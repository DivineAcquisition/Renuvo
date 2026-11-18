/**
 * The messaging ledger. Autumn holds the money (payments, the available balance and reservations as locks);
 * these rows are Selestial's audit record of each charge: what was sent or received, how it was counted, the
 * rate it was authorized under, what was reserved, what was finally charged, refunds and corrections, and
 * what the provider charged Selestial. Amounts are whole units of $0.0001 (money.ts).
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { envValidator } from "../billing/schema";
import { MESSAGING_KINDS } from "./rates";

export const CHARGE_KINDS = [...MESSAGING_KINDS, "number_monthly", "registration_fee", "refund", "adjustment"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];

/**
 * estimated   priced, nothing held yet
 * reserving   asking Autumn to hold the amount (recorded first, so a crash is found and released)
 * reserved    Autumn holds it; the message may be handed to the provider
 * pending     handed to the provider and the outcome is not known yet; the hold stays until it is
 * captured    charged: the final amount is settled in Autumn
 * released    nothing charged: the hold was returned
 * refunded    charged, then credited back by a refund row that names this one
 */
export const CHARGE_STATES = ["estimated", "reserving", "reserved", "pending", "captured", "released", "refunded"] as const;
export type ChargeState = (typeof CHARGE_STATES)[number];

/** How the charge was settled with Autumn, retried by the sweep until it is final. */
export const CHARGE_SETTLEMENTS = ["none", "pending_confirm", "pending_release", "pending_track", "confirmed", "released", "tracked", "unverified", "unbilled"] as const;
export type ChargeSettlement = (typeof CHARGE_SETTLEMENTS)[number];

export const messagingTables = {
  messagingCharges: defineTable({
    companyId: v.id("companies"),
    env: envValidator,
    kind: literals(CHARGE_KINDS),
    channel: v.optional(v.union(v.literal("sms"), v.literal("mms"), v.literal("email"))),
    direction: v.optional(v.union(v.literal("out"), v.literal("in"))),
    /** The outbound message this charge is for. One charge per message: retries reuse it. */
    messageId: v.optional(v.id("messages")),
    /** Inbound: the provider's message id, one charge per inbound message. */
    inboundKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    /** Who started it: an agent, a person, or Selestial itself (inbound, number rental). */
    agent: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    origin: v.optional(v.string()),
    /** What business activity produced it, in words, for the Owner. */
    activity: v.optional(v.string()),
    /** Segments, messages, recipients or months. `estimatedCount` is what was reserved for. */
    count: v.number(),
    estimatedCount: v.optional(v.number()),
    rateCardVersion: v.string(),
    unitPrice: v.number(),
    reserved: v.number(),
    /** The final charge (positive) or credit (negative, refunds and adjustments). */
    amount: v.number(),
    state: literals(CHARGE_STATES),
    lockId: v.optional(v.string()),
    lockExpiresAt: v.optional(v.number()),
    settlement: literals(CHARGE_SETTLEMENTS),
    settleAttempts: v.number(),
    nextSettleAt: v.optional(v.number()),
    settleProblem: v.optional(v.string()),
    /** The provider counted more units than were held: the hold was confirmed and the difference tracked once on its own. */
    extraTracked: v.optional(v.boolean()),
    /** What the provider charged Selestial, in units, when it reported it. Internal; never shown to tenants as their price. */
    providerCost: v.optional(v.number()),
    /** A refund or adjustment names the charge it corrects; a charge names the refund that corrected it. */
    refundOf: v.optional(v.id("messagingCharges")),
    refundedBy: v.optional(v.id("messagingCharges")),
    reason: v.optional(v.string()),
    by: v.optional(v.id("members")),
    history: v.array(v.object({ at: v.number(), kind: v.string(), amount: v.optional(v.number()), note: v.optional(v.string()) })),
    createdAt: v.number(),
    updatedAt: v.number(),
    capturedAt: v.optional(v.number()),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_message", ["messageId"])
    .index("by_company_inbound", ["companyId", "inboundKey"])
    .index("by_settlement_next", ["settlement", "nextSettleAt"])
    .index("by_state_updated", ["state", "updatedAt"])
    .index("by_refund_of", ["refundOf"]),
};
