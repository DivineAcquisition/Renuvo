"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { cancelPendingMessages } from "@/lib/agent/engine";
import { revalidatePath } from "next/cache";

export async function setAgentPaused(customerId: string, paused: boolean) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin
    .from("customers")
    .update({ agent_paused: paused })
    .eq("id", customerId)
    .eq("organization_id", active.org.id);
  if (paused)
    await cancelPendingMessages(active.org.id, customerId, "human_takeover");
  revalidatePath(`/dashboard/customers/${customerId}`);
  return { ok: true };
}

export async function sendManualMessage(customerId: string, body: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("phone, sms_sendable")
    .eq("id", customerId)
    .eq("organization_id", active.org.id)
    .single();
  if (!customer?.sms_sendable || !customer.phone)
    return { error: "Customer not reachable." };

  const res = await sendGuardedSms({
    orgId: active.org.id,
    customerId,
    toPhone: customer.phone,
    body,
    eventType: "message_sent",
    meta: { human: true, sent_by: "takeover" },
  });
  revalidatePath(`/dashboard/customers/${customerId}`);
  if (!res.ok) return { error: res.reason };
  return { ok: true };
}
