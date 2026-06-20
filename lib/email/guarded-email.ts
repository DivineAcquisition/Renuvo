import * as React from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { signUnsub } from "./unsub";
import { sendSystemEmail } from "./send-system";
import { CustomerGeneric } from "@/emails/customer";
import { log } from "@/lib/observability/logger";

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
        "name, email_local_part, email_from_name, email_reply_to, postal_address, messaging_suspended, accent_color"
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
    accent_color?: string | null;
  } | null;
  if (!o?.email_local_part || !o.postal_address)
    return { ok: false, reason: "email_not_configured" };

  const { data: sup } = await admin
    .from("email_suppressions")
    .select("id")
    .eq("email", c.email)
    .limit(1);
  if (sup && sup.length) return { ok: false, reason: "suppressed" };

  const unsubUrl = `${process.env.NEXT_PUBLIC_APP_URL}/u/${args.customerId}/${signUnsub(
    args.customerId,
    args.orgId
  )}`;
  const subject = args.subject ?? `A note from ${o.name}`;

  // Compose the tenant-branded React Email and send it through the unified
  // pipeline (Prompt 52). All CAN-SPAM gates above still govern this path.
  const react = React.createElement(CustomerGeneric, {
    brand: { name: o.email_from_name ?? o.name, accent: o.accent_color ?? undefined },
    body: args.body,
    preview: subject,
    footer: { address: o.postal_address, unsubscribeUrl: unsubUrl },
  });

  const res = await sendSystemEmail({
    audience: "homeowner",
    klass: "marketing",
    to: c.email,
    subject,
    react,
    orgId: args.orgId,
    fromLocalPart: o.email_local_part,
    fromName: o.email_from_name ?? o.name,
    replyTo: o.email_reply_to ?? undefined,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (!res.ok) return { ok: false, reason: res.reason };

  await admin.rpc("record_event", {
    p_org_id: args.orgId,
    p_type: "message_sent",
    p_source: "app",
    p_customer_id: args.customerId,
    p_channel: "email",
    p_direction: "outbound",
    p_body: args.body,
    p_external_id: res.id ? `email_${res.id}` : undefined,
    p_payload: { ...args.meta, provider_id: res.id },
  });
  log.info("email_sent", { orgId: args.orgId, event: "email_sent" });
  return { ok: true };
}
