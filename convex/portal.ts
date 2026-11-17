/**
 * The cleaner portal (docs/cleaners/00-architecture.md). Before the code, a link shows only the company
 * and the cleaner's first name. After it, a session on the device lets the cleaner work their onboarding,
 * say when they can work, see their jobs, and ask for help. Pay needs a code confirmed in the last few
 * minutes. Every function here reaches only the session's own cleaner.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { availabilityFor, overlaps } from "./lib/availability";
import { portalLinkMutation, portalLinkQuery, portalMutation, portalQuery, type PortalAccess } from "./lib/builders";
import { liveLink, tokenFor } from "./lib/dispatch/links";
import { money } from "./lib/dispatch/pay";
import { notFound, userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";
import { queueMessage } from "./lib/messaging/outbox";
import { sendablePhone } from "./lib/messaging/provider";
import { allow } from "./lib/rateLimit";
import { instant, optionalText } from "./lib/text";
import { clock, dayName, when } from "./lib/time";
import { readinessOf } from "./lib/workforce/readiness";
import { checkWindows } from "./lib/workforce/records";
import { acknowledge, attachDocument, markDone, markStarted } from "./lib/workforce/requirementWrites";
import { factDetail, requirementCheck, workerFacts } from "./lib/workforce/requirements";
import { checkCode, maskedPhone, newCode, openSession, steppedUp, STEP_UP_MINUTES } from "./lib/workforce/portal";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const asCleaner = (cleanerId: Id<"cleaners">): Actor => ({ kind: "cleaner_portal", cleanerId });

// ── Before the code ──────────────────────────────────────────────────────────────────────────────

/** What a link may show before the code: whether it works, the company, and a first name. Nothing else. */
export const link = portalLinkQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.portal) return { state: "unknown" as const, company: null, firstName: null, phoneHint: null, canText: false, purpose: null };
    const { link, state, company, cleaner } = ctx.portal;
    return {
      state: cleaner.status === "ended" ? ("revoked" as const) : state,
      company: company.name,
      firstName: firstName(cleaner.preferredName ?? cleaner.name),
      phoneHint: maskedPhone(cleaner.phone),
      canText: sendablePhone(cleaner.phone) !== null,
      purpose: link.purpose,
    };
  },
});

async function textCode(ctx: MutationCtx, input: { link: Doc<"portalLinks">; cleaner: Doc<"cleaners">; company: Doc<"companies"> }) {
  if (!(await allow(ctx, `portal.code:${input.link._id}`, 5, HOUR))) return { status: "too_many" as const, problem: "Too many codes in the last hour. Wait a little, then try again." };
  if (!sendablePhone(input.cleaner.phone)) return { status: "not_sent" as const, problem: "There is no mobile number on your record. Ask the office to add it." };
  const code = await newCode(ctx, input.link);
  const message = await queueMessage(ctx, {
    companyId: input.company._id,
    purpose: "portal_code",
    cleaner: input.cleaner,
    portalCodeId: code._id,
    body: `${input.company.name}: your portal code is {code}. It works for 10 minutes. Nobody from ${input.company.name} will ask you for it.`,
    dedupeKey: `portal.code:${code._id}`,
    actor: asCleaner(input.cleaner._id),
  });
  if (message.status === "not_sent" || message.status === "failed") return { status: "not_sent" as const, problem: message.problem ?? "The code could not be texted. Ask the office for help." };
  if (message.status === "held") return { status: "held" as const, problem: message.problem ?? "Texts are held right now. The code goes out when that ends." };
  return { status: "sent" as const, problem: null };
}

/** Texts a code to the phone on the cleaner's record. The phone is never given by the person asking. */
export const sendCode = portalLinkMutation({
  args: {},
  handler: async (ctx) => textCode(ctx, ctx.portal),
});

const CODE_WORDS = { no_code: "Ask for a code first.", expired: "That code has expired. Ask for a new one.", too_many: "Too many tries. Ask for a new code.", wrong: "That code is not right. Check the text and try again." };

/** Confirms the code and opens a session on this device. The session token is returned once and never stored. */
export const verify = portalLinkMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const result = await checkCode(ctx, ctx.portal.link, args.code.slice(0, 12));
    if (!result.ok) return { status: result.reason, message: CODE_WORDS[result.reason], session: null };
    const session = await openSession(ctx, ctx.portal.link);
    await recordEvent(ctx, { companyId: ctx.portal.company._id, type: "cleaner.portal_verified", actor: asCleaner(ctx.portal.cleaner._id), subject: { table: "cleaners", id: ctx.portal.cleaner._id } });
    return { status: "ok" as const, message: null, session, requirementId: ctx.portal.link.requirementId ?? null };
  },
});

// ── After the code ───────────────────────────────────────────────────────────────────────────────

const STATE_WORDS: Record<string, string> = {
  not_started: "To do",
  submitted: "Started",
  awaiting_review: "Sent, waiting for review",
  accepted: "Done",
  needs_changes: "Needs changes",
  expired: "Expired",
};

async function tasksFor(ctx: QueryCtx & PortalAccess, now: number) {
  const facts = await workerFacts(ctx, ctx.cleaner, now);
  return facts.map((fact) => ({
    requirementId: fact.requirement._id,
    label: fact.requirement.label,
    kind: fact.requirement.kind,
    instructions: fact.requirement.instructions ?? null,
    statement: fact.requirement.statement ?? null,
    state: fact.waived ? "accepted" : fact.state,
    stateWords: fact.waived ? "Not needed" : STATE_WORDS[fact.state],
    // Only what is meant for the cleaner: the reviewer's words, never internal notes.
    feedback: fact.row?.feedback ?? null,
    expiresWords: fact.row?.expiresAt ? dayName(fact.row.expiresAt, ctx.company.timezone) : null,
    files: fact.row?.documentIds.length ?? 0,
    blocksWork: fact.requirement.blocks === "assignments" && !fact.met,
    detail: factDetail(fact, ctx.company.timezone),
  }));
}

/** Everything the portal's home shows, for the session's own cleaner. */
export const home = portalQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const now = instant(args.asOf, "The time");
    const tz = ctx.company.timezone;
    const cleaner = ctx.cleaner;
    const facts = await workerFacts(ctx, cleaner, now);
    const windows = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(60);
    const timeOff = await ctx.db
      .query("timeOff")
      .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).gt("endsAt", now))
      .take(30);
    const readiness = readinessOf({
      status: cleaner.status,
      engagement: cleaner.engagement,
      phone: cleaner.phone,
      email: cleaner.email,
      serviceAreas: cleaner.serviceAreas,
      skills: cleaner.skills,
      windowCount: windows.length,
      hasPay: cleaner.pay !== undefined,
      workTexts: "granted",
      subcontractor: null,
      handoffOutstanding: [],
      requirementChecks: facts.map((fact) => requirementCheck(fact, tz)),
    });
    const jobs = [];
    for (const status of ["accepted", "offered"] as const) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).eq("status", status))
        .take(200);
      for (const assignment of assignments) {
        const job = await ctx.db.get(assignment.jobId);
        if (!job || job.companyId !== ctx.companyId || job.endsAt < now || job.startsAt > now + 30 * DAY || job.status === "cancelled" || job.status === "completed") continue;
        const property = await ctx.db.get(job.propertyId);
        // The job's own link, the way into its address and checklist, only for work they accepted.
        const jobLink = status === "accepted" ? await liveLink(ctx, assignment, "job") : null;
        const offerLink = status === "offered" ? await liveLink(ctx, assignment, "offer") : null;
        jobs.push({
          assignmentId: assignment._id,
          startsAt: job.startsAt,
          when: `${when(job.startsAt, now, tz)} – ${clock(job.endsAt, tz)}`,
          service: job.serviceType,
          area: property ? `${property.address.city} ${property.address.postalCode}` : "",
          status,
          jobToken: jobLink ? await tokenFor(jobLink) : null,
          offerToken: offerLink ? await tokenFor(offerLink) : null,
        });
      }
    }
    const help = await ctx.db
      .query("helpRequests")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open"))
      .take(200);
    // What blocks work, in words for the cleaner. The office's own checks (pay, areas) are named, never their values.
    const waitingWords: Record<string, string> = { awaiting_review: "sent, the office is reviewing it", needs_changes: "the office asked for changes", expired: "it has expired, send a new one", submitted: "started, not finished yet", not_started: "to do" };
    const blocking = readiness.blockers
      .filter((check) => check.key !== "active")
      .map((check) => {
        if (check.key === "pay") return "The office still has to set up your pay";
        if (check.key === "hours") return "Tell us when you can work";
        if (check.key === "service_areas") return "The office still has to set the areas you work in";
        const fact = facts.find((item) => `req:${item.requirement._id}` === check.key);
        return fact ? `${check.label}: ${waitingWords[fact.state] ?? "to do"}` : check.label;
      });
    return {
      firstName: firstName(cleaner.preferredName ?? cleaner.name),
      company: ctx.company.name,
      timezone: tz,
      status: cleaner.status,
      ready: readiness.state === "ready",
      blocking,
      tasks: await tasksFor(ctx, now),
      windows: windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute })).sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute),
      timeOff: timeOff.map((row) => ({ id: row._id, words: `${dayName(row.startsAt, tz)} ${clock(row.startsAt, tz)} – ${dayName(row.endsAt, tz)} ${clock(row.endsAt, tz)}`, note: row.note ?? null })),
      jobs: jobs.sort((a, b) => a.startsAt - b.startsAt),
      openHelp: help.filter((row) => row.cleanerId === cleaner._id).length,
      steppedUp: steppedUp(ctx.session, now),
    };
  },
});

async function ownRequirement(ctx: MutationCtx & PortalAccess, requirementId: Id<"onboardingRequirements">): Promise<Doc<"onboardingRequirements">> {
  const requirement = await ctx.db.get(requirementId);
  if (!requirement || requirement.companyId !== ctx.companyId) notFound();
  return requirement;
}

/** The cleaner agrees to a requirement's exact words, as the page showed them. */
export const acknowledgeTask = portalMutation({
  args: { requirementId: v.id("onboardingRequirements"), statement: v.string() },
  handler: async (ctx, args) => {
    await acknowledge(ctx, ctx.cleaner, await ownRequirement(ctx, args.requirementId), ctx.cleaner._id, args.statement);
    return null;
  },
});

export const startTask = portalMutation({
  args: { requirementId: v.id("onboardingRequirements") },
  handler: async (ctx, args) => {
    await markStarted(ctx, ctx.cleaner, await ownRequirement(ctx, args.requirementId), { kind: "cleaner", cleanerId: ctx.cleaner._id });
    return null;
  },
});

export const finishTask = portalMutation({
  args: { requirementId: v.id("onboardingRequirements") },
  handler: async (ctx, args) => {
    const requirement = await ownRequirement(ctx, args.requirementId);
    if (requirement.kind === "payment_setup") throw userError("Payment setup is confirmed by the office once it is complete. Tell them you finished.");
    await markDone(ctx, ctx.cleaner, requirement, { kind: "cleaner", cleanerId: ctx.cleaner._id });
    return null;
  },
});

export const uploadUrl = portalMutation({
  args: {},
  handler: async (ctx) => {
    if (!(await allow(ctx, `portal.upload:${ctx.cleaner._id}`, 30, HOUR))) throw userError("Too many uploads in the last hour. Try again later.", "limit");
    return ctx.storage.generateUploadUrl();
  },
});

export const attachFile = portalMutation({
  args: { requirementId: v.id("onboardingRequirements"), storageId: v.id("_storage"), fileName: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    await attachDocument(ctx, ctx.cleaner, await ownRequirement(ctx, args.requirementId), { kind: "cleaner", cleanerId: ctx.cleaner._id }, { storageId: args.storageId, fileName: args.fileName, clientKey: args.clientKey });
    return null;
  },
});

async function acceptedAhead(ctx: MutationCtx & PortalAccess, now: number) {
  const out = [];
  const assignments = await ctx.db
    .query("assignments")
    .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", ctx.cleaner._id).eq("status", "accepted"))
    .take(200);
  for (const assignment of assignments) {
    const job = await ctx.db.get(assignment.jobId);
    if (job && job.companyId === ctx.companyId && job.endsAt > now && job.status === "scheduled") out.push(job);
  }
  return out;
}

/**
 * The cleaner replaces the hours they can work. Visits they already accepted are never changed: the ones
 * the new hours no longer cover are listed back to them, and the office sees the same list.
 */
export const setHours = portalMutation({
  args: { windows: v.array(v.object({ weekday: v.number(), startMinute: v.number(), endMinute: v.number() })) },
  handler: async (ctx, args) => {
    const windows = checkWindows(args.windows);
    const old = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", ctx.cleaner._id))
      .take(100);
    for (const row of old) await ctx.db.delete(row._id);
    for (const window of windows) await ctx.db.insert("availabilityWindows", { companyId: ctx.companyId, cleanerId: ctx.cleaner._id, ...window });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.availability_set", actor: asCleaner(ctx.cleaner._id), subject: { table: "cleaners", id: ctx.cleaner._id }, data: { windows: windows.length } });
    const now = Date.now();
    const affected = (await acceptedAhead(ctx, now)).filter((job) => !availabilityFor({ windows, timeOff: [], booked: [], span: job, timezone: ctx.company.timezone }).available);
    return { affected: affected.map((job) => `${job.serviceType}, ${when(job.startsAt, now, ctx.company.timezone)}`) };
  },
});

/** The cleaner records time away. Accepted visits in that time stay theirs until the office decides; they are listed back. */
export const addTimeAway = portalMutation({
  args: { startsAt: v.number(), endsAt: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const startsAt = instant(args.startsAt, "The start");
    const endsAt = instant(args.endsAt, "The end");
    if (startsAt >= endsAt) throw userError("Time away must start before it ends.");
    if (endsAt - startsAt > 120 * DAY) throw userError("For more than four months away, talk to the office.");
    if (endsAt < Date.now()) throw userError("That time has already passed.");
    await ctx.db.insert("timeOff", { companyId: ctx.companyId, cleanerId: ctx.cleaner._id, startsAt, endsAt, note: optionalText(args.note, "Note", 300) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_added", actor: asCleaner(ctx.cleaner._id), subject: { table: "cleaners", id: ctx.cleaner._id }, data: { startsAt, endsAt } });
    const now = Date.now();
    const affected = (await acceptedAhead(ctx, now)).filter((job) => overlaps(job, { startsAt, endsAt }));
    return { affected: affected.map((job) => `${job.serviceType}, ${when(job.startsAt, now, ctx.company.timezone)}`) };
  },
});

export const removeTimeAway = portalMutation({
  args: { timeOffId: v.id("timeOff") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.timeOffId);
    if (!row || row.companyId !== ctx.companyId || row.cleanerId !== ctx.cleaner._id) notFound();
    await ctx.db.delete(row._id);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_removed", actor: asCleaner(ctx.cleaner._id), subject: { table: "cleaners", id: ctx.cleaner._id }, data: { startsAt: row.startsAt, endsAt: row.endsAt } });
    return null;
  },
});

/** A question for the office. A person answers it; the Cleaners workspace lists it until they do. */
export const askForHelp = portalMutation({
  args: { topic: v.union(v.literal("onboarding"), v.literal("availability"), v.literal("jobs"), v.literal("pay"), v.literal("other")), text: v.string() },
  handler: async (ctx, args) => {
    const words = args.text.trim();
    if (words.length < 3) throw userError("Say what you need help with.");
    if (!(await allow(ctx, `portal.help:${ctx.cleaner._id}`, 10, DAY))) throw userError("You have sent several requests today. The office will get back to you.", "limit");
    const id = await ctx.db.insert("helpRequests", { companyId: ctx.companyId, cleanerId: ctx.cleaner._id, topic: args.topic, text: words.slice(0, 1000), status: "open", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.help_requested", actor: asCleaner(ctx.cleaner._id), subject: { table: "cleaners", id: ctx.cleaner._id }, data: { helpRequestId: id, topic: args.topic } });
    return null;
  },
});

/** Texts a fresh code for this session, before pay and tax details are shown. */
export const sendStepUpCode = portalMutation({
  args: {},
  handler: async (ctx) => {
    const link = await ctx.db.get(ctx.session.linkId);
    if (!link) notFound();
    return textCode(ctx, { link, cleaner: ctx.cleaner, company: ctx.company });
  },
});

export const confirmStepUp = portalMutation({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(ctx.session.linkId);
    if (!link) notFound();
    const result = await checkCode(ctx, link, args.code.slice(0, 12));
    if (!result.ok) return { status: result.reason, message: CODE_WORDS[result.reason] };
    await ctx.db.patch(ctx.session._id, { verifiedAt: Date.now() });
    return { status: "ok" as const, message: null };
  },
});

/** Pay as each offer stated it. It needs a code confirmed in the last few minutes. It is not a payment record. */
export const earnings = portalQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const now = instant(args.asOf, "The time");
    if (!steppedUp(ctx.session, now)) return { needsCode: true as const, minutes: STEP_UP_MINUTES, jobs: [], note: null };
    const tz = ctx.company.timezone;
    const rows = [];
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", ctx.cleaner._id).eq("status", "accepted"))
      .order("desc")
      .take(60);
    for (const assignment of assignments) {
      const job = await ctx.db.get(assignment.jobId);
      if (!job || job.companyId !== ctx.companyId || job.status === "cancelled") continue;
      rows.push({ startsAt: job.startsAt, when: dayName(job.startsAt, tz), service: job.serviceType, pay: money(assignment.payCents), state: job.status === "completed" ? "Visit closed" : job.startsAt > now ? "Coming up" : "Done, not closed yet" });
    }
    return { needsCode: false as const, minutes: STEP_UP_MINUTES, jobs: rows.sort((a, b) => b.startsAt - a.startsAt), note: "This is the pay each offer stated. Approved earnings and payments are kept by the office's finance records, which are not in this portal yet." };
  },
});

export const signOut = portalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.db.patch(ctx.session._id, { revokedAt: Date.now() });
    return null;
  },
});
