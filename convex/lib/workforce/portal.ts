/**
 * The cleaner portal's keys: links, one-time codes and device sessions (docs/cleaners/00-architecture.md).
 *
 *  - A portal link is `<public id>.<signature>`, signed with ACTION_LINK_SECRET under its own words, so a
 *    job link never opens a portal and a portal link never opens a job. The token is never stored.
 *  - Opening a link changes nothing and shows nothing personal. The cleaner asks for a code, which is
 *    texted to the phone on their record through the one send gate; confirming it opens a session.
 *  - The code is worked out from the secret, the code row's id and a nonce, when it is sent and when it
 *    is checked. It is never stored, and it is useless without the link.
 *  - A session is a random token held on the cleaner's device; only its hash is kept. Pay and tax details
 *    need a code confirmed in the last few minutes.
 *  - A new invitation revokes the earlier link and its sessions. Ending an engagement revokes them all.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";

type Ctx = QueryCtx | MutationCtx;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const PORTAL_LINK_DAYS = 14;
export const TASK_LINK_DAYS = 7;
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;
export const SESSION_DAYS = 30;
/** Pay, earnings and tax details need a code confirmed this recently. */
export const STEP_UP_MINUTES = 15;

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

export function portalConfigured(): boolean {
  return secret() !== null;
}

async function hmac(words: string, key: string): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(words)));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomId(bytes = 16): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

export async function sha256(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function portalToken(link: Pick<Doc<"portalLinks">, "publicId">): Promise<string | null> {
  const key = secret();
  return key ? `${link.publicId}.${base64url(await hmac(`selestial.portal.v1:${link.publicId}`, key))}` : null;
}

export function portalPath(token: string): string {
  return `/c/portal/${token}`;
}

/** The link a token names, or null. A wrong signature, an unknown id and a missing secret all look the same. */
export async function portalLinkForToken(ctx: Ctx, token: string): Promise<Doc<"portalLinks"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), base64url(await hmac(`selestial.portal.v1:${publicId}`, key)))) return null;
  return ctx.db
    .query("portalLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

export type PortalLinkState = "active" | "expired" | "revoked";

export function portalLinkState(link: Doc<"portalLinks">, now: number): PortalLinkState {
  if (link.revokedAt !== undefined) return "revoked";
  return now >= link.expiresAt ? "expired" : "active";
}

/** The six digits for one code row, worked out from the secret. */
export async function codeFor(code: Pick<Doc<"portalCodes">, "_id" | "nonce">): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  const bytes = await hmac(`selestial.portal.code.v1:${code._id}:${code.nonce}`, key);
  const number = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(number % 1_000_000).padStart(6, "0");
}

export async function linksOf(ctx: Ctx, cleaner: Pick<Doc<"cleaners">, "_id" | "companyId">): Promise<Doc<"portalLinks">[]> {
  return ctx.db
    .query("portalLinks")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", cleaner.companyId).eq("cleanerId", cleaner._id))
    .order("desc")
    .take(50);
}

/** Revokes every live link and session a cleaner has, with the reason. Their history stays. */
export async function revokePortal(ctx: MutationCtx, cleaner: Pick<Doc<"cleaners">, "_id" | "companyId">, reason: string, actor: Actor, only?: "portal" | "task"): Promise<number> {
  const now = Date.now();
  let revoked = 0;
  for (const link of await linksOf(ctx, cleaner)) {
    if (only && link.purpose !== only) continue;
    if (link.revokedAt !== undefined) continue;
    await ctx.db.patch(link._id, { revokedAt: now, revokeReason: reason });
    revoked += 1;
  }
  const sessions = await ctx.db
    .query("portalSessions")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", cleaner.companyId).eq("cleanerId", cleaner._id))
    .take(200);
  for (const session of sessions) {
    if (session.revokedAt !== undefined) continue;
    if (only === "task") {
      const link = await ctx.db.get(session.linkId);
      if (link?.purpose !== "task") continue;
    }
    await ctx.db.patch(session._id, { revokedAt: now });
  }
  if (revoked > 0) await recordEvent(ctx, { companyId: cleaner.companyId, type: "cleaner.portal_revoked", actor, subject: { table: "cleaners", id: cleaner._id }, data: { links: revoked, reason } });
  return revoked;
}

/** Issues a portal link. A new whole-portal invitation revokes the earlier one, so only the newest works. */
export async function issuePortalLink(
  ctx: MutationCtx,
  cleaner: Doc<"cleaners">,
  input: { purpose: "portal" | "task"; requirementId?: Id<"onboardingRequirements">; issuedBy: Doc<"portalLinks">["issuedBy"]; actor: Actor },
): Promise<Doc<"portalLinks"> | null> {
  if (!portalConfigured()) return null;
  if (input.purpose === "portal") await revokePortal(ctx, cleaner, "A new invitation was sent.", input.actor, "portal");
  const now = Date.now();
  const id = await ctx.db.insert("portalLinks", {
    companyId: cleaner.companyId,
    cleanerId: cleaner._id,
    publicId: randomId(),
    purpose: input.purpose,
    requirementId: input.requirementId,
    issuedAt: now,
    issuedBy: input.issuedBy,
    expiresAt: now + (input.purpose === "portal" ? PORTAL_LINK_DAYS : TASK_LINK_DAYS) * DAY,
  });
  await recordEvent(ctx, { companyId: cleaner.companyId, type: "cleaner.portal_invited", actor: input.actor, subject: { table: "cleaners", id: cleaner._id }, data: { purpose: input.purpose, linkId: id } });
  return (await ctx.db.get(id))!;
}

export async function newCode(ctx: MutationCtx, link: Doc<"portalLinks">): Promise<Doc<"portalCodes">> {
  const now = Date.now();
  // A new code replaces any earlier one that was not used.
  const earlier = await ctx.db
    .query("portalCodes")
    .withIndex("by_link", (q) => q.eq("linkId", link._id))
    .take(50);
  for (const row of earlier) if (row.usedAt === undefined && row.expiresAt > now) await ctx.db.patch(row._id, { expiresAt: now });
  const id = await ctx.db.insert("portalCodes", { companyId: link.companyId, cleanerId: link.cleanerId, linkId: link._id, nonce: randomId(12), expiresAt: now + CODE_MINUTES * MINUTE, attempts: 0, createdAt: now });
  return (await ctx.db.get(id))!;
}

export type CodeCheck = { ok: true } | { ok: false; reason: "no_code" | "expired" | "too_many" | "wrong" };

/** Checks a code typed on the device against the newest code for the link. Each wrong try counts. */
export async function checkCode(ctx: MutationCtx, link: Doc<"portalLinks">, typed: string): Promise<CodeCheck> {
  const now = Date.now();
  const newest = (
    await ctx.db
      .query("portalCodes")
      .withIndex("by_link", (q) => q.eq("linkId", link._id))
      .order("desc")
      .take(1)
  )[0];
  if (!newest || newest.usedAt !== undefined) return { ok: false, reason: "no_code" };
  if (newest.expiresAt <= now) return { ok: false, reason: "expired" };
  if (newest.attempts >= CODE_ATTEMPTS) return { ok: false, reason: "too_many" };
  const expected = await codeFor(newest);
  if (!expected || !same(typed.replace(/\D/g, ""), expected)) {
    await ctx.db.patch(newest._id, { attempts: newest.attempts + 1 });
    return { ok: false, reason: newest.attempts + 1 >= CODE_ATTEMPTS ? "too_many" : "wrong" };
  }
  await ctx.db.patch(newest._id, { usedAt: now });
  return { ok: true };
}

/** Opens a session on this device and returns its token. Only the token's hash is kept. */
export async function openSession(ctx: MutationCtx, link: Doc<"portalLinks">): Promise<string> {
  const token = randomId(32);
  const now = Date.now();
  await ctx.db.insert("portalSessions", { companyId: link.companyId, cleanerId: link.cleanerId, linkId: link._id, tokenHash: await sha256(token), createdAt: now, expiresAt: now + SESSION_DAYS * DAY, verifiedAt: now });
  await ctx.db.patch(link._id, { verifiedAt: now });
  return token;
}

export type SessionState = "active" | "expired" | "revoked";

export async function sessionForToken(ctx: Ctx, token: string): Promise<Doc<"portalSessions"> | null> {
  if (!token || token.length > 100) return null;
  const hash = await sha256(token);
  return ctx.db
    .query("portalSessions")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hash))
    .unique();
}

export function sessionState(session: Doc<"portalSessions">, now: number): SessionState {
  if (session.revokedAt !== undefined) return "revoked";
  return now >= session.expiresAt ? "expired" : "active";
}

export function steppedUp(session: Doc<"portalSessions">, now: number): boolean {
  return now - session.verifiedAt <= STEP_UP_MINUTES * MINUTE;
}

/** The phone on record with all but the last two digits hidden, so the cleaner knows where the code went. */
export function maskedPhone(phone: string | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  if (digits.length < 10) return null;
  return `•••• ••${digits.slice(-2)}`;
}
