import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { company, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { COMPANY_DELETION_DAYS } from "./dataRights";

const NOW = Date.UTC(2026, 10, 16, 12);
const YEAR = 365 * 24 * 60 * 60 * 1000;

describe("retention, as the Privacy notice states it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("gives a company's own deletion request a due date 90 days out", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await as.mutation(api.dataRights.requestCompanyDeletion, { companyId });
    const row = await t.run(async (ctx) => ctx.db.query("trustRequests").first());
    expect(COMPANY_DELETION_DAYS).toBe(90);
    expect(row?.dueOn).toBe("2027-02-14");
  });

  it("deletes closed requests and deletion records three years after they close, and nothing younger or still open", async () => {
    const t = start();
    const { companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const memberId = await t.run(async (ctx) => (await ctx.db.query("members").first())!._id);
    const old = NOW - 3 * YEAR - 24 * 60 * 60 * 1000;
    const recent = NOW - 2 * YEAR;
    const base = { kind: "privacy" as const, requester: { email: "a@example.com", relationship: "other" as const }, details: "x", routing: "selestial" as const, verification: {}, notes: [], notify: { state: "sent" as const, attempts: 1 } };
    await t.run(async (ctx) => {
      await ctx.db.insert("trustRequests", { ...base, reference: "OLD-CLOSED", receivedAt: old, status: "completed", actions: [{ at: old, by: "system", action: "received", detail: "" }], completion: { at: old, by: "system", outcome: "Done." } });
      await ctx.db.insert("trustRequests", { ...base, reference: "OLD-OPEN", receivedAt: old, status: "in_progress", actions: [{ at: old, by: "system", action: "received", detail: "" }] });
      await ctx.db.insert("trustRequests", { ...base, reference: "OLD-CLOSED-LATE", receivedAt: old, status: "completed", actions: [{ at: old, by: "system", action: "received", detail: "" }], completion: { at: recent, by: "system", outcome: "Done." } });
      await ctx.db.insert("deletionRecords", { companyId, at: old, requestedBy: memberId, subject: { id: "x", kind: "customer" }, steps: [], keptReasons: [] });
      await ctx.db.insert("deletionRecords", { companyId, at: recent, requestedBy: memberId, subject: { id: "y", kind: "customer" }, steps: [], keptReasons: [] });
    });
    expect(await t.mutation(internal.retention.purge, {})).toEqual({ requests: 1, deletionRecords: 1 });
    const left = await t.run(async (ctx) => (await ctx.db.query("trustRequests").collect()).map((row) => row.reference).sort());
    expect(left).toEqual(["OLD-CLOSED-LATE", "OLD-OPEN"]);
    expect(await t.run(async (ctx) => (await ctx.db.query("deletionRecords").collect()).length)).toBe(1);
  });
});
