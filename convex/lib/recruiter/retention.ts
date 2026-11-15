/**
 * Keeping and removing applicant records. When an application ends without a hire it gets a date,
 * the Owner's retention period after it ended. On that date, or at once on a deletion request, the
 * personal data goes: contact details, answers, files, the text of messages. What stays is a line with
 * no person in it: that an application for this role existed, how far it got and why it ended.
 *
 * LEGAL REVIEW: how long hiring records must be kept, and what a deletion request must remove, differ by
 * state and by company size. The default (365 days) and this scope are placeholders for counsel to set.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { isActive, SYSTEM } from "./applications";
import { applicationLinks, revokeApplicantLink } from "./links";
import { applicationMessages } from "./outbox";

export async function redactApplication(ctx: MutationCtx, application: Doc<"applications">, actor: Actor): Promise<void> {
  if (application.redactedAt) return;
  const scope = { companyId: application.companyId, applicationId: application._id };
  for (const row of await ctx.db.query("formSessions").withIndex("by_company_application", (q) => q.eq("companyId", scope.companyId).eq("applicationId", scope.applicationId)).take(10)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query("applicantAttachments").withIndex("by_company_application", (q) => q.eq("companyId", scope.companyId).eq("applicationId", scope.applicationId)).take(50)) {
    await ctx.storage.delete(row.storageId);
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db.query("sourceMessages").withIndex("by_company_application", (q) => q.eq("companyId", scope.companyId).eq("applicationId", scope.applicationId)).take(200)) {
    await ctx.db.patch(row._id, { fromAddress: undefined, replyTo: undefined, subject: undefined, excerpt: undefined, attachments: undefined, flag: undefined, redactedAt: Date.now() });
  }
  for (const row of await applicationMessages(ctx, application)) await ctx.db.patch(row._id, { to: undefined, body: "[removed]", subject: undefined, replyTo: undefined });
  for (const row of await ctx.db.query("screenings").withIndex("by_company_application", (q) => q.eq("companyId", scope.companyId).eq("applicationId", scope.applicationId)).take(50)) await ctx.db.delete(row._id);
  for (const row of await ctx.db.query("interviews").withIndex("by_company_application", (q) => q.eq("companyId", scope.companyId).eq("applicationId", scope.applicationId)).take(50)) {
    if (row.feedback) await ctx.db.patch(row._id, { feedback: { ...row.feedback, notes: "[removed]" } });
  }
  for (const link of await applicationLinks(ctx, application)) await revokeApplicantLink(ctx, link, "The applicant's details were removed.", actor);
  await ctx.db.patch(application._id, { contact: { status: "missing", evidence: [] }, facts: [], roleSeen: undefined, sourceApplicationId: undefined, nextAction: undefined, redactedAt: Date.now(), retainUntil: undefined });
  await recordEvent(ctx, { companyId: application.companyId, type: "application.details_removed", actor, subject: { table: "applications", id: application._id } });
}

/** Removes everything personal about an applicant. Refused while an application is still open, or after a hire. */
export async function redactApplicant(ctx: MutationCtx, applicantId: Id<"applicants">, actor: Actor): Promise<{ ok: boolean; why?: string }> {
  const applicant = await ctx.db.get(applicantId);
  if (!applicant || applicant.redactedAt) return { ok: true };
  const applications = await ctx.db
    .query("applications")
    .withIndex("by_company_applicant", (q) => q.eq("companyId", applicant.companyId).eq("applicantId", applicant._id))
    .take(100);
  if (applications.some(isActive)) return { ok: false, why: "This person has an application that is still open. Close or withdraw it first." };
  if (applications.some((row) => row.closure?.reason === "hired")) return { ok: false, why: "This person was hired. Their worker record is kept separately and is not removed from here." };
  for (const application of applications) await redactApplication(ctx, application, actor);
  await ctx.db.patch(applicant._id, { name: undefined, email: undefined, phone: undefined, location: undefined, smsConsent: undefined, possibleDuplicateOf: undefined, redactedAt: Date.now() });
  await recordEvent(ctx, { companyId: applicant.companyId, type: "applicant.details_removed", actor, subject: { table: "applicants", id: applicant._id } });
  return { ok: true };
}

/** Run on a schedule: removes personal data whose retention date has passed. */
export async function redactDue(ctx: MutationCtx, now: number): Promise<number> {
  const due = await ctx.db
    .query("applications")
    .withIndex("by_retainUntil", (q) => q.gt("retainUntil", 0).lt("retainUntil", now))
    .take(100);
  for (const application of due) {
    await redactApplication(ctx, application, SYSTEM);
    const others = await ctx.db
      .query("applications")
      .withIndex("by_company_applicant", (q) => q.eq("companyId", application.companyId).eq("applicantId", application.applicantId))
      .take(100);
    // The person's own row goes once none of their applications still holds anything.
    if (others.every((row) => row._id === application._id || row.redactedAt)) await redactApplicant(ctx, application.applicantId, SYSTEM);
  }
  return due.length;
}
