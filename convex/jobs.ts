/**
 * Jobs: the service a customer is due. A job's status is only about the service. Whether a cleaner has
 * accepted it is read from its assignments, and nothing here knows about payment. Whenever a job is
 * created, changed, moved, cancelled or closed, Dispatch looks at it in the same step. A visit is closed
 * by a person's review of the crew's report, or by an override that says why there was none.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, managerMutation, type MemberAccess } from "./lib/builders";
import { endAssignment } from "./lib/dispatch/assignmentState";
import { coverageOf, requiredCrew, staffing, type Coverage } from "./lib/dispatch/crew";
import { reviewKey } from "./lib/dispatch/live";
import { commitMove, planMove } from "./lib/dispatch/reschedule";
import { coverJob } from "./lib/dispatch/workflow";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { ACTIVE_ASSIGNMENT, assertChange, JOB_CHANGES, jobStatusValidator, type JobStatus } from "./lib/statuses";
import { liveTaskByKey, setTaskState } from "./lib/taskState";
import { cents, instant, optionalText, tags, text } from "./lib/text";

export { coverageOf, type Coverage };

async function assignmentsOf(ctx: (QueryCtx | MutationCtx) & MemberAccess, job: Doc<"jobs">) {
  return ctx.db
    .query("assignments")
    .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
    .take(100);
}

function span(startsAt: number, endsAt: number) {
  const start = instant(startsAt, "The start time");
  const end = instant(endsAt, "The end time");
  if (start >= end) throw userError("A job must start before it ends.");
  if (end - start > 24 * 60 * 60 * 1000) throw userError("A job cannot be longer than a day.");
  return { startsAt: start, endsAt: end };
}

function checkedCrew(crew: number): number {
  if (!Number.isInteger(crew) || crew < 1 || crew > 12) throw userError("A job needs a whole number of cleaners, from 1 to 12.");
  return crew;
}

function checkedArrival(minutes: number): number {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 12 * 60) throw userError("The arrival window must be a whole number of minutes, up to 12 hours.");
  return minutes;
}

function deadlineFor(at: number, endsAt: number): number {
  const deadline = instant(at, "The deadline");
  if (deadline < endsAt) throw userError("The service must be finished by a time at or after the visit's end.");
  return deadline;
}

export const list = companyQuery({
  args: { from: v.number(), to: v.number(), status: v.optional(jobStatusValidator) },
  handler: async (ctx, args) => {
    const status = args.status;
    const rows = status
      ? await ctx.db
          .query("jobs")
          .withIndex("by_company_status_start", (q) => q.eq("companyId", ctx.companyId).eq("status", status).gte("startsAt", args.from).lt("startsAt", args.to))
          .take(200)
      : await ctx.db
          .query("jobs")
          .withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gte("startsAt", args.from).lt("startsAt", args.to))
          .take(200);
    const out = [];
    for (const job of rows) out.push({ ...job, coverage: coverageOf(await assignmentsOf(ctx, job), job), requiredCrew: requiredCrew(job) });
    return out;
  },
});

export const get = companyQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const assignments = await assignmentsOf(ctx, job);
    return { job, assignments, coverage: coverageOf(assignments, job), staffing: staffing(job, assignments) };
  },
});

export const create = companyMutation({
  args: {
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    serviceType: v.string(),
    scope: v.string(),
    requiredSkills: v.optional(v.array(v.string())),
    priceCents: v.optional(v.number()),
    startsAt: v.number(),
    endsAt: v.number(),
    requiredCrew: v.optional(v.number()),
    arrivalWindowMinutes: v.optional(v.number()),
    hardDeadlineAt: v.optional(v.number()),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const crew = checkedCrew(args.requiredCrew ?? 1);
    const arrival = checkedArrival(args.arrivalWindowMinutes ?? 0);
    const property = await owned(ctx, args.propertyId);
    if (property.customerId !== customer._id) throw userError("That property belongs to a different customer.");
    const jobId = await ctx.db.insert("jobs", {
      companyId: ctx.companyId,
      customerId: customer._id,
      propertyId: property._id,
      serviceType: text(args.serviceType, "Service type", 80),
      scope: text(args.scope, "Scope", 2000),
      requiredSkills: tags(args.requiredSkills ?? [], "Required skills"),
      priceCents: args.priceCents === undefined ? undefined : cents(args.priceCents, "The price"),
      ...span(args.startsAt, args.endsAt),
      status: "scheduled",
      ...(crew > 1 ? { requiredCrew: crew } : {}),
      ...(arrival > 0 ? { arrivalWindowMinutes: arrival } : {}),
      ...(args.hardDeadlineAt !== undefined ? { hardDeadlineAt: deadlineFor(args.hardDeadlineAt, args.endsAt) } : {}),
      ...(args.instructions?.trim() ? { instructions: text(args.instructions, "Instructions", 4000) } : {}),
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.created", actor: byMember(ctx), subject: { table: "jobs", id: jobId } });
    await coverJob(ctx, jobId);
    return jobId;
  },
});

/**
 * What moving the visit would do, before anything is done: whose offers are withdrawn, who is asked to
 * confirm the new time, whose place reopens and why. Nothing is changed by looking.
 */
export const reschedulePreview = companyQuery({
  args: { jobId: v.id("jobs"), startsAt: v.number(), endsAt: v.number(), hardDeadlineAt: v.optional(v.union(v.number(), v.null())) },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    return (await planMove(ctx, ctx.company, job, { startsAt: args.startsAt, endsAt: args.endsAt, hardDeadlineAt: args.hardDeadlineAt })).plan;
  },
});

/**
 * Moves a scheduled visit in one step. A cleaner agreed to a specific time, so nobody is moved
 * underneath their agreement: offers for the old time are withdrawn and everyone who had accepted is
 * asked again for the new one. `version` comes from the preview; if the visit changed since, the move is
 * refused and nothing happens. With no offers and no crew, it is simply a new time.
 */
export const reschedule = companyMutation({
  args: { jobId: v.id("jobs"), startsAt: v.number(), endsAt: v.number(), hardDeadlineAt: v.optional(v.union(v.number(), v.null())), version: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const move = { ...span(args.startsAt, args.endsAt), hardDeadlineAt: args.hardDeadlineAt === undefined || args.hardDeadlineAt === null ? args.hardDeadlineAt : instant(args.hardDeadlineAt, "The deadline") };
    const { plan } = await planMove(ctx, ctx.company, job, move);
    // A move that touches a cleaner's agreement must have been previewed: the version says which state was shown.
    const touches = plan.offersWithdrawn.length + plan.crew.length > 0;
    if (touches && args.version === undefined) throw userError("A cleaner has an offer or has accepted this time. Review what the move does to them, then confirm it.");
    await commitMove(ctx, ctx.company, job, move, args.version ?? plan.version, byMember(ctx));
    return { offersWithdrawn: plan.offersWithdrawn.length, askedAgain: plan.crew.filter((row) => row.outcome === "asked_again").length, placesReopened: plan.crew.filter((row) => row.outcome === "place_reopens").length };
  },
});

/**
 * Changes a scheduled visit's details. What a cleaner was told when they were offered the job (the
 * service, the scope, the skills) cannot change while an offer is out or accepted: withdraw or release
 * first. `expectedStartsAt` guards against editing a visit someone else just moved.
 */
export const edit = companyMutation({
  args: {
    jobId: v.id("jobs"),
    expectedStartsAt: v.number(),
    serviceType: v.optional(v.string()),
    scope: v.optional(v.string()),
    requiredSkills: v.optional(v.array(v.string())),
    priceCents: v.optional(v.union(v.number(), v.null())),
    requiredCrew: v.optional(v.number()),
    arrivalWindowMinutes: v.optional(v.number()),
    hardDeadlineAt: v.optional(v.union(v.number(), v.null())),
    instructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "scheduled") throw userError("Only a scheduled visit can be changed.");
    if (job.startsAt !== args.expectedStartsAt) throw userError("This visit was moved since you opened it. Open it again before changing it.");
    const assignments = await assignmentsOf(ctx, job);
    const active = assignments.some((row) => ACTIVE_ASSIGNMENT.includes(row.status));
    const patch: Partial<Doc<"jobs">> = {};
    const changed: string[] = [];
    const told = (field: string) => {
      if (active) throw userError(`A cleaner has an offer or has accepted this visit as it was described. Withdraw the offer or release the cleaner before changing the ${field}.`);
    };
    if (args.serviceType !== undefined && args.serviceType.trim() !== job.serviceType) {
      told("service");
      patch.serviceType = text(args.serviceType, "Service type", 80);
      changed.push("service");
    }
    if (args.scope !== undefined && args.scope.trim() !== job.scope) {
      told("scope");
      patch.scope = text(args.scope, "Scope", 2000);
      changed.push("scope");
    }
    if (args.requiredSkills !== undefined) {
      const next = tags(args.requiredSkills, "Required skills");
      if (next.join("|") !== job.requiredSkills.join("|")) {
        told("skills needed");
        patch.requiredSkills = next;
        changed.push("skills");
      }
    }
    if (args.priceCents !== undefined) {
      patch.priceCents = args.priceCents === null ? undefined : cents(args.priceCents, "The price");
      if (patch.priceCents !== job.priceCents) changed.push("price");
    }
    if (args.requiredCrew !== undefined && args.requiredCrew !== requiredCrew(job)) {
      const accepted = staffing(job, assignments).accepted;
      const crew = checkedCrew(args.requiredCrew);
      if (crew < accepted) throw userError(`${accepted} cleaners have already accepted this visit. Release one before lowering the number it needs.`);
      patch.requiredCrew = crew;
      changed.push("crew");
    }
    if (args.arrivalWindowMinutes !== undefined && args.arrivalWindowMinutes !== (job.arrivalWindowMinutes ?? 0)) {
      if (assignments.some((row) => row.status === "accepted")) throw userError("A cleaner accepted this arrival time. Move the visit to change when they arrive, so they are asked again.");
      patch.arrivalWindowMinutes = checkedArrival(args.arrivalWindowMinutes) || undefined;
      changed.push("arrival");
    }
    if (args.hardDeadlineAt !== undefined && (args.hardDeadlineAt ?? undefined) !== job.hardDeadlineAt) {
      if (args.hardDeadlineAt !== null && instant(args.hardDeadlineAt, "The deadline") < job.endsAt) throw userError("The service must be finished by a time at or after the visit's end.");
      patch.hardDeadlineAt = args.hardDeadlineAt ?? undefined;
      changed.push("deadline");
    }
    if (args.instructions !== undefined && args.instructions.trim() !== (job.instructions ?? "")) {
      patch.instructions = args.instructions.trim() ? text(args.instructions, "Instructions", 4000) : undefined;
      changed.push("instructions");
    }
    if (changed.length === 0) return { changed };
    await ctx.db.patch(job._id, patch);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.edited", actor: byMember(ctx), subject: { table: "jobs", id: job._id }, data: { changed: changed.join(", ") } });
    // More places, or fewer, changes what Dispatch still has to fill.
    await coverJob(ctx, job._id);
    return { changed };
  },
});

async function change(ctx: MutationCtx & MemberAccess, job: Doc<"jobs">, to: JobStatus, data?: Record<string, string>) {
  assertChange(JOB_CHANGES, job.status, to, "job");
  await ctx.db.patch(job._id, { status: to });
  await recordEvent(ctx, { companyId: ctx.companyId, type: `job.${to}`, actor: byMember(ctx), subject: { table: "jobs", id: job._id }, data: { from: job.status, ...data } });
}

/** A job starts only with an accepted cleaner. Scheduled alone never meant covered. */
export const start = companyMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (coverageOf(await assignmentsOf(ctx, job), job) !== "covered") {
      throw userError(requiredCrew(job) === 1 ? "No cleaner has accepted this job yet, so it cannot start." : "Not every place on this job has an accepted cleaner yet, so it cannot start.");
    }
    await change(ctx, job, "in_progress");
    return null;
  },
});

/** Closes the review task that was opened when the crew reported, if it is still open. */
async function settleReview(ctx: MutationCtx & MemberAccess, job: Doc<"jobs">, outcome: string) {
  const task = await liveTaskByKey(ctx, ctx.companyId, reviewKey(job._id));
  if (task) await setTaskState(ctx, task, "done", { outcome, closedAt: Date.now(), withPersonSince: null }, byMember(ctx));
}

/**
 * A person's decision on the crew's report. Submitted work is not approved work: a visit is closed only
 * by this review, after every crew member reported and every report from the job was decided. Sending it
 * back clears the crew's reports so they can correct the work and submit again. Closing a visit approves
 * no payment and releases no payout.
 */
export const reviewCompletion = managerMutation({
  args: { jobId: v.id("jobs"), decision: v.union(v.literal("close"), v.literal("return")), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "in_progress") throw userError("Only a visit that is underway can be reviewed.");
    if (job.completionReportedAt === undefined) throw userError("The crew has not all reported this visit done yet, so there is nothing to review.");
    const note = optionalText(args.note, "The note", 1000);
    const now = Date.now();
    if (args.decision === "return") {
      if (!note || note.length < 3) throw userError("Say what needs correcting, so the crew knows.");
      for (const row of await assignmentsOf(ctx, job)) {
        if (row.status === "accepted" && row.completion) await ctx.db.patch(row._id, { completion: undefined });
      }
      await ctx.db.patch(job._id, { completionReportedAt: undefined, completionReturns: (job.completionReturns ?? 0) + 1 });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "job.completion_returned", actor: byMember(ctx), subject: { table: "jobs", id: job._id }, data: { note } });
      await settleReview(ctx, job, `Sent back for correction: ${note}`);
      return { status: "returned" as const };
    }
    const undecided = (
      await ctx.db
        .query("jobReports")
        .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
        .take(100)
    ).filter((row) => row.status === "awaiting_decision").length;
    if (undecided > 0) throw userError(`${undecided} ${undecided === 1 ? "report from the crew is" : "reports from the crew are"} still waiting for a decision. Decide ${undecided === 1 ? "it" : "them"} before closing the visit.`);
    await ctx.db.patch(job._id, { completionReview: { decision: "closed", by: ctx.member._id, at: now, note } });
    await change(ctx, job, "completed", { review: "reviewed" });
    await settleReview(ctx, job, note ? `Reviewed and closed: ${note}` : "Reviewed and closed.");
    await coverJob(ctx, job._id);
    return { status: "closed" as const };
  },
});

/**
 * The override: closes a visit that was not reviewed, for example one done without the cleaner's link.
 * It needs a reason, is recorded as its own kind of closing, and is never shown as a review.
 */
export const closeWithoutReview = managerMutation({
  args: { jobId: v.id("jobs"), reason: v.string() },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "in_progress") throw userError("Only a visit that is underway can be closed.");
    const reason = text(args.reason, "The reason", 1000);
    if (reason.length < 10) throw userError("Give the reason this visit is closed without a review, in a sentence.");
    await ctx.db.patch(job._id, { completionReview: { decision: "closed_without_review", by: ctx.member._id, at: Date.now(), note: reason } });
    await change(ctx, job, "completed", { review: "none" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.closed_without_review", actor: byMember(ctx), subject: { table: "jobs", id: job._id }, data: { reason, crewReported: job.completionReportedAt !== undefined } });
    await settleReview(ctx, job, `Closed without review: ${reason}`);
    await coverJob(ctx, job._id);
    return null;
  },
});

/** Cancelling a job also ends every offer and acceptance on it, each with its own event. */
export const cancel = companyMutation({
  args: { jobId: v.id("jobs"), reason: v.string() },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const reason = text(args.reason, "The reason", 500);
    await change(ctx, job, "cancelled");
    await ctx.db.patch(job._id, { cancelReason: reason });
    for (const assignment of await assignmentsOf(ctx, job)) {
      if (!ACTIVE_ASSIGNMENT.includes(assignment.status)) continue;
      await endAssignment(ctx, assignment, "cancelled", byMember(ctx), { endReason: "The job was cancelled.", endCause: "job_cancelled", data: { cause: "job_cancelled" } });
    }
    await coverJob(ctx, job._id);
    return null;
  },
});
