/**
 * Business texting setup: the owner's saved draft, the company's own published texting pages, an
 * immutable copy of each submission, and the carrier callbacks Telnyx sends.
 *
 * The draft is the only thing the owner edits. Submitting copies it into a `textingSubmissions` row and a
 * `textingRequests` row (convex/lib/compliance/schema.ts), which provisioning works from. A correction
 * edits the draft again and makes a new submission version; nothing already filed is rewritten.
 *
 * The tax ID is never stored readable: it is sealed (AES-GCM, bound to the company) and only its last four
 * digits are kept beside it for the screens.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";

export const SETUP_STEPS = ["business", "activities", "permission", "number", "review", "progress"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** The kinds of business that can register. Government bodies are not cleaning companies and are not offered. */
export const ENTITY_TYPES = ["PRIVATE_PROFIT", "NON_PROFIT", "PUBLIC_PROFIT", "SOLE_PROPRIETOR"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Where a business detail came from, shown beside it until the owner confirms it. */
export const DETAIL_SOURCES = ["profile", "onboarding", "website", "booking", "company", "account", "owner"] as const;
export type DetailSource = (typeof DETAIL_SOURCES)[number];

export const BUSINESS_FIELDS = [
  "displayName",
  "legalName",
  "entityType",
  "vertical",
  "website",
  "supportEmail",
  "supportPhone",
  "street",
  "city",
  "state",
  "postalCode",
  "contactFirstName",
  "contactLastName",
  "contactEmail",
  "mobilePhone",
  "stockSymbol",
  "stockExchange",
] as const;
export type BusinessField = (typeof BUSINESS_FIELDS)[number];

const optional = v.optional(v.string());
export const businessValidator = v.object({
  displayName: optional,
  legalName: optional,
  entityType: optional,
  vertical: optional,
  website: optional,
  supportEmail: optional,
  supportPhone: optional,
  street: optional,
  city: optional,
  state: optional,
  postalCode: optional,
  contactFirstName: optional,
  contactLastName: optional,
  contactEmail: optional,
  mobilePhone: optional,
  stockSymbol: optional,
  stockExchange: optional,
});
export type Business = Partial<Record<BusinessField, string>>;

/** Where a company asks people for permission to text them. */
export const PERMISSION_PLACES = ["booking_form", "quote_form", "cleaner_application", "team_onboarding", "website", "other"] as const;
export type PermissionPlace = (typeof PERMISSION_PLACES)[number];

/** The texts the owner edits. Each starts as Selestial's draft written from the company's own details. */
export const DRAFT_KEYS = ["sms_consent", "marketing_consent", "terms", "privacy", "help_reply", "stop_reply", "start_reply", "opt_in_flow"] as const;
export type DraftKey = (typeof DRAFT_KEYS)[number];

export const draftValidator = v.object({ text: v.string(), edited: v.boolean(), at: v.number() });

export const PAGE_KINDS = ["privacy", "terms", "signup"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const textingTables = {
  /** One per company: the owner's saved setup. Saved on every change, so leaving and coming back resumes exactly. */
  textingSetups: defineTable({
    companyId: v.id("companies"),
    step: literals(SETUP_STEPS),
    business: businessValidator,
    /** Where each prefilled detail came from, and whether the owner has confirmed it. A detail the owner typed is "owner". */
    sources: v.array(v.object({ field: v.string(), source: literals(DETAIL_SOURCES), ref: v.optional(v.string()), confirmed: v.boolean() })),
    taxId: v.optional(v.object({ sealed: v.string(), last4: v.string(), at: v.number(), by: v.id("members") })),
    /** The owner said the business has no EIN. */
    noTaxId: v.optional(v.boolean()),
    activities: v.array(v.string()),
    places: v.array(v.string()),
    otherPlace: v.optional(v.string()),
    drafts: v.record(v.string(), draftValidator),
    /** One edited sample per activity key, when the owner changed Selestial's. */
    samples: v.record(v.string(), v.string()),
    hosting: v.optional(v.union(v.literal("selestial"), v.literal("own_site"))),
    ownSite: v.optional(v.object({ privacyUrl: v.optional(v.string()), termsUrl: v.optional(v.string()), signupUrl: v.optional(v.string()) })),
    /** The last check of each page address: whether it answered, and when. */
    checks: v.array(v.object({ kind: literals(PAGE_KINDS), url: v.string(), ok: v.boolean(), problem: v.optional(v.string()), at: v.number() })),
    number: v.optional(
      v.object({
        searchId: v.id("numberSearches"),
        phoneNumber: v.string(),
        locality: v.union(v.string(), v.null()),
        region: v.union(v.string(), v.null()),
        sms: v.boolean(),
        mms: v.boolean(),
        voice: v.boolean(),
        chosenAt: v.number(),
      }),
    ),
    /** What Selestial actually did or checked for the owner, newest last. Never a guess. */
    notes: v.array(v.object({ key: v.string(), step: literals(SETUP_STEPS), words: v.string(), at: v.number() })),
    requestId: v.optional(v.id("textingRequests")),
    revision: v.number(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("members")),
  }).index("by_company", ["companyId"]),

  /**
   * A published company page: its privacy policy, texting terms or texting sign-up. Never edited: a change
   * is a new version, and the older one is retired. A sign-up page also points at the consent wording it
   * records, so every permission it collects names the exact version shown.
   */
  textingPages: defineTable({
    companyId: v.id("companies"),
    kind: literals(PAGE_KINDS),
    version: v.number(),
    body: v.string(),
    /** Sign-up page only: the separate marketing line, and the disclosures the page records. */
    marketing: v.optional(v.string()),
    smsDisclosureId: v.optional(v.id("consentDisclosures")),
    marketingDisclosureId: v.optional(v.id("consentDisclosures")),
    publishedAt: v.number(),
    publishedBy: v.id("members"),
    retiredAt: v.optional(v.number()),
  }).index("by_company_kind_version", ["companyId", "kind", "version"]),

  /** Exactly what was submitted, each time. Never changed. The tax ID is not copied here. */
  textingSubmissions: defineTable({
    companyId: v.id("companies"),
    requestId: v.id("textingRequests"),
    version: v.number(),
    business: businessValidator,
    taxIdLast4: v.optional(v.string()),
    activities: v.array(v.string()),
    usecase: v.string(),
    subUsecases: v.array(v.string()),
    drafts: v.record(v.string(), v.string()),
    samples: v.array(v.string()),
    links: v.object({ privacy: v.string(), terms: v.string(), signup: v.optional(v.string()) }),
    phoneNumber: v.string(),
    authorization: v.optional(v.object({ wording: v.string(), pricesVersion: v.string(), at: v.number(), by: v.id("members") })),
    submittedAt: v.number(),
    submittedBy: v.id("members"),
  }).index("by_request_version", ["requestId", "version"]),

  /** Telnyx 10DLC callbacks whose signature checked out, once each. A callback is a hint: status is always read back from Telnyx. */
  telnyxEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    /** The brand, campaign or number the event is about. */
    ref: v.optional(v.string()),
    requestId: v.optional(v.id("textingRequests")),
    receivedAt: v.number(),
  }).index("by_event", ["eventId"]),
};
