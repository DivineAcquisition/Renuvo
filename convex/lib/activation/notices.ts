/**
 * Telling the people who run the company what activation produced: an in-app notice for each Owner and
 * Manager (memberNotices, with read state), and, through the shared notice router, an email to the
 * Owner for the first useful result and a consolidated summary when the batch settles.
 *
 * Only outcomes are noticed: a ready asset, a decision, a blocker, a failure, the batch settling. Never an
 * internal step. Every notice is deduplicated per event and person, and nothing here can change a task's
 * outcome: an email that can't be planned or fails later leaves the task exactly as it is.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { roleOf } from "../roles";
import type { Agent } from "../statuses";
import type { RecordRef } from "./schema";

export type NoticeKind = Doc<"memberNotices">["kind"];

/** Owners and Managers: the people who can decide what an agent prepared. Office staff work the queue, not these. */
async function audience(ctx: MutationCtx, companyId: Id<"companies">): Promise<Doc<"members">[]> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(500);
  return members.filter((m) => m.status === "active" && (roleOf(m.role) === "owner" || roleOf(m.role) === "manager"));
}

export async function noticeInApp(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; kind: NoticeKind; agent?: Agent; headline: string; summary: string; activationId?: Id<"activations">; taskId?: Id<"activationTasks">; target?: RecordRef; key: string },
): Promise<number> {
  let made = 0;
  const now = Date.now();
  for (const member of await audience(ctx, input.companyId)) {
    const dedupeKey = `${input.key}:${member._id}`;
    const existing = await ctx.db
      .query("memberNotices")
      .withIndex("by_company_dedupe", (q) => q.eq("companyId", input.companyId).eq("dedupeKey", dedupeKey))
      .first();
    if (existing) continue;
    await ctx.db.insert("memberNotices", {
      companyId: input.companyId,
      memberId: member._id,
      kind: input.kind,
      ...(input.agent ? { agent: input.agent } : {}),
      headline: input.headline.slice(0, 160),
      summary: input.summary.slice(0, 400),
      ...(input.activationId ? { activationId: input.activationId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.target ? { target: input.target } : {}),
      dedupeKey,
      createdAt: now,
    });
    made += 1;
  }
  return made;
}

/** The notice kind for a task that just reached this state with these outputs, or null when it isn't worth one. */
export function kindFor(state: Doc<"activationTasks">["state"], outputs: Doc<"activationTasks">["outputs"], firstResult: boolean): NoticeKind | null {
  const decision = outputs.some((o) => ["follow_up_drafts", "retention_cases", "applicants"].includes(o.kind) || (o.kind === "coverage_plan" && (o.count ?? 0) > 0));
  if (state === "failed") return "failed";
  if (state === "waiting_connection") return "needs_connection";
  if (state === "waiting_info") return "needs_information";
  if (!outputs.length) return null;
  if (firstResult) return "first_result";
  if (state === "ready_for_review" && decision) return "approval_required";
  if (state === "ready_for_review") return "asset_created";
  return outputs.some((o) => o.created) ? "task_completed" : null;
}
