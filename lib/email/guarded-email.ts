import { createAdminClient } from "@/lib/supabase/admin";
import { getServerSecret } from "@/lib/secrets";
import { renderEmail } from "./render";
import { signUnsub } from "./unsub";
import { captureError, log } from "@/lib/observability/logger";

export type EmailResult = { ok: true } | { ok: false; reason: string };

/**
 * Email send with CAN-SPAM gates: enabled → not suspended → has email → consent →
 * not unsubscribed → not suppressed → org configured (local-part + postal addr).
 * NO wallet/funds and NO quiet-hours gates (those are SMS-only).
 */
export async function sendGuardedEmail(args: {
  orgId: string;
  customerId: string;
  body: string;
  subject?: string;
  meta?: Record<string, unknown>;
}): Promise<EmailResult> {
  if (process.env.EMAIL_CHANNEL_ENABLED !== "true")
    return { ok: false, reason: "email_disabled" };
  const admin = createAdminClient();

  const [{ data: c }, { data: org }] = await Promise.all([
    admin
      .from("customers")
      .select("email, email_sendable, email_unsubscribed_at")
      .eq("id", args.customerId)
      .eq("organization_id", args.orgId)
      .single(),
    admin
      .from("organizations")
      .select(
        "name, email_local_part, email_from_name, email_reply_to, postal_address, messaging_suspended"
      )
      .eq("id", args.orgId)
      .single(),
  ]);

  if ((org as { messaging_suspended?: boolean })?.messaging_suspended)
    return { ok: false, reason: "messaging_suspended" };
  if (!c?.email) return { ok: false, reason: "no_email" };
  if (!c.email_sendable) return { ok: false, reason: "no_email_consent" };
  if (c.email_unsubscribed_at) return { ok: false, reason: "unsubscribed" };
  const o = org as {
    name: string;
    email_local_part?: string | null;
    email_from_name?: string | null;
    email_reply_to?: string | null;
    postal_address?: string | null;
  } | null;
  if (!o?.email_local_part || !o.postal_address)
    return { ok: false, reason: "email_not_configured" };

  const { data: sup } = await admin
    .from("email_suppressions")
    .select("id")
    .eq("email", c.email)
    .limit(1);
  if (sup && sup.length) return { ok: false, reason: "suppressed" };

  const apiKey = await getServerSecret("RESEND_API_KEY");
  if (!apiKey) return { ok: false, reason: "email_not_configured" };

  const domain = process.env.EMAIL_FROM_DOMAIN ?? "mail.renuvo.io";
  const from = `${o.email_from_name ?? o.name} <${o.email_local_part}@${domain}>`;
  const unsubUrl = `${process.env.NEXT_PUBLIC_APP_URL}/u/${args.customerId}/${signUnsub(
    args.customerId,
    args.orgId
  )}`;
  const html = renderEmail(args.body, {
    businessName: o.name,
    unsubUrl,
    postalAddress: o.postal_address,
  });

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: c.email,
        reply_to: o.email_reply_to ?? undefined,
        subject: args.subject ?? `A note from ${o.name}`,
        html,
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });
    if (!res.ok) {
      captureError(new Error(`resend ${res.status}`), {
        orgId: args.orgId,
        event: "email_send_failed",
      });
      return { ok: false, reason: "send_failed" };
    }
    const json = (await res.json()) as { id?: string };

    await admin.rpc("record_event", {
      p_org_id: args.orgId,
      p_type: "message_sent",
      p_source: "app",
      p_customer_id: args.customerId,
      p_channel: "email",
      p_direction: "outbound",
      p_body: args.body,
      p_external_id: json.id ? `email_${json.id}` : undefined,
      p_payload: { ...args.meta, provider_id: json.id },
    });
    log.info("email_sent", { orgId: args.orgId, event: "email_sent" });
    return { ok: true };
  } catch (e) {
    captureError(e, { orgId: args.orgId, event: "email_send_failed" });
    return { ok: false, reason: "send_failed" };
  }
}
