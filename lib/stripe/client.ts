import Stripe from "stripe";

// Platform secret key. Used for: Connect OAuth, AND charging tenants for wallet
// reloads on the PLATFORM account. For acting on a CONNECTED account, pass
// { stripeAccount: org.stripe_account_id } per-call (Prompt 12/18).
//
// NOTE: the SDK's TS types only describe the latest API version, so the pinned
// version is cast. Pinning keeps request/response shapes stable across SDK bumps.
// The SDK's types only describe the latest API version; "2024-06-20" is a valid
// pinned version at runtime, so we bridge past the narrow literal type.
type StripeApiVersion = NonNullable<
  ConstructorParameters<typeof Stripe>[1]
>["apiVersion"];

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20" as unknown as StripeApiVersion,
});
