import { createAdminClient } from "@/lib/supabase/admin";
import {
  pauseStripeSubscription,
  resumeStripeSubscription,
  cancelStripeSubscription,
} from "@/lib/stripe/recurring";
import { modifyPlan } from "@/lib/stripe/plan-modify";
import { enrollWinback } from "@/lib/winback/enroll";
import { issuePortalLink } from "@/lib/portal/auth";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";

export type ItemResult = { status: "ok" } | { status: "skip"; reason: string };

/**
 * Run ONE item of a bulk operation. Reuses the per-account primitives. Returns a
 * skip (with reason) for benign no-ops (already in state, not consented) and
 * THROWS for real failures so the worker records a per-item error.
 */
export async function runBulkItem(
  orgId: string,
  action: string,
  planId: string,
  params: Record<string, unknown>,
  actorId: string | null
): Promise<ItemResult> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("recurring_plans")
    .select(
      "id, status, stripe_subscription_id, customer_id, customers(full_name, phone, sms_sendable)"
    )
    .eq("id", planId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!plan) return { status: "skip", reason: "not_found" };

  const cust = plan.customers as unknown as {
    full_name: string | null;
    phone: string | null;
    sms_sendable: boolean;
  } | null;

  switch (action) {
    case "pause": {
      if (plan.status !== "active") return { status: "skip", reason: "not_active" };
      if (plan.stripe_subscription_id)
        await pauseStripeSubscription(orgId, plan.stripe_subscription_id);
      await admin.rpc("change_plan_status", {
        p_plan: planId,
        p_status: "paused",
        p_reason: "bulk_pause",
      });
      return { status: "ok" };
    }
    case "resume": {
      if (plan.status !== "paused") return { status: "skip", reason: "not_paused" };
      if (plan.stripe_subscription_id)
        await resumeStripeSubscription(orgId, plan.stripe_subscription_id);
      await admin.rpc("change_plan_status", {
        p_plan: planId,
        p_status: "active",
        p_reason: "bulk_resume",
      });
      return { status: "ok" };
    }
    case "cancel": {
      if (plan.status === "cancelled")
        return { status: "skip", reason: "already_cancelled" };
      if (plan.stripe_subscription_id)
        await cancelStripeSubscription(orgId, plan.stripe_subscription_id);
      await admin.rpc("change_plan_status", {
        p_plan: planId,
        p_status: "cancelled",
        p_reason: "bulk_cancel",
      });
      if (plan.customer_id)
        await enrollWinback({
          orgId,
          customerId: plan.customer_id,
          planId,
          kind: "voluntary",
        });
      return { status: "ok" };
    }
    case "adjust_price": {
      const newPriceCents = Number(params.newPriceCents);
      const prorate =
        (params.prorate as
          | "create_prorations"
          | "none"
          | "always_invoice") ?? "create_prorations";
      const res = await modifyPlan({
        orgId,
        planId,
        newPriceCents,
        prorate,
        actorId: actorId ?? undefined,
      });
      if ("error" in res) throw new Error(res.error);
      return { status: "ok" };
    }
    case "message": {
      if (!cust?.sms_sendable || !cust.phone)
        return { status: "skip", reason: "not_consented" };
      const res = await sendGuardedSms({
        orgId,
        customerId: plan.customer_id,
        toPhone: cust.phone,
        body: String(params.body ?? ""),
        eventType: "message_sent",
        meta: { reason: "bulk_message" },
      });
      if (!res.ok) {
        if (res.reason === "not_sendable")
          return { status: "skip", reason: "not_consented" };
        throw new Error(res.reason);
      }
      return { status: "ok" };
    }
    case "request_payment_update": {
      if (!cust?.sms_sendable || !cust.phone)
        return { status: "skip", reason: "not_consented" };
      const link = await issuePortalLink(orgId, plan.customer_id, "payment_update");
      const first =
        (cust.full_name ?? "there").trim().split(/\s+/)[0] || "there";
      const res = await sendGuardedSms({
        orgId,
        customerId: plan.customer_id,
        toPhone: cust.phone,
        body: `Hi ${first}, please update your card to keep your service going: ${link}`,
        eventType: "message_sent",
        meta: { reason: "payment_update_request" },
      });
      if (!res.ok) throw new Error(res.reason);
      await admin.from("plan_change_log").insert({
        organization_id: orgId,
        recurring_plan_id: planId,
        actor_id: actorId,
        actor_kind: "owner",
        change_type: "payment",
        new_value: { action: "update_requested", sent: true },
      });
      return { status: "ok" };
    }
    default:
      return { status: "skip", reason: "unknown_action" };
  }
}
