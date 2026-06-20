import Link from "next/link";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { getWallet } from "@/lib/billing/wallet";
import { getTenantSpend } from "@/lib/money/reports";
import { createAdminClient } from "@/lib/supabase/admin";
import { disconnectStripe } from "@/app/actions/stripe-connect";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { WalletCard } from "./WalletCard";
import { PlanCard } from "./PlanCard";

type OrgBilling = {
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean | null;
  subscription_status: string | null;
  subscription_plan_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

export default async function PaymentsSettings() {
  const active = await getActiveOrg();
  if (!active) return null;

  const admin = createAdminClient();
  const { data: orgRow } = await admin
    .from("organizations")
    .select(
      "stripe_account_id, stripe_charges_enabled, subscription_status, subscription_plan_id, trial_ends_at, current_period_end"
    )
    .eq("id", active.org.id)
    .single();
  const org = orgRow as unknown as OrgBilling | null;
  const { data: plansRaw } = await admin
    .from("subscription_plans")
    .select("id, name, price_cents, active")
    .eq("active", true)
    .order("price_cents");
  const plans = (plansRaw ?? []) as unknown as {
    id: string;
    name: string;
    price_cents: number;
  }[];
  const wallet = await getWallet(active.org.id);
  if (!wallet) return null;
  const connected = !!org?.stripe_account_id;
  const spend = await getTenantSpend(active.org.id);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold">Payments &amp; billing</h1>

      {/* Flow 1 — your Renuvo plan (SaaS subscription on the platform account) */}
      <PlanCard
        status={org?.subscription_status ?? "none"}
        currentPlanId={org?.subscription_plan_id ?? null}
        trialEndsAt={org?.trial_ends_at ?? null}
        currentPeriodEnd={org?.current_period_end ?? null}
        plans={plans}
        isOwner={active.role === "owner"}
        hasCard={!!wallet.stripe_payment_method_id}
      />

      {/* Flow 3 — your Stripe connection (you charge YOUR clients) */}
      <Card>
        <CardHeader>
          <CardTitle>Your Stripe account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect the Stripe account you already use, so Renuvo can detect paid
            jobs and set up recurring billing for your clients. Nothing is moved —
            Renuvo reads events and acts on your behalf.
          </p>
          {connected ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-primary">
                  Connected ✓
                </span>
                <form action={disconnectStripe}>
                  <Button variant="ghost" size="sm">
                    Disconnect
                  </Button>
                </form>
              </div>
              {org?.stripe_charges_enabled === false && (
                <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                  Your Stripe account can&apos;t accept charges yet. Finish Stripe&apos;s
                  onboarding (identity/bank details) so Renuvo can bill your clients.
                </p>
              )}
            </div>
          ) : (
            <Button asChild>
              <Link href="/api/stripe/connect">Connect Stripe</Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Wallet (platform billing) */}
      <WalletCard
        balanceCents={wallet.balance_cents}
        hasCard={!!wallet.stripe_payment_method_id}
        autoReloadEnabled={wallet.auto_reload_enabled}
        reloadThresholdCents={wallet.reload_threshold_cents}
        reloadAmountCents={wallet.reload_amount_cents}
        isOwner={active.role === "owner"}
      />

      {/* Your Renuvo spend (what you pay Renuvo — distinct from your recurring revenue) */}
      <Card>
        <CardHeader>
          <CardTitle>Your Renuvo spend (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Wallet top-ups</p>
            <p className="mt-1 text-lg font-bold">
              <Money value={spend.wallet_topups_micro} />
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">SMS spend</p>
            <p className="mt-1 text-lg font-bold">
              <Money value={spend.sms_spend_micro} />
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Refunds</p>
            <p className="mt-1 text-lg font-bold">
              <Money value={spend.refunds_micro} />
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
