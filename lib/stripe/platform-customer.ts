import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The single Stripe customer on Renuvo's PLATFORM account for an org. Funds both
 * the SaaS subscription (flow 1) and the SMS wallet (flow 2). NOT the connected
 * account (flow 3). Reuses wallets.stripe_customer_id if it already exists, and
 * keeps the org + wallet pointers in agreement.
 */
export async function ensurePlatformCustomer(orgId: string): Promise<string> {
  const admin = createAdminClient();
  const [{ data: org }, { data: wallet }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, platform_customer_id")
      .eq("id", orgId)
      .single(),
    admin
      .from("wallets")
      .select("stripe_customer_id")
      .eq("organization_id", orgId)
      .single(),
  ]);

  const existing =
    (org as { platform_customer_id?: string | null } | null)
      ?.platform_customer_id ?? wallet?.stripe_customer_id;
  if (existing) {
    await admin
      .from("organizations")
      .update({ platform_customer_id: existing })
      .eq("id", orgId);
    await admin
      .from("wallets")
      .update({ stripe_customer_id: existing })
      .eq("organization_id", orgId);
    return existing;
  }

  const stripe = await getStripe();
  const customer = await stripe.customers.create({
    name: org?.name ?? undefined,
    metadata: { organization_id: orgId, scope: "platform" },
  });
  await admin
    .from("organizations")
    .update({ platform_customer_id: customer.id })
    .eq("id", orgId);
  await admin
    .from("wallets")
    .update({ stripe_customer_id: customer.id })
    .eq("organization_id", orgId);
  return customer.id;
}
