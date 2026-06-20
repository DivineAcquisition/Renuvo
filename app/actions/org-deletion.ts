"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

const GRACE_DAYS = 14;

/** Request deletion → schedules teardown after a grace period (recoverable). */
export async function requestOrgDeletion() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can delete the account." };
  const admin = createAdminClient();
  const now = new Date();
  const scheduled = new Date(now.getTime() + GRACE_DAYS * 86400_000);
  await admin
    .from("organizations")
    .update({
      deletion_requested_at: now.toISOString(),
      deletion_scheduled_for: scheduled.toISOString(),
      // stop the agent immediately during wind-down
      messaging_suspended: true,
      messaging_suspended_reason: "account_deletion",
    })
    .eq("id", active.org.id);
  revalidatePath("/dashboard/settings/data");
  return { ok: true, scheduledFor: scheduled.toISOString() };
}

export async function cancelOrgDeletion() {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner")
    return { error: "Only owners can cancel." };
  const admin = createAdminClient();
  await admin
    .from("organizations")
    .update({
      deletion_requested_at: null,
      deletion_scheduled_for: null,
      messaging_suspended: false,
      messaging_suspended_reason: null,
    })
    .eq("id", active.org.id);
  revalidatePath("/dashboard/settings/data");
  return { ok: true };
}
