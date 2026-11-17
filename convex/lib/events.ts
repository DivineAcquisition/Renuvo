/**
 * The append-only event log (brief, section 9). This is the only place that writes an event, and nothing
 * changes or removes one; convex/guard.test.ts checks both. Rows hold ids, kinds and small facts, never
 * message text.
 */
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { agentValidator } from "./statuses";

export const actorValidator = v.union(
  v.object({ kind: v.literal("member"), memberId: v.id("members") }),
  v.object({ kind: v.literal("agent"), agent: agentValidator }),
  v.object({ kind: v.literal("system") }),
  /** A cleaner acting through an action link. The link is the authorization; the cleaner id says who it was issued to. */
  v.object({ kind: v.literal("cleaner"), cleanerId: v.id("cleaners"), linkId: v.id("actionLinks") }),
  /** An applicant acting through an applicant link. */
  v.object({ kind: v.literal("applicant"), applicantId: v.id("applicants"), linkId: v.id("applicantLinks") }),
);
export type Actor = typeof actorValidator.type;

export const subjectValidator = v.union(
  v.object({ table: v.literal("companies"), id: v.id("companies") }),
  v.object({ table: v.literal("members"), id: v.id("members") }),
  v.object({ table: v.literal("invitations"), id: v.id("invitations") }),
  v.object({ table: v.literal("customers"), id: v.id("customers") }),
  v.object({ table: v.literal("properties"), id: v.id("properties") }),
  v.object({ table: v.literal("cleaners"), id: v.id("cleaners") }),
  v.object({ table: v.literal("jobs"), id: v.id("jobs") }),
  v.object({ table: v.literal("assignments"), id: v.id("assignments") }),
  v.object({ table: v.literal("tasks"), id: v.id("tasks") }),
  v.object({ table: v.literal("approvals"), id: v.id("approvals") }),
  v.object({ table: v.literal("permissions"), id: v.id("permissions") }),
  v.object({ table: v.literal("messages"), id: v.id("messages") }),
  v.object({ table: v.literal("actionLinks"), id: v.id("actionLinks") }),
  v.object({ table: v.literal("coverageRequests"), id: v.id("coverageRequests") }),
  // Messaging consent and the compliance profile (convex/lib/compliance/schema.ts).
  v.object({ table: v.literal("complianceProfiles"), id: v.id("complianceProfiles") }),
  v.object({ table: v.literal("consentDisclosures"), id: v.id("consentDisclosures") }),
  v.object({ table: v.literal("contactPermissions"), id: v.id("contactPermissions") }),
  v.object({ table: v.literal("suppressions"), id: v.id("suppressions") }),
  v.object({ table: v.literal("agreementAcceptances"), id: v.id("agreementAcceptances") }),
  v.object({ table: v.literal("dataExports"), id: v.id("dataExports") }),
  v.object({ table: v.literal("deletionRecords"), id: v.id("deletionRecords") }),
  v.object({ table: v.literal("hiringNeeds"), id: v.id("hiringNeeds") }),
  v.object({ table: v.literal("applicants"), id: v.id("applicants") }),
  v.object({ table: v.literal("applications"), id: v.id("applications") }),
  v.object({ table: v.literal("mailboxConnections"), id: v.id("mailboxConnections") }),
  v.object({ table: v.literal("sourceMessages"), id: v.id("sourceMessages") }),
  v.object({ table: v.literal("applicantLinks"), id: v.id("applicantLinks") }),
  v.object({ table: v.literal("screenings"), id: v.id("screenings") }),
  v.object({ table: v.literal("interviews"), id: v.id("interviews") }),
  v.object({ table: v.literal("hiringOffers"), id: v.id("hiringOffers") }),
  v.object({ table: v.literal("onboardingHandoffs"), id: v.id("onboardingHandoffs") }),
  // Company agreements (convex/lib/agreements/schema.ts).
  v.object({ table: v.literal("agreements"), id: v.id("agreements") }),
  v.object({ table: v.literal("agreementTemplates"), id: v.id("agreementTemplates") }),
  v.object({ table: v.literal("agreementSignatureRequests"), id: v.id("agreementSignatureRequests") }),
  v.object({ table: v.literal("agreementFiles"), id: v.id("agreementFiles") }),
  // Company Chat (convex/lib/chat/schema.ts).
  v.object({ table: v.literal("chatArtifacts"), id: v.id("chatArtifacts") }),
  v.object({ table: v.literal("companyKnowledge"), id: v.id("companyKnowledge") }),
  // Creative Studio (convex/lib/ai/schema.ts).
  v.object({ table: v.literal("mediaAssets"), id: v.id("mediaAssets") }),
  v.object({ table: v.literal("mediaJobs"), id: v.id("mediaJobs") }),
  // Plans and credits (convex/lib/billing/schema.ts).
  v.object({ table: v.literal("billingAccounts"), id: v.id("billingAccounts") }),
  v.object({ table: v.literal("aiExecutions"), id: v.id("aiExecutions") }),
  v.object({ table: v.literal("billingIntents"), id: v.id("billingIntents") }),
  // Finance: the company's own money (convex/lib/finance/schema.ts).
  v.object({ table: v.literal("invoices"), id: v.id("invoices") }),
  v.object({ table: v.literal("payments"), id: v.id("payments") }),
  v.object({ table: v.literal("refunds"), id: v.id("refunds") }),
  v.object({ table: v.literal("invoiceCredits"), id: v.id("invoiceCredits") }),
  v.object({ table: v.literal("stripeAccounts"), id: v.id("stripeAccounts") }),
  v.object({ table: v.literal("financeSettings"), id: v.id("financeSettings") }),
  v.object({ table: v.literal("financeMessages"), id: v.id("financeMessages") }),
);
export type Subject = typeof subjectValidator.type;

export const eventDataValidator = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));
export type EventData = typeof eventDataValidator.type;

export function byMember(ctx: { member: Doc<"members"> }): Actor {
  return { kind: "member", memberId: ctx.member._id };
}

export async function recordEvent(
  ctx: MutationCtx,
  event: { companyId: Id<"companies">; type: string; actor: Actor; subject: Subject; data?: EventData },
): Promise<Id<"events">> {
  return ctx.db.insert("events", {
    companyId: event.companyId,
    type: event.type,
    actor: event.actor,
    subject: event.subject,
    subjectId: event.subject.id,
    data: event.data,
    at: Date.now(),
  });
}
