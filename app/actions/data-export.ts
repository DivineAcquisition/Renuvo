"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";

/** Build a portable JSON bundle of the org's own data. Owner-gated. */
export async function exportOrgData() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can export." };
  const admin = createAdminClient();
  const orgId = active.org.id;

  const [customers, plans, jobs, messages, financial] = await Promise.all([
    admin
      .from("customers")
      .select("*")
      .eq("organization_id", orgId)
      .is("deleted_at", null),
    admin.from("recurring_plans").select("*").eq("organization_id", orgId),
    admin.from("jobs").select("*").eq("organization_id", orgId),
    // message log lives in the events spine
    admin
      .from("events")
      .select("id, customer_id, direction, body, type, occurred_at")
      .eq("organization_id", orgId)
      .in("direction", ["inbound", "outbound"])
      .limit(5000),
    admin.from("financial_entries").select("*").eq("organization_id", orgId),
  ]);

  const bundle = {
    exported_at: new Date().toISOString(),
    organization: { id: orgId, name: active.org.name },
    customers: customers.data ?? [],
    recurring_plans: plans.data ?? [],
    jobs: jobs.data ?? [],
    messages: messages.data ?? [],
    financial_entries: financial.data ?? [],
  };
  return { ok: true, bundle };
}
