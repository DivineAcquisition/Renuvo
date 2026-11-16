/**
 * The one door every outbound email goes through. Applicant email is sent from a Selestial sending
 * domain with the company's name on it and the company's hiring inbox as Reply-To. Resend is the real
 * provider (resend.ts); it runs only when its key and sending address are set. The mock answers from the address alone, so a test can
 * ask for a delivered message, a bounce, a provider that fails and recovers, or a send that dies half way.
 */
import type { SendResult } from "./provider";
import { resendProvider } from "./resend";

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

/**
 * The provider this deployment uses, from EMAIL_PROVIDER. Null means email is not connected, including
 * "resend" chosen without its key or its sending address: nothing is sent half set up.
 */
export function emailProvider(): EmailProvider | null {
  const name = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (name === "mock") return mockEmailProvider;
  if (name === "resend") {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const fromAddress = process.env.EMAIL_FROM_ADDRESS?.trim().toLowerCase();
    return apiKey && fromAddress && /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(fromAddress) ? resendProvider({ apiKey, fromAddress }) : null;
  }
  return null;
}
