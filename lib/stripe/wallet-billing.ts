import { stripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

/** Ensure the org has a Stripe Customer on the PLATFORM account (for wallet billing). */
export async function ensurePlatformCustomer(orgId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: wallet } = await admin
    .from("wallets")
    .select("stripe_customer_id")
    .eq("organization_id", orgId)
    .single();

  if (wallet?.stripe_customer_id) return wallet.stripe_customer_id;

  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .single();

  const customer = await stripe.customers.create({
    name: org?.name ?? undefined,
    metadata: { organization_id: orgId },
  });

  await admin
    .from("wallets")
    .update({ stripe_customer_id: customer.id })
    .eq("organization_id", orgId);
  return customer.id;
}

/** SetupIntent client secret so the tenant can save a card (Elements on the client). */
export async function createWalletSetupIntent(orgId: string): Promise<string> {
  const customerId = await ensurePlatformCustomer(orgId);
  const si = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
  });
  return si.client_secret!;
}

/** Persist the saved card after the client confirms the SetupIntent. */
export async function saveWalletPaymentMethod(
  orgId: string,
  paymentMethodId: string
) {
  const admin = createAdminClient();
  const customerId = await ensurePlatformCustomer(orgId);

  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  await admin
    .from("wallets")
    .update({ stripe_payment_method_id: paymentMethodId })
    .eq("organization_id", orgId);
}
