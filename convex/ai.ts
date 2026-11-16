/**
 * What a company sees and decides about AI (Settings › AI & usage). Everyone reads; only the Owner
 * switches features off and on. Provider keys and model choices are Selestial's, never a company's.
 */
import { v } from "convex/values";

import { companyQuery, ownerMutation } from "./lib/builders";
import { featureOn, settingFor } from "./lib/ai/media";
import { CAPABILITIES, PROVIDER_NAMES, REGISTRY, resolve } from "./lib/ai/registry";
import { allowanceRow, mediaAllowance, monthKey } from "./lib/ai/usage";
import { monthlyRunAllowance, monthOf, planOf, usageRow } from "./lib/chat/state";
import { byMember, recordEvent } from "./lib/events";

export const overview = companyQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const monthStart = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    const capabilities = [];
    for (const capability of CAPABILITIES) {
      const entry = REGISTRY[capability];
      const resolved = resolve(capability, await settingFor(ctx, capability));
      capabilities.push({
        capability,
        label: entry.label,
        provider: PROVIDER_NAMES[entry.primary.provider],
        model: entry.implemented ? entry.primary.model : null,
        optional: entry.optional,
        state: resolved.ready ? ("ready" as const) : resolved.reason,
        words: resolved.ready ? null : resolved.words,
        dataNote: entry.dataNote,
      });
    }
    const rows = await ctx.db
      .query("aiUsage")
      .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId).gte("at", monthStart))
      .take(5000);
    const byFeature = new Map<string, { calls: number; inputTokens: number; outputTokens: number; images: number; videoSeconds: number; knownMicros: number; unknownCost: number; errors: number }>();
    for (const row of rows) {
      const current = byFeature.get(row.feature) ?? { calls: 0, inputTokens: 0, outputTokens: 0, images: 0, videoSeconds: 0, knownMicros: 0, unknownCost: 0, errors: 0 };
      current.calls += 1;
      current.inputTokens += row.units.inputTokens ?? 0;
      current.outputTokens += row.units.outputTokens ?? 0;
      current.images += row.units.images ?? 0;
      current.videoSeconds += row.units.videoSeconds ?? 0;
      const cost = row.reconciledMicros ?? row.estimatedMicros;
      if (cost === null || cost === undefined) current.unknownCost += row.outcome === "ok" ? 1 : 0;
      else current.knownMicros += cost;
      if (row.outcome !== "ok") current.errors += 1;
      byFeature.set(row.feature, current);
    }
    const chat = await usageRow(ctx, ctx.companyId, monthOf(now));
    const media = await allowanceRow(ctx, ctx.companyId, monthKey(now));
    const limits = mediaAllowance(ctx.company);
    return {
      plan: planOf(ctx.company),
      month: monthKey(now),
      allowances: {
        chat: { used: chat?.runs ?? 0, limit: monthlyRunAllowance(ctx.company) },
        images: { used: (media?.imagesUsed ?? 0) + (media?.imagesReserved ?? 0), limit: limits.images },
        videos: { used: (media?.videosUsed ?? 0) + (media?.videosReserved ?? 0), limit: limits.videos },
      },
      features: {
        imageGeneration: featureOn(ctx.company, "image_generate"),
        videoGeneration: featureOn(ctx.company, "video_generate"),
        photoReview: featureOn(ctx.company, "photoReview"),
        documentSearch: featureOn(ctx.company, "documentSearch"),
        otherChatModels: ctx.company.aiFeatures?.otherChatModels !== false,
      },
      usage: [...byFeature.entries()].map(([feature, row]) => ({ feature, ...row })),
      truncated: rows.length === 5000,
      capabilities,
      canChange: ctx.role === "owner",
    };
  },
});

/** The Owner switches AI features off or back on for the company. Allowances are the plan's. */
export const setFeatures = ownerMutation({
  args: { imageGeneration: v.boolean(), videoGeneration: v.boolean(), photoReview: v.boolean(), documentSearch: v.boolean(), otherChatModels: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const otherChatModels = args.otherChatModels ?? ctx.company.aiFeatures?.otherChatModels;
    await ctx.db.patch(ctx.companyId, { aiFeatures: { ...args, otherChatModels } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "company.ai_features_changed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { imageGeneration: args.imageGeneration, videoGeneration: args.videoGeneration, photoReview: args.photoReview, documentSearch: args.documentSearch, otherChatModels: otherChatModels !== false } });
    return null;
  },
});
