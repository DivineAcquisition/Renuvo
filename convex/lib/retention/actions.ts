/**
 * What Retention does about a case. An action is prepared first (what, why, at what cost, under which
 * permission), then routed by the Owner's authority for that permission: carried out, or put in the one
 * approvals queue. Whichever way it goes, every check runs again at the moment it is carried out, against
 * the evidence as it is then: an approval given this morning does not book a time that has since filled,
 * credit an invoice that has since been paid, or answer a customer who has since written again.
 *
 * Carrying out an action never closes a case. A booked correction visit is a handoff to Dispatch; a
 * credit is a change in Finance; a message is a question. Each names who has it, the record to watch
 * and what is expected back, and the case stays open until that comes back and is verified.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { localParts } from "../availability";
import { handOff as handToQueue } from "../dispatch/handoffs";
import { money } from "../dispatch/pay";
import { coverKey } from "../dispatch/workflow";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { recompute } from "../finance/ledger";
import { createVisit } from "../jobs/visits";
import { isOwner, roleOf } from "../roles";
import { checkCapacity } from "../sales/capacity";
import { businessSettingsOf } from "../settings/business";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { addLocalDays, clock, dayName, startOfLocalDay } from "../time";
import { addEntry, closeCase, DAY, HOUR, moveCase, permitFor, propertyName, RETENTION, SYSTEM } from "./cases";
import { issueCareLink } from "./links";
import { careChannel, queueCareMessage, type CarePurpose } from "./outbox";
import { applyPlanChange, CHANGE_OUTCOME, NEEDS_PERSON } from "./planChanges";
import { retentionSettings } from "./settings";
import type { ActionKind, HandoffTo, LinkPurpose } from "./schema";

type Ctx = QueryCtx | MutationCtx;
type Action = Doc<"retentionActions">;
type Case = Doc<"retentionCases">;
export type CarriedOut = { ok: boolean; detail: string };

export const ACTION_WORDS: Record<ActionKind, string> = {
  request_feedback: "Ask for feedback",
  correction_visit: "Correction visit",
  inspection: "Inspection",
  different_cleaner: "Different cleaner",
  credit: "Credit",
  refund: "Refund",
  scope_clarification: "Scope clarification",
  message: "Message to the customer",
  confirm_correction: "Ask whether the correction worked",
  plan_change: "Plan change",
  billing_review: "Billing review",
  renewal_proposal: "Renewal proposal",
  service_review: "Service review",
  return_offer: "Return offer",
  dispatch_review: "Dispatch review",
};

const MESSAGE_KINDS: readonly ActionKind[] = ["request_feedback", "message", "scope_clarification", "confirm_correction", "return_offer"];
const HANDOFF_WORDS: Record<HandoffTo, string> = { dispatch: "Dispatch", sales: "Sales", finance: "Finance (the Owner)", quality: "Quality (a person)", owner: "The Owner" };

export const whenWords = (at: number, timezone: string) => `${dayName(at, timezone)} at ${clock(at, timezone)}`;

export async function actionsOf(ctx: Ctx, row: Pick<Case, "_id" | "companyId">): Promise<Action[]> {
  return ctx.db
    .query("retentionActions")
    .withIndex("by_company_case", (q) => q.eq("companyId", row.companyId).eq("caseId", row._id))
    .take(100);
}

// ── What an action was prepared against ──────────────────────────────────────────────────────────

/**
 * The facts an action depends on, as one string. If it differs when the action is about to be carried
 * out, the evidence has moved on and the action is not carried out as prepared.
 */
export async function stampFor(ctx: Ctx, row: Case, action: Pick<Action, "kind" | "visit" | "money" | "planChange" | "message">): Promise<string> {
  const parts: (string | number)[] = [row.status === "closed" ? "closed" : "open", row.diagnosis?.category ?? "none", row.areas.join(","), row.serious ? "serious" : "", row.heldBy ? "held" : ""];
  const job = row.jobId ? await ctx.db.get(row.jobId) : null;
  if (job) parts.push(job.status, job.startsAt);
  if (action.visit) parts.push(action.visit.startsAt ?? 0, action.visit.minutes, action.visit.avoidCleanerIds.join(","));
  if (action.money?.invoiceId) {
    const invoice = await ctx.db.get(action.money.invoiceId);
    parts.push(invoice?.status ?? "gone", invoice?.totals.balanceCents ?? 0, action.money.amountCents);
  }
  if (action.planChange) parts.push(action.planChange.change, action.planChange.from ?? "", [...action.planChange.shown].map(String).sort().join(","));
  if (action.message) {
    // A message is an answer to the conversation as it stood. If the customer has written since, it is stale.
    const last = await ctx.db
      .query("inboundMessages")
      .withIndex("by_company_customer", (q) => q.eq("companyId", row.companyId).eq("customerId", row.customerId))
      .order("desc")
      .first();
    parts.push(last?.receivedAt ?? 0);
  }
  return parts.join("|");
}

// ── Preparing ────────────────────────────────────────────────────────────────────────────────────

export type NewAction = Pick<Action, "kind" | "summary" | "reason" | "permission"> &
  Partial<Pick<Action, "message" | "visit" | "money" | "planChange" | "estimatedCostCents" | "costBasis" | "dueAt">> & { key: string; actor: Actor };

/** Prepares one action on a case. Asked twice with the same key, it answers with the first. Nothing is done yet. */
export async function prepareAction(ctx: MutationCtx, row: Case, input: NewAction): Promise<Action> {
  const key = `${row._id}:${input.key}`;
  const existing = await ctx.db
    .query("retentionActions")
    .withIndex("by_company_key", (q) => q.eq("companyId", row.companyId).eq("key", key))
    .first();
  if (existing) return existing;
  const now = Date.now();
  const actionId = await ctx.db.insert("retentionActions", {
    companyId: row.companyId,
    caseId: row._id,
    kind: input.kind,
    status: "proposed",
    key,
    summary: input.summary.slice(0, 300),
    reason: input.reason.slice(0, 1000),
    permission: input.permission,
    message: input.message,
    visit: input.visit,
    money: input.money,
    planChange: input.planChange,
    estimatedCostCents: input.estimatedCostCents,
    costBasis: input.costBasis,
    dueAt: input.dueAt,
    preparedAt: now,
    stamp: await stampFor(ctx, row, input),
    createdBy: input.actor,
    createdAt: now,
    updatedAt: now,
  });
  await addEntry(ctx, row, { kind: "action", text: `Prepared: ${input.summary}`, actor: input.actor });
  await recordEvent(ctx, { companyId: row.companyId, type: "retention_action.prepared", actor: input.actor, subject: { table: "retentionActions", id: actionId }, data: { kind: input.kind } });
  return (await ctx.db.get(actionId))!;
}

async function setAction(ctx: MutationCtx, action: Action, patch: Partial<Action>): Promise<Action> {
  const done = patch.status === "done" || patch.status === "failed" || patch.status === "declined" || patch.status === "cancelled";
  await ctx.db.patch(action._id, { ...patch, updatedAt: Date.now(), ...(done && action.doneAt === undefined ? { doneAt: Date.now() } : {}) });
  return (await ctx.db.get(action._id))!;
}

// ── Cost, where the records support one ──────────────────────────────────────────────────────────

/**
 * What a correction visit is likely to cost in crew pay, from what the original crew was paid per minute.
 * With no pay on record there is no estimate, and the screens say so instead of showing a number.
 */
export function correctionCost(original: { crewPayCents: number; durationMinutes: number; priceCents: number | null } | null, minutes: number): { estimateCents: number | null; basis: string; payHintCents: number | undefined } {
  if (!original || original.durationMinutes <= 0) return { estimateCents: null, basis: "No original visit to estimate from.", payHintCents: undefined };
  const share = Math.min(1, minutes / original.durationMinutes);
  const payHintCents = original.priceCents === null ? undefined : Math.round(original.priceCents * share);
  if (original.crewPayCents <= 0) return { estimateCents: null, basis: "The original visit has no crew pay on record, so there is no reliable cost estimate.", payHintCents };
  const estimateCents = Math.round(original.crewPayCents * share);
  return { estimateCents, basis: `Estimate: ${minutes} of the original ${original.durationMinutes} minutes, at what the original crew was paid (${money(original.crewPayCents)}). Other costs, such as supplies or travel, are not included.`, payHintCents };
}

/** Open times for a visit at this property over the coming days, from the same capacity check a booking uses. */
export async function correctionSlots(ctx: Ctx, company: Doc<"companies">, input: { minutes: number; crew: number; like?: number; days?: number; from?: number }): Promise<{ startsAt: number; endsAt: number; state: "fits" | "tight" }[]> {
  const tz = company.timezone;
  const now = input.from ?? Date.now();
  const hours = businessSettingsOf(company).hours;
  const minuteOptions = new Set<number>();
  if (input.like !== undefined) minuteOptions.add(localParts(input.like, tz).minute);
  for (const minute of [9 * 60, 13 * 60]) minuteOptions.add(minute);
  const out: { startsAt: number; endsAt: number; state: "fits" | "tight" }[] = [];
  const base = startOfLocalDay(now, tz);
  for (let day = 1; day <= (input.days ?? 7) && out.length < 4; day += 1) {
    const dayStart = addLocalDays(base, day, tz);
    for (const minute of minuteOptions) {
      const startsAt = dayStart + minute * 60_000;
      const endsAt = startsAt + input.minutes * 60_000;
      if (hours.length) {
        const weekday = localParts(startsAt, tz).weekday;
        if (!hours.some((w) => w.weekday === weekday && w.startMinute <= minute && minute + input.minutes <= w.endMinute)) continue;
      }
      const answer = await checkCapacity(ctx, company, { startsAt, endsAt }, input.crew);
      if (answer.state === "fits" || answer.state === "tight") {
        out.push({ startsAt, endsAt, state: answer.state });
        break;
      }
    }
  }
  return out;
}

// ── Routing by authority ─────────────────────────────────────────────────────────────────────────

/**
 * Sends a prepared action where the Owner's settings say it goes: carried out now, into the approvals
 * queue, or refused. Asked again for an action already routed, it answers with where that stands.
 */
export const PAY_NOT_SET = "The Owner sets what the crew is paid for each correction visit. It is booked once that is set.";

/**
 * The Owner sets the pay basis on a prepared correction visit and books it. This is the Owner's own
 * decision, so it is carried out without a second approval. Every other check still runs.
 */
export async function setCorrectionPay(ctx: MutationCtx, company: Doc<"companies">, actionId: Id<"retentionActions">, payBasisCents: number, memberId: Id<"members">, book = true): Promise<{ status: Action["status"]; detail: string }> {
  const action = (await ctx.db.get(actionId))!;
  const row = (await ctx.db.get(action.caseId))!;
  const actor: Actor = { kind: "member", memberId };
  const visit = { ...action.visit!, payBasisCents, paySetBy: memberId };
  await ctx.db.patch(action._id, { visit, result: undefined, updatedAt: Date.now() });
  const fresh = (await ctx.db.get(action._id))!;
  await ctx.db.patch(action._id, { stamp: await stampFor(ctx, row, fresh), preparedAt: Date.now() });
  await addEntry(ctx, row, { kind: "action", text: `The Owner set the crew's pay basis for the correction visit: ${money(payBasisCents)}.`, actor });
  // Offered to the customer and not answered yet: the pay is set, and the visit waits for their yes.
  const offer = (await actionsOf(ctx, row)).find((other) => other.message?.aboutActionId === action._id && (other.status === "proposed" || other.status === "awaiting_approval" || other.status === "underway"));
  if (offer || !book) return { status: "proposed", detail: "The crew's pay is set. The visit is booked when the customer accepts it." };
  await ctx.db.patch(action._id, { authorization: `${action.permission}: pay set and booked by the Owner` });
  const result = await carryOut(ctx, company, (await ctx.db.get(action._id))!, actor);
  return { status: (await ctx.db.get(action._id))!.status, detail: result.detail };
}

export async function submitAction(ctx: MutationCtx, company: Doc<"companies">, actionId: Id<"retentionActions">, actor: Actor): Promise<{ status: Action["status"]; detail: string }> {
  let action = (await ctx.db.get(actionId))!;
  if (action.status !== "proposed") return { status: action.status, detail: action.result ?? "Already routed." };
  const row = (await ctx.db.get(action.caseId))!;
  if (row.status === "closed") {
    action = await setAction(ctx, action, { status: "cancelled", result: "The case was closed first." });
    return { status: action.status, detail: action.result! };
  }
  // While a person holds the case, or it is a serious concern, the agent prepares and waits.
  if (actor.kind === "agent" && (row.heldBy || row.serious) && MESSAGE_KINDS.includes(action.kind)) {
    action = await setAction(ctx, action, { status: "blocked", result: "A person is handling this case, so Retention sends nothing to the customer until it is handed back." });
    return { status: action.status, detail: action.result! };
  }
  // What a crew is paid for a correction is the Owner's decision each time. Until it is set, nothing is
  // booked and nothing goes to approval: the case waits on the Owner and says so.
  if (action.kind === "correction_visit" && action.visit?.payBasisCents === undefined) {
    const detail = PAY_NOT_SET;
    if (action.result !== detail) {
      await setAction(ctx, action, { result: detail });
      await addEntry(ctx, row, { kind: "action", text: `Waiting for the Owner: ${action.summary}. ${detail}`, actor: SYSTEM });
    }
    if (!row.serious) await moveCase(ctx, (await ctx.db.get(row._id))!, { status: "needs_attention", doing: "A correction visit is prepared. It is not booked.", needs: `Set the crew's pay for the correction visit. ${detail}` }, actor);
    return { status: "proposed", detail };
  }
  const cost = action.estimatedCostCents ?? action.money?.amountCents ?? null;
  const permit = await permitFor(ctx, company._id, action.permission, { cents: cost });
  if (permit.mode === "refuse") {
    action = await setAction(ctx, action, { status: "blocked", result: permit.why, authorization: permit.label });
    await addEntry(ctx, row, { kind: "action", text: `Not carried out: ${action.summary}. ${permit.why}`, actor: SYSTEM });
    return { status: action.status, detail: permit.why };
  }
  if (permit.mode === "ask") {
    const settings = retentionSettings(company);
    const decideBy = Math.max(Date.now() + HOUR, Math.min(action.dueAt ?? Date.now() + settings.recoveryDueHours * HOUR, Date.now() + 3 * DAY));
    const approvalId = await requestApproval(ctx, {
      companyId: company._id,
      action: action.permission,
      summary: action.summary,
      reason: `${action.reason}${action.costBasis ? ` ${action.costBasis}` : ""}`.slice(0, 2000),
      authorizes: authorizes(action, company.timezone),
      ifWaiting: "Nothing is done. The case stays open and is raised as overdue when its deadline passes.",
      decideBy,
      proposal: { kind: "retention_action", actionId: action._id, stamp: action.stamp },
      about: { table: "retentionCases", id: row._id },
      taskId: row.taskId,
    });
    action = await setAction(ctx, action, { status: "awaiting_approval", approvalId, authorization: permit.label, result: permit.why });
    await addEntry(ctx, row, { kind: "action", text: `Waiting for approval: ${action.summary}. ${permit.why}`, actor: SYSTEM });
    return { status: action.status, detail: permit.why };
  }
  action = await setAction(ctx, action, { authorization: permit.label });
  const result = await carryOut(ctx, company, action, actor);
  if (permit.level === "execute_and_report") {
    await recordEvent(ctx, { companyId: company._id, type: "retention.reported", actor: RETENTION, subject: { table: "retentionActions", id: action._id }, data: { kind: action.kind, action: action.permission, caseId: action.caseId, ok: result.ok } });
  }
  return { status: (await ctx.db.get(action._id))!.status, detail: result.detail };
}

function authorizes(action: Action, timezone: string): string {
  if (action.visit) {
    const when = action.visit.startsAt ? whenWords(action.visit.startsAt, timezone) : "a time Dispatch finds";
    return `Book one correction visit (${action.visit.minutes} minutes, ${action.visit.areas.join(", ") || "the reported work"}) for ${when}, at no charge to the customer, and hand it to Dispatch to staff. The crew is paid from a basis of ${money(action.visit.payBasisCents ?? 0)}, set by the Owner. Nothing else.`;
  }
  if (action.money) return `${action.kind === "refund" ? "Ask the Owner to refund" : "Credit"} ${money(action.money.amountCents)}${action.money.invoiceId ? " on the linked invoice" : ""}. The money moves only through Finance.`;
  if (action.message) return `Send this exact ${action.message.channel === "sms" ? "text" : "email"} to the customer, if they have not written again since it was prepared: "${action.message.body.slice(0, 600)}"`;
  if (action.planChange) return `Carry out this plan change exactly as previewed: ${action.summary}`;
  return action.summary;
}

// ── Carrying out ─────────────────────────────────────────────────────────────────────────────────

const PURPOSE: Partial<Record<ActionKind, CarePurpose>> = { request_feedback: "feedback_request", return_offer: "return_offer" };

async function openHandoff(ctx: MutationCtx, row: Case, action: Action, input: { to: HandoffTo; title: string; question: string; expected: string; dueAt: number }): Promise<Id<"tasks">> {
  const key = `retention.handoff:${action._id}`;
  const common = { companyId: row.companyId, key, title: input.title, trigger: row.happened, completionCondition: input.expected, escalation: "If the deadline passes, the retention case is raised as overdue and stays open.", dueAt: input.dueAt, about: { table: "customers" as const, id: row.customerId }, actor: RETENTION };
  if (input.to === "finance" || input.to === "quality") return (await handToQueue(ctx, { ...common, to: input.to, question: input.question }))._id;
  const existing = await liveTaskByKey(ctx, row.companyId, key);
  if (existing) return existing._id;
  const taskId = await openTask(ctx, { companyId: row.companyId, agent: input.to === "owner" ? "retention" : input.to, title: input.title.slice(0, 200), nextAction: input.question.slice(0, 500), dueAt: input.dueAt, completionCondition: input.expected, about: common.about, key, actor: RETENTION });
  await ctx.db.patch(taskId, { trigger: row.happened.slice(0, 500), escalation: common.escalation });
  // Sales and Dispatch act on their own records; work Retention hands them outside those is held for a person in that queue.
  await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: input.question.slice(0, 1000), dueAt: input.dueAt, withPersonSince: Date.now() }, RETENTION);
  return taskId;
}

/** Carries out one action, after every check is run again. Returns what happened in words a person can check. */
export async function carryOut(ctx: MutationCtx, company: Doc<"companies">, action: Action, decidedBy: Actor): Promise<CarriedOut> {
  const row = (await ctx.db.get(action.caseId))!;
  const fail = async (detail: string, status: Action["status"] = "failed"): Promise<CarriedOut> => {
    await setAction(ctx, action, { status, result: detail });
    await addEntry(ctx, row, { kind: "action", text: `Not carried out: ${action.summary}. ${detail}`, actor: SYSTEM });
    if (row.status !== "closed") await moveCase(ctx, (await ctx.db.get(row._id))!, { status: "needs_attention", needs: `${action.summary} was not carried out. ${detail}` }, SYSTEM);
    return { ok: false, detail: `Not carried out. ${detail}` };
  };
  if (row.status === "closed") {
    await setAction(ctx, action, { status: "cancelled", result: "The case was closed first." });
    return { ok: false, detail: "Not carried out. The case was closed first." };
  }
  if (company.pausedAgents.includes("retention") && decidedBy.kind === "agent") return fail("Retention is paused.", "blocked");
  // The evidence as it is now, against what the action was prepared on.
  const now = await stampFor(ctx, row, action);
  if (now !== action.stamp) return fail("What this was prepared against has changed since: the case, the visit, the invoice, or the customer wrote again. Review the case and prepare it again.", "proposed");
  const customer = (await ctx.db.get(row.customerId))!;
  const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
  const settings = retentionSettings(company);
  const tz = company.timezone;

  if (MESSAGE_KINDS.includes(action.kind)) {
    if (!action.message) return fail("There is no message to send.");
    const purpose = PURPOSE[action.kind] ?? "care_update";
    let linkId: Id<"retentionLinks"> | undefined;
    if (action.message.linkPurpose) {
      const link = await issueCareLink(ctx, { companyId: company._id, purpose: action.message.linkPurpose, customerId: customer._id, propertyId: row.propertyId, jobId: linkJob(row, action.message.linkPurpose), caseId: row._id, actionId: action.message.aboutActionId ?? action._id, plan: row.plan, days: settings.linkDays, actor: decidedBy });
      linkId = link._id;
    }
    const sending = await setAction(ctx, action, { status: "underway", linkId });
    const message = await queueCareMessage(ctx, { company, customer, action: sending, purpose, channel: action.message.channel, subject: action.message.subject, body: action.message.body, jobId: row.jobId, dedupeKey: `retention:${action._id}`, actor: decidedBy.kind === "agent" || action.createdBy.kind === "agent" ? RETENTION : decidedBy });
    await ctx.db.patch(action._id, { messageId: message._id });
    if (message.status === "not_sent") {
      // Nothing went out. The case says so plainly instead of reading as "sent".
      return fail(`The ${action.message.channel === "sms" ? "text" : "email"} was not sent: ${message.problem ?? "it could not be sent"}`, "blocked");
    }
    await addEntry(ctx, row, { kind: "action", text: `${message.status === "held" ? "Held for later" : "Sent"}: ${action.summary}`, source: { table: "messages", id: message._id, label: "Message" }, actor: decidedBy });
    const waiting = action.kind !== "message" && action.kind !== "scope_clarification";
    if (waiting || action.message.linkPurpose === "remedy") {
      const fresh = (await ctx.db.get(row._id))!;
      const asked = action.kind === "confirm_correction" && linkId ? { verification: { ...(fresh.verification ?? { criteria: "The customer confirms the problem was addressed." }), customerAsked: { at: Date.now(), linkId } } } : {};
      await moveCase(ctx, fresh, { status: action.kind === "confirm_correction" ? "monitoring" : "waiting_on_customer", doing: action.kind === "confirm_correction" ? "Asked the customer whether the correction addressed the problem." : "Waiting for the customer's answer.", clearNeeds: true, dueAt: Date.now() + settings.quietDays * DAY, ...asked }, SYSTEM);
    }
    return { ok: true, detail: message.status === "held" ? `Planned. ${message.problem ?? "It goes when quiet hours end."}` : "Handed to the sender. Delivery is shown on the case." };
  }

  if (action.kind === "correction_visit") {
    const visit = action.visit;
    if (!visit || visit.startsAt === undefined || visit.endsAt === undefined) return fail("No time was chosen for the visit.", "proposed");
    if (visit.payBasisCents === undefined) return fail(PAY_NOT_SET, "proposed");
    if (!property) return fail("The case has no property to send a crew to.");
    if (property.status !== "active") return fail("The property is archived.");
    const capacity = await checkCapacity(ctx, company, { startsAt: visit.startsAt, endsAt: visit.endsAt }, visit.crew);
    if (capacity.state !== "fits" && capacity.state !== "tight") return fail(`${whenWords(visit.startsAt, tz)} is no longer open: ${capacity.why} Choose another time.`, "proposed");
    const original = row.jobId ? await ctx.db.get(row.jobId) : null;
    let jobId: Id<"jobs">;
    try {
      jobId = await createVisit(
        { ...ctx, company, companyId: company._id },
        decidedBy,
        {
          customerId: customer._id,
          propertyId: property._id,
          serviceType: "Correction visit",
          scope: `Correction visit at no charge to the customer.\n${visit.scope === "full" ? "Repeat the full service." : visit.areas.map((area) => `- ${area}`).join("\n")}${original ? `\nCorrects the visit on ${localParts(original.startsAt, tz).day}.` : ""}`,
          requiredSkills: original?.requiredSkills ?? [],
          ...(visit.payBasisCents !== undefined ? { priceCents: visit.payBasisCents } : {}),
          startsAt: visit.startsAt,
          endsAt: visit.endsAt,
          requiredCrew: visit.crew,
          ...(original?.arrivalWindowMinutes ? { arrivalWindowMinutes: original.arrivalWindowMinutes } : {}),
          instructions: `Customer reported: ${row.areas.join(", ") || "see the case"}. This visit corrects that. The customer is not charged for it.`,
        },
        undefined,
        { caseId: row._id, originalJobId: original?._id, avoidCleanerIds: visit.avoidCleanerIds },
      );
    } catch (error) {
      const data = (error as { data?: { message?: string } }).data;
      return fail(data?.message ?? "The visit could not be booked.", "proposed");
    }
    const cover = await liveTaskByKey(ctx, company._id, coverKey(jobId));
    const expected = `An accepted crew for the correction visit on ${whenWords(visit.startsAt, tz)}, and the visit completed.`;
    await setAction(ctx, action, { status: "underway", visit: { ...visit, jobId }, handoff: { to: "dispatch", expected, jobId, taskId: cover?._id, status: "open" }, result: `Booked for ${whenWords(visit.startsAt, tz)}. Dispatch is staffing it.` });
    const fresh = (await ctx.db.get(row._id))!;
    await addEntry(ctx, fresh, { kind: "handoff", text: `Handed to Dispatch: staff the correction visit on ${whenWords(visit.startsAt, tz)} at ${propertyName(property)}. Expected back: ${expected}`, source: { table: "jobs", id: jobId, label: "Correction visit", at: visit.startsAt }, actor: decidedBy });
    await moveCase(ctx, fresh, {
      status: "action_underway",
      doing: `Correction visit booked for ${whenWords(visit.startsAt, tz)}. Dispatch is staffing it.`,
      clearNeeds: true,
      dueAt: visit.endsAt + DAY,
      verification: { ...(fresh.verification ?? { criteria: "" }), criteria: `The correction visit is completed, and the customer confirms that ${row.areas.join(", ") || "the reported work"} was addressed.`, correctionJobId: jobId },
    }, SYSTEM);
    return { ok: true, detail: `Booked for ${whenWords(visit.startsAt, tz)} and handed to Dispatch. The case stays open until the visit is done and the customer answers.` };
  }

  if (action.kind === "different_cleaner") {
    const avoid = action.visit?.avoidCleanerIds ?? [];
    if (!avoid.length || !property) return fail("There is no cleaner or property to apply this to.");
    const upcoming = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", company._id).eq("propertyId", property._id).gte("startsAt", Date.now()))
      .take(60);
    let marked = 0;
    let assigned = 0;
    for (const job of upcoming) {
      if (job.status !== "scheduled") continue;
      await ctx.db.patch(job._id, { avoidCleanerIds: [...new Set([...(job.avoidCleanerIds ?? []), ...avoid])] });
      marked += 1;
      const rows = await ctx.db.query("assignments").withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id)).take(30);
      if (rows.some((a) => avoid.includes(a.cleanerId) && (a.status === "accepted" || a.status === "offered"))) assigned += 1;
    }
    let taskId: Id<"tasks"> | undefined;
    if (assigned > 0) {
      // Taking an accepted cleaner off a visit is Dispatch's decision, under its own permission. Retention asks; it does not reassign.
      taskId = await openHandoff(ctx, row, action, { to: "dispatch", title: `Different cleaner requested at ${propertyName(property)}`, question: `The customer asked for a different cleaner at ${propertyName(property)}. ${assigned} upcoming ${assigned === 1 ? "visit is" : "visits are"} already offered to or accepted by that cleaner. Decide whether to reassign ${assigned === 1 ? "it" : "them"}.`, expected: "The upcoming visits are staffed by someone else, or a person recorded why not.", dueAt: Date.now() + DAY });
    }
    await setAction(ctx, action, { status: assigned > 0 ? "underway" : "done", ...(taskId ? { handoff: { to: "dispatch" as const, expected: "The upcoming visits are staffed by someone else, or a person recorded why not.", taskId, status: "open" as const } } : {}), result: `${marked} upcoming ${marked === 1 ? "visit" : "visits"} will not be offered to that cleaner.${assigned ? ` ${assigned} already assigned: Dispatch decides.` : ""}` });
    await addEntry(ctx, row, { kind: assigned ? "handoff" : "action", text: `Different cleaner: ${marked} upcoming ${marked === 1 ? "visit" : "visits"} at ${propertyName(property)} will not be offered to the cleaner the customer asked not to have back.${assigned ? ` ${assigned} already assigned: handed to Dispatch to decide.` : ""} This changes nothing about that cleaner's pay or standing.`, actor: decidedBy });
    return { ok: true, detail: `Applied to ${marked} upcoming ${marked === 1 ? "visit" : "visits"}.` };
  }

  if (action.kind === "credit" || action.kind === "refund") {
    const amount = action.money?.amountCents ?? 0;
    const invoice = action.money?.invoiceId ? await ctx.db.get(action.money.invoiceId) : null;
    const member = decidedBy.kind === "member" ? await ctx.db.get(decidedBy.memberId) : null;
    // A credit on an open invoice is written by the Owner who approved it, through Finance's own ledger. Anything else is Finance's to do by hand.
    if (action.kind === "credit" && invoice && member && isOwner(roleOf(member.role)) && invoice.status === "open" && amount > 0 && amount <= invoice.totals.balanceCents - invoice.totals.processingCents) {
      const creditId = await ctx.db.insert("invoiceCredits", { companyId: company._id, invoiceId: invoice._id, customerId: invoice.customerId, amountCents: amount, reason: `Service recovery: ${action.reason}`.slice(0, 500), by: member._id, at: Date.now() });
      await recompute(ctx, invoice._id);
      await recordEvent(ctx, { companyId: company._id, type: "credit.added", actor: decidedBy, subject: { table: "invoiceCredits", id: creditId }, data: { amountCents: amount, via: "retention_case" } });
      await setAction(ctx, action, { status: "done", money: { ...action.money!, creditId }, actualCostCents: amount, result: `${money(amount)} credited on invoice ${invoice.number ?? ""}. No money moved.` });
      await addEntry(ctx, row, { kind: "action", text: `Credit of ${money(amount)} recorded on invoice ${invoice.number ?? ""} by the Owner.`, source: { table: "invoiceCredits", id: creditId, label: "Credit" }, actor: decidedBy });
      return { ok: true, detail: `${money(amount)} credited. The case stays open until the outcome is recorded.` };
    }
    const why = action.kind === "refund" ? "Refunds are issued by the Owner in Finance." : !invoice ? "There is no invoice to credit yet." : invoice.status !== "open" ? "The invoice is not open, so a credit cannot be applied to it." : !member || !isOwner(roleOf(member.role)) ? "Credits are the Owner's to record." : "The amount is more than is still owed on the invoice.";
    const expected = `${action.kind === "refund" ? "A refund" : "A credit"} of ${money(amount)} recorded in Finance${invoice?.number ? ` against invoice ${invoice.number}` : ""}, or a recorded decision not to.`;
    const taskId = await openHandoff(ctx, row, action, { to: "finance", title: `${action.kind === "refund" ? "Refund" : "Credit"} ${money(amount)} for ${customer.name}`, question: `${action.summary}. ${why} Record it in Finance, then mark this done.`, expected, dueAt: Date.now() + 2 * DAY });
    await setAction(ctx, action, { status: "underway", handoff: { to: "finance", expected, taskId, status: "open" }, result: `${why} Handed to the Owner.` });
    await addEntry(ctx, row, { kind: "handoff", text: `Handed to Finance (the Owner): ${action.summary}. ${why} Expected back: ${expected}`, actor: decidedBy });
    await moveCase(ctx, (await ctx.db.get(row._id))!, { status: "action_underway", doing: `${HANDOFF_WORDS.finance} has the ${action.kind}.`, clearNeeds: true }, SYSTEM);
    return { ok: true, detail: `${why} Handed to the Owner in Finance. The case stays open until it is recorded.` };
  }

  if (action.kind === "inspection" || action.kind === "billing_review" || action.kind === "renewal_proposal" || action.kind === "dispatch_review") {
    const to: HandoffTo = action.kind === "inspection" ? "quality" : action.kind === "billing_review" ? "finance" : action.kind === "renewal_proposal" ? "sales" : "dispatch";
    const expected = action.kind === "inspection" ? "What the inspection found, recorded on the task." : action.kind === "billing_review" ? "The charge reviewed, and what was decided, recorded on the task." : action.kind === "renewal_proposal" ? "A renewal or scope-adjustment proposal sent, or a recorded decision not to." : "What Dispatch will do, recorded on the task.";
    const taskId = await openHandoff(ctx, row, action, { to, title: action.summary, question: `${action.summary}. ${action.reason}`, expected, dueAt: action.dueAt ?? Date.now() + 2 * DAY });
    await setAction(ctx, action, { status: "underway", handoff: { to, expected, taskId, status: "open" }, result: `Handed to ${HANDOFF_WORDS[to]}.` });
    await addEntry(ctx, row, { kind: "handoff", text: `Handed to ${HANDOFF_WORDS[to]}: ${action.summary}. Expected back: ${expected}`, source: { table: "tasks", id: taskId, label: "Task" }, actor: decidedBy });
    await moveCase(ctx, (await ctx.db.get(row._id))!, { status: "action_underway", doing: `${HANDOFF_WORDS[to]} has it: ${action.summary}.`, clearNeeds: true }, SYSTEM);
    return { ok: true, detail: `Handed to ${HANDOFF_WORDS[to]}. The case stays open until the result comes back.` };
  }

  if (action.kind === "plan_change") {
    const change = action.planChange;
    if (!change) return fail("There is no plan change to carry out.");
    if (NEEDS_PERSON.includes(change.change)) {
      // A new schedule can change the price, a moved visit needs a crew's time, and what is due is the Owner's: a person decides each.
      const to: HandoffTo = change.change === "reschedule_visit" ? "dispatch" : change.change === "pause_billing" ? "finance" : "owner";
      const expected = change.change === "reschedule_visit" ? "A new time confirmed with the customer, or a recorded reason it could not be moved." : change.change === "pause_billing" ? "What is due changed in Finance, or a recorded decision not to." : "The new schedule and its price confirmed with the customer and applied to the plan, or a recorded decision not to.";
      const taskId = await openHandoff(ctx, row, action, { to, title: action.summary, question: `${action.summary}. ${action.reason} Nothing has been changed.`, expected, dueAt: action.dueAt ?? Date.now() + 2 * DAY });
      await setAction(ctx, action, { status: "underway", handoff: { to, expected, taskId, status: "open" }, result: `Handed to ${HANDOFF_WORDS[to]}. Nothing has been changed yet.` });
      await addEntry(ctx, row, { kind: "handoff", text: `Handed to ${HANDOFF_WORDS[to]}: ${action.summary}. Expected back: ${expected}`, source: { table: "tasks", id: taskId, label: "Task" }, actor: decidedBy });
      await moveCase(ctx, (await ctx.db.get(row._id))!, { status: "action_underway", doing: `${HANDOFF_WORDS[to]} has the request: ${action.summary}.`, clearNeeds: true }, SYSTEM);
      return { ok: true, detail: `Handed to ${HANDOFF_WORDS[to]}. Nothing has been changed yet.` };
    }
    const result = await applyPlanChange(ctx, company, row, action, change.requestedBy === "customer" && decidedBy.kind === "agent" ? RETENTION : decidedBy);
    if (!result.ok) return fail(result.detail, result.retry ? "proposed" : "failed");
    await setAction(ctx, action, { status: "done", result: result.detail });
    await addEntry(ctx, row, { kind: "action", text: result.detail, actor: decidedBy });
    // The request was the whole case: once the plan shows the change, it is closed as what happened.
    if (row.kind === "continuity") await closeCase(ctx, (await ctx.db.get(row._id))!, CHANGE_OUTCOME[change.change], change.requestedBy === "customer" ? SYSTEM : decidedBy, result.detail);
    return { ok: true, detail: result.detail };
  }
  throw userError("This action cannot be carried out here.");
}

function linkJob(row: Case, purpose: LinkPurpose): Id<"jobs"> | undefined {
  // A confirmation is about the correction visit; everything else is about the service the case is about.
  if (purpose === "confirm") return row.verification?.correctionJobId ?? row.jobId;
  return row.jobId;
}

// ── Work coming back ─────────────────────────────────────────────────────────────────────────────

/** What a visit cost in crew pay and recorded expenses, read from the records that hold them. */
export async function visitCost(ctx: Ctx, job: Doc<"jobs">): Promise<number> {
  const assignments = await ctx.db.query("assignments").withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id)).take(30);
  const pay = assignments.filter((a) => a.status === "accepted").reduce((sum, a) => sum + a.payCents, 0);
  const expenses = await ctx.db
    .query("expenses")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(50);
  return pay + expenses.filter((e) => e.status === "recorded" && !e.voided).reduce((sum, e) => sum + (e.amountCents ?? 0), 0);
}

/**
 * Reads back what came of handed-off work. A handoff returns when the record it named changed: the
 * visit was completed or cancelled, the task was closed, the credit or refund was recorded. Returns
 * true when something changed.
 */
export async function syncHandoff(ctx: MutationCtx, action: Action): Promise<boolean> {
  const handoff = action.handoff;
  if (!handoff || handoff.status !== "open" || action.status !== "underway") return false;
  const row = (await ctx.db.get(action.caseId))!;
  const finish = async (ok: boolean, result: string, extra: Partial<Action> = {}) => {
    await setAction(ctx, action, { status: ok ? "done" : "failed", handoff: { ...handoff, status: ok ? "returned" : "failed", result, returnedAt: Date.now() }, result, ...extra });
    await addEntry(ctx, row, { kind: "handoff", text: `Back from ${HANDOFF_WORDS[handoff.to]}: ${result}`, actor: SYSTEM });
    return true;
  };
  if (action.kind === "correction_visit" && handoff.jobId) {
    const job = await ctx.db.get(handoff.jobId);
    if (!job) return finish(false, "The correction visit no longer exists.");
    if (job.status === "completed") return finish(true, "The correction visit was completed.", { actualCostCents: await visitCost(ctx, job) });
    if (job.status === "cancelled") {
      await finish(false, `The correction visit was cancelled${job.cancelReason ? `: ${job.cancelReason}` : ""}.`);
      if (row.status !== "closed") await moveCase(ctx, (await ctx.db.get(row._id))!, { status: "needs_attention", needs: "The correction visit was cancelled. The customer's concern has no completed correction. Decide the next step." }, SYSTEM);
      return true;
    }
    return false;
  }
  if (action.money && (action.kind === "credit" || action.kind === "refund")) {
    const rows = action.kind === "credit"
      ? await ctx.db.query("invoiceCredits").withIndex("by_company_customer", (q) => q.eq("companyId", action.companyId).eq("customerId", row.customerId).gte("at", action.createdAt)).take(20)
      : action.money.invoiceId ? await ctx.db.query("refunds").withIndex("by_company_invoice", (q) => q.eq("companyId", action.companyId).eq("invoiceId", action.money!.invoiceId!)).take(20) : [];
    const match = rows.find((r) => r.amountCents === action.money!.amountCents && (!("reversed" in r) || !r.reversed) && (!("createdAt" in r) || (r as Doc<"refunds">).createdAt >= action.createdAt));
    if (match) return finish(true, `${action.kind === "credit" ? "A credit" : "A refund"} of ${money(action.money.amountCents)} is recorded in Finance.`, { actualCostCents: action.money.amountCents });
  }
  const task = handoff.taskId ? await ctx.db.get(handoff.taskId) : null;
  if (task?.status === "done") return finish(true, task.outcome ?? "Marked done.");
  if (task?.status === "cancelled") return finish(false, task.outcome ?? "Cancelled.");
  return false;
}

/** A message this action sent has a final answer from the provider. */
export async function afterCareMessage(ctx: MutationCtx, message: Doc<"messages">): Promise<void> {
  const action = message.retentionActionId ? await ctx.db.get(message.retentionActionId) : null;
  if (!action || action.status !== "underway") return;
  const row = await ctx.db.get(action.caseId);
  if (!row) return;
  if (message.status === "sent" || message.status === "delivered") {
    // Sent is the action done. The case is not: it waits for the customer.
    await setAction(ctx, action, { status: "done", result: message.status === "delivered" ? "Delivered." : "Sent. Delivery not yet confirmed." });
    return;
  }
  if (message.status === "not_sent") {
    await setAction(ctx, action, { status: "blocked", result: `Not sent. ${message.problem ?? ""}`.trim() });
    await addEntry(ctx, row, { kind: "action", text: `"${action.summary}" was not sent: ${message.problem ?? "it could not be sent"}`, actor: SYSTEM });
    if (row.status !== "closed") await moveCase(ctx, row, { status: "needs_attention", needs: `A message to the customer was not sent: ${message.problem ?? "it could not be sent"}` }, SYSTEM);
    return;
  }
  const unknown = message.status === "unconfirmed";
  const why = message.problem ?? (unknown ? "It is not known whether it went." : "It was not delivered.");
  await setAction(ctx, action, { status: unknown ? "blocked" : "failed", result: unknown ? `Unknown. ${why} It was not sent again.` : `Not delivered. ${why}` });
  await addEntry(ctx, row, { kind: "action", text: unknown ? `It is not known whether "${action.summary}" went. It was not sent again.` : `"${action.summary}" did not go: ${why}`, actor: SYSTEM });
  if (row.status !== "closed") await moveCase(ctx, row, { status: "needs_attention", needs: unknown ? "A message may not have reached the customer. Check with them before sending another." : `A message to the customer did not go through: ${why} Reach them another way or correct the address.` }, SYSTEM);
}

export { careChannel };
