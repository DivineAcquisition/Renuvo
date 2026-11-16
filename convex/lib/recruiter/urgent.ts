/**
 * Urgent hiring requests from Dispatch. Dispatch opens a task in Recruiter's queue when nobody can cover
 * a visit. Recruiter answers with who is already in the pipeline, what each still lacks, and outreach
 * for a person to approve.
 *
 * It bypasses nothing. An applicant reached this way goes through the same application, decision, offer
 * and onboarding as anyone, the message promises no job, and only a person marking a worker ready makes
 * them assignable. A staffing request also opens no role and changes no pay: those are the Owner's.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import type { CarriedOut } from "../dispatch/workflow";
import type { Actor } from "../events";
import { isActive } from "./applications";
import { queueApplicantMessage } from "./outbox";
import { latestScreening } from "./screening";
import type { Stage } from "./schema";
import { HOUR, recruiterSettings } from "./settings";
import { partsFor, urgentOutreachEmail } from "./words";

export const URGENT_OUTREACH = "recruiter.urgent_outreach";

const RELEVANT: readonly Stage[] = ["invited", "application_started", "application_submitted", "screening", "interview", "decision_pending", "offer_sent", "accepted", "onboarding_handoff"];

export type UrgentCandidate = {
  applicationId: Id<"applications">;
  name: string;
  role: string;
  stage: Stage;
  coversArea: boolean | null;
  qualificationGaps: string[];
  readinessGaps: string[];
};

/** Who is already in the pipeline for an urgent request, and what stands between each of them and work. */
export async function urgentCandidates(ctx: QueryCtx | MutationCtx, task: Doc<"tasks">): Promise<{ postalCode: string | null; candidates: UrgentCandidate[] }> {
  const job = task.about?.table === "jobs" ? await ctx.db.get(task.about.id) : null;
  const property = job ? await ctx.db.get(job.propertyId) : null;
  const postalCode = property?.address.postalCode ?? null;
  const candidates: UrgentCandidate[] = [];
  for (const stage of RELEVANT) {
    const rows = await ctx.db
      .query("applications")
      .withIndex("by_company_stage", (q) => q.eq("companyId", task.companyId).eq("stage", stage))
      .take(100);
    for (const application of rows) {
      const applicant = await ctx.db.get(application.applicantId);
      const need = application.needId ? await ctx.db.get(application.needId) : null;
      if (!applicant || !need || applicant.doNotContact) continue;
      const session = await ctx.db
        .query("formSessions")
        .withIndex("by_company_application", (q) => q.eq("companyId", task.companyId).eq("applicationId", application._id))
        .first();
      const areas = session?.answers.serviceAreas;
      const screening = await latestScreening(ctx, application);
      const handoff = await ctx.db
        .query("onboardingHandoffs")
        .withIndex("by_company_application", (q) => q.eq("companyId", task.companyId).eq("applicationId", application._id))
        .first();
      const qualificationGaps = !application.submittedAt
        ? ["Has not submitted the application."]
        : screening
          ? screening.results.filter((row) => row.outcome === "does_not_meet" || row.outcome === "needs_clarification").map((row) => `${row.label}: ${row.outcome.replace(/_/g, " ")}`)
          : ["Not screened yet."];
      const readinessGaps: string[] = [];
      if (!handoff) readinessGaps.push(`Not hired: the application is at "${stage.replace(/_/g, " ")}". A person's decision, an approved offer and its acceptance come first.`);
      else readinessGaps.push(...handoff.requirements.filter((row) => row.status === "outstanding").map((row) => `Onboarding: ${row.label.toLowerCase()} is outstanding.`));
      const cleaner = handoff ? await ctx.db.get(handoff.cleanerId) : null;
      if (handoff && cleaner?.status !== "ready") readinessGaps.push("A person has not marked this worker ready, so Dispatch cannot offer them work.");
      candidates.push({ applicationId: application._id, name: applicant.name ?? "An applicant", role: need.title, stage, coversArea: postalCode && Array.isArray(areas) ? areas.includes(postalCode) : null, qualificationGaps, readinessGaps });
    }
  }
  // Furthest along first: they are the closest to being able to work.
  candidates.sort((a, b) => RELEVANT.indexOf(b.stage) - RELEVANT.indexOf(a.stage));
  return { postalCode, candidates: candidates.slice(0, 30) };
}

/** Proposes contacting one existing applicant about an urgent need. A person approves every one. */
export async function proposeUrgentOutreach(ctx: MutationCtx, task: Doc<"tasks">, application: Doc<"applications">): Promise<{ ok: boolean; detail: string }> {
  if (application.companyId !== task.companyId || !isActive(application)) return { ok: false, detail: "That application is not open." };
  const applicant = await ctx.db.get(application.applicantId);
  const company = await ctx.db.get(task.companyId);
  if (!applicant || !company) return { ok: false, detail: "That application is not open." };
  const pending = await ctx.db
    .query("approvals")
    .withIndex("by_company_task", (q) => q.eq("companyId", task.companyId).eq("taskId", task._id))
    .take(100);
  if (pending.some((row) => row.status === "pending" && row.proposal?.kind === "urgent_outreach" && row.proposal.applicationId === application._id)) return { ok: true, detail: "Already waiting for approval." };
  await requestApproval(ctx, {
    companyId: task.companyId,
    action: URGENT_OUTREACH,
    summary: `Ask ${applicant.name ?? "an applicant"} about their availability this week`,
    reason: `Dispatch asked for help: ${task.title}. This applicant is already in the pipeline at "${application.stage.replace(/_/g, " ")}".`,
    authorizes: `One email to ${application.contact.address ?? "the applicant"} asking if they are still interested and when they are available. It offers no work and skips no step.`,
    ifWaiting: "Nothing is sent.",
    decideBy: Date.now() + Math.min(recruiterSettings(company).decideWithinHours, 12) * HOUR,
    proposal: { kind: "urgent_outreach", applicationId: application._id, taskId: task._id },
    about: { table: "applications", id: application._id },
    taskId: task._id,
  });
  return { ok: true, detail: "Outreach is waiting for a person's approval." };
}

export async function sendUrgentOutreach(ctx: MutationCtx, applicationId: Id<"applications">, taskId: Id<"tasks">, actor: Actor): Promise<CarriedOut> {
  const application = await ctx.db.get(applicationId);
  const applicant = application ? await ctx.db.get(application.applicantId) : null;
  const company = application ? await ctx.db.get(application.companyId) : null;
  const need = application?.needId ? await ctx.db.get(application.needId) : null;
  if (!application || !applicant || !company || !need || !isActive(application)) return { ok: false, detail: "The application has ended." };
  const settings = recruiterSettings(company);
  const email = urgentOutreachEmail(partsFor(company, settings.fromName, applicant, need.title));
  const message = await queueApplicantMessage(ctx, { company, application, applicant, purpose: "urgent_outreach", channel: "email", subject: email.subject, body: email.body, dedupeKey: `urgent:${taskId}:${application._id}`, actor });
  return message.status === "not_sent" ? { ok: false, detail: message.problem ?? "The message could not be sent." } : { ok: true, detail: "The message was handed to the email service." };
}
