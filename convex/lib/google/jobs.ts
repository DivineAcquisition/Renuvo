/**
 * Queueing Google work. Each intended effect has one key; queueing it again finds the first job. A job
 * that is done is never redone; a job that failed or was cancelled can be queued again on purpose.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export const MAX_ATTEMPTS = 5;

/** Exponential backoff with a cap: 30s, 2m, 8m, 32m, then 2h. */
export function backoff(attempt: number, retryAfterMs?: number): number {
  const base = Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 2 * 60 * 60 * 1000);
  return Math.max(base, retryAfterMs ?? 0);
}

export async function enqueue(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; connectionId?: Id<"googleConnections">; kind: Doc<"googleJobs">["kind"]; key: string; payload: Record<string, unknown>; requestedBy?: Id<"members">; at?: number; again?: boolean },
): Promise<{ jobId: Id<"googleJobs">; repeated: boolean; status: Doc<"googleJobs">["status"] }> {
  const existing = await ctx.db.query("googleJobs").withIndex("by_company_key", (q) => q.eq("companyId", input.companyId).eq("key", input.key)).first();
  if (existing && (existing.status !== "failed" && existing.status !== "cancelled")) return { jobId: existing._id, repeated: true, status: existing.status };
  if (existing && !input.again) return { jobId: existing._id, repeated: true, status: existing.status };
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { status: "queued", attempts: 0, nextAt: input.at ?? now, payload: JSON.stringify(input.payload), lastError: undefined, updatedAt: now });
    return { jobId: existing._id, repeated: false, status: "queued" };
  }
  const jobId = await ctx.db.insert("googleJobs", { companyId: input.companyId, connectionId: input.connectionId, kind: input.kind, key: input.key, status: "queued", payload: JSON.stringify(input.payload), attempts: 0, nextAt: input.at ?? now, requestedBy: input.requestedBy, createdAt: now, updatedAt: now });
  return { jobId, repeated: false, status: "queued" };
}
