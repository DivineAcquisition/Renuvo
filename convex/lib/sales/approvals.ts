/**
 * Carrying out a decision made in the shared approvals queue on something Sales proposed. Every check
 * runs again at that moment: an approval given this morning does not send a message the customer has
 * since answered, or a quote that has since been revised. Approving one action grants nothing beyond it.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { CarriedOut } from "../dispatch/workflow";
import type { Actor } from "../events";
import { formatCents } from "../services/words";
import { decideAction, retire } from "./actions";
import { SALES, setNext } from "./opportunities";
import { approveVersion, versionOf } from "./quotes";
import { enqueueRun } from "./runs";

export const SALES_PROPOSALS = ["sales_action", "sales_quote"] as const;

export function isSalesProposal(approval: Pick<Doc<"approvals">, "proposal">): boolean {
  return approval.proposal !== undefined && (SALES_PROPOSALS as readonly string[]).includes(approval.proposal.kind);
}

async function record(ctx: MutationCtx, approval: Doc<"approvals">, result: CarriedOut | null): Promise<CarriedOut | null> {
  if (result) await ctx.db.patch(approval._id, { carriedOut: { ...result, at: Date.now() } });
  return result;
}

export async function afterSalesDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  const proposal = approval.proposal;
  const company = await ctx.db.get(approval.companyId);
  if (!proposal || !company) return null;
  const member = decidedBy.kind === "member" ? await ctx.db.get(decidedBy.memberId) : null;
  if (!member) return record(ctx, approval, { ok: false, detail: "Not carried out. Only a person can decide this." });

  if (proposal.kind === "sales_action") {
    const action = await ctx.db.get(proposal.actionId);
    if (!action || action.companyId !== approval.companyId) return record(ctx, approval, { ok: false, detail: "Not carried out. The draft no longer exists." });
    // The approval is already decided; the action must not try to close it again.
    await ctx.db.patch(action._id, { approvalId: undefined });
    const fresh = (await ctx.db.get(action._id))!;
    if (decision !== "approved") {
      const sent = await decideAction(ctx, company, fresh, member, { kind: "skip", note: approval.note });
      return record(ctx, approval, decision === "changed" ? { ok: true, detail: "Sales's draft was set aside. You said you would handle it yourself." } : { ok: sent.ok, detail: "Set aside. Nothing was sent." });
    }
    if (company.pausedAgents.includes("sales")) return record(ctx, approval, { ok: false, detail: "Not carried out. Sales is paused, so it sent nothing. The draft is still on the opportunity." });
    const sent = await decideAction(ctx, company, fresh, member, { kind: "send" });
    return record(ctx, approval, { ok: sent.ok, detail: sent.detail });
  }

  if (proposal.kind === "sales_quote") {
    const quote = await ctx.db.get(proposal.quoteId);
    const opportunity = quote ? await ctx.db.get(quote.opportunityId) : null;
    if (!quote || !opportunity || quote.companyId !== approval.companyId) return record(ctx, approval, { ok: false, detail: "Not carried out. The quote no longer exists." });
    await ctx.db.patch(quote._id, { approvalId: undefined });
    if (decision !== "approved") {
      if (quote.status === "awaiting_approval") await ctx.db.patch(quote._id, { status: "draft", updatedAt: Date.now() });
      await setNext(ctx, opportunity, { what: decision === "changed" ? "You said you would change this quote. Edit it and send it, or hand it back to Sales." : "The quote was not approved. Edit it, or close the opportunity.", by: "owner", dueAt: Date.now() + 24 * 60 * 60_000 }, decidedBy);
      return record(ctx, approval, { ok: true, detail: "The quote was not sent." });
    }
    // What was approved is one version at one total. Anything else is a different quote.
    const version = await versionOf(ctx, quote, proposal.version);
    if (!version || quote.currentVersion !== proposal.version || version.totalCents !== proposal.totalCents) {
      return record(ctx, approval, { ok: false, detail: `Not carried out. The quote changed after it was sent for approval${version ? ` (it is now ${formatCents((await versionOf(ctx, quote, quote.currentVersion))?.totalCents ?? 0)})` : ""}. Review the current version.` });
    }
    if (quote.status === "revoked" || quote.status === "accepted" || quote.status === "declined" || quote.status === "expired") return record(ctx, approval, { ok: false, detail: `Not carried out. The quote was already ${quote.status}.` });
    await approveVersion(ctx, quote, proposal.version, member._id, decidedBy);
    await ctx.db.patch(opportunity._id, { humanTouches: opportunity.humanTouches + 1 });
    const fresh = (await ctx.db.get(opportunity._id))!;
    await setNext(ctx, fresh, { what: "Send the approved quote", by: "sales", dueAt: Date.now() }, SALES);
    if (!fresh.takeover) await enqueueRun(ctx, fresh, { trigger: "quote_approved", key: `quote-approved:${quote._id}:${proposal.version}` });
    return record(ctx, approval, { ok: true, detail: `Approved at ${formatCents(version.totalCents)}. Sales sends it under its permission for replies and quotes.` });
  }
  return null;
}

/** Nobody decided in time. Silence is never approval: the draft is set aside and the opportunity goes to a person. */
export async function afterSalesExpiry(ctx: MutationCtx, approval: Doc<"approvals">): Promise<void> {
  const proposal = approval.proposal;
  if (!proposal) return;
  if (proposal.kind === "sales_action") {
    const action = await ctx.db.get(proposal.actionId);
    if (!action) return;
    await ctx.db.patch(action._id, { approvalId: undefined });
    await retire(ctx, (await ctx.db.get(action._id))!, "Nobody decided in time, so it was not sent.");
    const opportunity = await ctx.db.get(action.opportunityId);
    if (opportunity) await setNext(ctx, opportunity, { what: "Sales's draft waited a day with no decision and was not sent. Have Sales try again, or handle it yourself.", by: "owner", dueAt: Date.now() + 24 * 60 * 60_000 });
  }
  if (proposal.kind === "sales_quote") {
    const quote = await ctx.db.get(proposal.quoteId);
    if (quote?.status === "awaiting_approval") await ctx.db.patch(quote._id, { status: "draft", approvalId: undefined, updatedAt: Date.now() });
  }
}
