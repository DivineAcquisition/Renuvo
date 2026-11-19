/**
 * Messaging billing: holding, settling and reconciling messaging charges with Autumn, and releasing messages
 * that waited for funds. The ledger rules are in convex/lib/messagingBilling/ledger.ts.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { customerIdFor } from "./lib/billing/access";
import { finalizeMessaging, lockMessaging, trackMessaging } from "./lib/billing/autumn";
import { recordEvent } from "./lib/events";
import { heldNotice, HOLD_MS, releaseCharge, reserveAnswered, STALE_HOLD_MS } from "./lib/messagingBilling/ledger";

const MINUTE = 60_000;
const BACKOFF = [1, 5, 15, 60, 180, 360].map((m) => m * MINUTE);

export const lockInfo = internalQuery({
  args: { chargeId: v.id("messagingCharges") },
  handler: async (ctx, args) => {
    const charge = await ctx.db.get(args.chargeId);
    if (!charge || charge.state !== "reserving" || !charge.lockId) return null;
    return { customerId: customerIdFor(charge.companyId), lockId: charge.lockId, amount: charge.reserved, expiresAt: charge.lockExpiresAt ?? Date.now() + HOLD_MS, kind: charge.kind, agent: charge.agent ?? "", rateCard: charge.rateCardVersion };
  },
});

export const lockAnswered = internalMutation({
  args: { chargeId: v.id("messagingCharges"), outcome: v.union(v.literal("reserved"), v.literal("denied"), v.literal("unavailable")), remaining: v.optional(v.number()) },
  handler: async (ctx, args) => reserveAnswered(ctx, args.chargeId, args.outcome, args.remaining),
});

/**
 * Asks Autumn to hold a charge's estimate. Only a verified 200 that is allowed for this customer counts.
 * A degraded 202, a timeout or an error is never treated as a hold: any hold it may have made is released.
 */
export async function reserveCharge(ctx: ActionCtx, chargeId: Id<"messagingCharges">): Promise<"reserved" | "denied" | "unavailable"> {
  const info = await ctx.runQuery(internal.messagingBilling.lockInfo, { chargeId });
  if (!info) return "reserved";
  const answer = await lockMessaging({ customerId: info.customerId, lockId: info.lockId, amount: info.amount, expiresAt: info.expiresAt, properties: { charge_id: chargeId, kind: info.kind, agent: info.agent, rate_card: info.rateCard } });
  if (answer.kind === "ok" && answer.data.customer_id === info.customerId) {
    const remaining = typeof answer.data.balance?.remaining === "number" ? Math.round(answer.data.balance.remaining) : undefined;
    const outcome = answer.data.allowed ? "reserved" : "denied";
    await ctx.runMutation(internal.messagingBilling.lockAnswered, { chargeId, outcome, remaining });
    return outcome;
  }
  if (answer.kind === "replayed") {
    await ctx.runMutation(internal.messagingBilling.lockAnswered, { chargeId, outcome: "reserved" });
    return "reserved";
  }
  await finalizeMessaging({ customerId: info.customerId, lockId: info.lockId, action: "release" });
  await ctx.runMutation(internal.messagingBilling.lockAnswered, { chargeId, outcome: "unavailable" });
  return "unavailable";
}

/** A message whose hold was refused or could not be checked: it waits, with its content kept, and is not sent. */
export const holdMessage = internalMutation({
  args: { messageId: v.id("messages"), reason: v.union(v.literal("messaging_balance"), v.literal("billing_unavailable")), words: v.string() },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.status !== "sending") return;
    const now = Date.now();
    await ctx.db.patch(message._id, { status: "held", holdReason: args.reason, heldAt: message.heldAt ?? now, problem: args.words, attempts: Math.max(0, message.attempts - 1) });
    await recordEvent(ctx, { companyId: message.companyId, type: "message.held", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose, policy: args.reason } });
    // Billing unreachable is retried by itself; a missing balance waits for funds.
    if (args.reason === "billing_unavailable") await ctx.scheduler.runAfter(10 * MINUTE, internal.messaging.deliver, { messageId: message._id });
    else await heldNotice(ctx, message.companyId, args.reason);
  },
});

// ── Settlement ─────────────────────────────────────────────────────────────────────────────────

export const settlementOf = internalQuery({
  args: { chargeId: v.id("messagingCharges") },
  handler: async (ctx, args) => {
    const charge = await ctx.db.get(args.chargeId);
    if (!charge) return null;
    return { customerId: customerIdFor(charge.companyId), charge };
  },
});

export const settleAnswered = internalMutation({
  args: { chargeId: v.id("messagingCharges"), outcome: v.union(v.literal("done"), v.literal("retry"), v.literal("unverified"), v.literal("unbilled"), v.literal("extra_pending")), problem: v.optional(v.string()), remaining: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const charge = await ctx.db.get(args.chargeId);
    if (!charge) return;
    const now = Date.now();
    if (args.outcome === "retry") {
      const attempts = charge.settleAttempts + 1;
      await ctx.db.patch(charge._id, { settleAttempts: attempts, nextSettleAt: now + BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)], settleProblem: args.problem, updatedAt: now });
      return;
    }
    if (args.outcome === "extra_pending") {
      // The hold is confirmed; the part above it is still to be tracked.
      await ctx.db.patch(charge._id, { settlement: "pending_track", nextSettleAt: now, updatedAt: now });
      return;
    }
    const final = args.outcome === "done" ? (charge.settlement === "pending_release" ? "released" : charge.settlement === "pending_track" ? "tracked" : "confirmed") : args.outcome;
    await ctx.db.patch(charge._id, {
      settlement: final,
      nextSettleAt: undefined,
      settleProblem: args.problem,
      ...(charge.settlement === "pending_track" && charge.kind !== "refund" && charge.direction === "out" ? { extraTracked: true } : {}),
      updatedAt: now,
      history: [...charge.history, { at: now, kind: `settled:${final}`, note: args.problem }].slice(-30),
    });
  },
});

/**
 * Settles one charge with Autumn: confirm a hold for the final amount (and track any part above the hold once),
 * release a hold, record an inbound charge (which may overdraw, within Selestial's own bound), or credit back a
 * refund. Safe to run again: every call carries an idempotency key, and a replay counts as done.
 */
export const settle = internalAction({
  args: { chargeId: v.id("messagingCharges") },
  handler: async (ctx, args): Promise<void> => {
    const found: { customerId: string; charge: Doc<"messagingCharges"> } | null = await ctx.runQuery(internal.messagingBilling.settlementOf, { chargeId: args.chargeId });
    if (!found) return;
    const { charge, customerId } = found;
    const answered = async (outcome: "done" | "retry" | "unverified" | "unbilled" | "extra_pending", problem?: string): Promise<void> => {
      await ctx.runMutation(internal.messagingBilling.settleAnswered, { chargeId: charge._id, outcome, problem });
    };
    const classify = async (answer: { kind: string; message?: string }, onRefused: "unbilled" | "done" = "unbilled"): Promise<boolean> => {
      if (answer.kind === "ok" || answer.kind === "replayed") return true;
      if (answer.kind === "degraded") await answered("unverified", "Autumn accepted this without verifying it; it will be checked in reconciliation.");
      else if (answer.kind === "unavailable") await answered("retry", answer.message);
      else await answered(onRefused, answer.message);
      return false;
    };
    if (charge.settlement === "pending_release") {
      if (!charge.lockId) {
        await answered("done");
        return;
      }
      const answer = await finalizeMessaging({ customerId, lockId: charge.lockId, action: "release" });
      // A lock that has already gone (expired or released) needs nothing more.
      if (await classify(answer, "done")) await answered("done");
      return;
    }
    if (charge.settlement === "pending_confirm") {
      if (!charge.lockId) {
        await answered("done");
        return;
      }
      const confirmAmount = Math.min(charge.amount, charge.reserved);
      const answer = await finalizeMessaging({ customerId, lockId: charge.lockId, action: "confirm", amount: confirmAmount });
      if (!(await classify(answer))) return;
      if (charge.amount > charge.reserved && !charge.extraTracked) {
        await answered("extra_pending");
        await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId: charge._id });
        return;
      }
      await answered("done");
      return;
    }
    if (charge.settlement === "pending_track") {
      const props = { charge_id: charge._id, kind: charge.kind, agent: charge.agent ?? "", rate_card: charge.rateCardVersion };
      if (charge.direction === "in" && charge.kind !== "refund" && charge.lockId) {
        // Inbound cannot be refused: hold with overflow, then confirm. Selestial bounds the overdraft itself.
        const lock = await lockMessaging({ customerId, lockId: charge.lockId, amount: charge.amount, expiresAt: Date.now() + HOLD_MS, overflow: true, properties: props });
        if (!(await classify(lock))) return;
        const confirm = await finalizeMessaging({ customerId, lockId: charge.lockId, action: "confirm", amount: charge.amount });
        if (await classify(confirm)) await answered("done");
        return;
      }
      // A refund (negative) or the part of a capture above its hold (positive), tracked once by its own key.
      const amount = charge.kind === "refund" || charge.kind === "adjustment" ? charge.amount : charge.amount - charge.reserved;
      const answer = await trackMessaging({ customerId, amount, key: `${charge._id}`, properties: props });
      if (await classify(answer)) await answered("done");
    }
  },
});

// ── Recovery and release ───────────────────────────────────────────────────────────────────────

/**
 * Every few minutes:
 *  - a hold asked for and never answered (a crash between the two) is released;
 *  - a message whose outcome never came back is released before its hold expires, uncharged;
 *  - settlements that failed are retried with backoff;
 *  - messages waiting for funds are released when there are funds again (recent ones only).
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stuck = await ctx.db
      .query("messagingCharges")
      .withIndex("by_state_updated", (q) => q.eq("state", "reserving").lt("updatedAt", now - 10 * MINUTE))
      .take(100);
    for (const charge of stuck) {
      await ctx.db.patch(charge._id, { state: "reserved", updatedAt: now });
      await releaseCharge(ctx, charge._id, "The hold was asked for and never answered; it was released.");
    }
    const uncertain = await ctx.db
      .query("messagingCharges")
      .withIndex("by_state_updated", (q) => q.eq("state", "pending").lt("updatedAt", now - (HOLD_MS - 30 * MINUTE)))
      .take(100);
    for (const charge of uncertain) await releaseCharge(ctx, charge._id, "The provider never confirmed this message, so it was not charged. It was not sent again.");
    for (const settlement of ["pending_confirm", "pending_release", "pending_track"] as const) {
      const due = await ctx.db
        .query("messagingCharges")
        .withIndex("by_settlement_next", (q) => q.eq("settlement", settlement).lt("nextSettleAt", now))
        .take(50);
      for (const charge of due) await ctx.scheduler.runAfter(0, internal.messagingBilling.settle, { chargeId: charge._id });
    }
    return { stuck: stuck.length, uncertain: uncertain.length };
  },
});

/**
 * Sends again the messages that waited for funds or a limit, now that there is room. Each one goes back
 * through the outbox's claim, which asks the sending policy again (consent, opt-outs, quiet hours, pauses)
 * and each area's own check (the job still needs a cleaner, the invoice is still owed, the deal is still open).
 * A message that has waited more than a day is not released by itself: a person looks at it first.
 */
export const releaseHeld = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const now = Date.now();
    let released = 0;
    let stale = 0;
    for (const reason of ["messaging_balance", "messaging_limit", "billing_unavailable"] as const) {
      const held = await ctx.db
        .query("messages")
        .withIndex("by_company_hold", (q) => q.eq("companyId", args.companyId).eq("holdReason", reason))
        .take(500);
      for (const message of held) {
        if (message.status !== "held") continue;
        if (now - (message.heldAt ?? now) > STALE_HOLD_MS) {
          stale += 1;
          continue;
        }
        await ctx.db.patch(message._id, { status: "queued", holdReason: undefined });
        await ctx.scheduler.runAfter(released * 200, internal.messaging.deliver, { messageId: message._id });
        released += 1;
      }
    }
    return { released, stale };
  },
});


