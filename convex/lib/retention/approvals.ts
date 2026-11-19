/**
 * Carrying out a decision made in the shared approvals queue on something Retention prepared. Every
 * check runs again at that moment (convex/lib/retention/actions.ts `carryOut`). Approving one action
 * grants nothing beyond it, and silence is never approval: a proposal nobody decided is set aside and
 * the case goes to a person.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { Actor } from "../events";
import { isOwner, roleOf } from "../roles";
import { carryOut, type CarriedOut } from "./actions";
import { addEntry, moveCase, SYSTEM } from "./cases";

export function isRetentionProposal(approval: Pick<Doc<"approvals">, "proposal">): boolean {
  return approval.proposal?.kind === "retention_action";
}

/** Refunds, and compensation above the limit, are the Owner's to approve. A Manager decides the rest. */
export function ownerOnly(approval: Pick<Doc<"approvals">, "action">): boolean {
  return approval.action === "retention.refund_above_limit";
}

async function record(ctx: MutationCtx, approval: Doc<"approvals">, result: CarriedOut): Promise<CarriedOut & { at: number }> {
  const carriedOut = { ...result, at: Date.now() };
  await ctx.db.patch(approval._id, { carriedOut });
  return carriedOut;
}

export async function afterRetentionDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped", decidedBy: Actor) {
  const proposal = approval.proposal;
  if (!proposal || proposal.kind !== "retention_action") return null;
  const company = await ctx.db.get(approval.companyId);
  const action = await ctx.db.get(proposal.actionId);
  if (!company || !action || action.companyId !== approval.companyId) return record(ctx, approval, { ok: false, detail: "Not carried out. The prepared action no longer exists." });
  const row = await ctx.db.get(action.caseId);
  if (!row) return record(ctx, approval, { ok: false, detail: "Not carried out. The case no longer exists." });
  if (action.status !== "awaiting_approval") return record(ctx, approval, { ok: false, detail: `Not carried out. This was already ${action.status.replace(/_/g, " ")}.` });
  const member = decidedBy.kind === "member" ? await ctx.db.get(decidedBy.memberId) : null;
  if (!member) return record(ctx, approval, { ok: false, detail: "Not carried out. Only a person can decide this." });
  await ctx.db.patch(action._id, { approvalId: undefined });
  if (decision !== "approved") {
    await ctx.db.patch(action._id, { status: "declined", result: decision === "changed" ? `Changed: ${approval.note ?? ""}`.slice(0, 500) : `Not approved${approval.note ? `: ${approval.note}` : "."}`.slice(0, 500), updatedAt: Date.now(), doneAt: Date.now() });
    await addEntry(ctx, row, { kind: "action", text: decision === "changed" ? `A person said they would handle "${action.summary}" another way: ${approval.note ?? ""}` : `Not approved: ${action.summary}.${approval.note ? ` ${approval.note}` : ""}`, actor: decidedBy });
    if (row.status !== "closed") await moveCase(ctx, row, { status: "needs_attention", doing: "Waiting for a person to decide the next step.", needs: decision === "changed" ? "You said you would handle this another way. Record what you did, or prepare a different step." : "The proposed step was not approved. The customer's concern is still open: decide what to do instead." }, decidedBy);
    return record(ctx, approval, { ok: true, detail: "Set aside. Nothing was done, and the case is still open." });
  }
  if (ownerOnly(approval) && !isOwner(roleOf(member.role))) return record(ctx, approval, { ok: false, detail: "Not carried out. Only the Owner approves refunds and compensation above the limit." });
  // What was approved is one prepared action against one state of the evidence.
  if (proposal.stamp !== action.stamp) return record(ctx, approval, { ok: false, detail: "Not carried out. The action was changed after it was sent for approval. Review the current one." });
  await ctx.db.patch(action._id, { status: "proposed", authorization: `${action.permission}: approved by a person`, updatedAt: Date.now() });
  const result = await carryOut(ctx, company, (await ctx.db.get(action._id))!, decidedBy);
  return record(ctx, approval, result);
}

/** Nobody decided in time. The action is set aside and the case goes to a person with the question still open. */
export async function afterRetentionExpiry(ctx: MutationCtx, approval: Doc<"approvals">): Promise<void> {
  const proposal = approval.proposal;
  if (!proposal || proposal.kind !== "retention_action") return;
  const action = await ctx.db.get(proposal.actionId);
  if (!action || action.status !== "awaiting_approval") return;
  await ctx.db.patch(action._id, { status: "declined", approvalId: undefined, result: "Nobody decided in time, so it was not done.", updatedAt: Date.now(), doneAt: Date.now() });
  const row = await ctx.db.get(action.caseId);
  if (!row || row.status === "closed") return;
  await addEntry(ctx, row, { kind: "action", text: `"${action.summary}" waited with no decision and was not done.`, actor: SYSTEM });
  await moveCase(ctx, row, { status: "needs_attention", doing: "Waiting for a person to decide the next step.", needs: `"${action.summary}" waited with no decision and was not done. The case is still open: decide the next step.` }, SYSTEM);
}
