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
import type { Task } from "./rateCards";
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
};

export type Opened = { ok: true; executionId: Id<"aiExecutions">; credits: number; repeated: boolean } | { ok: false; block: Block; message: string };

export async function openExecution(
  ctx: MutationCtx,
  input: {
    company: Doc<"companies">;
    key: string;
    /** The agent whose work this is; "chat" for Company Chat's own answers. */
    agent: AgentId | "chat" | "studio";
    /** A plan feature the work also needs, such as Creative Studio. */
    feature?: PlanFeature;
    task: Task;
    units: number;
    autonomous: boolean;
    memberId?: Id<"members">;
    /** An Owner already approved going over the per-run limit for this exact work. */
    authorized?: boolean;
    source?: { table: string; id: string };
  },
): Promise<Opened> {
  const existing = await ctx.db
    .query("aiExecutions")
    .withIndex("by_company_key", (q) => q.eq("companyId", input.company._id).eq("key", input.key))
    .first();
  if (existing) return existing.block ? { ok: false, block: existing.block, message: existing.message ?? "" } : { ok: true, executionId: existing._id, credits: existing.credits, repeated: true };

  const price = pricing(input.task, input.units);
  if (!price.ok) return price;
  const account = await accountFor(ctx, input.company._id, price.env);
  // Before the first sync there is no copy of Autumn's record yet: the reservation fetches it and decides.
  const knowsPlan = account !== null || verifiedPlan(input.company) !== null;
  for (const verdict of [input.agent === "chat" || input.agent === "studio" ? null : agentVerdict(input.company, input.agent), input.feature ? featureVerdict(input.company, input.feature) : null]) {
    if (verdict && !verdict.ok && (verdict.block !== "plan" || knowsPlan)) return verdict;
  }
  if (input.agent === "chat" && knowsPlan && verifiedPlan(input.company) === null) return { ok: false, block: "plan", message: "Company Chat needs an active Operate or Expand plan." };

  const controls = account?.controls;
  if (controls?.perRunLimit !== undefined && price.credits > controls.perRunLimit && !input.authorized) {
    return { ok: false, block: "needs_authorization", message: `This needs ${price.credits} credits, more than the ${controls.perRunLimit}-credit limit for one piece of work. The Owner can approve it or raise the limit in Plan & Usage.` };
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
    createdAt: now,
    updatedAt: now,
  });
  return { ok: true, executionId, credits: price.credits, repeated: false };
}

/** Credits held or charged this calendar month (UTC) for autonomous work. */
export async function autonomousSpend(ctx: MutationCtx, companyId: Id<"companies">, now: number): Promise<number> {
  const date = new Date(now);
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const rows = await ctx.db
    .query("aiExecutions")
    .withIndex("by_company_created", (q) => q.eq("companyId", companyId).gte("createdAt", monthStart))
    .take(5000);
  return rows.filter((row) => row.autonomous).reduce((sum, row) => sum + (row.state === "completed" ? (row.charged ?? 0) : row.state === "reserved" || row.state === "reserving" ? row.credits : 0), 0);
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
    } else {
      await ctx.db.patch(executionId, { state: "ended" in outcome ? outcome.ended : "failed", completedUnits: 0, charged: 0, settlement: execution.lockId ? "pending_release" : "none", nextSettleAt: now, updatedAt: now });
    }
    if (execution.lockId) await ctx.scheduler.runAfter(0, internal.billing.settle, { executionId });
    return;
  }
  if (execution.state === "pending") {
    await ctx.db.patch(executionId, { state: "ended" in outcome ? outcome.ended : "failed", charged: 0, updatedAt: now });
  }
}
