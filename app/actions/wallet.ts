"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  createWalletSetupIntent,
  saveWalletPaymentMethod,
} from "@/lib/stripe/wallet-billing";
import { chargeWalletReload } from "@/lib/stripe/wallet-reload";
import { revalidatePath } from "next/cache";

export async function startSaveCard() {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const clientSecret = await createWalletSetupIntent(active.org.id);
  return { clientSecret };
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
