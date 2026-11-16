/**
 * One tool call from a chat, start to finish: checked, recorded, carried out once, and shown as a card
 * with what really happened. Approval of a `confirm` tool is bound to the preview the person saw.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { Role } from "../roles";
import { InputError, stableHash } from "./fields";
import { addPart, setState } from "./state";
import type { StepStatus } from "./schema";
import { checkInput, roleAllows, TOOL_BY_NAME, type ChatTool, type Outcome, type ToolCtx } from "./tools";

/** The most a tool result may put back in front of the model. */
const RESULT_CHARS = 12_000;

export type StepAnswer = { content: string; isError: boolean; waiting: boolean };

function toolCtx(ctx: MutationCtx, input: { company: Doc<"companies">; member: Doc<"members">; role: Role; run: Doc<"chatRuns">; idempotencyKey: string }): ToolCtx {
  return Object.assign(Object.create(null), ctx, { db: ctx.db, scheduler: ctx.scheduler, storage: ctx.storage, auth: ctx.auth, company: input.company, member: input.member, role: input.role, conversationId: input.run.conversationId, runId: input.run._id, idempotencyKey: input.idempotencyKey }) as ToolCtx;
}

function forModel(step: Pick<Doc<"chatActionSteps">, "status" | "summary" | "result" | "preview">): string {
  const body: Record<string, unknown> = { status: step.status };
  if (step.summary) body.summary = step.summary;
  if (step.preview && step.status === "awaiting_approval") body.preview = step.preview.summary;
  if (step.status === "awaiting_approval") body.note = "Shown to the person with Approve and Decline. Do not continue this action yourself; stop and let them decide.";
  if (step.result) {
    try {
      body.result = JSON.parse(step.result);
    } catch {
      body.result = step.result;
    }
  }
  return JSON.stringify(body).slice(0, RESULT_CHARS);
}

const FINISHED: StepStatus[] = ["done", "proposed", "refused", "unavailable", "awaiting_approval", "rejected"];

/** Writes what a tool did onto its step, and shows any draft it made in the reply. */
async function settle(ctx: MutationCtx, step: Doc<"chatActionSteps">, outcome: Outcome, messageId: Id<"chatMessages"> | null): Promise<Doc<"chatActionSteps">> {
  const now = Date.now();
  if (outcome.status === "needs_approval") {
    await ctx.db.patch(step._id, { status: "awaiting_approval", preview: outcome.preview, summary: outcome.preview.summary });
  } else if (outcome.status === "refused" || outcome.status === "unavailable") {
    await ctx.db.patch(step._id, { status: outcome.status, summary: outcome.why, result: JSON.stringify({ why: outcome.why, ...(outcome.data ?? {}) }).slice(0, 20_000), completedAt: now });
  } else if (outcome.status === "done" || outcome.status === "proposed") {
    await ctx.db.patch(step._id, { status: outcome.status, summary: outcome.summary, result: JSON.stringify(outcome.data).slice(0, 20_000), link: outcome.link, record: outcome.record, completedAt: now });
    if (outcome.artifact && messageId) await addPart(ctx, messageId, { kind: "artifact", artifactId: outcome.artifact.artifactId, version: outcome.artifact.version });
    if (outcome.agreement && messageId) await addPart(ctx, messageId, { kind: "agreement", agreementId: outcome.agreement.agreementId, version: outcome.agreement.version });
  }
  return (await ctx.db.get(step._id))!;
}

async function attempt(ctx: MutationCtx, tool: ChatTool, tc: ToolCtx, args: Record<string, unknown>, phase: "preview" | "run"): Promise<Outcome> {
  try {
    if (phase === "preview" && tool.preview) return await tool.preview(tc, args);
    return await tool.run(tc, args);
  } catch (error) {
    const message = (error as { data?: { message?: unknown } }).data?.message;
    if (typeof message === "string") return { status: "refused", why: message };
    return { status: "refused", why: "This step failed inside Selestial; nothing more was done for it." };
  }
}

/** A tool call the model made during a run. */
export async function stepFromModel(
  ctx: MutationCtx,
  input: { run: Doc<"chatRuns">; company: Doc<"companies">; member: Doc<"members">; role: Role; name: string; rawInput: unknown; toolUseId: string },
): Promise<StepAnswer> {
  const tool = TOOL_BY_NAME.get(input.name);
  if (!tool) return { content: JSON.stringify({ status: "refused", why: `There is no tool called ${input.name}.` }), isError: true, waiting: false };
  let args: Record<string, unknown>;
  try {
    args = checkInput(tool, input.rawInput);
  } catch (error) {
    return { content: JSON.stringify({ status: "invalid_input", why: error instanceof InputError ? error.message : "The input did not match the tool." }), isError: true, waiting: false };
  }

  // Reads are always fresh. Anything that changes something is named by what was asked and with what, so
  // a retried run, or the model asking twice, finds the first one instead of doing it again.
  const idempotencyKey = tool.kind === "read" ? `${input.run._id}:${input.toolUseId}` : `${input.run.conversationId}:${input.run.userMessageId}:${tool.name}:${stableHash(args)}`;
  if (tool.kind !== "read") {
    const earlier = await ctx.db
      .query("chatActionSteps")
      .withIndex("by_company_key", (q) => q.eq("companyId", input.company._id).eq("idempotencyKey", idempotencyKey))
      .order("desc")
      .first();
    if (earlier && FINISHED.includes(earlier.status)) {
      await addPart(ctx, input.run.assistantMessageId, { kind: "step", stepId: earlier._id });
      return { content: forModel(earlier), isError: false, waiting: earlier.status === "awaiting_approval" };
    }
  }

  const stepId = await ctx.db.insert("chatActionSteps", {
    companyId: input.company._id,
    conversationId: input.run.conversationId,
    runId: input.run._id,
    initiatedBy: input.member._id,
    tool: tool.name,
    agent: tool.specialist,
    args: JSON.stringify(args).slice(0, 250_000),
    status: "running",
    idempotencyKey,
    createdAt: Date.now(),
  });
  await addPart(ctx, input.run.assistantMessageId, { kind: "step", stepId });
  let step = (await ctx.db.get(stepId))!;

  if (!roleAllows(input.role, tool.minimumRole)) {
    step = await settle(ctx, step, { status: "refused", why: `Only ${tool.minimumRole === "owner" ? "the Owner" : "Owners and Managers"} can do this.` }, null);
    return { content: forModel(step), isError: false, waiting: false };
  }
  const tc = toolCtx(ctx, { ...input, idempotencyKey });
  const outcome = await attempt(ctx, tool, tc, args, tool.confirm ? "preview" : "run");
  step = await settle(ctx, step, outcome, input.run.assistantMessageId);
  return { content: forModel(step), isError: false, waiting: step.status === "awaiting_approval" };
}

/**
 * The person's answer to a step waiting on them. Approving re-reads what the preview was bound to; if it
 * changed, the approval does not apply and nothing is done. An approved step is never asked for again.
 */
export async function decideStep(ctx: MutationCtx, input: { step: Doc<"chatActionSteps">; company: Doc<"companies">; member: Doc<"members">; role: Role; approve: boolean }): Promise<Doc<"chatActionSteps">> {
  const { step } = input;
  const tool = TOOL_BY_NAME.get(step.tool);
  let result: Doc<"chatActionSteps">;
  if (!input.approve) {
    await ctx.db.patch(step._id, { status: "rejected", decidedAt: Date.now(), summary: `Declined: ${step.preview?.summary ?? step.tool}`, completedAt: Date.now() });
    result = (await ctx.db.get(step._id))!;
  } else if (!tool || !tool.confirm) {
    result = await settle(ctx, step, { status: "refused", why: "This action is no longer available." }, null);
  } else if (!roleAllows(input.role, tool.minimumRole)) {
    result = await settle(ctx, step, { status: "refused", why: `Only ${tool.minimumRole === "owner" ? "the Owner" : "Owners and Managers"} can approve this.` }, null);
  } else {
    const run = (await ctx.db.get(step.runId))!;
    const tc = toolCtx(ctx, { company: input.company, member: input.member, role: input.role, run, idempotencyKey: step.idempotencyKey });
    const args = JSON.parse(step.args) as Record<string, unknown>;
    const again = await attempt(ctx, tool, tc, args, "preview");
    await ctx.db.patch(step._id, { decidedAt: Date.now() });
    if (again.status !== "needs_approval") {
      result = await settle(ctx, step, again, null);
    } else if (again.preview.bindsTo !== step.preview?.bindsTo) {
      await ctx.db.patch(step._id, { status: "expired", summary: "What this would change has changed since you saw it, so the approval does not apply. Ask again to see the new preview.", completedAt: Date.now() });
      result = (await ctx.db.get(step._id))!;
    } else {
      result = await settle(ctx, step, await attempt(ctx, tool, tc, args, "run"), run.assistantMessageId);
    }
  }
  const stillWaiting = await ctx.db
    .query("chatActionSteps")
    .withIndex("by_company_conversation_created", (q) => q.eq("companyId", step.companyId).eq("conversationId", step.conversationId))
    .order("desc")
    .take(200);
  const conversation = await ctx.db.get(step.conversationId);
  if (conversation && conversation.state === "awaiting_approval" && !stillWaiting.some((row) => row.status === "awaiting_approval")) await setState(ctx, conversation._id, "completed");
  return result;
}
