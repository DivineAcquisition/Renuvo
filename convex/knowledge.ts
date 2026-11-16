/**
 * The company knowledge search index. Internal only. It holds passages of confirmed company knowledge
 * (findable by everyone in the company) and of each member's own drafts (findable by that member only),
 * as embeddings. It is an index, never the truth: before a passage is shown, its source is read again
 * and must still be confirmed, or still be that member's draft.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { chunks } from "./lib/ai/knowledge";
import { AiError } from "./lib/ai/errors";
import { embed } from "./lib/ai/openai";
import { resolve } from "./lib/ai/registry";
import { recordUsage } from "./lib/ai/usage";

type Source = { kind: "knowledge"; id: Id<"companyKnowledge"> } | { kind: "artifact"; id: Id<"chatArtifacts"> };

/** What a source says now, and who may find it. Null when it should not be in the index. */
export const sourceText = internalQuery({
  args: { kind: v.union(v.literal("knowledge"), v.literal("artifact")), id: v.string() },
  handler: async (ctx, args) => {
    if (args.kind === "knowledge") {
      const id = ctx.db.normalizeId("companyKnowledge", args.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.status !== "confirmed") return null;
      return { companyId: row.companyId, audience: `company:${row.companyId}`, text: row.text, version: 0, memberId: null };
    }
    const id = ctx.db.normalizeId("chatArtifacts", args.id);
    const artifact = id ? await ctx.db.get(id) : null;
    if (!artifact) return null;
    const version = await ctx.db
      .query("chatArtifactVersions")
      .withIndex("by_company_artifact_version", (q) => q.eq("companyId", artifact.companyId).eq("artifactId", artifact._id).eq("version", artifact.currentVersion))
      .unique();
    if (!version) return null;
    return { companyId: artifact.companyId, audience: `member:${artifact.createdBy}`, text: `${artifact.title}\n\n${version.content}`, version: artifact.currentVersion, memberId: artifact.createdBy };
  },
});

export const replace = internalMutation({
  args: {
    sourceKey: v.string(),
    companyId: v.id("companies"),
    audience: v.string(),
    source: v.union(v.object({ kind: v.literal("knowledge"), id: v.id("companyKnowledge") }), v.object({ kind: v.literal("artifact"), id: v.id("chatArtifacts"), version: v.number() })),
    passages: v.array(v.object({ text: v.string(), embedding: v.array(v.float64()) })),
    model: v.string(),
    inputTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_company_source", (q) => q.eq("companyId", args.companyId).eq("sourceKey", args.sourceKey))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    for (const [position, passage] of args.passages.entries()) {
      await ctx.db.insert("knowledgeChunks", { companyId: args.companyId, audience: args.audience, source: args.source, sourceKey: args.sourceKey, position, text: passage.text, embedding: passage.embedding, model: args.model, createdAt: Date.now() });
    }
    if (args.passages.length) await recordUsage(ctx, { companyId: args.companyId, feature: "embed", capability: "embed", model: resolveModel(), units: { inputTokens: args.inputTokens }, outcome: "ok" });
    return null;
  },
});

const resolveModel = () => {
  const resolved = resolve("embed");
  return resolved.ready ? resolved.model : resolved.entry.primary;
};

export const remove = internalMutation({
  args: { companyId: v.id("companies"), sourceKey: v.string() },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("knowledgeChunks")
      .withIndex("by_company_source", (q) => q.eq("companyId", args.companyId).eq("sourceKey", args.sourceKey))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    return null;
  },
});

/** (Re)indexes one source. Does nothing, quietly, when embeddings are not connected. */
export const index = internalAction({
  args: { kind: v.union(v.literal("knowledge"), v.literal("artifact")), id: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const resolved = resolve("embed");
    if (!resolved.ready) return null;
    const current = await ctx.runQuery(internal.knowledge.sourceText, args);
    const sourceKey = `${args.kind}:${args.id}`;
    if (!current) return null;
    const passages = chunks(current.text);
    try {
      const vectors: number[][] = [];
      let inputTokens = 0;
      for (let start = 0; start < passages.length; start += 64) {
        const batch = await embed(resolved.model, passages.slice(start, start + 64));
        vectors.push(...batch.vectors);
        inputTokens += batch.inputTokens;
      }
      const source = args.kind === "knowledge" ? { kind: "knowledge" as const, id: args.id as Id<"companyKnowledge"> } : { kind: "artifact" as const, id: args.id as Id<"chatArtifacts">, version: current.version };
      await ctx.runMutation(internal.knowledge.replace, { sourceKey, companyId: current.companyId, audience: current.audience, source, passages: passages.map((text, i) => ({ text, embedding: vectors[i] })), model: resolved.model.model, inputTokens });
    } catch (error) {
      // The index is best effort: the source itself is unchanged and still readable.
      if (!(error instanceof AiError)) throw error;
    }
    return null;
  },
});

export const passages = internalQuery({
  args: { ids: v.array(v.id("knowledgeChunks")), companyId: v.id("companies"), memberId: v.id("members") },
  handler: async (ctx, args) => {
    const out = [];
    for (const id of args.ids) {
      const chunk = await ctx.db.get(id);
      if (!chunk || chunk.companyId !== args.companyId) continue;
      if (chunk.audience !== `company:${args.companyId}` && chunk.audience !== `member:${args.memberId}`) continue;
      // The source, read again now: still confirmed, or still this member's draft.
      if (chunk.source.kind === "knowledge") {
        const row = await ctx.db.get(chunk.source.id);
        if (!row || row.status !== "confirmed" || row.companyId !== args.companyId) continue;
        out.push({ text: chunk.text, source: { kind: "knowledge" as const, label: "Confirmed company knowledge" } });
      } else {
        const artifact: Doc<"chatArtifacts"> | null = await ctx.db.get(chunk.source.id);
        if (!artifact || artifact.companyId !== args.companyId || artifact.createdBy !== args.memberId) continue;
        out.push({ text: chunk.text, source: { kind: "artifact" as const, label: `Draft "${artifact.title}" version ${chunk.source.version}${chunk.source.version < artifact.currentVersion ? ` (now at version ${artifact.currentVersion}; read the draft for the latest)` : ""}`, artifactId: artifact._id } });
      }
    }
    return out;
  },
});

export type { Source };
