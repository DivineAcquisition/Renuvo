"use client";

/** Time on the company's clock for the phone portals: the current minute, formatting, and a local date and time to an instant. */
import { useSyncExternalStore } from "react";

const minute = () => Math.floor(Date.now() / 60_000) * 60_000;
const subscribe = (change: () => void) => {
  const timer = setInterval(change, 30_000);
  return () => clearInterval(timer);
};

export function useMinute() {
  return useSyncExternalStore(subscribe, minute, () => 0);
}

export function fmt(at: number, timezone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...options }).format(new Date(at));
}

/** "2027-03-02" and "09:30" on the company's clock, as an instant. */
export function zoned(date: string, time: string, timezone: string): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const wanted = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  const local = (at: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  };
  let at = wanted - (local(wanted) - wanted);
  at -= local(at) - wanted;
  return at;
}
