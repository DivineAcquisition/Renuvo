"use server";

import { cookies } from "next/headers";
import { getPortalSession, PORTAL_COOKIE } from "@/lib/portal/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { getPublishableKey } from "@/lib/stripe/publishable";
import { captureError } from "@/lib/observability/logger";

async function sessionOrNull() {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  return getPortalSession(token);
}

async function billing(orgId: string, customerId: string) {
  const admin = createAdminClient();
  const [{ data: org }, { data: plan }] = await Promise.all([
    admin
      .from("organizations")
      .select("stripe_account_id")
      .eq("id", orgId)
      .single(),
    admin
      .from("recurring_plans")
      .select("id, stripe_subscription_id, stripe_customer_id")
      .eq("organization_id", orgId)
      .eq("customer_id", customerId)
      .in("status", ["active", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    acct: (org as { stripe_account_id?: string | null } | null)
      ?.stripe_account_id,
    plan,
  };
}

/**
 * SetupIntent on the TENANT's connected account so the homeowner can enter a new
 * card via Stripe Elements. Card data goes straight to Stripe; Renuvo only ever
 * handles the resulting payment-method id.
 */
export async function startCardUpdate() {
  const s = await sessionOrNull();
  if (!s) return { error: "no_session" };
  const { acct, plan } = await billing(s.orgId, s.customerId);
  if (!acct || !plan?.stripe_customer_id) return { error: "not_billable" };
  try {
    const stripe = await getStripe();
    const si = await stripe.setupIntents.create(
      {
        customer: plan.stripe_customer_id,
        usage: "off_session",
        payment_method_types: ["card"],
      },
      { stripeAccount: acct }
    );
    return {
      ok: true as const,
      clientSecret: si.client_secret,
      stripeAccount: acct,
      publishableKey: await getPublishableKey(),
    };
  } catch (e) {
    captureError(e, { orgId: s.orgId, event: "portal_card_setup_failed" });
    return { error: "stripe_error" };
  }
}

/** After Elements confirms the SetupIntent, set the new PM as the sub default. */
export async function finishCardUpdate(paymentMethodId: string) {
  const s = await sessionOrNull();
  if (!s) return { error: "no_session" };
  const { acct, plan } = await billing(s.orgId, s.customerId);
  if (!acct || !plan?.stripe_subscription_id) return { error: "no_plan" };
  try {
    const stripe = await getStripe();
    await stripe.subscriptions.update(
      plan.stripe_subscription_id,
      { default_payment_method: paymentMethodId },
      { stripeAccount: acct }
    );
    const admin = createAdminClient();
    await admin.from("plan_change_log").insert({
      organization_id: s.orgId,
      recurring_plan_id: plan.id,
      actor_kind: "customer",
      change_type: "payment",
      new_value: { updated: true },
    });
    return { ok: true as const };
  } catch (e) {
    captureError(e, { orgId: s.orgId, event: "portal_card_finish_failed" });
    return { error: "stripe_error" };
  }
}
