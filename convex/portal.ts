/**
 * The cleaner portal (/c/portal/<token>): a cleaner's own jobs, availability, onboarding steps, agreements,
 * skills and, after a one-time code, their pay. Everything is reached through the link: no id in the arguments
 * is trusted. A read changes nothing. Each named action is checked against the link (active, allowed) and
 * against the record, and recorded.
 *
 * What is never here: anyone else's details, internal notes, the reasons a requirement was waived, pay
 * without a code, or a job's address once that job is no longer theirs.
 */
import { cleanerTextWording } from "./lib/texting/wording";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { portalMutation, portalQuery, type PortalAccess } from "./lib/builders";
import { cleanersSettings, DAY, HOUR } from "./lib/cleaners/settings";
import { helpKey } from "./lib/cleaners/followUps";
import { acknowledgmentHolds } from "./lib/cleaners/readiness";
import { cleanerReadiness } from "./lib/cleaners/records";
import { cleanerTime, commitmentsBetween, currentClashes } from "./lib/cleaners/schedule";
import { queueCleanerMessage, channelsFor } from "./lib/cleaners/outbox";
import { CODE_ATTEMPTS, CODE_LIFETIME, CODE_WINDOW, CODES_PER_WINDOW, codeHash, isVerified, maskAddress, newCode, VERIFIED_FOR } from "./lib/cleaners/portal";
import { setPermission } from "./lib/compliance/permissions";
import { requiredCrew, staffing } from "./lib/dispatch/crew";
import { jobAssignments } from "./lib/dispatch/facts";
import { linkPath, liveLink, siteOrigin, tokenFor } from "./lib/dispatch/links";
import { userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";
import { payMethodWords } from "./lib/finance/teamPay";
import { recordSubmission } from "./requirements";
import { openTask } from "./lib/taskState";
import { optionalEmail, optionalText, tags, text } from "./lib/text";
import { localParts } from "./lib/availability";
import { addLocalDays, startOfLocalDay } from "./lib/time";
import { syncHandoffRequirement } from "./lib/cleaners/handoff";
import { conflictsOf } from "./lib/cleaners/attention";

type Ctx = (QueryCtx | MutationCtx) & PortalAccess;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Maria S.": enough for a teammate to know who they are working with, and no more. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

/** The permanent crews they are in now, with their crewmates by short name. */
async function crewsOf(ctx: Ctx, cleaner: Doc<"cleaners">) {
  const mine = (
    await ctx.db
      .query("crewMemberships")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(50)
  ).filter((row) => row.to === undefined);
  const out = [];
  for (const row of mine) {
    const crew = await ctx.db.get(row.crewId);
    if (!crew || crew.status !== "active" || crew.kind !== "permanent") continue;
    const members = (
      await ctx.db
        .query("crewMemberships")
        .withIndex("by_company_crew", (q) => q.eq("companyId", ctx.companyId).eq("crewId", crew._id))
        .take(50)
    ).filter((item) => item.to === undefined && item.cleanerId !== cleaner._id);
    const names = [];
    for (const item of members) {
      const person = await ctx.db.get(item.cleanerId);
      if (person && person.status !== "ended") names.push(`${shortName(person.name)}${item.role === "lead" ? " (lead)" : ""}`);
    }
    out.push({ name: crew.name, lead: row.role === "lead", with: names });
  }
  return out;
}

function actorOf(ctx: Ctx): Actor {
  return { kind: "cleaner_portal", cleanerId: ctx.cleaner!._id, linkId: ctx.link._id };
}

function cleanerOf(ctx: Ctx): Doc<"cleaners"> {
  if (!ctx.cleaner) throw userError("This link is for a subcontractor company, not a cleaner.", "not_allowed");
  return ctx.cleaner;
}

/** The whole portal as the cleaner sees it. An expired or revoked link sees only that it is closed. */
export const view = portalQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const companyName = ctx.company.name;
    if (ctx.linkState !== "active") return { state: ctx.linkState, company: companyName } as const;
    if (ctx.link.holder === "subcontractor") return { state: "subcontractor" as const, company: companyName, name: ctx.subcontractor!.name };
    const cleaner = ctx.cleaner!;
    if (cleaner.status === "ended") return { state: "ended" as const, company: companyName };
    const tz = ctx.company.timezone;
    const now = args.asOf;
    const { readiness, windows } = await cleanerReadiness(ctx, ctx.company, cleaner, now);
    const today = startOfLocalDay(now, tz);
    const upcoming = ((await commitmentsBetween(ctx, ctx.company, today, addLocalDays(today, 21, tz))).get(cleaner._id) ?? []).filter((row) => row.endsAt > now).sort((a, b) => a.startsAt - b.startsAt);
    const jobs = [];
    for (const row of upcoming.slice(0, 15)) {
      const job = await ctx.db.get(row.jobId as Id<"jobs">);
      if (!job) continue;
      const property = await ctx.db.get(job.propertyId);
      const assignment = await ctx.db.get(row.assignmentId as Id<"assignments">);
      // A job's own page, through Dispatch's job link, only while the job is theirs and the link is live.
      let page: string | null = null;
      if (assignment && assignment.status === "accepted") {
        const link = await liveLink(ctx, assignment, "job");
        const token = link ? await tokenFor(link) : null;
        if (link && token) page = `${siteOrigin()}${linkPath("job", token)}`;
      }
      // Who else is on it, by first name and initial, once the job is theirs. A lead also sees the open places.
      let team: { with: string[]; lead: boolean; open: number; offersOut: number } | null = null;
      if (assignment && assignment.status === "accepted" && requiredCrew(job) > 1) {
        const all = await jobAssignments(ctx, job);
        const others = [];
        for (const other of all.filter((item) => item.status === "accepted" && item.cleanerId !== cleaner._id)) {
          const person = await ctx.db.get(other.cleanerId);
          if (person) others.push(`${shortName(person.name)}${other.role === "lead" ? " (lead)" : ""}`);
        }
        const staff = staffing(job, all);
        team = { with: others, lead: assignment.role === "lead", open: staff.open, offersOut: staff.offersOut };
      }
      jobs.push({
        id: row.assignmentId,
        startsAt: job.startsAt,
        endsAt: job.endsAt,
        service: job.serviceType,
        status: row.status,
        /** The area for an offer; the street only once they have accepted and the job is still theirs. */
        where: row.status === "accepted" && property ? `${property.address.line1}, ${property.address.city}` : property ? `${property.address.city} ${property.address.postalCode}` : null,
        page,
        team,
      });
    }
    const past = [];
    const accepted = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).eq("status", "accepted"))
      .order("desc")
      .take(40);
    for (const row of accepted) {
      const job = await ctx.db.get(row.jobId);
      if (job && job.endsAt <= now && job.startsAt > now - 45 * DAY) past.push({ id: row._id, startsAt: job.startsAt, service: job.serviceType, status: job.status });
    }
    const time = await cleanerTime(ctx, ctx.company, cleaner._id, today);
    const claims = await ctx.db
      .query("skillClaims")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(50);
    const agreements = [];
    const links = await ctx.db
      .query("agreementLinks")
      .withIndex("by_company_record", (q) => q.eq("companyId", ctx.companyId).eq("table", "cleaners").eq("recordId", cleaner._id))
      .take(20);
    for (const link of links) {
      const agreement = await ctx.db.get(link.agreementId);
      // Only an agreement they are a party to, and only once it was sent to them: drafts are the company's own work.
      if (!agreement || agreement.companyId !== ctx.companyId) continue;
      if (!agreement.parties.some((party) => party.record?.table === "cleaners" && party.record.id === cleaner._id)) continue;
      if (!["sent", "partially_signed", "signed"].includes(agreement.workflow)) continue;
      agreements.push({ id: agreement._id, title: agreement.title, state: agreement.workflow === "signed" ? "Signed" : "Waiting for signatures" });
    }
    const shared = await ctx.db
      .query("coachingNotes")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(30);
    const contact = channelsFor(cleaner, ["sms", "email"]);
    return {
      state: "active" as const,
      company: companyName,
      timezone: tz,
      name: cleaner.name,
      firstName: first(cleaner.name),
      purpose: ctx.link.purpose,
      focus: ctx.link.requirementKey ?? null,
      allowed: ctx.link.allowed,
      expiresAt: ctx.link.expiresAt,
      engagement: cleaner.status === "onboarding" ? "onboarding" : cleaner.status === "ready" ? "active" : "paused",
      readiness: { state: readiness.state, eligible: readiness.eligible, summary: readiness.summary, progress: readiness.progress },
      // What they are asked to do. Review notes are shown only when a reviewer asked for a change; waiver reasons never.
      steps: readiness.requirements.map((view) => ({ key: view.key, label: view.label, description: view.description ?? null, kind: view.kind, state: view.state, met: view.met, mine: view.cleanerCompletes, forWork: view.effect === "blocks_assignments", changes: view.state === "needs_changes" ? (view.reviewNote ?? null) : null })),
      contact: { phone: cleaner.phone ?? null, email: cleaner.email ?? null },
      availability: {
        windows: windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })),
        confirmedAt: cleaner.availabilityConfirmedAt ?? null,
        timeAway: time.timeOff.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, note: row.note ?? null })),
        exceptions: time.exceptions.map((row) => ({ date: row.date, kind: row.kind, startMinute: row.startMinute ?? null, endMinute: row.endMinute ?? null })),
      },
      areas: cleaner.serviceAreas,
      skills: cleaner.skills,
      claimedSkills: claims.filter((row) => row.status === "claimed").map((row) => row.skill),
      jobs,
      past: past.slice(0, 15),
      crews: await crewsOf(ctx, cleaner),
      agreements,
      feedback: shared.filter((row) => row.visibility === "shared" && row.sharedAt && row.status !== "withdrawn" && row.status !== "draft").map((row) => ({ id: row._id, title: row.title, body: row.body, at: row.sharedAt!, response: row.response?.text ?? null, actions: row.actions.map((item) => item.text) })),
      verified: isVerified(ctx.link, now),
      codeTo: contact[0] ? maskAddress(contact[0], contact[0] === "sms" ? cleaner.phone! : cleaner.email!) : null,
    };
  },
});

// ── Onboarding steps ─────────────────────────────────────────────────────────────────────────────

async function requirementRow(ctx: MutationCtx & PortalAccess, key: string): Promise<Doc<"workerRequirements">> {
  const cleaner = cleanerOf(ctx);
  // A task link opens one step; it cannot be used for another.
  if (ctx.link.requirementKey && ctx.link.requirementKey !== key) throw userError("This link is for a different step.", "not_allowed");
  const row = (
    await ctx.db
      .query("workerRequirements")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).eq("key", key))
      .take(1)
  )[0];
  if (!row) throw userError("That step is not part of your onboarding.");
  return row;
}

/**
 * Confirms the phone and email the company uses. Unchanged details are confirmed by the person holding the
 * link; a change waits for the office. Agreeing to work texts is the person's own act, recorded with its words.
 */
export const confirmContact = portalMutation({
  action: "confirm_contact",
  args: { phone: v.optional(v.string()), email: v.optional(v.string()), workTexts: v.boolean() },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    const row = await requirementRow(ctx, "contact").catch(() => null);
    const phone = optionalText(args.phone, "Phone", 40);
    const email = optionalEmail(args.email);
    const digits = (value?: string) => value?.replace(/\D/g, "").slice(-10) ?? "";
    const changed = digits(phone) !== digits(cleaner.phone) || (email ?? "") !== (cleaner.email ?? "");
    if (args.workTexts) {
      if (!phone && !cleaner.phone) throw userError("Add a mobile number to get work texts.");
      await setPermission(ctx, {
        companyId: ctx.companyId,
        recipient: { kind: "cleaner", id: cleaner._id },
        channel: "sms",
        category: "operational",
        status: "granted",
        source: "onboarding",
        disclosureText: cleanerTextWording(ctx.company.name),
        evidence: "Given by the cleaner in their portal.",
        recordedBy: { kind: "recipient" },
        at: Date.now(),
        actor: actorOf(ctx),
      });
    }
    if (!row) return { status: "recorded" as const };
    const now = Date.now();
    if (changed) {
      await ctx.db.patch(row._id, { status: "awaiting_review", evidence: { text: `New details: ${[phone, email].filter(Boolean).join(", ")}` }, submittedAt: now, submittedBy: { kind: "cleaner", linkId: ctx.link._id }, updatedAt: now });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.requirement_submitted", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { key: "contact" } });
      return { status: "awaiting_review" as const };
    }
    // The link reached them at these details, and they say they are right: that is the confirmation.
    await ctx.db.patch(row._id, { status: "accepted", submittedAt: now, submittedBy: { kind: "cleaner", linkId: ctx.link._id }, acceptedAt: now, reviewNote: "Confirmed by the cleaner through their own link.", updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.requirement_accepted", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { key: "contact" } });
    await syncHandoffRequirement(ctx, cleaner, "contact", true, actorOf(ctx), "Confirmed by the cleaner.");
    return { status: "accepted" as const };
  },
});

export const uploadUrl = portalMutation({
  action: "submit_requirement",
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/** Sends files or a few words for one step. It waits for a person: an upload is never a verification. */
export const submitRequirement = portalMutation({
  action: "submit_requirement",
  args: { key: v.string(), text: v.optional(v.string()), storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const row = await requirementRow(ctx, args.key);
    const definitions = (await cleanerReadiness(ctx, ctx.company, cleanerOf(ctx), Date.now())).definitions;
    const def = definitions.find((item) => item.key === args.key);
    if (!def?.cleanerCompletes) throw userError("The office records this step.");
    if (def.kind === "acknowledgment" || def.kind === "contact" || def.kind === "availability" || def.kind === "service_areas" || def.kind === "agreement") throw userError("This step is done a different way.");
    await recordSubmission(ctx, row, { text: args.text, storageIds: args.storageIds }, { kind: "cleaner", linkId: ctx.link._id }, actorOf(ctx));
    return { status: "awaiting_review" as const };
  },
});

/** Acknowledging the company's policies is the person's own act, so it is complete when they do it. */
export const acknowledge = portalMutation({
  action: "acknowledge",
  /** `words`: what the page showed them. An agreement is to exact words, so older words cannot be agreed to. */
  args: { key: v.string(), words: v.string() },
  handler: async (ctx, args) => {
    const row = await requirementRow(ctx, args.key);
    const def = (await cleanerReadiness(ctx, ctx.company, cleanerOf(ctx), Date.now())).definitions.find((item) => item.key === args.key);
    if (def?.kind !== "acknowledgment") throw userError("This step is not an acknowledgment.");
    const current = (def.description ?? "").trim();
    if (args.words.trim() !== current) throw userError("What you are agreeing to changed since this page opened. Read it again, then agree.");
    const now = Date.now();
    if (row.status === "accepted" && acknowledgmentHolds(def, row) && (row.expiresAt === undefined || row.expiresAt > now)) return null;
    await ctx.db.patch(row._id, { status: "accepted", submittedAt: now, submittedBy: { kind: "cleaner", linkId: ctx.link._id }, acceptedAt: now, acknowledged: { words: current, at: now }, reviewNote: "Acknowledged by the cleaner through their own link.", expiresAt: def.validForDays ? now + def.validForDays * DAY : undefined, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.requirement_accepted", actor: actorOf(ctx), subject: { table: "cleaners", id: row.cleanerId }, data: { key: args.key } });
    await syncHandoffRequirement(ctx, cleanerOf(ctx), args.key, true, actorOf(ctx), "Acknowledged by the cleaner.");
    return null;
  },
});

// ── Availability ─────────────────────────────────────────────────────────────────────────────────

const windowValidator = v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() });

/** Replaces their weekly hours with what they say now, and counts as confirming them. */
export const setAvailability = portalMutation({
  action: "set_availability",
  args: { windows: v.array(windowValidator), areas: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    if (args.windows.length > 30) throw userError("That is too many windows for one week.");
    for (const window of args.windows) {
      const whole = [window.weekday, window.startMinute, window.endMinute].every(Number.isInteger);
      if (!whole || window.weekday < 0 || window.weekday > 6 || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) throw userError("Each day needs a start time before its end time.");
    }
    const old = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    for (const row of old) await ctx.db.delete(row._id);
    for (const window of args.windows) await ctx.db.insert("availabilityWindows", { companyId: ctx.companyId, cleanerId: cleaner._id, ...window });
    const patch: Partial<Doc<"cleaners">> = { availabilityConfirmedAt: Date.now(), updatedAt: Date.now() };
    if (args.areas !== undefined) patch.serviceAreas = tags(args.areas, "Service areas", 50).map((code) => code.toUpperCase());
    await ctx.db.patch(cleaner._id, patch);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_set", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { windows: args.windows.length, from: "portal" } });
    return { impact: await impactOf(ctx, cleaner) };
  },
});

/** "These hours are still right." */
export const confirmAvailability = portalMutation({
  action: "confirm_availability",
  args: {},
  handler: async (ctx) => {
    const cleaner = cleanerOf(ctx);
    await ctx.db.patch(cleaner._id, { availabilityConfirmedAt: Date.now(), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_confirmed", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id } });
    return null;
  },
});

/** Accepted jobs that the cleaner's new hours or time away would clash with. Nothing is changed: the office decides. */
async function impactOf(ctx: MutationCtx & PortalAccess, cleaner: Doc<"cleaners">): Promise<string[]> {
  return currentClashes(ctx, ctx.company, cleaner._id);
}

export const addTimeAway = portalMutation({
  action: "add_time_away",
  args: { startsAt: v.number(), endsAt: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    if (!Number.isSafeInteger(args.startsAt) || !Number.isSafeInteger(args.endsAt) || args.startsAt >= args.endsAt) throw userError("Time away must start before it ends.");
    if (args.endsAt <= Date.now()) throw userError("Time away has to be in the future.");
    if (args.endsAt - args.startsAt > 120 * DAY) throw userError("For more than four months away, talk to the office.");
    await ctx.db.insert("timeOff", { companyId: ctx.companyId, cleanerId: cleaner._id, startsAt: args.startsAt, endsAt: args.endsAt, note: optionalText(args.note, "Note", 300), source: "cleaner", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_added", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { startsAt: args.startsAt, endsAt: args.endsAt, from: "portal" } });
    const impact = await impactOf(ctx, cleaner);
    // Jobs they accepted are not dropped by this. The office is told, and decides.
    if (impact.length > 0) {
      await openTask(ctx, {
        companyId: ctx.companyId,
        agent: "dispatch",
        title: `${cleaner.name} will be away during accepted work`,
        nextAction: `They added time away that clashes with: ${impact.join("; ")}. Talk with them, then keep or cover each job in Dispatch.`,
        dueAt: Date.now() + 12 * HOUR,
        completionCondition: "Each clashing job is kept or covered by a person",
        about: { table: "cleaners", id: cleaner._id },
        key: `cleaners.time_away:${cleaner._id}:${args.startsAt}`,
        actor: actorOf(ctx),
      });
    }
    return { impact };
  },
});

export const addException = portalMutation({
  action: "add_exception",
  args: { date: v.string(), kind: v.union(v.literal("unavailable"), v.literal("available")), startMinute: v.optional(v.number()), endMinute: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || args.date < localParts(Date.now(), ctx.company.timezone).day) throw userError("Choose today or a later date.");
    if ((args.startMinute === undefined) !== (args.endMinute === undefined)) throw userError("Give both a start and an end, or neither for the whole day.");
    if (args.startMinute !== undefined && (!Number.isInteger(args.startMinute) || !Number.isInteger(args.endMinute) || args.startMinute < 0 || args.endMinute! > 1440 || args.startMinute >= args.endMinute!)) throw userError("The start must be before the end.");
    await ctx.db.insert("availabilityExceptions", { companyId: ctx.companyId, cleanerId: cleaner._id, date: args.date, kind: args.kind, startMinute: args.startMinute, endMinute: args.endMinute, note: optionalText(args.note, "Note", 300), by: { kind: "cleaner", linkId: ctx.link._id }, createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.exception_added", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { date: args.date, kind: args.kind } });
    return { impact: await impactOf(ctx, cleaner) };
  },
});

// ── Skills and help ──────────────────────────────────────────────────────────────────────────────

/** A skill they say they have. It counts for jobs once a person confirms it. */
export const claimSkill = portalMutation({
  action: "claim_skill",
  args: { skill: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    const skill = text(args.skill, "The skill", 60).toLowerCase();
    if (cleaner.skills.includes(skill)) return null;
    const existing = await ctx.db
      .query("skillClaims")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    if (existing.some((row) => row.skill === skill && row.status === "claimed")) return null;
    if (existing.filter((row) => row.status === "claimed").length >= 15) throw userError("The office has a few to look at already.");
    await ctx.db.insert("skillClaims", { companyId: ctx.companyId, cleanerId: cleaner._id, skill, note: optionalText(args.note, "Note", 300), status: "claimed", claimedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.skill_claimed", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { skill } });
    return null;
  },
});

/** A question for the office. It becomes a task a person answers; nothing is decided from it. */
export const askForHelp = portalMutation({
  action: "ask_for_help",
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    const words = text(args.text, "Your question", 600);
    await openTask(ctx, {
      companyId: ctx.companyId,
      agent: "recruiter",
      title: `${cleaner.name} asked for help`,
      nextAction: `They wrote from their portal: "${words.slice(0, 400)}" Reply to them directly.`,
      dueAt: Date.now() + DAY,
      completionCondition: "A person replied to them",
      about: { table: "cleaners", id: cleaner._id },
      // Named, so routine reminders can see the question is open and wait for a person's reply.
      key: helpKey(cleaner._id),
      actor: actorOf(ctx),
    });
    return null;
  },
});

// ── Pay, after a one-time code ───────────────────────────────────────────────────────────────────

/** Sends a six-digit code to the phone or email on file. Only its hash is kept; the code travels once. */
export const requestCode = portalMutation({
  action: "request_code",
  args: {},
  handler: async (ctx) => {
    const cleaner = cleanerOf(ctx);
    const now = Date.now();
    const recent = await ctx.db
      .query("portalCodes")
      .withIndex("by_link", (q) => q.eq("linkId", ctx.link._id).gt("createdAt", now - CODE_WINDOW))
      .take(10);
    if (recent.length >= CODES_PER_WINDOW) throw userError("Several codes were sent just now. Wait a few minutes and try again.", "limit");
    const channel = channelsFor(cleaner, cleanersSettings(ctx.company).followUpChannels)[0];
    if (!channel) throw userError("There is no phone or email on file to send a code to. Ask the office.");
    const code = newCode();
    const codeId = await ctx.db.insert("portalCodes", { companyId: ctx.companyId, linkId: ctx.link._id, codeHash: await codeHash(ctx.link._id, code), channel, expiresAt: now + CODE_LIFETIME, attempts: 0, createdAt: now });
    const message = await queueCleanerMessage(
      ctx,
      {
        company: ctx.company,
        cleaner,
        channel,
        purpose: "verification_code",
        subject: `Your ${ctx.company.name} code`,
        body: channel === "sms" ? `${ctx.company.name}: your code is {code}. It works for 10 minutes. Do not share it.` : `Your code is {code}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.\n\n${ctx.company.name}`,
        dedupeKey: `portal.code:${codeId}`,
        actor: actorOf(ctx),
      },
      { code },
    );
    await ctx.db.patch(codeId, { messageId: message._id });
    if (message.status === "not_sent") throw userError(`The code could not be sent: ${message.problem ?? "sending is not set up"} Ask the office.`);
    return { sentTo: maskAddress(channel, channel === "sms" ? cleaner.phone! : cleaner.email!) };
  },
});

export const verifyCode = portalMutation({
  action: "verify_code",
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const latest = await ctx.db
      .query("portalCodes")
      .withIndex("by_link", (q) => q.eq("linkId", ctx.link._id))
      .order("desc")
      .first();
    if (!latest || latest.usedAt !== undefined || latest.expiresAt <= now) throw userError("That code has expired. Ask for a new one.");
    if (latest.attempts >= CODE_ATTEMPTS) throw userError("Too many tries. Ask for a new code.", "limit");
    await ctx.db.patch(latest._id, { attempts: latest.attempts + 1 });
    if ((await codeHash(ctx.link._id, args.code.trim())) !== latest.codeHash) throw userError("That code is not right. Check the latest message and try again.");
    await ctx.db.patch(latest._id, { usedAt: now });
    await ctx.db.patch(ctx.link._id, { verifiedUntil: now + VERIFIED_FOR });
    return null;
  },
});

/** Their pay arrangement and the pay each job stated, once a code unlocked it. What was approved and paid is on their Team Pay earnings statement. */
export const earnings = portalQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    if (ctx.linkState !== "active" || !ctx.cleaner) return null;
    if (!isVerified(ctx.link, args.asOf)) return { locked: true as const };
    const cleaner = ctx.cleaner;
    const sub = cleaner.subcontractorId ? await ctx.db.get(cleaner.subcontractorId) : null;
    const accepted = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).eq("status", "accepted"))
      .order("desc")
      .take(100);
    const jobs = [];
    for (const row of accepted) {
      const job = await ctx.db.get(row.jobId);
      if (job && job.startsAt > args.asOf - 60 * DAY && job.startsAt <= args.asOf) jobs.push({ id: row._id, startsAt: job.startsAt, service: job.serviceType, payCents: row.payCents, status: job.status });
    }
    return {
      locked: false as const,
      arrangement: sub ? `Paid through ${sub.name}` : cleaner.pay ? payMethodWords(cleaner.pay, ctx.company.payTiers) : "Not set yet. Ask the office.",
      jobs,
      note: "These are the amounts each job's offer stated. The office reviews, approves and pays each job; ask them for your earnings statement link to see what was approved and paid.",
    };
  },
});

// ── Feedback ─────────────────────────────────────────────────────────────────────────────────────

/** Their reply to feedback the company shared with them. It is kept beside the feedback, in their words. */
export const respondToFeedback = portalMutation({
  action: "respond_feedback",
  args: { noteId: v.id("coachingNotes"), text: v.string() },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    const note = await ctx.db.get(args.noteId);
    if (!note || note.companyId !== ctx.companyId || note.cleanerId !== cleaner._id || note.visibility !== "shared" || !note.sharedAt || note.status === "withdrawn") throw userError("That feedback is not yours to answer.", "not_found");
    await ctx.db.patch(note._id, { response: { text: text(args.text, "Your reply", 2000), at: Date.now() }, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.feedback_answered", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { noteId: note._id } });
    return null;
  },
});

// ── Check-ins and their own record ───────────────────────────────────────────────────────────────

const CHECK_IN_WORDS = { available: "still available for work", fewer: "available, for fewer jobs", break: "taking a break", stop: "wanting to stop working with the company" } as const;

/**
 * Their answer to "are you still available?". A break is recorded as time away, so no work is offered then.
 * Wanting to stop opens a task for a person: the engagement is never ended by an answer here.
 */
export const respondCheckIn = portalMutation({
  action: "respond_check_in",
  args: { answer: v.union(v.literal("available"), v.literal("fewer"), v.literal("break"), v.literal("stop")), until: v.optional(v.number()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    const now = Date.now();
    const note = optionalText(args.note, "Note", 500);
    if (args.answer === "break") {
      if (args.until === undefined || !Number.isSafeInteger(args.until) || args.until <= now) throw userError("Say when you expect to be back.");
      if (args.until - now > 365 * DAY) throw userError("For more than a year away, talk to the office.");
    }
    await ctx.db.patch(cleaner._id, { checkIn: { answer: args.answer, at: now, until: args.answer === "break" ? args.until : undefined, note }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.checked_in", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { answer: args.answer, until: args.until ?? null } });
    let impact: string[] = [];
    if (args.answer === "break") {
      await ctx.db.insert("timeOff", { companyId: ctx.companyId, cleanerId: cleaner._id, startsAt: now, endsAt: args.until!, note: note ?? "Taking a break", source: "cleaner", createdAt: now });
      impact = await impactOf(ctx, cleaner);
    }
    if (args.answer === "stop" || impact.length > 0) {
      await openTask(ctx, {
        companyId: ctx.companyId,
        agent: "dispatch",
        title: args.answer === "stop" ? `${cleaner.name} said they want to stop working with you` : `${cleaner.name} is taking a break during accepted work`,
        nextAction:
          args.answer === "stop"
            ? `They answered a check-in from their portal${note ? `: "${note.slice(0, 300)}"` : ""}. Talk with them. Ending the engagement is a request the Owner decides; nothing has changed yet.`
            : `They are taking a break until ${new Date(args.until!).toISOString().slice(0, 10)}, which clashes with: ${impact.join("; ")}. Keep or cover each job in Dispatch.`,
        dueAt: now + DAY,
        completionCondition: args.answer === "stop" ? "A person has spoken with them" : "Each clashing job is kept or covered by a person",
        about: { table: "cleaners", id: cleaner._id },
        key: `cleaners.check_in:${cleaner._id}:${now}`,
        actor: actorOf(ctx),
      });
    }
    return { words: `Thanks. The office knows you are ${CHECK_IN_WORDS[args.answer]}.`, impact };
  },
});

/** "This record is wrong." The record is left out of their measures until a person decides. */
export const disputeRecord = portalMutation({
  action: "dispute",
  args: { assignmentId: v.id("assignments"), reason: v.string() },
  handler: async (ctx, args) => {
    const cleaner = cleanerOf(ctx);
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment || assignment.companyId !== ctx.companyId || assignment.cleanerId !== cleaner._id) throw userError("Not found.", "not_found");
    const reason = text(args.reason, "What is wrong", 1000);
    const open = (
      await ctx.db
        .query("recordDisputes")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
        .take(200)
    ).find((row) => row.assignmentId === assignment._id && row.status === "open");
    if (open) return { disputeId: open._id, already: true };
    const disputeId = await ctx.db.insert("recordDisputes", { companyId: ctx.companyId, cleanerId: cleaner._id, assignmentId: assignment._id, measure: "all", raisedBy: { kind: "cleaner", linkId: ctx.link._id }, reason, status: "open", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.record_disputed", actor: actorOf(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { assignmentId: assignment._id, measure: "all" } });
    return { disputeId, already: false };
  },
});
