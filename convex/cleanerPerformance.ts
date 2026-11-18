/**
 * A cleaner's performance as Owners and Managers see it: verified measures with their records, the
 * versioned score with each part explained (or "Not enough history"), suggestions that rest on records,
 * and disputes about records, which a person decides. Office does not see performance.
 *
 * The score is not used to rank people or to decide who is offered work.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { managerMutation, managerQuery } from "./lib/builders";
import { performanceFor, recommendationsFor, DEFINITIONS, GRACE_MINUTES, MINIMUM, PERIOD_DAYS, SCORE_VERSION, WEIGHTS, type MeasureKey } from "./lib/cleaners/performance";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { text } from "./lib/text";

const MEASURES = ["reliability", "punctuality", "responsiveness", "completion", "all"] as const;

export const forCleaner = managerQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const performance = await performanceFor(ctx, ctx.company, cleaner._id, args.asOf);
    const disputes = await ctx.db
      .query("recordDisputes")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(50);
    const labels = new Map(Object.values(performance.measures).flatMap((measure) => measure.records.map((row) => [row.assignmentId, row.label] as const)));
    const members = new Map<string, string>();
    for (const row of disputes) {
      for (const id of [row.raisedBy.kind === "member" ? row.raisedBy.memberId : null, row.decidedBy ?? null]) {
        if (id && !members.has(id)) members.set(id, (await ctx.db.get(id))?.name ?? "A team member");
      }
    }
    return {
      version: SCORE_VERSION,
      periodDays: PERIOD_DAYS,
      method: {
        weights: WEIGHTS,
        minimum: MINIMUM,
        graceMinutes: GRACE_MINUTES,
        words: `Not used to rank people or decide who is offered work. Reliability ${WEIGHTS.reliability} points, punctuality ${WEIGHTS.punctuality}, answering offers ${WEIGHTS.responsiveness}. A part counts only with at least ${MINIMUM.punctuality} records; with fewer than ${MINIMUM.reliability} accepted jobs there is no score. Completion is shown, not scored.`,
      },
      score: performance.score,
      /** When this was worked out: the records are read live, so it is as of this moment. */
      computedAt: performance.periodEnd,
      measures: (["reliability", "punctuality", "responsiveness", "completion"] as const).map((key) => performance.measures[key]),
      recommendations: recommendationsFor(performance),
      disputes: disputes.map((row) => ({
        disputeId: row._id,
        assignmentId: row.assignmentId,
        label: labels.get(row.assignmentId) ?? "A job outside the period",
        measure: row.measure,
        measureLabel: row.measure === "all" ? "The whole record" : (DEFINITIONS[row.measure as MeasureKey]?.label ?? row.measure),
        reason: row.reason,
        status: row.status,
        resolution: row.resolution ?? null,
        raisedBy: row.raisedBy.kind === "cleaner" ? cleaner.name : row.raisedBy.kind === "member" ? (members.get(row.raisedBy.memberId) ?? "A team member") : "Selestial",
        raisedByMemberId: row.raisedBy.kind === "member" ? row.raisedBy.memberId : null,
        decidedBy: row.decidedBy ? (members.get(row.decidedBy) ?? "A team member") : null,
        createdAt: row.createdAt,
        decidedAt: row.decidedAt ?? null,
      })),
    };
  },
});

/** Flags a record as wrong. It is left out of the measures until decided. Raising it twice finds the first. */
export const raiseDispute = managerMutation({
  args: { assignmentId: v.id("assignments"), measure: v.union(...MEASURES.map((key) => v.literal(key))), reason: v.string() },
  handler: async (ctx, args) => {
    const assignment = await owned(ctx, args.assignmentId);
    const reason = text(args.reason, "What is wrong", 1000);
    const existing = (
      await ctx.db
        .query("recordDisputes")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", assignment.cleanerId))
        .take(200)
    ).find((row) => row.assignmentId === assignment._id && row.status === "open" && (row.measure === args.measure || row.measure === "all"));
    if (existing) return { disputeId: existing._id, already: true };
    const disputeId = await ctx.db.insert("recordDisputes", { companyId: ctx.companyId, cleanerId: assignment.cleanerId, assignmentId: assignment._id, measure: args.measure, raisedBy: { kind: "member", memberId: ctx.member._id }, reason, status: "open", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.record_disputed", actor: byMember(ctx), subject: { table: "cleaners", id: assignment.cleanerId }, data: { assignmentId: assignment._id, measure: args.measure } });
    return { disputeId, already: false };
  },
});

/**
 * Upheld: the record stands and counts again. Corrected: the record was wrong and is left out for good. Someone
 * other than whoever raised it decides, unless that person is the Owner. The assignment itself is never changed.
 */
export const decideDispute = managerMutation({
  args: { disputeId: v.id("recordDisputes"), decision: v.union(v.literal("upheld"), v.literal("corrected")), resolution: v.string() },
  handler: async (ctx, args) => {
    const dispute = await owned(ctx, args.disputeId);
    if (dispute.status !== "open") throw userError("This dispute was already decided.");
    if (dispute.raisedBy.kind === "member" && dispute.raisedBy.memberId === ctx.member._id && !isOwner(ctx.role)) throw userError("Someone other than the person who raised it decides it.");
    const resolution = text(args.resolution, "What was found", 1000);
    await ctx.db.patch(dispute._id, { status: args.decision, resolution, decidedBy: ctx.member._id, decidedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.dispute_decided", actor: byMember(ctx), subject: { table: "cleaners", id: dispute.cleanerId }, data: { disputeId: dispute._id, decision: args.decision } });
    return null;
  },
});
