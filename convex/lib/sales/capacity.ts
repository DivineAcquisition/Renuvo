/**
 * Capacity: can the company take this visit at this time, and holding it while a booking waits.
 *
 * A slot fits when enough ready cleaners are free for the whole visit after subtracting the crew already
 * promised in the same hours: visits still waiting for cleaners, and other bookings' active holds. The
 * check and the hold are written in one Convex transaction, so two people booking the last crew at the
 * same moment cannot both get it: one transaction is retried, sees the other's hold, and is refused.
 *
 * A hold is a reservation of crew for a span, not an assignment: no cleaner is told or promised anything.
 * It lapses at `expiresAt`. A payment that arrives after a hold lapsed does not book the visit: the
 * booking checks capacity again and, if the slot is gone, goes back to staff as a conflict with the money
 * kept on the invoice (see convex/bookings.ts).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts } from "../availability";
import { whoIsFree } from "../cleaners/free";
import { businessSettingsOf } from "../settings/business";
import { ACTIVE_ASSIGNMENT } from "../statuses";
import { addLocalDays, startOfLocalDay } from "../time";

export type CapacityAnswer = {
  state: "fits" | "tight" | "full" | "closed" | "unknown";
  /** Ready cleaners free for the whole span, before other promises. */
  freeCleaners: number;
  /** Crew already promised in overlapping hours: waiting visits and other bookings' holds. */
  promised: number;
  crew: number;
  /** Plain words for the person booking. */
  why: string;
  blockers: string[];
};

const HOLD_MINUTES_DEFAULT = 60 * 24;

export async function checkCapacity(
  ctx: QueryCtx | MutationCtx,
  company: Doc<"companies">,
  span: { startsAt: number; endsAt: number },
  crew: number,
  ignoreBooking?: Id<"bookings">,
): Promise<CapacityAnswer> {
  const tz = company.timezone;
  const settings = businessSettingsOf(company);
  const blockers: string[] = [];
  if (settings.hours.length) {
    const start = localParts(span.startsAt, tz);
    const end = localParts(span.endsAt, tz);
    const fits = start.day === end.day && settings.hours.some((w) => w.weekday === start.weekday && w.startMinute <= start.minute && end.minute <= w.endMinute);
    if (!fits) blockers.push("This time is outside the company's operating hours.");
  }
  if (span.startsAt < Date.now()) blockers.push("This time has already passed.");
  if (blockers.length) return { state: "closed", freeCleaners: 0, promised: 0, crew, why: blockers[0]!, blockers };

  const free = await whoIsFree(ctx, company, span);
  const freeCleaners = free.filter((row) => row.available && row.ready).length;

  // Crew still owed to visits in overlapping hours that are not fully staffed.
  const dayStart = startOfLocalDay(span.startsAt, tz);
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", dayStart - 12 * 3_600_000).lt("startsAt", span.endsAt))
    .take(300);
  let promised = 0;
  for (const job of jobs) {
    if (job.status !== "scheduled" || job.endsAt <= span.startsAt || job.startsAt >= span.endsAt) continue;
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id))
      .take(20);
    const staffed = assignments.filter((row) => ACTIVE_ASSIGNMENT.includes(row.status)).length;
    promised += Math.max(0, (job.requiredCrew ?? 1) - staffed);
  }
  promised += await heldCrew(ctx, company, span, ignoreBooking);

  if (free.length === 0) return { state: "unknown", freeCleaners: 0, promised, crew, why: "No cleaners have set their availability yet, so capacity can't be checked.", blockers: ["Cleaners' availability is not set up."] };
  const left = freeCleaners - promised;
  if (left >= crew + 1) return { state: "fits", freeCleaners, promised, crew, why: `${left} cleaner${left === 1 ? "" : "s"} free after other commitments; this visit needs ${crew}.`, blockers: [] };
  if (left >= crew) return { state: "tight", freeCleaners, promised, crew, why: `Exactly ${left} cleaner${left === 1 ? "" : "s"} free after other commitments; this visit needs ${crew}.`, blockers: [] };
  const why = left <= 0 ? "No cleaners are free for this time after other commitments." : `Only ${left} cleaner${left === 1 ? "" : "s"} free after other commitments; this visit needs ${crew}.`;
  return { state: "full", freeCleaners, promised, crew, why, blockers: [why] };
}

async function heldCrew(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, span: { startsAt: number; endsAt: number }, ignoreBooking?: Id<"bookings">): Promise<number> {
  const day = localParts(span.startsAt, company.timezone).day;
  const holds = await ctx.db
    .query("capacityHolds")
    .withIndex("by_company_day_status", (q) => q.eq("companyId", company._id).eq("day", day).eq("status", "held"))
    .take(200);
  const now = Date.now();
  return holds.filter((h) => h.bookingId !== ignoreBooking && h.expiresAt > now && h.startsAt < span.endsAt && span.startsAt < h.endsAt).reduce((sum, h) => sum + h.crew, 0);
}

/** Holds crew for a booking, after checking in the same transaction that it still fits. */
export async function holdCapacity(
  ctx: MutationCtx,
  company: Doc<"companies">,
  input: { bookingId: Id<"bookings">; startsAt: number; endsAt: number; crew: number; holdMinutes?: number },
): Promise<{ ok: true; holdId: Id<"capacityHolds">; expiresAt: number } | { ok: false; answer: CapacityAnswer }> {
  const answer = await checkCapacity(ctx, company, input, input.crew, input.bookingId);
  if (answer.state !== "fits" && answer.state !== "tight") return { ok: false, answer };
  await releaseHolds(ctx, company._id, input.bookingId, "released");
  const now = Date.now();
  // A hold never outlives the visit's own start.
  const expiresAt = Math.min(now + (input.holdMinutes ?? HOLD_MINUTES_DEFAULT) * 60_000, input.startsAt);
  const holdId = await ctx.db.insert("capacityHolds", {
    companyId: company._id,
    bookingId: input.bookingId,
    day: localParts(input.startsAt, company.timezone).day,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    crew: input.crew,
    crewMinutes: Math.round(((input.endsAt - input.startsAt) / 60_000) * input.crew),
    status: "held",
    expiresAt,
    createdAt: now,
  });
  return { ok: true, holdId, expiresAt };
}

export async function releaseHolds(ctx: MutationCtx, companyId: Id<"companies">, bookingId: Id<"bookings">, to: "released" | "consumed"): Promise<void> {
  const holds = await ctx.db
    .query("capacityHolds")
    .withIndex("by_company_booking", (q) => q.eq("companyId", companyId).eq("bookingId", bookingId))
    .take(20);
  for (const hold of holds) if (hold.status === "held") await ctx.db.patch(hold._id, { status: to });
}

/** A live hold for the booking, or null if it lapsed or was released. */
export async function liveHold(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, bookingId: Id<"bookings">): Promise<Doc<"capacityHolds"> | null> {
  const holds = await ctx.db
    .query("capacityHolds")
    .withIndex("by_company_booking", (q) => q.eq("companyId", companyId).eq("bookingId", bookingId))
    .take(20);
  return holds.find((h) => h.status === "held" && h.expiresAt > Date.now()) ?? null;
}

/** Marks lapsed holds expired. Called by the bookings sweep. */
export async function expireHolds(ctx: MutationCtx, now: number): Promise<number> {
  const due = await ctx.db
    .query("capacityHolds")
    .withIndex("by_status_expires", (q) => q.eq("status", "held").lte("expiresAt", now))
    .take(200);
  for (const hold of due) await ctx.db.patch(hold._id, { status: "expired" });
  return due.length;
}

/** The next `days` days' capacity at one time of day, for "other dates to offer". */
export async function nearbyDays(ctx: QueryCtx, company: Doc<"companies">, startsAt: number, minutes: number, crew: number, days: number): Promise<{ startsAt: number; state: CapacityAnswer["state"] }[]> {
  const tz = company.timezone;
  const minuteOfDay = localParts(startsAt, tz).minute;
  const base = startOfLocalDay(startsAt, tz);
  const out: { startsAt: number; state: CapacityAnswer["state"] }[] = [];
  for (let i = 1; i <= days; i += 1) {
    const at = addLocalDays(base, i, tz) + minuteOfDay * 60_000;
    const answer = await checkCapacity(ctx, company, { startsAt: at, endsAt: at + minutes * 60_000 }, crew);
    out.push({ startsAt: at, state: answer.state });
  }
  return out;
}
