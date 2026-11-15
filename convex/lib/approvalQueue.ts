/** Putting a proposed action in the one approval queue. Called from agent workflows, never from a browser. */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { aboutValidator, proposalValidator } from "../schema";
import { notFound } from "./errors";
import { recordEvent } from "./events";
import { actionDef } from "./permissionCatalog";
import type { Agent } from "./statuses";
import { checkAbout } from "./taskState";
import { instant, optionalText, text } from "./text";

type About = typeof aboutValidator.type;
export type Proposal = typeof proposalValidator.type;

export async function requestApproval(
  ctx: MutationCtx,
  input: {
    companyId: Id<"companies">;
    action: string;
    summary: string;
    reason: string;
    decideBy: number;
    /** Exactly what approving will authorize. */
    authorizes?: string;
    /** What happens if nobody decides in time. */
    ifWaiting?: string;
    /** What approving will do, as data the workflow carries out and re-checks. */
    proposal?: Proposal;
    about?: About;
    taskId?: Id<"tasks">;
  },
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
    authorizes: optionalText(input.authorizes, "What this authorizes", 2000),
    ifWaiting: optionalText(input.ifWaiting, "What happens while waiting", 2000),
    proposal: input.proposal,
    about: input.about,
    taskId: input.taskId,
    status: "pending",
    decideBy: instant(input.decideBy, "The decision deadline"),
    createdAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "approval.requested", actor: { kind: "agent", agent }, subject: { table: "approvals", id: approvalId }, data: { action: def.key } });
  return approvalId;
}
