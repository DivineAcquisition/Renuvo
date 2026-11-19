/**
 * @vitest-environment edge-runtime
 *
 * Messaging billing failure cases, end to end against the stand-ins for Autumn and the providers: delivery
 * reports out of order and twice, the same send started twice, Gmail versus Selestial's email delivery,
 * recipients counted once, a price change while a message is on its way, a plan that ends with funds left,
 * and one company or role reaching another's money.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, company, HOUR, NOW, refusal } from "../tests/harness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Actor } from "./lib/events";
import { NOT_ALLOWED } from "./lib/errors";
import { queueMessage } from "./lib/messaging/outbox";
import { mockOutbox } from "./lib/messaging/provider";
import { planOutbound, recipientCount } from "./lib/messagingBilling/ledger";

const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const STAFF = { subject: "user_staff", email: "staff@selestial.example", emailVerified: true, name: "Staff" };
const MORNING = NOW + 4 * HOUR;
const LENA = "+15125551010";
/** Fails twice with a retryable answer, then goes (tests/the mock provider). */
const FLAKY = "+15125550002";

async function billed(funds: number) {
  const s = await setup(["Lena"]);
  await s.t.run(async (ctx) => ctx.db.patch(s.cleaners.Lena, { phone: LENA }));
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  billing.seed(s.companyId, { messaging: { purchased: funds, promo: 0, promoExpiresAt: null, used: 0 } });
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  return s;
}
type S = Awaited<ReturnType<typeof billed>>;
const text = (s: S, key: string, body = "Alpha Cleaning: reminder for tomorrow at 9.") =>
  s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body, dedupeKey: key, actor: DISPATCH }));
const message = (s: S, id: Id<"messages">) => s.t.run(async (ctx) => (await ctx.db.get(id))!);
const charges = (s: S) => s.t.run(async (ctx) => (await ctx.db.query("messagingCharges").collect()) as Doc<"messagingCharges">[]);
const left = (s: S) => billing.messagingLeft(billing.customerFor(`company_${s.companyId}`));
const shown = (s: S) => s.t.run(async (ctx) => (await ctx.db.query("billingAccounts").first())?.messaging?.remaining);

describe("Messaging billing: failure cases end to end", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
    vi.setSystemTime(MORNING);
    process.env.MESSAGING_BILLING = "on";
  });
  afterEach(() => {
    undo();
    delete process.env.MESSAGING_BILLING;
    delete process.env.MESSAGING_RATE_CARD;
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  it("applies a delivery report that beats the send's own answer, and a repeat of it changes nothing", async () => {
    const s = await billed(250_000);
    // Queue without running the sender, then take each step by hand so the report can arrive in between.
    const queued = await s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body: "Reminder.", dedupeKey: "race", actor: DISPATCH }));
    const claimed = (await s.t.mutation(internal.messaging.claim, { messageId: queued._id }))!;
    expect(claimed.billing).toMatchObject({ needsLock: true });
    expect(await s.t.action(internal.messagingBilling.reserve, { chargeId: claimed.billing!.chargeId })).toBe("reserved");
    const report = { provider: "mock", eventId: "evt-race", providerMessageId: "mock-race-1", outcome: "delivered" as const, providerCost: 40 };
    expect(await s.t.mutation(internal.messaging.receipt, report)).toBe("early");
    expect(await s.t.mutation(internal.messaging.receipt, report)).toBe("duplicate");
    await s.t.mutation(internal.messaging.settle, { messageId: queued._id, result: { ok: true, providerMessageId: "mock-race-1", delivered: false, parts: 1 } });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await message(s, queued._id)).toMatchObject({ status: "delivered" });
    expect((await charges(s))[0]).toMatchObject({ state: "captured", amount: 250, providerCost: 40, settlement: "confirmed" });
    // Settling again (a repeated answer) changes nothing: one charge.
    await s.t.mutation(internal.messaging.settle, { messageId: queued._id, result: { ok: true, providerMessageId: "mock-race-1", delivered: true, parts: 1 } });
    expect((await charges(s)).filter((c) => c.kind === "sms_out")).toHaveLength(1);
    expect(left(s)).toBe(250_000 - 250);
    expect(await shown(s)).toBe(left(s));
  });

  it("refunds a text whose early report says the provider never charged for it", async () => {
    const s = await billed(250_000);
    const queued = await s.t.run(async (ctx) => queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: (await ctx.db.get(s.cleaners.Lena))!, body: "Reminder.", dedupeKey: "exp", actor: DISPATCH }));
    const claimed = (await s.t.mutation(internal.messaging.claim, { messageId: queued._id }))!;
    await s.t.action(internal.messagingBilling.reserve, { chargeId: claimed.billing!.chargeId });
    await s.t.mutation(internal.messaging.receipt, { provider: "mock", eventId: "evt-exp", providerMessageId: "mock-exp-1", outcome: "failed", problem: "Expired", providerCost: 0, errorCode: "40014" });
    await s.t.mutation(internal.messaging.settle, { messageId: queued._id, result: { ok: true, providerMessageId: "mock-exp-1", delivered: false, parts: 1 } });
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await message(s, queued._id)).toMatchObject({ status: "failed" });
    expect((await charges(s)).map((c) => [c.kind, c.state, c.amount])).toEqual([
      ["sms_out", "refunded", 250],
      ["refund", "captured", -250],
    ]);
    expect(left(s)).toBe(250_000);
    expect(await shown(s)).toBe(left(s));
  });

  it("sends and charges once when the same message is started twice, or queued twice by a double click", async () => {
    const s = await billed(250_000);
    const first = await text(s, "same");
    const again = await text(s, "same");
    expect(again._id).toBe(first._id);
    // Two senders race for it: only one claims it.
    await s.t.action(internal.messaging.deliver, { messageId: first._id });
    await s.t.action(internal.messaging.deliver, { messageId: first._id });
    await flush(s.t);
    expect(mockOutbox.filter((row) => row.result === "accepted")).toHaveLength(1);
    expect((await charges(s)).filter((c) => c.kind === "sms_out")).toEqual([expect.objectContaining({ state: "captured", amount: 250 })]);
    expect(left(s)).toBe(250_000 - 250);
  });

  it("keeps the price set aside when the price list changes while a message is on its way", async () => {
    const s = await billed(250_000);
    await s.t.run(async (ctx) => ctx.db.patch(s.cleaners.Lena, { phone: FLAKY }));
    const sent = await text(s, "price");
    // The first try is set aside at $0.025 and fails; the price list changes before the retry goes.
    vi.advanceTimersByTime(1);
    await s.t.finishInProgressScheduledFunctions();
    expect(await message(s, sent._id)).toMatchObject({ status: "queued", attempts: 1 });
    expect((await charges(s))[0]).toMatchObject({ rateCardVersion: "msg-2026-11", unitPrice: 250 });
    process.env.MESSAGING_RATE_CARD = "msg-fixture-higher";
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await message(s, sent._id)).toMatchObject({ status: "delivered" });
    expect((await charges(s)).filter((c) => c.kind === "sms_out")).toEqual([expect.objectContaining({ state: "captured", unitPrice: 250, amount: 250, rateCardVersion: "msg-2026-11" })]);
    // A message set aside after the change uses the new price.
    await s.t.run(async (ctx) => ctx.db.patch(s.cleaners.Lena, { phone: LENA }));
    await text(s, "after");
    await flush(s.t);
    expect((await charges(s)).filter((c) => c.kind === "sms_out").map((c) => c.unitPrice).sort()).toEqual([250, 400]);
  });

  it("charges email through Selestial's delivery per distinct recipient, and nothing through the company's Gmail", async () => {
    const s = await billed(250_000);
    expect(recipientCount(["Dana@Example.com ", "dana@example.com", "ops@example.com", "", null, "not-an-address"])).toBe(2);
    const plan = (viaGmail: boolean) =>
      s.t.run(async (ctx) => {
        const id = await ctx.db.insert("messages", { companyId: s.companyId, purpose: "customer_message", channel: "email", to: "Dana@Example.com", subject: "Hi", body: "Hello", dedupeKey: `e-${viaGmail}`, status: "queued", attempts: 0, queuedAt: Date.now() });
        return planOutbound(ctx, (await ctx.db.get(id))!, { body: "Hello", viaGmail });
      });
    expect(await plan(true)).toEqual({ kind: "free" });
    const paid = await plan(false);
    expect(paid).toMatchObject({ kind: "reserve", needsLock: true });
    expect((await charges(s))[0]).toMatchObject({ kind: "email_out", count: 1, unitPrice: 20, reserved: 20 });
  });

  it("refuses business messages once the plan has ended, keeps the funds, and sends again with a plan", async () => {
    const s = await billed(250_000);
    await s.t.run(async (ctx) => ctx.db.patch(s.companyId, { plan: undefined }));
    const refused = await text(s, "no-plan");
    await flush(s.t);
    expect(await message(s, refused._id)).toMatchObject({ status: "not_sent", refusal: "no_plan" });
    expect((await message(s, refused._id)).problem).toMatch(/Unused messaging funds stay on the account/);
    expect(await charges(s)).toHaveLength(0);
    expect(left(s)).toBe(250_000);
    await s.t.run(async (ctx) => ctx.db.patch(s.companyId, { plan: "operate" }));
    const sent = await text(s, "plan-again");
    await flush(s.t);
    expect(await message(s, sent._id)).toMatchObject({ status: "delivered" });
    expect(left(s)).toBe(250_000 - 250);
  });

  it("keeps each company's messaging money to its own Owner, and staff tools to staff", async () => {
    const s = await billed(250_000);
    await text(s, "a1");
    await flush(s.t);
    const other = await company(s.t, "owner-b", "Bravo Maids");
    // Another company's Owner reads their own (empty) messaging, never this company's.
    const theirs = await other.as.query(api.messagingUsage.overview, { companyId: other.companyId });
    if (theirs.connected) expect(theirs.recent).toEqual([]);
    // Another company is not found at all: its existence is not confirmed.
    expect(await refusal(other.as.query(api.messagingUsage.overview, { companyId: s.companyId }))).toBe("Not found.");
    expect(await refusal(other.as.query(api.messagingUsage.statement, { companyId: s.companyId, month: "2026-11" }))).toBe("Not found.");
    expect(await refusal(other.as.mutation(api.messagingFunds.startTopUp, { companyId: s.companyId, cents: 2_500 }))).toBe("Not found.");
    // Inside the company, money is the Owner's alone.
    for (const role of ["manager", "office"] as const) {
      const member = await addMember(s.t, s.as, s.companyId, `${role}-z`, role);
      expect(await refusal(member.query(api.messagingUsage.overview, { companyId: s.companyId }))).toBe(NOT_ALLOWED);
      expect(await refusal(member.mutation(api.messagingFunds.setControls, { companyId: s.companyId, monthlyLimitCents: null, batchLimitCents: null, lowBalanceCents: 500, agentLimitsCents: {} }))).toBe(NOT_ALLOWED);
      expect(await refusal(member.mutation(api.messagingFunds.setAutoTopUp, { companyId: s.companyId, enabled: false, thresholdCents: 500, amountCents: 2_500, monthlyMaxCents: 10_000 }))).toBe(NOT_ALLOWED);
    }
    // Staff tools are refused to an Owner.
    expect(await refusal(s.as.mutation(api.messagingFunds.supportCredit, { companyId: s.companyId, cents: 500, reason: "Owner credits themselves", key: "x" }))).toBe("Not found.");
    expect(await refusal(s.as.query(api.messagingFunds.attention, {}))).toBe("Not found.");
    // A charge row is the company's own: the other company's Owner's statement is empty.
    expect((await other.as.query(api.messagingUsage.statement, { companyId: other.companyId, month: "2026-11" }))!.lines).toEqual([]);
    process.env.STAFF_BOOTSTRAP_EMAIL = STAFF.email;
    expect(await s.t.withIdentity(STAFF).query(api.messagingFunds.attention, {})).toEqual([]);
  });
});
