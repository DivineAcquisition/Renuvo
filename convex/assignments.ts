/**
 * Assignments: one offer of one job to one cleaner. A job is covered only when the cleaner accepts.
 * The checks that protect a cleaner's time are here in code, so nothing can offer around them:
 * ready for work, has the skills, said they can work then, not on time off, not already holding that time.
 * Travel time between jobs arrives with Dispatch.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, type MemberAccess } from "./lib/builders";
import { availabilityFor, UNAVAILABLE_WORDS, type Span } from "./lib/availability";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { assertChange, ASSIGNMENT_CHANGES, type AssignmentStatus } from "./lib/statuses";
import { cents, instant, text } from "./lib/text";

/** The times this cleaner is already holding: every job they have an offer on or have accepted. */
async function heldSpans(ctx: MutationCtx, companyId: Id<"companies">, cleanerId: Id<"cleaners">, exceptJob: Id<"jobs">): Promise<Span[]> {
  const spans: Span[] = [];
  for (const status of ["offered", "accepted"] as const) {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", companyId).eq("cleanerId", cleanerId).eq("status", status))
      .take(500);
    for (const row of rows) {
      if (row.jobId === exceptJob) continue;
      const job = await ctx.db.get(row.jobId);
      if (job && (job.status === "scheduled" || job.status === "in_progress")) spans.push({ startsAt: job.startsAt, endsAt: job.endsAt });
    }
  }
  return spans;
}

async function end(ctx: MutationCtx, assignment: Doc<"assignments">, to: AssignmentStatus, actor: Actor, extra: { endReason?: string; data?: Record<string, string> } = {}) {
  assertChange(ASSIGNMENT_CHANGES, assignment.status, to, "assignment");
  await ctx.db.patch(assignment._id, {
    status: to,
    ...(to === "accepted" || to === "declined" ? { respondedAt: Date.now() } : {}),
    ...(extra.endReason ? { endReason: extra.endReason } : {}),
  });
  await recordEvent(ctx, {
    companyId: assignment.companyId,
    type: `assignment.${to}`,
    actor,
    subject: { table: "assignments", id: assignment._id },
    data: { from: assignment.status, jobId: assignment.jobId, cleanerId: assignment.cleanerId, ...extra.data },
  });
}

export const offer = companyMutation({
  args: { jobId: v.id("jobs"), cleanerId: v.id("cleaners"), respondBy: v.number(), payCents: v.number() },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const cleaner = await owned(ctx, args.cleanerId);
    const now = Date.now();
    const respondBy = instant(args.respondBy, "The response deadline");
    const payCents = cents(args.payCents, "The cleaner's pay");

    if (job.status !== "scheduled") throw userError("Only a scheduled job can be offered.");
    if (respondBy <= now) throw userError("The response deadline must be in the future.");
    if (respondBy > job.startsAt) throw userError("The response deadline must be before the job starts.");
    if (cleaner.status !== "ready") throw userError("This cleaner is not marked ready for work.");
    const missing = job.requiredSkills.filter((skill) => !cleaner.skills.includes(skill));
    if (missing.length > 0) throw userError(`This cleaner does not have a skill the job needs: ${missing.join(", ")}.`);

    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
      .take(100);
    if (existing.some((row) => row.status === "accepted")) throw userError("A cleaner has already accepted this job.");
    if (existing.some((row) => row.status === "offered" && row.cleanerId === cleaner._id)) throw userError("This cleaner already has an open offer for this job.");

    const windows = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gt("endsAt", job.startsAt))
      .take(200);
    const answer = availabilityFor({
      windows,
      timeOff,
      booked: await heldSpans(ctx, ctx.companyId, cleaner._id, job._id),
      span: { startsAt: job.startsAt, endsAt: job.endsAt },
      timezone: ctx.company.timezone,
    });
    if (!answer.available) throw userError(UNAVAILABLE_WORDS[answer.reason]);

    const assignmentId = await ctx.db.insert("assignments", {
      companyId: ctx.companyId,
      jobId: job._id,
      cleanerId: cleaner._id,
      status: "offered",
      scope: job.scope,
      payCents,
      offeredAt: now,
      respondBy,
    });
    await recordEvent(ctx, {
      companyId: ctx.companyId,
      type: "assignment.offered",
      actor: byMember(ctx),
      subject: { table: "assignments", id: assignmentId },
      data: { jobId: job._id, cleanerId: cleaner._id, respondBy, payCents },
    });
    return assignmentId;
  },
});

async function respond(ctx: MutationCtx & MemberAccess, assignmentId: Id<"assignments">, answer: "accepted" | "declined") {
  const assignment = await owned(ctx, assignmentId);
  if (assignment.status !== "offered") throw userError(`This offer is ${assignment.status}, so it can no longer be answered.`);
  const actor = byMember(ctx);
  // An answer after the deadline does not count. The offer is recorded as expired and the caller is told.
  if (Date.now() > assignment.respondBy) {
    await end(ctx, assignment, "expired", actor, { endReason: "The response deadline passed." });
    return { status: "expired" as const };
  }
  if (answer === "accepted") {
    const job = await ctx.db.get(assignment.jobId);
    if (!job || job.status !== "scheduled") throw userError("This job is no longer scheduled.");
    const others = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", assignment.jobId))
      .take(100);
    if (others.some((row) => row.status === "accepted")) throw userError("Another cleaner has already accepted this job.");
    await end(ctx, assignment, "accepted", actor, { data: { recordedFor: "cleaner" } });
    // The job has its cleaner, so every other open offer for it is withdrawn.
    for (const other of others) {
      if (other._id !== assignment._id && other.status === "offered") {
        await end(ctx, other, "cancelled", actor, { endReason: "Another cleaner accepted the job.", data: { cause: "job_covered" } });
      }
    }
    return { status: "accepted" as const };
  }
  await end(ctx, assignment, "declined", actor, { data: { recordedFor: "cleaner" } });
  return { status: "declined" as const };
}

/**
 * Records the cleaner's own answer. Until cleaners have their own sign-in, a member of the office records
 * it for them, and the event says so.
 */
export const recordAnswer = companyMutation({
  args: { assignmentId: v.id("assignments"), answer: v.union(v.literal("accepted"), v.literal("declined")) },
  handler: async (ctx, args) => respond(ctx, args.assignmentId, args.answer),
});

/** Withdraws an offer, or releases a cleaner who accepted. The job is uncovered again, and says so. */
export const release = companyMutation({
  args: { assignmentId: v.id("assignments"), reason: v.string() },
  handler: async (ctx, args) => {
    const assignment = await owned(ctx, args.assignmentId);
    await end(ctx, assignment, "cancelled", byMember(ctx), { endReason: text(args.reason, "The reason", 500) });
    return null;
  },
});

/** Run on a schedule: offers nobody answered in time become expired. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("assignments")
      .withIndex("by_status_respondBy", (q) => q.eq("status", "offered").lt("respondBy", Date.now()))
      .take(200);
    for (const assignment of due) await end(ctx, assignment, "expired", { kind: "system" }, { endReason: "The response deadline passed." });
    return due.length;
  },
});
