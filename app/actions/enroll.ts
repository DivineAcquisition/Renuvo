"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSignupToken, consumeSignupToken } from "@/lib/capture/token";
import { cancelPendingMessages } from "@/lib/agent/engine";
import { activateRecurringPlan } from "@/lib/plans/activate"; // stub → Prompt 20
import { recordConsent } from "@/lib/consent";
import { markWinbackRecovered } from "@/lib/winback/recovery";
import { composePlan } from "@/lib/packages/compose";

export type EnrollResult =
  | { error: string; planId?: string }
  | { ok: true; planId: string };

export async function enrollRecurring(input: {
  token: string;
  cadenceProfileId: string;
  smsConsent: boolean;
  billingConsent: boolean;
  paymentMethodId: string;
  stripeCustomerId: string;
  email?: string;
  emailConsent?: boolean;
  packageId?: string;
  addonIds?: string[];
}): Promise<EnrollResult> {
  if (!input.billingConsent) return { error: "billing_consent_required" };

  const offer = await resolveSignupToken(input.token);
  if (!offer || !offer.customerId) return { error: "invalid_or_expired" };
  const customerId = offer.customerId;

  const admin = createAdminClient();

  // 1) CAPTURE CONSENT on the customer (this is our clean, first-party opt-in).
  // SMS and email are SEPARATE legal bases — capture each independently.
  const email = input.email?.trim() || null;
  const grantEmail = !!(input.emailConsent && email);
  await admin
    .from("customers")
    .update({
      sms_consent: input.smsConsent,
      sms_consent_at: input.smsConsent ? new Date().toISOString() : null,
      sms_consent_source: input.smsConsent ? "recurring_signup" : null,
      ...(email ? { email } : {}),
      email_sendable: grantEmail,
      email_consent_at: grantEmail ? new Date().toISOString() : null,
      email_consent_source: grantEmail ? "capture_page" : null,
    })
    .eq("id", customerId);

  // A2P consent proof (HMAC, retained for years even if the customer is deleted)
  if (input.smsConsent) {
    const { data: cust } = await admin
      .from("customers")
      .select("phone")
      .eq("id", customerId)
      .maybeSingle();
    if (cust?.phone)
      await recordConsent({
        orgId: offer.orgId,
        phone: cust.phone,
        source: "capture_page",
      });
  }

  // Service packages (Prompt 47): if a package was chosen, compute the total from
  // the CURRENT menu and snapshot it onto the plan. No package → legacy single price.
  let composed: Awaited<ReturnType<typeof composePlan>> | null = null;
  if (input.packageId) {
    try {
      composed = await composePlan(offer.orgId, {
        packageId: input.packageId,
        addonIds: input.addonIds ?? [],
      });
    } catch {
      return { error: "package_not_available" };
    }
  }
  const planPriceCents = composed ? composed.totalCents : offer.priceCents;

  // 2) CREATE THE OWNED PLAN (pending) + plan_created retention event (Prompt 6).
  // The public page has no auth session, so we go through the service-role client
  // (create_recurring_plan is SECURITY INVOKER; service_role bypasses RLS).
  const { data: planRow, error: planErr } = await admin.rpc(
    "create_recurring_plan",
    {
      p_org: offer.orgId,
      p_customer: customerId,
      p_origin_job: offer.jobId ?? undefined,
      p_cadence: input.cadenceProfileId,
      p_price_cents: planPriceCents,
      p_currency: offer.currency,
    }
  );
  if (planErr || !planRow) {
    if (planErr?.code === "23505") return { error: "active_plan_exists" };
    return { error: planErr?.message ?? "plan_create_failed" };
  }
  const plan = planRow as { id: string };

  // 3) attach the billing identity to the plan (subscription created in Prompt 20).
  // If this came from a win-back link, record the incentive on the plan so
  // margin/LTV reporting stays honest about what we gave away.
  const meta: Record<string, unknown> = {};
  if (offer.winbackDiscountPct > 0)
    meta.winback_discount_pct = offer.winbackDiscountPct;
  if (composed && composed.discountPct > 0)
    meta.package_discount_pct = composed.discountPct;

  await admin
    .from("recurring_plans")
    .update({
      stripe_customer_id: input.stripeCustomerId,
      ...(composed ? { service_package_id: input.packageId } : {}),
      ...(Object.keys(meta).length ? { meta } : {}),
    })
    .eq("id", plan.id);

  // snapshot the composition — the immutable record of what they agreed to
  if (composed) {
    await admin.from("plan_line_items").insert(
      composed.lineItems.map((li) => ({
        organization_id: offer.orgId,
        recurring_plan_id: plan.id,
        kind: li.kind,
        ref_id: li.ref_id,
        label: li.label,
        price_cents: li.price_cents,
      }))
    );
  }

  // 4) consume the token (single-use) + stop the conversion sequence
  await consumeSignupToken(offer.linkId);
  await cancelPendingMessages(offer.orgId, customerId, "enrolled");

  // a returnee came back → close out any live win-back campaigns + stop nudging
  await markWinbackRecovered({ orgId: offer.orgId, customerId });

  await admin.rpc("record_event", {
    p_org_id: offer.orgId,
    p_type: "agent_action",
    p_source: "system",
    p_customer_id: customerId,
    p_plan_id: plan.id,
    p_payload: {
      action: "enrollment_submitted",
      cadence_profile_id: input.cadenceProfileId,
    },
  });

  // 5) ACTIVATE → subscription + scheduled visits + confirmation SMS (Prompt 20).
  // Don't tell the customer "all set" unless billing actually started.
  const activation = await activateRecurringPlan(plan.id, {
    paymentMethodId: input.paymentMethodId,
    cadenceProfileId: input.cadenceProfileId,
  });
  if (!activation.ok) return { error: "activation_failed", planId: plan.id };

  return { ok: true, planId: plan.id };
}
