/**
 * @vitest-environment edge-runtime
 *
 * Early access to agents that are not released: anyone in the company can ask once per agent and say what
 * they'd use it for; asking again updates their own line; staff see every request and answer it; another
 * company sees nothing of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";

const STAFF = { subject: "user_staff", email: "staff@selestial.example", emailVerified: true, name: "Staff" };

describe("Early access to coming-soon agents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  it("records one request per company and agent, with each person's uses, and lets each take their name off", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const office = await addMember(t, as, companyId, "office-a", "office");
    expect(await as.query(api.agentAccess.mine, { companyId, agent: "quality" })).toMatchObject({ requested: false });

    await as.mutation(api.agentAccess.request, { companyId, agent: "quality", uses: ["Every visit reviewed", "Every visit reviewed", " "], note: "We lose customers to missed tasks." });
    await office.mutation(api.agentAccess.request, { companyId, agent: "quality", uses: ["Re-cleans arranged"] });
    // Asking again updates your own line; it never adds you twice.
    await office.mutation(api.agentAccess.request, { companyId, agent: "quality", uses: ["Re-cleans arranged", "Issues traced to the cause"] });
    const rows = await t.run(async (ctx) => ctx.db.query("agentAccessRequests").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].requesters.map((r) => r.uses)).toEqual([["Every visit reviewed"], ["Re-cleans arranged", "Issues traced to the cause"]]);
    expect(await office.query(api.agentAccess.mine, { companyId, agent: "quality" })).toMatchObject({ requested: true, mine: true, people: 2, status: "requested" });

    await office.mutation(api.agentAccess.withdraw, { companyId, agent: "quality" });
    expect(await office.query(api.agentAccess.mine, { companyId, agent: "quality" })).toMatchObject({ requested: true, mine: false, people: 1 });
    await as.mutation(api.agentAccess.withdraw, { companyId, agent: "quality" });
    expect(await t.run(async (ctx) => ctx.db.query("agentAccessRequests").collect())).toHaveLength(0);
  });

  it("refuses agents that are already available or don't exist", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    expect(await refusal(as.mutation(api.agentAccess.request, { companyId, agent: "sales", uses: [] }))).toMatch(/already available/);
    expect(await refusal(as.mutation(api.agentAccess.request, { companyId, agent: "astrologer", uses: [] }))).toMatch(/already available, or doesn't exist/);
  });

  it("shows staff every company's requests to answer, and keeps each company's to itself", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const b = await company(t, "owner-b", "Bravo Maids");
    await a.as.mutation(api.agentAccess.request, { companyId: a.companyId, agent: "marketing", uses: ["Campaigns that fill gaps"], note: "Slow Tuesdays." });
    await b.as.mutation(api.agentAccess.request, { companyId: b.companyId, agent: "customer-care", uses: [] });
    // Another company is not found, and sees nothing of Alpha's request.
    expect(await refusal(b.as.query(api.agentAccess.mine, { companyId: a.companyId, agent: "marketing" }))).toBe("Not found.");
    expect(await b.as.query(api.agentAccess.mine, { companyId: b.companyId, agent: "marketing" })).toMatchObject({ requested: false });
    // Staff only.
    expect(await refusal(a.as.query(api.agentAccess.requests, {}))).toBe("Not found.");
    process.env.STAFF_BOOTSTRAP_EMAIL = STAFF.email;
    const staff = t.withIdentity(STAFF);
    const all = await staff.query(api.agentAccess.requests, {});
    expect(all.map((row) => [row.company, row.agent, row.people])).toEqual(
      expect.arrayContaining([
        ["Alpha Cleaning", "marketing", 1],
        ["Bravo Maids", "customer-care", 1],
      ]),
    );
    const alpha = all.find((row) => row.company === "Alpha Cleaning")!;
    expect(alpha).toMatchObject({ uses: ["Campaigns that fill gaps"], notes: ["Slow Tuesdays."], status: "requested" });
    await staff.mutation(api.agentAccess.answer, { id: alpha.id, status: "invited", note: "First cohort" });
    expect(await a.as.query(api.agentAccess.mine, { companyId: a.companyId, agent: "marketing" })).toMatchObject({ status: "invited" });
  });
});
