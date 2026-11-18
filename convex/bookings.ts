/**
 * Bookings: the request to perform service, and what must be true before it is confirmed.
 *
 * A booking is not a quote, an invoice, an agreement or a job. It links to each and keeps its own
 * requirements, each with its own state:
 *  - schedule: crew held for the time (convex/lib/sales/capacity.ts), or a proposed time not yet held;
 *  - payment: what is due up front, paid only when Finance records a payment (never because staff chose
 *    cash or "paid outside Selestial");
 *  - agreement: signed by the customer through their own link, when the booking needs one;
 *  - a changed price: approved by the Owner unless the Owner made it.
 *
 * Confirmation happens when every requirement is met, by a person or on its own when the last
 * requirement is met (a payment arrives, the customer signs). It re-checks capacity in the same
 * transaction: a payment that arrives after the hold lapsed does not book a time someone else took; the
 * booking goes back to staff as a conflict with the money kept on the invoice. Confirming hands the work
 * to Dispatch through a step that is retried until it is done, so closing the browser interrupts nothing.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requestApproval } from "./lib/approvalQueue";
import { owned } from "./lib/access";
import { createAgreement } from "./lib/agreements/store";
import { startRequest } from "./lib/agreements/signingStore";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { payToken, payUrl } from "./lib/finance/payLinks";
import { isManager, isOwner } from "./lib/roles";
import { cadenceLabel, cadenceProblem } from "./lib/sales/cadence";
import { checkCapacity, expireHolds, holdCapacity, liveHold, releaseHolds } from "./lib/sales/capacity";
import type { DraftBody } from "./lib/sales/draft";
import { issueBookingInvoice, paidUpFront } from "./lib/sales/invoices";
import { channelFor, queueSalesMessage } from "./lib/sales/outbox";
import { createPlanFromBooking } from "./lib/sales/plans";
import { priceBooking, type PricedVisit } from "./lib/sales/pricing";
import type { AgreementState, PaymentState, ScheduleState } from "./lib/sales/schema";
import { createVisit } from "./lib/sales/visits";
import { saveQuote } from "./lib/services/operations";
import { publishedByKey } from "./lib/services/store";
import { formatCents } from "./lib/services/words";
import { businessSettingsOf, checkArea } from "./lib/settings/business";
import { openTask } from "./lib/taskState";
import { optionalText } from "./lib/text";
import { setMilestone } from "./sales";
import { internalMutation } from "./_generated/server";

type MemberCtx = MutationCtx & MemberAccess;

const DAY = 86_400_000;
const FREQUENCY_TERM: Record<string, string> = { weekly: "weekly", every_2_weeks: "every two weeks", every_4_weeks: "every four weeks", monthly: "monthly" };

/** What still stands between this booking and confirmation, in words. Empty means it can be confirmed. */
export function blockers(booking: Doc<"bookings">, invoice: Doc<"invoices"> | null, hold: Doc<"capacityHolds"> | null): string[] {
  const out: string[] = [];
  if (booking.status === "cancelled") return ["The booking was cancelled."];
  if (booking.status === "confirmed") return [];
  if (booking.override && booking.override.state !== "approved") out.push(booking.override.state === "declined" ? "The changed price was declined." : "The changed price is waiting for the Owner's approval.");
  if (booking.slot.proposed) out.push("The time is only proposed: confirm a time with the customer.");
  else if (!hold && booking.requirements.schedule.state !== "held") out.push("No crew is held for this time.");
  const pay = booking.requirements.payment;
  if (pay.state === "approval_needed") out.push("The payment link is waiting for an Owner or Manager.");
  else if (!paidUpFront(booking, invoice)) out.push(pay.policy === "deposit" ? `The deposit of ${formatCents(pay.dueNowCents)} hasn't been paid.` : `Payment of ${formatCents(pay.dueNowCents)} hasn't been received.`);
  const agreement = booking.requirements.agreement;
  if (agreement.state !== "not_required" && agreement.state !== "signed") out.push(agreement.state === "declined" ? "The customer declined the agreement." : "The customer hasn't signed the agreement.");
  return out;
}

// ── Requesting a booking ─────────────────────────────────────────────────────────────────────────

async function saveVisitQuote(ctx: MemberCtx, priced: PricedVisit) {
  const found = (await publishedByKey(ctx, ctx.companyId, priced.serviceKey))!;
  return saveQuote(ctx, { companyId: ctx.companyId, service: found.service, version: found.version, quoteInput: priced.input, result: priced.quote, purpose: "sales", actor: byMember(ctx) });
}

/**
 * Turns the draft into a booking request. Priced on the server again, the area and hours checked, crew
 * held for the time (unless it is only proposed), the invoice issued and the agreement started when the
 * booking needs them. Asked twice for the same draft revision, it answers with the same booking.
 */
export const request = companyMutation({
  args: { draftId: v.id("salesDrafts"), revision: v.number(), sendLinks: v.boolean() },
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args.draftId);
    const key = `draft:${draft._id}:${args.revision}`;
    const again = await ctx.db
      .query("bookings")
      .withIndex("by_company_key", (q) => q.eq("companyId", ctx.companyId).eq("idempotencyKey", key))
      .unique();
    if (again) return { bookingId: again._id, repeated: true };
    if (draft.revision !== args.revision) throw userError("The draft changed since the summary was shown. Review it again.");
    if (draft.mode !== "booking") throw userError("This draft is a proposal. Send it as a proposal.");
    if (draft.bookingId) {
      const existing = await ctx.db.get(draft.bookingId);
      if (existing && existing.status !== "cancelled") throw userError("This draft already has a booking. Open it instead of booking again.");
    }
    if (!draft.customerId || !draft.propertyId) throw userError("Choose the customer and the service address.");
    const customer = await owned(ctx, draft.customerId);
    const property = await owned(ctx, draft.propertyId);
    if (property.customerId !== customer._id) throw userError("That address belongs to a different customer.");
    checkArea(businessSettingsOf(ctx.company), property.address.postalCode);
    const body = draft.body as DraftBody;
    const recurring = draft.bookingKind === "recurring";
    if (recurring) {
      const cadence = body.recurring?.cadence;
      if (!cadence) throw userError("Choose how often the service repeats.");
      const problem = cadenceProblem(cadence);
      if (problem) throw userError(problem);
    }
    const pricing = await priceBooking(ctx, ctx.company, body, draft.bookingKind, property.address.postalCode);
    if (!pricing.visit) throw userError("Choose a published service.");
    for (const priced of [pricing.visit, pricing.first]) {
      if (!priced) continue;
      if (priced.quote.outcome === "incomplete") throw userError(`The price needs: ${priced.quote.missing.join(", ")}.`);
      if (priced.quote.outcome === "walkthrough" || priced.quote.totalCents === null) throw userError(`${priced.quote.reasons.join(" ")} Prepare a proposal or schedule an assessment instead.`);
    }
    if (pricing.startsAt === null || pricing.endsAt === null || pricing.crew === null || pricing.firstCents === null) throw userError("Choose the date and arrival time.");
    if (pricing.startsAt < Date.now()) throw userError("That time has already passed.");
    const policy = body.payment?.policy;
    if (!policy) throw userError("Choose how the customer pays.");
    if (policy === "deposit" && (pricing.dueNowCents === null || pricing.dueNowCents <= 0 || pricing.dueNowCents >= pricing.firstCents)) throw userError("Enter a deposit above $0 and below the first visit's price.");
    if (pricing.override && !pricing.override.reason) throw userError("Give a reason for the changed price.");

    const serviceQuoteId = await saveVisitQuote(ctx, pricing.visit);
    const firstQuoteId = pricing.first ? await saveVisitQuote(ctx, pricing.first) : null;
    const owner = isOwner(ctx.role);
    const overrideState = pricing.override ? (owner ? ("approved" as const) : ("waiting" as const)) : null;
    const dueNow = policy === "deposit" || policy === "full" ? (pricing.dueNowCents ?? 0) : 0;
    const proposed = body.schedule?.proposed === true;
    const now = Date.now();
    const bookingId = await ctx.db.insert("bookings", {
      companyId: ctx.companyId,
      draftId: draft._id,
      ...(draft.opportunityId ? { opportunityId: draft.opportunityId } : {}),
      ...(draft.quoteId ? { quoteId: draft.quoteId } : {}),
      customerId: customer._id,
      propertyId: property._id,
      kind: draft.bookingKind,
      status: "requested",
      idempotencyKey: key,
      serviceKey: pricing.visit.serviceKey,
      versionId: pricing.visit.versionId,
      quoteInput: pricing.visit.input,
      serviceQuoteId,
      // The ongoing visit's price; a different first visit, or a changed first price, is on `first`.
      priceCents: recurring ? pricing.visit.quote.totalCents! : pricing.firstCents,
      ...(pricing.first && firstQuoteId
        ? { first: { serviceKey: pricing.first.serviceKey, versionId: pricing.first.versionId, quoteInput: pricing.first.input, serviceQuoteId: firstQuoteId, priceCents: pricing.firstCents } }
        : recurring && pricing.firstCents !== pricing.visit.quote.totalCents
          ? { first: { serviceKey: pricing.visit.serviceKey, versionId: pricing.visit.versionId, quoteInput: pricing.visit.input, serviceQuoteId, priceCents: pricing.firstCents } }
          : {}),
      slot: { startsAt: pricing.startsAt, endsAt: pricing.endsAt, arrivalWindowMinutes: Math.max(0, Math.min(body.schedule?.windowMinutes ?? 60, 720)), crew: pricing.crew, proposed },
      ...(recurring && body.recurring?.cadence ? { recurring: { cadence: body.recurring.cadence, ...(body.recurring.endDate ? { endDate: body.recurring.endDate } : {}), billing: body.recurring.billing ?? "per_visit" } } : {}),
      requirements: {
        payment: { policy, dueNowCents: dueNow, state: policy === "deposit" || policy === "full" ? "link_needed" : "not_required" },
        agreement: { state: body.agreement?.required ? "to_send" : "not_required", ...(body.agreement?.required && body.agreement.docType ? { docType: body.agreement.docType } : {}) },
        schedule: { state: proposed ? "proposed" : "held" },
      },
      ...(pricing.override && overrideState ? { override: { referenceCents: pricing.override.referenceCents, proposedCents: pricing.override.proposedCents, reason: pricing.override.reason, state: overrideState } } : {}),
      instructions: { customer: optionalText(body.notes?.customer, "Customer note", 2000), cleaner: optionalText(body.notes?.cleaner, "Access notes", 2000), office: optionalText(body.notes?.office, "Office note", 2000) },
      ...(body.schedule?.preferredCleanerId ? { preferredCleanerId: (await owned(ctx, body.schedule.preferredCleanerId as Id<"cleaners">))._id } : {}),
      handoff: { state: "not_started", attempts: 0 },
      createdBy: ctx.member._id,
      createdAt: now,
      updatedAt: now,
    });
    let booking = (await ctx.db.get(bookingId))!;

    // The time: held now in the same transaction as the check, or carried as a proposal.
    if (!proposed) {
      const held = await holdCapacity(ctx, ctx.company, { bookingId, startsAt: booking.slot.startsAt, endsAt: booking.slot.endsAt, crew: booking.slot.crew });
      if (!held.ok) throw userError(`${held.answer.why} Choose another time, or send it as a proposed date.`);
      await patchRequirement(ctx, booking, "schedule", { state: "held", holdId: held.holdId });
    }

    // A changed price made by someone other than the Owner waits for the Owner.
    if (overrideState === "waiting") {
      const approvalId = await requestApproval(ctx, {
        companyId: ctx.companyId,
        action: "sales.discount_out_of_band",
        summary: `Change ${customer.name}'s price to ${formatCents(pricing.override!.proposedCents)} (calculated ${pricing.override!.referenceCents !== null ? formatCents(pricing.override!.referenceCents) : "—"})`,
        reason: pricing.override!.reason,
        decideBy: Math.min(now + 2 * DAY, booking.slot.startsAt),
        authorizes: "Charging this booking's first visit at the changed price, and sending the customer its payment link.",
        ifWaiting: "Nothing is sent and the booking is not confirmed.",
        proposal: { kind: "sales_price_override", bookingId },
        about: { table: "customers", id: customer._id },
      });
      booking = (await ctx.db.get(bookingId))!;
      await ctx.db.patch(bookingId, { override: { ...booking.override!, approvalId } });
    }

    // Payment up front: Owners and Managers issue the link now; Office asks an Owner or Manager first.
    booking = (await ctx.db.get(bookingId))!;
    if (booking.requirements.payment.state === "link_needed" && overrideState !== "waiting") {
      if (isManager(ctx.role)) await issueAndSend(ctx, booking, ctx.member._id, args.sendLinks, byMember(ctx));
      else await askForPaymentLink(ctx, booking, customer);
    }

    // The agreement: started from the company's terms with what the booking already knows.
    booking = (await ctx.db.get(bookingId))!;
    if (booking.requirements.agreement.state === "to_send") {
      const agreementId = await startAgreement(ctx, booking, pricing, body);
      await patchRequirement(ctx, (await ctx.db.get(bookingId))!, "agreement", { state: "to_send", agreementId, docType: booking.requirements.agreement.docType });
    }

    await ctx.db.patch(draft._id, { bookingId, status: "requested", updatedAt: Date.now() });
    await setMilestone(ctx, draft.opportunityId, "booking_requested", "Wait for payment and signature, then confirm");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking.requested", actor: byMember(ctx), subject: { table: "bookings", id: bookingId }, data: { kind: draft.bookingKind, firstCents: pricing.firstCents, proposed } });
    await refreshStatus(ctx, bookingId);
    return { bookingId, repeated: false };
  },
});

async function patchRequirement<K extends keyof Doc<"bookings">["requirements"]>(ctx: MutationCtx, booking: Doc<"bookings">, key: K, value: Doc<"bookings">["requirements"][K]) {
  await ctx.db.patch(booking._id, { requirements: { ...booking.requirements, [key]: value }, updatedAt: Date.now() });
}

async function askForPaymentLink(ctx: MemberCtx, booking: Doc<"bookings">, customer: Doc<"customers">) {
  const approvalId = await requestApproval(ctx, {
    companyId: ctx.companyId,
    action: "sales.reply_and_quote",
    summary: `Send ${customer.name} a payment link for ${formatCents(booking.requirements.payment.dueNowCents)}`,
    reason: `${ctx.member.name} took this booking and asked for the ${booking.requirements.payment.policy === "deposit" ? "deposit" : "payment"} link to go out.`,
    decideBy: Math.min(Date.now() + DAY, booking.slot.startsAt),
    authorizes: "Issuing the booking's invoice at its server-calculated price and sending the customer its secure payment link.",
    ifWaiting: "The link isn't sent and the booking can't be confirmed.",
    proposal: { kind: "sales_payment_link", bookingId: booking._id },
    about: { table: "customers", id: customer._id },
  });
  await patchRequirement(ctx, booking, "payment", { ...booking.requirements.payment, state: "approval_needed", approvalId });
}

/** Issues the booking's invoice and, when asked, sends the customer the link. Never marks it paid. */
async function issueAndSend(ctx: MutationCtx, booking: Doc<"bookings">, by: Id<"members">, send: boolean, actor: Actor) {
  const invoice = await issueBookingInvoice(ctx, booking, by);
  await ctx.db.patch(booking._id, { invoiceId: invoice._id, requirements: { ...booking.requirements, payment: { ...booking.requirements.payment, state: "awaiting", approvalId: undefined } }, updatedAt: Date.now() });
  if (send) await sendBookingRequest(ctx, (await ctx.db.get(booking._id))!, actor);
}

async function sendBookingRequest(ctx: MutationCtx, booking: Doc<"bookings">, actor: Actor) {
  const company = (await ctx.db.get(booking.companyId))!;
  const customer = (await ctx.db.get(booking.customerId))!;
  const version = await ctx.db.get(booking.first?.versionId ?? booking.versionId);
  const when = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(booking.slot.startsAt));
  const pay = booking.requirements.payment;
  const lines = [
    `Hi ${customer.name.split(" ")[0] || "there"},`,
    "",
    `Thanks for booking with ${company.name}. Here is what we have for you:`,
    `${version?.spec.name ?? "Cleaning"}${booking.slot.proposed ? ", proposed for" : ","} ${when}.`,
    `${booking.kind === "recurring" ? "First visit" : "Price"}: ${formatCents(booking.first?.priceCents ?? booking.priceCents)}.`,
  ];
  if (booking.kind === "recurring") lines.push(`Each visit after: ${formatCents(booking.priceCents)}.`);
  const links: { placeholder: string; kind: "pay"; id: string }[] = [];
  if (booking.invoiceId && (pay.policy === "deposit" || pay.policy === "full")) {
    lines.push("", `To hold your appointment, please pay ${pay.policy === "deposit" ? `the ${formatCents(pay.dueNowCents)} deposit` : formatCents(pay.dueNowCents)} here:`, "{pay}");
    links.push({ placeholder: "{pay}", kind: "pay", id: booking.invoiceId });
  }
  if (booking.requirements.agreement.state !== "not_required") lines.push("", "We'll also send you the service agreement to review and sign.");
  if (booking.instructions?.customer) lines.push("", booking.instructions.customer);
  lines.push("", "Your booking is confirmed once everything above is done. We'll let you know.");
  await queueSalesMessage(ctx, { company, customer, purpose: "booking_request", channel: channelFor(customer), subject: `Your booking with ${company.name}`, body: lines.join("\n"), links, dedupeKey: `booking-request:${booking._id}`, actor });
}

async function startAgreement(ctx: MemberCtx, booking: Doc<"bookings">, pricing: Awaited<ReturnType<typeof priceBooking>>, body: DraftBody): Promise<Id<"agreements">> {
  const recurring = booking.kind === "recurring";
  const docType = booking.requirements.agreement.docType ?? (recurring ? "recurring_residential" : "one_time_residential");
  const cadence = body.recurring?.cadence;
  const terms: Record<string, string | number> = {
    serviceName: pricing.visit?.name ?? "",
    scopeSummary: (pricing.visit?.quote.includedScope ?? []).join("; ").slice(0, 2000),
    startDate: new Intl.DateTimeFormat("en-CA", { timeZone: ctx.company.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(booking.slot.startsAt)),
    pricePerVisitCents: booking.priceCents,
    visitDurationHours: Math.max(1, Math.round((booking.slot.endsAt - booking.slot.startsAt) / 3_600_000)),
  };
  if (!recurring) terms.frequency = "one time";
  else if (cadence && FREQUENCY_TERM[cadence.kind] && !(cadence.kind === "weekly" && cadence.weekdays.length > 1)) terms.frequency = FREQUENCY_TERM[cadence.kind]!;
  if (booking.requirements.payment.policy === "deposit") terms.depositCents = booking.requirements.payment.dueNowCents;
  return createAgreement(ctx, { docType, links: [{ table: "customers", id: booking.customerId }, { table: "properties", id: booking.propertyId }], terms, origin: "manual", note: "Started from a booking" } as never);
}

// ── Confirming ───────────────────────────────────────────────────────────────────────────────────

/**
 * Re-reads every requirement and moves the booking on: to "awaiting" while something is outstanding,
 * or confirmed when nothing is. A lapsed hold is re-checked against capacity now; if the time is gone,
 * staff are told and nothing is booked.
 */
async function refreshStatus(ctx: MutationCtx, bookingId: Id<"bookings">, by?: Actor): Promise<{ confirmed: boolean; blockers: string[] }> {
  let booking = (await ctx.db.get(bookingId))!;
  if (booking.status === "cancelled" || booking.status === "confirmed") return { confirmed: booking.status === "confirmed", blockers: [] };
  const invoice = booking.invoiceId ? await ctx.db.get(booking.invoiceId) : null;
  let hold = await liveHold(ctx, booking.companyId, booking._id);
  // Payment state follows Finance's record, never a choice in the form.
  if (booking.requirements.payment.state === "awaiting" && paidUpFront(booking, invoice)) {
    await patchRequirement(ctx, booking, "payment", { ...booking.requirements.payment, state: "paid" });
    booking = (await ctx.db.get(bookingId))!;
  }
  const others = blockers(booking, invoice, hold).filter((b) => b !== "No crew is held for this time.");
  if (others.length === 0 && !booking.slot.proposed && !hold) {
    // Everything else is done but the hold lapsed (for example the payment came late). Check the time again.
    const company = (await ctx.db.get(booking.companyId))!;
    const held = await holdCapacity(ctx, company, { bookingId, startsAt: booking.slot.startsAt, endsAt: booking.slot.endsAt, crew: booking.slot.crew, holdMinutes: 30 });
    if (!held.ok) {
      const problem = `Everything is done, but the time is no longer available: ${held.answer.why} Agree a new time with the customer. Any payment stays on the invoice.`;
      await ctx.db.patch(bookingId, { status: "awaiting", problem, requirements: { ...booking.requirements, schedule: { state: "conflict", why: held.answer.why } }, updatedAt: Date.now() });
      await openTask(ctx, { companyId: booking.companyId, agent: "sales", title: "A paid booking lost its time", nextAction: "Call the customer and agree a new time, then confirm the booking.", dueAt: Date.now() + 4 * 3_600_000, completionCondition: "The booking is confirmed for a new time, or cancelled.", about: { table: "customers", id: booking.customerId }, key: `booking-conflict:${bookingId}`, actor: { kind: "system" } });
      return { confirmed: false, blockers: [problem] };
    }
    await patchRequirement(ctx, booking, "schedule", { state: "held", holdId: held.holdId });
    booking = (await ctx.db.get(bookingId))!;
    hold = await liveHold(ctx, booking.companyId, booking._id);
  }
  const remaining = blockers(booking, invoice, hold);
  if (remaining.length) {
    await ctx.db.patch(bookingId, { status: "awaiting", updatedAt: Date.now() });
    return { confirmed: false, blockers: remaining };
  }
  await confirm(ctx, booking, by ?? { kind: "system" });
  return { confirmed: true, blockers: [] };
}

async function confirm(ctx: MutationCtx, booking: Doc<"bookings">, actor: Actor) {
  const now = Date.now();
  await releaseHolds(ctx, booking.companyId, booking._id, "consumed");
  await ctx.db.patch(booking._id, {
    status: "confirmed",
    problem: undefined,
    confirmedAt: now,
    confirmedBy: actor.kind === "member" ? actor.memberId : "system",
    requirements: { ...booking.requirements, schedule: { state: "confirmed" } },
    handoff: { state: "pending", attempts: 0 },
    updatedAt: now,
  });
  const draft = await ctx.db.get(booking.draftId);
  if (draft) await ctx.db.patch(draft._id, { status: "confirmed", updatedAt: now });
  await recordEvent(ctx, { companyId: booking.companyId, type: "booking.confirmed", actor, subject: { table: "bookings", id: booking._id } });
  // Handing the work to Dispatch is its own step, retried until done.
  await ctx.scheduler.runAfter(0, internal.bookings.handoff, { bookingId: booking._id });
}

/** Makes the visit (or the recurring plan and its first visits) and hands it to Dispatch. Safe to run again. */
export const handoff = internalMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await ctx.db.get(args.bookingId);
    if (!booking || booking.status !== "confirmed" || booking.handoff.state === "done") return null;
    const company = (await ctx.db.get(booking.companyId))!;
    const attempts = booking.handoff.attempts + 1;
    try {
      if (booking.kind === "one_time" && !booking.jobId) {
        const first = booking.first;
        const jobId = await createVisit(ctx, {
          company,
          customerId: booking.customerId,
          propertyId: booking.propertyId,
          versionId: first?.versionId ?? booking.versionId,
          serviceKey: first?.serviceKey ?? booking.serviceKey,
          serviceQuoteId: first?.serviceQuoteId ?? booking.serviceQuoteId,
          // The settled price: a changed price is already on the booking, and was approved before it got here.
          priceCents: first?.priceCents ?? booking.priceCents,
          startsAt: booking.slot.startsAt,
          endsAt: booking.slot.endsAt,
          crew: booking.slot.crew,
          arrivalWindowMinutes: booking.slot.arrivalWindowMinutes,
          instructions: booking.instructions?.cleaner,
          actor: { kind: "system" },
          from: "booking",
        });
        await ctx.db.patch(booking._id, { jobId });
        // The booking's invoice now belongs to the visit too, so Finance shows them together.
        if (booking.invoiceId) {
          const invoice = await ctx.db.get(booking.invoiceId);
          if (invoice && !invoice.jobId) await ctx.db.patch(invoice._id, { jobId });
        }
      }
      if (booking.kind === "recurring" && !booking.planId) {
        const planId = await createPlanFromBooking(ctx, company, booking);
        await ctx.db.patch(booking._id, { planId });
        // The first visit's invoice is the booking's, so Finance shows them together.
        const first = await ctx.db
          .query("planVisits")
          .withIndex("by_plan_date", (q) => q.eq("planId", planId))
          .first();
        if (booking.invoiceId && first?.jobId) {
          const invoice = await ctx.db.get(booking.invoiceId);
          if (invoice && !invoice.jobId) await ctx.db.patch(invoice._id, { jobId: first.jobId });
        }
      }
      await ctx.db.patch(booking._id, { handoff: { state: "done", attempts }, updatedAt: Date.now() });
      await setMilestoneSystem(ctx, booking, "service_activated");
      const customer = (await ctx.db.get(booking.customerId))!;
      const when = new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(booking.slot.startsAt));
      await queueSalesMessage(ctx, { company, customer, purpose: "booking_confirmed", channel: channelFor(customer), subject: `Booked: ${when}`, body: `Hi ${customer.name.split(" ")[0] || "there"},\n\nYou're booked with ${company.name} for ${when}. We'll send a reminder before the visit.`, links: [], dedupeKey: `booking-confirmed:${booking._id}`, actor: { kind: "system" } });
    } catch (caught) {
      const problem = caught instanceof Error ? caught.message.slice(0, 300) : "The handoff failed.";
      await ctx.db.patch(booking._id, { handoff: { state: "failed", attempts, problem }, updatedAt: Date.now() });
    }
    return null;
  },
});

async function setMilestoneSystem(ctx: MutationCtx, booking: Doc<"bookings">, milestone: "service_activated") {
  if (!booking.opportunityId) return;
  const opportunity = await ctx.db.get(booking.opportunityId);
  if (!opportunity) return;
  await ctx.db.patch(opportunity._id, { milestone, stage: "won", nextAction: undefined, nextActionAt: undefined, followUps: "stopped", updatedAt: Date.now() });
}

/** A person confirms the booking. Refused, with what is missing, unless every requirement is met. */
export const confirmNow = companyMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await owned(ctx, args.bookingId);
    if (booking.status === "confirmed") return { confirmed: true, blockers: [] };
    const result = await refreshStatus(ctx, booking._id, byMember(ctx));
    if (!result.confirmed) throw userError(`Not yet: ${result.blockers.join(" ")}`);
    return result;
  },
});

/** Turns a proposed time into a held one, or moves the booking to a new time. Checked against capacity now. */
export const setTime = companyMutation({
  args: { bookingId: v.id("bookings"), startsAt: v.number() },
  handler: async (ctx, args) => {
    const booking = await owned(ctx, args.bookingId);
    if (booking.status === "confirmed" || booking.status === "cancelled") throw userError("Move a confirmed visit from Dispatch.");
    const length = booking.slot.endsAt - booking.slot.startsAt;
    const held = await holdCapacity(ctx, ctx.company, { bookingId: booking._id, startsAt: args.startsAt, endsAt: args.startsAt + length, crew: booking.slot.crew });
    if (!held.ok) throw userError(held.answer.why);
    await ctx.db.patch(booking._id, { slot: { ...booking.slot, startsAt: args.startsAt, endsAt: args.startsAt + length, proposed: false }, requirements: { ...booking.requirements, schedule: { state: "held", holdId: held.holdId } }, problem: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking.time_set", actor: byMember(ctx), subject: { table: "bookings", id: booking._id } });
    return refreshStatus(ctx, booking._id, byMember(ctx));
  },
});

/** Sends the approved agreement to the customer to sign through their own link. */
export const sendAgreement = companyMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await owned(ctx, args.bookingId);
    const agreementId = booking.requirements.agreement.agreementId;
    if (!agreementId) throw userError("This booking has no agreement.");
    const agreement = await owned(ctx, agreementId);
    const requestId = await startRequest(ctx as never, agreement, {});
    await ctx.scheduler.runAfter(0, internal.agreementSigning.dispatch, { requestId });
    await patchRequirement(ctx, booking, "agreement", { ...booking.requirements.agreement, state: "sent" });
    await setMilestone(ctx, booking.opportunityId, "agreement_pending", "Wait for the customer to sign");
    return null;
  },
});

/** Sends (or re-sends) the booking request with its payment link. The link is made at the moment of sending. */
export const resend = companyMutation({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await owned(ctx, args.bookingId);
    if (booking.status === "cancelled") throw userError("This booking was cancelled.");
    if (booking.requirements.payment.state === "link_needed") {
      if (!isManager(ctx.role)) throw userError("An Owner or Manager sends payment links.");
      await issueAndSend(ctx, booking, ctx.member._id, true, byMember(ctx));
      return null;
    }
    const company = ctx.company;
    const customer = await owned(ctx, booking.customerId);
    await queueSalesMessage(ctx, { company, customer, purpose: "booking_request", channel: channelFor(customer), subject: `Your booking with ${company.name}`, body: "A reminder about your booking. Complete it here:\n{pay}", links: booking.invoiceId ? [{ placeholder: "{pay}", kind: "pay", id: booking.invoiceId }] : [], dedupeKey: `booking-resend:${booking._id}:${Date.now()}`, actor: byMember(ctx) });
    return null;
  },
});

export const cancel = companyMutation({
  args: { bookingId: v.id("bookings"), reason: v.string() },
  handler: async (ctx, args) => {
    const booking = await owned(ctx, args.bookingId);
    if (booking.status === "cancelled") return null;
    if (booking.status === "confirmed") throw userError("This booking is confirmed. Cancel the visit from Dispatch, or end the recurring plan.");
    const reason = optionalText(args.reason, "Reason", 500);
    if (!reason) throw userError("Say why the booking is cancelled.");
    await releaseHolds(ctx, ctx.companyId, booking._id, "released");
    await ctx.db.patch(booking._id, { status: "cancelled", cancelledReason: reason, updatedAt: Date.now() });
    const draft = await ctx.db.get(booking.draftId);
    if (draft) await ctx.db.patch(draft._id, { status: "open", bookingId: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "booking.cancelled", actor: byMember(ctx), subject: { table: "bookings", id: booking._id }, data: { reason } });
    const invoice = booking.invoiceId ? await ctx.db.get(booking.invoiceId) : null;
    return { invoiceStillOpen: Boolean(invoice && invoice.status === "open"), paidCents: invoice?.totals.paidCents ?? 0 };
  },
});

// ── Events from other modules ────────────────────────────────────────────────────────────────────

/** A payment, refund or credit changed an invoice: the booking it belongs to looks again. */
export const invoiceChanged = internalMutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_company_invoice", (q) => q.eq("companyId", invoice.companyId).eq("invoiceId", invoice._id))
      .take(5);
    for (const booking of rows) await refreshStatus(ctx, booking._id);
    return null;
  },
});

/** An agreement was signed or declined: the bookings waiting on it look again. */
export const agreementChanged = internalMutation({
  args: { agreementId: v.id("agreements") },
  handler: async (ctx, args) => {
    const agreement = await ctx.db.get(args.agreementId);
    if (!agreement) return null;
    for (const status of ["requested", "awaiting"] as const) {
      const rows = await ctx.db
        .query("bookings")
        .withIndex("by_company_status", (q) => q.eq("companyId", agreement.companyId).eq("status", status))
        .take(300);
      for (const booking of rows) {
        if (booking.requirements.agreement.agreementId !== agreement._id) continue;
        const state: AgreementState = agreement.workflow === "signed" ? "signed" : agreement.workflow === "declined" ? "declined" : booking.requirements.agreement.state;
        if (state !== booking.requirements.agreement.state) await patchRequirement(ctx, booking, "agreement", { ...booking.requirements.agreement, state });
        await refreshStatus(ctx, booking._id);
      }
    }
    return null;
  },
});

/** Carries out an approved Sales proposal from the approval queue, checking everything again. */
export async function afterSalesDecision(ctx: MutationCtx & MemberAccess, approval: Doc<"approvals">, decision: "approved" | "changed" | "skipped"): Promise<{ ok: boolean; detail: string; at: number }> {
  const at = Date.now();
  const proposal = approval.proposal;
  if (!proposal || (proposal.kind !== "sales_payment_link" && proposal.kind !== "sales_price_override")) return { ok: false, detail: "Not a booking decision.", at };
  const booking = await ctx.db.get(proposal.bookingId);
  if (!booking || booking.companyId !== ctx.companyId || booking.status === "cancelled" || booking.status === "confirmed") return { ok: false, detail: "The booking is no longer waiting for this.", at };
  if (proposal.kind === "sales_price_override") {
    if (!booking.override || booking.override.approvalId !== approval._id) return { ok: false, detail: "The price on the booking changed since this was asked.", at };
    const state = decision === "approved" ? ("approved" as const) : ("declined" as const);
    await ctx.db.patch(booking._id, { override: { ...booking.override, state }, updatedAt: at });
    if (state === "approved") {
      const fresh = (await ctx.db.get(booking._id))!;
      // Approving the price covers sending its payment link. The booking already carries the changed price.
      if (fresh.requirements.payment.state === "link_needed") await issueAndSend(ctx, fresh, ctx.member._id, true, byMember(ctx));
    }
    await refreshStatus(ctx, booking._id, byMember(ctx));
    return { ok: true, detail: state === "approved" ? "The price was approved." : "The price change was declined; the booking keeps waiting.", at };
  }
  if (decision !== "approved") {
    await patchRequirement(ctx, booking, "payment", { ...booking.requirements.payment, state: "link_needed", approvalId: undefined });
    return { ok: true, detail: "The link was not sent.", at };
  }
  await issueAndSend(ctx, booking, ctx.member._id, true, byMember(ctx));
  await refreshStatus(ctx, booking._id, byMember(ctx));
  return { ok: true, detail: "The invoice was issued and the payment link sent.", at };
}

// ── The sweep ────────────────────────────────────────────────────────────────────────────────────

/** Expires lapsed holds, marks bookings whose time lapsed, and retries handoffs to Dispatch. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    await expireHolds(ctx, now);
    for (const state of ["pending", "failed"] as const) {
      const rows = await ctx.db
        .query("bookings")
        .withIndex("by_handoff", (q) => q.eq("handoff.state", state).lt("updatedAt", now - 60_000))
        .take(50);
      for (const booking of rows) if (booking.handoff.attempts < 10) await ctx.scheduler.runAfter(0, internal.bookings.handoff, { bookingId: booking._id });
    }
    return null;
  },
});

// ── Reading ──────────────────────────────────────────────────────────────────────────────────────

const PAYMENT_WORDS: Record<PaymentState, string> = { not_required: "Nothing due up front", link_needed: "Payment link not sent", awaiting: "Waiting for payment", paid: "Paid", failed: "Payment failed", approval_needed: "Link waiting for approval" };
const AGREEMENT_WORDS: Record<AgreementState, string> = { not_required: "No agreement needed", to_send: "Agreement to send", sent: "Waiting for signature", signed: "Signed", declined: "Declined" };
const SCHEDULE_WORDS: Record<ScheduleState, string> = { proposed: "Proposed time", held: "Time held", confirmed: "Confirmed", expired: "Hold expired", conflict: "Time no longer available" };

export const get = companyQuery({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, args) => {
    const booking = await owned(ctx, args.bookingId);
    const invoice = booking.invoiceId ? await ctx.db.get(booking.invoiceId) : null;
    const hold = await liveHold(ctx, ctx.companyId, booking._id);
    const agreement = booking.requirements.agreement.agreementId ? await ctx.db.get(booking.requirements.agreement.agreementId) : null;
    const token = invoice && isManager(ctx.role) ? await payToken(invoice) : null;
    return {
      booking,
      blockers: blockers(booking, invoice, hold),
      hold: hold ? { expiresAt: hold.expiresAt } : null,
      payment: { words: PAYMENT_WORDS[booking.requirements.payment.state], invoiceNumber: invoice?.number ?? null, paidCents: invoice?.totals.paidCents ?? 0, payUrl: token ? payUrl(token) : null },
      agreement: agreement ? { words: AGREEMENT_WORDS[booking.requirements.agreement.state], title: agreement.title, workflow: agreement.workflow, id: agreement._id } : { words: AGREEMENT_WORDS[booking.requirements.agreement.state], title: null, workflow: null, id: null },
      schedule: { words: SCHEDULE_WORDS[booking.requirements.schedule.state] },
    };
  },
});

export const forDraft = companyQuery({
  args: { draftId: v.id("salesDrafts") },
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args.draftId);
    if (!draft.bookingId) return null;
    const booking = await ctx.db.get(draft.bookingId);
    if (!booking || booking.companyId !== ctx.companyId) return null;
    const invoice = booking.invoiceId ? await ctx.db.get(booking.invoiceId) : null;
    const hold = await liveHold(ctx, ctx.companyId, booking._id);
    const agreement = booking.requirements.agreement.agreementId ? await ctx.db.get(booking.requirements.agreement.agreementId) : null;
    return {
      _id: booking._id,
      status: booking.status,
      kind: booking.kind,
      blockers: blockers(booking, invoice, hold),
      problem: booking.problem ?? null,
      payment: { state: booking.requirements.payment.state, words: PAYMENT_WORDS[booking.requirements.payment.state], invoiceId: invoice?._id ?? null, number: invoice?.number ?? null, paidCents: invoice?.totals.paidCents ?? 0 },
      agreement: { state: booking.requirements.agreement.state, words: AGREEMENT_WORDS[booking.requirements.agreement.state], id: agreement?._id ?? null, workflow: agreement?.workflow ?? null },
      schedule: { state: booking.requirements.schedule.state, words: SCHEDULE_WORDS[booking.requirements.schedule.state], startsAt: booking.slot.startsAt, proposed: booking.slot.proposed, holdExpiresAt: hold?.expiresAt ?? null },
      override: booking.override ?? null,
      jobId: booking.jobId ?? null,
      planId: booking.planId ?? null,
      handoff: booking.handoff,
      cadence: null as string | null,
    };
  },
});

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("bookings")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(100);
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      const invoice = row.invoiceId ? await ctx.db.get(row.invoiceId) : null;
      out.push({ _id: row._id, draftId: row.draftId, customer: customer?.name ?? "Customer", kind: row.kind, status: row.status, startsAt: row.slot.startsAt, priceCents: row.first?.priceCents ?? row.priceCents, blockers: blockers(row, invoice, null).filter((b) => b !== "No crew is held for this time."), createdAt: row.createdAt });
    }
    return out;
  },
});

export { cadenceLabel, checkCapacity };

/** Nobody decided on sending an Office member's payment link in time: the booking says so again. */
export async function afterSalesExpiry(ctx: MutationCtx, approval: Doc<"approvals">) {
  if (approval.proposal?.kind !== "sales_payment_link") return;
  const booking = await ctx.db.get(approval.proposal.bookingId);
  if (!booking || booking.requirements.payment.approvalId !== approval._id) return;
  await patchRequirement(ctx, booking, "payment", { ...booking.requirements.payment, state: "link_needed", approvalId: undefined });
}
