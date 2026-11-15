/**
 * Interview coordination. An interview is "confirmed" only when a slot has actually been reserved: in
 * Selestial's own slots, and in the interviewer's calendar when one is connected. With no times to
 * offer, a person gets a scheduling task; nothing is made up.
 *
 * A slot is one interviewer's one stretch of time. Booking is a single transaction that re-reads the
 * slot and every other booking of that interviewer, so two applicants picking the same time cannot both
 * get it. Nothing here records or transcribes an interview.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { CarriedOut } from "../dispatch/workflow";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { when } from "../time";
import { askPerson, isActive, RECRUITER, setNextAction, setStage, settleTask, SYSTEM } from "./applications";
import { calendarProvider } from "./calendar";
import { issueApplicantLink, liveApplicantLink } from "./links";
import { queueApplicantMessage } from "./outbox";
import { DAY, HOUR, recruiterSettings } from "./settings";
import { interviewConfirmationEmail, interviewInvitationEmail, interviewReminderEmail, interviewReminderText, partsFor } from "./words";

export const RUN_INTERVIEW = "recruiter.run_interview";
const MAX_RESCHEDULES = 3;
const NOTICE = HOUR;

type Loaded = { interview: Doc<"interviews">; application: Doc<"applications">; applicant: Doc<"applicants">; company: Doc<"companies">; need: Doc<"hiringNeeds"> };

async function load(ctx: QueryCtx | MutationCtx, interviewId: Id<"interviews">): Promise<Loaded | null> {
  const interview = await ctx.db.get(interviewId);
  const application = interview ? await ctx.db.get(interview.applicationId) : null;
  const applicant = application ? await ctx.db.get(application.applicantId) : null;
  const company = application ? await ctx.db.get(application.companyId) : null;
  const need = application?.needId ? await ctx.db.get(application.needId) : null;
  return interview && application && applicant && company && need ? { interview, application, applicant, company, need } : null;
}

export async function liveInterview(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">): Promise<Doc<"interviews"> | null> {
  const rows = await ctx.db
    .query("interviews")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .order("desc")
    .take(20);
  return rows.find((row) => row.status === "awaiting_slots" || row.status === "proposed" || row.status === "reserving" || row.status === "confirmed") ?? null;
}

/** The times an applicant can be offered: open, far enough ahead, and not across another booking of the same interviewer. */
export async function openSlots(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, now: number): Promise<Doc<"interviewSlots">[]> {
  const rows = await ctx.db
    .query("interviewSlots")
    .withIndex("by_company_start", (q) => q.eq("companyId", companyId).gt("startsAt", now + NOTICE))
    .take(300);
  const booked = rows.filter((row) => row.status === "booked");
  return rows.filter((row) => row.status === "open" && !booked.some((other) => other.interviewerId === row.interviewerId && other.startsAt < row.endsAt && row.startsAt < other.endsAt)).slice(0, 40);
}

async function send(ctx: MutationCtx, loaded: Loaded, purpose: "interview_invitation" | "interview_confirmation" | "interview_reminder", email: { subject: string; body: string }, dedupeKey: string, actor: Actor, immediate: boolean) {
  const settings = recruiterSettings(loaded.company);
  const link = await issueApplicantLink(ctx, { application: loaded.application, purpose: "interview", expiresAt: Date.now() + settings.linkTtlDays * DAY, actor });
  return queueApplicantMessage(ctx, { company: loaded.company, application: loaded.application, applicant: loaded.applicant, purpose, channel: "email", subject: email.subject, body: email.body, link, dedupeKey, actor, immediate });
}

/** Emails the applicant the page where they choose a time. */
export async function sendInterviewInvite(ctx: MutationCtx, interviewId: Id<"interviews">, actor: Actor): Promise<CarriedOut> {
  const loaded = await load(ctx, interviewId);
  if (!loaded || !isActive(loaded.application)) return { ok: false, detail: "The application has ended." };
  const { interview, application, applicant, company, need } = loaded;
  if (interview.status !== "awaiting_slots" && interview.status !== "proposed") return { ok: false, detail: `The interview is already ${interview.status}.` };
  if ((await openSlots(ctx, company._id, Date.now())).length === 0) return { ok: false, detail: "There are no open interview times to offer." };
  const settings = recruiterSettings(company);
  const message = await send(ctx, loaded, "interview_invitation", interviewInvitationEmail(partsFor(company, settings.fromName, applicant, need.title)), `interview-invite:${interview._id}`, actor, false);
  if (message.status === "not_sent") return { ok: false, detail: message.problem ?? "The invitation could not be sent." };
  await ctx.db.patch(interview._id, { status: "proposed" });
  await settleTask(ctx, application, "interview", "The applicant was asked to choose a time.");
  await setNextAction(ctx, application, { what: "Choose an interview time", by: "applicant", dueAt: Date.now() + settings.linkTtlDays * DAY });
  return { ok: true, detail: "The applicant was emailed the times to choose from." };
}

/** A person approved interviewing this applicant. Offers times if there are any; otherwise asks a person to schedule. */
export async function startInterview(ctx: MutationCtx, application: Doc<"applications">, actor: Actor): Promise<Id<"interviews">> {
  const existing = await liveInterview(ctx, application);
  if (existing) return existing._id;
  const company = (await ctx.db.get(application.companyId))!;
  const applicant = await ctx.db.get(application.applicantId);
  const who = applicant?.name ?? "the applicant";
  const interviewId = await ctx.db.insert("interviews", { companyId: application.companyId, applicationId: application._id, status: "awaiting_slots", reschedules: 0, createdAt: Date.now() });
  await recordEvent(ctx, { companyId: application.companyId, type: "interview.requested", actor, subject: { table: "interviews", id: interviewId }, data: { applicationId: application._id } });
  const settings = recruiterSettings(company);
  const slots = await openSlots(ctx, company._id, Date.now());
  const authority = await authorityFor(ctx, company._id, RUN_INTERVIEW);
  const mayAct = authority.kind === "level" && authority.level !== "off";
  if (slots.length === 0 || !mayAct) {
    // No time can be offered. A person schedules; nothing is shown as confirmed until a time is really reserved.
    const why = slots.length === 0 ? "There are no open interview times." : "Recruiter may not coordinate interviews.";
    await setNextAction(ctx, application, { what: `${why} Add times for applicants to choose from, or schedule ${who} yourself.`, by: "owner", dueAt: Date.now() + 2 * DAY });
    await askPerson(ctx, application, { what: "interview", title: `Schedule an interview with ${who}`, question: `${why} Add interview times and Recruiter will offer them, or set the time yourself. No interview is confirmed yet.`, dueAt: Date.now() + 2 * DAY, completionCondition: "An interview time is reserved, or the interview was cancelled" });
    return interviewId;
  }
  if (authority.level !== "propose" || actor.kind === "member") {
    // A person who just chose to interview this applicant has authorized asking them for a time.
    await sendInterviewInvite(ctx, interviewId, actor);
    return interviewId;
  }
  const decideBy = Date.now() + settings.decideWithinHours * HOUR;
  await requestApproval(ctx, {
    companyId: company._id,
    action: RUN_INTERVIEW,
    summary: `Ask ${who} to choose an interview time`,
    reason: `An interview was approved and ${slots.length} time${slots.length === 1 ? " is" : "s are"} open.`,
    authorizes: "One email with a page of open times, then the confirmation and one reminder for the time they choose. Nothing else.",
    ifWaiting: "Nothing is sent and no interview is scheduled.",
    decideBy,
    proposal: { kind: "invite_to_interview", interviewId },
    about: { table: "applications", id: application._id },
  });
  await setNextAction(ctx, application, { what: "Approve asking the applicant to choose an interview time", by: "owner", dueAt: decideBy });
  return interviewId;
}

export async function afterInterviewInviteDecision(ctx: MutationCtx, interviewId: Id<"interviews">, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  if (decision === "approved") return sendInterviewInvite(ctx, interviewId, decidedBy);
  const loaded = await load(ctx, interviewId);
  if (loaded && isActive(loaded.application)) await setNextAction(ctx, loaded.application, { what: "You chose not to send Recruiter's interview invitation. Schedule the interview yourself, or cancel it.", by: "owner", dueAt: Date.now() + 2 * DAY });
  return null;
}

async function releaseSlot(ctx: MutationCtx, interview: Doc<"interviews">) {
  if (!interview.slotId) return;
  const slot = await ctx.db.get(interview.slotId);
  if (slot && slot.interviewId === interview._id) await ctx.db.patch(slot._id, { status: slot.status === "cancelled" ? "cancelled" : "open", interviewId: undefined });
  if (interview.calendarEventId && interview.interviewerId) await ctx.scheduler.runAfter(0, internal.interviews.releaseCalendar, { interviewerId: interview.interviewerId, eventId: interview.calendarEventId });
}

async function confirm(ctx: MutationCtx, interviewId: Id<"interviews">, actor: Actor, calendarEventId?: string): Promise<void> {
  const loaded = await load(ctx, interviewId);
  if (!loaded || !loaded.interview.startsAt) return;
  const { interview, application, applicant, company, need } = loaded;
  await ctx.db.patch(interview._id, { status: "confirmed", calendarEventId, reminderQueuedAt: undefined });
  await recordEvent(ctx, { companyId: company._id, type: "interview.confirmed", actor, subject: { table: "interviews", id: interview._id }, data: { applicationId: application._id, startsAt: interview.startsAt! } });
  const settings = recruiterSettings(company);
  const at = when(interview.startsAt!, Date.now(), company.timezone);
  await send(ctx, loaded, "interview_confirmation", interviewConfirmationEmail({ ...partsFor(company, settings.fromName, applicant, need.title), when: `${at} (${company.timezone})`, how: interview.how }), `interview-confirm:${interview._id}:${interview.startsAt}`, actor, true);
  await settleTask(ctx, application, "interview", "An interview time is reserved.");
  await setNextAction(ctx, application, { what: `Interview ${at}. Record how it went afterwards.`, by: "owner", dueAt: interview.endsAt });
}

/**
 * Reserves a slot for an interview, replacing the one it had. One transaction: if anyone else took the
 * slot, or the interviewer has another booking across it, this fails and nothing changes.
 */
export async function bookSlot(ctx: MutationCtx, interviewId: Id<"interviews">, slotId: Id<"interviewSlots">, actor: Actor): Promise<{ status: "confirmed" | "reserving" }> {
  const loaded = await load(ctx, interviewId);
  if (!loaded || !isActive(loaded.application)) throw userError("This interview is no longer open.");
  const { interview, company } = loaded;
  if (interview.status !== "proposed" && interview.status !== "confirmed" && interview.status !== "awaiting_slots") throw userError("This interview cannot be scheduled right now.");
  const slot = await ctx.db.get(slotId);
  const now = Date.now();
  if (!slot || slot.companyId !== company._id || slot.status !== "open" || slot.startsAt <= now) throw userError("That time is no longer available. Please choose another.");
  const others = await ctx.db
    .query("interviewSlots")
    .withIndex("by_company_interviewer", (q) => q.eq("companyId", company._id).eq("interviewerId", slot.interviewerId).gt("startsAt", slot.startsAt - DAY))
    .take(200);
  if (others.some((row) => row._id !== slot._id && row.status === "booked" && row.interviewId !== interview._id && row.startsAt < slot.endsAt && slot.startsAt < row.endsAt)) throw userError("That time is no longer available. Please choose another.");
  const moving = interview.slotId !== undefined && interview.slotId !== slot._id;
  if (moving && interview.reschedules >= MAX_RESCHEDULES) throw userError("This interview has been moved as often as it can be. Reply to the email to arrange another time.");
  if (moving) await releaseSlot(ctx, interview);

  const calendar = calendarProvider();
  await ctx.db.patch(slot._id, { status: "booked", interviewId: interview._id });
  await ctx.db.patch(interview._id, { status: calendar ? "reserving" : interview.status, slotId: slot._id, interviewerId: slot.interviewerId, startsAt: slot.startsAt, endsAt: slot.endsAt, reschedules: interview.reschedules + (moving ? 1 : 0), calendarEventId: undefined });
  if (calendar) {
    // The slot is held, not confirmed, until the interviewer's calendar has taken it.
    await ctx.scheduler.runAfter(0, internal.interviews.reserve, { interviewId: interview._id, slotId: slot._id });
    return { status: "reserving" };
  }
  await confirm(ctx, interview._id, actor);
  return { status: "confirmed" };
}

/** The calendar answered about a held slot. */
export async function afterCalendar(ctx: MutationCtx, interviewId: Id<"interviews">, slotId: Id<"interviewSlots">, result: { ok: true; eventId: string } | { ok: false; busy: boolean }): Promise<void> {
  const interview = await ctx.db.get(interviewId);
  if (!interview || interview.status !== "reserving" || interview.slotId !== slotId) return;
  if (result.ok) return confirm(ctx, interviewId, SYSTEM, result.eventId);
  const slot = await ctx.db.get(slotId);
  // The interviewer is busy then: the slot is withdrawn so nobody else is offered it. A calendar that failed leaves the slot open.
  if (slot) await ctx.db.patch(slot._id, { status: result.busy ? "cancelled" : "open", interviewId: undefined });
  await ctx.db.patch(interview._id, { status: "proposed", slotId: undefined, startsAt: undefined, endsAt: undefined });
  const application = await ctx.db.get(interview.applicationId);
  if (application && isActive(application)) await setNextAction(ctx, application, { what: "The time they chose could not be reserved. Choose another interview time.", by: "applicant", dueAt: Date.now() + 3 * DAY });
}

/** The applicant, or a person, cancelled the time. The slot opens again. */
export async function cancelInterviewTime(ctx: MutationCtx, interviewId: Id<"interviews">, actor: Actor, reason: string): Promise<void> {
  const loaded = await load(ctx, interviewId);
  if (!loaded || (loaded.interview.status !== "confirmed" && loaded.interview.status !== "reserving")) throw userError("There is no scheduled interview to cancel.");
  const { interview, application, applicant } = loaded;
  await releaseSlot(ctx, interview);
  await ctx.db.patch(interview._id, { status: "proposed", slotId: undefined, startsAt: undefined, endsAt: undefined, calendarEventId: undefined, cancelReason: reason.slice(0, 500) });
  await recordEvent(ctx, { companyId: application.companyId, type: "interview.time_cancelled", actor, subject: { table: "interviews", id: interview._id }, data: { applicationId: application._id } });
  if (!isActive(application)) return;
  await setNextAction(ctx, application, { what: `${applicant.name ?? "The applicant"} cancelled their interview time and has not chosen another.`, by: "owner", dueAt: Date.now() + 2 * DAY });
}

/** A person set the time themselves. The same double-booking check applies. */
export async function scheduleByPerson(ctx: MutationCtx, interviewId: Id<"interviews">, input: { interviewerId: Id<"members">; startsAt: number; endsAt: number; how?: string }, actor: Actor): Promise<void> {
  const loaded = await load(ctx, interviewId);
  if (!loaded || !isActive(loaded.application)) throw userError("This interview is no longer open.");
  if (input.endsAt <= input.startsAt || input.startsAt <= Date.now()) throw userError("Choose a time in the future, with an end after its start.");
  const slotId = await ctx.db.insert("interviewSlots", { companyId: loaded.company._id, interviewerId: input.interviewerId, startsAt: input.startsAt, endsAt: input.endsAt, status: "open" });
  if (input.how) await ctx.db.patch(interviewId, { how: input.how.slice(0, 500) });
  try {
    await bookSlot(ctx, interviewId, slotId, actor);
  } catch (error) {
    await ctx.db.delete(slotId);
    throw error;
  }
}

/** Run on a schedule: one reminder before each confirmed interview. */
export async function reminderSweep(ctx: MutationCtx, now: number): Promise<number> {
  const upcoming = await ctx.db
    .query("interviews")
    .withIndex("by_status_start", (q) => q.eq("status", "confirmed").gt("startsAt", now))
    .take(300);
  let sent = 0;
  for (const interview of upcoming) {
    const loaded = await load(ctx, interview._id);
    if (!loaded || !interview.startsAt || interview.reminderQueuedAt || !isActive(loaded.application)) continue;
    const settings = recruiterSettings(loaded.company);
    if (interview.startsAt - now > settings.interviewReminderHours * HOUR) continue;
    const authority = await authorityFor(ctx, loaded.company._id, RUN_INTERVIEW);
    if (authority.kind !== "level" || authority.level === "off") continue;
    const parts = { ...partsFor(loaded.company, settings.fromName, loaded.applicant, loaded.need.title), when: `${when(interview.startsAt, now, loaded.company.timezone)} (${loaded.company.timezone})` };
    const key = `interview-reminder:${interview._id}:${interview.startsAt}`;
    await send(ctx, loaded, "interview_reminder", interviewReminderEmail(parts), key, RECRUITER, true);
    if (loaded.applicant.smsConsent) {
      const link = await liveApplicantLink(ctx, loaded.application, "interview");
      await queueApplicantMessage(ctx, { company: loaded.company, application: loaded.application, applicant: loaded.applicant, purpose: "interview_reminder", channel: "sms", body: interviewReminderText(parts), link, dedupeKey: `${key}:sms`, actor: RECRUITER, immediate: true });
    }
    await ctx.db.patch(interview._id, { reminderQueuedAt: now });
    sent += 1;
  }
  return sent;
}

/** The interviewer's own account of how it went. This is what moves the application to a decision. */
export async function recordFeedback(ctx: MutationCtx, interviewId: Id<"interviews">, member: Doc<"members">, input: { attended: boolean; notes: string; recommendation: "advance" | "hold" | "do_not_advance" }): Promise<void> {
  const loaded = await load(ctx, interviewId);
  if (!loaded) throw userError("That interview does not exist.");
  const { interview, application, applicant } = loaded;
  if (interview.status !== "confirmed") throw userError("Feedback is recorded for a confirmed interview.");
  const actor: Actor = { kind: "member", memberId: member._id };
  await ctx.db.patch(interview._id, { status: input.attended ? "completed" : "no_show", feedback: { by: member._id, at: Date.now(), attended: input.attended, notes: input.notes.trim().slice(0, 4000), recommendation: input.recommendation } });
  await recordEvent(ctx, { companyId: application.companyId, type: input.attended ? "interview.completed" : "interview.no_show", actor, subject: { table: "interviews", id: interview._id }, data: { applicationId: application._id, recommendation: input.recommendation } });
  if (!isActive(application) || application.stage !== "interview") return;
  const who = applicant.name ?? "the applicant";
  const dueAt = Date.now() + 2 * DAY;
  const staged = await setStage(ctx, application, "decision_pending", actor, { nextAction: { what: `Decide on ${who}: make an offer, interview again, hold, or turn down`, by: "owner", dueAt } });
  await askPerson(ctx, staged, { what: "decision", title: `Decide on ${who}`, question: `${input.attended ? "The interview happened" : `${who} did not attend the interview`}. The interviewer's recommendation: ${input.recommendation.replace(/_/g, " ")}. Make an offer, interview again, hold, or turn the applicant down.`, dueAt, completionCondition: "A person decided on this applicant" });
}
