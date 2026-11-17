/**
 * Quote links: how a customer opens one quote to read it, accept it, decline it or ask a question,
 * without signing in.
 *
 * The token is `<public id>.<signature>`, like pay links (convex/lib/finance/payLinks.ts): the public id
 * is 128 random bits stored on the quote, the signature an HMAC of it with ACTION_LINK_SECRET under
 * words of its own, so a quote link never opens a pay page or a cleaner page. The token is never stored.
 * Revoking the quote closes what the link can do; with no secret set, no link exists.
 *
 * A form's address is different on purpose: a published form is public, so it is found by its public id
 * alone and carries no signature.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { siteOrigin } from "../dispatch/links";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secret(): string | null {
  const value = process.env.ACTION_LINK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

export function quoteLinksConfigured(): boolean {
  return secret() !== null;
}

async function sign(publicId: string, key: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(`selestial.quote.v1:${publicId}`))));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function newPublicId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function quoteToken(quote: Pick<Doc<"salesQuotes">, "publicId">): Promise<string | null> {
  const key = secret();
  return key && quote.publicId ? `${quote.publicId}.${await sign(quote.publicId, key)}` : null;
}

/** The quote a token names, or null. A wrong signature, an unknown id, a quote never sent and a missing secret look the same. */
export async function quoteForToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"salesQuotes"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(publicId, key))) return null;
  const quote = await ctx.db
    .query("salesQuotes")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  return quote && quote.sentVersion !== undefined ? quote : null;
}

export function quoteUrl(token: string): string {
  return `${siteOrigin()}/c/quote/${token}`;
}

export function formUrl(publicId: string): string {
  return `${siteOrigin()}/c/form/${publicId}`;
}
