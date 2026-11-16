/**
 * Billing records. None of them is a subscription engine or a credit wallet: Autumn holds plans and
 * balances. These keep the company-to-customer mapping, a read-only copy of what Autumn last said, one row
 * per piece of AI work with its charge and settlement, and references to Autumn's webhooks and to the
 * purchases people started, for reconciliation and retries.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { AGENT_IDS, PLAN_IDS } from "./catalog";
import { TASK_IDS } from "./rateCards";

export const envValidator = v.union(v.literal("sandbox"), v.literal("production"));
export const planValidator = literals(PLAN_IDS);

/** Why something cannot run, kept apart so each can be explained and fixed in its own way. */
export const BLOCKS = ["not_connected", "not_approved", "not_released", "plan", "permission", "credits", "integration", "billing_unavailable", "budget", "needs_authorization"] as const;
export type Block = (typeof BLOCKS)[number];
export const blockValidator = literals(BLOCKS);

export const EXECUTION_STATES = ["pending", "reserving", "reserved", "denied", "paused", "completed", "failed", "canceled", "expired"] as const;
export type ExecutionState = (typeof EXECUTION_STATES)[number];

export const SETTLEMENTS = ["none", "pending_confirm", "pending_release", "confirmed", "released", "unverified", "unbilled"] as const;
export type Settlement = (typeof SETTLEMENTS)[number];

export const spendingControlsValidator = v.object({
  /** At most this many credits for one piece of work without someone authorizing it. Unset: no limit. */
  perRunLimit: v.optional(v.number()),
  /** Credits that work no person asked for (inbox reading, scheduled work) may use in a billing period. Unset: no limit. */
  autonomousMonthly: v.optional(v.number()),
  /** Percentages of the included allowance at which the Owner is told. */
  alertPercents: v.array(v.number()),
  /** Off unless the Owner turns it on, and then only within these limits. Purchases are not built yet. */
  autoTopUp: v.object({ enabled: v.boolean(), credits: v.optional(v.number()), maxPerMonth: v.optional(v.number()) }),
});

export const billingTables = {
  billingAccounts: defineTable({
    companyId: v.id("companies"),
    env: envValidator,
    /** Derived on the server from the company id; never taken from a request. */
    customerId: v.string(),
    /** The verified plan: an active Operate or Expand subscription in Autumn. Null: none. */
    plan: v.union(planValidator, v.null()),
    subscription: v.object({
      pastDue: v.boolean(),
      startedAt: v.union(v.number(), v.null()),
      periodEnd: v.union(v.number(), v.null()),
      /** Set when the subscription ends at the period end instead of renewing. */
      endsAt: v.union(v.number(), v.null()),
      scheduledPlan: v.union(planValidator, v.null()),
      scheduledAt: v.union(v.number(), v.null()),
    }),
    credits: v.union(
      v.object({
        remaining: v.number(),
        granted: v.number(),
        used: v.number(),
        included: v.object({ granted: v.number(), remaining: v.number() }),
        purchased: v.object({ granted: v.number(), remaining: v.number(), expiresAt: v.union(v.number(), v.null()) }),
        nextResetAt: v.union(v.number(), v.null()),
      }),
      v.null(),
    ),
    controls: spendingControlsValidator,
    /** The alert thresholds already sent for the current period. */
    alertsSent: v.object({ period: v.string(), percents: v.array(v.number()) }),
    notices: v.array(v.object({ kind: v.union(v.literal("zero_balance"), v.literal("usage_alert"), v.literal("billing_unavailable"), v.literal("past_due")), at: v.number(), text: v.string() })),
    /** Recent invoices as Autumn lists them. Amounts in cents. */
    invoices: v.array(v.object({ id: v.string(), status: v.string(), cents: v.number(), currency: v.string(), createdAt: v.number(), url: v.union(v.string(), v.null()) })),
    syncedAt: v.number(),
    syncProblem: v.optional(v.string()),
  })
    .index("by_company_env", ["companyId", "env"])
    .index("by_env_customer", ["env", "customerId"]),

  /** One row per piece of AI work: what it was, what it was priced at, and how its charge was settled. */
  aiExecutions: defineTable({
    companyId: v.id("companies"),
    env: envValidator,
    /** One per piece of work, so asking twice opens one execution. */
    key: v.string(),
    /** The agent whose work it is; "chat" for Company Chat's answers, "studio" for Creative Studio. */
    agent: v.union(literals(AGENT_IDS), v.literal("chat"), v.literal("studio")),
    /** A plan feature the work also needs, such as Creative Studio. */
    feature: v.optional(v.string()),
    task: literals(TASK_IDS),
    units: v.number(),
    rateCardVersion: v.string(),
    /** Credits per unit at the time it was priced. Never changed afterwards. */
    rate: v.number(),
    /** Credits held: rate × units. */
    credits: v.number(),
    /** Work no person asked for at that moment. */
    autonomous: v.boolean(),
    memberId: v.optional(v.id("members")),
    state: literals(EXECUTION_STATES),
    block: v.optional(blockValidator),
    message: v.optional(v.string()),
    lockId: v.optional(v.string()),
    lockAttempts: v.number(),
    lockExpiresAt: v.optional(v.number()),
    completedUnits: v.optional(v.number()),
    /** Credits charged when settled. */
    charged: v.optional(v.number()),
    settlement: literals(SETTLEMENTS),
    settleAttempts: v.number(),
    nextSettleAt: v.optional(v.number()),
    settleProblem: v.optional(v.string()),
    source: v.optional(v.object({ table: v.string(), id: v.string() })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_settlement_next", ["settlement", "nextSettleAt"])
    .index("by_state_updated", ["state", "updatedAt"]),

  /** Each Autumn webhook once, by its delivery id. */
  billingWebhooks: defineTable({
    env: envValidator,
    deliveryId: v.string(),
    type: v.string(),
    customerId: v.optional(v.string()),
    companyId: v.optional(v.id("companies")),
    receivedAt: v.number(),
  }).index("by_env_delivery", ["env", "deliveryId"]),

  /**
   * A plan change, cancellation, top-up or billing-portal visit the Owner started. Its id is the
   * Idempotency-Key sent to Autumn, so a double click or a retried request is one purchase.
   */
  billingIntents: defineTable({
    companyId: v.id("companies"),
    env: envValidator,
    kind: v.union(v.literal("plan_change"), v.literal("top_up"), v.literal("cancel"), v.literal("uncancel"), v.literal("portal"), v.literal("payment_method")),
    planId: v.optional(v.string()),
    quantity: v.optional(v.number()),
    memberId: v.id("members"),
    stage: v.union(v.literal("previewing"), v.literal("awaiting_confirmation"), v.literal("submitting"), v.literal("done"), v.literal("payment_needed"), v.literal("failed")),
    /** What Autumn says the change costs and when it takes effect. Amounts in cents. */
    preview: v.optional(
      v.object({
        currency: v.string(),
        dueNowCents: v.number(),
        nextCycleCents: v.union(v.number(), v.null()),
        nextCycleAt: v.union(v.number(), v.null()),
        effectiveAt: v.union(v.number(), v.null()),
        activates: v.string(),
        lines: v.array(v.object({ label: v.string(), cents: v.number() })),
        lostAgents: v.array(v.string()),
        lostFeatures: v.array(v.string()),
      }),
    ),
    /** Where to send the Owner: Stripe Checkout, a payment page, or the billing portal. */
    url: v.optional(v.string()),
    problem: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_company_created", ["companyId", "createdAt"]),
};

export const DEFAULT_CONTROLS = { alertPercents: [50, 80, 100], autoTopUp: { enabled: false } };
