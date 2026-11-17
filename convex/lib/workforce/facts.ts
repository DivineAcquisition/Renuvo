/**
 * Reads the workforce from the shared record in a handful of company-wide reads, then builds each
 * worker's row, readiness and attention items in code. Nothing here writes, and nothing here decides
 * anything a person has not: it only reports what the record says.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { overlaps, withinWeeklyWindows, type Span, type WeeklyWindow } from "../availability";
import { CLEANER_STATUSES, type CleanerStatus } from "../statuses";
import { addLocalDays, clock, dayName, startOfLocalDay, when } from "../time";
import { readinessOf, type Readiness, type ProfileSection } from "./readiness";
import { activeRequirements, expiringSoon, factFor, appliesTo, requirementCheck, signedAgreementsBy, stageOf, type OnboardingStage } from "./requirements";

type Ctx = QueryCtx | MutationCtx;

const DAY = 24 * 60 * 60 * 1000;
/** How far ahead "next assignment" and conflicts look. */
export const LOOK_AHEAD_DAYS = 14;
/** The most workers one company's directory reads at once. */
export const MAX_WORKERS = 1000;

export type Engagement = Doc<"cleaners">["engagement"];

export const ENGAGEMENT_WORDS: Record<Engagement, string> = {
  employee: "Employee",
  contractor: "Independent contractor",
  subcontracted: "Subcontractor worker",
};

export const STATUS_WORDS: Record<CleanerStatus, string> = { onboarding: "Onboarding", ready: "Active", paused: "Paused", ended: "Ended" };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export type UpcomingWork = {
  assignmentId: Id<"assignments">;
  jobId: Id<"jobs">;
  status: "offered" | "accepted";
  startsAt: number;
  endsAt: number;
  service: string;
  /** City and postal code. The street is not needed to know who is busy. */
  area: string;
  words: string;
};

export type AttentionItem = {
  /** Stable for one issue, so the list does not jump and the same issue is never listed twice. */
  key: string;
  kind: "conflict" | "blocked_active" | "onboarding_overdue" | "subcontractor_inactive" | "held_while_inactive" | "review_waiting" | "document_expiring" | "help_requested";
  cleanerId: Id<"cleaners">;
  cleanerName: string;
  title: string;
  detail: string;
  /** What the claim rests on: each a record a person can open. */
  evidence: { label: string; jobId?: Id<"jobs">; section?: ProfileSection }[];
  action: { label: string; section: ProfileSection };
  /** Higher first. A conflict with work that is already promised outranks a missing setting. */
  rank: number;
};

export type WorkforceRow = {
  cleanerId: Id<"cleaners">;
  name: string;
  preferredName: string | null;
  initials: string;
  engagement: Engagement;
  engagementWords: string;
  status: CleanerStatus;
  statusWords: string;
  subcontractor: { id: Id<"subcontractors">; name: string; status: Doc<"subcontractors">["status"] } | null;
  readiness: Readiness;
  serviceAreas: string[];
  skills: string[];
  crews: { id: Id<"crews">; name: string; role: "lead" | "member" }[];
  phone: string | null;
  email: string | null;
  /** The days of the week they said they can work, 0 is Sunday. */
  weekdays: number[];
  hoursWords: string;
  next: UpcomingWork | null;
  /** Upcoming offers still waiting for their answer. */
  offersOut: number;
  workingToday: boolean;
  /** Where onboarding stands, when it comes from a hire. */
  handoff: { total: number; done: number; dueAt: number; overdue: boolean } | null;
  /** Where the company's onboarding requirements stand for them. */
  onboarding: { stage: OnboardingStage; met: number; total: number; awaitingReview: number };
  /** Their portal: never invited, invited and not yet used, used (a code was confirmed), or the link ran out or was closed. */
  portal: "none" | "invited" | "used" | "closed";
  source: Doc<"cleaners">["source"] | null;
  createdAt: number;
  attention: number;
};

export type Workforce = {
  rows: WorkforceRow[];
  attention: AttentionItem[];
  counts: { ready: number; onboarding: number; attention: number; workingToday: number; total: number };
  truncated: boolean;
};

const DAY_WORDS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri", "Mon, Wed, Sat", "Every day". Ranges of three or more consecutive days are joined. */
export function weekdaysWords(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 0) return "No hours set";
  if (set.length === 7) return "Every day";
  const groups: number[][] = [];
  for (const day of set) {
    const last = groups[groups.length - 1];
    if (last && last[last.length - 1] === day - 1) last.push(day);
    else groups.push([day]);
  }
  return groups.map((group) => (group.length >= 3 ? `${DAY_WORDS[group[0]]}–${DAY_WORDS[group[group.length - 1]]}` : group.map((day) => DAY_WORDS[day]).join(", "))).join(", ");
}

async function allWorkers(ctx: Ctx, companyId: Id<"companies">, includeEnded: boolean) {
  const rows: Doc<"cleaners">[] = [];
  for (const status of CLEANER_STATUSES) {
    if (status === "ended" && !includeEnded) continue;
    rows.push(
      ...(await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
        .take(MAX_WORKERS + 1 - rows.length)),
    );
    if (rows.length > MAX_WORKERS) break;
  }
  return { workers: rows.slice(0, MAX_WORKERS), truncated: rows.length > MAX_WORKERS };
}

function areaOf(property: Doc<"properties"> | null): string {
  if (!property) return "";
  return `${property.address.city} ${property.address.postalCode}`.trim();
}

/**
 * Upcoming work for the whole company in the look-ahead window: every job that has not ended, and the
 * offers and acceptances on it. One read per job, never per worker.
 */
async function upcomingWork(ctx: Ctx, company: Doc<"companies">, now: number) {
  const tz = company.timezone;
  const today = startOfLocalDay(now, tz);
  const until = addLocalDays(today, LOOK_AHEAD_DAYS, tz);
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_start", (q) => q.eq("companyId", company._id).gte("startsAt", today - DAY).lt("startsAt", until))
    .take(1500);
  const byCleaner = new Map<string, UpcomingWork[]>();
  const properties = new Map<string, Doc<"properties"> | null>();
  for (const job of jobs) {
    if (job.status === "cancelled" || job.status === "completed") continue;
    if (job.endsAt < today) continue;
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id))
      .take(50);
    for (const assignment of assignments) {
      if (assignment.status !== "accepted" && assignment.status !== "offered") continue;
      if (!properties.has(job.propertyId)) properties.set(job.propertyId, await ctx.db.get(job.propertyId));
      const work: UpcomingWork = {
        assignmentId: assignment._id,
        jobId: job._id,
        status: assignment.status,
        startsAt: job.startsAt,
        endsAt: job.endsAt,
        service: job.serviceType,
        area: areaOf(properties.get(job.propertyId) ?? null),
        words: `${when(job.startsAt, now, tz)} – ${clock(job.endsAt, tz)}`,
      };
      const list = byCleaner.get(assignment.cleanerId) ?? [];
      list.push(work);
      byCleaner.set(assignment.cleanerId, list);
    }
  }
  for (const list of byCleaner.values()) list.sort((a, b) => a.startsAt - b.startsAt);
  return { byCleaner, today, tomorrow: addLocalDays(today, 1, tz) };
}

/** The same as upcomingWork, for one worker: read through their own assignments instead of every job. */
async function workerWork(ctx: Ctx, company: Doc<"companies">, worker: Doc<"cleaners">, now: number) {
  const tz = company.timezone;
  const today = startOfLocalDay(now, tz);
  const until = addLocalDays(today, LOOK_AHEAD_DAYS, tz);
  const list: UpcomingWork[] = [];
  for (const status of ["offered", "accepted"] as const) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", company._id).eq("cleanerId", worker._id).eq("status", status))
      .take(500);
    for (const assignment of assignments) {
      const job = await ctx.db.get(assignment.jobId);
      if (!job || job.companyId !== company._id || job.status === "cancelled" || job.status === "completed") continue;
      if (job.endsAt < today || job.startsAt >= until) continue;
      list.push({
        assignmentId: assignment._id,
        jobId: job._id,
        status,
        startsAt: job.startsAt,
        endsAt: job.endsAt,
        service: job.serviceType,
        area: areaOf(await ctx.db.get(job.propertyId)),
        words: `${when(job.startsAt, now, tz)} – ${clock(job.endsAt, tz)}`,
      });
    }
  }
  list.sort((a, b) => a.startsAt - b.startsAt);
  return { byCleaner: new Map([[worker._id as string, list]]), today, tomorrow: addLocalDays(today, 1, tz) };
}

/** Conflicts between work a cleaner already holds and what the record now says about them. */
function conflictsFor(
  worker: Doc<"cleaners">,
  work: UpcomingWork[],
  windows: WeeklyWindow[],
  timeOff: Span[],
  timezone: string,
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const accepted = work.filter((row) => row.status === "accepted" && row.endsAt > now);
  const name = worker.name;
  for (const row of accepted) {
    const evidence = [{ label: `${row.service}, ${row.words}`, jobId: row.jobId }];
    const off = timeOff.find((span) => overlaps(span, row));
    if (off) {
      items.push({
        key: `conflict.time_off:${row.assignmentId}`,
        kind: "conflict",
        cleanerId: worker._id,
        cleanerName: name,
        title: `${name} has time off during an accepted visit`,
        detail: `They accepted the ${row.service} ${row.words}, and time off from ${dayName(off.startsAt, timezone)} ${clock(off.startsAt, timezone)} to ${dayName(off.endsAt, timezone)} ${clock(off.endsAt, timezone)} now overlaps it. Nothing was changed: decide whether they keep the visit.`,
        evidence: [...evidence, { label: "Their time off", section: "availability" }],
        action: { label: "Review availability", section: "availability" },
        rank: 100,
      });
      continue;
    }
    const clash = accepted.find((other) => other.assignmentId !== row.assignmentId && overlaps(other, row));
    if (clash && row.assignmentId < clash.assignmentId) {
      items.push({
        key: `conflict.double:${row.assignmentId}:${clash.assignmentId}`,
        kind: "conflict",
        cleanerId: worker._id,
        cleanerName: name,
        title: `${name} holds two visits at the same time`,
        detail: `The ${row.service} ${row.words} overlaps the ${clash.service} ${clash.words}. Both are accepted.`,
        evidence: [...evidence, { label: `${clash.service}, ${clash.words}`, jobId: clash.jobId }],
        action: { label: "Open their jobs", section: "availability" },
        rank: 100,
      });
      continue;
    }
    if (!withinWeeklyWindows(windows, row, timezone)) {
      items.push({
        key: `conflict.hours:${row.assignmentId}`,
        kind: "conflict",
        cleanerId: worker._id,
        cleanerName: name,
        title: `An accepted visit is outside ${name}'s hours`,
        detail: `They accepted the ${row.service} ${row.words}, but their weekly hours on record no longer cover it. Confirm they can still go.`,
        evidence: [...evidence, { label: "Their weekly hours", section: "availability" }],
        action: { label: "Review availability", section: "availability" },
        rank: 90,
      });
    }
  }
  if ((worker.status === "paused" || worker.status === "ended") && accepted.length > 0) {
    items.push({
      key: `held_while_inactive:${worker._id}`,
      kind: "held_while_inactive",
      cleanerId: worker._id,
      cleanerName: name,
      title: `${name} is ${worker.status} and still holds ${accepted.length} upcoming ${accepted.length === 1 ? "visit" : "visits"}`,
      detail: "Changing their status did not take them off any visit. Decide whether each visit keeps them or needs cover.",
      evidence: accepted.slice(0, 3).map((row) => ({ label: `${row.service}, ${row.words}`, jobId: row.jobId })),
      action: { label: "Open their jobs", section: "availability" },
      rank: 95,
    });
  }
  return items;
}

/**
 * The whole workforce as the directory and the overview read it. `asOf` is the caller's clock (the
 * browser's minute), so a query result is stable for that minute.
 */
export async function loadWorkforce(ctx: Ctx, company: Doc<"companies">, opts: { asOf: number; includeEnded: boolean; only?: Doc<"cleaners"> }): Promise<Workforce> {
  const companyId = company._id;
  const tz = company.timezone;
  const now = opts.asOf;
  const only = opts.only;
  const { workers, truncated } = only ? { workers: [only], truncated: false } : await allWorkers(ctx, companyId, opts.includeEnded);

  const windowsBy = new Map<string, WeeklyWindow[]>();
  const windowRows = await ctx.db
    .query("availabilityWindows")
    .withIndex("by_company_cleaner", (q) => (only ? q.eq("companyId", companyId).eq("cleanerId", only._id) : q.eq("companyId", companyId)))
    .take(8000);
  for (const row of windowRows) {
    const list = windowsBy.get(row.cleanerId) ?? [];
    list.push({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute });
    windowsBy.set(row.cleanerId, list);
  }

  const consentBy = new Map<string, "granted" | "withdrawn">();
  const consentRows = await ctx.db
    .query("contactPermissions")
    .withIndex("by_company_recipient", (q) => (only ? q.eq("companyId", companyId).eq("recipient.kind", "cleaner").eq("recipient.id", only._id) : q.eq("companyId", companyId).eq("recipient.kind", "cleaner")))
    .take(4000);
  for (const row of consentRows) {
    if (row.channel === "sms" && row.category === "operational") consentBy.set(row.recipient.id, row.status);
  }

  const subcontractors = new Map<string, Doc<"subcontractors">>();
  for (const row of await ctx.db.query("subcontractors").withIndex("by_company_status", (q) => q.eq("companyId", companyId)).take(500)) subcontractors.set(row._id, row);
  const affiliationBy = new Map<string, Doc<"subcontractors">>();
  const affiliationRows = await ctx.db
    .query("workerAffiliations")
    .withIndex("by_company_cleaner", (q) => (only ? q.eq("companyId", companyId).eq("cleanerId", only._id) : q.eq("companyId", companyId)))
    .take(4000);
  for (const row of affiliationRows) {
    if (row.endedAt !== undefined) continue;
    const sub = subcontractors.get(row.subcontractorId);
    if (sub) affiliationBy.set(row.cleanerId, sub);
  }

  const crews = new Map<string, Doc<"crews">>();
  for (const row of await ctx.db.query("crews").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active")).take(500)) crews.set(row._id, row);
  const crewsBy = new Map<string, WorkforceRow["crews"]>();
  const memberRows = only
    ? await ctx.db
        .query("crewMembers")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", only._id))
        .take(100)
    : await ctx.db.query("crewMembers").withIndex("by_company_crew", (q) => q.eq("companyId", companyId)).take(5000);
  for (const row of memberRows) {
    if (row.leftAt !== undefined) continue;
    const crew = crews.get(row.crewId);
    if (!crew) continue;
    const list = crewsBy.get(row.cleanerId) ?? [];
    list.push({ id: crew._id, name: crew.name, role: row.role });
    crewsBy.set(row.cleanerId, list);
  }

  const requirements = await activeRequirements(ctx, companyId);
  const requirementRows = new Map<string, Doc<"workerRequirements">[]>();
  if (requirements.length > 0) {
    const rows = await ctx.db
      .query("workerRequirements")
      .withIndex("by_company_cleaner", (q) => (only ? q.eq("companyId", companyId).eq("cleanerId", only._id) : q.eq("companyId", companyId)))
      .take(8000);
    for (const row of rows) {
      const list = requirementRows.get(row.cleanerId) ?? [];
      list.push(row);
      requirementRows.set(row.cleanerId, list);
    }
  }
  const signed = requirements.some((row) => row.kind === "agreement") ? await signedAgreementsBy(ctx, companyId, only?._id) : new Set<string>();

  const portalBy = new Map<string, WorkforceRow["portal"]>();
  const portalRows = only
    ? await ctx.db.query("portalLinks").withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", only._id)).order("desc").take(20)
    : await ctx.db.query("portalLinks").withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId)).order("desc").take(5000);
  for (const link of portalRows) {
    if (link.purpose !== "portal" || portalBy.has(link.cleanerId)) continue;
    const open = link.revokedAt === undefined && link.expiresAt > now;
    portalBy.set(link.cleanerId, link.verifiedAt !== undefined && open ? "used" : open ? "invited" : "closed");
  }

  const helpBy = new Map<string, Doc<"helpRequests">[]>();
  for (const row of await ctx.db.query("helpRequests").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "open")).take(500)) {
    if (only && row.cleanerId !== only._id) continue;
    const list = helpBy.get(row.cleanerId) ?? [];
    list.push(row);
    helpBy.set(row.cleanerId, list);
  }

  const handoffBy = new Map<string, Doc<"onboardingHandoffs">>();
  for (const row of await ctx.db.query("onboardingHandoffs").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "open")).take(500)) handoffBy.set(row.cleanerId, row);

  const { byCleaner, today, tomorrow } = only ? await workerWork(ctx, company, only, now) : await upcomingWork(ctx, company, now);

  const rows: WorkforceRow[] = [];
  const attention: AttentionItem[] = [];
  for (const worker of workers) {
    const windows = windowsBy.get(worker._id) ?? [];
    const sub = affiliationBy.get(worker._id) ?? null;
    const handoff = handoffBy.get(worker._id) ?? null;
    const outstanding = handoff ? handoff.requirements.filter((item) => item.status === "outstanding").map((item) => item.label) : [];
    const own = requirementRows.get(worker._id) ?? [];
    const reqFacts = requirements.filter((requirement) => appliesTo(requirement, worker)).map((requirement) => factFor(requirement, own.find((row) => row.requirementId === requirement._id) ?? null, now, signed.has(worker._id)));
    const readiness = readinessOf({
      status: worker.status,
      engagement: worker.engagement,
      phone: worker.phone,
      email: worker.email,
      serviceAreas: worker.serviceAreas,
      skills: worker.skills,
      windowCount: windows.length,
      hasPay: worker.pay !== undefined,
      workTexts: consentBy.get(worker._id) ?? "none",
      subcontractor: sub ? { name: sub.name, status: sub.status } : null,
      handoffOutstanding: outstanding,
      requirementChecks: reqFacts.map((fact) => requirementCheck(fact, tz)),
    });
    const work = (byCleaner.get(worker._id) ?? []).filter((row) => row.endsAt > now);
    const next = work.find((row) => row.status === "accepted") ?? null;
    const workingToday = (byCleaner.get(worker._id) ?? []).some((row) => row.status === "accepted" && row.startsAt < tomorrow && row.endsAt > today);

    const items: AttentionItem[] = [];
    if (work.some((row) => row.status === "accepted")) {
      const timeOff = await ctx.db
        .query("timeOff")
        .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", companyId).eq("cleanerId", worker._id).gt("endsAt", now))
        .take(50);
      items.push(...conflictsFor(worker, work, windows, timeOff.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt })), tz, now));
    }
    if (readiness.state === "blocked") {
      items.push({
        key: `blocked_active:${worker._id}`,
        kind: "blocked_active",
        cleanerId: worker._id,
        cleanerName: worker.name,
        title: `${worker.name} is active but cannot be offered work`,
        detail: readiness.blockers.map((check) => check.detail).join(" "),
        evidence: readiness.blockers.map((check) => ({ label: check.label, section: check.section })),
        action: { label: readiness.blockers[0].section === "pay" ? "Open pay" : "Fix availability", section: readiness.blockers[0].section },
        rank: 60,
      });
    }
    const help = helpBy.get(worker._id) ?? [];
    if (help.length > 0) {
      items.push({
        key: `help_requested:${worker._id}`,
        kind: "help_requested",
        cleanerId: worker._id,
        cleanerName: worker.name,
        title: `${worker.name} asked for help${help.length > 1 ? ` (${help.length} requests)` : ""}`,
        detail: `"${help[0].text.slice(0, 220)}"${help.length > 1 ? " and more." : ""} Sent from their portal ${when(help[0].createdAt, now, tz)}.`,
        evidence: [{ label: "Their requests", section: "overview" }],
        action: { label: "Answer", section: "overview" },
        rank: 85,
      });
    }
    const waiting = worker.status === "ended" ? [] : reqFacts.filter((fact) => fact.state === "awaiting_review");
    if (waiting.length > 0) {
      items.push({
        key: `review_waiting:${worker._id}`,
        kind: "review_waiting",
        cleanerId: worker._id,
        cleanerName: worker.name,
        title: `${worker.name} submitted ${waiting.length === 1 ? `${waiting[0].requirement.label}` : `${waiting.length} onboarding items`} for review`,
        detail: `Waiting for a person: ${waiting.map((fact) => fact.requirement.label).join(", ")}. Submitted is not accepted until someone reviews it.`,
        evidence: waiting.map((fact) => ({ label: fact.requirement.label, section: "onboarding" as const })),
        action: { label: "Review", section: "onboarding" },
        rank: 75,
      });
    }
    const expiring = worker.status === "ended" ? [] : expiringSoon(reqFacts, now);
    if (expiring.length > 0) {
      items.push({
        key: `document_expiring:${worker._id}`,
        kind: "document_expiring",
        cleanerId: worker._id,
        cleanerName: worker.name,
        title: `${expiring.length === 1 ? expiring[0].requirement.label : `${expiring.length} documents`} for ${worker.name} ${expiring.length === 1 ? "expires" : "expire"} soon`,
        detail: expiring.map((fact) => `${fact.requirement.label}: valid until ${dayName(fact.row!.expiresAt!, tz)}${fact.requirement.blocks === "assignments" ? ", after which they cannot be offered work" : ""}.`).join(" "),
        evidence: expiring.map((fact) => ({ label: fact.requirement.label, section: "onboarding" as const })),
        action: { label: "Open onboarding", section: "onboarding" },
        rank: 55,
      });
    }
    if (handoff && handoff.dueAt < now && outstanding.length > 0 && worker.status === "onboarding") {
      items.push({
        key: `onboarding_overdue:${handoff._id}`,
        kind: "onboarding_overdue",
        cleanerId: worker._id,
        cleanerName: worker.name,
        title: `${worker.name}'s onboarding is past its due date`,
        detail: `It was due ${dayName(handoff.dueAt, tz)}. Still outstanding: ${outstanding.join(", ").toLowerCase()}.`,
        evidence: [{ label: "Onboarding from their hire", section: "onboarding" }],
        action: { label: "Open onboarding", section: "onboarding" },
        rank: 70,
      });
    }
    if (sub && sub.status !== "active" && (worker.status === "ready" || worker.status === "onboarding")) {
      items.push({
        key: `subcontractor_inactive:${worker._id}`,
        kind: "subcontractor_inactive",
        cleanerId: worker._id,
        cleanerName: worker.name,
        title: `${worker.name}'s supplying company is ${sub.status}`,
        detail: `${sub.name} is ${sub.status}, and ${worker.name} is still ${worker.status === "ready" ? "active" : "onboarding"}. Decide whether they keep working through them.`,
        evidence: [{ label: sub.name, section: "overview" }],
        action: { label: "Open profile", section: "overview" },
        rank: 50,
      });
    }
    attention.push(...items);

    rows.push({
      cleanerId: worker._id,
      name: worker.name,
      preferredName: worker.preferredName ?? null,
      initials: initialsOf(worker.preferredName ?? worker.name),
      engagement: worker.engagement,
      engagementWords: ENGAGEMENT_WORDS[worker.engagement],
      status: worker.status,
      statusWords: STATUS_WORDS[worker.status],
      subcontractor: sub ? { id: sub._id, name: sub.name, status: sub.status } : null,
      readiness,
      serviceAreas: worker.serviceAreas,
      skills: worker.skills,
      crews: crewsBy.get(worker._id) ?? [],
      phone: worker.phone ?? null,
      email: worker.email ?? null,
      weekdays: [...new Set(windows.map((row) => row.weekday))].sort((a, b) => a - b),
      hoursWords: weekdaysWords(windows.map((row) => row.weekday)),
      next,
      offersOut: work.filter((row) => row.status === "offered").length,
      workingToday,
      handoff: handoff ? { total: handoff.requirements.length, done: handoff.requirements.length - outstanding.length, dueAt: handoff.dueAt, overdue: handoff.dueAt < now && outstanding.length > 0 } : null,
      onboarding: { stage: stageOf(reqFacts), met: reqFacts.filter((fact) => fact.met).length, total: reqFacts.length, awaitingReview: waiting.length },
      portal: portalBy.get(worker._id) ?? "none",
      source: worker.source ?? null,
      createdAt: worker.createdAt,
      attention: items.length,
    });
  }
  attention.sort((a, b) => b.rank - a.rank || a.cleanerName.localeCompare(b.cleanerName));
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const counts = {
    ready: rows.filter((row) => row.readiness.state === "ready").length,
    onboarding: rows.filter((row) => row.status === "onboarding").length,
    attention: new Set(attention.map((item) => item.cleanerId)).size,
    workingToday: rows.filter((row) => row.workingToday).length,
    total: rows.filter((row) => row.status !== "ended").length,
  };
  return { rows, attention, counts, truncated };
}

/** The weekday and minute words for a weekly window, on the company's clock. */
export function windowWords(window: WeeklyWindow): string {
  const at = (minute: number) => {
    const h = Math.floor(minute / 60);
    const m = minute % 60;
    const suffix = h >= 12 && h < 24 ? "PM" : "AM";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
  };
  return `${DAY_WORDS[window.weekday]} ${at(window.startMinute)} – ${window.endMinute === 1440 ? "midnight" : at(window.endMinute)}`;
}

