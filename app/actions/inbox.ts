"use server";

import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { revalidatePath } from "next/cache";

/** Manual reply from the owner — still goes through the guarded send path. */
export async function sendReply(customerId: string, body: string) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  if (!body.trim()) return { error: "Empty message." };

  const admin = createAdminClient();
  const { data: customer } = await admin
    .from("customers")
    .select("phone, sms_sendable")
    .eq("id", customerId)
    .eq("organization_id", active.org.id)
    .single();
  if (!customer?.sms_sendable || !customer.phone)
    return { error: "This customer hasn't consented to texts." };

  const res = await sendGuardedSms({
    orgId: active.org.id,
    customerId,
    toPhone: customer.phone,
    body,
    eventType: "message_sent",
    meta: { human: true, sent_by: "inbox" },
  });
  if (!res.ok) return { error: res.reason ?? "Could not send." };

  // a human reply pauses the agent for this conversation
  await admin
    .from("customers")
    .update({ agent_paused: true })
    .eq("id", customerId)
    .eq("organization_id", active.org.id);

  revalidatePath(`/dashboard/inbox/${customerId}`);
  return { ok: true };
}

/** Toggle human takeover (pauses/resumes the agent for this customer). */
export async function setAgentPaused(customerId: string, paused: boolean) {
  const active = await getActiveOrg();
  if (!active) return { error: "Not authenticated." };
  const admin = createAdminClient();
  await admin
    .from("customers")
    .update({ agent_paused: paused })
    .eq("id", customerId)
    .eq("organization_id", active.org.id);
  revalidatePath(`/dashboard/inbox/${customerId}`);
  return { ok: true };
}
