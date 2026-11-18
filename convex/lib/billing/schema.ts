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
  /** Retired name of approvalThreshold, kept so older rows still read. */
  perRunLimit: v.optional(v.number()),
  /** Work estimated above this waits for the Owner (an alert to act, not a ceiling). Unset: none. */
  approvalThreshold: v.optional(v.number()),
  /** A hard ceiling: no single piece of work may hold more. Unset: none. */
  maxPerExecution: v.optional(v.number()),
  /** Monthly credit budget per agent, a hard limit. Missing agents: no budget. */
  agentBudgets: v.optional(v.record(v.string(), v.number())),
  /** Tell the Owner when available credits fall below this. Unset: no low-balance alert. */
  lowBalance: v.optional(v.number()),
  /** Credits that work no person asked for (inbox reading, scheduled work) may use in a billing period. Unset: no limit. */
  autonomousMonthly: v.optional(v.number()),
  /** Percentages of the included allowance at which the Owner is told. */
  alertPercents: v.array(v.number()),
  /** Off unless the Owner turns it on, and then only within these limits. Purchases are not built yet. */
  autoTopUp: v.object({ enabled: v.boolean(), credits: v.optional(v.number()), maxPerMonth: v.optional(v.number()) }),
});

export const messagingControlsValidator = v.object({
  /** Outbound messaging may spend at most this much in a calendar month. Unset: no limit. */
  monthlyLimit: v.optional(v.number()),
  /** A single batch or campaign may spend at most this much. Unset: no limit. */
  batchLimit: v.optional(v.number()),
  /** Monthly outbound limit per agent. Missing agents: no limit. */
  agentLimits: v.optional(v.record(v.string(), v.number())),
  /** Tell the Owner when the balance falls below this. */
  lowBalance: v.number(),
  /** Automatic top-up, off unless the Owner authorized it with the exact wording shown. */
  autoTopUp: v.object({
    enabled: v.boolean(),
    threshold: v.number(),
    amount: v.number(),
    monthlyMax: v.number(),
    authorizedAt: v.optional(v.number()),
    authorizedBy: v.optional(v.id("members")),
    wording: v.optional(v.string()),
  }),
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
    notices: v.array(v.object({ kind: v.union(v.literal("zero_balance"), v.literal("usage_alert"), v.literal("billing_unavailable"), v.literal("past_due"), v.literal("low_balance"), v.literal("messaging_low"), v.literal("messaging_empty"), v.literal("messaging_overdraft"), v.literal("messaging_topup_failed"), v.literal("messaging_held")), at: v.number(), text: v.string() })),
    /** The messaging balance as Autumn last reported it, in units of $0.0001. Purchased and promotional funds are kept apart. */
    messaging: v.optional(
      v.object({
        remaining: v.number(),
        purchased: v.number(),
        promotional: v.object({ remaining: v.number(), expiresAt: v.union(v.number(), v.null()) }),
        at: v.number(),
      }),
    ),
    /** The Owner's messaging spending controls. Amounts in units of $0.0001. */
    messagingControls: v.optional(messagingControlsValidator),
    /** Balance changes other than usage, as Autumn's ledger lists them: monthly grants, top-ups, plan changes, adjustments. */
    ledger: v.optional(v.array(v.object({ id: v.string(), at: v.number(), kind: v.string(), label: v.string(), change: v.union(v.number(), v.null()), after: v.union(v.number(), v.null()) }))),
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
    /** The agent whose work it is; "chat" for Company Chat's answers, "studio" for Creative Studio, "services" for Services & Pricing research. */
    agent: v.union(literals(AGENT_IDS), v.literal("chat"), v.literal("studio"), v.literal("services")),
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
    /** How the work started: from Company Chat, by a person in the app, or by itself (inbox reading, schedules). */
    origin: v.optional(v.union(v.literal("chat"), v.literal("member"), v.literal("automatic"))),
    /** Where the work's output can be opened, subject to the viewer's permissions. */
    link: v.optional(v.object({ label: v.string(), path: v.string() })),
    /** The media setup it was priced for. */
    variant: v.optional(v.object({ size: v.optional(v.string()), fast: v.optional(v.boolean()), durationSeconds: v.optional(v.number()) })),
    /** Every step of its charge, in order: opened, held, confirmed, released, and why. */
    history: v.optional(v.array(v.object({ at: v.number(), kind: v.string(), credits: v.optional(v.number()), note: v.optional(v.string()) }))),
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
