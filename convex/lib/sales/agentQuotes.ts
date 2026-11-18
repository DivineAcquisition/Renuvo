/**
 * How the Sales agent prices and quotes: through the same draft, pricing and quote a person uses in the
 * booking workspace, so a deal the agent quoted opens in the workspace exactly as the agent left it.
 *
 * The price is the pricing engine's, for the published version of one service and the facts the
 * customer gave (convex/lib/sales/pricing.ts `priceBooking`). The agent writes those facts into the
 * opportunity's booking draft and saves a quote from it. A saved quote never changes: new facts make a
 * new quote, and the earlier one is superseded, so what a customer was sent stays as it was sent.
 *
 * The agent never discounts. The deposit and the terms are the Playbook's; the agent does not type them.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sha256 } from "../agreements/hash";
import { recordEvent, type Actor } from "../events";
import { saveQuote } from "../services/operations";
import type { Schedule } from "../services/spec";
import { canonical, publishedByKey } from "../services/store";
import { formatCents } from "../services/words";
import { SEGMENT_OF_KIND, type Opp } from "./agentOpportunity";
import { addDays, cadenceLabel, localInstant, weekdayOf, type Cadence } from "./cadence";
import type { DraftBody } from "./draft";
import { factOf, known, ONE_TIME, quoteInputFrom } from "./facts";
import { newLinkId } from "./links";
import { checkCapacity } from "./capacity";
import { priceBooking, type BookingPricing, type PricedVisit } from "./pricing";
import { businessSettingsOf } from "../settings/business";
import { depositFor, salesSettings } from "./settings";

type Ctx = QueryCtx | MutationCtx;
const DAY = 24 * 60 * 60_000;

/** A customer nobody has cleaned for yet is on their first visit, which some services price differently. */
export async function isFirstVisit(ctx: Ctx, opportunity: Pick<Opp, "companyId" | "customerId">): Promise<boolean> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", opportunity.companyId).eq("customerId", opportunity.customerId))
    .take(20);
  return !jobs.some((job) => job.status === "completed");
}

/** The date in the company's time zone, as YYYY-MM-DD. */
function dateIn(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

function minuteIn(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(at));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** The workspace cadence for the frequency the customer asked for. The weekday follows the chosen time, when there is one. */
export function cadenceFor(schedule: Schedule, date: string | null): Cadence | null {
  const weekday = date ? weekdayOf(date) : 1;
  const day = date ? Number(date.slice(8, 10)) : 1;
  switch (schedule) {
    case "every_7_days":
      return { kind: "weekly", weekdays: [weekday] };
    case "every_14_days":
      return { kind: "every_2_weeks", weekday };
    case "every_28_days":
      return { kind: "every_4_weeks", weekday };
    case "once_per_month":
      return { kind: "monthly", dayOfMonth: Math.min(day, 28) };
    case "twice_per_month": {
      const second = ((day + 13) % 28) + 1;
      return { kind: "twice_monthly", days: [Math.min(day, second), Math.max(day, second)].map((d) => Math.min(d, 28)) };
    }
    default:
      return null;
  }
}

export type Priced =
  | { kind: "priced"; body: DraftBody; bookingKind: "one_time" | "recurring"; pricing: BookingPricing & { visit: PricedVisit; firstCents: number }; serviceName: string; outcome: string; postalCode: string | null }
  | { kind: "no_service" }
  | { kind: "incomplete"; missing: string[] }
  /** The service's own rules say a firm price is not possible from answers alone. */
  | { kind: "walkthrough"; reasons: string[]; serviceName: string };

/**
 * What the published service charges for what is known about this request, as a booking draft body and
 * the workspace's own pricing of it. The engine decides; nothing here adjusts it.
 */
export async function priceOpportunity(ctx: Ctx, company: Doc<"companies">, opportunity: Opp): Promise<Priced> {
  const found = opportunity.serviceKey ? await publishedByKey(ctx as QueryCtx, company._id, opportunity.serviceKey) : null;
  if (!found || found.service.status !== "active") return { kind: "no_service" };
  const spec = found.version.spec;
  const facts = opportunity.agent.facts;
  const firstVisit = await isFirstVisit(ctx, opportunity);
  const input = quoteInputFrom(spec, facts, { firstVisit });
  const schedule = input.schedule;
  // The draft carries the service's own answers; the schedule, postal code and first visit are the workspace's to add.
  delete input.schedule;
  delete input.firstVisit;
  const property = opportunity.propertyId ? await ctx.db.get(opportunity.propertyId) : null;
  const postalCode = property?.address.postalCode ?? (known(facts, "postalCode") ? String(factOf(facts, "postalCode")!.value) : null);
  delete input.postalCode;
  const slot = opportunity.timing?.slot;
  const date = slot ? dateIn(slot.startsAt, company.timezone) : null;
  const cadence = schedule && schedule !== (ONE_TIME as string) ? cadenceFor(schedule, date) : null;
  const bookingKind = cadence ? "recurring" : "one_time";
  const settings = salesSettings(company);
  const body: DraftBody = {
    service: { key: found.service.key, input },
    ...(cadence ? { recurring: { cadence, billing: "per_visit" as const }, firstVisit: { mode: firstVisit && spec.modifiers.firstClean.enabled ? ("first_clean" as const) : ("same" as const) } } : {}),
    ...(slot && date ? { schedule: { date, arrivalMinute: minuteIn(slot.startsAt, company.timezone), windowMinutes: 60 } } : {}),
    agreement: { required: settings.booking.agreementRequired },
  };
  let pricing = await priceBooking(ctx as QueryCtx, company, body, bookingKind, postalCode);
  const lead = pricing.first ?? pricing.visit;
  if (!pricing.visit || !lead) return { kind: "no_service" };
  for (const priced of [pricing.visit, pricing.first]) {
    if (!priced) continue;
    if (priced.quote.outcome === "incomplete") return { kind: "incomplete", missing: priced.quote.missing };
    if (priced.quote.outcome === "walkthrough" || priced.quote.totalCents === null) return { kind: "walkthrough", reasons: priced.quote.reasons.length ? priced.quote.reasons : ["This service is quoted after seeing the property."], serviceName: priced.name };
  }
  // The deposit is the Playbook's rule on the first visit's price. None means the customer pays after the service.
  const deposit = pricing.firstCents !== null ? depositFor(settings.booking.deposit, pricing.firstCents) : undefined;
  body.payment = deposit ? { policy: "deposit", depositCents: deposit } : { policy: "after_service" };
  pricing = await priceBooking(ctx as QueryCtx, company, body, bookingKind, postalCode);
  if (!pricing.visit || pricing.firstCents === null) return { kind: "no_service" };
  return { kind: "priced", body, bookingKind, pricing: pricing as BookingPricing & { visit: PricedVisit; firstCents: number }, serviceName: pricing.visit.name, outcome: (pricing.first ?? pricing.visit).quote.outcome, postalCode };
}

/** The opportunity's booking draft, made the first time the agent needs one. People open the same draft in the workspace. */
export async function draftFor(ctx: MutationCtx, opportunity: Opp, body: DraftBody, bookingKind: "one_time" | "recurring"): Promise<Doc<"salesDrafts">> {
  const now = Date.now();
  const existing = opportunity.draftId ? await ctx.db.get(opportunity.draftId) : null;
  if (existing && existing.status !== "archived" && existing.status !== "confirmed" && existing.mode === "booking") {
    const keep = (existing.body ?? {}) as DraftBody;
    // A person's own entries in the draft (notes, contacts, a preferred cleaner) are kept; the priced parts are the agent's.
    await ctx.db.patch(existing._id, { body: { ...keep, ...body, notes: keep.notes, contacts: keep.contacts }, bookingKind, ...(opportunity.propertyId ? { propertyId: opportunity.propertyId } : {}), revision: existing.revision + 1, updatedAt: now });
    return (await ctx.db.get(existing._id))!;
  }
  const draftId = await ctx.db.insert("salesDrafts", {
    companyId: opportunity.companyId,
    mode: "booking",
    segment: SEGMENT_OF_KIND[opportunity.agent.kind],
    bookingKind,
    opportunityId: opportunity._id,
    customerId: opportunity.customerId,
    ...(opportunity.propertyId ? { propertyId: opportunity.propertyId } : {}),
    entry: { from: "sales_agent" },
    body,
    revision: 0,
    status: "open",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(opportunity._id, { draftId });
  return (await ctx.db.get(draftId))!;
}

/** What a quote can still do: be sent, or be accepted. */
export const LIVE_QUOTES: readonly Doc<"salesQuotes">["status"][] = ["saved", "awaiting_approval", "sent"];

export type SavedQuote = { quote: Doc<"salesQuotes">; created: boolean };

/**
 * Saves the price as the opportunity's quote. The same price, scope and terms as the live quote change
 * nothing and answer with it, so a run that happens twice writes one quote. Anything different
 * supersedes the earlier quote: an approval or a link for it does not carry over.
 */
export async function saveAgentQuote(ctx: MutationCtx, company: Doc<"companies">, opportunity: Opp, priced: Extract<Priced, { kind: "priced" }>, actor: Actor): Promise<SavedQuote> {
  const settings = salesSettings(company);
  const { pricing } = priced;
  const visit = pricing.visit;
  const first = pricing.first;
  const snapshot = {
    service: visit.name,
    scope: visit.quote.includedScope,
    lines: visit.quote.lines.filter((l) => l.amountCents !== 0).map((l) => ({ label: l.label, amountCents: l.amountCents })),
    first: first ? { service: first.name, totalCents: first.quote.totalCents, lines: first.quote.lines.filter((l) => l.amountCents !== 0).map((l) => ({ label: l.label, amountCents: l.amountCents })) } : null,
    firstNote: pricing.firstNote,
    cadence: priced.bookingKind === "recurring" && priced.body.recurring?.cadence ? cadenceLabel(priced.body.recurring.cadence) : null,
    per: visit.quote.per,
    outcome: priced.outcome,
    durationMinutes: pricing.durationMinutes,
    crew: pricing.crew,
  };
  const depositCents = priced.body.payment?.policy === "deposit" ? priced.body.payment.depositCents : undefined;
  const terms = { payment: settings.quotes.paymentTerms, cancellation: settings.quotes.cancellationTerms };
  const hash = sha256(canonical({ snapshot, visit: { key: visit.serviceKey, version: visit.version, input: visit.input, total: visit.quote.totalCents }, first: first ? { key: first.serviceKey, version: first.version, input: first.input, total: first.quote.totalCents } : null, depositCents: depositCents ?? null, terms, agreementRequired: settings.booking.agreementRequired }));
  const current = opportunity.quoteId ? await ctx.db.get(opportunity.quoteId) : null;
  if (current && LIVE_QUOTES.includes(current.status) && current.hash === hash) return { quote: current, created: false };

  const draft = await draftFor(ctx, opportunity, priced.body, priced.bookingKind);
  const now = Date.now();
  const earlier = await ctx.db
    .query("salesQuotes")
    .withIndex("by_company_draft", (q) => q.eq("companyId", company._id).eq("draftId", draft._id))
    .take(20);
  for (const row of earlier) if (LIVE_QUOTES.includes(row.status)) await ctx.db.patch(row._id, { status: "superseded" });
  const saveOne = async (one: PricedVisit) => {
    const found = (await publishedByKey(ctx, company._id, one.serviceKey))!;
    const id = await saveQuote(ctx, { companyId: company._id, service: found.service, version: found.version, quoteInput: one.input, result: one.quote, purpose: "sales", actor });
    return { serviceKey: one.serviceKey, versionId: one.versionId, serviceQuoteId: id, totalCents: one.quote.totalCents!, outcome: one.quote.outcome };
  };
  const quoteId = await ctx.db.insert("salesQuotes", {
    companyId: company._id,
    draftId: draft._id,
    opportunityId: opportunity._id,
    customerId: opportunity.customerId,
    ...(opportunity.propertyId ? { propertyId: opportunity.propertyId } : {}),
    kind: priced.bookingKind,
    visit: await saveOne(visit),
    ...(first ? { first: await saveOne(first) } : {}),
    ...(priced.bookingKind === "recurring" && priced.body.recurring?.cadence ? { cadence: priced.body.recurring.cadence } : {}),
    snapshot,
    status: "saved",
    expiresAt: now + settings.quotes.validDays * DAY,
    createdAt: now,
    hash,
    ...(depositCents ? { depositCents } : {}),
    terms,
    agreementRequired: settings.booking.agreementRequired,
  });
  await ctx.db.patch(draft._id, { quoteId, status: draft.status === "open" ? "quoted" : draft.status, updatedAt: now });
  await ctx.db.patch(opportunity._id, { quoteId, estimateCents: pricing.firstCents, updatedAt: now });
  await recordEvent(ctx, { companyId: company._id, type: "sales_quote.saved", actor, subject: { table: "salesQuotes", id: quoteId }, data: { totalCents: visit.quote.totalCents ?? null, firstCents: first?.quote.totalCents ?? null, by: "agent" } });
  return { quote: (await ctx.db.get(quoteId))!, created: true };
}

/** The first visit's charge on a quote: what the customer pays first. */
export function quoteTotal(quote: Pick<Doc<"salesQuotes">, "first" | "visit">): number {
  return quote.first?.totalCents ?? quote.visit.totalCents;
}

export function quoteService(quote: Pick<Doc<"salesQuotes">, "snapshot" | "visit">): string {
  return (quote.snapshot as { service?: string } | null)?.service ?? quote.visit.serviceKey;
}

export function quotePer(quote: Pick<Doc<"salesQuotes">, "snapshot">): string {
  return (quote.snapshot as { per?: string } | null)?.per ?? "visit";
}

/**
 * Whether a quote may go out without a person looking at it first. It may when it is a firm price from
 * the published rules, the kind of work is not one the Owner wants to see, and it is under the Owner's
 * review threshold. Anything else waits for a person.
 */
export function reviewReason(company: Doc<"companies">, opportunity: Opp, quote: Doc<"salesQuotes">): string | null {
  const settings = salesSettings(company);
  const outcome = (quote.snapshot as { outcome?: string } | null)?.outcome ?? quote.visit.outcome;
  if (outcome !== "firm") return "It is an estimate: the price assumed something the customer has not confirmed.";
  if (opportunity.agent.kind === "commercial" && settings.eligibility.commercialNeedsWalkthrough) return "Commercial work is reviewed by a person before a price goes out.";
  if (settings.quotes.reviewAboveCents !== null && quoteTotal(quote) > settings.quotes.reviewAboveCents) return `It is above your review threshold of ${formatCents(settings.quotes.reviewAboveCents)}.`;
  return null;
}

/** Why this quote cannot be sent right now, or null. Checked when it is prepared and again when it goes. */
export function sendProblem(quote: Doc<"salesQuotes">, now = Date.now()): string | null {
  if (quote.status === "accepted") return "The customer already accepted this quote.";
  if (quote.status === "superseded") return "A newer quote replaced this one.";
  if (quote.status === "withdrawn" || quote.status === "declined" || quote.status === "expired") return `This quote was ${quote.status}. Prepare a new one.`;
  if (quote.status === "awaiting_approval" || quote.approval?.state === "waiting") return "This quote is waiting for a person to review it.";
  if (quote.approval?.state === "declined") return "This quote was not approved.";
  if (quote.expiresAt <= now) return "This quote has expired. Prepare a new one.";
  return null;
}

/** Records that a quote went to the customer: it gets its link id and its last day starts now. */
export async function markSent(ctx: MutationCtx, quote: Doc<"salesQuotes">, company: Doc<"companies">, actor: Actor): Promise<Doc<"salesQuotes">> {
  const now = Date.now();
  if (quote.status === "sent") return quote;
  await ctx.db.patch(quote._id, { status: "sent", sentAt: now, expiresAt: now + salesSettings(company).quotes.validDays * DAY, publicId: quote.publicId ?? newLinkId(), question: undefined });
  await recordEvent(ctx, { companyId: quote.companyId, type: "sales_quote.sent", actor, subject: { table: "salesQuotes", id: quote._id }, data: { totalCents: quoteTotal(quote) } });
  return (await ctx.db.get(quote._id))!;
}

/** Gives a quote its link id without sending it, so a message can carry its link. */
export async function ensurePublicId(ctx: MutationCtx, quote: Doc<"salesQuotes">): Promise<Doc<"salesQuotes">> {
  if (quote.publicId) return quote;
  await ctx.db.patch(quote._id, { publicId: newLinkId() });
  return (await ctx.db.get(quote._id))!;
}

/** What a quote page may do right now. Worked out from the record and the clock. */
export type PageState = "open" | "accepted" | "declined" | "expired" | "withdrawn" | "superseded" | "not_sent";

export function pageState(quote: Doc<"salesQuotes">, now: number): PageState {
  if (quote.status === "withdrawn") return "withdrawn";
  if (quote.status === "superseded") return "superseded";
  if (quote.status === "accepted") return "accepted";
  if (quote.status === "declined") return "declined";
  if (quote.status === "expired" || quote.expiresAt <= now) return "expired";
  if (quote.status !== "sent") return "not_sent";
  return "open";
}

/** Run on a schedule: a sent quote whose last day has passed is marked expired. */
export async function expireDue(ctx: MutationCtx, now: number): Promise<Doc<"salesQuotes">[]> {
  const due = await ctx.db
    .query("salesQuotes")
    .withIndex("by_status_expires", (q) => q.eq("status", "sent").lt("expiresAt", now))
    .take(100);
  for (const quote of due) {
    await ctx.db.patch(quote._id, { status: "expired" });
    await recordEvent(ctx, { companyId: quote.companyId, type: "sales_quote.expired", actor: { kind: "system" }, subject: { table: "salesQuotes", id: quote._id } });
  }
  return due;
}

/** A quote as the owner's screens and the customer's page both read it. */
export function quoteView(quote: Doc<"salesQuotes">) {
  const snapshot = (quote.snapshot ?? {}) as { service?: string; scope?: string[]; lines?: { label: string; amountCents: number }[]; first?: { service: string; totalCents: number | null; lines: { label: string; amountCents: number }[] } | null; firstNote?: string | null; cadence?: string | null; per?: string; outcome?: string; durationMinutes?: number | null; crew?: number | null };
  return {
    _id: quote._id,
    kind: quote.kind,
    status: quote.status,
    service: snapshot.service ?? quote.visit.serviceKey,
    scope: snapshot.scope ?? [],
    lines: snapshot.lines ?? [],
    first: snapshot.first ?? null,
    firstNote: snapshot.firstNote ?? null,
    cadence: snapshot.cadence ?? null,
    per: snapshot.per ?? "visit",
    outcome: snapshot.outcome ?? quote.visit.outcome,
    visitCents: quote.visit.totalCents,
    firstCents: quote.first?.totalCents ?? null,
    totalCents: quoteTotal(quote),
    depositCents: quote.depositCents ?? null,
    terms: quote.terms ?? null,
    agreementRequired: quote.agreementRequired ?? false,
    durationMinutes: snapshot.durationMinutes ?? null,
    expiresAt: quote.expiresAt,
    sentAt: quote.sentAt ?? null,
    acceptance: quote.acceptance ?? null,
    declined: quote.declined ?? null,
    question: quote.question ?? null,
    hash: quote.hash ?? null,
    createdAt: quote.createdAt,
  };
}
export type QuoteView = ReturnType<typeof quoteView>;

/** The first local day a time may be offered: the Playbook's minimum notice from now. */
export function earliestDate(company: Doc<"companies">, now = Date.now()): string {
  const notice = salesSettings(company).booking.minimumNoticeHours;
  return dateIn(now + notice * 60 * 60_000, company.timezone);
}

/**
 * Times the customer may choose: inside the company's hours, after the Playbook's minimum notice, with
 * capacity open now. Each is checked again when the booking is requested.
 */
export async function openTimes(ctx: QueryCtx | MutationCtx, company: Doc<"companies">, quote: Doc<"salesQuotes">, limit = 12): Promise<{ startsAt: number; endsAt: number }[]> {
  const snapshot = (quote.snapshot ?? {}) as { durationMinutes?: number | null; crew?: number | null };
  const minutes = Math.max(30, snapshot.durationMinutes ?? 120);
  const crew = Math.max(1, snapshot.crew ?? 1);
  const hours = businessSettingsOf(company).hours;
  const first = earliestDate(company);
  const now = Date.now();
  const out: { startsAt: number; endsAt: number }[] = [];
  for (let day = 0; day < 14 && out.length < limit; day += 1) {
    const date = addDays(first, day);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const windows = hours.length ? hours.filter((window) => window.weekday === weekday) : [{ weekday, startMinute: 9 * 60, endMinute: 17 * 60 }];
    for (const window of windows) {
      for (let minute = window.startMinute; minute + minutes <= window.endMinute && out.length < limit; minute += 120) {
        const startsAt = localInstant(date, minute, company.timezone);
        if (startsAt <= now) continue;
        const span = { startsAt, endsAt: startsAt + minutes * 60_000 };
        const answer = await checkCapacity(ctx, company, span, crew);
        if (answer.state === "fits" || answer.state === "tight") out.push(span);
      }
    }
  }
  return out;
}

export { addDays, dateIn, localInstant, minuteIn };
export type QuoteId = Id<"salesQuotes">;
