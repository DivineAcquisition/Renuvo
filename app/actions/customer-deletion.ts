"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/**
 * Data-subject deletion: anonymize PII, scrub message bodies, but RETAIN the
 * consent_record (A2P proof). Blocks while an active plan exists (cancel billing
 * first). Owner-only. We never hard-delete the row (referential integrity).
 */
export async function deleteCustomerData(customerId: string) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can delete a customer." };
  const admin = createAdminClient();
  const orgId = active.org.id;

  const { data: c } = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!c) return { error: "Customer not found." };

  const { count } = await admin
    .from("recurring_plans")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "active");
  if ((count ?? 0) > 0)
    return { error: "Cancel their active plan before deleting their data." };

  const now = new Date().toISOString();
  // anonymize: strip PII (phone is nullable now), clear consent so sms_sendable=false
  await admin
    .from("customers")
    .update({
      full_name: "Deleted Customer",
      phone: null,
      email: null,
      sms_consent: false,
      opted_out: true,
      opted_out_at: now,
      deleted_at: now,
      anonymized_at: now,
      anonymized_reason: "data_subject_request",
    })
    .eq("id", customerId)
    .eq("organization_id", orgId);

  // scrub message bodies in the events spine (keep metadata)
  await admin
    .from("events")
    .update({ body: "[deleted]" })
    .eq("organization_id", orgId)
    .eq("customer_id", customerId)
    .not("body", "is", null);

  // consent_records are intentionally RETAINED (HMAC + timestamps only).
  revalidatePath("/dashboard/customers");
  revalidatePath(`/dashboard/customers/${customerId}`);
  return { ok: true };
}
