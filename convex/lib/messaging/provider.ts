/**
 * The one door every outbound text goes through: Telnyx (convex/lib/messaging/telnyx.ts) or the mock.
 * The mock answers from the number alone, so a test can ask for a delivered message, a failure, a
 * carrier that never confirms, or a send that dies half way.
 */
import { telnyxProvider } from "./telnyx";

/** `from` is the company's texting number. The mock ignores it. */
export type SendInput = { to: string; from?: string; body: string; idempotencyKey: string; attempt: number };

export type SendResult =
  /** The provider took the message. `delivered` is set only when it also confirmed the handset got it. */
  | { ok: true; providerMessageId: string; delivered: boolean }
  /** It did not go. `retryable` means trying again may work. `problem` is words for a person, never a raw response. */
  | { ok: false; retryable: boolean; problem: string };

export interface MessagingProvider {
  name: string;
  send(input: SendInput): Promise<SendResult>;
}

/** What the mock was asked to send, newest last. For tests only. */
export const mockOutbox: (SendInput & { result: "accepted" | "failed" | "threw" })[] = [];

/**
 * Test numbers, by their last four digits:
 * 0001 never deliverable. 0002 fails twice, then goes. 0003 the send dies with no answer.
 * 0004 accepted, but no delivery report ever comes. Anything else is accepted and delivered.
 */
export const mockProvider: MessagingProvider = {
  name: "mock",
  async send(input) {
    const tail = input.to.slice(-4);
    if (tail === "0003") {
      mockOutbox.push({ ...input, result: "threw" });
      throw new Error("mock: connection lost");
    }
    if (tail === "0001" || (tail === "0002" && input.attempt < 3)) {
      mockOutbox.push({ ...input, result: "failed" });
      return { ok: false, retryable: tail === "0002", problem: tail === "0002" ? "The carrier did not answer." : "The carrier says this number cannot receive texts." };
    }
    mockOutbox.push({ ...input, result: "accepted" });
    return { ok: true, providerMessageId: `mock-${input.idempotencyKey}`, delivered: tail !== "0004" };
  },
};

/** The provider this deployment uses, from MESSAGING_PROVIDER. Null means messaging is not connected. */
export function messagingProvider(): MessagingProvider | null {
  const name = process.env.MESSAGING_PROVIDER?.trim().toLowerCase();
  if (name === "mock") return mockProvider;
  if (name === "telnyx") return telnyxProvider();
  return null;
}

/** A number a text can be sent to, in +digits form, or null. */
export function sendablePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits.length === 10 ? `1${digits}` : digits}`;
}
