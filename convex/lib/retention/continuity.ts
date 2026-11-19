/**
 * Recurring-service continuity: a customer's or the office's request to change a plan, and what a
 * customer writes about their service.
 *
 * A request is recorded the moment it is made, with the preview the person saw. Whether it is carried
 * out at once or waits for a person is the Owner's authority setting for that action. A request to
 * cancel is always recorded immediately and always reachable: alternatives may be offered beside it and
 * are never put in front of it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { localParts } from "../availability";
import { type Actor } from "../events";
import { carryOut, prepareAction, submitAction } from "./actions";
import { addEntry, areasIn, caseByKey, closeCase, DAY, moveCase, openCase, propertyName, RETENTION, segmentFor, seriousReason, SYSTEM } from "./cases";
import { CHANGE_WORDS, loadPlan, NEEDS_PERSON, previewPlanChange, type ChangeInput, type PlanView } from "./planChanges";
import { openRecovery } from "./recovery";
import { attachSignal, raiseSignal } from "./signals";
import { retentionSettings } from "./settings";
import type { Outcome, PlanChange, PlanRef } from "./schema";

const PERMISSION: Record<PlanChange, string> = {
  skip_visit: "retention.apply_plan_change",
  pause_service: "retention.apply_plan_change",
  resume: "retention.apply_plan_change",
  end_service: "retention.cancel_on_request",
  reschedule_visit: "retention.hand_off",
  change_cadence: "retention.hand_off",
  pause_billing: "retention.hand_off",
};

const DONE: Record<PlanChange, Outcome> = { skip_visit: "plan_adjusted", pause_service: "plan_adjusted", resume: "plan_resumed", end_service: "customer_cancelled", reschedule_visit: "plan_adjusted", change_cadence: "plan_adjusted", pause_billing: "plan_adjusted" };

export type ChangeRequest = ChangeInput & {
  plan: PlanRef;
  /** The visits the person was shown in the preview. If they have changed, nothing is done. */
  shown: Id<"jobs">[];
  reason?: string;
  requestedBy: "customer" | "staff";
  actor: Actor;
};

export type ChangeResult = { status: "done" | "awaiting_approval" | "with_person" | "refused" | "stale"; words: string; caseId: Id<"retentionCases"> | null };

/** Records a plan-change request against exactly what was previewed, and routes it by the Owner's authority. */
export async function requestPlanChange(ctx: MutationCtx, company: Doc<"companies">, request: ChangeRequest): Promise<ChangeResult> {
  const plan = await loadPlan(ctx, company._id, request.plan);
  if (!plan) return { status: "refused", words: "That service plan was not found.", caseId: null };
  const preview = await previewPlanChange(ctx, company, plan, request);
  if (preview.blocked) return { status: "refused", words: preview.blocked, caseId: null };
  if ([...preview.shown].map(String).sort().join(",") !== [...request.shown].map(String).sort().join(",")) {
    return { status: "stale", words: "The booked visits changed after you looked. Review them again before confirming.", caseId: null };
  }
  const customer = (await ctx.db.get(plan.customerId))!;
  const property = await ctx.db.get(plan.propertyId);
  const tz = company.timezone;
  const day = localParts(Date.now(), tz).day;
  const who = request.requestedBy === "customer" ? customer.name : "The office";
  const title = CHANGE_WORDS[request.change];
  const key = `plan:${request.plan.kind}:${request.plan.id}:${request.change}:${request.jobId ?? preview.from ?? day}`;
  const existing = await caseByKey(ctx, company._id, key);
  if (existing && existing.status !== "closed") return { status: "with_person", words: "This request is already recorded and is being handled.", caseId: existing._id };
  const opened = await openCase(ctx, {
    companyId: company._id,
    kind: "continuity",
    key: existing ? `${key}:${Date.now()}` : key,
    status: "action_underway",
    customer,
    property,
    plan: request.plan,
    title: `${customer.name}: ${title.toLowerCase()} at ${propertyName(property)}`,
    happened: `${who} asked to ${title.toLowerCase()}${request.reason ? `: "${request.reason.slice(0, 200)}"` : ""}.`,
    doing: "Carrying out the request as previewed.",
    origin: request.requestedBy === "customer" ? "customer_link" : "staff",
    customerWords: request.requestedBy === "customer" ? request.reason : undefined,
    dueAt: Date.now() + 2 * DAY,
    actor: request.actor,
  });
  let row = opened.row;
  await addEntry(ctx, row, { kind: "evidence", basis: request.requestedBy === "customer" ? "customer_stated" : "fact", text: `${who} asked to ${title.toLowerCase()}. They were shown: ${preview.consequences.map((c) => c.text).join(" ")}`, quote: request.requestedBy === "customer" ? request.reason : undefined, actor: request.actor });
  // A customer asking to stop is recorded as their stated wish at once, whatever happens to the request next.
  if (request.requestedBy === "customer" && (request.change === "end_service" || request.change === "change_cadence")) {
    const signal = await raiseSignal(ctx, { companyId: company._id, kind: request.change === "end_service" ? "cancel_request" : "reduce_request", key: `${request.change}:${request.plan.id}:${day}`, basis: "customer_stated", customerId: customer._id, propertyId: plan.propertyId, plan: request.plan, segment: row.segment, what: `${customer.name} asked to ${title.toLowerCase()} at ${propertyName(property)}${request.reason ? `: "${request.reason.slice(0, 160)}"` : ""}.`, source: { table: "retentionCases", id: row._id, label: "The request", at: Date.now() }, occurredAt: Date.now(), missing: request.reason ? [] : ["The customer gave no reason."], suggestedAction: request.change === "end_service" ? "Carry out the cancellation. Ask why once, and offer an alternative only if they want one." : "Confirm the new schedule and its price with the customer." });
    await attachSignal(ctx, signal.row, row._id);
  }
  const needsPerson = NEEDS_PERSON.includes(request.change);
  const action = await prepareAction(ctx, row, {
    kind: "plan_change",
    key: "change-1",
    summary: `${title} for ${customer.name} at ${propertyName(property)}${preview.from && request.change !== "resume" ? ` from ${preview.from}` : ""}${preview.until ? ` until ${preview.until}` : ""}${request.cadence ? ` (${request.cadence})` : ""}${request.preferred ? ` (preferred: ${request.preferred})` : ""}`,
    reason: `${who} asked. ${preview.consequences.find((c) => c.topic === "bookings")?.text ?? ""} ${preview.consequences.find((c) => c.topic === "billing")?.text ?? ""}`.trim(),
    permission: PERMISSION[request.change],
    planChange: { change: request.change, plan: request.plan, from: preview.from ?? undefined, until: preview.until ?? undefined, jobId: request.jobId ?? (request.change === "skip_visit" || request.change === "reschedule_visit" ? preview.shown[0] : undefined), cadence: request.cadence, preferred: request.preferred, shown: preview.shown, reason: request.reason?.slice(0, 500), requestedBy: request.requestedBy },
    dueAt: Date.now() + 2 * DAY,
    actor: request.actor,
  });
  // The office changing a plan in the workspace is a person acting: it is carried out under their own authority to do so.
  const routed = request.requestedBy === "staff" && request.actor.kind === "member" && !needsPerson ? await carryOutNow(ctx, company, action._id, request.actor) : await submitAction(ctx, company, action._id, request.requestedBy === "customer" ? RETENTION : request.actor);
  row = (await ctx.db.get(row._id))!;
  if (routed.status === "done") {
    await closeCase(ctx, row, DONE[request.change], request.requestedBy === "customer" ? SYSTEM : request.actor, routed.detail);
    return { status: "done", words: routed.detail, caseId: row._id };
  }
  if (routed.status === "awaiting_approval") {
    await moveCase(ctx, row, { status: "needs_attention", doing: "The request is recorded and waiting for approval.", needs: `${who} asked to ${title.toLowerCase()}. Approve the request to carry it out as previewed.` }, SYSTEM);
    return { status: "awaiting_approval", words: "Your request is recorded. Nothing has changed yet: the office confirms it first.", caseId: row._id };
  }
  if (routed.status === "underway") return { status: "with_person", words: "Your request is recorded and has been passed to the office. Nothing has changed yet.", caseId: row._id };
  if (row.status !== "closed") await moveCase(ctx, row, { status: "needs_attention", needs: `${who} asked to ${title.toLowerCase()}, and it could not be carried out: ${routed.detail}` }, SYSTEM);
  // A refused cancellation is still a customer who asked to cancel. It goes to a person and is never dropped.
  return { status: "with_person", words: "Your request is recorded and has been passed to the office.", caseId: row._id };
}

async function carryOutNow(ctx: MutationCtx, company: Doc<"companies">, actionId: Id<"retentionActions">, actor: Actor) {
  const action = (await ctx.db.get(actionId))!;
  await ctx.db.patch(actionId, { authorization: "changed by a person in the workspace" });
  const result = await carryOut(ctx, company, (await ctx.db.get(actionId))!, actor);
  return { status: (await ctx.db.get(action._id))!.status, detail: result.detail.replace(/^Not carried out\. /, "") };
}

// ── What a customer writes ───────────────────────────────────────────────────────────────────────

const CANCEL = /\b(cancel (?:my|our|the) (?:service|plan|cleaning|cleanings|account|subscription)|stop (?:the |my |our )?(?:service|cleaning|cleanings)|end (?:my|our|the) service|no longer need|don'?t need (?:you|the service|cleaning) (?:any ?more|anymore)|want to cancel|need to cancel)\b/i;
const REDUCE = /\b(less often|every other (?:week|month)|once a month instead|monthly instead|bi-?weekly instead|reduce (?:the )?frequency|too (?:expensive|much)|can'?t afford|cut back)\b/i;
const PROBLEM = /\b(missed|didn'?t (?:clean|do|get)|not (?:clean|cleaned|done)|wasn'?t (?:clean|cleaned|done)|still dirty|dirty|skipped|forgot|unhappy|disappointed|not happy|complain\w*)\b/i;

export type TextReading = { cancel: boolean; reduce: boolean; problem: boolean; serious: boolean; areas: string[] };

/** A customer's text, read by rule. It is data: nothing in it can change what Retention may do. */
export function readText(text: string): TextReading {
  return { cancel: CANCEL.test(text), reduce: REDUCE.test(text), problem: PROBLEM.test(text), serious: seriousReason(text) !== null, areas: areasIn(text) };
}

/**
 * A text from a known customer. A stated wish to cancel or to have less service is recorded as what the
 * customer said, never as a guess about why. A described problem opens a recovery case about their most
 * recent service. Anything else is left to the person reading the conversation.
 */
export async function onCustomerText(ctx: MutationCtx, company: Doc<"companies">, customer: Doc<"customers">, text: string, at: number): Promise<{ did: string }> {
  const reading = readText(text);
  const tz = company.timezone;
  const day = localParts(at, tz).day;
  const recent = (
    await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", company._id).eq("customerId", customer._id).lte("startsAt", at))
      .order("desc")
      .take(20)
  ).find((job) => job.status === "completed" && at - job.endsAt < 21 * DAY);
  if (reading.serious || (reading.problem && recent)) {
    const property = recent ? await ctx.db.get(recent.propertyId) : null;
    const opened = await openRecovery(ctx, company, { customer, property, job: recent ?? null, words: text, areas: reading.areas, origin: "conversation", actor: SYSTEM });
    return { did: opened.created ? "Opened a recovery case from the customer's text." : "Added the text to the open recovery case." };
  }
  if (reading.cancel || reading.reduce) {
    const kind = reading.cancel ? "cancel_request" : "reduce_request";
    const row = await raiseSignal(ctx, { companyId: company._id, kind, key: `${kind}:text:${customer._id}:${day}`, basis: "customer_stated", customerId: customer._id, segment: await segmentFor(ctx, company._id, customer, null), what: `${customer.name} wrote: "${text.slice(0, 180)}"`, source: { table: "customers", id: customer._id, label: "Text from the customer", at }, occurredAt: at, missing: ["Which service or property they mean, and from when.", "Why. The text does not say, and Retention does not guess."], suggestedAction: reading.cancel ? "Confirm what they want to cancel and carry it out. Ask why once; do not argue." : "Ask what schedule would suit them and confirm its price.", priority: reading.cancel ? "high" : "normal" });
    return { did: row.created ? "Recorded what the customer asked for." : "Counted on the request already recorded." };
  }
  return { did: "Nothing for Retention to act on." };
}

/** The plans a customer may manage from their link, with what the company lets them do there. */
export function manageable(company: Doc<"companies">, plan: PlanView): PlanChange[] {
  const offered = retentionSettings(company).selfService;
  const out: PlanChange[] = [];
  for (const change of offered) {
    if (change === "resume" && plan.state !== "paused" && !plan.pausedFrom) continue;
    if ((change === "pause_service" || change === "skip_visit" || change === "reschedule_visit" || change === "change_cadence") && plan.state !== "active") continue;
    if (change === "pause_billing") continue;
    out.push(change);
  }
  return out;
}
