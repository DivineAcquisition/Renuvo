/**
 * Signals: one explainable thing the company's own records show about a relationship. A signal says what
 * happened, where it came from and when, which relationship or property it affects, whether it is a fact,
 * something the customer said, or a hypothesis, what is not known, and a suggested next step.
 *
 * The same evidence seen again is counted on the same row, never added as another. Nothing here is a
 * score, and silence is never a signal: a customer who has not written is not thereby unhappy.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { SYSTEM } from "./cases";
import type { Basis, PlanRef, Segment, SignalKind, Source } from "./schema";

type Ctx = QueryCtx | MutationCtx;

export const SIGNAL_WORDS: Record<SignalKind, string> = {
  repeat_complaint: "Repeated complaint",
  commitment_overdue: "Commitment past its deadline",
  company_cancellation: "Visit lost on the company's side",
  repeated_reschedule: "Visit moved more than once",
  plan_missing_visit: "Recurring plan with no next visit",
  paid_without_service: "Paid, with no service scheduled",
  service_paused_billing_open: "Service paused, billing still open",
  cancel_request: "Customer asked to cancel",
  reduce_request: "Customer asked for less service",
  invoice_dispute: "Payment dispute",
  renewal_approaching: "Renewal or notice deadline approaching",
  decision_maker_changed: "Decision-maker changed",
  readiness_at_risk: "Open issue before a check-in",
};

export type NewSignal = {
  companyId: Id<"companies">;
  kind: SignalKind;
  key: string;
  basis: Basis;
  customerId: Id<"customers">;
  propertyId?: Id<"properties">;
  plan?: PlanRef;
  agreementId?: Id<"agreements">;
  segment: Segment;
  what: string;
  source: Source;
  occurredAt: number;
  missing?: string[];
  suggestedAction: string;
  priority?: "high" | "normal";
  deadlineAt?: number;
  actor?: Actor;
};

export async function signalByKey(ctx: Ctx, companyId: Id<"companies">, key: string): Promise<Doc<"retentionSignals"> | null> {
  return ctx.db
    .query("retentionSignals")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .first();
}

/** Raises a signal once. Seen again, the first row is counted and refreshed; a dismissed one stays dismissed. */
export async function raiseSignal(ctx: MutationCtx, input: NewSignal): Promise<{ row: Doc<"retentionSignals">; created: boolean }> {
  const now = Date.now();
  const existing = await signalByKey(ctx, input.companyId, input.key);
  if (existing) {
    await ctx.db.patch(existing._id, {
      seen: existing.seen + 1,
      lastSeenAt: now,
      what: input.what.slice(0, 500),
      missing: input.missing ?? existing.missing,
      deadlineAt: input.deadlineAt ?? existing.deadlineAt,
      priority: input.priority ?? existing.priority,
      // The record shows it again after it had cleared: it is open again. A person's dismissal stands.
      ...(existing.status === "cleared" ? { status: "open" as const, caseId: undefined } : {}),
    });
    return { row: (await ctx.db.get(existing._id))!, created: false };
  }
  const signalId = await ctx.db.insert("retentionSignals", {
    companyId: input.companyId,
    kind: input.kind,
    key: input.key,
    basis: input.basis,
    customerId: input.customerId,
    propertyId: input.propertyId,
    plan: input.plan,
    agreementId: input.agreementId,
    segment: input.segment,
    what: input.what.slice(0, 500),
    source: input.source,
    occurredAt: input.occurredAt,
    missing: input.missing ?? [],
    suggestedAction: input.suggestedAction.slice(0, 300),
    priority: input.priority ?? "normal",
    status: "open",
    seen: 1,
    lastSeenAt: now,
    deadlineAt: input.deadlineAt,
    createdAt: now,
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "retention_signal.raised", actor: input.actor ?? SYSTEM, subject: { table: "retentionSignals", id: signalId }, data: { kind: input.kind, basis: input.basis } });
  return { row: (await ctx.db.get(signalId))!, created: true };
}

/** After a reconciliation: signals of these kinds that the records no longer show are cleared, not deleted. */
export async function clearUnseen(ctx: MutationCtx, companyId: Id<"companies">, kinds: readonly SignalKind[], seenKeys: Set<string>): Promise<number> {
  const open = await ctx.db
    .query("retentionSignals")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "open"))
    .take(500);
  let cleared = 0;
  for (const row of open) {
    if (!kinds.includes(row.kind) || seenKeys.has(row.key)) continue;
    await ctx.db.patch(row._id, { status: "cleared", lastSeenAt: Date.now() });
    await recordEvent(ctx, { companyId, type: "retention_signal.cleared", actor: SYSTEM, subject: { table: "retentionSignals", id: row._id }, data: { kind: row.kind } });
    cleared += 1;
  }
  return cleared;
}

export async function attachSignal(ctx: MutationCtx, signal: Doc<"retentionSignals">, caseId: Id<"retentionCases">): Promise<void> {
  if (signal.status === "open" || signal.status === "cleared") await ctx.db.patch(signal._id, { status: "in_case", caseId });
}
