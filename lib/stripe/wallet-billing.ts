import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePlatformCustomer } from "./platform-customer";

// The wallet and the SaaS subscription bill ONE platform customer + one saved
// card. The canonical implementation lives in ./platform-customer (Prompt 30).
export { ensurePlatformCustomer };

/** SetupIntent client secret so the tenant can save a card (Elements on the client). */
export async function createWalletSetupIntent(orgId: string): Promise<string> {
  const customerId = await ensurePlatformCustomer(orgId);
  const stripe = await getStripe();
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

  const stripe = await getStripe();
  await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  await admin
    .from("wallets")
    .update({ stripe_payment_method_id: paymentMethodId })
    .eq("organization_id", orgId);
}
