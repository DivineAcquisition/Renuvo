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
import type { Fact } from "./schema";
import { DAY, recruiterSettings } from "./settings";
import { findMatches } from "../workforce/duplicates";

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

  // The worker record exists so onboarding has something to work on. If this person is already on record
  // as a worker (the same phone or email), the hire is linked to that record instead of making a second one,
  // so their history stays in one place. A name alone is never enough to link.
  const hiredEmail = typeof answers.email === "string" ? answers.email : application.contact.address;
  const hiredPhone = applicant.phone ? `+${applicant.phone}` : undefined;
  const everyone: Doc<"cleaners">[] = [];
  for (const status of ["onboarding", "ready", "paused", "ended"] as const) {
    everyone.push(...(await ctx.db.query("cleaners").withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status)).take(1000)));
  }
  const strong = everyone.filter((row) => findMatches({ name: applicant.name ?? "", email: hiredEmail, phone: hiredPhone }, [{ id: row._id, name: row.name, email: row.email, phone: row.phone }]).some((match) => match.reasons.some((reason) => reason !== "name")));
  let cleanerId: Id<"cleaners">;
  if (strong.length === 1) {
    const existing = strong[0];
    cleanerId = existing._id;
    // A returning worker goes back to onboarding for this hire. Their pay, history and documents are kept.
    await ctx.db.patch(existing._id, { applicationId: application._id, ...(existing.status === "ended" ? { status: "onboarding" as const, statusNote: undefined, statusChangedAt: Date.now() } : {}) });
    await recordEvent(ctx, { companyId: company._id, type: "cleaner.linked_to_hire", actor, subject: { table: "cleaners", id: existing._id }, data: { applicationId: application._id, was: existing.status } });
  } else {
    cleanerId = await ctx.db.insert("cleaners", {
      companyId: company._id,
      name: applicant.name ?? "New hire",
      email: hiredEmail,
      phone: hiredPhone,
      engagement: offer.terms.engagement,
      status: "onboarding",
      skills: [],
      serviceAreas: Array.isArray(answers.serviceAreas) ? answers.serviceAreas : [],
      // The hire this worker came from, so their profile keeps the hiring history and nobody is entered twice.
      source: "hiring",
      applicationId: application._id,
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: company._id, type: "cleaner.created", actor, subject: { table: "cleaners", id: cleanerId }, data: { from: "hiring", applicationId: application._id } });
  }

  const dueAt = Date.now() + 3 * DAY;
  const requirements = recruiterSettings(company).onboardingRequirements.map((row) => ({ key: row.key, label: row.label, status: "outstanding" as const }));
  const nextAction = `Start onboarding ${applicant.name ?? "the new hire"}: ${requirements.map((row) => row.label.toLowerCase()).join(", ")}.`;
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
