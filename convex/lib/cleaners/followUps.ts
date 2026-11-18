/**
 * Routine follow-ups with cleaners (docs/cleaners/00-architecture.md, section 6). Until Team Coordinator
 * exists, each is run by the launch agent that owns the work underneath: Recruiter reminds new cleaners about
 * onboarding; Dispatch asks cleaners to confirm availability and checks in with idle ones.
 *
 * The rules, in code:
 *  - One open follow-up per cleaner and topic (`key`), whichever workspace started it, and no message within
 *    the company's reminder window of any other routine message to the same person.
 *  - Before anything is sent, the follow-up is checked again: still unresolved, the person still active, the
 *    agent's permission at this moment (Off stops it, Propose asks a person in Approvals), and then the one
 *    sending policy (consent, opt-out, quiet hours, frequency). The message is checked once more as it goes.
 *  - After the company's limit of reminders, a person is asked to step in. Silence is never read as anything:
 *    no status changes, no consequence, no score.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import { recordEvent, type Actor } from "../events";
import { openTask, liveTaskByKey, setTaskState } from "../taskState";
import { channelsFor, queueCleanerMessage } from "./outbox";
import { issuePortalLink } from "./portal";
import { cleanerReadiness } from "./records";
import type { RequirementView } from "./readiness";
import type { FollowUpTopic } from "./schema";
import { cleanersSettings, DAY, HOUR } from "./settings";

export const TOPIC_AGENT: Record<FollowUpTopic, "recruiter" | "dispatch"> = { onboarding: "recruiter", availability: "dispatch", idle_check_in: "dispatch" };
export const TOPIC_ACTION: Record<FollowUpTopic, string> = { onboarding: "recruiter.onboarding_reminder", availability: "dispatch.availability_check_in", idle_check_in: "dispatch.availability_check_in" };
const PURPOSE: Record<FollowUpTopic, "onboarding_reminder" | "availability_check" | "idle_check_in"> = { onboarding: "onboarding_reminder", availability: "availability_check", idle_check_in: "idle_check_in" };
const LINK_PURPOSE: Record<FollowUpTopic, "task" | "availability" | "check_in"> = { onboarding: "task", availability: "availability", idle_check_in: "check_in" };
/** Messages from this workspace that count against the reminder window, whatever topic they were about. */
const ROUTINE: readonly Doc<"messages">["purpose"][] = ["portal_invitation", "onboarding_reminder", "availability_check", "idle_check_in"];
const OPEN: readonly Doc<"followUps">["status"][] = ["scheduled", "awaiting_approval", "sent"];

export const followUpKey = (topic: FollowUpTopic, cleanerId: Id<"cleaners">) => `cleaner.${topic}:${cleanerId}`;

/** Names a question a cleaner asked from their portal. While one is unanswered, routine reminders wait. */
export const helpKey = (cleanerId: Id<"cleaners">) => `cleaner.help:${cleanerId}`;
const WAITING_ON_US = "They asked the office a question that is not answered yet. Reminders wait until a person replies.";

/** The onboarding steps a reminder can ask about: things the cleaner can do and has not done. Items waiting on the company are not theirs to chase. */
export function cleanerOwes(views: RequirementView[]): RequirementView[] {
  return views.filter((view) => view.cleanerCompletes && !view.met && view.state !== "submitted" && view.state !== "awaiting_review");
}

export type Need = { summary: string; items: { key: string; label: string }[] } | null;

/** What the topic still needs from this cleaner, read from the record now. Null means nothing. */
export async function needFor(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, topic: FollowUpTopic, now: number): Promise<Need> {
  if (cleaner.status === "ended" || cleaner.status === "suspended" || cleaner.status === "paused") return null;
  const settings = cleanersSettings(company);
  if (topic === "onboarding") {
    const { readiness } = await cleanerReadiness(ctx, company, cleaner, now);
    const unique = cleanerOwes(readiness.requirements);
    if (unique.length === 0) return null;
    return { summary: `${unique.length} onboarding ${unique.length === 1 ? "step" : "steps"} still to do: ${unique.map((view) => view.label.toLowerCase()).join(", ")}.`, items: unique.map((view) => ({ key: view.key, label: view.label })) };
  }
  if (topic === "availability") {
    if (cleaner.status !== "ready") return null;
    const since = cleaner.availabilityConfirmedAt ?? cleaner.createdAt;
    if (now - since <= settings.availabilityConfirmDays * DAY) return null;
    return { summary: cleaner.availabilityConfirmedAt ? `Weekly hours last confirmed more than ${settings.availabilityConfirmDays} days ago.` : "Weekly hours have never been confirmed with them.", items: [] };
  }
  // idle_check_in: active and ready, yet no accepted work, no answered offer and nothing done through their portal
  // for the company's window. Silence after a check-in is never read as leaving: it goes to a person.
  if (cleaner.status !== "ready") return null;
  const window = settings.idleAfterDays * DAY;
  if (now - cleaner.createdAt < window) return null;
  if (cleaner.checkIn && (now - cleaner.checkIn.at < window || (cleaner.checkIn.until !== undefined && cleaner.checkIn.until > now))) return null;
  if (cleaner.checkIn?.answer === "stop") return null;
  const { readiness } = await cleanerReadiness(ctx, company, cleaner, now);
  if (!readiness.eligible) return null;
  const since = now - window;
  for (const status of ["accepted", "declined", "offered"] as const) {
    const recent = await ctx.db
      .query("assignments")
      .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id).eq("status", status))
      .order("desc")
      .take(20);
    if (recent.some((row) => row.offeredAt >= since || (row.respondedAt ?? 0) >= since || (status === "accepted" && (row.jobStartsAt ?? 0) >= since))) return null;
  }
  const away = await ctx.db
    .query("timeOff")
    .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id).gt("endsAt", now))
    .take(20);
  if (away.some((row) => row.startsAt <= now)) return null;
  const links = await ctx.db
    .query("portalLinks")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
    .order("desc")
    .take(20);
  if (links.some((row) => (row.lastActionAt ?? 0) >= since)) return null;
  return { summary: `No accepted jobs, answered offers or portal activity in the last ${settings.idleAfterDays} days.`, items: [] };
}

/** What a reminder asks, in the message and in an approval. */
const ASKS: Record<FollowUpTopic, { message: string; approval: string; subject: (company: string) => string }> = {
  onboarding: { message: "", approval: "a reminder about onboarding", subject: (company) => `Finish your onboarding with ${company}` },
  availability: { message: "to confirm the days and hours you can work", approval: "a reminder to confirm their hours", subject: () => "Are your working hours still right?" },
  idle_check_in: { message: "we have not had work with you for a while. Are you still looking for jobs with us? Tell us in one tap", approval: "a check-in: are they still available for work?", subject: () => "Still available for work?" },
};

async function latestFor(ctx: MutationCtx, companyId: Id<"companies">, key: string): Promise<Doc<"followUps"> | null> {
  return ctx.db
    .query("followUps")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .order("desc")
    .first();
}

async function note(ctx: MutationCtx, followUp: Doc<"followUps">, words: string, actor: Actor = { kind: "agent", agent: followUp.agent }) {
  await recordEvent(ctx, { companyId: followUp.companyId, type: "cleaner.follow_up", actor, subject: { table: "cleaners", id: followUp.cleanerId }, data: { words, topic: followUp.topic, followUpId: followUp._id } });
}

async function finish(ctx: MutationCtx, followUp: Doc<"followUps">, status: "resolved" | "stopped" | "not_sent" | "answered", reason: string) {
  await ctx.db.patch(followUp._id, { status, stopReason: reason, updatedAt: Date.now() });
  if (followUp.approvalId) {
    const approval = await ctx.db.get(followUp.approvalId);
    if (approval?.status === "pending") await ctx.db.patch(approval._id, { status: "expired", note: `No longer needed: ${reason}` });
  }
}

/**
 * Opens a follow-up when a cleaner needs one and none is open. A topic that already ran to its limit, or
 * that a person stopped, waits a reminder window before a new one may start.
 */
export async function ensureFollowUp(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, topic: FollowUpTopic, now: number): Promise<Doc<"followUps"> | null> {
  const key = followUpKey(topic, cleaner._id);
  const latest = await latestFor(ctx, company._id, key);
  if (latest && OPEN.includes(latest.status)) return latest;
  const need = await needFor(ctx, company, cleaner, topic, now);
  if (!need) return null;
  const settings = cleanersSettings(company);
  if (latest && now - latest.updatedAt < Math.max(settings.reminderEveryHours * HOUR, latest.status === "stopped" ? 14 * DAY : 0)) return null;
  // The first reminder waits a day after the person was added, so it never lands on top of their invitation.
  const dueAt = Math.max(now, cleaner.createdAt + DAY);
  const id = await ctx.db.insert("followUps", {
    companyId: company._id,
    cleanerId: cleaner._id,
    topic,
    key,
    agent: TOPIC_AGENT[topic],
    status: "scheduled",
    summary: need.summary,
    evidence: need.items.map((item) => ({ kind: "requirement" as const, id: item.key, label: item.label })),
    attempt: 0,
    dueAt,
    createdAt: now,
    updatedAt: now,
  });
  const row = (await ctx.db.get(id))!;
  await note(ctx, row, `${topic === "onboarding" ? "Recruiter scheduled a reminder" : topic === "availability" ? "Dispatch scheduled a reminder" : "Dispatch scheduled a check-in"}: ${need.summary}`);
  return row;
}

/** Why a follow-up should not go now, in words, or null. Checked when it runs and again when its message goes. */
export async function followUpBlocker(ctx: MutationCtx, followUpId: Id<"followUps">): Promise<string | null> {
  const followUp = await ctx.db.get(followUpId);
  if (!followUp) return "The follow-up no longer exists.";
  if (followUp.status === "resolved" || followUp.status === "stopped" || followUp.status === "answered") return followUp.stopReason ?? "The follow-up is closed.";
  const company = await ctx.db.get(followUp.companyId);
  const cleaner = await ctx.db.get(followUp.cleanerId);
  if (!company || !cleaner) return "The cleaner is no longer in the record.";
  if (cleaner.status === "ended" || cleaner.status === "suspended" || cleaner.status === "paused") return `They are ${cleaner.status} now, so routine reminders stop.`;
  if (await liveTaskByKey(ctx, company._id, helpKey(cleaner._id))) return WAITING_ON_US;
  const need = await needFor(ctx, company, cleaner, followUp.topic, Date.now());
  if (!need) return "What it was about is done.";
  return null;
}

async function recentRoutine(ctx: MutationCtx, followUp: Doc<"followUps">, since: number): Promise<Doc<"messages"> | null> {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", followUp.companyId).eq("cleanerId", followUp.cleanerId).gt("queuedAt", since))
    .take(20);
  // Its own last reminder counts too: a person pressing "send now" does not shorten the window.
  return rows.find((row) => ROUTINE.includes(row.purpose) && row.status !== "not_sent" && row.status !== "failed") ?? null;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Sends the reminder: a link scoped to the topic, and one message on the first channel that can reach them. */
async function send(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, followUp: Doc<"followUps">, need: NonNullable<Need>, now: number): Promise<void> {
  const settings = cleanersSettings(company);
  const channel = channelsFor(cleaner, settings.followUpChannels)[0];
  if (!channel) {
    await finish(ctx, followUp, "not_sent", "There is no phone number or email on file to reach them.");
    await note(ctx, followUp, "could not send a reminder: there is no way to reach them on file");
    return;
  }
  const actor: Actor = { kind: "agent", agent: followUp.agent };
  const link = await issuePortalLink(ctx, { companyId: company._id, holder: { cleanerId: cleaner._id }, purpose: LINK_PURPOSE[followUp.topic], expiresAt: now + 7 * DAY, followUpId: followUp._id, issuedBy: { kind: "agent", agent: followUp.agent }, actor });
  const attempt = followUp.attempt + 1;
  const what = followUp.topic === "onboarding" ? `to finish onboarding: ${need.items.map((item) => item.label.toLowerCase()).join(", ")}` : ASKS[followUp.topic].message;
  const body =
    followUp.topic === "idle_check_in"
      ? channel === "sms"
        ? `${company.name}: Hi ${firstName(cleaner.name)}, ${what}: {link}`
        : `Hi ${firstName(cleaner.name)},\n\n${what.charAt(0).toUpperCase()}${what.slice(1)} here: {link}\n\nYou can also take a break or change your hours there. This link is only for you and works for 7 days.\n\n${company.name}`
      : channel === "sms"
        ? `${company.name}: Hi ${firstName(cleaner.name)}, a reminder ${what}. It takes a few minutes: {link}`
        : `Hi ${firstName(cleaner.name)},\n\nA reminder ${what}.\n\nYou can do it here, on your phone: {link}\n\nThis link is only for you and works for 7 days.\n\n${company.name}`;
  const message = await queueCleanerMessage(ctx, {
    company,
    cleaner,
    channel,
    purpose: PURPOSE[followUp.topic],
    subject: ASKS[followUp.topic].subject(company.name),
    body,
    dedupeKey: `${followUp.key}:${followUp._id}:${attempt}`,
    link,
    followUpId: followUp._id,
    actor,
    agent: followUp.agent,
  });
  if (message.status === "not_sent") {
    await finish(ctx, followUp, "not_sent", message.problem ?? "It could not be sent.");
    await note(ctx, followUp, `could not send a reminder: ${message.problem ?? "it could not be sent"}`);
    return;
  }
  await ctx.db.patch(followUp._id, { status: "sent", attempt, lastSentAt: now, messageId: message._id, linkId: link?._id, channel, dueAt: now + settings.reminderEveryHours * HOUR, summary: need.summary, updatedAt: now });
  await note(ctx, followUp, `${message.status === "held" ? "prepared" : "sent"} reminder ${attempt} by ${channel === "sms" ? "text" : "email"}: ${need.summary}`);
}

/** Hands a follow-up that ran out of reminders to a person. Nothing about the cleaner changes. */
async function handToPerson(ctx: MutationCtx, company: Doc<"companies">, cleaner: Doc<"cleaners">, followUp: Doc<"followUps">) {
  const key = `${followUp.key}:person`;
  if (!(await liveTaskByKey(ctx, company._id, key))) {
    const due = Date.now() + 2 * DAY;
    const taskId = await openTask(ctx, {
      companyId: company._id,
      agent: followUp.agent,
      title: `Check in with ${cleaner.name} yourself`,
      nextAction: `${followUp.attempt} reminders went without a reply: ${followUp.summary} Reach out personally. Not answering a message is not a decision on their part.`,
      dueAt: due,
      completionCondition: "A person has spoken with them, or what the reminders were about is done",
      about: { table: "cleaners", id: cleaner._id },
      key,
      actor: { kind: "agent", agent: followUp.agent },
    });
    await ctx.db.patch(taskId, { handoffTo: "team_coordinator" });
    await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: `${followUp.attempt} reminders did not get a reply. ${followUp.summary ?? ""} Will you contact them yourself? Not answering is not a decision on their part.`.replace(/\s+/g, " "), dueAt: due, withPersonSince: Date.now() }, { kind: "agent", agent: followUp.agent });
    await ctx.db.patch(followUp._id, { taskId });
  }
  await finish(ctx, followUp, "stopped", `${followUp.attempt} reminders without a reply. A person was asked to reach out.`);
  await note(ctx, followUp, "stopped reminding after the company's limit and asked a person to reach out");
}

/**
 * One step of one follow-up: closes it if it is no longer needed, waits if another routine message just
 * went, asks a person if the agent is on Propose, sends if allowed, and hands over after the limit.
 */
export async function runFollowUp(ctx: MutationCtx, followUpId: Id<"followUps">, options: { approved?: boolean } = {}): Promise<{ ok: boolean; detail: string }> {
  const followUp = await ctx.db.get(followUpId);
  if (!followUp || !OPEN.includes(followUp.status)) return { ok: false, detail: "This follow-up is closed." };
  const company = (await ctx.db.get(followUp.companyId))!;
  const cleaner = await ctx.db.get(followUp.cleanerId);
  const now = Date.now();
  if (!cleaner) {
    await finish(ctx, followUp, "stopped", "The cleaner is no longer in the record.");
    return { ok: false, detail: "The cleaner is no longer in the record." };
  }
  const need = await needFor(ctx, company, cleaner, followUp.topic, now);
  if (!need) {
    const done = cleaner.status === "ready" || cleaner.status === "onboarding";
    await finish(ctx, followUp, done ? "resolved" : "stopped", done ? "What it was about is done." : "They are not active now, so routine reminders stop.");
    await note(ctx, followUp, done ? "closed the reminder: what it was about is done" : "stopped the reminder: they are not active now");
    return { ok: false, detail: done ? "What it was about is already done." : "They are not active now." };
  }
  const settings = cleanersSettings(company);
  // Their own question comes first: nothing routine goes to them until a person has answered it.
  if (await liveTaskByKey(ctx, company._id, helpKey(cleaner._id))) {
    await ctx.db.patch(followUp._id, { dueAt: now + settings.reminderEveryHours * HOUR, updatedAt: now });
    return { ok: false, detail: WAITING_ON_US };
  }
  // Did they act on the last reminder's link? Then wait for the review; acting is an answer.
  if (followUp.status === "sent" && followUp.linkId) {
    const link = await ctx.db.get(followUp.linkId);
    if (link?.lastActionAt && followUp.lastSentAt && link.lastActionAt > followUp.lastSentAt && options.approved !== true) {
      await ctx.db.patch(followUp._id, { summary: need.summary, dueAt: now + settings.reminderEveryHours * HOUR, lastSentAt: link.lastActionAt, updatedAt: now });
      return { ok: false, detail: "They acted on the last reminder; the next one waits." };
    }
  }
  if (followUp.status === "sent" && followUp.attempt >= settings.maxReminders) {
    await handToPerson(ctx, company, cleaner, followUp);
    return { ok: false, detail: "The reminder limit was reached; a person was asked to reach out." };
  }
  if (settings.maxReminders === 0) {
    await finish(ctx, followUp, "stopped", "The company sends no routine reminders.");
    return { ok: false, detail: "The company sends no routine reminders." };
  }
  // One routine message per window per person, whichever workspace sent it.
  const recent = await recentRoutine(ctx, followUp, now - settings.reminderEveryHours * HOUR);
  if (recent) {
    await ctx.db.patch(followUp._id, { dueAt: recent.queuedAt + settings.reminderEveryHours * HOUR, updatedAt: now });
    return { ok: false, detail: "Another message went to them recently; this one waits." };
  }
  if (!options.approved) {
    const authority = await authorityFor(ctx, company._id, TOPIC_ACTION[followUp.topic]);
    if (authority.kind === "paused") {
      await ctx.db.patch(followUp._id, { dueAt: now + HOUR, updatedAt: now });
      return { ok: false, detail: "The agent is paused." };
    }
    if (authority.kind !== "level" || authority.level === "off") {
      await finish(ctx, followUp, "stopped", "Routine reminders are turned off for this agent.");
      return { ok: false, detail: "Routine reminders are turned off." };
    }
    if (authority.level === "propose") {
      if (followUp.status !== "awaiting_approval") {
        const approvalId = await requestApproval(ctx, {
          companyId: company._id,
          action: TOPIC_ACTION[followUp.topic],
          summary: `Send ${cleaner.name} ${ASKS[followUp.topic].approval}`,
          reason: need.summary,
          authorizes: `One ${channelsFor(cleaner, settings.followUpChannels)[0] === "email" ? "email" : "text"} to ${cleaner.name} with a link to do it. It is checked again before it goes.`,
          ifWaiting: "Nothing is sent. The reminder stays prepared until you decide or it expires.",
          decideBy: now + 2 * DAY,
          proposal: { kind: "send_cleaner_follow_up", followUpId: followUp._id },
          about: { table: "cleaners", id: cleaner._id },
        });
        await ctx.db.patch(followUp._id, { status: "awaiting_approval", approvalId, summary: need.summary, updatedAt: now });
        await note(ctx, followUp, "prepared a reminder for your approval");
      }
      return { ok: true, detail: "Waiting for a person to approve." };
    }
  }
  await send(ctx, company, cleaner, followUp, need, now);
  return { ok: true, detail: "Sent." };
}

/** A person decided the proposal in Approvals. Approving runs every check again before anything goes. */
export async function afterFollowUpDecision(ctx: MutationCtx, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped", actor: Actor): Promise<{ ok: boolean; detail: string }> {
  if (approval.proposal?.kind !== "send_cleaner_follow_up") return { ok: false, detail: "Not a follow-up." };
  const followUp = await ctx.db.get(approval.proposal.followUpId);
  if (!followUp || followUp.companyId !== approval.companyId) return { ok: false, detail: "The follow-up no longer exists." };
  if (decision !== "approved") {
    await finish(ctx, followUp, "stopped", decision === "changed" ? "A person is following up their own way." : "A person chose not to send it.");
    await note(ctx, followUp, decision === "changed" ? "left the reminder to a person, who is following up their own way" : "did not send the reminder: a person skipped it", actor);
    return { ok: true, detail: "Not sent." };
  }
  return runFollowUp(ctx, followUp._id, { approved: true });
}

export async function afterFollowUpExpiry(ctx: MutationCtx, approval: Doc<"approvals">): Promise<void> {
  if (approval.proposal?.kind !== "send_cleaner_follow_up") return;
  const followUp = await ctx.db.get(approval.proposal.followUpId);
  if (followUp && followUp.status === "awaiting_approval") await finish(ctx, followUp, "stopped", "Nobody decided in time, so it was not sent.");
}

/** Every company's follow-ups: open the ones that are needed, and run the ones that are due. */
export async function sweep(ctx: MutationCtx, now: number): Promise<{ opened: number; ran: number }> {
  let opened = 0;
  let ran = 0;
  const companies = await ctx.db.query("companies").take(500);
  for (const company of companies) {
    if (company.suspendedAt !== undefined) continue;
    for (const status of ["onboarding", "ready"] as const) {
      const cleaners = await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
        .take(300);
      for (const cleaner of cleaners) {
        for (const topic of ["onboarding", "availability", "idle_check_in"] as const) {
          const before = await latestFor(ctx, company._id, followUpKey(topic, cleaner._id));
          const row = await ensureFollowUp(ctx, company, cleaner, topic, now);
          if (row && row._id !== before?._id) opened += 1;
        }
      }
    }
  }
  for (const status of ["scheduled", "sent"] as const) {
    const due = await ctx.db
      .query("followUps")
      .withIndex("by_status_due", (q) => q.eq("status", status).lte("dueAt", now))
      .take(200);
    for (const row of due) {
      await runFollowUp(ctx, row._id);
      ran += 1;
    }
  }
  return { opened, ran };
}
