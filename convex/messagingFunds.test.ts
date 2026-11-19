/**
 * @vitest-environment edge-runtime
 *
 * Money into the messaging balance: purchases confirmed by the Owner, automatic top-ups authorized in
 * exact words, refunds and disputes taken back once, support credits, and reconciliation with the provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, HOUR, NOW, refusal, type T } from "../tests/harness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";
import type { Actor } from "./lib/events";
import { NOT_ALLOWED } from "./lib/errors";
import { queueMessage } from "./lib/messaging/outbox";
import { autoTopUpWording } from "./messagingFunds";

const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const STAFF = { subject: "user_staff", email: "staff@selestial.example", emailVerified: true, name: "Staff" };
const MORNING = NOW + 4 * HOUR;
const LENA = "+15125551010";
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function billed(funds: number) {
  const s = await setup(["Lena"]);
  await s.t.run(async (ctx) => ctx.db.patch(s.cleaners.Lena, { phone: LENA }));
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  billing.seed(s.companyId, { messaging: { purchased: funds, promo: 0, promoExpiresAt: null, used: 0 } });
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  return s;
}
type S = Awaited<ReturnType<typeof billed>>;
const customer = (s: S) => billing.customerFor(`company_${s.companyId}`);
const autumnLeft = (s: S) => billing.messagingLeft(customer(s));
let lastS: S | null = null;
const left = (s: S) => {
  lastS = s;
  return autumnLeft(s);
};
const topUps = (s: S) => s.t.run(async (ctx) => ctx.db.query("messagingTopUps").collect());
const charges = (s: S) => s.t.run(async (ctx) => ctx.db.query("messagingCharges").collect());
const account = (s: S) => s.t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())!);

async function buy(s: S, cents: number) {
  const intentId = await s.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents });
  await settle(s.t);
  const preview = await s.as.query(api.billing.intent, { companyId: s.companyId, intentId });
  await s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId });
  await settle(s.t);
  return { intentId, preview };
}

describe("Messaging funds", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
    vi.setSystemTime(MORNING);
    process.env.MESSAGING_BILLING = "on";
  });
  afterEach(async () => {
    // Whatever the test did, the balance shown to the Owner agrees with Autumn's.
    if (lastS) expect((await account(lastS)).messaging?.remaining).toBe(autumnLeft(lastS));
    lastS = null;
    undo();
    delete process.env.MESSAGING_BILLING;
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  it("adds funds only after the Owner confirms the exact charge, and sends what was waiting", async () => {
    const s = await billed(0);
    const waiting = await s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body: "Reminder: 9am tomorrow.", dedupeKey: "wait", actor: DISPATCH }));
    await flush(s.t);
    expect((await s.t.run(async (ctx) => ctx.db.get(waiting._id)))!.status).toBe("held");

    const intentId = await s.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents: 2_500 });
    await settle(s.t);
    const preview = await s.as.query(api.billing.intent, { companyId: s.companyId, intentId });
    expect(preview).toMatchObject({ kind: "messaging_top_up", stage: "awaiting_confirmation", preview: { dueNowCents: 2_500 } });
    // Nothing is bought by looking at the price.
    expect(customer(s).messaging.purchased).toBe(0);
    await s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId });
    await settle(s.t);
    expect(customer(s).messaging.purchased).toBe(250_000);
    expect(await topUps(s)).toEqual([expect.objectContaining({ source: "manual", amount: 250_000, cents: 2_500, status: "paid" })]);
    expect((await s.t.run(async (ctx) => ctx.db.get(waiting._id)))!.status).toBe("delivered");
    // Confirming again does not buy twice.
    expect(await refusal(s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId }))).toMatch(/already confirmed/);
    expect(customer(s).messaging.purchased).toBe(250_000);
  });

  it("accepts $25, $50, $100 or whole dollars from $10 to $1,000, for the Owner of a company with a plan", async () => {
    const s = await billed(0);
    for (const cents of [5_000, 10_000, 1_000, 100_000]) await s.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents });
    expect(await refusal(s.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents: 2_550 }))).toMatch(/whole number of dollars/);
    expect(await refusal(s.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents: 500 }))).toMatch(/between \$10 and \$1000/);
    expect(await refusal(s.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents: 100_100 }))).toMatch(/between/);
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    expect(await refusal(office.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents: 2_500 }))).toBe(NOT_ALLOWED);
  });

  it("records a purchase that needs a card as waiting for payment, with no funds", async () => {
    const s = await billed(0);
    billing.seed(s.companyId, { cardOnFile: false });
    await buy(s, 2_500);
    expect(await topUps(s)).toEqual([expect.objectContaining({ status: "payment_needed", amount: 250_000 })]);
    expect(left(s)).toBe(0);
  });

  it("turns on automatic top-up only with the Owner's authorization of the exact amounts", async () => {
    const s = await billed(0);
    const amounts = { thresholdCents: 500, amountCents: 2_500, monthlyMaxCents: 10_000 };
    expect(await refusal(s.as.mutation(api.messagingFunds.setAutoTopUp, { companyId: s.companyId, enabled: true, ...amounts }))).toMatch(/authorization/);
    expect(await refusal(s.as.mutation(api.messagingFunds.setAutoTopUp, { companyId: s.companyId, enabled: true, ...amounts, wording: "I agree" }))).toMatch(/authorization/);
    const wording = autoTopUpWording({ threshold: 50_000, amount: 250_000, monthlyMax: 1_000_000 });
    expect(wording).toBe("I authorize Selestial to charge my saved payment method $25.00 (plus any applicable tax) whenever my messaging balance falls below $5.00, up to 4 times ($100.00) per calendar month, until I turn automatic top-up off. Each top-up appears on its own receipt.");
    await s.as.mutation(api.messagingFunds.setAutoTopUp, { companyId: s.companyId, enabled: true, ...amounts, wording });
    await settle(s.t);
    expect((await account(s)).messagingControls!.autoTopUp).toMatchObject({ enabled: true, threshold: 50_000, amount: 250_000, monthlyMax: 1_000_000, wording });
    expect(billing.state.billingControls.get(`company_${s.companyId}`)).toEqual({ auto_topups: [{ feature_id: "messaging_balance", enabled: true, threshold: 50_000, quantity: 250_000, purchase_limit: { interval: "month", interval_count: 1, limit: 4 } }] });
    // Turning it off needs no authorization, and Autumn is told.
    await s.as.mutation(api.messagingFunds.setAutoTopUp, { companyId: s.companyId, enabled: false, ...amounts });
    await settle(s.t);
    expect(billing.state.billingControls.get(`company_${s.companyId}`)).toMatchObject({ auto_topups: [expect.objectContaining({ enabled: false })] });
  });

  it("records each automatic top-up once by its invoice, and tells the Owner about a declined one", async () => {
    const s = await billed(0);
    const event = { deliveryId: "evt-1", type: "billing.auto_topup_succeeded", customerId: `company_${s.companyId}`, featureId: "messaging_balance", quantity: 250_000, invoiceId: "in_auto_1" };
    await s.t.mutation(internal.billing.webhookReceived, event);
    await s.t.mutation(internal.billing.webhookReceived, { ...event, deliveryId: "evt-2" });
    await settle(s.t);
    expect(await topUps(s)).toEqual([expect.objectContaining({ source: "automatic", amount: 250_000, invoiceId: "in_auto_1" })]);
    await s.t.mutation(internal.billing.webhookReceived, { deliveryId: "evt-3", type: "billing.auto_topup_failed", customerId: `company_${s.companyId}`, featureId: "messaging_balance", reason: "charge_failed" });
    await settle(s.t);
    expect((await account(s)).notices[0]).toMatchObject({ kind: "messaging_topup_failed" });
  });

  it("takes back refunded top-up funds once per event, up to what the top-up added", async () => {
    const s = await billed(0);
    await buy(s, 2_500);
    await s.t.run(async (ctx) => {
      const row = (await ctx.db.query("messagingTopUps").first())!;
      await ctx.db.patch(row._id, { invoiceId: "in_refund_me" });
    });
    await s.t.mutation(internal.messagingFunds.paymentEventReceived, { invoiceId: "in_refund_me", eventId: "evt_r1", kind: "refund", cents: 1_000 });
    await s.t.mutation(internal.messagingFunds.paymentEventReceived, { invoiceId: "in_refund_me", eventId: "evt_r1", kind: "refund", cents: 1_000 });
    await settle(s.t);
    expect(left(s)).toBe(250_000 - 100_000);
    // Stripe reports the total refunded so far: $40 is more than the $25 top-up, so only the rest is taken.
    await s.t.mutation(internal.messagingFunds.paymentEventReceived, { invoiceId: "in_refund_me", eventId: "evt_r2", kind: "refund", cents: 4_000 });
    await settle(s.t);
    expect(left(s)).toBe(0);
    expect(await topUps(s)).toEqual([expect.objectContaining({ status: "refunded", clawedBack: 250_000 })]);
    expect((await charges(s)).filter((c) => c.kind === "adjustment").map((c) => c.amount)).toEqual([100_000, 150_000]);
  });

  it("holds back disputed funds and returns them when the dispute is won, staff only", async () => {
    const s = await billed(0);
    await buy(s, 5_000);
    const topUp = (await topUps(s))[0];
    await s.t.run(async (ctx) => ctx.db.patch(topUp._id, { invoiceId: "in_dispute" }));
    expect(await refusal(s.as.mutation(api.messagingFunds.recordDispute, { topUpId: topUp._id, eventId: "dp_1", kind: "dispute_opened", cents: 5_000 }))).toBe("Not found.");
    process.env.STAFF_BOOTSTRAP_EMAIL = STAFF.email;
    const staff = s.t.withIdentity(STAFF);
    await staff.mutation(api.messagingFunds.recordDispute, { topUpId: topUp._id, eventId: "dp_1", kind: "dispute_opened", cents: 5_000 });
    await settle(s.t);
    expect(left(s)).toBe(0);
    await staff.mutation(api.messagingFunds.recordDispute, { topUpId: topUp._id, eventId: "dp_2", kind: "dispute_won", cents: 5_000 });
    await settle(s.t);
    expect(left(s)).toBe(500_000);
    expect((await topUps(s))[0]).toMatchObject({ status: "dispute_won", clawedBack: 0 });
  });

  it("refunds a text the provider expired before sending, and keeps what the provider charged Selestial", async () => {
    const s = await billed(250_000);
    const sent = await s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body: "Reminder.", dedupeKey: "exp", actor: DISPATCH }));
    await flush(s.t);
    const msg = (await s.t.run(async (ctx) => ctx.db.get(sent._id)))!;
    // The mock reports delivery at once, so make it look merely sent before the provider's final report.
    await s.t.run(async (ctx) => ctx.db.patch(sent._id, { status: "sent", deliveredAt: undefined }));
    await s.t.mutation(internal.messaging.receipt, { provider: "mock", eventId: "fin-1", providerMessageId: msg.providerMessageId!, outcome: "failed", problem: "Expired", providerCost: 0, errorCode: "40014" });
    await settle(s.t);
    const rows = await charges(s);
    expect(rows.find((c) => c.messageId === sent._id && c.kind === "sms_out")).toMatchObject({ state: "refunded", providerCost: 0 });
    expect(rows.find((c) => c.kind === "refund")).toMatchObject({ amount: -250, reason: expect.stringMatching(/expired/) });
    expect(left(s)).toBe(250_000);
  });

  it("lets staff credit a balance once per key, with a reason, and refund a charge once", async () => {
    const s = await billed(0);
    process.env.STAFF_BOOTSTRAP_EMAIL = STAFF.email;
    const staff = s.t.withIdentity(STAFF);
    expect(await refusal(staff.mutation(api.messagingFunds.supportCredit, { companyId: s.companyId, cents: 500, reason: "x", key: "k1" }))).toMatch(/Say why/);
    const first = await staff.mutation(api.messagingFunds.supportCredit, { companyId: s.companyId, cents: 500, reason: "Goodwill after a carrier outage", key: "k1" });
    const again = await staff.mutation(api.messagingFunds.supportCredit, { companyId: s.companyId, cents: 500, reason: "Goodwill after a carrier outage", key: "k1" });
    await settle(s.t);
    expect(again).toBe(first);
    expect(left(s)).toBe(50_000);
    expect(await refusal(s.as.mutation(api.messagingFunds.supportCredit, { companyId: s.companyId, cents: 500, reason: "Owner tries", key: "k2" }))).toBe("Not found.");
  });
  it("shows the Owner the balance, this month by kind and agent, held work, charges and a statement, with no internal ids", async () => {
    const s = await billed(250_000);
    const sent = await s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body: "Reminder: 9am tomorrow at Elm St.", dedupeKey: "ov1", actor: DISPATCH }));
    await flush(s.t);
    await s.as.mutation(api.messagingFunds.setControls, { companyId: s.companyId, monthlyLimitCents: 1_000, batchLimitCents: null, lowBalanceCents: 500, agentLimitsCents: { dispatch: 0 } });
    const waiting = await s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body: "Second reminder.", dedupeKey: "ov2", actor: DISPATCH }));
    await flush(s.t);
    expect((await s.t.run(async (ctx) => ctx.db.get(waiting._id)))!.status).toBe("held");

    const view = await s.as.query(api.messagingUsage.overview, { companyId: s.companyId });
    if (!view.connected) throw new Error("expected billing connected");
    expect(view.balance).toMatchObject({ available: 250_000 - 250, reserved: 0 });
    expect(view.month).toMatchObject({ outbound: 250, inbound: 0, total: 250, limit: 100_000 });
    expect(view.month.byKind.find((row) => row.kind === "sms_out")).toMatchObject({ count: 1, amount: 250 });
    expect(view.month.byAgent).toEqual([expect.objectContaining({ key: "dispatch", label: "Dispatch", amount: 250 })]);
    expect(view.controls.agentLimits.find((row) => row.agent === "dispatch")).toMatchObject({ limit: 0, spent: 250 });
    expect(view.held).toEqual([expect.objectContaining({ label: "Dispatch", reason: "messaging_limit", count: 1, estimate: 250 })]);
    expect(view.recent[0]).toMatchObject({ what: "Job reminder to a cleaner", detail: "1 segment", who: "Dispatch", status: "Charged", amount: 250, final: true });
    expect(view.rateCard.rows.find((row) => row.kind === "sms_out")).toMatchObject({ price: 250, per: "segment" });
    const sentRow = (await s.t.run(async (ctx) => ctx.db.get(sent._id)))!;
    const text = JSON.stringify(view);
    for (const secret of [sentRow.providerMessageId!, sent._id, "lockId", "m-"]) expect(text).not.toContain(secret);

    const month = new Date(MORNING).toISOString().slice(0, 7);
    const statement = (await s.as.query(api.messagingUsage.statement, { companyId: s.companyId, month }))!;
    expect(statement.lines).toEqual([expect.objectContaining({ description: "Job reminder to a cleaner", quantity: "1 segment", rateVersion: "msg-2026-11", amount: 250 })]);
    expect(statement.totals.charged).toBe(250);
    expect(await s.as.query(api.messagingUsage.statement, { companyId: s.companyId, month: "2026-13" })).toBeNull();

    const office = await addMember(s.t, s.as, s.companyId, "office-b", "office");
    expect(await refusal(office.query(api.messagingUsage.overview, { companyId: s.companyId }))).toBe(NOT_ALLOWED);
  });
});
