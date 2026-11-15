/**
 * Assignments: one offer of one job to one cleaner. A job is covered only when the cleaner accepts.
 * The checks that protect a cleaner's time live in convex/lib/dispatch/offers.ts and are the same for a
 * person and for Dispatch: ready for work, has the skills, said they can work then, not on time off,
 * not already holding that time, and not closer to another job than the company's time between jobs.
 * Whenever an offer ends without an acceptance, Dispatch looks at the job again in the same step.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, type MemberAccess } from "./lib/builders";
import { offerProblem, personRules, placeOffer } from "./lib/dispatch/offers";
import { coverJob, holdForPerson } from "./lib/dispatch/workflow";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { assertChange, ASSIGNMENT_CHANGES, type AssignmentStatus } from "./lib/statuses";
import { cents, instant, text } from "./lib/text";

type EndCause = NonNullable<Doc<"assignments">["endCause"]>;

async function end(
  ctx: MutationCtx,
  assignment: Doc<"assignments">,
  to: AssignmentStatus,
  actor: Actor,
  extra: { endReason?: string; endCause?: EndCause; data?: Record<string, string> } = {},
) {
  assertChange(ASSIGNMENT_CHANGES, assignment.status, to, "assignment");
  await ctx.db.patch(assignment._id, {
    status: to,
    ...(to === "accepted" || to === "declined" ? { respondedAt: Date.now() } : {}),
    ...(extra.endReason ? { endReason: extra.endReason } : {}),
    ...(extra.endCause ? { endCause: extra.endCause } : {}),
  });
  await recordEvent(ctx, {
    companyId: assignment.companyId,
    type: `assignment.${to}`,
    actor,
    subject: { table: "assignments", id: assignment._id },
    data: { from: assignment.status, jobId: assignment.jobId, cleanerId: assignment.cleanerId, ...extra.data },
  });
}

/**
 * A person offers a job to a cleaner they chose. The time between jobs applies to them too; they may set
 * it aside for one offer by saying so, and the event records that they did.
 */
export const offer = companyMutation({
  args: {
    jobId: v.id("jobs"),
    cleanerId: v.id("cleaners"),
    respondBy: v.number(),
    payCents: v.number(),
    allowTightSchedule: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const cleaner = await owned(ctx, args.cleanerId);
    const tight = args.allowTightSchedule === true;
    const request = {
      company: ctx.company,
      job,
      cleaner,
      respondBy: instant(args.respondBy, "The response deadline"),
      payCents: cents(args.payCents, "The cleaner's pay"),
      rules: personRules(tight),
    };
    const problem = await offerProblem(ctx, request);
    if (problem) throw userError(problem);
    const assignmentId = await placeOffer(ctx, request, byMember(ctx), tight ? { timeBetweenJobsSetAside: true } : {});
    await coverJob(ctx, job._id);
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
    await coverJob(ctx, assignment.jobId);
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
        await end(ctx, other, "cancelled", actor, { endReason: "Another cleaner accepted the job.", endCause: "job_covered", data: { cause: "job_covered" } });
      }
    }
    await coverJob(ctx, assignment.jobId);
    return { status: "accepted" as const };
  }
  await end(ctx, assignment, "declined", actor, { data: { recordedFor: "cleaner" } });
  await coverJob(ctx, assignment.jobId);
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

/**
 * Withdraws an offer, or releases a cleaner who accepted. The job is uncovered again, and says so.
 * Dispatch then looks for the next cleaner, unless the person keeps the visit (`keepWithMe`), for
 * example to move it to another time first.
 */
export const release = companyMutation({
  args: { assignmentId: v.id("assignments"), reason: v.string(), keepWithMe: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const assignment = await owned(ctx, args.assignmentId);
    await end(ctx, assignment, "cancelled", byMember(ctx), { endReason: text(args.reason, "The reason", 500), endCause: "released" });
    if (args.keepWithMe) {
      const job = await ctx.db.get(assignment.jobId);
      if (job && job.status === "scheduled") {
        await holdForPerson(ctx, job, "You released the cleaner and kept this visit. Offer it to a cleaner yourself, or hand it back to Dispatch.", byMember(ctx));
      }
    }
    await coverJob(ctx, assignment.jobId);
    return null;
  },
});

/** Run on a schedule: offers nobody answered in time become expired, and Dispatch looks at each job again. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("assignments")
      .withIndex("by_status_respondBy", (q) => q.eq("status", "offered").lt("respondBy", Date.now()))
      .take(100);
    for (const assignment of due) {
      await end(ctx, assignment, "expired", { kind: "system" }, { endReason: "The response deadline passed." });
      await coverJob(ctx, assignment.jobId);
    }
    return due.length;
  },
});
