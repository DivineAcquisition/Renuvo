/**
 * Customer links for Retention: give feedback, describe an issue, review a proposed remedy, say whether
 * a correction worked, or manage a recurring plan, without signing in.
 *
 * The same signing as every other customer link (convex/lib/sales/links.ts, kind "care"): the token is
 * `<public id>.<signature>`, never stored and never written to an event. Unlike a quote link, each one
 * has a row of its own, because it must be scoped (one customer, one service or case or plan), expire,
 * be revocable, and list the only things it may do. Opening a link reads; it never changes anything.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { linkToken, linkUrl, newLinkId } from "../sales/links";
import type { LinkPurpose, PlanRef } from "./schema";

type Ctx = QueryCtx | MutationCtx;
const DAY = 24 * 60 * 60 * 1000;

/** What each kind of link may do. A link is issued with exactly these and nothing else. */
export const LINK_ACTIONS: Record<LinkPurpose, readonly string[]> = {
  feedback: ["submit_feedback", "describe_issue", "request_different_cleaner"],
  issue: ["describe_issue", "request_different_cleaner"],
  remedy: ["accept_remedy", "decline_remedy", "ask_about_remedy"],
  confirm: ["confirm_correction"],
  manage: ["skip_visit", "reschedule_visit", "change_cadence", "pause_service", "resume", "end_service", "request_different_cleaner"],
};

export type CareLinkState = "active" | "expired" | "revoked";

export function careLinkState(link: Pick<Doc<"retentionLinks">, "expiresAt" | "revokedAt">, now: number): CareLinkState {
  if (link.revokedAt !== undefined) return "revoked";
  return link.expiresAt <= now ? "expired" : "active";
}

export async function careLinkByPublicId(ctx: Ctx, publicId: string): Promise<Doc<"retentionLinks"> | null> {
  return ctx.db
    .query("retentionLinks")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
}

export async function issueCareLink(
  ctx: MutationCtx,
  input: {
    companyId: Id<"companies">;
    purpose: LinkPurpose;
    customerId: Id<"customers">;
    propertyId?: Id<"properties">;
    jobId?: Id<"jobs">;
    caseId?: Id<"retentionCases">;
    actionId?: Id<"retentionActions">;
    plan?: PlanRef;
    /** Narrower than the purpose allows, when the company switched some choices off. */
    allowed?: string[];
    days: number;
    actor: Actor;
  },
): Promise<Doc<"retentionLinks">> {
  const now = Date.now();
  const allowed = (input.allowed ?? [...LINK_ACTIONS[input.purpose]]).filter((action) => LINK_ACTIONS[input.purpose].includes(action));
  const linkId = await ctx.db.insert("retentionLinks", {
    companyId: input.companyId,
    publicId: newLinkId(),
    purpose: input.purpose,
    customerId: input.customerId,
    propertyId: input.propertyId,
    jobId: input.jobId,
    caseId: input.caseId,
    actionId: input.actionId,
    plan: input.plan,
    allowed,
    expiresAt: now + input.days * DAY,
    issuedAt: now,
    issuedBy: input.actor,
  });
  await recordEvent(ctx, { companyId: input.companyId, type: "care_link.issued", actor: input.actor, subject: { table: "retentionLinks", id: linkId }, data: { purpose: input.purpose } });
  return (await ctx.db.get(linkId))!;
}

/** The address a link opens, made now and never stored. Null when links are not set up on the deployment. */
export async function careLinkUrl(link: Pick<Doc<"retentionLinks">, "publicId">): Promise<string | null> {
  const token = await linkToken("care", link.publicId);
  return token ? linkUrl("care", token) : null;
}

export async function revokeCareLink(ctx: MutationCtx, link: Doc<"retentionLinks">, reason: string, actor: Actor): Promise<void> {
  if (link.revokedAt !== undefined) return;
  await ctx.db.patch(link._id, { revokedAt: Date.now(), revokeReason: reason.slice(0, 200) });
  await recordEvent(ctx, { companyId: link.companyId, type: "care_link.revoked", actor, subject: { table: "retentionLinks", id: link._id }, data: { purpose: link.purpose } });
}

/** Closes every open link of a case, for example when the case closes or a person takes it over. */
export async function revokeCaseLinks(ctx: MutationCtx, companyId: Id<"companies">, caseId: Id<"retentionCases">, reason: string, actor: Actor, only?: LinkPurpose[]): Promise<void> {
  const rows = await ctx.db
    .query("retentionLinks")
    .withIndex("by_company_case", (q) => q.eq("companyId", companyId).eq("caseId", caseId))
    .take(50);
  for (const row of rows) if (!only || only.includes(row.purpose)) await revokeCareLink(ctx, row, reason, actor);
}

/** Records that a change was made through the link. Page views are not recorded. */
export async function noteCareAction(ctx: MutationCtx, link: Doc<"retentionLinks">, action: string): Promise<void> {
  await ctx.db.patch(link._id, { lastActionAt: Date.now(), lastAction: action });
  await recordEvent(ctx, { companyId: link.companyId, type: "care_link.action", actor: { kind: "customer", customerId: link.customerId, linkId: link._id }, subject: { table: "retentionLinks", id: link._id }, data: { action } });
}

export const customerActor = (link: Pick<Doc<"retentionLinks">, "_id" | "customerId">): Actor => ({ kind: "customer", customerId: link.customerId, linkId: link._id });
