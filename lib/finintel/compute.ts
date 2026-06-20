import { createAdminClient } from "@/lib/supabase/admin";
import { fromCents } from "@/lib/money";
import { log } from "@/lib/log";

const DAY = 86_400_000;

/** Normalize a per-visit price (cents) at a cadence (interval_days) to monthly µ$. */
function monthlyMicro(priceCents: number, intervalDays: number): number {
  const visitsPerMonth = intervalDays > 0 ? 30 / intervalDays : 1;
  return Math.round(fromCents(priceCents) * visitsPerMonth);
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return Math.round(Math.sqrt(v));
}

type HealthInput = {
  churn30: number;
  collection: number | null;
  volatility: number;
  mrr: number;
  nrr: number | null;
  bookAgeDays: number;
};

/** Transparent 0..100 book-health composite + a plain reason (no black box). */
function bookHealth(i: HealthInput): { score: number; reason: string } {
  const parts: string[] = [];
  // collection reliability — heaviest weight (can they actually collect?)
  const collection = i.collection ?? 0.9; // assume healthy until proven otherwise
  let score = collection * 45;
  if (i.collection != null)
    parts.push(`${Math.round(collection * 100)}% collection`);
  // stickiness
  score += (1 - Math.min(1, i.churn30)) * 30;
  parts.push(`${Math.round(i.churn30 * 100)}% churn`);
  // growth under its own weight
  if (i.nrr != null) {
    score += Math.max(0, Math.min(1, i.nrr - 0.9) / 0.3) * 15; // 90%→0, 120%→full
    parts.push(`${Math.round(i.nrr * 100)}% NRR`);
  } else {
    score += 7.5;
  }
  // predictability — penalize volatility relative to MRR
  const volRatio = i.mrr > 0 ? Math.min(1, i.volatility / i.mrr) : 0;
  score -= volRatio * 10;
  // track record (capped at ~180d)
  score += Math.min(1, i.bookAgeDays / 180) * 10;
  if (i.bookAgeDays < 60) parts.push(`${i.bookAgeDays}d track record`);

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reason: parts.join(", "),
  };
}

/**
 * Compute one org's book metrics for `asOf`. READ-ONLY over financial_entries +
 * outcome_events + recurring_plans. Writes ONLY book_metrics. No money moves.
 */
export async function computeBookMetrics(
  orgId: string,
  asOf = new Date()
): Promise<void> {
  const admin = createAdminClient();
  const asOfDate = asOf.toISOString().slice(0, 10);
  const since30 = new Date(asOf.getTime() - 30 * DAY);
  const since6mo = new Date(asOf.getTime() - 182 * DAY);

  // --- BOOK VALUE: normalized MRR from active plans (cadence via cadence_profiles)
  const { data: plans } = await admin
    .from("recurring_plans")
    .select("price_cents, status, created_at, cadence_profiles(interval_days)")
    .eq("organization_id", orgId);
  const active = (plans ?? []).filter((p) => p.status === "active");
  const mrr = active.reduce((s, p) => {
    const days =
      (p.cadence_profiles as unknown as { interval_days?: number } | null)
        ?.interval_days ?? 30;
    return s + monthlyMicro(p.price_cents, days);
  }, 0);
  const activeCount = active.length;
  const avg = activeCount ? Math.round(mrr / activeCount) : 0;

  // --- PREDICTABILITY: churn from outcome_events; collection from ledger + outcomes
  const { data: outcomes } = await admin
    .from("outcome_events")
    .select("type")
    .eq("organization_id", orgId)
    .gte("occurred_at", since30.toISOString());
  const canceled = (outcomes ?? []).filter((o) => o.type === "plan_canceled").length;
  const failed = (outcomes ?? []).filter((o) => o.type === "plan_failed").length;
  const baseActive = activeCount + canceled + failed || 1;
  const churn30 = (canceled + failed) / baseActive;
  const involuntary30 = failed / baseActive;

  // collection rate: successful recurring invoices (subscription_fee ledger entries)
  // vs failed charges. Null when there's nothing to measure (honest, not fabricated).
  const { count: succeededCharges } = await admin
    .from("financial_entries")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("category", "subscription_fee")
    .gte("occurred_at", since30.toISOString());
  const succeeded = succeededCharges ?? 0;
  const collection =
    succeeded + failed > 0 ? succeeded / (succeeded + failed) : null;

  // volatility: stddev of prior daily MRR snapshots over 6mo
  const { data: history } = await admin
    .from("book_metrics")
    .select("mrr_microdollars, as_of_date")
    .eq("organization_id", orgId)
    .gte("as_of_date", since6mo.toISOString().slice(0, 10))
    .order("as_of_date");
  const volatility = stddev((history ?? []).map((h) => Number(h.mrr_microdollars)));

  // churn-adjusted forward MRR (3 months out, simple projection)
  const forward = Math.round(mrr * Math.pow(1 - churn30, 3));

  // --- TRAJECTORY ---
  const mrr30agoRow = (history ?? [])
    .filter((h) => h.as_of_date <= since30.toISOString().slice(0, 10))
    .pop();
  const mrr30ago = mrr30agoRow ? Number(mrr30agoRow.mrr_microdollars) : mrr;
  const growth30 = mrr30ago > 0 ? (mrr - mrr30ago) / mrr30ago : 0;
  // NRR approximation: current MRR / MRR 30d ago (no separate expansion tracking yet)
  const nrr = mrr30ago > 0 ? mrr / mrr30ago : null;
  const createdTimes = active
    .map((p) => (p.created_at ? new Date(p.created_at).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  const bookAge = createdTimes.length
    ? Math.round((asOf.getTime() - Math.min(...createdTimes)) / DAY)
    : 0;

  const { score, reason } = bookHealth({
    churn30,
    collection,
    volatility,
    mrr,
    nrr,
    bookAgeDays: bookAge,
  });

  await admin.from("book_metrics").upsert(
    {
      organization_id: orgId,
      as_of_date: asOfDate,
      mrr_microdollars: mrr,
      active_plans: activeCount,
      avg_plan_value_microdollars: avg,
      churn_rate_30d: churn30,
      involuntary_churn_rate_30d: involuntary30,
      collection_rate: collection,
      mrr_volatility: volatility,
      churn_adjusted_forward_mrr: forward,
      net_revenue_retention: nrr,
      mrr_growth_30d: growth30,
      book_age_days: bookAge,
      book_health_score: score,
      health_reason: reason,
      computed_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,as_of_date" }
  );
}

/** Compute for every org that has at least one recurring plan. */
export async function computeAllBookMetrics(): Promise<{ orgs: number }> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("recurring_plans")
    .select("organization_id")
    .limit(20000);
  const orgIds = Array.from(
    new Set((rows ?? []).map((r) => r.organization_id))
  );
  for (const orgId of orgIds) {
    try {
      await computeBookMetrics(orgId);
    } catch {
      /* one org's failure never aborts the batch */
    }
  }
  log.info("finintel.computed", { event: "book_metrics_computed", orgs: orgIds.length });
  return { orgs: orgIds.length };
}
