/**
 * Dispatch (brief, section 11). The workflow itself is convex/lib/dispatch/workflow.ts; this file is how
 * it is started on a schedule, what a person can see of it, and how a person steps in or hands back.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { authorityFor } from "./lib/authority";
import { companyMutation, companyQuery, ownerMutation } from "./lib/builders";
import { checkedSettings, DISPATCH_LIMITS, dispatchSettings } from "./lib/dispatch/settings";
import { candidatesFor, coverAction, coverJob, coverKey, holdForPerson, jobApprovals } from "./lib/dispatch/workflow";
import { notAllowed, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isManager } from "./lib/roles";
import { liveTaskByKey, setTaskState } from "./lib/taskState";
import { optionalText } from "./lib/text";

const DAY = 24 * 60 * 60 * 1000;
/** The furthest ahead any company can ask Dispatch to look. */
const FURTHEST_DAYS = DISPATCH_LIMITS.lookAheadDays.max;

/** Looks at one job and does whatever is still missing to get it a cleaner. Safe to run again. */
export const cover = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => coverJob(ctx, args.jobId),
});

/**
 * Run on a schedule: every scheduled job starting in the coming days is looked at again, each in its own
 * step, so one job's trouble never holds up another. A long list continues where it left off.
 */
export const sweep = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const page = await ctx.db
      .query("jobs")
      .withIndex("by_status_start", (q) => q.eq("status", "scheduled").gt("startsAt", now).lt("startsAt", now + (FURTHEST_DAYS + 1) * DAY))
      .paginate({ numItems: 100, cursor: args.cursor ?? null });
    for (const job of page.page) await ctx.scheduler.runAfter(0, internal.dispatch.cover, { jobId: job._id });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.dispatch.sweep, { cursor: page.continueCursor });
    return page.page.length;
  },
});

export const settings = companyQuery({
  args: {},
  handler: async (ctx) => ({ ...dispatchSettings(ctx.company), usingDefaults: ctx.company.dispatch === undefined, limits: DISPATCH_LIMITS }),
});

/** How long a cleaner has to answer, the time kept between jobs, and how far ahead Dispatch looks. */
export const setSettings = ownerMutation({
  args: { offerWindowMinutes: v.number(), travelBufferMinutes: v.number(), lookAheadDays: v.number() },
  handler: async (ctx, args) => {
    const next = checkedSettings(args);
    await ctx.db.patch(ctx.companyId, { dispatch: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "company.dispatch_settings_changed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: next });
    return null;
  },
});

/**
 * Who Dispatch would ask for this job, best first, with the reasons, and who it cannot ask and why.
 * Pay amounts are the Owner's to see; everyone else sees only that the pay can be worked out.
 */
export const candidates = companyQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const found = await candidatesFor(ctx, ctx.company, job);
    const action = coverAction(found.assignments);
    const authority = await authorityFor(ctx, ctx.companyId, action);
    const task = await liveTaskByKey(ctx, ctx.companyId, coverKey(job._id));
    const pending = (await jobApprovals(ctx, job)).find((row) => row.status === "pending");
    const showPay = ctx.role === "owner";
    return {
      jobId: job._id,
      coverage: found.assignments.some((row) => row.status === "accepted") ? ("covered" as const) : found.assignments.some((row) => row.status === "offered") ? ("offered" as const) : ("uncovered" as const),
      /** The permission that covers finding a cleaner for this job now. */
      action,
      /** What Dispatch may do with that permission right now. */
      authority: authority.kind === "level" ? authority.level : authority.kind === "paused" ? ("paused" as const) : ("off" as const),
      taskId: task?._id ?? null,
      /** True while a person holds this visit and Dispatch is leaving it alone. */
      withPerson: task?.withPersonSince !== undefined,
      pendingApprovalId: pending?._id ?? null,
      /** The cleaner the pending proposal names, if there is one. */
      proposedCleanerId: pending?.proposal?.kind === "offer_assignment" ? pending.proposal.cleanerId : null,
      settings: dispatchSettings(ctx.company),
      candidates: found.candidates.map((candidate, index) => ({
        cleanerId: candidate.cleanerId as (typeof found.cleaners)[number]["_id"],
        name: candidate.name,
        rank: index + 1,
        reasons: candidate.reasons,
        priorVisitsForCustomer: candidate.priorVisitsForCustomer,
        otherVisitsThatDay: candidate.otherVisitsThatDay,
        pay: showPay && candidate.pay.ok ? { payCents: candidate.pay.payCents, basis: candidate.pay.basis } : null,
      })),
      excluded: found.excluded.map((entry) => ({
        cleanerId: entry.cleanerId as (typeof found.cleaners)[number]["_id"],
        name: entry.name,
        code: entry.code,
        reason: entry.reason,
      })),
    };
  },
});

/**
 * A person takes a visit's coverage into their own hands. Dispatch leaves it alone until it is handed
 * back. A proposal waiting on this visit is closed as changed, which only an Owner or Manager may do.
 */
export const takeOver = companyMutation({
  args: { jobId: v.id("jobs"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "scheduled") throw userError("Only a scheduled visit can be taken over.");
    const note = optionalText(args.note, "The note", 2000);
    const pending = (await jobApprovals(ctx, job)).filter((row) => row.status === "pending");
    if (pending.length > 0 && !isManager(ctx.role)) notAllowed();
    for (const approval of pending) {
      await ctx.db.patch(approval._id, { status: "changed", decidedBy: ctx.member._id, decidedAt: Date.now(), note: note ?? "Taken over by a person." });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "approval.changed", actor: byMember(ctx), subject: { table: "approvals", id: approval._id }, data: { action: approval.action, cause: "taken_over" } });
    }
    await holdForPerson(ctx, job, "You took this visit over. Offer it to a cleaner yourself, or hand it back to Dispatch.", byMember(ctx));
    await recordEvent(ctx, { companyId: ctx.companyId, type: "dispatch.taken_over", actor: byMember(ctx), subject: { table: "jobs", id: job._id } });
    return await coverJob(ctx, job._id);
  },
});

/** Gives a visit back to Dispatch, which looks at it again straight away. Answers where it now stands. */
export const handBack = companyMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const task = await liveTaskByKey(ctx, ctx.companyId, coverKey(job._id));
    if (task && task.withPersonSince !== undefined) {
      await setTaskState(ctx, task, "open", { nextAction: "Find a cleaner for this visit", withPersonSince: null }, byMember(ctx), { sameStatus: true });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "dispatch.handed_back", actor: byMember(ctx), subject: { table: "jobs", id: job._id } });
    }
    return await coverJob(ctx, job._id);
  },
});
