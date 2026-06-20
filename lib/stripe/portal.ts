import { getStripe } from "@/lib/stripe/client";
import { ensurePlatformCustomer } from "./platform-customer";

let _configId: string | null = null;

/**
 * Ensure a Billing Portal configuration exists on the platform account. A fresh
 * Stripe account has none, and `billingPortal.sessions.create` then 400s — so we
 * create one (card updates, invoice history, plan cancel) and cache its id.
 */
async function ensurePortalConfig(): Promise<string> {
  if (_configId) return _configId;
  const stripe = await getStripe();

  const existing = await stripe.billingPortal.configurations.list({ limit: 1 });
  if (existing.data[0]) {
    _configId = existing.data[0].id;
    return _configId;
  }

  const cfg = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Renuvo — manage your subscription",
    },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: {
        enabled: true,
        allowed_updates: ["email", "address", "name"],
      },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
      },
    },
  });
  _configId = cfg.id;
  return _configId;
}

/**
 * Create a Stripe Billing Portal session for the tenant's PLATFORM customer so
 * they can update their card, view invoices, and cancel — without us building
 * any of that UI ourselves.
 */
export async function createBillingPortalSession(
  orgId: string,
  returnUrl: string
): Promise<{ url: string } | { error: string }> {
  try {
    const customerId = await ensurePlatformCustomer(orgId);
    const stripe = await getStripe();
    const configuration = await ensurePortalConfig();
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
      configuration,
    });
    return { url: session.url };
  } catch {
    return { error: "portal_unavailable" };
  }
}
