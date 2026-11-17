/**
 * A property's own price for a service (the owner's decisions of November 17, 2026):
 *  - it is the property's base price; extras, rush, discounts, the minimum charge and rounding still come
 *    from the service's live version;
 *  - Managers, and Selestial in Chat on a person's request, propose it; the Owner approves each one in
 *    Changes; visits use it only once it is approved;
 *  - a change to the service's catalog price leaves it alone, and the review of that change lists the
 *    properties that have their own price;
 *  - it may carry a review date or an end date; the Owner is reminded two weeks before, and after an end
 *    date the property pays the service's price again.
 *
 * The workspace (convex/propertyPrices.ts), the change review (convex/services.ts) and Company Chat
 * (lib/chat/serviceTools.ts) all go through these functions, so they make the same records and checks.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { sha256 } from "../agreements/hash";
import { addDays } from "../agreements/store";
import { localParts } from "../availability";
import type { MemberAccess } from "../builders";
import { userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { priceSummary, type PropertyPrice } from "./engine";
import { canonical, openChanges, ownedService, publishedSpec } from "./store";
import { closeChange } from "./workflow";
import { formatCents, minutesWords } from "./words";

/** How long before a review or end date the Owner is reminded. */
export const REMIND_DAYS = 14;

export type Until = { kind: "review" | "end"; date: string } | null;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The company's calendar day for an instant, YYYY-MM-DD. */
export const dayOf = (at: number, timezone: string) => localParts(at, timezone).day;

/** A property in words: its label, or its street and city. */
export function propertyName(property: Doc<"properties">): string {
  return property.label?.trim() || `${property.address.line1}, ${property.address.city}`;
}

/** A calendar day in words, without a time zone shifting it. */
export function dayWords(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function untilWords(until: Until): string | null {
  if (!until) return null;
  return until.kind === "end" ? `Ends after ${dayWords(until.date)}` : `Review by ${dayWords(until.date)}`;
}

/** The property's approved price for the service, whatever its dates, or null. At most one is active. */
export async function activePrice(ctx: QueryCtx, companyId: Id<"companies">, propertyId: Id<"properties">, serviceId: Id<"services">): Promise<Doc<"propertyPrices"> | null> {
  return ctx.db
    .query("propertyPrices")
    .withIndex("by_company_property_service", (q) => q.eq("companyId", companyId).eq("propertyId", propertyId).eq("serviceId", serviceId).eq("state", "active"))
    .first();
}

/**
 * The approved price that prices a visit at this property on this day (YYYY-MM-DD on the company's
 * calendar), or null. The visit's own day decides, not today: a visit booked now for after the end date
 * pays the service's price.
 */
export async function priceInForce(ctx: QueryCtx, companyId: Id<"companies">, propertyId: Id<"properties">, serviceId: Id<"services">, day: string): Promise<Doc<"propertyPrices"> | null> {
  const row = await activePrice(ctx, companyId, propertyId, serviceId);
  if (!row) return null;
  if (row.until?.kind === "end" && day > row.until.date) return null;
  return row;
}

/** What the pricing engine is given for it. */
export function engineInput(row: Doc<"propertyPrices">): PropertyPrice {
  return { id: row._id, baseCents: row.baseCents, ...(row.laborMinutes !== null ? { laborMinutes: row.laborMinutes } : {}) };
}

function checkUntil(until: Until, today: string): Until {
  if (!until) return null;
  if (!DATE.test(until.date) || Number.isNaN(new Date(`${until.date}T12:00:00Z`).getTime())) throw userError("The date must be a calendar day.");
  if (until.date <= today) throw userError(until.kind === "end" ? "The end date must be after today." : "The review date must be after today.");
  if (until.date > addDays(today, 3 * 366)) throw userError("The date must be within three years.");
  return { kind: until.kind, date: until.date };
}

export type Proposal = {
  serviceId: Id<"services">;
  propertyId: Id<"properties">;
  baseCents: number;
  laborMinutes: number | null;
  until: Until;
  reason: string;
};

/** Checks a proposal and says what approving it would do, in words, without writing anything. */
export async function reviewProposal(ctx: QueryCtx & MemberAccess, input: Proposal) {
  const service = await ownedService(ctx, ctx.companyId, input.serviceId);
  const live = await publishedSpec(ctx, service);
  if (service.status !== "active" || !live) throw userError("Only a live service can have a property's own price. Publish the service first.");
  const property = await ctx.db.get(input.propertyId);
  if (!property || property.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
  if (property.status !== "active") throw userError("That property is archived.");
  const customer = await ctx.db.get(property.customerId);
  if (!Number.isSafeInteger(input.baseCents) || input.baseCents < 100 || input.baseCents > 100_000_00) throw userError("The price must be whole cents, from $1.00 to $100,000.00.");
  if (input.laborMinutes !== null && (!Number.isSafeInteger(input.laborMinutes) || input.laborMinutes < 15 || input.laborMinutes > 7 * 24 * 60)) throw userError("The cleaner time must be whole minutes, from 15 minutes to a week.");
  const reason = input.reason.trim().slice(0, 1000);
  if (!reason) throw userError("Say why this property has its own price, for example after a walkthrough. The Owner reads it first.");
  const today = dayOf(Date.now(), ctx.company.timezone);
  const until = checkUntil(input.until, today);
  const current = await activePrice(ctx, ctx.companyId, property._id, service._id);
  if (current && current.baseCents === input.baseCents && current.laborMinutes === input.laborMinutes && canonical(current.until) === canonical(until)) throw userError("This property already has this price.");
  const name = propertyName(property);
  const per = live.spec.pricing.method === "recurring_package" ? "month" : live.spec.visitWord;
  const impact = [
    `Visits at ${name} for "${service.name}" start from a base price of ${formatCents(input.baseCents)} per ${per}, instead of the service's (${priceSummary(live.spec)}).`,
    "Extras, rush, discounts, the minimum charge and rounding still come from the service.",
    ...(current ? [`It replaces this property's current price of ${formatCents(current.baseCents)}.`] : []),
    ...(input.laborMinutes !== null ? [`Visits here are planned at ${minutesWords(input.laborMinutes)} of cleaner time.`] : []),
    until
      ? until.kind === "end"
        ? `After ${dayWords(until.date)}, the property pays the service's price again. You are reminded two weeks before.`
        : `You are reminded two weeks before ${dayWords(until.date)} to review it. It stays in force until a person changes or ends it.`
      : "It has no end date: it stays until a person changes or ends it.",
    "Visits already booked keep the price they were booked with.",
    "A later change to the service's price does not change this property's price.",
  ];
  return { service, live, property, customer, current, until, reason, name, impact };
}

/**
 * Puts a property's own price in review. An earlier proposal for the same property and service that is
 * still open is replaced by this one. Nothing prices a visit until the Owner approves it.
 */
export async function proposePropertyPrice(ctx: MutationCtx & MemberAccess, input: Proposal & { actor: Actor; via: "workspace" | "chat" }): Promise<{ changeId: Id<"serviceChanges">; title: string }> {
  const checked = await reviewProposal(ctx, input);
  const { service, property, current, until, reason, name, impact } = checked;
  for (const change of await openChanges(ctx, ctx.companyId, service._id)) {
    if (change.kind === "property_price" && change.propertyPrice?.propertyId === property._id) await closeChange(ctx, change, "superseded", "A newer price for this property was proposed.");
  }
  const proposed = { propertyId: property._id, baseCents: input.baseCents, laborMinutes: input.laborMinutes, until, replaces: current?._id ?? null };
  const now = Date.now();
  const title = `Own price for ${name}`.slice(0, 200);
  const changeId = await ctx.db.insert("serviceChanges", {
    companyId: ctx.companyId,
    serviceId: service._id,
    kind: "property_price",
    state: "in_review",
    hash: sha256(canonical({ kind: "property_price", serviceId: service._id, ...proposed })),
    title,
    reason,
    evidence: input.via === "chat" ? [{ kind: "note", label: "Proposed in Chat", detail: "Selestial proposed this in Company Chat, on the person's request." }] : [],
    agentNotes: [],
    impact,
    customerNotice: { required: false, note: "" },
    contractReview: { required: false, note: "" },
    propertyPrice: proposed,
    submittedBy: input.actor,
    submittedAt: now,
    updatedAt: now,
  });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "service.property_price_proposed", actor: input.actor, subject: { table: "serviceChanges", id: changeId }, data: { service: service.name, via: input.via } });
  return { changeId, title };
}

/** Why an approved property price cannot go live now, or null. */
export async function propertyPriceProblem(ctx: QueryCtx, change: Doc<"serviceChanges">): Promise<string | null> {
  const proposed = change.propertyPrice;
  if (!proposed) return "This change has no price.";
  const property = await ctx.db.get(proposed.propertyId);
  if (!property || property.status !== "active") return "The property is no longer active.";
  const current = await activePrice(ctx, change.companyId, proposed.propertyId, change.serviceId);
  if ((current?._id ?? null) !== proposed.replaces) return "This property's price changed after this was proposed.";
  return null;
}

/** Makes an approved property price the one in force. The price it replaces is kept, marked replaced. */
export async function applyPropertyPrice(ctx: MutationCtx, change: Doc<"serviceChanges">, approvedBy: Id<"members">): Promise<Id<"propertyPrices">> {
  const proposed = change.propertyPrice!;
  const property = (await ctx.db.get(proposed.propertyId))!;
  const service = (await ctx.db.get(change.serviceId))!;
  const now = Date.now();
  const current = await activePrice(ctx, change.companyId, proposed.propertyId, change.serviceId);
  if (current) await ctx.db.patch(current._id, { state: "replaced", endedAt: now, endedReason: "A newer approved price replaced it.", updatedAt: now });
  return ctx.db.insert("propertyPrices", {
    companyId: change.companyId,
    serviceId: change.serviceId,
    propertyId: proposed.propertyId,
    customerId: property.customerId,
    baseCents: proposed.baseCents,
    laborMinutes: proposed.laborMinutes,
    until: proposed.until,
    reason: change.reason,
    state: "active",
    changeId: change._id,
    catalogVersion: service.publishedVersion ?? null,
    approvedBy,
    approvedAt: change.approval?.at ?? now,
    updatedAt: now,
  });
}

/** Ends a property's own price now. From its next visit, the property pays the service's price. */
export async function endPropertyPrice(ctx: MutationCtx, row: Doc<"propertyPrices">, reason: string, actor: Actor) {
  const now = Date.now();
  await ctx.db.patch(row._id, { state: "ended", endedAt: now, endedReason: reason.slice(0, 500), updatedAt: now });
  await recordEvent(ctx, { companyId: row.companyId, type: "service.property_price_ended", actor, subject: { table: "propertyPrices", id: row._id }, data: { reason: reason.slice(0, 200) } });
}

/** The properties that have their own price for a service, for the review of a catalog change. */
export async function ownPricesFor(ctx: QueryCtx, companyId: Id<"companies">, serviceId: Id<"services">) {
  const rows = await ctx.db
    .query("propertyPrices")
    .withIndex("by_company_service_state", (q) => q.eq("companyId", companyId).eq("serviceId", serviceId).eq("state", "active"))
    .take(200);
  const out = [];
  for (const row of rows) {
    const property = await ctx.db.get(row.propertyId);
    const customer = await ctx.db.get(row.customerId);
    out.push({ id: row._id, property: property ? propertyName(property) : "A property", customer: customer?.name ?? "A customer", baseCents: row.baseCents, until: row.until, untilWords: untilWords(row.until) });
  }
  return out.sort((a, b) => a.property.localeCompare(b.property));
}

/** The reminder for a price's review or end date, once, two weeks before. */
export function reminderDue(row: Doc<"propertyPrices">, today: string): boolean {
  if (!row.until) return false;
  if (row.remindedFor === `${row.until.kind}:${row.until.date}`) return false;
  return addDays(today, REMIND_DAYS) >= row.until.date;
}
