/**
 * Retention's tools: the same six things from a case's own buttons and from Company Chat. Each reads the
 * records again, checks the case's state, does one thing, and answers with what it found or prepared in
 * words a person can check. Every use is kept (convex/retentionAgent.ts writes the `toolRuns` row), so
 * the result is on the case afterwards, not only in the moment.
 *
 * A tool prepares; it does not decide. Anything a customer would see, and anything that costs money, is
 * left as a prepared action for the Owner's authority to route.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { localParts } from "../availability";
import { money } from "../dispatch/pay";
import type { Actor } from "../events";
import { ACTION_WORDS, actionsOf, careChannel, correctionCost, correctionSlots, prepareAction, whenWords } from "./actions";
import { entriesOf, OUTCOME_WORDS, propertyName, STATUS_WORDS } from "./cases";
import { DIAGNOSIS_WORDS } from "./diagnose";
import { about, gatherEvidence } from "./evidence";
import { assess, originalVisit, planRecovery, targetedMinutes } from "./recovery";

export const TOOL_NAMES = ["explain_attention", "prepare_recovery_plan", "show_original_scope", "find_correction_visit", "draft_response", "review_after_correction"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_WORDS: Record<ToolName, string> = {
  explain_attention: "Explain why this needs attention",
  prepare_recovery_plan: "Prepare a recovery plan",
  show_original_scope: "Show the original scope",
  find_correction_visit: "Find an available correction visit",
  draft_response: "Draft a response",
  review_after_correction: "Review what happened after the correction",
};

export type ToolResult = { outcome: "done" | "proposed" | "refused"; authorization: string; title: string; lines: string[]; data: Record<string, unknown> };

const refused = (tool: ToolName, why: string): ToolResult => ({ outcome: "refused", authorization: "read", title: TOOL_WORDS[tool], lines: [why], data: {} });
const first = (name: string) => name.trim().split(/\s+/)[0] || name;

export async function runCaseTool(ctx: MutationCtx, company: Doc<"companies">, row: Doc<"retentionCases">, tool: ToolName, actor: Actor): Promise<ToolResult> {
  const tz = company.timezone;
  const customer = (await ctx.db.get(row.customerId))!;
  const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
  const title = TOOL_WORDS[tool];

  if (tool === "explain_attention") {
    const entries = await entriesOf(ctx, row);
    const facts = entries.filter((e) => e.kind === "evidence" && e.basis === "fact").map((e) => e.text);
    const stated = entries.filter((e) => e.basis === "customer_stated").map((e) => (e.quote ? `${e.text} "${e.quote.slice(0, 200)}"` : e.text));
    const lines = [
      `Status: ${STATUS_WORDS[row.status]}. ${row.happened}`,
      ...(row.needs ? [`What needs a person: ${row.needs}`] : ["Nothing is waiting on a person right now."]),
      ...(stated.length ? [`The customer said: ${stated.slice(0, 2).join(" ")}`] : []),
      ...(facts.length ? [`The record shows: ${facts.slice(0, 4).join(" ")}`] : ["Nothing on the record speaks to this yet."]),
      ...(row.diagnosis ? [`Reading (${row.diagnosis.basis === "fact" ? "from the record" : row.diagnosis.basis === "customer_stated" ? "from what the customer said" : "a hypothesis"}): ${DIAGNOSIS_WORDS[row.diagnosis.category]}. ${row.diagnosis.reasons[0] ?? ""}`] : []),
      ...(row.diagnosis?.uncertain.length ? [`Not known: ${row.diagnosis.uncertain.slice(0, 3).join(" ")}`] : []),
      ...(row.serious ? [row.serious.reason] : []),
    ];
    return { outcome: "done", authorization: "read", title, lines, data: { status: row.status, facts: facts.length, stated: stated.length } };
  }

  if (tool === "show_original_scope") {
    const evidence = await gatherEvidence(ctx, company, row);
    if (!evidence.job) return refused(tool, "No service is linked to this case, so there is no scope to show.");
    const touched = evidence.checklist.filter((item) => about(item.label, row.areas).length);
    return {
      outcome: "done",
      authorization: "read",
      title,
      lines: [
        `${evidence.job.service} on ${localParts(evidence.job.startsAt, tz).day}, ${evidence.job.durationMinutes} minutes.`,
        evidence.job.included.length ? `Included: ${evidence.job.included.join("; ")}.` : "The visit lists no individual tasks.",
        evidence.job.excluded.length ? `Not included: ${evidence.job.excluded.join("; ")}.` : "No exclusions are named.",
        ...(touched.length ? touched.map((item) => `Checklist, "${item.label}": ${item.state === "done" ? "marked done" : item.state === "skipped" ? `skipped${item.skipReason ? ` (${item.skipReason})` : ""}` : "never marked done"}.`) : row.areas.length ? ["No checklist item names the area the customer reported."] : []),
        evidence.guarantee.set ? `Guarantee: ${evidence.guarantee.text} (${evidence.guarantee.days} days).` : "The company has not written a service guarantee in Retention's Playbook.",
        ...evidence.terms.filter((t) => typeof t.terms.correctiveRemedy === "string").map((t) => `Signed terms, "${t.title}": ${String(t.terms.correctiveRemedy).slice(0, 240)}`),
      ],
      data: { jobId: evidence.job.id, included: evidence.job.included, excluded: evidence.job.excluded },
    };
  }

  if (tool === "find_correction_visit") {
    if (row.status === "closed") return refused(tool, "This case is closed.");
    const evidence = await gatherEvidence(ctx, company, row);
    const minutes = targetedMinutes(evidence.job?.durationMinutes);
    const slots = await correctionSlots(ctx, company, { minutes, crew: 1, like: evidence.job?.startsAt });
    const cost = correctionCost(await originalVisit(ctx, evidence), minutes);
    if (!slots.length) return { outcome: "done", authorization: "read", title, lines: [`No open time was found in the next 7 days for a ${minutes}-minute visit. Dispatch would need to find one; nothing can be promised to the customer yet.`, cost.basis], data: { slots: [], minutes } };
    return { outcome: "done", authorization: "read", title, lines: [`Open for a ${minutes}-minute visit at ${propertyName(property)}:`, ...slots.map((slot) => `${whenWords(slot.startsAt, tz)}${slot.state === "tight" ? " (the last crew free at that time)" : ""}`), cost.estimateCents === null ? cost.basis : `Likely cost in crew pay: ${money(cost.estimateCents)}. ${cost.basis}`, "These are open now. A time is held only when a correction visit is approved and booked."], data: { slots, minutes, estimateCents: cost.estimateCents } };
  }

  if (tool === "prepare_recovery_plan") {
    if (row.status === "closed") return refused(tool, "This case is closed.");
    if (row.kind !== "recovery") return refused(tool, "A recovery plan is for a service concern. This case is about something else.");
    if (row.serious) return refused(tool, "This is a serious concern handled by a person. Retention prepares no remedy for it.");
    if (row.heldBy) return refused(tool, "A person is handling this case. Hand it back to have Retention prepare a plan.");
    const live = (await actionsOf(ctx, row)).filter((a) => a.status === "proposed" || a.status === "awaiting_approval" || a.status === "underway");
    if (!live.length) {
      const assessed = await assess(ctx, company, row);
      await planRecovery(ctx, company, assessed);
    }
    const actions = (await actionsOf(ctx, row)).filter((a) => a.status === "proposed" || a.status === "awaiting_approval" || a.status === "underway");
    const fresh = (await ctx.db.get(row._id))!;
    return {
      outcome: "proposed",
      authorization: "prepared, not carried out",
      title,
      lines: [
        fresh.diagnosis ? `Reading: ${DIAGNOSIS_WORDS[fresh.diagnosis.category]}. ${fresh.diagnosis.reasons[0] ?? ""}` : "No reading yet.",
        ...(actions.length ? actions.map((a) => `${ACTION_WORDS[a.kind]}: ${a.summary}. ${a.status === "awaiting_approval" ? "Waiting for approval." : a.status === "underway" ? "Under way." : "Prepared; not yet sent for approval."}${a.estimatedCostCents !== undefined ? ` Estimated cost ${money(a.estimatedCostCents)}.` : a.costBasis ? ` ${a.costBasis}` : ""}`) : ["No step could be prepared from the record. A person decides the next step."]),
        fresh.verification?.criteria ? `It counts as recovered when: ${fresh.verification.criteria}` : "It counts as recovered when the remedy is carried out and the customer confirms it.",
      ],
      data: { actions: actions.map((a) => ({ id: a._id, kind: a.kind, status: a.status })) },
    };
  }

  if (tool === "draft_response") {
    if (row.status === "closed") return refused(tool, "This case is closed.");
    if (row.serious) return refused(tool, "This is a serious concern handled by a person, who writes to the customer themselves.");
    const channel = await careChannel(ctx, customer);
    if (!channel) return refused(tool, "There is no phone or email on file for this customer.");
    const actions = await actionsOf(ctx, row);
    const visit = actions.find((a) => a.kind === "correction_visit" && a.status === "underway" && a.visit?.startsAt);
    const what = row.areas.join(", ") || "your recent service";
    // Only what the record supports: a booked visit is named; an unapproved one is not promised.
    const body = visit
      ? `Hi ${first(customer.name)}, thank you for telling us about ${what}. We are sorry it was not right. We have booked a visit to correct it on ${whenWords(visit.visit!.startsAt!, tz)}, at no charge. Reply here if that time does not work. - ${company.name}`
      : `Hi ${first(customer.name)}, thank you for telling us about ${what}. We are sorry it was not right. We are looking at what happened on your visit and will come back to you with how we will put it right. - ${company.name}`;
    const count = actions.filter((a) => a.kind === "message" && a.key.includes(":draft-")).length;
    const action = await prepareAction(ctx, row, { kind: "message", key: `draft-${count + 1}`, summary: `Reply to ${customer.name} about ${what}`, reason: visit ? "Acknowledges the concern and names the correction visit that is booked." : "Acknowledges the concern. It promises no time and no remedy, because none is approved yet.", permission: "retention.send_case_message", message: { channel, subject: channel === "email" ? "About your recent service" : undefined, body }, actor });
    return { outcome: "proposed", authorization: "drafted, not sent", title, lines: [`Draft ${channel === "sms" ? "text" : "email"} to ${customer.name}:`, body, row.heldBy ? "A person is handling this case, so this is theirs to edit and send." : "Nothing is sent until it is submitted and, where the Owner's settings ask for it, approved."], data: { actionId: action._id, channel } };
  }

  // review_after_correction
  const v = row.verification;
  const actions = await actionsOf(ctx, row);
  const visit = actions.find((a) => a.kind === "correction_visit");
  if (!v?.correctionJobId && !visit) return { outcome: "done", authorization: "read", title, lines: ["No correction has been booked for this case, so there is nothing to review yet."], data: {} };
  const job = v?.correctionJobId ? await ctx.db.get(v.correctionJobId) : null;
  const lines = [
    job ? (job.status === "completed" ? `The correction visit on ${localParts(job.startsAt, tz).day} was completed${job.completionReview?.decision === "closed" ? " and reviewed by a person" : ""}.` : job.status === "cancelled" ? `The correction visit was cancelled${job.cancelReason ? `: ${job.cancelReason}` : ""}.` : `The correction visit is booked for ${whenWords(job.startsAt, tz)} and has not happened yet.`) : "The correction visit is not booked yet.",
    v?.customerAnswer ? (v.customerAnswer.answer === "resolved" ? "The customer said it addressed the problem." : `The customer said it did not address the problem${v.customerAnswer.note ? `: "${v.customerAnswer.note.slice(0, 200)}"` : "."}`) : v?.customerAsked ? "The customer was asked whether it worked and has not answered." : "The customer has not been asked whether it worked.",
    v?.nextService ? (v.nextService.repeatReported ? "On the next ordinary service the same area was reported again." : "The next ordinary service was completed and no repeat report has been received.") : "The next ordinary service has not been completed yet.",
    visit?.actualCostCents !== undefined ? `It cost ${money(visit.actualCostCents)} in crew pay and recorded expenses.` : visit?.estimatedCostCents !== undefined ? `Estimated cost ${money(visit.estimatedCostCents)}; the actual cost is read once the visit is completed.` : "No cost is on record for it.",
    row.outcome ? `Outcome: ${OUTCOME_WORDS[row.outcome.code]}` : "No outcome is recorded yet. A completed correction is not a confirmed recovery.",
  ];
  return { outcome: "done", authorization: "read", title, lines, data: { correctionCompleted: job?.status === "completed", customerAnswer: v?.customerAnswer?.answer ?? null, nextService: v?.nextService ?? null } };
}
