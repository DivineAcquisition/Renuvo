/**
 * One worker's profile: the header, each section's facts, and their history. Every section is read from the
 * shared records (Dispatch's assignments, Recruiter's application, Agreements' links) and none is a copy.
 * Evidence files and pay are not here: they have their own functions with their own role checks.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { attentionFor, conflictsOf, weekSummary } from "./lib/cleaners/attention";
import { ENGAGEMENT_WORDS, STATUS_WORDS } from "./lib/cleaners/enroll";
import { cleanerReadiness, companyDefinitions, initialsOf } from "./lib/cleaners/records";
import { engagementValidator } from "./lib/cleaners/schema";
import { cleanerTime, commitmentsBetween, jobLabel } from "./lib/cleaners/schedule";
import { cleanersSettings, DAY } from "./lib/cleaners/settings";
import { actorWords, eventText, MESSAGE_STATE_WORDS, PURPOSE_WORDS, type TimelineEntry } from "./lib/cleaners/words";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isManager, isOwner } from "./lib/roles";
import { optionalEmail, optionalText, tags, text } from "./lib/text";
import { addLocalDays, startOfLocalDay } from "./lib/time";

export const profile = companyQuery({
  args: { cleanerId: v.id("cleaners"), asOf: v.number() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const company = ctx.company;
    const tz = company.timezone;
    const now = args.asOf;
    const settings = cleanersSettings(company);
    const { readiness, rows, windows } = await cleanerReadiness(ctx, company, cleaner, now);
    const definitions = await companyDefinitions(ctx, company);
    const today = startOfLocalDay(now, tz);
    const commitments = ((await commitmentsBetween(ctx, company, today, addLocalDays(today, 21, tz))).get(cleaner._id) ?? []).sort((a, b) => a.startsAt - b.startsAt);
    const time = await cleanerTime(ctx, company, cleaner._id, today);
    const weekly = windows.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute }));
    const conflicts = conflictsOf({ commitments, absences: time.absences, windows: weekly, extraAvailable: time.extraAvailable, timezone: tz });
    const claims = await ctx.db
      .query("skillClaims")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(50);
    const attention = attentionFor({
      cleaner: { id: cleaner._id, name: cleaner.name, status: cleaner.status, phone: cleaner.phone, email: cleaner.email, hasPay: Boolean(cleaner.pay) || cleaner.engagement === "subcontractor", availabilityConfirmedAt: cleaner.availabilityConfirmedAt, createdAt: cleaner.createdAt },
      readiness,
      weeklyWindows: weekly.length,
      conflicts,
      skillClaims: claims.filter((row) => row.status === "claimed").length,
      now,
      timezone: tz,
      settings,
      viewerIsOwner: isOwner(ctx.role),
    });

    // Crews, current and past, with the dates the membership ran.
    const memberships = await ctx.db
      .query("crewMemberships")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(100);
    const crews = [];
    for (const row of memberships) {
      const crew = await ctx.db.get(row.crewId);
      if (crew) crews.push({ crewId: crew._id, name: crew.name, kind: crew.kind, role: row.role, from: row.from, to: row.to ?? null, current: row.to === undefined && crew.status === "active", jobId: crew.jobId ?? null });
    }

    // The subcontractor company now and in the past.
    const sub = cleaner.subcontractorId ? await ctx.db.get(cleaner.subcontractorId) : null;
    const affiliations = await ctx.db
      .query("workerAffiliations")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .take(20);
    const affiliationRows = [];
    for (const row of affiliations) affiliationRows.push({ subcontractorId: row.subcontractorId, name: (await ctx.db.get(row.subcontractorId))?.name ?? "A subcontractor", from: row.from, to: row.to ?? null });

    // Recent and upcoming work, from Dispatch's assignments.
    const history = [];
    for (const status of ["accepted", "offered", "declined", "expired", "cancelled"] as const) {
      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id).eq("status", status))
        .order("desc")
        .take(60);
      for (const row of assignments) {
        const job = await ctx.db.get(row.jobId);
        if (!job || job.startsAt < now - 60 * DAY) continue;
        const customer = await ctx.db.get(job.customerId);
        history.push({
          assignmentId: row._id,
          jobId: job._id,
          startsAt: job.startsAt,
          endsAt: job.endsAt,
          label: jobLabel(job, customer?.name ?? null, tz),
          service: job.serviceType,
          assignment: row.status,
          endCause: row.endCause ?? null,
          job: job.status,
          role: row.role ?? null,
          checkedInAt: row.checkIn?.at ?? null,
          late: row.late ? { etaAt: row.late.etaAt } : null,
        });
      }
    }
    history.sort((a, b) => b.startsAt - a.startsAt);

    // Requirements not given to this person yet, so a manager can add them on purpose.
    const assigned = new Set(rows.map((row) => row.key));
    const notAssigned = definitions.filter((def) => def.appliesTo.includes(cleaner.engagement) && !assigned.has(def.key)).map((def) => ({ key: def.key, label: def.label }));
    const manager = isManager(ctx.role);
    const requirements = readiness.requirements.map((view) => {
      const row = rows.find((item) => item.key === view.key);
      // The words of a review and the names of files are for the people who review; the state is for everyone.
      const mayReview = view.reviewer === "owner" ? isOwner(ctx.role) : manager;
      return {
        ...view,
        submittedAt: row?.submittedAt ?? null,
        reviewedAt: row?.reviewedAt ?? null,
        reviewNote: manager ? (view.reviewNote ?? null) : null,
        waiverReason: manager ? (view.waiverReason ?? null) : null,
        files: mayReview ? (row?.evidence?.files ?? []).map((file) => ({ name: file.name, size: file.size, uploadedAt: file.uploadedAt })) : null,
        filesCount: row?.evidence?.files?.length ?? 0,
        text: mayReview ? (row?.evidence?.text ?? null) : null,
        mayReview,
      };
    });

    const application = cleaner.hiredFrom ? await ctx.db.get(cleaner.hiredFrom) : null;
    const need = application?.needId ? await ctx.db.get(application.needId) : null;
    const pendingPersonnel = manager
      ? (
          await ctx.db
            .query("personnelRequests")
            .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
            .take(50)
        ).filter((row) => row.status === "pending").length
      : 0;

    return {
      cleanerId: cleaner._id,
      name: cleaner.name,
      initials: initialsOf(cleaner.name),
      photoUrl: cleaner.photoStorageId ? await ctx.storage.getUrl(cleaner.photoStorageId) : null,
      email: cleaner.email ?? null,
      phone: cleaner.phone ?? null,
      engagement: cleaner.engagement,
      engagementWords: ENGAGEMENT_WORDS[cleaner.engagement],
      status: cleaner.status,
      statusWords: STATUS_WORDS[cleaner.status],
      statusChangedAt: cleaner.statusChangedAt ?? cleaner.createdAt,
      createdAt: cleaner.createdAt,
      subcontractor: sub ? { id: sub._id, name: sub.name, status: sub.status, contact: manager ? sub.contact : { name: sub.contact.name } } : null,
      affiliations: affiliationRows,
      hiredFrom: application ? { applicationId: application._id, role: need?.title ?? application.roleSeen ?? null } : null,
      rehireRestricted: manager ? Boolean(cleaner.rehireRestriction) : null,
      readiness: {
        state: readiness.state,
        eligible: readiness.eligible,
        summary: readiness.summary,
        nextStep: readiness.nextStep,
        blockers: readiness.blockers.map((view) => ({ key: view.key, label: view.label, state: view.state })),
        serviceBlockers: readiness.serviceBlockers.map((view) => ({ key: view.key, label: view.label, forServices: view.forServices })),
        payoutReady: readiness.payoutReady,
        paymentBlockers: readiness.paymentBlockers.map((view) => ({ key: view.key, label: view.label, state: view.state })),
        progress: readiness.progress,
      },
      requirements,
      notAssigned,
      attention,
      areas: { serviceAreas: cleaner.serviceAreas, preferredAreas: cleaner.preferredAreas ?? [], maxTravelMinutes: cleaner.maxTravelMinutes ?? null },
      skills: cleaner.skills,
      skillClaims: claims.filter((row) => row.status === "claimed").map((row) => ({ claimId: row._id, skill: row.skill, note: row.note ?? null, claimedAt: row.claimedAt })),
      availability: {
        windows: weekly,
        summary: weekSummary(weekly),
        confirmedAt: cleaner.availabilityConfirmedAt ?? null,
        timeOff: time.timeOff.map((row) => ({ id: row._id, startsAt: row.startsAt, endsAt: row.endsAt, note: row.note ?? null, source: row.source ?? "member" })),
        exceptions: time.exceptions.map((row) => ({ id: row._id, date: row.date, kind: row.kind, startMinute: row.startMinute ?? null, endMinute: row.endMinute ?? null, note: row.note ?? null })),
      },
      upcoming: commitments.map((row) => ({ ...row, conflict: conflicts.find((item) => item.commitment.assignmentId === row.assignmentId)?.reason ?? null })),
      history,
      crews,
      pendingPersonnel,
      viewer: { role: ctx.role, manager, owner: isOwner(ctx.role) },
    };
  },
});

/** The person's history: what happened to their record, what they were sent and whether it arrived, and their offers. */
const PERFORMANCE_EVENTS = ["cleaner.coaching_added", "cleaner.coaching_drafted", "cleaner.feedback_answered", "cleaner.record_disputed", "cleaner.dispute_decided"];

export const activity = companyQuery({
  args: { cleanerId: v.id("cleaners"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 80), 10), 300);
    const members = new Map<string, string>();
    for (const member of await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(200))
      members.set(member._id, member.name);
    const labels = new Map((await companyDefinitions(ctx, ctx.company)).map((def) => [def.key, def.label]));
    const entries: TimelineEntry[] = [];
    const events = await ctx.db
      .query("events")
      .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", cleaner._id))
      .order("desc")
      .take(limit);
    for (const event of events) {
      // Pay is the Owner's: other roles see neither pay changes nor pay requests in the history.
      if (!isOwner(ctx.role) && (event.type === "cleaner.pay_changed" || event.data?.kind === "pay_change")) continue;
      // Coaching, feedback and disputed records are for Owners and Managers.
      if (!isManager(ctx.role) && PERFORMANCE_EVENTS.includes(event.type)) continue;
      const words = eventText(event, labels);
      entries.push({ id: event._id, at: event.at, ...actorWords(event.actor, members, cleaner.name), text: words.text, tone: words.tone });
    }
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
      .order("desc")
      .take(limit);
    for (const message of messages) {
      const purpose = PURPOSE_WORDS[message.purpose] ?? "Message";
      const channel = message.channel === "email" ? "email" : "text";
      // A sign-in code is never shown, and neither is any message body: only what it was for and what became of it.
      entries.push({
        id: message._id,
        at: message.deliveredAt ?? message.sentAt ?? message.failedAt ?? message.queuedAt,
        who: "Selestial",
        whoKind: "system",
        text: `${purpose} ${channel} ${MESSAGE_STATE_WORDS[message.status]}${message.problem && (message.status === "not_sent" || message.status === "failed") ? `: ${message.problem}` : ""}`,
        tone: "message",
        jobId: message.jobId,
      });
    }
    entries.sort((a, b) => b.at - a.at);
    return entries.slice(0, limit);
  },
});

// ── Changes a manager makes on the record ───────────────────────────────────────────────────────────

export const updateDetails = managerMutation({
  args: {
    cleanerId: v.id("cleaners"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    serviceAreas: v.optional(v.array(v.string())),
    preferredAreas: v.optional(v.array(v.string())),
    maxTravelMinutes: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (cleaner.status === "ended") throw userError("This engagement has ended. Its record is kept as it was.");
    const areas = args.serviceAreas !== undefined ? tags(args.serviceAreas, "Service areas", 200).map((code) => code.toUpperCase()) : cleaner.serviceAreas;
    const preferred = args.preferredAreas !== undefined ? tags(args.preferredAreas, "Preferred areas", 200).map((code) => code.toUpperCase()) : cleaner.preferredAreas;
    if (preferred?.some((code) => !areas.includes(code))) throw userError("Preferred areas must be among the service areas.");
    if (args.maxTravelMinutes !== undefined && args.maxTravelMinutes !== null && (!Number.isInteger(args.maxTravelMinutes) || args.maxTravelMinutes < 5 || args.maxTravelMinutes > 240)) throw userError("A travel limit is between 5 and 240 minutes.");
    await ctx.db.patch(cleaner._id, {
      ...(args.name !== undefined ? { name: text(args.name, "Name", 160) } : {}),
      ...(args.email !== undefined ? { email: optionalEmail(args.email) } : {}),
      ...(args.phone !== undefined ? { phone: optionalText(args.phone, "Phone", 40) } : {}),
      ...(args.skills !== undefined ? { skills: tags(args.skills, "Skills") } : {}),
      serviceAreas: areas,
      preferredAreas: preferred,
      ...(args.maxTravelMinutes !== undefined ? { maxTravelMinutes: args.maxTravelMinutes ?? undefined } : {}),
      updatedAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.updated", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id } });
    return null;
  },
});

/**
 * Routine engagement changes a manager makes: making an engagement active, pausing it, resuming it, or
 * putting it back into onboarding. Suspending and ending are personnel requests that an authorized person
 * decides (convex/personnel.ts); they are refused here.
 */
const ROUTINE: Record<string, readonly string[]> = { onboarding: ["ready"], ready: ["paused", "onboarding"], paused: ["ready"], suspended: [], ended: [] };

export const setEngagementStatus = managerMutation({
  args: { cleanerId: v.id("cleaners"), status: v.union(v.literal("onboarding"), v.literal("ready"), v.literal("paused")) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (cleaner.status === args.status) return null;
    if (cleaner.status === "suspended") throw userError("A suspension is lifted by a reinstatement request that an authorized person approves.");
    if (cleaner.status === "ended") throw userError("This engagement has ended. Rehiring starts a new onboarding through a request.");
    if (!ROUTINE[cleaner.status].includes(args.status)) throw userError(`An engagement that is ${STATUS_WORDS[cleaner.status].toLowerCase()} cannot become ${STATUS_WORDS[args.status].toLowerCase()} directly.`);
    await ctx.db.patch(cleaner._id, { status: args.status, statusChangedAt: Date.now(), updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.status_changed", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { from: cleaner.status, to: args.status } });
    return null;
  },
});

/** Changing whether someone is an employee or a contractor changes their legal relationship: the Owner's, with a reason. */
export const changeEngagementType = ownerMutation({
  args: { cleanerId: v.id("cleaners"), engagement: engagementValidator, subcontractorId: v.optional(v.id("subcontractors")), reason: v.string() },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const reason = text(args.reason, "The reason", 500);
    if (cleaner.status === "ended") throw userError("This engagement has ended.");
    if (args.engagement === "subcontractor") {
      if (!args.subcontractorId) throw userError("Choose the subcontractor company they work through.");
      const sub = await owned(ctx, args.subcontractorId);
      if (sub.status === "ended") throw userError(`${sub.name} is no longer a subcontractor.`);
    } else if (args.subcontractorId) throw userError("Only a subcontractor worker works through a subcontractor company.");
    const now = Date.now();
    const changingSub = (args.subcontractorId ?? null) !== (cleaner.subcontractorId ?? null);
    if (changingSub) {
      const open = await ctx.db
        .query("workerAffiliations")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
        .take(50);
      for (const row of open) if (row.to === undefined) await ctx.db.patch(row._id, { to: now });
      if (args.subcontractorId) await ctx.db.insert("workerAffiliations", { companyId: ctx.companyId, cleanerId: cleaner._id, subcontractorId: args.subcontractorId, from: now });
    }
    // Pay belongs to the relationship: a different relationship starts without one, and the old one stays in its history.
    const pay = args.engagement === cleaner.engagement ? cleaner.pay : undefined;
    await ctx.db.patch(cleaner._id, { engagement: args.engagement, subcontractorId: args.subcontractorId, pay, updatedAt: now });
    if (args.engagement !== cleaner.engagement) await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.engagement_type_changed", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { from: cleaner.engagement, to: args.engagement, reason } });
    if (changingSub) await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.affiliation_changed", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { to: args.subcontractorId ?? null, reason } });
    return null;
  },
});

export const photoUploadUrl = managerMutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const setPhoto = managerMutation({
  args: { cleanerId: v.id("cleaners"), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (args.storageId) {
      const meta = await ctx.db.system.get(args.storageId);
      if (!meta) throw userError("The photo did not upload. Please try again.");
      if (!meta.contentType?.startsWith("image/") || meta.size > 5 * 1024 * 1024) {
        await ctx.storage.delete(args.storageId);
        throw userError("Use a photo (JPEG, PNG or WebP) under 5 MB.");
      }
    }
    const old = cleaner.photoStorageId;
    await ctx.db.patch(cleaner._id, { photoStorageId: args.storageId ?? undefined, updatedAt: Date.now() });
    if (old && old !== args.storageId) await ctx.storage.delete(old);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.photo_set", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id } });
    return null;
  },
});

/** A person confirms a skill the cleaner said they have, or does not. Only confirmed skills reach Dispatch. */
export const decideSkill = managerMutation({
  args: { claimId: v.id("skillClaims"), confirm: v.boolean() },
  handler: async (ctx, args) => {
    const claim = await owned(ctx, args.claimId);
    if (claim.status !== "claimed") throw userError("This was already decided.");
    const cleaner = await owned(ctx, claim.cleanerId);
    await ctx.db.patch(claim._id, { status: args.confirm ? "confirmed" : "declined", decidedBy: ctx.member._id, decidedAt: Date.now() });
    if (args.confirm && !cleaner.skills.includes(claim.skill)) await ctx.db.patch(cleaner._id, { skills: [...cleaner.skills, claim.skill], updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.confirm ? "cleaner.skill_confirmed" : "cleaner.skill_declined", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { skill: claim.skill } });
    return null;
  },
});
