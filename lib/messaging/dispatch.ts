import { createAdminClient } from "@/lib/supabase/admin";
import { sendGuardedSms } from "@/lib/telnyx/guarded-send";
import { sendGuardedEmail } from "@/lib/email/guarded-email";

type SendEventType = "message_sent" | "activation_sent" | "conversion_offer_sent";

export type DispatchResult =
  | { ok: true; channel: "sms" | "email" }
  | { ok: false; reason: string; channel: "sms" | "email" };

/**
 * Route a customer message to the right channel. 'auto' honors channel_preference,
 * else SMS-first when sms_sendable, else email when email_sendable. With email
 * disabled or unavailable, this always resolves to SMS — so existing behavior is
 * unchanged. Nothing slips out un-gated: each channel's guarded path still runs.
 */
export async function dispatchMessage(args: {
  orgId: string;
  customerId: string;
  toPhone?: string;
  body: string;
  subject?: string;
  eventType?: SendEventType;
  meta?: Record<string, unknown>;
  channel?: "sms" | "email" | "auto";
}): Promise<DispatchResult> {
  const channel = args.channel ?? "auto";
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("customers")
    .select("phone, sms_sendable, email_sendable, channel_preference")
    .eq("id", args.customerId)
    .eq("organization_id", args.orgId)
    .single();

  const pref = (c as { channel_preference?: string } | null)?.channel_preference;
  const preferEmail =
    channel === "email" ||
    (channel === "auto" &&
      (pref === "email" ||
        (pref !== "sms" && !c?.sms_sendable && !!c?.email_sendable)));

  if (preferEmail) {
    const r = await sendGuardedEmail({
      orgId: args.orgId,
      customerId: args.customerId,
      body: args.body,
      subject: args.subject,
      meta: args.meta,
    });
    if (r.ok) return { ok: true, channel: "email" };
    if (channel === "email")
      return { ok: false, reason: r.reason, channel: "email" };
    // 'auto' → fall through to SMS
  }

  const phone = args.toPhone ?? c?.phone ?? undefined;
  if (!phone) return { ok: false, reason: "no_number", channel: "sms" };
  const r = await sendGuardedSms({
    orgId: args.orgId,
    customerId: args.customerId,
    toPhone: phone,
    body: args.body,
    eventType: args.eventType,
    meta: args.meta,
  });
  return r.ok
    ? { ok: true, channel: "sms" }
    : { ok: false, reason: r.reason, channel: "sms" };
}
