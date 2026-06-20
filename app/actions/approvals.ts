"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

async function currentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function approveMessage(id: string, editedBody?: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const uid = await currentUserId();
  const admin = createAdminClient();
  await admin
    .from("scheduled_messages")
    .update({
      approved_at: new Date().toISOString(),
      approved_by: uid,
      edited_body: editedBody?.trim() ? editedBody.trim() : null,
      send_at: new Date().toISOString(), // due on next drain
    })
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .eq("status", "pending");
  revalidatePath("/dashboard/approvals");
  return { ok: true };
}

export async function rejectMessage(id: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin
    .from("scheduled_messages")
    .update({ status: "cancelled", cancel_reason: "owner_rejected" })
    .eq("id", id)
    .eq("organization_id", active.org.id)
    .eq("status", "pending");
  revalidatePath("/dashboard/approvals");
  return { ok: true };
}
