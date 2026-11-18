/**
 * Invitations: how a person the Owner named comes to be in a company.
 *
 * An invitation belongs to one company and one invited members row, names the role the person gets, and
 * has an expiry and a revocation. Its link carries a token of the form `<public id>.<signature>`: the
 * public id is 128 random bits, the signature is an HMAC of it with ACTION_LINK_SECRET, the same
 * deployment secret the cleaner links use. The words signed are different ("selestial.invite.v1:"), so
 * a cleaner's link can never open an invitation and an invitation can never act as a cleaner's link.
 * The token is never stored and never written to an event, so a copy of the database opens nothing.
 * With no secret set, no invitation can be made or opened.
 *
 * A link proves only that someone holds it. Joining also takes a signed-in person whose verified email
 * is the invited one; that check is in convex/invitations.ts and convex/members.ts.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { recordEvent, type Actor } from "./events";
import { INVITATION_DAYS } from "./invitationTerms";

/** How long an invitation link works. The one place this is set. */
export { INVITATION_DAYS };
const DAY = 24 * 60 * 60 * 1000;

export function invitationExpiry(now: number): number {
  return now + INVITATION_DAYS * DAY;
}

export type InvitationState = "pending" | "expired" | "accepted" | "revoked";

const encoder = new TextEncoder();
const SIGNED_WORDS = "selestial.invite.v1:";
/** 16 bytes and 32 bytes in base64url, with a dot between. Anything else is not a token. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inviteSecret(): string | null {
  const secret = process.env.ACTION_LINK_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

/** True when the deployment can make and open invitation links. */
export function invitesConfigured(): boolean {
  return inviteSecret() !== null;
}

async function sign(publicId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${SIGNED_WORDS}${publicId}`))));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A fresh public id: 128 random bits. */
export function newPublicId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** The token for an invitation, worked out again from the secret. Null when the deployment has no secret. */
export async function inviteTokenFor(invitation: Pick<Doc<"invitations">, "publicId">): Promise<string | null> {
  const secret = inviteSecret();
  return secret ? `${invitation.publicId}.${await sign(invitation.publicId, secret)}` : null;
}

/** The invitation a token names, or null. A wrong signature, an unknown id, a malformed token and a missing secret all look the same. */
export async function invitationForToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"invitations"> | null> {
  const secret = inviteSecret();
  if (!secret || !TOKEN_SHAPE.test(token)) return null;
  const dot = token.indexOf(".");
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(publicId, secret))) return null;
  return ctx.db
    .query("invitations")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

export function invitationState(invitation: Pick<Doc<"invitations">, "status" | "expiresAt">, now: number): InvitationState {
  if (invitation.status !== "pending") return invitation.status;
  return now >= invitation.expiresAt ? "expired" : "pending";
}

/** The invitation that points at this members row, if it has one. */
export async function invitationOfMember(ctx: QueryCtx | MutationCtx, member: Pick<Doc<"members">, "_id" | "companyId">): Promise<Doc<"invitations"> | null> {
  return ctx.db
    .query("invitations")
    .withIndex("by_company_member", (q) => q.eq("companyId", member.companyId).eq("memberId", member._id))
    .first();
}

/** Enough of an address to recognise it, not enough to learn it: the first character, dots, and the domain. */
export function emailHint(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${[...address][0]}•••${address.slice(at)}`;
}

/**
 * The address of the app, where the invitation page lives: APP_ORIGIN on the deployment, or SITE_ORIGIN
 * when that is not set. Null when neither is, so nothing ever sends a link to a guessed address.
 */
export function appOrigin(): string | null {
  for (const value of [process.env.APP_ORIGIN, process.env.SITE_ORIGIN]) {
    const origin = value?.trim().replace(/\/+$/, "");
    if (origin && /^https?:\/\/[^\s/]+/.test(origin)) return origin;
  }
  return null;
}

/**
 * Where to send a person back to after a provider sign-in: the app address they started from, if it is one
 * of Selestial's own (the configured origin, selestial.io, this project's Vercel previews, localhost, or
 * ALLOWED_APP_ORIGINS). Anything else is ignored, so the return address cannot send anyone elsewhere.
 */
export function returnOrigin(candidate?: string | null): string | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  const configured = [process.env.APP_ORIGIN, process.env.SITE_ORIGIN, ...(process.env.ALLOWED_APP_ORIGINS ?? "").split(",")].map((v) => v?.trim().replace(/\/+$/, "")).filter(Boolean);
  const ok = configured.includes(url.origin) || local || host === "selestial.io" || host.endsWith(".selestial.io") || (host.endsWith(".vercel.app") && host.startsWith("selestial-ai"));
  return ok ? url.origin : null;
}

export function invitePath(token: string): string {
  return `/invite/${token}`;
}

/** Ends an invitation that has not been accepted. One that is already revoked or accepted is left as it is. */
export async function revokeInvitation(ctx: MutationCtx, invitation: Doc<"invitations">, actor: Actor): Promise<void> {
  if (invitation.status !== "pending") return;
  await ctx.db.patch(invitation._id, { status: "revoked", revokedAt: Date.now() });
  await recordEvent(ctx, { companyId: invitation.companyId, type: "invitation.revoked", actor, subject: { table: "invitations", id: invitation._id } });
}

export type Joined = { status: "joined" | "already_member"; memberId: Id<"members"> };

/**
 * Carries out an acceptance. The caller has already checked that the invitation is pending and not
 * expired and that the signed-in person's verified email is the invited one. The role given is the
 * invitation's; nothing from the person accepting decides it.
 *
 * Someone who is already an active member of the company (invited again at another address) keeps the
 * membership they have: the invitation is closed as accepted and its invited row is removed, so the
 * company never has two rows for one person. Null means the invited row is gone, so there is nothing to join.
 */
export async function joinByInvitation(ctx: MutationCtx, invitation: Doc<"invitations">, userId: string, userIssuer: string): Promise<Joined | null> {
  const now = Date.now();
  const seat = await ctx.db.get(invitation.memberId);
  const rows = await ctx.db
    .query("members")
    .withIndex("by_company_user", (q) => q.eq("companyId", invitation.companyId).eq("userId", userId))
    .take(20);
  const accepted = { status: "accepted" as const, acceptedAt: now, acceptedUserId: userId };

  const current = rows.find((row) => row.status === "active" && row._id !== invitation.memberId);
  if (current) {
    await ctx.db.patch(invitation._id, accepted);
    if (seat && seat.status === "invited") await ctx.db.patch(seat._id, { status: "removed" });
    await recordEvent(ctx, {
      companyId: invitation.companyId,
      type: "invitation.accepted",
      actor: { kind: "member", memberId: current._id },
      subject: { table: "invitations", id: invitation._id },
      data: { alreadyMember: true },
    });
    return { status: "already_member", memberId: current._id };
  }

  if (!seat || seat.companyId !== invitation.companyId || seat.status !== "invited") return null;
  // Someone removed earlier and invited again joins on the new row. The old row stops pointing at their
  // sign-in, so the company still has one row for one signed-in person.
  for (const row of rows) if (row._id !== seat._id) await ctx.db.patch(row._id, { userId: undefined });
  await ctx.db.patch(seat._id, { userId, userIssuer, status: "active", role: invitation.role });
  await ctx.db.patch(invitation._id, accepted);
  await recordEvent(ctx, { companyId: invitation.companyId, type: "member.joined", actor: { kind: "member", memberId: seat._id }, subject: { table: "members", id: seat._id } });
  return { status: "joined", memberId: seat._id };
}
