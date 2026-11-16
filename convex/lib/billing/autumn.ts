/**
 * Autumn's REST API, called directly (API version 2.6.0, https://docs.useautumn.com/api-reference).
 *
 * Why not the autumn-js SDK (1.6.12): the SDK fails open by default. On a 5xx, a timeout or a network
 * error its `check` answers `{ allowed: true }`, and it hides the HTTP status, so Autumn's own
 * server-side fail-open (a 202 "access was allowed fail-open" on check and finalize) looks exactly like a
 * verified answer. Selestial must never start paid AI work on an unverified answer, so every call here
 * keeps the status and classifies it:
 *
 *   ok          200: a verified answer.
 *   degraded    202 on check or finalize: Autumn let it through without verifying. Never treated as ok.
 *   replayed    409: the same Idempotency-Key was already used within 24 hours.
 *   refused     other 4xx: a problem with the request, not an outage.
 *   unavailable 5xx, 429, timeout or network failure: try again later.
 *
 * The secret key never leaves the server. Its prefix decides the environment: am_sk_test_ is the sandbox,
 * am_sk_live_ is production, and any other value is treated as not configured.
 */
import { AUTUMN } from "./catalog";

export type AutumnEnv = "sandbox" | "production";
const BASE = "https://api.useautumn.com";
const API_VERSION = "2.6.0";
const TIMEOUT_MS = 10_000;

export function autumnConfig(): { secretKey: string; env: AutumnEnv } | null {
  const secretKey = process.env.AUTUMN_SECRET_KEY?.trim() ?? "";
  if (secretKey.startsWith("am_sk_test_")) return { secretKey, env: "sandbox" };
  if (secretKey.startsWith("am_sk_live_")) return { secretKey, env: "production" };
  return null;
}

/** Where requests go. Tests point this at a stand-in for Autumn; nothing else changes it. */
let transport: typeof fetch | null = null;
export function setAutumnTransportForTests(next: typeof fetch | null): void {
  transport = next;
}

export type Answer<T> =
  | { kind: "ok"; data: T }
  | { kind: "degraded" }
  | { kind: "replayed" }
  | { kind: "refused"; status: number; code: string | null; message: string }
  | { kind: "unavailable"; status: number | null; message: string };

async function call<T>(path: string, body: Record<string, unknown>, options: { idempotencyKey?: string; degradable?: boolean } = {}): Promise<Answer<T>> {
  const config = autumnConfig();
  if (!config) return { kind: "unavailable", status: null, message: "Billing is not connected on this deployment." };
  let response: Response;
  try {
    response = await (transport ?? fetch)(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/json",
        "x-api-version": API_VERSION,
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable", status: null, message: "Autumn could not be reached." };
  }
  if (response.status === 202 && options.degradable) return { kind: "degraded" };
  if (response.status === 200 || response.status === 202) {
    try {
      return { kind: "ok", data: (await response.json()) as T };
    } catch {
      return { kind: "unavailable", status: response.status, message: "Autumn's answer could not be read." };
    }
  }
  if (response.status === 409) return { kind: "replayed" };
  let code: string | null = null;
  let message = `Autumn answered ${response.status}.`;
  try {
    const parsed = (await response.json()) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === "string") code = parsed.code.slice(0, 80);
    if (typeof parsed.message === "string") message = parsed.message.slice(0, 300);
  } catch {
    // The error body is not documented; the status is enough.
  }
  if (response.status === 429 || response.status >= 500) return { kind: "unavailable", status: response.status, message };
  return { kind: "refused", status: response.status, code, message };
}

// ── The customer, as Autumn reports it ───────────────────────────────────────────────────────────

type RawBreakdown = { plan_id: string | null; included_grant: number; prepaid_grant: number; remaining: number; usage: number; reset: { interval: string; resets_at: number | null } | null; expires_at: number | null };
type RawBalance = { feature_id: string; granted: number; remaining: number; usage: number; unlimited: boolean; next_reset_at: number | null; breakdown?: RawBreakdown[] };
type RawSubscription = { plan_id: string; status: "active" | "scheduled"; past_due: boolean; canceled_at: number | null; expires_at: number | null; started_at: number | null; current_period_start: number | null; current_period_end: number | null; add_on?: boolean };
export type RawCustomer = { id: string; env?: string; subscriptions?: RawSubscription[]; purchases?: { plan_id: string; expires_at: number | null; started_at: number | null; quantity?: number }[]; balances?: Record<string, RawBalance | null>; invoices?: RawInvoice[] };
export type RawInvoice = { id: string; plan_ids: string[]; status: string; total: number; currency: string; created_at: number; hosted_invoice_url: string | null };

export function getOrCreateCustomer(customerId: string, name: string) {
  return call<RawCustomer>("/v1/customers.get_or_create", { customer_id: customerId, name: name.slice(0, 200) });
}

export function getCustomer(customerId: string, expand: string[] = []) {
  return call<RawCustomer>("/v1/customers.get", { customer_id: customerId, ...(expand.length ? { expand } : {}) });
}

// ── Credits: lock, then finalize ─────────────────────────────────────────────────────────────────

export type CheckData = { allowed: boolean; customer_id: string; balance: RawBalance | null };

/**
 * Atomically checks and holds `credits` for one execution. The lock always carries an expiry: Autumn
 * confirms an un-expiring lock after 24 hours, which would charge for abandoned work. Overage behaviour
 * is left unset, which is Autumn's "reject": no hold unless the whole amount is there.
 */
export function lockCredits(input: { customerId: string; lockId: string; credits: number; expiresAt: number; properties: Record<string, string | number> }) {
  return call<CheckData>(
    "/v1/balances.check",
    {
      customer_id: input.customerId,
      feature_id: AUTUMN.credits,
      required_balance: input.credits,
      send_event: true,
      properties: input.properties,
      lock: { enabled: true, lock_id: input.lockId, expires_at: input.expiresAt },
    },
    { idempotencyKey: `lock:${input.lockId}`, degradable: true },
  );
}

/** Confirms (optionally for less than was held) or releases a lock. Safe to repeat: a replay answers `replayed`. */
export function finalizeLock(input: { customerId: string; lockId: string; action: "confirm" | "release"; credits?: number }) {
  return call<{ success: boolean }>(
    "/v1/balances.finalize",
    { customer_id: input.customerId, lock_id: input.lockId, action: input.action, ...(input.action === "confirm" && input.credits !== undefined ? { override_value: input.credits } : {}) },
    { idempotencyKey: `${input.action}:${input.lockId}`, degradable: true },
  );
}

// ── Plans, top-ups and the billing portal ────────────────────────────────────────────────────────

export type AttachData = { customer_id: string; payment_url: string | null; required_action?: { code: string; reason?: string }; invoice?: { status: string; total: number; currency: string; hosted_invoice_url: string | null } };
export type PreviewData = {
  currency: string;
  total: number;
  subtotal: number;
  line_items: { display_name?: string; description?: string; total: number }[];
  next_cycle?: { starts_at: number; total: number } | null;
  plan_activates?: "now" | "on_finalize" | "on_payment";
  resets_usage?: boolean;
  incoming?: { plan_id: string; effective_at: number | null }[];
  outgoing?: { plan_id: string; effective_at: number | null }[];
  requires_payment_method?: boolean;
  redirect_to_checkout?: boolean;
};

/**
 * The body for a plan change or a top-up. On every plan change, usage so far this cycle carries over to
 * the new plan's allowance, so switching plans can never hand out a fresh allowance.
 */
export function attachBody(input: { customerId: string; planId: string; successUrl: string; quantity?: number; schedule?: "immediate" | "end_of_cycle" }) {
  return {
    customer_id: input.customerId,
    plan_id: input.planId,
    success_url: input.successUrl,
    redirect_mode: "if_required",
    ...(input.quantity !== undefined ? { feature_quantities: [{ feature_id: AUTUMN.credits, quantity: input.quantity }] } : { carry_over_usages: { enabled: true, feature_ids: [AUTUMN.credits] } }),
    ...(input.schedule ? { plan_schedule: input.schedule } : {}),
  };
}

export function previewAttach(body: ReturnType<typeof attachBody>) {
  return call<PreviewData>("/v1/billing.preview_attach", body);
}

export function attach(body: ReturnType<typeof attachBody>, idempotencyKey: string) {
  return call<AttachData>("/v1/billing.attach", body, { idempotencyKey });
}

export function updateSubscription(input: { customerId: string; planId: string; cancelAction: "cancel_end_of_cycle" | "uncancel" }, idempotencyKey: string) {
  return call<AttachData>("/v1/billing.update", { customer_id: input.customerId, plan_id: input.planId, cancel_action: input.cancelAction }, { idempotencyKey });
}

export function openPortal(customerId: string, returnUrl: string) {
  return call<{ url: string }>("/v1/billing.open_customer_portal", { customer_id: customerId, return_url: returnUrl });
}

export function setupPayment(customerId: string, successUrl: string) {
  return call<{ url: string }>("/v1/billing.setup_payment", { customer_id: customerId, success_url: successUrl });
}

export function listInvoices(customerId: string) {
  return call<{ list: RawInvoice[]; next_cursor: string | null }>("/v1/invoices.list", { customer_id: customerId, limit: 24 });
}
