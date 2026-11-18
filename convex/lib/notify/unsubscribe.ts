/**
 * The unsubscribe link in a notice a person may opt out of. The token names the notice it came in,
 * `<message id>.<signature>`, signed with ACTION_LINK_SECRET under words of its own, so it can never open
 * anything else. All it can do is turn off that notice's category for the member it went to.
 *
 * Two doors use it:
 *  - the footer link: the link host's page /n/unsubscribe#<token> (in the fragment, so it never reaches a
 *    server log). Opening it changes nothing; the person presses a button.
 *  - List-Unsubscribe with List-Unsubscribe-Post (RFC 8058): the mail program's own "Unsubscribe"
 *    button POSTs to the deployment, and only a POST changes anything.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { siteOrigin } from "../dispatch/links";

const encoder = new TextEncoder();

function secret(): string | null {
  const value = process.env.ACTION_LINK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

async function sign(messageId: string, key: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(`selestial.notice-unsubscribe.v1:${messageId}`)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function noticeToken(messageId: string): Promise<string | null> {
  const key = secret();
  return key ? `${messageId}.${await sign(messageId, key)}` : null;
}

/** The footer link and the List-Unsubscribe headers for one notice, or nothing when links aren't set up. */
export async function unsubscribeFor(messageId: string): Promise<{ pageUrl: string | null; headers: Record<string, string> } | null> {
  const token = await noticeToken(messageId);
  if (!token) return null;
  const site = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  const oneClick = site && /^https:\/\//.test(site) ? `${site}/notify/unsubscribe?t=${encodeURIComponent(token)}` : null;
  return {
    pageUrl: `${siteOrigin()}/n/unsubscribe#${token}`,
    headers: oneClick ? { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {},
  };
}

/** The notice a token names, or null for anything else: a wrong signature, another kind of message. */
export async function noticeForToken(ctx: Pick<QueryCtx, "db">, token: string): Promise<Doc<"messages"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const raw = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(raw, key))) return null;
  const id = ctx.db.normalizeId("messages", raw);
  const message = id ? await ctx.db.get(id) : null;
  return message && message.purpose === "member_notice" && message.memberId && message.notice ? message : null;
}
