/**
 * The data each Dispatch screen reads (docs/dispatch/02-screens.md). No screen is built yet; these are
 * the contracts. Groups on the board are worked out here from the records and stored nowhere: a job's
 * status, its crew's assignments, its offers and its review are separate facts, shown side by side.
 * Anything not known is returned as null, never as a guess.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, type MemberAccess } from "./lib/builders";
import { jobCoverageRequests } from "./lib/dispatch/coverage";
import { staffing } from "./lib/dispatch/crew";
import { jobAssignments } from "./lib/dispatch/facts";
import { linkState } from "./lib/dispatch/links";
import { affectedLaterJobs, arrivalEndsAt, jobChecklist, jobEvidence, noShowConditions } from "./lib/dispatch/live";
import { isManager } from "./lib/roles";
import { dispatchPolicy } from "./lib/dispatch/policy";
import { dispatchSettings } from "./lib/dispatch/settings";
import { coverKey, jobApprovals } from "./lib/dispatch/workflow";
import { liveTaskByKey } from "./lib/taskState";

type Ctx = QueryCtx & MemberAccess;

export const BOARD_GROUPS = ["needs_staffing", "awaiting_approval", "offers_out", "partially_staffed", "fully_staffed", "in_progress", "awaiting_completion_review", "closed"] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

/** Which column a job sits in. One job, one column; the facts behind it are all returned with it. */
export function boardGroup(input: { status: Doc<"jobs">["status"]; completionReported: boolean; open: number; accepted: number; offersOut: number; pendingApprovals: number }): BoardGroup {
  if (input.status === "cancelled" || input.status === "completed") return "closed";
  if (input.completionReported) return "awaiting_completion_review";
  if (input.status === "in_progress") return "in_progress";
  if (input.open === 0) return "fully_staffed";
  if (input.pendingApprovals > 0) return "awaiting_approval";
  if (input.offersOut > 0) return "offers_out";
  return input.accepted > 0 ? "partially_staffed" : "needs_staffing";
}

/** What is known about a text: its last reported state. "none" means no text was ever planned. */
async function delivery(ctx: Ctx, assignmentId: Id<"assignments">) {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_company_assignment", (q) => q.eq("companyId", ctx.companyId).eq("assignmentId", assignmentId))
    .take(50);
  return rows.map((row) => ({ messageId: row._id, purpose: row.purpose, status: row.status, problem: row.problem ?? null, attempts: row.attempts, queuedAt: row.queuedAt, sentAt: row.sentAt ?? null, deliveredAt: row.deliveredAt ?? null, failedAt: row.failedAt ?? null }));
}

async function jobRow(ctx: Ctx, job: Doc<"jobs">) {
  const assignments = await jobAssignments(ctx, job);
  const staff = staffing(job, assignments);
  const approvals = (await jobApprovals(ctx, job)).filter((row) => row.status === "pending");
  const requests = await jobCoverageRequests(ctx, job);
  const task = await liveTaskByKey(ctx, ctx.companyId, coverKey(job._id));
  const customer = await ctx.db.get(job.customerId);
  const property = await ctx.db.get(job.propertyId);
  const names = new Map<string, string>();
  for (const row of assignments) if (!names.has(row.cleanerId)) names.set(row.cleanerId, (await ctx.db.get(row.cleanerId))?.name ?? "A cleaner");
  const crew = assignments.filter((row) => row.status === "accepted");
  // The last thing the provider reported for each open offer's text, read once for the job. An offer whose
  // text did not go is a contact problem to fix, never the cleaner's silence.
  const texts = assignments.some((row) => row.status === "offered")
    ? await ctx.db
        .query("messages")
        .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
        .take(200)
    : [];
  const lastText = (assignmentId: Id<"assignments">) => {
    const mine = texts.filter((row) => row.assignmentId === assignmentId && (row.purpose === "offer" || row.purpose === "backup_offer"));
    const last = mine[mine.length - 1];
    return last ? { status: last.status, problem: last.problem ?? null } : null;
  };
  // What a cleaner is paid is the Owner's to see, here as everywhere else.
  const pay = (row: Doc<"assignments">) => (ctx.role === "owner" ? row.payCents : null);
  return {
    jobId: job._id,
    customer: customer?.name ?? null,
    serviceType: job.serviceType,
    postalCode: property?.address.postalCode ?? null,
    city: property?.address.city ?? null,
    /** The job's own status. It says nothing about staffing, review or payment. */
    status: job.status,
    startsAt: job.startsAt,
    endsAt: job.endsAt,
    /** The cleaner may arrive any time from startsAt to here. */
    arrivalEndsAt: arrivalEndsAt(job),
    hardDeadlineAt: job.hardDeadlineAt ?? null,
    /** Required and accepted are separate numbers. */
    requiredCrew: staff.required,
    acceptedCrew: staff.accepted,
    openPlaces: staff.open,
    offersOut: staff.offersOut,
    hasLead: crew.some((row) => row.role === "lead"),
    group: boardGroup({ status: job.status, completionReported: job.completionReportedAt !== undefined, open: staff.open, accepted: staff.accepted, offersOut: staff.offersOut, pendingApprovals: approvals.length }),
    pendingApprovalIds: approvals.map((row) => row._id),
    coverage: requests.filter((row) => row.status === "open" || row.status === "unresolved").map((row) => ({ coverageRequestId: row._id, cause: row.cause, status: row.status, openedAt: row.openedAt, decideBy: row.decideBy, summary: row.summary ?? null })),
    completionReportedAt: job.completionReportedAt ?? null,
    task: task ? { taskId: task._id, status: task.status, nextAction: task.nextAction ?? null, openQuestion: task.openQuestion ?? null, dueAt: task.dueAt, withPerson: task.withPersonSince !== undefined } : null,
    crew: crew.map((row) => ({
      assignmentId: row._id,
      cleanerId: row.cleanerId,
      name: names.get(row.cleanerId)!,
      role: row.role ?? null,
      payCents: pay(row),
      checkedInAt: row.checkIn?.at ?? null,
      /** Whether the phone gave a position at check-in. False means not given, not "elsewhere". */
      checkInHasPosition: row.checkIn ? row.checkIn.lat !== undefined : null,
      late: row.late ?? null,
      contactStage: row.contact?.stage ?? null,
      completion: row.completion ?? null,
    })),
    offers: assignments.filter((row) => row.status === "offered").map((row) => ({ assignmentId: row._id, cleanerId: row.cleanerId, name: names.get(row.cleanerId)!, role: row.role ?? null, kind: row.offerKind ?? "initial", offeredAt: row.offeredAt, respondBy: row.respondBy, payCents: pay(row), /** Null when no text was ever planned for this offer. */ text: lastText(row._id) })),
    ended: assignments
      .filter((row) => row.status !== "offered" && row.status !== "accepted")
      .map((row) => ({ assignmentId: row._id, cleanerId: row.cleanerId, name: names.get(row.cleanerId)!, status: row.status, cause: row.endCause ?? null, reason: row.endReason ?? null, offeredAt: row.offeredAt, respondedAt: row.respondedAt ?? null, wasAccepted: row.status === "cancelled" && row.respondedAt !== undefined })),
  };
}

type JobRow = Awaited<ReturnType<typeof jobRow>>;

async function jobsBetween(ctx: Ctx, from: number, to: number) {
  return ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gte("startsAt", from).lt("startsAt", to))
    .take(200);
}

const range = { from: v.number(), to: v.number() };

/** Dispatch Board: every job in the range in its column, with the records the column was worked out from. */
export const board = companyQuery({
  args: range,
  handler: async (ctx, args) => {
    const rows: JobRow[] = [];
    for (const job of await jobsBetween(ctx, args.from, args.to)) rows.push(await jobRow(ctx, job));
    return { groups: BOARD_GROUPS, jobs: rows, truncated: rows.length === 200 };
  },
});

/** Dispatch overview: each number comes with the ids behind it. */
export const overview = companyQuery({
  args: range,
  handler: async (ctx, args) => {
    const rows: JobRow[] = [];
    for (const job of await jobsBetween(ctx, args.from, args.to)) rows.push(await jobRow(ctx, job));
    const ids = (pick: (row: JobRow) => boolean) => rows.filter(pick).map((row) => row.jobId);
    const tasks = [];
    for (const status of ["open", "waiting", "needs_decision"] as const) {
      tasks.push(
        ...(await ctx.db
          .query("tasks")
          .withIndex("by_company_agent_status", (q) => q.eq("companyId", ctx.companyId).eq("agent", "dispatch").eq("status", status))
          .take(100)),
      );
    }
    return {
      paused: ctx.company.pausedAgents.includes("dispatch"),
      needingCoverage: ids((row) => row.group === "needs_staffing"),
      awaitingApproval: ids((row) => row.group === "awaiting_approval"),
      partiallyStaffed: ids((row) => row.openPlaces > 0 && row.acceptedCrew > 0 && row.status === "scheduled"),
      pendingOffers: rows.flatMap((row) => row.offers.map((offer) => ({ jobId: row.jobId, ...offer }))),
      activeDelays: rows.flatMap((row) => row.crew.filter((member) => member.late !== null && member.checkedInAt === null).map((member) => ({ jobId: row.jobId, assignmentId: member.assignmentId, etaAt: member.late!.etaAt }))),
      notCheckedIn: rows.flatMap((row) => row.crew.filter((member) => member.contactStage !== null).map((member) => ({ jobId: row.jobId, assignmentId: member.assignmentId, stage: member.contactStage! }))),
      coverageSearches: rows.flatMap((row) => row.coverage.map((request) => ({ jobId: row.jobId, ...request }))),
      awaitingHandoff: ids((row) => row.group === "awaiting_completion_review"),
      /** The agent's own work: what it is doing next and by when, and what it has handed to a person or another queue. */
      tasks: tasks.map((task) => ({ taskId: task._id, title: task.title, status: task.status, nextAction: task.nextAction ?? null, openQuestion: task.openQuestion ?? null, dueAt: task.dueAt, about: task.about ?? null, handoffTo: task.handoffTo ?? null, withPerson: task.withPersonSince !== undefined, trigger: task.trigger ?? null, escalation: task.escalation ?? null, completionCondition: task.completionCondition })),
      truncated: rows.length === 200,
    };
  },
});

/** Schedule: jobs with their windows, and each ready cleaner's hours, time off and commitments in the range. */
export const schedule = companyQuery({
  args: range,
  handler: async (ctx, args) => {
    const jobs: JobRow[] = [];
    for (const job of await jobsBetween(ctx, args.from, args.to)) jobs.push(await jobRow(ctx, job));
    const cleaners = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "ready"))
      .take(200);
    const out = [];
    for (const cleaner of cleaners) {
      const windows = await ctx.db
        .query("availabilityWindows")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
        .take(100);
      const timeOff = await ctx.db
        .query("timeOff")
        .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gt("endsAt", args.from))
        .take(100);
      out.push({
        cleanerId: cleaner._id,
        name: cleaner.name,
        /** Weekly hours on the company's clock: weekday 0 is Sunday, minutes from midnight. */
        windows: windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })),
        timeOff: timeOff.filter((row) => row.startsAt < args.to).map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })),
        commitments: jobs.flatMap((job) => [
          ...job.crew.filter((member) => member.cleanerId === cleaner._id).map((member) => ({ jobId: job.jobId, assignmentId: member.assignmentId, kind: "accepted" as const, role: member.role, startsAt: job.startsAt, endsAt: job.endsAt })),
          ...job.offers.filter((offer) => offer.cleanerId === cleaner._id).map((offer) => ({ jobId: job.jobId, assignmentId: offer.assignmentId, kind: "offered" as const, role: offer.role, startsAt: job.startsAt, endsAt: job.endsAt })),
        ]),
      });
    }
    // 200 is the most this reads. A screen that gets exactly that many says the list may be incomplete.
    return { timezone: ctx.company.timezone, travelBufferMinutes: dispatchSettings(ctx.company).travelBufferMinutes, jobs, cleaners: out, truncated: jobs.length === 200, cleanersTruncated: cleaners.length === 200 };
  },
});

/** Offers & Coverage: every open offer with its text's fate, every coverage request, and urgent-hire handoffs. */
export const offersAndCoverage = companyQuery({
  args: range,
  handler: async (ctx, args) => {
    const offers = [];
    const coverage = [];
    const jobs = await jobsBetween(ctx, args.from, args.to);
    for (const job of jobs) {
      const row = await jobRow(ctx, job);
      for (const offer of row.offers) offers.push({ jobId: row.jobId, customer: row.customer, startsAt: row.startsAt, ...offer, messages: await delivery(ctx, offer.assignmentId) });
      for (const request of await jobCoverageRequests(ctx, job)) {
        coverage.push({ coverageRequestId: request._id, jobId: job._id, customer: row.customer, startsAt: job.startsAt, cause: request.cause, detail: request.detail ?? null, status: request.status, openedAt: request.openedAt, decideBy: request.decideBy, summary: request.summary ?? null, filledByAssignmentId: request.filledByAssignmentId ?? null, offersOut: row.offers.filter((offer) => offer.kind === "backup").length });
      }
    }
    const urgent = (
      await ctx.db
        .query("tasks")
        .withIndex("by_company_agent_status", (q) => q.eq("companyId", ctx.companyId).eq("agent", "recruiter").eq("status", "open"))
        .take(100)
    ).filter((task) => task.handoffTo === "recruiter" || task.key?.startsWith("recruiter."));
    const policy = dispatchPolicy(ctx.company);
    return { truncated: jobs.length === 200, broadcastEnabled: policy.broadcastEnabled, offers, coverage, recruiterHandoffs: urgent.map((task) => ({ taskId: task._id, title: task.title, dueAt: task.dueAt, about: task.about ?? null })) };
  },
});

/** Live Jobs: each accepted cleaner's day, as recorded facts. "Not checked in" and "no-show" are different rows of the record. */
export const liveJobs = companyQuery({
  args: range,
  handler: async (ctx, args) => {
    const now = Date.now();
    const policy = dispatchPolicy(ctx.company);
    const out = [];
    const all = await jobsBetween(ctx, args.from, args.to);
    for (const job of all) {
      if (job.status === "cancelled") continue;
      const row = await jobRow(ctx, job);
      const items = await jobChecklist(ctx, job);
      const evidence = await jobEvidence(ctx, job);
      const crew = [];
      for (const member of row.crew) {
        const assignment = (await ctx.db.get(member.assignmentId))!;
        let arrival: "not_due" | "due" | "checked_in" | "late_with_eta" | "not_checked_in" | "cleaner_asked" | "operator_alerted" | "no_show_suspected";
        if (member.checkedInAt !== null) arrival = "checked_in";
        else if (member.contactStage === "contacted") arrival = "cleaner_asked";
        else if (member.contactStage) arrival = member.contactStage;
        else if (member.late && now < member.late.etaAt) arrival = "late_with_eta";
        else if (now < job.startsAt) arrival = "not_due";
        else arrival = now <= row.arrivalEndsAt ? "due" : "not_checked_in";
        const affected = member.late && member.checkedInAt === null ? await affectedLaterJobs(ctx, { assignment, job, company: ctx.company }, member.late.etaAt + (job.endsAt - job.startsAt)) : [];
        const cleaner = await ctx.db.get(member.cleanerId);
        // What still stands between this cleaner and a no-show, so a person confirms one knowing it.
        const notYet = arrival === "checked_in" || now < job.startsAt ? null : noShowConditions(assignment, job, policy, now, null).missing.filter((row) => !row.startsWith("the cleaner checked in"));
        crew.push({
          ...member,
          arrival,
          affectedLaterJobs: affected,
          messages: await delivery(ctx, member.assignmentId),
          /** A phone number is shown to Owners and Managers, who are the ones who call. */
          phone: isManager(ctx.role) ? (cleaner?.phone ?? null) : null,
          hasPhone: Boolean(cleaner?.phone),
          noShowNotYet: notYet,
        });
      }
      out.push({
        ...row,
        crew,
        noShows: row.ended.filter((entry) => entry.cause === "no_show"),
        drops: row.ended.filter((entry) => entry.cause === "dropped"),
        checklist: { total: items.length, done: items.filter((item) => item.state === "done").length, skipped: items.filter((item) => item.state === "skipped").length },
        photos: { before: evidence.filter((entry) => entry.kind === "before").length, after: evidence.filter((entry) => entry.kind === "after").length, requiredBefore: policy.beforePhotosRequired, requiredAfter: policy.afterPhotosRequired },
        openReports: (
          await ctx.db
            .query("jobReports")
            .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
            .take(100)
        ).map((report) => ({ reportId: report._id, kind: report.kind, text: report.text, status: report.status, assignmentId: report.assignmentId })),
      });
    }
    return { asOf: now, jobs: out, truncated: all.length === 200 };
  },
});

function nextActionFor(link: Doc<"actionLinks">, state: ReturnType<typeof linkState>, assignment: Doc<"assignments"> | null, lastText: { status: string } | null): string {
  if (!assignment) return "Nothing: the assignment no longer exists.";
  if (state === "revoked") return "Nothing: this link is closed.";
  if (link.purpose === "offer") {
    if (assignment.status !== "offered") return "Nothing: the offer was answered or ended.";
    if (!lastText || lastText.status === "not_sent") return "No text went out. Contact the cleaner and record their answer, or issue the link again.";
    if (lastText.status === "failed" || lastText.status === "unconfirmed") return "The text did not go. Check the number, then issue the link again.";
    if (lastText.status === "held") return "The text is held for quiet hours. It goes when they end, unless something stops it first.";
    return "Waiting for the cleaner's answer.";
  }
  if (assignment.status !== "accepted") return "Nothing: the cleaner is no longer on this job.";
  if (assignment.completion) return "Submitted for review. Quality reviews the visit.";
  if (assignment.checkIn) return "Waiting for the cleaner to finish and submit.";
  return state === "expired" ? "The link ran out before check-in. Issue a new one if the job is still on." : "Waiting for the cleaner to check in.";
}

async function linkRows(ctx: Ctx, links: Doc<"actionLinks">[]) {
  const now = Date.now();
  const out = [];
  for (const link of links) {
    const assignment = await ctx.db.get(link.assignmentId);
    const job = await ctx.db.get(link.jobId);
    const cleaner = await ctx.db.get(link.cleanerId);
    const texts = (await delivery(ctx, link.assignmentId));
    const mine = await ctx.db
      .query("messages")
      .withIndex("by_company_assignment", (q) => q.eq("companyId", ctx.companyId).eq("assignmentId", link.assignmentId))
      .take(50);
    const carried = mine.filter((row) => row.linkId === link._id).map((row) => texts.find((entry) => entry.messageId === row._id)!);
    const state = linkState(link, now);
    out.push({
      linkId: link._id,
      purpose: link.purpose,
      recipient: { cleanerId: link.cleanerId, name: cleaner?.name ?? null, hasPhone: Boolean(cleaner?.phone) },
      jobId: link.jobId,
      assignmentId: link.assignmentId,
      jobStartsAt: job?.startsAt ?? null,
      allowed: link.allowed,
      status: state,
      issuedAt: link.issuedAt,
      expiresAt: link.expiresAt,
      revokedAt: link.revokedAt ?? null,
      revokeReason: link.revokeReason ?? null,
      /** The texts that carried this link, with what the provider reported. Delivery is not the same as being seen. */
      messages: carried,
      /** Page views are not recorded, so whether the link was opened is not known. */
      opened: null,
      /** The last thing actually done through the link. */
      lastAction: link.lastAction ?? null,
      lastActionAt: link.lastActionAt ?? null,
      response: assignment ? { assignmentStatus: assignment.status, respondedAt: assignment.respondedAt ?? null, checkedInAt: assignment.checkIn?.at ?? null, completionSubmittedAt: assignment.completion?.submittedAt ?? null } : null,
      deadline: link.purpose === "offer" ? (assignment?.respondBy ?? null) : (job?.endsAt ?? null),
      nextAction: nextActionFor(link, state, assignment, carried[carried.length - 1] ?? null),
    });
  }
  return out;
}

/** Action Links: every link issued, newest first, with its recipient, texts, last action, deadline and next step. */
export const actionLinks = companyQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const links = await ctx.db
      .query("actionLinks")
      .withIndex("by_company_issued", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 100, 1), 200));
    return linkRows(ctx, links);
  },
});

/** The same, for one job: shown on the job record. */
export const jobRecord = companyQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const links = await ctx.db
      .query("actionLinks")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
      .take(200);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
      .take(200);
    return {
      job: await jobRow(ctx, job),
      links: await linkRows(ctx, links),
      /** Every text about this job, including ones with no link. The body is shown with the link left out. */
      messages: messages.map((row) => ({ messageId: row._id, purpose: row.purpose, cleanerId: row.cleanerId ?? null, assignmentId: row.assignmentId ?? null, body: row.body, status: row.status, problem: row.problem ?? null, queuedAt: row.queuedAt, sentAt: row.sentAt ?? null, deliveredAt: row.deliveredAt ?? null })),
    };
  },
});
