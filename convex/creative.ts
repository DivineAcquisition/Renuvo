/**
 * Creative Studio (docs/ai/00-architecture.md, "Creative Studio"). Company-scoped like every other
 * record. Anyone in the company can see the library; Owners and Managers decide what may be used in
 * marketing and spend generation allowance.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { companyMutation, companyQuery, managerMutation } from "./lib/builders";
import { featureOn, isRealWork, ownedAsset, queueGeneration } from "./lib/ai/media";
import { allowanceRow, mediaAllowance, monthKey } from "./lib/ai/usage";
import { readableArtifact } from "./lib/chat/artifacts";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { text } from "./lib/text";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const IMAGE_MAX = 20 * 1024 * 1024;
const VIDEO_MAX = 200 * 1024 * 1024;

const sizeParams = v.object({
  size: v.optional(v.union(v.literal("1024x1024"), v.literal("1536x1024"), v.literal("1024x1536"))),
  quality: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
  n: v.optional(v.number()),
  fast: v.optional(v.boolean()),
  aspectRatio: v.optional(v.union(v.literal("16:9"), v.literal("9:16"))),
  durationSeconds: v.optional(v.number()),
});

export const library = companyQuery({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("mediaAssets")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .filter((q) => q.eq(q.field("archivedAt"), undefined))
      .paginate(args.paginationOpts);
    const rows = [];
    for (const asset of page.page) {
      rows.push({
        assetId: asset._id,
        kind: asset.kind,
        origin: asset.origin,
        realWork: await isRealWork(ctx, asset),
        label: asset.label,
        contentType: asset.contentType,
        url: await ctx.storage.getUrl(asset.storageId),
        jobId: asset.jobId ?? null,
        marketingPermission: asset.marketingPermission ? { at: asset.marketingPermission.at, note: asset.marketingPermission.note } : null,
        generation: asset.generation ? { model: asset.generation.model, provider: asset.generation.provider, prompt: asset.generation.prompt, provenance: asset.generation.provenance, jobId: asset.generation.jobId } : null,
        sources: asset.sources ?? [],
        selectedFor: (asset.selectedFor ?? []).map((row) => row.artifactId),
        createdAt: asset.createdAt,
      });
    }
    return { ...page, page: rows };
  },
});

export const jobs = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("mediaJobs")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(40);
    return rows.map((job) => ({ jobId: job._id, kind: job.kind, model: job.model, provider: job.provider, prompt: job.prompt, promptVersion: job.promptVersion, state: job.state, error: job.error ?? null, outputs: job.outputs, sources: job.sources, params: job.params, createdAt: job.createdAt, finishedAt: job.finishedAt ?? null, canCancel: job.state === "queued" || (job.state === "running" && job.kind === "video_generate") }));
  },
});

export const allowance = companyQuery({
  args: {},
  handler: async (ctx) => {
    const month = monthKey(Date.now());
    const row = await allowanceRow(ctx, ctx.companyId, month);
    const limit = mediaAllowance(ctx.company);
    return {
      month,
      images: { used: row?.imagesUsed ?? 0, reserved: row?.imagesReserved ?? 0, limit: limit.images },
      videos: { used: row?.videosUsed ?? 0, reserved: row?.videosReserved ?? 0, limit: limit.videos },
      imageGeneration: featureOn(ctx.company, "image_generate"),
      videoGeneration: featureOn(ctx.company, "video_generate"),
      canSpend: ctx.role !== "office",
    };
  },
});

export const uploadUrl = companyMutation({
  args: {},
  handler: async (ctx) => {
    if (!(await allow(ctx, `creative.upload:${ctx.member._id}`, 60, 10 * 60_000))) throw userError("Too many uploads in a few minutes. Wait a moment.", "limit");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * An uploaded photo, video or logo. "original" files are kept exactly as uploaded. A composition is
 * registered with `composedFrom`, and its sources are checked: real work needs marketing permission.
 */
export const register = companyMutation({
  args: { storageId: v.id("_storage"), label: v.string(), kind: v.union(v.literal("image"), v.literal("video"), v.literal("logo")), composedFrom: v.optional(v.array(v.string())), layout: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const claimed = await ctx.db
      .query("mediaAssets")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (claimed) notFound();
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta) notFound();
    const type = (meta.contentType ?? "").toLowerCase();
    const isVideo = args.kind === "video";
    if (isVideo ? !VIDEO_TYPES.includes(type) : !IMAGE_TYPES.includes(type)) {
      await ctx.storage.delete(args.storageId);
      throw userError(isVideo ? "A video must be MP4, MOV or WebM." : "An image must be JPEG, PNG or WebP.");
    }
    if (meta.size > (isVideo ? VIDEO_MAX : IMAGE_MAX)) {
      await ctx.storage.delete(args.storageId);
      throw userError(isVideo ? "A video can be at most 200 MB." : "An image can be at most 20 MB.");
    }
    let sources: string[] | undefined;
    if (args.composedFrom) {
      if (args.composedFrom.length === 0 || args.composedFrom.length > 6) throw userError("A composition uses one to six assets.");
      sources = [];
      for (const sourceId of args.composedFrom) {
        const source = await ownedAsset(ctx, ctx.companyId, sourceId);
        if ((await isRealWork(ctx, source)) && source.origin === "original" && !source.marketingPermission) throw userError(`"${source.label}" is a real job photo without permission to use it in marketing. An Owner or Manager records that permission first.`, "not_allowed");
        sources.push(source._id);
      }
      if (args.layout && args.layout.length > 4000) throw userError("The layout is too long.");
    }
    const assetId = await ctx.db.insert("mediaAssets", {
      companyId: ctx.companyId,
      kind: args.kind,
      origin: sources ? "composed" : "original",
      storageId: args.storageId,
      contentType: type,
      size: meta.size,
      label: text(args.label, "The name", 120),
      sources: sources as never,
      layout: sources ? args.layout : undefined,
      createdBy: ctx.member._id,
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: sources ? "media_asset.composed" : "media_asset.uploaded", actor: byMember(ctx), subject: { table: "mediaAssets", id: assetId } });
    return assetId;
  },
});

/** Brings a visit's evidence photos into the library as real work. The photos themselves are not copied or changed. */
export const importJobPhotos = companyMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.companyId !== ctx.companyId) notFound();
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
      .take(60);
    let added = 0;
    for (const photo of evidence) {
      const existing = await ctx.db
        .query("mediaAssets")
        .withIndex("by_company_evidence", (q) => q.eq("companyId", ctx.companyId).eq("evidenceId", photo._id))
        .first();
      if (existing) continue;
      const meta = await ctx.db.system.get(photo.storageId);
      if (!meta) continue;
      await ctx.db.insert("mediaAssets", { companyId: ctx.companyId, kind: "image", origin: "original", storageId: photo.storageId, contentType: meta.contentType ?? "image/jpeg", size: meta.size, label: `${photo.kind === "before" ? "Before" : photo.kind === "after" ? "After" : "Job photo"} · ${job.serviceType}`, evidenceId: photo._id, jobId: job._id, createdBy: ctx.member._id, createdAt: Date.now() });
      added += 1;
    }
    return { added, found: evidence.length };
  },
});

/** Owners and Managers record that a real job photo or video may be used in marketing. */
export const grantMarketingPermission = managerMutation({
  args: { assetId: v.string(), note: v.string() },
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, ctx.companyId, args.assetId);
    if (asset.origin !== "original") throw userError("Permission is recorded on the original photo or video.");
    await ctx.db.patch(asset._id, { marketingPermission: { by: ctx.member._id, at: Date.now(), note: text(args.note, "How permission was given", 500) } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "media_asset.marketing_permission", actor: byMember(ctx), subject: { table: "mediaAssets", id: asset._id } });
    return null;
  },
});

/** A generation, reserved against the allowance and run by the media worker. */
export const generate = managerMutation({
  args: { kind: v.union(v.literal("image_generate"), v.literal("image_edit"), v.literal("video_generate")), prompt: v.string(), sources: v.optional(v.array(v.string())), params: sizeParams },
  handler: async (ctx, args) => queueGeneration(ctx, { company: ctx.company, member: ctx.member, kind: args.kind, prompt: args.prompt, sources: args.sources ?? [], params: args.params }),
});

/** Another try with the same prompt and settings, as a new job. Nothing it made before is replaced. */
export const regenerate = managerMutation({
  args: { jobId: v.id("mediaJobs"), prompt: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.companyId !== ctx.companyId) notFound();
    const prompt = args.prompt?.trim() ? args.prompt : job.prompt;
    return queueGeneration(ctx, { company: ctx.company, member: ctx.member, kind: job.kind, prompt, sources: job.sources, params: JSON.parse(job.params), promptVersion: prompt === job.prompt ? job.promptVersion : job.promptVersion + 1 });
  },
});

/** Stop a job. A queued job never starts; a running video stops being followed, and the provider may still bill it. */
export const cancel = managerMutation({
  args: { jobId: v.id("mediaJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.companyId !== ctx.companyId) notFound();
    if (job.state !== "queued" && job.state !== "running") throw userError("This job has already finished.");
    if (job.state === "running" && job.kind !== "video_generate") throw userError("An image request cannot be stopped once it is with the provider. It will finish in a moment.");
    await ctx.db.patch(job._id, { state: "cancel_requested", cancelRequestedAt: Date.now() });
    return { note: job.state === "queued" ? "Stopped before anything was sent." : "Selestial will stop waiting. The provider may still finish and bill it." };
  },
});

/** Choose an asset for one of your campaign drafts. Explicit and recorded; nothing is published. */
export const selectForCampaign = managerMutation({
  args: { assetId: v.string(), artifactId: v.string() },
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, ctx.companyId, args.assetId);
    const artifact = await readableArtifact(ctx, ctx.companyId, ctx.member._id, args.artifactId);
    if ((await isRealWork(ctx, asset)) && !(asset.origin === "original" ? asset.marketingPermission : true)) throw userError("This real job photo has no marketing permission yet.", "not_allowed");
    const selected = (asset.selectedFor ?? []).filter((row) => row.artifactId !== artifact._id);
    await ctx.db.patch(asset._id, { selectedFor: [...selected, { artifactId: artifact._id, by: ctx.member._id, at: Date.now() }] });
    return null;
  },
});

/** Archive hides an asset from the library. Its file is kept, because compositions and campaigns may point at it. */
export const archive = managerMutation({
  args: { assetId: v.string() },
  handler: async (ctx, args) => {
    const asset = await ownedAsset(ctx, ctx.companyId, args.assetId);
    await ctx.db.patch(asset._id, { archivedAt: Date.now() });
    return null;
  },
});
