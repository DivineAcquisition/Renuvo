/**
 * Moving sign-in from one Clerk instance to another gives everyone a new sign-in id. People keep their
 * companies and staff access, by verified email, only when the sign-in service itself changed.
 *
 * @vitest-environment edge-runtime
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { NOT_FOUND } from "./lib/errors";
import { refusal } from "../tests/harness";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

const DEV = "https://first-opossum-325.clerk.accounts.dev";
const LIVE = "https://clerk.selestial.io";

function who(subject: string, issuer: string, extra: Record<string, string | boolean> = {}) {
  return { subject, issuer, tokenIdentifier: `${issuer}|${subject}`, email: "owner@novara.test", emailVerified: true, name: "Owner", ...extra };
}

describe("moving sign-in to a new service", () => {
  it("reconnects a person's company under their new sign-in, once, and records it", async () => {
    const t = convexTest(schema, modules);
    const before = t.withIdentity(who("user_dev_1", DEV));
    const companyId = await before.mutation(api.companies.create, { name: "Novara Cleaning", timezone: "America/New_York" });

    const after = t.withIdentity(who("user_live_1", LIVE));
    expect(await after.query(api.companies.mine, {})).toEqual([]);
    expect(await after.mutation(api.companies.reconnect, {})).toEqual({ reconnected: 1 });
    expect(await after.query(api.companies.mine, {})).toEqual([{ companyId, name: "Novara Cleaning", role: "owner" }]);
    expect(await after.query(api.companies.get, { companyId })).toMatchObject({ name: "Novara Cleaning", role: "owner" });
    // The old sign-in no longer opens it, and a second call changes nothing.
    expect(await before.query(api.companies.mine, {})).toEqual([]);
    expect(await after.mutation(api.companies.reconnect, {})).toEqual({ reconnected: 0 });
    const events = await t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((row) => row.type === "member.reconnected"));
    expect(events).toHaveLength(1);
  });

  it("never moves a membership by email within the same sign-in service", async () => {
    const t = convexTest(schema, modules);
    const first = t.withIdentity(who("user_live_1", LIVE));
    const companyId = await first.mutation(api.companies.create, { name: "Novara Cleaning", timezone: "America/New_York" });
    const other = t.withIdentity(who("user_live_2", LIVE));
    expect(await other.mutation(api.companies.reconnect, {})).toEqual({ reconnected: 0 });
    expect(await refusal(other.query(api.companies.get, { companyId }))).toBe(NOT_FOUND);
    expect(await first.query(api.companies.mine, {})).toHaveLength(1);
  });

  it("needs a verified email", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(who("user_dev_1", DEV)).mutation(api.companies.create, { name: "Novara Cleaning", timezone: "America/New_York" });
    const unverified = t.withIdentity(who("user_live_1", LIVE, { emailVerified: false }));
    expect(await unverified.mutation(api.companies.reconnect, {})).toEqual({ reconnected: 0 });
    expect(await unverified.query(api.companies.mine, {})).toEqual([]);
  });

  it("keeps Selestial staff access across the move, and only across it", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("staff", { userId: "user_dev_9", userIssuer: DEV, email: "admin@selestial.test", name: "Admin", role: "admin", status: "active", addedAt: 0, addedBy: "test" });
    });
    const sameService = t.withIdentity(who("user_dev_10", DEV, { email: "admin@selestial.test" }));
    expect(await refusal(sameService.query(api.aiAdmin.models, {}))).toBe(NOT_FOUND);
    const moved = t.withIdentity(who("user_live_9", LIVE, { email: "admin@selestial.test" }));
    await moved.query(api.aiAdmin.models, {});
    const row = await t.run(async (ctx) => (await ctx.db.query("staff").collect())[0]);
    expect(row).toMatchObject({ userId: "user_dev_9", userIssuer: DEV });
  });
});
