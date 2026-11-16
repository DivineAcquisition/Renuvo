/**
 * The one frame every Selestial email is set in. This file is pure: it imports nothing and uses nothing
 * that only Convex or only Node has, so a function, a test and a plain Node script can all use it.
 *
 * Built for mail programs: tables for layout, every style inline, no images, no web fonts, no scripts.
 * Every value passed in is escaped here except `bodyHtml`, which the caller builds from escaped pieces.
 */

export const BRAND = {
  violet: "#6838EF",
  page: "#F8F9FC",
  card: "#FFFFFF",
  text: "#211A35",
  secondary: "#667085",
  border: "#E4E7EF",
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailAction = { label: string; url: string };

/** Only a web address becomes a button. Anything else is left out instead of being linked. */
function webAddress(url: string): string | null {
  const trimmed = url.trim();
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

export function emailLayout(input: { preheader: string; heading: string; bodyHtml: string; action?: EmailAction; footnote?: string }): string {
  const url = input.action ? webAddress(input.action.url) : null;
  const action =
    input.action && url
      ? `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0 0;">
            <tr>
              <td align="center" bgcolor="${BRAND.violet}" style="background-color:${BRAND.violet};border-radius:8px;">
                <a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(input.action.label)}</a>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.secondary};">If the button does not work, copy this address into your browser:</p>
          <p style="margin:4px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.secondary};word-break:break-all;">${escapeHtml(url)}</p>`
      : "";
  const footnote = input.footnote
    ? `
      <tr>
        <td style="padding:20px 8px 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.secondary};">${escapeHtml(input.footnote)}</td>
      </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.page};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${BRAND.page};">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.page}" style="background-color:${BRAND.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr>
        <td style="padding:0 8px 20px 8px;font-family:${FONT};font-size:15px;line-height:20px;font-weight:700;letter-spacing:0.18em;color:${BRAND.violet};">SELESTIAL</td>
      </tr>
      <tr>
        <td bgcolor="${BRAND.card}" style="background-color:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;padding:32px;">
          <h1 style="margin:0 0 16px 0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;color:${BRAND.text};">${escapeHtml(input.heading)}</h1>
          <div style="font-family:${FONT};font-size:16px;line-height:24px;color:${BRAND.text};">${input.bodyHtml}</div>${action}
        </td>
      </tr>${footnote}
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

/** The same message for a mail program that shows no HTML. */
export function emailText(input: { heading: string; lines: string[]; action?: EmailAction; footnote?: string }): string {
  const url = input.action ? webAddress(input.action.url) : null;
  const parts = ["SELESTIAL", input.heading, ...input.lines];
  if (input.action && url) parts.push(`${input.action.label}:\n${url}`);
  if (input.footnote) parts.push(input.footnote);
  return `${parts.map((part) => part.trim()).filter(Boolean).join("\n\n")}\n`;
}
