/**
 * The one approval queue (brief, sections 2 and 7). An agent on Propose prepares an action and its
 * reason; a person approves, changes or skips it. Owners and Managers decide. Agents cannot: there is no
 * public function that creates or decides an approval on an agent's word.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { requestApproval } from "./lib/approvalQueue";
import { managerMutation, managerQuery } from "./lib/builders";
import { afterDecision, afterExpiry, type CarriedOut } from "./lib/dispatch/workflow";
import { afterRecruiterDecision, afterRecruiterExpiry, isRecruiterProposal } from "./lib/recruiter/approvals";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { approvalStatusValidator } from "./lib/statuses";
import { optionalText } from "./lib/text";
import { aboutValidator, proposalValidator } from "./schema";

export { requestApproval } from "./lib/approvalQueue";

export const request = internalMutation({
  args: {
    companyId: v.id("companies"),
    action: v.string(),
    summary: v.string(),
    reason: v.string(),
    decideBy: v.number(),
    authorizes: v.optional(v.string()),
    ifWaiting: v.optional(v.string()),
    proposal: v.optional(proposalValidator),
    about: v.optional(aboutValidator),
    taskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => requestApproval(ctx, args),
});

export const list = managerQuery({
  args: { status: v.optional(approvalStatusValidator) },
  handler: async (ctx, args) =>
    ctx.db
      .query("approvals")
      .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", ctx.companyId).eq("status", args.status ?? "pending"))
      .take(200),
});

export const get = managerQuery({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, args) => owned(ctx, args.approvalId),
});

/**
 * approved: do it as proposed. changed: the person does it their way, and says how. skipped: do not do it.
 * A proposal that carries its action as data is carried out here, in the same step, after every check is
 * run again. The answer says whether it was carried out, and why not if it was not. A proposal without
 * one is a recommendation: deciding records the decision and a person carries it out.
 */
export const decide = managerMutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approved"), v.literal("changed"), v.literal("skipped")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ carriedOut: CarriedOut | null }> => {
    const approval = await owned(ctx, args.approvalId);
    if (approval.status !== "pending") throw userError(`This was already ${approval.status}.`);
    const note = optionalText(args.note, "The note", 2000);
    if (args.decision === "changed" && !note) throw userError("Say what to change.");
    const decided = { status: args.decision, decidedBy: ctx.member._id, decidedAt: Date.now(), note };
    await ctx.db.patch(approval._id, decided);
    await recordEvent(ctx, { companyId: ctx.companyId, type: `approval.${args.decision}`, actor: byMember(ctx), subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
    const decidedApproval = { ...approval, ...decided };
    // Each agent carries out its own proposals. Whichever it is, every check runs again at this moment.
    if (isRecruiterProposal(approval)) return { carriedOut: await afterRecruiterDecision(ctx, decidedApproval, args.decision, byMember(ctx)) };
    return { carriedOut: await afterDecision(ctx, decidedApproval, args.decision, byMember(ctx)) };
  },
});

/** Run on a schedule: a proposal nobody decided in time expires. It is never treated as approved. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("approvals")
      .withIndex("by_status_decideBy", (q) => q.eq("status", "pending").lt("decideBy", Date.now()))
      .take(100);
    for (const approval of due) {
      await ctx.db.patch(approval._id, { status: "expired" });
      await recordEvent(ctx, { companyId: approval.companyId, type: "approval.expired", actor: { kind: "system" }, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
      if (isRecruiterProposal(approval)) await afterRecruiterExpiry(ctx, { ...approval, status: "expired" });
      else await afterExpiry(ctx, { ...approval, status: "expired" });
    }
    return due.length;
  },
});
