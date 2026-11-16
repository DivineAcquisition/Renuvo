/**
 * Recruiter's workspace: the overview, the Playbook, the hiring inbox connection, and the answer to an
 * urgent request from Dispatch. Every number is counted from records at the moment it is asked for.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { isTimezone } from "./lib/availability";
import { companyQuery, managerMutation, managerQuery, ownerMutation } from "./lib/builders";
import { linksConfigured } from "./lib/dispatch/links";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { emailProvider } from "./lib/messaging/email";
import { messagingProvider } from "./lib/messaging/provider";
import { calendarProvider } from "./lib/recruiter/calendar";
import { reminderSweep } from "./lib/recruiter/interviews";
import { followUpSweep } from "./lib/recruiter/invitations";
import { connectorFor } from "./lib/recruiter/mailbox";
import { hiringModel } from "./lib/recruiter/model";
import { redactDue } from "./lib/recruiter/retention";
import { recruiterSettingsValidator, sourceValidator, type Stage } from "./lib/recruiter/schema";
import { DAY, recruiterSettings } from "./lib/recruiter/settings";
import { signatureProvider } from "./lib/recruiter/signature";
import { proposeUrgentOutreach, urgentCandidates } from "./lib/recruiter/urgent";
import { email, optionalText } from "./lib/text";

/** What Recruiter depends on outside itself, and whether each is there. A screen shows "not set up yet" from this, never a guess. */
function connections() {
  return {
    applicantLinks: linksConfigured(),
    email: emailProvider()?.name ?? null,
    texting: messagingProvider()?.name ?? null,
    calendar: calendarProvider()?.name ?? null,
    signing: signatureProvider()?.name ?? null,
    reader: hiringModel().name,
  };
}

export const overview = companyQuery({
  args: {},
  handler: async (ctx) => {
    const count = async (stage: Stage) =>
      (
        await ctx.db
          .query("applications")
          .withIndex("by_company_stage", (q) => q.eq("companyId", ctx.companyId).eq("stage", stage))
          .take(1000)
      );
    const stages = { received: await count("received"), contact_needed: await count("contact_needed"), invitation_awaiting_approval: await count("invitation_awaiting_approval"), invited: await count("invited"), application_started: await count("application_started"), application_submitted: await count("application_submitted"), screening: await count("screening"), interview: await count("interview"), decision_pending: await count("decision_pending"), offer_sent: await count("offer_sent"), accepted: await count("accepted"), onboarding_handoff: await count("onboarding_handoff") };
    const needs = await ctx.db
      .query("hiringNeeds")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open"))
      .take(200);
    const mailboxes = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(20);
    const now = Date.now();
    const failed = (
      await ctx.db
        .query("messages")
        .withIndex("by_company_queued", (q) => q.eq("companyId", ctx.companyId).gt("queuedAt", now - 14 * DAY))
        .take(2000)
    ).filter((row) => row.applicationId && (row.status === "failed" || row.status === "unconfirmed" || row.status === "not_sent"));
    const flagged = (
      await ctx.db
        .query("sourceMessages")
        .withIndex("by_company_received", (q) => q.eq("companyId", ctx.companyId).gt("receivedAt", now - 14 * DAY))
        .take(2000)
    ).filter((row) => row.flag !== undefined && !row.redactedAt);
    const awaitingForm = [...stages.invited, ...stages.application_started];
    return {
      asOf: now,
      openHiringNeeds: needs.length,
      newApplications: stages.received.length,
      contactNeeded: stages.contact_needed.length,
      invitationsAwaitingApproval: stages.invitation_awaiting_approval.length,
      /** Invited or started, and Recruiter has run out of reminders or the applicant asked something. */
      incompleteNeedingFollowUp: awaitingForm.filter((row) => row.nextAction?.by === "owner" || row.questionSince !== undefined).length,
      incompleteApplications: awaitingForm.length,
      awaitingScreening: stages.application_submitted.length + stages.screening.length,
      awaitingInterview: stages.interview.length,
      decisionsAwaitingOwner: stages.decision_pending.length,
      offersOut: stages.offer_sent.length,
      awaitingOnboardingHandoff: stages.accepted.length,
      inOnboarding: stages.onboarding_handoff.length,
      inbox: mailboxes.map((row) => ({ connectionId: row._id, address: row.address, provider: row.provider, status: row.status, problem: row.problem ?? null, lastSyncAt: row.lastSyncAt ?? null, connectorBuilt: connectorFor(row.provider) !== null })),
      inboxConnected: mailboxes.some((row) => row.status === "connected"),
      failures: { messages: failed.length, flaggedMessages: flagged.length, mailboxes: mailboxes.filter((row) => row.status !== "connected").length },
      connections: connections(),
      paused: ctx.company.pausedAgents.includes("recruiter"),
    };
  },
});

// ── Playbook ─────────────────────────────────────────────────────────────────────────────────────

export const playbook = companyQuery({
  args: {},
  handler: async (ctx) => ({ settings: recruiterSettings(ctx.company), timezone: ctx.company.timezone, connections: connections() }),
});

export const updatePlaybook = ownerMutation({
  args: { settings: recruiterSettingsValidator },
  handler: async (ctx, args) => {
    const next = { ...(ctx.company.recruiter ?? {}), ...args.settings };
    const within = (value: number | undefined, min: number, max: number, label: string) => {
      if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw userError(`${label} must be between ${min} and ${max}.`);
    };
    within(next.maxFollowUps, 0, 5, "The number of reminders");
    within(next.linkTtlDays, 1, 60, "Days an application link works");
    within(next.offerTtlDays, 1, 30, "Days an offer stays open");
    within(next.retentionDays, 30, 2555, "Days applicant records are kept");
    within(next.interviewMinutes, 10, 240, "Interview length");
    within(next.interviewReminderHours, 1, 72, "Hours before an interview the reminder goes");
    within(next.decideWithinHours, 1, 336, "Hours to decide a proposal");
    within(next.sendFromMinute, 0, 1439, "The start of sending hours");
    within(next.sendUntilMinute, 1, 1440, "The end of sending hours");
    if ((next.followUpHours ?? []).length > 5 || (next.followUpHours ?? []).some((hours) => !Number.isFinite(hours) || hours < 12 || hours > 720)) throw userError("Reminders are at most five, each between 12 hours and 30 days after the invitation.");
    const reminders = next.followUpHours ?? [];
    if (new Set(reminders).size !== reminders.length) throw userError("Two reminders are set for the same time. Each reminder needs its own delay.");
    if (next.maxFollowUps !== undefined && (!Number.isInteger(next.maxFollowUps) || next.maxFollowUps > reminders.length)) throw userError("The number of reminders must be a whole number and no more than the reminders you have scheduled.");
    if (next.sendFromMinute !== undefined && next.sendUntilMinute !== undefined && next.sendFromMinute >= next.sendUntilMinute) throw userError("Sending hours must end after they start.");
    if (next.sendDays !== undefined && next.sendDays.length === 0) throw userError("Choose at least one day messages may be sent.");
    if (next.onboardingRequirements !== undefined) {
      const items = next.onboardingRequirements.map((item) => ({ key: item.key.trim().toLowerCase(), label: item.label.trim() }));
      if (items.length === 0) throw userError("A new worker needs at least one onboarding requirement.");
      if (items.some((item) => !/^[a-z0-9_]{1,40}$/.test(item.key) || !item.label || item.label.length > 120)) throw userError("Each onboarding requirement needs a short key of letters, numbers or underscores, and a label.");
      if (new Set(items.map((item) => item.key)).size !== items.length) throw userError("Two onboarding requirements share a key.");
      next.onboardingRequirements = items;
    }
    if ((next.sendDays ?? []).some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw userError("Sending days are numbered 0 (Sunday) to 6 (Saturday).");
    if (next.replyTo !== undefined) next.replyTo = next.replyTo.trim() ? email(next.replyTo, "The reply address") : undefined;
    next.fromName = optionalText(next.fromName, "The sender name", 80);
    next.recruitingRules = optionalText(next.recruitingRules, "Recruiting rules", 4000);
    next.communicationPolicy = optionalText(next.communicationPolicy, "The communication policy", 4000);
    next.escalationRules = optionalText(next.escalationRules, "Escalation rules", 4000);
    if (!isTimezone(ctx.company.timezone)) throw userError("Set the company's time zone first.");
    await ctx.db.patch(ctx.companyId, { recruiter: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "recruiter.playbook_changed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return null;
  },
});

// ── The hiring inbox ─────────────────────────────────────────────────────────────────────────────

/**
 * Records which mailbox is the hiring inbox and from when to read it. Authorizing Selestial to read it
 * happens with the mailbox provider; no credential is passed through or stored by this function.
 */
export const connectMailbox = ownerMutation({
  args: {
    provider: v.union(v.literal("gmail"), v.literal("microsoft"), v.literal("mock")),
    address: v.string(),
    folder: v.optional(v.string()),
    sources: v.optional(v.array(sourceValidator)),
    /** Read mail received from this time on. Earlier than now is an explicit historical import. */
    processFrom: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const address = email(args.address, "The hiring inbox");
    const now = Date.now();
    const processFrom = args.processFrom ?? now;
    if (processFrom < now - 180 * DAY) throw userError("A historical import can go back at most 180 days.");
    const existing = await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(20);
    if (existing.some((row) => row.address === address && row.status !== "disconnected")) throw userError("That inbox is already connected.");
    const connectionId = await ctx.db.insert("mailboxConnections", { companyId: ctx.companyId, provider: args.provider, address, folder: optionalText(args.folder, "The folder or label", 200), sources: args.sources ?? [], processFrom, status: "connected", failures: 0, createdBy: ctx.member._id, createdAt: now });
    // Replies to Recruiter's emails go to the hiring inbox unless the Owner has named another address.
    if (!ctx.company.recruiter?.replyTo) await ctx.db.patch(ctx.companyId, { recruiter: { ...(ctx.company.recruiter ?? {}), replyTo: address } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.connected", actor: byMember(ctx), subject: { table: "mailboxConnections", id: connectionId }, data: { provider: args.provider, historical: processFrom < now } });
    return connectionId;
  },
});

/** After the Owner has authorized the mailbox again. */
export const reconnectMailbox = ownerMutation({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await owned(ctx, args.connectionId);
    await ctx.db.patch(connection._id, { status: "connected", problem: undefined, failures: 0 });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.connected", actor: byMember(ctx), subject: { table: "mailboxConnections", id: connection._id }, data: { provider: connection.provider, historical: false } });
    await ctx.scheduler.runAfter(0, internal.recruiterInbox.sync, { connectionId: connection._id });
    return null;
  },
});

export const disconnectMailbox = ownerMutation({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await owned(ctx, args.connectionId);
    await ctx.db.patch(connection._id, { status: "disconnected", problem: undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "mailbox.disconnected", actor: byMember(ctx), subject: { table: "mailboxConnections", id: connection._id } });
    return null;
  },
});

/** Reads the inbox now instead of at the next scheduled run. */
export const readInboxNow = managerMutation({
  args: { connectionId: v.id("mailboxConnections") },
  handler: async (ctx, args) => {
    const connection = await owned(ctx, args.connectionId);
    if (connection.status === "disconnected") throw userError("That inbox is disconnected.");
    await ctx.scheduler.runAfter(0, internal.recruiterInbox.sync, { connectionId: connection._id });
    return null;
  },
});

/** What was seen in the inbox, newest first. Unrelated mail appears only as a count: nothing about it was kept. */
export const inboxMessages = managerQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sourceMessages")
      .withIndex("by_company_received", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(Math.min(args.limit ?? 100, 300));
    return {
      unrelated: rows.filter((row) => row.classification === "unrelated").length,
      messages: rows
        .filter((row) => row.classification !== "unrelated")
        .map((row) => ({ sourceMessageId: row._id, classification: row.classification, classifiedBy: row.classifiedBy, reason: row.reason ?? null, source: row.source ?? null, from: row.fromAddress ?? null, subject: row.subject ?? null, receivedAt: row.receivedAt, applicationId: row.applicationId ?? null, flag: row.flag ?? null })),
    };
  },
});

// ── Urgent requests from Dispatch ────────────────────────────────────────────────────────────────

/** Dispatch's open requests for hiring help. A request is a question for a person: it opens no role and approves no pay. */
export const staffingRequests = companyQuery({
  args: {},
  handler: async (ctx) => {
    const tasks = [];
    for (const status of ["open", "needs_decision", "waiting"] as const) {
      tasks.push(
        ...(await ctx.db
          .query("tasks")
          .withIndex("by_company_agent_status", (q) => q.eq("companyId", ctx.companyId).eq("agent", "recruiter").eq("status", status))
          .take(200)),
      );
    }
    return tasks
      .filter((task) => task.key?.startsWith("recruiter.urgent_hire:") || task.key?.startsWith("recruiter.staffing_gap:"))
      .map((task) => ({ taskId: task._id, kind: task.key!.startsWith("recruiter.urgent_hire:") ? ("urgent_hire" as const) : ("staffing_gap" as const), title: task.title, what: task.nextAction ?? task.openQuestion ?? null, dueAt: task.dueAt, about: task.about ?? null }));
  },
});

export const urgentRequest = managerQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    return { title: task.title, dueAt: task.dueAt, ...(await urgentCandidates(ctx, task)) };
  },
});

/** Asks a person to approve contacting these existing applicants about an urgent need. Nothing is sent here. */
export const prepareUrgentOutreach = managerMutation({
  args: { taskId: v.id("tasks"), applicationIds: v.array(v.id("applications")) },
  handler: async (ctx, args) => {
    const task = await owned(ctx, args.taskId);
    const out = [];
    for (const applicationId of args.applicationIds.slice(0, 20)) out.push({ applicationId, ...(await proposeUrgentOutreach(ctx, task, await owned(ctx, applicationId))) });
    return out;
  },
});

// ── Kept on a schedule ───────────────────────────────────────────────────────────────────────────

export const followUps = internalMutation({ args: {}, handler: async (ctx) => followUpSweep(ctx, Date.now()) });
export const interviewReminders = internalMutation({ args: {}, handler: async (ctx) => reminderSweep(ctx, Date.now()) });
export const retention = internalMutation({ args: {}, handler: async (ctx) => redactDue(ctx, Date.now()) });
