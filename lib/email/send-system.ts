import * as React from "react";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerSecret } from "@/lib/secrets";
import { captureError, log } from "@/lib/observability/logger";

type Audience = "owner" | "homeowner";
type Klass = "transactional" | "marketing";

export type SendResult = { ok: true; id?: string } | { ok: false; reason: string };

async function client(): Promise<Resend | null> {
  const key = await getServerSecret("RESEND_API_KEY");
  return key ? new Resend(key) : null;
}

/**
 * THE single entry point for every email in the app. Routes the sending domain by
 * audience (platform→owner = notify.; tenant→homeowner = mail.) so transactional
 * and marketing reputations never mix. Enforces marketing suppression, renders a
 * React Email component via Resend's `react` field, logs without PII (Prompt 39),
 * and supports idempotency keys.
 *
 * Marketing CONSENT + unsubscribe + postal address are enforced UPSTREAM by the
 * Prompt 42 guarded path; this is the shared transport beneath it.
 */
export async function sendSystemEmail(args: {
  audience: Audience;
  klass: Klass;
  to: string;
  subject: string;
  react: React.ReactElement;
  orgId?: string;
  fromLocalPart?: string;
  fromName?: string;
  replyTo?: string;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}): Promise<SendResult> {
  // tenant channel ships behind the flag (Prompt 42)
  if (process.env.EMAIL_CHANNEL_ENABLED !== "true" && args.audience === "homeowner")
    return { ok: false, reason: "email_disabled" };

  const resend = await client();
  if (!resend) return { ok: false, reason: "email_not_configured" };

  // belt-and-suspenders suppression check for ALL marketing
  if (args.klass === "marketing") {
    const admin = createAdminClient();
    const { data: sup } = await admin
      .from("email_suppressions")
      .select("id")
      .eq("email", args.to)
      .limit(1);
    if (sup?.length) return { ok: false, reason: "suppressed" };
  }

  const platformDomain = process.env.EMAIL_PLATFORM_DOMAIN ?? "notify.renuvo.io";
  const tenantDomain =
    process.env.EMAIL_TENANT_DOMAIN ??
    process.env.EMAIL_FROM_DOMAIN ??
    "mail.renuvo.io";
  const domain = args.audience === "owner" ? platformDomain : tenantDomain;
  const local =
    args.fromLocalPart ?? (args.audience === "owner" ? "notify" : "hello");
  const name =
    args.fromName ??
    (args.audience === "owner"
      ? process.env.EMAIL_PLATFORM_FROM_NAME ?? "Renuvo"
      : "Renuvo");
  const from = `${name} <${local}@${domain}>`;

  // Resend SDK returns { data, error } — never throws on API errors (skill gotcha)
  const { data, error } = await resend.emails.send(
    {
      from,
      to: args.to,
      subject: args.subject,
      react: args.react,
      replyTo: args.replyTo,
      headers: args.headers,
    },
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined
  );

  if (error) {
    captureError(error, { orgId: args.orgId, event: "email_send_failed" });
    return { ok: false, reason: "send_failed" };
  }
  log.info("email_sent", {
    orgId: args.orgId,
    event: "email_sent",
    audience: args.audience,
    klass: args.klass,
  });
  return { ok: true, id: data?.id };
}
