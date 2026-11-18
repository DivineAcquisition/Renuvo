/**
 * Which start times can be offered, and holding one while the customer finishes.
 *
 * Capacity is counted the way Dispatch staffs a visit (convex/lib/dispatch/eligibility.ts): a cleaner
 * counts for a time when they are ready for work, have the service's skills, work in the postal code,
 * said they can work then, are not off, and hold no offer or job within the travel buffer of it. From
 * those cleaners, the crew still needed by other visits and by other customers' holds at the same time
 * is taken away. A time is offered only when the service's whole crew is left.
 *
 * Kept apart on purpose: the customer's preferred date, a time that is available, a time this session
 * holds, a booking confirmed against it, and a cleaner accepting it (which only Dispatch records).
 *
 * A hold is acquired and released inside one mutation each. Convex runs mutations as serializable
 * transactions, so two customers racing for the last crew both read the same holds: one commits and the
 * other is retried, sees the new hold, and is refused. An expired hold stops counting at once, even
 * before the scheduler marks it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts, overlaps, withinWeeklyWindows, type Span, type WeeklyWindow } from "../availability";
import { dispatchSettings } from "../dispatch/settings";
import { normalizePostalCode } from "../settings/business";
import { ACTIVE_ASSIGNMENT } from "../statuses";
import { addLocalDays, clock, startOfLocalDay } from "../time";

const MINUTE = 60_000;

/** Booking hours when the company has set none: offered times stay inside a normal working day. */
export const FALLBACK_HOURS: WeeklyWindow[] = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 18 * 60 }));

export type CleanerSupply = { id: Id<"cleaners">; skills: string[]; areas: string[]; windows: WeeklyWindow[]; off: Span[]; busy: Span[] };
export type Demand = { span: Span; crew: number; holdId?: Id<"bookingHolds"> };

export type Supply = { cleaners: CleanerSupply[]; demand: Demand[]; bufferMinutes: number; timezone: string };

/** Everything capacity needs between two instants, read once. */
export async function loadSupply(ctx: QueryCtx, company: Doc<"companies">, from: number, to: number): Promise<Supply> {
  const tz = company.timezone;
  const ready = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "ready"))
    .take(300);
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", from - 24 * 60 * MINUTE).lt("startsAt", to))
    .take(1000);
  const live = jobs.filter((job) => (job.status === "scheduled" || job.status === "in_progress") && job.endsAt > from);
  const busyByCleaner = new Map<string, Span[]>();
  const demand: Demand[] = [];
  for (const job of live) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id))
      .take(30);
    const active = assignments.filter((a) => ACTIVE_ASSIGNMENT.includes(a.status));
    const span = { startsAt: job.startsAt, endsAt: job.endsAt + (job.arrivalWindowMinutes ?? 0) * MINUTE };
    for (const a of active) busyByCleaner.set(a.cleanerId, [...(busyByCleaner.get(a.cleanerId) ?? []), span]);
    const open = Math.max(0, (job.requiredCrew ?? 1) - active.length);
    if (open > 0) demand.push({ span, crew: open });
  }
  const holds = await ctx.db
    .query("bookingHolds")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", from - 24 * 60 * MINUTE).lt("startsAt", to))
    .take(500);
  const now = Date.now();
  for (const hold of holds) {
    if (hold.status === "held" && hold.expiresAt > now) demand.push({ span: { startsAt: hold.startsAt, endsAt: hold.endsAt }, crew: hold.crew, holdId: hold._id });
  }
  const cleaners: CleanerSupply[] = [];
  for (const cleaner of ready) {
    const windows = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
      .take(28);
    if (!windows.length) continue;
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id).gte("endsAt", from))
      .take(50);
    const exceptions = await ctx.db
      .query("availabilityExceptions")
      .withIndex("by_company_cleaner_date", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id).gte("date", localParts(from, tz).day))
      .take(60);
    const off: Span[] = timeOff.filter((row) => row.startsAt < to).map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }));
    for (const ex of exceptions) {
      if (ex.kind !== "unavailable") continue;
      const day = dayStartOf(ex.date, tz);
      if (day === null) continue;
      off.push({ startsAt: day + (ex.startMinute ?? 0) * MINUTE, endsAt: ex.endMinute !== undefined ? day + ex.endMinute * MINUTE : addLocalDays(day, 1, tz) });
    }
    cleaners.push({ id: cleaner._id, skills: cleaner.skills, areas: cleaner.serviceAreas.map(normalizePostalCode), windows: windows.map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute })), off, busy: busyByCleaner.get(cleaner._id) ?? [] });
  }
  return { cleaners, demand, bufferMinutes: dispatchSettings(company).travelBufferMinutes, timezone: tz };
}

/** The local midnight a YYYY-MM-DD names, on the company's clock. */
export function dayStartOf(date: string, timezone: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const noon = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (Number.isNaN(noon)) return null;
  let start = startOfLocalDay(noon, timezone);
  for (let i = 0; i < 2 && localParts(start, timezone).day !== date; i += 1) start = addLocalDays(start, localParts(start, timezone).day < date ? 1 : -1, timezone);
  return localParts(start, timezone).day === date ? start : null;
}

export type Need = { crew: number; skills: string[]; postalCode: string; elapsedMinutes: number; windowMinutes: number };

/** The span a booked time occupies for capacity: its whole arrival window, then the time on site. */
export function occupied(startsAt: number, need: Pick<Need, "elapsedMinutes" | "windowMinutes">): Span {
  return { startsAt, endsAt: startsAt + (need.windowMinutes + need.elapsedMinutes) * MINUTE };
}

/** How many cleaners are left for this span once other visits and holds take theirs. `except` leaves this session's own hold out. */
export function spareCrew(supply: Supply, span: Span, need: Need, except?: Id<"bookingHolds">): number {
  const buffer = supply.bufferMinutes * MINUTE;
  const padded = { startsAt: span.startsAt - buffer, endsAt: span.endsAt + buffer };
  const postal = normalizePostalCode(need.postalCode);
  let free = 0;
  for (const c of supply.cleaners) {
    if (need.skills.some((skill) => !c.skills.includes(skill))) continue;
    if (!c.areas.includes(postal)) continue;
    if (!withinWeeklyWindows(c.windows, span, supply.timezone)) continue;
    if (c.off.some((off) => overlaps(off, span))) continue;
    if (c.busy.some((busy) => overlaps(busy, padded))) continue;
    free += 1;
  }
  const taken = supply.demand.filter((d) => d.holdId !== except && overlaps(d.span, span)).reduce((sum, d) => sum + d.crew, 0);
  return free - taken;
}

/** True when anyone at all could be offered work: a ready cleaner who has said when they work. */
export function hasSupply(supply: Supply): boolean {
  return supply.cleaners.length > 0;
}

export type Slot = { startsAt: number; label: string; windowLabel: string; period: "morning" | "afternoon" | "evening"; available: boolean };

/**
 * The start times for one local date: inside the company's booking hours (the visit's time on site must
 * finish inside the same window), after the notice period, every `slotMinutes`.
 */
export function slotsFor(input: { date: string; hours: WeeklyWindow[]; slotMinutes: number; earliest: number; need: Need; supply: Supply | null; except?: Id<"bookingHolds"> }): Slot[] {
  const tz = input.supply?.timezone;
  if (!tz) return [];
  return candidateStarts({ ...input, timezone: tz }).map((startsAt) => {
    const available = input.supply ? spareCrew(input.supply, occupied(startsAt, input.need), input.need, input.except) >= input.need.crew : true;
    return slotOf(startsAt, input.need.windowMinutes, tz, available);
  });
}

export function candidateStarts(input: { date: string; hours: WeeklyWindow[]; slotMinutes: number; earliest: number; need: Pick<Need, "elapsedMinutes">; timezone: string }): number[] {
  const day = dayStartOf(input.date, input.timezone);
  if (day === null) return [];
  const weekday = localParts(day + 12 * 60 * MINUTE, input.timezone).weekday;
  const hours = input.hours.length ? input.hours : FALLBACK_HOURS;
  const out: number[] = [];
  for (const window of hours.filter((w) => w.weekday === weekday)) {
    for (let minute = window.startMinute; minute + input.need.elapsedMinutes <= window.endMinute; minute += input.slotMinutes) {
      const startsAt = day + minute * MINUTE;
      // Clocks that change inside the day move the instant; keep only starts that land on the minute named.
      if (localParts(startsAt, input.timezone).minute !== minute) continue;
      if (startsAt >= input.earliest) out.push(startsAt);
    }
  }
  return out.sort((a, b) => a - b);
}

export function slotOf(startsAt: number, windowMinutes: number, timezone: string, available: boolean): Slot {
  const minute = localParts(startsAt, timezone).minute;
  const period = minute < 12 * 60 ? "morning" : minute < 16 * 60 ? "afternoon" : "evening";
  const windowLabel = windowMinutes > 0 ? `Arrives ${clock(startsAt, timezone)}–${clock(startsAt + windowMinutes * MINUTE, timezone)}` : `Starts at ${clock(startsAt, timezone)}`;
  return { startsAt, label: clock(startsAt, timezone), windowLabel, period, available };
}

/** Holds a time for a session, after checking it again inside this transaction. Releases the session's earlier hold. */
export async function acquireHold(
  ctx: MutationCtx,
  input: { company: Doc<"companies">; sessionId: Id<"bookingSessions">; startsAt: number; need: Need; holdMinutes: number; hours: WeeklyWindow[] },
): Promise<{ ok: true; holdId: Id<"bookingHolds"> } | { ok: false; why: string }> {
  const span = occupied(input.startsAt, input.need);
  const existing = await ctx.db
    .query("bookingHolds")
    .withIndex("by_company_session", (q) => q.eq("companyId", input.company._id).eq("sessionId", input.sessionId))
    .take(20);
  const mine = existing.filter((h) => h.status === "held");
  const supply = await loadSupply(ctx, input.company, span.startsAt - MINUTE, span.endsAt + MINUTE);
  const ownLive = mine.find((h) => h.expiresAt > Date.now());
  if (spareCrew(supply, span, input.need, ownLive?._id) < input.need.crew) return { ok: false, why: "That time was just taken. Please choose another." };
  const now = Date.now();
  for (const hold of mine) await ctx.db.patch(hold._id, { status: "released", updatedAt: now });
  const holdId = await ctx.db.insert("bookingHolds", { companyId: input.company._id, sessionId: input.sessionId, startsAt: span.startsAt, endsAt: span.endsAt, crew: input.need.crew, status: "held", expiresAt: now + input.holdMinutes * MINUTE, createdAt: now, updatedAt: now });
  return { ok: true, holdId };
}

/** Lets go of whatever the session holds. */
export async function releaseHolds(ctx: MutationCtx, companyId: Id<"companies">, sessionId: Id<"bookingSessions">): Promise<void> {
  const holds = await ctx.db
    .query("bookingHolds")
    .withIndex("by_company_session", (q) => q.eq("companyId", companyId).eq("sessionId", sessionId))
    .take(20);
  const now = Date.now();
  for (const hold of holds) if (hold.status === "held") await ctx.db.patch(hold._id, { status: "released", updatedAt: now });
}

/** True while the hold still reserves its time. */
export function holdLive(hold: Doc<"bookingHolds"> | null, now = Date.now()): boolean {
  return Boolean(hold && hold.status === "held" && hold.expiresAt > now);
}
