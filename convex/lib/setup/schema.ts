/**
 * Company setup (the owner's onboarding) and the shared company context it collects.
 *
 * Setup keeps only where the owner is and what they chose. What it learns about the company is not kept
 * here: a fact with an authoritative home goes there (the name and clock on the company, postal codes in
 * business settings, services in Services & Pricing), and everything else is a `companyFacts` row that every
 * agent and Chat read. A fact says where it came from and whether a person confirmed it; a found fact is
 * never treated as confirmed.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const PRIORITIES = ["sales", "dispatch", "recruiter", "retention", "pricing", "booking"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const priorityValidator = v.union(...PRIORITIES.map((value) => v.literal(value)));

export const METHODS = ["website", "connect", "manual"] as const;
export type Method = (typeof METHODS)[number];
export const methodValidator = v.union(...METHODS.map((value) => v.literal(value)));

export const FACT_SOURCES = ["owner", "website", "import", "sign_in"] as const;
export const factSourceValidator = v.union(...FACT_SOURCES.map((value) => v.literal(value)));
export const factValueValidator = v.union(v.string(), v.array(v.string()));

export const setupTables = {
  /** One per company. Absent for companies made before setup existed: they are never sent through it. */
  companySetups: defineTable({
    companyId: v.id("companies"),
    /** in_progress: the owner has not entered the workspace. entered: they have; setup continues inside the product. */
    status: v.union(v.literal("in_progress"), v.literal("entered")),
    /** The step the owner was last on, to resume there. */
    step: v.string(),
    methods: v.array(methodValidator),
    priority: v.optional(priorityValidator),
    secondary: v.array(priorityValidator),
    /** Answers to the priority's own questions, by question id. "unsure" is an answer. */
    answers: v.record(v.string(), factValueValidator),
    /** Optional steps the owner chose to skip, so they are not asked again. */
    skipped: v.array(v.string()),
    /** Counts saves, so an older tab or device cannot overwrite a newer one. */
    revision: v.number(),
    /** When each point of the journey was first reached. Measured, never estimated. */
    milestones: v.object({
      startedAt: v.number(),
      contextConfirmedAt: v.optional(v.number()),
      firstArtifactAt: v.optional(v.number()),
      firstReviewedAt: v.optional(v.number()),
      firstActionAt: v.optional(v.number()),
      enteredAt: v.optional(v.number()),
    }),
    updatedAt: v.number(),
  }).index("by_company", ["companyId"]),

  /** One thing known about the company, with its source and whether a person confirmed it. */
  companyFacts: defineTable({
    companyId: v.id("companies"),
    /** For example "workforce.arrangement". The keys are listed in lib/setup/facts.ts. */
    key: v.string(),
    value: factValueValidator,
    source: factSourceValidator,
    /** Where it was found, for a fact read from a page or a file. */
    sourceRef: v.optional(v.string()),
    retrievedAt: v.optional(v.number()),
    state: v.union(v.literal("found"), v.literal("confirmed")),
    confirmedBy: v.optional(v.id("members")),
    confirmedAt: v.optional(v.number()),
    /** A different value found elsewhere, kept for the owner to choose between. */
    conflict: v.optional(v.object({ value: factValueValidator, source: factSourceValidator, sourceRef: v.optional(v.string()) })),
    updatedAt: v.number(),
  }).index("by_company_key", ["companyId", "key"]),
};
