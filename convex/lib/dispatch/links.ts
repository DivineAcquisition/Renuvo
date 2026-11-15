/**
 * Action links: how a cleaner does one job's tasks from a text message without signing in.
 *
 * A link belongs to one company, one cleaner and one assignment, names the only actions it may perform,
 * and has an expiry and a revocation. The token is `<public id>.<signature>`: the public id is 128
 * random bits, the signature is an HMAC of it with ACTION_LINK_SECRET, a secret set on the deployment.
 * The token is never stored and never written to an event, so a copy of the database opens nothing.
 * With no secret set, no link can be issued or opened.
 *
 * Two kinds, with separate lives. An offer link answers one offer and stops at the response deadline.
 * A job link is issued when the cleaner accepts and lasts through the service; the offer's expiry never
 * touches it. Both are revoked the moment the assignment ends.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";

export const OFFER_ACTIONS = ["accept", "decline"] as const;
export const JOB_ACTIONS = ["check_in", "report_delay", "cannot_attend", "checklist", "photos", "report", "complete"] as const;
export type LinkAction = (typeof OFFER_ACTIONS)[number] | (typeof JOB_ACTIONS)[number];

export type LinkState = "active" | "expired" | "revoked";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function linkSecret(): string | null {
  const secret = process.env.ACTION_LINK_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

/** True when the deployment can issue and open links. */
export function linksConfigured(): boolean {
  return linkSecret() !== null;
}

async function sign(publicId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`selestial.link.v1:${publicId}`))));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The token for a link, worked out again from the secret. Null when the deployment has no secret. */
export async function tokenFor(link: Pick<Doc<"actionLinks">, "publicId">): Promise<string | null> {
  const secret = linkSecret();
  return secret ? `${link.publicId}.${await sign(link.publicId, secret)}` : null;
}

/** The link a token names, or null. A wrong signature, an unknown id and a missing secret all look the same. */
export async function linkForToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"actionLinks"> | null> {
  const secret = linkSecret();
  if (!secret || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await sign(publicId, secret))) return null;
  return ctx.db
    .query("actionLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

export function linkState(link: Doc<"actionLinks">, now: number): LinkState {
  if (link.revokedAt !== undefined) return "revoked";
  return now >= link.expiresAt ? "expired" : "active";
}

export async function assignmentLinks(ctx: QueryCtx | MutationCtx, assignment: Pick<Doc<"assignments">, "_id" | "companyId">): Promise<Doc<"actionLinks">[]> {
  return ctx.db
    .query("actionLinks")
    .withIndex("by_company_assignment", (q) => q.eq("companyId", assignment.companyId).eq("assignmentId", assignment._id))
    .take(50);
}

/** The link of this kind that still works for the assignment, if there is one. */
export async function liveLink(ctx: QueryCtx | MutationCtx, assignment: Pick<Doc<"assignments">, "_id" | "companyId">, purpose: "offer" | "job"): Promise<Doc<"actionLinks"> | null> {
  const now = Date.now();
  return (await assignmentLinks(ctx, assignment)).find((row) => row.purpose === purpose && linkState(row, now) === "active") ?? null;
}

/** Issues a link. Null when the deployment has no secret: the caller says so instead of sending a dead link. */
export async function issueLink(
  ctx: MutationCtx,
  input: { assignment: Doc<"assignments">; purpose: "offer" | "job"; expiresAt: number; actor: Actor },
): Promise<Doc<"actionLinks"> | null> {
  if (!linksConfigured()) return null;
  const { assignment, purpose } = input;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const linkId = await ctx.db.insert("actionLinks", {
    companyId: assignment.companyId,
    publicId: base64url(bytes),
    purpose,
    cleanerId: assignment.cleanerId,
    jobId: assignment.jobId,
    assignmentId: assignment._id,
    allowed: [...(purpose === "offer" ? OFFER_ACTIONS : JOB_ACTIONS)],
    expiresAt: input.expiresAt,
    issuedAt: Date.now(),
  });
  await recordEvent(ctx, {
    companyId: assignment.companyId,
    type: "link.issued",
    actor: input.actor,
    subject: { table: "actionLinks", id: linkId },
    data: { purpose, assignmentId: assignment._id, jobId: assignment.jobId, cleanerId: assignment.cleanerId, expiresAt: input.expiresAt },
  });
  return (await ctx.db.get(linkId))!;
}

export async function revokeLink(ctx: MutationCtx, link: Doc<"actionLinks">, reason: string, actor: Actor): Promise<void> {
  if (link.revokedAt !== undefined) return;
  await ctx.db.patch(link._id, { revokedAt: Date.now(), revokeReason: reason });
  await recordEvent(ctx, { companyId: link.companyId, type: "link.revoked", actor, subject: { table: "actionLinks", id: link._id }, data: { purpose: link.purpose, assignmentId: link.assignmentId, reason } });
}

/** Ends every link an assignment has. Called whenever an assignment stops being the cleaner's. */
export async function revokeAssignmentLinks(ctx: MutationCtx, assignment: Pick<Doc<"assignments">, "_id" | "companyId">, reason: string, actor: Actor, only?: "offer" | "job"): Promise<void> {
  for (const link of await assignmentLinks(ctx, assignment)) {
    if (only && link.purpose !== only) continue;
    await revokeLink(ctx, link, reason, actor);
  }
}

/** Records that an action was carried out through a link. This is the only "used" there is: views are not recorded. */
export async function noteLinkAction(ctx: MutationCtx, link: Doc<"actionLinks">, action: LinkAction, data: Record<string, string | number | boolean | null> = {}): Promise<void> {
  await ctx.db.patch(link._id, { lastActionAt: Date.now(), lastAction: action });
  await recordEvent(ctx, {
    companyId: link.companyId,
    type: "link.action",
    actor: { kind: "cleaner", cleanerId: link.cleanerId, linkId: link._id },
    subject: { table: "actionLinks", id: link._id },
    data: { action, assignmentId: link.assignmentId, jobId: link.jobId, ...data },
  });
}

/**
 * The host the link pages are served on, from one setting: LINK_ORIGIN on the deployment (for example
 * https://link.selestial.io in production, http://localhost:3000 locally, a preview address on a preview).
 * SITE_ORIGIN is used when LINK_ORIGIN is not set. Nothing else builds a link address.
 */
export function siteOrigin(): string {
  for (const value of [process.env.LINK_ORIGIN, process.env.SITE_ORIGIN]) {
    const origin = value?.trim().replace(/\/+$/, "");
    if (origin && /^https?:\/\//.test(origin)) return origin;
  }
  return "https://selestial.io";
}

export function linkPath(purpose: "offer" | "job", token: string, path = ""): string {
  return `/c/${purpose}/${token}${path}`;
}
export type { Id };
