/**
 * Whether the company could do a job at a time, before any job exists. The rules are Dispatch's own
 * (convex/lib/dispatch/eligibility.ts `assess`): ready for work, every requirement met, the skills, the
 * area, said they can work then, no time off, no other job overlapping or inside the time kept between
 * jobs. Sales applies them to a time instead of a job, then takes away what is already reserved for
 * other prospects.
 *
 * Four different things, never confused:
 *   open time      enough eligible cleaners are free then (this file's answer);
 *   reserved time  a hold was placed for one opportunity, for a limited time (salesHolds);
 *   booked         a job exists (booking.ts makes it, after checking this again);
 *   crew confirmed a cleaner accepted the job. That is Dispatch's, and Sales never says it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts, overlaps, type Span } from "../availability";
import { companyFacts, readinessOf } from "../cleaners/records";
import { exceptionSpan } from "../cleaners/schedule";
import { assess, type CleanerFacts, type ExclusionCode } from "../dispatch/eligibility";
import { heldSpans } from "../dispatch/facts";
import { dispatchSettings } from "../dispatch/settings";
import { businessSettingsOf, normalizePostalCode } from "../settings/business";
import { addLocalDays, startOfLocalDay } from "../time";
import { salesSettings } from "./settings";

type Ctx = QueryCtx | MutationCtx;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type Need = { serviceName: string; skills: string[]; crew: number; postalCode: string };

export type SlotAnswer = {
  ok: boolean;
  /** Eligible cleaners free then, after other prospects' reserved time is taken away. */
  free: number;
  needed: number;
  /** Why not, in words for a person. Empty when ok. */
  reasons: string[];
  checkedAt: number;
};

type Loaded = {
  company: Doc<"companies">;
  cleaners: { doc: Doc<"cleaners">; windows: CleanerFacts["windows"]; timeOff: Span[]; held: Span[]; off: Span[]; extra: Span[] }[];
  blockers: (cleaner: Doc<"cleaners">, at: number) => string[];
  holds: Doc<"salesHolds">[];
};

/** Reads once what any number of times can then be checked against: every ready cleaner's hours, time off and jobs, and the time already reserved. */
export async function loadCapacity(ctx: Ctx, company: Doc<"companies">, need: Pick<Need, "serviceName" | "skills">, range: Span): Promise<Loaded> {
  const cleaners = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "ready"))
    .take(200);
  const known = await companyFacts(ctx, company);
  const fromDay = localParts(range.startsAt, company.timezone).day;
  const toDay = localParts(range.endsAt, company.timezone).day;
  const out: Loaded["cleaners"] = [];
  for (const doc of cleaners) {
    const windows = known.windows.get(doc._id) ?? [];
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", company._id).eq("cleanerId", doc._id).gt("endsAt", range.startsAt))
      .take(100);
    const exceptions = await ctx.db
      .query("availabilityExceptions")
      .withIndex("by_company_cleaner_date", (q) => q.eq("companyId", company._id).eq("cleanerId", doc._id).gte("date", fromDay).lte("date", toDay))
      .take(60);
    out.push({
      doc,
      windows: windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })),
      timeOff: timeOff.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })),
      // No job exists yet, so nothing is left out of what the cleaner already holds.
      held: await heldSpans(ctx, company._id, doc._id, "" as Id<"jobs">),
      off: exceptions.filter((row) => row.kind === "unavailable").map((row) => exceptionSpan(row, company.timezone)),
      extra: exceptions.filter((row) => row.kind === "available").map((row) => exceptionSpan(row, company.timezone)),
    });
  }
  const holds = await ctx.db
    .query("salesHolds")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", range.startsAt - 24 * HOUR).lte("startsAt", range.endsAt))
    .take(300);
  const service = { name: need.serviceName, skills: need.skills };
  return { company, cleaners: out, blockers: (cleaner, at) => readinessOf(cleaner, known, company, at, service).blockers.map((view) => view.label), holds };
}

const WHY: Partial<Record<ExclusionCode, (count: number) => string>> = {
  already_booked: (count) => `${count} already ${count === 1 ? "has" : "have"} a job then`,
  too_close: (count) => `${count} ${count === 1 ? "has" : "have"} another job too close to it`,
  outside_hours: (count) => `${count} ${count === 1 ? "has" : "have"} not said they can work then`,
  outside_area: (count) => `${count} ${count === 1 ? "does" : "do"} not work in that area`,
  missing_skill: (count) => `${count} ${count === 1 ? "lacks" : "lack"} a skill the service needs`,
  time_off: (count) => `${count} ${count === 1 ? "has" : "have"} time off`,
  date_exception: (count) => `${count} said they cannot work that day`,
  requirements: (count) => `${count} ${count === 1 ? "has" : "have"} not met what is needed before work`,
};

/** The company's own rules for a time: its area, its hours, and how much notice it asks for. Null when the time is inside them. */
export function ruleProblem(company: Doc<"companies">, need: Pick<Need, "postalCode">, span: Span, now: number): string | null {
  const settings = businessSettingsOf(company);
  const code = normalizePostalCode(need.postalCode);
  if (!code) return "The property's postal code is not known yet.";
  if (settings.serviceAreas.length > 0 && !settings.serviceAreas.includes(code)) return `The company does not work in ${code}.`;
  if (span.startsAt >= span.endsAt) return "The time is not valid.";
  const notice = salesSettings(company).booking.minimumNoticeHours;
  if (span.startsAt < now + notice * HOUR) return notice > 0 ? `Bookings need at least ${notice} hours' notice.` : "That time has passed.";
  if (settings.hours.length > 0) {
    const start = localParts(span.startsAt, company.timezone);
    const end = localParts(span.endsAt, company.timezone);
    const fits = start.day === end.day && settings.hours.some((window) => window.weekday === start.weekday && window.startMinute <= start.minute && end.minute <= window.endMinute);
    if (!fits) return "That time is outside the company's operating hours.";
  }
  return null;
}

/** Whether one time is open, against what `loadCapacity` read. Pure: the same facts give the same answer. */
export function assessSlot(loaded: Loaded, need: Need, span: Span, now: number, except: { opportunityId?: Id<"salesOpportunities"> } = {}): SlotAnswer {
  const rule = ruleProblem(loaded.company, need, span, now);
  if (rule) return { ok: false, free: 0, needed: need.crew, reasons: [rule], checkedAt: now };
  const buffer = dispatchSettings(loaded.company).travelBufferMinutes;
  const job = { span, requiredSkills: need.skills, postalCode: normalizePostalCode(need.postalCode), timezone: loaded.company.timezone, travelBufferMinutes: buffer };
  let eligible = 0;
  const counts = new Map<ExclusionCode, number>();
  for (const cleaner of loaded.cleaners) {
    const facts: CleanerFacts = {
      id: cleaner.doc._id,
      name: cleaner.doc.name,
      status: cleaner.doc.status,
      skills: cleaner.doc.skills,
      serviceAreas: cleaner.doc.serviceAreas,
      windows: cleaner.windows,
      timeOff: cleaner.timeOff,
      held: cleaner.held,
      blockers: loaded.blockers(cleaner.doc, Math.max(span.startsAt, now)),
      exceptionsOff: cleaner.off,
      extraAvailable: cleaner.extra,
      endedForJob: null,
      priorVisitsForCustomer: 0,
      pay: { ok: true, payCents: 0, basis: "" } as CleanerFacts["pay"],
    };
    // Whether a cleaner's pay is set up is Dispatch's question when it makes the offer, not a reason the time is not open.
    const exclusion = assess(facts, job, { serviceArea: true, travelBuffer: true, ended: false, pay: false });
    if (exclusion) counts.set(exclusion.code, (counts.get(exclusion.code) ?? 0) + 1);
    else eligible += 1;
  }
  const padded = { startsAt: span.startsAt - buffer * MINUTE, endsAt: span.endsAt + buffer * MINUTE };
  const reserved = loaded.holds.filter((hold) => hold.status === "held" && hold.expiresAt > now && hold.opportunityId !== except.opportunityId && overlaps({ startsAt: hold.startsAt, endsAt: hold.endsAt }, padded)).reduce((sum, hold) => sum + hold.crew, 0);
  const free = Math.max(0, eligible - reserved);
  if (free >= need.crew) return { ok: true, free, needed: need.crew, reasons: [], checkedAt: now };
  const reasons: string[] = [];
  if (loaded.cleaners.length === 0) reasons.push("No cleaner is marked ready for work, so no time can be confirmed.");
  else {
    reasons.push(`${need.crew === 1 ? "A cleaner is" : `${need.crew} cleaners are`} needed and ${free} ${free === 1 ? "is" : "are"} free then.`);
    const why = [...counts.entries()].sort((a, b) => b[1] - a[1]).flatMap(([code, count]) => (WHY[code] ? [WHY[code]!(count)] : [])).slice(0, 3);
    if (why.length > 0) reasons.push(`Of the others: ${why.join("; ")}.`);
    if (reserved > 0) reasons.push(`${reserved} ${reserved === 1 ? "is" : "are"} reserved for another prospect's booking.`);
  }
  return { ok: false, free, needed: need.crew, reasons, checkedAt: now };
}

/** One time, checked now. The check a booking runs immediately before it commits. */
export async function checkSlot(ctx: Ctx, company: Doc<"companies">, need: Need, span: Span, except: { opportunityId?: Id<"salesOpportunities"> } = {}): Promise<SlotAnswer> {
  const now = Date.now();
  const rule = ruleProblem(company, need, span, now);
  if (rule) return { ok: false, free: 0, needed: need.crew, reasons: [rule], checkedAt: now };
  return assessSlot(await loadCapacity(ctx, company, need, span), need, span, now, except);
}

/**
 * Times that are open in the days ahead, for a customer to choose from. Up to three starts a day inside
 * the company's hours (or 8 to 5 when none are set). They are open at the moment of asking and nothing
 * more: a time is checked again when it is reserved and again when it is booked.
 */
export async function openSlots(ctx: Ctx, company: Doc<"companies">, need: Need, input: { durationMinutes: number; days?: number; limit?: number; except?: { opportunityId?: Id<"salesOpportunities"> } }): Promise<Span[]> {
  const now = Date.now();
  const tz = company.timezone;
  const days = Math.min(input.days ?? 10, 14);
  const limit = Math.min(input.limit ?? 6, 12);
  const first = startOfLocalDay(now, tz);
  const range = { startsAt: now, endsAt: addLocalDays(first, days + 1, tz) };
  if (ruleProblem(company, need, { startsAt: range.endsAt - 2 * HOUR, endsAt: range.endsAt - HOUR }, 0)?.includes("does not work in")) return [];
  const loaded = await loadCapacity(ctx, company, need, range);
  if (loaded.cleaners.length === 0) return [];
  const hours = businessSettingsOf(company).hours;
  const duration = Math.max(15, input.durationMinutes) * MINUTE;
  const out: Span[] = [];
  for (let offset = 0; offset <= days && out.length < limit; offset += 1) {
    const dayStart = addLocalDays(first, offset, tz);
    const weekday = localParts(dayStart + 12 * HOUR, tz).weekday;
    const windows = hours.length > 0 ? hours.filter((window) => window.weekday === weekday) : [{ weekday, startMinute: 8 * 60, endMinute: 17 * 60 }];
    let found = 0;
    for (const window of windows) {
      for (let minute = window.startMinute; minute * MINUTE + duration <= window.endMinute * MINUTE && found < 3 && out.length < limit; minute += 120) {
        const span = { startsAt: dayStart + minute * MINUTE, endsAt: dayStart + minute * MINUTE + duration };
        if (assessSlot(loaded, need, span, now, input.except).ok) {
          out.push(span);
          found += 1;
        }
      }
    }
  }
  return out;
}

/**
 * Reserves a time for one opportunity, if it is open right now. A mutation is one transaction, so two
 * prospects asking for the last opening at the same moment cannot both get it: the second one's check
 * sees the first one's hold. An opportunity holds at most one time; a new hold releases the old.
 */
export async function placeHold(ctx: MutationCtx, company: Doc<"companies">, opportunity: Doc<"salesOpportunities">, need: Need, span: Span): Promise<{ ok: true; hold: Doc<"salesHolds"> } | { ok: false; answer: SlotAnswer }> {
  const answer = await checkSlot(ctx, company, need, span, { opportunityId: opportunity._id });
  if (!answer.ok) return { ok: false, answer };
  await releaseHolds(ctx, opportunity, "released");
  const now = Date.now();
  const holdId = await ctx.db.insert("salesHolds", { companyId: company._id, opportunityId: opportunity._id, startsAt: span.startsAt, endsAt: span.endsAt, crew: need.crew, postalCode: normalizePostalCode(need.postalCode), status: "held", expiresAt: now + salesSettings(company).booking.holdMinutes * MINUTE, createdAt: now });
  await ctx.db.patch(opportunity._id, { booking: { ...opportunity.booking, holdId }, updatedAt: now });
  return { ok: true, hold: (await ctx.db.get(holdId))! };
}

export async function releaseHolds(ctx: MutationCtx, opportunity: Pick<Doc<"salesOpportunities">, "_id" | "companyId">, to: "released" | "converted" | "expired", jobId?: Id<"jobs">): Promise<void> {
  const holds = await ctx.db
    .query("salesHolds")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .take(20);
  for (const hold of holds) if (hold.status === "held") await ctx.db.patch(hold._id, { status: to, ...(jobId ? { jobId } : {}) });
}

/** The opportunity's live hold, if it has one that has not run out. */
export async function liveHold(ctx: Ctx, opportunity: Doc<"salesOpportunities">, now: number): Promise<Doc<"salesHolds"> | null> {
  const hold = opportunity.booking?.holdId ? await ctx.db.get(opportunity.booking.holdId) : null;
  return hold && hold.status === "held" && hold.expiresAt > now ? hold : null;
}
