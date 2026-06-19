"use server";

import { stripe } from "@/lib/stripe/client";
import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function disconnectStripe(): Promise<void> {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return; // owner-only; no-op otherwise

  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("stripe_account_id")
    .eq("id", active.org.id)
    .single();

  if (org?.stripe_account_id) {
    try {
      await stripe.oauth.deauthorize({
        client_id: process.env.STRIPE_CONNECT_CLIENT_ID!,
        stripe_user_id: org.stripe_account_id,
      });
    } catch {
      /* already revoked — fall through and clear locally */
    }
  }
  await admin
    .from("organizations")
    .update({ stripe_account_id: null })
    .eq("id", active.org.id);
  revalidatePath("/dashboard/settings/payments");
}
