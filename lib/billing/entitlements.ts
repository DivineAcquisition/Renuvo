import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The agent loop runs only for orgs with a live SaaS subscription. Trialing and
 * active count as live; past_due / canceled / none (after trial) do not. The
 * wallet still works (prepaid SMS) — this gates platform features, not funds.
 */
export async function requireActiveSubscription(orgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("subscription_status, trial_ends_at")
    .eq("id", orgId)
    .single();
  const o = org as {
    subscription_status?: string | null;
    trial_ends_at?: string | null;
  } | null;
  if (!o) return false;
  const status = o.subscription_status ?? "none";
  if (status === "active" || status === "trialing") return true;
  return false;
}

/**
 * Whether the agent loop may run for this org. Soft model: only a delinquent
 * subscription (past_due / canceled) pauses sends. Orgs that never subscribed
 * ('none') and trialing/active orgs keep running (tune stricter later).
 */
export async function canRunAgent(orgId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("subscription_status")
    .eq("id", orgId)
    .single();
  const status =
    (org as { subscription_status?: string | null } | null)
      ?.subscription_status ?? "none";
  return status !== "past_due" && status !== "canceled";
}

/** Read a plan feature value (e.g. max_active_plans) for the org's plan. */
export async function getEntitlement(
  orgId: string,
  key: string
): Promise<number | boolean | null> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("subscription_plan_id")
    .eq("id", orgId)
    .single();
  const planId = (org as { subscription_plan_id?: string | null } | null)
    ?.subscription_plan_id;
  if (!planId) return null;
  const { data: plan } = await admin
    .from("subscription_plans")
    .select("features")
    .eq("id", planId)
    .single();
  const features = (plan?.features ?? {}) as Record<string, unknown>;
  const v = features[key];
  if (typeof v === "number" || typeof v === "boolean") return v;
  return null;
}
