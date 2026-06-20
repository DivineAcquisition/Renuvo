import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * Transparent, explainable churn scorer (v1 — no black box). Grounded in real
 * outcomes: recent failed payments + skipped visits + tenure. Writes a 0–100
 * risk_score, a human reason, and maps to the existing risk_level so the home
 * at-risk queue + win-back engine react. A real ML model is a later iteration.
 */
export async function runChurnScoring(): Promise<{ scored: number }> {
  const admin = createAdminClient();

  const { data: plans } = await admin
    .from("recurring_plans")
    .select("id, organization_id, customer_id, started_at, risk_level")
    .eq("status", "active")
    .limit(5000);
  if (!plans?.length) return { scored: 0 };

  const planIds = plans.map((p) => p.id);
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const [{ data: fails }, { data: skips }] = await Promise.all([
    admin
      .from("outcome_events")
      .select("recurring_plan_id")
      .eq("type", "plan_failed")
      .gte("occurred_at", since90)
      .in("recurring_plan_id", planIds),
    admin
      .from("skipped_visits")
      .select("recurring_plan_id")
      .gte("created_at", since60)
      .in("recurring_plan_id", planIds),
  ]);

  const failBy = new Map<string, number>();
  for (const f of fails ?? [])
    if (f.recurring_plan_id)
      failBy.set(f.recurring_plan_id, (failBy.get(f.recurring_plan_id) ?? 0) + 1);
  const skipBy = new Map<string, number>();
  for (const s of skips ?? [])
    if (s.recurring_plan_id)
      skipBy.set(s.recurring_plan_id, (skipBy.get(s.recurring_plan_id) ?? 0) + 1);

  let scored = 0;
  for (const p of plans) {
    const failures = failBy.get(p.id) ?? 0;
    const skipCount = skipBy.get(p.id) ?? 0;
    const tenureDays = p.started_at
      ? (Date.now() - new Date(p.started_at).getTime()) / 86_400_000
      : 0;

    // transparent weighted score (auditable)
    let score = 0;
    const reasons: string[] = [];
    if (failures > 0) {
      score += Math.min(60, failures * 35);
      reasons.push(`${failures} failed payment${failures > 1 ? "s" : ""}`);
    }
    if (skipCount > 0) {
      score += Math.min(30, skipCount * 12);
      reasons.push(`${skipCount} skip${skipCount > 1 ? "s" : ""} in 60d`);
    }
    if (tenureDays > 0 && tenureDays < 30) {
      score += 10;
      reasons.push("new plan (<30d)");
    }
    score = Math.min(100, Math.round(score));

    const level =
      score >= 60 ? "high" : score >= 30 ? "medium" : score >= 10 ? "low" : "none";
    const reason = reasons.length ? reasons.join(" + ") : null;

    if (level !== p.risk_level || reason !== null) {
      await admin
        .from("recurring_plans")
        .update({ risk_score: score, risk_reason: reason, risk_level: level })
        .eq("id", p.id);
      scored++;
    }
  }

  log.info("churn.scored", { event: "churn_scored", scored });
  return { scored };
}
