/**
 * Queueing Retention's background work. A run is named by a key, so the same event delivered twice, a
 * webhook replayed or a schedule that fires again finds the first and queues nothing. The work itself is
 * in convex/retentionWork.ts.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { AGENT_PROFILES } from "../departments";

type RunKind = Doc<"retentionRuns">["kind"];

/** Queues one piece of work once. Asked again with the same key, nothing is queued. */
export async function enqueueRun(ctx: MutationCtx, input: { companyId: Id<"companies">; kind: RunKind; key: string; jobId?: Id<"jobs">; customerId?: Id<"customers">; caseId?: Id<"retentionCases">; payload?: string }): Promise<Id<"retentionRuns"> | null> {
  // Until Retention's workflow is released, nothing is queued in its name.
  if (!AGENT_PROFILES.retention.built) return null;
  const existing = await ctx.db
    .query("retentionRuns")
    .withIndex("by_company_key", (q) => q.eq("companyId", input.companyId).eq("key", input.key))
    .first();
  if (existing) return null;
  const runId = await ctx.db.insert("retentionRuns", { companyId: input.companyId, kind: input.kind, key: input.key, status: "queued", attempts: 0, jobId: input.jobId, customerId: input.customerId, caseId: input.caseId, payload: input.payload?.slice(0, 2000), queuedAt: Date.now() });
  if (input.kind === "diagnose") await ctx.scheduler.runAfter(0, internal.retentionWork.diagnose, { runId });
  else await ctx.scheduler.runAfter(0, internal.retentionWork.run, { runId });
  return runId;
}

