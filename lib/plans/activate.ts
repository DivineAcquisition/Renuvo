import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry } from "@/lib/retry";
import { intervalToStripe, nextVisitDates } from "./cadence";
import { generateMessage } from "@/lib/agent/generate";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { writeVisitsToCalendar } from "@/lib/calendar/sync";
import { getEntitlement } from "@/lib/billing/entitlements";

const FIRST_INSTANCES = 4;

export type ActivateResult =
  | { ok: true; subscriptionId: string; instances: number }
  | { ok: false; reason: string };

function errCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e
    ? String((e as { code?: string }).code)
    : "activation_failed";
}

/**
 * Turn a pending plan into live recurring revenue: subscription on the connected
 * account, first N recurring job instances, plan → active, confirmation SMS,
 * calendar push. Idempotent (no-op if already active). Plan-state writes go
 * through the service-role admin client (this runs in the public enroll context).
 */
export async function activateRecurringPlan(
  planId: string,
  args: { paymentMethodId: string; cadenceProfileId: string }
): Promise<ActivateResult> {
  const admin = createAdminClient();

  const { data: plan } = await admin
    .from("recurring_plans")
    .select(
      "id, organization_id, customer_id, origin_job_id, price_cents, currency, status, stripe_subscription_id, stripe_customer_id"
    )
    .eq("id", planId)
    .single();
  if (!plan) return { ok: false, reason: "plan_not_found" };

  // IDEMPOTENCY: already activated?
  if (plan.status === "active" || plan.stripe_subscription_id) {
    return {
      ok: true,
      subscriptionId: plan.stripe_subscription_id ?? "",
      instances: 0,
    };
  }

  const [{ data: org }, { data: cadence }, { data: customer }] =
    await Promise.all([
      admin
        .from("organizations")
        .select("name, stripe_account_id")
        .eq("id", plan.organization_id)
        .single(),
      admin
        .from("cadence_profiles")
        .select("interval_days, label")
        .eq("id", args.cadenceProfileId)
        .single(),
      admin
        .from("customers")
        .select("phone, sms_sendable")
        .eq("id", plan.customer_id)
        .single(),
    ]);
  if (!org?.stripe_account_id)
    return { ok: false, reason: "no_connected_account" };
  if (!cadence || !plan.stripe_customer_id)
    return { ok: false, reason: "missing_billing_context" };

  // plan gating: enforce the org's max_active_plans entitlement (Prompt 30)
  const maxActive = await getEntitlement(plan.organization_id, "max_active_plans");
  if (typeof maxActive === "number") {
    const { count } = await admin
      .from("recurring_plans")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", plan.organization_id)
      .eq("status", "active");
    if ((count ?? 0) >= maxActive)
      return { ok: false, reason: "plan_limit_reached" };
  }

  const acct = org.stripe_account_id;
  const rec = intervalToStripe(cadence.interval_days);
  const orgName = org.name ?? "your provider";

  let subscriptionId = "";
  let instanceCount = 0;
  const dates = nextVisitDates(cadence.interval_days, FIRST_INSTANCES);

  // ---- CORE: subscription + jobs + plan-active. Failure here → stays pending.
  try {
    const stripe = await getStripe();

    // set the saved card as default on the connected-account customer
    await withRetry(
      () =>
        stripe.customers.update(
          plan.stripe_customer_id!,
          {
            invoice_settings: {
              default_payment_method: args.paymentMethodId,
            },
          },
          { stripeAccount: acct }
        ),
      { label: "stripe.customer_update" }
    );

    const appFee = process.env.STRIPE_APP_FEE_PERCENT
      ? { application_fee_percent: Number(process.env.STRIPE_APP_FEE_PERCENT) }
      : {};

    // subscription item price_data needs a product id (not inline product_data)
    const product = await withRetry(
      () =>
        stripe.products.create(
          { name: `${orgName} — recurring service` },
          { stripeAccount: acct }
        ),
      { label: "stripe.product_create" }
    );

    const sub = await withRetry(
      () =>
        stripe.subscriptions.create(
          {
            customer: plan.stripe_customer_id!,
            default_payment_method: args.paymentMethodId,
            items: [
              {
                price_data: {
                  currency: plan.currency,
                  unit_amount: plan.price_cents,
                  recurring: {
                    interval: rec.interval,
                    interval_count: rec.interval_count,
                  },
                  product: product.id,
                },
              },
            ],
            metadata: { renuvo_plan_id: plan.id },
            ...appFee,
          },
          { stripeAccount: acct }
        ),
      { label: "stripe.subscription_create" }
    );
    subscriptionId = sub.id;

    const instanceRows = dates.map((d) => ({
      organization_id: plan.organization_id,
      customer_id: plan.customer_id,
      kind: "recurring" as const,
      status: "scheduled" as const,
      cadence_profile_id: args.cadenceProfileId,
      parent_job_id: plan.origin_job_id,
      recurring_plan_id: plan.id,
      scheduled_at: d.toISOString(),
      price_cents: plan.price_cents,
      currency: plan.currency,
    }));
    await admin.from("jobs").insert(instanceRows);
    instanceCount = instanceRows.length;

    // flip plan → active (+ 'activated' retention event) — service-role RPC
    await admin.rpc("activate_plan", {
      p_plan: plan.id,
      p_stripe_subscription_id: sub.id,
      p_started_at: new Date().toISOString(),
      p_next_service_at: dates[0].toISOString(),
    });

    await admin.rpc("record_event", {
      p_org_id: plan.organization_id,
      p_type: "recurring_booked",
      p_source: "system",
      p_customer_id: plan.customer_id,
      p_plan_id: plan.id,
      p_payload: {
        subscription_id: sub.id,
        cadence: cadence.label,
        price_cents: plan.price_cents,
      },
    });
  } catch (e) {
    console.error("[activate] failed:", e);
    await admin.rpc("record_event", {
      p_org_id: plan.organization_id,
      p_type: "agent_action",
      p_source: "system",
      p_customer_id: plan.customer_id,
      p_plan_id: plan.id,
      p_payload: { action: "activation_failed", reason: errCode(e) },
    });
    return { ok: false, reason: errCode(e) };
  }

  // ---- SIDE EFFECTS (best-effort): never roll back a completed activation. ----

  // confirmation SMS (guarded)
  try {
    if (customer?.sms_sendable && customer.phone) {
      const gen = await generateMessage({
        orgId: plan.organization_id,
        customerId: plan.customer_id,
        eventKey: "recurring_confirmation",
        planId: plan.id,
      });
      if (gen.text) {
        await sendGuardedSms({
          orgId: plan.organization_id,
          customerId: plan.customer_id,
          toPhone: customer.phone,
          body: gen.text,
          eventType: "message_sent",
          meta: { kind: "recurring_confirmation", plan_id: plan.id },
        });
      }
    }
  } catch (e) {
    console.error("[activate] confirmation SMS failed (non-blocking):", e);
  }

  // calendar push — fire-and-forget, never blocks (Prompt 15)
  void writeVisitsToCalendar(
    plan.organization_id,
    dates.map((d) => ({
      jobId: plan.id,
      title: `${orgName} — recurring visit`,
      startISO: d.toISOString(),
    }))
  ).catch(() => {});

  return { ok: true, subscriptionId, instances: instanceCount };
}
