/**
 * Google Calendar for a company: visits and interviews on the calendar the Owner chose, busy times from
 * the calendars the Owner chose, and notice when an event Selestial made is moved or deleted in Google.
 *
 * Selestial is the source of truth for visits. A change made in Google is never applied to a visit: it
 * opens a task for a person, and the next sync puts Selestial's version back only after the person acts.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { accessTokenFor } from "./google";
import { companyQuery, managerMutation } from "./lib/builders";
import { recordEvent } from "./lib/events";
import { changes, eventIdFor, freeBusy, stopChannel, watch, type EventDraft } from "./lib/google/calendar";
import { activeConnection, requireFeature } from "./lib/google/connection";
import { enquire } from "./lib/google/enquire";
import { endpoints } from "./lib/google/platform";
import { hashToken, randomToken } from "./lib/recruiter/secrets";
import { openTask } from "./lib/taskState";

const DAY = 86_400_000;
const HORIZON = 60 * DAY;

export const syncNow = managerMutation({
  args: {},
  handler: async (ctx) => {
    const connection = await requireFeature(ctx, ctx.companyId, "calendar");
    return enquire(ctx, ctx.companyId, connection._id, "calendar_sync", `calendar_sync:${Math.floor(Date.now() / 60_000)}`, {}, ctx.member._id);
  },
});

/** Busy times Selestial last read, between two times, for the calendars the Owner chose. */
export const busy = companyQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("googleBusy").withIndex("by_company_calendar", (q) => q.eq("companyId", ctx.companyId)).take(50);
    return rows.map((row) => ({ calendarId: row.calendarId, fetchedAt: row.fetchedAt, problem: row.problem ?? null, covers: { from: row.from, to: row.to }, busy: row.busy.filter((b) => b.end > args.from && b.start < args.to) }));
  },
});

// ── The plan the worker carries out ─────────────────────────────────────────────────────────────

export const plan = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    const target = (await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "calendar_sync")).take(5)).find((r) => r.access !== "lost");
    if (!company || !target) return null;
    const now = Date.now();
    const desired: (EventDraft & { subject: { table: "jobs"; id: Id<"jobs"> } | { table: "interviews"; id: Id<"interviews"> } })[] = [];
    const jobs = await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", args.companyId).gte("startsAt", now - DAY).lt("startsAt", now + HORIZON)).take(1000);
    for (const job of jobs) {
      if (job.status === "cancelled") continue;
      const customer = await ctx.db.get(job.customerId);
      const property = await ctx.db.get(job.propertyId);
      const location = property ? `${property.address.line1}, ${property.address.city}, ${property.address.region} ${property.address.postalCode}` : undefined;
      desired.push({ id: eventIdFor(args.companyId, target.externalId, job._id), summary: `${job.serviceType} for ${customer?.name ?? "a customer"}`, description: `Visit in Selestial. Change it in Selestial, not here: changes made here are flagged for review and not applied.\n\n${job.scope.slice(0, 1500)}`, location, startsAt: job.startsAt, endsAt: job.endsAt, timeZone: company.timezone, subjectId: job._id, subject: { table: "jobs", id: job._id } });
    }
    const interviews = await ctx.db.query("interviews").withIndex("by_company_application", (q) => q.eq("companyId", args.companyId)).take(500);
    for (const interview of interviews) {
      if (interview.status !== "confirmed" || !interview.startsAt || !interview.endsAt || interview.endsAt < now - DAY) continue;
      desired.push({ id: eventIdFor(args.companyId, target.externalId, interview._id), summary: "Interview (Selestial)", description: `Interview scheduled in Selestial${interview.how ? `: ${interview.how}` : ""}. Change it in Selestial.`, startsAt: interview.startsAt, endsAt: interview.endsAt, timeZone: company.timezone, subjectId: interview._id, subject: { table: "interviews", id: interview._id } });
    }
    const links = (await ctx.db.query("googleCalendarLinks").withIndex("by_company_subject", (q) => q.eq("companyId", args.companyId)).take(2000)).filter((l) => l.calendarId === target.externalId);
    // An event whose visit was cancelled, or whose interview was cancelled, is removed from the calendar.
    const stale: string[] = [];
    for (const link of links) {
      const subject = link.subject.table === "jobs" ? await ctx.db.get(link.subject.id) : await ctx.db.get(link.subject.id);
      if (!subject) stale.push(link.eventId);
      else if (link.subject.table === "jobs" && (subject as Doc<"jobs">).status === "cancelled") stale.push(link.eventId);
      else if (link.subject.table === "interviews" && (subject as Doc<"interviews">).status === "cancelled") stale.push(link.eventId);
    }
    return { calendarId: target.externalId, desired, stale, links: links.map((l) => ({ subjectId: l.subjectId, eventId: l.eventId, writtenHash: l.writtenHash, externalChange: l.externalChange ?? null })) };
  },
});

export const saveLink = internalMutation({
  args: { companyId: v.id("companies"), calendarId: v.string(), subject: v.union(v.object({ table: v.literal("jobs"), id: v.id("jobs") }), v.object({ table: v.literal("interviews"), id: v.id("interviews") })), eventId: v.string(), writtenHash: v.string() },
  handler: async (ctx, args) => {
    const existing = (await ctx.db.query("googleCalendarLinks").withIndex("by_company_subject", (q) => q.eq("companyId", args.companyId).eq("subjectId", args.subject.id)).take(5)).find((l) => l.calendarId === args.calendarId);
    if (existing) await ctx.db.patch(existing._id, { eventId: args.eventId, writtenHash: args.writtenHash, externalChange: undefined, updatedAt: Date.now() });
    else await ctx.db.insert("googleCalendarLinks", { companyId: args.companyId, calendarId: args.calendarId, subject: args.subject, subjectId: args.subject.id, eventId: args.eventId, writtenHash: args.writtenHash, updatedAt: Date.now() });
    return null;
  },
});

export const dropLink = internalMutation({
  args: { companyId: v.id("companies"), eventId: v.string() },
  handler: async (ctx, args) => {
    for (const link of await ctx.db.query("googleCalendarLinks").withIndex("by_company_event", (q) => q.eq("companyId", args.companyId).eq("eventId", args.eventId)).take(5)) await ctx.db.delete(link._id);
    return null;
  },
});

/**
 * An event Selestial made was changed in Google by someone else. The visit is not changed: a person is
 * asked to decide, once per change.
 */
export const externalChange = internalMutation({
  args: { companyId: v.id("companies"), eventId: v.string(), change: v.union(v.literal("moved"), v.literal("deleted"), v.literal("edited")) },
  handler: async (ctx, args) => {
    const link = (await ctx.db.query("googleCalendarLinks").withIndex("by_company_event", (q) => q.eq("companyId", args.companyId).eq("eventId", args.eventId)).take(1))[0];
    if (!link || link.externalChange === args.change) return null;
    await ctx.db.patch(link._id, { externalChange: args.change, updatedAt: Date.now() });
    const what = link.subject.table === "jobs" ? "visit" : "interview";
    await openTask(ctx, {
      companyId: args.companyId,
      agent: link.subject.table === "jobs" ? "dispatch" : "recruiter",
      title: `A ${what}'s Google Calendar event was ${args.change} outside Selestial`,
      nextAction: `Check the ${what} in Selestial. Selestial did not change it. If the new time is right, change the ${what} in Selestial; the calendar then follows.`,
      dueAt: Date.now() + 2 * 3600_000,
      completionCondition: `The ${what} in Selestial and the calendar agree.`,
      key: `calendar-change:${link._id}:${args.change}:${Math.floor(Date.now() / 3_600_000)}`,
      about: link.subject.table === "jobs" ? { table: "jobs", id: link.subject.id } : undefined,
      actor: { kind: "system" },
    });
    await recordEvent(ctx, { companyId: args.companyId, type: "google.calendar_external_change", actor: { kind: "system" }, subject: link.subject.table === "jobs" ? { table: "jobs", id: link.subject.id } : { table: "companies", id: args.companyId }, data: { change: args.change } });
    return null;
  },
});

export const storeBusy = internalMutation({
  args: { companyId: v.id("companies"), calendarId: v.string(), from: v.number(), to: v.number(), busy: v.array(v.object({ start: v.number(), end: v.number() })), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("googleBusy").withIndex("by_company_calendar", (q) => q.eq("companyId", args.companyId).eq("calendarId", args.calendarId)).take(5)) await ctx.db.delete(old._id);
    await ctx.db.insert("googleBusy", { ...args, busy: args.busy.slice(0, 2000), fetchedAt: Date.now() });
    return null;
  },
});

// ── Push channels ───────────────────────────────────────────────────────────────────────────────

export const watchTarget = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const connection = await activeConnection(ctx, args.companyId);
    const target = (await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "calendar_sync")).take(5)).find((r) => r.access !== "lost");
    const watches = await ctx.db.query("googleWatches").withIndex("by_company", (q) => q.eq("companyId", args.companyId)).take(20);
    return connection && connection.status === "connected" && target ? { connectionId: connection._id, calendarId: target.externalId, current: watches.find((w) => w.kind === "calendar" && w.target === target.externalId) ?? null } : null;
  },
});

export const saveWatch = internalMutation({
  args: { companyId: v.id("companies"), connectionId: v.id("googleConnections"), target: v.string(), channelId: v.string(), resourceId: v.string(), tokenHash: v.string(), expiresAt: v.number(), replace: v.optional(v.id("googleWatches")) },
  handler: async (ctx, args) => {
    const old = args.replace ? await ctx.db.get(args.replace) : null;
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("googleWatches", { companyId: args.companyId, connectionId: args.connectionId, kind: "calendar", target: args.target, channelId: args.channelId, resourceId: args.resourceId, tokenHash: args.tokenHash, expiresAt: args.expiresAt, syncToken: old?.syncToken, createdAt: Date.now() });
    return null;
  },
});

/** Opens (or renews) the notification channel for the sync calendar. Without a public site address it does nothing; the timer still catches changes. */
export const ensureWatch = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<null> => {
    const target = await ctx.runQuery(internal.googleCalendar.watchTarget, args);
    const address = endpoints().calendarWebhook;
    if (!target || !address) return null;
    if (target.current && target.current.expiresAt > Date.now() + 2 * DAY) return null;
    const access = await accessTokenFor(ctx, target.connectionId);
    if (!access.ok) return null;
    const channelToken = await randomToken();
    const channelId = `selestial-${crypto.randomUUID()}`;
    const opened = await watch(access.token, target.calendarId, { channelId, address, token: channelToken, ttlSeconds: 7 * 86_400 });
    await ctx.runMutation(internal.googleCalendar.saveWatch, { companyId: args.companyId, connectionId: target.connectionId, target: target.calendarId, channelId, resourceId: opened.resourceId, tokenHash: await hashToken(channelToken), expiresAt: opened.expiration, replace: target.current?._id });
    if (target.current?.resourceId) await stopChannel(access.token, target.current.channelId, target.current.resourceId).catch(() => undefined);
    return null;
  },
});

/** A Calendar notification, checked against the channel's own secret token. Anything else is ignored. */
export const notified = internalMutation({
  args: { channelId: v.string(), tokenHash: v.string(), state: v.string(), resourceId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const watchRow = await ctx.db.query("googleWatches").withIndex("by_channel", (q) => q.eq("channelId", args.channelId)).unique();
    if (!watchRow || watchRow.tokenHash !== args.tokenHash || (args.resourceId && watchRow.resourceId !== args.resourceId)) return "ignored" as const;
    await ctx.db.patch(watchRow._id, { lastNotifiedAt: Date.now() });
    if (args.state === "sync") return "handshake" as const;
    await ctx.scheduler.runAfter(0, internal.googleCalendar.pullChanges, { companyId: watchRow.companyId });
    return "scheduled" as const;
  },
});

export const watchFor = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const row = (await ctx.db.query("googleWatches").withIndex("by_company", (q) => q.eq("companyId", args.companyId)).take(10)).find((w) => w.kind === "calendar");
    const links = await ctx.db.query("googleCalendarLinks").withIndex("by_company_subject", (q) => q.eq("companyId", args.companyId)).take(2000);
    return row ? { watchId: row._id, connectionId: row.connectionId, calendarId: row.target, syncToken: row.syncToken ?? null, links: links.map((l) => ({ eventId: l.eventId, writtenHash: l.writtenHash })) } : null;
  },
});

export const saveSyncToken = internalMutation({
  args: { watchId: v.id("googleWatches"), syncToken: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.watchId);
    if (row) await ctx.db.patch(row._id, { syncToken: args.syncToken ?? undefined });
    return null;
  },
});

/**
 * What changed in the sync calendar since last time. Run on each notification and on a timer, so a missed
 * notification is caught. Only Selestial's own events are looked at.
 */
export const pullChanges = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.runQuery(internal.googleCalendar.watchFor, args);
    if (!state) return null;
    const access = await accessTokenFor(ctx, state.connectionId);
    if (!access.ok) return null;
    let result = await changes(access.token, state.calendarId, state.syncToken ?? undefined);
    if (result.resync) result = await changes(access.token, state.calendarId, undefined);
    const known = new Map(state.links.map((l) => [l.eventId, l]));
    const plan = await ctx.runQuery(internal.googleCalendar.plan, args);
    const desired = new Map((plan?.desired ?? []).map((d) => [d.id, d]));
    for (const event of result.events) {
      if (event.extendedProperties?.private?.selestial !== "1" || !known.has(event.id)) continue;
      const wanted = desired.get(event.id);
      if (event.status === "cancelled") {
        if (wanted) await ctx.runMutation(internal.googleCalendar.externalChange, { companyId: args.companyId, eventId: event.id, change: "deleted" });
        continue;
      }
      if (!wanted) continue;
      const start = Date.parse(event.start?.dateTime ?? event.start?.date ?? "");
      const end = Date.parse(event.end?.dateTime ?? event.end?.date ?? "");
      if (start !== wanted.startsAt || end !== wanted.endsAt) await ctx.runMutation(internal.googleCalendar.externalChange, { companyId: args.companyId, eventId: event.id, change: "moved" });
    }
    if (result.nextSyncToken) await ctx.runMutation(internal.googleCalendar.saveSyncToken, { watchId: state.watchId, syncToken: result.nextSyncToken });
    return null;
  },
});

/** Refreshes busy times for the next two weeks from the calendars chosen for availability. */
export const busyTargets = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    const connection = await activeConnection(ctx, args.companyId);
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "calendar_busy")).take(20);
    return company && connection?.status === "connected" ? { connectionId: connection._id, timezone: company.timezone, calendars: rows.filter((r) => r.access !== "lost").map((r) => r.externalId) } : null;
  },
});

export const refreshBusy = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<null> => {
    const targets = await ctx.runQuery(internal.googleCalendar.busyTargets, args);
    if (!targets || targets.calendars.length === 0) return null;
    const access = await accessTokenFor(ctx, targets.connectionId);
    if (!access.ok) return null;
    const from = Date.now();
    const to = from + 14 * DAY;
    const answer = await freeBusy(access.token, { calendarIds: targets.calendars, from, to, timeZone: targets.timezone });
    for (const calendarId of targets.calendars) await ctx.runMutation(internal.googleCalendar.storeBusy, { companyId: args.companyId, calendarId, from, to, busy: answer.busy[calendarId] ?? [], problem: answer.errors[calendarId] });
    return null;
  },
});

/** Every few minutes: sync, busy times, watch renewal, and a catch-up read in case a notification was missed. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const resources = await ctx.db.query("googleResources").withIndex("by_company_kind").take(2000);
    const companies = new Set<Id<"companies">>();
    for (const r of resources) if (r.kind === "calendar_sync" || r.kind === "calendar_busy") companies.add(r.companyId);
    const bucket = Math.floor(Date.now() / (10 * 60_000));
    for (const companyId of companies) {
      const connection = await activeConnection(ctx, companyId);
      if (!connection || connection.status !== "connected") continue;
      await enquire(ctx, companyId, connection._id, "calendar_sync", `calendar_sync:auto:${bucket}`, {});
      await ctx.scheduler.runAfter(0, internal.googleCalendar.refreshBusy, { companyId });
      await ctx.scheduler.runAfter(0, internal.googleCalendar.ensureWatch, { companyId });
      await ctx.scheduler.runAfter(0, internal.googleCalendar.pullChanges, { companyId });
    }
    return companies.size;
  },
});

export type LinkRow = Doc<"googleCalendarLinks">;
