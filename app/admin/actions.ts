"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  suspendTenantMessaging,
  unsuspendTenantMessaging,
} from "@/app/actions/a2p-admin";
import { revalidatePath } from "next/cache";

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (!user || !isAdmin) throw new Error("forbidden");
  return user.id;
}

export async function adminSuspend(orgId: string, reason: string) {
  const adminId = await requireAdmin();
  if (!reason.trim()) return { error: "A reason is required." };
  const res = await suspendTenantMessaging(orgId, reason);
  const admin = createAdminClient();
  await admin.from("settings_audit").insert({
    organization_id: orgId,
    profile_id: adminId,
    scope: "org",
    setting_key: "admin.messaging_suspended",
    new_value: { suspended: true, reason },
  });
  revalidatePath(`/admin/tenants/${orgId}`);
  return res;
}

export async function adminUnsuspend(orgId: string) {
  const adminId = await requireAdmin();
  const res = await unsuspendTenantMessaging(orgId);
  const admin = createAdminClient();
  await admin.from("settings_audit").insert({
    organization_id: orgId,
    profile_id: adminId,
    scope: "org",
    setting_key: "admin.messaging_suspended",
    new_value: { suspended: false },
  });
  revalidatePath(`/admin/tenants/${orgId}`);
  return res;
}
