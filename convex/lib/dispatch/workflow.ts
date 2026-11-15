/**
 * Dispatch's first workflow (brief, section 11): take a job that needs a cleaner to an accepted
 * assignment, and hand it to a person with the open question when that cannot be done.
 *
 * Every step is code. Read the record, filter and rank, check the permission, then propose, offer or
 * escalate. No model is called and no number is guessed. `coverJob` can run any number of times for
 * the same job: it looks at where the job is now and does only what is still missing, so a job never
 * gets two tasks, two proposals or two offers from it. It never throws for an ordinary state, because
 * it runs inside the mutation that changed the job.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import { recordEvent, type Actor } from "../events";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { DISPATCH_RULES, isStaffingGap, rankCleaners, type Candidate, type Excluded } from "./eligibility";
import { jobAssignments, jobFacts, jobHistory, readyCleanerFacts } from "./facts";
import { offerProblem, placeOffer } from "./offers";
import { money, payFor } from "./pay";
import { dispatchSettings, type DispatchSettings } from "./settings";

export const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const SYSTEM: Actor = { kind: "system" };
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const REQUEST_ACCEPTANCE = "dispatch.request_acceptance";
export const REASSIGN = "dispatch.reassign_confirmed_visit";

export type CoverState =
  | "gone"
  | "closed"
  | "covered"
  | "underway"
  | "offer_out"
  | "with_person"
  | "awaiting_decision"
  | "too_late"
  | "too_early"
  | "paused"
  | "off"
  | "no_candidate"
  | "proposed"
  | "offered";

export const coverKey = (jobId: Id<"jobs">) => `dispatch.cover:${jobId}`;

/** A time on the company's clock, in words: Tue, Mar 2, 10:00 AM. */
export function whenWords(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

const WITH_YOU = "You are handling this visit yourself and it has no cleaner yet. Offer it to a cleaner, or hand it back to Dispatch.";

/** Every approval Dispatch has raised for this job, across the cover tasks it has had. */
export async function jobApprovals(ctx: QueryCtx | MutationCtx, job: Doc<"jobs">): Promise<Doc<"approvals">[]> {
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_company_key", (q) => q.eq("companyId", job.companyId).eq("key", coverKey(job._id)))
    .take(20);
  const out: Doc<"approvals">[] = [];
  for (const task of tasks) {
    out.push(
      ...(await ctx.db
        .query("approvals")
        .withIndex("by_company_task", (q) => q.eq("companyId", job.companyId).eq("taskId", task._id))
        .take(100)),
    );
  }
  return out;
}

function skippedCleaners(approvals: Doc<"approvals">[]): Id<"cleaners">[] {
  return approvals.filter((row) => row.status === "skipped" && row.proposal?.kind === "offer_assignment").map((row) => row.proposal!.cleanerId);
}

/** Who Dispatch could ask for this job right now, best first, and who it cannot ask with the reason. */
export async function candidatesFor(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, job: Doc<"jobs">) {
  const assignments = await jobAssignments(ctx, job);
  const history = await jobHistory(ctx, job, assignments, skippedCleaners(await jobApprovals(ctx, job)));
  const { cleaners, facts } = await readyCleanerFacts(ctx, job, history);
  const ranked = rankCleaners(facts, await jobFacts(ctx, company, job), DISPATCH_RULES);
  return { ...ranked, cleaners, assignments, history };
}

/** Which permission covers finding a cleaner now: a first request, or replacing a cleaner who had accepted. */
export function coverAction(assignments: Doc<"assignments">[]): string {
  const hadAccepted = assignments.some((row) => row.status === "cancelled" && row.endCause === "released" && row.respondedAt !== undefined);
  return hadAccepted ? REASSIGN : REQUEST_ACCEPTANCE;
}

function taskDeadline(job: Doc<"jobs">, settings: DispatchSettings, now: number): number {
  const latest = job.startsAt - settings.offerWindowMinutes * MINUTE;
  return latest > now ? latest : job.startsAt;
}

async function closePending(ctx: MutationCtx, approvals: Doc<"approvals">[], cause: string, note: string) {
  for (const approval of approvals) {
    if (approval.status !== "pending") continue;
    await ctx.db.patch(approval._id, { status: "expired", note });
    await recordEvent(ctx, { companyId: approval.companyId, type: "approval.expired", actor: SYSTEM, subject: { table: "approvals", id: approval._id }, data: { action: approval.action, cause } });
  }
}

/** The one task that carries a job's coverage. Opened the first time the job needs a cleaner. */
export async function ensureCoverTask(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">): Promise<Doc<"tasks">> {
  const customer = await ctx.db.get(job.customerId);
  const title = `Cover the ${job.serviceType} visit for ${customer?.name ?? "a customer"} on ${whenWords(job.startsAt, company.timezone)}`.slice(0, 200);
  const existing = await liveTaskByKey(ctx, job.companyId, coverKey(job._id));
  if (existing) {
    if (existing.title !== title) await ctx.db.patch(existing._id, { title });
    return { ...existing, title };
  }
  const taskId = await openTask(ctx, {
    companyId: job.companyId,
    agent: "dispatch",
    title,
    nextAction: "Find a cleaner for this visit",
    dueAt: taskDeadline(job, dispatchSettings(company), Date.now()),
    completionCondition: "A cleaner accepted the visit",
    about: { table: "jobs", id: job._id },
    key: coverKey(job._id),
    actor: DISPATCH,
  });
  return (await ctx.db.get(taskId))!;
}

/** Recruiter hears about a gap once per area and day, with a job to trace it to. */
async function ensureGapTask(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">, postalCode: string) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, weekday: "short", month: "short", day: "numeric" }).format(new Date(job.startsAt));
  const key = `recruiter.staffing_gap:${postalCode || "unknown"}:${day}`;
  if (await liveTaskByKey(ctx, job.companyId, key)) return;
  await openTask(ctx, {
    companyId: job.companyId,
    agent: "recruiter",
    title: `Staffing gap: no cleaner could take a visit in ${postalCode || "an unknown area"} on ${day}`,
    nextAction: "Review who could cover this area and day, and recruit for it if nobody can",
    dueAt: job.startsAt,
    completionCondition: "A ready cleaner can cover this area and day",
    about: { table: "jobs", id: job._id },
    key,
    actor: DISPATCH,
  });
}

function noCandidateWords(excluded: Excluded[]): string {
  if (excluded.length === 0) return "No cleaner is marked ready for work, so nobody can be asked to take this visit. Decide how to cover it.";
  const shown = excluded.slice(0, 6).map((entry) => `${entry.name} ${entry.reason}`);
  const more = excluded.length > shown.length ? ` And ${excluded.length - shown.length} more.` : "";
  return `No cleaner can be asked to take this visit. ${shown.join("; ")}.${more} Decide how to cover it.`;
}

function fitWords(candidate: Candidate, others: number): string {
  const reasons = candidate.reasons;
  const list = reasons.length > 1 ? `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}` : reasons[0];
  const rest = others === 0 ? "Nobody else is eligible." : `${others} other ${others === 1 ? "cleaner is" : "cleaners are"} also eligible.`;
  return `${candidate.name} ${list}. ${rest}`;
}

/**
 * Looks at one job and does whatever is still missing to get it a cleaner. Safe to run again at any time.
 */
export async function coverJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<CoverState> {
  const job = await ctx.db.get(jobId);
  if (!job) return "gone";
  const company = await ctx.db.get(job.companyId);
  if (!company) return "gone";
  const settings = dispatchSettings(company);
  const now = Date.now();
  const live = await liveTaskByKey(ctx, job.companyId, coverKey(job._id));

  if (job.status === "cancelled" || job.status === "completed") {
    if (live) {
      const cancelled = job.status === "cancelled";
      await closePending(ctx, await jobApprovals(ctx, job), cancelled ? "job_cancelled" : "job_completed", cancelled ? "The visit was cancelled." : "The visit was completed.");
      await setTaskState(ctx, live, cancelled ? "cancelled" : "done", { outcome: cancelled ? "The visit was cancelled." : "The visit was completed.", closedAt: now, withPersonSince: null }, DISPATCH);
    }
    return "closed";
  }

  const assignments = await jobAssignments(ctx, job);
  const accepted = assignments.find((row) => row.status === "accepted");
  if (accepted) {
    if (live) {
      await closePending(ctx, await jobApprovals(ctx, job), "job_covered", "A cleaner accepted this visit.");
      const cleaner = await ctx.db.get(accepted.cleanerId);
      await setTaskState(ctx, live, "done", { outcome: `${cleaner?.name ?? "A cleaner"} accepted the visit.`, closedAt: now, withPersonSince: null }, DISPATCH);
    }
    return "covered";
  }

  // From here the job has no cleaner, so it has a task that says where it stands.
  const task = await ensureCoverTask(ctx, company, job);
  const same = { sameStatus: true };

  if (job.status === "in_progress") {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: "This visit is underway and has no cleaner on it. Decide what to do.", dueAt: job.startsAt }, DISPATCH, same);
    return "underway";
  }

  const offers = assignments.filter((row) => row.status === "offered");
  if (offers.length > 0) {
    const followUpAt = Math.min(...offers.map((row) => row.respondBy));
    await setTaskState(ctx, task, "waiting", { waitingOn: "cleaner", followUpAt, dueAt: job.startsAt }, DISPATCH, same);
    return "offer_out";
  }

  if (task.withPersonSince !== undefined) {
    if (task.status !== "needs_decision") await setTaskState(ctx, task, "needs_decision", { openQuestion: WITH_YOU, dueAt: job.startsAt }, DISPATCH);
    return "with_person";
  }

  const approvals = await jobApprovals(ctx, job);
  const pending = approvals.find((row) => row.status === "pending");
  if (pending) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `${pending.summary}?`, dueAt: pending.decideBy }, DISPATCH, same);
    return "awaiting_decision";
  }

  if (job.startsAt <= now) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: "This visit's start time has passed and no cleaner accepted it. Decide what to do with it.", dueAt: job.startsAt }, DISPATCH, same);
    return "too_late";
  }

  const opensAt = job.startsAt - settings.lookAheadDays * DAY;
  if (now < opensAt) {
    const days = settings.lookAheadDays;
    await setTaskState(ctx, task, "open", { nextAction: `Find a cleaner once the visit is within ${days} ${days === 1 ? "day" : "days"}`, dueAt: opensAt }, DISPATCH, same);
    return "too_early";
  }

  const action = coverAction(assignments);
  const authority = await authorityFor(ctx, company._id, action);
  if (authority.kind === "paused") {
    await setTaskState(ctx, task, "open", { nextAction: "Dispatch is paused. Resume Dispatch, or offer this visit to a cleaner yourself.", dueAt: taskDeadline(job, settings, now) }, DISPATCH, same);
    return "paused";
  }
  if (authority.kind !== "level" || authority.level === "off") {
    const what = action === REASSIGN ? "reassign a confirmed visit" : "request acceptance";
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `Dispatch is not allowed to ${what} for this company. Offer this visit to a cleaner yourself.`, dueAt: job.startsAt }, DISPATCH, same);
    return "off";
  }

  const history = await jobHistory(ctx, job, assignments, skippedCleaners(approvals));
  const { cleaners, facts } = await readyCleanerFacts(ctx, job, history);
  const jobView = await jobFacts(ctx, company, job);
  const { candidates, excluded } = rankCleaners(facts, jobView, DISPATCH_RULES);
  const respondBy = Math.min(now + settings.offerWindowMinutes * MINUTE, job.startsAt);

  // The ranking and the offer check use the same rules. The check has the last word all the same.
  let choice: { candidate: Candidate; cleaner: Doc<"cleaners">; payCents: number } | null = null;
  for (const candidate of candidates) {
    const cleaner = cleaners.find((row) => row._id === candidate.cleanerId);
    if (!cleaner || !candidate.pay.ok) continue;
    const problem = await offerProblem(ctx, { company, job, cleaner, respondBy, payCents: candidate.pay.payCents, rules: DISPATCH_RULES }, { assignments, history });
    if (problem === null) {
      choice = { candidate, cleaner, payCents: candidate.pay.payCents };
      break;
    }
  }

  if (!choice) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: noCandidateWords(excluded), dueAt: job.startsAt }, DISPATCH, same);
    if (isStaffingGap(excluded)) await ensureGapTask(ctx, company, job, jobView.postalCode);
    return "no_candidate";
  }

  const { candidate, cleaner, payCents } = choice;
  const customer = await ctx.db.get(job.customerId);
  const visit = `${customer?.name ?? "a customer"}'s ${job.serviceType} visit on ${whenWords(job.startsAt, company.timezone)}`;

  if (authority.level === "propose") {
    const latest = job.startsAt - settings.offerWindowMinutes * MINUTE;
    const decideBy = latest > now ? Math.min(latest, now + DAY) : job.startsAt;
    const reassigning = action === REASSIGN;
    const summary = `${reassigning ? "Reassign" : "Offer"} ${visit} to ${cleaner.name}`;
    await requestApproval(ctx, {
      companyId: job.companyId,
      action,
      summary,
      reason: `${reassigning ? "The cleaner who had accepted this visit is no longer on it. " : ""}${fitWords(candidate, candidates.length - 1)}`,
      authorizes:
        `Dispatch will offer this visit to ${cleaner.name}: ${job.scope}. Their pay is ${money(payCents)} (${candidate.pay.ok ? candidate.pay.basis : ""}). ` +
        `They get ${settings.offerWindowMinutes} minutes to answer, or until the visit starts if that is sooner. The visit is confirmed only if they accept.`,
      ifWaiting: `The visit stays without a cleaner. This proposal expires ${whenWords(decideBy, company.timezone)}, and the visit then waits for you.`,
      proposal: { kind: "offer_assignment", jobId: job._id, cleanerId: cleaner._id, payCents, respondWithinMinutes: settings.offerWindowMinutes },
      decideBy,
      about: { table: "jobs", id: job._id },
      taskId: task._id,
    });
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `${summary}?`, dueAt: decideBy }, DISPATCH, same);
    return "proposed";
  }

  const assignmentId = await placeOffer(ctx, { company, job, cleaner, respondBy, payCents, rules: DISPATCH_RULES }, DISPATCH, { action });
  if (authority.level === "execute_and_report") {
    await recordEvent(ctx, { companyId: job.companyId, type: "dispatch.reported", actor: DISPATCH, subject: { table: "assignments", id: assignmentId }, data: { action, jobId: job._id, cleanerId: cleaner._id } });
  }
  await setTaskState(ctx, task, "waiting", { waitingOn: "cleaner", followUpAt: respondBy, dueAt: job.startsAt }, DISPATCH, same);
  return "offered";
}

/** A proposal about the old time is withdrawn when a visit moves, and Dispatch looks at the new time. */
export async function afterReschedule(ctx: MutationCtx, job: Doc<"jobs">): Promise<CoverState> {
  await closePending(ctx, await jobApprovals(ctx, job), "job_moved", "The visit was moved to another time.");
  return coverJob(ctx, job._id);
}

/** Puts a job's coverage in a person's hands. Dispatch leaves it alone until it is handed back. */
export async function holdForPerson(ctx: MutationCtx, job: Doc<"jobs">, question: string, actor: Actor): Promise<Doc<"tasks"> | null> {
  const company = await ctx.db.get(job.companyId);
  if (!company) return null;
  const task = await ensureCoverTask(ctx, company, job);
  await setTaskState(ctx, task, "needs_decision", { openQuestion: question, dueAt: job.startsAt, withPersonSince: Date.now() }, actor, { sameStatus: true });
  return task;
}

export type CarriedOut = { ok: boolean; detail: string };

/**
 * What a person's decision on a Dispatch proposal sets in motion. Approved: the offer is made, after
 * every check is run again at this moment. If it can no longer be made, that is recorded and Dispatch
 * looks for the next cleaner. Changed: the visit is the person's. Skipped: that cleaner is not asked
 * for this visit, and Dispatch looks for the next.
 */
export async function afterDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped", decidedBy: Actor): Promise<CarriedOut | null> {
  const proposal = approval.proposal;
  if (!proposal || proposal.kind !== "offer_assignment") return null;
  const job = await ctx.db.get(proposal.jobId);
  const cleaner = await ctx.db.get(proposal.cleanerId);
  const company = await ctx.db.get(approval.companyId);
  const now = Date.now();

  if (decision === "changed") {
    if (job && job.companyId === approval.companyId) {
      await holdForPerson(ctx, job, `You changed Dispatch's proposal to offer this visit to ${cleaner?.name ?? "a cleaner"}. Offer the visit yourself, or hand it back to Dispatch.`, decidedBy);
    }
    return null;
  }
  if (decision === "skipped") {
    if (job) await coverJob(ctx, job._id);
    return null;
  }

  let problem: string | null = null;
  let respondBy = 0;
  if (!company || !job || !cleaner || job.companyId !== approval.companyId || cleaner.companyId !== approval.companyId) {
    problem = "The visit or the cleaner no longer exists.";
  } else if (company.pausedAgents.includes("dispatch")) {
    problem = "Dispatch is paused, so it made no offer.";
  } else if ((await jobAssignments(ctx, job)).some((row) => row.status === "offered")) {
    // Dispatch asks one cleaner at a time. A person may already have asked someone since this was proposed.
    problem = "An offer for this visit is already out to a cleaner.";
  } else {
    const pay = payFor(cleaner, job);
    if (!pay.ok) problem = `${cleaner.name} ${pay.reason}.`;
    else if (pay.payCents !== proposal.payCents) problem = `${cleaner.name}'s pay for this visit changed from ${money(proposal.payCents)} to ${money(pay.payCents)} after this was proposed.`;
    else {
      respondBy = Math.min(now + proposal.respondWithinMinutes * MINUTE, job.startsAt);
      problem = await offerProblem(ctx, { company, job, cleaner, respondBy, payCents: proposal.payCents, rules: DISPATCH_RULES });
    }
  }

  if (problem !== null || !company || !job || !cleaner) {
    const detail = `Not carried out. ${problem ?? ""}`.trim();
    await ctx.db.patch(approval._id, { carriedOut: { ok: false, detail, at: now } });
    await recordEvent(ctx, { companyId: approval.companyId, type: "approval.not_carried_out", actor: DISPATCH, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
    if (job) await coverJob(ctx, job._id);
    return { ok: false, detail };
  }

  const assignmentId = await placeOffer(ctx, { company, job, cleaner, respondBy, payCents: proposal.payCents, rules: DISPATCH_RULES }, DISPATCH, { action: approval.action, approvalId: approval._id });
  const detail = `Offered to ${cleaner.name}. Their answer is due ${whenWords(respondBy, company.timezone)}.`;
  await ctx.db.patch(approval._id, { carriedOut: { ok: true, detail, at: now } });
  await recordEvent(ctx, { companyId: approval.companyId, type: "approval.carried_out", actor: DISPATCH, subject: { table: "approvals", id: approval._id }, data: { action: approval.action, assignmentId } });
  await coverJob(ctx, job._id);
  return { ok: true, detail };
}

/** A proposal nobody decided in time is never treated as approved. The visit waits for a person. */
export async function afterExpiry(ctx: MutationCtx, approval: Doc<"approvals">) {
  const proposal = approval.proposal;
  if (!proposal || proposal.kind !== "offer_assignment") return;
  const job = await ctx.db.get(proposal.jobId);
  if (!job || job.status !== "scheduled") return;
  const assignments = await jobAssignments(ctx, job);
  if (assignments.some((row) => row.status === "accepted" || row.status === "offered")) return;
  const cleaner = await ctx.db.get(proposal.cleanerId);
  await holdForPerson(ctx, job, `Nobody decided on offering this visit to ${cleaner?.name ?? "a cleaner"} before the deadline. Offer the visit yourself, or hand it back to Dispatch.`, SYSTEM);
}
