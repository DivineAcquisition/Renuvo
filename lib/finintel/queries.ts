import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type BookMetrics = {
  as_of_date: string;
  mrr_microdollars: number;
  active_plans: number;
  avg_plan_value_microdollars: number;
  churn_rate_30d: number | null;
  involuntary_churn_rate_30d: number | null;
  collection_rate: number | null;
  mrr_volatility: number | null;
  churn_adjusted_forward_mrr: number | null;
  net_revenue_retention: number | null;
  mrr_growth_30d: number | null;
  book_age_days: number | null;
  book_health_score: number | null;
  health_reason: string | null;
};

/** A tenant's latest book metrics (own only, via RLS). */
export async function getLatestBookMetrics(
  orgId: string
): Promise<BookMetrics | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("book_metrics")
    .select("*")
    .eq("organization_id", orgId)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as BookMetrics | null) ?? null;
}

export type PortfolioRow = BookMetrics & {
  organization_id: string;
  org_name: string;
};

/** Platform-admin portfolio: latest metrics per org. READ-ONLY measurement. */
export async function getBookPortfolio(): Promise<PortfolioRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("book_metrics")
    .select("*, organizations(name)")
    .order("as_of_date", { ascending: false })
    .limit(5000);
  const seen = new Set<string>();
  const out: PortfolioRow[] = [];
  for (const r of data ?? []) {
    const orgId = r.organization_id as string;
    if (seen.has(orgId)) continue; // keep latest per org (rows are date-desc)
    seen.add(orgId);
    out.push({
      ...(r as unknown as BookMetrics),
      organization_id: orgId,
      org_name:
        (r.organizations as unknown as { name?: string } | null)?.name ??
        "Unknown",
    });
  }
  return out.sort(
    (a, b) => (a.book_health_score ?? 0) - (b.book_health_score ?? 0)
  );
}
