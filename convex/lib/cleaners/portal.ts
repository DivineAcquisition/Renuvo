/**
 * Portal and task links: how a cleaner (or a subcontractor company's contact) reaches their own records from
 * a text or an email without an account.
 *
 * Same scheme as Dispatch's action links (lib/dispatch/links.ts), with its own signing domain so one kind of
 * token can never open the other: `<public id>.<signature>`, 128 random bits signed with ACTION_LINK_SECRET.
 * The token is never stored. A link belongs to one company and one person, names the only actions it may
 * perform, expires, and can be revoked. Opening one changes nothing. Pay, tax and personnel records also need
 * a one-time code sent to the phone or email on file.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { siteOrigin } from "../dispatch/links";
import { recordEvent, type Actor } from "../events";

type Ctx = QueryCtx | MutationCtx;

/** Everything a full portal link may do. A task, availability or check-in link carries a subset. */
export const PORTAL_ACTIONS = ["confirm_contact", "submit_requirement", "set_availability", "confirm_availability", "add_time_away", "add_exception", "claim_skill", "acknowledge", "request_code", "verify_code", "ask_for_help", "respond_check_in", "respond_feedback", "dispute"] as const;
export type PortalAction = (typeof PORTAL_ACTIONS)[number];

const TASK_ACTIONS: PortalAction[] = ["confirm_contact", "submit_requirement", "acknowledge", "set_availability", "confirm_availability", "ask_for_help"];
const AVAILABILITY_ACTIONS: PortalAction[] = ["set_availability", "confirm_availability", "add_time_away", "add_exception", "ask_for_help"];
const CHECK_IN_ACTIONS: PortalAction[] = ["respond_check_in", "confirm_availability", "set_availability", "add_time_away", "ask_for_help"];
const CONTACT_ACTIONS: PortalAction[] = ["request_code", "verify_code", "ask_for_help"];

export type PortalLinkState = "active" | "expired" | "revoked";

const encoder = new TextEncoder();
const MINUTE = 60_000;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function secret(): string | null {
  const value = process.env.ACTION_LINK_SECRET?.trim();
  return value && value.length >= 32 ? value : null;
}

export function portalLinksConfigured(): boolean {
  return secret() !== null;
}

async function hmac(key: string, message: string): Promise<string> {
  const imported = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message))));
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function portalTokenFor(link: Pick<Doc<"portalLinks">, "publicId">): Promise<string | null> {
  const key = secret();
  return key ? `${link.publicId}.${await hmac(key, `selestial.portal.v1:${link.publicId}`)}` : null;
}

/** The link a token names, or null. A wrong signature, an unknown id and a missing secret all look the same. */
export async function portalLinkForToken(ctx: Ctx, token: string): Promise<Doc<"portalLinks"> | null> {
  const key = secret();
  if (!key || token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  if (!same(token.slice(dot + 1), await hmac(key, `selestial.portal.v1:${publicId}`))) return null;
  return ctx.db
    .query("portalLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

export function portalLinkState(link: Doc<"portalLinks">, now: number): PortalLinkState {
  if (link.revokedAt !== undefined) return "revoked";
  return now >= link.expiresAt ? "expired" : "active";
}

export function portalPath(token: string, path = ""): string {
  return `/c/portal/${token}${path}`;
}

export function portalUrl(token: string, path = ""): string {
  return `${siteOrigin()}${portalPath(token, path)}`;
}

function allowedFor(holder: "cleaner" | "subcontractor", purpose: Doc<"portalLinks">["purpose"]): PortalAction[] {
  if (holder === "subcontractor") return CONTACT_ACTIONS;
  if (purpose === "task") return TASK_ACTIONS;
  if (purpose === "availability") return AVAILABILITY_ACTIONS;
  if (purpose === "check_in") return CHECK_IN_ACTIONS;
  return [...PORTAL_ACTIONS];
}

/** Issues a link. Null when the deployment has no secret: the caller says so instead of sending a dead link. */
export async function issuePortalLink(
  ctx: MutationCtx,
  input: {
    companyId: Id<"companies">;
    holder: { cleanerId: Id<"cleaners"> } | { subcontractorId: Id<"subcontractors"> };
    purpose: Doc<"portalLinks">["purpose"];
    expiresAt: number;
    requirementKey?: string;
    followUpId?: Id<"followUps">;
    issuedBy: Doc<"portalLinks">["issuedBy"];
    actor: Actor;
  },
): Promise<Doc<"portalLinks"> | null> {
  if (!portalLinksConfigured()) return null;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const holder = "cleanerId" in input.holder ? ("cleaner" as const) : ("subcontractor" as const);
  const linkId = await ctx.db.insert("portalLinks", {
    companyId: input.companyId,
    publicId: base64url(bytes),
    holder,
    cleanerId: "cleanerId" in input.holder ? input.holder.cleanerId : undefined,
    subcontractorId: "subcontractorId" in input.holder ? input.holder.subcontractorId : undefined,
    purpose: input.purpose,
    requirementKey: input.requirementKey,
    followUpId: input.followUpId,
    allowed: allowedFor(holder, input.purpose),
    expiresAt: input.expiresAt,
    issuedAt: Date.now(),
    issuedBy: input.issuedBy,
  });
  const subject = "cleanerId" in input.holder ? { table: "cleaners" as const, id: input.holder.cleanerId } : { table: "subcontractors" as const, id: input.holder.subcontractorId };
  await recordEvent(ctx, { companyId: input.companyId, type: subject.table === "cleaners" ? "cleaner.portal_link_issued" : "subcontractor.portal_link_issued", actor: input.actor, subject, data: { purpose: input.purpose, expiresAt: input.expiresAt, linkId } });
  return (await ctx.db.get(linkId))!;
}

export async function revokePortalLink(ctx: MutationCtx, link: Doc<"portalLinks">, reason: string, actor: Actor): Promise<void> {
  if (link.revokedAt !== undefined) return;
  await ctx.db.patch(link._id, { revokedAt: Date.now(), revokeReason: reason });
  const subject = link.cleanerId ? { table: "cleaners" as const, id: link.cleanerId } : { table: "subcontractors" as const, id: link.subcontractorId! };
  await recordEvent(ctx, { companyId: link.companyId, type: link.cleanerId ? "cleaner.portal_revoked" : "subcontractor.portal_revoked", actor, subject, data: { links: 1, reason, purpose: link.purpose } });
}

/** Every link a cleaner holds, newest first. */
export async function cleanerLinks(ctx: Ctx, companyId: Id<"companies">, cleanerId: Id<"cleaners">): Promise<Doc<"portalLinks">[]> {
  return ctx.db
    .query("portalLinks")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleanerId))
    .order("desc")
    .take(100);
}

/** Records an action carried out through a link. Views are never recorded: only what the person did. */
export async function notePortalAction(ctx: MutationCtx, link: Doc<"portalLinks">, action: PortalAction, data: Record<string, string | number | boolean | null> = {}): Promise<void> {
  await ctx.db.patch(link._id, { lastActionAt: Date.now(), lastAction: action });
  const actor: Actor = link.cleanerId ? { kind: "cleaner_portal", cleanerId: link.cleanerId, linkId: link._id } : { kind: "subcontractor_contact", subcontractorId: link.subcontractorId!, linkId: link._id };
  const subject = link.cleanerId ? { table: "cleaners" as const, id: link.cleanerId } : { table: "subcontractors" as const, id: link.subcontractorId! };
  await recordEvent(ctx, { companyId: link.companyId, type: link.cleanerId ? "cleaner.portal_action" : "subcontractor.portal_action", actor, subject, data: { action, linkId: link._id, ...data } });
}

// ── One-time codes for sensitive records ─────────────────────────────────────────────────────────

export const CODE_LIFETIME = 10 * MINUTE;
export const VERIFIED_FOR = 30 * MINUTE;
export const CODE_ATTEMPTS = 5;
/** At most this many codes per link in CODE_WINDOW, so a link cannot be used to flood someone's phone. */
export const CODES_PER_WINDOW = 3;
export const CODE_WINDOW = 15 * MINUTE;

export function newCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

/** The stored form of a code: a hash bound to the link, so a code for one link never opens another. */
export async function codeHash(linkId: Id<"portalLinks">, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`selestial.portal.code.v1:${linkId}:${code}`));
  return base64url(new Uint8Array(digest));
}

export function maskAddress(channel: "sms" | "email", address: string): string {
  if (channel === "sms") return `•••${address.replace(/\D/g, "").slice(-4)}`;
  const [local, domain] = address.split("@");
  return `${local.slice(0, 1)}•••@${domain ?? ""}`;
}

export function isVerified(link: Doc<"portalLinks">, now: number): boolean {
  return link.verifiedUntil !== undefined && link.verifiedUntil > now;
}
