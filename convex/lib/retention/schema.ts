/**
 * The Retention agent: earn the next service by protecting the promise of the last one.
 *
 * Every intervention follows evidence → diagnosis → action → verification → outcome, and each step is a
 * record here. Nothing in these tables is a score or a prediction: a signal names the record it came
 * from and whether it is a fact, something the customer said, or a hypothesis.
 *
 *  - retentionSignals: one explainable thing that happened, read from the company's own records;
 *  - retentionCases: one piece of follow-through with an owner, a deadline and a completion condition;
 *  - retentionEntries: a case's evidence and history, in order, each with its source;
 *  - retentionActions: what is proposed or under way for a case, its approval, cost and handoff;
 *  - retentionFeedback: what a customer told the company about one service, linked to that service;
 *  - retentionLinks: scoped, expiring, revocable customer links (the token itself is never stored);
 *  - retentionRuns: persistent state for event work and reconciliation, so a repeat does nothing twice.
 *
 * Customers, properties, visits, plans, agreements and money stay where they live. This module points at
 * them by id and never copies them. convex/retention.ts is the privacy purge and is unrelated.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator } from "../events";
import { literals } from "../statuses";

/** How a relationship is served. Each has its own meaning of "continued" and its own rules. */
export const SEGMENTS = ["residential_recurring", "residential_one_time", "commercial", "office", "str", "multi_property", "project"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const segmentValidator = literals(SEGMENTS);

/** What a statement rests on. A hypothesis is never shown as a fact, and never acted on as one. */
export const BASES = ["fact", "customer_stated", "hypothesis"] as const;
export type Basis = (typeof BASES)[number];
export const basisValidator = literals(BASES);

export const SIGNAL_KINDS = [
  "repeat_complaint",
  "commitment_overdue",
  "company_cancellation",
  "repeated_reschedule",
  "plan_missing_visit",
  "paid_without_service",
  "service_paused_billing_open",
  "cancel_request",
  "reduce_request",
  "invoice_dispute",
  "renewal_approaching",
  "decision_maker_changed",
  "readiness_at_risk",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** A record a statement came from, so a person can open it. The label is words; the id is the proof. */
export const sourceValidator = v.object({ table: v.string(), id: v.string(), label: v.string(), at: v.optional(v.number()) });
export type Source = typeof sourceValidator.type;

/** The plan a relationship runs on. Both plan systems are live (docs/clients/00-architecture.md). */
export const planRefValidator = v.union(v.object({ kind: v.literal("service"), id: v.id("servicePlans") }), v.object({ kind: v.literal("sales"), id: v.id("recurringPlans") }));
export type PlanRef = typeof planRefValidator.type;

/**
 * What a person sees. "closed" carries an outcome; none of these says a customer is satisfied.
 * A relationship with no open case reads "No known open issues", which is a statement about the record.
 */
export const CASE_STATUSES = ["needs_context", "needs_attention", "action_underway", "waiting_on_customer", "monitoring", "closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const caseStatusValidator = literals(CASE_STATUSES);

export const CASE_KINDS = ["follow_through", "recovery", "continuity", "renewal", "reactivation"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const DIAGNOSES = ["quality_miss", "scope_misunderstanding", "scheduling_reliability", "billing", "insufficient_evidence", "serious_incident"] as const;
export type Diagnosis = (typeof DIAGNOSES)[number];

/** Explicit outcomes. "unknown" is an outcome: it is never rounded up to a success. */
export const OUTCOMES = [
  "customer_confirmed",
  "correction_done_unconfirmed",
  "customer_not_satisfied",
  "subsequent_service_completed",
  "feedback_no_issue",
  "no_response",
  "plan_adjusted",
  "plan_resumed",
  "customer_cancelled",
  "contract_renewed",
  "contract_ended",
  "reactivated",
  "recurring_started",
  "offer_made_no_plan",
  "declined_contact",
  "handled_by_person",
  "no_action_needed",
  "unknown",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const ACTION_KINDS = [
  "request_feedback",
  "correction_visit",
  "inspection",
  "different_cleaner",
  "credit",
  "refund",
  "scope_clarification",
  "message",
  "confirm_correction",
  "plan_change",
  "billing_review",
  "renewal_proposal",
  "service_review",
  "return_offer",
  "recurring_offer",
  "dispatch_review",
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** proposed: prepared, nothing done. awaiting_approval: in the approvals queue. underway: handed off or sent. */
export const ACTION_STATUSES = ["proposed", "awaiting_approval", "underway", "done", "declined", "failed", "cancelled", "blocked"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const PLAN_CHANGES = ["skip_visit", "reschedule_visit", "change_cadence", "pause_service", "pause_billing", "resume", "end_service"] as const;
export type PlanChange = (typeof PLAN_CHANGES)[number];

export const LINK_PURPOSES = ["feedback", "issue", "remedy", "confirm", "manage"] as const;
export type LinkPurpose = (typeof LINK_PURPOSES)[number];

/** Who receives handed-off work. Retention keeps the case open until the result comes back. */
export const HANDOFF_TO = ["dispatch", "sales", "finance", "quality", "owner"] as const;
export type HandoffTo = (typeof HANDOFF_TO)[number];

export const diagnosisValidator = v.object({
  category: literals(DIAGNOSES),
  basis: basisValidator,
  /** Why, in words that name the evidence. */
  reasons: v.array(v.string()),
  /** What is not known. A diagnosis with open questions stays reviewable. */
  uncertain: v.array(v.string()),
  by: actorValidator,
  /** "rules", a model's name, or "person". */
  reader: v.string(),
  at: v.number(),
});

export const verificationValidator = v.object({
  /** What must be true for this case to count as recovered, written when the remedy is proposed. */
  criteria: v.string(),
  correctionJobId: v.optional(v.id("jobs")),
  correctionCompletedAt: v.optional(v.number()),
  customerAsked: v.optional(v.object({ at: v.number(), linkId: v.id("retentionLinks") })),
  customerAnswer: v.optional(v.object({ answer: v.union(v.literal("resolved"), v.literal("not_resolved")), note: v.optional(v.string()), at: v.number() })),
  /** The next ordinary service at the property after the correction, and whether the issue was reported again. */
  nextService: v.optional(v.object({ jobId: v.id("jobs"), completedAt: v.number(), repeatReported: v.boolean() })),
});

/** What the company told Retention about how it works. Absent values mean "not set": nothing is invented. */
export const retentionSettingsValidator = v.object({
  /** Ask for feedback after a customer's first verified service. Other visits are asked only on request. */
  feedbackAfterFirstService: v.optional(v.boolean()),
  /** Days a customer link stays open. */
  linkDays: v.optional(v.number()),
  /** The company's own service guarantee, in its words, and the days after a service it covers. */
  guarantee: v.optional(v.object({ days: v.number(), text: v.string() })),
  /** Where everyone is invited to leave a public review. Shown to every customer, whatever they answered. */
  reviewUrl: v.optional(v.string()),
  /** Days before a renewal or notice deadline that a commercial account is prepared for. */
  renewalLeadDays: v.optional(v.number()),
  /** What a customer may ask for from their plan link. Absent: skip, pause, resume and end are offered. */
  selfService: v.optional(v.array(literals(PLAN_CHANGES))),
  /** Days after a recovery's deadline before it is raised as overdue. */
  recoveryDueHours: v.optional(v.number()),
  /** Days with no response before a customer question is closed as "no response". */
  quietDays: v.optional(v.number()),
  /**
   * Read customers' email in an inbox connected for Care & Retention. Off until the Owner turns it on.
   * Only mail from an address on a customer's record is opened; nothing is sent, deleted or marked.
   */
  readCareInbox: v.optional(v.boolean()),
});
export type RetentionSettingsInput = typeof retentionSettingsValidator.type;

export const retentionTables = {
  retentionSignals: defineTable({
    companyId: v.id("companies"),
    kind: literals(SIGNAL_KINDS),
    /** Names this one thing. The same evidence seen again updates this row instead of making another. */
    key: v.string(),
    basis: basisValidator,
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    plan: v.optional(planRefValidator),
    agreementId: v.optional(v.id("agreements")),
    segment: segmentValidator,
    /** What happened, in one sentence that only says what the record shows. */
    what: v.string(),
    source: sourceValidator,
    occurredAt: v.number(),
    /** What is not known that would change the reading. */
    missing: v.array(v.string()),
    suggestedAction: v.string(),
    priority: v.union(v.literal("high"), v.literal("normal")),
    /** open: nobody has it. in_case: a case carries it. dismissed: a person said it needs nothing. cleared: the record no longer shows it. */
    status: v.union(v.literal("open"), v.literal("in_case"), v.literal("dismissed"), v.literal("cleared")),
    caseId: v.optional(v.id("retentionCases")),
    /** How many times the same evidence was seen. Consolidated, never duplicated. */
    seen: v.number(),
    lastSeenAt: v.number(),
    dismissed: v.optional(v.object({ by: v.id("members"), at: v.number(), reason: v.string() })),
    /** A deadline that makes this urgent, such as a guest check-in or a notice date. */
    deadlineAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_status", ["companyId", "status", "occurredAt"])
    .index("by_company_customer", ["companyId", "customerId", "occurredAt"]),

  retentionCases: defineTable({
    companyId: v.id("companies"),
    kind: literals(CASE_KINDS),
    /** Names this one case, so the same trigger never opens it twice. */
    key: v.string(),
    status: caseStatusValidator,
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    /** The service the case is about: the original visit of a recovery, the first visit of a follow-through. */
    jobId: v.optional(v.id("jobs")),
    plan: v.optional(planRefValidator),
    agreementId: v.optional(v.id("agreements")),
    segment: segmentValidator,
    title: v.string(),
    /** One sentence each: what happened, what Selestial is doing, what needs a person. Rewritten as the case moves. */
    happened: v.string(),
    doing: v.string(),
    needs: v.optional(v.string()),
    /** Where the case came from. */
    origin: v.union(v.literal("feedback"), v.literal("conversation"), v.literal("inspection"), v.literal("staff"), v.literal("signal"), v.literal("customer_link"), v.literal("service_completed")),
    /** The customer's own words about the problem. Untrusted: shown as text, never treated as an instruction. */
    customerWords: v.optional(v.string()),
    /** The tasks or areas named, lowercased, so a repeat at the same property can be recognised. */
    areas: v.array(v.string()),
    diagnosis: v.optional(diagnosisValidator),
    /** Safety, damage, theft or staff conduct. A person handles it; the agent organises evidence and tracks it. */
    serious: v.optional(v.object({ reason: v.string(), at: v.number() })),
    /** A person is handling this case. The agent prepares nothing for the customer until it is handed back. */
    heldBy: v.optional(v.object({ memberId: v.id("members"), since: v.number() })),
    /** The team member responsible, when one was named. */
    ownerId: v.optional(v.id("members")),
    /** When the next commitment is due. */
    dueAt: v.number(),
    verification: v.optional(verificationValidator),
    outcome: v.optional(v.object({ code: literals(OUTCOMES), note: v.optional(v.string()), by: actorValidator, at: v.number() })),
    /** A case this one grew out of (a follow-through that became a recovery). */
    fromCaseId: v.optional(v.id("retentionCases")),
    taskId: v.optional(v.id("tasks")),
    /** Counts changes, so an action prepared against older evidence can be recognised as stale. */
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_status", ["companyId", "status", "dueAt"])
    .index("by_company_kind", ["companyId", "kind", "updatedAt"])
    .index("by_company_customer", ["companyId", "customerId", "createdAt"])
    .index("by_company_property", ["companyId", "propertyId", "createdAt"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_closed", ["companyId", "closedAt"]),

  retentionEntries: defineTable({
    companyId: v.id("companies"),
    caseId: v.id("retentionCases"),
    at: v.number(),
    kind: v.union(v.literal("evidence"), v.literal("diagnosis"), v.literal("action"), v.literal("handoff"), v.literal("verification"), v.literal("outcome"), v.literal("note"), v.literal("agent")),
    /** For evidence: what it rests on. */
    basis: v.optional(basisValidator),
    text: v.string(),
    source: v.optional(sourceValidator),
    actor: actorValidator,
    /** Customer-written text carried by this entry. Rendered as plain text only. */
    quote: v.optional(v.string()),
  }).index("by_company_case", ["companyId", "caseId", "at"]),

  retentionActions: defineTable({
    companyId: v.id("companies"),
    caseId: v.id("retentionCases"),
    kind: literals(ACTION_KINDS),
    status: literals(ACTION_STATUSES),
    /** Names this one action on the case, so a retry or a second click never makes another. */
    key: v.string(),
    summary: v.string(),
    /** Why this, in words that name the evidence. */
    reason: v.string(),
    /** The catalog action this runs under, and what was decided at the time. */
    permission: v.string(),
    authorization: v.optional(v.string()),
    /** The message to send, for the actions that send one. "{link}" marks where a customer link goes. */
    message: v.optional(v.object({ channel: v.union(v.literal("sms"), v.literal("email")), subject: v.optional(v.string()), body: v.string(), linkPurpose: v.optional(literals(LINK_PURPOSES)), aboutActionId: v.optional(v.id("retentionActions")) })),
    /**
     * A correction visit: what is corrected and when. The Owner sets the pay basis (the amount the crew's
     * pay is worked out from, as the price is on a paid visit) each time; nothing is booked without it.
     * `payHintCents` is the original price in proportion to the minutes, shown as a starting point only.
     */
    visit: v.optional(
      v.object({
        areas: v.array(v.string()),
        scope: v.union(v.literal("targeted"), v.literal("full")),
        startsAt: v.optional(v.number()),
        endsAt: v.optional(v.number()),
        minutes: v.number(),
        crew: v.number(),
        payBasisCents: v.optional(v.number()),
        payHintCents: v.optional(v.number()),
        paySetBy: v.optional(v.id("members")),
        avoidCleanerIds: v.array(v.id("cleaners")),
        jobId: v.optional(v.id("jobs")),
      }),
    ),
    /** A credit or refund: the invoice and the amount. The money moves only through Finance. */
    money: v.optional(v.object({ invoiceId: v.optional(v.id("invoices")), amountCents: v.number(), creditId: v.optional(v.id("invoiceCredits")) })),
    /** A plan change: which, from when, and exactly the visits the person was shown. */
    planChange: v.optional(
      v.object({
        change: literals(PLAN_CHANGES),
        plan: planRefValidator,
        from: v.optional(v.string()),
        until: v.optional(v.string()),
        jobId: v.optional(v.id("jobs")),
        cadence: v.optional(v.string()),
        preferred: v.optional(v.string()),
        shown: v.array(v.id("jobs")),
        reason: v.optional(v.string()),
        requestedBy: v.union(v.literal("customer"), v.literal("staff"), v.literal("agent")),
      }),
    ),
    /** What this is expected to cost the company, when reliable data exists, and what the number rests on. */
    estimatedCostCents: v.optional(v.number()),
    costBasis: v.optional(v.string()),
    /** What it did cost, read back from the records that hold it. */
    actualCostCents: v.optional(v.number()),
    approvalId: v.optional(v.id("approvals")),
    /** Work given to another agent or a person. It names who, what is expected, and the record to watch. */
    handoff: v.optional(
      v.object({
        to: literals(HANDOFF_TO),
        expected: v.string(),
        taskId: v.optional(v.id("tasks")),
        jobId: v.optional(v.id("jobs")),
        status: v.union(v.literal("open"), v.literal("returned"), v.literal("failed")),
        result: v.optional(v.string()),
        returnedAt: v.optional(v.number()),
      }),
    ),
    messageId: v.optional(v.id("messages")),
    linkId: v.optional(v.id("retentionLinks")),
    /** What this was prepared against. Carried out only if the evidence has not moved on since. */
    preparedAt: v.number(),
    stamp: v.string(),
    dueAt: v.optional(v.number()),
    /** What happened when it was carried out, or why it was not. */
    result: v.optional(v.string()),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    doneAt: v.optional(v.number()),
  })
    .index("by_company_case", ["companyId", "caseId", "createdAt"])
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_approval", ["companyId", "approvalId"])
    .index("by_company_message", ["companyId", "messageId"]),

  retentionFeedback: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    /** The service this is about. Feedback is always about one service. */
    jobId: v.id("jobs"),
    linkId: v.optional(v.id("retentionLinks")),
    source: v.union(v.literal("customer_link"), v.literal("staff")),
    /** 1 to 5, when the customer gave one. It routes nothing: an issue is whatever the customer described. */
    rating: v.optional(v.number()),
    /** The customer's words. Untrusted text. */
    comment: v.optional(v.string()),
    /** Whether the customer described something that needs attention, and where. */
    issue: v.optional(v.object({ description: v.string(), areas: v.array(v.string()), wantsDifferentCleaner: v.boolean() })),
    /** Chosen by the browser for one submission, so a double tap or a retry is kept once. */
    clientKey: v.string(),
    caseId: v.optional(v.id("retentionCases")),
    recordedBy: v.optional(v.id("members")),
    submittedAt: v.number(),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_customer", ["companyId", "customerId", "submittedAt"])
    .index("by_company_property", ["companyId", "propertyId", "submittedAt"])
    .index("by_company_link", ["companyId", "linkId"])
    .index("by_company_clientKey", ["companyId", "clientKey"]),

  retentionLinks: defineTable({
    companyId: v.id("companies"),
    /** 128 random bits. With the deployment's secret it makes the token, which is never stored. */
    publicId: v.string(),
    purpose: literals(LINK_PURPOSES),
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    jobId: v.optional(v.id("jobs")),
    caseId: v.optional(v.id("retentionCases")),
    actionId: v.optional(v.id("retentionActions")),
    plan: v.optional(planRefValidator),
    /** The only things this link may do. */
    allowed: v.array(v.string()),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    issuedAt: v.number(),
    issuedBy: actorValidator,
    /** The last change made through this link. Opening the page is never recorded and changes nothing. */
    lastActionAt: v.optional(v.number()),
    lastAction: v.optional(v.string()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company_customer", ["companyId", "customerId", "issuedAt"])
    .index("by_company_case", ["companyId", "caseId"]),

  retentionRuns: defineTable({
    companyId: v.id("companies"),
    kind: v.union(v.literal("service_completed"), v.literal("reconcile"), v.literal("customer_text"), v.literal("customer_email"), v.literal("diagnose")),
    /** Names this one piece of work. A repeated event or webhook finds it and does nothing. */
    key: v.string(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("skipped")),
    attempts: v.number(),
    jobId: v.optional(v.id("jobs")),
    customerId: v.optional(v.id("customers")),
    caseId: v.optional(v.id("retentionCases")),
    executionId: v.optional(v.id("aiExecutions")),
    /** Text the run reads, such as a customer's message. Untrusted. */
    payload: v.optional(v.string()),
    result: v.optional(v.string()),
    queuedAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_status_queued", ["status", "queuedAt"])
    .index("by_company_kind", ["companyId", "kind", "queuedAt"]),
};
