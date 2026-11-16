/**
 * Applicant links: how an applicant fills in the application, picks an interview time or answers an
 * offer without signing in. This is Dispatch's action-link scheme (lib/dispatch/links.ts), not a second
 * one: the same token (`<public id>.<signature>` made with ACTION_LINK_SECRET, never stored), the same
 * expiry and revocation, the same host and `/c` pages. Only the row differs, because an applicant link
 * belongs to an application where a cleaner link belongs to an assignment.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { linksConfigured, tokenFor, type LinkState } from "../dispatch/links";
import { recordEvent, type Actor } from "../events";

export const APPLY_ACTIONS = ["save", "upload", "submit", "withdraw"] as const;
export const INTERVIEW_ACTIONS = ["pick_time", "cancel_time", "withdraw"] as const;
export const HIRING_OFFER_ACTIONS = ["accept_offer", "decline_offer"] as const;
export type ApplicantAction = (typeof APPLY_ACTIONS)[number] | (typeof INTERVIEW_ACTIONS)[number] | (typeof HIRING_OFFER_ACTIONS)[number];
export type ApplicantLinkPurpose = Doc<"applicantLinks">["purpose"];

const ACTIONS: Record<ApplicantLinkPurpose, readonly ApplicantAction[]> = { apply: APPLY_ACTIONS, interview: INTERVIEW_ACTIONS, "hiring-offer": HIRING_OFFER_ACTIONS };

function base64url(bytes: Uint8Array): string {
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

/** The link a token names, or null. A wrong signature, an unknown id and a cleaner's token all look the same. */
export async function applicantLinkForToken(ctx: QueryCtx | MutationCtx, token: string): Promise<Doc<"applicantLinks"> | null> {
  if (token.length > 200) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const publicId = token.slice(0, dot);
  const expected = await tokenFor({ publicId });
  if (!expected || !same(token, expected)) return null;
  return ctx.db
    .query("applicantLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

export function applicantLinkState(link: Doc<"applicantLinks">, now: number): LinkState {
  if (link.revokedAt !== undefined) return "revoked";
  return now >= link.expiresAt ? "expired" : "active";
}

export async function applicationLinks(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">): Promise<Doc<"applicantLinks">[]> {
  return ctx.db
    .query("applicantLinks")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .take(50);
}

export async function liveApplicantLink(ctx: QueryCtx | MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">, purpose: ApplicantLinkPurpose): Promise<Doc<"applicantLinks"> | null> {
  const now = Date.now();
  return (await applicationLinks(ctx, application)).find((row) => row.purpose === purpose && applicantLinkState(row, now) === "active") ?? null;
}

/** Issues a link, or returns the one of this kind that still works. Null when the deployment has no link secret. */
export async function issueApplicantLink(ctx: MutationCtx, input: { application: Doc<"applications">; purpose: ApplicantLinkPurpose; expiresAt: number; actor: Actor }): Promise<Doc<"applicantLinks"> | null> {
  if (!linksConfigured()) return null;
  const { application, purpose } = input;
  const live = await liveApplicantLink(ctx, application, purpose);
  if (live) return live;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const linkId = await ctx.db.insert("applicantLinks", {
    companyId: application.companyId,
    publicId: base64url(bytes),
    purpose,
    applicationId: application._id,
    applicantId: application.applicantId,
    allowed: [...ACTIONS[purpose]],
    expiresAt: input.expiresAt,
    issuedAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: application.companyId, type: "applicant_link.issued", actor: input.actor, subject: { table: "applicantLinks", id: linkId }, data: { purpose, applicationId: application._id, expiresAt: input.expiresAt } });
  return (await ctx.db.get(linkId))!;
}

export async function revokeApplicantLink(ctx: MutationCtx, link: Doc<"applicantLinks">, reason: string, actor: Actor): Promise<void> {
  if (link.revokedAt !== undefined) return;
  await ctx.db.patch(link._id, { revokedAt: Date.now(), revokeReason: reason });
  await recordEvent(ctx, { companyId: link.companyId, type: "applicant_link.revoked", actor, subject: { table: "applicantLinks", id: link._id }, data: { purpose: link.purpose, applicationId: link.applicationId, reason } });
}

export async function revokeApplicationLinks(ctx: MutationCtx, application: Pick<Doc<"applications">, "_id" | "companyId">, reason: string, actor: Actor, only?: ApplicantLinkPurpose): Promise<void> {
  for (const link of await applicationLinks(ctx, application)) {
    if (only && link.purpose !== only) continue;
    await revokeApplicantLink(ctx, link, reason, actor);
  }
}

/** Records that an action was carried out through a link. Views are not recorded: nobody knows who opened what. */
export async function noteApplicantAction(ctx: MutationCtx, link: Doc<"applicantLinks">, action: ApplicantAction): Promise<void> {
  // Saving a draft happens often; the link notes it, and the event log is kept for things that change the record's state.
  await ctx.db.patch(link._id, { lastActionAt: Date.now(), lastAction: action });
  if (action === "save" || action === "upload") return;
  await recordEvent(ctx, { companyId: link.companyId, type: "applicant_link.action", actor: { kind: "applicant", applicantId: link.applicantId, linkId: link._id }, subject: { table: "applicantLinks", id: link._id }, data: { action, applicationId: link.applicationId } });
}

export function applicantLinkPath(purpose: ApplicantLinkPurpose, token: string): string {
  return `/c/${purpose}/${token}`;
}
