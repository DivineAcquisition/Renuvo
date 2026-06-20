import { createAdminClient } from "@/lib/supabase/admin";

export type OutcomeType =
  | "capture_sent"
  | "capture_opened"
  | "plan_activated"
  | "plan_canceled"
  | "plan_failed"
  | "plan_recovered"
  | "visit_completed"
  | "reply_classified";

// tiny per-process cohort cache (vertical + coarse region) to avoid re-querying
const cohortCache = new Map<
  string,
  { vertical: string | null; regionBucket: string | null }
>();

/** Coarse cohort dimensions for an org: vertical key + region bucket (state). */
export async function getOrgCohort(orgId: string) {
  const cached = cohortCache.get(orgId);
  if (cached) return cached;
  const admin = createAdminClient();
  const [{ data: org }, { data: reg }] = await Promise.all([
    admin
      .from("organizations")
      .select("verticals(key)")
      .eq("id", orgId)
      .maybeSingle(),
    admin
      .from("a2p_registrations")
      .select("state")
      .eq("organization_id", orgId)
      .maybeSingle(),
  ]);
  const vertical =
    (org?.verticals as unknown as { key?: string } | null)?.key ?? null;
  // coarse geo ONLY (state), never address
  const regionBucket =
    ((reg as { state?: string } | null)?.state ?? "").trim().toUpperCase() ||
    null;
  const out = { vertical, regionBucket };
  cohortCache.set(orgId, out);
  return out;
}

/**
 * Emit an append-only outcome event — the shared substrate the intelligence layer
 * (and the future financial layer) read independently. Best-effort: never throws,
 * never blocks the operational path. Stamps coarse cohort dimensions (no PII).
 */
export async function emitOutcome(e: {
  orgId: string;
  type: OutcomeType;
  cadence?: string | null;
  messageTemplateKey?: string | null;
  discountPct?: number | null;
  sequenceStep?: number | null;
  recurringPlanId?: string | null;
  customerId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { vertical, regionBucket } = await getOrgCohort(e.orgId);
    const now = new Date();
    await admin.from("outcome_events").insert({
      organization_id: e.orgId,
      type: e.type,
      vertical,
      region_bucket: regionBucket,
      cadence: e.cadence ?? null,
      message_template_key: e.messageTemplateKey ?? null,
      discount_pct: e.discountPct ?? null,
      sequence_step: e.sequenceStep ?? null,
      hour_of_day: now.getHours(),
      day_of_week: now.getDay(),
      recurring_plan_id: e.recurringPlanId ?? null,
      customer_id: e.customerId ?? null,
      meta: e.meta ?? {},
    });
  } catch {
    /* outcome emission is best-effort intelligence, never operational */
  }
}
