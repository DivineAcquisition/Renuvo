"use server";

import { getStripe } from "@/lib/stripe/client";
import { getPublishableKey } from "@/lib/stripe/publishable";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveSignupToken } from "./token";

/**
 * Create a SetupIntent on the TENANT'S connected account so the customer's card
 * is saved as a mandate for recurring billing on that account. Returns the
 * client secret + the connected account id (Elements needs it).
 *
 * Exposed as a server action (called from the public EnrollForm client).
 */
export async function createSignupPaymentSetup(token: string) {
  const offer = await resolveSignupToken(token);
  if (!offer) return { error: "invalid_or_expired" as const };

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", offer.orgId)
    .single();
  if (!org?.stripe_account_id) return { error: "no_connected_account" as const };

  const acct = org.stripe_account_id;

  const stripe = await getStripe();
  // create a Stripe customer on the connected account
  const customer = await stripe.customers.create(
    { name: offer.firstName, metadata: { renuvo_customer_id: offer.customerId } },
    { stripeAccount: acct }
  );

  const si = await stripe.setupIntents.create(
    { customer: customer.id, payment_method_types: ["card"], usage: "off_session" },
    { stripeAccount: acct }
  );

  return {
    clientSecret: si.client_secret!,
    connectedAccountId: acct,
    stripeCustomerId: customer.id,
    publishableKey: await getPublishableKey(),
  };
}
