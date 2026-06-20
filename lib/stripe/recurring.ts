import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Lifecycle ops on a tenant's recurring subscription. These run on the
 * CONNECTED account (the homeowner pays the tenant — Prompt 20/30 boundary),
 * never the platform account.
 */
async function connectedAccount(orgId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", orgId)
    .single();
  return org?.stripe_account_id ?? null;
}

export async function pauseStripeSubscription(orgId: string, subId: string) {
  const acct = await connectedAccount(orgId);
  if (!acct) return;
  const stripe = await getStripe();
  await stripe.subscriptions.update(
    subId,
    { pause_collection: { behavior: "void" } },
    { stripeAccount: acct }
  );
}

export async function resumeStripeSubscription(orgId: string, subId: string) {
  const acct = await connectedAccount(orgId);
  if (!acct) return;
  const stripe = await getStripe();
  await stripe.subscriptions.update(
    subId,
    { pause_collection: "" as unknown as null },
    { stripeAccount: acct }
  );
}

export async function cancelStripeSubscription(orgId: string, subId: string) {
  const acct = await connectedAccount(orgId);
  if (!acct) return;
  const stripe = await getStripe();
  await stripe.subscriptions.cancel(subId, undefined, { stripeAccount: acct });
}
