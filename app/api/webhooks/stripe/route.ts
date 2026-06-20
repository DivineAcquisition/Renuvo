import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPayment } from "@/lib/payments/record";
import { recordFinancialEntry } from "@/lib/money/ledger";
import { fromStripeAmount } from "@/lib/money";
import { getServerSecret } from "@/lib/secrets";
import { notify } from "@/lib/notify/dispatch";
import { enrollWinback } from "@/lib/winback/enroll";
import { markWinbackRecovered } from "@/lib/winback/recovery";
import { emitOutcome } from "@/lib/intelligence/emit";
import { log } from "@/lib/log";
import { captureError } from "@/lib/observability/logger";
import type Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  const stripe = await getStripe();
  const whsec = (await getServerSecret("STRIPE_WEBHOOK_SECRET")) ?? "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, whsec);
  } catch (e) {
    captureError(e, { event: "stripe_webhook_error" });
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  log.info("webhook.stripe.received", { type: event.type });

  // Stripe subscription.status → our platform sub_status enum.
  function mapPlatformStatus(s: string): string {
    if (s === "trialing") return "trialing";
    if (s === "active") return "active";
    if (s === "past_due" || s === "unpaid" || s === "incomplete")
      return "past_due";
    if (s === "canceled" || s === "incomplete_expired") return "canceled";
    return "active";
  }

  // Only care about successful charges on CONNECTED accounts
  if (
    event.type === "charge.succeeded" ||
    event.type === "payment_intent.succeeded"
  ) {
    const connectedAccountId = event.account; // set for Connect events
    if (!connectedAccountId) return NextResponse.json({ received: true });

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_account_id", connectedAccountId)
      .maybeSingle();
    if (!org) return NextResponse.json({ received: true });

    // normalize the charge
    const obj = event.data.object as Stripe.Charge | Stripe.PaymentIntent;
    const charge =
      "billing_details" in obj
        ? (obj as Stripe.Charge)
        : ((obj as Stripe.PaymentIntent).latest_charge as Stripe.Charge | null);

    const amount =
      (obj as Stripe.PaymentIntent).amount_received ??
      (obj as Stripe.Charge).amount ??
      charge?.amount ??
      0;
    const md = (obj.metadata ?? {}) as Record<string, string>;

    await recordPayment({
      orgId: org.id,
      source: "stripe",
      externalId: obj.id,
      amountCents: amount,
      currency: obj.currency ?? "usd",
      customer: {
        phone: md.phone ?? charge?.billing_details?.phone ?? null,
        email: md.email ?? charge?.billing_details?.email ?? null,
        fullName: md.name ?? charge?.billing_details?.name ?? null,
        // consent ONLY if the owner explicitly flagged it in metadata
        smsConsent: md.sms_consent === "true",
        consentSource: md.sms_consent === "true" ? "booking_form" : undefined,
      },
      metadata: { stripe_event: event.id },
    });
  }

  // Connected-account subscription lifecycle → keep plan status truthful.
  if (
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed" ||
    event.type === "customer.subscription.deleted"
  ) {
    const admin = createAdminClient();

    // idempotency: skip if this Stripe event was already processed
    const { data: seen } = await admin
      .from("events")
      .select("id")
      .eq("source", "stripe")
      .eq("external_id", event.id)
      .maybeSingle();
    if (seen) return NextResponse.json({ received: true });

    // ---- PLATFORM account (flows 1 & 2): Renuvo's SaaS billing. No event.account.
    if (!event.account) {
      let platformOrgId: string | null = null;

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as Stripe.Subscription;
        const { data: org } = await admin
          .from("organizations")
          .select("id")
          .eq("platform_subscription_id", sub.id)
          .maybeSingle();
        if (org) {
          platformOrgId = org.id;
          await admin
            .from("organizations")
            .update({ subscription_status: "canceled" })
            .eq("id", org.id);
        }
      } else {
        const inv = event.data.object as {
          id?: string;
          amount_paid?: number;
          subscription?: string | { id?: string } | null;
          lines?: { data?: { period?: { end?: number } }[] };
        };
        const psubId =
          typeof inv.subscription === "string"
            ? inv.subscription
            : inv.subscription?.id ?? null;
        if (psubId) {
          const { data: org } = await admin
            .from("organizations")
            .select("id")
            .eq("platform_subscription_id", psubId)
            .maybeSingle();
          if (org) {
            platformOrgId = org.id;
            if (event.type === "invoice.payment_failed") {
              await admin
                .from("organizations")
                .update({ subscription_status: "past_due" })
                .eq("id", org.id);
            } else {
              // invoice.payment_succeeded → active + period end + SaaS revenue
              const periodEnd = inv.lines?.data?.[0]?.period?.end;
              await admin
                .from("organizations")
                .update({
                  subscription_status: "active",
                  current_period_end: periodEnd
                    ? new Date(periodEnd * 1000).toISOString()
                    : null,
                })
                .eq("id", org.id);
              const paid = inv.amount_paid ?? 0;
              if (paid > 0) {
                await recordFinancialEntry({
                  orgId: org.id,
                  category: "saas_fee",
                  bucket: "platform_revenue",
                  amountMicrodollars: fromStripeAmount(paid),
                  source: "stripe",
                  reference: inv.id ?? event.id,
                });
              }
            }
          }
        }
      }

      // mark processed (idempotency) if we resolved an org
      if (platformOrgId) {
        await admin.rpc("record_event", {
          p_org_id: platformOrgId,
          p_type: "agent_action",
          p_source: "stripe",
          p_external_id: event.id,
          p_payload: { action: "platform_billing", stripe_type: event.type },
        });
      }
      return NextResponse.json({ received: true });
    }

    // ---- CONNECTED account (flow 3): the tenant's customers ----
    // resolve the subscription id, then the owned plan
    let subId: string | null = null;
    if (event.type === "customer.subscription.deleted") {
      subId = (event.data.object as Stripe.Subscription).id;
    } else {
      const inv = event.data.object as {
        subscription?: string | { id?: string } | null;
      };
      subId =
        typeof inv.subscription === "string"
          ? inv.subscription
          : inv.subscription?.id ?? null;
    }
    if (!subId) return NextResponse.json({ received: true });

    const { data: plan } = await admin
      .from("recurring_plans")
      .select("id, organization_id, customer_id, risk_level")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    if (!plan) return NextResponse.json({ received: true });

    if (event.type === "invoice.payment_failed") {
      await admin
        .from("recurring_plans")
        .update({ risk_level: "high" })
        .eq("id", plan.id);
      await admin.from("retention_events").insert({
        organization_id: plan.organization_id,
        recurring_plan_id: plan.id,
        customer_id: plan.customer_id,
        type: "payment_failed",
      });
      void notify(plan.organization_id, "failed_payment", {
        title: "A recurring payment failed",
        body: "A client's card was declined. Their plan is now at risk.",
        link: "/dashboard",
      });
      // involuntary churn → time-sensitive recovery (no cooldown, no discount)
      await enrollWinback({
        orgId: plan.organization_id,
        customerId: plan.customer_id,
        planId: plan.id,
        kind: "involuntary",
      });
      await emitOutcome({
        orgId: plan.organization_id,
        type: "plan_failed",
        recurringPlanId: plan.id,
        customerId: plan.customer_id,
      });
    } else if (event.type === "invoice.payment_succeeded") {
      // only a meaningful "recovery" if the plan was previously at risk
      if (plan.risk_level !== "none") {
        await admin
          .from("recurring_plans")
          .update({ risk_level: "none" })
          .eq("id", plan.id);
        await admin.from("retention_events").insert({
          organization_id: plan.organization_id,
          recurring_plan_id: plan.id,
          customer_id: plan.customer_id,
          type: "payment_recovered",
        });
        // the card works again → close out any involuntary win-back
        await markWinbackRecovered({
          orgId: plan.organization_id,
          customerId: plan.customer_id,
          kind: "involuntary",
        });
        await emitOutcome({
          orgId: plan.organization_id,
          type: "plan_recovered",
          recurringPlanId: plan.id,
          customerId: plan.customer_id,
        });
      }

      // Platform revenue: the application fee is RENUVO's money (NOT the full
      // invoice amount — that's the tenant's). Record it to the ledger, idempotent.
      const inv = event.data.object as {
        id?: string;
        application_fee_amount?: number | null;
      };
      const feeCents = inv.application_fee_amount ?? 0;
      if (feeCents > 0) {
        await recordFinancialEntry({
          orgId: plan.organization_id,
          category: "subscription_fee",
          bucket: "platform_revenue",
          amountMicrodollars: fromStripeAmount(feeCents),
          source: "stripe",
          reference: inv.id ?? `${subId}_${event.id}`,
          recurringPlanId: plan.id,
        });
      }
    } else {
      // customer.subscription.deleted
      await admin.rpc("change_plan_status", {
        p_plan: plan.id,
        p_status: "cancelled",
        p_reason: "subscription_cancelled",
      });
      // a deletion that followed failed payments is involuntary; otherwise it's a
      // voluntary cancel. Either way enrollWinback dedupes against existing rows.
      await enrollWinback({
        orgId: plan.organization_id,
        customerId: plan.customer_id,
        planId: plan.id,
        kind: plan.risk_level === "high" ? "involuntary" : "voluntary",
      });
      await emitOutcome({
        orgId: plan.organization_id,
        type: "plan_canceled",
        recurringPlanId: plan.id,
        customerId: plan.customer_id,
      });
    }

    // mark processed (idempotency key = stripe event id)
    await admin.rpc("record_event", {
      p_org_id: plan.organization_id,
      p_type: "agent_action",
      p_source: "stripe",
      p_customer_id: plan.customer_id,
      p_plan_id: plan.id,
      p_external_id: event.id,
      p_payload: { action: "subscription_event", stripe_type: event.type },
    });
  }

  // ── customer.subscription.updated — status/period/pause-resume drift ─────────
  if (event.type === "customer.subscription.updated") {
    const admin = createAdminClient();
    const sub = event.data.object as Stripe.Subscription;
    const subAny = sub as unknown as {
      id: string;
      status: string;
      current_period_end?: number | null;
    };

    if (!event.account) {
      // PLATFORM SaaS: keep the org's billing state truthful between invoices.
      const { data: org } = await admin
        .from("organizations")
        .select("id")
        .eq("platform_subscription_id", sub.id)
        .maybeSingle();
      if (org) {
        await admin
          .from("organizations")
          .update({
            subscription_status: mapPlatformStatus(subAny.status),
            current_period_end: subAny.current_period_end
              ? new Date(subAny.current_period_end * 1000).toISOString()
              : null,
          })
          .eq("id", org.id);
      }
    } else {
      // CONNECTED: mirror pause/resume the owner did in Stripe back to the plan.
      const { data: plan } = await admin
        .from("recurring_plans")
        .select("id, status")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();
      if (plan) {
        if (subAny.status === "paused" && plan.status !== "paused") {
          await admin.rpc("change_plan_status", {
            p_plan: plan.id,
            p_status: "paused",
            p_reason: "stripe_paused",
          });
        } else if (subAny.status === "active" && plan.status !== "active") {
          await admin.rpc("change_plan_status", {
            p_plan: plan.id,
            p_status: "active",
            p_reason: "stripe_resumed",
          });
        }
      }
    }
    return NextResponse.json({ received: true });
  }

  // ── account.updated — Connect onboarding/readiness reconciliation ───────────
  if (event.type === "account.updated") {
    const admin = createAdminClient();
    const acct = event.data.object as Stripe.Account;
    const acctId = acct.id ?? event.account;
    if (acctId) {
      await admin
        .from("organizations")
        .update({
          stripe_charges_enabled: !!acct.charges_enabled,
          stripe_payouts_enabled: !!acct.payouts_enabled,
          stripe_details_submitted: !!acct.details_submitted,
        })
        .eq("stripe_account_id", acctId);
    }
    return NextResponse.json({ received: true });
  }

  // ── payment_intent.payment_failed — alert on a failed wallet auto-reload ─────
  if (event.type === "payment_intent.payment_failed" && !event.account) {
    const pi = event.data.object as Stripe.PaymentIntent;
    const md = (pi.metadata ?? {}) as Record<string, string>;
    if (md.purpose === "wallet_reload" && md.organization_id) {
      captureError(new Error("wallet_reload_payment_failed"), {
        orgId: md.organization_id,
        event: "wallet_reload_failed",
      });
      void notify(md.organization_id, "wallet_low", {
        title: "Card declined on SMS top-up",
        body: "We couldn't charge your card to refill your SMS balance. Update it to keep texts sending.",
        link: "/dashboard/settings/payments",
      });
    }
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}
