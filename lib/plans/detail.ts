import { createClient } from "@/lib/supabase/server";

export async function getPlanDetail(orgId: string, planId: string) {
  const supabase = await createClient();
  const [{ data: plan }, { data: jobs }, { data: payments }, { data: lineItems }] =
    await Promise.all([
      supabase
        .from("recurring_plans")
        .select(
          "*, customers(id, full_name, phone), cadence_profiles(label, interval_days), service_packages(name)"
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
      supabase
        .from("plan_line_items")
        .select("id, kind, label, price_cents")
        .eq("organization_id", orgId)
        .eq("recurring_plan_id", planId)
        .order("created_at", { ascending: true }),
    ]);
  return {
    plan,
    jobs: jobs ?? [],
    payments: payments ?? [],
    lineItems: lineItems ?? [],
  };
}
