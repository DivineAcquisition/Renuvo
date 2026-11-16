/**
 * Cookie and tracking choices on the public site. Pure: no React, no browser, no Next.js, so the
 * browser, the server and tests all decide the same way.
 *
 * Rules (docs/foundation/04-trust.md):
 * - Optional tools are off until a current, explicit choice turns them on. Closing the banner is not a choice.
 * - A Global Privacy Control signal is treated as opting out. Advertising stays off whatever the banner
 *   says. Analytics stays off unless the visitor turns analytics on themselves after the signal was seen.
 * - A choice is tied to a version of the cookie disclosure. When the disclosure changes in a way that
 *   needs a new choice, CONSENT_VERSION goes up and every stored choice stops counting.
 * - A choice lasts CONSENT_LIFETIME_DAYS (Selestial's setting, not a legal figure), then the banner asks again.
 */
export const CONSENT_COOKIE = "selestial_consent";
/** Raise when the categories or the tools in them change in a way a visitor should choose again for. */
export const CONSENT_VERSION = 1;
export const CONSENT_LIFETIME_DAYS = 365;

export const OPTIONAL_CATEGORIES = ["analytics", "advertising"] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type Category = "essential" | OptionalCategory;

export type Choice = {
  /** The disclosure version the choice was made under. */
  v: number;
  /** Analytics on. */
  a: boolean;
  /** Advertising on. */
  d: boolean;
  /** When it was made, ms since 1970. */
  t: number;
  /** Whether a Global Privacy Control signal was present when it was made. */
  g: boolean;
};

export function serializeChoice(choice: Choice): string {
  return `v=${choice.v}&a=${choice.a ? 1 : 0}&d=${choice.d ? 1 : 0}&t=${Math.round(choice.t)}&g=${choice.g ? 1 : 0}`;
}

/** Reads a stored choice. Anything malformed counts as no choice, so optional tools stay off. */
export function parseChoice(raw: string | null | undefined): Choice | null {
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const version = Number(params.get("v"));
  const at = Number(params.get("t"));
  if (!Number.isInteger(version) || !Number.isFinite(at) || at <= 0) return null;
  const flag = (key: string) => {
    const value = params.get(key);
    return value === "1" ? true : value === "0" ? false : null;
  };
  const a = flag("a");
  const d = flag("d");
  const g = flag("g");
  if (a === null || d === null || g === null) return null;
  return { v: version, a, d, t: at, g };
}

/** True when a stored choice still counts: same disclosure version, not expired, not from the future. */
export function isCurrent(choice: Choice | null, now: number, version = CONSENT_VERSION, lifetimeDays = CONSENT_LIFETIME_DAYS): choice is Choice {
  if (!choice || choice.v !== version) return false;
  const age = now - choice.t;
  return age >= -60_000 && age < lifetimeDays * 24 * 60 * 60 * 1000;
}

/** Whether one category may run right now. Essential always may; nothing optional runs without a current choice. */
export function allowed(category: Category, choice: Choice | null, gpc: boolean, now: number): boolean {
  if (category === "essential") return true;
  if (!isCurrent(choice, now)) return false;
  if (category === "advertising") return choice.d && !gpc;
  // With the signal on, analytics needs a choice made while the signal was on: the person saw it and still said yes.
  return choice.a && (!gpc || choice.g);
}

export function makeChoice(analytics: boolean, advertising: boolean, gpc: boolean, now: number): Choice {
  return { v: CONSENT_VERSION, a: analytics, d: advertising && !gpc, t: now, g: gpc };
}

/** Reads the cookie header a request or `document.cookie` carries. */
export function choiceFromCookieHeader(header: string | null | undefined): Choice | null {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    if (part.startsWith(`${CONSENT_COOKIE}=`)) {
      try {
        return parseChoice(decodeURIComponent(part.slice(CONSENT_COOKIE.length + 1)));
      } catch {
        return null;
      }
    }
  }
  return null;
}
