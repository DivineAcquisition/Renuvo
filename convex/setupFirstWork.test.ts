/**
 * @vitest-environment edge-runtime
 *
 * "Your first work" after setup: counts read from records, one next step in the right order, and the two
 * milestones (first decision, first action) recorded from what actually happened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

async function message(t: T, companyId: Id<"companies">, fields: { status: "sent" | "held" | "not_sent"; draftedBy?: "agent" | "person"; at: number }) {
  await t.run((ctx) => ctx.db.insert("messages", { companyId, purpose: "reminder", channel: "sms", to: "+15125550101", body: "Test message", dedupeKey: `m${fields.at}${fields.status}`, status: fields.status, attempts: 1, queuedAt: fields.at, draftedBy: fields.draftedBy } as never));
}

describe("your first work", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    t = start();
  });
  afterEach(() => vi.useRealTimers());

  it("a company with nothing yet says so, and points at what is in the way", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    const work = (await as.query(api.setup.firstWork, { companyId }))!;
    expect(work).toMatchObject({ priority: null, prepared: [], reviews: [], waiting: { firstBatch: 0, approvals: 0 }, started: { messages: 0 } });
    expect(work.blockers.length).toBeGreaterThan(0);
    expect(work.next).toEqual({ words: work.blockers[0].next, href: work.blockers[0].href });
  });

  it("lists what setup prepared, and a decision waiting comes first in the next step", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    await as.mutation(api.setup.prepareService, { companyId, templateId: "res-standard" });
    const drafted = (await as.query(api.setup.firstWork, { companyId }))!;
    expect(drafted.prepared).toEqual([expect.objectContaining({ label: expect.stringMatching(/^Service draft: /), detail: "A draft to review before it is published." })]);
    // The blocker points at the draft that was made, not at starting another.
    const serviceGap = drafted.blockers.find((gap) => /service is published/i.test(gap.words));
    if (serviceGap) expect(serviceGap.next).toMatch(/^Review and publish /);

    await t.mutation(internal.approvals.request, { companyId, action: "dispatch.request_acceptance", summary: "Offer a visit", reason: "A visit needs a cleaner", decideBy: NOW + 86_400_000 });
    const work = (await as.query(api.setup.firstWork, { companyId }))!;
    expect(work.waiting.approvals).toBe(1);
    expect(work.next).toEqual({ words: "Decide 1 item waiting for your approval", href: "/app/approvals" });
  });

  it("counts only messages agents actually sent since setup began", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    await message(t, companyId, { status: "sent", draftedBy: "agent", at: NOW + 1000 });
    await message(t, companyId, { status: "held", draftedBy: "agent", at: NOW + 2000 });
    await message(t, companyId, { status: "sent", draftedBy: "person", at: NOW + 3000 });
    await message(t, companyId, { status: "sent", draftedBy: "agent", at: NOW - 86_400_000 });
    expect((await as.query(api.setup.firstWork, { companyId }))!.started).toEqual({ messages: 1 });
  });

  it("records the first decision and the first action when the owner enters, from what happened", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    vi.setSystemTime(NOW + 60_000);
    const approvalId = await t.mutation(internal.approvals.request, { companyId, action: "dispatch.request_acceptance", summary: "Offer a visit", reason: "A visit needs a cleaner", decideBy: NOW + 86_400_000 });
    vi.setSystemTime(NOW + 120_000);
    await as.mutation(api.approvals.decide, { companyId, approvalId, decision: "skipped" });
    await message(t, companyId, { status: "sent", draftedBy: "agent", at: NOW + 180_000 });
    vi.setSystemTime(NOW + 240_000);
    await as.mutation(api.setup.enter, { companyId });
    const milestones = await t.run(async (ctx) => (await ctx.db.query("companySetups").collect())[0].milestones);
    expect(milestones).toMatchObject({ firstReviewedAt: NOW + 120_000, firstActionAt: NOW + 180_000, enteredAt: NOW + 240_000 });
  });

  it("with nothing decided or sent, entering records neither milestone", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    await as.mutation(api.setup.enter, { companyId });
    const milestones = await t.run(async (ctx) => (await ctx.db.query("companySetups").collect())[0].milestones);
    expect(milestones.firstReviewedAt).toBeUndefined();
    expect(milestones.firstActionAt).toBeUndefined();
    expect(milestones.enteredAt).toBe(NOW);
  });

  it("staff can read it, and one company never sees another's", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    await t.mutation(internal.approvals.request, { companyId, action: "dispatch.request_acceptance", summary: "Offer a visit", reason: "A visit needs a cleaner", decideBy: NOW + 86_400_000 });
    const office = await addMember(t, as, companyId, "office", "office");
    expect((await office.query(api.setup.firstWork, { companyId }))!).toMatchObject({ waiting: { approvals: 1 }, canDecide: false });
    const other = await company(t, "owner-b", "Beta");
    expect((await other.as.query(api.setup.firstWork, { companyId: other.companyId }))!.waiting.approvals).toBe(0);
  });
});
