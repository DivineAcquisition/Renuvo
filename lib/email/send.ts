/**
 * Platform → owner email (a NEW channel; customer messaging stays SMS-only).
 * No-ops unless RESEND_API_KEY is configured, so notifications ship in-app now
 * and email lights up the moment a key is added (env or Vault).
 */
import { getServerSecret } from "@/lib/secrets";

export async function sendOwnerEmail(
  to: string,
  subject: string,
  body: string,
  link?: string
): Promise<boolean> {
  const apiKey = await getServerSecret("RESEND_API_KEY");
  if (!apiKey) return false; // email not configured — in-app only
  const from = process.env.RENUVO_FROM_EMAIL ?? "Renuvo <notifications@renuvo.io>";
  const html = `<p>${body}</p>${link ? `<p><a href="https://app.renuvo.io${link}">Open Renuvo</a></p>` : ""}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
