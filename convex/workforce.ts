/**
 * The Cleaners workspace: the directory with its operational overview, who is free in a window, adding and
 * importing workers with a duplicate check, and a worker's profile (docs/cleaners/00-architecture.md).
 *
 * Pay and sensitive personnel details never leave this file for a role that may not see them: the
 * directory carries none, and the profile's pay and notes are read by their own Owner- or Manager-only
 * functions.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { availabilityFor, type Span } from "./lib/availability";
import { companyQuery, managerMutation, managerQuery, type MemberAccess } from "./lib/builders";
import { attentionFor, conflictsOf, sortAttention, weekSummary, type AttentionItem } from "./lib/cleaners/attention";
import { matchesFor, WHY_WORDS, type Match } from "./lib/cleaners/duplicates";
import { applyTemplate, createWorker, ENGAGEMENT_WORDS, STATUS_WORDS } from "./lib/cleaners/enroll";
import { companyCleaners, companyFacts, DIRECTORY_CAP, initialsOf, readinessOf } from "./lib/cleaners/records";
import { engagementValidator } from "./lib/cleaners/schema";
import { commitmentsBetween, companyTime } from "./lib/cleaners/schedule";
import { cleanersSettings, DAY } from "./lib/cleaners/settings";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { tags } from "./lib/text";
import { addLocalDays, startOfLocalDay } from "./lib/time";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What each overview number counts, shown beside it. */
export const OVERVIEW_DEFINITIONS = {
  ready: "Active, with every requirement for work met. Free time is still checked for each job.",
  onboarding: "Not active yet: finishing onboarding, or waiting for a person to make them active.",
  attention: "Have at least one verified item below to review, fix or confirm.",
  working: "Have accepted work on a visit today. Not working today does not mean free.",
} as const;

async function photoUrl(ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } }, cleaner: Doc<"cleaners">): Promise<string | null> {
  return cleaner.photoStorageId ? await ctx.storage.getUrl(cleaner.photoStorageId) : null;
}

export const directory = companyQuery({
  args: { asOf: v.number(), includeEnded: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const company = ctx.company;
    const tz = company.timezone;
    const settings = cleanersSettings(company);
    const now = args.asOf;
    const today = startOfLocalDay(now, tz);
    const tomorrow = addLocalDays(today, 1, tz);
    const horizon = addLocalDays(today, 14, tz);

    const cleaners = await companyCleaners(ctx, ctx.companyId, args.includeEnded ?? false);
    const facts = await companyFacts(ctx, company);
    const commitments = await commitmentsBetween(ctx, company, today, horizon);
    const time = await companyTime(ctx, company, now);
    const claims = await ctx.db
      .query("skillClaims")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "claimed"))
      .take(1000);
    const memberships = (
      await ctx.db
        .query("crewMemberships")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId))
        .take(5000)
    ).filter((row) => row.to === undefined);
    const crews = new Map<string, Doc<"crews">>();
    for (const row of memberships) if (!crews.has(row.crewId)) {
      const crew = await ctx.db.get(row.crewId);
      if (crew && crew.status === "active") crews.set(row.crewId, crew);
    }
    const subcontractors = await ctx.db
      .query("subcontractors")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    const subName = new Map(subcontractors.map((row) => [row._id as string, row.name]));

    const attention: AttentionItem[] = [];
    const rows = [];
    for (const cleaner of cleaners) {
      const ready = readinessOf(cleaner, facts, company, now);
      const windows = (facts.windows.get(cleaner._id) ?? []).map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute }));
      const held = (commitments.get(cleaner._id) ?? []).sort((a, b) => a.startsAt - b.startsAt);
      const own = time.get(cleaner._id) ?? { absences: [], extraAvailable: [] };
      const conflicts = conflictsOf({ commitments: held, absences: own.absences, windows, extraAvailable: own.extraAvailable, timezone: tz });
      const items = attentionFor({
        cleaner: { id: cleaner._id, name: cleaner.name, status: cleaner.status, phone: cleaner.phone, email: cleaner.email, hasPay: Boolean(cleaner.pay) || cleaner.engagement === "subcontractor", availabilityConfirmedAt: cleaner.availabilityConfirmedAt, createdAt: cleaner.createdAt },
        readiness: ready,
        weeklyWindows: windows.length,
        conflicts,
        skillClaims: claims.filter((row) => row.cleanerId === cleaner._id).length,
        now,
        timezone: tz,
        settings,
        viewerIsOwner: isOwner(ctx.role),
      });
      attention.push(...items);
      const next = held.find((row) => row.status === "accepted" && row.endsAt > now) ?? null;
      const offered = held.filter((row) => row.status === "offered" && row.startsAt > now).length;
      const workingToday = held.some((row) => row.status === "accepted" && row.startsAt >= today && row.startsAt < tomorrow);
      const firstOpen = ready.requirements.find((view) => !view.met && view.effect === "blocks_assignments") ?? ready.requirements.find((view) => !view.met) ?? null;
      rows.push({
        cleanerId: cleaner._id,
        name: cleaner.name,
        initials: initialsOf(cleaner.name),
        photoUrl: await photoUrl(ctx, cleaner),
        engagement: cleaner.engagement,
        engagementWords: ENGAGEMENT_WORDS[cleaner.engagement],
        subcontractor: cleaner.subcontractorId ? { id: cleaner.subcontractorId, name: subName.get(cleaner.subcontractorId) ?? "Subcontractor" } : null,
        status: cleaner.status,
        statusWords: STATUS_WORDS[cleaner.status],
        readiness: { state: ready.state, summary: ready.summary, nextStep: ready.nextStep, blockers: ready.blockers.map((view) => view.label), progress: ready.progress, payoutReady: ready.payoutReady },
        /** The first requirement still open, for the onboarding-stage filter. Null when every one is met. */
        stage: firstOpen ? { key: firstOpen.key, label: firstOpen.label } : null,
        serviceAreas: cleaner.serviceAreas,
        skills: cleaner.skills,
        crews: memberships.filter((row) => row.cleanerId === cleaner._id && crews.has(row.crewId)).map((row) => ({ crewId: row.crewId, name: crews.get(row.crewId)!.name, role: row.role, kind: crews.get(row.crewId)!.kind })),
        week: weekSummary(windows),
        next: next ? { jobId: next.jobId, startsAt: next.startsAt, label: next.label } : null,
        offersWaiting: offered,
        workingToday,
        attention: items.length,
        hasPhone: Boolean(cleaner.phone),
        createdAt: cleaner.createdAt,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const attentionCleaners = new Set(attention.map((item) => item.cleanerId));
    const active = rows.filter((row) => row.status !== "ended");
    return {
      overview: {
        ready: { count: active.filter((row) => row.readiness.state === "ready").length, definition: OVERVIEW_DEFINITIONS.ready },
        onboarding: { count: active.filter((row) => row.status === "onboarding").length, definition: OVERVIEW_DEFINITIONS.onboarding },
        attention: { count: attentionCleaners.size, definition: OVERVIEW_DEFINITIONS.attention },
        working: { count: active.filter((row) => row.workingToday).length, definition: OVERVIEW_DEFINITIONS.working },
        total: active.length,
      },
      attention: sortAttention(attention),
      rows,
      filters: {
        crews: [...crews.values()].filter((crew) => crew.kind === "permanent").map((crew) => ({ id: crew._id, name: crew.name })),
        areas: [...new Set(rows.flatMap((row) => row.serviceAreas))].sort(),
        skills: [...new Set(rows.flatMap((row) => row.skills))].sort(),
        subcontractors: subcontractors.filter((row) => row.status !== "ended").map((row) => ({ id: row._id, name: row.name })),
        stages: facts.definitions.map((def) => ({ key: def.key, label: def.label })),
      },
      capped: cleaners.length >= DIRECTORY_CAP,
    };
  },
});

const REASON_WORDS = {
  outside_hours: "has not said they can work then",
  time_off: "has time away then",
  already_booked: "already has work then",
  exception: "said they cannot work that day",
  not_active: "is not active",
} as const;

/**
 * Who can work in a window, cleaner by cleaner, with the reason for each who cannot. It answers only for
 * time: it says nothing about a particular job's skills or area, which Dispatch checks per job.
 */
export const availableIn = companyQuery({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    if (!(args.to > args.from) || args.to - args.from > 14 * DAY) throw userError("Choose a window of up to two weeks, with the end after the start.");
    const company = ctx.company;
    const span: Span = { startsAt: args.from, endsAt: args.to };
    const cleaners = await companyCleaners(ctx, ctx.companyId);
    const facts = await companyFacts(ctx, company);
    const commitments = await commitmentsBetween(ctx, company, startOfLocalDay(args.from, company.timezone) - DAY, args.to + DAY);
    const time = await companyTime(ctx, company, args.from - DAY);
    return cleaners.map((cleaner) => {
      const windows = (facts.windows.get(cleaner._id) ?? []).map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute }));
      const own = time.get(cleaner._id) ?? { absences: [], extraAvailable: [] };
      const held = (commitments.get(cleaner._id) ?? []).map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt }));
      if (cleaner.status !== "ready") return { cleanerId: cleaner._id, available: false, reason: REASON_WORDS.not_active };
      if (own.absences.some((row) => row.kind === "exception" && row.span.startsAt < span.endsAt && span.startsAt < row.span.endsAt)) return { cleanerId: cleaner._id, available: false, reason: REASON_WORDS.exception };
      const extra = own.extraAvailable.some((row) => row.startsAt <= span.startsAt && span.endsAt <= row.endsAt);
      const answer = availabilityFor({ windows: extra ? [] : windows, timeOff: own.absences.filter((row) => row.kind === "time_off").map((row) => row.span), booked: held, span, timezone: company.timezone });
      if (extra && !answer.available && answer.reason === "outside_hours") {
        const booked = held.some((row) => row.startsAt < span.endsAt && span.startsAt < row.endsAt);
        return booked ? { cleanerId: cleaner._id, available: false, reason: REASON_WORDS.already_booked } : { cleanerId: cleaner._id, available: true, reason: null };
      }
      return answer.available ? { cleanerId: cleaner._id, available: true, reason: null } : { cleanerId: cleaner._id, available: false, reason: REASON_WORDS[answer.reason] };
    });
  },
});

// ── Adding workers ───────────────────────────────────────────────────────────────────────────────

const personValidator = v.object({
  name: v.string(),
  engagement: engagementValidator,
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  skills: v.optional(v.array(v.string())),
  serviceAreas: v.optional(v.array(v.string())),
  subcontractorId: v.optional(v.id("subcontractors")),
});

async function existingPeople(ctx: QueryCtx & MemberAccess) {
  const all = await companyCleaners(ctx, ctx.companyId, true);
  return all.map((row) => ({ id: row._id as string, name: row.name, email: row.email, phone: row.phone, status: row.status }));
}

function matchWords(match: Match): string {
  return match.why.map((why) => WHY_WORDS[why]).join(", ");
}

/** People already in the record who may be this one. Checked as the add form is filled in. */
export const possibleDuplicates = managerQuery({
  args: { name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.name.trim() && !args.email?.trim() && !args.phone?.trim()) return [];
    const people = await existingPeople(ctx);
    return matchesFor(args, people).map((match) => ({ cleanerId: match.id as Id<"cleaners">, name: match.name, why: matchWords(match), strong: match.strong, status: people.find((row) => row.id === match.id)?.status ?? null }));
  },
});

/**
 * Adds one worker with the company's onboarding template. A possible duplicate is refused unless the person
 * says it is a different person, with a reason, so two records for one person are never made by accident.
 */
export const add = managerMutation({
  args: {
    person: personValidator,
    /** Weekly hours the worker said they can work, on the company's clock. */
    windows: v.optional(v.array(v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() }))),
    notDuplicateBecause: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const people = await existingPeople(ctx);
    const matches = matchesFor(args.person, people);
    if (matches.length > 0 && !args.notDuplicateBecause?.trim()) {
      throw userError(`${matches[0].name} is already in the record (${matchWords(matches[0])}). Open them instead, or say why this is a different person.`);
    }
    const cleanerId = await createWorker(ctx, ctx.company, args.person, byMember(ctx), { template: true, source: "added" });
    if (matches.length > 0) {
      await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.duplicate_overridden", actor: byMember(ctx), subject: { table: "cleaners", id: cleanerId }, data: { similarTo: matches[0].id, reason: args.notDuplicateBecause!.trim().slice(0, 300) } });
    }
    if (args.windows?.length) {
      for (const window of args.windows) {
        const whole = [window.weekday, window.startMinute, window.endMinute].every(Number.isInteger);
        if (!whole || window.weekday < 0 || window.weekday > 6 || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) throw userError("Each window needs a day of the week and a start time before its end time.");
        await ctx.db.insert("availabilityWindows", { companyId: ctx.companyId, cleanerId, ...window });
      }
      await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_set", actor: byMember(ctx), subject: { table: "cleaners", id: cleanerId }, data: { windows: args.windows.length } });
    }
    return { cleanerId };
  },
});

const importRowValidator = v.object({
  name: v.string(),
  engagement: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  skills: v.optional(v.string()),
  serviceAreas: v.optional(v.string()),
  subcontractor: v.optional(v.string()),
});
type ImportRow = typeof importRowValidator.type;

const ENGAGEMENT_ALIASES: Record<string, "employee" | "contractor" | "subcontractor"> = {
  employee: "employee",
  w2: "employee",
  "w-2": "employee",
  staff: "employee",
  contractor: "contractor",
  "independent contractor": "contractor",
  "1099": "contractor",
  subcontractor: "subcontractor",
  sub: "subcontractor",
  "subcontractor worker": "subcontractor",
};

const split = (value: string | undefined) => (value ?? "").split(/[;,|]/).map((part) => part.trim()).filter(Boolean);

type Checked = {
  index: number;
  name: string;
  engagement: "employee" | "contractor" | "subcontractor" | null;
  subcontractorId: Id<"subcontractors"> | null;
  problems: string[];
  matches: { cleanerId: string; name: string; why: string; strong: boolean }[];
  /** Earlier rows in the same file that look like the same person. */
  sameAsRow: number | null;
};

async function checkRows(ctx: QueryCtx & MemberAccess, rows: ImportRow[]): Promise<Checked[]> {
  if (rows.length > 500) throw userError("Import up to 500 people at a time.");
  const people = await existingPeople(ctx);
  const subs = await ctx.db
    .query("subcontractors")
    .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
    .take(200);
  const seen: { index: number; name: string; email?: string; phone?: string }[] = [];
  return rows.map((row, index) => {
    const problems: string[] = [];
    const name = row.name.trim();
    if (!name) problems.push("No name.");
    const engagement = row.engagement?.trim() ? (ENGAGEMENT_ALIASES[row.engagement.trim().toLowerCase()] ?? null) : "contractor";
    if (!engagement) problems.push(`"${row.engagement}" is not a relationship type. Use employee, contractor or subcontractor.`);
    let subcontractorId: Id<"subcontractors"> | null = null;
    if (row.subcontractor?.trim()) {
      const found = subs.find((sub) => sub.name.trim().toLowerCase() === row.subcontractor!.trim().toLowerCase() && sub.status !== "ended");
      if (!found) problems.push(`No subcontractor company named "${row.subcontractor.trim()}". Add it first.`);
      else subcontractorId = found._id;
    }
    if (engagement === "subcontractor" && !row.subcontractor?.trim()) problems.push("A subcontractor worker needs their subcontractor company.");
    if (engagement && engagement !== "subcontractor" && row.subcontractor?.trim()) problems.push("Only subcontractor workers work through a subcontractor company.");
    if (row.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email.trim())) problems.push("The email is not valid.");
    try {
      tags(split(row.skills), "Skills");
      tags(split(row.serviceAreas), "Service areas", 200);
    } catch {
      problems.push("Too many skills or areas, or one is too long.");
    }
    const matches = matchesFor({ name, email: row.email, phone: row.phone }, people).map((match) => ({ cleanerId: match.id, name: match.name, why: matchWords(match), strong: match.strong }));
    const inFile = matchesFor({ name, email: row.email, phone: row.phone }, seen.map((other) => ({ id: String(other.index), ...other })));
    seen.push({ index, name, email: row.email, phone: row.phone });
    return { index, name, engagement, subcontractorId, problems, matches, sameAsRow: inFile.length > 0 ? Number(inFile[0].id) : null };
  });
}

/** What an import would do, row by row, before anything is written. */
export const checkImport = managerQuery({
  args: { rows: v.array(importRowValidator) },
  handler: async (ctx, args) => checkRows(ctx, args.rows),
});

/**
 * Writes the rows a person chose to add. Every row is checked again here: a row with a problem is never
 * written, and a row that now matches someone is added only when the person said to add it anyway.
 */
export const importRows = managerMutation({
  args: { rows: v.array(importRowValidator), addAnyway: v.array(v.number()), skip: v.array(v.number()) },
  handler: async (ctx, args) => {
    const checked = await checkRows(ctx, args.rows);
    const added: Id<"cleaners">[] = [];
    const skipped: { index: number; why: string }[] = [];
    for (const row of checked) {
      const source = args.rows[row.index];
      if (args.skip.includes(row.index)) {
        skipped.push({ index: row.index, why: "You chose to skip it." });
        continue;
      }
      if (row.problems.length > 0 || !row.engagement) {
        skipped.push({ index: row.index, why: row.problems.join(" ") || "It could not be read." });
        continue;
      }
      if ((row.matches.length > 0 || row.sameAsRow !== null) && !args.addAnyway.includes(row.index)) {
        skipped.push({ index: row.index, why: row.matches.length > 0 ? `May be ${row.matches[0].name} (${row.matches[0].why}).` : `Looks like row ${row.sameAsRow! + 1} in the same file.` });
        continue;
      }
      const cleanerId = await createWorker(
        ctx,
        ctx.company,
        { name: row.name, engagement: row.engagement, email: source.email?.trim() || undefined, phone: source.phone?.trim() || undefined, skills: split(source.skills), serviceAreas: split(source.serviceAreas), subcontractorId: row.subcontractorId ?? undefined },
        byMember(ctx),
        { template: true, source: "imported" },
      );
      added.push(cleanerId);
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.import_finished", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { added: added.length, skipped: skipped.length } });
    return { added: added.length, skipped, summary: `${plural(added.length, "person", "people")} added${skipped.length ? `, ${skipped.length} not added` : ""}.` };
  },
});

/** Gives existing workers the template's requirements they do not have yet (for example after the Owner adds one). */
export const applyTemplateTo = managerMutation({
  args: { cleanerIds: v.array(v.id("cleaners")), keys: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    if (args.cleanerIds.length > 200) throw userError("Apply to up to 200 people at a time.");
    let added = 0;
    for (const id of args.cleanerIds) {
      const cleaner = await owned(ctx, id);
      if (cleaner.status === "ended") continue;
      added += await applyTemplate(ctx, ctx.company, cleaner, byMember(ctx), args.keys);
    }
    return { added };
  },
});
