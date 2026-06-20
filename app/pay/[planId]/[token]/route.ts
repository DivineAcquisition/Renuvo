import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPlanToken } from "@/lib/winback/links";
import { captureError } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";

// one portal configuration per connected account, cached for the process
const _cfg = new Map<string, string>();

async function connectedPortalConfig(
  stripe: Awaited<ReturnType<typeof getStripe>>,
  accountId: string
): Promise<string> {
  const cached = _cfg.get(accountId);
  if (cached) return cached;
  const existing = await stripe.billingPortal.configurations.list(
    { limit: 1 },
    { stripeAccount: accountId }
  );
  let id = existing.data[0]?.id;
  if (!id) {
    const created = await stripe.billingPortal.configurations.create(
      {
        business_profile: { headline: "Update your payment method" },
        features: {
          payment_method_update: { enabled: true },
          invoice_history: { enabled: true },
        },
      },
      { stripeAccount: accountId }
    );
    id = created.id;
  }
  _cfg.set(accountId, id);
  return id;
}

const PAGE = (msg: string) =>
  `<!doctype html><html><body style="font-family:Inter,system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f6f5fb"><div style="text-align:center;padding:24px"><h1 style="font-size:18px;color:#141221">${msg}</h1></div></body></html>`;

/** Involuntary win-back / dunning: open the card-update portal for a plan. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; token: string }> }
) {
  const { planId, token } = await params;
  if (!verifyPlanToken(planId, token))
    return new NextResponse(PAGE("This link is no longer valid."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });

  try {
    const admin = createAdminClient();
    const { data: plan } = await admin
      .from("recurring_plans")
      .select("stripe_customer_id, organization_id")
      .eq("id", planId)
      .maybeSingle();
    if (!plan?.stripe_customer_id)
      return new NextResponse(PAGE("We couldn't find your plan."), {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });

    const { data: org } = await admin
      .from("organizations")
      .select("stripe_account_id")
      .eq("id", plan.organization_id)
      .single();
    const acct = (org as { stripe_account_id?: string | null } | null)
      ?.stripe_account_id;
    if (!acct)
      return new NextResponse(PAGE("Payment updates aren't available."), {
        status: 400,
        headers: { "Content-Type": "text/html" },
      });

    const stripe = await getStripe();
    const configuration = await connectedPortalConfig(stripe, acct);
    const session = await stripe.billingPortal.sessions.create(
      {
        customer: plan.stripe_customer_id,
        return_url: process.env.NEXT_PUBLIC_APP_URL ?? "https://app.renuvo.io",
        configuration,
      },
      { stripeAccount: acct }
    );
    return NextResponse.redirect(session.url);
  } catch (e) {
    captureError(e, { event: "winback_card_update_failed" });
    return new NextResponse(PAGE("Something went wrong. Please try again."), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }
}
