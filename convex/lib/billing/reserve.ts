/**
 * Holding credits for one execution, from an action. Called after `openExecution` and before any model
 * is called. Returns ok only when Autumn verified the hold (HTTP 200, allowed, for this customer). Anything
 * else stops the work before it starts:
 *
 *   - Autumn unreachable, or a 202 "allowed fail-open": billing_unavailable. A hold that may have been
 *     made is released straight away.
 *   - Not enough credits: credits. The Owner is told; nothing is bought automatically.
 *   - No active plan, or a plan without this agent: plan.
 */
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ActionCtx } from "../../_generated/server";
import { finalizeLock, getOrCreateCustomer, listLedger, lockCredits, type RawLedgerEntry } from "./autumn";
import type { Block } from "./schema";
import { projectCustomer } from "./projection";

export type Reserved = { ok: true } | { ok: false; block: Block; message: string };

const FRESH_MS = 10 * 60_000;
const OUTAGE = "Billing could not be checked just now, so this AI work was not started. Nothing was charged. Everything that does not use AI keeps working.";

/** Refreshes Selestial's copy of the company's Autumn record. Returns false when Autumn could not be reached. */
export async function syncAccount(ctx: ActionCtx, companyId: Id<"companies">): Promise<boolean> {
  const target = await ctx.runQuery(internal.billing.syncTarget, { companyId });
  if (!target) return false;
  const answer = await getOrCreateCustomer(target.customerId, target.companyName);
  if (answer.kind !== "ok") {
    await ctx.runMutation(internal.billing.syncFailed, { companyId, env: target.env, problem: answer.kind === "refused" || answer.kind === "unavailable" ? answer.message : "Autumn did not confirm the account." });
    return false;
  }
  const projection = projectCustomer(answer.data, Date.now());
  // Balance history is optional: Autumn is still rolling it out, so its absence never fails a sync.
  const history = await listLedger(target.customerId);
  const ledger = history.kind === "ok" ? JSON.stringify((history.data.list ?? []).map(ledgerRow)) : undefined;
  await ctx.runMutation(internal.billing.storeAccount, { companyId, env: target.env, customerId: target.customerId, projection: JSON.stringify(projection), invoices: JSON.stringify(answer.data.invoices ?? []), ledger });
  return true;
}

const LEDGER_WORDS: Record<string, string> = {
  reset: "Monthly credits renewed",
  plan_change: "Plan change",
  update: "Balance updated",
  adjustment: "Adjustment",
  delete: "Balance removed",
  recalculate: "Balance recalculated",
  missing_history: "Some history is missing here",
  history_started: "History begins",
};

function ledgerRow(entry: RawLedgerEntry) {
  const type = entry.why?.type ?? "unknown";
  const action = entry.why?.action ?? entry.why?.source ?? null;
  const label = action === "manual_topup" ? "Credits purchased" : action === "auto_topup" ? "Automatic top-up" : (LEDGER_WORDS[type] ?? type.replace(/_/g, " "));
  const before = entry.before?.remaining;
  const after = entry.after?.remaining;
  return { id: String(entry.id).slice(0, 100), at: Number(entry.occurred_at) || 0, kind: type.slice(0, 40), label, change: typeof before === "number" && typeof after === "number" ? after - before : null, after: typeof after === "number" ? after : null };
}

export async function reserveExecution(ctx: ActionCtx, executionId: Id<"aiExecutions">): Promise<Reserved> {
  const context = await ctx.runQuery(internal.billing.reserveContext, { executionId });
  if (!context) return { ok: false, block: "billing_unavailable", message: OUTAGE };
  if (context.state === "reserved") return { ok: true };
  if (context.state !== "pending") return { ok: false, block: context.block ?? "billing_unavailable", message: context.message ?? OUTAGE };

  if (context.syncedAt === null || Date.now() - context.syncedAt > FRESH_MS) {
    if (!(await syncAccount(ctx, context.companyId))) {
      await ctx.runMutation(internal.billing.lockAnswered, { executionId, outcome: "paused", block: "billing_unavailable", message: OUTAGE });
      return { ok: false, block: "billing_unavailable", message: OUTAGE };
    }
  }
  // The plan is decided on the copy just refreshed, not on what the request assumed.
  const planCheck = await ctx.runQuery(internal.billing.planCheck, { executionId });
  if (!planCheck.ok) {
    await ctx.runMutation(internal.billing.lockAnswered, { executionId, outcome: "denied", block: planCheck.block, message: planCheck.message });
    return planCheck;
  }

  const lock = await ctx.runMutation(internal.billing.beginLock, { executionId });
  if (!lock) return { ok: false, block: "billing_unavailable", message: OUTAGE };
  const answer = await lockCredits({ customerId: lock.customerId, lockId: lock.lockId, credits: lock.credits, expiresAt: lock.expiresAt, properties: { execution_id: executionId, task: lock.task, agent: lock.agent, rate_card: lock.rateCardVersion } });

  if (answer.kind === "ok" && answer.data.allowed === true && answer.data.customer_id === lock.customerId) {
    await ctx.runMutation(internal.billing.lockAnswered, { executionId, outcome: "reserved" });
    return { ok: true };
  }
  if (answer.kind === "ok" && answer.data.allowed === false && answer.data.customer_id === lock.customerId) {
    const remaining = answer.data.balance?.remaining ?? 0;
    const message = remaining > 0 ? `This needs ${lock.credits} credits and ${remaining} are left. Nothing was charged.` : "This company has no Selestial Credits left, so new AI work is paused. Schedules, records and everything that does not use AI keep working.";
    await ctx.runMutation(internal.billing.lockAnswered, { executionId, outcome: "denied", block: "credits", message, remaining });
    return { ok: false, block: "credits", message };
  }
  // Unverified: a fail-open 202, a timeout, an error, or an answer for someone else. Undo any hold it may have made.
  await finalizeLock({ customerId: lock.customerId, lockId: lock.lockId, action: "release" });
  await ctx.runMutation(internal.billing.lockAnswered, { executionId, outcome: "paused", block: "billing_unavailable", message: OUTAGE });
  return { ok: false, block: "billing_unavailable", message: OUTAGE };
}
