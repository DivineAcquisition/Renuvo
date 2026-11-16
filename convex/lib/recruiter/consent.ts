/**
 * Recruiter's side of the shared consent record (convex/lib/compliance/permissions.ts). The sending
 * policy reads these rows before every applicant message; this file is where Recruiter writes them.
 *
 * - Applying for a job counts as permission to email the applicant about that application (the owner's
 *   decision of November 16, 2026). It is recorded once, when the application is filed, with the
 *   notification as evidence, and never over an earlier withdrawal.
 * - Texting needs the applicant's own tick on the application form, with the exact wording they agreed to.
 * - Asking not to be contacted withdraws both.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { currentPermission, setPermission, withdrawChannel } from "../compliance/permissions";
import type { RecordedBy } from "../compliance/schema";
import type { Actor } from "../events";
import { SMS_CONSENT_WORDING } from "./form";

const SOURCE_WORDS: Record<string, string> = { indeed: "Indeed", ziprecruiter: "ZipRecruiter", direct: "an email to the company", manual: "the company (entered by a person)", other: "a forwarded message" };

const asRecipient = (applicant: Pick<Doc<"applicants">, "_id">) => ({ kind: "applicant" as const, id: applicant._id });

/** Records that this applicant may be emailed about their application, unless a permission is already on file. */
export async function grantApplicationEmail(ctx: MutationCtx, application: Doc<"applications">, role: string | undefined, actor: Actor): Promise<void> {
  const recipient = { kind: "applicant" as const, id: application.applicantId };
  if (await currentPermission(ctx, application.companyId, recipient, "email", "recruiting")) return;
  const when = new Date(application.appliedAt).toISOString().slice(0, 10);
  const recordedBy: RecordedBy = actor.kind === "member" ? { kind: "member", memberId: actor.memberId } : { kind: "system" };
  await setPermission(ctx, {
    companyId: application.companyId,
    recipient,
    channel: "email",
    category: "recruiting",
    status: "granted",
    source: "job_application",
    evidence: `Applied for ${role ?? "a role"} through ${SOURCE_WORDS[application.source] ?? application.source} on ${when}. Application ${application._id}.`,
    recordedBy,
    at: Date.now(),
    actor,
  });
}

/** The applicant ticked, or unticked, permission to be texted on the form. */
export async function recordTextConsent(ctx: MutationCtx, applicant: Doc<"applicants">, granted: boolean, actor: Actor): Promise<void> {
  const recipient = asRecipient(applicant);
  const current = await currentPermission(ctx, applicant.companyId, recipient, "sms", "recruiting");
  if (granted && current?.status === "granted") return;
  if (!granted && current?.status !== "granted") return;
  await setPermission(ctx, {
    companyId: applicant.companyId,
    recipient,
    channel: "sms",
    category: "recruiting",
    status: granted ? "granted" : "withdrawn",
    source: "applicant_form",
    ...(granted ? { disclosureText: SMS_CONSENT_WORDING } : {}),
    evidence: granted ? "Ticked the permission to text on the application form." : "Unticked the permission to text on the application form.",
    recordedBy: { kind: "recipient" },
    at: Date.now(),
    actor,
  });
}

/** The applicant asked not to be contacted. Every permission they gave is withdrawn, on both channels. */
export async function withdrawApplicantContact(ctx: MutationCtx, applicant: Doc<"applicants">, how: { source: "email_reply" | "staff"; evidence: string; recordedBy: RecordedBy }, actor: Actor): Promise<void> {
  for (const channel of ["email", "sms"] as const) {
    await withdrawChannel(ctx, { companyId: applicant.companyId, recipient: asRecipient(applicant), channel, source: how.source, recordedBy: how.recordedBy, evidence: how.evidence, actor, at: Date.now() });
  }
}
