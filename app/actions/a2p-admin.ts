"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * ISV compliance kill-switch: instantly stop a tenant's outbound messaging.
 * Platform-admin only (Renuvo carries carrier liability for their traffic).
 */
export async function suspendTenantMessaging(orgId: string, reason: string) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) return { error: "Not allowed." };

  const admin = createAdminClient();
  await admin
    .from("organizations")
    .update({ messaging_suspended: true, messaging_suspended_reason: reason })
    .eq("id", orgId);
  // cancel any pending sends for this org
  await admin
    .from("scheduled_messages")
    .update({ status: "cancelled", cancel_reason: "messaging_suspended" })
    .eq("organization_id", orgId)
    .eq("status", "pending");
  return { ok: true };
}

export async function unsuspendTenantMessaging(orgId: string) {
  const supabase = await createClient();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!isAdmin) return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin
    .from("organizations")
    .update({ messaging_suspended: false, messaging_suspended_reason: null })
    .eq("id", orgId);
  return { ok: true };
}
