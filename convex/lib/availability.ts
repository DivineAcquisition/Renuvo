/**
 * When a cleaner can work. Pure functions, so the same check runs in a mutation and in a test.
 * A cleaner is never offered a time they have not said they can work (brief, section 5).
 */
export type WeeklyWindow = { weekday: number; startMinute: number; endMinute: number };
export type Span = { startsAt: number; endsAt: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The weekday (0 is Sunday), minute of the day and calendar day of an instant, on the company's clock. */
export function localParts(at: number, timezone: string): { weekday: number; minute: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: WEEKDAYS.indexOf(get("weekday")),
    minute: Number(get("hour")) * 60 + Number(get("minute")),
    day: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

export function overlaps(a: Span, b: Span): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/**
 * True when the whole span sits inside one of the cleaner's weekly windows. A span that crosses midnight
 * on the company's clock is not covered by any window: windows are per day.
 */
export function withinWeeklyWindows(windows: WeeklyWindow[], span: Span, timezone: string): boolean {
  const start = localParts(span.startsAt, timezone);
  const end = localParts(span.endsAt, timezone);
  if (start.day !== end.day) return false;
  return windows.some((window) => window.weekday === start.weekday && window.startMinute <= start.minute && end.minute <= window.endMinute);
}

export type AvailabilityAnswer = { available: true } | { available: false; reason: "outside_hours" | "time_off" | "already_booked" };

export function availabilityFor(input: { windows: WeeklyWindow[]; timeOff: Span[]; booked: Span[]; span: Span; timezone: string }): AvailabilityAnswer {
  if (!withinWeeklyWindows(input.windows, input.span, input.timezone)) return { available: false, reason: "outside_hours" };
  if (input.timeOff.some((off) => overlaps(off, input.span))) return { available: false, reason: "time_off" };
  if (input.booked.some((other) => overlaps(other, input.span))) return { available: false, reason: "already_booked" };
  return { available: true };
}

export const UNAVAILABLE_WORDS: Record<"outside_hours" | "time_off" | "already_booked", string> = {
  outside_hours: "This cleaner has not said they can work at that time.",
  time_off: "This cleaner has time off then.",
  already_booked: "This cleaner already has an offer or a job that overlaps this one.",
};
