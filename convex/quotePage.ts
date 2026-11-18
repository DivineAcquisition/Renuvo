/**
 * The customer's quote page: read the offer, choose a time, accept it, decline it, or ask a question,
 * without signing in. The link's token is the only authorization (convex/lib/builders.ts
 * salesLinkQuery / salesLinkMutation, kind "quote").
 *
 * Accepting names one exact quote by its fingerprint. If the quote was replaced, withdrawn or has passed
 * its last day since the page was opened, nothing is accepted and the page says which. An acceptance is
 * the customer's yes to a price and scope. It is not a confirmed booking: the page says so, and the
 * booking is made by the booking engine only when its steps are done and the time is still open.
 *
 * Opening the page changes nothing and is not recorded.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { salesLinkMutation, salesLinkQuery } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { quiet } from "./lib/sales/actions";
import { agentStage, bump, load, setNext, setStage, SYSTEM } from "./lib/sales/agentOpportunity";
import { dateIn, openTimes, pageState, quoteView } from "./lib/sales/agentQuotes";
import { withFact } from "./lib/sales/facts";
import { lostReasonFrom } from "./lib/sales/interpret";
import { enqueueRun } from "./lib/sales/runs";
import { optionalText, text } from "./lib/text";

const HOUR = 60 * 60_000;

async function resolve(ctx: QueryCtx | MutationCtx, publicId: string): Promise<{ quote: Doc<"salesQuotes">; company: Doc<"companies"> } | null> {
  const quote = await ctx.db
    .query("salesQuotes")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (!quote) return null;
  const company = await ctx.db.get(quote.companyId);
  return company ? { quote, company } : null;
}

export const view = salesLinkQuery({
  kind: "quote",
  resolve,
  args: {},
  handler: async (ctx) => {
    if (!ctx.link) return null;
    const { quote, company } = ctx.link;
    const now = Date.now();
    const state = pageState(quote, now);
    if (state === "not_sent") return null;
    const opportunity = quote.opportunityId ? await ctx.db.get(quote.opportunityId) : null;
    const customer = await ctx.db.get(quote.customerId);
    const profile = await readProfile(ctx, company._id);
    const property = opportunity?.propertyId ? await ctx.db.get(opportunity.propertyId) : null;
    const booking = opportunity?.bookingId ? await ctx.db.get(opportunity.bookingId) : null;
    // Times are offered while the quote is open, and after acceptance until the booking holds one.
    const choosing = (state === "open" || state === "accepted") && !booking;
    const times = choosing ? await openTimes(ctx, company, quote) : [];
    return {
      state,
      company: { name: profile.messaging.senderName ?? company.name, timezone: company.timezone, phone: profile.identity.supportPhone ?? null, email: profile.identity.supportEmail ?? null },
      customerName: customer?.name ?? "",
      quote: quoteView(quote),
      booking: booking ? { status: booking.status, startsAt: booking.slot.startsAt } : null,
      chosen: opportunity?.timing?.slot ?? null,
      needsAddress: !property,
      needsAccess: !property?.accessInstructions && !(opportunity?.facts ?? []).some((fact) => fact.key === "access"),
      times,
      asked: quote.question ? { text: quote.question.text, at: quote.question.at } : null,
    };
  },
});

const addressArg = v.object({ line1: v.string(), line2: v.optional(v.string()), city: v.string(), region: v.string(), postalCode: v.string() });

/** The address and how to get in, when the customer gives them on the page. */
async function recordDetails(ctx: MutationCtx, quote: Doc<"salesQuotes">, input: { address?: typeof addressArg.type; access?: string }) {
  if (!quote.opportunityId) return;
  let opportunity = await load(ctx, quote.opportunityId);
  const now = Date.now();
  let facts = opportunity.agent.facts;
  let propertyId = opportunity.propertyId;
  if (!propertyId && input.address) {
    const address = { line1: text(input.address.line1, "Street address", 200), line2: optionalText(input.address.line2, "Address line 2", 200), city: text(input.address.city, "City", 100), region: text(input.address.region, "State", 60), postalCode: text(input.address.postalCode, "ZIP code", 12).toUpperCase() };
    propertyId = await ctx.db.insert("properties", { companyId: quote.companyId, customerId: quote.customerId, address, kind: opportunity.agent.kind === "commercial" ? "commercial" : opportunity.agent.kind === "short_term_rental" ? "short_term_rental" : "home", status: "active", createdAt: now });
    facts = withFact(facts, { key: "postalCode", value: address.postalCode, source: { kind: "customer", ref: "quote_page" }, status: "confirmed", at: now }).facts;
    await recordEvent(ctx, { companyId: quote.companyId, type: "property.created", actor: SYSTEM, subject: { table: "properties", id: propertyId }, data: { via: "quote_link" } });
  }
  const access = input.access?.trim().slice(0, 600);
  if (access) {
    facts = withFact(facts, { key: "access", value: access, source: { kind: "customer", ref: "quote_page" }, status: "confirmed", at: now }).facts;
    if (propertyId) {
      const property = await ctx.db.get(propertyId);
      if (property && !property.accessInstructions) await ctx.db.patch(propertyId, { accessInstructions: access });
    }
  }
  opportunity = await bump(ctx, opportunity, { facts, propertyId });
  if (propertyId && opportunity.draftId) {
    const draft = await ctx.db.get(opportunity.draftId);
    if (draft && draft.status !== "confirmed" && draft.status !== "archived") await ctx.db.patch(draft._id, { propertyId, revision: draft.revision + 1, updatedAt: now });
  }
  if (propertyId && !quote.propertyId) await ctx.db.patch(quote._id, { propertyId });
}

/** A time the customer chose, if it is still one the page offers. Otherwise the acceptance stands and the time is chosen again. */
async function chooseTime(ctx: MutationCtx, company: Doc<"companies">, quote: Doc<"salesQuotes">, startsAt: number): Promise<boolean> {
  if (!quote.opportunityId) return false;
  const offered = await openTimes(ctx, company, quote, 40);
  const span = offered.find((row) => row.startsAt === startsAt);
  if (!span) return false;
  const opportunity = await load(ctx, quote.opportunityId);
  await bump(ctx, opportunity, { timing: { ...opportunity.timing, slot: span, text: opportunity.timing?.text ?? dateIn(span.startsAt, company.timezone) } });
  return true;
}

export type AcceptResult = { status: "accepted"; time: "chosen" | "not_open" | "none" } | { status: "changed" | "expired" | "withdrawn" | "already" | "invalid"; message: string };

export const accept = salesLinkMutation({
  kind: "quote",
  resolve,
  args: { hash: v.string(), name: v.string(), startsAt: v.optional(v.number()), address: v.optional(addressArg), access: v.optional(v.string()) },
  handler: async (ctx, args): Promise<AcceptResult> => {
    const { quote, company } = ctx.link;
    const now = Date.now();
    const state = pageState(quote, now);
    if (state === "accepted") return { status: "already", message: "This quote was already accepted." };
    if (state === "withdrawn" || state === "superseded") return { status: "withdrawn", message: "This quote was replaced or withdrawn. Contact the company for the current one." };
    if (state === "expired") return { status: "expired", message: "This quote has expired. Contact the company for a fresh one." };
    if (state !== "open") return { status: "invalid", message: "This quote cannot be accepted." };
    // The offer on the table is this quote, exactly as shown.
    if (!quote.hash || quote.hash !== args.hash) return { status: "changed", message: "This quote was updated after you opened it. Review the current one before accepting." };
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 120) return { status: "invalid", message: "Type your full name to accept." };
    const row = quote.opportunityId ? await ctx.db.get(quote.opportunityId) : null;
    if (!row || row.stage === "won" || row.stage === "lost") return { status: "invalid", message: "This quote cannot be accepted." };

    await ctx.db.patch(quote._id, { status: "accepted", acceptance: { name, at: now } });
    await recordEvent(ctx, { companyId: company._id, type: "sales_quote.accepted", actor: SYSTEM, subject: { table: "salesQuotes", id: quote._id }, data: { via: "quote_link" } });
    let opportunity = await load(ctx, row._id);
    await quiet(ctx, opportunity, "The customer accepted the quote.", SYSTEM);
    await recordDetails(ctx, quote, { address: args.address, access: args.access });
    let time: "chosen" | "not_open" | "none" = "none";
    if (args.startsAt !== undefined) time = (await chooseTime(ctx, company, (await ctx.db.get(quote._id))!, args.startsAt)) ? "chosen" : "not_open";
    opportunity = await load(ctx, row._id);
    await ctx.db.patch(opportunity._id, { lastInboundAt: Math.max(opportunity.lastInboundAt ?? 0, now) });
    opportunity = await setStage(ctx, await load(ctx, row._id), "booking_pending", SYSTEM);
    opportunity = await setNext(ctx, opportunity, { what: "Request the booking", by: "sales", dueAt: now }, SYSTEM);
    if (!opportunity.agent.takeover) await enqueueRun(ctx, opportunity, { trigger: "quote_accepted", key: `quote-accepted:${quote._id}` });
    return { status: "accepted", time };
  },
});

/** After accepting: the customer chooses or changes the time, or adds the address and access, until the booking holds a time. */
export const finish = salesLinkMutation({
  kind: "quote",
  resolve,
  args: { startsAt: v.optional(v.number()), address: v.optional(addressArg), access: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { quote, company } = ctx.link;
    if (quote.status !== "accepted" || !quote.opportunityId) return { ok: false as const, message: "Accept the quote first." };
    if (!(await allow(ctx, `quote-finish:${quote._id}`, 20, HOUR))) return { ok: false as const, message: "That's a lot of changes at once. Give it a minute, or call us." };
    const row = await ctx.db.get(quote.opportunityId);
    if (!row || row.bookingId) return { ok: false as const, message: "Your booking is already in progress. Contact the company to change it." };
    await recordDetails(ctx, quote, { address: args.address, access: args.access });
    let chosen = true;
    if (args.startsAt !== undefined) chosen = await chooseTime(ctx, company, (await ctx.db.get(quote._id))!, args.startsAt);
    const opportunity = await load(ctx, row._id);
    await ctx.db.patch(opportunity._id, { lastInboundAt: Math.max(opportunity.lastInboundAt ?? 0, Date.now()) });
    if (!opportunity.agent.takeover && agentStage(row) === "booking_pending") await enqueueRun(ctx, opportunity, { trigger: "booking_change", key: `quote-page:${quote._id}:${opportunity.agent.revision}` });
    return chosen ? { ok: true as const, message: "Thanks. We'll confirm your booking shortly." } : { ok: false as const, message: "That time was just taken. Choose another." };
  },
});

export const decline = salesLinkMutation({
  kind: "quote",
  resolve,
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { quote, company } = ctx.link;
    const now = Date.now();
    if (pageState(quote, now) !== "open") return { ok: false as const, message: "This quote is no longer open." };
    const reason = args.reason?.trim().slice(0, 500) || undefined;
    await ctx.db.patch(quote._id, { status: "declined", declined: { reason, at: now } });
    await recordEvent(ctx, { companyId: company._id, type: "sales_quote.declined", actor: SYSTEM, subject: { table: "salesQuotes", id: quote._id }, data: { via: "quote_link" } });
    const row = quote.opportunityId ? await ctx.db.get(quote.opportunityId) : null;
    if (row && row.stage !== "won" && row.stage !== "lost") {
      // A decline ends it. Nothing more is sent, and the reason is kept as the customer gave it.
      const opportunity = await load(ctx, row._id);
      await quiet(ctx, opportunity, "The customer declined the quote.", SYSTEM);
      if (opportunity.intake) await setStage(ctx, await load(ctx, row._id), "closed_lost", SYSTEM, { reason: reason ? lostReasonFrom(reason) : "other", note: reason });
      else await ctx.db.patch(row._id, { milestone: "declined", updatedAt: now });
    }
    return { ok: true as const, message: "Thanks for letting us know." };
  },
});

export const ask = salesLinkMutation({
  kind: "quote",
  resolve,
  args: { question: v.string() },
  handler: async (ctx, args) => {
    const { quote, company } = ctx.link;
    const question = args.question.trim().replace(/\s+/g, " ");
    if (question.length < 3 || question.length > 1000) return { ok: false as const, message: "Type your question, up to 1,000 characters." };
    if (quote.status === "withdrawn" || quote.status === "superseded") return { ok: false as const, message: "This quote was replaced or withdrawn. Contact the company directly." };
    // A few questions an hour per quote, so the page cannot be used to flood the company. A refusal is returned, never thrown.
    if (!(await allow(ctx, `quote-question:${quote._id}`, 5, HOUR))) return { ok: false as const, message: "That's a lot of questions at once. Give us a little time to answer, or call us." };
    const now = Date.now();
    const row = quote.opportunityId ? await ctx.db.get(quote.opportunityId) : null;
    if (!row || !row.customerId) return { ok: false as const, message: "This quote is no longer open." };
    await ctx.db.patch(quote._id, { question: { text: question, at: now } });
    const messageId = await ctx.db.insert("salesMessages", { companyId: company._id, opportunityId: row._id, customerId: row.customerId, direction: "in", channel: "form", author: { kind: "customer" }, subject: "Question about the quote", body: question, at: now });
    const opportunity = await load(ctx, row._id);
    await ctx.db.patch(opportunity._id, { lastInboundAt: Math.max(opportunity.lastInboundAt ?? 0, now), revision: opportunity.agent.revision + 1, updatedAt: now });
    await quiet(ctx, opportunity, "The customer asked a question.", SYSTEM);
    await recordEvent(ctx, { companyId: company._id, type: "opportunity.reply_received", actor: SYSTEM, subject: { table: "salesOpportunities", id: opportunity._id }, data: { channel: "quote_page" } });
    const fresh = await load(ctx, row._id);
    if (fresh.intake && !fresh.agent.takeover && fresh.agent.stage !== "won" && fresh.agent.stage !== "closed_lost") await enqueueRun(ctx, fresh, { trigger: "reply", key: `reply:${messageId}`, messageId });
    return { ok: true as const, message: "Thanks. We'll reply shortly." };
  },
});
