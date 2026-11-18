/**
 * Booking Experiences (docs/booking/00-architecture.md): the shared booking rules, the experiences and
 * their published versions, customer sessions, capacity holds, agreement acceptances and funnel events.
 *
 * Rules every table here keeps:
 *  - Every row carries `companyId` and is read through an index that starts with it (except lookups by a
 *    secret token hash or by a scheduler's due time, which never return a row to a caller without
 *    checking its company).
 *  - Money is whole cents. Times are milliseconds since 1970.
 *  - A session's states are kept apart: paid is not confirmed, confirmed is not "a cleaner accepted".
 *  - A token is never stored, only its SHA-256.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { definitionValidator, experienceKindValidator, stepIdValidator } from "./definition";

export const EXPERIENCE_STATUSES = ["draft", "published", "unpublished", "archived"] as const;
export type ExperienceStatus = (typeof EXPERIENCE_STATUSES)[number];

export const PAYMENT_POLICY_KINDS = ["none", "deposit_percent", "deposit_fixed", "full"] as const;
export type PaymentPolicyKind = (typeof PAYMENT_POLICY_KINDS)[number];

export const paymentPolicyValidator = v.object({
  id: v.string(),
  label: v.string(),
  kind: literals(PAYMENT_POLICY_KINDS),
  /** For deposit_percent: 1 to 100. */
  percent: v.optional(v.number()),
  /** For deposit_fixed: whole cents. */
  cents: v.optional(v.number()),
  /** How the rest is collected, in the company's words ("Invoiced after the visit"). */
  balanceTerms: v.string(),
});
export type PaymentPolicy = typeof paymentPolicyValidator.type;

export const termValueValidator = v.union(v.string(), v.number(), v.boolean());

export const bookingAgreementValidator = v.object({
  id: v.string(),
  label: v.string(),
  /** An approved customer template in Company Agreements. */
  templateId: v.id("agreementTemplates"),
  /** Company-wide answers the template needs (cancellation notice, governing state…). Booking facts are filled per booking. */
  standing: v.record(v.string(), termValueValidator),
});
export type BookingAgreementRule = typeof bookingAgreementValidator.type;

export const SCHEDULING_MODES = ["capacity", "request"] as const;

export const bookingSettingsFields = {
  companyId: v.id("companies"),
  /** The company's public handle in booking links: /b/<handle>/<experience>. Lower case, unique. */
  handle: v.optional(v.string()),
  /**
   * The company's public profile: what a customer sees on every public page. Shared by every
   * experience; an experience can only choose which parts to show.
   */
  profile: v.object({
    displayName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    logo: v.optional(v.id("_storage")),
    brandColor: v.string(),
    accentColor: v.string(),
    /** The company's postal address, printed in marketing email (the "finish your booking" reminder). */
    mailingAddress: v.optional(v.string()),
  }),
  scheduling: v.object({
    /** "capacity": times are offered from cleaners' availability and held. "request": the customer names a preferred time and the office confirms. */
    mode: literals(SCHEDULING_MODES),
    /** The soonest a booking may start, in hours from now. */
    noticeHours: v.number(),
    /** How many days ahead customers may book. */
    horizonDays: v.number(),
    /** Minutes between offered start times. */
    slotMinutes: v.number(),
    /** Minutes a chosen time is held while the customer finishes. */
    holdMinutes: v.number(),
    /** Arrival window when the service has none. */
    defaultWindowMinutes: v.number(),
  }),
  paymentPolicies: v.array(paymentPolicyValidator),
  agreements: v.array(bookingAgreementValidator),
  revision: v.number(),
  updatedBy: v.optional(v.id("members")),
  updatedAt: v.number(),
};

export const SESSION_STATUSES = ["active", "requested", "confirmed", "needs_attention", "abandoned", "expired", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ANSWER_STATES = ["incomplete", "complete"] as const;
export const QUOTE_STATES = ["none", "firm", "estimate", "walkthrough", "incomplete", "changed"] as const;
export const AGREEMENT_STATES = ["not_required", "pending", "accepted"] as const;
export const PAYMENT_STATES = ["not_required", "pending", "started", "processing", "succeeded", "failed", "simulated"] as const;
export const CAPACITY_STATES = ["none", "held", "expired", "committed", "requested", "unavailable"] as const;
export const CONFIRMATION_STATES = ["open", "requested", "confirmed", "needs_attention", "cancelled"] as const;

export type PaymentState = (typeof PAYMENT_STATES)[number];
export type CapacityState = (typeof CAPACITY_STATES)[number];

export const quoteLineValidator = v.object({ key: v.string(), kind: v.string(), label: v.string(), detail: v.string(), amountCents: v.number() });

/** A price the customer was shown, with everything needed to show it again and to prove where it came from. */
export const sessionQuoteValidator = v.object({
  serviceKey: v.string(),
  serviceId: v.id("services"),
  versionId: v.id("serviceVersions"),
  version: v.number(),
  engineVersion: v.number(),
  /** The engine's input, canonical JSON, and its hash. */
  input: v.string(),
  inputHash: v.string(),
  outcome: literals(["firm", "estimate", "walkthrough", "incomplete"] as const),
  reasons: v.array(v.string()),
  missing: v.array(v.string()),
  per: v.string(),
  lines: v.array(quoteLineValidator),
  /** The service amount from the engine. Null when there is no price. */
  totalCents: v.union(v.number(), v.null()),
  taxCents: v.number(),
  taxLabel: v.optional(v.string()),
  /** Service amount plus tax. */
  grandTotalCents: v.union(v.number(), v.null()),
  dueNowCents: v.number(),
  balanceCents: v.number(),
  policy: v.union(v.null(), v.object({ id: v.string(), label: v.string(), kind: literals(PAYMENT_POLICY_KINDS), percent: v.optional(v.number()), cents: v.optional(v.number()), balanceTerms: v.string() })),
  elapsedMinutes: v.number(),
  crew: v.number(),
  windowMinutes: v.number(),
  /** A recurring frequency the customer chose, as the engine's schedule id. */
  schedule: v.optional(v.string()),
  computedAt: v.number(),
});
export type SessionQuote = typeof sessionQuoteValidator.type;

export const bookingTables = {
  bookingSettings: defineTable(bookingSettingsFields).index("by_company", ["companyId"]).index("by_handle", ["handle"]),

  bookingExperiences: defineTable({
    companyId: v.id("companies"),
    name: v.string(),
    /** The experience's part of its public address. Lower case, unique within the company. */
    slug: v.string(),
    kind: experienceKindValidator,
    status: literals(EXPERIENCE_STATUSES),
    /** The working draft. Saving names the revision it started from; a stale save is refused. */
    draft: definitionValidator,
    draftRevision: v.number(),
    draftSavedAt: v.number(),
    /** Who saved last, in words ("Dana", "Selestial, asked by Dana in Chat"). */
    draftSavedBy: v.string(),
    /** The version the public page serves. Absent: never published. */
    publishedVersion: v.optional(v.number()),
    publishedAt: v.optional(v.number()),
    /** Set when the draft differs from the published version. */
    draftDiffers: v.boolean(),
    duplicatedFrom: v.optional(v.id("bookingExperiences")),
    archivedAt: v.optional(v.number()),
    createdBy: v.id("members"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_status", ["companyId", "status", "updatedAt"])
    .index("by_company_slug", ["companyId", "slug"])
    .index("by_company_updated", ["companyId", "updatedAt"]),

  /** A published definition. Never edited: a rollback publishes a new version that names the old one. */
  bookingExperienceVersions: defineTable({
    companyId: v.id("companies"),
    experienceId: v.id("bookingExperiences"),
    version: v.number(),
    definition: definitionValidator,
    hash: v.string(),
    note: v.optional(v.string()),
    restoredFrom: v.optional(v.number()),
    publishedBy: v.id("members"),
    publishedAt: v.number(),
  }).index("by_company_experience_version", ["companyId", "experienceId", "version"]),

  bookingSessions: defineTable({
    companyId: v.id("companies"),
    experienceId: v.id("bookingExperiences"),
    /** The published version the session started on, or 0 for a test of the draft. */
    version: v.number(),
    /** A test booking started from the builder: it never charges, never creates a visit and never messages anyone. */
    test: v.boolean(),
    testDefinition: v.optional(definitionValidator),
    startedBy: v.optional(v.id("members")),
    /** SHA-256 of the secret the customer holds. Rotating replaces it; the old one stops working. */
    tokenHash: v.string(),
    /** SHA-256 of the token in the latest emailed link. Each email issues a new one; the previous emailed link stops working. */
    linkTokenHash: v.optional(v.string()),
    tokenIssuedAt: v.number(),
    revokedAt: v.optional(v.number()),
    /** After this the token opens nothing (a confirmed booking keeps a longer life for managing it). */
    expiresAt: v.number(),
    status: literals(SESSION_STATUSES),
    /** The furthest step reached. */
    step: stepIdValidator,
    mode: literals(["instant", "estimate_request", "walkthrough_request"] as const),
    contact: v.optional(v.object({ firstName: v.string(), lastName: v.string(), email: v.string(), phone: v.string(), textOk: v.boolean() })),
    postalCode: v.optional(v.string()),
    inArea: v.optional(v.boolean()),
    /** The property facts prices use. Asked once and reused by every service. */
    home: v.object({
      sizeKey: v.optional(v.string()),
      area: v.optional(v.number()),
      bedrooms: v.optional(v.number()),
      bathrooms: v.optional(v.number()),
      halfBaths: v.optional(v.number()),
      units: v.optional(v.number()),
      beds: v.optional(v.number()),
    }),
    selection: v.optional(
      v.object({
        serviceKey: v.string(),
        condition: v.optional(v.string()),
        schedule: v.optional(v.string()),
        /** For a per-unit service (rooms, windows): how many. */
        units: v.optional(v.number()),
        addOns: v.array(v.object({ id: v.string(), quantity: v.number() })),
        /** Answers to the service's own quoting questions, by question id, shared across services. */
        answers: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
      }),
    ),
    quote: v.optional(sessionQuoteValidator),
    /** The quote the customer accepted, exactly as shown. A later change asks them again. */
    accepted: v.optional(v.object({ inputHash: v.string(), grandTotalCents: v.number(), dueNowCents: v.number(), version: v.number(), acceptedAt: v.number() })),
    schedule: v.optional(
      v.object({
        /** YYYY-MM-DD on the company's calendar. */
        date: v.string(),
        /** The start of the arrival window. */
        startsAt: v.number(),
        windowMinutes: v.number(),
        /** The customer's preference only: nothing is reserved. */
        preferredOnly: v.boolean(),
        holdId: v.optional(v.id("bookingHolds")),
      }),
    ),
    address: v.optional(v.object({ line1: v.string(), line2: v.optional(v.string()), city: v.string(), region: v.string(), postalCode: v.string() })),
    /** The experience's own questions, without the access answers. */
    answers: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))),
    /** Access answers: shown to the assigned crew through the visit's instructions, and to nobody else. */
    accessNotes: v.optional(v.string()),
    /** Which access questions were answered (their words are only in `accessNotes`). */
    accessAnswered: v.optional(v.array(v.string())),
    answersState: literals(ANSWER_STATES),
    quoteState: literals(QUOTE_STATES),
    agreementState: literals(AGREEMENT_STATES),
    paymentState: literals(PAYMENT_STATES),
    capacityState: literals(CAPACITY_STATES),
    confirmationState: literals(CONFIRMATION_STATES),
    /** What still stands between the session and a confirmed booking, in words. */
    blockers: v.array(v.string()),
    acceptanceId: v.optional(v.id("bookingAcceptances")),
    invoiceId: v.optional(v.id("invoices")),
    paymentId: v.optional(v.id("payments")),
    customerId: v.optional(v.id("customers")),
    propertyId: v.optional(v.id("properties")),
    jobId: v.optional(v.id("jobs")),
    taskId: v.optional(v.id("tasks")),
    /** Where the visitor came from. Never a name, email or phone. */
    attribution: v.object({ source: v.string(), medium: v.string(), campaign: v.string(), referrer: v.string(), landing: v.string() }),
    /** A newer published version the session was asked to move to. */
    versionNotice: v.optional(v.string()),
    requestedAt: v.optional(v.number()),
    confirmedAt: v.optional(v.number()),
    recoveryOfferedAt: v.optional(v.number()),
    lastSeenAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["tokenHash"])
    .index("by_link_token", ["linkTokenHash"])
    .index("by_company_experience_created", ["companyId", "experienceId", "createdAt"])
    .index("by_company_status_updated", ["companyId", "status", "updatedAt"])
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_company_invoice", ["companyId", "invoiceId"]),

  /** A time a session is holding for a crew while the customer finishes. Acquired and released in one transaction each. */
  bookingHolds: defineTable({
    companyId: v.id("companies"),
    sessionId: v.id("bookingSessions"),
    startsAt: v.number(),
    /** Arrival window plus the visit's time on site. */
    endsAt: v.number(),
    crew: v.number(),
    status: literals(["held", "committed", "released", "expired"] as const),
    expiresAt: v.number(),
    jobId: v.optional(v.id("jobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_start", ["companyId", "startsAt"])
    .index("by_company_status_start", ["companyId", "status", "startsAt"])
    .index("by_company_session", ["companyId", "sessionId"])
    .index("by_status_expires", ["status", "expiresAt"]),

  /**
   * Images a company uploaded for its booking pages (logo, hero). A stored file has no owner of its own,
   * so a page may only show an image registered here to the same company.
   */
  bookingImages: defineTable({
    companyId: v.id("companies"),
    storageId: v.id("_storage"),
    uploadedBy: v.id("members"),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_company", ["companyId", "createdAt"]),

  /** What a customer accepted, exactly as they saw it, with the evidence. Never edited. */
  bookingAcceptances: defineTable({
    companyId: v.id("companies"),
    sessionId: v.id("bookingSessions"),
    ruleId: v.string(),
    templateId: v.id("agreementTemplates"),
    templateVersion: v.number(),
    title: v.string(),
    markdown: v.string(),
    contentHash: v.string(),
    signerName: v.string(),
    /** A drawn signature as an SVG path, if one was drawn. A typed name is always kept. */
    drawn: v.optional(v.string()),
    acceptedAt: v.number(),
    /** A one-way hash of the network address, and the browser's description, as evidence. */
    ipHash: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  }).index("by_company_session", ["companyId", "sessionId"]),

  /** The booking funnel, step by step. Holds no personal information. Test sessions are marked and counted apart. */
  bookingEvents: defineTable({
    companyId: v.id("companies"),
    experienceId: v.id("bookingExperiences"),
    sessionId: v.id("bookingSessions"),
    version: v.number(),
    type: v.string(),
    step: v.optional(v.string()),
    test: v.boolean(),
    source: v.optional(v.string()),
    campaign: v.optional(v.string()),
    amountCents: v.optional(v.number()),
    at: v.number(),
  })
    .index("by_company_experience_at", ["companyId", "experienceId", "at"])
    .index("by_company_session", ["companyId", "sessionId"]),
};
