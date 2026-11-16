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
import { jobCoverageRequests, settleCoverage } from "./coverage";
import { nextRole, requiredCrew, staffing } from "./crew";
import { DISPATCH_RULES, isStaffingGap, rankCleaners, type Candidate, type Excluded } from "./eligibility";
import { jobAssignments, jobFacts, jobHistory, readyCleanerFacts } from "./facts";
import { handOff } from "./handoffs";
import { carryOutReminder } from "./live";
import { offerProblem, placeOffer, type OfferKind } from "./offers";
import { money, payFor } from "./pay";
import { crewPayOf, dispatchPolicy } from "./policy";
import { dispatchSettings, type DispatchSettings } from "./settings";

export const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const SYSTEM: Actor = { kind: "system" };
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export const REQUEST_ACCEPTANCE = "dispatch.request_acceptance";
export const REASSIGN = "dispatch.reassign_confirmed_visit";
export const SEND_REPLACEMENT = "dispatch.send_replacement_offer";
export const RUN_BACKUP = "dispatch.run_backup_coverage";
export const BROADCAST = "dispatch.broadcast_offer";
export const URGENT_HIRE = "dispatch.request_urgent_hire";

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
  const out: Id<"cleaners">[] = [];
  for (const row of approvals) if (row.status === "skipped" && row.proposal?.kind === "offer_assignment") out.push(row.proposal.cleanerId);
  return out;
}

/** Who Dispatch could ask for this job right now, best first, and who it cannot ask with the reason. */
export async function candidatesFor(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, job: Doc<"jobs">) {
  const assignments = await jobAssignments(ctx, job);
  const history = await jobHistory(ctx, job, assignments, skippedCleaners(await jobApprovals(ctx, job)));
  const { cleaners, facts } = await readyCleanerFacts(ctx, job, history);
  const ranked = rankCleaners(facts, await jobFacts(ctx, company, job), DISPATCH_RULES);
  return { ...ranked, cleaners, assignments, history };
}

/**
 * The same answer for a person looking at a job that already has someone on it: a cleaner who accepted
 * this job, or holds an open offer for it, is not someone to ask for its remaining places. They are
 * listed with the others who cannot be asked, and the reason says which it is.
 */
export function withoutCrew<C extends { cleanerId: string; name: string }, E extends { cleanerId: string; name: string; code: string; reason: string }>(found: { candidates: C[]; excluded: E[]; assignments: Doc<"assignments">[] }) {
  const held = new Map<string, "accepted" | "offered">();
  for (const row of found.assignments) if (row.status === "accepted" || (row.status === "offered" && !held.has(row.cleanerId))) held.set(row.cleanerId, row.status);
  const onJob = found.candidates.filter((row) => held.has(row.cleanerId));
  return {
    candidates: found.candidates.filter((row) => !held.has(row.cleanerId)),
    excluded: [
      ...onJob.map((row) => ({ cleanerId: row.cleanerId, name: row.name, code: held.get(row.cleanerId) === "accepted" ? "on_this_job" : "offer_out", reason: held.get(row.cleanerId) === "accepted" ? "has already accepted this visit" : "already has an open offer for this visit" })),
      ...found.excluded.map((row) => ({ cleanerId: row.cleanerId, name: row.name, code: row.code as string, reason: row.reason })),
    ],
  };
}

/**
 * Which permission covers finding a cleaner now. Each is the Owner's to set on its own: a first offer,
 * the next cleaner after a no or no answer, cover for a place whose cleaner dropped out or did not
 * arrive, and replacing a cleaner a person took off a confirmed visit.
 */
export function coverAction(assignments: Doc<"assignments">[], backup = false): string {
  if (backup) return RUN_BACKUP;
  const hadAccepted = assignments.some((row) => row.status === "cancelled" && row.endCause === "released" && row.respondedAt !== undefined);
  if (hadAccepted) return REASSIGN;
  const hadNo = assignments.some((row) => row.status === "declined" || row.status === "expired" || (row.status === "cancelled" && row.endCause === "undelivered"));
  return hadNo ? SEND_REPLACEMENT : REQUEST_ACCEPTANCE;
}

const ACTION_WORDS: Record<string, string> = {
  [REQUEST_ACCEPTANCE]: "request acceptance",
  [REASSIGN]: "reassign a confirmed visit",
  [SEND_REPLACEMENT]: "offer a visit to the next cleaner",
  [RUN_BACKUP]: "find cover for a visit",
};

function offerKindFor(action: string): OfferKind {
  return action === REQUEST_ACCEPTANCE ? "initial" : action === RUN_BACKUP ? "backup" : "replacement";
}

/** The permission that applies to this job as it stands, reading whether a place is waiting for cover. */
export async function currentCoverAction(ctx: QueryCtx | MutationCtx, job: Doc<"jobs">, assignments: Doc<"assignments">[]): Promise<string> {
  const requests = await jobCoverageRequests(ctx, job);
  return coverAction(assignments, requests.some((row) => row.status === "open" || row.status === "unresolved"));
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
    completionCondition: requiredCrew(job) === 1 ? "A cleaner accepted the visit" : `All ${requiredCrew(job)} cleaners accepted the visit`,
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

/** What was tried for a place that lost its cleaner, what is left, and when a person has to have decided. */
function unresolvedWords(job: Doc<"jobs">, assignments: Doc<"assignments">[], excluded: Excluded[], timezone: string): string {
  const asked = assignments.filter((row) => row.status === "declined" || row.status === "expired" || (row.status === "cancelled" && row.endCause === "undelivered")).length;
  const tried = asked === 0 ? "No other cleaner could be asked." : `${asked} ${asked === 1 ? "cleaner was" : "cleaners were"} asked and none accepted.`;
  const why = excluded.slice(0, 4).map((entry) => `${entry.name} ${entry.reason}`).join("; ");
  return `${tried}${why ? ` ${why}.` : ""} What is left: offer it yourself to a cleaner Dispatch may not ask, move the visit, or ask Recruiter for an urgent hire. Decide by ${whenWords(Math.max(job.startsAt, Date.now()), timezone)}.`;
}

/**
 * Looks at one job and does whatever is still missing to fill every place on it. Safe to run again at
 * any time. A job with two places is covered only when two cleaners have accepted: one acceptance leaves
 * it partially staffed and the work goes on.
 */
export async function coverJob(ctx: MutationCtx, jobId: Id<"jobs">): Promise<CoverState> {
  const job = await ctx.db.get(jobId);
  if (!job) return "gone";
  const company = await ctx.db.get(job.companyId);
  if (!company) return "gone";
  const settings = dispatchSettings(company);
  const policy = dispatchPolicy(company);
  const now = Date.now();
  const live = await liveTaskByKey(ctx, job.companyId, coverKey(job._id));
  const requests = await jobCoverageRequests(ctx, job);

  if (job.status === "cancelled" || job.status === "completed") {
    const cancelled = job.status === "cancelled";
    for (const request of requests) await settleCoverage(ctx, request, "cancelled", SYSTEM);
    if (live) {
      await closePending(ctx, await jobApprovals(ctx, job), cancelled ? "job_cancelled" : "job_completed", cancelled ? "The visit was cancelled." : "The visit was completed.");
      await setTaskState(ctx, live, cancelled ? "cancelled" : "done", { outcome: cancelled ? "The visit was cancelled." : "The visit was completed.", closedAt: now, withPersonSince: null }, DISPATCH);
    }
    return "closed";
  }

  const assignments = await jobAssignments(ctx, job);
  const staff = staffing(job, assignments);
  const crew = staff.required;
  if (staff.open === 0) {
    for (const request of requests) {
      const by = assignments.find((row) => row.status === "accepted" && row.coverageRequestId === request._id);
      await settleCoverage(ctx, request, "filled", DISPATCH, { filledByAssignmentId: by?._id });
    }
    if (live) {
      await closePending(ctx, await jobApprovals(ctx, job), "job_covered", "A cleaner accepted this visit.");
      const names: string[] = [];
      for (const row of assignments.filter((entry) => entry.status === "accepted")) names.push((await ctx.db.get(row.cleanerId))?.name ?? "A cleaner");
      const outcome = crew === 1 ? `${names[0] ?? "A cleaner"} accepted the visit.` : `All ${crew} places are accepted: ${names.join(", ")}.`;
      await setTaskState(ctx, live, "done", { outcome, closedAt: now, withPersonSince: null }, DISPATCH);
    }
    return "covered";
  }

  // From here the job is short at least one cleaner, so it has a task that says where it stands.
  const task = await ensureCoverTask(ctx, company, job);
  const same = { sameStatus: true };
  const short = crew === 1 ? "" : ` ${staff.accepted} of ${crew} places are accepted.`;

  if (job.status === "in_progress") {
    const question = crew === 1 ? "This visit is underway and has no cleaner on it. Decide what to do." : `This visit is underway and is short ${staff.open} of ${crew} cleaners. Decide what to do.`;
    await setTaskState(ctx, task, "needs_decision", { openQuestion: question, dueAt: job.startsAt }, DISPATCH, same);
    return "underway";
  }

  const offers = assignments.filter((row) => row.status === "offered");
  if (offers.length >= staff.open) {
    const followUpAt = Math.min(...offers.map((row) => row.respondBy));
    await setTaskState(ctx, task, "waiting", { waitingOn: "cleaner", followUpAt, dueAt: job.startsAt }, DISPATCH, same);
    return "offer_out";
  }

  if (task.withPersonSince !== undefined) {
    if (task.status !== "needs_decision") await setTaskState(ctx, task, "needs_decision", { openQuestion: WITH_YOU, dueAt: job.startsAt }, DISPATCH);
    return "with_person";
  }

  const approvals = await jobApprovals(ctx, job);
  const pending = approvals.filter((row) => row.status === "pending" && row.proposal?.kind === "offer_assignment");
  if (pending.length > 0 && offers.length + pending.length >= staff.open) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `${pending[0].summary}?`, dueAt: Math.min(...pending.map((row) => row.decideBy)) }, DISPATCH, same);
    return "awaiting_decision";
  }

  const openRequests = requests.filter((row) => row.status === "open" || row.status === "unresolved");
  const backup = openRequests.length > 0;
  // A place that lost its cleaner is still worth covering after the start time, until the job would have ended.
  const lateCover = backup && job.startsAt <= now && now < job.endsAt;
  if (job.startsAt <= now && !lateCover) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `This visit's start time has passed and ${crew === 1 ? "no cleaner accepted it" : `it is short ${staff.open} of ${crew} cleaners`}. Decide what to do with it.`, dueAt: job.startsAt }, DISPATCH, same);
    return "too_late";
  }

  const opensAt = job.startsAt - settings.lookAheadDays * DAY;
  if (now < opensAt) {
    const days = settings.lookAheadDays;
    await setTaskState(ctx, task, "open", { nextAction: `Find a cleaner once the visit is within ${days} ${days === 1 ? "day" : "days"}`, dueAt: opensAt }, DISPATCH, same);
    return "too_early";
  }

  const action = coverAction(assignments, backup);
  const authority = await authorityFor(ctx, company._id, action);
  if (authority.kind === "paused") {
    await setTaskState(ctx, task, "open", { nextAction: "Dispatch is paused. Resume Dispatch, or offer this visit to a cleaner yourself.", dueAt: taskDeadline(job, settings, now) }, DISPATCH, same);
    return "paused";
  }
  if (authority.kind !== "level" || authority.level === "off") {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `Dispatch is not allowed to ${ACTION_WORDS[action] ?? "do this"} for this company. Offer this visit to a cleaner yourself.`, dueAt: job.startsAt }, DISPATCH, same);
    return "off";
  }

  const history = await jobHistory(ctx, job, assignments, skippedCleaners(approvals));
  const { cleaners, facts } = await readyCleanerFacts(ctx, job, history);
  const jobView = await jobFacts(ctx, company, job);
  const { candidates, excluded } = rankCleaners(facts, jobView, DISPATCH_RULES);
  const windowMinutes = backup ? policy.backupOfferWindowMinutes : settings.offerWindowMinutes;
  const respondBy = Math.min(now + windowMinutes * MINUTE, lateCover ? job.endsAt : job.startsAt);

  // One offer or proposal per open place, unless the Owner allows asking several cleaners at once.
  let wanted = staff.open - offers.length - pending.length;
  if (policy.broadcastEnabled && authority.level !== "propose") {
    const broadcast = await authorityFor(ctx, company._id, BROADCAST);
    if (broadcast.kind === "level" && (broadcast.level === "execute" || broadcast.level === "execute_and_report")) {
      wanted = Math.min(candidates.length, staff.open * policy.broadcastSize) - offers.length;
    }
  }
  const taken = new Set<string>([
    ...assignments.filter((row) => row.status === "offered" || row.status === "accepted").map((row) => row.cleanerId as string),
    ...pending.map((row) => (row.proposal?.kind === "offer_assignment" ? (row.proposal.cleanerId as string) : "")),
  ]);
  const customer = await ctx.db.get(job.customerId);
  const visit = `${customer?.name ?? "a customer"}'s ${job.serviceType} visit on ${whenWords(job.startsAt, company.timezone)}`;
  const eligibleOthers = candidates.filter((row) => !taken.has(row.cleanerId)).length - 1;
  const request = openRequests[0];
  const proposals: { summary: string; decideBy: number }[] = pending.map((row) => ({ summary: row.summary, decideBy: row.decideBy }));
  let offered = 0;
  let proposed = 0;

  for (const candidate of candidates) {
    if (wanted <= 0) break;
    if (taken.has(candidate.cleanerId)) continue;
    const cleaner = cleaners.find((row) => row._id === candidate.cleanerId);
    if (!cleaner || !candidate.pay.ok) continue;
    // Offers placed earlier in this loop may have taken the lead, so the pay is worked out for the role this offer carries.
    const pay = payFor(cleaner, job, { rule: crewPayOf(company), role: nextRole(assignments) });
    if (!pay.ok) continue;
    const payCents = pay.payCents;
    // The ranking and the offer check use the same rules. The check has the last word all the same.
    const problem = await offerProblem(ctx, { company, job, cleaner, respondBy, payCents, rules: DISPATCH_RULES, afterStart: lateCover }, { assignments, history });
    if (problem !== null) continue;
    taken.add(candidate.cleanerId);
    wanted -= 1;

    if (authority.level === "propose") {
      const latest = job.startsAt - windowMinutes * MINUTE;
      const decideBy = lateCover ? Math.min(now + windowMinutes * MINUTE, job.endsAt) : latest > now ? Math.min(latest, now + DAY) : job.startsAt;
      const reassigning = action === REASSIGN;
      const summary = `${reassigning ? "Reassign" : backup ? "Offer cover for" : "Offer"} ${visit} to ${cleaner.name}`;
      const lead =
        reassigning ? "The cleaner who had accepted this visit is no longer on it. " : backup ? "A cleaner who had accepted this visit is no longer on it. " : action === SEND_REPLACEMENT ? "An earlier offer for this visit ended without an acceptance. " : "";
      await requestApproval(ctx, {
        companyId: job.companyId,
        action,
        summary,
        reason: `${lead}${fitWords(candidate, Math.max(0, eligibleOthers))}${short}`,
        authorizes:
          `Dispatch will offer this visit to ${cleaner.name}: ${job.scope}. Their pay is ${money(payCents)} (${pay.basis}). ` +
          `They get ${windowMinutes} minutes to answer, or until the visit starts if that is sooner. The visit is confirmed only if they accept.`,
        ifWaiting: `The visit stays without a cleaner. This proposal expires ${whenWords(decideBy, company.timezone)}, and the visit then waits for you.`,
        proposal: { kind: "offer_assignment", jobId: job._id, cleanerId: cleaner._id, payCents, respondWithinMinutes: windowMinutes },
        decideBy,
        about: { table: "jobs", id: job._id },
        taskId: task._id,
      });
      proposals.push({ summary, decideBy });
      proposed += 1;
      continue;
    }

    const assignmentId = await placeOffer(ctx, { company, job, cleaner, respondBy, payCents, rules: DISPATCH_RULES, afterStart: lateCover }, DISPATCH, { action }, { kind: offerKindFor(action), coverageRequestId: request?._id });
    assignments.push((await ctx.db.get(assignmentId))!);
    if (authority.level === "execute_and_report") {
      await recordEvent(ctx, { companyId: job.companyId, type: "dispatch.reported", actor: DISPATCH, subject: { table: "assignments", id: assignmentId }, data: { action, jobId: job._id, cleanerId: cleaner._id } });
    }
    offered += 1;
  }

  const inFlight = offers.length + offered + proposals.length;
  // A place nobody can be asked for is a gap even while another place has an offer out.
  if (wanted > 0 && inFlight < staff.open && isStaffingGap(excluded)) await ensureGapTask(ctx, company, job, jobView.postalCode);

  if (inFlight === 0) {
    let question = noCandidateWords(excluded);
    if (crew > 1) question = `${question.replace(/ Decide how to cover it\.$/, "")}${short} Decide how to cover it.`;
    if (backup) {
      // Cover could not be found. It is marked unresolved, with what was tried and what is left: never quietly dropped.
      const summary = unresolvedWords(job, assignments, excluded, company.timezone);
      for (const row of openRequests) await settleCoverage(ctx, row, "unresolved", DISPATCH, { summary });
      question = `Cover could not be found for this visit. ${summary}`.slice(0, 1000);
      const urgent = await authorityFor(ctx, company._id, URGENT_HIRE);
      if (urgent.kind === "level" && (urgent.level === "execute" || urgent.level === "execute_and_report")) {
        await handOff(ctx, {
          companyId: job.companyId,
          to: "recruiter",
          key: `recruiter.urgent_hire:${job._id}`,
          title: `Urgent hire: nobody can cover the visit on ${whenWords(job.startsAt, company.timezone)}`,
          question: "Find a cleaner who can be made ready in time for this visit, or say that nobody can",
          trigger: "A cleaner left this visit and no ready cleaner could cover it.",
          completionCondition: "A ready cleaner can take this visit, or the owner is told nobody can",
          escalation: "If nobody is found before the visit starts, the owner decides whether to move or cancel it.",
          dueAt: Math.max(job.startsAt, now),
          about: { table: "jobs", id: job._id },
          actor: DISPATCH,
        });
      }
    }
    await setTaskState(ctx, task, "needs_decision", { openQuestion: question, dueAt: job.startsAt }, DISPATCH, same);
    return "no_candidate";
  }

  if (backup) for (const row of openRequests) await settleCoverage(ctx, row, "open", DISPATCH);

  if (proposals.length > 0) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: `${proposals[0].summary}?`, dueAt: Math.min(...proposals.map((row) => row.decideBy)) }, DISPATCH, same);
    return proposed > 0 ? "proposed" : "awaiting_decision";
  }
  const out = assignments.filter((row) => row.status === "offered");
  await setTaskState(ctx, task, "waiting", { waitingOn: "cleaner", followUpAt: Math.min(...out.map((row) => row.respondBy)), dueAt: job.startsAt }, DISPATCH, same);
  return offered > 0 ? "offered" : "offer_out";
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
  if (proposal?.kind === "send_reminder") return decision === "approved" ? carryOutReminder(ctx, approval, proposal.assignmentId) : null;
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
  let afterStart = false;
  if (!company || !job || !cleaner || job.companyId !== approval.companyId || cleaner.companyId !== approval.companyId) {
    problem = "The visit or the cleaner no longer exists.";
  } else if (company.pausedAgents.includes("dispatch")) {
    problem = "Dispatch is paused, so it made no offer.";
  } else if (staffing(job, await jobAssignments(ctx, job)).open <= (await jobAssignments(ctx, job)).filter((row) => row.status === "offered").length) {
    // Dispatch keeps one offer out per open place. A person may already have asked someone since this was proposed.
    problem = requiredCrew(job) === 1 ? "An offer for this visit is already out to a cleaner." : "An offer is already out for every open place on this visit.";
  } else {
    const pay = payFor(cleaner, job, { rule: crewPayOf(company), role: nextRole(await jobAssignments(ctx, job)) });
    if (!pay.ok) problem = `${cleaner.name} ${pay.reason}.`;
    else if (pay.payCents !== proposal.payCents) problem = `${cleaner.name}'s pay for this visit changed from ${money(proposal.payCents)} to ${money(pay.payCents)} after this was proposed.`;
    else {
      afterStart = approval.action === RUN_BACKUP && job.startsAt <= now && now < job.endsAt;
      respondBy = Math.min(now + proposal.respondWithinMinutes * MINUTE, afterStart ? job.endsAt : job.startsAt);
      problem = await offerProblem(ctx, { company, job, cleaner, respondBy, payCents: proposal.payCents, rules: DISPATCH_RULES, afterStart });
    }
  }

  if (problem !== null || !company || !job || !cleaner) {
    const detail = `Not carried out. ${problem ?? ""}`.trim();
    await ctx.db.patch(approval._id, { carriedOut: { ok: false, detail, at: now } });
    await recordEvent(ctx, { companyId: approval.companyId, type: "approval.not_carried_out", actor: DISPATCH, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
    if (job) await coverJob(ctx, job._id);
    return { ok: false, detail };
  }

  const coverRequest = (await jobCoverageRequests(ctx, job)).find((row) => row.status === "open" || row.status === "unresolved");
  const assignmentId = await placeOffer(
    ctx,
    { company, job, cleaner, respondBy, payCents: proposal.payCents, rules: DISPATCH_RULES, afterStart },
    DISPATCH,
    { action: approval.action, approvalId: approval._id },
    { kind: offerKindFor(approval.action), coverageRequestId: approval.action === RUN_BACKUP ? coverRequest?._id : undefined },
  );
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
