/**
 * Server-side prices for the workspace. Every figure a person or customer sees comes from the Services &
 * Pricing engine on a published version. The browser never adds anything up.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { profitability } from "../services/profit";
import { quote as runQuote, type Quote, type QuoteInput } from "../services/engine";
import { visitInput } from "../services/operations";
import { publishedByKey } from "../services/store";
import { localInstant, pricingSchedule } from "./cadence";
import type { DraftBody, ServiceChoice } from "./draft";

export type PricedVisit = {
  serviceKey: string;
  name: string;
  serviceId: Id<"services">;
  versionId: Id<"serviceVersions">;
  version: number;
  input: QuoteInput;
  quote: Quote;
};

export type BookingPricing = {
  visit: PricedVisit | null;
  first: PricedVisit | null;
  /** Why a first visit is or isn't priced differently, in words. */
  firstNote: string | null;
  recurringNote: string | null;
  /** The first visit's charge: the separate first visit when there is one, else the visit. */
  firstCents: number | null;
  ongoingCents: number | null;
  dueNowCents: number | null;
  dueLaterCents: number | null;
  /** A person's proposed price instead of the calculated first-visit price. */
  override: { referenceCents: number | null; proposedCents: number; reason: string } | null;
  startsAt: number | null;
  endsAt: number | null;
  crew: number | null;
  durationMinutes: number | null;
};

export async function priceChoice(ctx: QueryCtx, company: Doc<"companies">, choice: ServiceChoice | undefined, extra: Partial<QuoteInput>, startsAt: number | null): Promise<PricedVisit | null> {
  if (!choice?.key) return null;
  const found = await publishedByKey(ctx, company._id, choice.key);
  if (!found || found.service.status === "archived") return null;
  const spec = found.version.spec;
  const base: QuoteInput = { ...(choice.input ?? {}), ...extra };
  delete base.dayFullnessPercent;
  delete base.timePercent;
  const input = startsAt === null ? base : await visitInput(ctx, company, spec, base, startsAt);
  return { serviceKey: found.service.key, name: spec.name, serviceId: found.service._id, versionId: found.version._id, version: found.version.version, input, quote: runQuote(spec, input) };
}

export function startOf(body: DraftBody, timezone: string): number | null {
  const date = body.schedule?.date;
  const minute = body.schedule?.arrivalMinute;
  if (!date || minute === undefined) return null;
  try {
    return localInstant(date, minute, timezone);
  } catch {
    return null;
  }
}

export async function priceBooking(ctx: QueryCtx, company: Doc<"companies">, body: DraftBody, kind: "one_time" | "recurring", postalCode: string | null): Promise<BookingPricing> {
  const startsAt = startOf(body, company.timezone);
  const postal = postalCode ? { postalCode } : {};
  const cadence = kind === "recurring" ? body.recurring?.cadence : undefined;
  const schedule = cadence ? pricingSchedule(cadence) : undefined;
  const visit = await priceChoice(ctx, company, body.service, { ...postal, ...(schedule ? { schedule } : {}), firstVisit: false }, startsAt);
  let first: PricedVisit | null = null;
  let firstNote: string | null = null;
  let recurringNote: string | null = null;
  if (kind === "recurring" && visit) {
    const spec = (await publishedByKey(ctx, company._id, visit.serviceKey))!.version.spec;
    if (schedule && !(spec.modifiers.recurring.enabled && spec.modifiers.recurring.options.some((o) => o.schedule === schedule))) {
      recurringNote = `${spec.name} has no recurring rate for this frequency, so each visit is priced at its one-time rate.`;
    }
    const mode = body.firstVisit?.mode ?? "same";
    if (mode === "first_clean") {
      if (spec.modifiers.firstClean.enabled) {
        first = await priceChoice(ctx, company, body.service, { ...postal, ...(schedule ? { schedule } : {}), firstVisit: true }, startsAt);
        firstNote = "The first visit uses this service's first-clean price.";
      } else firstNote = `${spec.name} has no first-clean price, so the first visit is priced like the others.`;
    } else if (mode === "different") {
      first = await priceChoice(ctx, company, body.firstVisit?.service, { ...postal, firstVisit: true }, startsAt);
      firstNote = first ? `The first visit is a ${first.name}; visits after it are ${visit.name}.` : "Choose the first visit's service.";
    }
  }
  const lead = first ?? visit;
  const calculatedFirst = lead?.quote.totalCents ?? null;
  const override = body.override?.priceCents !== undefined && Number.isInteger(body.override.priceCents) && body.override.priceCents > 0 ? { referenceCents: calculatedFirst, proposedCents: body.override.priceCents, reason: body.override.reason?.trim() ?? "" } : null;
  const firstCents = override ? override.proposedCents : calculatedFirst;
  const ongoingCents = kind === "recurring" ? (visit?.quote.totalCents ?? null) : null;
  const policy = body.payment?.policy;
  let dueNowCents: number | null = null;
  if (firstCents !== null) {
    if (policy === "full") dueNowCents = firstCents;
    else if (policy === "deposit") dueNowCents = body.payment?.depositCents && body.payment.depositCents > 0 ? Math.min(body.payment.depositCents, firstCents) : null;
    else if (policy) dueNowCents = 0;
  }
  const crew = lead?.quote.time.crewSize ?? null;
  const durationMinutes = lead ? Math.max(15, lead.quote.time.elapsedMinutes) : null;
  return {
    visit,
    first,
    firstNote,
    recurringNote,
    firstCents,
    ongoingCents,
    dueNowCents,
    dueLaterCents: firstCents !== null && dueNowCents !== null ? firstCents - dueNowCents : null,
    override,
    startsAt,
    endsAt: startsAt !== null && durationMinutes !== null ? startsAt + durationMinutes * 60_000 : null,
    crew,
    durationMinutes,
  };
}

/** Owner-only: estimated costs and contribution, labeled as incomplete when costs are missing. */
export async function contributionFor(ctx: QueryCtx, companyId: Id<"companies">, priced: PricedVisit | null, chargedCents: number | null) {
  if (!priced || chargedCents === null) return null;
  const profile = await ctx.db
    .query("pricingProfiles")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();
  if (!profile) return { revenueCents: chargedCents, result: null, why: "Add your costs in Services & Pricing to see an estimate." };
  const result = profitability({ ...priced.quote, totalCents: chargedCents }, profile.costs);
  return { revenueCents: chargedCents, result, why: result && result.missing.length ? `Incomplete: ${result.missing.join(", ")} not entered, so what remains is overstated.` : null };
}
