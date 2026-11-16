/** Splitting text into passages, and searching the company knowledge index (convex/knowledge.ts). */
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { embed } from "./openai";
import { resolve } from "./registry";

const CHUNK = 1200;

export function chunks(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n{2,}/)) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if ((current + "\n\n" + piece).length > CHUNK && current) {
      out.push(current);
      current = "";
    }
    if (piece.length > CHUNK) {
      for (let index = 0; index < piece.length; index += CHUNK) out.push(piece.slice(index, index + CHUNK));
    } else current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) out.push(current);
  return out.slice(0, 200);
}

/** Searches only what this member may read in this company. Used by chat's document search. */
export async function searchKnowledge(ctx: ActionCtx, input: { companyId: Id<"companies">; memberId: Id<"members">; query: string }) {
  const resolved = resolve("embed");
  if (!resolved.ready) return { ok: false as const, why: `Document search needs ${resolved.words.replace(/^.*needs /, "")}` };
  const { vectors, inputTokens } = await embed(resolved.model, [input.query.slice(0, 2000)]);
  const company = `company:${input.companyId}`;
  const member = `member:${input.memberId}`;
  const hits = await ctx.vectorSearch("knowledgeChunks", "by_embedding", { vector: vectors[0], limit: 8, filter: (q) => q.or(q.eq("audience", company), q.eq("audience", member)) });
  const found = await ctx.runQuery(internal.knowledge.passages, { ids: hits.map((hit) => hit._id), companyId: input.companyId, memberId: input.memberId });
  return { ok: true as const, passages: found, inputTokens, model: resolved.model };
}

