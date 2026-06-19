import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordPayment } from "@/lib/payments/record";
import type Stripe from "stripe";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

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

  return NextResponse.json({ received: true });
}
