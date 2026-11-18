/**
 * A customer's private booking link. The token is 256 random bits, shown to the customer once and never
 * stored: the session keeps only its SHA-256. A booking id is never authorization on its own.
 *
 * The link carries the token in the address's fragment (`/b/resume#<token>`), which browsers never send
 * to a server, put in a Referer header or hand to analytics. The page reads it and passes it to Convex.
 *
 * Rotating issues a new token and the old one stops working. Revoking stops every token for the session.
 */
import type { Doc } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { sha256 } from "../agreements/hash";

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `bk_${base64url(bytes)}`;
}

export const tokenHash = (token: string) => sha256(`selestial.booking.v1:${token}`);

const SHAPE = /^bk_[A-Za-z0-9_-]{40,50}$/;

/** The session a token names, or null. A malformed, unknown, revoked or expired token all look the same to the caller. */
export async function sessionForToken(ctx: QueryCtx, token: string): Promise<{ session: Doc<"bookingSessions">; open: boolean } | null> {
  if (!SHAPE.test(token)) return null;
  const hash = tokenHash(token);
  const session =
    (await ctx.db
      .query("bookingSessions")
      .withIndex("by_token", (q) => q.eq("tokenHash", hash))
      .unique()) ??
    (await ctx.db
      .query("bookingSessions")
      .withIndex("by_link_token", (q) => q.eq("linkTokenHash", hash))
      .unique());
  if (!session) return null;
  const open = session.revokedAt === undefined && session.expiresAt > Date.now();
  return { session, open };
}

const DAY = 24 * 60 * 60 * 1000;
/** An unfinished booking's link works for a week; a confirmed one, until 30 days after the visit. */
export const OPEN_SESSION_LIFE = 7 * DAY;
export const MANAGE_LIFE_AFTER_VISIT = 30 * DAY;
