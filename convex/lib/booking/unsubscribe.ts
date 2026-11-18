/**
 * The unsubscribe link in a "finish your booking" reminder (marketing email). The token names the message
 * it came in, `<message id>.<signature>`, signed with ACTION_LINK_SECRET under words of its own so it can
 * never open a booking, a pay page or a cleaner's link. It travels in the address's fragment
 * (`/b/unsubscribe#<token>`), so it never reaches a server log. All it can do is take the address that
 * message went to off the company's marketing email.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { siteOrigin } from "../dispatch/links";

const encoder = new TextEncoder();

function secret(): string | null {
  const value = process.env.ACTION_LINK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

async function sign(messageId: string, key: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(`selestial.unsubscribe.v1:${messageId}`)));
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

export const unsubscribeLinksConfigured = () => secret() !== null;

export async function unsubscribeUrl(messageId: Id<"messages">): Promise<string | null> {
  const key = secret();
  return key ? `${siteOrigin()}/b/unsubscribe#${messageId}.${await sign(messageId, key)}` : null;
}

/** The marketing message a token names, or null for anything else (a wrong signature, another kind of message). */
export async function messageForUnsubscribe(ctx: QueryCtx, token: string): Promise<Doc<"messages"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const raw = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(raw, key))) return null;
  const id = ctx.db.normalizeId("messages", raw);
  const message = id ? await ctx.db.get(id) : null;
  return message && message.purpose === "booking_recovery" && message.channel === "email" ? message : null;
}
