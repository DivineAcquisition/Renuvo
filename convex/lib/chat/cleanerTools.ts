/**
 * Chat's tools for the Cleaners workspace. Each calls the same functions the workspace's screens use (who is
 * free, readiness, crew options for a job, performance, coaching drafts, routine reminders), as the member who
 * is chatting, with their role as it is right now. Nothing here bypasses a rule the screens keep: reminders go
 * through Recruiter's permission (Propose puts them in Approvals), drafts stay drafts until a person publishes
 * them, and the score is explained, never used to rank anyone.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { authorityFor } from "../authority";
import { draftCoaching, DRAFT_KEYS, type DraftKey } from "../cleaners/coaching";
import { crewOptionsForJob } from "../cleaners/crewOptions";
import { whoIsFree } from "../cleaners/free";
import { cleanerOwes, ensureFollowUp, runFollowUp, TOPIC_ACTION } from "../cleaners/followUps";
import { channelsFor } from "../cleaners/outbox";
import { performanceFor, recommendationsFor, PERIOD_DAYS } from "../cleaners/performance";
import { cleanerReadiness, companyCleaners } from "../cleaners/records";
import { cleanersSettings } from "../cleaners/settings";
import { isOwner } from "../roles";
import { clock, dayName } from "../time";
import { type Field, stableHash } from "./fields";
import { localDay, type ChatTool, type Outcome, type ToolCtx } from "./tools";

const ID = (description: string): Field => ({ type: "string", description, max: 64 });
const refused = (why: string, data?: Record<string, unknown>): Outcome => ({ status: "refused", why, data });
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const say = (error: unknown, fallback: string) => (error as { data?: { message?: string } }).data?.message ?? fallback;
const profile = (cleanerId: string, section?: string) => ({ href: `/app/cleaners/${cleanerId}${section ? `/${section}` : ""}`, label: "Open their profile" });

async function cleanerIn(ctx: ToolCtx, value: unknown): Promise<Doc<"cleaners"> | null> {
  const id = typeof value === "string" ? ctx.db.normalizeId("cleaners", value) : null;
  const row = id ? await ctx.db.get(id) : null;
  return row && row.companyId === ctx.company._id ? row : null;
}

/** "13:30" as minutes from midnight, or null. */
function minutes(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute <= 1440 ? minute : null;
}

/** Cleaners who still owe onboarding steps they can do themselves, and can be reached. */
async function reminderCandidates(ctx: ToolCtx, only: Doc<"cleaners"> | null) {
  const now = Date.now();
  const settings = cleanersSettings(ctx.company);
  const people = only ? [only] : (await companyCleaners(ctx, ctx.company._id)).filter((row) => row.status === "onboarding" || row.status === "ready");
  const out: { cleaner: Doc<"cleaners">; owes: string[]; reachable: boolean }[] = [];
  for (const cleaner of people.slice(0, 200)) {
    if (cleaner.status !== "onboarding" && cleaner.status !== "ready") continue;
    const { readiness } = await cleanerReadiness(ctx, ctx.company, cleaner, now);
    const owes = cleanerOwes(readiness.requirements).map((view) => view.label);
    if (owes.length) out.push({ cleaner, owes, reachable: channelsFor(cleaner, settings.followUpChannels).length > 0 });
  }
  return out;
}

export const CLEANER_TOOLS: ChatTool[] = [
  {
    name: "cleaners_free_at",
    label: "Checking who is free",
    description: "Who can work in a window of time on the company's clock (for example Friday afternoon): free by their weekly hours, single dates, time away and work they already hold, and whether each free person is also ready to be offered work. Answers 'Who can work Friday afternoon?'.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { date: { type: "string", max: 10, description: "The day, YYYY-MM-DD." }, from: { type: "string", max: 5, description: "Start, HH:MM (24-hour)." }, to: { type: "string", max: 5, description: "End, HH:MM (24-hour)." } } },
    run: async (ctx, args) => {
      const tz = ctx.company.timezone;
      const day = localDay(args.date as string, tz);
      const start = minutes(args.from);
      const end = minutes(args.to);
      if (start === null || end === null || start >= end) return refused("Give a start and an end as HH:MM, with the start first.");
      const span = { startsAt: day + start * 60_000, endsAt: day + end * 60_000 };
      const answers = await whoIsFree(ctx, ctx.company, span);
      const ready = answers.filter((row) => row.available && row.ready);
      const notReady = answers.filter((row) => row.available && !row.ready);
      const busy = answers.filter((row) => !row.available && row.reason !== "is not active");
      const window = `${dayName(span.startsAt, tz)} ${clock(span.startsAt, tz)}–${clock(span.endsAt, tz)}`;
      return {
        status: "done",
        summary: `${plural(ready.length, "cleaner")} free and ready ${window}${notReady.length ? `; ${notReady.length} more free but not ready` : ""}`,
        link: { href: "/app/cleaners", label: "Open Cleaners" },
        data: {
          window,
          freeAndReady: ready.map((row) => ({ cleanerId: row.cleanerId, name: row.name })),
          freeButNotReady: notReady.map((row) => ({ cleanerId: row.cleanerId, name: row.name, stillNeeded: row.notReady })),
          notFree: busy.map((row) => ({ name: row.name, why: row.reason })),
          note: "Free means their records allow this time. A job's area, skills and travel are checked when Dispatch offers it.",
        },
      };
    },
  },
  {
    name: "cleaner_readiness_blockers",
    label: "Checking what is holding people up",
    description: "What stops cleaners from becoming ready for work: each one's unmet requirements, which they do themselves and which the office records, what is waiting for review, and any reminder already scheduled. One cleaner by id, or everyone who is onboarding or blocked. Answers 'What is stopping these cleaners from becoming ready?'.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { cleanerId: { ...ID("One cleaner's id. Leave out for everyone not ready."), optional: true } } },
    run: async (ctx, args) => {
      const only = args.cleanerId ? await cleanerIn(ctx, args.cleanerId) : null;
      if (args.cleanerId && !only) return refused("No such cleaner in this company.");
      const now = Date.now();
      const people = only ? [only] : (await companyCleaners(ctx, ctx.company._id)).filter((row) => row.status === "onboarding" || row.status === "ready");
      const rows = [];
      for (const cleaner of people.slice(0, 150)) {
        const { readiness } = await cleanerReadiness(ctx, ctx.company, cleaner, now);
        if (!only && readiness.eligible) continue;
        const followUp = await ctx.db
          .query("followUps")
          .withIndex("by_company_key", (q) => q.eq("companyId", ctx.company._id).eq("key", `cleaner.onboarding:${cleaner._id}`))
          .order("desc")
          .first();
        rows.push({
          cleanerId: cleaner._id,
          name: cleaner.name,
          engagement: cleaner.status === "ready" ? "active" : cleaner.status,
          summary: readiness.summary,
          notMet: readiness.blockers.map((view) => ({ requirement: view.label, state: view.state.replace(/_/g, " "), whoDoesIt: view.fromRecord ? "read from their record" : view.cleanerCompletes ? "they do it in their portal" : "the office records it", reviewer: view.reviewer })),
          waitingForReview: readiness.requirements.filter((view) => view.state === "awaiting_review").map((view) => view.label),
          reminder: followUp && (followUp.status === "scheduled" || followUp.status === "sent" || followUp.status === "awaiting_approval") ? `Recruiter's reminder is ${followUp.status.replace(/_/g, " ")}` : null,
        });
      }
      return { status: "done", summary: only ? `${only.name}: ${rows[0]?.summary ?? "ready"}` : `${plural(rows.length, "person", "people")} not yet ready for work`, link: only ? profile(only._id, "onboarding") : { href: "/app/cleaners?ready=no", label: "Open Cleaners" }, data: { people: rows } };
    },
  },
  {
    name: "prepare_onboarding_reminders",
    label: "Recruiter is preparing reminders",
    description: "Prepare Recruiter's reminders for incomplete onboarding: one per person who still owes steps they can do from their portal, under Recruiter's current permission (on Propose each waits in Approvals). Never two for the same person. The person approves the exact list in chat first. Owners and Managers.",
    kind: "write",
    minimumRole: "manager",
    specialist: "recruiter",
    confirm: true,
    input: { type: "object", properties: { cleanerId: { ...ID("One cleaner's id. Leave out for everyone who owes steps."), optional: true } } },
    preview: async (ctx, args) => {
      const only = args.cleanerId ? await cleanerIn(ctx, args.cleanerId) : null;
      if (args.cleanerId && !only) return refused("No such cleaner in this company.");
      const authority = await authorityFor(ctx, ctx.company._id, TOPIC_ACTION.onboarding);
      if (authority.kind !== "level" || authority.level === "off") return refused(`Recruiter is not allowed to send onboarding reminders right now (${authority.kind === "paused" ? "Recruiter is paused" : "the permission is off"}).`);
      const candidates = await reminderCandidates(ctx, only);
      if (candidates.length === 0) return refused("Nobody owes onboarding steps they can do themselves right now.");
      const effect = authority.level === "propose" ? "Each reminder waits in Approvals. Nothing is sent until an Owner or Manager approves it there." : `Recruiter sends each reminder when it is due (its permission is ${authority.level.replace(/_/g, " ")}), one message per person per reminder window, checked again as it goes.`;
      return {
        status: "needs_approval",
        preview: {
          summary: `Prepare onboarding reminders for ${plural(candidates.filter((row) => row.reachable).length, "person", "people")}`,
          lines: [effect, ...candidates.map((row) => `${row.cleaner.name}: ${row.owes.join(", ").toLowerCase()}${row.reachable ? "" : " (no phone or email on file, so nothing can be sent)"}`)],
          bindsTo: stableHash({ level: authority.level, people: candidates.map((row) => [row.cleaner._id, row.owes, row.reachable]) }),
        },
      };
    },
    run: async (ctx, args) => {
      const only = args.cleanerId ? await cleanerIn(ctx, args.cleanerId) : null;
      if (args.cleanerId && !only) return refused("No such cleaner in this company.");
      const now = Date.now();
      const results = [];
      for (const row of await reminderCandidates(ctx, only)) {
        if (!row.reachable) {
          results.push({ name: row.cleaner.name, outcome: "Nothing can be sent: no phone or email on file." });
          continue;
        }
        const followUp = await ensureFollowUp(ctx, ctx.company, row.cleaner, "onboarding", now);
        if (!followUp) {
          results.push({ name: row.cleaner.name, outcome: "No reminder: one already ran to the company's limit, or nothing is owed now." });
          continue;
        }
        if (followUp.status === "scheduled" && followUp.dueAt <= now) await runFollowUp(ctx, followUp._id);
        const fresh = (await ctx.db.get(followUp._id))!;
        const tz = ctx.company.timezone;
        results.push({
          name: row.cleaner.name,
          outcome: fresh.status === "awaiting_approval" ? "Waiting for approval in Approvals." : fresh.status === "sent" ? "Sent." : fresh.status === "scheduled" ? `Scheduled for ${dayName(fresh.dueAt, tz)} ${clock(fresh.dueAt, tz)}, if still needed then.` : (fresh.stopReason ?? fresh.status.replace(/_/g, " ")),
        });
      }
      return { status: "done", summary: `Recruiter prepared ${plural(results.length, "reminder")}`, link: { href: "/app/approvals", label: "Open Approvals" }, data: { reminders: results } };
    },
  },
  {
    name: "suggest_crew_for_job",
    label: "Dispatch is checking who can take the job",
    description: "For one visit: who can take it, each checked with Dispatch's rules for that visit (requirements, skills, hours, dates, time away, other work); how each permanent crew fares member by member; the places still open; and a suggestion. Suggests only: offers are made from the crew builder or Dispatch. Answers 'Suggest a crew for this commercial job'.",
    kind: "read",
    minimumRole: "office",
    specialist: "dispatch",
    input: { type: "object", properties: { jobId: ID("The visit's id (jobs).") } },
    run: async (ctx, args) => {
      const id = typeof args.jobId === "string" ? ctx.db.normalizeId("jobs", args.jobId) : null;
      const job = id ? await ctx.db.get(id) : null;
      if (!job || job.companyId !== ctx.company._id) return refused("No such visit in this company.");
      const view = await crewOptionsForJob({ ...ctx, companyId: ctx.company._id }, job);
      return {
        status: "done",
        summary: view.suggestion.words,
        record: { kind: "job", id: job._id },
        link: { href: `/app/cleaners/crews?job=${job._id}`, label: "Open the crew builder" },
        data: {
          visit: view.job.label,
          staffing: view.staffing,
          suggestion: view.suggestion,
          crews: view.crews.map((crew) => ({ name: crew.name, canTakeIt: `${crew.eligible} of ${crew.members.length}`, members: crew.members.map((member) => ({ name: member.name, lead: member.role === "lead", canTakeIt: member.eligible, why: member.reason })) })),
          canTakeIt: view.people.filter((person) => person.eligible && !person.onJob).map((person) => ({ cleanerId: person.cleanerId, name: person.name, priorVisitsForCustomer: person.priorVisits, pay: isOwner(ctx.role) ? person.pay : undefined })),
          cannot: view.people.filter((person) => !person.eligible).slice(0, 20).map((person) => ({ name: person.name, why: person.reason })),
        },
      };
    },
  },
  {
    name: "explain_cleaner_score",
    label: "Reading their performance",
    description: `One cleaner's performance from verified records over the last ${PERIOD_DAYS} days: each measure with its definition, sample and breakdown, the versioned score with each part's points (or "not enough history"), records under dispute, and suggestions that rest on records. The score is never used to rank people. Owners and Managers. Answers 'Explain this cleaner's score'.`,
    kind: "read",
    minimumRole: "manager",
    input: { type: "object", properties: { cleanerId: ID("The cleaner's id.") } },
    run: async (ctx, args) => {
      const cleaner = await cleanerIn(ctx, args.cleanerId);
      if (!cleaner) return refused("No such cleaner in this company.");
      const performance = await performanceFor(ctx, ctx.company, cleaner._id, Date.now());
      const { score } = performance;
      return {
        status: "done",
        summary: score.state === "scored" ? `${cleaner.name}: ${score.words}` : `${cleaner.name}: ${score.words}`,
        link: profile(cleaner._id, "performance"),
        data: {
          version: score.version,
          score: score.state === "scored" ? { value: score.value, parts: score.lines.map((line) => line.words) } : { value: null, why: score.words },
          measures: Object.values(performance.measures).map((item) => ({ measure: item.label, definition: item.definition, result: item.words, breakdown: item.breakdown.map((row) => `${row.label}: ${row.count}`), underDispute: item.disputed })),
          suggestions: recommendationsFor(performance).map((row) => ({ title: row.title, detail: row.detail, records: row.evidence.map((item) => item.label) })),
          note: "Only verified records count. A missing check-in is not counted as late, silence is told apart from declining, and work on crew jobs is not put on one person.",
        },
      };
    },
  },
  {
    name: "draft_coaching_follow_up",
    label: "Drafting a coaching note",
    description: "Draft a coaching or feedback note for one cleaner from their records (arriving on time, a recorded no-show, offers going unanswered, or thanks). It is saved as a draft on their profile, seen by nobody else until an Owner or Manager publishes it. Answers 'Draft a coaching follow-up'.",
    kind: "draft",
    minimumRole: "manager",
    input: { type: "object", properties: { cleanerId: ID("The cleaner's id."), topic: { type: "string", enum: DRAFT_KEYS, optional: true, description: "late, no_show, unanswered or recognize. Leave out to draft what their records call for." } } },
    run: async (ctx, args) => {
      const cleaner = await cleanerIn(ctx, args.cleanerId);
      if (!cleaner) return refused("No such cleaner in this company.");
      try {
        const answer = await draftCoaching(ctx, ctx.company, cleaner, (args.topic as DraftKey | undefined) ?? null, { kind: "member", memberId: ctx.member._id });
        return {
          status: "done",
          summary: answer.already ? `A draft "${answer.title}" for ${cleaner.name} was already waiting for review` : `Drafted "${answer.title}" for ${cleaner.name}. Nothing is shared until a person publishes it.`,
          link: profile(cleaner._id, "performance"),
          data: { noteId: answer.noteId as Id<"coachingNotes">, already: answer.already },
        };
      } catch (error) {
        return refused(say(error, "Nothing to draft."));
      }
    },
  },
];
