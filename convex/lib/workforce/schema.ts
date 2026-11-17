/**
 * The workforce record beyond the cleaner row itself (docs/cleaners/00-architecture.md).
 *
 * Six things are kept apart on purpose, so none is ever read off another:
 *  - relationship type: how the person works with the company (`cleaners.engagement`);
 *  - engagement status: whether the relationship is onboarding, active, paused or ended (`cleaners.status`);
 *  - onboarding progress: which of the company's requirements are met (computed, lib/workforce/readiness.ts);
 *  - job eligibility: whether Dispatch may offer them work at all (computed from the two above);
 *  - availability: when they said they can work, for a given time (availabilityWindows, timeOff);
 *  - payout readiness: whether they can be paid (Finance's, not built; shown as not tracked).
 *
 * A subcontractor company, its authorized contact and the individual people it supplies are three
 * records. Jobs are only ever assigned to a real person (a `cleaners` row); the affiliation history
 * keeps which company supplied them, and when.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

export const SUBCONTRACTOR_STATUSES = ["active", "paused", "ended"] as const;
export type SubcontractorStatus = (typeof SUBCONTRACTOR_STATUSES)[number];
export const subcontractorStatusValidator = literals(SUBCONTRACTOR_STATUSES);

export const CREW_STATUSES = ["active", "archived"] as const;
export const crewStatusValidator = literals(CREW_STATUSES);

/** How a worker record came to exist. Kept so an import or a hire can be traced back. */
export const WORKER_SOURCES = ["manual", "import", "hiring"] as const;
export const workerSourceValidator = literals(WORKER_SOURCES);

/**
 * Onboarding requirements (Phase 2). What a requirement asks for is the company's; whether a given worker
 * has met it is a separate row, with its own review. An upload is never a verification, viewing a document
 * is never signing it, and starting payment setup is never completing it.
 */
export const REQUIREMENT_KINDS = ["document", "acknowledgment", "agreement", "payment_setup", "training", "equipment", "custom"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export const requirementKindValidator = literals(REQUIREMENT_KINDS);

/**
 * Stored states. "not_started" is the absence of a row; "expired" is read from expiresAt, so a stored
 * state never disagrees with the clock. submitted: started but not complete (payment setup begun, training
 * under way). awaiting_review: complete, waiting for a person. needs_changes: a person sent it back.
 */
export const STORED_REQUIREMENT_STATES = ["submitted", "awaiting_review", "accepted", "needs_changes"] as const;
export const storedRequirementStateValidator = literals(STORED_REQUIREMENT_STATES);
export const REQUIREMENT_STATES = ["not_started", ...STORED_REQUIREMENT_STATES, "expired"] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];

export const BLOCKS = ["assignments", "payment", "info"] as const;
export const blocksValidator = literals(BLOCKS);

export const engagementListValidator = v.array(v.union(v.literal("contractor"), v.literal("employee"), v.literal("subcontracted")));

/** Who did something to a requirement: a person in the company, or the cleaner through their portal. */
export const requirementActorValidator = v.union(
  v.object({ kind: v.literal("member"), memberId: v.id("members") }),
  v.object({ kind: v.literal("cleaner"), cleanerId: v.id("cleaners") }),
);

export const workforceTables = {
  onboardingRequirements: defineTable({
    companyId: v.id("companies"),
    label: v.string(),
    /** What the cleaner is asked to do, in the company's words. Shown to the cleaner. */
    instructions: v.optional(v.string()),
    kind: requirementKindValidator,
    /** The worker types it applies to. */
    appliesTo: engagementListValidator,
    /** What an unmet requirement stops: being offered work, being paid, or nothing. */
    blocks: blocksValidator,
    /** A person must accept what is submitted. An acknowledgment the cleaner makes needs no review. */
    needsReview: v.boolean(),
    /** The least role that may accept, send back or waive it. */
    reviewBy: v.union(v.literal("manager"), v.literal("owner")),
    /** Months an accepted document stays valid. Absent: it does not expire on its own. */
    validMonths: v.optional(v.number()),
    /** For an acknowledgment: the exact words the cleaner agrees to. A change makes a new version. */
    statement: v.optional(v.string()),
    /** Tax and payout documents: the Owner alone sees the files. */
    ownerOnly: v.boolean(),
    order: v.number(),
    version: v.number(),
    status: v.union(v.literal("active"), v.literal("retired")),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  /** One worker's progress on one requirement. No row means not started. */
  workerRequirements: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    requirementId: v.id("onboardingRequirements"),
    /** The requirement's version this answers. An acknowledgment of older words is not an acknowledgment of new ones. */
    version: v.number(),
    state: storedRequirementStateValidator,
    submittedAt: v.optional(v.number()),
    submittedBy: v.optional(requirementActorValidator),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("members")),
    /** Words shared with the cleaner, for example what to change. */
    feedback: v.optional(v.string()),
    /** A note kept for managers and the Owner. Never shown to the cleaner. */
    note: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    /** The words the cleaner agreed to, as they were. */
    acknowledged: v.optional(v.object({ statement: v.string(), at: v.number() })),
    /** A person set the requirement aside for this worker, with the reason. It is not an acceptance. */
    waived: v.optional(v.object({ by: v.id("members"), at: v.number(), reason: v.string() })),
    documentIds: v.array(v.id("workerDocuments")),
    updatedAt: v.number(),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId"])
    .index("by_company_requirement", ["companyId", "requirementId"]),

  /**
   * A link into one cleaner's portal. The token is the public id plus a signature made with the
   * deployment's secret; it is never stored. Opening the link shows nothing personal until the cleaner
   * confirms a code sent to the phone on their record. A new invitation revokes the earlier link.
   */
  portalLinks: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    publicId: v.string(),
    /** portal: the whole portal. task: opens one onboarding requirement after the same code check. */
    purpose: v.union(v.literal("portal"), v.literal("task")),
    requirementId: v.optional(v.id("onboardingRequirements")),
    issuedAt: v.number(),
    issuedBy: v.union(v.object({ kind: v.literal("member"), memberId: v.id("members") }), v.object({ kind: v.literal("agent"), agent: v.literal("recruiter") })),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
    revokeReason: v.optional(v.string()),
    /** When a code was last confirmed through this link: the cleaner acted on it. Views are not recorded. */
    verifiedAt: v.optional(v.number()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_company_cleaner", ["companyId", "cleanerId", "issuedAt"]),

  /**
   * A one-time code for a portal link. The code itself is never stored: it is worked out from the
   * deployment's secret, this row's id and its nonce, both when it is texted and when it is checked.
   */
  portalCodes: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    linkId: v.id("portalLinks"),
    nonce: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    usedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_link", ["linkId", "createdAt"]),

  /** A cleaner's signed-in portal on one device. Only a hash of the session token is kept. */
  portalSessions: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    linkId: v.id("portalLinks"),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    /** The last time a code was confirmed in this session. Pay and tax details need a recent one. */
    verifiedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_company_cleaner", ["companyId", "cleanerId"]),

  /** A cleaner asked the office for help from their portal. A person answers; nothing here is automated. */
  helpRequests: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    topic: v.union(v.literal("onboarding"), v.literal("availability"), v.literal("jobs"), v.literal("pay"), v.literal("other")),
    text: v.string(),
    status: v.union(v.literal("open"), v.literal("answered")),
    createdAt: v.number(),
    answeredBy: v.optional(v.id("members")),
    answeredAt: v.optional(v.number()),
  }).index("by_company_status", ["companyId", "status", "createdAt"]),

  /** A file a worker or a person gave for a requirement. Having it says nothing about whether it is genuine. */
  workerDocuments: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    requirementId: v.id("onboardingRequirements"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
    uploadedBy: requirementActorValidator,
    /** Chosen by the device for each file, so an upload retried on a bad connection is kept once. */
    clientKey: v.string(),
    uploadedAt: v.number(),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId"])
    .index("by_company_key", ["companyId", "cleanerId", "clientKey"]),

  /**
   * A company that supplies its own cleaners. The organization, the person authorized to speak for it,
   * and the workers it supplies are separate: the workers are `cleaners` rows linked through
   * `workerAffiliations`, so a job is always assigned to a named person.
   */
  subcontractors: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    /** The person authorized to act for the subcontractor. Not a worker unless also added as one. */
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    status: subcontractorStatusValidator,
    /** Who changed the status last and why, for paused and ended. */
    statusNote: v.optional(v.string()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    endedAt: v.optional(v.number()),
  }).index("by_company_status", ["companyId", "status"]),

  /**
   * Which subcontractor supplied a worker, and over what period. A change closes the open row and opens
   * a new one, so past jobs keep the affiliation they had. A direct worker has no open row.
   */
  workerAffiliations: defineTable({
    companyId: v.id("companies"),
    cleanerId: v.id("cleaners"),
    subcontractorId: v.id("subcontractors"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    by: v.id("members"),
  })
    .index("by_company_cleaner", ["companyId", "cleanerId", "startedAt"])
    .index("by_company_subcontractor", ["companyId", "subcontractorId", "startedAt"]),

  /**
   * A named team that usually works together, with a lead. Membership is history: a member who leaves
   * keeps their row with `leftAt`. Being in a crew says nothing about being free at a given time.
   */
  crews: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    notes: v.optional(v.string()),
    status: crewStatusValidator,
    createdBy: v.id("members"),
    createdAt: v.number(),
  }).index("by_company_status", ["companyId", "status"]),

  crewMembers: defineTable({
    companyId: v.id("companies"),
    crewId: v.id("crews"),
    cleanerId: v.id("cleaners"),
    role: v.union(v.literal("lead"), v.literal("member")),
    joinedAt: v.number(),
    leftAt: v.optional(v.number()),
    by: v.id("members"),
  })
    .index("by_company_crew", ["companyId", "crewId"])
    .index("by_company_cleaner", ["companyId", "cleanerId"]),

  /**
   * One import of a list of workers, named by the key the browser chose for it. The same import sent
   * twice (a double click, a retry after a dropped connection) finds this row and adds nobody again.
   */
  workerImports: defineTable({
    companyId: v.id("companies"),
    key: v.string(),
    created: v.array(v.id("cleaners")),
    skipped: v.number(),
    by: v.id("members"),
    at: v.number(),
  }).index("by_company_key", ["companyId", "key"]),
};
