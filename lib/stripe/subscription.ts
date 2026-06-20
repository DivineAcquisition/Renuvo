import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePlatformCustomer } from "./platform-customer";

/** Start a tenant's SaaS subscription on the PLATFORM account (flow 1). */
export async function startSubscription(orgId: string, planId: string) {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("subscription_plans")
    .select("stripe_price_id, price_cents, currency, name")
    .eq("id", planId)
    .single();
  if (!plan?.stripe_price_id) return { error: "plan_not_configured" as const };

  const customerId = await ensurePlatformCustomer(orgId);
  const stripe = await getStripe();

  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: plan.stripe_price_id }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    trial_period_days: 14,
    expand: ["latest_invoice.payment_intent"],
    metadata: { organization_id: orgId, scope: "platform_saas" },
  });

  // SDK type churn: current_period_end / latest_invoice.payment_intent read loosely.
  const subAny = sub as unknown as {
    status: string;
    trial_end?: number | null;
    current_period_end?: number | null;
    latest_invoice?: { payment_intent?: { client_secret?: string | null } };
  };

  await admin
    .from("organizations")
    .update({
      subscription_plan_id: planId,
      platform_subscription_id: sub.id,
      subscription_status: subAny.status === "trialing" ? "trialing" : "active",
      trial_ends_at: subAny.trial_end
        ? new Date(subAny.trial_end * 1000).toISOString()
        : null,
      current_period_end: subAny.current_period_end
        ? new Date(subAny.current_period_end * 1000).toISOString()
        : null,
    })
    .eq("id", orgId);

  return {
    ok: true as const,
    subscriptionId: sub.id,
    clientSecret: subAny.latest_invoice?.payment_intent?.client_secret ?? null,
    status: subAny.status,
  };
}

export async function cancelSubscription(orgId: string) {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("platform_subscription_id")
    .eq("id", orgId)
    .single();
  const subId = (org as { platform_subscription_id?: string | null } | null)
    ?.platform_subscription_id;
  if (!subId) return { error: "no_subscription" as const };
  const stripe = await getStripe();
  await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
  return { ok: true as const };
}
