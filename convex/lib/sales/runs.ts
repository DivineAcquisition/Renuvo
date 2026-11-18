/**
 * Starting a run of the Sales workflow. A run is a row first (queued), so it survives a restart and can
 * be found, retried or shown; the work itself is convex/salesAgent.ts. `key` names the event that
 * started it, so the same inquiry, reply or reminder never starts two.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Trigger } from "./agentSchema";

export async function runByKey(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, key: string): Promise<Doc<"salesRuns"> | null> {
  return ctx.db
    .query("salesRuns")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .first();
}

export async function enqueueRun(ctx: MutationCtx, opportunity: Pick<Doc<"salesOpportunities">, "_id" | "companyId">, input: { trigger: Trigger; key: string; messageId?: Id<"salesMessages">; followUpId?: Id<"salesFollowUps">; delayMs?: number }): Promise<Id<"salesRuns"> | null> {
  if (await runByKey(ctx, opportunity.companyId, input.key)) return null;
  const runId = await ctx.db.insert("salesRuns", { companyId: opportunity.companyId, opportunityId: opportunity._id, trigger: input.trigger, key: input.key.slice(0, 300), status: "queued", steps: [], attempt: 0, createdAt: Date.now() });
  await ctx.scheduler.runAfter(input.delayMs ?? 0, internal.salesAgent.run, { runId, messageId: input.messageId, followUpId: input.followUpId });
  return runId;
}

/** Whether Sales is working on this opportunity right now, from the record. A screen shows "working" only when this is true. */
export async function activeRun(ctx: QueryCtx | MutationCtx, opportunity: Pick<Doc<"salesOpportunities">, "_id" | "companyId">): Promise<Doc<"salesRuns"> | null> {
  const rows = await ctx.db
    .query("salesRuns")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .order("desc")
    .take(5);
  return rows.find((row) => row.status === "queued" || row.status === "running") ?? null;
}
