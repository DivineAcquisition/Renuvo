import Stripe from "stripe";

// Platform secret key. Used for: Connect OAuth, AND charging tenants for wallet
// reloads on the PLATFORM account. For acting on a CONNECTED account, pass
// { stripeAccount: org.stripe_account_id } per-call (Prompt 12/18).
//
// IMPORTANT: the client is created LAZILY (on first use), never at import time.
// If we instantiated at module load, a missing STRIPE_SECRET_KEY would throw
// during `next build` (page-data collection imports this module), failing the
// whole production deploy even on pages that never touch Stripe. Lazy init keeps
// the app deployable before Stripe is configured; calls only fail when actually
// used without a key.
//
// The SDK's TS types only describe the latest API version, so the pinned version
// is bridged past the narrow literal type. Pinning keeps shapes stable.
type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>["apiVersion"];

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error(
        "STRIPE_SECRET_KEY is not set. Add it (from your Stripe account) in the environment before using Stripe features."
      );
    }
    _stripe = new Stripe(key, {
      apiVersion: "2024-06-20" as unknown as StripeApiVersion,
    });
  }
  return _stripe;
}

// Proxy preserves the `stripe.resource.method(...)` call surface used across the
// codebase while deferring construction until the first property access.
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    const client = getStripe();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
