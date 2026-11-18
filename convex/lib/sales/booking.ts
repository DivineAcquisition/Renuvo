/**
 * From an accepted quote to a booking the company can fulfil.
 *
 * `bookingReadiness` is the checklist a person sees and the gate Sales goes through, read from the
 * record every time: the details, the accepted quote version, the agreement, the deposit, the time and
 * capacity. Nothing in it is a model's opinion.
 *
 * `confirmBooking` is the only place an opportunity becomes Won. It runs the checklist again, checks
 * capacity at that moment in the same transaction that makes the job, and makes the job through the
 * path a person uses (convex/lib/dispatch/createJob.ts), where Dispatch picks it up in the same step.
 * Asked twice, it answers with the job it already made.
 *
 * What it never does: say a cleaner is confirmed. A job existing means the company has taken the
 * booking. Whether a cleaner accepted it is Dispatch's record, read from assignments.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { governs } from "../agreements/agents";
import { localParts, type Span } from "../availability";
import { createJob } from "../dispatch/createJob";
import { recordEvent, type Actor } from "../events";
import { depositOutstanding } from "../finance/invoiceState";
import { publishedByKey } from "../services/store";
import { formatCents } from "../services/words";
import { clock, dayName } from "../time";
import { checkSlot, liveHold, releaseHolds, ruleProblem, type Need, type SlotAnswer } from "./capacity";
import { factOf, known } from "./facts";
import { currentQuote, setStage } from "./opportunities";
import { versionOf } from "./quotes";

type Ctx = QueryCtx | MutationCtx;

export type ReadinessKey = "details" | "quote" | "agreement" | "deposit" | "time" | "confirmation";
export type ReadinessItem = {
  key: ReadinessKey;
  label: string;
  state: "done" | "todo" | "blocked" | "not_required";
  detail: string;
  /** Who can move it forward. */
  by: "customer" | "owner" | "sales" | null;
};

export type Readiness = {
  items: ReadinessItem[];
  /** Everything a booking needs is in place, apart from making it. */
  ready: boolean;
  /** Ready except that capacity could not be verified. Only a person may go on from here, with a reason. */
  onlyCapacity: boolean;
  blockers: string[];
};

export function whenWords(span: Span, timezone: string): string {
  return `${dayName(span.startsAt, timezone)} at ${clock(span.startsAt, timezone)}`;
}

async function customerAgreements(ctx: Ctx, opportunity: Doc<"salesOpportunities">): Promise<Doc<"agreements">[]> {
  const out = new Map<string, Doc<"agreements">>();
  const records: { table: "customers" | "properties"; id: string }[] = [{ table: "customers", id: opportunity.customerId }];
  if (opportunity.propertyId) records.push({ table: "properties", id: opportunity.propertyId });
  for (const record of records) {
    const links = await ctx.db
      .query("agreementLinks")
      .withIndex("by_company_record", (q) => q.eq("companyId", opportunity.companyId).eq("table", record.table).eq("recordId", record.id))
      .take(50);
    for (const link of links) {
      const agreement = await ctx.db.get(link.agreementId);
      if (agreement && agreement.companyId === opportunity.companyId && agreement.category === "customer" && !agreement.archivedAt) out.set(agreement._id, agreement);
    }
  }
  return [...out.values()];
}

export type BookingFacts = {
  quote: Doc<"salesQuotes"> | null;
  version: Doc<"salesQuoteVersions"> | null;
  property: Doc<"properties"> | null;
  slot: Span | null;
  need: Need | null;
  capacity: SlotAnswer | null;
  hold: Doc<"salesHolds"> | null;
};

/** The booking checklist, from the record as it is now. */
export async function bookingReadiness(ctx: Ctx, company: Doc<"companies">, opportunity: Doc<"salesOpportunities">, now = Date.now()): Promise<Readiness & { facts: BookingFacts }> {
  const items: ReadinessItem[] = [];
  const quote = await currentQuote(ctx, opportunity);
  const accepted = quote && quote.status === "accepted" && quote.acceptance && quote.acceptance.version === quote.sentVersion ? quote.acceptance : null;
  const version = quote && accepted ? await versionOf(ctx, quote, accepted.version) : null;
  const property = opportunity.propertyId ? await ctx.db.get(opportunity.propertyId) : null;
  const tz = company.timezone;

  // 1. The details the visit needs.
  const access = property?.accessInstructions?.trim() || (known(opportunity.facts, "access") ? String(factOf(opportunity.facts, "access")!.value) : "");
  if (!property) items.push({ key: "details", label: "Required details", state: "todo", detail: "The service address is not on record yet.", by: "customer" });
  else if (!access) items.push({ key: "details", label: "Required details", state: "todo", detail: "How the team gets in is not recorded yet.", by: "customer" });
  else items.push({ key: "details", label: "Required details", state: "done", detail: `${property.address.line1}, ${property.address.city}. Access is on record.`, by: null });

  // 2. The quote, accepted for the exact version that was sent.
  if (!quote) items.push({ key: "quote", label: "Quote accepted", state: "todo", detail: "No quote has been prepared.", by: "sales" });
  else if (!accepted || !version) items.push({ key: "quote", label: "Quote accepted", state: "todo", detail: quote.status === "sent" ? "The customer has the quote and has not accepted it yet." : quote.status === "expired" ? "The quote expired before it was accepted." : `The quote is ${quote.status.replace(/_/g, " ")}.`, by: quote.status === "sent" ? "customer" : "sales" });
  else items.push({ key: "quote", label: "Quote accepted", state: "done", detail: `${accepted.name} accepted version ${accepted.version} (${formatCents(version.totalCents)}) on ${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(accepted.at))}.`, by: null });

  // 3. The agreement, when the quote said one is required.
  if (!version?.agreementRequired) items.push({ key: "agreement", label: "Agreement", state: "not_required", detail: "This company does not require a signed agreement before booking.", by: null });
  else {
    const agreements = await customerAgreements(ctx, opportunity);
    const today = localParts(now, tz).day;
    const governing = agreements.find((agreement) => governs(agreement, today));
    const out = agreements.find((agreement) => agreement.workflow === "sent" || agreement.workflow === "partially_signed");
    if (governing) items.push({ key: "agreement", label: "Agreement", state: "done", detail: `"${governing.title}" is signed and in force.`, by: null });
    else if (out) items.push({ key: "agreement", label: "Agreement", state: "todo", detail: `"${out.title}" is out for signature and not fully signed yet.`, by: "customer" });
    else items.push({ key: "agreement", label: "Agreement", state: "todo", detail: agreements.length > 0 ? `"${agreements[0].title}" has not been sent for signature yet.` : "A signed service agreement is required and none has been prepared for this customer.", by: "owner" });
  }

  // 4. The deposit, when the accepted quote asks for one. Paid means Finance's ledger says so.
  if (!version?.depositCents) items.push({ key: "deposit", label: "Deposit", state: "not_required", detail: "This quote does not ask for a deposit.", by: null });
  else {
    const invoice = opportunity.booking?.depositInvoiceId ? await ctx.db.get(opportunity.booking.depositInvoiceId) : null;
    const amount = formatCents(version.depositCents);
    if (!invoice || invoice.companyId !== opportunity.companyId || invoice.status === "void") items.push({ key: "deposit", label: "Deposit", state: "todo", detail: `A deposit of ${amount} is required and no invoice has been made for it yet.`, by: "owner" });
    else if (invoice.status === "draft") items.push({ key: "deposit", label: "Deposit", state: "todo", detail: `The ${amount} deposit invoice is a draft. Issue it in Finance so the customer can pay.`, by: "owner" });
    else {
      const net = invoice.totals.paidCents - invoice.totals.refundedCents;
      const paid = invoice.status === "paid" || net >= version.depositCents || (invoice.depositCents !== undefined && invoice.balanceRequestedAt === undefined && depositOutstanding(invoice) <= 0);
      if (paid) items.push({ key: "deposit", label: "Deposit", state: "done", detail: `The ${amount} deposit is paid${invoice.number ? ` (${invoice.number})` : ""}.`, by: null });
      else items.push({ key: "deposit", label: "Deposit", state: "todo", detail: `The ${amount} deposit${invoice.number ? ` on ${invoice.number}` : ""} has not been paid yet${invoice.totals.processingCents > 0 ? "; a payment is still processing" : ""}.`, by: "customer" });
    }
  }

  // 5. A time, inside the company's rules, with capacity.
  const slot = opportunity.timing?.slot ?? null;
  const postalCode = property?.address.postalCode ?? (known(opportunity.facts, "postalCode") ? String(factOf(opportunity.facts, "postalCode")!.value) : "");
  let need: Need | null = null;
  let capacity: SlotAnswer | null = null;
  let hold: Doc<"salesHolds"> | null = null;
  let onlyCapacity = false;
  if (!slot) items.push({ key: "time", label: "Time and capacity", state: "todo", detail: "No time has been chosen yet.", by: "customer" });
  else if (!version) items.push({ key: "time", label: "Time and capacity", state: "todo", detail: `${whenWords(slot, tz)} was requested. It is checked once the quote is accepted.`, by: null });
  else {
    const service = await publishedByKey(ctx as QueryCtx, company._id, version.serviceKey);
    need = { serviceName: version.serviceName, skills: service?.version.spec.team.skills ?? [], crew: version.crewSize, postalCode };
    hold = await liveHold(ctx, opportunity, now);
    const rule = ruleProblem(company, need, slot, now);
    if (rule) items.push({ key: "time", label: "Time and capacity", state: "blocked", detail: `${whenWords(slot, tz)}: ${rule} Choose another time.`, by: "customer" });
    else if (!service || service.service.status !== "active") items.push({ key: "time", label: "Time and capacity", state: "blocked", detail: `${version.serviceName} is no longer offered, so this cannot be booked as quoted. Review the quote.`, by: "owner" });
    else {
      capacity = await checkSlot(ctx, company, need, slot, { opportunityId: opportunity._id });
      if (capacity.ok) items.push({ key: "time", label: "Time and capacity", state: "done", detail: `${whenWords(slot, tz)} is open${hold ? ` and reserved until ${clock(hold.expiresAt, tz)}` : ""}. It is checked once more at the moment of booking.`, by: null });
      else {
        onlyCapacity = true;
        items.push({ key: "time", label: "Time and capacity", state: "blocked", detail: `${whenWords(slot, tz)} cannot be confirmed. ${capacity.reasons.join(" ")}`, by: "owner" });
      }
    }
  }

  const before = items.filter((item) => item.state === "todo" || item.state === "blocked");
  const ready = before.length === 0;
  items.push({ key: "confirmation", label: "Customer confirmation", state: opportunity.jobId ? "done" : "todo", detail: opportunity.jobId ? "The booking was made and the confirmation was prepared." : ready ? "Ready: Sales prepares the confirmation as the booking is made." : "Prepared once everything above is done.", by: opportunity.jobId ? null : "sales" });
  return {
    items,
    ready,
    onlyCapacity: onlyCapacity && before.length === 1,
    blockers: before.map((item) => item.detail),
    facts: { quote, version, property, slot, need, capacity, hold },
  };
}

export type Booked = { ok: true; jobId: Id<"jobs">; already: boolean } | { ok: false; blockers: string[] };

/**
 * Makes the booking: one job, once. Everything is checked again here, capacity included, in the same
 * transaction that writes the job, so two bookings cannot both take the last opening. `override` is a
 * person confirming without verified capacity; it is recorded as theirs, with their reason, and it
 * waives nothing else.
 */
export async function confirmBooking(ctx: MutationCtx, company: Doc<"companies">, opportunity: Doc<"salesOpportunities">, actor: Actor, options: { override?: { by: Id<"members">; reason: string } } = {}): Promise<Booked> {
  if (opportunity.jobId) return { ok: true, jobId: opportunity.jobId, already: true };
  const readiness = await bookingReadiness(ctx, company, opportunity);
  const { quote, version, property, slot } = readiness.facts;
  const overridden = !readiness.ready && readiness.onlyCapacity && options.override !== undefined && options.override.reason.trim().length >= 3;
  if ((!readiness.ready && !overridden) || !quote || !version || !property || !slot) return { ok: false, blockers: readiness.blockers.length ? readiness.blockers : ["The booking is not ready."] };

  const access = property.accessInstructions?.trim() || (known(opportunity.facts, "access") ? String(factOf(opportunity.facts, "access")!.value) : "");
  const notes = [
    `Booked from quote Q-${quote.number}, version ${version.version}: ${formatCents(version.totalCents)} per ${version.per}${version.frequency ? `, ${version.frequency.toLowerCase()}` : ""}.`,
    version.extras.length ? `Extras agreed: ${version.extras.map((extra) => `${extra.label}${extra.quantity > 1 ? ` × ${extra.quantity}` : ""}`).join(", ")}.` : "",
    access ? `Access: ${access}` : "",
    known(opportunity.facts, "pets") ? `Pets: ${String(factOf(opportunity.facts, "pets")!.value)}` : "",
    version.note ? `Note to the customer on the quote: ${version.note}` : "",
  ].filter(Boolean);
  const jobId = await createJob(ctx, company, actor, {
    customerId: opportunity.customerId,
    propertyId: property._id,
    serviceId: version.serviceKey,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    requiredCrew: version.crewSize,
    instructions: notes.join("\n").slice(0, 4000),
    sales: { opportunityId: opportunity._id, quoteId: quote._id, quoteVersion: version.version, pricingQuoteId: version.pricingQuoteId, serviceVersionId: version.serviceVersionId, serviceVersion: version.serviceVersion, priceCents: version.priceCents - (version.discount?.cents ?? 0), durationMinutes: version.durationMinutes },
  });
  const now = Date.now();
  await releaseHolds(ctx, opportunity, "converted", jobId);
  await ctx.db.patch(opportunity._id, { jobId, booking: { ...opportunity.booking, ...(overridden ? { override: { by: options.override!.by, reason: options.override!.reason.trim().slice(0, 500), at: now } } : {}) }, nextAction: undefined, updatedAt: now });
  await recordEvent(ctx, { companyId: company._id, type: "opportunity.booked", actor, subject: { table: "salesOpportunities", id: opportunity._id }, data: { jobId, quoteVersion: version.version, totalCents: version.totalCents, capacityVerified: !overridden } });
  await setStage(ctx, (await ctx.db.get(opportunity._id))!, "won", actor, { booked: true });
  return { ok: true, jobId, already: false };
}
