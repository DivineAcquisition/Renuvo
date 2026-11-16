/**
 * The one door every outbound email goes through. EMAIL_PROVIDER on the deployment picks the provider:
 * "mock" for development and tests, "resend" for real mail. Anything else means email is not connected.
 *
 * A provider's answer is turned into plain words here. Its raw response and the API key never leave
 * this file: they are not returned, not logged and not stored.
 */
export type EmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  /** Shown as the sender's name in place of EMAIL_FROM's, on the same address. For mail sent on a company's behalf. */
  fromName?: string;
  /** Where replies go, for example a company's own hiring inbox. */
  replyTo?: string;
  /** Another address on EMAIL_FROM's verified domain to send from, for example a no-reply address. */
  fromAddress?: string;
};

/** EMAIL_FROM with another display name on the same address. A name cannot break the header. */
export function senderWithName(from: string, name: string | undefined, fromAddress?: string): string {
  const own = from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? from.trim();
  // Only an address on the same verified domain may replace EMAIL_FROM's.
  const domain = (value: string) => value.slice(value.lastIndexOf("@") + 1).toLowerCase();
  const address = fromAddress && /^[^\s@<>"]+@[^\s@<>"]+$/.test(fromAddress) && domain(fromAddress) === domain(own) ? fromAddress : own;
  const clean = (name ?? "").replace(/["<>\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (clean) return `"${clean}" <${address}>`;
  return address === own ? from : address;
}

export type EmailResult =
  /** The provider took the message. That is all it says: nobody knows whether it was read. */
  | { ok: true; providerMessageId: string }
  /** It did not go. `retryable` means trying again may work. `problem` is words for a person. */
  | { ok: false; retryable: boolean; problem: string };

export interface EmailProvider {
  name: string;
  send(input: EmailInput): Promise<EmailResult>;
}

/** What the mock was asked to send, newest last. For tests only. */
export const mockEmailOutbox: (EmailInput & { result: "accepted" | "failed" | "threw" })[] = [];

/**
 * Test addresses, by their ending: @fail.test is never deliverable. @throw.test dies with no answer.
 * @busy.test fails twice, then goes. Anything else is accepted.
 */
export const mockEmailProvider: EmailProvider = {
  name: "mock",
  async send(input) {
    if (input.to.endsWith("@throw.test")) {
      mockEmailOutbox.push({ ...input, result: "threw" });
      throw new Error("mock: connection lost");
    }
    if (input.to.endsWith("@fail.test")) {
      mockEmailOutbox.push({ ...input, result: "failed" });
      return { ok: false, retryable: false, problem: "The email service says this address cannot receive email." };
    }
    const earlier = mockEmailOutbox.filter((row) => row.idempotencyKey === input.idempotencyKey).length;
    if (input.to.endsWith("@busy.test") && earlier < 2) {
      mockEmailOutbox.push({ ...input, result: "failed" });
      return { ok: false, retryable: true, problem: "The email service is busy." };
    }
    mockEmailOutbox.push({ ...input, result: "accepted" });
    return { ok: true, providerMessageId: `mock-${input.idempotencyKey}` };
  },
};

/** What a refusal from Resend means, by its status. The body is never read into a result. */
function refused(status: number): EmailResult {
  if (status === 401 || status === 403) return { ok: false, retryable: false, problem: "Email couldn’t be sent right now." };
  if (status === 409) return { ok: false, retryable: false, problem: "The email service is already handling this message." };
  if (status === 429) return { ok: false, retryable: true, problem: "The email service is busy. It can be tried again shortly." };
  if (status >= 500) return { ok: false, retryable: true, problem: "The email service is not answering right now." };
  return { ok: false, retryable: false, problem: "The email service did not accept this message." };
}

function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(input) {
      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
          body: JSON.stringify({ from: senderWithName(from, input.fromName, input.fromAddress), to: [input.to], subject: input.subject, html: input.html, text: input.text, ...(input.replyTo ? { reply_to: input.replyTo } : {}) }),
        });
      } catch {
        // The same idempotency key goes with every try, so trying again cannot send the message twice.
        return { ok: false, retryable: true, problem: "The email service could not be reached." };
      }
      if (!response.ok) return refused(response.status);
      let id: unknown;
      try {
        id = ((await response.json()) as { id?: unknown } | null)?.id;
      } catch {
        id = undefined;
      }
      return { ok: true, providerMessageId: typeof id === "string" && id ? id : "unknown" };
    },
  };
}

/** The provider this deployment uses, from EMAIL_PROVIDER. Null means email is not connected. */
export function emailProvider(): EmailProvider | null {
  const name = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (name === "mock") return mockEmailProvider;
  if (name === "resend") {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    return apiKey && from ? resendProvider(apiKey, from) : null;
  }
  return null;
}
