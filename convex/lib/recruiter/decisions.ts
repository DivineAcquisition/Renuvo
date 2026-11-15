/**
 * Hiring decisions. A person makes them. Recruiter records what was decided, by whom and why, and does
 * what follows.
 *
 * The one thing that can end an application without a person is a decline on a published fixed
 * requirement, and only when the Owner has raised that permission above Propose. It starts on Propose
 * in every company. LEGAL REVIEW: rules on automated hiring decisions differ by state; this setting
 * should not be offered to customers until counsel has reviewed it (docs/recruiter/05-assumptions.md).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { CarriedOut } from "../dispatch/workflow";
import { recordEvent, type Actor } from "../events";
import { closeApplication, isActive, RECRUITER } from "./applications";
import { queueApplicantMessage } from "./outbox";
import type { CriterionResult } from "./screening";
import { HOUR, recruiterSettings } from "./settings";
import { declineEmail, partsFor } from "./words";

export const DECLINE_FIXED = "recruiter.decline_fixed_requirement";

const memberOf = (actor: Actor): Id<"members"> | undefined => (actor.kind === "member" ? actor.memberId : undefined);

/** Tells the applicant, plainly and without reasons that were not checked, that the application will not move forward. */
export async function sendDecline(ctx: MutationCtx, application: Doc<"applications">, actor: Actor): Promise<void> {
  const applicant = await ctx.db.get(application.applicantId);
  const company = await ctx.db.get(application.companyId);
  const need = application.needId ? await ctx.db.get(application.needId) : null;
  if (!applicant || !company || !need) return;
  const settings = recruiterSettings(company);
  const email = declineEmail(partsFor(company, settings.fromName, applicant, need.title));
  await queueApplicantMessage(ctx, { company, application: (await ctx.db.get(application._id))!, applicant, purpose: "application_decline", channel: "email", subject: email.subject, body: email.body, dedupeKey: `decline:${application._id}`, actor });
}

async function declineOnRequirement(ctx: MutationCtx, application: Doc<"applications">, criterion: string, actor: Actor, automatic: boolean): Promise<void> {
  await ctx.db.insert("hiringDecisions", { companyId: application.companyId, applicationId: application._id, decision: "reject", reason: `Did not meet the published requirement: ${criterion}`, automatic: automatic || undefined, decidedBy: memberOf(actor), at: Date.now() });
  await closeApplication(ctx, application, "requirement_not_met", actor, { note: criterion, by: memberOf(actor) });
  await recordEvent(ctx, { companyId: application.companyId, type: "application.declined", actor, subject: { table: "applications", id: application._id }, data: { automatic, criterion: criterion.slice(0, 200) } });
  await sendDecline(ctx, application, actor);
}

/** A published fixed requirement was not met: propose the decline, or carry it out if the Owner allowed that. */
export async function proposeOrDecline(ctx: MutationCtx, application: Doc<"applications">, need: Doc<"hiringNeeds">, result: CriterionResult): Promise<void> {
  const company = await ctx.db.get(application.companyId);
  const applicant = await ctx.db.get(application.applicantId);
  if (!company || !applicant) return;
  const authority = await authorityFor(ctx, company._id, DECLINE_FIXED);
  if (authority.kind !== "level" || authority.level === "off") return;
  if (authority.level !== "propose") {
    await declineOnRequirement(ctx, application, result.label, RECRUITER, true);
    return;
  }
  await requestApproval(ctx, {
    companyId: company._id,
    action: DECLINE_FIXED,
    summary: `Turn down ${applicant.name ?? "an applicant"} for ${need.title}: "${result.label}" is not met`,
    reason: `${result.label} is a published fixed requirement for this role. ${result.evidence}`,
    authorizes: `Closing this application as "requirement not met" and one email telling the applicant it will not move forward. Nothing else.`,
    ifWaiting: "The application stays in screening for you to review.",
    decideBy: Date.now() + recruiterSettings(company).decideWithinHours * HOUR,
    proposal: { kind: "decline_application", applicationId: application._id, criterion: result.label },
    about: { table: "applications", id: application._id },
  });
}

export async function afterDeclineDecision(ctx: MutationCtx, approval: Doc<"approvals">, applicationId: Id<"applications">, criterion: string, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  if (decision !== "approved") return null;
  const application = await ctx.db.get(applicationId);
  if (!application || application.companyId !== approval.companyId || !isActive(application)) return { ok: false, detail: "The application has already ended." };
  await declineOnRequirement(ctx, application, criterion, decidedBy, false);
  return { ok: true, detail: "The application was closed and the applicant was told." };
}
