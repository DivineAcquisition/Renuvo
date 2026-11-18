/**
 * The shared record (brief, section 9). Every company table carries `companyId` and is read through an
 * index that starts with it. Times are milliseconds since 1970. Money is whole cents.
 */
import { defineSchema, defineTable } from "convex/server";

import { agreementTables } from "./lib/agreements/schema";
import { cleanersSettingsValidator, cleanersTables, engagementValidator } from "./lib/cleaners/schema";
import { googleTables } from "./lib/google/schema";
import { aiTables } from "./lib/ai/schema";
import { billingTables } from "./lib/billing/schema";
import { chatTables } from "./lib/chat/schema";
import { complianceTables } from "./lib/compliance/schema";
import { financeTables } from "./lib/finance/schema";
import { clientsTables, communicationValidator, propertyDetailsValidator, propertyKindValidator, relationshipValidator } from "./lib/clients/schema";
import { trustTables } from "./lib/trust/schema";
import { staffTables } from "./lib/trust/staffSchema";
import { v } from "convex/values";

import { actorValidator, eventDataValidator, subjectValidator } from "./lib/events";
import { levelValidator } from "./lib/permissionCatalog";
import { recruiterSettingsValidator, recruiterTables } from "./lib/recruiter/schema";
import { grantableRoleValidator, roleValidator } from "./lib/roles";
import { businessSettingsValidator, serviceSnapshotValidator } from "./lib/settings/business";
import { servicesTables } from "./lib/services/schema";
import {
  agentValidator,
  approvalStatusValidator,
  assignmentStatusValidator,
  coverageCauseValidator,
  coverageStatusValidator,
  crewRoleValidator,
  endCauseValidator,
  handoffValidator,
  invitationDeliveryStateValidator,
  invitationStatusValidator,
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
  /** Google's place id, when the address was picked from address search. */
  placeId: v.optional(v.string()),
  /** The map location from address search, for travel times and service areas. Absent when typed. */
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
});

/**
 * How a cleaner is paid. Contractors: a share of the job (basis points), a named tier's share (the
 * company's `payTiers`), or a fixed amount per job. Employees: an hourly rate.
 */
export const payValidator = v.union(
  v.object({ kind: v.literal("share"), shareBps: v.number() }),
  v.object({ kind: v.literal("hourly"), hourlyCents: v.number() }),
  v.object({ kind: v.literal("tier"), tierId: v.string() }),
  v.object({ kind: v.literal("fixed"), perJobCents: v.number() }),
);

/** A named share of the job the Owner defines, for example "Proven, 40%". Archived tiers keep past pay readable. */
export const payTierValidator = v.object({ id: v.string(), name: v.string(), shareBps: v.number(), archived: v.optional(v.boolean()) });

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
  // Cleaners workspace (convex/lib/cleaners/followUps.ts carries it out).
  /** Send one routine follow-up to a cleaner. It is checked again, in full, when approved. */
  v.object({ kind: v.literal("send_cleaner_follow_up"), followUpId: v.id("followUps") }),
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
  /** How a cleaner on a share is paid on a crew job: their share of the whole price, or split across the crew. */
  crewPayMode: v.optional(v.union(v.literal("share_of_whole"), v.literal("split_by_crew"))),
  /** Extra pay for the lead of a crew, as a percentage. */
  leadPremiumPercent: v.optional(v.number()),
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
  /**
   * An Owner asked for an integration that is not built yet (convex/integrations.ts). One row per company
   * and integration: asking again keeps the first. It tells Selestial what to build next and promises nothing.
   */
  integrationRequests: defineTable({
    companyId: v.id("companies"),
    integrationId: v.string(),
    requestedBy: v.id("members"),
    requestedAt: v.number(),
  }).index("by_company_integration", ["companyId", "integrationId"]),

  // ── Selestial staff (convex/lib/trust/staffSchema.ts) ─────────────────────────────────────────────
  ...staffTables,
  // ── Messaging consent, the compliance profile, agreements (convex/lib/compliance/schema.ts) ──────
  ...complianceTables,
  ...trustTables,

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
    /** How the Cleaners workspace works for this company: follow-up rules and who decides personnel requests. */
    cleaners: v.optional(cleanersSettingsValidator),
    /** Where the company works, when appointments may be, and its services (convex/lib/settings/business.ts). */
    businessSettings: v.optional(businessSettingsValidator),
    /** Counts saves of the business settings, so a stale browser tab cannot overwrite a newer save. Absent means zero. */
    settingsRevision: v.optional(v.number()),
    /**
     * When the services listed under businessSettings were copied into Services & Pricing (the one catalog
     * since November 16, 2026). After it, businessSettings.services is a record of what was there, not read.
     */
    servicesMigratedAt: v.optional(v.number()),
    /** The sign-in subject of whoever created the company. */
    createdBy: v.optional(v.string()),
    /** Chosen by the creator's browser for one setup, so a create that is sent twice makes one company. */
    setupKey: v.optional(v.string()),
    /** Set only by Selestial staff. While set, nothing is sent for this company. */
    suspendedAt: v.optional(v.number()),
    /**
     * The verified plan, copied from Autumn by billing sync (convex/lib/billing) and nothing else. "growth"
     * and "scale" are the retired, staff-set values: they grant nothing and are cleared by
     * billing.clearLegacyPlans.
     */
    plan: v.optional(v.union(v.literal("operate"), v.literal("expand"), v.literal("growth"), v.literal("scale"))),
    /** The Owner's named pay tiers (Finance › Team Pay). A job keeps the share that applied when it was worked. */
    payTiers: v.optional(v.array(payTierValidator)),
    /** AI features the Owner switched off. Absent means on, within the plan's allowances. */
    aiFeatures: v.optional(v.object({ imageGeneration: v.optional(v.boolean()), videoGeneration: v.optional(v.boolean()), photoReview: v.optional(v.boolean()), documentSearch: v.optional(v.boolean()), otherChatModels: v.optional(v.boolean()) })),
    createdAt: v.number(),
  }).index("by_creator_setupKey", ["createdBy", "setupKey"]),

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

  /**
   * An invitation to join a company. It points at the invited members row it will make active. The
   * link's token is never stored: it is the public id plus a signature made with the deployment's
   * secret. Expired is not a status; it is read from expiresAt.
   */
  invitations: defineTable({
    companyId: v.id("companies"),
    /** The invited members row this invitation turns into a membership. */
    memberId: v.id("members"),
    email: v.string(),
    /** The role the person gets on joining. It is never taken from the person accepting. */
    role: grantableRoleValidator,
    /** 128 random bits. Changed on every reissue, which is what stops the old link. */
    publicId: v.string(),
    status: invitationStatusValidator,
    expiresAt: v.number(),
    invitedBy: v.id("members"),
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedUserId: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
    /** The invitation email. `problem` is words for a person, never a provider's raw response. */
    delivery: v.object({ state: invitationDeliveryStateValidator, at: v.optional(v.number()), problem: v.optional(v.string()) }),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company", ["companyId", "createdAt"])
    .index("by_company_member", ["companyId", "memberId"])
    .index("by_email_status", ["email", "status", "expiresAt"]),

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
    // ── Clients & Properties (convex/lib/clients). Absent on clients made before it: read with clientFields(). ──
    /** A person or a business. A business's contacts are its people. */
    type: v.optional(v.union(v.literal("person"), v.literal("business"))),
    /** Absent: "active" for an active record, "former" for an archived one. */
    relationship: v.optional(relationshipValidator),
    relationshipNote: v.optional(v.string()),
    relationshipAt: v.optional(v.number()),
    /** The team member responsible for the relationship. */
    accountOwnerId: v.optional(v.id("members")),
    communication: v.optional(communicationValidator),
    /** Owner and Manager only. Never in search, previews or agent summaries. */
    privateNotes: v.optional(v.string()),
    /** Where the client came from: added by a person, a Google lead, an import or a booking. */
    source: v.optional(v.string()),
    archivedAt: v.optional(v.number()),
    archivedReason: v.optional(v.string()),
    /** Counts saves. A save names the revision it started from; a different one is refused, never overwritten. */
    revision: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    /** A person who is handling this client's conversation themselves. Agent follow-ups to the client wait. */
    conversationHeld: v.optional(v.object({ by: v.id("members"), since: v.number() })),
  }).index("by_company_status", ["companyId", "status"]),

  properties: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    label: v.optional(v.string()),
    address: addressValidator,
    kind: propertyKindValidator,
    /** Gate codes, lockboxes, alarms. Owner and Manager only; a cleaner sees them on an accepted visit. Never in search, previews or agent summaries. */
    accessInstructions: v.optional(v.string()),
    status: recordStatusValidator,
    createdAt: v.number(),
    // ── Clients & Properties (convex/lib/clients). ──
    timezone: v.optional(v.string()),
    details: v.optional(propertyDetailsValidator),
    /** For the crew: parking and where to go. Not sensitive. */
    parking: v.optional(v.string()),
    /** For the crew: how this property is cleaned. */
    crewNotes: v.optional(v.string()),
    /** What the client asked for or was told, in their words. */
    clientNotes: v.optional(v.string()),
    /** Owner and Manager only. */
    officeNotes: v.optional(v.string()),
    siteContactId: v.optional(v.id("clientContacts")),
    archivedAt: v.optional(v.number()),
    revision: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_postal", ["companyId", "address.postalCode"]),

  // ── Cleaners and when they can work ────────────────────────────────────────────────────────────
  cleaners: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    /** Relationship type: employee, independent contractor, or a worker supplied by a subcontractor company. */
    engagement: engagementValidator,
    /**
     * Engagement status, set by a person. The stored value "ready" means the engagement is active; it does
     * not by itself make anyone eligible for a job (lib/cleaners/readiness.ts adds the requirements).
     */
    status: cleanerStatusValidator,
    /** Skills a person confirmed. Dispatch matches a job's required skills against these. */
    skills: v.array(v.string()),
    /** Postal codes the cleaner works in. Empty means not set yet, which matches nothing. */
    serviceAreas: v.array(v.string()),
    /** Set by the Owner only. No agent reads this to change it. Its history is in payArrangements. */
    pay: v.optional(payValidator),
    createdAt: v.number(),
    // The Cleaners workspace (convex/lib/cleaners/schema.ts). Every field is optional so older rows stay valid.
    /** The subcontractor company this worker works through now. Past ones are in workerAffiliations. */
    subcontractorId: v.optional(v.id("subcontractors")),
    photoStorageId: v.optional(v.id("_storage")),
    /** Areas the cleaner prefers, a subset of serviceAreas. */
    preferredAreas: v.optional(v.array(v.string())),
    /** The longest the cleaner said they will travel to a job. Dispatch has no drive times, so this is shown, not enforced. */
    maxTravelMinutes: v.optional(v.number()),
    /** When the cleaner (or a person for them) last confirmed the weekly availability is still right. */
    availabilityConfirmedAt: v.optional(v.number()),
    /** The application this worker was hired from, when Recruiter handed them over. */
    hiredFrom: v.optional(v.id("applications")),
    /** When the engagement status last changed. */
    statusChangedAt: v.optional(v.number()),
    /** Set by an approved rehire restriction. Shown to managers; never sent to the cleaner. */
    rehireRestriction: v.optional(v.object({ until: v.optional(v.number()), requestId: v.id("personnelRequests") })),
    /** Their last answer to a check-in: still available, fewer jobs, a break until a date, or wanting to stop. */
    checkIn: v.optional(v.object({ answer: v.union(v.literal("available"), v.literal("fewer"), v.literal("break"), v.literal("stop")), at: v.number(), until: v.optional(v.number()), note: v.optional(v.string()) })),
    updatedAt: v.optional(v.number()),
  })
    .index("by_company_status", ["companyId", "status"])
    .index("by_company_subcontractor", ["companyId", "subcontractorId"]),

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
    /** Who recorded it: a person, the cleaner from their portal, or their subcontractor company. Absent on older rows (a person). */
    source: v.optional(v.union(v.literal("member"), v.literal("cleaner"), v.literal("subcontractor"))),
    createdAt: v.optional(v.number()),
  }).index("by_company_cleaner_end", ["companyId", "cleanerId", "endsAt"]),

  // ── Jobs and assignments. Payments are not here and are never inferred from these. ─────────────
  jobs: defineTable({
    companyId: v.id("companies"),
    customerId: v.id("customers"),
    propertyId: v.id("properties"),
    serviceType: v.string(),
    scope: v.string(),
    requiredSkills: v.array(v.string()),
    /** The service template this job was made from, as it was then. Later edits to the template do not reach it. */
    serviceSnapshot: v.optional(serviceSnapshotValidator),
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
    /**
     * What a person decided about the crew's report. "closed" follows a review. "closed_without_review" is
     * the override: it always carries the reason, and it is kept apart so it is never read as a review.
     * Neither approves a payment or releases a payout.
     */
    completionReview: v.optional(v.object({ decision: v.union(v.literal("closed"), v.literal("closed_without_review")), by: v.id("members"), at: v.number(), note: v.optional(v.string()) })),
    /** How many times the crew's report was sent back for correction. */
    completionReturns: v.optional(v.number()),
    /** The checklist template version this visit's checklist was copied from, if any. */
    checklistTemplate: v.optional(v.object({ templateId: v.id("checklistTemplates"), version: v.number() })),
    /** The service plan that booked this visit, and the day of the series it is. */
    planId: v.optional(v.id("servicePlans")),
    planDate: v.optional(v.string()),
    /** Cancelled because a person skipped it (a plan's visit), kept apart from a cancellation. */
    skipped: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_company_start", ["companyId", "startsAt"])
    .index("by_company_status_start", ["companyId", "status", "startsAt"])
    .index("by_company_customer", ["companyId", "customerId"])
    .index("by_company_customer_start", ["companyId", "customerId", "startsAt"])
    .index("by_company_property_start", ["companyId", "propertyId", "startsAt"])
    .index("by_company_plan", ["companyId", "planId", "startsAt"])
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
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_about", ["companyId", "about.id"]),

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
      /** The answer to a STOP, HELP or START the person texted (convex/inbound.ts). */
      v.literal("compliance_reply"),
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
      // Finance, to customers: an invoice's pay link, and a reminder about what is due (convex/lib/finance/outbox.ts).
      v.literal("invoice_sent"),
      v.literal("payment_reminder"),
      // Finance, to a cleaner: the private link to their own earnings statement.
      v.literal("earnings_statement"),
      // Cleaners workspace, to cleaners and subcontractor contacts.
      v.literal("portal_invitation"),
      v.literal("onboarding_reminder"),
      v.literal("availability_check"),
      v.literal("idle_check_in"),
      v.literal("verification_code"),
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
    /** Finance messages: the customer and the invoice whose pay link the message carries as "{link}". */
    customerId: v.optional(v.id("customers")),
    invoiceId: v.optional(v.id("invoices")),
    jobId: v.optional(v.id("jobs")),
    assignmentId: v.optional(v.id("assignments")),
    linkId: v.optional(v.id("actionLinks")),
    /** A Cleaners portal or task link the message carries. */
    portalLinkId: v.optional(v.id("portalLinks")),
    followUpId: v.optional(v.id("followUps")),
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
    /** Set when the sending policy refused this text: the policy's code (convex/lib/messaging/policy.ts). */
    refusal: v.optional(v.string()),
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
    .index("by_company_invoice", ["companyId", "invoiceId"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "queuedAt"])
    .index("by_company_customer", ["companyId", "customerId", "queuedAt"])
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

  /**
   * The checklist a service starts from. Each change is a new version; a visit keeps the items it was
   * created with, so a change applies to visits scheduled after it and never to work already offered.
   */
  checklistTemplates: defineTable({
    companyId: v.id("companies"),
    /** The service it applies to, matched without regard to case or spacing. */
    serviceKey: v.string(),
    serviceType: v.string(),
    version: v.number(),
    items: v.array(v.object({ label: v.string(), section: v.optional(v.string()), requiresPhoto: v.boolean() })),
    createdBy: v.id("members"),
    createdAt: v.number(),
    /** Set when a person stopped using it. Visits already made from it keep their items. */
    retiredAt: v.optional(v.number()),
  }).index("by_company_service_version", ["companyId", "serviceKey", "version"]),

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

  /**
   * A cleaner's text, read against the visits they are on or were offered. The reading is a proposal:
   * it is checked against the record before anything changes, and a person decides anything unclear.
   * Only an excerpt of the text is kept, with any link taken out.
   */
  replyReadings: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    excerpt: v.string(),
    receivedAt: v.number(),
    status: v.union(v.literal("reading"), v.literal("proposed"), v.literal("applied"), v.literal("unclear"), v.literal("dismissed"), v.literal("not_applied")),
    reader: v.optional(v.string()),
    intent: v.optional(v.union(v.literal("accept_offer"), v.literal("decline_offer"), v.literal("running_late"), v.literal("cannot_attend"), v.literal("other"))),
    assignmentId: v.optional(v.id("assignments")),
    etaMinutes: v.optional(v.number()),
    reason: v.optional(v.string()),
    /** What happened when it was applied, or why it could not be. */
    outcome: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    decidedAt: v.optional(v.number()),
  })
    .index("by_company_received", ["companyId", "receivedAt"])
    .index("by_company_task", ["companyId", "taskId"]),

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

  // ── Company Chat: conversations, runs, action receipts, drafts and confirmed knowledge ─────────
  ...chatTables,
  ...agreementTables,
  ...googleTables,
  // ── Cleaners: subcontractors, requirements, crews, portal, follow-ups, coaching, personnel ──────
  ...cleanersTables,
  ...clientsTables,

  // ── The AI layer: usage, model settings, Creative Studio, generation allowances, search index ──
  ...aiTables,
  ...billingTables,
  // Services & Pricing (convex/lib/services/schema.ts).
  ...servicesTables,

  // ── Finance: the cleaning company's own money, never Selestial's subscription (convex/lib/finance) ─
  ...financeTables,

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
