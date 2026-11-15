"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const minute = () => Math.floor(Date.now() / MINUTE) * MINUTE;

function subscribe(onChange: () => void) {
  const timer = setInterval(onChange, 15_000);
  return () => clearInterval(timer);
}

/**
 * The current time, to the minute. Queries take it as an argument, so a deadline that passes shows as
 * late without anyone reloading, and the same minute reuses the same result.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, minute, () => 0);
}
