/**
 * Selestial's email kit: the pieces every email is built from, for mail programs (docs/email/01-design.md).
 *
 * Pure: no imports, nothing only Convex or only Node has, so functions, tests, a script and the preview
 * gallery all render the same thing. Every block returns its HTML and its plain-text twin together, so the
 * text version can never drift from what the HTML says.
 *
 * Built for Gmail, Apple Mail and Outlook: tables for layout, inline styles, a 600px reading column,
 * a "bulletproof" button with an Outlook (VML) fallback, real text when images are off, and a dark-mode
 * palette for the clients that honour it. No scripts, no web fonts, no tracking pixels, no progress bars.
 * Every value passed in is escaped here; nothing a caller passes can add markup.
 */

// ── Tokens ───────────────────────────────────────────────────────────────────────────────────────

/** From the app's own tokens (src/app/globals.css): brand-500 for actions, brand-700 for links on white. */
export const TOKENS = {
  violet: "#6838EF",
  violetDeep: "#5126C7",
  violetSoft: "#F3EFFF",
  page: "#F5F4FA",
  card: "#FFFFFF",
  text: "#211A35",
  secondary: "#5E6478",
  muted: "#8A8FA3",
  border: "#E6E3F0",
  success: "#067647",
  successSoft: "#ECFDF3",
  warning: "#B54708",
  warningSoft: "#FFF6E5",
  danger: "#B42318",
  dangerSoft: "#FEF3F2",
  dark: { page: "#100E1C", card: "#1B1830", text: "#F2F0FA", secondary: "#B9B5CC", border: "#302B4A", link: "#B39EFF", soft: "#272143" },
} as const;

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
const TONE: Record<Tone, { fg: string; bg: string; dot: string }> = {
  neutral: { fg: TOKENS.secondary, bg: "#F4F3F8", dot: TOKENS.muted },
  info: { fg: TOKENS.violetDeep, bg: TOKENS.violetSoft, dot: TOKENS.violet },
  success: { fg: TOKENS.success, bg: TOKENS.successSoft, dot: "#12B76A" },
  warning: { fg: TOKENS.warning, bg: TOKENS.warningSoft, dot: "#F79009" },
  danger: { fg: TOKENS.danger, bg: TOKENS.dangerSoft, dot: "#F04438" },
};

// ── Safety ───────────────────────────────────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** One line: a value can never add a header, a line break in a subject, or a second paragraph. */
export function oneLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Only an http(s) address becomes a link. Anything else is dropped rather than linked. */
export function webAddress(url: string | null | undefined): string | null {
  const trimmed = (url ?? "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(trimmed) ? trimmed : null;
}

/** A hex colour a company chose, kept only if white text on it is readable (contrast ≥ 4.5:1). */
export function safeAccent(color: string | null | undefined): string {
  const hex = (color ?? "").trim();
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return TOKENS.violet;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return 1.05 / (luminance + 0.05) >= 4.5 ? hex.toUpperCase() : TOKENS.violet;
}

// ── Blocks ───────────────────────────────────────────────────────────────────────────────────────

/** A piece of an email: its HTML and the same words as plain text. */
export type Block = { html: string; text: string };

const p = (style: string, html: string, cls = "") => `<p style="margin:0;font-family:${FONT};${style}"${cls ? ` class="${cls}"` : ""}>${html}</p>`;
const spacer = (px: number) => `<tr><td style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</td></tr>`;

/** Who the email is about and where things stand: "Dispatch · Needs your decision". */
export function agentStatus(input: { agent: string; state: string; tone?: Tone; avatarUrl?: string | null }): Block {
  const tone = TONE[input.tone ?? "info"];
  const avatar = webAddress(input.avatarUrl);
  const mark = avatar
    ? `<img src="${escapeHtml(avatar)}" width="28" height="28" alt="${escapeHtml(input.agent)}" style="display:block;width:28px;height:28px;border-radius:14px;border:0;">`
    : `<div style="width:28px;height:28px;border-radius:14px;background-color:${TOKENS.violetSoft};font-family:${FONT};font-size:13px;line-height:28px;font-weight:700;text-align:center;color:${TOKENS.violetDeep};">${escapeHtml(input.agent.slice(0, 1).toUpperCase())}</div>`;
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding:0 10px 0 0;vertical-align:middle;">${mark}</td>
      <td style="vertical-align:middle;font-family:${FONT};font-size:13px;line-height:18px;font-weight:600;color:${TOKENS.text};" class="sx-text">${escapeHtml(input.agent)}<span style="color:${TOKENS.muted};font-weight:400;"> &middot; </span><span style="color:${tone.fg};" class="sx-${input.tone ?? "info"}">&#9679;&nbsp;${escapeHtml(input.state)}</span></td>
    </tr></table>`,
    text: `${input.agent} · ${input.state}`,
  };
}

export function eyebrow(text: string): Block {
  return { html: p(`font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.secondary};`, escapeHtml(text), "sx-sub"), text: text.toUpperCase() };
}

export function title(text: string): Block {
  return { html: `<h1 style="margin:0;font-family:${FONT};font-size:24px;line-height:32px;font-weight:650;letter-spacing:-0.01em;color:${TOKENS.text};word-break:break-word;" class="sx-text">${escapeHtml(text)}</h1>`, text: text };
}

/** The short outcome: what happened and why it matters, in one or two sentences. */
export function lead(text: string): Block {
  return { html: p(`font-size:16px;line-height:26px;color:${TOKENS.text};`, escapeHtml(text), "sx-text"), text };
}

export function paragraph(text: string): Block {
  return { html: p(`font-size:15px;line-height:24px;color:${TOKENS.secondary};`, escapeHtml(text), "sx-sub"), text };
}

/** Key facts as label/value rows. Values are what the records say; a missing one is left out, never invented. */
export function facts(rows: { label: string; value: string | null | undefined }[], heading?: string): Block {
  const present = rows.filter((r) => r.value && r.value.trim());
  if (!present.length) return { html: "", text: "" };
  const head = heading ? `<tr><td colspan="2" style="padding:0 0 8px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(heading)}</td></tr>` : "";
  const body = present
    .map(
      (r, i) => `<tr>
        <td valign="top" style="padding:${i ? 10 : 0}px 16px 0 0;width:38%;font-family:${FONT};font-size:14px;line-height:20px;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(r.label)}</td>
        <td valign="top" style="padding:${i ? 10 : 0}px 0 0 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${TOKENS.text};" class="sx-text">${escapeHtml(r.value!)}</td>
      </tr>`,
    )
    .join("");
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${TOKENS.border};border-radius:10px;" class="sx-panel"><tr><td style="padding:16px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${head}${body}</table></td></tr></table>`,
    text: `${heading ? `${heading}\n` : ""}${present.map((r) => `${r.label}: ${r.value}`).join("\n")}`,
  };
}

/**
 * The one dominant action. A bulletproof button: a real link with padding for every client, and VML for
 * desktop Outlook, which ignores padding on links. Opening it never approves, signs or accepts anything:
 * it opens a page where the person decides.
 */
export function action(input: { label: string; url: string; accent?: string | null; showAddress?: boolean }): Block {
  const url = webAddress(input.url);
  if (!url) return { html: "", text: "" };
  const color = safeAccent(input.accent);
  const label = escapeHtml(oneLine(input.label));
  const width = Math.min(520, Math.max(180, Math.round(oneLine(input.label).length * 9 + 56)));
  // For a link that matters on its own (an invitation), the address is also written out, for a mail
  // program that won't show the button.
  const address = input.showAddress
    ? `<tr><td style="padding:12px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${TOKENS.secondary};word-break:break-all;" class="sx-sub">If the button doesn't work, copy this address into your browser:<br><a href="${escapeHtml(url)}" target="_blank" style="color:${TOKENS.violetDeep};text-decoration:underline;" class="sx-link">${escapeHtml(url)}</a></td></tr>`
    : "";
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(url)}" style="height:46px;v-text-anchor:middle;width:${width}px;" arcsize="18%" stroke="f" fillcolor="${color}"><w:anchorlock/><center style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
      <!--[if !mso]><!--><a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;background-color:${color};border-radius:9px;padding:13px 24px;font-family:${FONT};font-size:16px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;mso-hide:all;">${label}</a><!--<![endif]-->
    </td></tr>${address}</table>`,
    text: `${oneLine(input.label)}:\n${url}`,
  };
}

/** A quiet second route: a text link, never a second button. */
export function textLink(input: { label: string; url: string; before?: string }): Block {
  const url = webAddress(input.url);
  if (!url) return { html: "", text: "" };
  return {
    html: p(`font-size:14px;line-height:22px;color:${TOKENS.secondary};`, `${input.before ? `${escapeHtml(input.before)} ` : ""}<a href="${escapeHtml(url)}" target="_blank" style="color:${TOKENS.violetDeep};text-decoration:underline;" class="sx-link">${escapeHtml(input.label)}</a>`, "sx-sub"),
    text: `${input.before ? `${input.before} ` : ""}${input.label}: ${url}`,
  };
}

/** A list of short lines, for "What Dispatch already tried" or what a document request needs. */
export function checklist(input: { heading: string; items: { text: string; state?: "done" | "open" | "failed" }[] }): Block {
  if (!input.items.length) return { html: "", text: "" };
  const mark = { done: { glyph: "&#10003;", color: TOKENS.success }, open: { glyph: "&#9675;", color: TOKENS.muted }, failed: { glyph: "&#10007;", color: TOKENS.danger } } as const;
  const rows = input.items
    .map((item) => {
      const m = mark[item.state ?? "done"];
      return `<tr><td valign="top" style="padding:6px 10px 0 0;width:16px;font-family:${FONT};font-size:14px;line-height:20px;color:${m.color};">${m.glyph}</td><td style="padding:6px 0 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${TOKENS.text};" class="sx-text">${escapeHtml(item.text)}</td></tr>`;
    })
    .join("");
  const words = { done: "Done", open: "To do", failed: "Didn't work" } as const;
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(input.heading)}</td></tr><tr><td><table role="presentation" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`,
    text: `${input.heading}\n${input.items.map((i) => `- ${i.text}${i.state && i.state !== "done" ? ` (${words[i.state]})` : ""}`).join("\n")}`,
  };
}

/** Money lines and a total, for a quote or an invoice. Amounts arrive already formatted by the caller. */
export function amounts(input: { heading?: string; lines: { label: string; amount: string; muted?: boolean }[]; total?: { label: string; amount: string }; note?: string | null }): Block {
  const rows = input.lines
    .map((l) => `<tr><td style="padding:8px 0 0 0;font-family:${FONT};font-size:14px;line-height:20px;color:${l.muted ? TOKENS.secondary : TOKENS.text};" class="${l.muted ? "sx-sub" : "sx-text"}">${escapeHtml(l.label)}</td><td align="right" style="padding:8px 0 0 12px;font-family:${FONT};font-size:14px;line-height:20px;color:${l.muted ? TOKENS.secondary : TOKENS.text};white-space:nowrap;" class="${l.muted ? "sx-sub" : "sx-text"}">${escapeHtml(l.amount)}</td></tr>`)
    .join("");
  const total = input.total
    ? `<tr><td colspan="2" style="padding:12px 0 0 0;"><div style="height:1px;line-height:1px;font-size:0;background-color:${TOKENS.border};">&nbsp;</div></td></tr><tr><td style="padding:12px 0 0 0;font-family:${FONT};font-size:15px;line-height:22px;font-weight:700;color:${TOKENS.text};" class="sx-text">${escapeHtml(input.total.label)}</td><td align="right" style="padding:12px 0 0 12px;font-family:${FONT};font-size:18px;line-height:22px;font-weight:700;color:${TOKENS.text};white-space:nowrap;" class="sx-text">${escapeHtml(input.total.amount)}</td></tr>`
    : "";
  const head = input.heading ? `<tr><td colspan="2" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(input.heading)}</td></tr>` : "";
  const note = input.note ? `<tr><td colspan="2" style="padding:12px 0 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(input.note)}</td></tr>` : "";
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${TOKENS.border};border-radius:10px;" class="sx-panel"><tr><td style="padding:16px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${head}${rows}${total}${note}</table></td></tr></table>`,
    text: [input.heading, ...input.lines.map((l) => `${l.label}: ${l.amount}`), input.total ? `${input.total.label}: ${input.total.amount}` : null, input.note].filter(Boolean).join("\n"),
  };
}

/** An alert with what to do about it. Tone is repeated in words, never colour alone. */
export function alert(input: { tone: Exclude<Tone, "neutral" | "info"> | "info"; title: string; body?: string; steps?: string[] }): Block {
  const tone = TONE[input.tone];
  const word = { info: "Note", success: "Done", warning: "Needs attention", danger: "Action needed" }[input.tone];
  const steps = input.steps?.length ? `<ol style="margin:8px 0 0 18px;padding:0;font-family:${FONT};font-size:14px;line-height:22px;color:${TOKENS.text};" class="sx-text">${input.steps.map((s) => `<li style="margin:0 0 4px 0;">${escapeHtml(s)}</li>`).join("")}</ol>` : "";
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:${tone.bg};border-left:3px solid ${tone.dot};border-radius:8px;padding:14px 16px;" class="sx-soft">
      ${p(`font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${tone.fg};`, escapeHtml(word), `sx-${input.tone}`)}
      ${p(`padding-top:4px;font-size:15px;line-height:22px;font-weight:600;color:${TOKENS.text};`, escapeHtml(input.title), "sx-text")}
      ${input.body ? p(`padding-top:4px;font-size:14px;line-height:22px;color:${TOKENS.text};`, escapeHtml(input.body), "sx-text") : ""}${steps}
    </td></tr></table>`,
    text: [`${word}: ${input.title}`, input.body, ...(input.steps ?? []).map((s, i) => `${i + 1}. ${s}`)].filter(Boolean).join("\n"),
  };
}

/** One section of a digest: a heading, a few counted lines, each optionally linking to its record. */
export function digestSection(input: { heading: string; summary?: string; items: { label: string; detail?: string; url?: string }[]; empty?: string }): Block {
  const items = input.items.slice(0, 6);
  const more = input.items.length - items.length;
  const rows = items.length
    ? items
        .map((i) => {
          const url = webAddress(i.url);
          const label = url ? `<a href="${escapeHtml(url)}" target="_blank" style="color:${TOKENS.text};text-decoration:none;font-weight:600;" class="sx-text">${escapeHtml(i.label)}</a>` : `<span style="font-weight:600;">${escapeHtml(i.label)}</span>`;
          return `<tr><td style="padding:10px 0 0 0;border-top:1px solid ${TOKENS.border};font-family:${FONT};font-size:14px;line-height:20px;color:${TOKENS.text};" class="sx-text sx-rule">${label}${i.detail ? `<br><span style="color:${TOKENS.secondary};font-weight:400;" class="sx-sub">${escapeHtml(i.detail)}</span>` : ""}</td></tr><tr><td style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>`;
        })
        .join("")
    : `<tr><td style="padding:10px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(input.empty ?? "Nothing this week.")}</td></tr>`;
  const moreRow = more > 0 ? `<tr><td style="font-family:${FONT};font-size:13px;line-height:20px;color:${TOKENS.secondary};" class="sx-sub">and ${more} more</td></tr>` : "";
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="font-family:${FONT};font-size:16px;line-height:24px;font-weight:650;color:${TOKENS.text};" class="sx-text">${escapeHtml(input.heading)}</td></tr>
      ${input.summary ? `<tr><td style="padding:2px 0 6px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(input.summary)}</td></tr>` : ""}
      ${rows}${moreRow}
    </table>`,
    text: [input.heading, input.summary, ...(items.length ? items.map((i) => `- ${i.label}${i.detail ? ` (${i.detail})` : ""}${webAddress(i.url) ? `: ${i.url}` : ""}`) : [input.empty ?? "Nothing this week."]), more > 0 ? `and ${more} more` : null].filter(Boolean).join("\n"),
  };
}

/** Big numbers for a summary, side by side: each a real count from the records, with its label. */
export function stats(items: { label: string; value: string }[]): Block {
  const cells = items.slice(0, 3);
  if (!cells.length) return { html: "", text: "" };
  const width = Math.floor(100 / cells.length);
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells
      .map((c, i) => `<td width="${width}%" valign="top" style="padding:${i ? "0 0 0 8px" : "0"};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:${TOKENS.violetSoft};border-radius:10px;padding:14px 14px;" class="sx-soft"><p style="margin:0;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${TOKENS.text};" class="sx-text">${escapeHtml(c.value)}</p><p style="margin:2px 0 0 0;font-family:${FONT};font-size:12px;line-height:16px;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(c.label)}</p></td></tr></table></td>`)
      .join("")}</tr></table>`,
    text: cells.map((c) => `${c.label}: ${c.value}`).join("\n"),
  };
}

export function divider(): Block {
  return { html: `<div style="height:1px;line-height:1px;font-size:0;background-color:${TOKENS.border};" class="sx-rule-bg">&nbsp;</div>`, text: "" };
}

/** A company's restrained signature for messages sent on its behalf. */
export function signature(input: { name?: string | null; company: string; phone?: string | null; email?: string | null; website?: string | null }): Block {
  const lines = [input.name, input.company, [input.phone, input.email].filter(Boolean).join(" · "), webAddress(input.website) ? input.website : null].filter((l): l is string => Boolean(l && l.trim()));
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:2px solid ${TOKENS.border};padding:2px 0 2px 12px;font-family:${FONT};font-size:14px;line-height:21px;color:${TOKENS.secondary};" class="sx-sub">${lines.map((l, i) => (i === 0 ? `<span style="color:${TOKENS.text};font-weight:600;" class="sx-text">${escapeHtml(l)}</span>` : escapeHtml(l))).join("<br>")}</td></tr></table>`,
    text: lines.join("\n"),
  };
}

// ── The frame ────────────────────────────────────────────────────────────────────────────────────

/** Who the email is from, which sets the header and the footer's wording. */
export type Identity =
  /**
   * Selestial writing to the people who use it. The mark is a small image beside the name as live text,
   * so the name stays readable in dark mode and with images off.
   */
  | { kind: "platform"; markUrl?: string | null }
  /** A cleaning company writing to its customers, applicants or cleaners. */
  | { kind: "company"; name: string; logoUrl?: string | null; accent?: string | null; viaSelestial: boolean; address?: string | null };

export type Footer = {
  /** Why this person got it: "You're getting this because you're the Owner of Sparkle Cleaning." */
  reason: string;
  preferencesUrl?: string | null;
  /** Only for email a person can opt out of. Security and account notices never carry one. */
  unsubscribeUrl?: string | null;
};

function header(identity: Identity): Block {
  if (identity.kind === "platform") {
    const mark = webAddress(identity.markUrl);
    const name = `<span style="font-family:${FONT};font-size:20px;line-height:28px;font-weight:700;letter-spacing:-0.01em;color:${TOKENS.text};" class="sx-text">Selestial</span>`;
    return {
      html: mark
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:0 8px 0 0;vertical-align:middle;"><img src="${escapeHtml(mark)}" width="16" height="28" alt="" style="display:block;width:16px;height:28px;border:0;"></td><td style="vertical-align:middle;">${name}</td></tr></table>`
        : name,
      text: "Selestial",
    };
  }
  const logo = webAddress(identity.logoUrl);
  const name = escapeHtml(oneLine(identity.name));
  return {
    html: logo
      ? `<img src="${escapeHtml(logo)}" height="40" alt="${name}" style="display:block;height:40px;max-width:200px;border:0;font-family:${FONT};font-size:18px;font-weight:700;color:${TOKENS.text};">`
      : `<span style="font-family:${FONT};font-size:18px;line-height:24px;font-weight:700;color:${safeAccent(identity.accent) === TOKENS.violet ? TOKENS.text : safeAccent(identity.accent)};" class="sx-text">${name}</span>`,
    text: oneLine(identity.name),
  };
}

function footer(identity: Identity, f: Footer): Block {
  const links = [
    webAddress(f.preferencesUrl) ? `<a href="${escapeHtml(f.preferencesUrl!)}" target="_blank" style="color:${TOKENS.secondary};text-decoration:underline;" class="sx-sub">Notification settings</a>` : null,
    webAddress(f.unsubscribeUrl) ? `<a href="${escapeHtml(f.unsubscribeUrl!)}" target="_blank" style="color:${TOKENS.secondary};text-decoration:underline;" class="sx-sub">Unsubscribe</a>` : null,
  ].filter(Boolean);
  const sender =
    identity.kind === "platform"
      ? "Selestial · Software for cleaning companies"
      : `${oneLine(identity.name)}${identity.viaSelestial ? " · sent via Selestial" : ""}${identity.address ? ` · ${oneLine(identity.address)}` : ""}`;
  return {
    html: `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${TOKENS.secondary};" class="sx-sub">${escapeHtml(f.reason)}</p>
      ${links.length ? `<p style="margin:8px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${TOKENS.secondary};" class="sx-sub">${links.join(" &nbsp;·&nbsp; ")}</p>` : ""}
      <p style="margin:8px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${TOKENS.muted};">${escapeHtml(sender)}</p>`,
    text: [f.reason, webAddress(f.preferencesUrl) ? `Notification settings: ${f.preferencesUrl}` : null, webAddress(f.unsubscribeUrl) ? `Unsubscribe: ${f.unsubscribeUrl}` : null, sender].filter(Boolean).join("\n"),
  };
}

const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
@media (prefers-color-scheme: dark){
  .sx-page{background-color:${TOKENS.dark.page}!important;}
  .sx-card{background-color:${TOKENS.dark.card}!important;border-color:${TOKENS.dark.border}!important;}
  .sx-text{color:${TOKENS.dark.text}!important;}
  .sx-sub{color:${TOKENS.dark.secondary}!important;}
  .sx-panel{border-color:${TOKENS.dark.border}!important;}
  .sx-rule{border-color:${TOKENS.dark.border}!important;}
  .sx-rule-bg{background-color:${TOKENS.dark.border}!important;}
  .sx-soft{background-color:${TOKENS.dark.soft}!important;}
  .sx-link{color:${TOKENS.dark.link}!important;}
  .sx-info{color:#B39EFF!important;}
  .sx-success{color:#6CE9A6!important;}
  .sx-warning{color:#FEC84B!important;}
  .sx-danger{color:#FDA29B!important;}
  .sx-neutral{color:${TOKENS.dark.secondary}!important;}
}
[data-ogsc] .sx-text{color:${TOKENS.dark.text}!important;}
[data-ogsc] .sx-sub{color:${TOKENS.dark.secondary}!important;}
[data-ogsc] .sx-link{color:${TOKENS.dark.link}!important;}
[data-ogsb] .sx-page{background-color:${TOKENS.dark.page}!important;}
[data-ogsb] .sx-card{background-color:${TOKENS.dark.card}!important;}
@media only screen and (max-width:620px){
  .sx-pad{padding:24px 20px!important;}
  .sx-outer{padding:16px 10px!important;}
}`;

/**
 * A whole email. `blocks` is the card's content in order; empty blocks are skipped. The plain-text
 * version is built from the same blocks.
 */
export function renderEmail(input: { identity: Identity; preheader: string; blocks: Block[]; footer: Footer; lang?: string }): { html: string; text: string } {
  const head = header(input.identity);
  const foot = footer(input.identity, input.footer);
  const blocks = input.blocks.filter((b) => b.html);
  const body = blocks.map((b, i) => `${i ? spacer(20) : ""}<tr><td>${b.html}</td></tr>`).join("");
  const preheader = escapeHtml(oneLine(input.preheader));
  const html = `<!doctype html>
<html lang="${input.lang ?? "en"}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${preheader}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>${DARK_CSS}</style>
</head>
<body style="margin:0;padding:0;background-color:${TOKENS.page};" class="sx-page">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${TOKENS.page};">${preheader}${"&#8199;&#65279;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${TOKENS.page}" style="background-color:${TOKENS.page};" class="sx-page">
  <tr><td align="center" style="padding:32px 16px;" class="sx-outer">
    <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:0 4px 18px 4px;">${head.html}</td></tr>
      <tr><td bgcolor="${TOKENS.card}" style="background-color:${TOKENS.card};border:1px solid ${TOKENS.border};border-radius:14px;padding:32px 36px;" class="sx-card sx-pad">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>
      </td></tr>
      <tr><td style="padding:20px 8px 0 8px;">${foot.html}</td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>
`;
  const text = `${[head.text, ...blocks.map((b) => b.text), "—", foot.text].map((t) => t.trim()).filter(Boolean).join("\n\n")}\n`;
  return { html, text };
}
