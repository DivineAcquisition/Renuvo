/**
 * The one door every outbound email goes through. Applicant email is sent from a Selestial sending
 * address with the company's name on it and the company's hiring inbox as Reply-To. The real provider is
 * the shared one in convex/lib/email/provider.ts. The mock answers from the address alone, so a test can
 * ask for a delivered message, a bounce, a provider that fails and recovers, or a send that dies half way.
 */
import { emailProvider as sharedEmailProvider } from "../email/provider";
import type { SendResult } from "./provider";

export type EmailInput = { to: string; fromName: string; replyTo: string; subject: string; text: string; idempotencyKey: string; attempt: number };

export type EmailResult = SendResult | { ok: false; retryable: false; problem: string; bounced: true };

export interface EmailProvider {
  name: string;
  send(input: EmailInput): Promise<EmailResult>;
}

/** What the mock was asked to send, newest last. For tests only. */
export const mockEmails: (EmailInput & { result: "accepted" | "failed" | "bounced" | "threw" })[] = [];

/**
 * Test addresses, by the part before the @:
 * bounce… the address rejects it. flaky… fails twice, then goes. crash… the send dies with no answer.
 * slow… accepted, but no delivery report ever comes. Anything else is accepted and delivered.
 */
export const mockEmailProvider: EmailProvider = {
  name: "mock-email",
  async send(input) {
    const local = input.to.slice(0, input.to.indexOf("@"));
    if (local.startsWith("crash")) {
      mockEmails.push({ ...input, result: "threw" });
      throw new Error("mock: connection lost");
    }
    if (local.startsWith("bounce")) {
      mockEmails.push({ ...input, result: "bounced" });
      return { ok: false, retryable: false, problem: "The address rejected the message.", bounced: true };
    }
    if (local.startsWith("flaky") && input.attempt < 3) {
      mockEmails.push({ ...input, result: "failed" });
      return { ok: false, retryable: true, problem: "The email service did not answer." };
    }
    mockEmails.push({ ...input, result: "accepted" });
    return { ok: true, providerMessageId: `mock-email-${input.idempotencyKey}`, delivered: !local.startsWith("slow") };
  },
};

/** An applicant email's text as simple HTML: the company is the sender, so it carries no Selestial branding. */
export function plainHtml(text: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const paragraphs = text.split(/\n{2,}/).map((block) => `<p style="margin:0 0 14px 0;">${escape(block).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#211A35;">${paragraphs.join("")}</body></html>`;
}

/**
 * The provider applicant email uses. "mock" is the applicant test double above (it can bounce). Every
 * real provider is the one shared email door, convex/lib/email/provider.ts, the same Resend connection
 * that sends member invitations. Null means email is not connected, including Resend set up only half.
 */
export function emailProvider(): EmailProvider | null {
  const name = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (name === "mock") return mockEmailProvider;
  const shared = sharedEmailProvider();
  if (!shared) return null;
  return {
    name: shared.name,
    async send(input) {
      const result = await shared.send({ to: input.to, subject: input.subject, text: input.text, html: plainHtml(input.text), idempotencyKey: input.idempotencyKey, fromName: input.fromName, replyTo: input.replyTo });
      // The provider took it. Whether it arrived comes later, from the webhook (convex/http.ts).
      return result.ok ? { ok: true, providerMessageId: result.providerMessageId, delivered: false } : result;
    },
  };
}
