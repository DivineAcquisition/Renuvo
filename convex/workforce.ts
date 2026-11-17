/**
 * The Cleaners workspace (docs/cleaners/00-architecture.md): the overview, the directory, one worker's
 * profile, and adding or importing workers with a duplicate review. Every read is the company's own;
 * pay and personnel notes are removed here, in Convex, for anyone whose role may not see them.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { authorityFor } from "./lib/authority";
import { REMINDER_ACTION, reminderDays, reminderKey, reminderPlan, reminderSweep, sendOnboardingReminder } from "./lib/workforce/reminders";
import { owned } from "./lib/access";
import { availabilityFor, overlaps, type Span, type WeeklyWindow } from "./lib/availability";
import { companyMutation, companyQuery, managerMutation, managerQuery, ownerMutation, ownerQuery } from "./lib/builders";
import { siteOrigin } from "./lib/dispatch/links";
import { queueMessage } from "./lib/messaging/outbox";
import { issuePortalLink, linksOf, portalConfigured, portalLinkState, portalPath, portalToken, revokePortal, sessionState } from "./lib/workforce/portal";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { describeEvents } from "./lib/eventWords";
import { eventsAbout } from "./lib/workforce/activity";
import { money } from "./lib/dispatch/pay";
import { CLEANER_STATUSES, cleanerStatusValidator } from "./lib/statuses";
import { instant, optionalText } from "./lib/text";
import { clock, dayName, when } from "./lib/time";
import { maySeePay, maySeePersonnelNotes } from "./lib/workforce/access";
import { findMatches, MATCH_WORDS, nameKey, phoneKey, emailKey } from "./lib/workforce/duplicates";
import { ENGAGEMENT_WORDS, initialsOf, loadWorkforce, STATUS_WORDS, windowWords, MAX_WORKERS } from "./lib/workforce/facts";
import { COUNT_DEFINITIONS } from "./lib/workforce/readiness";
import { areas, changeStatus, checkAffiliation, insertWorker, parseEngagement, phone as checkedPhone, setAffiliation, skills as checkedSkills, type Engagement } from "./lib/workforce/records";
import { engagementValidator } from "./schema";

const windowValidator = v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() });

// ── The overview and the directory ───────────────────────────────────────────────────────────────

/**
 * Everything the workspace's first screen needs, read once: the four counts with what each means, the
 * attention list, and every worker's directory row. `asOf` is the browser's current minute.
 */
export const workspace = companyQuery({
  args: { asOf: v.number(), includeEnded: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const asOf = instant(args.asOf, "The time");
    const force = await loadWorkforce(ctx, ctx.company, { asOf, includeEnded: args.includeEnded ?? false });
    const subcontractors = await ctx.db
      .query("subcontractors")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(500);
    const crews = await ctx.db
      .query("crews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(500);
    const members = new Map<string, number>();
    for (const row of force.rows) for (const crew of row.crews) members.set(crew.id, (members.get(crew.id) ?? 0) + 1);
    return {
      asOf,
      timezone: ctx.company.timezone,
      counts: force.counts,
      definitions: COUNT_DEFINITIONS,
      attention: force.attention.slice(0, 60),
      attentionTotal: force.attention.length,
      rows: force.rows,
      truncated: force.truncated,
      subcontractors: subcontractors.map((row) => ({ id: row._id, name: row.name, status: row.status, workers: force.rows.filter((worker) => worker.subcontractor?.id === row._id).length })),
      crews: crews.map((row) => ({ id: row._id, name: row.name, members: members.get(row._id) ?? 0 })),
    };
  },
});

/**
 * Who can work in one time window, for the directory's availability filter. A window is required: the
 * answer is about that time only. "Not working today" never means free, and being free never means a
 * job fits: skills and areas are still checked per job.
 */
export const availableFor = companyQuery({
  args: { startsAt: v.number(), endsAt: v.number() },
  handler: async (ctx, args) => {
    const span: Span = { startsAt: instant(args.startsAt, "The start"), endsAt: instant(args.endsAt, "The end") };
    if (span.startsAt >= span.endsAt) throw userError("The window must start before it ends.");
    if (span.endsAt - span.startsAt > 24 * 60 * 60 * 1000) throw userError("Choose a window within one day.");
    const companyId = ctx.companyId;
    const windows = new Map<string, WeeklyWindow[]>();
    for (const row of await ctx.db.query("availabilityWindows").withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId)).take(8000)) {
      const list = windows.get(row.cleanerId) ?? [];
      list.push(row);
      windows.set(row.cleanerId, list);
    }
    // Work that overlaps the window: jobs that start up to a day before it and before it ends.
    const booked = new Map<string, Span[]>();
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_start", (q) => q.eq("companyId", companyId).gte("startsAt", span.startsAt - 24 * 60 * 60 * 1000).lt("startsAt", span.endsAt))
      .take(1000);
    for (const job of jobs) {
      if (job.status === "cancelled" || job.status === "completed" || !overlaps(job, span)) continue;
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id))
        .take(50);
      for (const row of assignments) {
        if (row.status !== "offered" && row.status !== "accepted") continue;
        const list = booked.get(row.cleanerId) ?? [];
        list.push({ startsAt: job.startsAt, endsAt: job.endsAt });
        booked.set(row.cleanerId, list);
      }
    }
    const answers: Record<string, { available: boolean; reason: string }> = {};
    for (const status of ["ready", "onboarding", "paused"] as const) {
      const workers = await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
        .take(MAX_WORKERS);
      for (const worker of workers) {
        if (status !== "ready") {
          answers[worker._id] = { available: false, reason: status === "onboarding" ? "Still onboarding" : "Paused" };
          continue;
        }
        const own = windows.get(worker._id) ?? [];
        if (own.length === 0) {
          answers[worker._id] = { available: false, reason: "No hours on record" };
          continue;
        }
        const timeOff = await ctx.db
          .query("timeOff")
          .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", companyId).eq("cleanerId", worker._id).gt("endsAt", span.startsAt))
          .take(50);
        const answer = availabilityFor({ windows: own, timeOff, booked: booked.get(worker._id) ?? [], span, timezone: ctx.company.timezone });
        answers[worker._id] = answer.available
          ? { available: true, reason: "Said they can work then, with nothing booked" }
          : { available: false, reason: answer.reason === "outside_hours" ? "Outside the hours they gave" : answer.reason === "time_off" ? "Time off" : "Already has work then" };
      }
    }
    const tz = ctx.company.timezone;
    return { answers, words: `${dayName(span.startsAt, tz)}, ${clock(span.startsAt, tz)} – ${clock(span.endsAt, tz)}` };
  },
});

// ── One worker's profile ─────────────────────────────────────────────────────────────────────────

/** The profile header and overview. Pay is never here; personnel notes only for managers and the Owner. */
export const profile = companyQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const asOf = instant(args.asOf, "The time");
    const force = await loadWorkforce(ctx, ctx.company, { asOf, includeEnded: true, only: worker });
    const row = force.rows[0];
    const tz = ctx.company.timezone;
    const windows = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id))
      .take(60);
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id).gt("endsAt", asOf))
      .take(50);
    const affiliations = await ctx.db
      .query("workerAffiliations")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id))
      .take(50);
    const history = [];
    // The current one first, then newest first.
    for (const row of affiliations.sort((a, b) => Number(a.endedAt !== undefined) - Number(b.endedAt !== undefined) || b.startedAt - a.startedAt || b._creationTime - a._creationTime)) {
      const sub = await ctx.db.get(row.subcontractorId);
      history.push({ subcontractor: sub?.name ?? "A subcontractor", from: dayName(row.startedAt, tz), until: row.endedAt ? dayName(row.endedAt, tz) : null });
    }
    const handoffs = await ctx.db
      .query("onboardingHandoffs")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(1000);
    const handoff = handoffs.find((item) => item.cleanerId === worker._id) ?? null;
    let hire: null | { handoffId: Id<"onboardingHandoffs">; applicationId: Id<"applications">; role: string; handoffStatus: Doc<"onboardingHandoffs">["status"]; requirements: { key: string; label: string; done: boolean; at: string | null; note: string | null }[]; dueAt: number; dueWords: string; nextAction: string } = null;
    if (handoff) {
      hire = {
        handoffId: handoff._id,
        applicationId: handoff.applicationId,
        role: handoff.terms.role,
        handoffStatus: handoff.status,
        // The terms carry pay, so only the requirements and the role are given here.
        requirements: handoff.requirements.map((item) => ({ key: item.key, label: item.label, done: item.status === "done", at: item.at ? dayName(item.at, tz) : null, note: maySeePersonnelNotes(ctx.role) ? (item.note ?? null) : null })),
        dueAt: handoff.dueAt,
        dueWords: dayName(handoff.dueAt, tz),
        nextAction: handoff.nextAction,
      };
    }
    const changedBy = worker.statusChangedBy ? await ctx.db.get(worker.statusChangedBy) : null;
    return {
      ...row,
      asOf,
      timezone: tz,
      createdWords: dayName(worker.createdAt, tz),
      applicationId: worker.applicationId ?? handoff?.applicationId ?? null,
      hire,
      affiliationHistory: history,
      windows: windows.map((window) => ({ weekday: window.weekday, startMinute: window.startMinute, endMinute: window.endMinute, words: windowWords(window) })).sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
      timeOff: timeOff.map((item) => ({ id: item._id, startsAt: item.startsAt, endsAt: item.endsAt, words: `${dayName(item.startsAt, tz)} ${clock(item.startsAt, tz)} – ${dayName(item.endsAt, tz)} ${clock(item.endsAt, tz)}`, note: item.note ?? null })),
      attentionItems: force.attention,
      /** Why the status was last changed. A personnel note: managers and the Owner only. */
      statusChange: worker.statusChangedAt
        ? { at: dayName(worker.statusChangedAt, tz), by: changedBy?.name ?? null, note: maySeePersonnelNotes(ctx.role) ? (worker.statusNote ?? null) : null, noteHidden: !maySeePersonnelNotes(ctx.role) && Boolean(worker.statusNote) }
        : null,
      viewer: { role: ctx.role, seesPay: maySeePay(ctx.role), seesNotes: maySeePersonnelNotes(ctx.role) },
    };
  },
});

const ASSIGNMENT_WORDS: Record<Doc<"assignments">["status"], string> = { offered: "Offer out", accepted: "Accepted", declined: "Declined", expired: "No answer in time", cancelled: "Ended" };
const END_WORDS: Record<string, string> = {
  released: "Released by the office",
  job_covered: "Another cleaner took it",
  job_cancelled: "The visit was cancelled",
  job_moved: "The visit was moved",
  dropped: "They said they could not attend",
  no_show: "Confirmed no-show",
  undelivered: "The offer text was not delivered",
};

/** Upcoming work and recent history. Each row opens its visit. Pay is in the Pay section, for the Owner. */
export const jobs = companyQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const asOf = instant(args.asOf, "The time");
    const tz = ctx.company.timezone;
    const rows = [];
    for (const status of ["offered", "accepted", "declined", "expired", "cancelled"] as const) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id).eq("status", status))
        .order("desc")
        .take(60);
      for (const assignment of assignments) {
        const job = await ctx.db.get(assignment.jobId);
        if (!job || job.companyId !== ctx.companyId) continue;
        const customer = await ctx.db.get(job.customerId);
        rows.push({
          assignmentId: assignment._id,
          jobId: job._id,
          startsAt: job.startsAt,
          when: `${when(job.startsAt, asOf, tz)} – ${clock(job.endsAt, tz)}`,
          service: job.serviceType,
          customer: customer?.name ?? "A customer",
          status: assignment.status,
          statusWords: assignment.status === "cancelled" && assignment.endCause ? (END_WORDS[assignment.endCause] ?? "Ended") : ASSIGNMENT_WORDS[assignment.status],
          jobStatus: job.status,
          role: assignment.role ?? null,
          checkedIn: assignment.checkIn ? clock(assignment.checkIn.at, tz) : null,
          completed: job.status === "completed",
        });
      }
    }
    const upcoming = rows.filter((row) => (row.status === "accepted" || row.status === "offered") && row.jobStatus !== "completed" && row.jobStatus !== "cancelled" && row.startsAt + 6 * 60 * 60 * 1000 > asOf).sort((a, b) => a.startsAt - b.startsAt);
    const upcomingIds = new Set(upcoming.map((row) => row.assignmentId));
    const past = rows.filter((row) => !upcomingIds.has(row.assignmentId)).sort((a, b) => b.startsAt - a.startsAt).slice(0, 40);
    return { upcoming, past };
  },
});

/** What happened to and around this worker, in words built from the event log. */
export const activity = companyQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const events = await eventsAbout(ctx, ctx.companyId, worker);
    return describeEvents(ctx, ctx.company, events.slice(0, 120), instant(args.asOf, "The time"));
  },
});

/**
 * The Pay section, for the Owner only. It reads the pay arrangement on the worker and the pay each offer
 * stated, kept on the assignment as offered, so a later change of rate never rewrites an earlier job.
 * Approved earnings, adjustments and payments belong to Finance, which is not built: they are not shown,
 * and never as zero.
 */
export const pay = ownerQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const asOf = instant(args.asOf, "The time");
    const tz = ctx.company.timezone;
    const changes = (
      await ctx.db
        .query("events")
        .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", worker._id))
        .take(500)
    ).filter((event) => event.type === "cleaner.pay_changed");
    const jobsPaid = [];
    for (const status of ["accepted", "offered"] as const) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id).eq("status", status))
        .order("desc")
        .take(50);
      for (const assignment of assignments) {
        const job = await ctx.db.get(assignment.jobId);
        if (!job || job.companyId !== ctx.companyId || job.status === "cancelled") continue;
        jobsPaid.push({ jobId: job._id, startsAt: job.startsAt, when: when(job.startsAt, asOf, tz), service: job.serviceType, pay: money(assignment.payCents), status: assignment.status === "offered" ? "Offer out" : job.status === "completed" ? "Visit closed" : "Accepted", offeredOn: dayName(assignment.offeredAt, tz) });
      }
    }
    const arrangement = worker.pay
      ? worker.pay.kind === "share"
        ? { kind: "share" as const, words: `${worker.pay.shareBps / 100}% of each job's price`, shareBps: worker.pay.shareBps, hourlyCents: null }
        : { kind: "hourly" as const, words: `${money(worker.pay.hourlyCents)} an hour`, shareBps: null, hourlyCents: worker.pay.hourlyCents }
      : null;
    return {
      engagement: worker.engagement,
      arrangement,
      lastChanged: changes.length > 0 ? dayName(changes[changes.length - 1].at, tz) : null,
      changes: changes.map((event) => dayName(event.at, tz)).reverse(),
      jobs: jobsPaid.sort((a, b) => b.startsAt - a.startsAt).slice(0, 60),
      finance: { built: false as const, words: "Approved earnings, adjustments and payments are kept by Finance, which is not built yet. Nothing here is a payment record." },
    };
  },
});

// ── Adding a worker ──────────────────────────────────────────────────────────────────────────────

async function everyone(ctx: { db: QueryCtx["db"]; companyId: Id<"companies"> }) {
  const all: Doc<"cleaners">[] = [];
  for (const status of CLEANER_STATUSES) {
    all.push(
      ...(await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .take(MAX_WORKERS)),
    );
  }
  return all;
}

const matchRow = (worker: Doc<"cleaners">, reasons: string[]) => ({
  cleanerId: worker._id,
  name: worker.name,
  initials: initialsOf(worker.name),
  status: STATUS_WORDS[worker.status],
  engagement: ENGAGEMENT_WORDS[worker.engagement],
  reasons: reasons.map((reason) => MATCH_WORDS[reason as keyof typeof MATCH_WORDS]),
});

/**
 * Adds one worker. If they may already be on record (same phone, email or name), nothing is added and
 * the possible matches come back for a person to look at. Adding anyway needs each match acknowledged.
 * The same add sent twice (same `addKey`) returns the first record.
 */
export const add = managerMutation({
  args: {
    addKey: v.string(),
    name: v.string(),
    preferredName: v.optional(v.string()),
    engagement: engagementValidator,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    serviceAreas: v.optional(v.array(v.string())),
    subcontractorId: v.optional(v.id("subcontractors")),
    windows: v.optional(v.array(windowValidator)),
    acknowledged: v.optional(v.array(v.id("cleaners"))),
  },
  handler: async (ctx, args) => {
    const addKey = args.addKey.trim();
    if (addKey.length < 8 || addKey.length > 80) throw userError("This form has expired. Open it again.");
    const repeat = await ctx.db
      .query("cleaners")
      .withIndex("by_company_addKey", (q) => q.eq("companyId", ctx.companyId).eq("addKey", addKey))
      .first();
    if (repeat) return { status: "created" as const, cleanerId: repeat._id };
    checkAffiliation(args.engagement, args.subcontractorId);
    const existing = await everyone(ctx);
    const matches = findMatches({ name: args.name, email: args.email, phone: args.phone }, existing.map((row) => ({ id: row._id, name: row.name, email: row.email, phone: row.phone })));
    const acknowledged = new Set<string>(args.acknowledged ?? []);
    const open = matches.filter((match) => !acknowledged.has(match.id));
    if (open.length > 0) {
      const byId = new Map(existing.map((row) => [row._id as string, row]));
      return { status: "possible_duplicates" as const, matches: matches.map((match) => matchRow(byId.get(match.id)!, match.reasons)) };
    }
    const cleanerId = await insertWorker(ctx, ctx.companyId, { ...args, addKey, source: "manual" }, ctx.member);
    return { status: "created" as const, cleanerId };
  },
});

/** Edits the details a manager keeps. Relationship type and pay have their own, Owner-only functions. */
export const update = managerMutation({
  args: {
    cleanerId: v.id("cleaners"),
    name: v.optional(v.string()),
    preferredName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    serviceAreas: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const name = args.name !== undefined ? optionalText(args.name, "Name", 160) : undefined;
    if (args.name !== undefined && !name) throw userError("Name is required.");
    const email = args.email !== undefined ? (args.email.trim() ? args.email.trim().toLowerCase() : undefined) : worker.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw userError("Email is not a valid email address.");
    await ctx.db.patch(worker._id, {
      ...(name !== undefined ? { name } : {}),
      ...(args.preferredName !== undefined ? { preferredName: optionalText(args.preferredName, "Preferred name", 80) } : {}),
      ...(args.email !== undefined ? { email } : {}),
      ...(args.phone !== undefined ? { phone: checkedPhone(args.phone) } : {}),
      ...(args.skills !== undefined ? { skills: checkedSkills(args.skills) } : {}),
      ...(args.serviceAreas !== undefined ? { serviceAreas: areas(args.serviceAreas) } : {}),
    });
    const fields = ["name", "preferredName", "email", "phone", "skills", "serviceAreas"].filter((key) => args[key as keyof typeof args] !== undefined);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.updated", actor: byMember(ctx), subject: { table: "cleaners", id: worker._id }, data: { fields: fields.join(",") } });
    return null;
  },
});

/** What changing a worker's status would touch: the visits they hold. Shown before a person confirms. */
export const statusImpact = managerQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const asOf = instant(args.asOf, "The time");
    const tz = ctx.company.timezone;
    const held = [];
    for (const status of ["accepted", "offered"] as const) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id).eq("status", status))
        .take(200);
      for (const assignment of assignments) {
        const job = await ctx.db.get(assignment.jobId);
        if (!job || job.companyId !== ctx.companyId || job.endsAt < asOf || job.status === "cancelled" || job.status === "completed") continue;
        held.push({ jobId: job._id, status, when: `${when(job.startsAt, asOf, tz)} – ${clock(job.endsAt, tz)}`, service: job.serviceType, startsAt: job.startsAt });
      }
    }
    return { held: held.sort((a, b) => a.startsAt - b.startsAt) };
  },
});

/**
 * A person changes a worker's engagement status. Pausing or ending needs a reason. Visits they already
 * accepted are not touched: the workspace lists them, and a person decides each one.
 */
export const setStatus = managerMutation({
  args: { cleanerId: v.id("cleaners"), status: cleanerStatusValidator, reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    await changeStatus(ctx, worker, args.status, args.reason, ctx.member);
    return null;
  },
});

/** Classification is the Owner's: whether someone is an employee, a contractor or supplied by a subcontractor. */
export const setEngagement = ownerMutation({
  args: { cleanerId: v.id("cleaners"), engagement: engagementValidator, subcontractorId: v.optional(v.id("subcontractors")) },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    checkAffiliation(args.engagement, args.subcontractorId);
    const pay = worker.pay;
    if (pay && ((pay.kind === "share" && args.engagement === "employee") || (pay.kind === "hourly" && args.engagement === "contractor"))) {
      throw userError(pay.kind === "share" ? "Their pay is a share of the job, which is for contractors. Change their pay first." : "Their pay is hourly, which is for employees. Change their pay first.");
    }
    if (worker.engagement !== args.engagement) {
      await ctx.db.patch(worker._id, { engagement: args.engagement });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.engagement_changed", actor: byMember(ctx), subject: { table: "cleaners", id: worker._id }, data: { from: worker.engagement, to: args.engagement } });
    }
    await setAffiliation(ctx, (await ctx.db.get(worker._id))!, args.subcontractorId ?? null, ctx.member);
    return null;
  },
});

// ── Importing workers ────────────────────────────────────────────────────────────────────────────

const importRowValidator = v.object({
  name: v.string(),
  preferredName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  workerType: v.optional(v.string()),
  skills: v.optional(v.string()),
  serviceAreas: v.optional(v.string()),
  subcontractor: v.optional(v.string()),
});
type ImportRow = typeof importRowValidator.type;

const split = (value: string | undefined) => (value ?? "").split(/[,;|]/).map((part) => part.trim()).filter(Boolean);

type Checked = {
  index: number;
  name: string;
  engagement: Engagement | null;
  engagementWords: string | null;
  subcontractorId: Id<"subcontractors"> | null;
  subcontractorName: string | null;
  email: string | null;
  phone: string | null;
  skills: string[];
  serviceAreas: string[];
  problems: string[];
  /** Workers already on record this row may be. */
  matches: ReturnType<typeof matchRow>[];
  /** Earlier rows in the same file this row may be. */
  sameAsRows: number[];
};

async function checkRows(ctx: { db: QueryCtx["db"]; companyId: Id<"companies"> }, rows: ImportRow[], defaultEngagement: Engagement | undefined): Promise<Checked[]> {
  if (rows.length > 500) throw userError("Import up to 500 people at a time.");
  const existing = await everyone(ctx);
  const subcontractors = await ctx.db
    .query("subcontractors")
    .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
    .take(500);
  const byId = new Map(existing.map((row) => [row._id as string, row]));
  const out: Checked[] = [];
  rows.forEach((row, index) => {
    const problems: string[] = [];
    const name = row.name.trim().slice(0, 160);
    if (!name) problems.push("No name.");
    const typed = parseEngagement(row.workerType);
    const engagement = typed ?? (row.workerType?.trim() ? null : (defaultEngagement ?? null));
    if (!engagement) problems.push(row.workerType?.trim() ? `"${row.workerType.trim().slice(0, 40)}" is not a worker type Selestial can read. Use employee, contractor or subcontractor.` : "No worker type. Choose one for rows that leave it blank.");
    const email = emailKey(row.email);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) problems.push("The email is not a valid address.");
    const rawPhone = row.phone?.trim() || null;
    if (rawPhone && !phoneKey(rawPhone)) problems.push("The phone number needs 10 to 15 digits.");
    let subcontractorId: Id<"subcontractors"> | null = null;
    let subcontractorName: string | null = null;
    if (row.subcontractor?.trim()) {
      const found = subcontractors.find((sub) => nameKey(sub.name) === nameKey(row.subcontractor!));
      if (!found) problems.push(`No subcontractor company named "${row.subcontractor.trim().slice(0, 80)}". Add it first.`);
      else if (found.status !== "active") problems.push(`${found.name} is ${found.status}, so no worker can be added through them.`);
      else {
        subcontractorId = found._id;
        subcontractorName = found.name;
      }
    }
    if (engagement === "subcontracted" && !row.subcontractor?.trim()) problems.push("A subcontractor worker needs the company that supplies them.");
    if (engagement && engagement !== "subcontracted" && row.subcontractor?.trim()) problems.push("Only a subcontractor worker is supplied by a subcontractor company.");
    const skillList = split(row.skills).map((value) => value.toLowerCase());
    const areaList = split(row.serviceAreas).map((value) => value.toUpperCase());
    if (skillList.length > 30 || skillList.some((value) => value.length > 60)) problems.push("Too many or too long skills.");
    if (areaList.length > 200 || areaList.some((value) => value.length > 60)) problems.push("Too many or too long service areas.");
    const identity = { name, email, phone: rawPhone };
    const matches = name ? findMatches(identity, existing.map((worker) => ({ id: worker._id, name: worker.name, email: worker.email, phone: worker.phone }))).map((match) => matchRow(byId.get(match.id)!, match.reasons)) : [];
    const sameAsRows = name ? findMatches(identity, out.map((earlier) => ({ id: String(earlier.index), name: earlier.name, email: earlier.email, phone: earlier.phone }))).map((match) => Number(match.id)) : [];
    out.push({ index, name, engagement, engagementWords: engagement ? ENGAGEMENT_WORDS[engagement] : null, subcontractorId, subcontractorName, email, phone: rawPhone, skills: [...new Set(skillList)], serviceAreas: [...new Set(areaList)], problems, matches, sameAsRows });
  });
  return out;
}

/** Checks a list before anything is added: each row's problems, and who each row may already be. Changes nothing. */
export const previewImport = managerQuery({
  args: { rows: v.array(importRowValidator), defaultEngagement: v.optional(engagementValidator) },
  handler: async (ctx, args) => {
    const checked = await checkRows(ctx, args.rows, args.defaultEngagement);
    return {
      rows: checked,
      ready: checked.filter((row) => row.problems.length === 0 && row.matches.length === 0 && row.sameAsRows.length === 0).length,
      toReview: checked.filter((row) => row.problems.length === 0 && (row.matches.length > 0 || row.sameAsRows.length > 0)).length,
      withProblems: checked.filter((row) => row.problems.length > 0).length,
    };
  },
});

/**
 * Adds the rows a person chose. Every row is checked again here. A row with a problem cannot be added; a
 * row that may be someone already on record (or another row in the file) is added only if the person
 * said it is a different person. The same import sent twice adds nobody the second time.
 */
export const commitImport = managerMutation({
  args: {
    key: v.string(),
    rows: v.array(importRowValidator),
    defaultEngagement: v.optional(engagementValidator),
    decisions: v.array(v.object({ index: v.number(), add: v.boolean(), differentPerson: v.boolean() })),
  },
  handler: async (ctx, args) => {
    const key = args.key.trim();
    if (key.length < 8 || key.length > 80) throw userError("This import has expired. Start it again.");
    const done = await ctx.db
      .query("workerImports")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("key", key))
      .first();
    if (done) return { status: "already_imported" as const, created: done.created.length, skipped: done.skipped, importId: done._id };
    const checked = await checkRows(ctx, args.rows, args.defaultEngagement);
    const decisions = new Map(args.decisions.map((row) => [row.index, row]));
    const chosen = checked.filter((row) => decisions.get(row.index)?.add);
    if (chosen.length === 0) throw userError("Choose at least one person to add.");
    const problems: string[] = [];
    const chosenIndexes = new Set(chosen.map((row) => row.index));
    for (const row of chosen) {
      const label = `Row ${row.index + 1}${row.name ? ` (${row.name})` : ""}`;
      if (row.problems.length > 0) problems.push(`${label}: ${row.problems[0]}`);
      const unresolved = row.matches.length > 0 || row.sameAsRows.some((other) => chosenIndexes.has(other));
      if (unresolved && !decisions.get(row.index)?.differentPerson) problems.push(`${label} may be someone already on record. Confirm it is a different person, or leave it out.`);
    }
    if (problems.length > 0) return { status: "needs_review" as const, problems: problems.slice(0, 20) };
    const importId = await ctx.db.insert("workerImports", { companyId: ctx.companyId, key, created: [], skipped: checked.length - chosen.length, by: ctx.member._id, at: Date.now() });
    const created: Id<"cleaners">[] = [];
    for (const row of chosen) {
      created.push(
        await insertWorker(
          ctx,
          ctx.companyId,
          { name: row.name, engagement: row.engagement!, email: row.email ?? undefined, phone: row.phone ?? undefined, skills: row.skills, serviceAreas: row.serviceAreas, subcontractorId: row.subcontractorId ?? undefined, preferredName: args.rows[row.index].preferredName, source: "import" },
          ctx.member,
          { importId },
        ),
      );
    }
    await ctx.db.patch(importId, { created });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "workforce.imported", actor: byMember(ctx), subject: { table: "workerImports", id: importId }, data: { created: created.length, skipped: checked.length - chosen.length } });
    return { status: "imported" as const, created: created.length, skipped: checked.length - chosen.length, importId };
  },
});


// ── The cleaner portal, from the office ──────────────────────────────────────────────────────────

const DELIVERY_WORDS: Record<Doc<"messages">["status"], string> = {
  queued: "Being prepared",
  held: "Held until quiet hours end",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Not delivered",
  unconfirmed: "Sent, delivery not confirmed",
  not_sent: "Not sent",
};

/**
 * Where a cleaner's portal stands: the newest invitation, what became of its text (prepared, sent,
 * delivered, failed), and whether the cleaner acted on it by confirming a code. Opening a link is never
 * recorded, so it is never shown.
 */
export const portalStatus = managerQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const now = instant(args.asOf, "The time");
    const tz = ctx.company.timezone;
    const links = (await linksOf(ctx, worker)).filter((link) => link.purpose === "portal");
    const newest = links[0] ?? null;
    let text: null | { status: Doc<"messages">["status"]; words: string; problem: string | null; at: number } = null;
    if (newest) {
      const message = await ctx.db
        .query("messages")
        .withIndex("by_company_dedupe", (q) => q.eq("companyId", ctx.companyId).eq("dedupeKey", `portal.invite:${newest._id}`))
        .first();
      if (message) text = { status: message.status, words: DELIVERY_WORDS[message.status], problem: message.problem ?? null, at: message.deliveredAt ?? message.sentAt ?? message.queuedAt };
    }
    const sessions = await ctx.db
      .query("portalSessions")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", worker._id))
      .take(100);
    return {
      configured: portalConfigured(),
      phone: worker.phone ?? null,
      invitation: newest
        ? {
            linkId: newest._id,
            state: portalLinkState(newest, now),
            issued: dayName(newest.issuedAt, tz),
            expires: dayName(newest.expiresAt, tz),
            revokeReason: newest.revokeReason ?? null,
            usedWords: newest.verifiedAt ? `Confirmed their code ${when(newest.verifiedAt, now, tz)}` : "Has not confirmed a code yet",
            text,
          }
        : null,
      activeSessions: sessions.filter((session) => sessionState(session, now) === "active").length,
      earlierInvitations: Math.max(0, links.length - 1),
    };
  },
});

/**
 * Invites a cleaner to their portal: a new link (the earlier one stops working) and a text through the
 * one send gate. A text the gate refuses is kept as not sent, with the reason; the office can then copy
 * the link and give it to the cleaner directly.
 */
export const invitePortal = managerMutation({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    if (worker.status === "ended") throw userError("Their engagement has ended, so they have no portal.");
    const link = await issuePortalLink(ctx, worker, { purpose: "portal", issuedBy: { kind: "member", memberId: ctx.member._id }, actor: byMember(ctx) });
    if (!link) throw userError("Links are not set up on this deployment yet, so no portal link can be made.");
    const message = await queueMessage(ctx, {
      companyId: ctx.companyId,
      purpose: "portal_invite",
      cleaner: worker,
      portalLinkId: link._id,
      body: `${ctx.company.name}: your cleaner portal is ready for onboarding, your hours and your jobs. Open {link} and confirm it is you with a code we text you.`,
      dedupeKey: `portal.invite:${link._id}`,
      actor: byMember(ctx),
    });
    return { status: message.status, problem: message.problem ?? null };
  },
});

/** The current link, for the office to give the cleaner by hand when a text cannot go. The cleaner still needs the code. */
export const portalLink = managerMutation({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const current = (await linksOf(ctx, worker)).find((row) => row.purpose === "portal" && portalLinkState(row, Date.now()) === "active");
    if (!current) throw userError("There is no working portal link. Send a new invitation first.");
    const token = await portalToken(current);
    if (!token) throw userError("Links are not set up on this deployment yet.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.portal_link_copied", actor: byMember(ctx), subject: { table: "cleaners", id: worker._id } });
    return `${siteOrigin()}${portalPath(token)}`;
  },
});

export const endPortalAccess = managerMutation({
  args: { cleanerId: v.id("cleaners"), reason: v.string() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const reason = args.reason.trim();
    if (reason.length < 3) throw userError("Say why their portal access is ending.");
    await revokePortal(ctx, worker, reason.slice(0, 300), byMember(ctx));
    return null;
  },
});

/** Open questions cleaners sent from their portal. Everyone in the company may answer one. */
export const helpRequests = companyQuery({
  args: { cleanerId: v.optional(v.id("cleaners")), asOf: v.number() },
  handler: async (ctx, args) => {
    const now = instant(args.asOf, "The time");
    const rows = await ctx.db
      .query("helpRequests")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open"))
      .order("desc")
      .take(200);
    const out = [];
    for (const row of rows) {
      if (args.cleanerId && row.cleanerId !== args.cleanerId) continue;
      const worker = await ctx.db.get(row.cleanerId);
      out.push({ id: row._id, cleanerId: row.cleanerId, name: worker?.name ?? "A cleaner", topic: row.topic, text: row.text, when: when(row.createdAt, now, ctx.company.timezone) });
    }
    return out;
  },
});

export const answerHelp = companyMutation({
  args: { helpRequestId: v.id("helpRequests") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.helpRequestId);
    if (row.status === "answered") return null;
    await ctx.db.patch(row._id, { status: "answered", answeredBy: ctx.member._id, answeredAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "helpRequests.answered", actor: byMember(ctx), subject: { table: "helpRequests", id: row._id } });
    return null;
  },
});

// ── Onboarding reminders ─────────────────────────────────────────────────────────────────────────

export const reminders = internalMutation({ args: {}, handler: async (ctx) => reminderSweep(ctx, Date.now()) });

/**
 * Where reminders stand for one worker: what the next one would be about, or why none is due. The same
 * check the sweep runs, so what a person reads is what Recruiter will do.
 */
export const reminderStatus = managerQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const now = instant(args.asOf, "The time");
    const days = reminderDays(ctx.company);
    const sent = [];
    for (let attempt = 1; attempt <= days.length; attempt += 1) {
      const message = await ctx.db
        .query("messages")
        .withIndex("by_company_dedupe", (q) => q.eq("companyId", ctx.companyId).eq("dedupeKey", reminderKey(worker._id, attempt)))
        .first();
      if (!message) break;
      sent.push({ attempt, status: message.status, words: DELIVERY_WORDS[message.status], when: when(message.queuedAt, now, ctx.company.timezone), problem: message.problem ?? null });
    }
    const authority = await authorityFor(ctx, ctx.companyId, REMINDER_ACTION);
    const level = authority.kind === "level" ? authority.level : authority.kind;
    return { sent, max: days.length, days, level };
  },
});

/** A person sends the next reminder now, whatever the timing. Every other check still applies, and it is the same reminder the sweep would send. */
export const remindNow = managerMutation({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    const plan = await reminderPlan(ctx, ctx.company, worker, Date.now(), { ignoreTiming: true });
    if (!plan.due) throw userError(plan.why);
    return sendOnboardingReminder(ctx, worker._id, plan.attempt, byMember(ctx), { ignoreTiming: true });
  },
});
