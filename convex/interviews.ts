/**
 * Interviews, as a person works them: the times interviewers are free, what is proposed and confirmed,
 * a time set by hand, and how each interview went. The calendar steps at the bottom are internal.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { calendarProvider } from "./lib/recruiter/calendar";
import { afterCalendar, cancelInterviewTime, openSlots, recordFeedback, scheduleByPerson, sendInterviewInvite } from "./lib/recruiter/interviews";
import { recruiterSettings } from "./lib/recruiter/settings";
import { instant, optionalText, text } from "./lib/text";

const MINUTE = 60_000;

/** Interviews: requests waiting for times, proposed, confirmed and done, with open times and whether a calendar is connected. */
export const board = companyQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = [];
    for (const status of ["awaiting_slots", "proposed", "reserving", "confirmed", "completed", "no_show", "cancelled"] as const) {
      const found = await ctx.db
        .query("interviews")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .order("desc")
        .take(100);
      for (const interview of found) {
        const application = await ctx.db.get(interview.applicationId);
        const applicant = application ? await ctx.db.get(application.applicantId) : null;
        const interviewer = interview.interviewerId ? await ctx.db.get(interview.interviewerId) : null;
        rows.push({ interviewId: interview._id, applicationId: interview.applicationId, applicant: applicant?.name ?? null, status: interview.status, startsAt: interview.startsAt ?? null, endsAt: interview.endsAt ?? null, interviewer: interviewer?.name ?? null, how: interview.how ?? null, reschedules: interview.reschedules, reminderQueuedAt: interview.reminderQueuedAt ?? null, feedback: interview.feedback ?? null, inCalendar: interview.calendarEventId !== undefined });
      }
    }
    const slots = await ctx.db
      .query("interviewSlots")
      .withIndex("by_company_start", (q) => q.eq("companyId", ctx.companyId).gt("startsAt", now))
      .take(300);
    return { interviews: rows, slots: slots.map((slot) => ({ slotId: slot._id, interviewerId: slot.interviewerId, startsAt: slot.startsAt, endsAt: slot.endsAt, status: slot.status })), offerable: (await openSlots(ctx, ctx.companyId, now)).length, calendar: calendarProvider()?.name ?? null, timezone: ctx.company.timezone };
  },
});

/** Adds times an interviewer is free. A stretch longer than one interview is cut into interview-length times. */
export const addSlots = managerMutation({
  args: { interviewerId: v.id("members"), startsAt: v.number(), endsAt: v.number() },
  handler: async (ctx, args) => {
    const interviewer = await owned(ctx, args.interviewerId);
    if (interviewer.status !== "active") throw userError("That person is not an active member.");
    const startsAt = instant(args.startsAt, "The start");
    const endsAt = instant(args.endsAt, "The end");
    const length = recruiterSettings(ctx.company).interviewMinutes * MINUTE;
    if (startsAt <= Date.now() || endsAt - startsAt < length || endsAt - startsAt > 12 * 60 * MINUTE) throw userError("Choose a future stretch at least one interview long, and at most 12 hours.");
    const existing = await ctx.db
      .query("interviewSlots")
      .withIndex("by_company_interviewer", (q) => q.eq("companyId", ctx.companyId).eq("interviewerId", interviewer._id).gt("startsAt", startsAt - 12 * 60 * MINUTE))
      .take(300);
    const created = [];
    for (let at = startsAt; at + length <= endsAt; at += length) {
      // A time across one this interviewer already has, open or booked, is not added twice.
      if (existing.some((slot) => slot.status !== "cancelled" && slot.startsAt < at + length && at < slot.endsAt)) continue;
      created.push(await ctx.db.insert("interviewSlots", { companyId: ctx.companyId, interviewerId: interviewer._id, startsAt: at, endsAt: at + length, status: "open" }));
    }
    // Interviews that were waiting for times can now be offered them.
    const waiting = await ctx.db
      .query("interviews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "awaiting_slots"))
      .take(50);
    if (created.length > 0) for (const interview of waiting) await sendInterviewInvite(ctx, interview._id, byMember(ctx));
    return created;
  },
});

export const removeSlot = managerMutation({
  args: { slotId: v.id("interviewSlots") },
  handler: async (ctx, args) => {
    const slot = await owned(ctx, args.slotId);
    if (slot.status === "booked") throw userError("That time is booked. Cancel the interview's time first.");
    await ctx.db.patch(slot._id, { status: "cancelled" });
    return null;
  },
});

/** A person sets the time themselves. The interviewer's other bookings are checked exactly as for a slot. */
export const schedule = managerMutation({
  args: { interviewId: v.id("interviews"), interviewerId: v.id("members"), startsAt: v.number(), endsAt: v.number(), how: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await owned(ctx, args.interviewId);
    await owned(ctx, args.interviewerId);
    await scheduleByPerson(ctx, args.interviewId, { interviewerId: args.interviewerId, startsAt: instant(args.startsAt, "The start"), endsAt: instant(args.endsAt, "The end"), how: optionalText(args.how, "How to join", 500) }, byMember(ctx));
    return null;
  },
});

export const cancelTime = managerMutation({
  args: { interviewId: v.id("interviews"), reason: v.string() },
  handler: async (ctx, args) => {
    await owned(ctx, args.interviewId);
    await cancelInterviewTime(ctx, args.interviewId, byMember(ctx), text(args.reason, "The reason", 500));
    return null;
  },
});

/** The interviewer's own notes on how it went. Nothing is recorded or transcribed by Selestial. */
export const feedback = managerMutation({
  args: { interviewId: v.id("interviews"), attended: v.boolean(), notes: v.string(), recommendation: v.union(v.literal("advance"), v.literal("hold"), v.literal("do_not_advance")) },
  handler: async (ctx, args) => {
    await owned(ctx, args.interviewId);
    await recordFeedback(ctx, args.interviewId, ctx.member, { attended: args.attended, notes: text(args.notes, "The notes", 4000), recommendation: args.recommendation });
    return null;
  },
});

// ── The interviewer's calendar ───────────────────────────────────────────────────────────────────

export const held = internalQuery({
  args: { interviewId: v.id("interviews"), slotId: v.id("interviewSlots") },
  handler: async (ctx, args) => {
    const interview = await ctx.db.get(args.interviewId);
    const slot = await ctx.db.get(args.slotId);
    if (!interview || !slot || interview.status !== "reserving" || interview.slotId !== slot._id) return null;
    const interviewer = await ctx.db.get(slot.interviewerId);
    const application = await ctx.db.get(interview.applicationId);
    const applicant = application ? await ctx.db.get(application.applicantId) : null;
    return interviewer ? { interviewerEmail: interviewer.email, startsAt: slot.startsAt, endsAt: slot.endsAt, title: `Interview: ${applicant?.name ?? "applicant"}` } : null;
  },
});

export const calendarAnswered = internalMutation({
  args: { interviewId: v.id("interviews"), slotId: v.id("interviewSlots"), result: v.union(v.object({ ok: v.literal(true), eventId: v.string() }), v.object({ ok: v.literal(false), busy: v.boolean() })) },
  handler: async (ctx, args) => {
    await afterCalendar(ctx, args.interviewId, args.slotId, args.result);
    if (!args.result.ok) {
      const interview = await ctx.db.get(args.interviewId);
      if (interview) await recordEvent(ctx, { companyId: interview.companyId, type: "interview.reservation_failed", actor: { kind: "system" }, subject: { table: "interviews", id: interview._id }, data: { busy: args.result.busy } });
    }
    return null;
  },
});

/** Asks the calendar to hold a slot that Selestial is already holding. Only its answer confirms the interview. */
export const reserve = internalAction({
  args: { interviewId: v.id("interviews"), slotId: v.id("interviewSlots") },
  handler: async (ctx, args) => {
    const hold = await ctx.runQuery(internal.interviews.held, args);
    const calendar = calendarProvider();
    if (!hold) return null;
    if (!calendar) {
      await ctx.runMutation(internal.interviews.calendarAnswered, { ...args, result: { ok: false, busy: false } });
      return null;
    }
    let result: { ok: true; eventId: string } | { ok: false; busy: boolean };
    try {
      const answer = await calendar.reserve({ ...hold, idempotencyKey: `${args.interviewId}:${args.slotId}` });
      result = answer.ok ? { ok: true, eventId: answer.eventId } : { ok: false, busy: answer.busy };
    } catch {
      result = { ok: false, busy: false };
    }
    await ctx.runMutation(internal.interviews.calendarAnswered, { ...args, result });
    return null;
  },
});

export const interviewerEmail = internalQuery({
  args: { interviewerId: v.id("members") },
  handler: async (ctx, args) => (await ctx.db.get(args.interviewerId))?.email ?? null,
});

export const releaseCalendar = internalAction({
  args: { interviewerId: v.id("members"), eventId: v.string() },
  handler: async (ctx, args) => {
    const calendar = calendarProvider();
    const email = await ctx.runQuery(internal.interviews.interviewerEmail, { interviewerId: args.interviewerId });
    if (calendar && email) await calendar.release(email, args.eventId);
    return null;
  },
});
