/**
 * Service recovery, and the follow-through after a customer's first service.
 *
 *   feedback or a report → a case about one service → its evidence → a diagnosis with its uncertainty →
 *   a proposed remedy with its cost → approval → the work handed to whoever owns it → verification →
 *   an outcome recorded as it actually is.
 *
 * A concern is always linked to the service it is about. A second report about the same service joins
 * the first case instead of opening another, and the same area reported on a later visit is recognised
 * as a repeat. A correction that was carried out is not a recovered relationship: the case stays open
 * until the customer answers, or it is closed saying plainly that they did not.
 *
 * Nobody is asked for a public review only because they were pleased, and nobody is kept from one
 * because they were not: the company's review page is shown to everyone who gives feedback.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { localParts } from "../availability";
import { dayName } from "../time";
import { recordEvent, type Actor } from "../events";
import { offerRecurring } from "./growth";
import { ACTION_WORDS, actionsOf, careChannel, correctionCost, correctionSlots, prepareAction, submitAction, whenWords } from "./actions";
import { addEntry, areasIn, caseByKey, cleanAreas, closeCase, DAY, entriesOf, HOUR, moveCase, openCase, propertyName, RETENTION, seriousReason, sharedAreas, SYSTEM } from "./cases";
import { DIAGNOSIS_WORDS, diagnoseByRule, retentionModel } from "./diagnose";
import { gatherEvidence, statements, type Evidence } from "./evidence";
import { enqueueRun } from "./runs";
import { raiseSignal, attachSignal } from "./signals";
import { retentionSettings } from "./settings";
import type { Diagnosis } from "./schema";

type Case = Doc<"retentionCases">;

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
/** What went wrong, without the lead-in the approvals queue adds. */
const plain = (detail: string) => detail.replace(/^Not carried out\. /, "").replace(/^The (text|email) was not sent: /, "");

// ── Opening a recovery case ──────────────────────────────────────────────────────────────────────

export type Concern = {
  customer: Doc<"customers">;
  property: Doc<"properties"> | null;
  job: Doc<"jobs"> | null;
  words: string;
  areas?: string[];
  origin: Case["origin"];
  wantsDifferentCleaner?: boolean;
  fromCaseId?: Id<"retentionCases">;
  actor: Actor;
};

/** When the first commitment on a concern is due: the company's own window, or sooner if a guest checks in first. */
async function firstDue(ctx: MutationCtx, company: Doc<"companies">, property: Doc<"properties"> | null): Promise<{ dueAt: number; checkIn: Doc<"jobs"> | null }> {
  const now = Date.now();
  let dueAt = now + retentionSettings(company).recoveryDueHours * HOUR;
  let checkIn: Doc<"jobs"> | null = null;
  if (property) {
    const upcoming = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", company._id).eq("propertyId", property._id).gte("startsAt", now))
      .take(20);
    // A turnover with a hard deadline is a guest arriving. An open issue has to be dealt with before that, not within a general window.
    checkIn = upcoming.find((job) => job.status === "scheduled" && job.hardDeadlineAt !== undefined && job.hardDeadlineAt < now + 3 * DAY) ?? null;
    if (checkIn?.hardDeadlineAt) dueAt = Math.min(dueAt, Math.max(now + HOUR, checkIn.hardDeadlineAt - 4 * HOUR));
  }
  return { dueAt, checkIn };
}

/**
 * Opens the recovery case for a concern about one service, or joins the one already open for it. Then
 * gathers the evidence, diagnoses, and prepares the first step.
 */
export async function openRecovery(ctx: MutationCtx, company: Doc<"companies">, concern: Concern): Promise<{ row: Case; created: boolean }> {
  const { customer, property, job } = concern;
  const tz = company.timezone;
  const day = localParts(Date.now(), tz).day;
  const key = job ? `recovery:${job._id}` : `recovery:${customer._id}:${property?._id ?? "account"}:${day}`;
  const areas = cleanAreas([...(concern.areas ?? []), ...areasIn(concern.words)]);
  const existing = await caseByKey(ctx, company._id, key);
  if (existing && existing.status !== "closed") {
    // The same service, reported again: one case, with the new words added to its history.
    await addEntry(ctx, existing, { kind: "evidence", basis: "customer_stated", text: "The customer reported this service again.", quote: concern.words, actor: concern.actor });
    const merged = cleanAreas([...existing.areas, ...areas]);
    const row = await moveCase(ctx, existing, { areas: merged }, concern.actor);
    return { row, created: false };
  }
  const due = await firstDue(ctx, company, property);
  const where = propertyName(property);
  const what = areas.length ? areas.join(", ") : "a concern";
  const opened = await openCase(ctx, {
    companyId: company._id,
    kind: "recovery",
    // A closed case about the same service is history; a new report after it is a new case.
    key: existing ? `${key}:${Date.now()}` : key,
    status: "action_underway",
    customer,
    property,
    jobId: job?._id,
    title: `${customer.name}: ${what} at ${where}`,
    happened: `${customer.name} reported ${areas.length ? `a problem with ${what}` : "a concern"}${job ? ` after the ${job.serviceSnapshot?.name ?? job.serviceType} service on ${dayName(job.startsAt, tz)}` : ""}.`,
    doing: "Gathering the visit's record and preparing a first step.",
    origin: concern.origin,
    customerWords: concern.words,
    areas,
    dueAt: due.dueAt,
    fromCaseId: concern.fromCaseId,
    actor: concern.actor,
  });
  let row = opened.row;
  await addEntry(ctx, row, { kind: "evidence", basis: "customer_stated", text: `The customer's description${concern.origin === "staff" ? ", as recorded by the office" : ""}:`, quote: concern.words, actor: concern.actor, source: job ? { table: "jobs", id: job._id, label: "The service this is about", at: job.startsAt } : undefined });
  if (due.checkIn && property) {
    const signal = await raiseSignal(ctx, {
      companyId: company._id,
      kind: "readiness_at_risk",
      key: `readiness:${row._id}:${due.checkIn._id}`,
      basis: "fact",
      customerId: customer._id,
      propertyId: property._id,
      segment: row.segment,
      what: `An open concern at ${where}, and the next turnover must be finished by ${whenWords(due.checkIn.hardDeadlineAt!, tz)}.`,
      source: { table: "jobs", id: due.checkIn._id, label: "Next turnover", at: due.checkIn.startsAt },
      occurredAt: Date.now(),
      suggestedAction: "Deal with the open concern before the guest arrives, with Dispatch.",
      priority: "high",
      deadlineAt: due.checkIn.hardDeadlineAt,
    });
    await attachSignal(ctx, signal.row, row._id);
  }
  row = await assess(ctx, company, row);
  if (!row.serious) row = await planRecovery(ctx, company, row, { wantsDifferentCleaner: concern.wantsDifferentCleaner === true });
  // When an AI reader is connected, it reads the customer's words once, with credits held first. The rules' reading stands until then, and if it cannot.
  if (!row.serious && retentionModel()) await enqueueRun(ctx, { companyId: company._id, kind: "diagnose", key: `diagnose:${row._id}`, caseId: row._id });
  return { row, created: true };
}

/** Reads the evidence into the case's history (once) and records the rule diagnosis with what is still not known. */
export async function assess(ctx: MutationCtx, company: Doc<"companies">, row: Case, hint?: { category?: Diagnosis; areas?: string[]; reader: string }): Promise<Case> {
  const evidence = await gatherEvidence(ctx, company, row);
  const already = (await entriesOf(ctx, row)).some((entry) => entry.kind === "evidence" && entry.basis === "fact");
  if (!already) for (const statement of statements(evidence, row, company.timezone)) await addEntry(ctx, row, { kind: "evidence", basis: statement.basis, text: statement.text, source: statement.source, actor: SYSTEM });
  const reading = diagnoseByRule(row, evidence, hint);
  // A person's diagnosis stands. Rules and a model only fill the gap or refine their own earlier reading.
  if (row.diagnosis?.reader === "person") return row;
  const changed = row.diagnosis?.category !== reading.category;
  const fresh = await moveCase(ctx, row, { diagnosis: { category: reading.category, basis: reading.basis, reasons: reading.reasons, uncertain: reading.uncertain, by: RETENTION, reader: reading.reader, at: Date.now() }, areas: reading.areas });
  if (changed) await addEntry(ctx, fresh, { kind: "diagnosis", basis: reading.basis, text: `${DIAGNOSIS_WORDS[reading.category]}. ${reading.reasons.join(" ")}${reading.uncertain.length ? ` Not known: ${reading.uncertain.slice(0, 3).join(" ")}` : ""}`, actor: RETENTION });
  // The same area reported on more than one visit is raised by itself, whatever the remedy turns out to be.
  const repeats = evidence.prior.filter((p) => p.shared.length > 0);
  if (repeats.length && fresh.propertyId) {
    const shared = [...new Set(repeats.flatMap((p) => p.shared))].sort();
    const signal = await raiseSignal(ctx, {
      companyId: company._id,
      kind: "repeat_complaint",
      key: `repeat:${fresh.propertyId}:${shared.join("+")}`,
      basis: "fact",
      customerId: fresh.customerId,
      propertyId: fresh.propertyId,
      segment: fresh.segment,
      what: `The customer reported ${shared.join(", ")} on ${repeats.length + 1} separate visits.${repeats.some((p) => p.correctionCompleted === false) ? " An earlier correction has no completion on record." : ""}`,
      source: { table: "retentionCases", id: fresh._id, label: "Latest report", at: fresh.createdAt },
      occurredAt: fresh.createdAt,
      missing: ["Why it keeps happening: the task, the time allowed, or the instructions to the crew."],
      suggestedAction: "Correct it, record the instruction on the property, and check the next ordinary service.",
      priority: "high",
    });
    await attachSignal(ctx, signal.row, fresh._id);
  }
  return fresh;
}

export async function originalVisit(ctx: MutationCtx, evidence: Evidence): Promise<{ crewPayCents: number; durationMinutes: number; priceCents: number | null } | null> {
  if (!evidence.job) return null;
  return { crewPayCents: evidence.crew.reduce((sum, c) => sum + c.payCents, 0), durationMinutes: evidence.job.durationMinutes, priceCents: evidence.job.priceCents };
}

/** How long a targeted correction is planned for: a quarter of the original visit, between 45 minutes and 2 hours. */
export function targetedMinutes(durationMinutes: number | undefined): number {
  const quarter = Math.round(((durationMinutes ?? 120) / 4) / 15) * 15;
  return Math.max(45, Math.min(120, quarter));
}

/**
 * The first step for a case, chosen from the diagnosis. It is prepared and routed by the Owner's
 * authority; nothing here books, credits or sends on its own word.
 */
export async function planRecovery(ctx: MutationCtx, company: Doc<"companies">, row: Case, options: { wantsDifferentCleaner?: boolean } = {}): Promise<Case> {
  if (row.status === "closed" || row.serious || row.heldBy || !row.diagnosis) return row;
  const customer = (await ctx.db.get(row.customerId))!;
  const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
  const evidence = await gatherEvidence(ctx, company, row);
  const tz = company.timezone;
  const category = row.diagnosis.category;
  const what = row.areas.join(", ") || "the reported work";
  const channel = await careChannel(ctx, customer);
  let needs: string | undefined;
  let doing = row.doing;

  if (options.wantsDifferentCleaner && evidence.crew.length) {
    const action = await prepareAction(ctx, row, {
      kind: "different_cleaner",
      key: "different-cleaner",
      summary: `Do not send ${evidence.crew.map((c) => c.name).join(" or ")} to ${propertyName(property)} again`,
      reason: "The customer asked for a different cleaner. This changes who Dispatch offers this property's visits to. It changes nothing about anyone's pay or standing.",
      permission: "retention.hand_off",
      visit: { areas: [], scope: "targeted", minutes: 0, crew: 1, avoidCleanerIds: evidence.crew.map((c) => c.cleanerId) },
      actor: RETENTION,
    });
    // A request about a named person is reviewed by a person before Dispatch is told anything.
    needs = `The customer asked for a different cleaner. Review "${action.summary}" before it is applied.`;
  }

  if (category === "quality_miss") {
    const minutes = targetedMinutes(evidence.job?.durationMinutes);
    const cost = correctionCost(await originalVisit(ctx, evidence), minutes);
    const slots = await correctionSlots(ctx, company, { minutes, crew: 1, like: evidence.job?.startsAt });
    if (slots.length) {
      const slot = slots[0];
      const action = await prepareAction(ctx, row, {
        kind: "correction_visit",
        key: "correction-1",
        summary: `Correction visit for ${what} at ${propertyName(property)}, ${whenWords(slot.startsAt, tz)}`,
        reason: `${row.diagnosis.reasons.join(" ")} A targeted correction of ${minutes} minutes, at no charge to the customer.`,
        permission: "retention.remedy_within_limit",
        visit: { areas: row.areas, scope: "targeted", startsAt: slot.startsAt, endsAt: slot.endsAt, minutes, crew: 1, payHintCents: cost.payHintCents, avoidCleanerIds: options.wantsDifferentCleaner ? evidence.crew.map((c) => c.cleanerId) : [] },
        estimatedCostCents: cost.estimateCents ?? undefined,
        costBasis: cost.basis,
        dueAt: row.dueAt,
        actor: RETENTION,
      });
      const routed = await submitAction(ctx, company, action._id, RETENTION);
      if (routed.status === "awaiting_approval") {
        needs = needs ?? `Review the proposed correction visit for ${whenWords(slot.startsAt, tz)}.`;
        doing = "A correction visit is prepared and waiting for approval.";
      } else if (routed.status === "proposed") {
        needs = needs ?? `Set the crew's pay for the correction visit prepared for ${whenWords(slot.startsAt, tz)}. ${routed.detail}`;
        doing = "A correction visit is prepared. It is not booked.";
      } else if (routed.status === "blocked") needs = `${ACTION_WORDS.correction_visit} was not carried out: ${plain(routed.detail)}`;
    } else {
      // No open time is a real answer. Retention says so and asks Dispatch; it does not promise a visit.
      const action = await prepareAction(ctx, row, { kind: "dispatch_review", key: "find-slot-1", summary: `Find a time for a ${minutes}-minute correction visit at ${propertyName(property)}`, reason: `No open time was found in the next 7 days for a correction of ${what}. ${cost.basis}`, permission: "retention.hand_off", dueAt: row.dueAt, actor: RETENTION });
      await submitAction(ctx, company, action._id, RETENTION);
      doing = "No open time was found for a correction visit in the next 7 days. Dispatch has been asked to find one.";
      needs = needs ?? "No correction visit could be offered yet. Nothing has been promised to the customer.";
    }
  } else if (category === "scope_misunderstanding") {
    if (channel) {
      const excluded = evidence.job?.excluded.find((line) => sharedAreas(areasIn(line), row.areas).length) ?? what;
      await prepareAction(ctx, row, {
        kind: "scope_clarification",
        key: "scope-1",
        summary: `Explain to ${customer.name} that "${excluded}" was not part of the service booked, and offer to add it`,
        reason: row.diagnosis.reasons.join(" "),
        permission: "retention.send_case_message",
        message: { channel, subject: channel === "email" ? "About your recent service" : undefined, body: `Hi ${first(customer.name)}, thank you for telling us. We looked at the service that was booked for your visit. "${excluded}" was not part of it, which is why it was not done. We are sorry that was not clear. If you would like it included in future visits, reply here and we will tell you what that would involve. - ${company.name}` },
        actor: RETENTION,
      });
    }
    // Telling a customer something was out of scope is a judgement. A person confirms it first, always.
    needs = needs ?? "The record suggests this was outside the booked scope. Confirm that reading before the customer is told, or change the diagnosis.";
    doing = "A scope explanation is drafted. It is not sent until a person confirms the reading.";
  } else if (category === "scheduling_reliability") {
    const action = await prepareAction(ctx, row, { kind: "dispatch_review", key: "reliability-1", summary: `Review what happened with timing on ${customer.name}'s visit and say what will be different`, reason: row.diagnosis.reasons.join(" "), permission: "retention.hand_off", dueAt: row.dueAt, actor: RETENTION });
    await submitAction(ctx, company, action._id, RETENTION);
    doing = "Dispatch has been asked what happened with timing and what will be different.";
  } else if (category === "billing") {
    const action = await prepareAction(ctx, row, { kind: "billing_review", key: "billing-1", summary: `Review the charge ${customer.name} is questioning`, reason: `${row.diagnosis.reasons.join(" ")} Invoices and payments are the Owner's to read and change.`, permission: "retention.hand_off", dueAt: row.dueAt, actor: RETENTION });
    await submitAction(ctx, company, action._id, RETENTION);
    doing = "The Owner has been asked to review the charge in Finance.";
  } else {
    // Insufficient evidence: ask, or look. Nothing is concluded from photos alone.
    if (!row.areas.length && channel) {
      const action = await prepareAction(ctx, row, {
        kind: "message",
        key: "ask-1",
        summary: `Ask ${customer.name} which part of the service the concern is about`,
        reason: "The customer has not said which task or area was affected, so there is nothing yet to correct.",
        permission: "retention.send_case_message",
        message: { channel, subject: channel === "email" ? "About your recent service" : undefined, body: `Hi ${first(customer.name)}, thank you for telling us about your recent service. So we can put it right, could you tell us which rooms or tasks were not as expected? You can describe it here: {link} - ${company.name}`, linkPurpose: "issue" },
        actor: RETENTION,
      });
      const routed = await submitAction(ctx, company, action._id, RETENTION);
      doing = routed.status === "awaiting_approval" ? "A question to the customer is drafted and waiting for approval." : "Asked the customer which part of the service the concern is about.";
      if (routed.status === "awaiting_approval") needs = needs ?? "Review the question drafted for the customer.";
      else if (routed.status === "blocked") needs = `The question could not be sent: ${plain(routed.detail)}`;
    } else {
      await prepareAction(ctx, row, { kind: "inspection", key: "inspect-1", summary: `Inspect ${what} at ${propertyName(property)}`, reason: `${row.diagnosis.reasons.join(" ")} The record does not settle it, so someone needs to look.`, permission: "retention.hand_off", dueAt: row.dueAt, actor: RETENTION });
      needs = needs ?? "The record does not settle what happened. Decide: send someone to inspect, offer a correction anyway, or ask the customer a question.";
      doing = "The visit's record and the customer's report disagree. An inspection is prepared for a person to decide on.";
    }
  }
  const fresh = (await ctx.db.get(row._id))!;
  if (fresh.status === "closed") return fresh;
  // The action may already have moved the case (a booked visit, a sent question). Otherwise it waits on a person or is under way.
  const keep = fresh.status === "waiting_on_customer" || (fresh.status === "action_underway" && fresh.doing !== row.doing);
  return moveCase(ctx, fresh, { status: needs ? "needs_attention" : keep ? fresh.status : "action_underway", doing: keep ? fresh.doing : doing, needs, clearNeeds: !needs }, RETENTION);
}

// ── Feedback ─────────────────────────────────────────────────────────────────────────────────────

export type FeedbackInput = {
  job: Doc<"jobs">;
  link?: Doc<"retentionLinks">;
  source: "customer_link" | "staff";
  rating?: number;
  comment?: string;
  issue?: { description: string; areas: string[]; wantsDifferentCleaner: boolean };
  clientKey: string;
  recordedBy?: Id<"members">;
  actor: Actor;
};

/**
 * Records feedback about one service, once. A second submission through the same link, or a retry with
 * the same key, answers with the first. An issue opens (or joins) the recovery case for that service
 * whatever rating came with it; a rating alone never opens or prevents anything.
 */
export async function recordFeedback(ctx: MutationCtx, company: Doc<"companies">, input: FeedbackInput): Promise<{ feedbackId: Id<"retentionFeedback">; caseId: Id<"retentionCases"> | null; repeated: boolean }> {
  const { job } = input;
  const byKey = await ctx.db
    .query("retentionFeedback")
    .withIndex("by_company_clientKey", (q) => q.eq("companyId", company._id).eq("clientKey", input.clientKey))
    .first();
  if (byKey) return { feedbackId: byKey._id, caseId: byKey.caseId ?? null, repeated: true };
  if (input.link) {
    const byLink = await ctx.db
      .query("retentionFeedback")
      .withIndex("by_company_link", (q) => q.eq("companyId", company._id).eq("linkId", input.link!._id))
      .first();
    if (byLink) return { feedbackId: byLink._id, caseId: byLink.caseId ?? null, repeated: true };
  }
  const customer = (await ctx.db.get(job.customerId))!;
  const property = await ctx.db.get(job.propertyId);
  const rating = input.rating !== undefined && Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 5 ? input.rating : undefined;
  const comment = input.comment?.trim().slice(0, 2000) || undefined;
  const issue = input.issue && input.issue.description.trim() ? { description: input.issue.description.trim().slice(0, 2000), areas: cleanAreas([...input.issue.areas, ...areasIn(input.issue.description)]), wantsDifferentCleaner: input.issue.wantsDifferentCleaner } : undefined;
  // Words that describe a serious concern are an issue even when the customer did not tick the box.
  const serious = !issue && comment ? seriousReason(comment) : null;
  const effective = issue ?? (serious && comment ? { description: comment, areas: areasIn(comment), wantsDifferentCleaner: false } : undefined);
  const feedbackId = await ctx.db.insert("retentionFeedback", { companyId: company._id, customerId: customer._id, propertyId: job.propertyId, jobId: job._id, linkId: input.link?._id, source: input.source, rating, comment, issue: effective, clientKey: input.clientKey, recordedBy: input.recordedBy, submittedAt: Date.now() });
  await recordEvent(ctx, { companyId: company._id, type: "retention_feedback.received", actor: input.actor, subject: { table: "retentionFeedback", id: feedbackId }, data: { hasIssue: effective !== undefined, source: input.source } });

  // The follow-through that asked, if there was one.
  const asked = await caseByKey(ctx, company._id, `follow:${customer._id}`);
  const followThrough = asked && asked.status !== "closed" && asked.jobId === job._id ? asked : null;
  let caseId: Id<"retentionCases"> | null = null;
  if (effective) {
    const opened = await openRecovery(ctx, company, { customer, property, job, words: effective.description, areas: effective.areas, origin: input.source === "staff" ? "staff" : "feedback", wantsDifferentCleaner: effective.wantsDifferentCleaner, fromCaseId: followThrough?._id, actor: input.actor });
    caseId = opened.row._id;
    await addEntry(ctx, opened.row, { kind: "evidence", basis: "customer_stated", text: `Feedback received${rating !== undefined ? ` with a rating of ${rating} of 5` : ""}. The rating did not decide anything: the case is about what the customer described.`, source: { table: "retentionFeedback", id: feedbackId, label: "Feedback" }, actor: input.actor });
    if (followThrough) {
      await addEntry(ctx, followThrough, { kind: "note", text: "The customer described an issue. It has its own recovery case; no offer of more service goes out while it is open.", source: { table: "retentionCases", id: opened.row._id, label: "Recovery case" }, actor: SYSTEM });
      await closeCase(ctx, followThrough, "handled_by_person", SYSTEM, "Continued in the recovery case.");
    }
    // A repeat on the service that followed a correction changes what that earlier case can claim.
    await noteRepeatAfterCorrection(ctx, company, job, effective.areas);
  } else if (followThrough) {
    await addEntry(ctx, followThrough, { kind: "verification", basis: "customer_stated", text: `The customer gave feedback${rating !== undefined ? ` (${rating} of 5)` : ""} and described no issue.`, quote: comment, source: { table: "retentionFeedback", id: feedbackId, label: "Feedback" }, actor: input.actor });
    await closeCase(ctx, followThrough, "feedback_no_issue", SYSTEM);
    caseId = followThrough._id;
  }
  if (caseId) await ctx.db.patch(feedbackId, { caseId });
  // A service the customer says went well is when a recurring plan is worth offering, through Sales.
  if (!effective) await offerRecurring(ctx, company, { customer, property, job, rating, feedbackId });
  return { feedbackId, caseId, repeated: false };
}

/** A new report about the same area on the service after a correction: the earlier case's "next service" was not clean. */
async function noteRepeatAfterCorrection(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">, areas: string[]): Promise<void> {
  const earlier = await ctx.db
    .query("retentionCases")
    .withIndex("by_company_property", (q) => q.eq("companyId", company._id).eq("propertyId", job.propertyId))
    .order("desc")
    .take(30);
  for (const other of earlier) {
    const next = other.verification?.nextService;
    if (other.kind !== "recovery" || !next || next.jobId !== job._id || next.repeatReported) continue;
    if (!sharedAreas(other.areas, areas).length) continue;
    await ctx.db.patch(other._id, { verification: { ...other.verification!, nextService: { ...next, repeatReported: true } }, updatedAt: Date.now() });
    await addEntry(ctx, other, { kind: "verification", basis: "customer_stated", text: `The customer reported ${sharedAreas(other.areas, areas).join(", ")} again on the next service. The correction did not hold.`, source: { table: "jobs", id: job._id, label: "Next service", at: job.startsAt }, actor: SYSTEM });
  }
}

// ── Verification ─────────────────────────────────────────────────────────────────────────────────

/** The correction visit was completed. The case moves to monitoring and the customer is asked whether it worked. */
export async function correctionCompleted(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">): Promise<void> {
  if (!job.recovery) return;
  let row = await ctx.db.get(job.recovery.caseId);
  if (!row || row.status === "closed") return;
  if (row.verification?.correctionCompletedAt !== undefined) return;
  const customer = (await ctx.db.get(row.customerId))!;
  const what = row.areas.join(", ") || "the reported work";
  row = await moveCase(ctx, row, {
    status: "monitoring",
    doing: "The correction visit is done. Asking the customer whether it addressed the problem.",
    clearNeeds: true,
    dueAt: Date.now() + retentionSettings(company).quietDays * DAY,
    verification: { ...(row.verification ?? { criteria: `The customer confirms that ${what} was addressed.` }), correctionJobId: job._id, correctionCompletedAt: Date.now() },
  }, SYSTEM);
  await addEntry(ctx, row, { kind: "verification", basis: "fact", text: `The correction visit was completed${job.completionReview?.decision === "closed" ? " and reviewed by a person" : ""}. That is the work done. Whether it addressed the problem is the customer's to say.`, source: { table: "jobs", id: job._id, label: "Correction visit", at: job.startsAt }, actor: SYSTEM });
  if (row.serious || row.heldBy) return;
  const channel = await careChannel(ctx, customer);
  if (!channel) {
    await moveCase(ctx, row, { status: "needs_attention", needs: "The correction is done, and there is no phone or email on file to ask the customer whether it worked. Ask them another way and record the answer." }, SYSTEM);
    return;
  }
  const action = await prepareAction(ctx, row, {
    kind: "confirm_correction",
    key: `confirm:${job._id}`,
    summary: `Ask ${customer.name} whether the correction addressed ${what}`,
    reason: "A completed correction is not a recovered relationship until the customer says so.",
    permission: "retention.send_case_message",
    message: { channel, subject: channel === "email" ? "Did we put it right?" : undefined, body: `Hi ${first(customer.name)}, we came back to take care of ${what}. Did that put it right? Tell us here, yes or no: {link} - ${company.name}`, linkPurpose: "confirm" },
    actor: RETENTION,
  });
  const routed = await submitAction(ctx, company, action._id, RETENTION);
  const fresh = (await ctx.db.get(row._id))!;
  if (routed.status === "awaiting_approval") await moveCase(ctx, fresh, { status: "needs_attention", needs: "The correction is done. Approve the question asking the customer whether it worked.", doing: "The correction visit is done. A question to the customer is waiting for approval." }, SYSTEM);
}

/** The customer's own answer about a correction. "Yes" closes the case as confirmed; "no" brings a person back in. */
export async function customerAnswered(ctx: MutationCtx, row: Case, answer: "resolved" | "not_resolved", note: string | undefined, actor: Actor): Promise<Case> {
  if (row.status === "closed") return row;
  const verification = { ...(row.verification ?? { criteria: "The customer confirms the problem was addressed." }), customerAnswer: { answer, note: note?.slice(0, 1000), at: Date.now() } };
  await addEntry(ctx, row, { kind: "verification", basis: "customer_stated", text: answer === "resolved" ? "The customer said the correction addressed the problem." : "The customer said the correction did not address the problem.", quote: note, actor });
  if (answer === "resolved") {
    const moved = await moveCase(ctx, row, { verification }, actor);
    return closeCase(ctx, moved, "customer_confirmed", actor);
  }
  return moveCase(ctx, row, { verification, status: "needs_attention", doing: "The customer says the problem is not solved. Waiting for a person to decide the next step.", needs: "The customer says the correction did not address the problem. Decide the next step: another correction, an inspection, a credit, or a call." }, actor);
}

/**
 * A later ordinary service at the property was completed. For a case still watching its correction, that
 * is recorded as the next service, clean until the customer reports otherwise.
 */
export async function noteNextService(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">): Promise<void> {
  if (job.recovery) return;
  const cases = await ctx.db
    .query("retentionCases")
    .withIndex("by_company_property", (q) => q.eq("companyId", company._id).eq("propertyId", job.propertyId))
    .order("desc")
    .take(30);
  for (const row of cases) {
    const v = row.verification;
    if (row.kind !== "recovery" || !v?.correctionCompletedAt || v.nextService || job.startsAt < v.correctionCompletedAt) continue;
    if (row.closedAt !== undefined && job.startsAt - row.closedAt > 60 * DAY) continue;
    await ctx.db.patch(row._id, { verification: { ...v, nextService: { jobId: job._id, completedAt: Date.now(), repeatReported: false } }, updatedAt: Date.now() });
    await addEntry(ctx, row, { kind: "verification", basis: "fact", text: "The next ordinary service at the property was completed. No repeat report has been received for it.", source: { table: "jobs", id: job._id, label: "Next service", at: job.startsAt }, actor: SYSTEM });
    // The customer never answered, and the next service passed without a repeat: closed as exactly that.
    if (row.status === "monitoring" && !v.customerAnswer) await closeCase(ctx, (await ctx.db.get(row._id))!, "subsequent_service_completed", SYSTEM);
  }
}

/** Cases whose question to the customer passed its last day with no answer are closed as exactly that. */
export async function closeQuiet(ctx: MutationCtx, company: Doc<"companies">, now: number): Promise<number> {
  let closed = 0;
  for (const status of ["monitoring", "waiting_on_customer"] as const) {
    const rows = await ctx.db
      .query("retentionCases")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status).lt("dueAt", now))
      .take(100);
    for (const row of rows) {
      if (row.heldBy || row.serious) continue;
      const pending = (await actionsOf(ctx, row)).some((a) => a.status === "awaiting_approval" || (a.status === "underway" && a.handoff?.status === "open"));
      if (pending) continue;
      if (row.kind === "recovery") {
        if (row.verification?.correctionCompletedAt && !row.verification.customerAnswer) {
          await closeCase(ctx, row, "correction_done_unconfirmed", SYSTEM, "The customer was asked and did not answer.");
          closed += 1;
        } else if (status === "waiting_on_customer") {
          // A concern the customer has not clarified is not dropped: a person decides what to do with it.
          await moveCase(ctx, row, { status: "needs_attention", needs: "The customer has not answered the question about their concern. Decide the next step: call them, offer a correction anyway, or close it as unknown." }, SYSTEM);
        }
      } else if (row.kind === "follow_through" || row.kind === "reactivation") {
        await closeCase(ctx, row, "no_response", SYSTEM);
        closed += 1;
      }
    }
  }
  return closed;
}

// ── After a first service ────────────────────────────────────────────────────────────────────────

/** Whether this is the customer's first verified completed service: reviewed and closed by a person, with none before it. */
async function isFirstVerifiedService(ctx: MutationCtx, job: Doc<"jobs">): Promise<boolean> {
  if (job.status !== "completed" || job.completionReview?.decision !== "closed" || job.recovery) return false;
  const all = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", job.companyId).eq("customerId", job.customerId))
    .take(200);
  return !all.some((other) => other._id !== job._id && other.status === "completed" && !other.recovery);
}

/**
 * New-customer follow-through, once per customer: check that what was agreed and what matters to them is
 * on record, ask for feedback once, and confirm the next service where a recurring plan exists. Later
 * visits are not surveyed unless a person asks.
 */
export async function followThrough(ctx: MutationCtx, company: Doc<"companies">, job: Doc<"jobs">): Promise<Case | null> {
  const settings = retentionSettings(company);
  if (!settings.feedbackAfterFirstService || !(await isFirstVerifiedService(ctx, job))) return null;
  const customer = await ctx.db.get(job.customerId);
  const property = await ctx.db.get(job.propertyId);
  if (!customer || customer.status !== "active") return null;
  const tz = company.timezone;
  const opened = await openCase(ctx, {
    companyId: company._id,
    kind: "follow_through",
    key: `follow:${customer._id}`,
    status: "action_underway",
    customer,
    property,
    jobId: job._id,
    title: `${customer.name}: first service follow-through`,
    happened: `The first service for ${customer.name} (${job.serviceSnapshot?.name ?? job.serviceType}) was completed and reviewed on ${dayName(job.startsAt, tz)}.`,
    doing: "Checking what was agreed is on record and asking how it went.",
    origin: "service_completed",
    dueAt: Date.now() + settings.linkDays * DAY,
    actor: RETENTION,
  });
  if (!opened.created) return opened.row;
  let row = opened.row;
  const source = { table: "jobs", id: job._id, label: "First service", at: job.startsAt };
  const gaps: string[] = [];
  // What was promised, and what matters to this customer, checked against the record rather than assumed.
  const scoped = job.scope.trim().length > 20;
  await addEntry(ctx, row, { kind: "evidence", basis: "fact", text: scoped ? "The visit was booked with a written scope." : "The visit has almost no written scope, so there is little on record of what was agreed.", source, actor: SYSTEM });
  if (!scoped) gaps.push("Write down what was agreed for this customer's service.");
  const preferences = customer.preferences?.trim() || property?.clientNotes?.trim() || property?.crewNotes?.trim();
  await addEntry(ctx, row, { kind: "evidence", basis: "fact", text: preferences ? "Preferences are recorded for this customer or property." : "No preferences or notes are recorded for this customer or property.", actor: SYSTEM });
  if (!preferences) gaps.push("Record this customer's preferences, so they do not have to repeat them.");
  if (row.segment === "residential_recurring") {
    const next = (
      await ctx.db
        .query("jobs")
        .withIndex("by_company_property_start", (q) => q.eq("companyId", company._id).eq("propertyId", job.propertyId).gte("startsAt", Date.now()))
        .take(20)
    ).find((other) => other.status === "scheduled" && !other.recovery);
    await addEntry(ctx, row, next ? { kind: "evidence", basis: "fact", text: `The next service is booked for ${whenWords(next.startsAt, tz)}.`, source: { table: "jobs", id: next._id, label: "Next service", at: next.startsAt }, actor: SYSTEM } : { kind: "evidence", basis: "fact", text: "A recurring plan exists, and no next service is booked.", actor: SYSTEM });
    if (!next) gaps.push("A recurring plan exists with no next visit booked. Check the plan.");
  } else {
    await addEntry(ctx, row, { kind: "note", text: "This was a one-time service. Its completion is not a lost recurring customer, and no offer is made before feedback is in and clear of issues.", actor: SYSTEM });
  }
  const channel = await careChannel(ctx, customer);
  let needs = gaps.length ? gaps.join(" ") : undefined;
  let doing = "Asking how the first service went.";
  if (!channel) {
    needs = `${needs ? `${needs} ` : ""}There is no phone or email on file, so feedback cannot be requested. Ask in person and record it.`;
  } else {
    const action = await prepareAction(ctx, row, {
      kind: "request_feedback",
      key: "feedback-1",
      summary: `Ask ${customer.name} how their first service went`,
      reason: "One short request after a first service catches a mismatch early. It is not repeated after every visit.",
      permission: "retention.request_feedback",
      message: { channel, subject: channel === "email" ? "How did we do?" : undefined, body: `Hi ${first(customer.name)}, thank you for choosing ${company.name}. How did your first service go? It takes a minute, and if anything was not right you can tell us there: {link}`, linkPurpose: "feedback" },
      actor: RETENTION,
    });
    const routed = await submitAction(ctx, company, action._id, RETENTION);
    if (routed.status === "awaiting_approval") {
      needs = `${needs ? `${needs} ` : ""}Approve the feedback request.`;
      doing = "A feedback request is drafted and waiting for approval.";
    } else if (routed.status === "blocked") needs = `${needs ? `${needs} ` : ""}The feedback request was not sent: ${plain(routed.detail)}`;
  }
  row = (await ctx.db.get(row._id))!;
  if (row.status === "closed") return row;
  // A request that is out and waiting is not held up by a record-keeping gap: the gap is shown on the case for a person.
  const waiting = row.status === "waiting_on_customer";
  return moveCase(ctx, row, { status: waiting ? "waiting_on_customer" : needs ? "needs_attention" : "action_underway", doing: waiting ? row.doing : doing, needs, clearNeeds: !needs }, RETENTION);
}
