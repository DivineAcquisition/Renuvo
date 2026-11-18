/**
 * Recurring cadences: which calendar dates a recurring plan visits, on the company's clock.
 *
 * Pure and deterministic, so the browser's calendar preview and the server's visit sweep give the same
 * dates. Rules a person can read in the preview:
 *  - every 2 weeks / every 4 weeks count from the first-service date's week, on the chosen weekday;
 *  - monthly on day 29, 30 or 31 uses the month's last day when the month is shorter; day 0 means
 *    "the last day of each month";
 *  - twice monthly uses its two days of the month, clamped the same way;
 *  - a date the company marks closed or unavailable is never moved silently: it is returned as a
 *    conflict for a person (or Dispatch) to decide.
 * A visit's clock time comes from `localInstant`, which keeps 9:00 AM at 9:00 AM across daylight-saving
 * changes.
 */
import { localParts } from "../availability";
import { startOfLocalDay } from "../time";
import type { Schedule } from "../services/spec";

export type Cadence =
  | { kind: "weekly"; weekdays: number[] }
  | { kind: "every_2_weeks"; weekday: number }
  | { kind: "every_4_weeks"; weekday: number }
  | { kind: "monthly"; dayOfMonth: number }
  | { kind: "twice_monthly"; days: number[] };

export const CADENCE_KINDS = ["weekly", "every_2_weeks", "every_4_weeks", "monthly", "twice_monthly"] as const;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_MS = 86_400_000;

export function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(ms / DAY_MS);
}

export function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const day = dayNumber(date);
  if (day === null) throw new Error(`Not a date: ${date}`);
  return dayString(day + days);
}

/** 0 = Sunday. */
export function weekdayOf(date: string): number {
  const day = dayNumber(date);
  if (day === null) throw new Error(`Not a date: ${date}`);
  return (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday.
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Checks a cadence and returns a plain-language problem, or null. */
export function cadenceProblem(cadence: Cadence): string | null {
  const weekday = (n: number) => Number.isInteger(n) && n >= 0 && n <= 6;
  const monthDay = (n: number) => Number.isInteger(n) && n >= 0 && n <= 31;
  switch (cadence.kind) {
    case "weekly": {
      const days = new Set(cadence.weekdays);
      if (days.size === 0) return "Choose at least one day of the week.";
      if (days.size !== cadence.weekdays.length || !cadence.weekdays.every(weekday)) return "Choose each day of the week once.";
      return null;
    }
    case "every_2_weeks":
    case "every_4_weeks":
      return weekday(cadence.weekday) ? null : "Choose the day of the week.";
    case "monthly":
      return monthDay(cadence.dayOfMonth) ? null : "Choose a day of the month from 1 to 31, or the last day.";
    case "twice_monthly": {
      if (cadence.days.length !== 2 || !cadence.days.every(monthDay)) return "Choose two days of the month.";
      const [a, b] = [...cadence.days].sort((x, y) => (x === 0 ? 32 : x) - (y === 0 ? 32 : y));
      if (a === b) return "Choose two different days of the month.";
      if (a !== 0 && b !== 0 && b - a < 7) return "Twice a month needs the two days at least a week apart.";
      return null;
    }
  }
}

export function cadenceLabel(cadence: Cadence): string {
  const ordinal = (n: number) => (n === 0 ? "last day" : `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`);
  switch (cadence.kind) {
    case "weekly":
      return cadence.weekdays.length === 1 ? `Weekly on ${WEEKDAY_NAMES[cadence.weekdays[0]!]}` : `${cadence.weekdays.length}× a week (${[...cadence.weekdays].sort().map((d) => WEEKDAY_NAMES[d]!.slice(0, 3)).join(", ")})`;
    case "every_2_weeks":
      return `Every 2 weeks on ${WEEKDAY_NAMES[cadence.weekday]}`;
    case "every_4_weeks":
      return `Every 4 weeks on ${WEEKDAY_NAMES[cadence.weekday]}`;
    case "monthly":
      return `Monthly on the ${ordinal(cadence.dayOfMonth)}`;
    case "twice_monthly":
      return `Twice a month on the ${cadence.days.map(ordinal).join(" and ")}`;
  }
}

/** Visits in a typical week or month, for words only. Billing never uses it: it counts real dates. */
export function cadenceRate(cadence: Cadence): string {
  switch (cadence.kind) {
    case "weekly":
      return `${cadence.weekdays.length} visit${cadence.weekdays.length === 1 ? "" : "s"} a week`;
    case "every_2_weeks":
      return "2 or 3 visits a month (26 a year)";
    case "every_4_weeks":
      return "13 visits a year; one month in the year has two";
    case "monthly":
      return "1 visit a month";
    case "twice_monthly":
      return "2 visits a month";
  }
}

/**
 * The recurring-price tier a cadence uses in Services & Pricing. Several visits a week price each visit
 * as a weekly visit (each weekday recurs weekly). Every 4 weeks has its own tier and is never priced as
 * monthly.
 */
export function pricingSchedule(cadence: Cadence): Schedule {
  switch (cadence.kind) {
    case "weekly":
      return "every_7_days";
    case "every_2_weeks":
      return "every_14_days";
    case "every_4_weeks":
      return "every_28_days";
    case "monthly":
      return "once_per_month";
    case "twice_monthly":
      return "twice_per_month";
  }
}

/**
 * The cadence's dates from `start` (inclusive) to `until` (inclusive). For weekly-type cadences the
 * series is anchored on `anchor` (the plan's first date), so changing the window later does not shift
 * which weeks are "on". Never more than `limit` dates.
 */
export function cadenceDates(cadence: Cadence, anchor: string, start: string, until: string, limit = 400): string[] {
  const a = dayNumber(anchor);
  const s = dayNumber(start);
  const u = dayNumber(until);
  if (a === null || s === null || u === null || u < s || cadenceProblem(cadence)) return [];
  const out: string[] = [];
  if (cadence.kind === "weekly" || cadence.kind === "every_2_weeks" || cadence.kind === "every_4_weeks") {
    const step = cadence.kind === "weekly" ? 1 : cadence.kind === "every_2_weeks" ? 2 : 4;
    const weekdays = cadence.kind === "weekly" ? new Set(cadence.weekdays) : new Set([cadence.weekday]);
    // Week index counted from the Sunday on or before the anchor.
    const anchorWeekStart = a - weekdayOf(dayString(a));
    for (let day = Math.max(s, a); day <= u && out.length < limit; day += 1) {
      const date = dayString(day);
      if (!weekdays.has(weekdayOf(date))) continue;
      const week = Math.floor((day - anchorWeekStart) / 7);
      if (week % step === 0) out.push(date);
    }
    return out;
  }
  const days = cadence.kind === "monthly" ? [cadence.dayOfMonth] : cadence.days;
  const from = new Date(Math.max(s, a) * DAY_MS);
  for (let i = 0; out.length < limit; i += 1) {
    const year = from.getUTCFullYear() + Math.floor((from.getUTCMonth() + i) / 12);
    const month0 = (from.getUTCMonth() + i) % 12;
    if (Date.UTC(year, month0, 1) / DAY_MS > u) break;
    const last = lastDayOfMonth(year, month0);
    const picked = [...new Set(days.map((d) => (d === 0 ? last : Math.min(d, last))))].sort((x, y) => x - y);
    for (const d of picked) {
      const day = Math.round(Date.UTC(year, month0, d) / DAY_MS);
      if (day >= Math.max(s, a) && day <= u) out.push(dayString(day));
    }
  }
  return out;
}

/** The instant a local date and minute-of-day happen on the company's clock, across daylight-saving changes. */
export function localInstant(date: string, minuteOfDay: number, timezone: string): number {
  const day = dayNumber(date);
  if (day === null) throw new Error(`Not a date: ${date}`);
  const midnight = startOfLocalDay(day * DAY_MS + DAY_MS / 2, timezone);
  let at = midnight + minuteOfDay * 60_000;
  // A clock change between midnight and the visit moves the wall clock; correct it once.
  const actual = localParts(at, timezone);
  if (actual.day === date && actual.minute !== minuteOfDay) at += (minuteOfDay - actual.minute) * 60_000;
  return at;
}

export type PreviewVisit = { date: string; first: boolean; conflict: string | null };

/**
 * The next visits of a plan for the calendar preview: the cadence's dates, with the first one marked and
 * each closed or unavailable day marked as a conflict (never moved).
 */
export function previewVisits(input: { cadence: Cadence; firstDate: string; endDate?: string; count: number; closedWeekdays?: number[]; blockedDates?: string[] }): PreviewVisit[] {
  const until = input.endDate ?? addDays(input.firstDate, 400);
  const dates = cadenceDates(input.cadence, input.firstDate, input.firstDate, until, input.count);
  const closed = new Set(input.closedWeekdays ?? []);
  const blocked = new Set(input.blockedDates ?? []);
  return dates.map((date, index) => ({
    date,
    first: index === 0,
    conflict: blocked.has(date) ? "The company marked this date unavailable." : closed.has(weekdayOf(date)) ? "The company is closed on this weekday." : null,
  }));
}

/** Calendar months and how many visits fall in each, from real dates (never "4 a month" for weekly). */
export function visitsPerMonth(dates: string[]): { month: string; visits: number }[] {
  const counts = new Map<string, number>();
  for (const date of dates) counts.set(date.slice(0, 7), (counts.get(date.slice(0, 7)) ?? 0) + 1);
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, visits]) => ({ month, visits }));
}
