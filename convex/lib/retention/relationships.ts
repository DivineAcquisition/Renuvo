/**
 * Relationships at the right level, and the two workflows that work at account level: renewals for
 * commercial and office accounts, and selective re-engagement of former customers.
 *
 * An account can hold several properties, agreements and services. Six things are kept apart and never
 * folded into one word: the account's relationship status, each property's service health, each plan's
 * status, each contract's renewal status, open recovery cases, and repeat-purchase opportunities. A
 * customer with one paused property and two active ones is an active customer with one paused property.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { addDays, lifecycleStatus } from "../agreements/store";
import { localParts } from "../availability";
import { contactsOf, relationshipOf, RELATIONSHIP_WORDS } from "../clients/directory";
import type { Actor } from "../events";
import { cadenceLabel } from "../sales/cadence";
import { versionFor, versionsOf } from "../sales/plans";
import { careChannel, prepareAction, submitAction } from "./actions";
import { addEntry, DAY, KIND_WORDS, moveCase, NO_KNOWN_ISSUES, openCase, openCasesFor, propertyName, recurringPlansAt, RETENTION, segmentFor, SEGMENT_WORDS, STATUS_WORDS, SYSTEM } from "./cases";
import { canReach } from "./outbox";
import { agreementCustomer } from "./reconcile";
import { retentionSettings } from "./settings";
import type { CaseStatus, PlanRef, Segment } from "./schema";

type Ctx = QueryCtx | MutationCtx;

const ORDER: CaseStatus[] = ["needs_attention", "needs_context", "action_underway", "waiting_on_customer", "monitoring", "closed"];
/** The most pressing state among open cases, or "No known open issues". Never a statement about satisfaction. */
export function healthOf(cases: Pick<Doc<"retentionCases">, "status">[]): { status: CaseStatus | "none"; words: string } {
  const open = cases.filter((row) => row.status !== "closed");
  if (!open.length) return { status: "none", words: NO_KNOWN_ISSUES };
  const worst = ORDER.find((status) => open.some((row) => row.status === status))!;
  return { status: worst, words: STATUS_WORDS[worst] };
}

const SERVICE_CADENCE: Record<string, string> = { every_7_days: "Every week", every_14_days: "Every 2 weeks", every_28_days: "Every 4 weeks", twice_per_month: "Twice a month", once_per_month: "Once a month" };

export type PlanSummary = { ref: PlanRef; state: "setup" | "active" | "paused" | "ended"; words: string; cadence: string; kind: "recurring" | "standing"; pausedUntil: string | null; next: number | null };

async function nextVisit(ctx: Ctx, companyId: Id<"companies">, propertyId: Id<"properties">, now: number): Promise<Doc<"jobs"> | null> {
  const rows = await ctx.db
    .query("jobs")
    .withIndex("by_company_property_start", (q) => q.eq("companyId", companyId).eq("propertyId", propertyId).gte("startsAt", now))
    .take(20);
  return rows.find((job) => job.status === "scheduled") ?? null;
}

async function lastCompleted(ctx: Ctx, companyId: Id<"companies">, propertyId: Id<"properties">, now: number): Promise<Doc<"jobs"> | null> {
  const rows = await ctx.db
    .query("jobs")
    .withIndex("by_company_property_start", (q) => q.eq("companyId", companyId).eq("propertyId", propertyId).lte("startsAt", now))
    .order("desc")
    .take(30);
  return rows.find((job) => job.status === "completed" && !job.recovery) ?? null;
}

/** One account as its separate parts. Read for the case view, the continuity tab and Chat. */
export async function relationshipSummary(ctx: Ctx, company: Doc<"companies">, customer: Doc<"customers">, now = Date.now()) {
  const companyId = company._id;
  const tz = company.timezone;
  const today = localParts(now, tz).day;
  const properties = (
    await ctx.db
      .query("properties")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id))
      .take(200)
  ).filter((p) => p.status === "active");
  const cases = await openCasesFor(ctx, companyId, customer._id);
  const plans = await recurringPlansAt(ctx, companyId, customer._id);
  const sites = [];
  for (const property of properties) {
    const own = cases.filter((row) => row.propertyId === property._id);
    const next = await nextVisit(ctx, companyId, property._id, now);
    const last = await lastCompleted(ctx, companyId, property._id, now);
    const sitePlans: PlanSummary[] = [];
    for (const plan of plans.service.filter((p) => p.propertyId === property._id && p.state !== "ended")) {
      sitePlans.push({ ref: { kind: "service", id: plan._id }, state: plan.state, kind: plan.kind, cadence: plan.cadence ? (SERVICE_CADENCE[plan.cadence] ?? plan.cadence) : "Booked one by one", pausedUntil: plan.pausedUntil ?? null, next: next?.planId === plan._id ? next.startsAt : null, words: plan.kind === "standing" ? "Standing arrangement: turnovers are booked one by one" : plan.state === "paused" || (plan.pausedFrom && plan.pausedFrom <= today && (!plan.pausedUntil || today < plan.pausedUntil)) ? `Service paused${plan.pausedUntil ? ` until ${plan.pausedUntil}` : ""}` : plan.state === "setup" ? "Being set up" : "Running" });
    }
    for (const plan of plans.sales.filter((p) => p.propertyId === property._id && p.status !== "ended")) {
      const version = versionFor(await versionsOf(ctx, plan._id), today);
      sitePlans.push({ ref: { kind: "sales", id: plan._id }, state: plan.status === "pending" ? "setup" : plan.status, kind: "recurring", cadence: version ? cadenceLabel(version.cadence) : "Not set", pausedUntil: plan.pause?.until ?? null, next: null, words: plan.status === "paused" || plan.pause ? `Service paused${plan.pause?.until ? ` until ${plan.pause.until}` : ""}` : plan.status === "pending" ? "Being set up" : "Running" });
    }
    const segment = await segmentFor(ctx, companyId, customer, property);
    // A rental with no turnover booked is a fact about the calendar. Selestial has no reservation data to say more.
    const note = segment === "str" && !next ? "No upcoming turnover is booked. No reservation calendar is connected, so this says nothing about whether the host has guests." : segment === "residential_one_time" && last && !next ? "One-time service completed. This is not a recurring customer who stopped." : null;
    sites.push({ propertyId: property._id, name: propertyName(property), kind: property.kind, segment, segmentWords: SEGMENT_WORDS[segment], health: healthOf(own), openCases: own.map((row) => ({ caseId: row._id, title: row.title, status: row.status, kind: row.kind })), plans: sitePlans, nextVisitAt: next?.startsAt ?? null, nextDeadlineAt: next?.hardDeadlineAt ?? null, lastServiceAt: last?.startsAt ?? null, note });
  }
  const agreements = await customerAgreements(ctx, company, customer, today);
  const contacts = await contactsOf(ctx as QueryCtx, companyId, customer._id);
  const relationship = relationshipOf(customer);
  return {
    customerId: customer._id,
    name: customer.name,
    account: { relationship, words: RELATIONSHIP_WORDS[relationship], note: customer.relationshipNote ?? null, type: customer.type ?? "person", heldByPerson: customer.conversationHeld !== undefined },
    health: healthOf(cases),
    sites,
    agreements,
    contacts: contacts.filter((c) => c.status === "active").map((c) => ({ name: c.name, title: c.title ?? null, roles: c.roles, decisionMaker: c.roles.some((r) => r === "primary" || r === "signer" || r === "billing"), sites: c.propertyIds.length })),
    accountCases: cases.filter((row) => !row.propertyId).map((row) => ({ caseId: row._id, title: row.title, status: row.status, kind: row.kind })),
    preferences: customer.preferences?.trim() || null,
  };
}

export type RenewalRow = { agreementId: Id<"agreements">; title: string; status: string; words: string; target: string | null; noticeBy: string | null; noticePassed: boolean; autoRenew: boolean; termMonths: number | null; signers: string[] };

/** The customer's agreements in force, with their real dates. A missing notice period is shown as missing. */
export async function customerAgreements(ctx: Ctx, company: Doc<"companies">, customer: Doc<"customers">, today: string): Promise<RenewalRow[]> {
  const links = await ctx.db
    .query("agreementLinks")
    .withIndex("by_company_record", (q) => q.eq("companyId", company._id).eq("table", "customers").eq("recordId", customer._id))
    .take(50);
  const out: RenewalRow[] = [];
  const seen = new Set<string>();
  for (const link of links) {
    const agreement = await ctx.db.get(link.agreementId);
    if (!agreement || seen.has(agreement._id) || agreement.category !== "customer" || agreement.archivedAt || agreement.access === "restricted") continue;
    seen.add(agreement._id);
    out.push(renewalRow(agreement, today, retentionSettings(company).renewalLeadDays));
  }
  return out;
}

export function renewalRow(agreement: Doc<"agreements">, today: string, lead: number): RenewalRow {
  const l = agreement.lifecycle;
  const status = lifecycleStatus(agreement, today, lead);
  const target = l.renewalOn ?? l.expiresOn ?? null;
  const autoRenew = agreement.terms.autoRenew === true;
  const days = typeof agreement.terms.renewalNoticeDays === "number" && autoRenew ? agreement.terms.renewalNoticeDays : typeof agreement.terms.terminationNoticeDays === "number" ? agreement.terms.terminationNoticeDays : null;
  const noticeBy = target && days !== null ? addDays(target, -days) : null;
  const words =
    status === "none" ? "Not signed" : status === "terminated" ? `Ended ${l.terminatedOn}` : status === "superseded" ? "Replaced by a newer agreement" : status === "expired" ? `Expired ${l.expiresOn}` : status === "not_started" ? `Starts ${l.effectiveOn}` : !target ? "In force, with no end date recorded" : `${autoRenew ? "Renews automatically" : "Ends"} ${target}`;
  return { agreementId: agreement._id, title: agreement.title, status, words, target, noticeBy, noticePassed: noticeBy !== null && noticeBy < today, autoRenew, termMonths: l.termMonths ?? null, signers: agreement.parties.filter((p) => p.signer && p.role !== "company").map((p) => p.name) };
}

// ── The service review for a renewal ─────────────────────────────────────────────────────────────

/**
 * What the account's own records say about the term so far: visits completed and cancelled, concerns
 * and how long each took, repeat concerns, and reviews of the crew's reports. Every figure is a count of
 * records, by site, with the period it covers. Nothing is rated or scored.
 */
export async function serviceReview(ctx: Ctx, company: Doc<"companies">, customer: Doc<"customers">, since: number, now = Date.now()) {
  const companyId = company._id;
  const jobs = (
    await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", companyId).eq("customerId", customer._id).gte("startsAt", since).lte("startsAt", now))
      .take(1500)
  ).filter((job) => !job.recovery);
  const cases = (
    await ctx.db
      .query("retentionCases")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id).gte("createdAt", since))
      .take(300)
  ).filter((row) => row.kind === "recovery");
  const properties = await ctx.db
    .query("properties")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id))
    .take(200);
  const perSite = properties.map((property) => {
    const own = jobs.filter((job) => job.propertyId === property._id);
    const ownCases = cases.filter((row) => row.propertyId === property._id);
    return {
      propertyId: property._id,
      name: propertyName(property),
      active: property.status === "active",
      completed: own.filter((j) => j.status === "completed").length,
      reviewed: own.filter((j) => j.status === "completed" && j.completionReview?.decision === "closed").length,
      cancelled: own.filter((j) => j.status === "cancelled" && !j.skipped).length,
      skipped: own.filter((j) => j.skipped).length,
      returned: own.reduce((sum, j) => sum + (j.completionReturns ?? 0), 0),
      concerns: ownCases.length,
      openConcerns: ownCases.filter((row) => row.status !== "closed").length,
      lastServiceAt: own.filter((j) => j.status === "completed").reduce((max, j) => Math.max(max, j.startsAt), 0) || null,
    };
  });
  const closed = cases.filter((row) => row.closedAt !== undefined);
  const days = closed.map((row) => (row.closedAt! - row.createdAt) / DAY).sort((a, b) => a - b);
  const areas = new Map<string, number>();
  for (const row of cases) for (const area of row.areas) areas.set(area, (areas.get(area) ?? 0) + 1);
  return {
    from: since,
    to: now,
    sites: perSite.filter((s) => s.completed + s.cancelled + s.concerns > 0 || s.active),
    totals: {
      completed: jobs.filter((j) => j.status === "completed").length,
      cancelled: jobs.filter((j) => j.status === "cancelled" && !j.skipped).length,
      concerns: cases.length,
      openConcerns: cases.filter((row) => row.status !== "closed").length,
      confirmedByCustomer: cases.filter((row) => row.outcome?.code === "customer_confirmed").length,
      medianDaysToClose: days.length ? Math.round(days[Math.floor(days.length / 2)] * 10) / 10 : null,
      closedConcerns: closed.length,
    },
    repeatedAreas: [...areas.entries()].filter(([, n]) => n > 1).map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count),
    limits: ["Counts are of records in Selestial for this period. Inspections outside Selestial, and conversations by phone, are not in them."],
  };
}

/** Opens the renewal case for an agreement whose end of term is coming, once, with the service review in its history. */
export async function prepareRenewal(ctx: MutationCtx, company: Doc<"companies">, agreement: Doc<"agreements">, actor: Actor = RETENTION): Promise<Doc<"retentionCases"> | null> {
  const customerId = await agreementCustomer(ctx, agreement);
  const customer = customerId ? await ctx.db.get(customerId) : null;
  if (!customer || customer.companyId !== company._id) return null;
  const tz = company.timezone;
  const today = localParts(Date.now(), tz).day;
  const row = renewalRow(agreement, today, retentionSettings(company).renewalLeadDays);
  if (!row.target) return null;
  const due = new Date(`${row.noticeBy && !row.noticePassed ? row.noticeBy : row.target}T17:00:00Z`).getTime();
  const opened = await openCase(ctx, {
    companyId: company._id,
    kind: "renewal",
    key: `renewal:${agreement._id}:${row.target}`,
    status: "needs_attention",
    customer,
    agreementId: agreement._id,
    title: `${customer.name}: ${row.autoRenew ? "renewal" : "end of term"} on ${row.target}`,
    happened: `"${agreement.title}" ${row.autoRenew ? "renews automatically" : "ends"} on ${row.target}.${row.noticeBy ? ` Notice is due by ${row.noticeBy}${row.noticePassed ? ", which has passed" : ""}.` : " The agreement records no notice period."}`,
    doing: "The service review is assembled from the term's records.",
    needs: "Decide on the renewal: renew as is, adjust the scope, or let it end. Selestial never renews an agreement itself.",
    origin: "signal",
    dueAt: Math.max(due, Date.now() + DAY),
    actor,
  });
  if (!opened.created) return opened.row;
  const since = agreement.lifecycle.effectiveOn ? new Date(`${agreement.lifecycle.effectiveOn}T00:00:00Z`).getTime() : Date.now() - 365 * DAY;
  const review = await serviceReview(ctx, company, customer, since);
  const source = { table: "agreements", id: agreement._id, label: agreement.title };
  await addEntry(ctx, opened.row, { kind: "evidence", basis: "fact", text: opened.row.happened, source, actor: SYSTEM });
  await addEntry(ctx, opened.row, { kind: "evidence", basis: "fact", text: `Since ${localParts(since, tz).day}: ${review.totals.completed} ${review.totals.completed === 1 ? "visit" : "visits"} completed and ${review.totals.cancelled} cancelled across ${review.sites.length} ${review.sites.length === 1 ? "site" : "sites"}. ${review.totals.concerns} ${review.totals.concerns === 1 ? "concern was" : "concerns were"} raised; ${review.totals.openConcerns} still open; ${review.totals.confirmedByCustomer} confirmed resolved by the customer.`, actor: SYSTEM });
  for (const site of review.sites) await addEntry(ctx, opened.row, { kind: "evidence", basis: "fact", text: `${site.name}: ${site.completed} completed, ${site.cancelled} cancelled, ${site.concerns} ${site.concerns === 1 ? "concern" : "concerns"}${site.openConcerns ? ` (${site.openConcerns} open)` : ""}${site.active ? "" : ". This site is no longer served"}.`, source: { table: "properties", id: site.propertyId, label: site.name }, actor: SYSTEM });
  for (const repeat of review.repeatedAreas) await addEntry(ctx, opened.row, { kind: "evidence", basis: "fact", text: `"${repeat.area}" was raised ${repeat.count} times in this term.`, actor: SYSTEM });
  const contacts = await contactsOf(ctx as QueryCtx, company._id, customer._id);
  const deciders = contacts.filter((c) => c.status === "active" && c.roles.some((r) => r === "primary" || r === "signer" || r === "billing"));
  await addEntry(ctx, opened.row, { kind: "evidence", basis: "fact", text: deciders.length ? `Decision-makers on record: ${deciders.map((c) => `${c.name} (${c.roles.join(", ")})`).join("; ")}.${row.signers.length ? ` The agreement was signed by ${row.signers.join(", ")}.` : ""}` : `No primary, billing or signing contact is recorded for this account.${row.signers.length ? ` The agreement was signed by ${row.signers.join(", ")}.` : ""}`, actor: SYSTEM });
  if (!deciders.length) await moveCase(ctx, opened.row, { status: "needs_context", needs: "No decision-maker is recorded for this account. Add the person who decides the renewal, then decide how to approach it." }, SYSTEM);
  return (await ctx.db.get(opened.row._id))!;
}

// ── Selective re-engagement ──────────────────────────────────────────────────────────────────────

export type Candidate = {
  customerId: Id<"customers">;
  name: string;
  segment: Segment;
  segmentWords: string;
  /** Why they are on this list, from the record. */
  basis: string;
  lastServiceAt: number | null;
  lastService: string | null;
  completedVisits: number;
  statedReason: { words: string; source: string } | null;
  eligible: boolean;
  /** Why not, or what a person should weigh first. */
  why: string;
  contact: { channel: "sms" | "email" | null; ok: boolean; words: string };
  openIssues: number;
  caseId: Id<"retentionCases"> | null;
};

/**
 * Former customers who could be asked back, each with what the record says about why they left and
 * whether they may be contacted. Nobody is here only because time passed: a customer is a candidate
 * when a person marked the relationship former or paused, or their recurring service ended.
 */
export async function reactivationCandidates(ctx: Ctx, company: Doc<"companies">, now = Date.now()): Promise<Candidate[]> {
  const companyId = company._id;
  const out: Candidate[] = [];
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(1500);
  for (const customer of customers) {
    const relationship = relationshipOf(customer);
    const plans = await recurringPlansAt(ctx, companyId, customer._id);
    const running = plans.service.some((p) => p.state === "active" || p.state === "setup" || p.state === "paused") || plans.sales.some((p) => p.status !== "ended");
    const ended = [...plans.service.filter((p) => p.state === "ended" && p.kind === "recurring"), ...plans.sales.filter((p) => p.status === "ended")];
    let basis: string | null = null;
    if (relationship === "former") basis = "A person marked this relationship as former.";
    else if (!running && ended.length) basis = "Their recurring service ended and no service is running.";
    if (!basis) continue;
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", companyId).eq("customerId", customer._id))
      .order("desc")
      .take(300);
    if (jobs.some((job) => job.status === "scheduled" && job.startsAt > now)) continue;
    const completed = jobs.filter((job) => job.status === "completed" && !job.recovery);
    const last = completed[0] ?? null;
    const cases = await ctx.db
      .query("retentionCases")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id))
      .order("desc")
      .take(60);
    // A concern or a plan request still open. A feedback request that is out is not an unresolved issue.
    const open = cases.filter((row) => row.status !== "closed" && (row.kind === "recovery" || row.kind === "continuity"));
    const existing = cases.find((row) => row.kind === "reactivation" && (row.status !== "closed" || now - (row.closedAt ?? 0) < 90 * DAY)) ?? null;
    const cancelled = cases.find((row) => row.outcome?.code === "customer_cancelled");
    const declined = cases.some((row) => row.outcome?.code === "declined_contact");
    const endedSales = plans.sales.find((p) => p.status === "ended" && p.endedReason);
    const statedReason = cancelled?.customerWords
      ? { words: cancelled.customerWords.slice(0, 240), source: "What the customer wrote when they cancelled" }
      : customer.relationshipNote
        ? { words: customer.relationshipNote.slice(0, 240), source: "Note recorded by the office" }
        : endedSales?.endedReason
          ? { words: endedSales.endedReason.slice(0, 240), source: "Reason recorded when the plan ended" }
          : cancelled?.outcome?.note
            ? { words: cancelled.outcome.note.slice(0, 240), source: "Recorded when the service ended" }
            : null;
    const channel = careChannel(customer);
    const reach = channel ? await canReach(ctx, customer, channel, "return_offer", RETENTION) : null;
    const contact = { channel, ok: reach?.ok === true, words: !channel ? "No phone or email on file." : reach!.ok ? `May be contacted by ${channel === "sms" ? "text" : "email"}.` : reach!.words };
    let eligible = true;
    let why = "Eligible. A person writes or reviews the message; nothing goes to a list.";
    if (declined) [eligible, why] = [false, "They asked not to be contacted."];
    else if (open.length) [eligible, why] = [false, `${open.length} open ${open.length === 1 ? "issue" : "issues"} must be resolved first. No offer goes out over an unresolved concern.`];
    else if (!contact.ok) [eligible, why] = [false, contact.words];
    else if (existing && existing.status !== "closed") [eligible, why] = [false, "A return offer is already under way."];
    else if (existing) [eligible, why] = [false, "They were asked in the last 90 days."];
    else if (!last) [eligible, why] = [false, "No completed service is on record, so there is nothing to refer back to."];
    else if (!statedReason) why = "Eligible, but why they left is not on record. Do not assume a reason in the message.";
    else if (cancelled) why = "They chose to cancel. Contact them only with a reason that answers why they left.";
    const property = last ? await ctx.db.get(last.propertyId) : null;
    const segment = await segmentFor(ctx, companyId, customer, property);
    out.push({ customerId: customer._id, name: customer.name, segment, segmentWords: SEGMENT_WORDS[segment], basis, lastServiceAt: last?.startsAt ?? null, lastService: last ? (last.serviceSnapshot?.name ?? last.serviceType) : null, completedVisits: completed.length, statedReason, eligible, why, contact, openIssues: open.length, caseId: existing?._id ?? null });
    if (out.length >= 200) break;
  }
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || (b.lastServiceAt ?? 0) - (a.lastServiceAt ?? 0));
}

/**
 * Prepares one return offer to one former customer, in words a person wrote or reviewed. Refused for
 * anyone who is not eligible right now. It names no price and no discount: those follow the company's
 * approved pricing, which Retention does not set.
 */
export async function prepareReturn(ctx: MutationCtx, company: Doc<"companies">, customer: Doc<"customers">, input: { body: string; reason: string; actor: Actor }): Promise<{ ok: true; caseId: Id<"retentionCases">; status: string; words: string } | { ok: false; words: string }> {
  const candidate = (await reactivationCandidates(ctx, company)).find((row) => row.customerId === customer._id);
  if (!candidate) return { ok: false, words: "This customer is not a former customer on record, or has a service booked." };
  if (!candidate.eligible) return { ok: false, words: candidate.why };
  const body = input.body.trim();
  if (body.length < 20) return { ok: false, words: "Write the message: a specific reason for this customer to come back." };
  if (/\b\d{1,3}\s?%|\$\s?\d|\bdiscount|\bfree\b|\boff\b/i.test(body)) return { ok: false, words: "The message names a price, a discount or something free. Offers follow the company's approved pricing: take it out, or have the Owner set the offer in Services & Pricing first." };
  const channel = candidate.contact.channel!;
  const opened = await openCase(ctx, {
    companyId: company._id,
    kind: "reactivation",
    key: `return:${customer._id}:${localParts(Date.now(), company.timezone).day}`,
    status: "action_underway",
    customer,
    title: `${customer.name}: return offer`,
    happened: `${candidate.basis} Last service: ${candidate.lastService ?? "none"}${candidate.lastServiceAt ? ` on ${localParts(candidate.lastServiceAt, company.timezone).day}` : ""}.${candidate.statedReason ? ` ${candidate.statedReason.source}: "${candidate.statedReason.words}"` : " Why they left is not on record."}`,
    doing: "A return offer is prepared.",
    origin: "staff",
    dueAt: Date.now() + retentionSettings(company).quietDays * DAY,
    actor: input.actor,
  });
  const action = await prepareAction(ctx, opened.row, { kind: "return_offer", key: "offer-1", summary: `Send ${customer.name} a return offer by ${channel === "sms" ? "text" : "email"}`, reason: input.reason.trim().slice(0, 600) || candidate.why, permission: "retention.reactivation_offer", message: { channel, subject: channel === "email" ? `From ${company.name}` : undefined, body: body.slice(0, 1200) }, actor: input.actor });
  const routed = await submitAction(ctx, company, action._id, input.actor.kind === "member" ? RETENTION : input.actor);
  const fresh = (await ctx.db.get(opened.row._id))!;
  if (routed.status === "awaiting_approval") await moveCase(ctx, fresh, { status: "needs_attention", needs: "Approve the return offer to send it.", doing: "A return offer is waiting for approval." }, SYSTEM);
  return { ok: true, caseId: opened.row._id, status: routed.status, words: routed.status === "awaiting_approval" ? "Prepared. It is in Approvals: nothing is sent until it is approved." : routed.detail };
}

export { KIND_WORDS };
