/**
 * Addresses for the crew's photos that stop working. A photo is served through this deployment at
 * /photos/<evidence id>?exp=<ms>&sig=<signature>, where the signature is an HMAC of the id and the expiry
 * with ACTION_LINK_SECRET under a label of its own, so it can never stand in for a cleaner's link. The
 * address works for 30 to 40 minutes; a screen asks for a fresh one as time passes.
 *
 * A deployment without the secret or its own site address (CONVEX_SITE_URL, which Convex sets) falls
 * back to the stored file's own address, which does not expire, and says so with `expiring: false`.
 */
import type { Id } from "../../_generated/dataModel";

const MINUTE = 60_000;
const BUCKET = 10 * MINUTE;
const LIFETIME = 30 * MINUTE;
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(secret: string, evidenceId: string, exp: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`selestial.photo.v1:${evidenceId}:${exp}`))));
}

function secret(): string | null {
  const value = process.env.ACTION_LINK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

function site(): string | null {
  const value = process.env.CONVEX_SITE_URL?.trim().replace(/\/+$/, "");
  return value && /^https?:\/\//.test(value) ? value : null;
}

/** The moment to sign for: the caller's minute, unless it is far from the server's own clock. */
export function signingTime(asOf: number | undefined): number {
  const now = Date.now();
  return asOf !== undefined && Math.abs(asOf - now) <= 10 * MINUTE ? asOf : now;
}

/** When an address signed at `at` stops working. The same for a whole ten minutes, so the address stays the same. */
export function expiryFor(at: number): number {
  return Math.floor(at / BUCKET) * BUCKET + LIFETIME;
}

export function photoLinksReady(): boolean {
  return secret() !== null && site() !== null;
}

/** A signed, expiring address for one photo, or null when this deployment cannot sign. */
export async function signedPhotoUrl(evidenceId: Id<"evidence">, at: number): Promise<string | null> {
  const key = secret();
  const base = site();
  if (!key || !base) return null;
  const exp = expiryFor(at);
  return `${base}/photos/${evidenceId}?exp=${exp}&sig=${await signature(key, evidenceId, exp)}`;
}

/** Whether a request for a photo carries a valid, unexpired signature. Every failure looks the same. */
export async function photoRequestValid(evidenceId: string, exp: string | null, sig: string | null, now: number): Promise<boolean> {
  const key = secret();
  if (!key || !exp || !sig || !/^\d{10,15}$/.test(exp)) return false;
  const expiry = Number(exp);
  if (expiry <= now || expiry > now + LIFETIME + BUCKET) return false;
  const expected = await signature(key, evidenceId, expiry);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
