"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSignupToken, consumeSignupToken } from "@/lib/capture/token";
import { cancelPendingMessages } from "@/lib/agent/engine";
import { activateRecurringPlan } from "@/lib/plans/activate"; // stub → Prompt 20
import { recordConsent } from "@/lib/consent";
import { markWinbackRecovered } from "@/lib/winback/recovery";

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
      p_price_cents: offer.priceCents,
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
  await admin
    .from("recurring_plans")
    .update({
      stripe_customer_id: input.stripeCustomerId,
      ...(offer.winbackDiscountPct > 0
        ? { meta: { winback_discount_pct: offer.winbackDiscountPct } }
        : {}),
    })
    .eq("id", plan.id);

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
