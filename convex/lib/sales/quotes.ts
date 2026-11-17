/**
 * Quotes: a customer-facing offer made from a published service and the facts of one request.
 *
 * The price is the pricing engine's, for one exact version of the service and one exact set of inputs,
 * and both are kept (the engine's own record, `serviceQuotes`, is what a version points at). A version
 * is never edited: a change is a new version, and what the customer was sent stays as it was sent, so a
 * later change to the catalog never reaches a quote already out. Tax comes from Finance's settings and
 * the deposit from the Playbook's rule; neither is typed by a model.
 *
 * A discount is only ever a person's: inside the Owner's band a Manager may add one with a reason,
 * outside it only the Owner, and never below the service's minimum charge.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sha256 } from "../agreements/hash";
import { recordEvent, type Actor } from "../events";
import { settingsOf, settingsRow } from "../finance/settings";
import { isOwner, type Role } from "../roles";
import { quote as runQuote, type Quote } from "../services/engine";
import { saveQuote, visitInput } from "../services/operations";
import { canonical, publishedByKey } from "../services/store";
import { formatCents, scheduleLabel } from "../services/words";
import { clock, dayName } from "../time";
import { factOf, known, quoteInputFrom } from "./facts";
import { newPublicId } from "./links";
import { depositFor, salesSettings } from "./settings";

type Ctx = QueryCtx | MutationCtx;
const DAY = 24 * 60 * 60_000;

export type Priced =
  | { kind: "priced"; service: Doc<"services">; version: Doc<"serviceVersions">; input: ReturnType<typeof quoteInputFrom>; result: Quote & { totalCents: number } }
  | { kind: "no_service" }
  | { kind: "incomplete"; missing: string[] }
  /** The service's own rules say a firm price is not possible from answers alone. */
  | { kind: "walkthrough"; reasons: string[]; service: Doc<"services"> };

/** A customer nobody has cleaned for yet is on their first visit, which some services price differently. */
export async function isFirstVisit(ctx: Ctx, opportunity: Pick<Doc<"salesOpportunities">, "companyId" | "customerId">): Promise<boolean> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", opportunity.companyId).eq("customerId", opportunity.customerId))
    .take(20);
  return !jobs.some((job) => job.status === "completed");
}

/** What the published service charges for what is known about this request. The engine decides; nothing here adjusts it. */
export async function priceOpportunity(ctx: Ctx, company: Doc<"companies">, opportunity: Doc<"salesOpportunities">): Promise<Priced> {
  const found = opportunity.serviceKey ? await publishedByKey(ctx as QueryCtx, company._id, opportunity.serviceKey) : null;
  if (!found || found.service.status !== "active") return { kind: "no_service" };
  const spec = found.version.spec;
  let input = quoteInputFrom(spec, opportunity.facts, { firstVisit: await isFirstVisit(ctx, opportunity) });
  // A chosen time brings the day's date into the price, for a service that prices busy days.
  if (opportunity.timing?.slot) input = await visitInput(ctx as QueryCtx, company, spec, input, opportunity.timing.slot.startsAt);
  const result = runQuote(spec, input);
  if (result.outcome === "incomplete") return { kind: "incomplete", missing: result.missing };
  if (result.outcome === "walkthrough" || result.totalCents === null) return { kind: "walkthrough", reasons: result.reasons.length ? result.reasons : ["This service is quoted after seeing the property."], service: found.service };
  return { kind: "priced", service: found.service, version: found.version, input, result: { ...result, totalCents: result.totalCents } };
}

export type DiscountInput = { cents: number; reason: string };

/** Why this discount cannot be given by this person, or null. The band and the floor are the Owner's; a reason is always required. */
export function discountProblem(company: Doc<"companies">, role: Role, discount: DiscountInput, priced: { cleaningCents: number; totalCents: number; minimumCents: number | null }): string | null {
  if (!Number.isInteger(discount.cents) || discount.cents <= 0) return "Enter the discount as an amount above zero.";
  if (discount.reason.trim().length < 3) return "Say why the discount is being given. It is kept with the quote.";
  if (discount.cents >= priced.totalCents) return "A discount must be less than the price.";
  const floor = priced.minimumCents ?? 0;
  if (priced.totalCents - discount.cents < floor) return `That would take the price below this service's minimum charge of ${formatCents(floor)}.`;
  const band = Math.floor((priced.cleaningCents * salesSettings(company).discounts.maxPercent) / 100);
  if (discount.cents > band && !isOwner(role)) return band > 0 ? `The most that can come off this quote without the Owner is ${formatCents(band)} (${salesSettings(company).discounts.maxPercent}% of the cleaning amount). The Owner can approve more.` : "The Owner has not allowed discounts. Only the Owner can add one.";
  return null;
}

async function nextNumber(ctx: MutationCtx, companyId: Id<"companies">): Promise<number> {
  const last = await ctx.db
    .query("salesQuotes")
    .withIndex("by_company_number", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
  return (last?.number ?? 1000) + 1;
}

export async function versionOf(ctx: Ctx, quote: Pick<Doc<"salesQuotes">, "_id" | "companyId">, version: number): Promise<Doc<"salesQuoteVersions"> | null> {
  return ctx.db
    .query("salesQuoteVersions")
    .withIndex("by_company_quote_version", (q) => q.eq("companyId", quote.companyId).eq("quoteId", quote._id).eq("version", version))
    .unique();
}

export async function versionsOf(ctx: Ctx, quote: Pick<Doc<"salesQuotes">, "_id" | "companyId">): Promise<Doc<"salesQuoteVersions">[]> {
  return ctx.db
    .query("salesQuoteVersions")
    .withIndex("by_company_quote_version", (q) => q.eq("companyId", quote.companyId).eq("quoteId", quote._id))
    .order("desc")
    .take(50);
}

/** A quote that can still be changed or sent: not accepted, declined, expired or revoked. */
const LIVE: readonly Doc<"salesQuotes">["status"][] = ["draft", "awaiting_approval", "approved", "sent"];

export type SavedQuote = { quote: Doc<"salesQuotes">; version: Doc<"salesQuoteVersions">; created: boolean };

/**
 * Saves the next version of the opportunity's quote from a price the engine just gave. The same service
 * version, inputs, discount and note as the current version change nothing and answer with it, so a
 * workflow that runs twice writes one version.
 */
export async function saveQuoteVersion(
  ctx: MutationCtx,
  company: Doc<"companies">,
  opportunity: Doc<"salesOpportunities">,
  priced: Extract<Priced, { kind: "priced" }>,
  actor: Actor,
  options: { discount?: DiscountInput & { approvedBy: Id<"members"> }; note?: string } = {},
): Promise<SavedQuote> {
  const settings = salesSettings(company);
  const spec = priced.version.spec;
  const finance = settingsOf(await settingsRow(ctx, company._id));
  const price = priced.result.totalCents;
  const discountCents = options.discount?.cents ?? 0;
  const taxable = finance.taxRateBps !== null && finance.taxRateBps > 0 && finance.taxableServiceIds.includes(priced.service.key);
  const taxCents = taxable ? Math.round(((price - discountCents) * finance.taxRateBps!) / 10_000) : 0;
  const totalCents = price - discountCents + taxCents;
  const depositCents = depositFor(settings.booking.deposit, totalCents);
  const schedule = factOf(opportunity.facts, "schedule");
  const frequency = priced.input.schedule ? scheduleLabel(priced.input.schedule) : schedule && known(opportunity.facts, "schedule") ? "One time" : undefined;
  const slot = opportunity.timing?.slot;
  const timing = slot ? `${dayName(slot.startsAt, company.timezone)} at ${clock(slot.startsAt, company.timezone)}` : opportunity.timing?.text;
  const body = {
    serviceId: priced.service._id,
    serviceKey: priced.service.key,
    serviceName: spec.name,
    serviceVersionId: priced.version._id,
    serviceVersion: priced.version.version,
    input: canonical(priced.input),
    outcome: priced.result.outcome,
    per: priced.result.per,
    lines: priced.result.lines.map((line) => ({ key: line.key, kind: line.kind, label: line.label.slice(0, 200), detail: line.detail.slice(0, 400), amountCents: line.amountCents })),
    priceCents: price,
    ...(options.discount ? { discount: { cents: options.discount.cents, label: "Discount", reason: options.discount.reason.trim().slice(0, 300), source: "approved" as const, approvedBy: options.discount.approvedBy } } : {}),
    taxCents,
    ...(taxable ? { taxLabel: finance.taxLabel } : {}),
    totalCents,
    ...(depositCents !== undefined ? { depositCents } : {}),
    included: priced.result.includedScope.slice(0, 60).map((item) => item.slice(0, 200)),
    excluded: spec.excluded.slice(0, 30).map((item) => item.slice(0, 200)),
    extras: priced.result.extras.map((extra) => ({ label: extra.label.slice(0, 120), quantity: extra.quantity, amountCents: extra.amountCents, included: extra.included })),
    ...(frequency ? { frequency } : {}),
    ...(timing ? { timing: timing.slice(0, 200) } : {}),
    durationMinutes: Math.max(15, Math.round(priced.result.time.elapsedMinutes)),
    crewSize: priced.result.time.crewSize,
    terms: { payment: settings.quotes.paymentTerms, cancellation: settings.quotes.cancellationTerms },
    validDays: settings.quotes.validDays,
    agreementRequired: settings.booking.agreementRequired,
    ...(options.note?.trim() ? { note: options.note.trim().slice(0, 1000) } : {}),
  };
  const hash = sha256(canonical(body));
  const now = Date.now();

  let quote = opportunity.quoteId ? await ctx.db.get(opportunity.quoteId) : null;
  if (quote && !LIVE.includes(quote.status)) quote = null;
  if (quote) {
    const current = await versionOf(ctx, quote, quote.currentVersion);
    if (current && current.hash === hash) return { quote, version: current, created: false };
  }
  if (!quote) {
    const quoteId = await ctx.db.insert("salesQuotes", { companyId: company._id, opportunityId: opportunity._id, customerId: opportunity.customerId, number: await nextNumber(ctx, company._id), status: "draft", currentVersion: 0, createdBy: actor, createdAt: now, updatedAt: now });
    quote = (await ctx.db.get(quoteId))!;
    await ctx.db.patch(opportunity._id, { quoteId });
  }
  const pricingQuoteId = await saveQuote(ctx, { companyId: company._id, service: priced.service, version: priced.version, quoteInput: priced.input, result: priced.result, purpose: "sales", actor });
  const version = quote.currentVersion + 1;
  const versionId = await ctx.db.insert("salesQuoteVersions", { companyId: company._id, quoteId: quote._id, version, pricingQuoteId, ...body, hash, createdBy: actor, createdAt: now });
  // A new version is a new offer: it has not been approved, and an approval of the older one does not carry over.
  await ctx.db.patch(quote._id, { currentVersion: version, status: quote.status === "sent" ? "sent" : "draft", approvedVersion: undefined, approvedBy: undefined, updatedAt: now });
  await recordEvent(ctx, { companyId: company._id, type: "quote.version_saved", actor, subject: { table: "salesQuotes", id: quote._id }, data: { version, totalCents, serviceVersion: priced.version.version, ...(options.discount ? { discountCents: options.discount.cents } : {}) } });
  return { quote: (await ctx.db.get(quote._id))!, version: (await ctx.db.get(versionId))!, created: true };
}

/**
 * Whether a version may go out without a person looking at it first. It may when it is a firm price
 * from the published rules with no discount, the kind of work is not one the Owner wants to see, and it
 * is under the Owner's review threshold. Anything else waits for a person.
 */
export function reviewReason(company: Doc<"companies">, opportunity: Pick<Doc<"salesOpportunities">, "kind">, version: Doc<"salesQuoteVersions">): string | null {
  const settings = salesSettings(company);
  if (version.discount) return "It carries a discount.";
  if (version.outcome !== "firm") return "It is an estimate: the price assumed something the customer has not confirmed.";
  if (opportunity.kind === "commercial" && settings.eligibility.commercialNeedsWalkthrough) return "Commercial work is reviewed by a person before a price goes out.";
  if (settings.quotes.reviewAboveCents !== null && version.totalCents > settings.quotes.reviewAboveCents) return `It is above your review threshold of ${formatCents(settings.quotes.reviewAboveCents)}.`;
  return null;
}

export async function approveVersion(ctx: MutationCtx, quote: Doc<"salesQuotes">, version: number, by: Id<"members"> | "rules", actor: Actor): Promise<Doc<"salesQuotes">> {
  await ctx.db.patch(quote._id, { approvedVersion: version, approvedBy: by, status: quote.status === "sent" ? "sent" : "approved", updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: quote.companyId, type: "quote.approved", actor, subject: { table: "salesQuotes", id: quote._id }, data: { version, by: by === "rules" ? "rules" : "person" } });
  return (await ctx.db.get(quote._id))!;
}

/** Why this quote cannot be sent right now, or null. Checked when it is prepared and again when it goes. */
export function sendProblem(quote: Doc<"salesQuotes">, version: Doc<"salesQuoteVersions"> | null): string | null {
  if (!version) return "The quote has no saved version.";
  if (quote.status === "accepted") return "The customer already accepted this quote.";
  if (quote.status === "revoked" || quote.status === "declined" || quote.status === "expired") return `This quote was ${quote.status}. Prepare a new one.`;
  if (quote.approvedVersion !== version.version) return "This version has not been approved to send.";
  if (version.version !== quote.currentVersion) return "A newer version of this quote exists.";
  return null;
}

/**
 * Records that a version went to the customer: it gets its link id (once, kept across revisions so an
 * old message's link opens the current offer and says the earlier one was replaced) and its last day.
 */
export async function markSent(ctx: MutationCtx, quote: Doc<"salesQuotes">, version: Doc<"salesQuoteVersions">, actor: Actor): Promise<Doc<"salesQuotes">> {
  const now = Date.now();
  await ctx.db.patch(quote._id, { status: "sent", sentVersion: version.version, sentAt: now, validUntil: now + version.validDays * DAY, publicId: quote.publicId ?? newPublicId(), question: undefined, updatedAt: now });
  await recordEvent(ctx, { companyId: quote.companyId, type: "quote.sent", actor, subject: { table: "salesQuotes", id: quote._id }, data: { version: version.version, totalCents: version.totalCents } });
  return (await ctx.db.get(quote._id))!;
}

/** What a quote page may do right now. Worked out from the record and the clock, so a stored status never disagrees with the date. */
export type PageState = "open" | "accepted" | "declined" | "expired" | "revoked" | "superseded";

export function pageState(quote: Doc<"salesQuotes">, now: number): PageState {
  if (quote.status === "revoked") return "revoked";
  if (quote.status === "accepted") return "accepted";
  if (quote.status === "declined") return "declined";
  if (quote.status === "expired" || (quote.validUntil !== undefined && quote.validUntil <= now)) return "expired";
  return "open";
}

/** Run on a schedule: a sent quote whose last day has passed is marked expired, and its opportunity told. */
export async function expireDue(ctx: MutationCtx, now: number): Promise<Doc<"salesQuotes">[]> {
  const due = await ctx.db
    .query("salesQuotes")
    .withIndex("by_status_valid", (q) => q.eq("status", "sent").lt("validUntil", now))
    .take(100);
  for (const quote of due) {
    await ctx.db.patch(quote._id, { status: "expired", updatedAt: now });
    await recordEvent(ctx, { companyId: quote.companyId, type: "quote.expired", actor: { kind: "system" }, subject: { table: "salesQuotes", id: quote._id }, data: { version: quote.sentVersion ?? null } });
  }
  return due;
}

/** A quote and one of its versions as the owner's screens and the customer's page both read it. */
export function versionView(version: Doc<"salesQuoteVersions">) {
  return {
    version: version.version,
    serviceName: version.serviceName,
    serviceVersion: version.serviceVersion,
    outcome: version.outcome,
    per: version.per,
    lines: version.lines.filter((line) => line.kind !== "info" || line.amountCents !== 0 || line.detail).map((line) => ({ key: line.key, kind: line.kind, label: line.label, detail: line.detail, amountCents: line.amountCents })),
    priceCents: version.priceCents,
    discount: version.discount ? { cents: version.discount.cents, label: version.discount.label, reason: version.discount.reason } : null,
    taxCents: version.taxCents,
    taxLabel: version.taxLabel ?? null,
    totalCents: version.totalCents,
    depositCents: version.depositCents ?? null,
    balanceCents: version.depositCents ? version.totalCents - version.depositCents : null,
    included: version.included,
    excluded: version.excluded,
    extras: version.extras,
    frequency: version.frequency ?? null,
    timing: version.timing ?? null,
    durationMinutes: version.durationMinutes,
    crewSize: version.crewSize,
    terms: version.terms,
    validDays: version.validDays,
    agreementRequired: version.agreementRequired,
    note: version.note ?? null,
    hash: version.hash,
    createdAt: version.createdAt,
  };
}
export type VersionView = ReturnType<typeof versionView>;
