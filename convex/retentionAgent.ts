/**
 * The Retention workspace: what the office sees and does. (convex/retention.ts is the privacy purge and
 * has nothing to do with this.)
 *
 * Every read is of one company's records, through a builder that checks the member first. Reads return
 * words ready to show beside the ids they came from, so a screen never has to guess what a state means.
 * Writes that change what a customer experiences or what the company spends are prepared as actions and
 * routed by the Owner's authority settings; nothing here sends, books or credits on a browser's word.
 *
 * Money stays where Finance keeps it: invoice amounts are read for the Owner only.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { purposesOf } from "./lib/inbox/mailboxes";
import { owned } from "./lib/access";
import { localParts } from "./lib/availability";
import { billingState } from "./lib/billing/access";
import { companyMutation, companyQuery, managerMutation, ownerMutation, type MemberAccess } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { money } from "./lib/dispatch/pay";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { emailProvider } from "./lib/messaging/email";
import { senderGaps } from "./lib/messaging/policy";
import { messagingProvider } from "./lib/messaging/provider";
import { actionDef } from "./lib/permissionCatalog";
import { ACTION_WORDS, actionsOf, careChannel, correctionCost, prepareAction, setCorrectionPay as setCorrectionPayOn, stampFor, submitAction, whenWords } from "./lib/retention/actions";
import { addEntry, areasIn, cleanAreas, closeCase, DAY, entriesOf, HOUR, KIND_WORDS, moveCase, openCase as openCaseRecord, OUTCOME_WORDS, propertyName, SEGMENT_WORDS, STATUS_WORDS, VERIFIED_OUTCOMES } from "./lib/retention/cases";
import { requestPlanChange } from "./lib/retention/continuity";
import { DIAGNOSIS_WORDS, retentionModel } from "./lib/retention/diagnose";
import { gatherEvidence } from "./lib/retention/evidence";
import { careLinkState, careLinkUrl, issueCareLink, revokeCareLink } from "./lib/retention/links";
import { measures } from "./lib/retention/measures";
import { conversationOwner, deliveryWords, MESSAGING_BALANCE } from "./lib/retention/outbox";
import { CHANGE_WORDS, loadPlan, openBilling, previewPlanChange } from "./lib/retention/planChanges";
import { MISSING_DATA } from "./lib/retention/reconcile";
import { customerAnswered, openRecovery, originalVisit, planRecovery } from "./lib/retention/recovery";
import { prepareRenewal, prepareReturn, reactivationCandidates, relationshipSummary, renewalRow, serviceReview } from "./lib/retention/relationships";
import { ACTION_KINDS, DIAGNOSES, OUTCOMES, PLAN_CHANGES, planRefValidator, retentionSettingsValidator, type CaseStatus } from "./lib/retention/schema";
import { checkedSettings, retentionSettings } from "./lib/retention/settings";
import { attachSignal, SIGNAL_WORDS } from "./lib/retention/signals";
import { runCaseTool, TOOL_NAMES, TOOL_WORDS } from "./lib/retention/tools";
import { isManager, isOwner } from "./lib/roles";
import { literals } from "./lib/statuses";
import { optionalText, text } from "./lib/text";
import { enqueueRun } from "./lib/retention/runs";

type Ctx = QueryCtx & MemberAccess;
type Case = Doc<"retentionCases">;

const OPEN: CaseStatus[] = ["needs_attention", "needs_context", "action_underway", "waiting_on_customer", "monitoring"];
const WAITING_WORDS: Record<string, string> = { dispatch: "Dispatch", sales: "Sales", finance: "the Owner, in Finance", quality: "an inspection", owner: "the Owner" };

async function openCases(ctx: QueryCtx, companyId: Id<"companies">): Promise<Case[]> {
  const out: Case[] = [];
  for (const status of OPEN) out.push(...(await ctx.db.query("retentionCases").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status)).take(300)));
  return out;
}

/** A case as a card: what happened, what Selestial is doing, and what needs a person, readable at a glance. */
async function card(ctx: QueryCtx, row: Case, now: number, cache: Map<string, string>) {
  const name = async (table: "customers" | "properties", id: string) => {
    if (!cache.has(id)) {
      const doc = await ctx.db.get(id as Id<"customers"> | Id<"properties">);
      cache.set(id, !doc ? "" : table === "customers" ? (doc as Doc<"customers">).name : propertyName(doc as Doc<"properties">));
    }
    return cache.get(id)!;
  };
  const actions = await actionsOf(ctx, row);
  const waiting = actions.find((a) => a.status === "underway" && a.handoff?.status === "open");
  const approval = actions.find((a) => a.status === "awaiting_approval");
  const draft = actions.find((a) => a.status === "proposed");
  return {
    caseId: row._id,
    kind: row.kind,
    kindWords: KIND_WORDS[row.kind],
    segment: row.segment,
    segmentWords: SEGMENT_WORDS[row.segment],
    status: row.status,
    statusWords: STATUS_WORDS[row.status],
    title: row.title,
    customerId: row.customerId,
    customer: await name("customers", row.customerId),
    property: row.propertyId ? await name("properties", row.propertyId) : null,
    happened: row.happened,
    doing: row.doing,
    needs: row.needs ?? null,
    nextAction: approval ? `Review: ${approval.summary}` : draft && row.status === "needs_attention" ? `Decide: ${draft.summary}` : null,
    approvalId: approval?.approvalId ?? null,
    waitingOn: waiting?.handoff ? WAITING_WORDS[waiting.handoff.to] : row.status === "waiting_on_customer" || row.status === "monitoring" ? "the customer" : null,
    dueAt: row.dueAt,
    overdue: row.status !== "closed" && row.status !== "waiting_on_customer" && row.status !== "monitoring" && row.dueAt < now,
    serious: row.serious !== undefined,
    held: row.heldBy !== undefined,
    areas: row.areas,
    diagnosis: row.diagnosis ? DIAGNOSIS_WORDS[row.diagnosis.category] : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    closedAt: row.closedAt ?? null,
    outcome: row.outcome ? { code: row.outcome.code, words: OUTCOME_WORDS[row.outcome.code], verified: VERIFIED_OUTCOMES.includes(row.outcome.code), at: row.outcome.at } : null,
  };
}

const RANK: Record<CaseStatus, number> = { needs_attention: 0, needs_context: 1, action_underway: 2, waiting_on_customer: 3, monitoring: 4, closed: 5 };
const byUrgency = <T extends { status: CaseStatus; dueAt: number; serious: boolean }>(a: T, b: T) => Number(b.serious) - Number(a.serious) || RANK[a.status] - RANK[b.status] || a.dueAt - b.dueAt;

/** What Retention can and cannot do right now, in words: sending, the AI reader, and what Selestial does not hold. */
async function readiness(ctx: Ctx) {
  const profile = await readProfile(ctx, ctx.companyId);
  const sms = messagingProvider() ? senderGaps(profile.messaging, "sms") : [{ key: "provider", words: "Texting isn't connected for Selestial yet." }];
  const email = emailProvider() !== null;
  const model = retentionModel();
  const billing = billingState();
  const links = Boolean(process.env.ACTION_LINK_SECRET && process.env.ACTION_LINK_SECRET.trim().length >= 32);
  return [
    { key: "sms", label: "Texting", ok: sms.length === 0, detail: sms.length ? sms.map((g) => g.words).join(" ") : "Ready. Consent, opt-outs and quiet hours are checked on every send." },
    { key: "email", label: "Email", ok: email, detail: email ? "Ready." : "Email isn't connected for Selestial yet." },
    { key: "links", label: "Customer links", ok: links, detail: links ? "Ready. Each link is scoped to one customer, expires, and can be closed." : "Customer links are not set up on this deployment, so feedback and plan pages cannot be sent." },
    { key: "reader", label: "AI reading", ok: model !== null && billing.connected, detail: model ? (billing.connected ? `Customer messages are read by ${model.name}, with credits held first. Without credits the company's rules read them.` : `An AI reader is connected, but ${billing.message.toLowerCase()} The company's rules read instead.`) : "Customer messages are read by the company's rules. No AI reader is connected, and no credits are used." },
    { key: "balance", label: "Messaging balance", ok: false, detail: MESSAGING_BALANCE.words },
  ];
}

// ── Reads ────────────────────────────────────────────────────────────────────────────────────────

export const overview = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const now = args.asOf;
    const cache = new Map<string, string>();
    const rows = await openCases(ctx, ctx.companyId);
    const cards = (await Promise.all(rows.map((row) => card(ctx, row, now, cache)))).sort(byUrgency);
    const needsOwner = cards.filter((c) => c.status === "needs_attention" || c.status === "needs_context");
    const working = cards.filter((c) => c.status === "action_underway" || c.status === "waiting_on_customer" || c.status === "monitoring");
    const overdue = cards.filter((c) => c.overdue);
    const signals = await ctx.db.query("retentionSignals").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open")).take(300);
    // Renewal decisions coming up: open renewal cases, soonest deadline first.
    const today = localParts(now, ctx.company.timezone).day;
    const lead = retentionSettings(ctx.company).renewalLeadDays;
    const renewals = [];
    for (const row of rows.filter((r) => r.kind === "renewal" && r.agreementId)) {
      const agreement = await ctx.db.get(row.agreementId!);
      if (!agreement) continue;
      renewals.push({ caseId: row._id, customer: cache.get(row.customerId) ?? "", caseStatus: row.status, statusWords: STATUS_WORDS[row.status], ...renewalRow(agreement, today, lead) });
    }
    renewals.sort((a, b) => (a.noticeBy ?? a.target ?? "9").localeCompare(b.noticeBy ?? b.target ?? "9"));
    const recent = await ctx.db.query("retentionCases").withIndex("by_company_closed", (q) => q.eq("companyId", ctx.companyId).gte("closedAt", now - 30 * DAY)).order("desc").take(12);
    const outcomes = await Promise.all(recent.map((row) => card(ctx, row, now, cache)));
    const paused = ctx.company.pausedAgents.includes("retention");
    return {
      paused,
      state: paused ? ("paused" as const) : needsOwner.length ? ("needs_you" as const) : cards.some((c) => c.status === "action_underway") ? ("working" as const) : working.length ? ("waiting" as const) : ("clear" as const),
      counts: { needsOwner: needsOwner.length, working: working.length, overdue: overdue.length, signals: signals.length, renewals: renewals.length, open: cards.length },
      needsOwner: needsOwner.slice(0, 8),
      working: working.slice(0, 8),
      overdue: overdue.slice(0, 8),
      renewals: renewals.slice(0, 6),
      outcomes: outcomes.slice(0, 8),
      readiness: await readiness(ctx),
      missing: MISSING_DATA,
    };
  },
});

export const cases = companyQuery({
  args: { asOf: v.number(), view: v.union(v.literal("attention"), v.literal("recovery"), v.literal("continuity"), v.literal("renewals"), v.literal("reactivation"), v.literal("closed")) },
  handler: async (ctx, args) => {
    const cache = new Map<string, string>();
    if (args.view === "closed") {
      const closed = await ctx.db.query("retentionCases").withIndex("by_company_closed", (q) => q.eq("companyId", ctx.companyId).gte("closedAt", args.asOf - 90 * DAY)).order("desc").take(100);
      return Promise.all(closed.map(async (row) => ({ ...(await card(ctx, row, args.asOf, cache)), checkInAt: null as number | null })));
    }
    const rows = (await openCases(ctx, ctx.companyId)).filter((row) =>
      args.view === "attention" ? row.status === "needs_attention" || row.status === "needs_context" : args.view === "recovery" ? row.kind === "recovery" || row.kind === "follow_through" : args.view === "continuity" ? row.kind === "continuity" : args.view === "renewals" ? row.kind === "renewal" : row.kind === "reactivation",
    );
    const cards = await Promise.all(rows.map((row) => card(ctx, row, args.asOf, cache)));
    // A short-term rental's open issue is ordered by the guest's arrival, not by when it was raised.
    const deadlines = new Map<string, number>();
    for (const row of rows) {
      if (row.segment !== "str" || !row.propertyId) continue;
      const next = (await ctx.db.query("jobs").withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", row.propertyId!).gte("startsAt", args.asOf)).take(10)).find((job) => job.status === "scheduled" && job.hardDeadlineAt !== undefined);
      if (next?.hardDeadlineAt) deadlines.set(row._id, next.hardDeadlineAt);
    }
    return cards.map((c) => ({ ...c, checkInAt: deadlines.get(c.caseId) ?? null })).sort((a, b) => (a.checkInAt ?? Infinity) - (b.checkInAt ?? Infinity) || byUrgency(a, b));
  },
});

export const signals = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const rows = [
      ...(await ctx.db.query("retentionSignals").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open")).order("desc").take(200)),
      ...(await ctx.db.query("retentionSignals").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "in_case")).order("desc").take(100)),
    ];
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
      const linked = row.caseId ? await ctx.db.get(row.caseId) : null;
      if (row.status === "in_case" && (!linked || linked.status === "closed")) continue;
      out.push({
        signalId: row._id,
        kind: row.kind,
        kindWords: SIGNAL_WORDS[row.kind],
        basis: row.basis,
        basisWords: row.basis === "fact" ? "Fact from the record" : row.basis === "customer_stated" ? "The customer said so" : "Hypothesis",
        customerId: row.customerId,
        customer: customer?.name ?? "",
        affects: property ? propertyName(property) : row.agreementId ? "The agreement" : row.plan ? "The recurring plan" : "The account",
        segmentWords: SEGMENT_WORDS[row.segment],
        what: row.what,
        source: row.source,
        occurredAt: row.occurredAt,
        missing: row.missing,
        suggestedAction: row.suggestedAction,
        priority: row.priority,
        seen: row.seen,
        deadlineAt: row.deadlineAt ?? null,
        late: row.deadlineAt !== undefined && row.deadlineAt < args.asOf,
        status: row.status,
        caseId: linked?._id ?? null,
        caseStatus: linked ? STATUS_WORDS[linked.status] : null,
      });
    }
    return out.sort((a, b) => Number(a.status === "in_case") - Number(b.status === "in_case") || Number(b.priority === "high") - Number(a.priority === "high") || (a.deadlineAt ?? Infinity) - (b.deadlineAt ?? Infinity) || b.occurredAt - a.occurredAt);
  },
});

export const caseDetail = companyQuery({
  args: { caseId: v.id("retentionCases"), asOf: v.number() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.caseId);
    const now = args.asOf;
    const tz = ctx.company.timezone;
    const customer = (await ctx.db.get(row.customerId))!;
    const cache = new Map<string, string>();
    const summary = await relationshipSummary(ctx, ctx.company, customer, now);
    const entries = await entriesOf(ctx, row);
    const names = new Map<string, string>();
    const who = async (actor: Doc<"retentionEntries">["actor"]): Promise<string> => {
      if (actor.kind === "agent") return "Retention";
      if (actor.kind === "customer") return "The customer";
      if (actor.kind !== "member") return "Selestial";
      if (!names.has(actor.memberId)) names.set(actor.memberId, (await ctx.db.get(actor.memberId))?.name ?? "A person");
      return names.get(actor.memberId)!;
    };
    const timeline = [];
    for (const entry of entries) timeline.push({ id: entry._id, at: entry.at, kind: entry.kind, basis: entry.basis ?? null, text: entry.text, quote: entry.quote ?? null, source: entry.source ?? null, by: await who(entry.actor) });
    const actions = [];
    for (const action of await actionsOf(ctx, row)) {
      const message = action.messageId ? await ctx.db.get(action.messageId) : null;
      const approval = action.approvalId ? await ctx.db.get(action.approvalId) : null;
      const def = actionDef(action.permission);
      const link = action.linkId ? await ctx.db.get(action.linkId) : null;
      const stale = action.status === "proposed" || action.status === "awaiting_approval" ? (await stampFor(ctx, row, action)) !== action.stamp : false;
      actions.push({
        actionId: action._id,
        kind: action.kind,
        kindWords: ACTION_WORDS[action.kind],
        status: action.status,
        summary: action.summary,
        reason: action.reason,
        permission: { key: action.permission, label: def?.label ?? action.permission, money: def?.money ?? false, ownerOnly: action.permission === "retention.refund_above_limit" },
        authorization: action.authorization ?? null,
        message: action.message ? { channel: action.message.channel, subject: action.message.subject ?? null, body: action.message.body, hasLink: action.message.linkPurpose !== undefined } : null,
        delivery: message ? deliveryWords(message) : null,
        visit: action.visit ? { areas: action.visit.areas, scope: action.visit.scope, startsAt: action.visit.startsAt ?? null, minutes: action.visit.minutes, when: action.visit.startsAt ? whenWords(action.visit.startsAt, tz) : null, payBasisCents: action.visit.payBasisCents ?? null, payHintCents: action.visit.payHintCents ?? null, jobId: action.visit.jobId ?? null, avoiding: action.visit.avoidCleanerIds.length } : null,
        money: action.money ? { amountCents: action.money.amountCents, invoiceId: action.money.invoiceId ?? null } : null,
        planChange: action.planChange ? { change: action.planChange.change, words: CHANGE_WORDS[action.planChange.change], from: action.planChange.from ?? null, until: action.planChange.until ?? null, requestedBy: action.planChange.requestedBy, visits: action.planChange.shown.length } : null,
        estimatedCostCents: action.estimatedCostCents ?? null,
        costBasis: action.costBasis ?? null,
        actualCostCents: action.actualCostCents ?? null,
        approval: approval ? { approvalId: approval._id, status: approval.status, decideBy: approval.decideBy, carriedOut: approval.carriedOut ?? null } : null,
        handoff: action.handoff ? { to: action.handoff.to, toWords: WAITING_WORDS[action.handoff.to], expected: action.handoff.expected, status: action.handoff.status, result: action.handoff.result ?? null, returnedAt: action.handoff.returnedAt ?? null, taskId: action.handoff.taskId ?? null, jobId: action.handoff.jobId ?? null } : null,
        link: link ? { state: careLinkState(link, now), expiresAt: link.expiresAt, purpose: link.purpose } : null,
        stale,
        result: action.result ?? null,
        createdAt: action.createdAt,
        doneAt: action.doneAt ?? null,
      });
    }
    const job = row.jobId ? await ctx.db.get(row.jobId) : null;
    const evidence = row.kind === "recovery" || row.kind === "follow_through" ? await gatherEvidence(ctx, ctx.company, row) : null;
    const cost = evidence ? correctionCost(await originalVisit(ctx as unknown as MutationCtx, evidence), 60) : null;
    const tools = await ctx.db.query("toolRuns").withIndex("by_company_case", (q) => q.eq("companyId", ctx.companyId).eq("caseId", row._id)).order("desc").take(20);
    const agreement = row.agreementId ? await ctx.db.get(row.agreementId) : null;
    const since = agreement?.lifecycle.effectiveOn ? new Date(`${agreement.lifecycle.effectiveOn}T00:00:00Z`).getTime() : now - 365 * DAY;
    const owner = await conversationOwner(ctx, customer);
    const billing = isOwner(ctx.role) ? await openBilling(ctx, ctx.companyId, customer._id) : null;
    const invoices = [];
    if (billing) for (const id of billing.ids.slice(0, 10)) {
      const invoice = await ctx.db.get(id);
      if (invoice) invoices.push({ invoiceId: invoice._id, number: invoice.number ?? "", balanceCents: invoice.totals.balanceCents, jobId: invoice.jobId ?? null });
    }
    return {
      card: await card(ctx, row, now, cache),
      revision: row.revision,
      origin: row.origin,
      customerWords: row.customerWords ?? null,
      serious: row.serious ?? null,
      heldBy: row.heldBy ? { name: (await ctx.db.get(row.heldBy.memberId))?.name ?? "A person", since: row.heldBy.since, you: row.heldBy.memberId === ctx.member._id } : null,
      relationship: summary,
      site: summary.sites.find((s) => s.propertyId === row.propertyId) ?? null,
      service: job ? { jobId: job._id, service: job.serviceSnapshot?.name ?? job.serviceType, startsAt: job.startsAt, status: job.status, when: whenWords(job.startsAt, tz), isCorrection: job.recovery !== undefined } : null,
      scope: evidence?.job ? { included: evidence.job.included, excluded: evidence.job.excluded } : null,
      crew: evidence ? evidence.crew.map((c) => ({ cleanerId: c.cleanerId, name: c.name })) : [],
      guarantee: evidence?.guarantee ?? null,
      evidenceGaps: evidence?.missing ?? [],
      diagnosis: row.diagnosis ? { category: row.diagnosis.category, words: DIAGNOSIS_WORDS[row.diagnosis.category], basis: row.diagnosis.basis, reasons: row.diagnosis.reasons, uncertain: row.diagnosis.uncertain, reader: row.diagnosis.reader, at: row.diagnosis.at } : null,
      timeline,
      actions,
      verification: row.verification ?? null,
      costHint: cost,
      toolRuns: tools.map((run) => ({ id: run._id, tool: run.tool, words: TOOL_WORDS[run.tool as (typeof TOOL_NAMES)[number]] ?? run.tool, outcome: run.outcome, at: run.at, result: safeJson(run.result) })),
      review: row.kind === "renewal" ? await serviceReview(ctx, ctx.company, customer, since, now) : null,
      agreement: agreement ? renewalRow(agreement, localParts(now, tz).day, retentionSettings(ctx.company).renewalLeadDays) : null,
      conversation: owner.free ? null : owner.words,
      invoices: billing ? invoices : null,
      can: { manage: isManager(ctx.role), owner: isOwner(ctx.role) },
      outcomeChoices: OUTCOMES.filter((code) => code !== "customer_confirmed" || row.verification?.customerAnswer?.answer === "resolved").map((code) => ({ code, words: OUTCOME_WORDS[code] })),
    };
  },
});

function safeJson(value: string): { title: string; lines: string[] } {
  try {
    const parsed = JSON.parse(value) as { title?: unknown; lines?: unknown };
    return { title: typeof parsed.title === "string" ? parsed.title : "", lines: Array.isArray(parsed.lines) ? parsed.lines.map(String) : [] };
  } catch {
    return { title: "", lines: [] };
  }
}

/** Continuity and renewals: every recurring service and customer agreement, each with its own status. */
export const continuity = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const now = args.asOf;
    const tz = ctx.company.timezone;
    const today = localParts(now, tz).day;
    const lead = retentionSettings(ctx.company).renewalLeadDays;
    const open = await ctx.db.query("retentionSignals").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open")).take(300);
    const plans = [];
    const servicePlans = [];
    for (const state of ["active", "paused"] as const) servicePlans.push(...(await ctx.db.query("servicePlans").withIndex("by_company_state", (q) => q.eq("companyId", ctx.companyId).eq("state", state)).take(300)));
    const salesPlans = [];
    for (const status of ["active", "paused"] as const) salesPlans.push(...(await ctx.db.query("recurringPlans").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status)).take(300)));
    const refs = [...servicePlans.map((p) => ({ kind: "service" as const, id: p._id })), ...salesPlans.map((p) => ({ kind: "sales" as const, id: p._id }))];
    for (const ref of refs) {
      const plan = await loadPlan(ctx, ctx.companyId, ref);
      if (!plan) continue;
      const customer = await ctx.db.get(plan.customerId);
      const property = await ctx.db.get(plan.propertyId);
      if (!customer || customer.status !== "active") continue;
      const next = (await ctx.db.query("jobs").withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", plan.propertyId).gte("startsAt", now)).take(10)).find((job) => job.status === "scheduled");
      const mismatches = open.filter((s) => s.plan?.id === ref.id).map((s) => ({ signalId: s._id, kindWords: SIGNAL_WORDS[s.kind], what: s.what, priority: s.priority }));
      const pausedNow = plan.state === "paused" || (plan.pausedFrom !== null && plan.pausedFrom <= today && (!plan.pausedUntil || today < plan.pausedUntil));
      plans.push({
        plan: ref,
        customerId: plan.customerId,
        customer: customer.name,
        property: propertyName(property),
        recurring: plan.recurring,
        cadence: plan.cadence,
        service: pausedNow ? `Paused${plan.pausedUntil ? ` until ${plan.pausedUntil}` : " until resumed"}` : plan.recurring ? "Running" : "Standing arrangement",
        servicePaused: pausedNow,
        // Billing is stated separately from service, always.
        billing: plan.billing === "monthly_consolidated" ? "Billed monthly for completed visits. Not paused by a service pause." : "Billed per visit, after it happens. Not paused by a service pause.",
        nextVisitAt: next?.startsAt ?? null,
        nextVisit: next ? whenWords(next.startsAt, tz) : plan.recurring ? (pausedNow ? "None while paused" : "None booked") : "Booked one by one",
        mismatches,
      });
    }
    plans.sort((a, b) => b.mismatches.length - a.mismatches.length || a.customer.localeCompare(b.customer));
    const agreements = await ctx.db.query("agreements").withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(300);
    const renewals = [];
    for (const agreement of agreements) {
      if (agreement.category !== "customer" || agreement.archivedAt || agreement.access === "restricted") continue;
      const row = renewalRow(agreement, today, lead);
      if (row.status !== "renewal_due" && row.status !== "in_force") continue;
      if (!row.target) continue;
      const party = agreement.parties.find((p) => p.record?.table === "customers");
      const customerId = party?.record ? ctx.db.normalizeId("customers", party.record.id) : null;
      const linked = await ctx.db.query("retentionCases").withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("key", `renewal:${agreement._id}:${row.target}`)).first();
      renewals.push({ ...row, customer: party?.name ?? "", customerId, due: row.status === "renewal_due", caseId: linked?._id ?? null, caseStatus: linked ? STATUS_WORDS[linked.status] : null });
    }
    renewals.sort((a, b) => (a.noticeBy ?? a.target ?? "9").localeCompare(b.noticeBy ?? b.target ?? "9"));
    return { plans, renewals, missing: MISSING_DATA.filter((m) => m.key === "memberships" || m.key === "reservations") };
  },
});

export const reengagement = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => ({ candidates: await reactivationCandidates(ctx, ctx.company, args.asOf), rule: "A customer is listed when a person marked the relationship former, or their recurring service ended and nothing is booked. Nobody is listed only because time has passed." }),
});

export const outcomes = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => measures(ctx, ctx.company, args.asOf, { money: isOwner(ctx.role) }),
});

/** The working inbox connected for Care & Retention, if there is one. */
async function careInboxAddress(ctx: { db: QueryCtx["db"]; companyId: Id<"companies"> }): Promise<string | null> {
  const rows = await ctx.db
    .query("mailboxConnections")
    .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
    .take(20);
  return rows.find((row) => row.status === "connected" && purposesOf(row).includes("care"))?.address ?? null;
}

export const settings = companyQuery({
  args: {},
  handler: async (ctx) => ({ settings: retentionSettings(ctx.company), careInbox: await careInboxAddress(ctx), set: { guarantee: ctx.company.retention?.guarantee !== undefined, reviewUrl: ctx.company.retention?.reviewUrl !== undefined }, changes: PLAN_CHANGES.filter((c) => c !== "pause_billing").map((c) => ({ id: c, words: CHANGE_WORDS[c] })), canEdit: isOwner(ctx.role), readiness: await readiness(ctx), missing: MISSING_DATA }),
});

/** What a plan change would do, before anything is changed. Amounts due are shown to the Owner only. */
export const planPreview = companyQuery({
  args: { plan: planRefValidator, change: literals(PLAN_CHANGES), from: v.optional(v.string()), until: v.optional(v.string()), jobId: v.optional(v.id("jobs")), cadence: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const plan = await loadPlan(ctx, ctx.companyId, args.plan);
    if (!plan) return null;
    return previewPlanChange(ctx, ctx.company, plan, args, isOwner(ctx.role));
  },
});

/** The customers, properties and recent visits a person can open a case about. */
export const caseSources = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const properties = await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).take(100);
    const jobs = await ctx.db.query("jobs").withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).order("desc").take(30);
    return {
      customer: customer.name,
      properties: properties.filter((p) => p.status === "active").map((p) => ({ id: p._id, name: propertyName(p) })),
      visits: jobs.filter((j) => j.status === "completed" || j.status === "in_progress").map((j) => ({ id: j._id, propertyId: j.propertyId, label: `${j.serviceSnapshot?.name ?? j.serviceType} · ${whenWords(j.startsAt, ctx.company.timezone)}` })),
    };
  },
});

// ── Writes ───────────────────────────────────────────────────────────────────────────────────────

async function liveCase(ctx: MutationCtx & MemberAccess, caseId: Id<"retentionCases">): Promise<Case> {
  const row = await owned(ctx, caseId);
  if (row.status === "closed") throw userError("This case is closed.");
  return row;
}

/** A person opens a case from a conversation, an inspection or a report. It is linked to the service it is about. */
export const openCase = companyMutation({
  args: { customerId: v.id("customers"), propertyId: v.optional(v.id("properties")), jobId: v.optional(v.id("jobs")), description: v.string(), areas: v.optional(v.array(v.string())), origin: v.union(v.literal("conversation"), v.literal("inspection"), v.literal("staff")), wantsDifferentCleaner: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const job = args.jobId ? await owned(ctx, args.jobId) : null;
    if (job && job.customerId !== customer._id) throw userError("That visit belongs to a different customer.");
    const property = args.propertyId ? await owned(ctx, args.propertyId) : job ? await ctx.db.get(job.propertyId) : null;
    if (property && property.customerId !== customer._id) throw userError("That property belongs to a different customer.");
    const words = text(args.description, "What the customer reported", 2000);
    const opened = await openRecovery(ctx, ctx.company, { customer, property, job, words, areas: cleanAreas(args.areas ?? areasIn(words)), origin: args.origin, wantsDifferentCleaner: args.wantsDifferentCleaner, actor: byMember(ctx) });
    return { caseId: opened.row._id, created: opened.created };
  },
});

/** Asks for feedback on one visit a person chose. Routine visits are not surveyed unless someone asks. */
export const requestFeedback = managerMutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "completed") throw userError("Feedback is asked about a completed visit.");
    const customer = (await ctx.db.get(job.customerId))!;
    const property = await ctx.db.get(job.propertyId);
    const channel = await careChannel(ctx, customer);
    if (!channel) throw userError("There is no phone or email on file for this customer.");
    const opened = await openCaseRecord(ctx, { companyId: ctx.companyId, kind: "follow_through", key: `feedback:${job._id}`, status: "action_underway", customer, property, jobId: job._id, title: `${customer.name}: feedback on ${localParts(job.startsAt, ctx.company.timezone).day}`, happened: `A person asked for feedback on the ${job.serviceSnapshot?.name ?? job.serviceType} on ${localParts(job.startsAt, ctx.company.timezone).day}.`, doing: "Asking how the service went.", origin: "staff", dueAt: Date.now() + retentionSettings(ctx.company).linkDays * DAY, actor: byMember(ctx) });
    if (!opened.created) return { caseId: opened.row._id, status: "already" as const };
    const action = await prepareAction(ctx, opened.row, { kind: "request_feedback", key: "feedback-1", summary: `Ask ${customer.name} how the service went`, reason: "A person asked for feedback on this visit.", permission: "retention.request_feedback", message: { channel, subject: channel === "email" ? "How did we do?" : undefined, body: `Hi ${customer.name.split(/\s+/)[0]}, how did your recent service go? It takes a minute, and if anything was not right you can tell us there: {link} - ${ctx.company.name}`, linkPurpose: "feedback" }, actor: byMember(ctx) });
    const routed = await submitAction(ctx, ctx.company, action._id, byMember(ctx));
    return { caseId: opened.row._id, status: routed.status };
  },
});

/** A person's own reading of what kind of problem this is. It stands over the rules' and any model's. */
export const setDiagnosis = managerMutation({
  args: { caseId: v.id("retentionCases"), category: literals(DIAGNOSES), note: v.string() },
  handler: async (ctx, args) => {
    const row = await liveCase(ctx, args.caseId);
    const note = text(args.note, "Why", 600);
    const moved = await moveCase(ctx, row, { diagnosis: { category: args.category, basis: "fact", reasons: [note], uncertain: [], by: byMember(ctx), reader: "person", at: Date.now() } }, byMember(ctx));
    await addEntry(ctx, moved, { kind: "diagnosis", text: `${DIAGNOSIS_WORDS[args.category]}, decided by a person: ${note}`, actor: byMember(ctx) });
    // A changed reading changes what should be proposed. Unsent drafts built on the old one are set aside.
    for (const action of await actionsOf(ctx, moved)) if (action.status === "proposed") await ctx.db.patch(action._id, { status: "cancelled", result: "The diagnosis changed.", updatedAt: Date.now(), doneAt: Date.now() });
    if (args.category !== "serious_incident") await planRecovery(ctx, ctx.company, (await ctx.db.get(moved._id))!);
    return null;
  },
});

/** A person proposes a remedy. It is routed by the Owner's authority like any other; proposing is not approving. */
export const proposeRemedy = managerMutation({
  args: {
    caseId: v.id("retentionCases"),
    kind: literals(ACTION_KINDS),
    reason: v.string(),
    startsAt: v.optional(v.number()),
    minutes: v.optional(v.number()),
    scope: v.optional(v.union(v.literal("targeted"), v.literal("full"))),
    areas: v.optional(v.array(v.string())),
    avoidCleanerIds: v.optional(v.array(v.id("cleaners"))),
    amountCents: v.optional(v.number()),
    /** A correction visit's pay basis. Only the Owner sets it (see setCorrectionPay). */
    payBasisCents: v.optional(v.number()),
    invoiceId: v.optional(v.id("invoices")),
    body: v.optional(v.string()),
    askCustomerFirst: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await liveCase(ctx, args.caseId);
    const customer = (await ctx.db.get(row.customerId))!;
    const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
    const reason = text(args.reason, "The reason", 800);
    const tz = ctx.company.timezone;
    const actor = byMember(ctx);
    const count = (await actionsOf(ctx, row)).length;
    const key = `manual-${args.kind}-${count + 1}`;
    if (args.kind === "correction_visit") {
      if (!property) throw userError("This case has no property to send a crew to.");
      const evidence = await gatherEvidence(ctx, ctx.company, row);
      const minutes = args.minutes ?? (args.scope === "full" ? (evidence.job?.durationMinutes ?? 120) : 60);
      if (!Number.isInteger(minutes) || minutes < 15 || minutes > 600) throw userError("The visit is from 15 minutes to 10 hours.");
      if (args.startsAt === undefined || args.startsAt <= Date.now()) throw userError("Choose a time in the future for the visit.");
      const cost = correctionCost(await originalVisit(ctx, evidence), minutes);
      const areas = cleanAreas(args.areas ?? row.areas);
      const action = await prepareAction(ctx, row, { kind: "correction_visit", key, summary: `Correction visit for ${areas.join(", ") || "the reported work"} at ${propertyName(property)}, ${whenWords(args.startsAt, tz)}`, reason, permission: "retention.remedy_within_limit", visit: { areas, scope: args.scope ?? "targeted", startsAt: args.startsAt, endsAt: args.startsAt + minutes * 60_000, minutes, crew: 1, payHintCents: cost.payHintCents, avoidCleanerIds: args.avoidCleanerIds ?? [] }, estimatedCostCents: cost.estimateCents ?? undefined, costBasis: cost.basis, dueAt: row.dueAt, actor });
      const pay = args.payBasisCents;
      if (pay !== undefined && !isOwner(ctx.role)) throw userError("Only the Owner sets what the crew is paid for a correction visit.");
      if (pay !== undefined && (!Number.isInteger(pay) || pay < 0 || pay > 500_000)) throw userError("Enter an amount from $0 to $5,000.");
      if (args.askCustomerFirst) {
        const offered = await offerToCustomer(ctx, row, customer, action, `we would like to come back on ${whenWords(args.startsAt, tz)} to take care of ${areas.join(", ") || "it"}, at no charge`);
        if (pay !== undefined) await setCorrectionPayOn(ctx, ctx.company, action._id, pay, ctx.member._id, false);
        return offered;
      }
      if (pay !== undefined) return { actionId: action._id, ...(await setCorrectionPayOn(ctx, ctx.company, action._id, pay, ctx.member._id)) };
      return { actionId: action._id, ...(await submitAction(ctx, ctx.company, action._id, actor)) };
    }
    if (args.kind === "credit" || args.kind === "refund") {
      const amount = args.amountCents ?? 0;
      if (!Number.isInteger(amount) || amount <= 0) throw userError("Enter the amount.");
      const invoice = args.invoiceId ? await owned(ctx, args.invoiceId) : null;
      if (invoice && invoice.customerId !== customer._id) throw userError("That invoice belongs to a different customer.");
      // A refund is always the Owner's. A credit follows the Owner's limit for remedies.
      const action = await prepareAction(ctx, row, { kind: args.kind, key, summary: `${args.kind === "refund" ? "Refund" : "Credit"} ${money(amount)} to ${customer.name}`, reason, permission: args.kind === "refund" ? "retention.refund_above_limit" : "retention.remedy_within_limit", money: { invoiceId: invoice?._id, amountCents: amount }, estimatedCostCents: amount, costBasis: `${money(amount)} the company gives up.`, actor });
      return { actionId: action._id, ...(await submitAction(ctx, ctx.company, action._id, actor)) };
    }
    if (args.kind === "scope_clarification" || args.kind === "message") {
      const channel = await careChannel(ctx, customer);
      if (!channel) throw userError("There is no phone or email on file for this customer.");
      const body = text(args.body ?? "", "The message", 1200);
      const action = await prepareAction(ctx, row, { kind: args.kind, key, summary: `${args.kind === "message" ? "Message" : "Scope explanation"} to ${customer.name}`, reason, permission: "retention.send_case_message", message: { channel, subject: channel === "email" ? "About your recent service" : undefined, body }, actor });
      return { actionId: action._id, ...(await submitAction(ctx, ctx.company, action._id, actor)) };
    }
    if (args.kind === "inspection" || args.kind === "dispatch_review" || args.kind === "billing_review" || args.kind === "renewal_proposal") {
      const summary = args.kind === "inspection" ? `Inspect ${row.areas.join(", ") || "the reported work"} at ${propertyName(property)}` : args.kind === "dispatch_review" ? `Dispatch: ${reason.slice(0, 120)}` : args.kind === "billing_review" ? `Review the charge ${customer.name} is questioning` : `Prepare a renewal or scope-adjustment proposal for ${customer.name}`;
      const action = await prepareAction(ctx, row, { kind: args.kind, key, summary, reason, permission: "retention.hand_off", dueAt: row.dueAt, actor });
      return { actionId: action._id, ...(await submitAction(ctx, ctx.company, action._id, actor)) };
    }
    if (args.kind === "different_cleaner") {
      const avoid = args.avoidCleanerIds ?? [];
      if (!avoid.length) throw userError("Choose which cleaner the customer asked not to have back.");
      const action = await prepareAction(ctx, row, { kind: "different_cleaner", key, summary: `Do not send the named cleaner to ${propertyName(property)} again`, reason: `${reason} This changes who Dispatch offers the property's visits to. It changes nothing about anyone's pay or standing.`, permission: "retention.hand_off", visit: { areas: [], scope: "targeted", minutes: 0, crew: 1, avoidCleanerIds: avoid }, actor });
      return { actionId: action._id, ...(await submitAction(ctx, ctx.company, action._id, actor)) };
    }
    throw userError("That is not a remedy a person proposes here.");
  },
});

/** Sends the customer a private page to review a proposed remedy. Nothing is booked until they accept and it is approved. */
async function offerToCustomer(ctx: MutationCtx & MemberAccess, row: Case, customer: Doc<"customers">, remedy: Doc<"retentionActions">, offer: string) {
  const channel = await careChannel(ctx, customer);
  if (!channel) throw userError("There is no phone or email on file for this customer.");
  const message = await prepareAction(ctx, row, { kind: "message", key: `offer:${remedy._id}`, summary: `Ask ${customer.name} whether the proposed remedy suits them`, reason: "The customer reviews the remedy before it is booked.", permission: "retention.send_case_message", message: { channel, subject: channel === "email" ? "How we would like to put it right" : undefined, body: `Hi ${customer.name.split(/\s+/)[0]}, about your recent service: ${offer}. You can review it and tell us yes or no here: {link} - ${ctx.company.name}`, linkPurpose: "remedy", aboutActionId: remedy._id }, actor: byMember(ctx) });
  const routed = await submitAction(ctx, ctx.company, message._id, byMember(ctx));
  return { actionId: remedy._id, status: routed.status, detail: routed.status === "awaiting_approval" ? "The message to the customer is waiting for approval." : "The customer has been sent the remedy to review. Nothing is booked until they accept." };
}

/** Sends a prepared action where the Owner's settings say it goes. */
export const submit = managerMutation({
  args: { actionId: v.id("retentionActions"), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const action = await owned(ctx, args.actionId);
    const row = await liveCase(ctx, action.caseId);
    if (action.status !== "proposed") throw userError(`This was already ${action.status.replace(/_/g, " ")}.`);
    if (args.body !== undefined && action.message) {
      // A person's edit is the message. It is stamped again so approval is of exactly these words.
      const message = { ...action.message, body: text(args.body, "The message", 1200) };
      await ctx.db.patch(action._id, { message, updatedAt: Date.now() });
    }
    const fresh = (await ctx.db.get(action._id))!;
    await ctx.db.patch(action._id, { stamp: await stampFor(ctx, row, fresh), preparedAt: Date.now() });
    return submitAction(ctx, ctx.company, action._id, byMember(ctx));
  },
});

/**
 * The Owner sets what the crew's pay is worked out from for one correction visit, and books it. Each
 * correction is decided on its own: no figure carries over, and nothing sets one automatically.
 */
export const setCorrectionPay = ownerMutation({
  args: { actionId: v.id("retentionActions"), payBasisCents: v.number() },
  handler: async (ctx, args) => {
    const action = await owned(ctx, args.actionId);
    await liveCase(ctx, action.caseId);
    if (action.kind !== "correction_visit" || !action.visit) throw userError("Only a correction visit has crew pay to set.");
    if (action.status !== "proposed") throw userError(`This was already ${action.status.replace(/_/g, " ")}.`);
    if (!Number.isInteger(args.payBasisCents) || args.payBasisCents < 0 || args.payBasisCents > 500_000) throw userError("Enter an amount from $0 to $5,000.");
    return setCorrectionPayOn(ctx, ctx.company, action._id, args.payBasisCents, ctx.member._id);
  },
});

export const discard = managerMutation({
  args: { actionId: v.id("retentionActions"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const action = await owned(ctx, args.actionId);
    if (action.status !== "proposed" && action.status !== "blocked") throw userError("Only a prepared action that has not gone anywhere can be set aside. Decide a pending one in Approvals.");
    await ctx.db.patch(action._id, { status: "cancelled", result: optionalText(args.reason, "The reason", 300) ?? "Set aside by a person.", updatedAt: Date.now(), doneAt: Date.now() });
    const row = await ctx.db.get(action.caseId);
    if (row) await addEntry(ctx, row, { kind: "action", text: `Set aside: ${action.summary}`, actor: byMember(ctx) });
    return null;
  },
});

/** A person takes the case. The agent prepares nothing for the customer, and its unsent messages are withdrawn. */
export const takeOver = companyMutation({
  args: { caseId: v.id("retentionCases") },
  handler: async (ctx, args) => {
    const row = await liveCase(ctx, args.caseId);
    if (row.heldBy) throw userError("A person already has this case.");
    const moved = await moveCase(ctx, row, { heldBy: { memberId: ctx.member._id, since: Date.now() }, ownerId: ctx.member._id }, byMember(ctx));
    await addEntry(ctx, moved, { kind: "note", text: `${ctx.member.name} took this case over. Retention sends nothing to the customer until it is handed back.`, actor: byMember(ctx) });
    for (const action of await actionsOf(ctx, moved)) {
      if (!action.message || action.createdBy.kind !== "agent") continue;
      if (action.status === "proposed") await ctx.db.patch(action._id, { status: "cancelled", result: "A person took the case over.", updatedAt: Date.now(), doneAt: Date.now() });
      const message = action.messageId ? await ctx.db.get(action.messageId) : null;
      if (action.status === "underway" && message && (message.status === "queued" || message.status === "held")) {
        await ctx.db.patch(message._id, { status: "not_sent", problem: "A person took over the case before it went out.", refusal: "case_taken_over" });
        await ctx.db.patch(action._id, { status: "cancelled", result: "A person took the case over before it went out.", updatedAt: Date.now(), doneAt: Date.now() });
      }
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "retention_case.taken_over", actor: byMember(ctx), subject: { table: "retentionCases", id: row._id } });
    return null;
  },
});

export const handBack = companyMutation({
  args: { caseId: v.id("retentionCases") },
  handler: async (ctx, args) => {
    const row = await liveCase(ctx, args.caseId);
    if (!row.heldBy) throw userError("Nobody is holding this case.");
    if (row.heldBy.memberId !== ctx.member._id && !isManager(ctx.role)) throw userError("Only the person holding it, an Owner or a Manager can hand it back.");
    if (row.serious) throw userError("A serious concern stays with a person. Close it with what happened when it is settled.");
    const moved = await moveCase(ctx, row, { clearHeld: true }, byMember(ctx));
    await addEntry(ctx, moved, { kind: "note", text: `${ctx.member.name} handed this case back to Retention.`, actor: byMember(ctx) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "retention_case.handed_back", actor: byMember(ctx), subject: { table: "retentionCases", id: row._id } });
    return null;
  },
});

export const addNote = companyMutation({
  args: { caseId: v.id("retentionCases"), body: v.string() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.caseId);
    await addEntry(ctx, row, { kind: "note", text: text(args.body, "The note", 1000), actor: byMember(ctx) });
    return null;
  },
});

/** What the customer told a person about a correction, when they answered by phone instead of their link. */
export const recordAnswer = companyMutation({
  args: { caseId: v.id("retentionCases"), answer: v.union(v.literal("resolved"), v.literal("not_resolved")), note: v.string() },
  handler: async (ctx, args) => {
    const row = await liveCase(ctx, args.caseId);
    const note = text(args.note, "How you know", 600);
    await customerAnswered(ctx, row, args.answer, `Recorded by ${ctx.member.name}: ${note}`, byMember(ctx));
    return null;
  },
});

/** Closes a case with what actually happened. "Customer confirmed" needs the customer's answer on record. */
export const close = managerMutation({
  args: { caseId: v.id("retentionCases"), outcome: literals(OUTCOMES), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await liveCase(ctx, args.caseId);
    if (args.outcome === "customer_confirmed" && row.verification?.customerAnswer?.answer !== "resolved") throw userError("There is no answer from the customer on record. Record what they told you first, or choose the outcome that describes what is actually known.");
    if (args.outcome === "contract_renewed" && row.kind !== "renewal") throw userError("That outcome is for a renewal case.");
    const note = optionalText(args.note, "The note", 600);
    if ((args.outcome === "unknown" || args.outcome === "handled_by_person" || args.outcome === "no_action_needed") && !note) throw userError("Say what happened, so the case can be understood later.");
    for (const action of await actionsOf(ctx, row)) if (action.status === "awaiting_approval") throw userError("A step is waiting in Approvals. Decide it first.");
    await closeCase(ctx, row, args.outcome, byMember(ctx), note);
    return null;
  },
});

export const dismissSignal = managerMutation({
  args: { signalId: v.id("retentionSignals"), reason: v.string() },
  handler: async (ctx, args) => {
    const signal = await owned(ctx, args.signalId);
    if (signal.status !== "open") throw userError("This is already being handled or was dismissed.");
    await ctx.db.patch(signal._id, { status: "dismissed", dismissed: { by: ctx.member._id, at: Date.now(), reason: text(args.reason, "The reason", 400) } });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "retention_signal.dismissed", actor: byMember(ctx), subject: { table: "retentionSignals", id: signal._id }, data: { kind: signal.kind } });
    return null;
  },
});

/** Turns a signal into a case a person will follow through. */
export const caseFromSignal = managerMutation({
  args: { signalId: v.id("retentionSignals") },
  handler: async (ctx, args) => {
    const signal = await owned(ctx, args.signalId);
    if (signal.status === "in_case" && signal.caseId) return { caseId: signal.caseId };
    if (signal.status !== "open") throw userError("This signal was dismissed or has cleared.");
    const customer = (await ctx.db.get(signal.customerId))!;
    const property = signal.propertyId ? await ctx.db.get(signal.propertyId) : null;
    if (signal.kind === "renewal_approaching" && signal.agreementId) {
      const agreement = await owned(ctx, signal.agreementId);
      const row = await prepareRenewal(ctx, ctx.company, agreement, byMember(ctx));
      if (!row) throw userError("That agreement is not linked to a customer record.");
      await attachSignal(ctx, signal, row._id);
      return { caseId: row._id };
    }
    const kind = signal.kind === "repeat_complaint" || signal.kind === "readiness_at_risk" || signal.kind === "company_cancellation" ? ("recovery" as const) : ("continuity" as const);
    const opened = await openCaseRecord(ctx, { companyId: ctx.companyId, kind, key: `signal:${signal._id}`, status: signal.missing.length ? "needs_context" : "needs_attention", customer, property, plan: signal.plan, agreementId: signal.agreementId, title: `${customer.name}: ${SIGNAL_WORDS[signal.kind].toLowerCase()}`, happened: signal.what, doing: "Waiting for a person to decide the next step.", needs: signal.suggestedAction, origin: "signal", dueAt: signal.deadlineAt ?? Date.now() + retentionSettings(ctx.company).recoveryDueHours * HOUR, actor: byMember(ctx) });
    await addEntry(ctx, opened.row, { kind: "evidence", basis: signal.basis, text: signal.what, source: signal.source, actor: byMember(ctx) });
    for (const gap of signal.missing) await addEntry(ctx, opened.row, { kind: "note", text: `Not known: ${gap}`, actor: byMember(ctx) });
    await attachSignal(ctx, signal, opened.row._id);
    return { caseId: opened.row._id };
  },
});

/** The office changes a plan, against exactly the preview the person saw. */
export const requestChange = managerMutation({
  args: { plan: planRefValidator, change: literals(PLAN_CHANGES), from: v.optional(v.string()), until: v.optional(v.string()), jobId: v.optional(v.id("jobs")), cadence: v.optional(v.string()), preferred: v.optional(v.string()), shown: v.array(v.id("jobs")), reason: v.optional(v.string()) },
  handler: async (ctx, args) => requestPlanChange(ctx, ctx.company, { ...args, reason: optionalText(args.reason, "The reason", 500), requestedBy: "staff", actor: byMember(ctx) }),
});

export const prepareReturnOffer = managerMutation({
  args: { customerId: v.id("customers"), body: v.string(), reason: v.string() },
  handler: async (ctx, args) => prepareReturn(ctx, ctx.company, await owned(ctx, args.customerId), { body: args.body, reason: args.reason, actor: byMember(ctx) }),
});

/** Makes a private link for a customer to manage their plan, give feedback or describe an issue, for a person to pass on. */
export const shareLink = managerMutation({
  args: { customerId: v.id("customers"), purpose: v.union(v.literal("manage"), v.literal("issue"), v.literal("feedback")), plan: v.optional(planRefValidator), jobId: v.optional(v.id("jobs")) },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    let propertyId: Id<"properties"> | undefined;
    if (args.purpose === "manage") {
      if (!args.plan) throw userError("Choose the plan the customer will manage.");
      const plan = await loadPlan(ctx, ctx.companyId, args.plan);
      if (!plan || plan.customerId !== customer._id) throw userError("That plan belongs to a different customer.");
      propertyId = plan.propertyId;
    } else {
      if (!args.jobId) throw userError("Choose the visit this is about.");
      const job = await owned(ctx, args.jobId);
      if (job.customerId !== customer._id) throw userError("That visit belongs to a different customer.");
      propertyId = job.propertyId;
    }
    const settings = retentionSettings(ctx.company);
    const link = await issueCareLink(ctx, { companyId: ctx.companyId, purpose: args.purpose, customerId: customer._id, propertyId, jobId: args.jobId, plan: args.plan, allowed: args.purpose === "manage" ? [...settings.selfService, "request_different_cleaner"] : undefined, days: settings.linkDays, actor: byMember(ctx) });
    const url = await careLinkUrl(link);
    if (!url) {
      await revokeCareLink(ctx, link, "Links are not set up.", byMember(ctx));
      throw userError("Customer links are not set up on this deployment yet.");
    }
    return { url, expiresAt: link.expiresAt, linkId: link._id };
  },
});

export const revokeLink = managerMutation({
  args: { linkId: v.id("retentionLinks"), reason: v.string() },
  handler: async (ctx, args) => {
    await revokeCareLink(ctx, await owned(ctx, args.linkId), text(args.reason, "The reason", 200), byMember(ctx));
    return null;
  },
});

/** One of Retention's tools, run on a case from its own buttons. Every use is kept with its result. */
export const runTool = companyMutation({
  args: { caseId: v.id("retentionCases"), tool: literals(TOOL_NAMES), key: v.string() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.caseId);
    if (!/^[\w-]{8,80}$/.test(args.key)) throw userError("Reload the page and try again.");
    const idempotencyKey = `retention:${row._id}:${args.tool}:${args.key}`;
    const existing = await ctx.db.query("toolRuns").withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("idempotencyKey", idempotencyKey)).first();
    if (existing) return { ...safeJson(existing.result), outcome: existing.outcome, repeated: true };
    // Preparing a plan or a draft changes the case; Office may read and draft, and a Manager submits.
    const result = await runCaseTool(ctx, ctx.company, row, args.tool, byMember(ctx));
    await ctx.db.insert("toolRuns", { companyId: ctx.companyId, tool: args.tool, idempotencyKey, actor: byMember(ctx), authorization: result.authorization, input: JSON.stringify({ caseId: row._id }), outcome: result.outcome, result: JSON.stringify({ title: result.title, lines: result.lines, data: result.data }).slice(0, 12_000), caseId: row._id, jobId: row.jobId, at: Date.now() });
    await addEntry(ctx, row, { kind: "agent", text: `${result.title}: ${result.lines[0] ?? ""}`.slice(0, 600), actor: byMember(ctx) });
    return { title: result.title, lines: result.lines, outcome: result.outcome, repeated: false };
  },
});

export const saveSettings = ownerMutation({
  args: { settings: retentionSettingsValidator, clear: v.optional(v.array(v.union(v.literal("guarantee"), v.literal("reviewUrl")))) },
  handler: async (ctx, args) => {
    const next = { ...(ctx.company.retention ?? {}), ...checkedSettings(args.settings) };
    for (const key of args.clear ?? []) delete next[key];
    await ctx.db.patch(ctx.companyId, { retention: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "retention.settings_changed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { changed: [...Object.keys(args.settings), ...(args.clear ?? [])].join(", ") } });
    return null;
  },
});

/** Reads the records again now, instead of waiting for the next scheduled reconciliation. */
export const reconcileNow = managerMutation({
  args: {},
  handler: async (ctx) => {
    if (ctx.company.pausedAgents.includes("retention")) throw userError("Retention is paused, so it reads nothing. Resume it first.");
    await enqueueRun(ctx, { companyId: ctx.companyId, kind: "reconcile", key: `reconcile:now:${Date.now()}` });
    return null;
  },
});
