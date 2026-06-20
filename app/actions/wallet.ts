"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  createWalletSetupIntent,
  saveWalletPaymentMethod,
} from "@/lib/stripe/wallet-billing";
import { chargeWalletReload } from "@/lib/stripe/wallet-reload";
import { getPublishableKey } from "@/lib/stripe/publishable";
import { revalidatePath } from "next/cache";

export async function startSaveCard() {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  try {
    const [clientSecret, publishableKey] = await Promise.all([
      createWalletSetupIntent(active.org.id),
      getPublishableKey(),
    ]);
    if (!clientSecret || !publishableKey)
      return { error: "payments_unconfigured" as const };
    return { clientSecret, publishableKey };
  } catch {
    // most commonly the platform Stripe key isn't set in this environment
    return { error: "payments_unconfigured" as const };
  }
}

export async function confirmSaveCard(paymentMethodId: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  await saveWalletPaymentMethod(active.org.id, paymentMethodId);
  revalidatePath("/dashboard/settings/payments");
}

export async function addFunds(amountCents: number) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const res = await chargeWalletReload(active.org.id, amountCents, {
    offSession: false,
  });
  if (!res.ok) return { error: res.reason ?? "Charge failed." };
  revalidatePath("/dashboard/settings/payments");
  return { ok: true, balanceAfterCents: res.balanceAfterCents };
}
