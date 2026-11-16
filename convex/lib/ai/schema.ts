/**
 * The AI layer's record: what every model call used, the platform's model settings, Creative Studio's
 * assets and generation jobs, generation allowances, and the company knowledge search index.
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

import { literals } from "../statuses";
import { CAPABILITIES, PROVIDERS } from "./registry";

export const capabilityValidator = literals(CAPABILITIES);
export const providerValidator = literals(PROVIDERS);

export const FEATURES = ["chat", "recruiter_mail", "photo_review", "video_review", "image_generate", "image_edit", "video_generate", "embed", "document_search"] as const;
export type Feature = (typeof FEATURES)[number];
export const featureValidator = literals(FEATURES);

export const EVALUATIONS = ["not_evaluated", "evaluating", "approved", "rejected"] as const;
export const evaluationValidator = literals(EVALUATIONS);

export const JOB_STATES = ["queued", "running", "completed", "failed", "uncertain", "cancel_requested", "cancelled"] as const;
export type JobState = (typeof JOB_STATES)[number];
export const jobStateValidator = literals(JOB_STATES);

export const ASSET_ORIGINS = ["original", "composed", "generated"] as const;
export const assetOriginValidator = literals(ASSET_ORIGINS);

export const aiTables = {
  /** One row per model call (or per media job), with the provider's own usage kept as it came. */
  aiUsage: defineTable({
    companyId: v.id("companies"),
    memberId: v.optional(v.id("members")),
    feature: featureValidator,
    capability: capabilityValidator,
    provider: v.string(),
    model: v.string(),
    runId: v.optional(v.id("chatRuns")),
    jobId: v.optional(v.id("mediaJobs")),
    units: v.object({
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      cacheReadTokens: v.optional(v.number()),
      images: v.optional(v.number()),
      videoSeconds: v.optional(v.number()),
      resolution: v.optional(v.string()),
    }),
    /** From published rates; null when a rate is unknown. Never invented. */
    estimatedMicros: v.union(v.number(), v.null()),
    /** From the provider's own report of cost, when it gives one. */
    reconciledMicros: v.optional(v.number()),
    /** The provider's usage object, trimmed, for reconciliation. */
    raw: v.optional(v.string()),
    outcome: v.union(v.literal("ok"), v.literal("error"), v.literal("uncertain")),
    errorKind: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_company_at", ["companyId", "at"])
    .index("by_company_feature_at", ["companyId", "feature", "at"]),

  /** Platform administrators' settings per capability. No row means the registry's default. */
  aiSettings: defineTable({
    capability: capabilityValidator,
    enabled: v.boolean(),
    evaluation: evaluationValidator,
    note: v.optional(v.string()),
    updatedBy: v.id("staff"),
    updatedAt: v.number(),
  }).index("by_capability", ["capability"]),

  /** Staff's switch for one model a person may choose in chat (lib/ai/chatModels.ts). No row: on. */
  chatModelSettings: defineTable({
    key: v.string(),
    enabled: v.boolean(),
    updatedBy: v.id("staff"),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * One file in Creative Studio. The bytes behind `storageId` are never changed: a composition or a
   * generation is a new asset that points at its sources.
   */
  mediaAssets: defineTable({
    companyId: v.id("companies"),
    kind: v.union(v.literal("image"), v.literal("video"), v.literal("logo")),
    origin: assetOriginValidator,
    storageId: v.id("_storage"),
    contentType: v.string(),
    size: v.number(),
    label: v.string(),
    /** For a real job photo: the evidence it came from. The photo is the evidence's own bytes. */
    evidenceId: v.optional(v.id("evidence")),
    jobId: v.optional(v.id("jobs")),
    /** Assets this one was made from. */
    sources: v.optional(v.array(v.id("mediaAssets"))),
    /** A composition's layout, as data, so it can be checked and made again. */
    layout: v.optional(v.string()),
    /** A generation's job, provider, model and prompt. */
    generation: v.optional(v.object({ jobId: v.id("mediaJobs"), provider: v.string(), model: v.string(), prompt: v.string(), revisedPrompt: v.optional(v.string()), provenance: v.string() })),
    /** Permission to use a real job photo or footage in marketing. Required before it can be composed. */
    marketingPermission: v.optional(v.object({ by: v.id("members"), at: v.number(), note: v.string() })),
    /** Chosen for a campaign draft. Selecting is explicit and recorded. */
    selectedFor: v.optional(v.array(v.object({ artifactId: v.id("chatArtifacts"), by: v.id("members"), at: v.number() }))),
    createdBy: v.optional(v.id("members")),
    archivedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_company_evidence", ["companyId", "evidenceId"])
    .index("by_storage", ["storageId"]),

  /** A generation that runs on a provider. Durable: it survives refreshes, restarts and closed tabs. */
  mediaJobs: defineTable({
    companyId: v.id("companies"),
    requestedBy: v.id("members"),
    kind: v.union(v.literal("image_generate"), v.literal("image_edit"), v.literal("video_generate")),
    capability: capabilityValidator,
    provider: v.string(),
    model: v.string(),
    prompt: v.string(),
    promptVersion: v.number(),
    sources: v.array(v.id("mediaAssets")),
    params: v.string(),
    state: jobStateValidator,
    /** The provider's id for the request, saved before polling, so a job is reconciled and never sent twice. */
    providerRef: v.optional(v.string()),
    attempts: v.number(),
    /** What was set aside from the month's allowance, and whether it has been settled. */
    reserved: v.object({ images: v.number(), videos: v.number() }),
    settled: v.boolean(),
    outputs: v.array(v.id("mediaAssets")),
    /** Plain words for a person; never a provider's raw response. */
    error: v.optional(v.string()),
    errorKind: v.optional(v.string()),
    /** Set when a person asks to stop. The provider may still finish and bill; the job says so. */
    cancelRequestedAt: v.optional(v.number()),
    heartbeatAt: v.number(),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_company_created", ["companyId", "createdAt"])
    .index("by_state_heartbeat", ["state", "heartbeatAt"]),

  /** Generations used and set aside per company per month. Changed only in mutations, so it is never oversold. */
  mediaAllowances: defineTable({
    companyId: v.id("companies"),
    month: v.string(),
    imagesUsed: v.number(),
    imagesReserved: v.number(),
    videosUsed: v.number(),
    videosReserved: v.number(),
  }).index("by_company_month", ["companyId", "month"]),

  /**
   * Passages for company knowledge search. `audience` is who may find it: "company:<company id>" for
   * confirmed company knowledge, "member:<member id>" for a member's own drafts (a member belongs to one
   * company). Search filters on it before anything is read, and the source is read again before a
   * passage is shown.
   */
  knowledgeChunks: defineTable({
    companyId: v.id("companies"),
    audience: v.string(),
    source: v.union(v.object({ kind: v.literal("knowledge"), id: v.id("companyKnowledge") }), v.object({ kind: v.literal("artifact"), id: v.id("chatArtifacts"), version: v.number() })),
    sourceKey: v.string(),
    position: v.number(),
    text: v.string(),
    embedding: v.array(v.float64()),
    model: v.string(),
    createdAt: v.number(),
  })
    .index("by_company_source", ["companyId", "sourceKey"])
    .vectorIndex("by_embedding", { vectorField: "embedding", dimensions: 1536, filterFields: ["companyId", "audience"] }),
};
