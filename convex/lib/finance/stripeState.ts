/**
 * Where the company's Stripe connection stands, in one word the pages can trust:
 *  not_available  Selestial's own Stripe settings are missing on this deployment. Nobody can connect yet.
 *  not_connected  the company has not started.
 *  onboarding     an account exists and Stripe still needs details before it can take payments.
 *  active         Stripe says the account can take payments.
 *  restricted     Stripe has paused payments until it gets something.
 *  disconnected   the connection was removed; the history stays.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { stripeConfig } from "./stripe";

export type StripeState = "not_available" | "not_connected" | "onboarding" | "active" | "restricted" | "disconnected";

export async function currentStripeAccount(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">): Promise<Doc<"stripeAccounts"> | null> {
  const rows = await ctx.db
    .query("stripeAccounts")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(5);
  return rows.find((row) => row.status !== "disconnected") ?? rows[0] ?? null;
}

export async function stripeState(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">) {
  const config = stripeConfig();
  const row = await currentStripeAccount(ctx, companyId);
  const state: StripeState = !config ? "not_available" : !row ? "not_connected" : row.status;
  // An account made in test mode never takes real money, and a live key can't use it.
  const modeMismatch = Boolean(config && row && row.status !== "disconnected" && row.livemode !== config.livemode);
  return {
    state: modeMismatch ? ("not_connected" as StripeState) : state,
    testMode: config ? !config.livemode : false,
    canPayByCard: !modeMismatch && state === "active" && Boolean(config?.publishableKey),
    businessName: row?.businessName ?? null,
    payoutsEnabled: row?.payoutsEnabled ?? false,
    requirementsDue: row?.requirementsDue ?? 0,
    problem: row?.problem ?? null,
    checkedAt: row?.checkedAt ?? null,
    onboarding: row?.onboarding ? { state: row.onboarding.state, url: row.onboarding.state === "ready" && (row.onboarding.expiresAt ?? 0) > Date.now() ? (row.onboarding.url ?? null) : null, problem: row.onboarding.problem ?? null, requestedAt: row.onboarding.requestedAt } : null,
  };
}
