"use server";

import { cookies } from "next/headers";
import { getPortalSession, PORTAL_COOKIE } from "@/lib/portal/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { modifyPlan } from "@/lib/stripe/plan-modify";
import {
  pauseStripeSubscription,
  resumeStripeSubscription,
  cancelStripeSubscription,
} from "@/lib/stripe/recurring";
import { enrollWinback } from "@/lib/winback/enroll";
import { emitOutcome } from "@/lib/intelligence/emit";
import { captureError } from "@/lib/observability/logger";

async function session() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  const s = await getPortalSession(token);
  if (!s) throw new Error("no_session");
  return s;
}

/** The session customer's active/paused plan — the ONLY plan they may touch. */
async function activePlan(orgId: string, customerId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("recurring_plans")
    .select(
      "id, stripe_subscription_id, stripe_customer_id, price_cents, cadence_profile_id, next_service_at, status, cadence_profiles(interval_days, label)"
    )
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function logCustomerChange(
  orgId: string,
  planId: string,
  type: string,
  val: Record<string, unknown>
) {
  const admin = createAdminClient();
  await admin.from("plan_change_log").insert({
    organization_id: orgId,
    recurring_plan_id: planId,
    actor_kind: "customer",
    change_type: type,
    new_value: val,
  });
}

export async function portalSkipNextVisit() {
  try {
    const { orgId, customerId } = await session();
    const admin = createAdminClient();
    const plan = await activePlan(orgId, customerId);
    if (!plan?.stripe_subscription_id) return { error: "no_plan" };

    const { data: org } = await admin
      .from("organizations")
      .select("stripe_account_id")
      .eq("id", orgId)
      .single();
    const acct = (org as { stripe_account_id?: string | null } | null)
      ?.stripe_account_id;
    const intervalDays =
      (plan.cadence_profiles as unknown as { interval_days?: number } | null)
        ?.interval_days ?? 30;

    if (acct) {
      const stripe = await getStripe();
      const sub = await stripe.subscriptions.retrieve(
        plan.stripe_subscription_id,
        undefined,
        { stripeAccount: acct }
      );
      const periodEnd =
        (sub as unknown as { current_period_end?: number }).current_period_end ??
        Math.floor(Date.now() / 1000);
      // push the next charge by one cycle (a "skip") via trial extension
      const newEnd = periodEnd + intervalDays * 86_400;
      await stripe.subscriptions.update(
        plan.stripe_subscription_id,
        { trial_end: newEnd, proration_behavior: "none" },
        { stripeAccount: acct }
      );
      await admin
        .from("recurring_plans")
        .update({ next_service_at: new Date(newEnd * 1000).toISOString() })
        .eq("id", plan.id);
    }

    await admin.from("skipped_visits").insert({
      organization_id: orgId,
      recurring_plan_id: plan.id,
      skipped_charge_at: plan.next_service_at ?? new Date().toISOString(),
    });
    await logCustomerChange(orgId, plan.id, "status", { action: "skip_next" });
    return { ok: true };
  } catch (e) {
    captureError(e, { event: "portal_skip_failed" });
    return { error: "could_not_skip" };
  }
}

export async function portalChangeCadence(newCadenceProfileId: string) {
  const { orgId, customerId } = await session();
  const plan = await activePlan(orgId, customerId);
  if (!plan) return { error: "no_plan" };
  // customer-initiated → no surprise proration
  const res = await modifyPlan({
    orgId,
    planId: plan.id,
    newCadenceProfileId,
    prorate: "none",
    actorKind: "customer",
  });
  return res;
}

export async function portalPause() {
  const { orgId, customerId } = await session();
  const plan = await activePlan(orgId, customerId);
  if (!plan?.stripe_subscription_id) return { error: "no_plan" };
  await pauseStripeSubscription(orgId, plan.stripe_subscription_id);
  const admin = createAdminClient();
  await admin.rpc("change_plan_status", {
    p_plan: plan.id,
    p_status: "paused",
    p_reason: "customer_paused",
  });
  await logCustomerChange(orgId, plan.id, "status", { status: "paused" });
  return { ok: true };
}

export async function portalResume() {
  const { orgId, customerId } = await session();
  const plan = await activePlan(orgId, customerId);
  if (!plan?.stripe_subscription_id) return { error: "no_plan" };
  await resumeStripeSubscription(orgId, plan.stripe_subscription_id);
  const admin = createAdminClient();
  await admin.rpc("change_plan_status", {
    p_plan: plan.id,
    p_status: "active",
    p_reason: "customer_resumed",
  });
  await logCustomerChange(orgId, plan.id, "status", { status: "active" });
  return { ok: true };
}

export async function portalCancel(reason?: string) {
  const { orgId, customerId } = await session();
  const plan = await activePlan(orgId, customerId);
  if (!plan?.stripe_subscription_id) return { error: "no_plan" };
  await cancelStripeSubscription(orgId, plan.stripe_subscription_id);
  const admin = createAdminClient();
  await admin.rpc("change_plan_status", {
    p_plan: plan.id,
    p_status: "cancelled",
    p_reason: reason ?? "customer_cancelled",
  });
  await logCustomerChange(orgId, plan.id, "status", {
    status: "cancelled",
    reason,
  });
  // cancelling does NOT revoke SMS/email consent (separate basis); win-back may
  // re-engage later while still consented.
  await enrollWinback({ orgId, customerId, planId: plan.id, kind: "voluntary" });
  await emitOutcome({
    orgId,
    type: "plan_canceled",
    recurringPlanId: plan.id,
    customerId,
  });
  return { ok: true };
}
