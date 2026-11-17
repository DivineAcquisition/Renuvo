/**
 * A cleaner's time as the record knows it: the jobs they hold (from Dispatch's assignments), the time away
 * and date exceptions they gave, and their weekly pattern. Read here, decided in attention.ts and in
 * Dispatch's own eligibility rules.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts, type Span } from "../availability";
import { addLocalDays, clock, dayName, startOfLocalDay } from "../time";
import type { Absence, Commitment } from "./attention";

type Ctx = QueryCtx | MutationCtx;
const MINUTE = 60_000;

export function jobLabel(job: Pick<Doc<"jobs">, "serviceType" | "startsAt">, customer: string | null, timezone: string): string {
  return `${job.serviceType} for ${customer ?? "a customer"}, ${dayName(job.startsAt, timezone)} ${clock(job.startsAt, timezone)}`;
}

/** Live jobs from `from` to `to`, and every offered or accepted assignment on them, by cleaner. */
export async function commitmentsBetween(ctx: Ctx, company: Doc<"companies">, from: number, to: number): Promise<Map<string, Commitment[]>> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", from).lt("startsAt", to))
    .take(1000);
  const customers = new Map<string, string | null>();
  const out = new Map<string, Commitment[]>();
  for (const job of jobs) {
    if (job.status === "cancelled") continue;
    if (!customers.has(job.customerId)) customers.set(job.customerId, (await ctx.db.get(job.customerId))?.name ?? null);
    const label = jobLabel(job, customers.get(job.customerId) ?? null, company.timezone);
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id))
      .take(50);
    for (const row of assignments) {
      if (row.status !== "offered" && row.status !== "accepted") continue;
      const list = out.get(row.cleanerId) ?? [];
      list.push({ jobId: job._id, assignmentId: row._id, startsAt: job.startsAt, endsAt: job.endsAt, label, status: row.status });
      out.set(row.cleanerId, list);
    }
  }
  return out;
}

/** One local day's span on the company's clock, from a YYYY-MM-DD date. */
export function daySpan(date: string, timezone: string): Span {
  const [y, m, d] = date.split("-").map(Number);
  const start = startOfLocalDay(Date.UTC(y, m - 1, d, 12), timezone);
  return { startsAt: start, endsAt: addLocalDays(start, 1, timezone) };
}

/** An exception's span: the whole day, or the minutes it names. */
export function exceptionSpan(row: Pick<Doc<"availabilityExceptions">, "date" | "startMinute" | "endMinute">, timezone: string): Span {
  const day = daySpan(row.date, timezone);
  if (row.startMinute === undefined || row.endMinute === undefined) return day;
  return { startsAt: day.startsAt + row.startMinute * MINUTE, endsAt: day.startsAt + row.endMinute * MINUTE };
}

export type TimeFacts = { absences: Absence[]; extraAvailable: Span[] };

/** Time away and date exceptions from `from` onward, for every cleaner in the company. */
export async function companyTime(ctx: Ctx, company: Doc<"companies">, from: number): Promise<Map<string, TimeFacts>> {
  const out = new Map<string, TimeFacts>();
  const get = (id: string) => {
    const found = out.get(id) ?? { absences: [], extraAvailable: [] };
    out.set(id, found);
    return found;
  };
  const off = await ctx.db
    .query("timeOff")
    .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", company._id))
    .take(5000);
  for (const row of off) if (row.endsAt > from) get(row.cleanerId).absences.push({ kind: "time_off", span: { startsAt: row.startsAt, endsAt: row.endsAt }, note: row.note });
  const fromDay = localParts(from, company.timezone).day;
  const exceptions = await ctx.db
    .query("availabilityExceptions")
    .withIndex("by_company_cleaner_date", (q) => q.eq("companyId", company._id))
    .take(5000);
  for (const row of exceptions) {
    if (row.date < fromDay) continue;
    const span = exceptionSpan(row, company.timezone);
    if (row.kind === "unavailable") get(row.cleanerId).absences.push({ kind: "exception", span, note: row.note });
    else get(row.cleanerId).extraAvailable.push(span);
  }
  return out;
}

export async function cleanerTime(ctx: Ctx, company: Doc<"companies">, cleanerId: Id<"cleaners">, from: number): Promise<TimeFacts & { timeOff: Doc<"timeOff">[]; exceptions: Doc<"availabilityExceptions">[] }> {
  const timeOff = await ctx.db
    .query("timeOff")
    .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId).gt("endsAt", from))
    .take(200);
  const fromDay = localParts(from, company.timezone).day;
  const exceptions = await ctx.db
    .query("availabilityExceptions")
    .withIndex("by_company_cleaner_date", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId).gte("date", fromDay))
    .take(200);
  return {
    timeOff,
    exceptions,
    absences: [
      ...timeOff.map((row) => ({ kind: "time_off" as const, span: { startsAt: row.startsAt, endsAt: row.endsAt }, note: row.note })),
      ...exceptions.filter((row) => row.kind === "unavailable").map((row) => ({ kind: "exception" as const, span: exceptionSpan(row, company.timezone), note: row.note })),
    ],
    extraAvailable: exceptions.filter((row) => row.kind === "available").map((row) => exceptionSpan(row, company.timezone)),
  };
}
