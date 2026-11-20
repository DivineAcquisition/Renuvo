/**
 * The day of service: reminder, check-in, delay, dropping out, the no-check-in steps, and completion.
 *
 * Each fact has its own field and its own time. "Not checked in" is not a no-show: a no-show is declared
 * only after the cleaner was asked, the operator was alerted and the Owner's wait has passed, and by
 * Dispatch itself only if the Owner allows that. A cleaner who says they are late is a communicated
 * delay, not silence. A crew reporting completion hands the visit to Quality: it approves nothing and
 * pays nobody.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { messageByKey, queueMessage } from "../messaging/outbox";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { clock } from "../time";
import { endAssignment } from "./assignmentState";
import { openCoverageRequest } from "./coverage";
import { jobAssignments } from "./facts";
import { handOff } from "./handoffs";
import { liveLink } from "./links";
import { dispatchPolicy, type DispatchPolicy } from "./policy";
import { dispatchSettings } from "./settings";
import { arrivalWords, beforePhotosSms, checkInNudgeSms, endedSms, reminderSms } from "./sms";
import { coverJob, whenWords, type CarriedOut } from "./workflow";

const MINUTE = 60_000;
const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const SYSTEM: Actor = { kind: "system" };

export const SEND_REMINDER = "dispatch.send_reminder";
export const DECLARE_NO_SHOW = "dispatch.declare_no_show";
/** A cleaner can check in from this long before the start. Earlier than that is refused as a mistake. */
export const EARLY_CHECK_IN_MINUTES = 120;

export const noCheckInKey = (assignmentId: Id<"assignments">) => `dispatch.no_check_in:${assignmentId}`;
export const delayKey = (assignmentId: Id<"assignments">) => `dispatch.delay:${assignmentId}`;

/** The latest moment the cleaner is expected: the end of the arrival window, not its start. */
export function arrivalEndsAt(job: Pick<Doc<"jobs">, "startsAt" | "arrivalWindowMinutes">): number {
  return job.startsAt + (job.arrivalWindowMinutes ?? 0) * MINUTE;
}

type Loaded = { assignment: Doc<"assignments">; job: Doc<"jobs">; company: Doc<"companies">; cleaner: Doc<"cleaners"> };

/** Reads an assignment with its job, company and cleaner, and refuses anything that is not a live accepted assignment. */
export async function liveAssignment(ctx: QueryCtx | MutationCtx, assignmentId: Id<"assignments">): Promise<Loaded> {
  const assignment = await ctx.db.get(assignmentId);
  const job = assignment ? await ctx.db.get(assignment.jobId) : null;
  const company = assignment ? await ctx.db.get(assignment.companyId) : null;
  const cleaner = assignment ? await ctx.db.get(assignment.cleanerId) : null;
  if (!assignment || !job || !company || !cleaner) throw userError("This job is no longer available.", "not_found");
  if (assignment.status !== "accepted") throw userError("You are no longer assigned to this job.", "not_allowed");
  if (job.status === "cancelled") throw userError("This job was cancelled.", "not_allowed");
  if (job.status === "completed") throw userError("This job is closed.", "not_allowed");
  return { assignment, job, company, cleaner };
}

// ── Reminder ─────────────────────────────────────────────────────────────────────────────────────

async function queueReminder(ctx: MutationCtx, loaded: Loaded, actor: Actor) {
  const { assignment, job, company, cleaner } = loaded;
  return queueMessage(ctx, {
    companyId: company._id,
    purpose: "reminder",
    cleaner,
    jobId: job._id,
    assignmentId: assignment._id,
    link: await liveLink(ctx, assignment, "job"),
    body: reminderSms({ company, job }),
    dedupeKey: `reminder:${assignment._id}:${job.startsAt}`,
    actor,
  });
}

/** An approved reminder is sent only if it still makes sense at that moment. */
export async function carryOutReminder(ctx: MutationCtx, approval: Doc<"approvals">, assignmentId: Id<"assignments">): Promise<CarriedOut> {
  const now = Date.now();
  let detail: string;
  let ok = false;
  const assignment = await ctx.db.get(assignmentId);
  const job = assignment ? await ctx.db.get(assignment.jobId) : null;
  const company = await ctx.db.get(approval.companyId);
  const cleaner = assignment ? await ctx.db.get(assignment.cleanerId) : null;
  if (!assignment || !job || !company || !cleaner || assignment.companyId !== approval.companyId) detail = "Not carried out. The assignment no longer exists.";
  else if (assignment.status !== "accepted") detail = `Not carried out. ${cleaner.name} is no longer assigned to this visit.`;
  else if (job.status !== "scheduled" || job.startsAt <= now) detail = "Not carried out. The visit has already started or is no longer scheduled.";
  else if (assignment.checkIn) detail = `Not carried out. ${cleaner.name} has already checked in.`;
  else if (company.pausedAgents.includes("dispatch")) detail = "Not carried out. Dispatch is paused, so it sent nothing.";
  else {
    const message = await queueReminder(ctx, { assignment, job, company, cleaner }, DISPATCH);
    ok = message.status !== "not_sent";
    detail = ok ? `The reminder to ${cleaner.name} was handed to the text service.` : `Not carried out. ${message.problem ?? "The reminder could not be sent."}`;
  }
  await ctx.db.patch(approval._id, { carriedOut: { ok, detail, at: now } });
  await recordEvent(ctx, { companyId: approval.companyId, type: ok ? "approval.carried_out" : "approval.not_carried_out", actor: DISPATCH, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
  return { ok, detail };
}

async function remind(ctx: MutationCtx, loaded: Loaded, policy: DispatchPolicy, now: number) {
  const { assignment, job, company, cleaner } = loaded;
  if (assignment.reminderQueuedAt !== undefined || assignment.checkIn) return;
  if (now < job.startsAt - policy.reminderLeadMinutes * MINUTE || now >= job.startsAt) return;
  const authority = await authorityFor(ctx, company._id, SEND_REMINDER);
  // Paused or switched off: nothing goes out, and nothing is marked done, so it goes once Dispatch is back.
  if (authority.kind !== "level" || authority.level === "off") return;
  await ctx.db.patch(assignment._id, { reminderQueuedAt: now });
  if (authority.level === "propose") {
    await requestApproval(ctx, {
      companyId: company._id,
      action: SEND_REMINDER,
      summary: `Send ${cleaner.name} the reminder for the visit on ${whenWords(job.startsAt, company.timezone)}`,
      reason: `The visit starts ${whenWords(job.startsAt, company.timezone)} and your reminder time is ${policy.reminderLeadMinutes} minutes before.`,
      authorizes: `Dispatch will text ${cleaner.name}: "${reminderSms({ company, job }).replace("{link}", "[their job link]")}"`,
      ifWaiting: "No reminder goes out. The visit itself is not affected.",
      proposal: { kind: "send_reminder", assignmentId: assignment._id },
      decideBy: job.startsAt,
      about: { table: "assignments", id: assignment._id },
    });
    return;
  }
  const message = await queueReminder(ctx, loaded, DISPATCH);
  if (authority.level === "execute_and_report") {
    await recordEvent(ctx, { companyId: company._id, type: "dispatch.reported", actor: DISPATCH, subject: { table: "messages", id: message._id }, data: { action: SEND_REMINDER, jobId: job._id, cleanerId: cleaner._id } });
  }
}

// ── Check-in ─────────────────────────────────────────────────────────────────────────────────────

export type Position = { lat?: number; lng?: number; accuracyM?: number };

function checkedPosition(position: Position): Position {
  const { lat, lng, accuracyM } = position;
  if (lat === undefined || lng === undefined) return {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return {};
  return { lat, lng, ...(accuracyM !== undefined && Number.isFinite(accuracyM) && accuracyM >= 0 ? { accuracyM: Math.round(accuracyM) } : {}) };
}

/**
 * Records that the cleaner arrived. Checking in twice changes nothing the second time and sends nothing
 * again. The position is what the phone reported, kept as given; without one the arrival is still recorded,
 * as an arrival with no position.
 */
export async function checkIn(ctx: MutationCtx, assignmentId: Id<"assignments">, position: Position, actor: Actor): Promise<{ status: "checked_in" | "already_checked_in"; at: number }> {
  const loaded = await liveAssignment(ctx, assignmentId);
  const { assignment, job, company, cleaner } = loaded;
  if (assignment.checkIn) return { status: "already_checked_in", at: assignment.checkIn.at };
  const now = Date.now();
  if (now < job.startsAt - EARLY_CHECK_IN_MINUTES * MINUTE) throw userError(`It is too early to check in. This job is ${arrivalWords(job, company.timezone)}.`);
  const at = { at: now, ...checkedPosition(position) };
  await ctx.db.patch(assignment._id, { checkIn: at, contact: undefined });
  await recordEvent(ctx, {
    companyId: company._id,
    type: "assignment.checked_in",
    actor,
    subject: { table: "assignments", id: assignment._id },
    data: { jobId: job._id, cleanerId: cleaner._id, withPosition: at.lat !== undefined, minutesAfterStart: Math.round((now - job.startsAt) / MINUTE) },
  });
  if (job.status === "scheduled") {
    await ctx.db.patch(job._id, { status: "in_progress" });
    await recordEvent(ctx, { companyId: company._id, type: "job.in_progress", actor, subject: { table: "jobs", id: job._id }, data: { from: "scheduled", by: "check_in" } });
  }
  const waiting = await liveTaskByKey(ctx, company._id, noCheckInKey(assignment._id));
  if (waiting) await setTaskState(ctx, waiting, "done", { outcome: `${cleaner.name} checked in at ${clock(now, company.timezone)}.`, closedAt: now, withPersonSince: null }, DISPATCH);

  const policy = dispatchPolicy(company);
  if (policy.sendBeforePhotoLink) {
    await queueMessage(ctx, {
      companyId: company._id,
      purpose: "before_photos",
      cleaner,
      jobId: job._id,
      assignmentId: assignment._id,
      link: await liveLink(ctx, assignment, "job"),
      linkPath: "/photos",
      body: beforePhotosSms({ company, count: policy.beforePhotosRequired }),
      dedupeKey: `before_photos:${assignment._id}`,
      actor: SYSTEM,
    });
  }
  await coverJob(ctx, job._id);
  return { status: "checked_in", at: now };
}

// ── Delay and downstream work ────────────────────────────────────────────────────────────────────

export type Affected = { jobId: Id<"jobs">; assignmentId: Id<"assignments">; startsAt: number; shortByMinutes: number };

/** The cleaner's later accepted jobs that start before they can be free, counting the company's time between jobs. */
export async function affectedLaterJobs(ctx: QueryCtx | MutationCtx, loaded: Pick<Loaded, "assignment" | "job" | "company">, freeAt: number): Promise<Affected[]> {
  const { assignment, job, company } = loaded;
  const buffer = dispatchSettings(company).travelBufferMinutes * MINUTE;
  const rows = await ctx.db
    .query("assignments")
    .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", company._id).eq("cleanerId", assignment.cleanerId).eq("status", "accepted"))
    .take(200);
  const out: Affected[] = [];
  for (const row of rows) {
    if (row._id === assignment._id) continue;
    const other = await ctx.db.get(row.jobId);
    if (!other || other.status !== "scheduled" || other.startsAt <= job.startsAt) continue;
    const latest = arrivalEndsAt(other);
    if (freeAt + buffer > latest) out.push({ jobId: other._id, assignmentId: row._id, startsAt: other.startsAt, shortByMinutes: Math.ceil((freeAt + buffer - latest) / MINUTE) });
  }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

async function raiseDownstream(ctx: MutationCtx, loaded: Loaded, affected: Affected[], cause: string) {
  if (affected.length === 0) return;
  const { assignment, company, cleaner } = loaded;
  const list = affected.map((row) => `the ${clock(row.startsAt, company.timezone)} visit (about ${row.shortByMinutes} minutes short)`).join(", ");
  const question = `${cause} ${cleaner.name} will not reach ${list} on time. For each: find cover, move it, or tell the customer and keep it. Dispatch has changed nothing.`.slice(0, 1000);
  const existing = await liveTaskByKey(ctx, company._id, delayKey(assignment._id));
  if (existing) {
    await setTaskState(ctx, existing, "needs_decision", { openQuestion: question, dueAt: affected[0].startsAt }, DISPATCH, { sameStatus: true });
    return;
  }
  const taskId = await openTask(ctx, {
    companyId: company._id,
    agent: "dispatch",
    title: `Later visits affected: ${cleaner.name} is running behind`,
    nextAction: "Decide what to do about the later visits",
    dueAt: affected[0].startsAt,
    completionCondition: "Every affected later visit is covered, moved, or confirmed with its customer",
    about: { table: "assignments", id: assignment._id },
    key: delayKey(assignment._id),
    actor: DISPATCH,
  });
  await ctx.db.patch(taskId, { trigger: cause, escalation: "If nobody decides before the first affected visit starts, it is treated as at risk and shown on Live Jobs." });
  await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: question, dueAt: affected[0].startsAt }, DISPATCH);
}

/**
 * The cleaner says they will be late. The delay and the ETA are recorded as they said them; the later
 * jobs they can no longer reach are worked out; a customer update is drafted for a person to send.
 */
export async function reportDelay(ctx: MutationCtx, assignmentId: Id<"assignments">, input: { etaMinutes: number; reason?: string }, actor: Actor) {
  const loaded = await liveAssignment(ctx, assignmentId);
  const { assignment, job, company, cleaner } = loaded;
  if (assignment.checkIn) throw userError("You are already checked in for this job.");
  if (!Number.isInteger(input.etaMinutes) || input.etaMinutes < 1 || input.etaMinutes > 8 * 60) throw userError("Give your ETA in minutes, from 1 to 480.");
  const reason = input.reason?.trim().slice(0, 500) || undefined;
  const now = Date.now();
  const etaAt = now + input.etaMinutes * MINUTE;
  await ctx.db.patch(assignment._id, { late: { reportedAt: now, etaAt, reason }, contact: undefined });
  await recordEvent(ctx, { companyId: company._id, type: "assignment.delay_reported", actor, subject: { table: "assignments", id: assignment._id }, data: { jobId: job._id, cleanerId: cleaner._id, etaAt, minutesPastWindow: Math.max(0, Math.round((etaAt - arrivalEndsAt(job)) / MINUTE)) } });

  const waiting = await liveTaskByKey(ctx, company._id, noCheckInKey(assignment._id));
  if (waiting) await setTaskState(ctx, waiting, "done", { outcome: `${cleaner.name} answered: arriving about ${clock(etaAt, company.timezone)}.`, closedAt: now, withPersonSince: null }, DISPATCH);

  const pastWindow = etaAt > arrivalEndsAt(job);
  if (pastWindow) {
    const customer = await ctx.db.get(job.customerId);
    await handOff(ctx, {
      companyId: company._id,
      to: "customer_care",
      key: `customer_care.delay:${assignment._id}:${job.startsAt}`,
      title: `Tell ${customer?.name ?? "the customer"} their cleaner is running late`,
      question: `${cleaner.name} expects to arrive about ${clock(etaAt, company.timezone)} for the visit due ${arrivalWords(job, company.timezone)}. Draft: "Your cleaner is running behind and expects to arrive around ${clock(etaAt, company.timezone)}. We're sorry for the wait." Send it, or call them.`,
      trigger: "A cleaner reported a delay past the arrival window.",
      completionCondition: "The customer has been told, or a person decided not to",
      escalation: "Dispatch does not message customers here. If nobody acts, the customer has not been told.",
      dueAt: arrivalEndsAt(job),
      about: { table: "jobs", id: job._id },
      actor: DISPATCH,
    });
  }
  const freeAt = etaAt + (job.endsAt - job.startsAt);
  const affected = await affectedLaterJobs(ctx, loaded, freeAt);
  await raiseDownstream(ctx, loaded, affected, `${cleaner.name} reported a delay.`);
  return { etaAt, affected: affected.length, pastWindow };
}

// ── Leaving a job ────────────────────────────────────────────────────────────────────────────────

async function vacate(ctx: MutationCtx, loaded: Loaded, cause: "drop" | "no_show", reason: string, actor: Actor) {
  const { assignment, job, company, cleaner } = loaded;
  const dropped = cause === "drop";
  // Ending the assignment closes its links in the same step, so the outgoing cleaner's access is gone at once.
  await endAssignment(ctx, assignment, "cancelled", actor, {
    endReason: dropped ? `The cleaner said they cannot attend: ${reason}` : `No-show: ${reason}`,
    endCause: dropped ? "dropped" : "no_show",
    data: { cause: dropped ? "dropped" : "no_show" },
  });
  const deadline = job.hardDeadlineAt ? ` The service must be finished by ${whenWords(job.hardDeadlineAt, company.timezone)}.` : "";
  await openCoverageRequest(ctx, { job, from: assignment, cause, detail: `${reason}${deadline}`.slice(0, 1000), actor });
  if (!dropped && cleaner.phone) {
    await queueMessage(ctx, { companyId: company._id, purpose: "assignment_ended", cleaner, jobId: job._id, assignmentId: assignment._id, body: endedSms({ company, job }), dedupeKey: `ended:${assignment._id}`, actor: SYSTEM });
  }
  for (const key of [noCheckInKey(assignment._id), delayKey(assignment._id)]) {
    const task = await liveTaskByKey(ctx, company._id, key);
    if (task) await setTaskState(ctx, task, "done", { outcome: dropped ? `${cleaner.name} said they cannot attend. Cover is being arranged.` : `Recorded as a no-show. Cover is being arranged.`, closedAt: Date.now(), withPersonSince: null }, DISPATCH);
  }
  await coverJob(ctx, job._id);
}

/** The cleaner says they cannot come. The place is open again and cover starts in the same step. */
export async function cannotAttend(ctx: MutationCtx, assignmentId: Id<"assignments">, reason: string, actor: Actor) {
  const loaded = await liveAssignment(ctx, assignmentId);
  if (loaded.assignment.checkIn) throw userError("You are already checked in. Use the job page to report what is unfinished.");
  const why = reason.trim();
  if (why.length < 3) throw userError("Say briefly what happened.");
  await vacate(ctx, loaded, "drop", why.slice(0, 500), actor);
  return { status: "released" as const };
}

/** The conditions for a no-show, read from the record. `missing` says which are not met yet. */
export function noShowConditions(assignment: Doc<"assignments">, job: Doc<"jobs">, policy: DispatchPolicy, now: number, contactText: Doc<"messages"> | null) {
  const missing: string[] = [];
  if (assignment.checkIn) missing.push("the cleaner checked in");
  if (assignment.late && now < assignment.late.etaAt + policy.contactAfterMinutes * MINUTE) missing.push("the cleaner gave an ETA that has not passed");
  if (!assignment.contact) missing.push("the cleaner has not been asked yet");
  else if (assignment.contact.alertedAt === undefined) missing.push("the operator has not been alerted yet");
  if (now < arrivalEndsAt(job) + policy.noShowAfterMinutes * MINUTE) missing.push(`${policy.noShowAfterMinutes} minutes have not passed since the arrival window closed`);
  // A text that did not go is not an unanswered text.
  const reached = contactText !== null && (contactText.status === "sent" || contactText.status === "delivered");
  return { met: missing.length === 0, missing, reached };
}

export async function declareNoShow(ctx: MutationCtx, assignmentId: Id<"assignments">, actor: Actor, note?: string) {
  const loaded = await liveAssignment(ctx, assignmentId);
  if (loaded.assignment.checkIn) throw userError("This cleaner checked in, so this is not a no-show.");
  await vacate(ctx, loaded, "no_show", note?.trim().slice(0, 500) || "No check-in and no answer after the contact steps.", actor);
}

async function watchArrival(ctx: MutationCtx, loaded: Loaded, policy: DispatchPolicy, now: number) {
  const { assignment, job, company, cleaner } = loaded;
  if (assignment.checkIn) return;
  // A communicated delay is not silence. The steps start again only once the ETA they gave has passed.
  const from = assignment.late ? Math.max(arrivalEndsAt(job), assignment.late.etaAt) : arrivalEndsAt(job);
  const since = now - from;
  const contact = assignment.contact;
  const nudgeKey = `check_in_nudge:${assignment._id}:${from}`;

  if (!contact) {
    if (since < policy.contactAfterMinutes * MINUTE) return;
    // Asking the cleaner is the first step. Paused means Dispatch sends nothing, and the step is recorded as not taken.
    const paused = company.pausedAgents.includes("dispatch");
    if (!paused) {
      await queueMessage(ctx, { companyId: company._id, purpose: "check_in_nudge", cleaner, jobId: job._id, assignmentId: assignment._id, link: await liveLink(ctx, assignment, "job"), linkPath: "/delay", body: checkInNudgeSms({ company, job }), dedupeKey: nudgeKey, actor: DISPATCH });
    }
    await ctx.db.patch(assignment._id, { contact: { stage: "contacted", contactedAt: now } });
    await recordEvent(ctx, { companyId: company._id, type: "assignment.no_check_in_contacted", actor: DISPATCH, subject: { table: "assignments", id: assignment._id }, data: { jobId: job._id, cleanerId: cleaner._id, textQueued: !paused } });
    return;
  }

  const text = await messageByKey(ctx, company._id, nudgeKey);
  const textWords = !text ? "No text was sent (Dispatch was paused)." : text.status === "delivered" ? "The text asking them was delivered." : text.status === "sent" ? "The text asking them was sent; delivery is not confirmed." : `The text asking them did not go: ${text.problem ?? text.status}.`;

  if (contact.stage === "contacted") {
    if (since < policy.alertAfterMinutes * MINUTE) return;
    const customer = await ctx.db.get(job.customerId);
    const question = `${cleaner.name} has not checked in for ${customer?.name ?? "a customer"}'s visit due ${arrivalWords(job, company.timezone)}. ${textWords} Call ${cleaner.name}. The customer has been waiting since ${clock(arrivalEndsAt(job), company.timezone)}. This is not yet a no-show.`;
    const taskId = await openTask(ctx, {
      companyId: company._id,
      agent: "dispatch",
      title: `No check-in: ${cleaner.name}, ${arrivalWords(job, company.timezone)}`,
      nextAction: "Reach the cleaner",
      dueAt: from + policy.noShowAfterMinutes * MINUTE,
      completionCondition: "The cleaner checked in or gave an ETA, or a no-show was declared and cover started",
      about: { table: "assignments", id: assignment._id },
      key: noCheckInKey(assignment._id),
      actor: DISPATCH,
    });
    await ctx.db.patch(taskId, { trigger: "No check-in after the arrival window closed, and no answer to the text.", escalation: `After ${policy.noShowAfterMinutes} minutes a no-show can be declared and cover started.` });
    await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: question.slice(0, 1000), dueAt: from + policy.noShowAfterMinutes * MINUTE }, DISPATCH);
    await ctx.db.patch(assignment._id, { contact: { ...contact, stage: "operator_alerted", alertedAt: now } });
    await recordEvent(ctx, { companyId: company._id, type: "assignment.no_check_in_alerted", actor: DISPATCH, subject: { table: "assignments", id: assignment._id }, data: { jobId: job._id, cleanerId: cleaner._id, customerWaitingSince: arrivalEndsAt(job) } });
    return;
  }

  if (contact.stage === "operator_alerted") {
    const conditions = noShowConditions(assignment, job, policy, now, text);
    if (!conditions.met) return;
    const authority = await authorityFor(ctx, company._id, DECLARE_NO_SHOW);
    const may = authority.kind === "level" && (authority.level === "execute" || authority.level === "execute_and_report");
    // Dispatch declares it only when allowed and only when the cleaner was actually reached. Otherwise a person confirms.
    if (may && conditions.reached) {
      await declareNoShow(ctx, assignment._id, DISPATCH);
      return;
    }
    await ctx.db.patch(assignment._id, { contact: { ...contact, stage: "no_show_suspected", suspectedAt: now } });
    await recordEvent(ctx, { companyId: company._id, type: "assignment.no_show_suspected", actor: DISPATCH, subject: { table: "assignments", id: assignment._id }, data: { jobId: job._id, cleanerId: cleaner._id, reached: conditions.reached } });
    const task = await liveTaskByKey(ctx, company._id, noCheckInKey(assignment._id));
    if (task) {
      const question = `${cleaner.name} still has not checked in, ${policy.noShowAfterMinutes} minutes after the arrival window closed. ${textWords} Confirm the no-show to start cover, or record that they are coming.`;
      await setTaskState(ctx, task, "needs_decision", { openQuestion: question.slice(0, 1000), dueAt: now }, DISPATCH, { sameStatus: true });
    }
  }
}

async function watchOverrun(ctx: MutationCtx, loaded: Loaded, now: number) {
  const { assignment, job, cleaner } = loaded;
  if (!assignment.checkIn || assignment.completion || now <= job.endsAt) return;
  const affected = await affectedLaterJobs(ctx, loaded, now);
  await raiseDownstream(ctx, loaded, affected, `${cleaner.name} is still on the earlier visit past its end time.`);
}

/** Looks at one job's accepted crew: reminder due, arrival overdue, running over. Safe to run again. */
export async function watchJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job || job.migration?.held || (job.status !== "scheduled" && job.status !== "in_progress")) return;
  const company = await ctx.db.get(job.companyId);
  if (!company) return;
  const policy = dispatchPolicy(company);
  const now = Date.now();
  for (const row of await jobAssignments(ctx, job)) {
    if (row.status !== "accepted") continue;
    const assignment = (await ctx.db.get(row._id))!;
    if (assignment.status !== "accepted") continue;
    const cleaner = await ctx.db.get(assignment.cleanerId);
    if (!cleaner) continue;
    const loaded = { assignment, job, company, cleaner };
    await remind(ctx, loaded, policy, now);
    await watchArrival(ctx, { ...loaded, assignment: (await ctx.db.get(assignment._id))! }, policy, now);
    const after = await ctx.db.get(assignment._id);
    if (after && after.status === "accepted") await watchOverrun(ctx, { ...loaded, assignment: after }, now);
  }
}

// ── Completion ───────────────────────────────────────────────────────────────────────────────────

export async function jobChecklist(ctx: QueryCtx | MutationCtx, job: Pick<Doc<"jobs">, "_id" | "companyId">): Promise<Doc<"checklistItems">[]> {
  return ctx.db
    .query("checklistItems")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(300);
}

export async function jobEvidence(ctx: QueryCtx | MutationCtx, job: Pick<Doc<"jobs">, "_id" | "companyId">): Promise<Doc<"evidence">[]> {
  return ctx.db
    .query("evidence")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(500);
}

/** What still stands between this cleaner and submitting the job as done. Empty means nothing. */
export async function completionGaps(ctx: QueryCtx | MutationCtx, loaded: Pick<Loaded, "assignment" | "job" | "company">): Promise<string[]> {
  const { assignment, job, company } = loaded;
  const policy = dispatchPolicy(company);
  const gaps: string[] = [];
  if (!assignment.checkIn) gaps.push("Check in first.");
  const items = await jobChecklist(ctx, job);
  const pending = items.filter((item) => item.state === "pending").length;
  if (pending > 0) gaps.push(`${pending} checklist ${pending === 1 ? "item is" : "items are"} not done or skipped.`);
  const evidence = await jobEvidence(ctx, job);
  const before = evidence.filter((row) => row.kind === "before").length;
  const after = evidence.filter((row) => row.kind === "after").length;
  if (before < policy.beforePhotosRequired) gaps.push(`${policy.beforePhotosRequired - before} more before ${policy.beforePhotosRequired - before === 1 ? "photo" : "photos"} needed.`);
  if (after < policy.afterPhotosRequired) gaps.push(`${policy.afterPhotosRequired - after} more after ${policy.afterPhotosRequired - after === 1 ? "photo" : "photos"} needed.`);
  for (const item of items) {
    if (item.requiresPhoto && item.state === "done" && !evidence.some((row) => row.checklistItemId === item._id)) gaps.push(`"${item.label}" needs a photo.`);
  }
  return gaps;
}

export const reviewKey = (jobId: Id<"jobs">) => `quality.review:${jobId}`;

/**
 * The cleaner reports the job done, or done with something left. This is a report. The visit goes to
 * Quality for review; the job is not closed, nothing is approved, and no payment or payout follows from it.
 */
export async function submitCompletion(ctx: MutationCtx, assignmentId: Id<"assignments">, input: { incomplete: boolean; note?: string }, actor: Actor) {
  const loaded = await liveAssignment(ctx, assignmentId);
  const { assignment, job, company, cleaner } = loaded;
  if (assignment.completion) return { status: "already_submitted" as const, submittedAt: assignment.completion.submittedAt };
  const note = input.note?.trim().slice(0, 1000) || undefined;
  if (!assignment.checkIn) throw userError("Check in before you submit the job.");
  if (input.incomplete) {
    if (!note || note.length < 3) throw userError("Say what could not be finished.");
  } else {
    const gaps = await completionGaps(ctx, loaded);
    if (gaps.length > 0) throw userError(`Not ready to submit. ${gaps.join(" ")} If something cannot be finished, submit it as incomplete and say why.`);
  }
  const now = Date.now();
  await ctx.db.patch(assignment._id, { completion: { submittedAt: now, incomplete: input.incomplete, note } });
  await recordEvent(ctx, { companyId: company._id, type: "assignment.completion_submitted", actor, subject: { table: "assignments", id: assignment._id }, data: { jobId: job._id, cleanerId: cleaner._id, incomplete: input.incomplete } });
  if (input.incomplete && note) {
    await ctx.db.insert("jobReports", { companyId: company._id, jobId: job._id, assignmentId: assignment._id, cleanerId: cleaner._id, kind: "incomplete", text: note, status: "awaiting_decision", createdAt: now });
  }

  // The visit goes to review once everyone who is on it has reported. A crew member who has not is named.
  const crew = (await jobAssignments(ctx, job)).filter((row) => row.status === "accepted");
  const waitingOn = crew.filter((row) => row._id !== assignment._id && !row.completion);
  if (waitingOn.length === 0) {
    await ctx.db.patch(job._id, { completionReportedAt: now });
    await recordEvent(ctx, { companyId: company._id, type: "job.completion_reported", actor, subject: { table: "jobs", id: job._id }, data: { crew: crew.length } });
    const items = await jobChecklist(ctx, job);
    const evidence = await jobEvidence(ctx, job);
    const skipped = items.filter((item) => item.state === "skipped").length;
    const exceptions = crew.filter((row) => row._id === assignment._id ? input.incomplete : row.completion?.incomplete).length;
    const customer = await ctx.db.get(job.customerId);
    await handOff(ctx, {
      companyId: company._id,
      to: "quality",
      key: reviewKey(job._id),
      title: `Review the completed visit for ${customer?.name ?? "a customer"} on ${whenWords(job.startsAt, company.timezone)}`,
      question:
        `The crew reported this visit complete. Checklist: ${items.filter((item) => item.state === "done").length} done, ${skipped} skipped, of ${items.length}. ` +
        `Photos: ${evidence.filter((row) => row.kind === "before").length} before, ${evidence.filter((row) => row.kind === "after").length} after. ` +
        `${exceptions > 0 ? `${exceptions} crew ${exceptions === 1 ? "member" : "members"} reported work left unfinished. ` : ""}Review it, then close the visit or send it back. Nothing has been approved or paid.`,
      trigger: "Every cleaner on the visit submitted completion.",
      completionCondition: "A person reviewed the evidence and closed the visit or arranged corrective work",
      escalation: "The visit stays open and unpaid until someone reviews it.",
      dueAt: now + 24 * 60 * MINUTE,
      about: { table: "jobs", id: job._id },
      actor: DISPATCH,
    });
  }
  return { status: "submitted_for_review" as const, submittedAt: now, waitingOnCrew: waitingOn.length };
}
