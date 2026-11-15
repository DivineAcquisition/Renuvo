/** Days and clock times on the company's clock. Code produces every date and time a person reads. */
import { localParts } from "./availability";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The instant the company's local day containing `at` began. */
export function startOfLocalDay(at: number, timezone: string): number {
  let start = Math.floor(at / MINUTE) * MINUTE - localParts(at, timezone).minute * MINUTE;
  // On a day the clocks change, the first guess can land an hour off midnight.
  const minute = localParts(start, timezone).minute;
  if (minute !== 0) start += (minute > 720 ? 1440 - minute : -minute) * MINUTE;
  return start;
}

/** The start of the local day `days` after the day that starts at `dayStart`. */
export function addLocalDays(dayStart: number, days: number, timezone: string): number {
  return startOfLocalDay(dayStart + days * DAY + DAY / 2, timezone);
}

export function clock(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

export function dayName(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(at));
}

/** "today at 2:00 PM", "tomorrow at 9:00 AM" or "Tue, Mar 2 at 9:00 AM", relative to `asOf`. */
export function when(at: number, asOf: number, timezone: string): string {
  const today = startOfLocalDay(asOf, timezone);
  const day = startOfLocalDay(at, timezone);
  const time = clock(at, timezone);
  if (day === today) return `today at ${time}`;
  if (day === addLocalDays(today, 1, timezone)) return `tomorrow at ${time}`;
  if (day === addLocalDays(today, -1, timezone)) return `yesterday at ${time}`;
  return `${dayName(at, timezone)} at ${time}`;
}
