"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSignupToken, consumeSignupToken } from "@/lib/capture/token";
import { cancelPendingMessages } from "@/lib/agent/engine";
import { activateRecurringPlan } from "@/lib/plans/activate"; // stub → Prompt 20

export type EnrollResult = { error: string } | { ok: true; planId: string };

export async function enrollRecurring(input: {
  token: string;
  cadenceProfileId: string;
  smsConsent: boolean;
  billingConsent: boolean;
  paymentMethodId: string;
  stripeCustomerId: string;
}): Promise<EnrollResult> {
  if (!input.billingConsent) return { error: "billing_consent_required" };

  const offer = await resolveSignupToken(input.token);
  if (!offer) return { error: "invalid_or_expired" };

  const admin = createAdminClient();

  // 1) CAPTURE CONSENT on the customer (this is our clean, first-party opt-in)
  await admin
    .from("customers")
    .update({
      sms_consent: input.smsConsent,
      sms_consent_at: input.smsConsent ? new Date().toISOString() : null,
      sms_consent_source: input.smsConsent ? "recurring_signup" : null,
    })
    .eq("id", offer.customerId);

  // 2) CREATE THE OWNED PLAN (pending) + plan_created retention event (Prompt 6).
  // The public page has no auth session, so we go through the service-role client
  // (create_recurring_plan is SECURITY INVOKER; service_role bypasses RLS).
  const { data: planRow, error: planErr } = await admin.rpc(
    "create_recurring_plan",
    {
      p_org: offer.orgId,
      p_customer: offer.customerId,
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

  // 3) attach the billing identity to the plan (subscription created in Prompt 20)
  await admin
    .from("recurring_plans")
    .update({ stripe_customer_id: input.stripeCustomerId })
    .eq("id", plan.id);

  // 4) consume the token (single-use) + stop the conversion sequence
  await consumeSignupToken(offer.linkId);
  await cancelPendingMessages(offer.orgId, offer.customerId, "enrolled");

  await admin.rpc("record_event", {
    p_org_id: offer.orgId,
    p_type: "agent_action",
    p_source: "system",
    p_customer_id: offer.customerId,
    p_plan_id: plan.id,
    p_payload: {
      action: "enrollment_submitted",
      cadence_profile_id: input.cadenceProfileId,
    },
  });

  // 5) ACTIVATE → subscription + scheduled visits + confirmation SMS (Prompt 20)
  await activateRecurringPlan(plan.id, {
    paymentMethodId: input.paymentMethodId,
    cadenceProfileId: input.cadenceProfileId,
  });

  return { ok: true, planId: plan.id };
}
