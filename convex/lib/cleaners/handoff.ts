/**
 * Recruiter's hire and the Cleaners record are one person with one checklist. When an applicant accepts an
 * offer, Recruiter's handoff points at a cleaner record (a new one, or the same person's earlier record when
 * they come back), and its checklist is the company's onboarding template. Recording a step in either place
 * records it in both, under the template's reviewer rule, so nothing is entered twice and no history is lost.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { notAllowed } from "../errors";
import { recordEvent, type Actor } from "../events";
import { isManager, isOwner, roleOf } from "../roles";
import { normalEmail, normalPhone } from "./duplicates";
import { applyTemplate } from "./enroll";
import { companyDefinitions } from "./records";
import type { Engagement } from "./schema";

/** Read from the record (weekly hours, areas), never ticked by hand. They stay in the Cleaners profile. */
const FROM_RECORD_ONLY = ["availability", "service_areas"];

export async function handoffChecklist(ctx: MutationCtx, company: Doc<"companies">, engagement: Engagement, cleanerId: Id<"cleaners">): Promise<{ key: string; label: string; status: "outstanding" | "done" }[]> {
  const definitions = (await companyDefinitions(ctx, company)).filter((def) => def.appliesTo.includes(engagement) && !FROM_RECORD_ONLY.includes(def.kind));
  const rows = await ctx.db
    .query("workerRequirements")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId))
    .take(100);
  return definitions.map((def) => {
    const row = rows.find((item) => item.key === def.key);
    return { key: def.key, label: def.label, status: row && (row.status === "accepted" || row.status === "waived") ? ("done" as const) : ("outstanding" as const) };
  });
}

/** The same person already in the record, by the email or phone they applied with. A name alone is not enough. */
export async function existingPerson(ctx: MutationCtx, companyId: Id<"companies">, email: string | undefined, phone: string | undefined): Promise<Doc<"cleaners"> | null> {
  const wantEmail = normalEmail(email);
  const wantPhone = normalPhone(phone);
  if (!wantEmail && !wantPhone) return null;
  for (const status of ["ended", "paused", "onboarding", "ready", "suspended"] as const) {
    const rows = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
      .take(1000);
    const found = rows.find((row) => (wantEmail && normalEmail(row.email) === wantEmail) || (wantPhone && normalPhone(row.phone) === wantPhone));
    if (found) return found;
  }
  return null;
}

/**
 * A hire who is already in the record (a returning worker) keeps their record and history. An ended
 * engagement starts onboarding again; a rehire restriction is not applied by code: it is put in front of the
 * person who completes the handoff.
 */
export async function linkReturningWorker(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, applicationId: Id<"applications">, actor: Actor): Promise<{ restricted: boolean }> {
  const patch: Partial<Doc<"cleaners">> = { hiredFrom: applicationId, updatedAt: Date.now() };
  if (cleaner.status === "ended") Object.assign(patch, { status: "onboarding", statusChangedAt: Date.now() });
  await ctx.db.patch(cleaner._id, patch);
  await recordEvent(ctx, { companyId: company._id, type: "cleaner.rehired", actor, subject: { table: "cleaners", id: cleaner._id }, data: { applicationId, from: cleaner.status } });
  if (cleaner.status === "ended") await recordEvent(ctx, { companyId: company._id, type: "cleaner.status_changed", actor, subject: { table: "cleaners", id: cleaner._id }, data: { from: "ended", to: "onboarding" } });
  await applyTemplate(ctx, company, (await ctx.db.get(cleaner._id))!, actor);
  return { restricted: Boolean(cleaner.rehireRestriction) };
}

async function openHandoffFor(ctx: MutationCtx, companyId: Id<"companies">, cleanerId: Id<"cleaners">): Promise<Doc<"onboardingHandoffs"> | null> {
  const rows = await ctx.db
    .query("onboardingHandoffs")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "open"))
    .take(500);
  return rows.find((row) => row.cleanerId === cleanerId) ?? null;
}

function nextActionOf(requirements: Doc<"onboardingHandoffs">["requirements"]): string {
  const left = requirements.filter((row) => row.status === "outstanding");
  return left.length > 0 ? `Still outstanding: ${left.map((row) => row.label.toLowerCase()).join(", ")}.` : "Every requirement is recorded. Complete the handoff, then make the engagement active when you are satisfied.";
}

/** A review in Cleaners shows on Recruiter's handoff at once. */
export async function syncHandoffRequirement(ctx: MutationCtx, cleaner: Doc<"cleaners">, key: string, done: boolean, actor: Actor, note?: string): Promise<void> {
  const handoff = await openHandoffFor(ctx, cleaner.companyId, cleaner._id);
  if (!handoff || !handoff.requirements.some((row) => row.key === key)) return;
  const memberId = actor.kind === "member" ? actor.memberId : undefined;
  const requirements = handoff.requirements.map((row) => (row.key === key ? { ...row, status: done ? ("done" as const) : ("outstanding" as const), note: note?.slice(0, 500), recordedBy: memberId, at: Date.now() } : row));
  await ctx.db.patch(handoff._id, { requirements, nextAction: nextActionOf(requirements) });
}

/**
 * A step recorded in Recruiter's onboarding queue is recorded on the cleaner too, by the same rule: the person
 * must be one the template allows to review that requirement.
 */
export async function recordFromHandoff(ctx: MutationCtx, handoff: Doc<"onboardingHandoffs">, key: string, done: boolean, member: Doc<"members">, note: string | undefined): Promise<void> {
  const company = (await ctx.db.get(handoff.companyId))!;
  const def = (await companyDefinitions(ctx, company)).find((row) => row.key === key);
  if (!def) return;
  const role = roleOf(member.role);
  if (def.reviewer === "owner" ? !isOwner(role) : !isManager(role)) notAllowed();
  const row = (
    await ctx.db
      .query("workerRequirements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", handoff.companyId).eq("cleanerId", handoff.cleanerId).eq("key", key))
      .take(1)
  )[0];
  if (!row) return;
  const now = Date.now();
  await ctx.db.patch(row._id, done ? { status: "accepted", reviewedAt: now, reviewedBy: member._id, reviewNote: note?.trim().slice(0, 500) || "Recorded in Recruiter's onboarding.", acceptedAt: now, expiresAt: def.validForDays ? now + def.validForDays * 86_400_000 : undefined, updatedAt: now } : { status: "not_started", reviewedAt: now, reviewedBy: member._id, acceptedAt: undefined, expiresAt: undefined, updatedAt: now });
  await recordEvent(ctx, { companyId: handoff.companyId, type: done ? "cleaner.requirement_accepted" : "cleaner.requirement_reset", actor: { kind: "member", memberId: member._id }, subject: { table: "cleaners", id: handoff.cleanerId }, data: { key } });
}
