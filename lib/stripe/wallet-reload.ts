import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { captureError } from "@/lib/observability/logger";
import { notify } from "@/lib/notify/dispatch";

/**
 * Charge the saved card on the PLATFORM account and credit the wallet on success.
 * Used by manual "Add funds" and by triggerAutoReload.
 */
export async function chargeWalletReload(
  orgId: string,
  amountCents: number,
  opts: { offSession?: boolean } = {}
): Promise<{ ok: boolean; reason?: string; balanceAfterCents?: number }> {
  const admin = createAdminClient();
  const { data: wallet } = await admin
    .from("wallets")
    .select("stripe_customer_id, stripe_payment_method_id")
    .eq("organization_id", orgId)
    .single();

  if (!wallet?.stripe_customer_id || !wallet?.stripe_payment_method_id) {
    return { ok: false, reason: "no_card_on_file" };
  }

  try {
    const stripe = await getStripe();
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: wallet.stripe_customer_id,
      payment_method: wallet.stripe_payment_method_id,
      off_session: opts.offSession ?? true,
      confirm: true,
      metadata: { organization_id: orgId, purpose: "wallet_reload" },
    });

    if (pi.status !== "succeeded") return { ok: false, reason: pi.status };

    // record the credit (Prompt 8 RPC)
    const { data: credit } = await admin.rpc("credit_wallet", {
      p_org_id: orgId,
      p_amount_cents: amountCents,
      p_type: "credit_reload",
      p_reference: pi.id,
      p_meta: {},
    });

    return {
      ok: true,
      balanceAfterCents: (credit as { balance_after_cents?: number } | null)
        ?.balance_after_cents,
    };
  } catch (e) {
    const reason =
      e && typeof e === "object" && "code" in e
        ? String((e as { code?: string }).code)
        : "charge_failed";
    return { ok: false, reason };
  }
}

/**
 * Auto-reload, called when a debit returns reload_needed (Prompt 8 send path).
 * Debounced via low_balance_notified_at so concurrent sends don't double-charge.
 */
export async function triggerAutoReload(orgId: string) {
  const admin = createAdminClient();
  const { data: wallet } = await admin
    .from("wallets")
    .select(
      "auto_reload_enabled, reload_amount_cents, stripe_payment_method_id, low_balance_notified_at"
    )
    .eq("organization_id", orgId)
    .single();

  if (!wallet?.auto_reload_enabled || !wallet.stripe_payment_method_id) return;

  // debounce: skip if we attempted a reload in the last 2 minutes
  if (
    wallet.low_balance_notified_at &&
    Date.now() - new Date(wallet.low_balance_notified_at).getTime() < 120_000
  ) {
    return;
  }
  await admin
    .from("wallets")
    .update({ low_balance_notified_at: new Date().toISOString() })
    .eq("organization_id", orgId);

  const res = await chargeWalletReload(orgId, wallet.reload_amount_cents, {
    offSession: true,
  });
  // a failed auto-reload is high-severity: sends will start failing for funds.
  if (!res.ok) {
    captureError(new Error(`wallet_reload_failed: ${res.reason}`), {
      orgId,
      event: "wallet_reload_failed",
    });
    void notify(orgId, "wallet_low", {
      title: "Auto-reload failed",
      body: "We couldn't top up your SMS balance. Update your card to keep sending.",
      link: "/dashboard/settings/payments",
    });
  }
  // credit_wallet clears low_balance_notified_at on success
}
