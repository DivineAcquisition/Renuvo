/** Dates, times and money as a person reads them. Times are always on the company's clock. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function clock(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

export function dayName(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(at));
}

export function longDay(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date(at));
}

function dayKey(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(at));
}

/** "today at 2:00 PM", "tomorrow at 9:00 AM", or "Tue, Mar 2 at 9:00 AM". */
export function whenLabel(at: number, now: number, timezone: string): string {
  const key = dayKey(at, timezone);
  const time = clock(at, timezone);
  if (key === dayKey(now, timezone)) return `today at ${time}`;
  if (key === dayKey(now + DAY, timezone)) return `tomorrow at ${time}`;
  if (key === dayKey(now - DAY, timezone)) return `yesterday at ${time}`;
  return `${dayName(at, timezone)} at ${time}`;
}

/** "just now", "5 min ago", "3 h ago", then the day. */
export function ago(at: number, now: number, timezone: string): string {
  const diff = Math.max(0, now - at);
  if (diff < 90_000) return "just now";
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.round(diff / HOUR)} h ago`;
  return whenLabel(at, now, timezone);
}

/** How long until a deadline, or how late it is. */
export function until(deadline: number, now: number): { text: string; late: boolean; soon: boolean } {
  const diff = deadline - now;
  const size = Math.abs(diff);
  const amount = size < HOUR ? `${Math.max(1, Math.round(size / MINUTE))} min` : size < 2 * DAY ? `${Math.round(size / HOUR)} h` : `${Math.round(size / DAY)} days`;
  return diff < 0 ? { text: `${amount} overdue`, late: true, soon: true } : { text: `in ${amount}`, late: false, soon: diff < 4 * HOUR };
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/** The hour of the day on the company's clock, for the greeting. */
export function greeting(now: number, timezone: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** The instant of a date ("2027-03-02") and time ("14:30") on the company's clock. Null when either is not valid. */
export function zonedInstant(date: string, time: string, timezone: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wanted = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const asLocal = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  };
  // Shift by the zone's offset at that moment, then once more in case the first guess crossed a clock change.
  let at = wanted - (asLocal(wanted) - wanted);
  at -= asLocal(at) - wanted;
  return asLocal(at) === wanted ? at : null;
}

/** "12.50" → 1250. Null when it is not an amount of money. */
export function centsFrom(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** The date on the company's clock, as a date field takes it: "2027-03-02". */
export function localDate(at: number, timezone: string): string {
  return dayKey(at, timezone);
}

/** The time on the company's clock, as a time field takes it: "14:30". */
export function localTime(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}

/** Midnight at the start of this instant's day on the company's clock. */
export function localDayStart(at: number, timezone: string): number {
  return zonedInstant(dayKey(at, timezone), "00:00", timezone) ?? at;
}

/** The start of the day `days` after (or before) the day that starts at `dayStart`, across clock changes. */
export function addLocalDays(dayStart: number, days: number, timezone: string): number {
  return localDayStart(dayStart + days * DAY + 12 * HOUR, timezone);
}

/** "2 h", "1 h 30 min", "45 min". */
export function durationLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / MINUTE));
  const [hours, rest] = [Math.floor(minutes / 60), minutes % 60];
  return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
