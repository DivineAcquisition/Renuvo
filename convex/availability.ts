/**
 * When each cleaner said they can work, as the office keeps it: weekly windows on the company's clock, date
 * exceptions, time away and confirmations. Every change can be previewed against the upcoming work it would
 * touch before it is saved. Nothing here removes anyone from a job: a clash is shown, and a person decides it
 * in Dispatch. Office reads; Owners and Managers change.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation, type MemberAccess } from "./lib/builders";
import { conflictsOf, type Absence } from "./lib/cleaners/attention";
import { cleanerTime, commitmentsBetween, exceptionSpan } from "./lib/cleaners/schedule";
import { localParts, type Span, type WeeklyWindow } from "./lib/availability";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { instant, optionalText, text } from "./lib/text";
import { addLocalDays, startOfLocalDay } from "./lib/time";

const windowValidator = v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() });
const exceptionValidator = v.object({
  date: v.string(),
  kind: v.union(v.literal("unavailable"), v.literal("available")),
  startMinute: v.optional(v.number()),
  endMinute: v.optional(v.number()),
});
type Exception = typeof exceptionValidator.type;

/** How far ahead a change is checked against booked and offered work. */
const IMPACT_DAYS = 60;

function checkWindows(windows: WeeklyWindow[]) {
  if (windows.length > 50) throw userError("That is too many windows for one week.");
  for (const window of windows) {
    const whole = [window.weekday, window.startMinute, window.endMinute].every(Number.isInteger);
    if (!whole || window.weekday < 0 || window.weekday > 6 || window.startMinute < 0 || window.endMinute > 24 * 60 || window.startMinute >= window.endMinute) {
      throw userError("Each window needs a day of the week and a start time before its end time.");
    }
  }
}

function checkException(exception: Exception, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.date)) throw userError("Choose a date.");
  if (exception.date < localParts(Date.now(), timezone).day) throw userError("Choose today or a later date.");
  if ((exception.startMinute === undefined) !== (exception.endMinute === undefined)) throw userError("Give both a start and an end, or neither for the whole day.");
  if (exception.startMinute !== undefined && exception.endMinute !== undefined) {
    const whole = Number.isInteger(exception.startMinute) && Number.isInteger(exception.endMinute);
    if (!whole || exception.startMinute < 0 || exception.endMinute > 24 * 60 || exception.startMinute >= exception.endMinute) throw userError("The start must be before the end.");
  }
}

async function weekOf(ctx: QueryCtx & MemberAccess, cleaner: Doc<"cleaners">): Promise<WeeklyWindow[]> {
  const rows = await ctx.db
    .query("availabilityWindows")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
    .take(100);
  return rows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute }));
}

export type Clash = { jobId: string; label: string; startsAt: number; status: "offered" | "accepted"; reason: string; alreadyClashing: boolean };

/**
 * Booked and offered work in the next weeks that would clash once the change is made. Work that already
 * clashes is marked, so the preview tells apart what this change causes from what was already a problem.
 */
async function clashesAfter(ctx: QueryCtx & MemberAccess, cleaner: Doc<"cleaners">, change: { windows?: WeeklyWindow[]; timeAway?: Span; exception?: Exception; removeTimeOffId?: string; removeExceptionId?: string }): Promise<Clash[]> {
  const tz = ctx.company.timezone;
  const now = Date.now();
  const today = startOfLocalDay(now, tz);
  const commitments = ((await commitmentsBetween(ctx, ctx.company, today, addLocalDays(today, IMPACT_DAYS, tz))).get(cleaner._id) ?? []).filter((row) => row.endsAt > now);
  if (commitments.length === 0) return [];
  const time = await cleanerTime(ctx, ctx.company, cleaner._id, today);
  const week = await weekOf(ctx, cleaner);

  // An offer still out for a time they will not be free is worth knowing about too, so both are checked.
  const asBooked = commitments.map((row) => ({ ...row, status: "accepted" as const }));
  const before = new Set(conflictsOf({ commitments: asBooked, absences: time.absences, windows: week, extraAvailable: time.extraAvailable, timezone: tz }).map((row) => row.commitment.assignmentId));

  const absences: Absence[] = [
    ...time.timeOff.filter((row) => row._id !== change.removeTimeOffId).map((row) => ({ kind: "time_off" as const, span: { startsAt: row.startsAt, endsAt: row.endsAt }, note: row.note })),
    ...time.exceptions.filter((row) => row._id !== change.removeExceptionId && row.kind === "unavailable").map((row) => ({ kind: "exception" as const, span: exceptionSpan(row, tz), note: row.note })),
  ];
  const extra = time.exceptions.filter((row) => row._id !== change.removeExceptionId && row.kind === "available").map((row) => exceptionSpan(row, tz));
  if (change.timeAway) absences.push({ kind: "time_off", span: change.timeAway });
  if (change.exception) {
    const span = exceptionSpan(change.exception, tz);
    if (change.exception.kind === "unavailable") absences.push({ kind: "exception", span });
    else extra.push(span);
  }
  const statusOf = new Map(commitments.map((row) => [row.assignmentId, row.status]));
  return conflictsOf({ commitments: asBooked, absences, windows: change.windows ?? week, extraAvailable: extra, timezone: tz }).map((row) => ({
    jobId: row.commitment.jobId,
    label: row.commitment.label,
    startsAt: row.commitment.startsAt,
    status: statusOf.get(row.commitment.assignmentId) ?? "accepted",
    reason: row.reason,
    alreadyClashing: before.has(row.commitment.assignmentId),
  }));
}

export const forCleaner = companyQuery({
  args: { cleanerId: v.id("cleaners"), from: v.number() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const windows = await weekOf(ctx, cleaner);
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gt("endsAt", args.from))
      .take(100);
    return {
      timezone: ctx.company.timezone,
      windows,
      timeOff: timeOff.map((row) => ({ id: row._id, startsAt: row.startsAt, endsAt: row.endsAt, note: row.note })),
    };
  },
});

/** What a change would touch, before it is saved. Read by the same roles that can make the change. */
export const preview = companyQuery({
  args: {
    cleanerId: v.id("cleaners"),
    windows: v.optional(v.array(windowValidator)),
    timeAway: v.optional(v.object({ startsAt: v.number(), endsAt: v.number() })),
    exception: v.optional(exceptionValidator),
    removeTimeOffId: v.optional(v.id("timeOff")),
    removeExceptionId: v.optional(v.id("availabilityExceptions")),
  },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (args.timeAway && args.timeAway.startsAt >= args.timeAway.endsAt) return [];
    if (args.windows && args.windows.some((row) => row.startMinute >= row.endMinute)) return [];
    if (args.exception && !/^\d{4}-\d{2}-\d{2}$/.test(args.exception.date)) return [];
    return clashesAfter(ctx, cleaner, args);
  },
});

/**
 * Replaces the cleaner's whole week with what they told the office, so what is stored is exactly what they
 * last said. Counts as confirming their hours.
 */
export const setWeek = managerMutation({
  args: { cleanerId: v.id("cleaners"), windows: v.array(windowValidator) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    checkWindows(args.windows);
    const clashes = await clashesAfter(ctx, cleaner, { windows: args.windows });
    const old = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    for (const row of old) await ctx.db.delete(row._id);
    for (const window of args.windows) await ctx.db.insert("availabilityWindows", { companyId: ctx.companyId, cleanerId: cleaner._id, ...window });
    await ctx.db.patch(cleaner._id, { availabilityConfirmedAt: Date.now(), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_set", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { windows: args.windows.length, clashes: clashes.filter((row) => !row.alreadyClashing).length } });
    return { clashes };
  },
});

/** "We checked with them: their hours are still right." Says how, so the history can be read later. */
export const confirm = managerMutation({
  args: { cleanerId: v.id("cleaners"), how: v.string() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const how = text(args.how, "How it was confirmed", 200);
    await ctx.db.patch(cleaner._id, { availabilityConfirmedAt: Date.now(), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_confirmed", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { how } });
    return null;
  },
});

/** One date they can or cannot work, outside their weekly pattern. */
export const addException = managerMutation({
  args: { cleanerId: v.id("cleaners"), exception: exceptionValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    checkException(args.exception, ctx.company.timezone);
    const clashes = await clashesAfter(ctx, cleaner, { exception: args.exception });
    const exceptionId = await ctx.db.insert("availabilityExceptions", {
      companyId: ctx.companyId,
      cleanerId: cleaner._id,
      ...args.exception,
      note: optionalText(args.note, "Note", 300),
      by: { kind: "member", memberId: ctx.member._id },
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.exception_added", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { date: args.exception.date, kind: args.exception.kind } });
    return { exceptionId, clashes };
  },
});

export const removeException = managerMutation({
  args: { exceptionId: v.id("availabilityExceptions") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.exceptionId);
    await ctx.db.delete(row._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.exception_removed", actor: byMember(ctx), subject: { table: "cleaners", id: row.cleanerId }, data: { date: row.date, kind: row.kind } });
    return null;
  },
});

/** Time away the office records. Booked work it touches stays booked until a person changes it in Dispatch. */
export const addTimeOff = managerMutation({
  args: { cleanerId: v.id("cleaners"), startsAt: v.number(), endsAt: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const startsAt = instant(args.startsAt, "The start");
    const endsAt = instant(args.endsAt, "The end");
    if (startsAt >= endsAt) throw userError("Time away must start before it ends.");
    const id = await ctx.db.insert("timeOff", { companyId: ctx.companyId, cleanerId: cleaner._id, startsAt, endsAt, note: optionalText(args.note, "Note", 300), source: "member", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_added", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { startsAt, endsAt } });
    return id;
  },
});

export const removeTimeOff = managerMutation({
  args: { timeOffId: v.id("timeOff") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.timeOffId);
    await ctx.db.delete(row._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_removed", actor: byMember(ctx), subject: { table: "cleaners", id: row.cleanerId }, data: { startsAt: row.startsAt, endsAt: row.endsAt } });
    return null;
  },
});
