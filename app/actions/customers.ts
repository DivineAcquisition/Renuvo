"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { toE164 } from "@/lib/phone";
import { revalidatePath } from "next/cache";

export async function upsertCustomer(input: {
  id?: string;
  fullName: string;
  phone: string;
  email?: string;
  smsConsent: boolean;
}) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  if (!input.fullName.trim()) return { error: "Enter a name." };
  const phone = toE164(input.phone);
  if (!phone) return { error: "Enter a valid phone number." };

  const admin = createAdminClient();

  // CONSENT GATE (Prompt 6): sms_sendable is a generated column from sms_consent
  // and NOT opted_out. Owner-attested consent is the only edit path that grants
  // it; a payment never does. Record the source for the audit trail.
  const consentFields = input.smsConsent
    ? {
        sms_consent: true,
        sms_consent_at: new Date().toISOString(),
        sms_consent_source: "manual",
        opted_out: false,
      }
    : { sms_consent: false, sms_consent_source: null };

  if (input.id) {
    const { error } = await admin
      .from("customers")
      .update({
        full_name: input.fullName.trim(),
        phone,
        email: input.email?.trim() || null,
        ...consentFields,
      })
      .eq("id", input.id)
      .eq("organization_id", active.org.id);
    if (error) return { error: error.message };
    revalidatePath(`/dashboard/customers/${input.id}`);
    return { ok: true, id: input.id };
  }

  const { data, error } = await admin
    .from("customers")
    .insert({
      organization_id: active.org.id,
      full_name: input.fullName.trim(),
      phone,
      email: input.email?.trim() || null,
      source: "manual",
      ...consentFields,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { ok: true, id: data?.id as string };
}
