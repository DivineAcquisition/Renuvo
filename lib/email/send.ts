/**
 * Platform → owner email. Now a thin wrapper over the unified pipeline
 * (Prompt 52): renders the branded EventAlert template and sends from the
 * transactional domain (notify.renuvo.io). No-ops if Resend isn't configured, so
 * in-app notifications still work and email lights up when a key is added.
 */
import * as React from "react";
import { sendSystemEmail } from "./send-system";
import { EventAlert } from "@/emails/notify";

export async function sendOwnerEmail(
  to: string,
  subject: string,
  body: string,
  link?: string
): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.renuvo.io";
  const react = React.createElement(EventAlert, {
    title: subject,
    body,
    ctaUrl: link ? `${base}${link}` : undefined,
  });
  const res = await sendSystemEmail({
    audience: "owner",
    klass: "transactional",
    to,
    subject,
    react,
  });
  return res.ok;
}
