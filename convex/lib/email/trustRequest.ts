/**
 * The email to Selestial's own security or privacy inbox when a request arrives. Pure, like the layout.
 *
 * It says that something arrived, what kind, and its reference. It does not carry what the person wrote,
 * their name or their address: those stay in the record, behind the staff sign-in, so a forwarded or
 * leaked email gives away nothing about the requester or the vulnerability.
 */
import { emailLayout, emailText, escapeHtml } from "./layout";

const KIND_WORDS = {
  privacy: "privacy request",
  vulnerability: "vulnerability report",
  security_review: "security review request",
} as const;

const SUBTYPE_WORDS: Record<string, string> = {
  access: "access to data",
  correction: "correction",
  deletion: "deletion",
  communication_preferences: "communication preferences",
  other: "other",
};

export function trustRequestEmail(input: { kind: keyof typeof KIND_WORDS; subtype?: string; reference: string; receivedAt: number; staffUrl?: string | null }): {
  subject: string;
  html: string;
  text: string;
} {
  const kind = KIND_WORDS[input.kind];
  const subtype = input.subtype ? SUBTYPE_WORDS[input.subtype] ?? null : null;
  const received = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" }).format(new Date(input.receivedAt));
  const heading = `New ${kind}`;
  const lines = [
    `A ${kind}${subtype ? ` (${subtype})` : ""} arrived through the Selestial website on ${received} UTC.`,
    `Reference: ${input.reference}`,
    "What the person wrote is in the staff request queue, not in this email. Sign in as staff to read it.",
  ];
  const action = input.staffUrl ? { label: "Open the request queue", url: input.staffUrl } : undefined;
  const bodyHtml = lines.map((line, index) => `<p style="margin:0 0 ${index === lines.length - 1 ? 0 : 12}px 0;">${escapeHtml(line)}</p>`).join("");
  return {
    subject: `${heading} ${input.reference}`,
    html: emailLayout({ preheader: lines[0], heading, bodyHtml, action }),
    text: emailText({ heading, lines, action }),
  };
}
