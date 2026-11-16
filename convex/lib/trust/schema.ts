/**
 * The trust record: what Selestial says about itself in public, the evidence behind it, and the
 * requests people send about their data and about security. Staff keep it (convex/trust.ts and
 * convex/requests.ts). Company data rights (exports and erasures) are in convex/dataRights.ts.
 *
 * Only some fields are public. Anything a person outside Selestial can see goes through
 * `publicView` in ./seed.ts; nothing else here is shown outside the staff pages.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

// ── The registry ──────────────────────────────────────────────────────────────────────────────────

export const PROVIDER_STATUSES = ["in_use", "connected_not_live", "planned"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export const providerStatusValidator = literals(PROVIDER_STATUSES);

export const REVIEW_STATUSES = ["verified", "needs_review"] as const;
export const reviewStatusValidator = literals(REVIEW_STATUSES);

export const CLAIM_AREAS = ["access", "permissions", "audit", "messaging", "links", "encryption", "backups", "mfa", "ai", "certification", "sale_of_data"] as const;
export type ClaimArea = (typeof CLAIM_AREAS)[number];
export const claimAreaValidator = literals(CLAIM_AREAS);

/**
 * implemented_verified: built, and the evidence (a test, a setting) was checked. implemented_unverified:
 * built, not yet checked. planned: not built. external_setup: depends on a provider setting nobody has
 * confirmed. decision_required: a business or legal decision nobody has made yet.
 */
export const CLAIM_STATUSES = ["implemented_verified", "implemented_unverified", "planned", "external_setup", "decision_required"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const claimStatusValidator = literals(CLAIM_STATUSES);

export const PUBLICATION_STATUSES = ["published", "draft", "withdrawn"] as const;
export const publicationStatusValidator = literals(PUBLICATION_STATUSES);

export const contactsValidator = v.object({ security: v.string(), privacy: v.string(), support: v.string() });
export const verifiedValidator = v.object({
  legalEntity: v.boolean(),
  mailingAddress: v.boolean(),
  security: v.boolean(),
  privacy: v.boolean(),
  support: v.boolean(),
});

export const TRUST_TABLES = ["trustSettings", "trustProviders", "trustClaims", "policyPublications"] as const;
export const trustTableValidator = literals(TRUST_TABLES);

/** A value as it was before or after a change. Objects are flattened to dotted field names first. */
export const changeValueValidator = v.union(v.string(), v.number(), v.boolean(), v.null());

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────

export const REQUEST_KINDS = ["privacy", "vulnerability", "security_review"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const requestKindValidator = literals(REQUEST_KINDS);

export const PRIVACY_SUBTYPES = ["access", "correction", "deletion", "communication_preferences", "other"] as const;
export type PrivacySubtype = (typeof PRIVACY_SUBTYPES)[number];
export const privacySubtypeValidator = literals(PRIVACY_SUBTYPES);

export const RELATIONSHIPS = ["cleaning_company_customer", "customer_of_a_cleaning_company", "cleaner", "applicant", "other"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];
export const relationshipValidator = literals(RELATIONSHIPS);

export const REQUEST_STATUSES = ["received", "verifying", "in_progress", "waiting_on_requester", "routed_to_business", "completed", "closed_with_limitation", "spam"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const requestStatusValidator = literals(REQUEST_STATUSES);

export const ROUTINGS = ["selestial", "business"] as const;
export const routingValidator = literals(ROUTINGS);

export const NOTIFY_STATES = ["pending", "sent", "failed", "not_configured"] as const;
export const notifyStateValidator = literals(NOTIFY_STATES);

/** Who did something on a request: a staff member, or the system for automatic steps. */
const byValidator = v.string();

// ── Company data rights ───────────────────────────────────────────────────────────────────────────

export const EXPORT_STATUSES = ["preparing", "ready", "expired", "failed"] as const;
export const exportStatusValidator = literals(EXPORT_STATUSES);

export const ERASE_STEP_STATES = ["done", "kept", "failed"] as const;
export const eraseStepStateValidator = literals(ERASE_STEP_STATES);

export const trustTables = {
  /** One row, key "public". A contact or name is shown in public only while its `verified` flag is on. */
  trustSettings: defineTable({
    key: v.string(),
    legalEntity: v.string(),
    mailingAddress: v.string(),
    governingPlace: v.string(),
    contacts: contactsValidator,
    /** The Expires date in security.txt, YYYY-MM-DD. */
    securityTxtExpiresOn: v.string(),
    verified: verifiedValidator,
    updatedAt: v.number(),
    /** A staff id, or "seed". */
    updatedBy: v.string(),
  }).index("by_key", ["key"]),

  /** A company that handles data for Selestial. Planned ones are kept here but never shown as in use. */
  trustProviders: defineTable({
    key: v.string(),
    name: v.string(),
    purpose: v.string(),
    dataHandled: v.string(),
    /** Where it processes data. Null means nobody has verified it. */
    locations: v.union(v.string(), v.null()),
    /** The data processing agreement or terms, by name or reference. Null means none on file. Staff only. */
    agreementRef: v.union(v.string(), v.null()),
    policyUrl: v.union(v.string(), v.null()),
    status: providerStatusValidator,
    reviewStatus: reviewStatusValidator,
    /** YYYY-MM-DD. */
    reviewedOn: v.string(),
    publicNote: v.optional(v.string()),
  }).index("by_key", ["key"]),

  /** One sentence Selestial may say in public, with what proves it. Public only when implemented and verified. */
  trustClaims: defineTable({
    key: v.string(),
    area: claimAreaValidator,
    /** The exact public sentence. */
    text: v.string(),
    /** Test files, configuration or provider documents that back it. Staff only. */
    evidence: v.string(),
    status: claimStatusValidator,
    reviewedOn: v.string(),
    public: v.boolean(),
  }).index("by_key", ["key"]),

  /** Whether each document version (convex/lib/trust/documents.ts) is published. */
  policyPublications: defineTable({
    documentId: v.string(),
    status: publicationStatusValidator,
    publishedAt: v.optional(v.number()),
    publishedBy: v.optional(v.string()),
    approvalNote: v.optional(v.string()),
  }).index("by_document", ["documentId"]),

  /**
   * Append-only: every change to the four tables above. Public fields are kept with their values before
   * and after; staff-only fields that changed are named without their values.
   */
  trustChanges: defineTable({
    table: trustTableValidator,
    key: v.string(),
    action: v.union(v.literal("created"), v.literal("updated"), v.literal("removed")),
    fields: v.array(v.object({ field: v.string(), before: changeValueValidator, after: changeValueValidator })),
    internalFieldsChanged: v.array(v.string()),
    by: v.object({ staffId: v.optional(v.id("staff")), name: v.string() }),
    at: v.number(),
    note: v.string(),
  })
    .index("by_at", ["at"])
    .index("by_table_key", ["table", "key", "at"]),

  /**
   * A privacy request, a vulnerability report or a security review request from the public site, or a
   * company's request to be deleted. No IP address or device data is kept.
   */
  trustRequests: defineTable({
    /** Short and random, given to the requester. Not the database id. */
    reference: v.string(),
    kind: requestKindValidator,
    subtype: v.optional(privacySubtypeValidator),
    requester: v.object({ name: v.optional(v.string()), email: v.string(), relationship: relationshipValidator }),
    /** The cleaning company the person deals with, as they wrote it. For routing only. */
    businessName: v.optional(v.string()),
    details: v.string(),
    affected: v.optional(v.string()),
    severityGuess: v.optional(v.string()),
    company: v.optional(v.string()),
    role: v.optional(v.string()),
    questions: v.optional(v.string()),
    receivedAt: v.number(),
    status: requestStatusValidator,
    routing: routingValidator,
    companyId: v.optional(v.id("companies")),
    verification: v.object({ method: v.optional(v.string()), verifiedAt: v.optional(v.number()), by: v.optional(byValidator) }),
    assignedTo: v.optional(v.id("staff")),
    /** Set by staff, YYYY-MM-DD. Not a computed legal deadline. */
    dueOn: v.optional(v.string()),
    notes: v.array(v.object({ at: v.number(), by: byValidator, text: v.string() })),
    actions: v.array(v.object({ at: v.number(), by: byValidator, action: v.string(), detail: v.string() })),
    completion: v.optional(v.object({ at: v.number(), by: byValidator, outcome: v.string(), limitation: v.optional(v.string()) })),
    /** The email to Selestial's own inbox about this request. `problem` is words for a person. */
    notify: v.object({ state: notifyStateValidator, attempts: v.number(), lastAt: v.optional(v.number()), problem: v.optional(v.string()) }),
  })
    .index("by_reference", ["reference"])
    .index("by_received", ["receivedAt"])
    .index("by_kind_received", ["kind", "receivedAt"])
    .index("by_status_received", ["status", "receivedAt"])
    .index("by_kind_status_received", ["kind", "status", "receivedAt"])
    .index("by_company_received", ["companyId", "receivedAt"]),

  /** A JSON file of one company's records, made at the Owner's request and kept for a short time. */
  dataExports: defineTable({
    companyId: v.id("companies"),
    requestedBy: v.id("members"),
    status: exportStatusValidator,
    storageId: v.optional(v.id("_storage")),
    expiresAt: v.number(),
    createdAt: v.number(),
    sizeBytes: v.optional(v.number()),
    downloadedAt: v.optional(v.number()),
    problem: v.optional(v.string()),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_status_expires", ["status", "expiresAt"]),

  /** What an erasure did, step by step, and what it kept and why. Holds ids, never the erased details. */
  deletionRecords: defineTable({
    companyId: v.id("companies"),
    subject: v.object({ kind: v.union(v.literal("customer"), v.literal("cleaner")), id: v.string() }),
    requestedBy: v.id("members"),
    at: v.number(),
    steps: v.array(v.object({ step: v.string(), state: eraseStepStateValidator, detail: v.string() })),
    keptReasons: v.array(v.string()),
  })
    .index("by_company_at", ["companyId", "at"])
    .index("by_company_subject", ["companyId", "subject.id"]),
};
