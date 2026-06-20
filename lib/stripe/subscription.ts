import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePlatformCustomer } from "./platform-customer";
import { ensurePlanPrice } from "./saas-catalog";

/** Start (or switch) a tenant's SaaS subscription on the PLATFORM account (flow 1). */
export async function startSubscription(orgId: string, planId: string) {
  const admin = createAdminClient();

  // self-provisioning: create the Product/Price on first use, cache the ids.
  let priceId: string;
  try {
    priceId = await ensurePlanPrice(planId);
  } catch {
    return { error: "plan_not_configured" as const };
  }

  const customerId = await ensurePlatformCustomer(orgId);
  const stripe = await getStripe();

  // reuse the one platform card (shared with the SMS wallet) so the subscription
  // has a payment method the moment the trial ends — no separate card capture.
  const { data: wallet } = await admin
    .from("wallets")
    .select("stripe_payment_method_id")
    .eq("organization_id", orgId)
    .maybeSingle();
  const savedPm =
    (wallet as { stripe_payment_method_id?: string | null } | null)
      ?.stripe_payment_method_id ?? undefined;

  // If the org already has a live subscription, SWITCH the price in place with
  // proration instead of creating a second (double-billing) subscription.
  const { data: orgRow } = await admin
    .from("organizations")
    .select("platform_subscription_id, subscription_status")
    .eq("id", orgId)
    .maybeSingle();
  const existingSubId = (
    orgRow as { platform_subscription_id?: string | null } | null
  )?.platform_subscription_id;
  const existingStatus = (
    orgRow as { subscription_status?: string | null } | null
  )?.subscription_status;

  if (
    existingSubId &&
    (existingStatus === "active" || existingStatus === "trialing")
  ) {
    const current = await stripe.subscriptions.retrieve(existingSubId);
    const itemId = current.items.data[0]?.id;
    const updated = await stripe.subscriptions.update(existingSubId, {
      items: itemId
        ? [{ id: itemId, price: priceId }]
        : [{ price: priceId }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
      metadata: { organization_id: orgId, scope: "platform_saas" },
    });
    const uAny = updated as unknown as {
      status: string;
      current_period_end?: number | null;
    };
    await admin
      .from("organizations")
      .update({
        subscription_plan_id: planId,
        subscription_status: uAny.status === "trialing" ? "trialing" : "active",
        current_period_end: uAny.current_period_end
          ? new Date(uAny.current_period_end * 1000).toISOString()
          : null,
      })
      .eq("id", orgId);
    return {
      ok: true as const,
      subscriptionId: existingSubId,
      clientSecret: null,
      status: uAny.status,
      switched: true as const,
    };
  }

  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    ...(savedPm ? { default_payment_method: savedPm } : {}),
    trial_period_days: 14,
    expand: ["latest_invoice.payment_intent", "pending_setup_intent"],
    metadata: { organization_id: orgId, scope: "platform_saas" },
  });

  // SDK type churn: current_period_end / latest_invoice.payment_intent read loosely.
  const subAny = sub as unknown as {
    status: string;
    trial_end?: number | null;
    current_period_end?: number | null;
    latest_invoice?: { payment_intent?: { client_secret?: string | null } };
    pending_setup_intent?: { client_secret?: string | null } | null;
  };
  // During a trial there's no $0 invoice PaymentIntent; Stripe hands back a
  // pending_setup_intent to collect the card that bills when the trial ends.
  const clientSecret =
    subAny.latest_invoice?.payment_intent?.client_secret ??
    subAny.pending_setup_intent?.client_secret ??
    null;

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
    clientSecret,
    status: subAny.status,
    needsCard: !savedPm,
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
