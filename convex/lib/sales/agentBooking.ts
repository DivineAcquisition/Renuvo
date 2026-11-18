/**
 * From an accepted quote to a booking the company can fulfil, as the Sales agent sees it.
 *
 * `bookingReadiness` is the checklist a person sees and the gate the agent goes through, read from the
 * record every time: the address and how the team gets in, the accepted quote, a chosen time with
 * capacity, and, once the booking request exists, what the booking itself still waits for (payment,
 * agreement, the hold). Nothing in it is a model's opinion.
 *
 * The booking itself is main's (convex/bookings.ts `requestFromAgent`): the same request, capacity hold,
 * payment and agreement steps, confirmation and handoff to Dispatch a person's booking goes through.
 * Confirmation never says a cleaner is confirmed: that is Dispatch's record.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent } from "../events";
import { clock, dayName } from "../time";
import { retireOpenActions } from "./actions";
import { SYSTEM, load, syncTask, type Opp } from "./agentOpportunity";
import { stopFollowUps } from "./agentFollowUps";
import { checkCapacity, liveHold } from "./capacity";
import { factOf, known } from "./facts";
import { quoteTotal } from "./agentQuotes";
import { formatCents } from "../services/words";

type Ctx = QueryCtx | MutationCtx;

export type ReadinessKey = "details" | "quote" | "time" | "payment" | "agreement" | "confirmation";
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
  /** Everything needed to request the booking is in place. */
  ready: boolean;
  blockers: string[];
  booking: Doc<"bookings"> | null;
  quote: Doc<"salesQuotes"> | null;
  slot: { startsAt: number; endsAt: number } | null;
};

export function whenWords(span: { startsAt: number }, timezone: string): string {
  return `${dayName(span.startsAt, timezone)} at ${clock(span.startsAt, timezone)}`;
}

/** The booking checklist, from the record as it is now. */
export async function bookingReadiness(ctx: Ctx, company: Doc<"companies">, opportunity: Opp, now = Date.now()): Promise<Readiness> {
  const items: ReadinessItem[] = [];
  const tz = company.timezone;
  const quote = opportunity.quoteId ? await ctx.db.get(opportunity.quoteId) : null;
  const property = opportunity.propertyId ? await ctx.db.get(opportunity.propertyId) : null;
  const booking = opportunity.bookingId ? await ctx.db.get(opportunity.bookingId) : null;
  const facts = opportunity.agent.facts;

  // 1. The details the visit needs.
  const access = property?.accessInstructions?.trim() || (known(facts, "access") ? String(factOf(facts, "access")!.value) : "");
  if (!property) items.push({ key: "details", label: "Required details", state: "todo", detail: "The service address is not on record yet.", by: "customer" });
  else if (!access) items.push({ key: "details", label: "Required details", state: "todo", detail: "How the team gets in is not recorded yet.", by: "customer" });
  else items.push({ key: "details", label: "Required details", state: "done", detail: `${property.address.line1}, ${property.address.city}. Access is on record.`, by: null });

  // 2. The quote, accepted.
  if (!quote) items.push({ key: "quote", label: "Quote accepted", state: "todo", detail: "No quote has been prepared.", by: "sales" });
  else if (quote.status !== "accepted" || !quote.acceptance) items.push({ key: "quote", label: "Quote accepted", state: "todo", detail: quote.status === "sent" ? "The customer has the quote and has not accepted it yet." : `The quote is ${quote.status.replace(/_/g, " ")}.`, by: quote.status === "sent" ? "customer" : "sales" });
  else items.push({ key: "quote", label: "Quote accepted", state: "done", detail: `${quote.acceptance.name} accepted ${formatCents(quoteTotal(quote))} on ${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(quote.acceptance.at))}.`, by: null });

  // 3. A time, inside the company's hours, with capacity. Once booked, the booking's own hold says.
  const slot = booking ? { startsAt: booking.slot.startsAt, endsAt: booking.slot.endsAt } : (opportunity.timing?.slot ?? null);
  if (!slot) items.push({ key: "time", label: "Time and capacity", state: "todo", detail: "No time has been chosen yet.", by: "customer" });
  else if (booking) {
    const hold = await liveHold(ctx, company._id, booking._id);
    const state = booking.requirements.schedule.state;
    if (booking.status === "confirmed") items.push({ key: "time", label: "Time and capacity", state: "done", detail: `${whenWords(slot, tz)} is booked.`, by: null });
    else if (state === "conflict") items.push({ key: "time", label: "Time and capacity", state: "blocked", detail: `${whenWords(slot, tz)} is no longer open. ${booking.requirements.schedule.why ?? ""}`.trim(), by: "owner" });
    else items.push({ key: "time", label: "Time and capacity", state: "done", detail: `${whenWords(slot, tz)}${hold ? `, held until ${clock(hold.expiresAt, tz)}` : ""}. Checked again when the booking is confirmed.`, by: null });
  } else if (slot.startsAt <= now) items.push({ key: "time", label: "Time and capacity", state: "blocked", detail: `${whenWords(slot, tz)} has already passed. Choose another time.`, by: "customer" });
  else {
    const crew = (quote?.snapshot as { crew?: number | null } | null)?.crew ?? 1;
    const answer = await checkCapacity(ctx, company, slot, crew);
    if (answer.state === "fits" || answer.state === "tight") items.push({ key: "time", label: "Time and capacity", state: "done", detail: `${whenWords(slot, tz)} is open. It is held when the booking is requested.`, by: null });
    else items.push({ key: "time", label: "Time and capacity", state: "blocked", detail: `${whenWords(slot, tz)} cannot be confirmed. ${answer.why}`, by: "customer" });
  }

  // 4–5. What the booking itself waits for, once requested.
  if (booking) {
    const pay = booking.requirements.payment;
    if (pay.state === "not_required") items.push({ key: "payment", label: "Payment up front", state: "not_required", detail: "Nothing is due before the visit.", by: null });
    else if (pay.state === "paid") items.push({ key: "payment", label: "Payment up front", state: "done", detail: `${formatCents(pay.dueNowCents)} is paid.`, by: null });
    else if (pay.state === "approval_needed" || pay.state === "link_needed") items.push({ key: "payment", label: "Payment up front", state: "todo", detail: `${formatCents(pay.dueNowCents)} is due before the visit. An Owner or Manager sends the payment link.`, by: "owner" });
    else items.push({ key: "payment", label: "Payment up front", state: "todo", detail: `${formatCents(pay.dueNowCents)} is due before the visit and has not been paid yet.`, by: "customer" });
    const agreement = booking.requirements.agreement;
    if (agreement.state === "not_required") items.push({ key: "agreement", label: "Agreement", state: "not_required", detail: "This booking does not need a signed agreement.", by: null });
    else if (agreement.state === "signed") items.push({ key: "agreement", label: "Agreement", state: "done", detail: "The service agreement is signed.", by: null });
    else if (agreement.state === "sent") items.push({ key: "agreement", label: "Agreement", state: "todo", detail: "The service agreement is out for signature.", by: "customer" });
    else if (agreement.state === "declined") items.push({ key: "agreement", label: "Agreement", state: "blocked", detail: "The customer declined the agreement.", by: "owner" });
    else items.push({ key: "agreement", label: "Agreement", state: "todo", detail: agreement.agreementId ? "The service agreement is prepared and not sent yet." : "A signed service agreement is required. Prepare it from the booking.", by: "owner" });
  }

  const before = items.filter((item) => (item.state === "todo" || item.state === "blocked") && item.key !== "payment" && item.key !== "agreement");
  const ready = !booking && before.length === 0;
  items.push({ key: "confirmation", label: "Booking confirmed", state: booking?.status === "confirmed" ? "done" : "todo", detail: booking?.status === "confirmed" ? "The booking is confirmed and handed to Dispatch." : booking ? "Confirmed on its own once everything above is done." : ready ? "Ready: the agent requests the booking." : "Requested once everything above is done.", by: booking?.status === "confirmed" ? null : "sales" });
  return { items, ready, blockers: items.filter((item) => item.state === "todo" || item.state === "blocked").filter((item) => item.key !== "confirmation").map((item) => item.detail), booking, quote, slot };
}

/** A booking the agent worked was confirmed and handed to Dispatch: its reminders and waiting drafts end, its task closes as won. */
export async function agentBookingConfirmed(ctx: MutationCtx, opportunityId: Id<"salesOpportunities">): Promise<void> {
  const opportunity = await load(ctx, opportunityId).catch(() => null);
  if (!opportunity) return;
  await stopFollowUps(ctx, opportunity, "The booking was confirmed.", SYSTEM);
  await retireOpenActions(ctx, opportunity, "The booking was confirmed.");
  await syncTask(ctx, opportunity, SYSTEM);
  await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.booked", actor: SYSTEM, subject: { table: "salesOpportunities", id: opportunity._id }, data: { bookingId: opportunity.bookingId ?? null } });
}
