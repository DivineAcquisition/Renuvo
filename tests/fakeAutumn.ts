/**
 * A stand-in for Autumn's API (version 2.6.0), for tests. It keeps plans, balances and locks the way the
 * documentation describes them, and can be told to fail the ways Autumn can: unreachable, 5xx, a 202
 * "allowed fail-open", or an Idempotency-Key replay (409). Nothing reaches the network.
 */
type PlanId = "operate" | "expand";
type Lock = { customerId: string; credits: number; expiresAt: number; finalized: "confirm" | "release" | null; properties: Record<string, unknown> };
type Customer = {
  id: string;
  plan: PlanId | null;
  pastDue: boolean;
  canceledAt: number | null;
  periodEnd: number;
  scheduled: PlanId | null;
  /** Included credits this period. */
  grant: number;
  usage: number;
  purchased: number;
  purchasedUsed: number;
  cardOnFile: boolean;
  invoices: { id: string; plan_ids: string[]; status: string; total: number; currency: string; created_at: number; hosted_invoice_url: string | null }[];
};

export type Outage = "none" | "network" | "server" | "degraded";

export const GRANTS: Record<PlanId, number> = { operate: 1000, expand: 2000 };
const PRICES: Record<PlanId, number> = { operate: 299, expand: 499 };

export function fakeAutumn() {
  const state = {
    /** A customer seen for the first time starts on this plan, with a card on file. */
    defaultPlan: "expand" as PlanId | null,
    defaultGrant: 1_000_000,
    customers: new Map<string, Customer>(),
    locks: new Map<string, Lock>(),
    keys: new Set<string>(),
    outage: "none" as Outage,
    /** Only these operations fail while `outage` is set. Empty: all of them. */
    outageOps: [] as string[],
    calls: [] as { path: string; body: Record<string, unknown>; key: string | null }[],
    /** Balance history entries; null answers 404, as for a customer without history yet. */
    ledger: null as unknown[] | null,
    topUpPrice: 0.01,
  };
  const grantOf = (customer: Customer) => (customer.plan ? customer.grant : 0);
  const held = (customerId: string) => [...state.locks.values()].filter((lock) => lock.customerId === customerId && lock.finalized === null && lock.expiresAt > Date.now()).reduce((sum, lock) => sum + lock.credits, 0);
  const remaining = (customer: Customer) => grantOf(customer) + customer.purchased - customer.usage - customer.purchasedUsed - held(customer.id);
  const customerFor = (id: string): Customer => {
    let customer = state.customers.get(id);
    if (!customer) {
      customer = { id, plan: state.defaultPlan, pastDue: false, canceledAt: null, periodEnd: Date.now() + 20 * 86_400_000, scheduled: null, grant: state.defaultGrant, usage: 0, purchased: 0, purchasedUsed: 0, cardOnFile: true, invoices: [] };
      state.customers.set(id, customer);
    }
    return customer;
  };
  /** Sets up a customer for a company before it is first seen. */
  const seed = (companyId: string, fields: Partial<Customer>) => {
    const id = `company_${companyId}`;
    const customer = { ...customerFor(id), ...fields };
    state.customers.set(id, customer);
    return customer;
  };
  const balance = (customer: Customer) => {
    const grant = grantOf(customer);
    const included = Math.max(0, grant - customer.usage);
    return {
      feature_id: "selestial_credits",
      granted: grant + customer.purchased,
      remaining: remaining(customer),
      usage: customer.usage + customer.purchasedUsed,
      unlimited: false,
      next_reset_at: customer.periodEnd,
      breakdown: [
        ...(customer.plan ? [{ plan_id: customer.plan, included_grant: grant, prepaid_grant: 0, remaining: included, usage: customer.usage, reset: { interval: "month", resets_at: customer.periodEnd }, expires_at: null }] : []),
        ...(customer.purchased ? [{ plan_id: "credit_top_up", included_grant: 0, prepaid_grant: customer.purchased, remaining: customer.purchased - customer.purchasedUsed, usage: customer.purchasedUsed, reset: { interval: "one_off", resets_at: null }, expires_at: null }] : []),
      ],
    };
  };
  const view = (customer: Customer) => ({
    id: customer.id,
    env: "sandbox",
    subscriptions: [
      ...(customer.plan ? [{ plan_id: customer.plan, status: "active", past_due: customer.pastDue, canceled_at: customer.canceledAt, expires_at: customer.canceledAt ? customer.periodEnd : null, started_at: 1, current_period_start: customer.periodEnd - 30 * 86_400_000, current_period_end: customer.periodEnd }] : []),
      ...(customer.scheduled ? [{ plan_id: customer.scheduled, status: "scheduled", past_due: false, canceled_at: null, expires_at: null, started_at: customer.periodEnd, current_period_start: null, current_period_end: null }] : []),
    ],
    balances: { selestial_credits: customer.plan || customer.purchased ? balance(customer) : null },
    invoices: customer.invoices,
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  /** Spends credits: included first, then purchased (Autumn's documented order). */
  const spend = (customer: Customer, credits: number) => {
    const included = Math.max(0, grantOf(customer) - customer.usage);
    const fromIncluded = Math.min(included, credits);
    customer.usage += fromIncluded;
    customer.purchasedUsed += credits - fromIncluded;
  };

  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const path = url.pathname;
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    const headers = new Headers(init.headers);
    const key = headers.get("Idempotency-Key");
    state.calls.push({ path, body, key });
    if (!headers.get("Authorization")?.startsWith("Bearer am_sk_test_") || headers.get("x-api-version") !== "2.6.0") return json(401, { code: "unauthorized", message: "Bad key" });
    const failing = state.outage !== "none" && (state.outageOps.length === 0 || state.outageOps.includes(path));
    if (failing && state.outage === "network") throw new TypeError("fetch failed");
    if (failing && state.outage === "server") return json(503, { code: "service_unavailable", message: "Down" });
    if (key) {
      if (state.keys.has(key)) return json(409, { code: "duplicate_request", message: "Duplicate" });
      state.keys.add(key);
    }
    const customerId = String(body.customer_id ?? "");
    switch (path) {
      case "/v1/customers.get_or_create":
      case "/v1/customers.get":
        return json(200, view(customerFor(customerId)));
      case "/v1/balances.check": {
        const customer = customerFor(customerId);
        const want = Number(body.required_balance ?? 1);
        const lock = body.lock as { lock_id: string; expires_at: number } | undefined;
        if (failing && state.outage === "degraded") return json(202, { allowed: true, customer_id: customerId, balance: null });
        const allowed = customer.plan !== null && remaining(customer) >= want;
        if (allowed && lock) state.locks.set(lock.lock_id, { customerId, credits: want, expiresAt: lock.expires_at, finalized: null, properties: (body.properties as Record<string, unknown>) ?? {} });
        return json(200, { allowed, customer_id: customerId, balance: balance(customer) });
      }
      case "/v1/balances.finalize": {
        if (failing && state.outage === "degraded") return json(202, { success: true });
        const lock = state.locks.get(String(body.lock_id));
        if (!lock || lock.customerId !== customerId || lock.finalized !== null || lock.expiresAt <= Date.now()) return json(404, { code: "lock_not_found", message: "No such lock" });
        lock.finalized = body.action === "confirm" ? "confirm" : "release";
        if (lock.finalized === "confirm") spend(customerFor(customerId), body.override_value === undefined ? lock.credits : Number(body.override_value));
        return json(200, { success: true });
      }
      case "/v1/billing.preview_attach": {
        const customer = customerFor(customerId);
        const plan = body.plan_id as string;
        if (plan === "credit_top_up") {
          const quantity = Number((body.feature_quantities as { quantity: number }[])[0].quantity);
          return json(200, { currency: "usd", total: quantity * state.topUpPrice, subtotal: quantity * state.topUpPrice, line_items: [{ display_name: "Credit top-up", total: quantity * state.topUpPrice }], plan_activates: "on_payment", incoming: [{ plan_id: plan, effective_at: null }] });
        }
        const target = plan as PlanId;
        const downgrade = customer.plan === "expand" && target === "operate";
        const due = downgrade ? 0 : customer.plan ? PRICES[target] - PRICES[customer.plan] : PRICES[target];
        return json(200, { currency: "usd", total: due, subtotal: due, line_items: [{ display_name: `${target} plan`, total: due }], next_cycle: { starts_at: customer.periodEnd, total: PRICES[target] }, plan_activates: downgrade ? "on_finalize" : "on_payment", resets_usage: false, incoming: [{ plan_id: target, effective_at: downgrade ? customer.periodEnd : null }] });
      }
      case "/v1/billing.attach": {
        const customer = customerFor(customerId);
        const plan = body.plan_id as string;
        if (!customer.cardOnFile) return json(200, { customer_id: customerId, payment_url: "https://checkout.stripe.test/session", required_action: { code: "payment_method_required", reason: "Add a card." } });
        if (plan === "credit_top_up") {
          customer.purchased += Number((body.feature_quantities as { quantity: number }[])[0].quantity);
          return json(200, { customer_id: customerId, payment_url: null });
        }
        const target = plan as PlanId;
        if (body.plan_schedule === "end_of_cycle") customer.scheduled = target;
        else {
          // carry_over_usages keeps what was used this cycle; without it the new plan would start from zero.
          const carry = (body.carry_over_usages as { enabled: boolean } | undefined)?.enabled === true;
          customer.plan = target;
          customer.grant = GRANTS[target];
          if (!carry) customer.usage = 0;
          customer.invoices.push({ id: `inv_${customer.invoices.length + 1}`, plan_ids: [target], status: "paid", total: PRICES[target], currency: "usd", created_at: Date.now(), hosted_invoice_url: "https://invoice.stripe.test/1" });
        }
        return json(200, { customer_id: customerId, payment_url: null });
      }
      case "/v1/billing.update": {
        const customer = customerFor(customerId);
        if (body.cancel_action === "cancel_end_of_cycle") customer.canceledAt = Date.now();
        if (body.cancel_action === "uncancel") {
          customer.canceledAt = null;
          customer.scheduled = null;
        }
        return json(200, { customer_id: customerId, payment_url: null });
      }
      case "/v1/billing.open_customer_portal":
        return json(200, { customer_id: customerId, url: "https://billing.stripe.test/portal" });
      case "/v1/balances.list_ledger":
        return state.ledger ? json(200, { list: state.ledger, has_more: false, next_cursor: null }) : json(404, { code: "not_found", message: "No history" });
      case "/v1/billing.setup_payment":
        return json(200, { customer_id: customerId, url: "https://checkout.stripe.test/setup" });
      default:
        return json(404, { code: "not_found", message: path });
    }
  }) as typeof globalThis.fetch;

  return { state, fetch, seed, customerFor, remaining, held };
}
