/**
 * The one approval queue (brief, sections 2 and 7). An agent on Propose prepares an action and its
 * reason; a person approves, changes or skips it. Owners and Managers decide. Agents cannot: there is no
 * public function that creates or decides an approval on an agent's word.
 */
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { managerMutation, managerQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { actionDef } from "./lib/permissionCatalog";
import { approvalStatusValidator, type Agent } from "./lib/statuses";
import { instant, optionalText, text } from "./lib/text";
import { aboutValidator } from "./schema";
import { checkAbout } from "./tasks";

type About = typeof aboutValidator.type;

/** Puts a proposed action in the queue. Called from agent workflows, never from a browser. */
export async function requestApproval(
  ctx: MutationCtx,
  input: { companyId: Id<"companies">; action: string; summary: string; reason: string; decideBy: number; about?: About; taskId?: Id<"tasks"> },
): Promise<Id<"approvals">> {
  const def = actionDef(input.action);
  if (!def) throw new Error(`Unknown action ${input.action}`);
  await checkAbout(ctx, input.companyId, input.about);
  if (input.taskId) {
    const task = await ctx.db.get(input.taskId);
    if (!task || task.companyId !== input.companyId) notFound();
  }
  const agent: Agent = def.agent;
  const approvalId = await ctx.db.insert("approvals", {
    companyId: input.companyId,
    agent,
    action: def.key,
    summary: text(input.summary, "The summary", 1000),
    reason: text(input.reason, "The reason", 2000),
    about: input.about,
    taskId: input.taskId,
    status: "pending",
    decideBy: instant(input.decideBy, "The decision deadline"),
    createdAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "approval.requested", actor: { kind: "agent", agent }, subject: { table: "approvals", id: approvalId }, data: { action: def.key } });
  return approvalId;
}

export const request = internalMutation({
  args: {
    companyId: v.id("companies"),
    action: v.string(),
    summary: v.string(),
    reason: v.string(),
    decideBy: v.number(),
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
 * approved: do it as proposed. changed: do it the way the note says. skipped: do not do it.
 * Deciding records the decision; carrying it out belongs to the agent's workflow, which reads it.
 */
export const decide = managerMutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approved"), v.literal("changed"), v.literal("skipped")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const approval = await owned(ctx, args.approvalId);
    if (approval.status !== "pending") throw userError(`This was already ${approval.status}.`);
    const note = optionalText(args.note, "The note", 2000);
    if (args.decision === "changed" && !note) throw userError("Say what to change.");
    await ctx.db.patch(approval._id, { status: args.decision, decidedBy: ctx.member._id, decidedAt: Date.now(), note });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `approval.${args.decision}`, actor: byMember(ctx), subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
    return null;
  },
});

/** Run on a schedule: a proposal nobody decided in time expires. It is never treated as approved. */
export const expireDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const due = await ctx.db
      .query("approvals")
      .withIndex("by_status_decideBy", (q) => q.eq("status", "pending").lt("decideBy", Date.now()))
      .take(200);
    for (const approval of due) {
      await ctx.db.patch(approval._id, { status: "expired" });
      await recordEvent(ctx, { companyId: approval.companyId, type: "approval.expired", actor: { kind: "system" }, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
    }
    return due.length;
  },
});
