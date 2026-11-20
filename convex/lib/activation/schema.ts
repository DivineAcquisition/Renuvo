/**
 * Activation: the bounded first batch of agent work an Owner explicitly starts, after setup or later from
 * Home (docs/onboarding/01-activation.md). It is not another agent runner: each task is carried out
 * through the workspace's own builders and the agents' own workflows (Sales runs, Dispatch's coverJob,
 * Retention's reconcile, Recruiter's inbox reader), under their own permissions, billing and outbox.
 *
 * Three tables:
 *  - activations       one started batch, with the context it was planned from and what it may spend
 *  - activationTasks   one planned piece of work, its state, the steps it actually took and what it made
 *  - memberNotices     the in-app notification inbox: one row per person, with read state
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { agentValidator, literals } from "../statuses";
import { priorityValidator } from "../setup/schema";

export const ACTIVATION_STATUSES = ["running", "completed", "partial", "canceled"] as const;
export type ActivationStatus = (typeof ACTIVATION_STATUSES)[number];

/**
 * queued: planned and waiting its turn. working: a step is running or Selestial is waiting on the agent's
 * own workflow. ready_for_review: what it made needs the owner's decision. waiting_info / waiting_connection:
 * blocked on one specific answer or integration. unavailable: the plan, a paused agent or an unbuilt
 * capability rules it out; it is shown, never run.
 */
export const TASK_STATES = ["queued", "working", "ready_for_review", "waiting_info", "waiting_connection", "completed", "failed", "paused", "canceled", "unavailable"] as const;
export type TaskState = (typeof TASK_STATES)[number];
export const taskStateValidator = literals(TASK_STATES);

/** Finished for good: nothing more runs. */
export const FINAL_STATES: readonly TaskState[] = ["completed", "ready_for_review", "failed", "canceled", "unavailable"];
/** Stopped until something changes: an answer, a connection, a resumed agent. Re-checked when it does. */
export const BLOCKED_STATES: readonly TaskState[] = ["waiting_info", "waiting_connection", "paused"];

/** A record the task read or made, with where it opens. Only real rows: never a sentence standing in for one. */
export const recordRefValidator = v.object({ table: v.string(), id: v.string(), label: v.string(), href: v.string() });
export type RecordRef = typeof recordRefValidator.type;

export const outputValidator = v.object({
  /** What it is, for the card: "booking_page", "service_draft", "follow_up_drafts", ... */
  kind: v.string(),
  ref: recordRefValidator,
  /** "draft", "proposed", "prepared", "awaiting approval": the record's own state, in words. */
  state: v.string(),
  /** Set when this run made it; absent when it found one that already existed (and left it as it was). */
  created: v.boolean(),
  /** Marks for the owner: example prices, inferred values, unreviewed terms. */
  flags: v.optional(v.array(v.string())),
  /** A real count behind the headline ("5 inquiries"), when there is one. */
  count: v.optional(v.number()),
});
export type Output = typeof outputValidator.type;

export const stepValidator = v.object({ at: v.number(), words: v.string(), kind: literals(["done", "info", "failed", "waiting"] as const) });

export const blockerValidator = v.object({
  kind: literals(["information", "connection", "plan", "paused", "credits", "authority", "approval"] as const),
  words: v.string(),
  action: v.object({ label: v.string(), href: v.string() }),
});
export type Blocker = typeof blockerValidator.type;

export const activationTables = {
  activations: defineTable({
    companyId: v.id("companies"),
    /** What the owner chose to focus on. */
    focus: priorityValidator,
    secondary: v.array(priorityValidator),
    /** Where the owner pressed Start. */
    source: literals(["setup", "workspace"] as const),
    /** A hash of the context the plan was made from: setup answers, confirmed facts and the records counted. */
    contextVersion: v.string(),
    /** The confirmed and found facts the plan read, as they were. Found facts are never used as confirmed. */
    context: v.array(v.object({ key: v.string(), value: v.string(), state: literals(["confirmed", "found", "record"] as const), source: v.string() })),
    status: literals(ACTIVATION_STATUSES),
    startedBy: v.id("members"),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    /** What the plan said it might use, shown before Start; and the ceiling no run may pass. */
    budget: v.object({
      estimatedCredits: v.number(),
      ceilingCredits: v.number(),
      /** The plan's words about allowances: there is no setup allowance unless the billing catalog has one. */
      allowance: v.string(),
    }),
    /** Notices already planned for this batch, so each goes once. */
    noticed: v.object({ firstResultAt: v.optional(v.number()), summaryAt: v.optional(v.number()) }),
    canceledBy: v.optional(v.id("members")),
    updatedAt: v.number(),
  })
    .index("by_company_started", ["companyId", "startedAt"])
    .index("by_company_version", ["companyId", "contextVersion"])
    .index("by_status_updated", ["status", "updatedAt"]),

  activationTasks: defineTable({
    companyId: v.id("companies"),
    activationId: v.id("activations"),
    /** The template, e.g. "sales.booking_page". One per activation. */
    template: v.string(),
    agent: agentValidator,
    title: v.string(),
    objective: v.string(),
    /** The records it reads, as counted when planned. */
    sources: v.array(v.object({ label: v.string(), count: v.number(), href: v.optional(v.string()) })),
    expectedOutput: v.string(),
    prerequisites: v.array(v.object({ words: v.string(), met: v.boolean() })),
    /** The permission that governs anything it would send, and what that means right now. */
    authority: v.object({ action: v.union(v.string(), v.null()), words: v.string() }),
    estimate: v.object({ credits: v.number(), externalCents: v.number(), words: v.string() }),
    /** 1 is the owner's focus; higher numbers are supporting work. */
    priority: v.number(),
    dependsOn: v.array(v.string()),
    completion: v.string(),
    state: taskStateValidator,
    /** What it is doing now, in one precise sentence. */
    statusLine: v.string(),
    steps: v.array(stepValidator),
    outputs: v.array(outputValidator),
    blocker: v.optional(blockerValidator),
    /** Records of the agent's own workflow this task is waiting on (salesRuns keys, retention run keys...). */
    watching: v.optional(v.object({ kind: v.string(), keys: v.array(v.string()), until: v.number() })),
    attempts: v.number(),
    /** Set while a step holds the task. A step that never reports back is found by its lease running out. */
    leaseUntil: v.optional(v.number()),
    nextRunAt: v.number(),
    /** Credits the agents' own executions charged for this task (aiExecutions), read back from the record. */
    charges: v.array(v.object({ executionId: v.id("aiExecutions"), credits: v.number(), state: v.string() })),
    /** Approvals the agents' own workflows asked for while doing this task. */
    approvals: v.array(v.id("approvals")),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_activation", ["activationId"])
    .index("by_company_state", ["companyId", "state", "nextRunAt"])
    .index("by_state_lease", ["state", "leaseUntil"])
    .index("by_state_updated", ["state", "updatedAt"]),

  /**
   * The in-app inbox: one row per person, so read state is theirs. Email notices are separate rows in the
   * shared outbox (messages, purpose member_notice); an email that fails never touches these or the task.
   */
  memberNotices: defineTable({
    companyId: v.id("companies"),
    memberId: v.id("members"),
    kind: literals(["first_result", "asset_created", "approval_required", "task_completed", "needs_information", "needs_connection", "failed", "batch_finished", "support_access", "service_issue", "service_recovered"] as const),
    agent: v.optional(agentValidator),
    headline: v.string(),
    summary: v.string(),
    activationId: v.optional(v.id("activations")),
    taskId: v.optional(v.id("activationTasks")),
    /** The record it is about; opening it re-checks the company and the person's role. */
    target: v.optional(recordRefValidator),
    /** One notice per event and person, however often it is reported. */
    dedupeKey: v.string(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_member_created", ["companyId", "memberId", "createdAt"])
    .index("by_member_unread", ["companyId", "memberId", "readAt"])
    .index("by_company_dedupe", ["companyId", "dedupeKey"]),
};
