"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  startSubscription,
  cancelSubscription,
} from "@/lib/stripe/subscription";
import { createBillingPortalSession } from "@/lib/stripe/portal";
import { revalidatePath } from "next/cache";

export async function subscribe(planId: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const res = await startSubscription(active.org.id, planId);
  revalidatePath("/dashboard/settings/payments");
  return res;
}

export async function cancelPlan() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const res = await cancelSubscription(active.org.id);
  revalidatePath("/dashboard/settings/payments");
  return res;
}

/** Stripe-hosted billing portal: update card, view invoices, cancel. */
export async function openBillingPortal() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/settings/payments`;
  return createBillingPortalSession(active.org.id, returnUrl);
}
