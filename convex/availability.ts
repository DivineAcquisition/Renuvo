/** When each cleaner said they can work: weekly windows on the company's clock, and time off. */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyMutation, companyQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { instant, optionalText } from "./lib/text";

const windowValidator = v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() });

export const forCleaner = companyQuery({
  args: { cleanerId: v.id("cleaners"), from: v.number() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const windows = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gt("endsAt", args.from))
      .take(100);
    return {
      timezone: ctx.company.timezone,
      windows: windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })),
      timeOff: timeOff.map((row) => ({ id: row._id, startsAt: row.startsAt, endsAt: row.endsAt, note: row.note })),
    };
  },
});

/** Replaces the cleaner's whole week, so what is stored is exactly what they last said. */
export const setWeek = companyMutation({
  args: { cleanerId: v.id("cleaners"), windows: v.array(windowValidator) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (args.windows.length > 50) throw userError("That is too many windows for one week.");
    for (const window of args.windows) {
      const whole = [window.weekday, window.startMinute, window.endMinute].every(Number.isInteger);
      if (!whole || window.weekday < 0 || window.weekday > 6 || window.startMinute < 0 || window.endMinute > 24 * 60 || window.startMinute >= window.endMinute) {
        throw userError("Each window needs a day of the week and a start time before its end time.");
      }
    }
    const old = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    for (const row of old) await ctx.db.delete(row._id);
    for (const window of args.windows) await ctx.db.insert("availabilityWindows", { companyId: ctx.companyId, cleanerId: cleaner._id, ...window });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_set", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { windows: args.windows.length } });
    return null;
  },
});

export const addTimeOff = companyMutation({
  args: { cleanerId: v.id("cleaners"), startsAt: v.number(), endsAt: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const startsAt = instant(args.startsAt, "The start");
    const endsAt = instant(args.endsAt, "The end");
    if (startsAt >= endsAt) throw userError("Time off must start before it ends.");
    const id = await ctx.db.insert("timeOff", { companyId: ctx.companyId, cleanerId: cleaner._id, startsAt, endsAt, note: optionalText(args.note, "Note", 300) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_added", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { startsAt, endsAt } });
    return id;
  },
});

export const removeTimeOff = companyMutation({
  args: { timeOffId: v.id("timeOff") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.timeOffId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    await ctx.db.delete(row._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_removed", actor: byMember(ctx), subject: { table: "cleaners", id: row.cleanerId }, data: { startsAt: row.startsAt, endsAt: row.endsAt } });
    return null;
  },
});
