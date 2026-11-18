/**
 * @vitest-environment edge-runtime
 *
 * Messaging billing end to end against the stand-ins for Autumn (tests/fakeAutumn.ts) and the texting
 * provider: estimate → hold → send → charge the provider's units, and every way that can go wrong.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, PHONES, setup } from "../tests/dispatchHarness";
import { HOUR, NOW } from "../tests/harness";
import { billing } from "../tests/setupBilling";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { Actor } from "./lib/events";
import { queueMessage } from "./lib/messaging/outbox";
import { mockOutbox } from "./lib/messaging/provider";
import { HOLD_MS, OVERDRAFT_FLOOR, refundCharge } from "./lib/messagingBilling/ledger";

const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
/** 10:00 in Chicago, outside quiet hours. */
const MORNING = NOW + 4 * HOUR;
type S = Awaited<ReturnType<typeof setup>>;

/** Real-looking US numbers: the harness's 555-01xx numbers are not valid US exchanges, so they have no rate. */
const US: Record<"Lena" | "Rosa", string> = { Lena: "+15125551010", Rosa: "+15125552020" };

async function billed(funds: number, names: (keyof typeof PHONES)[] = ["Lena", "Rosa"]) {
  const s = await setup(names);
  await s.t.run(async (ctx) => {
    for (const name of names) if (name === "Lena" || name === "Rosa") await ctx.db.patch(s.cleaners[name], { phone: US[name] });
  });
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  billing.seed(s.companyId, { messaging: { purchased: funds, promo: 0, promoExpiresAt: null, used: 0 } });
  await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
  return s;
}

function text(s: S, key: string, body = "Alpha Cleaning: reminder for tomorrow at 9.", cleaner: keyof typeof PHONES = "Lena") {
  return s.t.run(async (ctx) => {
    const row = (await ctx.db.get(s.cleaners[cleaner]))!;
    return queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner: row, body, dedupeKey: key, actor: DISPATCH });
  });
}

const message = (s: S, id: Id<"messages">) => s.t.run(async (ctx) => (await ctx.db.get(id))!);
const charges = (s: S) => s.t.run(async (ctx) => (await ctx.db.query("messagingCharges").collect()) as Doc<"messagingCharges">[]);
const left = (s: S) => billing.messagingLeft(billing.customerFor(`company_${s.companyId}`));
const setPhone = (s: S, cleaner: keyof typeof PHONES, phone: string) => s.t.run(async (ctx) => ctx.db.patch(s.cleaners[cleaner], { phone }));

describe("Messaging billing", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
    vi.setSystemTime(MORNING);
    process.env.MESSAGING_BILLING = "on";
  });
  afterEach(() => {
    undo();
    delete process.env.MESSAGING_BILLING;
  });

  it("holds the estimate, sends, and charges the provider's segment count on the rate in force", async () => {
    const s = await billed(250_000);
    const sent = await text(s, "one");
    await flush(s.t);
    expect(await message(s, sent._id)).toMatchObject({ status: "delivered", segments: 1, encoding: "gsm7", agent: "dispatch", sentVia: "mock", provider: "mock" });
    const [charge] = await charges(s);
    expect(charge).toMatchObject({ kind: "sms_out", direction: "out", count: 1, rateCardVersion: "msg-2026-11", unitPrice: 250, reserved: 250, amount: 250, state: "captured", settlement: "confirmed", agent: "dispatch", activity: "Job reminder to a cleaner" });
    expect(left(s)).toBe(250_000 - 250);
  });

  it("charges Unicode and long texts by segment, and the provider's count when it differs", async () => {
    const s = await billed(250_000);
    // An emoji makes it UCS-2: 80 characters is two 67-unit segments.
    const emoji = await text(s, "emoji", `${"a".repeat(78)} 😀`);
    await flush(s.t);
    expect(await message(s, emoji._id)).toMatchObject({ segments: 2, encoding: "ucs2" });
    // The provider counts one segment more than the estimate (numbers ending 0005): the hold is confirmed and the difference charged once.
    await setPhone(s, "Rosa", "+15125550005");
    const extra = await text(s, "extra", "Short and plain.", "Rosa");
    await flush(s.t);
    await flush(s.t);
    const rows = await charges(s);
    expect(rows.find((c) => c.messageId === emoji._id)).toMatchObject({ count: 2, amount: 500, state: "captured" });
    expect(rows.find((c) => c.messageId === extra._id)).toMatchObject({ estimatedCount: 1, count: 2, reserved: 250, amount: 500, extraTracked: true, settlement: "tracked" });
    expect(left(s)).toBe(250_000 - 1000);
  });

  it("never overspends: two texts against a balance that covers one", async () => {
    const s = await billed(250);
    const a = await text(s, "a");
    const b = await text(s, "b", undefined, "Rosa");
    await flush(s.t);
    const statuses = [(await message(s, a._id)).status, (await message(s, b._id)).status].sort();
    expect(statuses).toEqual(["delivered", "held"]);
    const held = [await message(s, a._id), await message(s, b._id)].find((m) => m.status === "held")!;
    expect(held).toMatchObject({ holdReason: "messaging_balance" });
    expect(held.problem).toMatch(/Add funds/);
    expect(left(s)).toBe(0);
    expect(mockOutbox.filter((m) => m.result === "accepted")).toHaveLength(1);
  });

  it("keeps a message that waited for funds, and checks it again before it goes once funds arrive", async () => {
    const s = await billed(0);
    const waiting = await text(s, "wait");
    const optedOut = await text(s, "stop", "Second reminder.", "Rosa");
    await flush(s.t);
    expect(await message(s, waiting._id)).toMatchObject({ status: "held", holdReason: "messaging_balance" });
    expect(mockOutbox).toHaveLength(0);
    // While they wait, Rosa texts STOP.
    await s.t.mutation(internal.inbound.sms, { to: s.smsNumber, from: US.Rosa, body: "STOP", receivedAt: Date.now() });
    billing.seed(s.companyId, { messaging: { purchased: 250_000, promo: 0, promoExpiresAt: null, used: 0 } });
    await s.t.action(internal.billing.syncCompany, { companyId: s.companyId });
    expect(await s.t.mutation(internal.messagingBilling.releaseHeld, { companyId: s.companyId })).toEqual({ released: 2, stale: 0 });
    // Released messages are spread a moment apart.
    vi.advanceTimersByTime(1_000);
    await flush(s.t);
    expect(await message(s, waiting._id)).toMatchObject({ status: "delivered" });
    // The opt-out came first: not sent and not charged.
    expect(await message(s, optedOut._id)).toMatchObject({ status: "not_sent", refusal: "suppressed" });
    expect((await charges(s)).filter((c) => c.state === "captured")).toHaveLength(1);
  });

  it("does not release by itself a message that has waited more than a day", async () => {
    const s = await billed(0);
    const waiting = await text(s, "old");
    await flush(s.t);
    vi.setSystemTime(MORNING + 25 * HOUR);
    billing.seed(s.companyId, { messaging: { purchased: 250_000, promo: 0, promoExpiresAt: null, used: 0 } });
    expect(await s.t.mutation(internal.messagingBilling.releaseHeld, { companyId: s.companyId })).toEqual({ released: 0, stale: 1 });
    expect(await message(s, waiting._id)).toMatchObject({ status: "held" });
  });

  it("retries a provider failure on the same hold and charges once; a final failure charges nothing", async () => {
    const s = await billed(250_000);
    await setPhone(s, "Lena", "+15125550002"); // fails twice, then goes
    await setPhone(s, "Rosa", "+15125550001"); // never deliverable
    const retried = await text(s, "retry");
    const failed = await text(s, "fail", undefined, "Rosa");
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(60_000);
      await flush(s.t);
    }
    expect(await message(s, retried._id)).toMatchObject({ status: "delivered", attempts: 3 });
    expect(await message(s, failed._id)).toMatchObject({ status: "failed" });
    const rows = await charges(s);
    expect(rows.filter((c) => c.messageId === retried._id)).toEqual([expect.objectContaining({ state: "captured", amount: 250 })]);
    expect(rows.find((c) => c.messageId === failed._id)).toMatchObject({ state: "released", amount: 0 });
    expect(left(s)).toBe(250_000 - 250);
    // Only one hold was ever asked for the retried message.
    expect(billing.state.calls.filter((c) => c.path === "/v1/balances.check" && String((c.body.lock as { lock_id: string }).lock_id).includes(retried._id))).toHaveLength(1);
  });

  it("treats a send that never answered as uncertain: never resent, held, then released uncharged", async () => {
    const s = await billed(250_000);
    await setPhone(s, "Lena", "+15125550003"); // the send dies with no answer
    const lost = await text(s, "lost");
    await flush(s.t).catch(() => undefined);
    vi.advanceTimersByTime(6 * 60_000);
    await s.t.mutation(internal.messaging.sweepStuck, {});
    expect(await message(s, lost._id)).toMatchObject({ status: "unconfirmed" });
    expect((await charges(s))[0]).toMatchObject({ state: "pending", reserved: 250 });
    vi.advanceTimersByTime(HOLD_MS);
    await s.t.mutation(internal.messagingBilling.sweep, {});
    await flush(s.t);
    expect((await charges(s))[0]).toMatchObject({ state: "released", amount: 0, settlement: "released" });
    expect(left(s)).toBe(250_000);
    expect(mockOutbox.filter((m) => m.to === "+15125550003")).toHaveLength(1);
  });

  it("refuses routes without a rate and texts that are too long, before anything is held", async () => {
    const s = await billed(250_000);
    await setPhone(s, "Lena", "+14165550188"); // Toronto
    const canada = await text(s, "ca");
    const long = await text(s, "long", "a".repeat(153 * 10 + 1), "Rosa");
    await flush(s.t);
    expect(await message(s, canada._id)).toMatchObject({ status: "not_sent", refusal: "route_unsupported" });
    expect(await message(s, long._id)).toMatchObject({ status: "not_sent", refusal: "too_long" });
    expect(await charges(s)).toEqual([]);
    expect(billing.state.calls.filter((c) => c.path === "/v1/balances.check")).toHaveLength(0);
  });

  it("does not charge the required answer to STOP, and never holds a send on an unverified answer", async () => {
    const s = await billed(250_000);
    await s.t.mutation(internal.inbound.sms, { to: s.smsNumber, from: US.Lena, body: "STOP", receivedAt: Date.now() });
    await flush(s.t);
    expect(mockOutbox.filter((m) => m.to === US.Lena && m.result === "accepted")).toHaveLength(1);
    expect((await charges(s)).filter((c) => c.direction === "out")).toEqual([]);
    // Autumn degraded (a 202 "allowed fail-open"): the text waits instead of going out unpaid.
    billing.state.outage = "degraded";
    const waiting = await text(s, "degraded", undefined, "Rosa");
    await flush(s.t);
    expect(await message(s, waiting._id)).toMatchObject({ status: "held", holdReason: "billing_unavailable" });
    billing.state.outage = "none";
    vi.advanceTimersByTime(11 * 60_000);
    await flush(s.t);
    expect(await message(s, waiting._id)).toMatchObject({ status: "delivered" });
  });

  it("charges inbound texts even at zero, within the overdraft bound, and tells the Owner", async () => {
    const s = await billed(100);
    await s.t.mutation(internal.inbound.telnyx, { eventId: "evt-1", to: s.smsNumber, from: US.Lena, body: "Running 5 min late", receivedAt: Date.now(), providerMessageId: "in-1", parts: 1, media: 0 });
    // The same webhook again changes nothing.
    await s.t.mutation(internal.inbound.telnyx, { eventId: "evt-1", to: s.smsNumber, from: US.Lena, body: "Running 5 min late", receivedAt: Date.now(), providerMessageId: "in-1", parts: 1, media: 0 });
    await flush(s.t);
    const inbound = (await charges(s)).filter((c) => c.direction === "in");
    expect(inbound).toEqual([expect.objectContaining({ kind: "sms_in", count: 1, amount: 150, settlement: "tracked" })]);
    expect(left(s)).toBe(-50);
    const account = await s.t.run(async (ctx) => ctx.db.query("billingAccounts").first());
    expect(account!.notices.map((n) => n.kind)).toContain("messaging_empty");
    expect(OVERDRAFT_FLOOR).toBe(-100_000);
  });

  it("refunds a charge once, naming the original, and credits the balance back once", async () => {
    const s = await billed(250_000);
    await text(s, "refund-me");
    await flush(s.t);
    const [charge] = await charges(s);
    const first = await s.t.run((ctx) => refundCharge(ctx, charge._id, { reason: "Sent in error" }));
    const second = await s.t.run((ctx) => refundCharge(ctx, charge._id, { reason: "Sent in error" }));
    await flush(s.t);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const rows = await charges(s);
    expect(rows.find((c) => c._id === charge._id)).toMatchObject({ state: "refunded", refundedBy: first });
    expect(rows.find((c) => c._id === first)).toMatchObject({ kind: "refund", amount: -250, refundOf: charge._id, settlement: "tracked" });
    expect(left(s)).toBe(250_000);
  });

  it("charges nothing while metering is off for the deployment", async () => {
    delete process.env.MESSAGING_BILLING;
    const s = await billed(0);
    const sent = await text(s, "free");
    await flush(s.t);
    expect(await message(s, sent._id)).toMatchObject({ status: "delivered" });
    expect(await charges(s)).toEqual([]);
  });
});
