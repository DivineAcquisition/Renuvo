/**
 * Performance from verified records only: offers, accepted jobs, check-ins and completion reports, each a
 * fact with its own time in Dispatch's assignments. Every measure carries its definition, the period, the
 * sample it rests on and the records themselves, so anyone can check it.
 *
 * What it never does:
 *  - count silence as a refusal, or an undelivered offer as silence;
 *  - count a missing check-in as late (no fault without a record that shows it);
 *  - count a job a person released, cancelled, moved or covered against the cleaner;
 *  - put a crew's outcome (a completion report on a job several people worked) on one member;
 *  - count a record while a dispute about it is open, or after it was corrected.
 *
 * The score is a deterministic, versioned summary of three of these measures. It is not used to rank people
 * or to decide who is offered work: Dispatch never reads it. With too little history there is no score.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requiredCrew } from "../dispatch/crew";
import { arrivalEndsAt } from "../dispatch/live";
import { ASSIGNMENT_STATUSES } from "../statuses";
import { jobLabel } from "./schedule";

export const SCORE_VERSION = "selestial.cleaners.score.v1";
export const PERIOD_DAYS = 90;
const DAY = 86_400_000;
/** A check-in this soon after the arrival window closes still counts as on time: phones and doors take a minute. */
export const GRACE_MINUTES = 5;

export type MeasureKey = "reliability" | "punctuality" | "responsiveness" | "completion";

/** The score's parts and their weights. Completion is shown but not scored: on most jobs it is the crew's. */
export const WEIGHTS: Record<Exclude<MeasureKey, "completion">, number> = { reliability: 50, punctuality: 30, responsiveness: 20 };
/** The least sample a measure needs before it counts. Reliability below its minimum means no score at all. */
export const MINIMUM: Record<MeasureKey, number> = { reliability: 5, punctuality: 5, responsiveness: 5, completion: 5 };

export const DEFINITIONS: Record<MeasureKey, { label: string; definition: string }> = {
  reliability: {
    label: "Accepted jobs kept",
    definition: "Of the jobs they accepted that were due to start in the period, how many they kept. Jobs a person released, cancelled, moved or covered are left out. Saying they could not attend and a no-show declared by a person are counted apart.",
  },
  punctuality: {
    label: "On time when checked in",
    definition: `Of the kept jobs with a recorded check-in, how many checked in by the end of the arrival window (${GRACE_MINUTES} minutes' grace). Jobs with no check-in recorded are not counted as late. Late arrivals they told the office about are shown apart.`,
  },
  responsiveness: {
    label: "Offers answered",
    definition: "Of the offers that reached them and closed in the period, how many they answered, yes or no. Declining is an answer. Offers that were not delivered, or were withdrawn before they could answer, are left out.",
  },
  completion: {
    label: "Completion reports on their own jobs",
    definition: "Of the jobs they worked alone that are finished, how many have a completion report. On crew jobs the report is the crew's, so it is not counted for one person.",
  },
};

export type AssignmentFact = {
  assignmentId: string;
  jobId: string;
  label: string;
  status: Doc<"assignments">["status"];
  endCause: Doc<"assignments">["endCause"] | null;
  offeredAt: number;
  respondBy: number;
  respondedAt: number | null;
  jobStatus: Doc<"jobs">["status"];
  startsAt: number;
  endsAt: number;
  arrivalEndsAt: number;
  checkInAt: number | null;
  lateReportedAt: number | null;
  completion: { submittedAt: number; incomplete: boolean } | null;
  crewSize: number;
};

export type DisputeFact = { disputeId: string; assignmentId: string; measure: string; status: "open" | "upheld" | "corrected"; reason: string };

export type RecordRow = {
  assignmentId: string;
  jobId: string;
  label: string;
  at: number;
  /** What the record shows, in words. */
  outcome: string;
  /** Whether it counts in the measure: false while disputed or once corrected, and for left-out records. */
  counts: boolean;
  tone: "good" | "neutral" | "concern";
  dispute: { disputeId: string; status: "open" | "upheld" | "corrected"; reason: string } | null;
};

export type Measure = {
  key: MeasureKey;
  label: string;
  definition: string;
  periodDays: number;
  numerator: number;
  denominator: number;
  /** 0 to 1, or null with no sample. */
  rate: number | null;
  minimum: number;
  enough: boolean;
  /** One line: the measure in words with its sample. */
  words: string;
  breakdown: { label: string; count: number; tone: RecordRow["tone"] }[];
  records: RecordRow[];
  /** Records left out while a dispute is open, or because one was corrected. */
  disputed: number;
};

export type Score =
  | { state: "not_enough"; version: string; words: string; needed: number; have: number }
  | { state: "scored"; version: string; value: number; lines: { key: MeasureKey; words: string; points: number | null }[]; words: string };

export type Performance = { periodStart: number; periodEnd: number; measures: Record<MeasureKey, Measure>; score: Score };

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A dispute about one measure, or about the whole record ("all", as a cleaner raises it from their portal). */
function disputeOf(disputes: DisputeFact[], assignmentId: string, measure: MeasureKey) {
  const about = (item: DisputeFact) => item.assignmentId === assignmentId && (item.measure === measure || item.measure === "all");
  const row = disputes.find((item) => about(item) && item.status !== "upheld") ?? disputes.find(about);
  return row ? { disputeId: row.disputeId, status: row.status, reason: row.reason } : null;
}

/** Counts a record unless a dispute about it is open or corrected it. */
const stands = (dispute: RecordRow["dispute"]) => dispute === null || dispute.status === "upheld";

/** Company-side reasons an accepted job did not go ahead. None of them is the cleaner's doing. */
const COMPANY_SIDE: NonNullable<Doc<"assignments">["endCause"]>[] = ["released", "job_cancelled", "job_moved", "job_covered", "undelivered"];

function measure(key: MeasureKey, numerator: number, denominator: number, breakdown: Measure["breakdown"], records: RecordRow[], words: (rate: number) => string): Measure {
  const rate = denominator > 0 ? numerator / denominator : null;
  const enough = denominator >= MINIMUM[key];
  return {
    key,
    ...DEFINITIONS[key],
    periodDays: PERIOD_DAYS,
    numerator,
    denominator,
    rate,
    minimum: MINIMUM[key],
    enough,
    words: rate === null ? "No records in the period." : `${words(rate)}${enough ? "" : ` Only ${plural(denominator, "record")}, so it is not counted yet (needs ${MINIMUM[key]}).`}`,
    breakdown: breakdown.filter((row) => row.count > 0),
    records: records.sort((a, b) => b.at - a.at),
    disputed: records.filter((row) => row.dispute && row.dispute.status !== "upheld").length,
  };
}

/** The measures and the score from the facts. Pure: the same facts always give the same answer. */
export function performanceFrom(input: { now: number; facts: AssignmentFact[]; disputes: DisputeFact[] }): Performance {
  const { now, facts, disputes } = input;
  const periodStart = now - PERIOD_DAYS * DAY;

  // Responsiveness: offers made in the period that closed, answered or not.
  const offerRows: RecordRow[] = [];
  let answered = 0;
  let unanswered = 0;
  let yes = 0;
  let no = 0;
  for (const fact of facts) {
    if (fact.offeredAt < periodStart || fact.offeredAt > now) continue;
    const closedUnanswered = fact.status === "expired";
    const wasAnswered = fact.respondedAt !== null && (fact.status === "accepted" || fact.status === "declined" || fact.status === "cancelled");
    if (!closedUnanswered && !wasAnswered) continue;
    const dispute = disputeOf(disputes, fact.assignmentId, "responsiveness");
    const counts = stands(dispute);
    const accepted = wasAnswered && fact.status !== "declined";
    offerRows.push({ assignmentId: fact.assignmentId, jobId: fact.jobId, label: fact.label, at: fact.offeredAt, outcome: closedUnanswered ? "No answer before the offer closed" : accepted ? "Accepted" : "Declined", counts, tone: closedUnanswered ? "concern" : "neutral", dispute });
    if (!counts) continue;
    if (closedUnanswered) unanswered += 1;
    else {
      answered += 1;
      if (accepted) yes += 1;
      else no += 1;
    }
  }
  const responsiveness = measure(
    "responsiveness",
    answered,
    answered + unanswered,
    [
      { label: "Accepted", count: yes, tone: "neutral" },
      { label: "Declined", count: no, tone: "neutral" },
      { label: "No answer", count: unanswered, tone: "concern" },
    ],
    offerRows,
    (rate) => `Answered ${answered} of ${answered + unanswered} offers (${pct(rate)}).`,
  );

  // Reliability: accepted jobs due to start in the period that have started.
  const keptFacts: AssignmentFact[] = [];
  const reliabilityRows: RecordRow[] = [];
  let kept = 0;
  let dropped = 0;
  let noShow = 0;
  let companySide = 0;
  for (const fact of facts) {
    if (fact.startsAt < periodStart || fact.startsAt > now || fact.respondedAt === null) continue;
    const wasAccepted = fact.status === "accepted" || (fact.status === "cancelled" && fact.endCause !== null);
    if (!wasAccepted) continue;
    if ((fact.status === "cancelled" && fact.endCause && COMPANY_SIDE.includes(fact.endCause)) || fact.jobStatus === "cancelled") {
      companySide += 1;
      continue;
    }
    const dispute = disputeOf(disputes, fact.assignmentId, "reliability");
    const counts = stands(dispute);
    const outcome = fact.status === "accepted" ? "Kept" : fact.endCause === "no_show" ? "No-show, declared by a person" : "Said they could not attend";
    reliabilityRows.push({ assignmentId: fact.assignmentId, jobId: fact.jobId, label: fact.label, at: fact.startsAt, outcome, counts, tone: fact.status === "accepted" ? "good" : "concern", dispute });
    if (fact.status === "accepted") keptFacts.push(fact);
    if (!counts) continue;
    if (fact.status === "accepted") kept += 1;
    else if (fact.endCause === "no_show") noShow += 1;
    else dropped += 1;
  }
  const reliability = measure(
    "reliability",
    kept,
    kept + dropped + noShow,
    [
      { label: "Kept", count: kept, tone: "good" },
      { label: "Said they could not attend", count: dropped, tone: "concern" },
      { label: "No-show, declared by a person", count: noShow, tone: "concern" },
    ],
    reliabilityRows,
    (rate) => `Kept ${kept} of ${kept + dropped + noShow} accepted jobs (${pct(rate)}).${companySide ? ` ${plural(companySide, "job")} the company released, cancelled or moved ${companySide === 1 ? "is" : "are"} left out.` : ""}`,
  );

  // Punctuality: kept jobs with a recorded check-in.
  const punctualityRows: RecordRow[] = [];
  let onTime = 0;
  let lateTold = 0;
  let lateUntold = 0;
  let noCheckIn = 0;
  for (const fact of keptFacts) {
    if (fact.checkInAt === null) {
      noCheckIn += 1;
      punctualityRows.push({ assignmentId: fact.assignmentId, jobId: fact.jobId, label: fact.label, at: fact.startsAt, outcome: "No check-in recorded (not counted)", counts: false, tone: "neutral", dispute: null });
      continue;
    }
    const late = fact.checkInAt > fact.arrivalEndsAt + GRACE_MINUTES * 60_000;
    const told = late && fact.lateReportedAt !== null && fact.lateReportedAt <= fact.startsAt;
    const minutes = Math.round((fact.checkInAt - fact.arrivalEndsAt) / 60_000);
    const dispute = disputeOf(disputes, fact.assignmentId, "punctuality");
    const counts = stands(dispute);
    punctualityRows.push({ assignmentId: fact.assignmentId, jobId: fact.jobId, label: fact.label, at: fact.startsAt, outcome: late ? `Checked in ${minutes} minutes after the arrival window${told ? ", and told the office beforehand" : ""}` : "On time", counts, tone: late ? (told ? "neutral" : "concern") : "good", dispute });
    if (!counts) continue;
    if (!late) onTime += 1;
    else if (told) lateTold += 1;
    else lateUntold += 1;
  }
  const punctuality = measure(
    "punctuality",
    onTime,
    onTime + lateTold + lateUntold,
    [
      { label: "On time", count: onTime, tone: "good" },
      { label: "Late, told the office beforehand", count: lateTold, tone: "neutral" },
      { label: "Late without word", count: lateUntold, tone: "concern" },
      { label: "No check-in recorded (not counted)", count: noCheckIn, tone: "neutral" },
    ],
    punctualityRows,
    (rate) => `On time for ${onTime} of ${onTime + lateTold + lateUntold} recorded check-ins (${pct(rate)}).`,
  );

  // Completion: finished jobs they worked alone.
  const completionRows: RecordRow[] = [];
  let reported = 0;
  let missing = 0;
  let incomplete = 0;
  let crewJobs = 0;
  for (const fact of keptFacts) {
    const finished = fact.jobStatus === "completed" || fact.endsAt <= now;
    if (!finished) continue;
    if (fact.crewSize > 1) {
      crewJobs += 1;
      continue;
    }
    const dispute = disputeOf(disputes, fact.assignmentId, "completion");
    const counts = stands(dispute);
    completionRows.push({ assignmentId: fact.assignmentId, jobId: fact.jobId, label: fact.label, at: fact.startsAt, outcome: fact.completion ? (fact.completion.incomplete ? "Reported, with work left undone" : "Reported complete") : "No completion report", counts, tone: fact.completion ? (fact.completion.incomplete ? "neutral" : "good") : "concern", dispute });
    if (!counts) continue;
    if (fact.completion) {
      reported += 1;
      if (fact.completion.incomplete) incomplete += 1;
    } else missing += 1;
  }
  const completion = measure(
    "completion",
    reported,
    reported + missing,
    [
      { label: "Reported", count: reported, tone: "good" },
      { label: "Of those, with work left undone", count: incomplete, tone: "neutral" },
      { label: "No report", count: missing, tone: "concern" },
    ],
    completionRows,
    (rate) => `Completion reports on ${reported} of ${reported + missing} finished solo jobs (${pct(rate)}).${crewJobs ? ` ${plural(crewJobs, "crew job")} not counted for one person.` : ""}`,
  );

  const measures = { reliability, punctuality, responsiveness, completion };
  return { periodStart, periodEnd: now, measures, score: scoreOf(measures) };
}

/** The versioned score. Reliability is required; other parts count only with enough records, and say so. */
export function scoreOf(measures: Record<MeasureKey, Measure>): Score {
  const base = measures.reliability;
  if (!base.enough || base.rate === null) {
    return {
      state: "not_enough",
      version: SCORE_VERSION,
      needed: MINIMUM.reliability,
      have: base.denominator,
      words: `Not enough history: ${plural(base.denominator, "accepted job")} in the last ${PERIOD_DAYS} days, and a score needs ${MINIMUM.reliability}. The records are shown as they are.`,
    };
  }
  let weighted = 0;
  let total = 0;
  const lines: { key: MeasureKey; words: string; points: number | null }[] = [];
  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    const item = measures[key];
    if (item.enough && item.rate !== null) {
      weighted += WEIGHTS[key] * item.rate;
      total += WEIGHTS[key];
      lines.push({ key, points: Math.round(WEIGHTS[key] * item.rate * 10) / 10, words: `${item.label}: ${pct(item.rate)} of ${WEIGHTS[key]} points (${item.numerator} of ${item.denominator}).` });
    } else {
      lines.push({ key, points: null, words: `${item.label}: left out, ${item.denominator === 0 ? "no records" : `only ${plural(item.denominator, "record")}`} (needs ${item.minimum}). Its points are shared among the parts that count.` });
    }
  }
  const value = Math.round((weighted / total) * 100);
  return { state: "scored", version: SCORE_VERSION, value, lines, words: `${value} out of 100 from ${lines.filter((line) => line.points !== null).length} of 3 parts over the last ${PERIOD_DAYS} days.` };
}

// ── Recommendations ──────────────────────────────────────────────────────────────────────────────────

export type Recommendation = {
  key: string;
  kind: "recognize" | "coach" | "check" | "decide";
  title: string;
  detail: string;
  evidence: { assignmentId: string; jobId: string; label: string }[];
  /** What the profile offers to do about it. */
  action: "draft_coaching" | "draft_recognition" | "review_disputes" | "check_contact" | null;
};

/** Suggestions that each rest on the records listed with them. None changes anything by itself. */
export function recommendationsFor(performance: Performance): Recommendation[] {
  const { measures } = performance;
  const out: Recommendation[] = [];
  const ev = (rows: RecordRow[]) => rows.slice(0, 6).map((row) => ({ assignmentId: row.assignmentId, jobId: row.jobId, label: row.label }));
  const openDisputes = Object.values(measures).flatMap((item) => item.records.filter((row) => row.dispute?.status === "open"));
  if (openDisputes.length) out.push({ key: "disputes", kind: "decide", title: `${plural(openDisputes.length, "disputed record")} to decide`, detail: "Each is left out of the measures until a person upholds or corrects it.", evidence: ev(openDisputes), action: "review_disputes" });
  const noShows = measures.reliability.records.filter((row) => row.counts && row.outcome.startsWith("No-show"));
  if (noShows.length) out.push({ key: "no_show", kind: "coach", title: noShows.length === 1 ? "Talk about the no-show" : `Talk about ${noShows.length} no-shows`, detail: "A person declared each one. Hear their side before anything else; a conversation is not a disciplinary step.", evidence: ev(noShows), action: "draft_coaching" });
  const untold = measures.punctuality.records.filter((row) => row.counts && row.tone === "concern");
  if (untold.length >= 2) out.push({ key: "late", kind: "coach", title: "Talk about arriving on time", detail: `${plural(untold.length, "recorded check-in")} after the arrival window without word beforehand.`, evidence: ev(untold), action: "draft_coaching" });
  const silent = measures.responsiveness.records.filter((row) => row.counts && row.tone === "concern");
  if (silent.length >= 3) out.push({ key: "unanswered", kind: "check", title: "Check how offers reach them", detail: `${plural(silent.length, "offer")} closed without an answer. That can be a phone or contact problem before anything else.`, evidence: ev(silent), action: "check_contact" });
  const r = measures.reliability;
  const p = measures.punctuality;
  if (r.enough && r.rate === 1 && r.denominator >= 10 && (!p.enough || (p.rate ?? 0) >= 0.9)) out.push({ key: "recognize", kind: "recognize", title: "Recognise their reliability", detail: `Kept all ${r.denominator} accepted jobs in the last ${PERIOD_DAYS} days.`, evidence: ev(r.records.filter((row) => row.counts)), action: "draft_recognition" });
  return out;
}

// ── Reading the facts ────────────────────────────────────────────────────────────────────────────────

type Ctx = QueryCtx | MutationCtx;

export async function factsFor(ctx: Ctx, company: Doc<"companies">, cleanerId: Id<"cleaners">, now: number): Promise<{ facts: AssignmentFact[]; disputes: DisputeFact[] }> {
  const since = now - PERIOD_DAYS * DAY - 30 * DAY;
  const jobs = new Map<string, Doc<"jobs"> | null>();
  const customers = new Map<string, string | null>();
  const facts: AssignmentFact[] = [];
  for (const status of ASSIGNMENT_STATUSES) {
    const rows = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId).eq("status", status))
      .order("desc")
      .take(400);
    for (const row of rows) {
      if (row.offeredAt < since) continue;
      if (!jobs.has(row.jobId)) jobs.set(row.jobId, await ctx.db.get(row.jobId));
      const job = jobs.get(row.jobId);
      if (!job) continue;
      if (!customers.has(job.customerId)) customers.set(job.customerId, (await ctx.db.get(job.customerId))?.name ?? null);
      facts.push({
        assignmentId: row._id,
        jobId: job._id,
        label: jobLabel(job, customers.get(job.customerId) ?? null, company.timezone),
        status: row.status,
        endCause: row.endCause ?? null,
        offeredAt: row.offeredAt,
        respondBy: row.respondBy,
        respondedAt: row.respondedAt ?? null,
        jobStatus: job.status,
        // An answer about an earlier time is judged against that time.
        startsAt: row.jobStartsAt ?? job.startsAt,
        endsAt: job.endsAt,
        arrivalEndsAt: arrivalEndsAt(job),
        checkInAt: row.checkIn?.at ?? null,
        lateReportedAt: row.late?.reportedAt ?? null,
        completion: row.completion ? { submittedAt: row.completion.submittedAt, incomplete: row.completion.incomplete } : null,
        crewSize: requiredCrew(job),
      });
    }
  }
  const disputeRows = await ctx.db
    .query("recordDisputes")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleanerId))
    .order("desc")
    .take(200);
  return { facts, disputes: disputeRows.map((row) => ({ disputeId: row._id, assignmentId: row.assignmentId, measure: row.measure, status: row.status, reason: row.reason })) };
}

export async function performanceFor(ctx: Ctx, company: Doc<"companies">, cleanerId: Id<"cleaners">, now: number): Promise<Performance> {
  const { facts, disputes } = await factsFor(ctx, company, cleanerId, now);
  return performanceFrom({ now, facts, disputes });
}
