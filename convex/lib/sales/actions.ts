/**
 * Everything the Sales agent prepares goes through here before a customer sees it.
 *
 *   prepare   writes the action: what, why, on what evidence, under which permission.
 *   route     reads the Owner's permission at that moment and does what it says: hold it for the first
 *             review batch, put it in the approvals queue, or send it. Paused or switched off, nothing
 *             goes and the action stays prepared, with words saying why.
 *   send      checks the action against the conversation as it is now, then plans the message in the
 *             one outbox (or, for a booking, requests it through the booking engine). A reply, a person
 *             stepping in or a revised quote since it was written makes it stale, and a stale action is
 *             never sent.
 *
 * An approval is for one exact action. Approving it, or deciding the first batch, changes no permission:
 * what the agent may do without asking is only ever changed in Settings.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { Channel } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { requestFromAgent } from "../../bookings";
import { planFollowUp, stopFollowUps } from "./agentFollowUps";
import { isOpen, load, SALES, setNext, setStage, type Opp } from "./agentOpportunity";
import { draftFor, ensurePublicId, markSent, priceOpportunity, sendProblem } from "./agentQuotes";
import type { ActionKind } from "./agentSchema";
import { queueSalesMessage, type SalesLink, type SalesPurpose } from "./outbox";
import { salesSettings } from "./settings";
import type { Voice } from "./words";

type Ctx = QueryCtx | MutationCtx;
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const REPLY_AND_QUOTE = "sales.reply_and_quote";
export const FOLLOW_UP = "sales.follow_up";
export const CONFIRM_BOOKING = "sales.confirm_booking";

export const ACTION_WORDS: Record<ActionKind, string> = {
  reply: "Reply",
  question: "Ask for details",
  send_quote: "Send quote",
  follow_up: "Follow up",
  booking_steps: "Explain booking steps",
  booking_request: "Book",
  escalation: "Needs a person",
};

const PURPOSE: Record<Exclude<ActionKind, "escalation">, SalesPurpose> = { reply: "sales_reply", question: "sales_reply", send_quote: "sales_quote", follow_up: "sales_follow_up", booking_steps: "sales_booking", booking_request: "sales_booking" };
const OPEN_STATUSES: readonly Doc<"salesActions">["status"][] = ["prepared", "awaiting_approval"];

export const BATCH_KEY = "sales.first-batch";

export async function openActions(ctx: Ctx, opportunity: Pick<Opp, "_id" | "companyId">): Promise<Doc<"salesActions">[]> {
  const rows = await ctx.db
    .query("salesActions")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .order("desc")
    .take(50);
  return rows.filter((row) => OPEN_STATUSES.includes(row.status));
}

/** Closes an approval that no longer has anything to approve, with why, so it leaves the queue. */
async function closeApproval(ctx: MutationCtx, approvalId: Id<"approvals"> | undefined, note: string) {
  const approval = approvalId ? await ctx.db.get(approvalId) : null;
  if (!approval || approval.status !== "pending") return;
  await ctx.db.patch(approval._id, { status: "expired", note: `No longer needed: ${note}`.slice(0, 500), decidedAt: Date.now() });
  await recordEvent(ctx, { companyId: approval.companyId, type: "approval.expired", actor: { kind: "system" }, subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
}

/** Sets an open action aside because the conversation moved on. It is kept, marked stale, and never sent. */
export async function retire(ctx: MutationCtx, action: Doc<"salesActions">, why: string, status: "stale" | "discarded" = "stale") {
  if (!OPEN_STATUSES.includes(action.status)) return;
  await ctx.db.patch(action._id, { status, result: why.slice(0, 400), updatedAt: Date.now() });
  await closeApproval(ctx, action.approvalId, why);
}

/** When the conversation moves on (a reply, a takeover, a close), what the agent had waiting is set aside. */
export async function retireOpenActions(ctx: MutationCtx, opportunity: Pick<Opp, "_id" | "companyId">, why: string, keep: (action: Doc<"salesActions">) => boolean = () => false): Promise<number> {
  let count = 0;
  for (const action of await openActions(ctx, opportunity)) {
    if (keep(action)) continue;
    await retire(ctx, action, why);
    count += 1;
  }
  return count;
}

export type NewAction = {
  kind: ActionKind;
  channel?: Channel;
  subject?: string;
  body?: string;
  quoteId?: Id<"salesQuotes">;
  followUpId?: Id<"salesFollowUps">;
  summary: string;
  reason: string;
  evidence: { label: string; detail: string }[];
  nextStep?: string;
  permission: string;
  runId?: Id<"salesRuns">;
  writtenBy?: string;
};

/** Writes one action. An older open action for the same opportunity is replaced, not duplicated. */
export async function prepareAction(ctx: MutationCtx, company: Doc<"companies">, opportunity: Opp, input: NewAction): Promise<Doc<"salesActions">> {
  for (const older of await openActions(ctx, opportunity)) if (older.kind === input.kind || older.kind !== "escalation") await retire(ctx, older, "Replaced by newer work on this opportunity.");
  const authority = await authorityFor(ctx, company._id, input.permission);
  const now = Date.now();
  const actionId = await ctx.db.insert("salesActions", {
    companyId: company._id,
    opportunityId: opportunity._id,
    customerId: opportunity.customerId,
    kind: input.kind,
    status: "prepared",
    channel: input.channel,
    subject: input.subject?.slice(0, 200),
    body: input.body?.slice(0, 2400),
    quoteId: input.quoteId,
    followUpId: input.followUpId,
    summary: input.summary.slice(0, 300),
    reason: input.reason.slice(0, 600),
    evidence: input.evidence.slice(0, 8).map((row) => ({ label: row.label.slice(0, 60), detail: row.detail.slice(0, 300) })),
    nextStep: input.nextStep?.slice(0, 300),
    permission: input.permission,
    level: authority.kind === "level" ? authority.level : authority.kind,
    basis: { revision: opportunity.agent.revision, lastInboundAt: opportunity.lastInboundAt, ...(input.quoteId ? { quoteId: input.quoteId } : {}) },
    runId: input.runId,
    writtenBy: input.writtenBy ?? "rules",
    createdAt: now,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: company._id, type: "sales_action.prepared", actor: SALES, subject: { table: "salesActions", id: actionId }, data: { kind: input.kind, opportunityId: opportunity._id } });
  return (await ctx.db.get(actionId))!;
}

/** Why an action written earlier must not go now, or null. The same checks run whether a person approved it a minute or a day later. */
export async function staleReason(ctx: Ctx, opportunity: Opp, action: Doc<"salesActions">, by: "sales" | "person"): Promise<string | null> {
  if (!OPEN_STATUSES.includes(action.status)) return `It was already ${action.status.replace(/_/g, " ")}.`;
  if (by === "sales" && opportunity.agent.takeover) return "A person took over this conversation, so the agent sends nothing.";
  if (!isOpen(opportunity.agent.stage) && !(action.kind === "follow_up" && opportunity.agent.stage === "deferred")) return "The opportunity is no longer open.";
  if ((opportunity.lastInboundAt ?? 0) > (action.basis.lastInboundAt ?? 0)) return "The customer replied after this was written. The agent reads the reply first.";
  if (action.quoteId) {
    const quote = await ctx.db.get(action.quoteId);
    if (!quote) return "The quote no longer exists.";
    if (action.kind === "send_quote") {
      const problem = sendProblem(quote);
      if (problem) return problem;
      if (opportunity.quoteId !== quote._id) return "The quote was revised after this was written.";
    } else if (action.kind !== "booking_request" && (quote.status === "withdrawn" || quote.status === "expired" || quote.status === "superseded")) return `The quote was ${quote.status} after this was written.`;
  }
  return null;
}

export async function voiceOf(ctx: Ctx, company: Doc<"companies">, opportunity: Opp): Promise<Voice> {
  const settings = salesSettings(company);
  return { company: company.name, tone: settings.voice.tone, signature: settings.voice.signature, firstContact: opportunity.firstResponseAt === undefined, channel: opportunity.agent.channel };
}

export type Sent = { ok: boolean; detail: string };

const firstNameOf = (name: string) => (/^[+\d\s().-]+$/.test(name.trim()) || name.includes("@") ? "the customer" : name.split(/\s+/)[0] || "the customer");

/**
 * Sends one action, if it is still right to. `actor` is who is sending: the agent (its own permission, or
 * a person's approval of the agent's exact words) or a member sending by hand. What follows the send, the
 * stage, the next step and the next reminder, is written here in the same step.
 */
export async function sendAction(ctx: MutationCtx, company: Doc<"companies">, opportunity: Opp, action: Doc<"salesActions">, actor: Actor): Promise<Sent> {
  const now = Date.now();
  const stale = await staleReason(ctx, opportunity, action, actor.kind === "member" ? "person" : "sales");
  if (stale) {
    await retire(ctx, action, stale);
    return { ok: false, detail: `Not sent. ${stale}` };
  }
  if (action.kind === "escalation") return { ok: false, detail: "This is a question for a person, not a message." };
  // A person's approval is the authority for this one message, but only for something Sales may do at all:
  // an action the Owner has since switched off, or one that is a person's decision, is not sent. (A pause is
  // checked by the send itself, which holds the message instead of dropping it.)
  const authority = await authorityFor(ctx, company._id, action.permission);
  if (authority.kind === "person_only" || authority.kind === "unknown" || (authority.kind === "level" && authority.level === "off")) {
    const why = authority.kind === "level" ? "This kind of message is switched off in Sales's permissions." : "This is a decision for a person, not something Sales may send.";
    await retire(ctx, action, why);
    return { ok: false, detail: `Not sent. ${why}` };
  }
  const customer = await ctx.db.get(opportunity.customerId);
  if (!customer) return { ok: false, detail: "Not sent. The customer record no longer exists." };
  const first = firstNameOf(customer.name);

  // Booking: the booking engine requests it, holds the time and confirms it when nothing is outstanding.
  if (action.kind === "booking_request") {
    // The draft is priced again with the time the customer chose, so the booking is made for that time.
    // A price that changed since they accepted is caught by the booking itself, and nothing is booked.
    const priced = await priceOpportunity(ctx, company, opportunity);
    if (priced.kind === "priced") await draftFor(ctx, opportunity, priced.body, priced.bookingKind);
    const booked = await requestFromAgent(ctx, company, await load(ctx, opportunity._id));
    if (!booked.ok) {
      await ctx.db.patch(action._id, { status: "failed", result: `Not booked. ${booked.problem}`.slice(0, 400), updatedAt: now });
      await closeApproval(ctx, action.approvalId, "The booking could not be made.");
      await setNext(ctx, await load(ctx, opportunity._id), { what: `The booking for ${first} could not be requested: ${booked.problem}`, by: "owner", dueAt: now + 4 * HOUR });
      return { ok: false, detail: `Not booked. ${booked.problem}` };
    }
    await ctx.db.patch(action._id, { status: "sent", bookingId: booked.bookingId, decidedAt: now, result: booked.confirmed ? "Booked, confirmed and handed to Dispatch." : `Booking requested. Waiting for: ${booked.blockers.join(" ") || "the last steps."}`.slice(0, 400), updatedAt: now });
    await recordEvent(ctx, { companyId: company._id, type: "sales_action.sent", actor, subject: { table: "salesActions", id: action._id }, data: { kind: action.kind, opportunityId: opportunity._id } });
    const fresh = await load(ctx, opportunity._id);
    if (booked.confirmed) return { ok: true, detail: "Booked and handed to Dispatch. The customer gets the confirmation." };
    // Not confirmed yet: the customer is told the time is held and what comes next, in the agent's own words.
    if (action.body?.trim() && action.channel) await queueSalesMessage(ctx, { company, customer, opportunity: fresh, purpose: "sales_booking", channel: action.channel, subject: action.subject, body: action.body, links: [], actionId: action._id, dedupeKey: `sales-action:${action._id}`, actor });
    const outstanding = booked.blockers[0] ?? "the last booking steps";
    await setNext(ctx, await load(ctx, opportunity._id), { what: `The booking for ${first} is requested and waits for: ${outstanding}`, by: /Owner or Manager|Prepare it/.test(outstanding) ? "owner" : "customer", dueAt: now + DAY });
    return { ok: true, detail: "The booking was requested. It confirms once its last steps are done." };
  }
  if (!action.body?.trim() || !action.channel) return { ok: false, detail: "Not sent. There is no message to send." };

  let quote = action.quoteId ? await ctx.db.get(action.quoteId) : null;
  const links: SalesLink[] = [];
  if (quote && action.body.includes("{link}")) {
    quote = await ensurePublicId(ctx, quote);
    links.push({ placeholder: "{link}", kind: "quote", id: quote._id });
  }
  const message = await queueSalesMessage(ctx, { company, customer, opportunity, purpose: PURPOSE[action.kind], channel: action.channel, subject: action.subject, body: action.body, links, actionId: action._id, dedupeKey: `sales-action:${action._id}`, actor });
  if (message.status === "not_sent") {
    const why = message.problem ?? "The message could not be sent.";
    await ctx.db.patch(action._id, { status: "failed", messageId: message._id, result: `Not sent. ${why}`, decidedAt: now, updatedAt: now });
    await closeApproval(ctx, action.approvalId, "It could not be sent.");
    await setNext(ctx, await load(ctx, opportunity._id), { what: `A message to ${customer.name} could not be sent: ${why}`, by: "owner", dueAt: now + 4 * HOUR });
    return { ok: false, detail: `Not sent. ${why}` };
  }
  await ctx.db.patch(action._id, { status: "sent", messageId: message._id, result: message.status === "held" ? `Held: ${message.problem ?? "it goes when quiet hours end."}` : "Handed to the message service. Delivery is shown on the message.", decidedAt: now, updatedAt: now });
  await recordEvent(ctx, { companyId: company._id, type: "sales_action.sent", actor, subject: { table: "salesActions", id: action._id }, data: { kind: action.kind, opportunityId: opportunity._id, channel: action.channel } });

  // What the send changes.
  let fresh = await load(ctx, opportunity._id);
  if (action.kind === "question") {
    if (fresh.agent.stage === "new") fresh = await setStage(ctx, fresh, "qualifying", actor);
    const next = await planFollowUp(ctx, company, fresh, { purpose: "missing_info", attempt: 1, reason: `No answer yet to the details the agent asked ${first} for.`, preview: action.body, actor: SALES });
    await setNext(ctx, fresh, { what: `Waiting for ${first} to answer${next ? "; a reminder is planned" : ""}`, by: "customer", dueAt: next?.dueAt ?? now + 3 * DAY });
  } else if (action.kind === "send_quote" && quote) {
    await markSent(ctx, quote, company, actor);
    fresh = await load(ctx, opportunity._id);
    if (fresh.agent.stage !== "quote_sent") fresh = await setStage(ctx, fresh, "quote_sent", actor);
    const next = await planFollowUp(ctx, company, fresh, { purpose: "quote", attempt: 1, reason: `${first} has the quote and has not answered.`, preview: action.body, quoteId: quote._id, actor: SALES });
    await setNext(ctx, fresh, { what: `Waiting for ${first} to accept, decline or ask about the quote`, by: "customer", dueAt: next?.dueAt ?? now + salesSettings(company).quotes.validDays * DAY });
  } else if (action.kind === "follow_up") {
    const followUp = action.followUpId ? await ctx.db.get(action.followUpId) : null;
    if (followUp) {
      await ctx.db.patch(followUp._id, { status: "sent", actionId: action._id, doneAt: now });
      const next = await planFollowUp(ctx, company, fresh, { purpose: followUp.purpose, attempt: followUp.attempt + 1, reason: followUp.reason, preview: action.body, quoteId: followUp.basis.quoteId, actor: SALES });
      // The last reminder in a sequence is the last one. After it, a person decides what happens next.
      if (next) await setNext(ctx, fresh, { what: `Waiting for ${first} to answer; reminder ${followUp.attempt} of ${followUp.maxAttempts} sent`, by: "customer", dueAt: next.dueAt });
      else await setNext(ctx, fresh, { what: `${first} has not answered after ${followUp.maxAttempts} ${followUp.maxAttempts === 1 ? "reminder" : "reminders"}. Close it, defer it, or reach out yourself. The agent will not send more.`, by: "owner", dueAt: now + 3 * DAY });
    }
  } else {
    await setNext(ctx, fresh, { what: `Waiting for ${first} to reply`, by: "customer", dueAt: now + 3 * DAY });
  }
  return { ok: true, detail: message.status === "held" ? `Planned. ${message.problem ?? "It goes when quiet hours end."}` : "Handed to the message service." };
}

/** The open first review batch, made if there is none. Its task is what tells the Owner it is waiting. */
async function openBatch(ctx: MutationCtx, company: Doc<"companies">): Promise<Doc<"salesBatches">> {
  const existing = await ctx.db
    .query("salesBatches")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "open"))
    .first();
  if (existing) return existing;
  const batchId = await ctx.db.insert("salesBatches", { companyId: company._id, status: "open", createdAt: Date.now() });
  return (await ctx.db.get(batchId))!;
}

export async function batchActions(ctx: Ctx, batch: Pick<Doc<"salesBatches">, "_id" | "companyId">): Promise<Doc<"salesActions">[]> {
  return ctx.db
    .query("salesActions")
    .withIndex("by_company_batch", (q) => q.eq("companyId", batch.companyId).eq("batchId", batch._id))
    .take(100);
}

/** Keeps the batch's task saying how many items are waiting. With nothing left to review it is closed. */
export async function syncBatchTask(ctx: MutationCtx, company: Doc<"companies">, batch: Doc<"salesBatches">): Promise<void> {
  const waiting = (await batchActions(ctx, batch)).filter((row) => row.status === "prepared").length;
  let task = await liveTaskByKey(ctx, company._id, BATCH_KEY);
  const now = Date.now();
  if (batch.status === "decided" || waiting === 0) {
    if (task) await setTaskState(ctx, task, "done", { outcome: batch.status === "decided" ? "The first review batch was decided." : "Nothing was left to review.", closedAt: now, withPersonSince: null }, SALES);
    return;
  }
  const question = `The Sales agent prepared its first ${waiting === 1 ? "message" : `${waiting} messages`} to customers. Nothing has been sent. Review each one on the Sales page: who it goes to, what it says and which quote it carries. Approving them does not change what the agent may do afterwards.`;
  if (!task) {
    const taskId = await openTask(ctx, { companyId: company._id, agent: "sales", title: "Review the Sales agent's first messages", nextAction: "Review the first batch", dueAt: now + DAY, completionCondition: "Every item in the first batch was sent or skipped by a person.", key: BATCH_KEY, actor: SALES });
    await ctx.db.patch(batch._id, { taskId });
    task = (await ctx.db.get(taskId))!;
  }
  await setTaskState(ctx, task, "needs_decision", { openQuestion: question, dueAt: task.dueAt, withPersonSince: task.withPersonSince ?? now }, SALES, { sameStatus: true });
}

export type Routed = "sent" | "awaiting_approval" | "batched" | "held" | "not_allowed" | "failed" | "for_person";

/**
 * Does what the Owner's permission says for this action, read now. The order matters: a paused or
 * switched-off action never reaches the batch or the queue as if it were waiting to go.
 */
export async function routeAction(ctx: MutationCtx, company: Doc<"companies">, opportunity: Opp, action: Doc<"salesActions">): Promise<Routed> {
  const now = Date.now();
  const customer = await ctx.db.get(opportunity.customerId);
  const name = customer?.name ?? "the customer";
  if (action.kind === "escalation") {
    await ctx.db.patch(action._id, { status: "awaiting_approval", updatedAt: now });
    await setNext(ctx, opportunity, { what: action.summary, by: "owner", dueAt: now + 4 * HOUR });
    return "for_person";
  }
  const authority = await authorityFor(ctx, company._id, action.permission);
  if (authority.kind === "paused") {
    await ctx.db.patch(action._id, { result: "Sales is paused, so this was prepared and not sent. It can go when Sales is resumed, or you can send it yourself.", updatedAt: now });
    await setNext(ctx, opportunity, { what: `Sales is paused. A ${ACTION_WORDS[action.kind].toLowerCase()} for ${name} is prepared and waiting.`, by: "owner", dueAt: now + DAY });
    return "held";
  }
  if (authority.kind !== "level" || authority.level === "off") {
    await ctx.db.patch(action._id, { result: "This is switched off for Sales, so it was prepared and not sent. You can send it yourself, or change the permission in Settings.", updatedAt: now });
    await setNext(ctx, opportunity, { what: `The agent prepared a ${ACTION_WORDS[action.kind].toLowerCase()} for ${name} but is not allowed to send it.`, by: "owner", dueAt: now + 4 * HOUR });
    return "not_allowed";
  }
  // Before the Owner has seen any of the agent's work, everything waits in one batch, whatever the level says.
  if (salesSettings(company).firstBatchDecidedAt === null) {
    const batch = await openBatch(ctx, company);
    await ctx.db.patch(action._id, { batchId: batch._id, updatedAt: now });
    await syncBatchTask(ctx, company, batch);
    await setNext(ctx, opportunity, { what: `A ${ACTION_WORDS[action.kind].toLowerCase()} for ${name} is in your first review batch.`, by: "owner", dueAt: now + DAY });
    return "batched";
  }
  if (authority.level === "propose") {
    const to = action.channel === "email" ? (customer?.email ?? "their email") : (customer?.phone ?? "their phone");
    const approvalId = await requestApproval(ctx, {
      companyId: company._id,
      action: action.permission,
      summary: `${action.summary}`.slice(0, 1000),
      reason: `${action.reason} ${action.evidence.map((row) => `${row.label}: ${row.detail}.`).join(" ")}`.trim().slice(0, 2000),
      authorizes:
        action.kind === "booking_request"
          ? `The agent will request the booking: check the time against capacity again, hold it, and ${action.channel === "email" ? "email" : "text"} ${name} what happens next. A payment link still needs an Owner or Manager. If the time is gone, nothing is booked.`
          : `The agent will ${action.channel === "email" ? "email" : "text"} ${name} at ${to}: "${(action.body ?? "").replace("{link}", "[their quote link]")}"`.slice(0, 2000),
      ifWaiting: "Nothing is sent. The customer keeps waiting, and the opportunity stays where it is.",
      proposal: { kind: "sales_action", actionId: action._id },
      decideBy: now + DAY,
      about: { table: "salesOpportunities", id: opportunity._id },
      ...(opportunity.taskId ? { taskId: opportunity.taskId } : {}),
    });
    await ctx.db.patch(action._id, { status: "awaiting_approval", approvalId, updatedAt: now });
    await setNext(ctx, opportunity, { what: `${action.summary} Waiting for your approval.`, by: "owner", dueAt: now + DAY });
    return "awaiting_approval";
  }
  const sent = await sendAction(ctx, company, opportunity, action, SALES);
  if (sent.ok && authority.level === "execute_and_report") {
    await recordEvent(ctx, { companyId: company._id, type: "sales.reported", actor: SALES, subject: { table: "salesActions", id: action._id }, data: { action: action.permission, kind: action.kind, opportunityId: opportunity._id } });
  }
  return sent.ok ? "sent" : "failed";
}

/** A person decided one waiting action: send it as written, send their own edit of it, or set it aside. */
export async function decideAction(ctx: MutationCtx, company: Doc<"companies">, action: Doc<"salesActions">, member: Doc<"members">, decision: { kind: "send"; body?: string; subject?: string } | { kind: "skip"; note?: string }): Promise<Sent> {
  const opportunity = await load(ctx, action.opportunityId).catch(() => null);
  if (!opportunity) return { ok: false, detail: "The opportunity no longer exists." };
  const now = Date.now();
  if (!OPEN_STATUSES.includes(action.status)) return { ok: false, detail: `This was already ${action.status.replace(/_/g, " ")}.` };
  await ctx.db.patch(opportunity._id, { humanTouches: opportunity.agent.humanTouches + 1 });
  if (decision.kind === "skip") {
    await ctx.db.patch(action._id, { status: "discarded", decidedBy: member._id, decidedAt: now, result: decision.note?.trim() ? `Set aside: ${decision.note.trim().slice(0, 300)}` : "Set aside by a person.", updatedAt: now });
    await closeApproval(ctx, action.approvalId, "A person set it aside on the Sales page.");
    if (action.followUpId) await ctx.db.patch(action.followUpId, { status: "skipped", stopReason: "A person set the reminder aside.", doneAt: now });
    await setNext(ctx, await load(ctx, opportunity._id), { what: "You set the agent's draft aside. Decide the next step, or hand it back to the agent.", by: "owner", dueAt: now + DAY }, { kind: "member", memberId: member._id });
    return { ok: true, detail: "Set aside. Nothing was sent." };
  }
  const edited = decision.body !== undefined && decision.body.trim() !== (action.body ?? "").trim();
  if (edited || decision.subject !== undefined) await ctx.db.patch(action._id, { body: decision.body?.trim().slice(0, 2400) ?? action.body, subject: decision.subject?.trim().slice(0, 200) ?? action.subject, ...(edited ? { editedBy: member._id } : {}) });
  await ctx.db.patch(action._id, { decidedBy: member._id });
  await closeApproval(ctx, action.approvalId, "It was decided on the Sales page.");
  // A person's own edit goes out as theirs. Unchanged, it is the agent's message with a person's approval.
  const actor: Actor = edited ? { kind: "member", memberId: member._id } : SALES;
  return sendAction(ctx, company, await load(ctx, opportunity._id), (await ctx.db.get(action._id))!, actor);
}

/** Ends reminders and waiting drafts when a stop condition is met, in one place. */
export async function quiet(ctx: MutationCtx, opportunity: Pick<Opp, "_id" | "companyId">, why: string, actor: Actor): Promise<void> {
  await stopFollowUps(ctx, opportunity, why, actor);
  await retireOpenActions(ctx, opportunity, why);
}
