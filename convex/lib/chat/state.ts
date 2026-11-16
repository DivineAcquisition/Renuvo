/** Reading and changing a conversation's record. Shared by the public chat functions and the run engine. */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { notFound } from "../errors";
import { roleOf, type Role } from "../roles";
import type { ConversationState, Part, RunStatus } from "./schema";

type Ctx = QueryCtx | MutationCtx;

/**
 * A conversation the member may read: in this company, started by them, not deleted. Everyone else gets
 * the same "Not found." as an id that never existed.
 */
export async function ownConversation(ctx: Ctx, companyId: Id<"companies">, memberId: Id<"members">, conversationId: string): Promise<Doc<"conversations">> {
  const id = ctx.db.normalizeId("conversations", conversationId);
  const conversation = id ? await ctx.db.get(id) : null;
  if (!conversation || conversation.companyId !== companyId || conversation.createdBy !== memberId || conversation.shelf === "deleted") notFound();
  return conversation;
}

/** The member as they are now. A removed member, or one moved to another company, is no longer anyone here. */
export async function currentMember(ctx: Ctx, memberId: Id<"members">, companyId: Id<"companies">): Promise<{ member: Doc<"members">; role: Role } | null> {
  const member = await ctx.db.get(memberId);
  if (!member || member.companyId !== companyId || member.status !== "active") return null;
  return { member, role: roleOf(member.role) };
}

export async function latestRun(ctx: Ctx, conversation: Doc<"conversations">): Promise<Doc<"chatRuns"> | null> {
  return ctx.db
    .query("chatRuns")
    .withIndex("by_company_conversation_started", (q) => q.eq("companyId", conversation.companyId).eq("conversationId", conversation._id))
    .order("desc")
    .first();
}

export const isLive = (run: Doc<"chatRuns"> | null) => run !== null && (run.status === "queued" || run.status === "running");

export async function lastSeq(ctx: Ctx, conversation: Doc<"conversations">): Promise<number> {
  const last = await ctx.db
    .query("chatMessages")
    .withIndex("by_company_conversation_seq", (q) => q.eq("companyId", conversation.companyId).eq("conversationId", conversation._id))
    .order("desc")
    .first();
  return last?.seq ?? 0;
}

export async function setState(ctx: MutationCtx, conversationId: Id<"conversations">, state: ConversationState) {
  await ctx.db.patch(conversationId, { state, updatedAt: Date.now() });
}

export async function addPart(ctx: MutationCtx, messageId: Id<"chatMessages">, part: Part) {
  const message = await ctx.db.get(messageId);
  if (!message) return;
  const parts = message.parts ?? [];
  // A step or draft already shown in this reply is not shown twice (a retried call returns the same receipt).
  if (part.kind === "step" && parts.some((existing) => existing.kind === "step" && existing.stepId === part.stepId)) return;
  if (part.kind === "artifact" && parts.some((existing) => existing.kind === "artifact" && existing.artifactId === part.artifactId && existing.version === part.version)) return;
  await ctx.db.patch(messageId, { parts: [...parts, part] });
}

/** The conversation state that follows a run's end. A step still waiting on the person wins. */
export function stateAfter(status: RunStatus, waiting: boolean): ConversationState {
  if (waiting) return "awaiting_approval";
  switch (status) {
    case "queued":
    case "running":
      return "working";
    case "awaiting_approval":
      return "awaiting_approval";
    case "needs_input":
      return "needs_input";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
  }
}

export function monthOf(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

/**
 * Chat answers are paid for with Selestial Credits (convex/lib/billing). CHAT_MONTHLY_RUNS, when set on
 * the deployment, is an emergency cap on answers per company per month; normally it is unset.
 */
export function monthlyRunAllowance(): number | null {
  const raw = Number(process.env.CHAT_MONTHLY_RUNS);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
}

export async function usageRow(ctx: Ctx, companyId: Id<"companies">, month: string) {
  return ctx.db
    .query("chatUsage")
    .withIndex("by_company_month", (q) => q.eq("companyId", companyId).eq("month", month))
    .unique();
}
