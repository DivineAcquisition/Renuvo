/**
 * The shared record (brief, section 9). Every company table carries `companyId` and is read through an
 * index that starts with it. Times are milliseconds since 1970. Money is whole cents.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator, eventDataValidator, subjectValidator } from "./lib/events";
import { levelValidator } from "./lib/permissionCatalog";
import { recruiterSettingsValidator, recruiterTables } from "./lib/recruiter/schema";
import { roleValidator } from "./lib/roles";
import {
  agentValidator,
  approvalStatusValidator,
  assignmentStatusValidator,
  coverageCauseValidator,
  coverageStatusValidator,
  crewRoleValidator,
  endCauseValidator,
  handoffValidator,
  messageStatusValidator,
  cleanerStatusValidator,
  jobStatusValidator,
  memberStatusValidator,
  recordStatusValidator,
  taskStatusValidator,
  waitingOnValidator,
  workKindValidator,
} from "./lib/statuses";

export const addressValidator = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.string(),
  region: v.string(),
  postalCode: v.string(),
});

/** How a cleaner is paid. Contractors get a share of the job (basis points); employees an hourly rate. */
export const payValidator = v.union(
  v.object({ kind: v.literal("share"), shareBps: v.number() }),
  v.object({ kind: v.literal("hourly"), hourlyCents: v.number() }),
);

/** What a task or approval is about. */
export const aboutValidator = v.union(
  v.object({ table: v.literal("customers"), id: v.id("customers") }),
  v.object({ table: v.literal("properties"), id: v.id("properties") }),
  v.object({ table: v.literal("cleaners"), id: v.id("cleaners") }),
  v.object({ table: v.literal("jobs"), id: v.id("jobs") }),
  v.object({ table: v.literal("assignments"), id: v.id("assignments") }),
  v.object({ table: v.literal("hiringNeeds"), id: v.id("hiringNeeds") }),
  v.object({ table: v.literal("applications"), id: v.id("applications") }),
  v.object({ table: v.literal("mailboxConnections"), id: v.id("mailboxConnections") }),
);

/**
 * What approving an approval will do, as data the workflow can carry out and re-check. A proposal with
 * no entry here is a recommendation a person carries out themselves.
 */
export const proposalValidator = v.union(
  v.object({
    kind: v.literal("offer_assignment"),
    jobId: v.id("jobs"),
    cleanerId: v.id("cleaners"),
    payCents: v.number(),
    /** How long the cleaner has to answer once the offer goes out. */
    respondWithinMinutes: v.number(),
  }),
  /** Text the before-service reminder to the cleaner on this assignment. */
  v.object({ kind: v.literal("send_reminder"), assignmentId: v.id("assignments") }),
  // Recruiter (convex/lib/recruiter/approvals.ts carries these out).
  /** Email the application link to the applicant at the address recorded on the application. */
  v.object({ kind: v.literal("send_invitation"), applicationId: v.id("applications") }),
  v.object({ kind: v.literal("send_follow_up"), applicationId: v.id("applications"), attempt: v.number() }),
  v.object({ kind: v.literal("request_information"), applicationId: v.id("applications"), question: v.string() }),
  v.object({ kind: v.literal("invite_to_interview"), interviewId: v.id("interviews") }),
  v.object({ kind: v.literal("send_hiring_offer"), offerId: v.id("hiringOffers") }),
  v.object({ kind: v.literal("decline_application"), applicationId: v.id("applications"), criterion: v.string() }),
  v.object({ kind: v.literal("urgent_outreach"), applicationId: v.id("applications"), taskId: v.id("tasks") }),
);

/** How Dispatch works for this company. Every value is the owner's, with a default in code. */
export const dispatchSettingsValidator = v.object({
  /** Minutes a cleaner has to answer an offer. */
  offerWindowMinutes: v.number(),
  /** Minutes kept free between two jobs for the same cleaner. */
  travelBufferMinutes: v.number(),
  /** How many days ahead Dispatch looks for jobs without a cleaner. */
  lookAheadDays: v.number(),
});

/**
 * The rest of how Dispatch works for this company: messaging, the day of service and recovery. Every
 * value is optional and the Owner's; the defaults are in convex/lib/dispatch/policy.ts.
 */
export const dispatchPolicyValidator = v.object({
  /** More offers than open slots may go out at once, first to accept gets the slot. Off unless the Owner turns it on. */
  broadcastEnabled: v.optional(v.boolean()),
  /** The most cleaners asked at once for one open slot when broadcasting. */
  broadcastSize: v.optional(v.number()),
  /** Minutes a cleaner has to answer a backup offer after a drop or no-show. */
  backupOfferWindowMinutes: v.optional(v.number()),
  /** Minutes before the start that the reminder goes out. */
  reminderLeadMinutes: v.optional(v.number()),
  /** Minutes after the arrival window closes with no check-in before the cleaner is asked. */
  contactAfterMinutes: v.optional(v.number()),
  /** Minutes after the arrival window closes before the operator is alerted. */
  alertAfterMinutes: v.optional(v.number()),
  /** Minutes after the arrival window closes before a no-show can be declared. */
  noShowAfterMinutes: v.optional(v.number()),
  /** Hours the assigned-job link keeps working after the job's end time, for photos and completion. */
  jobAccessGraceHours: v.optional(v.number()),
  beforePhotosRequired: v.optional(v.number()),
  afterPhotosRequired: v.optional(v.number()),
  /** Text the before-photo link after check-in. */
  sendBeforePhotoLink: v.optional(v.boolean()),
});

export const checkInValidator = v.object({
  at: v.number(),
  /** Where the phone said it was, when the cleaner allowed it. Absent means not given, not "at the property". */
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  accuracyM: v.optional(v.number()),
});

export default defineSchema({
  // ── Public site ────────────────────────────────────────────────────────────────────────────────
  earlyAccessRequests: defineTable({
    name: v.string(),
    email: v.string(),
    company: v.string(),
    focus: v.union(v.literal("Sales"), v.literal("Recruiting"), v.literal("Dispatch"), v.literal("Retention")),
    source: v.string(),
    // The operations assessment (convex/lib/assessment.ts). Absent on requests made before it existed.
    role: v.optional(v.string()),
    businessType: v.optional(v.string()),
    cleaners: v.optional(v.string()),
    monthlyCleans: v.optional(v.string()),
    bookingTool: v.optional(v.string()),
    help: v.optional(v.string()),
    openTo: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    /** Set only when the person ticked the separate box saying they may be texted, and gave a number. */
    smsConsentAt: v.optional(v.number()),
    /** How many times this email has asked. A repeat updates the row instead of adding one. */
    requests: v.number(),
    createdAt: v.number(),
    lastRequestedAt: v.number(),
  }).index("by_email", ["email"]),

  rateLimits: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() }).index("by_key", ["key"]),

  // ── Companies and the people in them ───────────────────────────────────────────────────────────
  companies: defineTable({
    name: v.string(),
    /** IANA name, for example America/Chicago. Availability windows are on this clock. */
    timezone: v.string(),
    /** Agents the owner has paused. Pausing all four pauses everything. */
    pausedAgents: v.array(agentValidator),
    dispatch: v.optional(dispatchSettingsValidator),
    dispatchPolicy: v.optional(dispatchPolicyValidator),
    recruiter: v.optional(recruiterSettingsValidator),
    createdAt: v.number(),
  }),

  members: defineTable({
    companyId: v.id("companies"),
    /** The sign-in subject. Empty until an invited person signs in and joins. */
    userId: v.optional(v.string()),
    email: v.string(),
    name: v.string(),
    role: roleValidator,
    status: memberStatusValidator,
    createdAt: v.number(),
  })
    .index("by_company_user", ["companyId", "userId"])
    .index("by_company_email", ["companyId", "email"])
    .index("by_company", ["companyId"])
    .index("by_user", ["userId"])
    .index("by_email_status", ["email", "status"]),

  // ── Customers and properties ───────────────────────────────────────────────────────────────────
  customers: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    kind: workKindValidator,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    preferences: v.optional(v.string()),
    status: recordStatusValidator,
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  properties: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    label: v.optional(v.string()),
    address: addressValidator,
    kind: workKindValidator,
    accessInstructions: v.optional(v.string()),
    status: recordStatusValidator,
    createdAt: v.number(),
  })
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_postal", ["companyId", "address.postalCode"]),

  // ── Cleaners and when they can work ────────────────────────────────────────────────────────────
  cleaners: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    engagement: v.union(v.literal("contractor"), v.literal("employee")),
    status: cleanerStatusValidator,
    skills: v.array(v.string()),
    /** Postal codes the cleaner works in. Empty means not set yet, which matches nothing. */
    serviceAreas: v.array(v.string()),
    /** Set by the Owner only. No agent reads this to change it. */
    pay: v.optional(payValidator),
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  /** A weekly window the cleaner said they can work, on the company's clock. Minutes from midnight. */
  availabilityWindows: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    weekday: v.number(),
    startMinute: v.number(),
    endMinute: v.number(),
  }).index("by_company_cleaner", ["companyId", "cleanerId"]),

  timeOff: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    startsAt: v.number(),
    endsAt: v.number(),
    note: v.optional(v.string()),
  }).index("by_company_cleaner_end", ["companyId", "cleanerId", "endsAt"]),

  // ── Jobs and assignments. Payments are not here and are never inferred from these. ─────────────
  jobs: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    serviceType: v.string(),
    scope: v.string(),
    requiredSkills: v.array(v.string()),
    /** The price of the service in cents, from the company's pricing. It is not a payment. */
    priceCents: v.optional(v.number()),
    startsAt: v.number(),
    endsAt: v.number(),
    status: jobStatusValidator,
    cancelReason: v.optional(v.string()),
    /** How many cleaners the job needs. Absent means one. Accepted crew is counted from assignments, never stored. */
    requiredCrew: v.optional(v.number()),
    /** The cleaner may arrive any time from startsAt until this many minutes later. Absent means at startsAt. */
    arrivalWindowMinutes: v.optional(v.number()),
    /** The service must be finished by this time, for example a guest check-in. */
    hardDeadlineAt: v.optional(v.number()),
    /** What the crew needs to know that is not the scope. Shown to a cleaner only after they accept. */
    instructions: v.optional(v.string()),
    /** When the crew reported the service complete. It is a report: not a quality approval, not a payment. */
    completionReportedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_company_start", ["companyId", "startsAt"])
    .index("by_company_status_start", ["companyId", "status", "startsAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_status_start", ["status", "startsAt"]),

  assignments: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    cleanerId: v.id("cleaners"),
    status: assignmentStatusValidator,
    /** What the cleaner was told: the scope and their own pay, kept as offered. */
    scope: v.string(),
    payCents: v.number(),
    offeredAt: v.number(),
    respondBy: v.number(),
    respondedAt: v.optional(v.number()),
    endReason: v.optional(v.string()),
    /** Why a cancelled assignment ended. Only "released" counts against offering the same cleaner again. */
    endCause: v.optional(endCauseValidator),
    role: v.optional(crewRoleValidator),
    /** Why this offer was made: a first offer, the next cleaner after a no, or cover for a slot that lost its cleaner. */
    offerKind: v.optional(v.union(v.literal("initial"), v.literal("replacement"), v.literal("backup"))),
    coverageRequestId: v.optional(v.id("coverageRequests")),
    // The day of service, for an accepted assignment. Each is a recorded fact with its own time.
    checkIn: v.optional(checkInValidator),
    /** The cleaner said they are running late. A communicated delay is not silence. */
    late: v.optional(v.object({ reportedAt: v.number(), etaAt: v.number(), reason: v.optional(v.string()) })),
    /** How far the no-check-in ladder has gone. Absent means it has not started. */
    contact: v.optional(
      v.object({
        stage: v.union(v.literal("contacted"), v.literal("operator_alerted"), v.literal("no_show_suspected")),
        contactedAt: v.number(),
        alertedAt: v.optional(v.number()),
        suspectedAt: v.optional(v.number()),
      }),
    ),
    reminderQueuedAt: v.optional(v.number()),
    completion: v.optional(v.object({ submittedAt: v.number(), incomplete: v.boolean(), note: v.optional(v.string()) })),
    /** The job's start when this was offered, so an answer about an old time is not held against a new one. */
    jobStartsAt: v.optional(v.number()),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_cleaner_status", ["companyId", "cleanerId", "status"])
    .index("by_status_respondBy", ["status", "respondBy"]),

  // ── Tasks carry the work (brief, section 10) ───────────────────────────────────────────────────
  tasks: defineTable({
    companyId: v.id("companies"),
    /** The responsible agent. */
    agent: agentValidator,
    title: v.string(),
    about: v.optional(aboutValidator),
    /** Names the one piece of work this is (for example dispatch.cover:<job id>), so it is not opened twice. */
    key: v.optional(v.string()),
    /** Set while a person holds the task. The agent does not act on it until it is handed back. */
    withPersonSince: v.optional(v.number()),
    completionCondition: v.string(),
    status: taskStatusValidator,
    /** Set while open. */
    nextAction: v.optional(v.string()),
    /** The deadline for the next action, or for the decision while a person holds it. */
    dueAt: v.number(),
    /** Set while waiting. */
    waitingOn: v.optional(waitingOnValidator),
    followUpAt: v.optional(v.number()),
    /** Set while a person must decide. */
    openQuestion: v.optional(v.string()),
    /** Set when done or cancelled. */
    outcome: v.optional(v.string()),
    /** What started this work, in words. */
    trigger: v.optional(v.string()),
    /** What happens, and who is told, if the deadline passes. */
    escalation: v.optional(v.string()),
    /** Set when Dispatch handed this to another agent's queue. A person works it until that agent exists. */
    handoffTo: v.optional(handoffValidator),
    createdAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_company_status_due", ["companyId", "status", "dueAt"])
    .index("by_company_agent_status", ["companyId", "agent", "status"])
    .index("by_company_key", ["companyId", "key"]),

  // ── Authority (brief, section 7) ───────────────────────────────────────────────────────────────
  /** One row per action the owner has changed. An action with no row is at its starting level. */
  permissions: defineTable({
    companyId: v.id("companies"),
    action: v.string(),
    level: levelValidator,
    /** Money actions only. */
    perActionCents: v.optional(v.number()),
    perDayCents: v.optional(v.number()),
    updatedBy: v.id("members"),
    updatedAt: v.number(),
  }).index("by_company_action", ["companyId", "action"]),

  approvals: defineTable({
    companyId: v.id("companies"),
    agent: agentValidator,
    action: v.string(),
    /** What the agent wants to do, and why, in words a person can check. */
    summary: v.string(),
    reason: v.string(),
    /** Exactly what approving will authorize. */
    authorizes: v.optional(v.string()),
    /** What happens if nobody decides in time. */
    ifWaiting: v.optional(v.string()),
    proposal: v.optional(proposalValidator),
    about: v.optional(aboutValidator),
    taskId: v.optional(v.id("tasks")),
    status: approvalStatusValidator,
    decideBy: v.number(),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    /** What the person changed, or why they skipped it. */
    note: v.optional(v.string()),
    /** Whether an approved proposal was carried out, checked again at that moment, and why not if not. */
    carriedOut: v.optional(v.object({ ok: v.boolean(), detail: v.string(), at: v.number() })),
    createdAt: v.number(),
  })
    .index("by_company_status_decideBy", ["companyId", "status", "decideBy"])
    .index("by_company_task", ["companyId", "taskId"])
    .index("by_status_decideBy", ["status", "decideBy"]),

  // ── Dispatch: messages, links, coverage and the service itself ─────────────────────────────────
  /**
   * One outbound text. The body is stored with the link left out ("{link}"), so no token is ever at rest.
   * Delivery here is only what the provider reported. Nothing records "opened" or "read": nobody knows.
   */
  messages: defineTable({
    companyId: v.id("companies"),
    purpose: v.union(
      v.literal("offer"),
      v.literal("backup_offer"),
      v.literal("assignment_confirmed"),
      v.literal("reminder"),
      v.literal("before_photos"),
      v.literal("check_in_nudge"),
      v.literal("offer_withdrawn"),
      v.literal("assignment_ended"),
      v.literal("operator_alert"),
      // Recruiter, to applicants.
      v.literal("application_invitation"),
      v.literal("application_follow_up"),
      v.literal("information_request"),
      v.literal("interview_invitation"),
      v.literal("interview_confirmation"),
      v.literal("interview_reminder"),
      v.literal("hiring_offer"),
      v.literal("application_decline"),
      v.literal("urgent_outreach"),
    ),
    /** Absent means a text. */
    channel: v.optional(v.union(v.literal("sms"), v.literal("email"))),
    subject: v.optional(v.string()),
    replyTo: v.optional(v.string()),
    applicationId: v.optional(v.id("applications")),
    applicantId: v.optional(v.id("applicants")),
    applicantLinkId: v.optional(v.id("applicantLinks")),
    /** The provider reported that the address rejected the message. */
    bouncedAt: v.optional(v.number()),
    cleanerId: v.optional(v.id("cleaners")),
    jobId: v.optional(v.id("jobs")),
    assignmentId: v.optional(v.id("assignments")),
    linkId: v.optional(v.id("actionLinks")),
    /** Where on the cleaner pages the link opens, for example "/delay". */
    linkPath: v.optional(v.string()),
    to: v.optional(v.string()),
    body: v.string(),
    /** Names this one message, so a retry or a repeated event never queues it twice. */
    dedupeKey: v.string(),
    status: messageStatusValidator,
    attempts: v.number(),
    provider: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    /** Why it failed or was not sent, in words. Never a provider's raw response. */
    problem: v.optional(v.string()),
    queuedAt: v.number(),
    attemptedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
  })
    .index("by_company_dedupe", ["companyId", "dedupeKey"])
    .index("by_company_assignment", ["companyId", "assignmentId"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_queued", ["companyId", "queuedAt"])
    .index("by_company_application", ["companyId", "applicationId"])
    .index("by_provider_message", ["provider", "providerMessageId"])
    .index("by_status_attempted", ["status", "attemptedAt"]),

  /** A provider's delivery report, kept by its id so the same report delivered twice changes nothing twice. */
  providerReceipts: defineTable({ provider: v.string(), eventId: v.string(), receivedAt: v.number() }).index("by_provider_event", ["provider", "eventId"]),

  /**
   * A link that lets one cleaner do named things for one assignment without signing in. The token is
   * never stored: it is the public id plus a signature made with the deployment's secret.
   */
  actionLinks: defineTable({
    companyId: v.id("companies"),
    publicId: v.string(),
    purpose: v.union(v.literal("offer"), v.literal("job")),
    cleanerId: v.id("cleaners"),
    jobId: v.id("jobs"),
    assignmentId: v.id("assignments"),
    /** The only actions this link may perform. */
    allowed: v.array(v.string()),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    issuedAt: v.number(),
    /** The last time an action was carried out through this link. Page views are not recorded. */
    lastActionAt: v.optional(v.number()),
    lastAction: v.optional(v.string()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company_assignment", ["companyId", "assignmentId"])
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_issued", ["companyId", "issuedAt"]),

  coverageRequests: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    /** The assignment whose slot is open again. */
    fromAssignmentId: v.id("assignments"),
    cause: coverageCauseValidator,
    detail: v.optional(v.string()),
    status: coverageStatusValidator,
    openedAt: v.number(),
    /** When a person has to have decided if nobody can cover. */
    decideBy: v.number(),
    filledByAssignmentId: v.optional(v.id("assignments")),
    resolvedAt: v.optional(v.number()),
    /** What was tried and what is left, written when it becomes unresolved. */
    summary: v.optional(v.string()),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_status", ["companyId", "status", "openedAt"]),

  /** The job's checklist. The whole crew works the same items; each records who did it. */
  checklistItems: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    order: v.number(),
    section: v.optional(v.string()),
    label: v.string(),
    requiresPhoto: v.boolean(),
    state: v.union(v.literal("pending"), v.literal("done"), v.literal("skipped")),
    skipReason: v.optional(v.string()),
    byCleanerId: v.optional(v.id("cleaners")),
    at: v.optional(v.number()),
  }).index("by_company_job", ["companyId", "jobId", "order"]),

  /** A photo a cleaner uploaded for a job. */
  evidence: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    assignmentId: v.id("assignments"),
    cleanerId: v.id("cleaners"),
    kind: v.union(v.literal("before"), v.literal("after"), v.literal("item"), v.literal("issue")),
    checklistItemId: v.optional(v.id("checklistItems")),
    storageId: v.id("_storage"),
    /** Chosen by the phone for each photo, so an upload retried on a bad connection is kept once. */
    clientKey: v.string(),
    uploadedAt: v.number(),
  })
    .index("by_company_job", ["companyId", "jobId"])
    .index("by_company_assignment_key", ["companyId", "assignmentId", "clientKey"]),

  /**
   * Something a cleaner reported from the job: an unexpected condition, work left incomplete, or a
   * request to add to the scope. A request is only a request. Nothing here charges a customer.
   */
  jobReports: defineTable({
    companyId: v.id("companies"),
    jobId: v.id("jobs"),
    assignmentId: v.id("assignments"),
    cleanerId: v.id("cleaners"),
    kind: v.union(v.literal("condition"), v.literal("addon_request"), v.literal("incomplete")),
    text: v.string(),
    status: v.union(v.literal("awaiting_decision"), v.literal("acknowledged"), v.literal("approved"), v.literal("declined")),
    decidedBy: v.optional(v.id("members")),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
  }).index("by_company_job", ["companyId", "jobId"]),

  /** One use of one Dispatch tool: who or what allowed it, what went in, what came out, what it touched. */
  toolRuns: defineTable({
    companyId: v.id("companies"),
    tool: v.string(),
    /** Names this one use, so the same call made twice is carried out once. */
    idempotencyKey: v.string(),
    actor: actorValidator,
    /** The permission it ran under and the level at that moment, or "read" for a tool that changes nothing. */
    authorization: v.string(),
    input: v.string(),
    outcome: v.union(v.literal("done"), v.literal("proposed"), v.literal("refused")),
    result: v.string(),
    jobId: v.optional(v.id("jobs")),
    assignmentId: v.optional(v.id("assignments")),
    applicationId: v.optional(v.id("applications")),
    at: v.number(),
  })
    .index("by_company_key", ["companyId", "idempotencyKey"])
    .index("by_company_application", ["companyId", "applicationId", "at"])
    .index("by_company_job", ["companyId", "jobId", "at"]),

  // ── Recruiter: hiring needs, applicants, applications and everything that hangs off them ───────
  ...recruiterTables,

  // ── Events: append-only ────────────────────────────────────────────────────────────────────────
  events: defineTable({
    companyId: v.id("companies"),
    /** thing.what_happened, for example assignment.accepted. */
    type: v.string(),
    actor: actorValidator,
    subject: subjectValidator,
    /** The subject's id again, so one record's history can be read through an index. */
    subjectId: v.string(),
    data: v.optional(eventDataValidator),
    at: v.number(),
  })
    .index("by_company_at", ["companyId", "at"])
    .index("by_company_subject_at", ["companyId", "subjectId", "at"]),
});
