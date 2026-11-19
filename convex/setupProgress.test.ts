/**
 * @vitest-environment edge-runtime
 *
 * Setup after setup: milestones recorded when they happen, the staff funnel, the Home checklist, and Jobber
 * and Housecall Pro on the Integrations page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const STAFF = { subject: "user_staff", email: "ops@selestial.example", emailVerified: true, name: "Ops" };
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 3)));

async function agentMessage(t: T, companyId: Id<"companies">, at: number) {
  await t.run((ctx) => ctx.db.insert("messages", { companyId, purpose: "reminder", channel: "sms", to: "+15125550101", body: "Test message", dedupeKey: `m${at}`, status: "sent", attempts: 1, queuedAt: at, draftedBy: "agent" } as never));
}

describe("setup progress", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    t = start();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("records the first decision and first agent message after entering, at the times they happened, without making the Owner's save stale", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    await as.mutation(api.setup.enter, { companyId });
    const before = await t.run(async (ctx) => (await ctx.db.query("companySetups").collect())[0]);
    expect(before.milestones.firstReviewedAt).toBeUndefined();

    vi.setSystemTime(NOW + 3_600_000);
    const approvalId = await t.mutation(internal.approvals.request, { companyId, action: "dispatch.request_acceptance", summary: "Offer a visit", reason: "A visit needs a cleaner", decideBy: NOW + 86_400_000 });
    await as.mutation(api.approvals.decide, { companyId, approvalId, decision: "approved" });
    await agentMessage(t, companyId, NOW + 7_200_000);
    vi.setSystemTime(NOW + 10_800_000);
    expect(await t.mutation(internal.setupProgress.catchUp, {})).toBe(1);
    const after = await t.run(async (ctx) => (await ctx.db.query("companySetups").collect())[0]);
    expect(after.milestones).toMatchObject({ firstReviewedAt: NOW + 3_600_000, firstActionAt: NOW + 7_200_000 });
    expect(after.revision).toBe(before.revision);
    // Nothing more to record: the sweep leaves it alone.
    expect(await t.mutation(internal.setupProgress.catchUp, {})).toBe(0);
  });

  it("gives Selestial staff the funnel in counts, keeps companies that opted in later apart, and refuses anyone else", async () => {
    vi.stubEnv("STAFF_BOOTSTRAP_EMAIL", STAFF.email);
    const a = await company(t, "owner-a", "Alpha");
    await a.as.mutation(api.setup.prepareService, { companyId: a.companyId, templateId: "res-standard" });
    await a.as.mutation(api.setup.enter, { companyId: a.companyId });
    await company(t, "owner-b", "Beta");
    // A company made before setup existed, which chose to go through it.
    const c = await company(t, "owner-c", "Gamma");
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("companySetups").collect()) if (row.companyId === c.companyId) await ctx.db.delete(row._id);
    });
    await c.as.mutation(api.setup.begin, { companyId: c.companyId });

    const funnel = await t.withIdentity(STAFF).query(api.setupProgress.funnel, { days: 30 });
    expect(funnel).toMatchObject({ days: 30, setups: 2, optedInLater: 1 });
    expect(Object.fromEntries(funnel.stages.map((row) => [row.stage, row.reached]))).toEqual({ startedAt: 2, contextConfirmedAt: 0, firstArtifactAt: 1, firstReviewedAt: 0, firstActionAt: 0, enteredAt: 1 });
    expect(JSON.stringify(funnel)).not.toMatch(/Alpha|Beta|Gamma/);
    await refusal(a.as.query(api.setupProgress.funnel, {}));
  });

  it("shows the Owner what is left from setup on Home, only open items, until they close it", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    // Before entering the workspace, setup itself is where things happen.
    expect(await as.query(api.setupProgress.checklist, { companyId })).toBeNull();
    await as.mutation(api.setup.prepareService, { companyId, templateId: "res-standard" });
    await as.mutation(api.setup.enter, { companyId });
    const list = (await as.query(api.setupProgress.checklist, { companyId }))!;
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items.length).toBeLessThanOrEqual(4);
    expect(list.items.some((item) => /Review and publish|Finish service draft/.test(item.words))).toBe(true);
    // Staff don't see it, and can't close it.
    const manager = await addMember(t, as, companyId, "manager", "manager");
    expect(await manager.query(api.setupProgress.checklist, { companyId })).toBeNull();
    await refusal(manager.mutation(api.setupProgress.dismissChecklist, { companyId }));
    await as.mutation(api.setupProgress.dismissChecklist, { companyId });
    expect(await as.query(api.setupProgress.checklist, { companyId })).toBeNull();
  });

  it("lists Jobber and Housecall Pro as built, with their real connection state", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    let live = (await as.query(api.integrations.overview, { companyId })).live as Record<string, { state: string; detail: string | null }>;
    // No sealing key and no Jobber app on this deployment: both say Selestial still has to switch them on.
    expect(live.jobber).toEqual({ state: "not_set_up", detail: null });
    expect(live["housecall-pro"]).toEqual({ state: "not_set_up", detail: null });
    vi.stubEnv("MAILBOX_TOKEN_KEY", KEY);
    live = (await as.query(api.integrations.overview, { companyId })).live as typeof live;
    expect(live["housecall-pro"]).toEqual({ state: "ready", detail: null });
    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find((row) => row.companyId === companyId)!;
      await ctx.db.insert("connectorConnections", { companyId, system: "housecall_pro", status: "connected", account: "Sample Home Services", connectedBy: member._id, connectedAt: NOW });
    });
    live = (await as.query(api.integrations.overview, { companyId })).live as typeof live;
    expect(live["housecall-pro"]).toEqual({ state: "connected", detail: "Sample Home Services" });
    // Built integrations can't be "requested".
    await refusal(as.mutation(api.integrations.request, { companyId, integrationId: "jobber" }));
  });
});
