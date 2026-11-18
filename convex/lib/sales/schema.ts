/**
 * Sales: the internal booking and proposal workspace, and what it commits the company to.
 *
 * Each record is one kind of commitment, linked to the others and never sharing a status with them:
 *  - salesOpportunities: the deal in the pipeline (stage + milestone, an owner, the next action);
 *  - salesDrafts: the staff workspace, autosaved with a revision; both modes share it;
 *  - salesQuotes: a priced offer for a home service, saved or sent, with an expiry;
 *  - bookings: the request to perform service, with its own payment, agreement and schedule requirements;
 *  - capacityHolds: minutes reserved on a day while a booking waits for its requirements;
 *  - recurringPlans / recurringPlanVersions / planVisits: a recurring service and each visit it made;
 *  - proposals / proposalVersions / proposalResponses: commercial, office and STR proposals, frozen per
 *    version, and the customer's answer bound to the exact version they saw;
 *  - assessments: a walkthrough appointment and its findings (never a cleaning job);
 *  - serviceSetups: what an accepted proposal still needs before each site's service starts.
 *
 * Invoices, payments, agreements, jobs, customers and properties stay in their own modules and are only
 * linked from here. Every table carries companyId and is read through an index that starts with it.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { quoteInputValidator } from "../services/schema";
import { literals } from "../statuses";

export const SEGMENTS = ["residential", "commercial", "office", "str"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const segmentValidator = literals(SEGMENTS);

export const STAGES = ["new", "qualifying", "quoting", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

/** Where a deal is inside its stage. A prerequisite is a milestone, never a stage of its own. */
export const MILESTONES = [
  "assessment_needed",
  "pricing_pending",
  "quote_saved",
  "quote_sent",
  "proposal_ready",
  "proposal_sent",
  "changes_requested",
  "proposal_accepted",
  "agreement_pending",
  "billing_pending",
  "ready_to_schedule",
  "booking_requested",
  "service_activated",
  "declined",
  "expired",
] as const;
export type Milestone = (typeof MILESTONES)[number];

export const DRAFT_MODES = ["booking", "proposal"] as const;
export type DraftMode = (typeof DRAFT_MODES)[number];
export const BOOKING_KINDS = ["one_time", "recurring"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const DRAFT_STATUS = ["open", "quoted", "requested", "confirmed", "proposal_created", "archived"] as const;

export const QUOTE_STATUS = ["saved", "sent", "accepted", "expired", "superseded", "withdrawn"] as const;

/** Payment arrangements a booking may use. "external" is collected outside Selestial and recorded separately. */
export const PAYMENT_POLICIES = ["none", "deposit", "full", "invoice_terms", "after_service", "external"] as const;
export type PaymentPolicy = (typeof PAYMENT_POLICIES)[number];
export const PAYMENT_STATES = ["not_required", "link_needed", "awaiting", "paid", "failed", "approval_needed"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];
export const AGREEMENT_STATES = ["not_required", "to_send", "sent", "signed", "declined"] as const;
export type AgreementState = (typeof AGREEMENT_STATES)[number];
export const SCHEDULE_STATES = ["proposed", "held", "confirmed", "expired", "conflict"] as const;
export type ScheduleState = (typeof SCHEDULE_STATES)[number];

/** requested → awaiting (requirements outstanding) → confirmed; cancelled at any point before the visit. */
export const BOOKING_STATUS = ["requested", "awaiting", "confirmed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];

export const HOLD_STATUS = ["held", "consumed", "released", "expired"] as const;

export const PLAN_STATUS = ["pending", "active", "paused", "ended"] as const;
export type PlanStatus = (typeof PLAN_STATUS)[number];
export const VISIT_STATES = ["scheduled", "skipped", "moved", "exception", "cancelled"] as const;
export type VisitState = (typeof VISIT_STATES)[number];
export const PLAN_BILLING = ["per_visit", "monthly_consolidated"] as const;

export const PROPOSAL_TEMPLATES = ["commercial", "office", "str"] as const;
export type ProposalTemplate = (typeof PROPOSAL_TEMPLATES)[number];
export const PROPOSAL_STATUS = ["draft", "ready", "sent", "changes_requested", "accepted", "declined", "expired", "withdrawn", "superseded"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];
export const RESPONSE_KINDS = ["accept", "changes", "decline"] as const;
export const ASSESSMENT_STATUS = ["requested", "scheduled", "completed", "cancelled"] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUS)[number];
export const READINESS = ["pending", "in_progress", "done", "blocked", "not_needed"] as const;
export type Readiness = (typeof READINESS)[number];

/**
 * A recurring cadence. Every four weeks and once a month are different schedules, as are every two weeks
 * and twice a month. Weekdays are 0 (Sunday) to 6; several weekdays make several visits a week.
 */
export const cadenceValidator = v.union(
  v.object({ kind: v.literal("weekly"), weekdays: v.array(v.number()) }),
  v.object({ kind: v.literal("every_2_weeks"), weekday: v.number() }),
  v.object({ kind: v.literal("every_4_weeks"), weekday: v.number() }),
  /** dayOfMonth 1–31; months shorter than that use their last day. 0 means the last day of every month. */
  v.object({ kind: v.literal("monthly"), dayOfMonth: v.number() }),
  v.object({ kind: v.literal("twice_monthly"), days: v.array(v.number()) }),
);

const requirementsValidator = v.object({
  payment: v.object({ policy: literals(PAYMENT_POLICIES), dueNowCents: v.number(), state: literals(PAYMENT_STATES), approvalId: v.optional(v.id("approvals")) }),
  agreement: v.object({ state: literals(AGREEMENT_STATES), agreementId: v.optional(v.id("agreements")), docType: v.optional(v.string()) }),
  schedule: v.object({ state: literals(SCHEDULE_STATES), holdId: v.optional(v.id("capacityHolds")), why: v.optional(v.string()) }),
});

export const salesTables = {
  salesOpportunities: defineTable({
    companyId: v.id("companies"),
    title: v.string(),
    segment: segmentValidator,
    customerId: v.optional(v.id("customers")),
    stage: literals(STAGES),
    milestone: v.optional(literals(MILESTONES)),
    ownerMemberId: v.optional(v.id("members")),
    nextAction: v.optional(v.string()),
    nextActionAt: v.optional(v.number()),
    source: v.optional(v.string()),
    estimateCents: v.optional(v.number()),
    closedReason: v.optional(v.string()),
    /** Follow-ups stop while a person has taken the deal over. */
    followUps: v.union(v.literal("on"), v.literal("paused"), v.literal("stopped")),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_updated", ["companyId", "updatedAt"])
    .index("by_company_stage", ["companyId", "stage", "updatedAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_followup_due", ["followUps", "nextActionAt"]),

  salesDrafts: defineTable({
    companyId: v.id("companies"),
    mode: literals(DRAFT_MODES),
    segment: segmentValidator,
    bookingKind: literals(BOOKING_KINDS),
    opportunityId: v.optional(v.id("salesOpportunities")),
    customerId: v.optional(v.id("customers")),
    propertyId: v.optional(v.id("properties")),
    /** Where the draft was started (pipeline, quotes, customer, dispatch), for the back link. */
    entry: v.optional(v.object({ from: v.string(), id: v.optional(v.string()) })),
    /** The form's answers. Checked in full by every action that commits anything; never trusted for money. */
    body: v.any(),
    revision: v.number(),
    status: literals(DRAFT_STATUS),
    quoteId: v.optional(v.id("salesQuotes")),
    bookingId: v.optional(v.id("bookings")),
    proposalId: v.optional(v.id("proposals")),
    createdBy: v.id("members"),
    updatedBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_updated", ["companyId", "updatedAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_opportunity", ["companyId", "opportunityId"]),

  salesQuotes: defineTable({
    companyId: v.id("companies"),
    draftId: v.id("salesDrafts"),
    opportunityId: v.optional(v.id("salesOpportunities")),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    kind: literals(BOOKING_KINDS),
    /** The priced visit. For recurring service, the ongoing visit. */
    visit: v.object({ serviceKey: v.string(), versionId: v.id("serviceVersions"), serviceQuoteId: v.id("serviceQuotes"), totalCents: v.number(), outcome: v.string() }),
    /** A different first visit (for example a deep clean before standard visits), when there is one. */
    first: v.optional(v.object({ serviceKey: v.string(), versionId: v.id("serviceVersions"), serviceQuoteId: v.id("serviceQuotes"), totalCents: v.number(), outcome: v.string() })),
    cadence: v.optional(cadenceValidator),
    /** What the customer is shown, frozen when saved. */
    snapshot: v.any(),
    status: literals(QUOTE_STATUS),
    expiresAt: v.number(),
    sentAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_draft", ["companyId", "draftId"]),

  bookings: defineTable({
    companyId: v.id("companies"),
    draftId: v.id("salesDrafts"),
    opportunityId: v.optional(v.id("salesOpportunities")),
    quoteId: v.optional(v.id("salesQuotes")),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    kind: literals(BOOKING_KINDS),
    status: literals(BOOKING_STATUS),
    /** One booking per draft revision: retried requests return the same booking. */
    idempotencyKey: v.string(),
    serviceKey: v.string(),
    versionId: v.id("serviceVersions"),
    quoteInput: quoteInputValidator,
    serviceQuoteId: v.id("serviceQuotes"),
    priceCents: v.number(),
    first: v.optional(v.object({ serviceKey: v.string(), versionId: v.id("serviceVersions"), quoteInput: quoteInputValidator, serviceQuoteId: v.id("serviceQuotes"), priceCents: v.number() })),
    slot: v.object({ startsAt: v.number(), endsAt: v.number(), arrivalWindowMinutes: v.number(), crew: v.number(), proposed: v.boolean() }),
    requirements: requirementsValidator,
    instructions: v.optional(v.object({ customer: v.optional(v.string()), cleaner: v.optional(v.string()), office: v.optional(v.string()) })),
    preferredCleanerId: v.optional(v.id("cleaners")),
    invoiceId: v.optional(v.id("invoices")),
    jobId: v.optional(v.id("jobs")),
    planId: v.optional(v.id("recurringPlans")),
    /** Handing the confirmed work to Dispatch. Retried by the sweep until it is done. */
    handoff: v.object({ state: v.union(v.literal("not_started"), v.literal("pending"), v.literal("done"), v.literal("failed")), attempts: v.number(), problem: v.optional(v.string()) }),
    cancelledReason: v.optional(v.string()),
    createdBy: v.id("members"),
    confirmedBy: v.optional(v.union(v.id("members"), v.literal("system"))),
    confirmedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_key", ["companyId", "idempotencyKey"])
    .index("by_company_invoice", ["companyId", "invoiceId"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_handoff", ["handoff.state", "updatedAt"]),

  capacityHolds: defineTable({
    companyId: v.id("companies"),
    bookingId: v.id("bookings"),
    day: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    crew: v.number(),
    crewMinutes: v.number(),
    status: literals(HOLD_STATUS),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_company_day_status", ["companyId", "day", "status"])
    .index("by_status_expires", ["status", "expiresAt"])
    .index("by_company_booking", ["companyId", "bookingId"]),

  recurringPlans: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    bookingId: v.optional(v.id("bookings")),
    setupId: v.optional(v.id("serviceSetups")),
    status: literals(PLAN_STATUS),
    currentVersion: v.number(),
    timezone: v.string(),
    /** Visits are made this many days ahead, by a sweep that never makes the same date twice. */
    horizonDays: v.number(),
    generatedThrough: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.optional(v.string()),
    pause: v.optional(v.object({ from: v.string(), until: v.optional(v.string()), reason: v.string() })),
    billing: literals(PLAN_BILLING),
    endedReason: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_status", ["status", "updatedAt"]),

  recurringPlanVersions: defineTable({
    companyId: v.id("companies"),
    planId: v.id("recurringPlans"),
    version: v.number(),
    /** The first date this version applies to. Visits before it keep the version they were made with. */
    effectiveFrom: v.string(),
    cadence: cadenceValidator,
    arrivalMinute: v.number(),
    arrivalWindowMinutes: v.number(),
    durationMinutes: v.number(),
    crew: v.number(),
    serviceKey: v.string(),
    versionId: v.id("serviceVersions"),
    quoteInput: quoteInputValidator,
    visitPriceCents: v.number(),
    first: v.optional(v.object({ serviceKey: v.string(), versionId: v.id("serviceVersions"), quoteInput: quoteInputValidator, priceCents: v.number(), durationMinutes: v.number(), crew: v.number() })),
    preferredCleanerId: v.optional(v.id("cleaners")),
    reason: v.optional(v.string()),
    approvalId: v.optional(v.id("approvals")),
    createdBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_plan_version", ["planId", "version"])
    .index("by_company_created", ["companyId", "createdAt"]),

  planVisits: defineTable({
    companyId: v.id("companies"),
    planId: v.id("recurringPlans"),
    /** The date the cadence gave. Unique per plan: a retried sweep finds it and makes nothing. */
    date: v.string(),
    state: literals(VISIT_STATES),
    version: v.number(),
    first: v.boolean(),
    jobId: v.optional(v.id("jobs")),
    override: v.optional(v.object({ startsAt: v.optional(v.number()), quoteInput: v.optional(quoteInputValidator), priceCents: v.optional(v.number()), note: v.optional(v.string()) })),
    exception: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_plan_date", ["planId", "date"])
    .index("by_company_state", ["companyId", "state", "date"])
    .index("by_company_job", ["companyId", "jobId"]),

  proposals: defineTable({
    companyId: v.id("companies"),
    opportunityId: v.optional(v.id("salesOpportunities")),
    draftId: v.optional(v.id("salesDrafts")),
    customerId: v.id("customers"),
    template: literals(PROPOSAL_TEMPLATES),
    title: v.string(),
    status: literals(PROPOSAL_STATUS),
    /** The last version sent; 0 before the first send. */
    sentVersion: v.number(),
    latestVersion: v.number(),
    publicId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    firstViewedAt: v.optional(v.number()),
    viewCount: v.number(),
    /** Custom rates need an approval of the exact version content before it can be sent. */
    approval: v.optional(v.object({ hash: v.string(), approvalId: v.id("approvals"), state: v.union(v.literal("waiting"), v.literal("approved"), v.literal("declined")) })),
    acceptedVersion: v.optional(v.number()),
    setupId: v.optional(v.id("serviceSetups")),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_updated", ["companyId", "updatedAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_publicId", ["publicId"])
    .index("by_status_expires", ["status", "expiresAt"]),

  proposalVersions: defineTable({
    companyId: v.id("companies"),
    proposalId: v.id("proposals"),
    version: v.number(),
    /** Everything the customer sees, frozen. Changing services or rates later never rewrites it. */
    content: v.any(),
    hash: v.string(),
    createdBy: v.id("members"),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_proposal_version", ["proposalId", "version"])
    .index("by_company_created", ["companyId", "createdAt"]),

  proposalResponses: defineTable({
    companyId: v.id("companies"),
    proposalId: v.id("proposals"),
    version: v.number(),
    hash: v.string(),
    kind: literals(RESPONSE_KINDS),
    optionId: v.optional(v.string()),
    name: v.string(),
    email: v.optional(v.string()),
    title: v.optional(v.string()),
    /** Another person who signs the company's contracts. The contract party does not change. */
    signer: v.optional(v.object({ name: v.string(), email: v.string(), title: v.optional(v.string()) })),
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_proposal", ["proposalId", "at"])
    .index("by_company_at", ["companyId", "at"]),

  assessments: defineTable({
    companyId: v.id("companies"),
    proposalId: v.optional(v.id("proposals")),
    draftId: v.optional(v.id("salesDrafts")),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    status: literals(ASSESSMENT_STATUS),
    assessorMemberId: v.optional(v.id("members")),
    scheduledAt: v.optional(v.number()),
    durationMinutes: v.number(),
    siteContact: v.optional(v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()) })),
    /** What must be recorded before the assessment counts as complete. */
    requiredFindings: v.array(v.string()),
    findings: v.optional(v.any()),
    photos: v.array(v.object({ storageId: v.id("_storage"), caption: v.optional(v.string()), at: v.number() })),
    publicId: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    completedBy: v.optional(v.string()),
    pricingReviewedAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_proposal", ["companyId", "proposalId"])
    .index("by_publicId", ["publicId"]),

  serviceSetups: defineTable({
    companyId: v.id("companies"),
    proposalId: v.id("proposals"),
    version: v.number(),
    customerId: v.id("customers"),
    /** All sites start together only when the agreement says so. */
    startTogether: v.boolean(),
    agreementId: v.optional(v.id("agreements")),
    agreement: literals(READINESS),
    billing: literals(READINESS),
    sites: v.array(
      v.object({
        key: v.string(),
        propertyId: v.id("properties"),
        label: v.string(),
        access: literals(READINESS),
        schedule: literals(READINESS),
        planId: v.optional(v.id("recurringPlans")),
        jobId: v.optional(v.id("jobs")),
        activatedAt: v.optional(v.number()),
        note: v.optional(v.string()),
      }),
    ),
    status: v.union(v.literal("open"), v.literal("active"), v.literal("cancelled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status"])
    .index("by_company_proposal", ["companyId", "proposalId"]),
};
