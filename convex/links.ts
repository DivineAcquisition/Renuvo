/**
 * What a cleaner can see and do through an action link, with no sign-in. Every function here goes
 * through `linkQuery` or `linkMutation`, so the token is the only way in, the link's own company,
 * cleaner and assignment are the only records reached, and no argument names a record outside them.
 *
 * Reads change nothing. An offer shows the area, never the street: the address and the way in are
 * shown only on the job page, and only while the cleaner is the accepted cleaner on it.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { linkMutation, linkQuery, type LinkAccess } from "./lib/builders";
import { answerOffer } from "./lib/dispatch/assignmentState";
import { requiredCrew } from "./lib/dispatch/crew";
import { jobAssignments } from "./lib/dispatch/facts";
import { handOff } from "./lib/dispatch/handoffs";
import { linkState, liveLink, tokenFor } from "./lib/dispatch/links";
import { arrivalEndsAt, cannotAttend, checkIn, completionGaps, EARLY_CHECK_IN_MINUTES, jobChecklist, jobEvidence, liveAssignment, reportDelay, submitCompletion } from "./lib/dispatch/live";
import { money } from "./lib/dispatch/pay";
import { dispatchPolicy } from "./lib/dispatch/policy";
import { areaWords, arrivalWords, durationWords, roleWords } from "./lib/dispatch/sms";
import { whenWords } from "./lib/dispatch/workflow";
import { notFound, userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";

const MAX_PHOTOS_PER_KIND = 30;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const asCleaner = (ctx: LinkAccess): Actor => ({ kind: "cleaner", cleanerId: ctx.link.cleanerId, linkId: ctx.link._id });
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

async function linked(ctx: QueryCtx & LinkAccess) {
  const assignment = await ctx.db.get(ctx.link.assignmentId);
  const job = await ctx.db.get(ctx.link.jobId);
  const cleaner = await ctx.db.get(ctx.link.cleanerId);
  // The link's own records must still be in its company. Anything else is treated as a link to nothing.
  if (!assignment || !job || !cleaner || assignment.companyId !== ctx.companyId || job.companyId !== ctx.companyId || cleaner.companyId !== ctx.companyId) notFound();
  return { assignment, job, cleaner };
}

export type OfferState = "open" | "accepted" | "declined" | "expired" | "filled" | "withdrawn" | "job_cancelled";

function offerState(assignment: Doc<"assignments">, job: Doc<"jobs">, now: number): OfferState {
  if (job.status === "cancelled") return "job_cancelled";
  if (assignment.status === "offered") return now > assignment.respondBy ? "expired" : "open";
  if (assignment.status === "accepted") return "accepted";
  if (assignment.status === "declined") return "declined";
  if (assignment.status === "expired") return "expired";
  if (assignment.endCause === "job_covered") return "filled";
  if (assignment.endCause === "job_cancelled") return "job_cancelled";
  return "withdrawn";
}

// ── The offer ────────────────────────────────────────────────────────────────────────────────────

/** The offer page. Opening it changes nothing. Once the offer is no longer open, only its state is shown. */
export const offer = linkQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.link.purpose !== "offer") notFound();
    const { assignment, job, cleaner } = await linked(ctx);
    const now = Date.now();
    const state = offerState(assignment, job, now);
    const base = { company: ctx.company.name, cleanerFirstName: firstName(cleaner.name), state, asOf: now };
    if (state === "accepted") {
      // The offer link itself is spent. The way into the job is the job link, which has its own life.
      const jobLink = await liveLink(ctx, assignment, "job");
      return { ...base, offer: null, jobToken: jobLink ? await tokenFor(jobLink) : null };
    }
    if (state !== "open") return { ...base, offer: null, jobToken: null };
    const tz = ctx.company.timezone;
    const crew = requiredCrew(job);
    return {
      ...base,
      jobToken: null,
      offer: {
        backup: assignment.offerKind === "backup",
        serviceType: job.serviceType,
        scope: assignment.scope,
        requiredSkills: job.requiredSkills,
        when: arrivalWords(job, tz),
        duration: durationWords(job),
        mustFinishBy: job.hardDeadlineAt ? whenWords(job.hardDeadlineAt, tz) : null,
        /** City and postal code only. The street and the way in come after acceptance. */
        area: areaWords(await ctx.db.get(job.propertyId)),
        role: roleWords(assignment.role, crew),
        crewSize: crew,
        estimatedPay: money(assignment.payCents),
        respondBy: assignment.respondBy,
        respondByWords: whenWords(assignment.respondBy, tz),
      },
    };
  },
});

function refusalFor(code: "not_open" | "job_closed" | "filled" | "conflict" | "not_ready"): string {
  return {
    not_open: "This offer is no longer open.",
    job_closed: "This job is no longer scheduled.",
    filled: "This job has already been filled.",
    conflict: "You already have a job or time off at that time, so this one cannot be accepted.",
    not_ready: "You are not marked ready for work right now. Please contact the office.",
  }[code];
}

/** Accepting is its own request, never a page load. Everything is checked again at this moment. */
export const acceptOffer = linkMutation({
  action: "accept",
  args: {},
  handler: async (ctx) => {
    if (ctx.link.purpose !== "offer") notFound();
    const { assignment } = await linked(ctx);
    const result = await answerOffer(ctx, assignment, "accepted", asCleaner(ctx), { via: "link" });
    if (result.status === "refused") return { status: result.code === "filled" ? ("filled" as const) : ("refused" as const), message: refusalFor(result.code), jobToken: null };
    if (result.status !== "accepted") return { status: result.status, message: null, jobToken: null };
    const jobLink = result.jobLinkId ? await ctx.db.get(result.jobLinkId) : null;
    return { status: "accepted" as const, message: null, jobToken: jobLink ? await tokenFor(jobLink) : null };
  },
});

export const declineOffer = linkMutation({
  action: "decline",
  args: {},
  handler: async (ctx) => {
    if (ctx.link.purpose !== "offer") notFound();
    const { assignment } = await linked(ctx);
    const result = await answerOffer(ctx, assignment, "declined", asCleaner(ctx), { via: "link" });
    if (result.status === "refused") return { status: "refused" as const, message: refusalFor(result.code) };
    return { status: result.status, message: null };
  },
});

// ── The assigned job ─────────────────────────────────────────────────────────────────────────────

export type JobPageState = "active" | "submitted" | "ended" | "expired" | "job_cancelled" | "closed";

/**
 * The assigned-job page. The address and the way in are returned only while this cleaner is the
 * accepted cleaner and the link is live. A link that was revoked or has run out gets the state and
 * nothing else.
 */
export const job = linkQuery({
  args: {},
  handler: async (ctx) => {
    if (ctx.link.purpose !== "job") notFound();
    const { assignment, job: jobDoc, cleaner } = await linked(ctx);
    const now = Date.now();
    let state: JobPageState = "active";
    if (jobDoc.status === "cancelled") state = "job_cancelled";
    else if (assignment.status !== "accepted" || ctx.linkState === "revoked") state = "ended";
    else if (ctx.linkState === "expired") state = "expired";
    else if (jobDoc.status === "completed") state = "closed";
    else if (assignment.completion) state = "submitted";
    const base = { company: ctx.company.name, cleanerFirstName: firstName(cleaner.name), state, asOf: now };
    if (state !== "active" && state !== "submitted") return { ...base, detail: null };

    const tz = ctx.company.timezone;
    const policy = dispatchPolicy(ctx.company);
    const property = await ctx.db.get(jobDoc.propertyId);
    const customer = await ctx.db.get(jobDoc.customerId);
    const crewRows = (await jobAssignments(ctx, jobDoc)).filter((row) => row.status === "accepted");
    const names = new Map<string, string>();
    for (const row of crewRows) names.set(row.cleanerId, firstName((await ctx.db.get(row.cleanerId))?.name ?? "A cleaner"));
    const items = await jobChecklist(ctx, jobDoc);
    const evidence = await jobEvidence(ctx, jobDoc);
    const photo = async (row: Doc<"evidence">) => ({ id: row._id, url: await ctx.storage.getUrl(row.storageId), mine: row.assignmentId === assignment._id, by: names.get(row.cleanerId) ?? "A cleaner", itemId: row.checklistItemId ?? null });
    const photos = { before: [] as Awaited<ReturnType<typeof photo>>[], after: [] as Awaited<ReturnType<typeof photo>>[], item: [] as Awaited<ReturnType<typeof photo>>[], issue: [] as Awaited<ReturnType<typeof photo>>[] };
    for (const row of evidence) photos[row.kind].push(await photo(row));
    const reports = await ctx.db
      .query("jobReports")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", jobDoc._id))
      .take(100);
    const crew = requiredCrew(jobDoc);
    return {
      ...base,
      detail: {
        serviceType: jobDoc.serviceType,
        scope: assignment.scope,
        instructions: jobDoc.instructions ?? null,
        when: arrivalWords(jobDoc, tz),
        duration: durationWords(jobDoc),
        mustFinishBy: jobDoc.hardDeadlineAt ? whenWords(jobDoc.hardDeadlineAt, tz) : null,
        startsAt: jobDoc.startsAt,
        arrivalEndsAt: arrivalEndsAt(jobDoc),
        checkInOpensAt: jobDoc.startsAt - EARLY_CHECK_IN_MINUTES * 60_000,
        customerFirstName: customer ? firstName(customer.name) : null,
        address: property ? { ...property.address, label: property.label ?? null } : null,
        accessInstructions: property?.accessInstructions ?? null,
        role: roleWords(assignment.role, crew),
        crewSize: crew,
        crew: crewRows.map((row) => ({ name: names.get(row.cleanerId) ?? "A cleaner", role: row.role ?? "lead", you: row._id === assignment._id, checkedIn: row.checkIn !== undefined, submitted: row.completion !== undefined })),
        estimatedPay: money(assignment.payCents),
        checkedInAt: assignment.checkIn?.at ?? null,
        late: assignment.late ?? null,
        completion: assignment.completion ?? null,
        checklist: items.map((item) => ({ id: item._id, section: item.section ?? null, label: item.label, requiresPhoto: item.requiresPhoto, state: item.state, skipReason: item.skipReason ?? null, by: item.byCleanerId ? (names.get(item.byCleanerId) ?? "A cleaner") : null })),
        photos,
        required: { before: policy.beforePhotosRequired, after: policy.afterPhotosRequired },
        /** Requests and reports, with whether a person has decided. A request alone changes no scope and no price. */
        reports: reports.map((row) => ({ id: row._id, kind: row.kind, text: row.text, status: row.status, decisionNote: row.decisionNote ?? null, mine: row.assignmentId === assignment._id })),
        /** What still has to be done before the job can be submitted as complete. */
        beforeSubmit: await completionGaps(ctx, { assignment, job: jobDoc, company: ctx.company }),
      },
    };
  },
});

function jobLinkOnly(ctx: LinkAccess) {
  if (ctx.link.purpose !== "job") notFound();
}

export const checkInJob = linkMutation({
  action: "check_in",
  args: { lat: v.optional(v.number()), lng: v.optional(v.number()), accuracyM: v.optional(v.number()) },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    return checkIn(ctx, ctx.link.assignmentId, args, asCleaner(ctx));
  },
});

export const reportDelayJob = linkMutation({
  action: "report_delay",
  args: { etaMinutes: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    const result = await reportDelay(ctx, ctx.link.assignmentId, args, asCleaner(ctx));
    return { etaAt: result.etaAt, etaWords: whenWords(result.etaAt, ctx.company.timezone) };
  },
});

export const cannotAttendJob = linkMutation({
  action: "cannot_attend",
  args: { reason: v.string() },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    return cannotAttend(ctx, ctx.link.assignmentId, args.reason, asCleaner(ctx));
  },
});

/** Marks one checklist item done, skipped with a reason, or not done. Whoever marks it is recorded on it. */
export const setChecklistItem = linkMutation({
  action: "checklist",
  args: { itemId: v.id("checklistItems"), state: v.union(v.literal("pending"), v.literal("done"), v.literal("skipped")), skipReason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    const { assignment, job: jobDoc } = await liveAssignment(ctx, ctx.link.assignmentId);
    if (!assignment.checkIn) throw userError("Check in before you start the checklist.");
    if (assignment.completion) throw userError("You have already submitted this job.");
    const item = await ctx.db.get(args.itemId);
    // An item from another job, or another company, is not this link's to touch.
    if (!item || item.companyId !== ctx.companyId || item.jobId !== jobDoc._id) notFound();
    const reason = args.skipReason?.trim().slice(0, 300);
    if (args.state === "skipped" && (!reason || reason.length < 3)) throw userError("Say why this item is skipped.");
    if (args.state === "done" && item.requiresPhoto) {
      const has = (await jobEvidence(ctx, jobDoc)).some((row) => row.checklistItemId === item._id);
      if (!has) throw userError("Add the photo for this item first.");
    }
    await ctx.db.patch(item._id, {
      state: args.state,
      skipReason: args.state === "skipped" ? reason : undefined,
      byCleanerId: args.state === "pending" ? undefined : ctx.link.cleanerId,
      at: args.state === "pending" ? undefined : Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.checklist_item_set", actor: asCleaner(ctx), subject: { table: "jobs", id: jobDoc._id }, data: { itemId: item._id, state: args.state } });
    return null;
  },
});

/** A one-time address the phone uploads one photo to. The photo counts only once `attachPhoto` records it. */
export const photoUploadUrl = linkMutation({
  action: "photos",
  args: {},
  handler: async (ctx) => {
    jobLinkOnly(ctx);
    const { assignment } = await liveAssignment(ctx, ctx.link.assignmentId);
    if (!assignment.checkIn) throw userError("Check in before you add photos.");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Records an uploaded photo against the job. `clientKey` is chosen by the phone for each photo, so a
 * retry on a bad connection, or a page reopened half way, never records the same photo twice.
 */
export const attachPhoto = linkMutation({
  action: "photos",
  args: {
    storageId: v.id("_storage"),
    kind: v.union(v.literal("before"), v.literal("after"), v.literal("item"), v.literal("issue")),
    clientKey: v.string(),
    itemId: v.optional(v.id("checklistItems")),
  },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    const { assignment, job: jobDoc } = await liveAssignment(ctx, ctx.link.assignmentId);
    if (!assignment.checkIn) throw userError("Check in before you add photos.");
    const clientKey = args.clientKey.trim().slice(0, 80);
    if (clientKey.length < 8) throw userError("This photo could not be recorded. Try again.");
    const existing = await ctx.db
      .query("evidence")
      .withIndex("by_company_assignment_key", (q) => q.eq("companyId", ctx.companyId).eq("assignmentId", assignment._id).eq("clientKey", clientKey))
      .first();
    if (existing) {
      if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return { evidenceId: existing._id, duplicate: true };
    }
    const file = await ctx.db.system.get(args.storageId);
    if (!file) throw userError("That upload was not found. Try again.");
    if (!file.contentType?.startsWith("image/") || file.size > MAX_PHOTO_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw userError("Photos must be images, 15 MB or smaller.");
    }
    const all = await jobEvidence(ctx, jobDoc);
    // One upload is one photo: a stored file is never attached twice, here or on another job.
    if (all.some((row) => row.storageId === args.storageId)) throw userError("This photo is already recorded.");
    if (all.filter((row) => row.kind === args.kind).length >= MAX_PHOTOS_PER_KIND) throw userError(`This job already has ${MAX_PHOTOS_PER_KIND} photos of this kind.`);
    let itemId: Id<"checklistItems"> | undefined;
    if (args.kind === "item") {
      const item = args.itemId ? await ctx.db.get(args.itemId) : null;
      if (!item || item.companyId !== ctx.companyId || item.jobId !== jobDoc._id) notFound();
      itemId = item._id;
    }
    const evidenceId = await ctx.db.insert("evidence", { companyId: ctx.companyId, jobId: jobDoc._id, assignmentId: assignment._id, cleanerId: ctx.link.cleanerId, kind: args.kind, checklistItemId: itemId, storageId: args.storageId, clientKey, uploadedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.photo_added", actor: asCleaner(ctx), subject: { table: "jobs", id: jobDoc._id }, data: { kind: args.kind, assignmentId: assignment._id } });
    return { evidenceId, duplicate: false };
  },
});

/** Removes a photo the same cleaner added, before they submit. */
export const removePhoto = linkMutation({
  action: "photos",
  args: { evidenceId: v.id("evidence") },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    const { assignment, job: jobDoc } = await liveAssignment(ctx, ctx.link.assignmentId);
    if (assignment.completion) throw userError("You have already submitted this job.");
    const row = await ctx.db.get(args.evidenceId);
    if (!row || row.companyId !== ctx.companyId || row.assignmentId !== assignment._id) notFound();
    await ctx.db.delete(row._id);
    await ctx.storage.delete(row.storageId);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.photo_removed", actor: asCleaner(ctx), subject: { table: "jobs", id: jobDoc._id }, data: { kind: row.kind, assignmentId: assignment._id } });
    return null;
  },
});

/**
 * Reports something from the job: a condition nobody expected, or a request to add to the scope. A
 * request waits for a person. It changes no scope, no price and no charge.
 */
export const report = linkMutation({
  action: "report",
  args: { kind: v.union(v.literal("condition"), v.literal("addon_request")), text: v.string() },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    const { assignment, job: jobDoc, cleaner } = await liveAssignment(ctx, ctx.link.assignmentId);
    const words = args.text.trim().slice(0, 1000);
    if (words.length < 3) throw userError("Say what you found or what you are asking for.");
    const now = Date.now();
    const reportId = await ctx.db.insert("jobReports", { companyId: ctx.companyId, jobId: jobDoc._id, assignmentId: assignment._id, cleanerId: cleaner._id, kind: args.kind, text: words, status: "awaiting_decision", createdAt: now });
    const addon = args.kind === "addon_request";
    const task = await handOff(ctx, {
      companyId: ctx.companyId,
      to: "customer_care",
      key: `customer_care.report:${reportId}`,
      title: addon ? `${cleaner.name} asks to add to the scope of a visit` : `${cleaner.name} reported an unexpected condition at a visit`,
      question: addon
        ? `${cleaner.name} asks: "${words}". Decide with the customer. Approving this request does not charge anyone: any price change is yours to make.`
        : `${cleaner.name} reports: "${words}". Decide whether the customer needs to hear about it and whether the scope changes.`,
      trigger: addon ? "A cleaner asked to add to the scope from the job." : "A cleaner reported an unexpected condition from the job.",
      completionCondition: "A person decided and the cleaner can see the decision",
      escalation: "Until someone decides, the cleaner works the original scope.",
      dueAt: Math.max(now + 30 * 60_000, Math.min(jobDoc.endsAt, now + 24 * 60 * 60_000)),
      about: { table: "jobs", id: jobDoc._id },
      actor: asCleaner(ctx),
    });
    await ctx.db.patch(reportId, { taskId: task._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "job.report_added", actor: asCleaner(ctx), subject: { table: "jobs", id: jobDoc._id }, data: { kind: args.kind, assignmentId: assignment._id } });
    return { reportId, status: "awaiting_decision" as const };
  },
});

/** Submits the job as complete, or as complete with something left. The answer is "submitted for review", nothing more. */
export const submitJob = linkMutation({
  action: "complete",
  args: { incomplete: v.boolean(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    jobLinkOnly(ctx);
    return submitCompletion(ctx, ctx.link.assignmentId, args, asCleaner(ctx));
  },
});
export { linkState };
