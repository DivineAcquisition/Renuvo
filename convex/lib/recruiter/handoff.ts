/**
 * The handoff to onboarding. Team Coordinator will own onboarding; until that agent exists this is a
 * queue a person works, with explicit requirements that only a person records as done.
 *
 * The new worker is created in "onboarding". Dispatch offers work only to a cleaner a person has marked
 * "ready" (convex/lib/dispatch/eligibility.ts), so being approved, accepting an offer, or even finishing
 * this handoff never by itself makes anyone assignable. Nothing here says a document was verified or a
 * background check was passed: a requirement is "done" because a named person said so.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { openTask, setTaskState } from "../taskState";
import { closeApplication, setStage } from "./applications";
import { createWorker } from "../cleaners/enroll";
import { existingPerson, handoffChecklist, linkReturningWorker, recordFromHandoff } from "../cleaners/handoff";
import type { Fact } from "./schema";
import { DAY } from "./settings";

async function ownerOf(ctx: MutationCtx, companyId: Id<"companies">): Promise<Doc<"members"> | null> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .take(200);
  return members.find((member) => member.role === "owner" && member.status === "active") ?? null;
}

export async function createHandoff(ctx: MutationCtx, application: Doc<"applications">, offer: Doc<"hiringOffers">, actor: Actor): Promise<Id<"onboardingHandoffs"> | null> {
  const existing = await ctx.db
    .query("onboardingHandoffs")
    .withIndex("by_company_application", (q) => q.eq("companyId", application.companyId).eq("applicationId", application._id))
    .first();
  if (existing) return existing._id;
  if (application.stage !== "accepted" || offer.status !== "accepted") return null;
  const company = (await ctx.db.get(application.companyId))!;
  const applicant = (await ctx.db.get(application.applicantId))!;
  const owner = await ownerOf(ctx, company._id);
  if (!owner) return null;
  const session = await ctx.db
    .query("formSessions")
    .withIndex("by_company_application", (q) => q.eq("companyId", company._id).eq("applicationId", application._id))
    .first();
  const answers = session?.answers ?? {};
  const told = (field: string, value: unknown): Fact[] => (typeof value === "string" || typeof value === "number" ? [{ field, value: String(value), from: "form", where: "the application form, as the applicant wrote it" }] : []);
  const information: Fact[] = [...told("name", answers.fullName ?? applicant.name), ...told("email", answers.email), ...told("phone", answers.phone), ...told("experience_years", answers.experienceYears), ...told("hours_per_week", answers.hoursPerWeek)];
  if (Array.isArray(answers.availableDays)) information.push({ field: "available_days", value: answers.availableDays.join(", "), from: "form", where: "the application form, as the applicant wrote it" });

  // One person, one record: a returning worker keeps theirs; anyone else gets a new one with the company's
  // onboarding template. Either way it is not active, has no pay set, and is offered nothing.
  const email = typeof answers.email === "string" ? answers.email : application.contact.address;
  const phone = applicant.phone ? `+${applicant.phone}` : undefined;
  const returning = await existingPerson(ctx, company._id, email, phone);
  let cleanerId: Id<"cleaners">;
  let restricted = false;
  if (returning) {
    cleanerId = returning._id;
    restricted = (await linkReturningWorker(ctx, company, returning, application._id, actor)).restricted;
  } else {
    cleanerId = await createWorker(
      ctx,
      company,
      { name: applicant.name ?? "New hire", engagement: offer.terms.engagement, email, phone, serviceAreas: Array.isArray(answers.serviceAreas) ? answers.serviceAreas.map(String) : [], hiredFrom: application._id },
      actor,
      { template: true, source: "hiring" },
    );
  }

  const dueAt = Date.now() + 3 * DAY;
  // The checklist is the company's onboarding template, the same list the Cleaners profile shows.
  const requirements = await handoffChecklist(ctx, company, offer.terms.engagement, cleanerId);
  const outstanding = requirements.filter((row) => row.status === "outstanding");
  const nextAction = `${restricted ? "This person has a rehire restriction on their record: decide before going on. " : ""}Start onboarding ${applicant.name ?? "the new hire"}: ${outstanding.map((row) => row.label.toLowerCase()).join(", ") || "every requirement is already met"}.`;
  const taskId = await openTask(ctx, {
    companyId: company._id,
    agent: "recruiter",
    title: `Onboard ${applicant.name ?? "the new hire"} (${offer.terms.role})`,
    nextAction,
    dueAt,
    completionCondition: "Every onboarding requirement is recorded as done by a person, or the hire was cancelled",
    about: { table: "applications", id: application._id },
    key: `recruiter.onboarding:${application._id}`,
    actor,
  });
  await ctx.db.patch(taskId, { handoffTo: "team_coordinator", trigger: "The applicant accepted an approved offer.", escalation: "Until a person marks the worker ready, Dispatch offers them no work." });
  await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: `${nextAction} They accepted the offer. They are not ready for work until you say so.`, dueAt, withPersonSince: Date.now() }, actor);
  const handoffId = await ctx.db.insert("onboardingHandoffs", { companyId: company._id, applicationId: application._id, applicantId: applicant._id, needId: offer.needId, cleanerId, terms: offer.terms, information, requirements, responsibleId: owner._id, nextAction, dueAt, status: "open", taskId, createdAt: Date.now() });
  await recordEvent(ctx, { companyId: company._id, type: "onboarding.handed_off", actor, subject: { table: "onboardingHandoffs", id: handoffId }, data: { applicationId: application._id, cleanerId } });
  await setStage(ctx, application, "onboarding_handoff", actor, { nextAction: { what: nextAction, by: "owner", dueAt } });
  return handoffId;
}

/** A person records that one requirement is done, or is outstanding again. */
export async function recordRequirement(ctx: MutationCtx, handoff: Doc<"onboardingHandoffs">, key: string, done: boolean, member: Doc<"members">, note: string | undefined): Promise<void> {
  if (handoff.status !== "open") throw userError("This handoff is closed.");
  if (!handoff.requirements.some((row) => row.key === key)) throw userError("That is not one of this handoff's requirements.");
  // Recorded on the cleaner too, under the template's reviewer rule, so there is one checklist.
  await recordFromHandoff(ctx, handoff, key, done, member, note);
  const requirements = handoff.requirements.map((row) => (row.key === key ? { ...row, status: done ? ("done" as const) : ("outstanding" as const), note: note?.trim().slice(0, 500) || undefined, recordedBy: member._id, at: Date.now() } : row));
  const left = requirements.filter((row) => row.status === "outstanding");
  await ctx.db.patch(handoff._id, { requirements, nextAction: left.length > 0 ? `Still outstanding: ${left.map((row) => row.label.toLowerCase()).join(", ")}.` : "Every requirement is recorded. Complete the handoff, then mark the worker ready when you are satisfied." });
  await recordEvent(ctx, { companyId: handoff.companyId, type: "onboarding.requirement_recorded", actor: { kind: "member", memberId: member._id }, subject: { table: "onboardingHandoffs", id: handoff._id }, data: { key, done } });
}

/**
 * The Owner closes the handoff once every requirement is recorded. This ends the hiring record. It does
 * not change the worker's status: marking them ready is its own act, on the worker's record.
 */
export async function completeHandoff(ctx: MutationCtx, handoff: Doc<"onboardingHandoffs">, member: Doc<"members">): Promise<void> {
  if (handoff.status !== "open") throw userError("This handoff is closed.");
  const left = handoff.requirements.filter((row) => row.status === "outstanding");
  if (left.length > 0) throw userError(`Still outstanding: ${left.map((row) => row.label.toLowerCase()).join(", ")}.`);
  const actor: Actor = { kind: "member", memberId: member._id };
  await ctx.db.patch(handoff._id, { status: "complete", nextAction: "Mark the worker ready on their record when they can take work." });
  if (handoff.taskId) {
    const task = await ctx.db.get(handoff.taskId);
    if (task && task.status !== "done" && task.status !== "cancelled") await setTaskState(ctx, task, "done", { outcome: "Every onboarding requirement was recorded as done.", closedAt: Date.now() }, actor);
  }
  await recordEvent(ctx, { companyId: handoff.companyId, type: "onboarding.completed", actor, subject: { table: "onboardingHandoffs", id: handoff._id }, data: { cleanerId: handoff.cleanerId } });
  const application = await ctx.db.get(handoff.applicationId);
  if (application && application.stage === "onboarding_handoff") await closeApplication(ctx, application, "hired", actor, { by: member._id });
}
