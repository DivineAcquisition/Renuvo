import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPayment } from "@/lib/payments/record";
import { recordFinancialEntry } from "@/lib/money/ledger";
import { fromStripeAmount } from "@/lib/money";
import { log } from "@/lib/log";
import type Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  const stripe = await getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    log.error("webhook.stripe.bad_signature");
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  log.info("webhook.stripe.received", { type: event.type });

  // Only care about successful charges on CONNECTED accounts
  if (
    event.type === "charge.succeeded" ||
    event.type === "payment_intent.succeeded"
  ) {
    const connectedAccountId = event.account; // set for Connect events
    if (!connectedAccountId) return NextResponse.json({ received: true });

    const admin = createAdminClient();
    const { data: org } = await admin
      .from("organizations")
      .select("id")
      .eq("stripe_account_id", connectedAccountId)
      .maybeSingle();
    if (!org) return NextResponse.json({ received: true });

    // normalize the charge
    const obj = event.data.object as Stripe.Charge | Stripe.PaymentIntent;
    const charge =
      "billing_details" in obj
        ? (obj as Stripe.Charge)
        : ((obj as Stripe.PaymentIntent).latest_charge as Stripe.Charge | null);

    const amount =
      (obj as Stripe.PaymentIntent).amount_received ??
      (obj as Stripe.Charge).amount ??
      charge?.amount ??
      0;
    const md = (obj.metadata ?? {}) as Record<string, string>;

    await recordPayment({
      orgId: org.id,
      source: "stripe",
      externalId: obj.id,
      amountCents: amount,
      currency: obj.currency ?? "usd",
      customer: {
        phone: md.phone ?? charge?.billing_details?.phone ?? null,
        email: md.email ?? charge?.billing_details?.email ?? null,
        fullName: md.name ?? charge?.billing_details?.name ?? null,
        // consent ONLY if the owner explicitly flagged it in metadata
        smsConsent: md.sms_consent === "true",
        consentSource: md.sms_consent === "true" ? "booking_form" : undefined,
      },
      metadata: { stripe_event: event.id },
    });
  }

  // Connected-account subscription lifecycle → keep plan status truthful.
  if (
    event.type === "invoice.payment_succeeded" ||
    event.type === "invoice.payment_failed" ||
    event.type === "customer.subscription.deleted"
  ) {
    const admin = createAdminClient();

    // idempotency: skip if this Stripe event was already processed
    const { data: seen } = await admin
      .from("events")
      .select("id")
      .eq("source", "stripe")
      .eq("external_id", event.id)
      .maybeSingle();
    if (seen) return NextResponse.json({ received: true });

    // resolve the subscription id, then the owned plan
    let subId: string | null = null;
    if (event.type === "customer.subscription.deleted") {
      subId = (event.data.object as Stripe.Subscription).id;
    } else {
      const inv = event.data.object as {
        subscription?: string | { id?: string } | null;
      };
      subId =
        typeof inv.subscription === "string"
          ? inv.subscription
          : inv.subscription?.id ?? null;
    }
    if (!subId) return NextResponse.json({ received: true });

    const { data: plan } = await admin
      .from("recurring_plans")
      .select("id, organization_id, customer_id, risk_level")
      .eq("stripe_subscription_id", subId)
      .maybeSingle();
    if (!plan) return NextResponse.json({ received: true });

    if (event.type === "invoice.payment_failed") {
      await admin
        .from("recurring_plans")
        .update({ risk_level: "high" })
        .eq("id", plan.id);
      await admin.from("retention_events").insert({
        organization_id: plan.organization_id,
        recurring_plan_id: plan.id,
        customer_id: plan.customer_id,
        type: "payment_failed",
      });
    } else if (event.type === "invoice.payment_succeeded") {
      // only a meaningful "recovery" if the plan was previously at risk
      if (plan.risk_level !== "none") {
        await admin
          .from("recurring_plans")
          .update({ risk_level: "none" })
          .eq("id", plan.id);
        await admin.from("retention_events").insert({
          organization_id: plan.organization_id,
          recurring_plan_id: plan.id,
          customer_id: plan.customer_id,
          type: "payment_recovered",
        });
      }

      // Platform revenue: the application fee is RENUVO's money (NOT the full
      // invoice amount — that's the tenant's). Record it to the ledger, idempotent.
      const inv = event.data.object as {
        id?: string;
        application_fee_amount?: number | null;
      };
      const feeCents = inv.application_fee_amount ?? 0;
      if (feeCents > 0) {
        await recordFinancialEntry({
          orgId: plan.organization_id,
          category: "subscription_fee",
          bucket: "platform_revenue",
          amountMicrodollars: fromStripeAmount(feeCents),
          source: "stripe",
          reference: inv.id ?? `${subId}_${event.id}`,
          recurringPlanId: plan.id,
        });
      }
    } else {
      // customer.subscription.deleted
      await admin.rpc("change_plan_status", {
        p_plan: plan.id,
        p_status: "cancelled",
        p_reason: "subscription_cancelled",
      });
    }

    // mark processed (idempotency key = stripe event id)
    await admin.rpc("record_event", {
      p_org_id: plan.organization_id,
      p_type: "agent_action",
      p_source: "stripe",
      p_customer_id: plan.customer_id,
      p_plan_id: plan.id,
      p_external_id: event.id,
      p_payload: { action: "subscription_event", stripe_type: event.type },
    });
  }

  return NextResponse.json({ received: true });
}
