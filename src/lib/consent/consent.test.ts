import { describe, expect, it } from "vitest";

import { allowed, CONSENT_COOKIE, CONSENT_LIFETIME_DAYS, CONSENT_VERSION, choiceFromCookieHeader, isCurrent, makeChoice, parseChoice, serializeChoice } from "./model";
import { pageForTools, trackingAllowedOn } from "./pages";
import { gpcFromHeaders, serverEventAllowed } from "./server";
import { trackingTools } from "./tools";

const NOW = Date.UTC(2026, 10, 16, 12);
const DAY = 86_400_000;
const header = (choice: ReturnType<typeof makeChoice>) => `other=1; ${CONSENT_COOKIE}=${encodeURIComponent(serializeChoice(choice))}`;
const request = (cookie: string | null, gpc = false) => ({ headers: { get: (name: string) => (name === "cookie" ? cookie : name === "sec-gpc" && gpc ? "1" : null) } });

describe("a choice", () => {
  it("round-trips, and anything malformed counts as no choice", () => {
    const choice = makeChoice(true, false, false, NOW);
    expect(parseChoice(serializeChoice(choice))).toEqual(choice);
    for (const bad of [null, "", "v=1", "v=x&a=1&d=1&t=1&g=0", "v=1&a=yes&d=1&t=1&g=0", "v=1&a=1&d=1&t=-5&g=0"]) expect(parseChoice(bad)).toBeNull();
    expect(choiceFromCookieHeader(header(choice))).toEqual(choice);
    expect(choiceFromCookieHeader("a=b")).toBeNull();
  });

  it("counts only under the current disclosure version and only for its lifetime", () => {
    const choice = makeChoice(true, true, false, NOW);
    expect(isCurrent(choice, NOW + (CONSENT_LIFETIME_DAYS - 1) * DAY)).toBe(true);
    expect(isCurrent(choice, NOW + CONSENT_LIFETIME_DAYS * DAY)).toBe(false);
    expect(isCurrent({ ...choice, v: CONSENT_VERSION + 1 }, NOW)).toBe(false);
    expect(isCurrent(null, NOW)).toBe(false);
  });
});

describe("what may run", () => {
  it("essential always; nothing optional without a choice", () => {
    expect(allowed("essential", null, false, NOW)).toBe(true);
    expect(allowed("analytics", null, false, NOW)).toBe(false);
    expect(allowed("advertising", null, false, NOW)).toBe(false);
  });

  it("follows the choice, category by category, and stops after withdrawal or expiry", () => {
    const yes = makeChoice(true, true, false, NOW);
    const analyticsOnly = makeChoice(true, false, false, NOW);
    expect(allowed("analytics", yes, false, NOW)).toBe(true);
    expect(allowed("advertising", yes, false, NOW)).toBe(true);
    expect(allowed("advertising", analyticsOnly, false, NOW)).toBe(false);
    const withdrawn = makeChoice(false, false, false, NOW + DAY);
    expect(allowed("analytics", withdrawn, false, NOW + DAY)).toBe(false);
    expect(allowed("analytics", yes, false, NOW + CONSENT_LIFETIME_DAYS * DAY)).toBe(false);
  });

  it("treats Global Privacy Control as opting out: advertising never, analytics only if chosen with the signal on", () => {
    const before = makeChoice(true, true, false, NOW);
    expect(allowed("advertising", before, true, NOW)).toBe(false);
    expect(allowed("analytics", before, true, NOW)).toBe(false);
    const after = makeChoice(true, true, true, NOW);
    expect(after.d).toBe(false);
    expect(allowed("analytics", after, true, NOW)).toBe(true);
    expect(allowed("advertising", after, true, NOW)).toBe(false);
  });
});

describe("where tracking may run", () => {
  it("only on the public marketing pages", () => {
    for (const path of ["/", "/security", "/privacy", "/terms", "/cookies", "/messaging", "/assessment", "/security/subprocessors"]) expect(trackingAllowedOn(path), path).toBe(true);
    for (const path of ["/app", "/app/settings", "/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/invite/abc.def", "/c/offer/abc", "/c/job/abc/photos", "/privacy/requests", "/security/report", "/security/review", "/apply/abc"]) expect(trackingAllowedOn(path), path).toBe(false);
  });

  it("never on an address carrying a token, and tools are told the path only", () => {
    expect(trackingAllowedOn("/", "?token=abc")).toBe(false);
    expect(trackingAllowedOn("/", "?__clerk_status=verified")).toBe(false);
    expect(trackingAllowedOn("/", "?utm_source=google")).toBe(true);
    expect(pageForTools("https://www.selestial.io", "/cookies")).toBe("https://www.selestial.io/cookies");
  });
});

describe("server-side events", () => {
  it("follow the browser's choice, the signal and the page rule", () => {
    const yes = header(makeChoice(true, true, false, NOW));
    expect(serverEventAllowed(request(yes), "advertising", { pathname: "/assessment" }, NOW)).toBe(true);
    expect(serverEventAllowed(request(null), "advertising", { pathname: "/assessment" }, NOW)).toBe(false);
    expect(serverEventAllowed(request(yes, true), "advertising", { pathname: "/assessment" }, NOW)).toBe(false);
    expect(serverEventAllowed(request(yes), "advertising", { pathname: "/app" }, NOW)).toBe(false);
    expect(serverEventAllowed(request(header(makeChoice(false, false, false, NOW))), "analytics", { pathname: "/" }, NOW)).toBe(false);
    expect(gpcFromHeaders(request(null, true).headers)).toBe(true);
  });
});

describe("the tools", () => {
  it("are off unless their setting is present and well formed", () => {
    expect(trackingTools({}).every((tool) => tool.id === null)).toBe(true);
    const on = trackingTools({ NEXT_PUBLIC_VERCEL_ANALYTICS: "1", NEXT_PUBLIC_GA4_ID: "G-ABC1234", NEXT_PUBLIC_GOOGLE_ADS_ID: "AW-1234567", NEXT_PUBLIC_META_PIXEL_ID: "1234567890123" });
    expect(on.map((tool) => [tool.key, tool.category, Boolean(tool.id)])).toEqual([
      ["vercel-analytics", "analytics", true],
      ["ga4", "analytics", true],
      ["google-ads", "advertising", true],
      ["meta-pixel", "advertising", true],
    ]);
    expect(trackingTools({ NEXT_PUBLIC_GA4_ID: "<script>" })[1].id).toBeNull();
  });
});
