/** Recording what each model call used, and the generation allowances per plan. */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { userError } from "../errors";
import { estimateMicros, type Capability, type ModelEntry } from "./registry";
import type { Feature } from "./schema";

export type UsageInput = {
  companyId: Id<"companies">;
  memberId?: Id<"members">;
  feature: Feature;
  capability: Capability;
  model: Pick<ModelEntry, "provider" | "model" | "rates">;
  runId?: Id<"chatRuns">;
  jobId?: Id<"mediaJobs">;
  units: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; images?: number; videoSeconds?: number; resolution?: string };
  raw?: unknown;
  reconciledMicros?: number;
  outcome: "ok" | "error" | "uncertain";
  errorKind?: string;
};

export async function recordUsage(ctx: MutationCtx, input: UsageInput): Promise<Id<"aiUsage">> {
  const tokenEstimate = input.units.inputTokens !== undefined || input.units.outputTokens !== undefined ? estimateMicros(input.model as ModelEntry, input.units) : null;
  const perImage = input.model.rates.perImage;
  const perSecond = input.model.rates.perVideoSecond;
  const mediaEstimate = input.units.images ? (perImage == null ? null : Math.round(input.units.images * perImage * 1e6)) : input.units.videoSeconds ? (perSecond == null ? null : Math.round(input.units.videoSeconds * perSecond * 1e6)) : null;
  return ctx.db.insert("aiUsage", {
    companyId: input.companyId,
    memberId: input.memberId,
    feature: input.feature,
    capability: input.capability,
    provider: input.model.provider,
    model: input.model.model,
    runId: input.runId,
    jobId: input.jobId,
    units: input.units,
    estimatedMicros: tokenEstimate ?? mediaEstimate,
    reconciledMicros: input.reconciledMicros,
    raw: input.raw === undefined ? undefined : JSON.stringify(input.raw).slice(0, 4000),
    outcome: input.outcome,
    errorKind: input.errorKind,
    at: Date.now(),
  });
}

/**
 * A monthly ceiling on generations per company, to bound provider cost. Each generation is paid for with
 * Selestial Credits (convex/lib/billing), and Creative Studio itself is Expand's; this ceiling only stops
 * runaway use. MEDIA_IMAGES_PER_MONTH / MEDIA_VIDEOS_PER_MONTH override it.
 */
export const MEDIA_PER_MONTH = { images: 150, videos: 15 } as const;

export function mediaAllowance(): { images: number; videos: number } {
  const plan = MEDIA_PER_MONTH;
  const images = Number(process.env.MEDIA_IMAGES_PER_MONTH);
  const videos = Number(process.env.MEDIA_VIDEOS_PER_MONTH);
  return { images: Number.isInteger(images) && images >= 0 ? images : plan.images, videos: Number.isInteger(videos) && videos >= 0 ? videos : plan.videos };
}

export const monthKey = (at: number) => new Date(at).toISOString().slice(0, 7);

export async function allowanceRow(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, month: string) {
  return ctx.db
    .query("mediaAllowances")
    .withIndex("by_company_month", (q) => q.eq("companyId", companyId).eq("month", month))
    .unique();
}

/**
 * Sets aside generations before any provider is called. A mutation is one transaction, so two requests
 * at the limit cannot both get the last one.
 */
export async function reserve(ctx: MutationCtx, company: Doc<"companies">, want: { images: number; videos: number }): Promise<{ month: string }> {
  const month = monthKey(Date.now());
  const limit = mediaAllowance();
  const row = await allowanceRow(ctx, company._id, month);
  const used = { images: (row?.imagesUsed ?? 0) + (row?.imagesReserved ?? 0), videos: (row?.videosUsed ?? 0) + (row?.videosReserved ?? 0) };
  if (want.images && used.images + want.images > limit.images) throw userError(`This company has used this month's ${limit.images} image generations.`, "limit");
  if (want.videos && used.videos + want.videos > limit.videos) throw userError(`This company has used this month's ${limit.videos} video generations.`, "limit");
  if (row) await ctx.db.patch(row._id, { imagesReserved: row.imagesReserved + want.images, videosReserved: row.videosReserved + want.videos });
  else await ctx.db.insert("mediaAllowances", { companyId: company._id, month, imagesUsed: 0, imagesReserved: want.images, videosUsed: 0, videosReserved: want.videos });
  return { month };
}

/**
 * Settles a reservation: what the provider may have billed counts as used; the rest goes back. A job
 * whose outcome is uncertain counts as used, because the provider may have charged for it.
 */
export async function settle(ctx: MutationCtx, job: Doc<"mediaJobs">, used: { images: number; videos: number }) {
  if (job.settled) return;
  const row = await allowanceRow(ctx, job.companyId, monthKey(job.createdAt));
  if (row) {
    await ctx.db.patch(row._id, {
      imagesReserved: Math.max(0, row.imagesReserved - job.reserved.images),
      videosReserved: Math.max(0, row.videosReserved - job.reserved.videos),
      imagesUsed: row.imagesUsed + used.images,
      videosUsed: row.videosUsed + used.videos,
    });
  }
  await ctx.db.patch(job._id, { settled: true });
}
