/**
 * Customer links for Sales: a proposal, a signing request, an assessor's findings page and a quote.
 *
 * The same pattern as pay links (convex/lib/finance/payLinks.ts): the token is `<public id>.<signature>`,
 * the public id 128 random bits stored on the row, the signature an HMAC of it with ACTION_LINK_SECRET
 * under words of each kind's own, so one kind of link never opens another kind of page. The token is
 * never stored and never written to events. With no secret set, no link exists.
 */
import { siteOrigin } from "../dispatch/links";

/** "care" is Retention's: feedback, an issue, a remedy, a confirmation or a plan (convex/lib/retention/links.ts). */
export type LinkKind = "proposal" | "sign" | "assess" | "quote" | "care";

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

export function salesLinksConfigured(): boolean {
  return secret() !== null;
}

async function sign(kind: LinkKind, publicId: string, key: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(`selestial.${kind}.v1:${publicId}`))));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function newLinkId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function linkToken(kind: LinkKind, publicId: string | undefined): Promise<string | null> {
  const key = secret();
  return key && publicId ? `${publicId}.${await sign(kind, publicId, key)}` : null;
}

/** The public id a token names, or null. A wrong signature, a malformed token and a missing secret look the same. */
export async function publicIdFor(kind: LinkKind, token: string): Promise<string | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  return same(token.slice(dot + 1), await sign(kind, publicId, key)) ? publicId : null;
}

const PATHS: Record<LinkKind, string> = { proposal: "/c/proposal/", sign: "/c/sign/", assess: "/c/assess/", quote: "/c/quote/", care: "/c/care/" };

export function linkUrl(kind: LinkKind, token: string): string {
  return `${siteOrigin()}${PATHS[kind]}${token}`;
}
