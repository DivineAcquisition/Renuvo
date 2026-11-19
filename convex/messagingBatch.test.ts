/**
 * Bulk sends and the messaging balance: the preview of Sales' first review batch (who gets a message, who
 * can't and why, segments, cost, no AI credits) and the Owner's batch limit, enforced before anything goes.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { addMember, refusal } from "../tests/harness";
import { agentSetup, agentTestEnv, flush } from "../tests/salesHarness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";

const PHONE = "+15125557070";
const BAD = "+15550107071";

async function billedSales(funds: number) {
  const s = await agentSetup();
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  billing.seed(s.companyId, { messaging: { purchased: funds, promo: 0, promoExpiresAt: null, used: 0 } });
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  await s.text(PHONE, "3 bed 2 bath house cleaning please, 78701");
  await s.text(BAD, "2 bed 1 bath cleaning, 78701");
  await flush(s.t);
  return s;
}

describe("Bulk sends and the messaging balance", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = agentTestEnv();
    process.env.MESSAGING_BILLING = "on";
  });
  afterEach(() => {
    undo();
    delete process.env.MESSAGING_BILLING;
  });

  it("previews the first review batch: eligible and excluded with reasons, segments, cost, and no AI credits", async () => {
    const s = await billedSales(250_000);
    const waiting = await s.as.query(api.salesActions.waiting, { companyId: s.companyId });
    if (waiting.firstBatch.decided) throw new Error("expected an open batch");
    expect(waiting.firstBatch.items).toHaveLength(2);
    const preview = waiting.firstBatch.messaging!;
    expect(preview).toMatchObject({ total: 2, eligible: 1, metering: true, covered: true, overLimit: false, aiCredits: 0 });
    expect(preview.segments).toBeGreaterThanOrEqual(1);
    expect(preview.cost).toBe(preview.segments * 250);
    expect(preview.excluded).toEqual([expect.objectContaining({ why: expect.stringMatching(/only go to US mobile and landline numbers/) })]);
    expect(preview.words).toMatch(/^1 of 2 will be sent; 1 can't be\. 1 text using \d+ SMS segments?\. Estimated cost: \$0\.\d+\. AI credits: none\./);
    // Nobody but the Owner sees messaging money.
    const office = await addMember(s.t, s.as, s.companyId, "office-x", "office");
    const theirs = await office.query(api.salesActions.waiting, { companyId: s.companyId });
    if (theirs.firstBatch.decided) throw new Error();
    expect(theirs.firstBatch.messaging).toBeNull();
  });

  it("refuses a batch over the Owner's batch limit before anything is sent, and sends once the limit allows it", async () => {
    const s = await billedSales(250_000);
    await s.as.mutation(api.messagingFunds.setControls, { companyId: s.companyId, monthlyLimitCents: null, batchLimitCents: 0, lowBalanceCents: 500, agentLimitsCents: {} });
    const waiting = await s.as.query(api.salesActions.waiting, { companyId: s.companyId });
    if (waiting.firstBatch.decided) throw new Error();
    expect(waiting.firstBatch.messaging).toMatchObject({ overLimit: true, problem: expect.stringMatching(/batch limit/) });
    const items = waiting.firstBatch.items.map((item) => ({ actionId: item.actionId, decision: "send" as const }));
    expect(await refusal(s.as.mutation(api.salesActions.decideBatch, { companyId: s.companyId, batchId: waiting.firstBatch.batchId!, items }))).toMatch(/more than your \$0\.00 batch limit/);
    expect(s.textsTo(PHONE)).toHaveLength(0);
    await s.as.mutation(api.messagingFunds.setControls, { companyId: s.companyId, monthlyLimitCents: null, batchLimitCents: 5_00, lowBalanceCents: 500, agentLimitsCents: {} });
    const result = await s.as.mutation(api.salesActions.decideBatch, { companyId: s.companyId, batchId: waiting.firstBatch.batchId!, items });
    expect(result).toMatchObject({ sent: 1, skipped: 1 });
    expect(result.results.find((row) => !row.ok)?.detail).toMatch(/^Not sent: Texts can only go to US/);
    await flush(s.t);
    expect(s.textsTo(PHONE)).toHaveLength(1);
    // The text is Sales' spending, even though the Owner approved it.
    const charge = await s.t.run(async (ctx) => (await ctx.db.query("messagingCharges").collect()).find((row) => row.kind === "sms_out"));
    expect(charge).toMatchObject({ agent: "sales", state: "captured" });
  });
});
