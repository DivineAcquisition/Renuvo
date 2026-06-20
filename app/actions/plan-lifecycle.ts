"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  pauseStripeSubscription,
  resumeStripeSubscription,
  cancelStripeSubscription,
} from "@/lib/stripe/recurring";
import { revalidatePath } from "next/cache";

export async function pausePlan(planId: string) {
  return lifecycle(planId, "paused");
}
export async function resumePlan(planId: string) {
  return lifecycle(planId, "active");
}
export async function cancelPlan(planId: string) {
  return lifecycle(planId, "cancelled");
}

async function lifecycle(
  planId: string,
  status: "paused" | "active" | "cancelled"
) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("recurring_plans")
    .select("stripe_subscription_id")
    .eq("id", planId)
    .eq("organization_id", active.org.id)
    .single();
  if (!plan) return { error: "Plan not found." };

  try {
    const subId = plan.stripe_subscription_id;
    if (subId) {
      if (status === "paused") await pauseStripeSubscription(active.org.id, subId);
      if (status === "active") await resumeStripeSubscription(active.org.id, subId);
      if (status === "cancelled")
        await cancelStripeSubscription(active.org.id, subId);
    }
    await admin.rpc("change_plan_status", {
      p_plan: planId,
      p_status: status,
      p_reason: `owner_${status}`,
    });
    revalidatePath(`/dashboard/plans/${planId}`);
    return { ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not update the plan.",
    };
  }
}
