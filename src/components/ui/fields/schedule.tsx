"use client";

import { CheckCircle2, Clock, Info, Loader2, TriangleAlert } from "@/components/icons";
import { clock, longDay } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { durationWords } from "./number";

/** The zone's name as people say it: "Central Time", falling back to the identifier. */
export function zoneName(timezone: string, at = Date.now()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "long" }).formatToParts(new Date(at)).find((row) => row.type === "timeZoneName")?.value;
    return part ? part.replace(/ (Standard|Daylight) Time$/, " Time") : timezone;
  } catch {
    return timezone;
  }
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((row) => row.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return Math.round((local - Math.floor(at / 60000) * 60000) / 60000);
}

/** Whether the zone's clocks change between two instants (a daylight-saving start or end). */
export function crossesClockChange(startsAt: number, endsAt: number, timezone: string): boolean {
  return offsetMinutes(endsAt, timezone) !== offsetMinutes(startsAt, timezone);
}

const sameDay = (a: number, b: number, timezone: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(a)) === new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(b));

/** "9:00–11:30 AM", sharing the AM/PM when both are on the same side. */
export function timeRange(from: number, to: number, timezone: string): string {
  const [a, b] = [clock(from, timezone), clock(to, timezone)];
  const [ma, mb] = [a.slice(-2), b.slice(-2)];
  return ma === mb ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
}

/**
 * A visit's time in words, on the company's clock: the day and times, how long it lasts, the arrival
 * window and any deadline. It reads instants, so the length is real elapsed time even across a clock
 * change, and it says so when one happens. An end before the start is shown as a problem, never quietly
 * read as the next day.
 */
export function ScheduleSummary({ startsAt, endsAt, timezone, arrivalWindowMinutes, deadlineAt, label = "Company time", className }: { startsAt: number | null; endsAt: number | null; timezone: string; arrivalWindowMinutes?: number | null; deadlineAt?: number | null; label?: string; className?: string }) {
  if (startsAt === null || endsAt === null) {
    return <p className={cn("text-xs text-muted-foreground", className)}>Choose the day and both times to see the visit summarized.</p>;
  }
  if (endsAt <= startsAt) {
    return (
      <p role="alert" className={cn("flex gap-1.5 text-xs font-medium text-destructive-foreground", className)}>
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        The end time is not after the start time. Change one of them.
      </p>
    );
  }
  const minutes = Math.round((endsAt - startsAt) / 60000);
  const overnight = !sameDay(startsAt, endsAt, timezone);
  const shift = crossesClockChange(startsAt, endsAt, timezone) ? 1 : 0;
  const arrivalEnd = arrivalWindowMinutes ? startsAt + arrivalWindowMinutes * 60000 : null;
  return (
    <div className={cn("grid gap-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs", className)} aria-live="polite">
      <p className="text-sm font-medium text-strong">
        {longDay(startsAt, timezone).split(",")[0]} · {overnight ? `${clock(startsAt, timezone)} – ${longDay(endsAt, timezone).split(",")[0]} ${clock(endsAt, timezone)}` : timeRange(startsAt, endsAt, timezone)}
      </p>
      <p className="text-muted-foreground">
        {durationWords(minutes)} · {label}, {zoneName(timezone, startsAt)}
      </p>
      {arrivalEnd ? <p className="text-muted-foreground">Arrival window: {timeRange(startsAt, arrivalEnd, timezone)}</p> : null}
      {deadlineAt ? <p className={deadlineAt < endsAt ? "font-medium text-destructive-foreground" : "text-muted-foreground"}>Must be finished by {longDay(deadlineAt, timezone).split(",")[0]} {clock(deadlineAt, timezone)}{deadlineAt < endsAt ? ", before the visit ends." : ""}</p> : null}
      {overnight ? <p className="text-strong">This visit runs past midnight.</p> : null}
      {shift !== 0 ? <p className="text-strong">The clocks change during this visit, so it lasts {durationWords(minutes)} of real time.</p> : null}
    </div>
  );
}

export type AvailabilityState = { state: "not_checked" } | { state: "checking" } | { state: "available"; checkedAt?: number } | { state: "conflict"; reasons: readonly string[] } | { state: "failed" };

/**
 * What is known about whether a time is free, in one of four honest states. "Available" always says when
 * it was checked: it is not a reservation, and the server checks again when the change is confirmed.
 */
export function AvailabilityStatus({ status, timezone, className }: { status: AvailabilityState; timezone: string; className?: string }) {
  const row = "flex items-start gap-1.5 text-xs";
  if (status.state === "checking")
    return (
      <p className={cn(row, "text-muted-foreground", className)} role="status">
        <Loader2 className="mt-px size-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        Checking this time…
      </p>
    );
  if (status.state === "available")
    return (
      <p className={cn(row, "text-success-foreground", className)} role="status">
        <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          {status.checkedAt ? `Available when checked at ${clock(status.checkedAt, timezone)}.` : "Available when last checked."} <span className="text-muted-foreground">It is checked again when you confirm; nothing is held until then.</span>
        </span>
      </p>
    );
  if (status.state === "conflict")
    return (
      <div className={cn(row, "text-destructive-foreground", className)} role="alert">
        <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        <span>
          Conflict found.
          {status.reasons.length ? (
            <ul className="mt-0.5 grid gap-0.5">
              {status.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </span>
      </div>
    );
  if (status.state === "failed")
    return (
      <p className={cn(row, "text-warning-foreground", className)} role="alert">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />
        Availability could not be checked. You can still continue; it is checked when you confirm.
      </p>
    );
  return (
    <p className={cn(row, "text-muted-foreground", className)}>
      <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
      Availability not checked yet.
    </p>
  );
}

/** The one line that says which clock a date or time field uses. */
export function TimezoneNote({ timezone, className }: { timezone: string; className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Clock className="size-3.5" aria-hidden />
      Times are on the company&apos;s clock: {zoneName(timezone)}.
    </p>
  );
}
