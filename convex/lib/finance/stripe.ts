/**
 * Stripe's REST API, called directly for Finance (Stripe Connect, https://docs.stripe.com/connect/saas).
 *
 * How the money flows: each cleaning company has its own Stripe account, connected to Selestial's
 * platform. Customer payments are direct charges on the company's account (the Stripe-Account header),
 * so the money lands there, the company pays Stripe's fees and handles its own disputes, and Selestial
 * never holds funds or takes a fee. Accounts are created with the full Stripe Dashboard and Stripe as
 * the party responsible for fees and losses, and onboarded through Stripe-hosted onboarding links.
 *
 * Every call keeps the HTTP status and classifies it, like convex/lib/billing/autumn.ts:
 *   ok          2xx: Stripe answered.
 *   refused     4xx: Stripe said no, with its reason. Nothing happened.
 *   unavailable 5xx, 429, timeout or network failure. For a write this is UNCERTAIN: it may have
 *               happened. The caller marks the record "checking" and asks again with the SAME
 *               Idempotency-Key, which Stripe answers with the original result for 24 hours, or looks
 *               the object up. A write is never retried under a new key.
 *
 * Settings on the Convex deployment: STRIPE_SECRET_KEY (sk_test_… or sk_live_…, or a restricted rk_
 * key), STRIPE_PUBLISHABLE_KEY (pk_…, for the pay page) and STRIPE_CONNECT_WEBHOOK_SECRET (whsec_… of
 * the Connect webhook pointed at https://<deployment>.convex.site/webhooks/stripe). Unset: card
 * payments are unavailable and Finance says so; recording payments by hand keeps working.
 */
const BASE = "https://api.stripe.com";
const TIMEOUT_MS = 15_000;

export type StripeConfig = { secretKey: string; publishableKey: string | null; livemode: boolean };

export function stripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const test = /^(sk|rk)_test_/.test(secretKey);
  const live = /^(sk|rk)_live_/.test(secretKey);
  if (!test && !live) return null;
  const publishable = process.env.STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  const pkOk = live ? publishable.startsWith("pk_live_") : publishable.startsWith("pk_test_");
  return { secretKey, publishableKey: pkOk ? publishable : null, livemode: live };
}

let transport: typeof fetch | null = null;
/** Where requests go. Tests point this at a stand-in for Stripe; nothing else changes it. */
export function setStripeTransportForTests(next: typeof fetch | null): void {
  transport = next;
}

export type Answer<T> =
  | { kind: "ok"; data: T }
  | { kind: "refused"; status: number; code: string | null; message: string }
  | { kind: "unavailable"; status: number | null; message: string };

type Params = Record<string, unknown>;

/** Stripe's form encoding: nested objects as a[b][c]=v, arrays as a[0]=v. */
export function formEncode(params: Params, prefix = ""): string[] {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item !== null && typeof item === "object") pairs.push(...formEncode(item as Params, `${name}[${index}]`));
        else pairs.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof value === "object") {
      pairs.push(...formEncode(value as Params, name));
    } else {
      pairs.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs;
}

async function call<T>(method: "GET" | "POST", path: string, params: Params, options: { account?: string; idempotencyKey?: string } = {}): Promise<Answer<T>> {
  const config = stripeConfig();
  if (!config) return { kind: "unavailable", status: null, message: "Card payments aren’t set up for Selestial yet." };
  const body = formEncode(params).join("&");
  const url = method === "GET" && body ? `${BASE}${path}?${body}` : `${BASE}${path}`;
  let response: Response;
  try {
    response = await (transport ?? fetch)(url, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(options.account ? { "Stripe-Account": options.account } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      body: method === "POST" ? body : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable", status: null, message: "Stripe could not be reached." };
  }
  if (response.status >= 200 && response.status < 300) {
    try {
      return { kind: "ok", data: (await response.json()) as T };
    } catch {
      return { kind: "unavailable", status: response.status, message: "Stripe’s answer could not be read." };
    }
  }
  if (response.status === 429 || response.status >= 500) return { kind: "unavailable", status: response.status, message: "Stripe is busy or having a problem." };
  let code: string | null = null;
  let message = "Stripe declined the request.";
  try {
    const parsed = (await response.json()) as { error?: { code?: unknown; message?: unknown; decline_code?: unknown } };
    if (typeof parsed.error?.code === "string") code = parsed.error.code.slice(0, 80);
    if (typeof parsed.error?.message === "string") message = parsed.error.message.slice(0, 300);
  } catch {
    // Keep the plain words.
  }
  return { kind: "refused", status: response.status, code, message };
}

// ── The objects Selestial reads, reduced to the fields it uses ────────────────────────────────────

export type RawAccount = {
  id: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  business_profile?: { name?: string | null } | null;
  settings?: { dashboard?: { display_name?: string | null } } | null;
  requirements?: { currently_due?: string[] | null; past_due?: string[] | null; disabled_reason?: string | null } | null;
};

export type RawPaymentIntent = {
  id: string;
  status: "requires_payment_method" | "requires_confirmation" | "requires_action" | "processing" | "requires_capture" | "canceled" | "succeeded";
  amount: number;
  amount_received?: number;
  client_secret?: string | null;
  livemode?: boolean;
  metadata?: Record<string, string>;
  last_payment_error?: { message?: string | null; decline_code?: string | null; code?: string | null } | null;
  latest_charge?:
    | string
    | {
        id: string;
        balance_transaction?: string | { fee?: number } | null;
        payment_method_details?: { type?: string; card?: { brand?: string; last4?: string } | null; us_bank_account?: { bank_name?: string | null; last4?: string | null } | null } | null;
        disputed?: boolean;
      }
    | null;
};

export type RawRefund = { id: string; status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled"; amount: number; failure_reason?: string | null; metadata?: Record<string, string> | null };

// ── Calls ──────────────────────────────────────────────────────────────────────────────────────────

export function createAccount(input: { companyId: string; email: string; businessName: string; attempt: number }) {
  return call<RawAccount>(
    "POST",
    "/v1/accounts",
    {
      country: "US",
      email: input.email || undefined,
      business_profile: { name: input.businessName, mcc: "7349", product_description: "Residential and commercial cleaning services" },
      controller: { stripe_dashboard: { type: "full" }, fees: { payer: "account" }, losses: { payments: "stripe" }, requirement_collection: "stripe" },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { selestial_company: input.companyId },
    },
    { idempotencyKey: `selestial-account-${input.companyId}-${input.attempt}` },
  );
}

export function createAccountLink(input: { accountId: string; refreshUrl: string; returnUrl: string }) {
  return call<{ url: string; expires_at: number }>("POST", "/v1/account_links", {
    account: input.accountId,
    refresh_url: input.refreshUrl,
    return_url: input.returnUrl,
    type: "account_onboarding",
    collection_options: { fields: "eventually_due" },
  });
}

export function retrieveAccount(accountId: string) {
  return call<RawAccount>("GET", `/v1/accounts/${encodeURIComponent(accountId)}`, {});
}

export function createPaymentIntent(input: {
  accountId: string;
  paymentId: string;
  invoiceId: string;
  companyId: string;
  amountCents: number;
  description: string;
  receiptEmail?: string;
}) {
  return call<RawPaymentIntent>(
    "POST",
    "/v1/payment_intents",
    {
      amount: input.amountCents,
      currency: "usd",
      automatic_payment_methods: { enabled: true },
      description: input.description,
      receipt_email: input.receiptEmail,
      metadata: { selestial_payment: input.paymentId, selestial_invoice: input.invoiceId, selestial_company: input.companyId },
    },
    // The same key on every try for this payment: Stripe answers a repeat with the first result.
    { account: input.accountId, idempotencyKey: `selestial-payment-${input.paymentId}` },
  );
}

export function retrievePaymentIntent(accountId: string, paymentIntentId: string) {
  return call<RawPaymentIntent>("GET", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`, { expand: ["latest_charge.balance_transaction"] }, { account: accountId });
}

/** Stops a payment the customer never finished, so it cannot be completed later for an amount no longer owed. */
export function cancelPaymentIntent(accountId: string, paymentIntentId: string, paymentId: string) {
  return call<RawPaymentIntent>("POST", `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`, {}, { account: accountId, idempotencyKey: `selestial-cancel-${paymentId}` });
}

export function createRefund(input: { accountId: string; paymentIntentId: string; refundId: string; amountCents: number }) {
  return call<RawRefund>(
    "POST",
    "/v1/refunds",
    { payment_intent: input.paymentIntentId, amount: input.amountCents, metadata: { selestial_refund: input.refundId } },
    { account: input.accountId, idempotencyKey: `selestial-refund-${input.refundId}` },
  );
}

export function retrieveRefund(accountId: string, refundId: string) {
  return call<RawRefund>("GET", `/v1/refunds/${encodeURIComponent(refundId)}`, {}, { account: accountId });
}

/** The refunds on one payment, to find one whose creation answer was lost after Stripe stopped replaying it. */
export function listRefunds(accountId: string, paymentIntentId: string) {
  return call<{ data: RawRefund[] }>("GET", "/v1/refunds", { payment_intent: paymentIntentId, limit: 100 }, { account: accountId });
}

// ── Reading Stripe's objects into plain facts ────────────────────────────────────────────────────

const DISABLED_WORDS: Record<string, string> = {
  "requirements.past_due": "Stripe needs more information before payments can continue.",
  "requirements.pending_verification": "Stripe is checking the information you gave.",
  rejected: "Stripe closed this account.",
  under_review: "Stripe is reviewing this account.",
  listed: "Stripe is reviewing this account.",
  platform_paused: "Payments are paused for this account.",
};

export function accountFacts(account: RawAccount) {
  const due = new Set([...(account.requirements?.currently_due ?? []), ...(account.requirements?.past_due ?? [])]);
  const reason = account.requirements?.disabled_reason ?? null;
  const problem = reason ? (DISABLED_WORDS[reason] ?? (reason.startsWith("rejected") ? DISABLED_WORDS.rejected : "Stripe has paused payments on this account.")) : undefined;
  const chargesEnabled = account.charges_enabled === true;
  const detailsSubmitted = account.details_submitted === true;
  return {
    chargesEnabled,
    payoutsEnabled: account.payouts_enabled === true,
    detailsSubmitted,
    requirementsDue: due.size,
    problem,
    businessName: account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? undefined,
    status: (chargesEnabled ? (due.size > 0 && reason ? "restricted" : "active") : detailsSubmitted ? "restricted" : "onboarding") as "active" | "restricted" | "onboarding",
  };
}

const BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

export type PaymentFacts = {
  status: "awaiting_customer" | "processing" | "succeeded" | "failed" | "canceled";
  receivedCents: number;
  feeCents?: number;
  methodLabel?: string;
  method: "card" | "bank_debit";
  problem?: string;
  disputed: boolean;
};

export function paymentFacts(intent: RawPaymentIntent): PaymentFacts {
  const charge = typeof intent.latest_charge === "object" && intent.latest_charge ? intent.latest_charge : null;
  const details = charge?.payment_method_details ?? null;
  const fee = charge && typeof charge.balance_transaction === "object" && charge.balance_transaction ? charge.balance_transaction.fee : undefined;
  const method = details?.type === "us_bank_account" ? "bank_debit" : "card";
  const methodLabel = details?.card?.last4
    ? `${BRANDS[details.card.brand ?? ""] ?? "Card"} ending ${details.card.last4}`
    : details?.us_bank_account?.last4
      ? `${details.us_bank_account.bank_name ?? "Bank account"} ending ${details.us_bank_account.last4}`
      : undefined;
  const failure = intent.last_payment_error ? (intent.last_payment_error.message ?? "The payment was declined.").slice(0, 200) : undefined;
  let status: PaymentFacts["status"];
  switch (intent.status) {
    case "succeeded":
      status = "succeeded";
      break;
    case "processing":
      status = "processing";
      break;
    case "canceled":
      status = "canceled";
      break;
    case "requires_payment_method":
      // Stripe sends a payment back here after a decline; with no error, the customer has not tried yet.
      status = failure ? "failed" : "awaiting_customer";
      break;
    default:
      status = "awaiting_customer";
  }
  return { status, receivedCents: intent.amount_received ?? 0, feeCents: typeof fee === "number" ? fee : undefined, methodLabel, method, problem: status === "failed" ? failure : undefined, disputed: charge?.disputed === true };
}

export function refundFacts(refund: RawRefund): { status: "pending" | "succeeded" | "failed" | "canceled"; problem?: string } {
  const status = refund.status === "requires_action" ? "pending" : refund.status;
  const problem = status === "failed" ? `Stripe could not return the money${refund.failure_reason ? ` (${refund.failure_reason.replace(/_/g, " ")})` : ""}.` : undefined;
  return { status, problem };
}

// ── Webhook signatures (https://docs.stripe.com/webhooks#verify-manually) ─────────────────────────

const TOLERANCE_S = 300;

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** True when the Stripe-Signature header was made with this endpoint's secret over this exact body, recently. */
export async function verifyStripeSignature(input: { secret: string; header: string | null; body: string; now: number }): Promise<boolean> {
  if (!input.header || !input.secret.startsWith("whsec_")) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of input.header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s.trim());
    if (key === "t" && /^\d+$/.test(value ?? "")) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(input.now / 1000 - timestamp) > TOLERANCE_S) return false;
  const expected = await hmacHex(input.secret, `${timestamp}.${input.body}`);
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  });
}

export async function signForTests(secret: string, body: string, timestampS: number): Promise<string> {
  return `t=${timestampS},v1=${await hmacHex(secret, `${timestampS}.${body}`)}`;
}

/** The parts of a webhook event Selestial uses. Everything else is read back from Stripe. */
export type StripeEvent = {
  id: string;
  type: string;
  account: string | null;
  livemode: boolean;
  objectId: string | null;
  objectType: string | null;
  paymentIntentId: string | null;
  /** On a dispute: Stripe's status word and the disputed amount. */
  disputeStatus: string | null;
  amount: number | null;
};

export function parseEvent(body: string): StripeEvent | null {
  try {
    const parsed = JSON.parse(body) as { id?: unknown; type?: unknown; account?: unknown; livemode?: unknown; data?: { object?: { id?: unknown; object?: unknown; payment_intent?: unknown; status?: unknown; amount?: unknown } } };
    if (typeof parsed.id !== "string" || typeof parsed.type !== "string") return null;
    const object = parsed.data?.object;
    const objectType = typeof object?.object === "string" ? object.object.slice(0, 50) : null;
    return {
      id: parsed.id.slice(0, 100),
      type: parsed.type.slice(0, 100),
      account: typeof parsed.account === "string" ? parsed.account.slice(0, 100) : null,
      livemode: parsed.livemode === true,
      objectId: typeof object?.id === "string" ? object.id.slice(0, 100) : null,
      objectType,
      paymentIntentId: typeof object?.payment_intent === "string" ? object.payment_intent.slice(0, 100) : null,
      disputeStatus: objectType === "dispute" && typeof object?.status === "string" ? object.status.slice(0, 40) : null,
      amount: objectType === "dispute" && typeof object?.amount === "number" && Number.isSafeInteger(object.amount) ? object.amount : null,
    };
  } catch {
    return null;
  }
}

/** Finds a payment whose creation answer was lost after Stripe stopped replaying the request (24 hours). */
export function searchPaymentIntents(accountId: string, paymentId: string) {
  return call<{ data: RawPaymentIntent[] }>("GET", "/v1/payment_intents/search", { query: `metadata['selestial_payment']:'${paymentId.replace(/[^\w]/g, "")}'`, limit: 5 }, { account: accountId });
}
