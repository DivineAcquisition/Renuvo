/**
 * One piece of AI work, from asking to settled charge.
 *
 *   open      (a mutation, in the request that asks for the work) checks release, plan, the work's price
 *             and the company's spending controls, and records the execution. The caller has already
 *             checked the person's role and the work's own prerequisites.
 *   reserve   (an action, reserve.ts) has Autumn hold the credits atomically with an expiring lock.
 *   run       the caller does the work and saves its output.
 *   finish    (a mutation) records how many units were completed. Completed units are confirmed once;
 *             nothing completed means the hold is released. Settlement is retried on its own, so a
 *             failed settlement never repeats the work or anything the work did.
 *
 * Nothing is charged for work that did not complete. A lock that is never finalized expires and Autumn
 * returns the credits; Selestial never sets a lock without an expiry.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { accountFor, agentVerdict, featureVerdict, pricing, verifiedPlan } from "./access";
import type { AgentId, PlanFeature } from "./catalog";
import type { Task, Variant } from "./rateCards";
import type { Block } from "./schema";

const MINUTE = 60_000;

/** How long Autumn holds credits for each kind of work before returning them unasked. */
export const HOLD_MS: Record<Task, number> = {
  chat_response_standard: 15 * MINUTE,
  chat_response_advanced: 15 * MINUTE,
  hiring_message_reading: 5 * MINUTE,
  image_generation: 30 * MINUTE,
  image_edit: 30 * MINUTE,
  video_generation: 3 * 60 * MINUTE,
  applicant_evaluation: 10 * MINUTE,
  follow_up_draft: 10 * MINUTE,
  dispatch_exception_analysis: 10 * MINUTE,
  retention_assessment: 10 * MINUTE,
  agreement_draft: 15 * MINUTE,
  campaign_generation: 60 * MINUTE,
  research_brief: 15 * MINUTE,
};

export type Opened = { ok: true; executionId: Id<"aiExecutions">; credits: number; repeated: boolean } | { ok: false; block: Block; message: string };

export async function openExecution(
  ctx: MutationCtx,
  input: {
    company: Doc<"companies">;
    key: string;
    /** The agent whose work this is; "chat" for Company Chat's own answers. */
    agent: AgentId | "chat" | "studio" | "services";
    /** A plan feature the work also needs, such as Creative Studio. */
    feature?: PlanFeature;
    task: Task;
    units: number;
    autonomous: boolean;
    memberId?: Id<"members">;
    /** An Owner already approved going over the approval threshold for this exact work. */
    authorized?: boolean;
    source?: { table: string; id: string };
    /** How it started. Defaults to "automatic" for autonomous work and "member" otherwise. */
    origin?: "chat" | "member" | "automatic";
    /** Where its output can be opened. */
    link?: { label: string; path: string };
    /** The media setup, so the price matches exactly what will be made. */
    variant?: Variant;
  },
): Promise<Opened> {
  const existing = await ctx.db
    .query("aiExecutions")
    .withIndex("by_company_key", (q) => q.eq("companyId", input.company._id).eq("key", input.key))
    .first();
  if (existing) return existing.block ? { ok: false, block: existing.block, message: existing.message ?? "" } : { ok: true, executionId: existing._id, credits: existing.credits, repeated: true };

  const price = pricing(input.task, input.units, input.variant);
  if (!price.ok) return price;
  const account = await accountFor(ctx, input.company._id, price.env);
  // Before the first sync there is no copy of Autumn's record yet: the reservation fetches it and decides.
  const knowsPlan = account !== null || verifiedPlan(input.company) !== null;
  for (const verdict of [input.agent === "chat" || input.agent === "studio" || input.agent === "services" ? null : agentVerdict(input.company, input.agent), input.feature ? featureVerdict(input.company, input.feature) : null]) {
    if (verdict && !verdict.ok && (verdict.block !== "plan" || knowsPlan)) return verdict;
  }
  if (input.agent === "chat" && knowsPlan && verifiedPlan(input.company) === null) return { ok: false, block: "plan", message: "Company Chat needs an active Operate or Expand plan." };

  const controls = account?.controls;
  // Hard limits first: nothing over them runs, approved or not.
  if (controls?.maxPerExecution !== undefined && price.credits > controls.maxPerExecution) {
    return { ok: false, block: "budget", message: `This needs ${price.credits} credits, more than the ${controls.maxPerExecution}-credit maximum for one piece of work. Nothing was started. The Owner can raise the maximum in Plan & Usage.` };
  }
  const threshold = controls?.approvalThreshold ?? controls?.perRunLimit;
  if (threshold !== undefined && price.credits > threshold && !input.authorized) {
    return { ok: false, block: "needs_authorization", message: `This needs ${price.credits} credits, above the ${threshold}-credit approval threshold. The Owner can raise the threshold in Plan & Usage.` };
  }
  const budget = controls?.agentBudgets?.[input.agent];
  if (budget !== undefined) {
    const spent = await monthSpend(ctx, input.company._id, Date.now(), (row) => row.agent === input.agent);
    if (spent + price.credits > budget) return { ok: false, block: "budget", message: `This agent has used ${spent} of its ${budget}-credit monthly budget. Its AI work is paused until next month or until the Owner raises the budget; everything else keeps working.` };
  }
  if (input.autonomous && controls?.autonomousMonthly !== undefined) {
    const spent = await autonomousSpend(ctx, input.company._id, Date.now());
    if (spent + price.credits > controls.autonomousMonthly) return { ok: false, block: "budget", message: `Work no one asked for has used ${spent} of this month's ${controls.autonomousMonthly}-credit budget. It is paused until next month or until the Owner raises the budget.` };
  }

  const now = Date.now();
  const executionId = await ctx.db.insert("aiExecutions", {
    companyId: input.company._id,
    env: price.env,
    key: input.key,
    agent: input.agent,
    feature: input.feature,
    task: input.task,
    units: input.units,
    rateCardVersion: price.card.version,
    rate: price.rate,
    credits: price.credits,
    autonomous: input.autonomous,
    memberId: input.memberId,
    state: "pending",
    lockAttempts: 0,
    settlement: "none",
    settleAttempts: 0,
    source: input.source,
    origin: input.origin ?? (input.autonomous ? "automatic" : "member"),
    link: input.link,
    variant: input.variant,
    history: [{ at: now, kind: "estimated", credits: price.credits, note: `${input.units} × ${price.rate} credits on rate card ${price.card.version}` }],
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, executionId, credits: price.credits, repeated: false };
}

/** Adds one step to an execution's charge history. */
export async function noteExecution(ctx: MutationCtx, executionId: Id<"aiExecutions">, step: { kind: string; credits?: number; note?: string }): Promise<void> {
  const row = await ctx.db.get(executionId);
  if (!row) return;
  await ctx.db.patch(executionId, { history: [...(row.history ?? []), { at: Date.now(), ...step }].slice(-20) });
}

/** Credits held or charged this calendar month (UTC) by the executions `which` selects. */
export async function monthSpend(ctx: MutationCtx, companyId: Id<"companies">, now: number, which: (row: Doc<"aiExecutions">) => boolean): Promise<number> {
  const date = new Date(now);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const rows = await ctx.db
    .query("aiExecutions")
    .withIndex("by_company_created", (q) => q.eq("companyId", companyId).gte("createdAt", monthStart))
    .take(5000);
  return rows.filter(which).reduce((sum, row) => sum + (row.state === "completed" ? (row.charged ?? 0) : row.state === "reserved" || row.state === "reserving" ? row.credits : 0), 0);
}

/** Credits held or charged this calendar month (UTC) for autonomous work. */
export function autonomousSpend(ctx: MutationCtx, companyId: Id<"companies">, now: number): Promise<number> {
  return monthSpend(ctx, companyId, now, (row) => row.autonomous);
}

/**
 * Records how the work ended. `completedUnits` are charged at the rate stored when the work was priced;
 * zero completed units releases the hold. Safe to call more than once: only the first call counts.
 */
export async function finishExecution(ctx: MutationCtx, executionId: Id<"aiExecutions">, outcome: { completedUnits: number } | { ended: "failed" | "canceled" }): Promise<void> {
  const execution = await ctx.db.get(executionId);
  if (!execution) return;
  const now = Date.now();
  if (execution.state === "reserved" || execution.state === "reserving") {
    // Work only runs after its hold is confirmed; an unconfirmed hold is always released.
    const completed = "completedUnits" in outcome && execution.state === "reserved" ? Math.max(0, Math.min(execution.units, Math.floor(outcome.completedUnits))) : 0;
    if (completed > 0) {
      await ctx.db.patch(executionId, { state: "completed", completedUnits: completed, charged: completed * execution.rate, settlement: "pending_confirm", nextSettleAt: now, updatedAt: now });
      await noteExecution(ctx, executionId, { kind: "completed", credits: completed * execution.rate, note: completed < execution.units ? `${completed} of ${execution.units} units completed; only those are charged and the rest is released.` : undefined });
    } else {
      await ctx.db.patch(executionId, { state: "ended" in outcome ? outcome.ended : "failed", completedUnits: 0, charged: 0, settlement: execution.lockId ? "pending_release" : "none", nextSettleAt: now, updatedAt: now });
      await noteExecution(ctx, executionId, { kind: "ended" in outcome ? outcome.ended : "failed", credits: 0, note: "Nothing was completed, so the hold is released and nothing is charged." });
    }
    if (execution.lockId) await ctx.scheduler.runAfter(0, internal.billing.settle, { executionId });
    return;
  }
  if (execution.state === "pending") {
    await ctx.db.patch(executionId, { state: "ended" in outcome ? outcome.ended : "failed", charged: 0, updatedAt: now });
    await noteExecution(ctx, executionId, { kind: "ended" in outcome ? outcome.ended : "failed", credits: 0, note: "Ended before any credits were held." });
  }
}
