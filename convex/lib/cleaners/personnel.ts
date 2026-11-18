/**
 * Carrying out an approved personnel request (docs/cleaners/00-architecture.md, section 6). These are the
 * changes that always need an authorized person: pay, discipline, suspension, ending an engagement, rehire
 * restrictions and removing personal details. No agent and no score can start one. Every check is run again
 * at the moment of approval, and nothing about a job a cleaner accepted is changed silently: the jobs are
 * listed for a person to decide in Dispatch.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { payWords } from "../recruiter/offers";
import { recordEvent, type Actor } from "../events";
import { openTask, setTaskState } from "../taskState";
import { addLocalDays, startOfLocalDay } from "../time";
import { cleanersSettings } from "./settings";
import { commitmentsBetween } from "./schedule";
import type { PersonnelKind } from "./schema";

export const KIND_WORDS: Record<PersonnelKind, string> = {
  pay_change: "Change pay",
  disciplinary: "Record a disciplinary action",
  suspend: "Suspend",
  reinstate: "Reinstate",
  end_engagement: "End the engagement",
  rehire_restriction: "Restrict rehiring",
  remove_record: "Remove personal details",
};

export type CarryOut = { ok: boolean; detail: string };

/** Accepted and offered work from now on: what a suspension or an ending would touch. */
export async function upcomingWork(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, cleanerId: Id<"cleaners">): Promise<{ accepted: { jobId: string; label: string }[]; offered: number }> {
  const today = startOfLocalDay(Date.now(), company.timezone);
  const rows = (await commitmentsBetween(ctx, company, today, addLocalDays(today, 120, company.timezone))).get(cleanerId) ?? [];
  const upcoming = rows.filter((row) => row.endsAt > Date.now());
  return { accepted: upcoming.filter((row) => row.status === "accepted").map((row) => ({ jobId: row.jobId, label: row.label })), offered: upcoming.filter((row) => row.status === "offered").length };
}

/** Upcoming accepted jobs go to a person, in Dispatch's queue, never removed by this workspace. */
export async function handOverJobs(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, why: string, actor: Actor): Promise<string> {
  const work = await upcomingWork(ctx, company, cleaner._id);
  if (work.accepted.length === 0) return work.offered > 0 ? ` ${work.offered} open offer${work.offered === 1 ? "" : "s"} can no longer be accepted.` : "";
  const taskId = await openTask(ctx, {
    companyId: company._id,
    agent: "dispatch",
    title: `Decide ${cleaner.name}'s upcoming jobs`,
    nextAction: `${cleaner.name} was ${why}. Decide for each accepted job whether they keep it or it is covered: ${work.accepted.map((row) => row.label).join("; ")}.`,
    dueAt: Date.now() + 24 * 60 * 60 * 1000,
    completionCondition: "Each listed job is kept or covered by a person's decision",
    about: { table: "cleaners", id: cleaner._id },
    key: `cleaners.jobs_after_change:${cleaner._id}:${Date.now()}`,
    actor,
  });
  // A question carries its own details: the task's state keeps only the question, so the jobs are named in it.
  const one = work.accepted.length === 1;
  const shown = work.accepted.slice(0, 6).map((row) => row.label).join("; ");
  const more = work.accepted.length > 6 ? ` and ${work.accepted.length - 6} more` : "";
  const openQuestion = `${cleaner.name} was ${why}. Nothing was changed on ${one ? "this job" : "these jobs"}: ${shown}${more}. Keep ${cleaner.name} on ${one ? "it" : "each"}, or cover ${one ? "it" : "them"} in Dispatch.`;
  await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion, dueAt: Date.now() + 24 * 60 * 60 * 1000, withPersonSince: Date.now() }, actor);
  return ` ${work.accepted.length} accepted job${work.accepted.length === 1 ? " was" : "s were"} left as they are and handed to a person to decide.`;
}

async function revokePortal(ctx: MutationCtx, company: Doc<"companies">, cleanerId: Id<"cleaners">, reason: string, actor: Actor): Promise<number> {
  const links = await ctx.db
    .query("portalLinks")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId))
    .take(200);
  let revoked = 0;
  for (const link of links) {
    if (link.revokedAt !== undefined) continue;
    await ctx.db.patch(link._id, { revokedAt: Date.now(), revokeReason: reason });
    revoked += 1;
  }
  if (revoked > 0) await recordEvent(ctx, { companyId: company._id, type: "cleaner.portal_revoked", actor, subject: { table: "cleaners", id: cleanerId }, data: { links: revoked, reason } });
  return revoked;
}

async function setStatus(ctx: MutationCtx, cleaner: Doc<"cleaners">, status: Doc<"cleaners">["status"], actor: Actor) {
  await ctx.db.patch(cleaner._id, { status, statusChangedAt: Date.now(), updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: cleaner.companyId, type: "cleaner.status_changed", actor, subject: { table: "cleaners", id: cleaner._id }, data: { from: cleaner.status, to: status } });
}

/** Applies a pay arrangement from its effective time: closes the one before it, and copies it to the record. */
export async function applyPay(ctx: MutationCtx, request: Doc<"personnelRequests">, actor: Actor): Promise<CarryOut> {
  const pay = request.details.pay;
  if (!pay) return { ok: false, detail: "No pay was given." };
  const effectiveFrom = request.details.effectiveAt ?? request.decidedAt ?? Date.now();
  if (request.cleanerId) {
    const cleaner = await ctx.db.get(request.cleanerId);
    if (!cleaner || cleaner.companyId !== request.companyId) return { ok: false, detail: "The worker is no longer in the record." };
    if (pay.kind === "share" && cleaner.engagement !== "contractor") return { ok: false, detail: "A share of the job is for contractors." };
    if (pay.kind === "hourly" && cleaner.engagement !== "employee") return { ok: false, detail: "An hourly rate is for employees." };
    const previous = await ctx.db
      .query("payArrangements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", request.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    for (const row of previous) if (row.effectiveTo === undefined && row.effectiveFrom <= effectiveFrom) await ctx.db.patch(row._id, { effectiveTo: effectiveFrom });
    await ctx.db.insert("payArrangements", { companyId: request.companyId, cleanerId: cleaner._id, pay, effectiveFrom, setBy: request.decidedBy ?? request.requestedBy, requestId: request._id, createdAt: Date.now() });
    // Offers already made keep the pay they stated: each assignment holds its own pay.
    if (effectiveFrom <= Date.now()) {
      await ctx.db.patch(cleaner._id, { pay, updatedAt: Date.now() });
      await recordEvent(ctx, { companyId: request.companyId, type: "cleaner.pay_changed", actor, subject: { table: "cleaners", id: cleaner._id }, data: { kind: pay.kind } });
    }
    return { ok: true, detail: `${cleaner.name}'s pay is ${payWords(pay)}${effectiveFrom > Date.now() ? " from the date approved" : " from now"}. Jobs already offered keep the pay they stated.` };
  }
  if (request.subcontractorId) {
    const sub = await ctx.db.get(request.subcontractorId);
    if (!sub || sub.companyId !== request.companyId) return { ok: false, detail: "The subcontractor company is no longer in the record." };
    await ctx.db.insert("payArrangements", { companyId: request.companyId, subcontractorId: sub._id, pay, effectiveFrom, setBy: request.decidedBy ?? request.requestedBy, requestId: request._id, createdAt: Date.now() });
    if (effectiveFrom <= Date.now()) await ctx.db.patch(sub._id, { pay });
    return { ok: true, detail: `${sub.name} is paid ${payWords(pay)}${effectiveFrom > Date.now() ? " from the date approved" : " from now"}.` };
  }
  return { ok: false, detail: "Nobody was named." };
}

export async function carryOut(ctx: MutationCtx, company: Doc<"companies">, request: Doc<"personnelRequests">, actor: Actor): Promise<CarryOut> {
  if (request.kind === "pay_change") return applyPay(ctx, request, actor);
  const cleaner = request.cleanerId ? await ctx.db.get(request.cleanerId) : null;
  if (!cleaner || cleaner.companyId !== company._id) return { ok: false, detail: "The worker is no longer in the record." };
  const settings = cleanersSettings(company);
  switch (request.kind) {
    case "disciplinary":
      // The approved request is the record. It changes nothing else: no pay, no status, no score.
      return { ok: true, detail: "Recorded on their file. Nothing else was changed." };
    case "suspend": {
      if (cleaner.status === "suspended" || cleaner.status === "ended") return { ok: false, detail: `They are already ${cleaner.status}.` };
      await setStatus(ctx, cleaner, "suspended", actor);
      return { ok: true, detail: `Suspended: no new work is offered.${await handOverJobs(ctx, company, cleaner, "suspended", actor)}` };
    }
    case "reinstate": {
      if (cleaner.status !== "suspended") return { ok: false, detail: "They are not suspended." };
      await setStatus(ctx, cleaner, "ready", actor);
      return { ok: true, detail: "Reinstated as active. Their requirements still decide whether work can be offered." };
    }
    case "end_engagement": {
      if (cleaner.status === "ended") return { ok: false, detail: "The engagement has already ended." };
      await setStatus(ctx, cleaner, "ended", actor);
      const jobs = await handOverJobs(ctx, company, cleaner, "ended", actor);
      // Access follows the company's policy. Their history, jobs, documents and pay records are all kept.
      const revoked = settings.endedAccess === "revoke" ? await revokePortal(ctx, company, cleaner._id, "The engagement ended.", actor) : 0;
      if (cleaner.subcontractorId) {
        const rows = await ctx.db
          .query("workerAffiliations")
          .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
          .take(50);
        for (const row of rows) if (row.to === undefined) await ctx.db.patch(row._id, { to: Date.now() });
      }
      return { ok: true, detail: `The engagement has ended. Their history is kept.${revoked ? " Portal access was ended." : ""}${jobs}` };
    }
    case "rehire_restriction": {
      await ctx.db.patch(cleaner._id, { rehireRestriction: { until: request.details.until, requestId: request._id }, updatedAt: Date.now() });
      return { ok: true, detail: "Recorded. Recruiter and this workspace will show it if they apply again." };
    }
    case "remove_record": {
      if (cleaner.status !== "ended") return { ok: false, detail: "Only an ended engagement's personal details can be removed." };
      if (cleaner.photoStorageId) await ctx.storage.delete(cleaner.photoStorageId);
      await ctx.db.patch(cleaner._id, { name: "Former worker", email: undefined, phone: undefined, photoStorageId: undefined, updatedAt: Date.now() });
      await revokePortal(ctx, company, cleaner._id, "Personal details were removed.", actor);
      return { ok: true, detail: "Name, contact details and photo were removed. Job history is kept without them." };
    }
  }
  return { ok: false, detail: "This kind of request is not known." };
}
