import { createClient } from "@/lib/supabase/server";

export type DashboardMetrics = {
  one_time_jobs: number;
  plans_total: number;
  active_plans: number;
  conversion_rate: number;
  mrr_cents: number;
  arr_cents: number;
  median_ttr_days: number;
  churn_rate: number;
  reply_rate: number;
  at_risk: number;
};

const EMPTY_METRICS: DashboardMetrics = {
  one_time_jobs: 0,
  plans_total: 0,
  active_plans: 0,
  conversion_rate: 0,
  mrr_cents: 0,
  arr_cents: 0,
  median_ttr_days: 0,
  churn_rate: 0,
  reply_rate: 0,
  at_risk: 0,
};

export async function getMetrics(orgId: string): Promise<DashboardMetrics> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_dashboard_metrics", {
      p_org_id: orgId,
    });
    if (error || !data) return EMPTY_METRICS;
    return data as unknown as DashboardMetrics;
  } catch {
    return EMPTY_METRICS;
  }
}

export async function getMonthlyConversions(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_monthly_conversions", {
    p_org_id: orgId,
  });
  return (data ?? []) as unknown as { month: string; conversions: number }[];
}

export async function getAtRiskPlans(orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("recurring_plans")
    .select(
      "id, risk_level, price_cents, currency, next_service_at, customers(id, full_name, phone)"
    )
    .eq("organization_id", orgId)
    .eq("status", "active")
    .in("risk_level", ["medium", "high"])
    .order("risk_level", { ascending: false })
    .limit(20);
  return data ?? [];
}
