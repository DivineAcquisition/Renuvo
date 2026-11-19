/**
 * Money into the messaging balance, and the Owner's spending controls.
 *
 * - Adding funds is a billing intent (convex/billing.ts): the Owner chooses $25, $50, $100 or a custom
 *   amount, Autumn previews the exact charge (tax on its own line), the Owner confirms, and only then is
 *   anything charged. Funds count once Autumn reports them.
 * - Automatic top-up is off until the Owner authorizes the exact words shown, with the threshold, amount and
 *   monthly limit in them. Autumn then charges the saved card when the balance falls below the threshold.
 *   Permission for agents to send never includes permission to refill the balance.
 * - A refunded or disputed top-up takes its funds back from the balance, once per payment event; a dispute
 *   won gives them back.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { connectedOrRefuse, startIntent } from "./billing";
import { accountFor, customerIdFor } from "./lib/billing/access";
import { setMessagingAutoTopUp } from "./lib/billing/autumn";
import { AUTUMN } from "./lib/billing/catalog";
import { ownerMutation, staffMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { controlsOf, noticeOnce, refundCharge } from "./lib/messagingBilling/ledger";
import { centsToUnits, UNITS_PER_CENT } from "./lib/messagingBilling/money";
import { autoTopUpWording } from "./lib/messagingBilling/wording";

/** The amounts offered first, in cents. */
export const TOP_UP_PRESETS = [2_500, 5_000, 10_000] as const;
/** A custom amount is whole dollars between these, in cents. */
export const TOP_UP_MIN_CENTS = 1_000;
export const TOP_UP_MAX_CENTS = 100_000;

function wholeDollars(cents: number, label: string, min: number, max: number) {
  if (!Number.isSafeInteger(cents) || cents % 100 !== 0) throw userError(`${label} must be a whole number of dollars.`);
  if (cents < min || cents > max) throw userError(`${label} must be between $${min / 100} and $${max / 100}.`);
  return cents;
}

export const startTopUp = ownerMutation({
  args: { cents: v.number() },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    wholeDollars(args.cents, "The amount", TOP_UP_MIN_CENTS, TOP_UP_MAX_CENTS);
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account?.plan) throw userError("Messaging funds are for companies with an active Operate or Expand plan. Choose a plan first.");
    // $1 buys 10,000 units: the quantity is the units, so the charge is exactly the amount chosen.
    return startIntent(ctx, { kind: "messaging_top_up", planId: AUTUMN.messagingTopUpPlan, quantity: centsToUnits(args.cents), stage: "previewing" });
  },
});

export { autoTopUpWording };

export const setAutoTopUp = ownerMutation({
  args: { enabled: v.boolean(), thresholdCents: v.number(), amountCents: v.number(), monthlyMaxCents: v.number(), wording: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account) throw userError("Billing hasn't loaded for this company yet. Refresh Plan & Usage and try again.");
    const threshold = centsToUnits(wholeDollars(args.thresholdCents, "The balance to top up at", 0, 50_000));
    const amount = centsToUnits(wholeDollars(args.amountCents, "The top-up amount", TOP_UP_MIN_CENTS, 50_000));
    const monthlyMax = centsToUnits(wholeDollars(args.monthlyMaxCents, "The monthly limit", TOP_UP_MIN_CENTS, 200_000));
    if (monthlyMax < amount) throw userError("The monthly limit must be at least one top-up.");
    const controls = controlsOf(account);
    const now = Date.now();
    let autoTopUp: NonNullable<Doc<"billingAccounts">["messagingControls"]>["autoTopUp"];
    if (args.enabled) {
      if (!account.plan) throw userError("Automatic top-up needs an active plan.");
      const wording = autoTopUpWording({ threshold, amount, monthlyMax });
      // The Owner must have seen and accepted exactly these words; anything else is not an authorization.
      if (args.wording !== wording) throw userError("Read and accept the authorization for these exact amounts to turn automatic top-up on.");
      autoTopUp = { enabled: true, threshold, amount, monthlyMax, authorizedAt: now, authorizedBy: ctx.member._id, wording };
    } else {
      autoTopUp = { ...controls.autoTopUp, enabled: false, threshold, amount, monthlyMax };
    }
    await ctx.db.patch(account._id, { messagingControls: { ...controls, autoTopUp } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.enabled ? "billing.messaging_auto_topup_authorized" : "billing.messaging_auto_topup_off", actor: byMember(ctx), subject: { table: "billingAccounts", id: account._id }, data: { threshold, amount, monthlyMax } });
    await ctx.scheduler.runAfter(0, internal.messagingFunds.applyAutoTopUp, { companyId: ctx.companyId, version: now });
    return null;
  },
});

export const autoTopUpTarget = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, args.companyId, state.env);
    if (!account) return null;
    return { customerId: customerIdFor(args.companyId), autoTopUp: controlsOf(account).autoTopUp };
  },
});

export const autoTopUpProblem = internalMutation({
  args: { companyId: v.id("companies"), problem: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, args.companyId, state.env);
    if (!account) return;
    const controls = controlsOf(account);
    if (args.problem) {
      // Not set in Autumn: shown as off, so nobody believes a card will be charged when it won't be.
      await ctx.db.patch(account._id, { messagingControls: { ...controls, autoTopUp: { ...controls.autoTopUp, enabled: false } } });
      await noticeOnce(ctx, (await ctx.db.get(account._id))!, "messaging_topup_failed", `Automatic top-up could not be turned on: ${args.problem} It is off.`, { always: true });
    }
  },
});

/** Sends the Owner's automatic top-up setting to Autumn. */
export const applyAutoTopUp = internalAction({
  args: { companyId: v.id("companies"), version: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const target = await ctx.runQuery(internal.messagingFunds.autoTopUpTarget, { companyId: args.companyId });
    if (!target) return;
    const a = target.autoTopUp;
    const answer = await setMessagingAutoTopUp({ customerId: target.customerId, enabled: a.enabled, threshold: a.threshold, quantity: a.amount, perMonth: Math.floor(a.monthlyMax / a.amount) }, `autotopup:${args.companyId}:${args.version}`);
    if (answer.kind === "ok" || answer.kind === "replayed") return;
    if (a.enabled) await ctx.runMutation(internal.messagingFunds.autoTopUpProblem, { companyId: args.companyId, problem: answer.kind === "unavailable" ? "Billing could not be reached." : answer.kind === "refused" ? answer.message : "Billing did not confirm it." });
  },
});

export const setControls = ownerMutation({
  args: { monthlyLimitCents: v.union(v.number(), v.null()), batchLimitCents: v.union(v.number(), v.null()), lowBalanceCents: v.number(), agentLimitsCents: v.record(v.string(), v.number()) },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account) throw userError("Billing hasn't loaded for this company yet. Refresh Plan & Usage and try again.");
    const units = (cents: number, label: string) => centsToUnits(wholeDollars(cents, label, 0, 1_000_000));
    const agents = ["sales", "dispatch", "recruiter", "retention"];
    const agentLimits: Record<string, number> = {};
    for (const [agent, cents] of Object.entries(args.agentLimitsCents)) {
      if (!agents.includes(agent)) throw userError("That agent has no messaging limit.");
      agentLimits[agent] = units(cents, "An agent's limit");
    }
    const controls = controlsOf(account);
    await ctx.db.patch(account._id, {
      messagingControls: {
        ...controls,
        monthlyLimit: args.monthlyLimitCents === null ? undefined : units(args.monthlyLimitCents, "The monthly limit"),
        batchLimit: args.batchLimitCents === null ? undefined : units(args.batchLimitCents, "The batch limit"),
        lowBalance: units(args.lowBalanceCents, "The low-balance alert"),
        agentLimits,
      },
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "billing.messaging_controls_changed", actor: byMember(ctx), subject: { table: "billingAccounts", id: account._id } });
    // A raised limit may let held messages go: they are checked again before each one is sent.
    await ctx.scheduler.runAfter(0, internal.messagingBilling.releaseHeld, { companyId: ctx.companyId });
    return null;
  },
});

// ── Purchases, automatic top-ups, refunds and disputes ─────────────────────────────────────────

/** A confirmed purchase came back from Autumn: recorded once per intent, and held messages released if it is paid. */
export const purchaseAnswered = internalMutation({
  args: { intentId: v.id("billingIntents"), paid: v.boolean(), url: v.optional(v.string()), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.kind !== "messaging_top_up" || !intent.quantity) return;
    const existing = await ctx.db
      .query("messagingTopUps")
      .withIndex("by_intent", (q) => q.eq("intentId", intent._id))
      .first();
    const now = Date.now();
    const status = args.paid ? ("paid" as const) : args.problem ? ("failed" as const) : ("payment_needed" as const);
    if (existing) {
      if (existing.status !== "paid") await ctx.db.patch(existing._id, { status, invoiceUrl: args.url ?? existing.invoiceUrl, problem: args.problem, updatedAt: now });
    } else {
      await ctx.db.insert("messagingTopUps", { companyId: intent.companyId, env: intent.env, source: "manual", amount: intent.quantity, cents: intent.quantity / UNITS_PER_CENT, status, intentId: intent._id, memberId: intent.memberId, invoiceUrl: args.url, problem: args.problem, applied: [], clawedBack: 0, createdAt: now, updatedAt: now });
    }
    if (args.paid) await ctx.scheduler.runAfter(0, internal.messagingBilling.releaseHeld, { companyId: intent.companyId });
  },
});

/** Autumn's automatic top-up webhooks. Succeeded is recorded once per invoice; failed tells the Owner. */
export const autoTopUpEvent = internalMutation({
  args: { companyId: v.id("companies"), succeeded: v.boolean(), quantity: v.optional(v.number()), invoiceId: v.optional(v.string()), invoiceUrl: v.optional(v.string()), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, args.companyId, state.env);
    if (!account) return;
    const now = Date.now();
    if (!args.succeeded) {
      const text = args.reason === "charge_failed" ? "An automatic top-up of the messaging balance was declined by the card. Update the payment method or add funds; outbound messages wait until then." : "An automatic top-up of the messaging balance didn't go through. Add funds to keep messages going out.";
      await noticeOnce(ctx, account, "messaging_topup_failed", text, { always: true });
      await recordEvent(ctx, { companyId: args.companyId, type: "billing.messaging_auto_topup_failed", actor: { kind: "system" }, subject: { table: "billingAccounts", id: account._id }, data: { reason: args.reason ?? null } });
      return;
    }
    if (args.invoiceId) {
      const seen = await ctx.db
        .query("messagingTopUps")
        .withIndex("by_invoice", (q) => q.eq("invoiceId", args.invoiceId))
        .first();
      if (seen) return;
    }
    const amount = Math.round(args.quantity ?? controlsOf(account).autoTopUp.amount);
    await ctx.db.insert("messagingTopUps", { companyId: args.companyId, env: state.env, source: "automatic", amount, cents: Math.round(amount / UNITS_PER_CENT), status: "paid", invoiceId: args.invoiceId, invoiceUrl: args.invoiceUrl, applied: [], clawedBack: 0, createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: args.companyId, type: "billing.messaging_auto_topup", actor: { kind: "system" }, subject: { table: "billingAccounts", id: account._id }, data: { amount } });
    await ctx.scheduler.runAfter(0, internal.messagingBilling.releaseHeld, { companyId: args.companyId });
  },
});

/**
 * A payment for a top-up was refunded or disputed (from Stripe, matched by invoice). The funds it added are
 * taken back from the balance, at most the amount it added, and each payment event is applied once. A dispute
 * won gives back what was taken. The balance may go below zero; outbound messages then wait.
 */
export async function paymentEvent(ctx: MutationCtx, input: { invoiceId: string; eventId: string; kind: "refund" | "dispute_opened" | "dispute_won" | "dispute_lost"; cents: number }) {
  const topUp = await ctx.db
    .query("messagingTopUps")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", input.invoiceId))
    .first();
  if (!topUp || topUp.applied.includes(input.eventId)) return null;
  const now = Date.now();
  let change = 0;
  let status = topUp.status;
  if (input.kind === "refund") {
    // Stripe reports the total refunded so far on the charge: take back up to that, never more than the top-up added.
    change = Math.max(0, Math.min(centsToUnits(Math.max(0, input.cents)), topUp.amount) - topUp.clawedBack);
    status = topUp.clawedBack + change >= topUp.amount ? "refunded" : "partly_refunded";
  } else if (input.kind === "dispute_opened") {
    change = Math.min(centsToUnits(Math.max(0, input.cents)), topUp.amount - topUp.clawedBack);
    status = input.kind === "dispute_opened" ? "disputed" : topUp.clawedBack + change >= topUp.amount ? "refunded" : "partly_refunded";
  } else if (input.kind === "dispute_won") {
    change = -topUp.clawedBack;
    status = "dispute_won";
  } else {
    status = "disputed";
  }
  await ctx.db.patch(topUp._id, { status, clawedBack: topUp.clawedBack + change, applied: [...topUp.applied, input.eventId].slice(-20), updatedAt: now });
  if (change !== 0) {
    const chargeId: Id<"messagingCharges"> = await ctx.db.insert("messagingCharges", {
      companyId: topUp.companyId,
      env: topUp.env,
      kind: "adjustment",
      activity: change > 0 ? (input.kind === "refund" ? "Top-up refunded: funds taken back" : "Top-up payment disputed: funds held back") : "Dispute won: funds returned",
      count: 1,
      rateCardVersion: "payment",
      unitPrice: change,
      reserved: 0,
      amount: change,
      state: "captured",
      settlement: "pending_track",
      settleAttempts: 0,
      nextSettleAt: now,
      reason: `${input.kind} ${input.eventId}`.slice(0, 300),
      history: [{ at: now, kind: input.kind, amount: change }],
      createdAt: now,
      updatedAt: now,
      capturedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId });
  }
  await recordEvent(ctx, { companyId: topUp.companyId, type: `billing.messaging_${input.kind}`, actor: { kind: "system" }, subject: { table: "companies", id: topUp.companyId }, data: { cents: input.cents } });
  return topUp._id;
}

/**
 * Selestial staff: a dispute on a top-up payment, matched by hand (Stripe's dispute names the charge, not the
 * invoice, and this deployment cannot read Stripe's charges). Applied once per dispute event id.
 */
export const recordDispute = staffMutation({
  args: { topUpId: v.id("messagingTopUps"), eventId: v.string(), kind: v.union(v.literal("dispute_opened"), v.literal("dispute_won"), v.literal("dispute_lost")), cents: v.number() },
  handler: async (ctx, args) => {
    const topUp = await ctx.db.get(args.topUpId);
    if (!topUp?.invoiceId) throw userError("That top-up has no invoice to match a dispute to.");
    return paymentEvent(ctx, { invoiceId: topUp.invoiceId, eventId: args.eventId.slice(0, 100), kind: args.kind, cents: args.cents });
  },
});

/** Selestial staff: a credit to a company's messaging balance (a goodwill credit or a correction), audited with its reason. */
export const supportCredit = staffMutation({
  args: { companyId: v.id("companies"), cents: v.number(), reason: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    if (!(await ctx.db.get(args.companyId))) throw userError("No such company.", "not_found");
    const reason = args.reason.trim();
    if (reason.length < 5) throw userError("Say why, so the credit can be audited.");
    const amount = centsToUnits(wholeDollarsOrCents(args.cents));
    const existing = await ctx.db
      .query("messagingCharges")
      .withIndex("by_company_inbound", (q) => q.eq("companyId", args.companyId).eq("inboundKey", `support:${args.key}`))
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    const chargeId = await ctx.db.insert("messagingCharges", { companyId: args.companyId, env: state.env, kind: "adjustment", inboundKey: `support:${args.key}`.slice(0, 120), activity: "Credit from Selestial support", count: 1, rateCardVersion: "support", unitPrice: -amount, reserved: 0, amount: -amount, state: "captured", settlement: "pending_track", settleAttempts: 0, nextSettleAt: now, reason: reason.slice(0, 300), history: [{ at: now, kind: "support_credit", amount: -amount, note: reason.slice(0, 300) }], createdAt: now, updatedAt: now, capturedAt: now });
    await recordEvent(ctx, { companyId: args.companyId, type: "billing.messaging_support_credit", actor: { kind: "system" }, subject: { table: "messagingCharges", id: chargeId }, data: { cents: args.cents, staff: ctx.staff._id } });
    await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId });
    return chargeId;
  },
});

/** Selestial staff: refunds one messaging charge, naming it. A charge can be refunded once. */
export const supportRefund = staffMutation({
  args: { chargeId: v.id("messagingCharges"), reason: v.string() },
  handler: async (ctx, args) => {
    const reason = args.reason.trim();
    if (reason.length < 5) throw userError("Say why, so the refund can be audited.");
    const refundId = await refundCharge(ctx, args.chargeId, { reason });
    if (!refundId) throw userError("That charge can't be refunded: it was not charged, or it was already refunded.");
    return refundId;
  },
});

function wholeDollarsOrCents(cents: number) {
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000) throw userError("A credit is between 1 cent and $1,000.");
  return cents;
}

export const paymentEventReceived = internalMutation({
  args: { invoiceId: v.string(), eventId: v.string(), kind: v.union(v.literal("refund"), v.literal("dispute_opened"), v.literal("dispute_won"), v.literal("dispute_lost")), cents: v.number() },
  handler: async (ctx, args) => paymentEvent(ctx, args),
});


