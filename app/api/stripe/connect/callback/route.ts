import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const settings = new URL(
    "/dashboard/settings/payments",
    process.env.NEXT_PUBLIC_APP_URL
  );

  const active = await getActiveOrg();
  // CSRF guard: the state must match the caller's active org
  if (!active || !code || state !== active.org.id) {
    settings.searchParams.set("error", "connect_failed");
    return NextResponse.redirect(settings);
  }

  try {
    const stripe = await getStripe();
    const token = await stripe.oauth.token({
      grant_type: "authorization_code",
      code,
    });
    const connectedAccountId = token.stripe_user_id!;

    // pull readiness so the UI + capture flow know whether the tenant can charge
    let chargesEnabled = false;
    let payoutsEnabled = false;
    let detailsSubmitted = false;
    try {
      const acct = await stripe.accounts.retrieve(connectedAccountId);
      chargesEnabled = !!acct.charges_enabled;
      payoutsEnabled = !!acct.payouts_enabled;
      detailsSubmitted = !!acct.details_submitted;
    } catch {
      /* best-effort; account.updated webhook will reconcile */
    }

    const admin = createAdminClient();
    await admin
      .from("organizations")
      .update({
        stripe_account_id: connectedAccountId,
        stripe_charges_enabled: chargesEnabled,
        stripe_payouts_enabled: payoutsEnabled,
        stripe_details_submitted: detailsSubmitted,
      })
      .eq("id", active.org.id);

    settings.searchParams.set("connected", "1");
    return NextResponse.redirect(settings);
  } catch {
    settings.searchParams.set("error", "connect_failed");
    return NextResponse.redirect(settings);
  }
}
