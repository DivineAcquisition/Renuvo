/**
 * The address a customer's email reply comes back to. Each opportunity has its own, on the receiving
 * domain (SALES_REPLY_DOMAIN, for example reply.selestial.io), so a reply finds its conversation without
 * anyone reading a company's mailbox. The address holds 128 random bits kept on the opportunity: an
 * address someone made up names nothing.
 *
 * The address says which conversation a message is for. It does not say who sent it: that is checked
 * against the customer's own email address when the message arrives (convex/salesInbound.ts).
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

const LOCAL = /^r-([0-9a-f]{32})$/;

/** The receiving domain, or null when replies by email are not set up on this deployment. */
export function replyDomain(): string | null {
  const value = process.env.SALES_REPLY_DOMAIN?.trim().toLowerCase();
  return value && /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(value) ? value : null;
}

export function emailRepliesConfigured(): boolean {
  return replyDomain() !== null;
}

/** The reply address for one opportunity, giving it its key the first time. Null when email replies are not set up. */
export async function replyAddressFor(ctx: MutationCtx, opportunity: Doc<"salesOpportunities">): Promise<string | null> {
  const domain = replyDomain();
  if (!domain) return null;
  let key = opportunity.replyKey;
  if (!key) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await ctx.db.patch(opportunity._id, { replyKey: key });
  }
  return `r-${key}@${domain}`;
}

/** "Name <a@b.c>" or "a@b.c" → "a@b.c", lower case. Null when there is no address in it. */
export function bareAddress(value: string): string | null {
  const found = value.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? value.trim();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(found) ? found.toLowerCase() : null;
}

/** The opportunity one of these recipient addresses names, or null. An unknown key and a malformed address look the same. */
export async function opportunityForReply(ctx: QueryCtx | MutationCtx, recipients: string[]): Promise<Doc<"salesOpportunities"> | null> {
  const domain = replyDomain();
  if (!domain) return null;
  for (const raw of recipients.slice(0, 20)) {
    const address = bareAddress(raw);
    if (!address || !address.endsWith(`@${domain}`)) continue;
    const match = LOCAL.exec(address.slice(0, address.lastIndexOf("@")));
    if (!match) continue;
    const row = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_replyKey", (q) => q.eq("replyKey", match[1]))
      .unique();
    if (row) return row;
  }
  return null;
}

/**
 * What the person wrote, without the message they were answering. Mail programs quote the earlier
 * message below the reply; a quoted quote must never be read as the customer's own words (it holds
 * Sales's own price and questions).
 */
export function replyText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^On .{0,200}wrote:$/i.test(trimmed) || /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(trimmed) || /^_{10,}$/.test(trimmed)) break;
    if (/^(From|Sent|De|Von):\s.+/i.test(trimmed) && out.length > 0 && out.at(-1)?.trim() === "") break;
    if (trimmed.startsWith(">")) continue;
    // The signature separator: everything after it is a signature.
    if (line === "-- " || trimmed === "--") break;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** HTML-only mail, as plain text. Good enough to read a short reply; never rendered. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** A machine's answer (an out-of-office note, a bounce, a list): not something to reply to or read as the customer. */
export function isAutomatic(headers: Record<string, string>, from: string): boolean {
  const get = (name: string) => (headers[name] ?? headers[name.toLowerCase()] ?? "").toLowerCase();
  if (get("auto-submitted") && get("auto-submitted") !== "no") return true;
  if (/bulk|junk|list|auto_reply/.test(get("precedence"))) return true;
  if (get("x-autoreply") || get("x-autorespond") || get("x-auto-response-suppress")) return true;
  return /^(mailer-daemon|postmaster|no-?reply|donotreply|bounce)[^@]*@/i.test(from);
}
