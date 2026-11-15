/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { PER_VISITOR_PER_HOUR } from "./earlyAccess";
import { NOT_FOUND } from "./lib/errors";

const secret = "test-secret-value";
const answers = { role: "owner", businessType: "residential", cleaners: "5_14", monthlyCleans: "50_149", bookingTool: "jobber", help: "dispatch", openTo: "test_one_workflow" };
const entry = { secret, name: "Dana Whitfield", email: "Dana@SparkleCo.com", company: "Sparkle Co", ...answers, visitorKey: "visitor-1" };

const rows = (t: T) => t.query(internal.earlyAccess.list, {});

describe("early-access requests", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_FORM_SECRET", secret);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("is closed to anyone who is not the web server", async () => {
    const t = start();
    expect(await refusal(t.mutation(api.earlyAccess.request, { ...entry, secret: "wrong-secret-value" }))).toBe(NOT_FOUND);
    expect(await refusal(t.mutation(api.earlyAccess.request, { ...entry, secret: "" }))).toBe(NOT_FOUND);
    vi.stubEnv("PUBLIC_FORM_SECRET", "");
    expect(await refusal(t.mutation(api.earlyAccess.request, { ...entry, secret: "" }))).toBe(NOT_FOUND);
    expect(await rows(t)).toEqual([]);
  });

  it("saves a request and says so", async () => {
    const t = start();
    expect(await t.mutation(api.earlyAccess.request, entry)).toEqual({ status: "saved" });
    const saved = await rows(t);
    expect(saved).toHaveLength(1);
    // Every answer is kept, and "needs the most help" names the agent it points at.
    expect(saved[0]).toMatchObject({ name: "Dana Whitfield", email: "dana@sparkleco.com", company: "Sparkle Co", ...answers, focus: "Dispatch", requests: 1 });
    expect(saved[0].phone).toBeUndefined();
    expect(saved[0].smsConsentAt).toBeUndefined();
  });

  it("keeps one row per email and takes the latest answers", async () => {
    const t = start();
    await t.mutation(api.earlyAccess.request, entry);
    expect(await t.mutation(api.earlyAccess.request, { ...entry, email: " dana@sparkleco.com ", help: "sales", company: "Sparkle Cleaning" })).toEqual({ status: "saved" });
    const saved = await rows(t);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ focus: "Sales", help: "sales", company: "Sparkle Cleaning", requests: 2 });
  });

  it("refuses what is not a real request and saves nothing", async () => {
    const t = start();
    const bad = [
      { ...entry, name: "   " },
      { ...entry, email: "not-an-email" },
      { ...entry, company: "" },
      { ...entry, help: "everything" },
      { ...entry, role: "" },
      { ...entry, bookingTool: "Jobber" },
      { ...entry, phone: "call me" },
      { ...entry, website: "not a site" },
      { ...entry, name: "x".repeat(121) },
    ];
    for (const args of bad) expect(await t.mutation(api.earlyAccess.request, args)).toEqual({ status: "invalid" });
    expect(await rows(t)).toEqual([]);
  });

  it("keeps the optional phone and website, and records consent to texts only when it was given with a number", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2027, 0, 5, 12));
    const t = start();
    await t.mutation(api.earlyAccess.request, { ...entry, phone: " (512) 555-0142 ", website: "sparkleco.com", smsConsent: true });
    expect((await rows(t))[0]).toMatchObject({ phone: "(512) 555-0142", website: "sparkleco.com", smsConsentAt: Date.UTC(2027, 0, 5, 12) });
    // A number alone is not consent, and a ticked box with no number is not consent either.
    await t.mutation(api.earlyAccess.request, { ...entry, email: "b@example.com", phone: "5125550142" });
    await t.mutation(api.earlyAccess.request, { ...entry, email: "c@example.com", smsConsent: true });
    const saved = await rows(t);
    expect(saved.find((row) => row.email === "b@example.com")).toMatchObject({ phone: "5125550142" });
    expect(saved.find((row) => row.email === "b@example.com")?.smsConsentAt).toBeUndefined();
    expect(saved.find((row) => row.email === "c@example.com")?.smsConsentAt).toBeUndefined();
    // Asking again without the box withdraws it.
    await t.mutation(api.earlyAccess.request, { ...entry, phone: "(512) 555-0142" });
    expect((await rows(t)).find((row) => row.email === "dana@sparkleco.com")?.smsConsentAt).toBeUndefined();
  });

  it("limits one visitor per hour, never reports a limited request as saved, and opens again later", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2027, 0, 5, 12));
    const t = start();
    for (let i = 0; i < PER_VISITOR_PER_HOUR; i += 1) {
      expect(await t.mutation(api.earlyAccess.request, { ...entry, email: `person${i}@example.com` })).toEqual({ status: "saved" });
    }
    expect(await t.mutation(api.earlyAccess.request, { ...entry, email: "one-too-many@example.com" })).toEqual({ status: "limited" });
    expect(await rows(t)).toHaveLength(PER_VISITOR_PER_HOUR);
    // Someone else is not held back by that visitor.
    expect(await t.mutation(api.earlyAccess.request, { ...entry, email: "other@example.com", visitorKey: "visitor-2" })).toEqual({ status: "saved" });

    vi.setSystemTime(Date.UTC(2027, 0, 5, 13, 1));
    expect(await t.mutation(api.earlyAccess.request, { ...entry, email: "one-too-many@example.com" })).toEqual({ status: "saved" });
  });
});
