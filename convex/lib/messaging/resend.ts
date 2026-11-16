/**
 * Resend, behind the EmailProvider interface (email.ts). Used when EMAIL_PROVIDER is "resend" and both
 * RESEND_API_KEY and EMAIL_FROM_ADDRESS (an address on the verified sending domain, for example
 * hiring@mail.selestial.io) are set on the deployment.
 *
 * The company's name is the display name and the company's hiring inbox is the Reply-To, so applicants
 * see who is writing and their replies reach the company. The message id is sent as the idempotency
 * key, so a retried send is one email.
 *
 * Delivery and bounces arrive later through the webhook in convex/http.ts.
 *
 * NOT VERIFIED against the live Resend API in this build: no key or verified domain was available. The
 * request and webhook shapes follow Resend's public documentation as understood when this was written.
 */
import type { EmailInput, EmailProvider, EmailResult } from "./email";

const ENDPOINT = "https://api.resend.com/emails";

/** Keeps a display name from breaking the From header. */
function displayName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim().slice(0, 80) || "Hiring Team";
}

export function resendProvider(config: { apiKey: string; fromAddress: string; fetch?: typeof fetch }): EmailProvider {
  const send = config.fetch ?? fetch;
  return {
    name: "resend",
    async send(input: EmailInput): Promise<EmailResult> {
      let response: Response;
      try {
        response = await send(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
          body: JSON.stringify({ from: `"${displayName(input.fromName)}" <${config.fromAddress}>`, to: [input.to], reply_to: input.replyTo, subject: input.subject, text: input.text }),
        });
      } catch {
        // Nobody knows whether it went. The message stays "sending" and is marked unconfirmed, never re-sent by itself.
        throw new Error("resend: no answer");
      }
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
        if (body && typeof body.id === "string") return { ok: true, providerMessageId: body.id, delivered: false };
        return { ok: false, retryable: false, problem: "The email service accepted the request but did not say which message it was." };
      }
      // Words for a person, never the provider's raw response.
      if (response.status === 429 || response.status >= 500) return { ok: false, retryable: true, problem: "The email service is busy or unavailable." };
      if (response.status === 401 || response.status === 403) return { ok: false, retryable: false, problem: "The email service refused the sending credentials." };
      return { ok: false, retryable: false, problem: "The email service would not send this message." };
    },
  };
}

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
