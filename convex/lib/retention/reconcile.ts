/**
 * Reconciliation: reading the company's records for the mismatches that put a relationship at risk, and
 * raising each as an explainable signal. It runs on a schedule and after the events that matter, and it
 * is safe to run any number of times: the same mismatch is one signal, counted again, and a mismatch the
 * records no longer show is cleared.
 *
 * The rules compare records that should agree: a running plan and its booked visits, a paid invoice and
 * the service it paid for, a paused service and what is still due, an agreement and its dates. Each is
 * adjusted for the kind of relationship:
 *  - a standing arrangement (a short-term rental's turnovers) has no calendar, so having no visit booked
 *    is not a gap, and a quiet season is not a lost account;
 *  - a planned pause is a pause, not a missing visit;
 *  - a one-time service that was completed is complete, not a recurring customer who stopped.
 *
 * What Selestial does not hold is said, not guessed (`MISSING_DATA`).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { addDays } from "../agreements/store";
import { lifecycleStatus } from "../agreements/store";
import { localParts } from "../availability";
import { seriesDays, upcomingPlanVisits } from "../clients/plans";
import { localDay } from "../chat/localDay";
import { money } from "../dispatch/pay";
import { futureVisits } from "../sales/plans";
import { actionsOf, whenWords } from "./actions";
import { DAY, propertyName, segmentFor } from "./cases";
import { openBilling } from "./planChanges";
import { clearUnseen, raiseSignal } from "./signals";
import { retentionSettings } from "./settings";
import type { SignalKind } from "./schema";

/** What these rules cannot see, because Selestial does not hold the data. Shown on the workspace as it is. */
export const MISSING_DATA: { key: string; title: string; words: string }[] = [
  { key: "memberships", title: "Memberships and prepaid cleaning credits", words: "Selestial has no memberships, prepaid packages or expiring cleaning credits for customers. A paid entitlement is read from invoices: money paid for a visit that was cancelled." },
  { key: "reservations", title: "Short-term rental reservations", words: "No reservation calendar is connected, so Selestial cannot know which turnovers a host gave to someone else. A property with no upcoming turnover is shown as that, never as a lost account." },
  { key: "messaging_balance", title: "Messaging balance", words: "Texts and emails are not metered in Selestial yet, so there is no balance to check before sending. Consent, opt-outs, quiet hours and sender setup are checked every time." },
  { key: "inbound_email", title: "Customer email replies", words: "Replies by email from existing customers are not received in Selestial yet. Texts are, and so are answers on a customer's private link." },
];

const RECONCILED: readonly SignalKind[] = ["plan_missing_visit", "paid_without_service", "service_paused_billing_open", "invoice_dispute", "renewal_approaching", "company_cancellation", "repeated_reschedule", "decision_maker_changed", "commitment_overdue"];

/** Runs every rule for one company. Returns how many signals the records show now. */
export async function reconcile(ctx: MutationCtx, company: Doc<"companies">): Promise<{ seen: number; cleared: number }> {
  const seen = new Set<string>();
  const tz = company.timezone;
  const now = Date.now();
  const today = localParts(now, tz).day;
  const companyId = company._id;
  const customers = new Map<string, Doc<"customers"> | null>();
  const properties = new Map<string, Doc<"properties"> | null>();
  const customerOf = async (id: Id<"customers">) => {
    if (!customers.has(id)) customers.set(id, await ctx.db.get(id));
    return customers.get(id)!;
  };
  const propertyOf = async (id: Id<"properties">) => {
    if (!properties.has(id)) properties.set(id, await ctx.db.get(id));
    return properties.get(id)!;
  };
  const paused = (from: string | undefined, until: string | undefined) => from !== undefined && from <= today && (until === undefined || today < until);

  // ── Recurring plans against their booked visits, and against what is still due ──
  const servicePlans = [
    ...(await ctx.db.query("servicePlans").withIndex("by_company_state", (q) => q.eq("companyId", companyId).eq("state", "active")).take(500)),
    ...(await ctx.db.query("servicePlans").withIndex("by_company_state", (q) => q.eq("companyId", companyId).eq("state", "paused")).take(500)),
  ];
  for (const plan of servicePlans) {
    // A standing arrangement holds terms, not a calendar: its turnovers are booked one by one.
    if (plan.kind !== "recurring") continue;
    const customer = await customerOf(plan.customerId);
    const property = await propertyOf(plan.propertyId);
    if (!customer || customer.status !== "active" || !property) continue;
    const segment = await segmentFor(ctx, companyId, customer, property);
    const isPaused = plan.state === "paused" || paused(plan.pausedFrom, plan.pausedUntil);
    if (isPaused) {
      const billing = await openBilling(ctx, companyId, customer._id);
      if (billing.invoices > 0) {
        const key = `paused-billing:service:${plan._id}`;
        seen.add(key);
        await raiseSignal(ctx, { companyId, kind: "service_paused_billing_open", key, basis: "fact", customerId: customer._id, propertyId: property._id, plan: { kind: "service", id: plan._id }, segment, what: `Service at ${propertyName(property)} is paused${plan.pausedUntil ? ` until ${plan.pausedUntil}` : ""}. ${billing.invoices} open ${billing.invoices === 1 ? "invoice is" : "invoices are"} still due. Pausing service did not pause billing.`, source: { table: "servicePlans", id: plan._id, label: "Service plan" }, occurredAt: now, missing: ["Whether the customer expects billing to stop while service is paused."], suggestedAction: "Tell the customer what is still due, or ask the Owner to change it. Service and billing are paused separately." });
      }
      continue;
    }
    const expected = seriesDays(plan, today, addDays(today, 28));
    const booked = await upcomingPlanVisits(ctx, plan, today);
    if (expected.length && booked.length === 0) {
      const key = `plan-gap:service:${plan._id}`;
      seen.add(key);
      await raiseSignal(ctx, { companyId, kind: "plan_missing_visit", key, basis: "fact", customerId: customer._id, propertyId: property._id, plan: { kind: "service", id: plan._id }, segment, what: `The recurring service at ${propertyName(property)} is running and no visit is booked. The schedule's next day is ${expected[0]}.`, source: { table: "servicePlans", id: plan._id, label: "Service plan" }, occurredAt: now, missing: ["Whether the day could not be booked (hours, area, capacity) or was removed by a person."], suggestedAction: "Book the next visit, or pause or end the plan if that is what the customer wants.", priority: "high" });
    }
  }
  const salesPlans = [
    ...(await ctx.db.query("recurringPlans").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active")).take(500)),
    ...(await ctx.db.query("recurringPlans").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "paused")).take(500)),
  ];
  for (const plan of salesPlans) {
    const customer = await customerOf(plan.customerId);
    const property = await propertyOf(plan.propertyId);
    if (!customer || customer.status !== "active" || !property) continue;
    const segment = await segmentFor(ctx, companyId, customer, property);
    const isPaused = plan.status === "paused" || (plan.pause !== undefined && plan.pause.from <= today && (plan.pause.until === undefined || today <= plan.pause.until));
    if (isPaused) {
      const billing = await openBilling(ctx, companyId, customer._id);
      if (billing.invoices > 0) {
        const key = `paused-billing:sales:${plan._id}`;
        seen.add(key);
        await raiseSignal(ctx, { companyId, kind: "service_paused_billing_open", key, basis: "fact", customerId: customer._id, propertyId: property._id, plan: { kind: "sales", id: plan._id }, segment, what: `Service at ${propertyName(property)} is paused. ${billing.invoices} open ${billing.invoices === 1 ? "invoice is" : "invoices are"} still due. Pausing service did not pause billing.`, source: { table: "recurringPlans", id: plan._id, label: "Recurring plan" }, occurredAt: now, missing: ["Whether the customer expects billing to stop while service is paused."], suggestedAction: "Tell the customer what is still due, or ask the Owner to change it. Service and billing are paused separately." });
      }
      continue;
    }
    if (plan.endDate && plan.endDate < today) continue;
    if ((await futureVisits(ctx, plan, today)).length === 0) {
      const key = `plan-gap:sales:${plan._id}`;
      seen.add(key);
      await raiseSignal(ctx, { companyId, kind: "plan_missing_visit", key, basis: "fact", customerId: customer._id, propertyId: property._id, plan: { kind: "sales", id: plan._id }, segment, what: `The recurring plan at ${propertyName(property)} is active and has no upcoming visit booked.`, source: { table: "recurringPlans", id: plan._id, label: "Recurring plan" }, occurredAt: now, missing: ["Whether visits could not be made (capacity, hours) or were removed by a person."], suggestedAction: "Have the plan make its visits, or pause or end it if that is what the customer wants.", priority: "high" });
    }
  }

  // ── Money paid for a service that is not going to happen ──
  for (const status of ["paid", "open"] as const) {
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status).gte("createdAt", now - 120 * DAY))
      .take(300);
    for (const invoice of invoices) {
      const kept = invoice.totals.paidCents - invoice.totals.refundedCents;
      if (!invoice.jobId || kept <= 0) continue;
      const job = await ctx.db.get(invoice.jobId);
      if (!job || job.status !== "cancelled") continue;
      const customer = await customerOf(invoice.customerId);
      const property = await propertyOf(job.propertyId);
      if (!customer) continue;
      // Another visit already booked for the same customer and property after the cancelled one counts as the service being rescheduled.
      const later = await ctx.db
        .query("jobs")
        .withIndex("by_company_property_start", (q) => q.eq("companyId", companyId).eq("propertyId", job.propertyId).gte("startsAt", now))
        .take(10);
      const rebooked = later.some((other) => other.status === "scheduled");
      const key = `paid-no-service:${invoice._id}`;
      seen.add(key);
      await raiseSignal(ctx, { companyId, kind: "paid_without_service", key, basis: "fact", customerId: customer._id, propertyId: job.propertyId, segment: await segmentFor(ctx, companyId, customer, property), what: `Invoice ${invoice.number ?? ""} has ${money(kept)} paid for a visit on ${localParts(job.startsAt, tz).day} that was cancelled${job.cancelReason ? ` ("${job.cancelReason.slice(0, 80)}")` : ""}. ${rebooked ? "Another visit is booked at the property, but this payment is not linked to it." : "No visit is booked at the property."}`, source: { table: "invoices", id: invoice._id, label: `Invoice ${invoice.number ?? ""}`.trim(), at: invoice.paidAt ?? invoice.createdAt }, occurredAt: invoice.paidAt ?? invoice.createdAt, missing: ["Whether the customer was told, and whether they want the visit rebooked or the money back."], suggestedAction: "Prepare a correction: rebook the visit, or ask the Owner to refund or credit it. Money changes are the Owner's.", priority: "high" });
    }
  }

  // ── A payment the customer disputed ──
  for (const status of ["succeeded", "checking"] as const) {
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status).gte("updatedAt", now - 120 * DAY))
      .take(300);
    for (const payment of payments) {
      if (!payment.dispute || /won|lost|closed/i.test(payment.dispute.status)) continue;
      const customer = await customerOf(payment.customerId);
      if (!customer) continue;
      const key = `dispute:${payment._id}`;
      seen.add(key);
      await raiseSignal(ctx, { companyId, kind: "invoice_dispute", key, basis: "fact", customerId: customer._id, segment: await segmentFor(ctx, companyId, customer, null), what: `A payment of ${money(payment.dispute.amountCents)} is disputed with the card issuer (${payment.dispute.status.replace(/_/g, " ")}).`, source: { table: "payments", id: payment._id, label: "Payment", at: payment.dispute.at }, occurredAt: payment.dispute.at, missing: ["Why the customer disputed it. A dispute is handled by the Owner; Retention does not write to the customer about it."], suggestedAction: "The Owner answers the dispute in Finance. Hold any offer or outreach to this customer until it is settled.", priority: "high" });
    }
  }

  // ── Agreements with an end of term or a notice deadline coming ──
  const lead = retentionSettings(company).renewalLeadDays;
  const agreements = await ctx.db
    .query("agreements")
    .withIndex("by_company_updated", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(400);
  for (const agreement of agreements) {
    const l = agreement.lifecycle;
    // An agreement with only an expiry date has an end of term too.
    const target = l.renewalOn ?? l.expiresOn;
    if (agreement.category !== "customer" || agreement.archivedAt || !target) continue;
    const status = lifecycleStatus(agreement, today, lead);
    if (status !== "renewal_due" && !(status === "in_force" && target <= addDays(today, lead))) continue;
    if (target < addDays(today, -30)) continue;
    const customerId = await agreementCustomer(ctx, agreement);
    const customer = customerId ? await customerOf(customerId) : null;
    if (!customer) continue;
    const autoRenew = agreement.terms.autoRenew === true;
    const noticeDays = typeof agreement.terms.renewalNoticeDays === "number" && autoRenew ? agreement.terms.renewalNoticeDays : typeof agreement.terms.terminationNoticeDays === "number" ? agreement.terms.terminationNoticeDays : null;
    const noticeBy = noticeDays !== null ? addDays(target, -noticeDays) : null;
    const deadline = noticeBy && noticeBy >= today ? noticeBy : target;
    const key = `renewal:${agreement._id}:${target}`;
    seen.add(key);
    await raiseSignal(ctx, { companyId, kind: "renewal_approaching", key, basis: "fact", customerId: customer._id, agreementId: agreement._id, segment: await segmentFor(ctx, companyId, customer, null), what: `"${agreement.title}" ${autoRenew ? "renews automatically" : "ends"} on ${target}.${noticeBy ? ` Notice is due by ${noticeBy}${noticeBy < today ? ", which has passed" : ""}.` : " The agreement names no notice period."}`, source: { table: "agreements", id: agreement._id, label: agreement.title }, occurredAt: now, missing: [noticeBy ? "" : "The notice period is not recorded on the agreement.", "Whether the customer intends to renew."].filter(Boolean), suggestedAction: "Assemble the service review and decide: renew, adjust the scope, or let it end. Selestial never renews an agreement itself.", priority: deadline <= addDays(today, 14) ? "high" : "normal", deadlineAt: localDay(deadline, tz) + 17 * 60 * 60_000 });
  }

  // ── Visits lost or moved on the company's side, and changes of decision-maker ──
  const unresolved = await ctx.db
    .query("coverageRequests")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "unresolved").gte("openedAt", now - 30 * DAY))
    .take(100);
  for (const request of unresolved) {
    const job = await ctx.db.get(request.jobId);
    if (!job || job.status !== "cancelled") continue;
    const customer = await customerOf(job.customerId);
    const property = await propertyOf(job.propertyId);
    if (!customer) continue;
    const key = `company-cancel:${job._id}`;
    seen.add(key);
    await raiseSignal(ctx, { companyId, kind: "company_cancellation", key, basis: "fact", customerId: customer._id, propertyId: job.propertyId, segment: await segmentFor(ctx, companyId, customer, property), what: `The visit on ${localParts(job.startsAt, tz).day} at ${propertyName(property)} was cancelled after its cleaner was lost (${request.cause.replace(/_/g, " ")}) and nobody could cover it.`, source: { table: "jobs", id: job._id, label: "Cancelled visit", at: job.startsAt }, occurredAt: request.resolvedAt ?? request.openedAt, missing: ["What the customer was told, and whether the visit was rebooked."], suggestedAction: "Acknowledge it to the customer and agree a dependable new time with Dispatch." });
  }
  const events = await ctx.db
    .query("events")
    .withIndex("by_company_at", (q) => q.eq("companyId", companyId).gte("at", now - 30 * DAY))
    .order("desc")
    .take(1500);
  const moves = new Map<string, number>();
  for (const event of events) if (event.type === "job.rescheduled") moves.set(event.subjectId, (moves.get(event.subjectId) ?? 0) + 1);
  for (const [jobId, count] of moves) {
    if (count < 2) continue;
    const job = await ctx.db.get(jobId as Id<"jobs">);
    if (!job || job.companyId !== companyId || job.status !== "scheduled") continue;
    const customer = await customerOf(job.customerId);
    const property = await propertyOf(job.propertyId);
    if (!customer) continue;
    const key = `moved:${job._id}`;
    seen.add(key);
    await raiseSignal(ctx, { companyId, kind: "repeated_reschedule", key, basis: "fact", customerId: customer._id, propertyId: job.propertyId, segment: await segmentFor(ctx, companyId, customer, property), what: `The visit now on ${whenWords(job.startsAt, tz)} at ${propertyName(property)} has been moved ${count} times.`, source: { table: "jobs", id: job._id, label: "Visit", at: job.startsAt }, occurredAt: now, missing: ["Who asked for each move. The record does not say whether it was the customer or the company."], suggestedAction: "Check who asked for the moves before reading anything into them." });
  }
  const DECISION_ROLES = /primary|billing|signer/;
  for (const event of events) {
    if (event.type !== "customer.contact_added" && event.type !== "customer.contact_updated" && event.type !== "customer.contact_removed") continue;
    const roles = typeof event.data?.roles === "string" ? event.data.roles : "";
    if (event.type !== "customer.contact_removed" && !DECISION_ROLES.test(roles)) continue;
    const customer = await customerOf(event.subjectId as Id<"customers">);
    if (!customer || customer.status !== "active" || (customer.type !== "business" && customer.kind === "home")) continue;
    // A contact added in the first week of an account is the account being set up, not a change.
    if (event.at - customer.createdAt < 7 * DAY) continue;
    const key = `contact:${customer._id}:${localParts(event.at, tz).day}`;
    seen.add(key);
    const name = typeof event.data?.contact === "string" ? event.data.contact : "A contact";
    await raiseSignal(ctx, { companyId, kind: "decision_maker_changed", key, basis: "fact", customerId: customer._id, segment: await segmentFor(ctx, companyId, customer, null), what: `${name} was ${event.type === "customer.contact_removed" ? "removed as a contact" : event.type === "customer.contact_added" ? `added as ${roles || "a contact"}` : `changed (${roles || "contact"})`} on ${localParts(event.at, tz).day}.`, source: { table: "customers", id: customer._id, label: customer.name, at: event.at }, occurredAt: event.at, missing: ["Whether the new contact knows the agreed scope, schedule and how to report a problem."], suggestedAction: "Introduce the service to the new contact and confirm what was agreed." });
  }

  // ── Commitments past their deadline ──
  for (const status of ["needs_attention", "action_underway", "needs_context"] as const) {
    const late = await ctx.db
      .query("retentionCases")
      .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status).lt("dueAt", now))
      .take(100);
    for (const row of late) {
      const pending = (await actionsOf(ctx, row)).find((a) => a.status === "underway" || a.status === "awaiting_approval");
      const key = `overdue:${row._id}:${row.dueAt}`;
      seen.add(key);
      const signal = await raiseSignal(ctx, { companyId, kind: "commitment_overdue", key, basis: "fact", customerId: row.customerId, propertyId: row.propertyId, segment: row.segment, what: `"${row.title}" was due ${whenWords(row.dueAt, tz)} and is still open${pending ? `: ${pending.summary}` : ""}.`, source: { table: "retentionCases", id: row._id, label: row.title, at: row.dueAt }, occurredAt: row.dueAt, suggestedAction: "Open the case and move it: decide, chase the handoff, or record what happened.", priority: "high", deadlineAt: row.dueAt });
      if (signal.row.status === "open") await ctx.db.patch(signal.row._id, { status: "in_case", caseId: row._id });
    }
  }

  const cleared = await clearUnseen(ctx, companyId, RECONCILED, seen);
  // A signal a case already carries is cleared too when the record no longer shows it, without closing the case.
  return { seen: seen.size, cleared };
}

/** The customer an agreement is with: its customer party, or the customer record it is linked to. */
export async function agreementCustomer(ctx: QueryCtx | MutationCtx, agreement: Doc<"agreements">): Promise<Id<"customers"> | null> {
  const party = agreement.parties.find((p) => p.record?.table === "customers");
  if (party?.record) return ctx.db.normalizeId("customers", party.record.id);
  const links = await ctx.db
    .query("agreementLinks")
    .withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id))
    .take(20);
  const link = links.find((row) => row.table === "customers");
  return link ? ctx.db.normalizeId("customers", link.recordId) : null;
}
