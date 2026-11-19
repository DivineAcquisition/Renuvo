/**
 * What a customer wrote in an email, with everything they did not write taken out: the message they were
 * replying to, forwarded headers, and a signature. An email reply carries the company's own earlier
 * words underneath it, and reading those as the customer's would put words in their mouth.
 *
 * The result is untrusted text like any other customer message. It is read by rules, never obeyed.
 */

const QUOTE_START = [
  /^On .{4,200} wrote:\s*$/i,
  /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^From:\s.+/i,
  /^Sent from my .{2,40}$/i,
  /^Get Outlook for .{2,20}$/i,
];
const SIGNATURE = /^--\s?$/;

/** Mail a machine sent: an out-of-office answer, a bounce, a list. Never read as the customer speaking. */
export function isAutomatic(header: { from: string; subject: string }): boolean {
  if (/^(automatic reply|auto(-|\s)?reply|out of (the )?office|undeliverable|delivery status notification|mail delivery)/i.test(header.subject.trim())) return true;
  return /\b(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?)@/i.test(header.from);
}

/** The customer's own lines, oldest quoting removed, cut to `max`. Empty when they wrote nothing new. */
export function replyText(body: string, max = 2000): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (SIGNATURE.test(line)) break;
    if (QUOTE_START.some((pattern) => pattern.test(line.trim()))) break;
    // "On <date>, <name>\n<address> wrote:" wrapped across two lines by the mail program.
    if (/^On .{4,200}$/i.test(line.trim()) && /wrote:\s*$/i.test((lines[i + 1] ?? "").trim())) break;
    if (line.trimStart().startsWith(">")) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
