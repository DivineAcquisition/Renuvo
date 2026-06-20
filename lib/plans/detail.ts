import { createClient } from "@/lib/supabase/server";

export async function getPlanDetail(orgId: string, planId: string) {
  const supabase = await createClient();
  const [{ data: plan }, { data: jobs }, { data: payments }] =
    await Promise.all([
      supabase
        .from("recurring_plans")
        .select(
          "*, customers(id, full_name, phone), cadence_profiles(label, interval_days)"
        )
        .eq("organization_id", orgId)
        .eq("id", planId)
        .maybeSingle(),
      supabase
        .from("jobs")
        .select("id, scheduled_at, status, price_cents")
        .eq("organization_id", orgId)
        .eq("recurring_plan_id", planId)
        .order("scheduled_at", { ascending: false })
        .limit(25),
      supabase
        .from("financial_entries")
        .select("id, occurred_at, amount_microdollars, category")
        .eq("organization_id", orgId)
        .eq("recurring_plan_id", planId)
        .order("occurred_at", { ascending: false })
        .limit(25),
    ]);
  return { plan, jobs: jobs ?? [], payments: payments ?? [] };
}
