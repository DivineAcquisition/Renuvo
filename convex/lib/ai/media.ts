/**
 * Creative Studio's rules for assets and generation jobs, used by the Creative Studio screens
 * (convex/creative.ts) and by chat (the Marketing tool) alike, so both create the same records.
 *
 * Two paths stay separate:
 *  - Real-job creatives use the company's own photos and footage, unchanged. They are composed by code
 *    (side by side, captions, logo, offer) and never sent to a generator: an edited photo is no longer
 *    evidence of the work.
 *  - Generated creatives come from a model and are labelled as generated, with their prompt, model and
 *    provenance, wherever they are shown.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { featureVerdict } from "../billing/access";
import { openExecution } from "../billing/executions";
import { notFound, userError } from "../errors";
import { recordEvent } from "../events";
import { text } from "../text";
import { resolve, type Capability, type Override } from "./registry";
import { reserve } from "./usage";

export type GenerationKind = "image_generate" | "image_edit" | "video_generate";
export type GenerationParams = { size?: "1024x1024" | "1536x1024" | "1024x1536"; quality?: "low" | "medium" | "high"; n?: number; fast?: boolean; aspectRatio?: "16:9" | "9:16"; durationSeconds?: number };

const SIZES = ["1024x1024", "1536x1024", "1024x1536"];
const DURATIONS = [4, 6, 8, 10];

export async function settingFor(ctx: QueryCtx | MutationCtx, capability: Capability): Promise<Override | null> {
  const row = await ctx.db
    .query("aiSettings")
    .withIndex("by_capability", (q) => q.eq("capability", capability))
    .unique();
  return row ? { enabled: row.enabled, evaluation: row.evaluation } : null;
}

export function featureOn(company: Doc<"companies">, kind: GenerationKind | "photoReview" | "documentSearch"): boolean {
  const features = company.aiFeatures ?? {};
  if (kind === "photoReview") return features.photoReview !== false;
  if (kind === "documentSearch") return features.documentSearch !== false;
  return kind === "video_generate" ? features.videoGeneration !== false : features.imageGeneration !== false;
}

export async function ownedAsset(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, assetId: string): Promise<Doc<"mediaAssets">> {
  const id = ctx.db.normalizeId("mediaAssets", assetId);
  const asset = id ? await ctx.db.get(id) : null;
  if (!asset || asset.companyId !== companyId || asset.archivedAt) notFound();
  return asset;
}

/** A real job photo, footage or anything composed from one: never sent to a generator. */
export async function isRealWork(ctx: QueryCtx | MutationCtx, asset: Doc<"mediaAssets">, depth = 0): Promise<boolean> {
  if (asset.origin === "original") return asset.kind !== "logo";
  if (asset.origin === "generated" || depth > 5) return false;
  for (const sourceId of asset.sources ?? []) {
    const source = await ctx.db.get(sourceId);
    if (source && (await isRealWork(ctx, source, depth + 1))) return true;
  }
  return false;
}

export function checkedParams(kind: GenerationKind, params: GenerationParams): GenerationParams {
  if (kind === "video_generate") {
    const aspectRatio = params.aspectRatio ?? "16:9";
    const durationSeconds = params.durationSeconds ?? 6;
    if (aspectRatio !== "16:9" && aspectRatio !== "9:16") throw userError("A video is 16:9 or 9:16.");
    if (!DURATIONS.includes(durationSeconds)) throw userError(`A video can be ${DURATIONS.join(", ")} seconds.`);
    return { aspectRatio, durationSeconds };
  }
  const size = params.size ?? "1024x1024";
  if (!SIZES.includes(size)) throw userError(`An image can be ${SIZES.join(", ")}.`);
  const n = params.n ?? 1;
  if (!Number.isInteger(n) || n < 1 || n > 4) throw userError("Ask for one to four images at a time.");
  const quality = params.quality ?? "high";
  if (!["low", "medium", "high"].includes(quality)) throw userError("Quality is low, medium or high.");
  return { size, n, quality, fast: Boolean(params.fast) && kind === "image_generate" };
}

export function capabilityFor(kind: GenerationKind, params: GenerationParams): Capability {
  if (kind === "video_generate") return "video_generate";
  if (kind === "image_edit") return "image_edit";
  return params.fast ? "image_fast" : "image_generate";
}

/**
 * Sets aside the allowance and queues one generation. Nothing reaches a provider here; the job runs in
 * internal.media.run. Refused when the feature is off, the capability is not ready, the allowance is used,
 * or a source is real work.
 */
export async function queueGeneration(
  ctx: MutationCtx,
  input: { company: Doc<"companies">; member: Doc<"members">; kind: GenerationKind; prompt: string; sources: string[]; params: GenerationParams; promptVersion?: number },
): Promise<Id<"mediaJobs">> {
  // Creative Studio is Expand's. Before the plan is known here, the credit hold decides, after reading it from billing.
  const studio = featureVerdict(input.company, "creative_studio");
  if (!studio.ok && (studio.block !== "plan" || input.company.plan !== undefined)) throw userError(studio.message, "limit");
  if (!featureOn(input.company, input.kind)) throw userError(input.kind === "video_generate" ? "The Owner has switched video generation off for this company." : "The Owner has switched image generation off for this company.", "not_allowed");
  const prompt = text(input.prompt, "The prompt", 4000);
  const params = checkedParams(input.kind, input.params);
  if (input.sources.length > 4) throw userError("Use at most four source images.");
  const sources: Id<"mediaAssets">[] = [];
  for (const sourceId of input.sources) {
    const asset = await ownedAsset(ctx, input.company._id, sourceId);
    if (asset.kind === "video") throw userError("A video cannot be a source for this generation.");
    if (await isRealWork(ctx, asset)) throw userError(`"${asset.label}" is a real job photo. Real work is never sent to an image generator; compose it instead, so it stays exactly as it was.`);
    sources.push(asset._id);
  }
  if (input.kind === "image_edit" && sources.length === 0) throw userError("Choose the image to edit.");
  // Selestial's own rules first; then whether a provider can take it.
  const capability = capabilityFor(input.kind, params);
  const resolved = resolve(capability, await settingFor(ctx, capability));
  if (!resolved.ready) throw userError(resolved.words, "not_allowed");
  const want = input.kind === "video_generate" ? { images: 0, videos: 1 } : { images: params.n ?? 1, videos: 0 };
  await reserve(ctx, input.company, want);
  const now = Date.now();
  const jobId = await ctx.db.insert("mediaJobs", {
    companyId: input.company._id,
    requestedBy: input.member._id,
    kind: input.kind,
    capability,
    provider: resolved.model.provider,
    model: resolved.model.model,
    prompt,
    promptVersion: input.promptVersion ?? 1,
    sources,
    params: JSON.stringify(params),
    state: "queued",
    attempts: 0,
    reserved: want,
    settled: false,
    outputs: [],
    heartbeatAt: now,
    createdAt: now,
  });
  // Paid with Selestial Credits, per image or video delivered. Refused here, nothing is queued.
  const opened = await openExecution(ctx, { company: input.company, key: `media:${jobId}`, agent: "studio", feature: "creative_studio", task: input.kind === "video_generate" ? "video_generation" : input.kind === "image_edit" ? "image_edit" : "image_generation", units: want.images + want.videos, autonomous: false, memberId: input.member._id, source: { table: "mediaJobs", id: jobId } });
  if (!opened.ok) throw userError(opened.message, "limit");
  await ctx.db.patch(jobId, { executionId: opened.executionId });
  await recordEvent(ctx, { companyId: input.company._id, type: "media_job.queued", actor: { kind: "member", memberId: input.member._id }, subject: { table: "mediaJobs", id: jobId }, data: { kind: input.kind, model: resolved.model.model } });
  await ctx.scheduler.runAfter(0, internal.media.run, { jobId });
  return jobId;
}
