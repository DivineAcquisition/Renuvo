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
