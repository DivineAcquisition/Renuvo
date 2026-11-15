/**
 * Sending a planned message, in three separate steps so a crash between any two is recoverable and
 * nothing is sent twice. claim: queued becomes sending, in one transaction, so two workers cannot both
 * take it. send: the provider is called once, with the message's id as its idempotency key. settle: the
 * outcome is written. A send that never settles is found later and marked unconfirmed. It is not sent
 * again by itself, because nobody knows whether the first one went.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { afterMessageFailed } from "./lib/dispatch/delivery";
import { linkPath, linkState, siteOrigin, tokenFor } from "./lib/dispatch/links";
import { recordEvent } from "./lib/events";
import { messagingProvider } from "./lib/messaging/provider";

const MAX_ATTEMPTS = 3;
const STUCK_AFTER = 5 * 60 * 1000;

/** Takes a queued message for sending. Null means there is nothing to send: someone else has it, or it was withdrawn. */
export const claim = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.status !== "queued" || !message.to) return null;
    let body = message.body;
    if (message.linkId) {
      const link = await ctx.db.get(message.linkId);
      const token = link ? await tokenFor(link) : null;
      // A text is never sent with a link that is already closed.
      if (!link || !token || linkState(link, Date.now()) !== "active") {
        await ctx.db.patch(message._id, { status: "not_sent", problem: "The link was closed before the text went out." });
        await recordEvent(ctx, { companyId: message.companyId, type: "message.not_sent", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
        return null;
      }
      body = body.replace("{link}", `${siteOrigin()}${linkPath(link.purpose, token, message.linkPath ?? "")}`);
    }
    const attempt = message.attempts + 1;
    await ctx.db.patch(message._id, { status: "sending", attempts: attempt, attemptedAt: Date.now() });
    return { to: message.to, body, attempt };
  },
});

const resultValidator = v.union(
  v.object({ ok: v.literal(true), providerMessageId: v.string(), delivered: v.boolean() }),
  v.object({ ok: v.literal(false), retryable: v.boolean(), problem: v.string() }),
);

export const settle = internalMutation({
  args: { messageId: v.id("messages"), result: resultValidator },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    // Only a send that is in flight can be settled, so a late or repeated answer changes nothing.
    if (!message || message.status !== "sending") return null;
    const now = Date.now();
    const subject = { table: "messages" as const, id: message._id };
    const result = args.result;
    if (result.ok) {
      await ctx.db.patch(message._id, { status: result.delivered ? "delivered" : "sent", providerMessageId: result.providerMessageId, sentAt: now, ...(result.delivered ? { deliveredAt: now } : {}), problem: undefined });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.sent", actor: { kind: "system" }, subject, data: { purpose: message.purpose, attempt: message.attempts } });
      if (result.delivered) await recordEvent(ctx, { companyId: message.companyId, type: "message.delivered", actor: { kind: "system" }, subject, data: { purpose: message.purpose } });
      return null;
    }
    if (result.retryable && message.attempts < MAX_ATTEMPTS) {
      await ctx.db.patch(message._id, { status: "queued", problem: result.problem });
      await ctx.scheduler.runAfter(message.attempts * 30_000, internal.messaging.deliver, { messageId: message._id });
      return null;
    }
    await ctx.db.patch(message._id, { status: "failed", failedAt: now, problem: result.problem });
    await recordEvent(ctx, { companyId: message.companyId, type: "message.failed", actor: { kind: "system" }, subject, data: { purpose: message.purpose, attempts: message.attempts } });
    await afterMessageFailed(ctx, { ...message, status: "failed", problem: result.problem });
    return null;
  },
});

export const deliver = internalAction({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.messaging.claim, { messageId: args.messageId });
    if (!claimed) return null;
    const provider = messagingProvider();
    if (!provider) {
      await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result: { ok: false, retryable: false, problem: "Text messaging is not connected." } });
      return null;
    }
    // If this throws, nobody knows whether the text went. The message stays "sending" and the sweep marks it unconfirmed.
    const result = await provider.send({ to: claimed.to, body: claimed.body, idempotencyKey: args.messageId, attempt: claimed.attempt });
    await ctx.runMutation(internal.messaging.settle, { messageId: args.messageId, result });
    return null;
  },
});

/**
 * A delivery report from the provider. The same report arriving twice changes nothing the second time.
 * This is what a webhook will call once a provider is connected.
 */
export const receipt = internalMutation({
  args: { provider: v.string(), eventId: v.string(), providerMessageId: v.string(), outcome: v.union(v.literal("delivered"), v.literal("failed")), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("providerReceipts")
      .withIndex("by_provider_event", (q) => q.eq("provider", args.provider).eq("eventId", args.eventId))
      .first();
    if (seen) return "duplicate" as const;
    await ctx.db.insert("providerReceipts", { provider: args.provider, eventId: args.eventId, receivedAt: Date.now() });
    const message = await ctx.db
      .query("messages")
      .withIndex("by_provider_message", (q) => q.eq("provider", args.provider).eq("providerMessageId", args.providerMessageId))
      .first();
    if (!message || (message.status !== "sent" && message.status !== "unconfirmed")) return "ignored" as const;
    const now = Date.now();
    const subject = { table: "messages" as const, id: message._id };
    if (args.outcome === "delivered") {
      await ctx.db.patch(message._id, { status: "delivered", deliveredAt: now });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.delivered", actor: { kind: "system" }, subject, data: { purpose: message.purpose } });
      return "delivered" as const;
    }
    const problem = "The carrier reported that the text was not delivered.";
    await ctx.db.patch(message._id, { status: "failed", failedAt: now, problem });
    await recordEvent(ctx, { companyId: message.companyId, type: "message.failed", actor: { kind: "system" }, subject, data: { purpose: message.purpose, attempts: message.attempts } });
    await afterMessageFailed(ctx, { ...message, status: "failed", problem });
    return "failed" as const;
  },
});

/** Run on a schedule: a send that started and never settled is marked unconfirmed and handed on. */
export const sweepStuck = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stuck = await ctx.db
      .query("messages")
      .withIndex("by_status_attempted", (q) => q.eq("status", "sending").lt("attemptedAt", Date.now() - STUCK_AFTER))
      .take(100);
    for (const message of stuck) {
      const problem = "The send was started and never finished, so it is not known whether the text went. It was not sent again.";
      await ctx.db.patch(message._id, { status: "unconfirmed", problem });
      await recordEvent(ctx, { companyId: message.companyId, type: "message.unconfirmed", actor: { kind: "system" }, subject: { table: "messages", id: message._id }, data: { purpose: message.purpose } });
      await afterMessageFailed(ctx, { ...message, status: "unconfirmed", problem });
    }
    return stuck.length;
  },
});
