/**
 * Pay links: how a customer opens one invoice to see it and pay, without signing in.
 *
 * The token is `<public id>.<signature>`, like the cleaners' action links (convex/lib/dispatch/links.ts):
 * the public id is 128 random bits stored on the invoice, the signature an HMAC of it with
 * ACTION_LINK_SECRET under words of its own, so a pay link never opens a cleaner page or the reverse.
 * The token is never stored. Voiding the invoice closes the link; with no secret set, no link exists.
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

export function payLinksConfigured(): boolean {
  return secret() !== null;
}

async function sign(publicId: string, key: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(`selestial.pay.v1:${publicId}`))));
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

export async function payToken(invoice: Pick<Doc<"invoices">, "publicId">): Promise<string | null> {
  const key = secret();
  return key && invoice.publicId ? `${invoice.publicId}.${await sign(invoice.publicId, key)}` : null;
}

/** The invoice a token names, or null. A wrong signature, an unknown id and a missing secret look the same. */
export async function invoiceForToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"invoices"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(publicId, key))) return null;
  const invoice = await ctx.db
    .query("invoices")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  // A draft has no public id; a void invoice keeps one so the page can say it was cancelled.
  return invoice && invoice.status !== "draft" ? invoice : null;
}

/** The address a customer opens, on the link host (the one setting every link is built from). */
export function payUrl(token: string): string {
  return `${siteOrigin()}/c/pay/${token}`;
}
