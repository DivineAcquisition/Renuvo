"use client";

import { useSyncExternalStore } from "react";

import { CONSENT_COOKIE, CONSENT_LIFETIME_DAYS, choiceFromCookieHeader, isCurrent, makeChoice, serializeChoice, type Choice } from "@/lib/consent/model";
import { OPTIONAL_COOKIE_PREFIXES } from "@/lib/consent/tools";

export const CHANGED = "selestial:consent";
export const OPEN = "selestial:consent-open";
/** Hides the banner for this tab after "Close". It records no choice: optional tools stay off. */
const CLOSED_KEY = "selestial.consent.closed";

export type Snapshot = { ready: boolean; choice: Choice | null; current: boolean; gpc: boolean; closed: boolean };

const SERVER: Snapshot = { ready: false, choice: null, current: false, gpc: false, closed: false };
let cached: { key: string; value: Snapshot } | null = null;

function gpcOn(): boolean {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function closedThisTab(): boolean {
  try {
    return window.sessionStorage.getItem(CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

function read(): Snapshot {
  const raw = document.cookie;
  const gpc = gpcOn();
  const closed = closedThisTab();
  const key = `${raw}|${gpc}|${closed}`;
  if (cached?.key === key) return cached.value;
  const choice = choiceFromCookieHeader(raw);
  const value = { ready: true, choice, current: isCurrent(choice, Date.now()), gpc, closed };
  cached = { key, value };
  return value;
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("focus", onChange);
  };
}

/** The visitor's choice, re-read whenever it changes. Before the page is interactive it is "not ready", so nothing optional runs. */
export function useConsent(): Snapshot {
  return useSyncExternalStore(subscribe, read, () => SERVER);
}

/** Removes cookies the optional tools left, on this host and its parent domain. Best effort: a browser may keep some. */
function clearOptionalCookies() {
  const names = document.cookie
    .split(/;\s*/)
    .map((part) => part.split("=")[0])
    .filter((name) => OPTIONAL_COOKIE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  const host = window.location.hostname;
  const parent = host.split(".").slice(-2).join(".");
  for (const name of names) {
    for (const domain of ["", `; domain=${host}`, `; domain=.${parent}`]) document.cookie = `${name}=; Max-Age=0; Path=/${domain}`;
  }
}

/**
 * Saves a choice. Returns false when the browser refused to keep it, in which case nothing optional runs.
 * Withdrawing something that was on reloads the page, because a script that already ran cannot be unloaded.
 */
export function saveChoice(analytics: boolean, advertising: boolean): boolean {
  const before = read();
  const choice = makeChoice(analytics, advertising, gpcOn(), Date.now());
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(serializeChoice(choice))}; Path=/; Max-Age=${CONSENT_LIFETIME_DAYS * 86400}; SameSite=Lax${secure}`;
  } catch {
    return false;
  }
  const saved = choiceFromCookieHeader(document.cookie);
  if (!saved || saved.t !== choice.t) return false;
  const withdrew = (before.current && before.choice?.a && !choice.a) || (before.current && before.choice?.d && !choice.d);
  if (!choice.a || !choice.d) clearOptionalCookies();
  window.dispatchEvent(new Event(CHANGED));
  if (withdrew) window.location.reload();
  return true;
}

export function closeWithoutChoosing() {
  try {
    window.sessionStorage.setItem(CLOSED_KEY, "1");
  } catch {
    // Without storage the banner simply shows again on the next page.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function openPreferences() {
  window.dispatchEvent(new Event(OPEN));
}
