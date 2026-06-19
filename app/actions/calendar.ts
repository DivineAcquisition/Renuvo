"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export async function setCalendarEnabled(enabled: boolean) {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return { error: "Not allowed." };
  const admin = createAdminClient();
  await admin
    .from("calendar_connections")
    .update({ enabled })
    .eq("organization_id", active.org.id);
  revalidatePath("/dashboard/settings/calendar");
}

export async function disconnectCalendar(): Promise<void> {
  const active = await getActiveOrg();
  if (!active || active.role !== "owner") return; // owner-only; no-op otherwise
  const admin = createAdminClient();
  await admin
    .from("calendar_connections")
    .delete()
    .eq("organization_id", active.org.id);
  revalidatePath("/dashboard/settings/calendar");
}
