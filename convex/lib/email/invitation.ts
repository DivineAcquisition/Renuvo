/**
 * The invitation email. Pure, like the layout it is set in. The only secret in it is the token inside
 * the link; there is no password and nothing else to copy.
 */
import { emailLayout, emailText, escapeHtml } from "./layout";

const ROLE_WORDS = { manager: "Manager", office: "Office" } as const;

/** The day the link stops working, on the company's clock. A zone that is not one falls back to UTC. */
function expiryDate(expiresAt: number, timezone?: string): string {
  const format = (timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "long" }).format(new Date(expiresAt));
  try {
    return format(timezone?.trim() || "UTC");
  } catch {
    return format("UTC");
  }
}

/** One line, so a name can never add a header or break the subject. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function invitationEmail(input: {
  companyName: string;
  inviterName: string;
  role: "manager" | "office";
  url: string;
  expiresAt: number;
  timezone?: string;
}): { subject: string; html: string; text: string } {
  const company = oneLine(input.companyName);
  const inviter = oneLine(input.inviterName);
  const role = ROLE_WORDS[input.role];
  const until = expiryDate(input.expiresAt, input.timezone);

  const heading = `Join ${company} on Selestial`;
  const invited = `${inviter} invited you to join ${company} on Selestial. Your role will be ${role}.`;
  const how = "To accept, sign in with the email address this message was sent to.";
  const expires = `This link stops working on ${until}.`;
  const action = { label: "Accept invitation", url: input.url };
  const footnote = "If you did not expect this invitation, you can ignore this email. Nothing happens unless you accept.";

  const paragraph = (html: string, last = false) => `<p style="margin:0 0 ${last ? 0 : 12}px 0;">${html}</p>`;
  const bodyHtml = [
    paragraph(`<strong>${escapeHtml(inviter)}</strong> invited you to join <strong>${escapeHtml(company)}</strong> on Selestial. Your role will be <strong>${role}</strong>.`),
    paragraph(escapeHtml(how)),
    paragraph(escapeHtml(expires), true),
  ].join("");

  return {
    subject: `${inviter} invited you to ${company} on Selestial`,
    html: emailLayout({ preheader: invited, heading, bodyHtml, action, footnote }),
    text: emailText({ heading, lines: [invited, how, expires], action, footnote }),
  };
}
