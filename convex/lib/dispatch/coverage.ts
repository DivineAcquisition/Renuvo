/**
 * A coverage request is the record that a slot lost its cleaner and has to be filled again. It exists so
 * the loss is never silent: it is open until a cleaner accepts the slot, or it is unresolved and a
 * person has it with what was tried, what is left and by when to decide. One per lost assignment.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import type { CoverageCause } from "../statuses";

export async function jobCoverageRequests(ctx: QueryCtx | MutationCtx, job: Pick<Doc<"jobs">, "_id" | "companyId">): Promise<Doc<"coverageRequests">[]> {
  return ctx.db
    .query("coverageRequests")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(100);
}

export async function openCoverageRequest(
  ctx: MutationCtx,
  input: { job: Doc<"jobs">; from: Doc<"assignments">; cause: CoverageCause; detail?: string; actor: Actor },
): Promise<Id<"coverageRequests">> {
  const { job, from } = input;
  const existing = (await jobCoverageRequests(ctx, job)).find((row) => row.fromAssignmentId === from._id);
  if (existing) return existing._id;
  const now = Date.now();
  const requestId = await ctx.db.insert("coverageRequests", {
    companyId: job.companyId,
    jobId: job._id,
    fromAssignmentId: from._id,
    cause: input.cause,
    detail: input.detail,
    status: "open",
    openedAt: now,
    // A job that has not started must be decided before it does. One already underway is decided now.
    decideBy: Math.max(job.startsAt, now),
  });
  await recordEvent(ctx, {
    companyId: job.companyId,
    type: "coverage.opened",
    actor: input.actor,
    subject: { table: "coverageRequests", id: requestId },
    data: { jobId: job._id, fromAssignmentId: from._id, cleanerId: from.cleanerId, cause: input.cause },
  });
  return requestId;
}

export async function settleCoverage(
  ctx: MutationCtx,
  request: Doc<"coverageRequests">,
  to: "filled" | "unresolved" | "cancelled" | "open",
  actor: Actor,
  extra: { filledByAssignmentId?: Id<"assignments">; summary?: string } = {},
): Promise<void> {
  if (request.status === to && request.summary === (extra.summary ?? request.summary)) return;
  if (request.status === "filled" || request.status === "cancelled") return;
  await ctx.db.patch(request._id, {
    status: to,
    ...(to === "filled" || to === "cancelled" ? { resolvedAt: Date.now() } : {}),
    ...(extra.filledByAssignmentId ? { filledByAssignmentId: extra.filledByAssignmentId } : {}),
    ...(extra.summary ? { summary: extra.summary } : {}),
  });
  if (request.status !== to) {
    await recordEvent(ctx, { companyId: request.companyId, type: `coverage.${to}`, actor, subject: { table: "coverageRequests", id: request._id }, data: { jobId: request.jobId, from: request.status } });
  }
}
