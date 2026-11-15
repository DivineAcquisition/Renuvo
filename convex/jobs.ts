/**
 * Jobs: the service a customer is due. A job's status is only about the service. Whether a cleaner has
 * accepted it is read from its assignments, and nothing here knows about payment. Whenever a job is
 * created, moved, cancelled or completed, Dispatch looks at it in the same step.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { afterReschedule, coverJob } from "./lib/dispatch/workflow";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { ACTIVE_ASSIGNMENT, assertChange, JOB_CHANGES, jobStatusValidator, type JobStatus } from "./lib/statuses";
import { cents, instant, tags, text } from "./lib/text";

export type Coverage = "covered" | "offered" | "uncovered";

/** Covered means a cleaner accepted. An offer that is still out is not coverage. */
export function coverageOf(assignments: Pick<Doc<"assignments">, "status">[]): Coverage {
  if (assignments.some((row) => row.status === "accepted")) return "covered";
  if (assignments.some((row) => row.status === "offered")) return "offered";
  return "uncovered";
}

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
    for (const job of rows) out.push({ ...job, coverage: coverageOf(await assignmentsOf(ctx, job)) });
    return out;
  },
});

export const get = companyQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const assignments = await assignmentsOf(ctx, job);
    return { job, assignments, coverage: coverageOf(assignments) };
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
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
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
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.created", actor: byMember(ctx), subject: { table: "jobs", id: jobId } });
    await coverJob(ctx, jobId);
    return jobId;
  },
});

/**
 * Moves a scheduled job. A cleaner agreed to a specific time, so a job with an offer out or an accepted
 * assignment is not moved underneath them: release the assignment first, then offer the new time.
 */
export const reschedule = companyMutation({
  args: { jobId: v.id("jobs"), startsAt: v.number(), endsAt: v.number() },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "scheduled") throw userError("Only a scheduled job can be moved.");
    const assignments = await assignmentsOf(ctx, job);
    if (assignments.some((row) => ACTIVE_ASSIGNMENT.includes(row.status))) {
      throw userError("A cleaner has an offer or has accepted this time. Release that assignment before moving the job.");
    }
    const next = span(args.startsAt, args.endsAt);
    await ctx.db.patch(job._id, next);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.rescheduled", actor: byMember(ctx), subject: { table: "jobs", id: job._id }, data: { from: job.startsAt, to: next.startsAt } });
    await afterReschedule(ctx, { ...job, ...next });
    return null;
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
    if (coverageOf(await assignmentsOf(ctx, job)) !== "covered") throw userError("No cleaner has accepted this job yet, so it cannot start.");
    await change(ctx, job, "in_progress");
    return null;
  },
});

export const complete = companyMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    await change(ctx, job, "completed");
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
      await ctx.db.patch(assignment._id, { status: "cancelled", endReason: "The job was cancelled.", endCause: "job_cancelled" });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "assignment.cancelled", actor: byMember(ctx), subject: { table: "assignments", id: assignment._id }, data: { from: assignment.status, cause: "job_cancelled" } });
    }
    await coverJob(ctx, job._id);
    return null;
  },
});
