/**
 * May this work run? Five questions, asked separately and answered in words, so a person can tell a plan
 * limit from an unreleased agent, an empty balance, a missing connection, their own role, or Autumn being
 * unreachable:
 *
 *   1. released      the agent or feature exists (catalog.ts), whatever anyone pays
 *   2. plan          the company's verified plan includes it (the copy of Autumn's record)
 *   3. permission    the person's role allows it (checked by the caller, which knows the action)
 *   4. credits       Autumn holds enough credits for it (only at reservation, in an action)
 *   5. integration   what it needs is connected (checked by the caller)
 *
 * Tenant isolation and roles never depend on billing: they are checked before any of this, by the
 * access builders, whether or not Autumn is reachable.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { autumnConfig, type AutumnEnv } from "./autumn";
import { AGENT_CATALOG, agentReleased, PLAN_FEATURES, planIncludesAgent, planIncludesFeature, PLANS, type AgentId, type PlanFeature, type PlanId } from "./catalog";
import { activeRateCard, priceOf, TASKS, withinSpec, type RateCard, type Task, type Variant } from "./rateCards";
import type { Block } from "./schema";

export type Verdict = { ok: true } | { ok: false; block: Block; message: string };
const no = (block: Block, message: string): Verdict => ({ ok: false, block, message });

/** The Autumn customer id for a company: derived here, on the server, from the company id alone. */
export function customerIdFor(companyId: Id<"companies">): string {
  return `company_${companyId}`;
}

/** The company's verified plan: what billing sync last copied from Autumn. Retired staff-set values grant nothing. */
export function verifiedPlan(company: Pick<Doc<"companies">, "plan">): PlanId | null {
  return company.plan === "operate" || company.plan === "expand" ? company.plan : null;
}

export type BillingState =
  | { connected: false; message: string }
  | { connected: true; env: AutumnEnv; card: RateCard | null; problem: string | null };

/** Whether this deployment can charge for AI work at all, and with which rate card. */
export function billingState(): BillingState {
  const config = autumnConfig();
  if (!config) return { connected: false, message: "AI work is paused while billing is being set up." };
  const card = activeRateCard();
  if (!card) return { connected: true, env: config.env, card: null, problem: "No rate card is selected (BILLING_RATE_CARD), so AI work cannot be priced." };
  if (card.fixture && config.env === "production") return { connected: true, env: config.env, card: null, problem: "The selected rate card holds test values and cannot be used with a live billing key." };
  return { connected: true, env: config.env, card, problem: null };
}

export async function accountFor(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, env: AutumnEnv): Promise<Doc<"billingAccounts"> | null> {
  return ctx.db
    .query("billingAccounts")
    .withIndex("by_company_env", (q) => q.eq("companyId", companyId).eq("env", env))
    .unique();
}

/** Questions 1 and 2 for an agent. A paid plan never makes an unreleased agent available. */
export function agentVerdict(company: Pick<Doc<"companies">, "plan">, agent: AgentId): Verdict {
  const name = AGENT_CATALOG[agent].name;
  if (!agentReleased(agent)) return no("not_released", `${name} is not released yet. No plan or purchase makes it available before then.`);
  const plan = verifiedPlan(company);
  if (!plan) return no("plan", `${name} needs an active Operate or Expand plan.`);
  if (!planIncludesAgent(plan, agent)) return no("plan", `${name} is part of the Expand plan. This company is on ${PLANS[plan].name}.`);
  return { ok: true };
}

/** Questions 1 and 2 for a platform feature that differs by plan. */
export function featureVerdict(company: Pick<Doc<"companies">, "plan">, feature: PlanFeature): Verdict {
  const entry = PLAN_FEATURES[feature];
  if (!entry.built) return no("not_released", `${entry.name} is not available yet. No plan or purchase makes it available before then.`);
  const plan = verifiedPlan(company);
  if (!plan) return no("plan", `${entry.name} needs an active Expand plan.`);
  if (!planIncludesFeature(plan, feature)) return no("plan", `${entry.name} is part of the Expand plan. This company is on ${PLANS[plan].name}.`);
  return { ok: true };
}

/** Whether a task can be priced right now, and at what. */
export function pricing(task: Task, units: number, variant: Variant = {}): { ok: true; card: RateCard; env: AutumnEnv; rate: number; credits: number } | { ok: false; block: Block; message: string } {
  const state = billingState();
  if (!state.connected) return no("not_connected", state.message) as { ok: false; block: Block; message: string };
  if (!state.card) return no("not_approved", state.problem ?? "AI work cannot be priced yet.") as { ok: false; block: Block; message: string };
  if (!TASKS[task].available) return no("not_released", `${TASKS[task].label} is not available yet.`) as { ok: false; block: Block; message: string };
  if (!withinSpec(state.card, task, variant)) return no("not_approved", `${state.card.specs?.[task]?.describe ?? "This setup"} Other settings have no published credit price yet, so this cannot run.`) as { ok: false; block: Block; message: string };
  const credits = priceOf(state.card, task, units, variant);
  const rate = priceOf(state.card, task, 1, variant);
  if (credits === null || rate === null) return no("not_approved", `The credit price for ${TASKS[task].label.toLowerCase()} has not been approved yet, so it cannot run.`) as { ok: false; block: Block; message: string };
  return { ok: true, card: state.card, env: state.env, rate, credits };
}

/** Words for each kind of block, for screens that only have the kind. */
export const BLOCK_WORDS: Record<Block, string> = {
  not_connected: "Billing is not connected",
  not_approved: "Credit prices are not approved yet",
  not_released: "Not released yet",
  plan: "Not in this plan",
  permission: "Your role cannot do this",
  credits: "Out of credits",
  integration: "Needs a connection",
  billing_unavailable: "Billing is unreachable right now",
  budget: "Over the spending limit",
  needs_authorization: "Needs the Owner's go-ahead",
};
