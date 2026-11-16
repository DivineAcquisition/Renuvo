/** Autumn's customer record, reduced to what Selestial shows and checks. Read-only: nothing here grants anything Autumn did not. */
import type { RawCustomer } from "./autumn";
import { AUTUMN, planIdFromAutumn, type PlanId } from "./catalog";

export type Projection = {
  plan: PlanId | null;
  subscription: { pastDue: boolean; startedAt: number | null; periodEnd: number | null; endsAt: number | null; scheduledPlan: PlanId | null; scheduledAt: number | null };
  credits: {
    remaining: number;
    granted: number;
    used: number;
    included: { granted: number; remaining: number };
    purchased: { granted: number; remaining: number; expiresAt: number | null };
    nextResetAt: number | null;
  } | null;
};

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const when = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export function projectCustomer(customer: RawCustomer, now: number): Projection {
  const subscriptions = (customer.subscriptions ?? []).filter((row) => planIdFromAutumn(row.plan_id) !== null);
  const active = subscriptions.find((row) => row.status === "active" && (row.expires_at === null || row.expires_at === undefined || row.expires_at > now)) ?? null;
  const scheduled = subscriptions.find((row) => row.status === "scheduled") ?? null;
  const balance = customer.balances?.[AUTUMN.credits] ?? null;
  let credits: Projection["credits"] = null;
  if (balance) {
    const rows = balance.breakdown ?? [];
    const isPurchased = (row: (typeof rows)[number]) => row.plan_id === AUTUMN.topUpPlan || row.reset === null || row.reset?.interval === "one_off" || (num(row.prepaid_grant) > 0 && num(row.included_grant) === 0);
    const purchased = rows.filter(isPurchased);
    const included = rows.filter((row) => !isPurchased(row));
    const expiries = purchased.map((row) => when(row.expires_at)).filter((value): value is number => value !== null);
    credits = {
      remaining: num(balance.remaining),
      granted: num(balance.granted),
      used: num(balance.usage),
      included: { granted: included.reduce((sum, row) => sum + num(row.included_grant), 0), remaining: included.reduce((sum, row) => sum + num(row.remaining), 0) },
      purchased: { granted: purchased.reduce((sum, row) => sum + num(row.prepaid_grant) + num(row.included_grant), 0), remaining: purchased.reduce((sum, row) => sum + num(row.remaining), 0), expiresAt: expiries.length ? Math.min(...expiries) : null },
      nextResetAt: when(balance.next_reset_at),
    };
  }
  return {
    plan: active ? planIdFromAutumn(active.plan_id) : null,
    subscription: {
      pastDue: active?.past_due === true,
      startedAt: when(active?.started_at),
      periodEnd: when(active?.current_period_end),
      endsAt: active && active.canceled_at !== null && active.canceled_at !== undefined ? (when(active.expires_at) ?? when(active.current_period_end)) : null,
      scheduledPlan: scheduled ? planIdFromAutumn(scheduled.plan_id) : null,
      scheduledAt: scheduled ? (when(scheduled.started_at) ?? when(active?.current_period_end)) : null,
    },
    credits,
  };
}
