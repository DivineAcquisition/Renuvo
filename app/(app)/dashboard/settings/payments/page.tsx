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

export default async function PaymentsSettings() {
  const active = await getActiveOrg();
  if (!active) return null;

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", active.org.id)
    .single();
  const wallet = await getWallet(active.org.id);
  if (!wallet) return null;
  const connected = !!org?.stripe_account_id;
  const spend = await getTenantSpend(active.org.id);

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="font-display text-2xl font-bold">Payments &amp; billing</h1>

      {/* Connect */}
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
