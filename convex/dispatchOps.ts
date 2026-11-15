/**
 * What people do in Dispatch, and the schedule that watches the day of service. Everything a person
 * does here is recorded with who did it. Nothing here is reachable by a cleaner's link.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { assignmentLinks, issueLink, linkPath, linkState, revokeLink, siteOrigin, tokenFor } from "./lib/dispatch/links";
import { declareNoShow, jobChecklist, noCheckInKey, noShowConditions, watchJob } from "./lib/dispatch/live";
import { checkedPolicy, dispatchPolicy, POLICY_LIMITS } from "./lib/dispatch/policy";
import { confirmedSms, offerSms } from "./lib/dispatch/sms";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { messageByKey, queueMessage } from "./lib/messaging/outbox";
import { messagingProvider } from "./lib/messaging/provider";
import { liveTaskByKey, setTaskState } from "./lib/taskState";
import { optionalText, text } from "./lib/text";
import { dispatchPolicyValidator } from "./schema";

const HOUR = 60 * 60 * 1000;

// ── The schedule ─────────────────────────────────────────────────────────────────────────────────

export const watch = internalMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    await watchJob(ctx, args.jobId);
    return null;
  },
});

/**
 * Run on a schedule: every job from twelve hours ago to two days ahead is looked at, each in its own
 * step, for a reminder that is due, an arrival that is overdue, or a visit running over.
 */
export const monitor = internalMutation({
  args: { status: v.optional(v.union(v.literal("scheduled"), v.literal("in_progress"))), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const status = args.status ?? "scheduled";
    const page = await ctx.db
      .query("jobs")
      .withIndex("by_status_start", (q) => q.eq("status", status).gt("startsAt", now - 12 * HOUR).lt("startsAt", now + 49 * HOUR))
      .paginate({ numItems: 100, cursor: args.cursor ?? null });
    for (const job of page.page) await ctx.scheduler.runAfter(0, internal.dispatchOps.watch, { jobId: job._id });
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.dispatchOps.monitor, { status, cursor: page.continueCursor });
    else if (status === "scheduled") await ctx.scheduler.runAfter(0, internal.dispatchOps.monitor, { status: "in_progress" });
    return page.page.length;
  },
});

// ── Policy ───────────────────────────────────────────────────────────────────────────────────────

export const policy = companyQuery({
  args: {},
  handler: async (ctx) => ({
    ...dispatchPolicy(ctx.company),
    limits: POLICY_LIMITS,
    /** Whether texts can go out at all, and whether links can be issued. Unknown is never shown as working. */
    messaging: messagingProvider()?.name ?? null,
    linksReady: (await tokenFor({ publicId: "probe" })) !== null,
  }),
});

export const setPolicy = ownerMutation({
  args: { policy: dispatchPolicyValidator },
  handler: async (ctx, args) => {
    const next = checkedPolicy(ctx.company.dispatchPolicy, args.policy);
    await ctx.db.patch(ctx.companyId, { dispatchPolicy: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "company.dispatch_policy_changed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { changed: Object.keys(args.policy).join(",") } });
    return null;
  },
});

// ── Checklist ────────────────────────────────────────────────────────────────────────────────────

/** Sets the job's checklist. Once a cleaner has marked anything on it, it is theirs and is not replaced. */
export const setChecklist = companyMutation({
  args: { jobId: v.id("jobs"), items: v.array(v.object({ label: v.string(), section: v.optional(v.string()), requiresPhoto: v.optional(v.boolean()) })) },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status === "completed" || job.status === "cancelled") throw userError("This job is closed.");
    if (args.items.length > 200) throw userError("A checklist can have up to 200 items.");
    const existing = await jobChecklist(ctx, job);
    if (existing.some((item) => item.state !== "pending")) throw userError("The crew has started this checklist, so it can no longer be replaced.");
    for (const item of existing) await ctx.db.delete(item._id);
    let order = 0;
    for (const item of args.items) {
      await ctx.db.insert("checklistItems", { companyId: ctx.companyId, jobId: job._id, order: order++, section: optionalText(item.section, "The section", 80), label: text(item.label, "A checklist item", 200), requiresPhoto: item.requiresPhoto === true, state: "pending" });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.checklist_set", actor: byMember(ctx), subject: { table: "jobs", id: job._id }, data: { items: args.items.length } });
    return null;
  },
});

// ── No-show ──────────────────────────────────────────────────────────────────────────────────────

/** A person confirms the no-show. The record says which of the configured steps had and had not run. */
export const confirmNoShow = managerMutation({
  args: { assignmentId: v.id("assignments"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const assignment = await owned(ctx, args.assignmentId);
    const job = await ctx.db.get(assignment.jobId);
    if (!job || assignment.status !== "accepted") throw userError("Only an accepted assignment can be a no-show.");
    const nudge = assignment.contact ? await messageByKey(ctx, ctx.companyId, `check_in_nudge:${assignment._id}:${Math.max(job.startsAt + (job.arrivalWindowMinutes ?? 0) * 60_000, assignment.late?.etaAt ?? 0)}`) : null;
    const conditions = noShowConditions(assignment, job, dispatchPolicy(ctx.company), Date.now(), nudge);
    if (Date.now() < job.startsAt) throw userError("The visit has not started, so nobody can be a no-show yet. Release the cleaner instead.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "assignment.no_show_confirmed", actor: byMember(ctx), subject: { table: "assignments", id: assignment._id }, data: { jobId: job._id, stepsComplete: conditions.met, notMet: conditions.missing.join("; ").slice(0, 300) } });
    await declareNoShow(ctx, assignment._id, byMember(ctx), optionalText(args.note, "The note", 500));
    return { stepsComplete: conditions.met, notMet: conditions.missing };
  },
});

/** A person reached the cleaner and they are coming. The no-check-in steps start over from now. */
export const cleanerIsComing = managerMutation({
  args: { assignmentId: v.id("assignments"), note: v.string(), etaMinutes: v.number() },
  handler: async (ctx, args) => {
    const assignment = await owned(ctx, args.assignmentId);
    if (assignment.status !== "accepted" || assignment.checkIn) throw userError("This only applies to an accepted cleaner who has not checked in.");
    if (!Number.isInteger(args.etaMinutes) || args.etaMinutes < 1 || args.etaMinutes > 480) throw userError("Give the ETA in minutes, from 1 to 480.");
    const now = Date.now();
    const note = text(args.note, "The note", 500);
    await ctx.db.patch(assignment._id, { late: { reportedAt: now, etaAt: now + args.etaMinutes * 60_000, reason: note }, contact: undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "assignment.delay_recorded", actor: byMember(ctx), subject: { table: "assignments", id: assignment._id }, data: { jobId: assignment.jobId, etaAt: now + args.etaMinutes * 60_000 } });
    const task = await liveTaskByKey(ctx, ctx.companyId, noCheckInKey(assignment._id));
    if (task) await setTaskState(ctx, task, "done", { outcome: `Reached by a person: ${note}`, closedAt: now, withPersonSince: null }, byMember(ctx));
    return null;
  },
});

// ── Reports from the job ─────────────────────────────────────────────────────────────────────────

/** A person's decision on a cleaner's report or add-on request. Approving a request charges nobody. */
export const decideReport = managerMutation({
  args: { reportId: v.id("jobReports"), decision: v.union(v.literal("acknowledged"), v.literal("approved"), v.literal("declined")), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const report = await owned(ctx, args.reportId);
    if (report.status !== "awaiting_decision") throw userError("This was already decided.");
    const note = optionalText(args.note, "The note", 500);
    await ctx.db.patch(report._id, { status: args.decision, decidedBy: ctx.member._id, decidedAt: Date.now(), decisionNote: note });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.report_decided", actor: byMember(ctx), subject: { table: "jobs", id: report.jobId }, data: { kind: report.kind, decision: args.decision } });
    if (report.taskId) {
      const task = await ctx.db.get(report.taskId);
      if (task && task.status !== "done" && task.status !== "cancelled") await setTaskState(ctx, task, "done", { outcome: `${args.decision}${note ? `: ${note}` : ""}`, closedAt: Date.now(), withPersonSince: null }, byMember(ctx));
    }
    return null;
  },
});

// ── Links and messages ───────────────────────────────────────────────────────────────────────────

export const revokeActionLink = managerMutation({
  args: { linkId: v.id("actionLinks"), reason: v.string() },
  handler: async (ctx, args) => {
    const link = await owned(ctx, args.linkId);
    await revokeLink(ctx, link, text(args.reason, "The reason", 300), byMember(ctx));
    return null;
  },
});

/**
 * Shows a live link's address to a manager so they can pass it on by hand. The reveal is recorded. The
 * address is returned to this caller only and written nowhere.
 */
export const revealActionLink = managerMutation({
  args: { linkId: v.id("actionLinks") },
  handler: async (ctx, args) => {
    const link = await owned(ctx, args.linkId);
    if (linkState(link, Date.now()) !== "active") throw userError("This link is no longer active. Issue a new one.");
    const token = await tokenFor(link);
    if (!token) throw userError("Action links are not set up on this deployment.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "link.revealed", actor: byMember(ctx), subject: { table: "actionLinks", id: link._id }, data: { purpose: link.purpose, assignmentId: link.assignmentId } });
    return { url: `${siteOrigin()}${linkPath(link.purpose, token)}` };
  },
});

/**
 * Closes the assignment's current link of its kind, issues a fresh one and texts it. For an offer that
 * is still open, or an accepted cleaner who lost their link.
 */
export const reissueLink = managerMutation({
  args: { assignmentId: v.id("assignments") },
  handler: async (ctx, args) => {
    const assignment = await owned(ctx, args.assignmentId);
    const job = await ctx.db.get(assignment.jobId);
    const cleaner = await ctx.db.get(assignment.cleanerId);
    if (!job || !cleaner) notFound();
    if (assignment.status !== "offered" && assignment.status !== "accepted") throw userError("This assignment has ended, so it has no link to issue.");
    if (job.status === "cancelled" || job.status === "completed") throw userError("This job is closed.");
    const purpose = assignment.status === "offered" ? ("offer" as const) : ("job" as const);
    const now = Date.now();
    const expiresAt = purpose === "offer" ? assignment.respondBy : job.endsAt + dispatchPolicy(ctx.company).jobAccessGraceHours * HOUR;
    if (expiresAt <= now) throw userError("The time this link would cover has passed.");
    for (const old of await assignmentLinks(ctx, assignment)) if (old.purpose === purpose) await revokeLink(ctx, old, "Replaced by a new link.", byMember(ctx));
    const link = await issueLink(ctx, { assignment, purpose, expiresAt, actor: byMember(ctx) });
    if (!link) throw userError("Action links are not set up on this deployment.");
    const message = await queueMessage(ctx, {
      companyId: ctx.companyId,
      purpose: purpose === "offer" ? (assignment.offerKind === "backup" ? "backup_offer" : "offer") : "assignment_confirmed",
      cleaner,
      jobId: job._id,
      assignmentId: assignment._id,
      link,
      body: purpose === "offer" ? offerSms({ company: ctx.company, job, property: await ctx.db.get(job.propertyId), assignment, backup: assignment.offerKind === "backup" }) : confirmedSms({ company: ctx.company, job }),
      dedupeKey: `reissue:${link._id}`,
      actor: byMember(ctx),
    });
    return { linkId: link._id, messageStatus: message.status, problem: message.problem ?? null };
  },
});
