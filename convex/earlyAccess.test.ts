/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { PER_VISITOR_PER_HOUR } from "./earlyAccess";
import { NOT_FOUND } from "./lib/errors";

const secret = "test-secret-value";
const entry = { secret, name: "Dana Whitfield", email: "Dana@SparkleCo.com", company: "Sparkle Co", focus: "Dispatch", visitorKey: "visitor-1" };

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
    expect(saved[0]).toMatchObject({ name: "Dana Whitfield", email: "dana@sparkleco.com", company: "Sparkle Co", focus: "Dispatch", requests: 1 });
  });

  it("keeps one row per email and takes the latest answers", async () => {
    const t = start();
    await t.mutation(api.earlyAccess.request, entry);
    expect(await t.mutation(api.earlyAccess.request, { ...entry, email: " dana@sparkleco.com ", focus: "Sales", company: "Sparkle Cleaning" })).toEqual({ status: "saved" });
    const saved = await rows(t);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ focus: "Sales", company: "Sparkle Cleaning", requests: 2 });
  });

  it("refuses what is not a real request and saves nothing", async () => {
    const t = start();
    const bad = [
      { ...entry, name: "   " },
      { ...entry, email: "not-an-email" },
      { ...entry, company: "" },
      { ...entry, focus: "Everything" },
      { ...entry, name: "x".repeat(121) },
    ];
    for (const args of bad) expect(await t.mutation(api.earlyAccess.request, args)).toEqual({ status: "invalid" });
    expect(await rows(t)).toEqual([]);
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
