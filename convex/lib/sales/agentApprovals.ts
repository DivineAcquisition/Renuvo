/**
 * Carrying out a decision made in the shared approvals queue on something the Sales agent proposed.
 * Every check runs again at that moment: an approval given this morning does not send a message the
 * customer has since answered, or a quote that has since been revised. Approving one action grants
 * nothing beyond it.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { Actor } from "../events";
import { formatCents } from "../services/words";
import { decideAction, retire } from "./actions";
import { load, SALES, setNext } from "./agentOpportunity";
import { quoteTotal } from "./agentQuotes";
import { enqueueRun } from "./runs";

export type CarriedOut = { ok: boolean; detail: string };

export const AGENT_PROPOSALS = ["sales_action", "sales_quote"] as const;

export function isAgentProposal(approval: Pick<Doc<"approvals">, "proposal">): boolean {
  return approval.proposal !== undefined && (AGENT_PROPOSALS as readonly string[]).includes(approval.proposal.kind);
}

async function record(ctx: MutationCtx, approval: Doc<"approvals">, result: CarriedOut | null): Promise<(CarriedOut & { at: number }) | null> {
  if (!result) return null;
  const carriedOut = { ...result, at: Date.now() };
  await ctx.db.patch(approval._id, { carriedOut });
  return carriedOut;
}

export async function afterAgentDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped", decidedBy: Actor) {
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
      return record(ctx, approval, decision === "changed" ? { ok: true, detail: "The agent's draft was set aside. You said you would handle it yourself." } : { ok: sent.ok, detail: "Set aside. Nothing was sent." });
    }
    if (company.pausedAgents.includes("sales")) return record(ctx, approval, { ok: false, detail: "Not carried out. Sales is paused, so it sent nothing. The draft is still on the opportunity." });
    const sent = await decideAction(ctx, company, fresh, member, { kind: "send" });
    return record(ctx, approval, { ok: sent.ok, detail: sent.detail });
  }

  if (proposal.kind === "sales_quote") {
    const quote = await ctx.db.get(proposal.quoteId);
    const opportunity = quote?.opportunityId ? await load(ctx, quote.opportunityId).catch(() => null) : null;
    if (!quote || !opportunity || quote.companyId !== approval.companyId) return record(ctx, approval, { ok: false, detail: "Not carried out. The quote no longer exists." });
    if (decision !== "approved") {
      await ctx.db.patch(quote._id, { status: quote.status === "awaiting_approval" ? "saved" : quote.status, approval: { state: "declined", by: member._id } });
      await setNext(ctx, opportunity, { what: decision === "changed" ? "You said you would change this quote. Edit it in the workspace and send it, or hand it back to the agent." : "The quote was not approved. Edit it in the workspace, or close the opportunity.", by: "owner", dueAt: Date.now() + 24 * 60 * 60_000 }, decidedBy);
      return record(ctx, approval, { ok: true, detail: "The quote was not sent." });
    }
    // What was approved is one quote at one total. Anything else is a different quote.
    if (opportunity.quoteId !== quote._id || quoteTotal(quote) !== proposal.totalCents) return record(ctx, approval, { ok: false, detail: "Not carried out. The quote changed after it was sent for approval. Review the current one." });
    if (quote.status !== "awaiting_approval" && quote.status !== "saved") return record(ctx, approval, { ok: false, detail: `Not carried out. The quote was already ${quote.status.replace(/_/g, " ")}.` });
    await ctx.db.patch(quote._id, { status: "saved", approval: { state: "approved", by: member._id } });
    await ctx.db.patch(opportunity._id, { humanTouches: opportunity.agent.humanTouches + 1 });
    const fresh = await setNext(ctx, await load(ctx, opportunity._id), { what: "Send the approved quote", by: "sales", dueAt: Date.now() }, SALES);
    if (!fresh.agent.takeover) await enqueueRun(ctx, fresh, { trigger: "quote_approved", key: `quote-approved:${quote._id}` });
    return record(ctx, approval, { ok: true, detail: `Approved at ${formatCents(quoteTotal(quote))}. The agent sends it under its permission for replies and quotes.` });
  }
  return null;
}

/** Nobody decided in time. Silence is never approval: the draft is set aside and the opportunity goes to a person. */
export async function afterAgentExpiry(ctx: MutationCtx, approval: Doc<"approvals">): Promise<void> {
  const proposal = approval.proposal;
  if (!proposal) return;
  if (proposal.kind === "sales_action") {
    const action = await ctx.db.get(proposal.actionId);
    if (!action) return;
    await ctx.db.patch(action._id, { approvalId: undefined });
    await retire(ctx, (await ctx.db.get(action._id))!, "Nobody decided in time, so it was not sent.");
    const opportunity = await load(ctx, action.opportunityId).catch(() => null);
    if (opportunity) await setNext(ctx, opportunity, { what: "The agent's draft waited a day with no decision and was not sent. Have the agent try again, or handle it yourself.", by: "owner", dueAt: Date.now() + 24 * 60 * 60_000 });
  }
  if (proposal.kind === "sales_quote") {
    const quote = await ctx.db.get(proposal.quoteId);
    if (quote?.status === "awaiting_approval") await ctx.db.patch(quote._id, { status: "saved", approval: undefined });
  }
}
