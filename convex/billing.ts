/**
 * Plans, credits and billing, with Autumn as the authority (convex/lib/billing has the design).
 *
 * The Owner manages the plan, credits and spending controls. Every other member sees only the credit
 * indicator. Each purchase or plan change is an intent: the Owner starts it, Autumn previews it, the Owner
 * confirms the exact charge and date, and only then is anything attached. Its effect is shown only after
 * Autumn reports it (a webhook or a refresh), never because the request was sent.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { accountFor, agentVerdict, billingState, BLOCK_WORDS, customerIdFor, featureVerdict, verifiedPlan } from "./lib/billing/access";
import { attach, attachBody, finalizeLock, openPortal, previewAttach, setupPayment, updateSubscription, type RawInvoice } from "./lib/billing/autumn";
import { AGENT_CATALOG, AGENT_IDS, agentReleased, AUTUMN, BOTH_PLANS_INCLUDE, lostOnChange, PLAN_FEATURES, PLAN_IDS, planIncludesAgent, planIncludesFeature, PLANS, type PlanFeature } from "./lib/billing/catalog";
import { HOLD_MS, noteExecution } from "./lib/billing/executions";
import type { Projection } from "./lib/billing/projection";
import { TASKS } from "./lib/billing/rateCards";
import { reserveExecution, syncAccount } from "./lib/billing/reserve";
import { blockValidator, DEFAULT_CONTROLS, envValidator } from "./lib/billing/schema";
import { companyQuery, ownerMutation, ownerQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { appOrigin } from "./lib/invitations";
import { allow } from "./lib/rateLimit";

const MINUTE = 60_000;
const ACTIVE_STATES = new Set(["reserving", "reserved"]);

// ── Reservation and settlement (internal) ────────────────────────────────────────────────────────

export const syncTarget = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const state = billingState();
    const company = await ctx.db.get(args.companyId);
    if (!state.connected || !company) return null;
    return { env: state.env, customerId: customerIdFor(company._id), companyName: company.name };
  },
});

export const reserveContext = internalQuery({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) return null;
    const account = await accountFor(ctx, execution.companyId, execution.env);
    return { companyId: execution.companyId, state: execution.state, block: execution.block ?? null, message: execution.message ?? null, syncedAt: account?.syncedAt ?? null };
  },
});

/** Release and plan, decided again on the copy of Autumn's record that was just refreshed. */
export const planCheck = internalQuery({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args) => {
    const execution = (await ctx.db.get(args.executionId))!;
    const company = (await ctx.db.get(execution.companyId))!;
    if (execution.agent === "chat" || execution.agent === "studio") {
      if (!verifiedPlan(company)) return { ok: false as const, block: "plan" as const, message: "AI work needs an active Operate or Expand plan." };
    } else {
      const verdict = agentVerdict(company, execution.agent);
      if (!verdict.ok) return verdict;
    }
    if (execution.feature) {
      const verdict = featureVerdict(company, execution.feature as PlanFeature);
      if (!verdict.ok) return verdict;
    }
    return { ok: true as const };
  },
});

export const beginLock = internalMutation({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution || execution.state !== "pending") return null;
    const attempts = execution.lockAttempts + 1;
    const now = Date.now();
    const lockId = `${execution._id}-${attempts}`;
    const expiresAt = now + HOLD_MS[execution.task];
    // Recorded before Autumn is asked, so a crash between the two is found by the sweep and released.
    await ctx.db.patch(execution._id, { state: "reserving", lockId, lockAttempts: attempts, lockExpiresAt: expiresAt, updatedAt: now });
    return { lockId, expiresAt, credits: execution.credits, customerId: customerIdFor(execution.companyId), task: execution.task, agent: execution.agent, rateCardVersion: execution.rateCardVersion };
  },
});

export const lockAnswered = internalMutation({
  args: { executionId: v.id("aiExecutions"), outcome: v.union(v.literal("reserved"), v.literal("denied"), v.literal("paused")), block: v.optional(blockValidator), message: v.optional(v.string()), remaining: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution) return;
    const now = Date.now();
    if (args.outcome === "reserved") {
      if (execution.state === "reserving") {
        await ctx.db.patch(execution._id, { state: "reserved", updatedAt: now });
        await noteExecution(ctx, execution._id, { kind: "held", credits: execution.credits, note: "Autumn held the credits for this work." });
      }
      return;
    }
    // A hold that may have been made was released by the caller, or returns itself at its expiry.
    await ctx.db.patch(execution._id, { state: args.outcome, block: args.block, message: args.message, settlement: execution.lockId && args.outcome === "paused" ? "released" : execution.settlement, charged: 0, updatedAt: now });
    await noteExecution(ctx, execution._id, { kind: args.outcome === "denied" ? "not_started" : "paused", credits: 0, note: args.message });
    const account = await accountFor(ctx, execution.companyId, execution.env);
    if (!account) return;
    if (args.block === "credits" && (args.remaining ?? 0) <= 0) {
      await notify(ctx, account, "zero_balance", "Selestial Credits ran out, so new AI work is paused. Schedules, records, cleaner links and everything that does not use AI keep working. Buy a top-up or wait for the monthly reset.");
      if (account.credits) await ctx.db.patch(account._id, { credits: { ...account.credits, remaining: 0 } });
    }
    if (args.block === "billing_unavailable") await notify(ctx, account, "billing_unavailable", "Billing could not be checked, so some AI work was paused. Nothing was charged for it.");
  },
});

async function notify(ctx: MutationCtx, account: Doc<"billingAccounts">, kind: Doc<"billingAccounts">["notices"][number]["kind"], text: string) {
  const now = Date.now();
  // One notice of a kind a day is enough.
  if (account.notices.some((row) => row.kind === kind && now - row.at < 24 * 60 * MINUTE)) return;
  await ctx.db.patch(account._id, { notices: [{ kind, at: now, text }, ...account.notices].slice(0, 10) });
  await recordEvent(ctx, { companyId: account.companyId, type: `billing.${kind}`, actor: { kind: "system" }, subject: { table: "billingAccounts", id: account._id }, data: { env: account.env } });
}

const BACKOFF = [1, 5, 15, 60, 180, 360].map((minutes) => minutes * MINUTE);

/** Holds the credits for an execution that was opened in a mutation. True when Autumn verified the hold. */
export const reserve = internalAction({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args): Promise<boolean> => (await reserveExecution(ctx, args.executionId)).ok,
});

export const settle = internalAction({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args): Promise<void> => {
    const execution = await ctx.runQuery(internal.billing.settlementOf, { executionId: args.executionId });
    if (!execution || !execution.lockId || (execution.settlement !== "pending_confirm" && execution.settlement !== "pending_release")) return;
    const action = execution.settlement === "pending_confirm" ? "confirm" : "release";
    const answer = await finalizeLock({ customerId: customerIdFor(execution.companyId), lockId: execution.lockId, action, credits: action === "confirm" ? execution.charged : undefined });
    await ctx.runMutation(internal.billing.settleAnswered, { executionId: args.executionId, answer: answer.kind, success: answer.kind === "ok" ? answer.data.success : null, problem: answer.kind === "refused" || answer.kind === "unavailable" ? answer.message : undefined });
    if (action === "confirm") await syncAccount(ctx, execution.companyId);
  },
});

export const settlementOf = internalQuery({
  args: { executionId: v.id("aiExecutions") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    return row ? { companyId: row.companyId, lockId: row.lockId ?? null, settlement: row.settlement, charged: row.charged ?? 0 } : null;
  },
});

export const settleAnswered = internalMutation({
  args: { executionId: v.id("aiExecutions"), answer: v.string(), success: v.union(v.boolean(), v.null()), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.executionId);
    if (!row || (row.settlement !== "pending_confirm" && row.settlement !== "pending_release")) return;
    const confirming = row.settlement === "pending_confirm";
    const now = Date.now();
    if ((args.answer === "ok" && args.success !== false) || args.answer === "replayed") {
      await ctx.db.patch(row._id, { settlement: confirming ? "confirmed" : "released", nextSettleAt: undefined, settleProblem: undefined, updatedAt: now });
      await noteExecution(ctx, row._id, confirming ? { kind: "charged", credits: row.charged ?? 0, note: "Autumn confirmed the charge." } : { kind: "released", credits: 0, note: "Autumn returned the held credits." });
    } else if (args.answer === "degraded") {
      // Autumn accepted it without verifying. Not retried (a retry would only be a replay); listed for reconciliation.
      await ctx.db.patch(row._id, { settlement: "unverified", nextSettleAt: undefined, settleProblem: "Autumn accepted this while degraded and did not verify it.", updatedAt: now });
      await noteExecution(ctx, row._id, { kind: "unverified", note: "Billing was degraded when this settled; it is listed for reconciliation." });
    } else if (args.answer === "refused" || (args.answer === "ok" && args.success === false)) {
      // The lock is gone: it expired, so the credits already went back. Work that completed stays done and is recorded as not billed.
      await ctx.db.patch(row._id, { settlement: confirming ? "unbilled" : "released", nextSettleAt: undefined, settleProblem: args.problem ?? "Autumn no longer had this hold.", updatedAt: now });
      await noteExecution(ctx, row._id, confirming ? { kind: "not_charged", credits: 0, note: "The work finished after its hold expired, so it was not charged." } : { kind: "released", credits: 0, note: "The hold had already expired and its credits went back." });
    } else {
      const attempts = row.settleAttempts + 1;
      if (attempts > BACKOFF.length) await ctx.db.patch(row._id, { settlement: "unverified", settleAttempts: attempts, nextSettleAt: undefined, settleProblem: args.problem ?? "Autumn could not be reached.", updatedAt: now });
      else await ctx.db.patch(row._id, { settleAttempts: attempts, nextSettleAt: now + BACKOFF[attempts - 1], settleProblem: args.problem, updatedAt: now });
    }
  },
});

/** Every few minutes: retries due settlements, and recovers work that stopped part-way. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const settlement of ["pending_confirm", "pending_release"] as const) {
      const due = await ctx.db
        .query("aiExecutions")
        .withIndex("by_settlement_next", (q) => q.eq("settlement", settlement).lte("nextSettleAt", now))
        .take(50);
      for (const row of due) await ctx.scheduler.runAfter(0, internal.billing.settle, { executionId: row._id });
    }
    // A request that stopped between recording the hold and hearing back: release it.
    for (const row of await ctx.db
      .query("aiExecutions")
      .withIndex("by_state_updated", (q) => q.eq("state", "reserving").lt("updatedAt", now - 2 * MINUTE))
      .take(50)) {
      await ctx.db.patch(row._id, { state: "paused", block: "billing_unavailable", message: "The credit hold was not confirmed in time. Nothing was charged.", settlement: "pending_release", nextSettleAt: now, charged: 0, updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.billing.settle, { executionId: row._id });
    }
    // Work that held credits and never reported back: Autumn returns the credits at the hold's expiry.
    for (const row of await ctx.db
      .query("aiExecutions")
      .withIndex("by_state_updated", (q) => q.eq("state", "reserved").lt("updatedAt", now - 5 * MINUTE))
      .take(100)) {
      if ((row.lockExpiresAt ?? 0) < now) {
        await ctx.db.patch(row._id, { state: "expired", settlement: "released", charged: 0, settleProblem: "The work did not finish before its hold expired; the credits went back.", updatedAt: now });
        await noteExecution(ctx, row._id, { kind: "expired", credits: 0, note: "The work never reported back, so the hold expired and its credits went back." });
      }
    }
    for (const row of await ctx.db
      .query("aiExecutions")
      .withIndex("by_state_updated", (q) => q.eq("state", "pending").lt("updatedAt", now - 30 * MINUTE))
      .take(100)) {
      await ctx.db.patch(row._id, { state: "canceled", charged: 0, updatedAt: now });
    }
  },
});

// ── Keeping Selestial's copy of Autumn's record ──────────────────────────────────────────────────

export const storeAccount = internalMutation({
  args: { companyId: v.id("companies"), env: envValidator, customerId: v.string(), projection: v.string(), invoices: v.string(), ledger: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const projection = JSON.parse(args.projection) as Projection;
    const invoices = (JSON.parse(args.invoices) as RawInvoice[]).slice(0, 24).map((row) => ({ id: row.id, status: row.status, cents: Math.round(Number(row.total) * 100), currency: row.currency, createdAt: row.created_at, url: row.hosted_invoice_url ?? null }));
    const now = Date.now();
    let account = await accountFor(ctx, args.companyId, args.env);
    const ledger = args.ledger ? (JSON.parse(args.ledger) as Doc<"billingAccounts">["ledger"]) : undefined;
    const fields = { plan: projection.plan, subscription: projection.subscription, credits: projection.credits, syncedAt: now, syncProblem: undefined, ...(invoices.length ? { invoices } : {}), ...(ledger ? { ledger } : {}) };
    if (account) await ctx.db.patch(account._id, fields);
    else {
      const id = await ctx.db.insert("billingAccounts", { companyId: args.companyId, env: args.env, customerId: args.customerId, controls: DEFAULT_CONTROLS, alertsSent: { period: "", percents: [] }, notices: [], invoices, ...fields });
      account = (await ctx.db.get(id))!;
    }
    account = (await ctx.db.get(account._id))!;
    // The company's plan is only ever what Autumn reported, for the environment this deployment bills in.
    const company = (await ctx.db.get(args.companyId))!;
    if (billingState().connected && (verifiedPlan(company) ?? null) !== projection.plan) {
      await ctx.db.patch(company._id, { plan: projection.plan ?? undefined });
      await recordEvent(ctx, { companyId: company._id, type: "company.plan_changed", actor: { kind: "system" }, subject: { table: "companies", id: company._id }, data: { from: verifiedPlan(company), to: projection.plan, source: "autumn" } });
    }
    const low = account.controls.lowBalance;
    if (low !== undefined && projection.credits && projection.credits.remaining > 0 && projection.credits.remaining < low) await notify(ctx, account, "low_balance", `Fewer than ${low.toLocaleString("en-US")} credits are left. AI work pauses at zero; buy a top-up or wait for the monthly reset.`);
    if (projection.subscription.pastDue) await notify(ctx, account, "past_due", "The last payment for this plan did not go through. Update the payment method in Plan & Usage to keep the plan.");
    await usageAlerts(ctx, account);
  },
});

async function usageAlerts(ctx: MutationCtx, account: Doc<"billingAccounts">) {
  const credits = account.credits;
  if (!credits || credits.included.granted <= 0) return;
  const period = String(credits.nextResetAt ?? "");
  const used = Math.round((100 * (credits.included.granted - credits.included.remaining)) / credits.included.granted);
  const sent = account.alertsSent.period === period ? account.alertsSent.percents : [];
  const crossed = account.controls.alertPercents.filter((percent) => used >= percent && !sent.includes(percent));
  if (!crossed.length) {
    if (account.alertsSent.period !== period) await ctx.db.patch(account._id, { alertsSent: { period, percents: [] } });
    return;
  }
  const top = Math.max(...crossed);
  await ctx.db.patch(account._id, { alertsSent: { period, percents: [...sent, ...crossed] }, notices: [{ kind: "usage_alert" as const, at: Date.now(), text: `This company has used ${top}% of this month's included credits.` }, ...account.notices].slice(0, 10) });
  await recordEvent(ctx, { companyId: account.companyId, type: "billing.usage_alert", actor: { kind: "system" }, subject: { table: "billingAccounts", id: account._id }, data: { percent: top } });
}

export const syncFailed = internalMutation({
  args: { companyId: v.id("companies"), env: envValidator, problem: v.string() },
  handler: async (ctx, args) => {
    const account = await accountFor(ctx, args.companyId, args.env);
    if (account) await ctx.db.patch(account._id, { syncProblem: args.problem.slice(0, 300) });
  },
});

export const syncCompany = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<void> => {
    await syncAccount(ctx, args.companyId);
  },
});

/** An Autumn webhook, verified by the HTTP route. It only says "look again": the record is read back from Autumn. */
export const webhookReceived = internalMutation({
  args: { deliveryId: v.string(), type: v.string(), customerId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const state = billingState();
    if (!state.connected) return;
    const seen = await ctx.db
      .query("billingWebhooks")
      .withIndex("by_env_delivery", (q) => q.eq("env", state.env).eq("deliveryId", args.deliveryId))
      .first();
    if (seen) return;
    const account = args.customerId
      ? await ctx.db
          .query("billingAccounts")
          .withIndex("by_env_customer", (q) => q.eq("env", state.env).eq("customerId", args.customerId!))
          .first()
      : null;
    await ctx.db.insert("billingWebhooks", { env: state.env, deliveryId: args.deliveryId.slice(0, 200), type: args.type.slice(0, 80), customerId: args.customerId?.slice(0, 200), companyId: account?.companyId, receivedAt: Date.now() });
    if (account) await ctx.scheduler.runAfter(0, internal.billing.syncCompany, { companyId: account.companyId });
  },
});

/**
 * The retired staff-set plans ("growth", "scale") granted chat allowances and nothing was ever charged
 * for them. They grant nothing now; this clears them so only Autumn's verified plan remains. Run once:
 * `npx convex run billing:clearLegacyPlans`.
 */
export const clearLegacyPlans = internalMutation({
  args: {},
  handler: async (ctx) => {
    let cleared = 0;
    for (const company of await ctx.db.query("companies").take(5000)) {
      if (company.plan !== "growth" && company.plan !== "scale") continue;
      await ctx.db.patch(company._id, { plan: undefined });
      await recordEvent(ctx, { companyId: company._id, type: "company.plan_changed", actor: { kind: "system" }, subject: { table: "companies", id: company._id }, data: { from: company.plan, to: null, source: "legacy_plan_retired" } });
      cleared += 1;
    }
    return { cleared };
  },
});

// ── The Owner's purchases and changes ────────────────────────────────────────────────────────────

function connectedOrRefuse() {
  const state = billingState();
  if (!state.connected) throw userError("Billing is not connected on this deployment yet.", "limit");
  return state;
}

/** Top-up pack sizes offered, from BILLING_TOP_UP_PACKS. Empty (the default) means top-ups are not on sale. */
export function topUpPacks(): number[] {
  const state = billingState();
  if (!state.connected || !state.card) return [];
  return (process.env.BILLING_TOP_UP_PACKS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 1_000_000)
    .slice(0, 4);
}

async function startIntent(ctx: MutationCtx & { companyId: Id<"companies">; member: Doc<"members"> }, fields: { kind: Doc<"billingIntents">["kind"]; planId?: string; quantity?: number; stage: "previewing" | "submitting" }) {
  const state = connectedOrRefuse();
  if (!(await allow(ctx, `billing:${ctx.companyId}`, 20, 10 * MINUTE))) throw userError("That is a lot of billing requests in a few minutes. Wait a moment and try again.", "limit");
  const now = Date.now();
  const intentId = await ctx.db.insert("billingIntents", { companyId: ctx.companyId, env: state.env, kind: fields.kind, planId: fields.planId, quantity: fields.quantity, memberId: ctx.member._id, stage: fields.stage, createdAt: now, updatedAt: now });
  await recordEvent(ctx, { companyId: ctx.companyId, type: `billing.${fields.kind}_started`, actor: byMember(ctx), subject: { table: "billingIntents", id: intentId }, data: { planId: fields.planId ?? null, quantity: fields.quantity ?? null } });
  await ctx.scheduler.runAfter(0, internal.billing.runIntent, { intentId });
  return intentId;
}

export const startPlanChange = ownerMutation({
  args: { plan: v.union(v.literal("operate"), v.literal("expand")) },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (account?.plan === args.plan && !account.subscription.scheduledPlan) throw userError(`This company is already on ${PLANS[args.plan].name}.`);
    return startIntent(ctx, { kind: "plan_change", planId: args.plan, stage: "previewing" });
  },
});

export const startTopUp = ownerMutation({
  args: { credits: v.number() },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    if (!topUpPacks().includes(args.credits)) throw userError("That top-up is not offered.");
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account?.plan) throw userError("Top-ups add credits to an active plan. Choose a plan first.");
    return startIntent(ctx, { kind: "top_up", planId: AUTUMN.topUpPlan, quantity: args.credits, stage: "previewing" });
  },
});

/** The Owner confirms the exact charge and date they were shown. */
export const confirmIntent = ownerMutation({
  args: { intentId: v.id("billingIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.companyId !== ctx.companyId) throw userError("That request was not found.", "not_found");
    if (intent.stage !== "awaiting_confirmation") throw userError(intent.stage === "submitting" || intent.stage === "done" ? "This was already confirmed." : "This is no longer waiting to be confirmed.");
    if (Date.now() - intent.updatedAt > 30 * MINUTE) throw userError("This price is more than 30 minutes old. Start again to see the current one.");
    await ctx.db.patch(intent._id, { stage: "submitting", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `billing.${intent.kind}_confirmed`, actor: byMember(ctx), subject: { table: "billingIntents", id: intent._id }, data: { dueNowCents: intent.preview?.dueNowCents ?? null } });
    await ctx.scheduler.runAfter(0, internal.billing.runIntent, { intentId: intent._id });
    return null;
  },
});

export const cancelPlan = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account?.plan) throw userError("There is no active plan to cancel.");
    if (account.subscription.endsAt) throw userError("This plan is already set to end.");
    return startIntent(ctx, { kind: "cancel", planId: account.plan, stage: "submitting" });
  },
});

/** Keeps a plan that was set to end, or drops a scheduled plan change. */
export const resumePlan = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account?.plan || (!account.subscription.endsAt && !account.subscription.scheduledPlan)) throw userError("Nothing is scheduled to change.");
    return startIntent(ctx, { kind: "uncancel", planId: account.plan, stage: "submitting" });
  },
});

export const openBillingPortal = ownerMutation({
  args: { purpose: v.union(v.literal("portal"), v.literal("payment_method")) },
  handler: async (ctx, args) => startIntent(ctx, { kind: args.purpose, stage: "submitting" }),
});

export const refresh = ownerMutation({
  args: {},
  handler: async (ctx) => {
    connectedOrRefuse();
    if (!(await allow(ctx, `billing.refresh:${ctx.companyId}`, 6, MINUTE))) throw userError("Refreshed a moment ago. Try again shortly.", "limit");
    await ctx.scheduler.runAfter(0, internal.billing.syncCompany, { companyId: ctx.companyId });
    return null;
  },
});

export const intentFor = internalQuery({
  args: { intentId: v.id("billingIntents") },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent) return null;
    const account = await accountFor(ctx, intent.companyId, intent.env);
    return { intent, plan: account?.plan ?? null };
  },
});

export const intentAnswered = internalMutation({
  args: { intentId: v.id("billingIntents"), stage: v.union(v.literal("awaiting_confirmation"), v.literal("done"), v.literal("payment_needed"), v.literal("failed")), preview: v.optional(v.string()), url: v.optional(v.string()), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent) return;
    await ctx.db.patch(intent._id, { stage: args.stage, preview: args.preview ? JSON.parse(args.preview) : intent.preview, url: args.url, problem: args.problem?.slice(0, 300), updatedAt: Date.now() });
    if (args.stage === "done" || args.stage === "failed") await recordEvent(ctx, { companyId: intent.companyId, type: `billing.${intent.kind}_${args.stage}`, actor: { kind: "system" }, subject: { table: "billingIntents", id: intent._id }, data: { planId: intent.planId ?? null } });
  },
});

const cents = (major: number | undefined | null) => Math.round(Number(major ?? 0) * 100);

export const runIntent = internalAction({
  args: { intentId: v.id("billingIntents") },
  handler: async (ctx, args): Promise<void> => {
    const found = await ctx.runQuery(internal.billing.intentFor, { intentId: args.intentId });
    if (!found) return;
    const { intent, plan } = found;
    const customerId = customerIdFor(intent.companyId);
    const returnUrl = `${appOrigin() ?? "https://app.selestial.io"}/app/settings/billing?billing=returned`;
    const answered = async (stage: "awaiting_confirmation" | "done" | "payment_needed" | "failed", extra: { preview?: string; url?: string; problem?: string } = {}): Promise<void> => {
      await ctx.runMutation(internal.billing.intentAnswered, { intentId: intent._id, stage, ...extra });
    };
    const failed = (answer: { kind: string; message?: string }): Promise<void> => answered("failed", { problem: answer.kind === "unavailable" ? "Billing could not be reached. Nothing was charged. Try again in a few minutes." : (answer.message ?? "Autumn refused this request. Nothing was charged.") });

    // The customer must exist in Autumn before anything is attached to it.
    if (!(await syncAccount(ctx, intent.companyId))) return failed({ kind: "unavailable" });

    if (intent.kind === "portal" || intent.kind === "payment_method") {
      const answer = intent.kind === "portal" ? await openPortal(customerId, returnUrl) : await setupPayment(customerId, returnUrl);
      return answer.kind === "ok" ? answered("done", { url: answer.data.url }) : failed(answer as never);
    }
    if (intent.kind === "cancel" || intent.kind === "uncancel") {
      const answer = await updateSubscription({ customerId, planId: intent.planId!, cancelAction: intent.kind === "cancel" ? "cancel_end_of_cycle" : "uncancel" }, `intent:${intent._id}`);
      if (answer.kind === "ok" || answer.kind === "replayed") {
        await answered("done");
        await syncAccount(ctx, intent.companyId);
        return;
      }
      return failed(answer as never);
    }

    const target = intent.planId!;
    const downgrade = intent.kind === "plan_change" && plan === "expand" && target === "operate";
    const body = attachBody({ customerId, planId: target, successUrl: returnUrl, quantity: intent.kind === "top_up" ? intent.quantity : undefined, schedule: intent.kind === "plan_change" ? (downgrade ? "end_of_cycle" : "immediate") : undefined });

    if (intent.stage === "previewing") {
      const answer = await previewAttach(body);
      if (answer.kind !== "ok") return failed(answer as never);
      const data = answer.data;
      const incoming = data.incoming?.find((row) => row.plan_id === target);
      const lost = downgrade ? lostOnChange("expand", "operate") : { agents: [], features: [] };
      const preview = {
        currency: data.currency,
        dueNowCents: cents(data.total),
        nextCycleCents: data.next_cycle ? cents(data.next_cycle.total) : null,
        nextCycleAt: data.next_cycle?.starts_at ?? null,
        effectiveAt: incoming?.effective_at ?? null,
        activates: data.plan_activates ?? "on_payment",
        lines: (data.line_items ?? []).slice(0, 10).map((row) => ({ label: String(row.display_name ?? row.description ?? "Charge").slice(0, 120), cents: cents(row.total) })),
        lostAgents: lost.agents,
        lostFeatures: lost.features,
      };
      return answered("awaiting_confirmation", { preview: JSON.stringify(preview) });
    }
    if (intent.stage !== "submitting") return;
    const answer = await attach(body, `intent:${intent._id}`);
    if (answer.kind === "ok") {
      // Plans and credits count only once Autumn reports them; the sync below, or the webhook, does that.
      if (answer.data.payment_url) await answered("payment_needed", { url: answer.data.payment_url, problem: answer.data.required_action?.reason });
      else await answered("done");
      await syncAccount(ctx, intent.companyId);
      return;
    }
    if (answer.kind === "replayed") return answered("done");
    return failed(answer as never);
  },
});

const PROBLEMS_PER_MONTH = 31 * 24 * 60 * MINUTE;

export const setSpendingControls = ownerMutation({
  args: {
    /** Hard: no single piece of work holds more. */
    maxPerExecution: v.union(v.number(), v.null()),
    /** Soft: work above it waits for the Owner. */
    approvalThreshold: v.union(v.number(), v.null()),
    /** Hard: monthly credits for work no one asked for. */
    autonomousMonthly: v.union(v.number(), v.null()),
    /** Hard: monthly credits per agent ("chat", "studio" or an agent id). */
    agentBudgets: v.record(v.string(), v.number()),
    /** Alert only: tell the Owner when available credits fall below this. */
    lowBalance: v.union(v.number(), v.null()),
    /** Alert only: percentages of the monthly allowance. */
    alertPercents: v.array(v.number()),
    autoTopUp: v.object({ enabled: v.boolean(), credits: v.optional(v.number()), maxPerMonth: v.optional(v.number()) }),
  },
  handler: async (ctx, args) => {
    const state = connectedOrRefuse();
    const account = await accountFor(ctx, ctx.companyId, state.env);
    if (!account) throw userError("Open Plan & Usage once so the billing account can be set up, then try again.");
    const whole = (value: number | null, label: string) => {
      if (value === null) return undefined;
      if (!Number.isInteger(value) || value < 1 || value > 10_000_000) throw userError(`${label} must be a whole number of credits.`);
      return value;
    };
    const alerts = [...new Set(args.alertPercents)].sort((a, b) => a - b);
    if (alerts.length > 5 || alerts.some((value) => !Number.isInteger(value) || value < 1 || value > 100)) throw userError("Alerts are up to five percentages between 1 and 100.");
    if (args.autoTopUp.enabled) throw userError("Automatic top-ups are not available yet: top-ups are not on sale. Nothing is ever bought without you.");
    const budgets: Record<string, number> = {};
    for (const [agent, value] of Object.entries(args.agentBudgets)) {
      if (agent !== "chat" && agent !== "studio" && !(AGENT_IDS as readonly string[]).includes(agent)) throw userError("That agent is not known.");
      budgets[agent] = whole(value, `The budget for ${agentName(agent as Doc<"aiExecutions">["agent"])}`)!;
    }
    const maxPerExecution = whole(args.maxPerExecution, "The maximum for one piece of work");
    const approvalThreshold = whole(args.approvalThreshold, "The approval threshold");
    if (maxPerExecution !== undefined && approvalThreshold !== undefined && approvalThreshold > maxPerExecution) throw userError("The approval threshold must not be above the maximum for one piece of work.");
    await ctx.db.patch(account._id, { controls: { maxPerExecution, approvalThreshold, autonomousMonthly: whole(args.autonomousMonthly, "The monthly budget"), agentBudgets: budgets, lowBalance: whole(args.lowBalance, "The low-balance alert"), alertPercents: alerts, autoTopUp: { enabled: false, maxPerMonth: args.autoTopUp.maxPerMonth } } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "billing.controls_changed", actor: byMember(ctx), subject: { table: "billingAccounts", id: account._id }, data: { maxPerExecution: args.maxPerExecution, approvalThreshold: args.approvalThreshold, autonomousMonthly: args.autonomousMonthly, lowBalance: args.lowBalance } });
    return null;
  },
});

// ── What people see ──────────────────────────────────────────────────────────────────────────────

/** Credits held right now for work in progress. */
async function reservedCredits(ctx: { db: QueryCtx["db"] }, companyId: Id<"companies">, since: number) {
  const rows = await ctx.db
    .query("aiExecutions")
    .withIndex("by_company_created", (q) => q.eq("companyId", companyId).gte("createdAt", since))
    .order("desc")
    .take(500);
  return rows.filter((row) => ACTIVE_STATES.has(row.state)).reduce((sum, row) => sum + row.credits, 0);
}

/** The compact indicator in Chat and before AI work. Every member sees it; it holds no prices or invoices. */
export const creditIndicator = companyQuery({
  args: {},
  handler: async (ctx) => {
    const state = billingState();
    if (!state.connected) return { state: "not_connected" as const, message: state.message, available: null, reserved: 0, low: false };
    if (!state.card) return { state: "not_approved" as const, message: state.problem ?? "", available: null, reserved: 0, low: false };
    const account = await accountFor(ctx, ctx.companyId, state.env);
    const reserved = await reservedCredits(ctx, ctx.companyId, Date.now() - 24 * 60 * MINUTE);
    if (!account) return { state: "unknown" as const, message: "Credits are checked when AI work starts.", available: null, reserved, low: false };
    if (!account.plan) return { state: "no_plan" as const, message: "AI work needs an active Operate or Expand plan.", available: account.credits?.remaining ?? 0, reserved, low: true };
    const available = account.credits?.remaining ?? 0;
    const included = account.credits?.included.granted ?? 0;
    return { state: available <= 0 ? ("empty" as const) : ("ok" as const), message: available <= 0 ? "No credits left. New AI work is paused; everything else keeps working." : "", available, reserved, low: included > 0 && available < included * 0.1 };
  },
});

export const intent = ownerQuery({
  args: { intentId: v.id("billingIntents") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.intentId);
    if (!row || row.companyId !== ctx.companyId) return null;
    return { id: row._id, kind: row.kind, planId: row.planId ?? null, quantity: row.quantity ?? null, stage: row.stage, preview: row.preview ?? null, url: row.url ?? null, problem: row.problem ?? null };
  },
});

/** Settings → Plan & Usage. The Owner only. */
export const planAndUsage = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const state = billingState();
    const plan = verifiedPlan(ctx.company);
    const catalog = {
      plans: PLAN_IDS.map((id) => ({ id, name: PLANS[id].name, monthlyCents: PLANS[id].monthlyCents, positioning: PLANS[id].positioning, summary: PLANS[id].summary })),
      bothInclude: [...BOTH_PLANS_INCLUDE],
      agents: AGENT_IDS.map((agent) => ({ agent, name: AGENT_CATALOG[agent].name, department: AGENT_CATALOG[agent].department, released: agentReleased(agent), operate: planIncludesAgent("operate", agent), expand: planIncludesAgent("expand", agent), here: agentVerdict(ctx.company, agent).ok })),
      features: (Object.keys(PLAN_FEATURES) as PlanFeature[]).map((feature) => ({ feature, name: PLAN_FEATURES[feature].name, built: PLAN_FEATURES[feature].built, expandOnly: !planIncludesFeature("operate", feature), here: plan ? planIncludesFeature(plan, feature) && PLAN_FEATURES[feature].built : false })),
    };
    if (!state.connected) return { connected: false as const, message: state.message, plan, catalog };
    const account = await accountFor(ctx, ctx.companyId, state.env);
    const now = Date.now();
    const periodStart = account?.credits?.nextResetAt ? new Date(account.credits.nextResetAt).setUTCMonth(new Date(account.credits.nextResetAt).getUTCMonth() - 1) : Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1);
    const executions = await ctx.db
      .query("aiExecutions")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId).gte("createdAt", Math.min(periodStart, now - PROBLEMS_PER_MONTH)))
      .order("desc")
      .take(2000);
    const inPeriod = executions.filter((row) => row.createdAt >= periodStart && row.env === state.env);
    const usage = new Map<string, { agent: string; task: string; label: string; units: number; credits: number }>();
    for (const row of inPeriod) {
      if (row.state !== "completed") continue;
      const key = `${row.agent}:${row.task}`;
      const entry = usage.get(key) ?? { agent: agentName(row.agent), task: row.task, label: TASKS[row.task].label, units: 0, credits: 0 };
      entry.units += row.completedUnits ?? 0;
      entry.credits += row.charged ?? 0;
      usage.set(key, entry);
    }
    const intents = await ctx.db
      .query("billingIntents")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(5);
    return {
      connected: true as const,
      env: state.env,
      problem: state.problem,
      rateCard: state.card ? { version: state.card.version, fixture: state.card.fixture, rates: TASKS_LIST.map((task) => ({ task, label: TASKS[task].label, unit: TASKS[task].unit, available: TASKS[task].available, credits: state.card!.rates[task] })) } : null,
      plan,
      catalog,
      account: account
        ? {
            plan: account.plan,
            subscription: account.subscription,
            credits: account.credits,
            reserved: inPeriod.filter((row) => ACTIVE_STATES.has(row.state)).reduce((sum, row) => sum + row.credits, 0),
            controls: account.controls,
            notices: account.notices,
            invoices: account.invoices,
            syncedAt: account.syncedAt,
            syncProblem: account.syncProblem ?? null,
          }
        : null,
      usage: [...usage.values()].sort((a, b) => b.credits - a.credits),
      recent: executions.slice(0, 25).map((row) => ({ id: row._id, at: row.createdAt, agent: agentName(row.agent), task: TASKS[row.task].label, units: row.completedUnits ?? row.units, credits: row.charged ?? (ACTIVE_STATES.has(row.state) ? row.credits : 0), state: row.state, settlement: row.settlement, block: row.block ? BLOCK_WORDS[row.block] : null, rateCard: row.rateCardVersion, source: row.source ?? null })),
      topUps: { packs: topUpPacks(), validity: "Purchased credits are used after the month's included credits run out. They do not reset or expire on a date, and can be used only while the company has an active plan.", consumption: "Included credits first, then purchased credits." },
      pendingIntent: intents.find((row) => row.stage === "previewing" || row.stage === "awaiting_confirmation" || row.stage === "submitting" || row.stage === "payment_needed")?._id ?? null,
    };
  },
});

const TASKS_LIST = Object.keys(TASKS) as (keyof typeof TASKS)[];

function agentName(agent: Doc<"aiExecutions">["agent"]): string {
  return agent === "chat" ? "Company Chat" : agent === "studio" ? "Marketing · Creative Studio" : AGENT_CATALOG[agent].name;
}
