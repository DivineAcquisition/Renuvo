/**
 * The invitation email, set on the email kit (convex/lib/email/templates/platform.ts). The only secret in
 * it is the token inside the link; there is no password and nothing else to copy.
 */
import { memberInvitationEmail } from "./templates/platform";

/** The app's own address, from the link: the mark image is served from the same place as the page it opens. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function invitationEmail(input: {
  companyName: string;
  inviterName: string;
  role: "manager" | "office";
  url: string;
  expiresAt: number;
  timezone?: string;
}): { subject: string; html: string; text: string } {
  const mail = memberInvitationEmail({ ...input, origin: originOf(input.url) });
  return { subject: mail.subject, html: mail.html, text: mail.text };
}
