/**
 * Resend's webhook: delivery reports, bounces and complaints for email sent through the shared email
 * door (convex/lib/email/provider.ts). Route: convex/http.ts. Needs RESEND_WEBHOOK_SECRET.
 *
 * NOT VERIFIED against Resend itself in this build. The signing scheme and event shape follow Resend's
 * public documentation as understood when this was written.
 */

// ── The webhook: delivery reports, bounces and complaints ───────────────────────────────────────

const encoder = new TextEncoder();

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Checks a webhook's signature (Resend signs with Svix: HMAC-SHA256 over "<id>.<timestamp>.<body>" with
 * the secret after its "whsec_" prefix). Refuses one older or newer than five minutes, so a captured
 * request cannot be replayed later.
 */
export async function verifyWebhook(input: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now: number }): Promise<boolean> {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature || !input.secret.startsWith("whsec_")) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(input.now / 1000 - seconds) > 300) return false;
  const key = await crypto.subtle.importKey("raw", base64ToBytes(input.secret.slice("whsec_".length)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${id}.${timestamp}.${input.body}`))));
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    return version === "v1" && value !== undefined && same(value, expected);
  });
}

export type WebhookOutcome = { providerMessageId: string; outcome: "delivered" | "failed" | "bounced" } | null;

/** What a Resend event means for a message, or null for one that changes nothing. */
export function webhookOutcome(body: string): WebhookOutcome {
  let event: { type?: unknown; data?: { email_id?: unknown } };
  try {
    event = JSON.parse(body);
  } catch {
    return null;
  }
  const id = event.data?.email_id;
  if (typeof id !== "string" || !id) return null;
  if (event.type === "email.delivered") return { providerMessageId: id, outcome: "delivered" };
  if (event.type === "email.bounced") return { providerMessageId: id, outcome: "bounced" };
  // A complaint means the person does not want this mail. It is treated like a bounce: nothing more goes to that address without a person.
  if (event.type === "email.complained") return { providerMessageId: id, outcome: "bounced" };
  if (event.type === "email.failed") return { providerMessageId: id, outcome: "failed" };
  return null;
}

/** The id of an email that arrived at the receiving domain, from the service's notice, or null for any other event. The notice carries no body. */
export function receivedEmailId(body: string): string | null {
  try {
    const event = JSON.parse(body) as { type?: unknown; data?: { email_id?: unknown } };
    const id = event.data?.email_id;
    return event.type === "email.received" && typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
