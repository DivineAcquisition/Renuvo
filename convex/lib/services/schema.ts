/**
 * Services & Pricing: the company's one service catalog and everything that changes it.
 *
 * Kept apart on purpose:
 *  - the service's identity (services), which never changes its key, so visits can name it;
 *  - versions (serviceVersions), immutable once written and identified by the hash of their content;
 *  - the working draft (serviceDrafts), autosaved with a revision, shared by people and Selestial;
 *  - changes (serviceChanges): a submitted version, its review, approval of that exact hash, and when
 *    it went live. Publishing is always a person's act (the owner's decision of November 16, 2026).
 *
 * Every table carries companyId and is read through an index that starts with it.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { actorValidator } from "../events";
import { literals, workKindValidator } from "../statuses";
import { costsValidator } from "./profit";
import { categoryValidator, specValidator } from "./spec";

export const SERVICE_STATUS = ["draft", "active", "archived"] as const;
export type ServiceStatus = (typeof SERVICE_STATUS)[number];

export const ORIGINS = ["settings", "template", "import", "manual", "chat", "research"] as const;
export type ServiceOrigin = (typeof ORIGINS)[number];

/**
 * in_review → approved → (scheduled →) published. "returned" means the draft was edited after it was
 * submitted, so the review and any approval no longer describe it. "superseded" means a later change
 * for the same service went live first. "withdrawn" is the submitter's or the Owner's choice.
 */
export const CHANGE_STATES = ["in_review", "approved", "scheduled", "published", "returned", "withdrawn", "superseded"] as const;
export type ChangeState = (typeof CHANGE_STATES)[number];
export const OPEN_CHANGE_STATES: readonly ChangeState[] = ["in_review", "approved", "scheduled"];

/**
 * publish, archive and restore change the service itself. property_price gives one property its own base
 * price for the service: it is reviewed and approved like any other change, but it does not touch the
 * catalog, and a catalog change does not touch it (the owner's decision of November 17, 2026).
 */
export const CHANGE_KINDS = ["publish", "archive", "restore", "property_price"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** A property price's optional date: a review date only reminds; an end date stops it after that day. */
export const untilValidator = v.union(v.null(), v.object({ kind: v.union(v.literal("review"), v.literal("end")), date: v.string() }));

/** An extra that works differently at one property: included at no charge, or at the property's own price. */
export const propertyExtraValidator = v.object({ id: v.string(), included: v.boolean(), priceCents: v.union(v.number(), v.null()) });

/** What a property price change proposes. Lives on the change; approving it writes a propertyPrices row. */
export const proposedPropertyPriceValidator = v.object({
  propertyId: v.id("properties"),
  baseCents: v.number(),
  /** Usual labor-minutes at this property, when it differs from the service's. Changes time, not price. */
  laborMinutes: v.union(v.number(), v.null()),
  until: untilValidator,
  /** Tasks the crew also does at this property, added to each visit's scope and checklist. */
  addedTasks: v.optional(v.array(v.string())),
  /** Extras that are included, or priced their own way, at this property. */
  extras: v.optional(v.array(propertyExtraValidator)),
  /** The property's price in force when this was proposed, if any. Approval is refused if it changed since. */
  replaces: v.union(v.id("propertyPrices"), v.null()),
});

export const PROPERTY_PRICE_STATES = ["active", "ended", "replaced"] as const;

export const evidenceValidator = v.object({
  kind: v.union(v.literal("research"), v.literal("note"), v.literal("scenario"), v.literal("agent"), v.literal("import")),
  label: v.string(),
  detail: v.string(),
  /** A research brief, import or other record this came from. */
  ref: v.optional(v.string()),
});
export type Evidence = typeof evidenceValidator.type;

/** A specialist's structured contribution to a review: what it checked, what it found, and an edit it suggests. */
export const agentNoteValidator = v.object({
  agent: v.union(v.literal("dispatch"), v.literal("recruiter"), v.literal("sales"), v.literal("retention")),
  status: v.union(v.literal("ok"), v.literal("concern"), v.literal("unavailable")),
  title: v.string(),
  detail: v.string(),
  /** A structured edit the specialist proposes; applied only if a person chooses it. */
  suggestion: v.optional(v.object({ label: v.string(), field: v.string(), value: v.number() })),
});
export type AgentNote = typeof agentNoteValidator.type;

export const lineValidator = v.object({
  key: v.string(),
  kind: v.union(v.literal("base"), v.literal("adjustment"), v.literal("add_on"), v.literal("fee"), v.literal("discount"), v.literal("minimum"), v.literal("rounding"), v.literal("info"), v.literal("billed_later")),
  label: v.string(),
  detail: v.string(),
  amountCents: v.number(),
});

export const outcomeValidator = v.union(v.literal("firm"), v.literal("estimate"), v.literal("walkthrough"), v.literal("incomplete"));

/** What the owner told setup. Null means they chose "I'm not sure"; `unsure` lists those fields, and each becomes a stated assumption or follow-up. */
export const contextValidator = v.object({
  serviceAreas: v.string(),
  customerKinds: v.array(workKindValidator),
  categories: v.array(categoryValidator),
  currentServices: v.string(),
  typicalSizes: v.string(),
  teamStructure: v.union(v.literal("solo"), v.literal("one_crew"), v.literal("several_crews"), v.null()),
  cleaners: v.union(v.number(), v.null()),
  compensation: v.union(v.literal("hourly"), v.literal("per_visit"), v.literal("revenue_share"), v.literal("mixed"), v.null()),
  typicalVisitMinutes: v.union(v.number(), v.null()),
  bookingsPerWeek: v.union(v.number(), v.null()),
  capacityPerWeek: v.union(v.number(), v.null()),
  notes: v.string(),
  unsure: v.array(v.string()),
});
export type Context = typeof contextValidator.type;

export const STRATEGIES = ["cost_plus", "positioning", "market"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export const BASES = ["advertised_starting", "estimated", "firm_published", "company_data", "ai_inference"] as const;
export type Basis = (typeof BASES)[number];

/** The inputs a quote takes (engine.ts QuoteInput), as a validator for public functions. */
export const quoteInputValidator = v.object({
  area: v.optional(v.number()),
  bedrooms: v.optional(v.number()),
  bathrooms: v.optional(v.number()),
  halfBaths: v.optional(v.number()),
  units: v.optional(v.number()),
  laborMinutes: v.optional(v.number()),
  elapsedMinutes: v.optional(v.number()),
  crewSize: v.optional(v.number()),
  condition: v.optional(v.string()),
  firstVisit: v.optional(v.boolean()),
  schedule: v.optional(v.union(v.literal("every_7_days"), v.literal("every_14_days"), v.literal("every_28_days"), v.literal("twice_per_month"), v.literal("once_per_month"))),
  addOns: v.optional(v.array(v.object({ id: v.string(), quantity: v.number() }))),
  postalCode: v.optional(v.string()),
  date: v.optional(v.string()),
  rush: v.optional(v.boolean()),
  afterHours: v.optional(v.boolean()),
  promotionId: v.optional(v.string()),
  beds: v.optional(v.number()),
  answers: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
  timePercent: v.optional(v.number()),
});

export const servicesTables = {
  services: defineTable({
    companyId: v.id("companies"),
    /** Stable, chosen once: a migrated service keeps its Settings id, so visits that name it still find it. */
    key: v.string(),
    /** The published name, or the draft's while it was never published. For lists only. */
    name: v.string(),
    category: categoryValidator,
    status: literals(SERVICE_STATUS),
    publishedVersion: v.optional(v.number()),
    publishedVersionId: v.optional(v.id("serviceVersions")),
    publishedAt: v.optional(v.number()),
    /** The highest version number written. */
    latestVersion: v.number(),
    origin: literals(ORIGINS),
    templateId: v.optional(v.string()),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_company_key", ["companyId", "key"])
    .index("by_company_status", ["companyId", "status"]),

  serviceVersions: defineTable({
    companyId: v.id("companies"),
    serviceId: v.id("services"),
    version: v.number(),
    spec: specValidator,
    /** SHA-256 of the canonical spec. Approval is bound to it. */
    hash: v.string(),
    /** The version this one started from. A rollback names the old version it copies. */
    basedOn: v.optional(v.number()),
    source: v.union(v.literal("settings"), v.literal("draft"), v.literal("rollback")),
    note: v.optional(v.string()),
    author: actorValidator,
    createdAt: v.number(),
  }).index("by_company_service_version", ["companyId", "serviceId", "version"]),

  serviceDrafts: defineTable({
    companyId: v.id("companies"),
    serviceId: v.id("services"),
    spec: specValidator,
    /** Counts saves. A save names the revision it started from; a different one is refused, never overwritten. */
    revision: v.number(),
    /** The published version this draft started from, if any. */
    baseVersion: v.optional(v.number()),
    /** The builder step to reopen at. */
    step: v.string(),
    updatedBy: actorValidator,
    updatedAt: v.number(),
    createdAt: v.number(),
    /** Set when a rollback started this draft. */
    rollbackOf: v.optional(v.number()),
    /** Where the last edit was made: the workspace, or Company Chat on the person's request. */
    via: v.optional(v.union(v.literal("workspace"), v.literal("chat"))),
    /** Research, imports and notes attached while drafting. They travel with the draft into its review. */
    evidence: v.optional(v.array(evidenceValidator)),
  }).index("by_company_service", ["companyId", "serviceId"]),

  serviceChanges: defineTable({
    companyId: v.id("companies"),
    serviceId: v.id("services"),
    kind: literals(CHANGE_KINDS),
    state: literals(CHANGE_STATES),
    /** The version a publish change makes live. Archive and restore name the version in force. */
    versionId: v.optional(v.id("serviceVersions")),
    version: v.optional(v.number()),
    /** The live version when this was submitted. Publishing refuses if the live version moved since. */
    fromVersion: v.optional(v.number()),
    /** Hash of exactly what approving authorizes: kind, version hash, the live version it replaces, timing. */
    hash: v.string(),
    /** The draft's revision when submitted. A later save returns the change. */
    draftRevision: v.optional(v.number()),
    title: v.string(),
    reason: v.string(),
    evidence: v.array(evidenceValidator),
    agentNotes: v.array(agentNoteValidator),
    /** In words, computed when submitted: what changes, which future quotes, what is left alone. */
    impact: v.array(v.string()),
    customerNotice: v.object({ required: v.boolean(), note: v.string() }),
    contractReview: v.object({ required: v.boolean(), note: v.string() }),
    /** When it should take effect. Absent: when published. */
    effectiveAt: v.optional(v.number()),
    /** The scheduled publish, so returning or withdrawing the change can cancel it. */
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    /** Set on a property_price change: the price it proposes for one property. */
    propertyPrice: v.optional(proposedPropertyPriceValidator),
    submittedBy: actorValidator,
    submittedAt: v.number(),
    approval: v.optional(v.object({ by: v.id("members"), at: v.number(), hash: v.string(), note: v.optional(v.string()) })),
    publishedAt: v.optional(v.number()),
    publishedBy: v.optional(actorValidator),
    /** Why it was returned or withdrawn, or why a scheduled publish could not go ahead. */
    closedReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_company_updated", ["companyId", "updatedAt"])
    .index("by_company_service", ["companyId", "serviceId", "submittedAt"])
    .index("by_company_state", ["companyId", "state", "updatedAt"]),

  /**
   * A property's own base price for one service, after the Owner approved it. Extras, rush, discounts,
   * the minimum and rounding still apply from the service's live version. It keeps its price when the
   * catalog changes, until a person changes it or its end date passes. Only "active" rows price visits.
   */
  propertyPrices: defineTable({
    companyId: v.id("companies"),
    serviceId: v.id("services"),
    propertyId: v.id("properties"),
    customerId: v.id("customers"),
    baseCents: v.number(),
    laborMinutes: v.union(v.number(), v.null()),
    until: untilValidator,
    /** Tasks the crew also does at this property. Absent on rows written before property scope existed. */
    addedTasks: v.optional(v.array(v.string())),
    /** Extras included, or priced their own way, at this property. */
    extras: v.optional(v.array(propertyExtraValidator)),
    /** Why the property has its own price, from the change that set it. */
    reason: v.string(),
    state: literals(PROPERTY_PRICE_STATES),
    /** The approved change that set it. */
    changeId: v.id("serviceChanges"),
    /** The service's live version when it was approved, so a later catalog change can be pointed out. */
    catalogVersion: v.union(v.number(), v.null()),
    approvedBy: v.id("members"),
    approvedAt: v.number(),
    /** Set when the Owner was reminded of its review or end date. */
    remindedFor: v.optional(v.string()),
    endedAt: v.optional(v.number()),
    endedReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_company_property_service", ["companyId", "propertyId", "serviceId", "state"])
    .index("by_company_service_state", ["companyId", "serviceId", "state"])
    .index("by_company_state", ["companyId", "state"]),

  /** The company's own pricing setup: what setup learned, its costs and its strategy. One row per company. */
  pricingProfiles: defineTable({
    companyId: v.id("companies"),
    revision: v.number(),
    context: contextValidator,
    costs: costsValidator,
    strategy: v.union(literals(STRATEGIES), v.null()),
    positioning: v.union(v.literal("value"), v.literal("standard"), v.literal("premium"), v.null()),
    /** Research runs on its own during setup unless the Owner switches it off (the owner's decision of November 16, 2026). */
    researchDuringSetup: v.boolean(),
    setupCompletedAt: v.optional(v.number()),
    updatedBy: actorValidator,
    updatedAt: v.number(),
  }).index("by_company", ["companyId"]),

  /** A price the engine gave, with the version and inputs it was given for. A visit points at the one it was made with. */
  serviceQuotes: defineTable({
    companyId: v.id("companies"),
    serviceId: v.id("services"),
    versionId: v.id("serviceVersions"),
    version: v.number(),
    engineVersion: v.number(),
    /** The inputs, as JSON, and their hash: the same inputs and version always give the same price. */
    input: v.string(),
    inputHash: v.string(),
    outcome: outcomeValidator,
    totalCents: v.union(v.number(), v.null()),
    per: v.string(),
    lines: v.array(lineValidator),
    purpose: v.union(v.literal("visit"), v.literal("chat"), v.literal("studio"), v.literal("sales")),
    jobId: v.optional(v.id("jobs")),
    createdBy: actorValidator,
    createdAt: v.number(),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_job", ["companyId", "jobId"]),

  /** Existing pricing brought in from a spreadsheet or pasted text, held for review. Nothing here is a service until a person accepts a row. */
  serviceImports: defineTable({
    companyId: v.id("companies"),
    kind: v.union(v.literal("csv"), v.literal("text")),
    name: v.string(),
    /** The original, kept as it was given, so each row can point back to it. */
    source: v.string(),
    state: v.union(v.literal("review"), v.literal("failed"), v.literal("done"), v.literal("discarded")),
    error: v.optional(v.string()),
    rows: v.array(
      v.object({
        id: v.string(),
        /** Where in the original: "Row 4", "Line 7". */
        sourceRef: v.string(),
        raw: v.string(),
        name: v.string(),
        priceCents: v.union(v.number(), v.null()),
        unitRaw: v.string(),
        /** What the unit was read as, or null when it is unclear. */
        method: v.union(v.literal("fixed"), v.literal("hourly_per_cleaner"), v.literal("hourly_per_crew"), v.literal("per_area"), v.literal("per_unit"), v.literal("recurring_package"), v.null()),
        unitWord: v.optional(v.string()),
        scope: v.string(),
        flags: v.array(v.union(v.literal("unclear_unit"), v.literal("missing_scope"), v.literal("duplicate"), v.literal("missing_price"), v.literal("matches_existing"))),
        decision: v.union(v.literal("pending"), v.literal("drafted"), v.literal("skipped")),
        serviceId: v.optional(v.id("services")),
      }),
    ),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_company_created", ["companyId", "createdAt"]),

  researchBriefs: defineTable({
    companyId: v.id("companies"),
    question: v.string(),
    geography: v.string(),
    category: v.optional(categoryValidator),
    serviceId: v.optional(v.id("services")),
    origin: v.union(v.literal("setup"), v.literal("member"), v.literal("chat")),
    /** web: Selestial searched public pages. sources: only what a person supplied, plus the company's own records. */
    mode: v.union(v.literal("web"), v.literal("sources")),
    state: v.union(v.literal("queued"), v.literal("running"), v.literal("ready"), v.literal("failed"), v.literal("blocked")),
    /** Why it could not run, in words: no credits, no rate approved, web research not connected. */
    blocked: v.optional(v.string()),
    executionId: v.optional(v.id("aiExecutions")),
    summary: v.optional(
      v.object({
        found: v.array(v.string()),
        comparable: v.array(v.string()),
        uncertain: v.array(v.string()),
        options: v.array(v.object({ label: v.string(), tradeoff: v.string() })),
      }),
    ),
    findings: v.array(
      v.object({
        id: v.string(),
        statement: v.string(),
        basis: literals(BASES),
        sourceIds: v.array(v.id("researchSources")),
        geography: v.string(),
        scope: v.string(),
        limitation: v.string(),
        priceCents: v.union(v.number(), v.null()),
        unit: v.string(),
        comparable: v.boolean(),
      }),
    ),
    createdBy: actorValidator,
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
    /** The Chat conversation that started it. That conversation is told when it is ready. */
    conversationId: v.optional(v.id("conversations")),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_conversation", ["companyId", "conversationId"]),

  researchSources: defineTable({
    companyId: v.id("companies"),
    briefId: v.id("researchBriefs"),
    origin: v.union(v.literal("web"), v.literal("owner"), v.literal("company")),
    url: v.optional(v.string()),
    title: v.string(),
    publisher: v.optional(v.string()),
    /** When Selestial read it, or when the owner supplied it. */
    retrievedAt: v.number(),
    geography: v.string(),
    /** At most 300 characters, quoted from the source. */
    excerpt: v.string(),
    limitation: v.string(),
    priceKind: v.union(literals(BASES), v.null()),
    priceCents: v.union(v.number(), v.null()),
    unit: v.string(),
  }).index("by_company_brief", ["companyId", "briefId"]),
};
