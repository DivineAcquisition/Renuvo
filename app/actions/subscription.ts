"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  startSubscription,
  cancelSubscription,
} from "@/lib/stripe/subscription";
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
