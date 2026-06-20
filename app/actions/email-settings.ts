"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

function slugifyLocalPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
}

/**
 * Owner-gated email sending identity on the SHARED Renuvo domain. CAN-SPAM requires
 * a physical postal address in every email — so we block enabling email (a non-empty
 * local-part) unless a postal address is present.
 */
export async function saveEmailSettings(input: {
  fromName?: string;
  localPart?: string;
  replyTo?: string;
  postalAddress?: string;
}) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  if (active.role !== "owner")
    return { error: "Only the owner can change email settings." };

  const localPart =
    slugifyLocalPart(input.localPart || "") ||
    slugifyLocalPart(active.org.slug) ||
    slugifyLocalPart(active.org.name);
  const postal = input.postalAddress?.trim() || null;

  if (!postal)
    return {
      error:
        "A physical postal address is required before email can be enabled (CAN-SPAM).",
    };

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      email_local_part: localPart,
      email_from_name: input.fromName?.trim() || active.org.name,
      email_reply_to: input.replyTo?.trim() || null,
      postal_address: postal,
    })
    .eq("id", active.org.id);
  if (error) {
    if (error.code === "23505")
      return { error: "That sending name is taken. Try another." };
    return { error: error.message };
  }
  revalidatePath("/dashboard/settings/email");
  return { ok: true, localPart };
}
