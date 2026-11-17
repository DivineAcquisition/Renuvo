/**
 * The customer's quote page: read the offer, accept it, decline it, or ask a question, without signing
 * in. The link's token is the only authorization (convex/lib/builders.ts quoteQuery / quoteMutation).
 *
 * Accepting names one exact version by its fingerprint. If the quote was revised, withdrawn or has
 * passed its last day since the page was opened, nothing is accepted and the page says which. An
 * acceptance is the customer's yes to a price and scope. It is not a confirmed booking: the page says
 * so, and the booking is made only when every requirement and capacity are checked (booking.ts).
 *
 * Opening the page changes nothing and is not recorded.
 */
import { v } from "convex/values";

import { quoteMutation, quoteQuery } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { quiet } from "./lib/sales/actions";
import { openSlots, placeHold } from "./lib/sales/capacity";
import { withFact } from "./lib/sales/facts";
import { lostReasonFrom } from "./lib/sales/interpret";
import { bump, setNext, setStage, SYSTEM } from "./lib/sales/opportunities";
import { pageState, versionOf, versionView } from "./lib/sales/quotes";
import { enqueueRun } from "./lib/sales/runs";
import { publishedByKey } from "./lib/services/store";
import { optionalText, text } from "./lib/text";

const HOUR = 60 * 60_000;

export const view = quoteQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.quote) return null;
    const { quote, company } = ctx.quote;
    const version = await versionOf(ctx, quote, quote.sentVersion ?? quote.currentVersion);
    if (!version) return null;
    const now = Date.now();
    const state = pageState(quote, now);
    const opportunity = await ctx.db.get(quote.opportunityId);
    const customer = await ctx.db.get(quote.customerId);
    const profile = await readProfile(ctx, company._id);
    const property = opportunity?.propertyId ? await ctx.db.get(opportunity.propertyId) : null;
    // Times are offered only while the quote can still be accepted. They are open now; each is checked again when chosen.
    let slots: { startsAt: number; endsAt: number }[] = [];
    if (state === "open" && opportunity) {
      const service = await publishedByKey(ctx, company._id, version.serviceKey);
      const postal = property?.address.postalCode ?? String(opportunity.facts.find((fact) => fact.key === "postalCode")?.value ?? "");
      if (postal) slots = await openSlots(ctx, company, { serviceName: version.serviceName, skills: service?.version.spec.team.skills ?? [], crew: version.crewSize, postalCode: postal }, { durationMinutes: version.durationMinutes, except: { opportunityId: opportunity._id } });
    }
    return {
      state,
      company: { name: profile.messaging.senderName ?? company.name, timezone: company.timezone, phone: profile.identity.supportPhone ?? null, email: profile.identity.supportEmail ?? null },
      customerName: customer?.name ?? "",
      number: quote.number,
      quote: versionView(version),
      validUntil: quote.validUntil ?? null,
      // An earlier version this link was first sent for has been replaced by the one shown.
      revised: version.version > 1,
      acceptance: quote.acceptance ? { name: quote.acceptance.name, at: quote.acceptance.at, version: quote.acceptance.version } : null,
      booked: opportunity?.jobId !== undefined,
      chosenSlot: opportunity?.timing?.slot ?? null,
      needsAddress: !property,
      slots,
      asked: quote.question ? { text: quote.question.text, at: quote.question.at } : null,
    };
  },
});

export type AcceptResult = { status: "accepted"; slot: "reserved" | "not_reserved" | "none" } | { status: "changed" | "expired" | "revoked" | "already" | "invalid"; message: string };

export const accept = quoteMutation({
  args: {
    version: v.number(),
    /** The fingerprint of the version the customer was shown. */
    hash: v.string(),
    name: v.string(),
    slotStartsAt: v.optional(v.number()),
    address: v.optional(v.object({ line1: v.string(), line2: v.optional(v.string()), city: v.string(), region: v.string(), postalCode: v.string() })),
    access: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AcceptResult> => {
    const quote = ctx.quote;
    const now = Date.now();
    const state = pageState(quote, now);
    if (state === "accepted") return { status: "already", message: "This quote was already accepted." };
    if (state === "revoked") return { status: "revoked", message: "This quote was withdrawn. Contact the company for a new one." };
    if (state === "expired") return { status: "expired", message: "This quote has expired. Contact the company for a fresh one." };
    if (state !== "open" || quote.status !== "sent") return { status: "invalid", message: "This quote cannot be accepted." };
    const version = await versionOf(ctx, quote, args.version);
    // The offer on the table is the version that was sent, exactly as sent.
    if (!version || quote.sentVersion !== args.version || version.hash !== args.hash) return { status: "changed", message: "This quote was updated after you opened it. Review the current version before accepting." };
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 120) return { status: "invalid", message: "Type your full name to accept." };
    let opportunity = await ctx.db.get(quote.opportunityId);
    if (!opportunity || opportunity.stage === "closed_lost" || opportunity.stage === "won") return { status: "invalid", message: "This quote cannot be accepted." };

    await ctx.db.patch(quote._id, { status: "accepted", acceptance: { version: version.version, name, at: now }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "quote.accepted", actor: SYSTEM, subject: { table: "salesQuotes", id: quote._id }, data: { version: version.version, totalCents: version.totalCents, via: "quote_link" } });
    await quiet(ctx, opportunity, "The customer accepted the quote.", SYSTEM);

    // The address and how to get in, when the customer gave them here.
    let facts = opportunity.facts;
    let propertyId = opportunity.propertyId;
    if (!propertyId && args.address) {
      const address = { line1: text(args.address.line1, "Street address", 200), line2: optionalText(args.address.line2, "Address line 2", 200), city: text(args.address.city, "City", 100), region: text(args.address.region, "State", 60), postalCode: text(args.address.postalCode, "ZIP code", 12).toUpperCase() };
      propertyId = await ctx.db.insert("properties", { companyId: ctx.companyId, customerId: quote.customerId, address, kind: opportunity.kind === "commercial" ? "commercial" : opportunity.kind === "short_term_rental" ? "short_term_rental" : "home", status: "active", createdAt: now });
      facts = withFact(facts, { key: "postalCode", value: address.postalCode, source: { kind: "customer", ref: "quote_page" }, status: "confirmed", at: now }).facts;
    }
    const access = args.access?.trim().slice(0, 600);
    if (access) {
      facts = withFact(facts, { key: "access", value: access, source: { kind: "customer", ref: "quote_page" }, status: "confirmed", at: now }).facts;
      if (propertyId) {
        const property = await ctx.db.get(propertyId);
        if (property && !property.accessInstructions) await ctx.db.patch(propertyId, { accessInstructions: access });
      }
    }
    opportunity = await bump(ctx, opportunity, { facts, propertyId, lastInboundAt: Math.max(opportunity.lastInboundAt ?? 0, now) });
    opportunity = await setStage(ctx, opportunity, "booking_pending", SYSTEM);

    // A chosen time is reserved only if it is still open at this moment. If not, the acceptance stands and the time is chosen again.
    let slot: "reserved" | "not_reserved" | "none" = "none";
    if (args.slotStartsAt !== undefined) {
      const property = propertyId ? await ctx.db.get(propertyId) : null;
      const postal = property?.address.postalCode ?? String(facts.find((fact) => fact.key === "postalCode")?.value ?? "");
      const service = await publishedByKey(ctx, ctx.companyId, version.serviceKey);
      const span = { startsAt: args.slotStartsAt, endsAt: args.slotStartsAt + version.durationMinutes * 60_000 };
      const held = await placeHold(ctx, ctx.company, opportunity, { serviceName: version.serviceName, skills: service?.version.spec.team.skills ?? [], crew: version.crewSize, postalCode: postal }, span);
      slot = held.ok ? "reserved" : "not_reserved";
      opportunity = await bump(ctx, (await ctx.db.get(opportunity._id))!, held.ok ? { timing: { ...opportunity.timing, slot: span } } : {});
    }
    await setNext(ctx, opportunity, { what: "Finish the booking steps", by: "sales", dueAt: now }, SYSTEM);
    if (!opportunity.takeover) await enqueueRun(ctx, opportunity, { trigger: "quote_accepted", key: `quote-accepted:${quote._id}:${version.version}` });
    return { status: "accepted", slot };
  },
});

export const decline = quoteMutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const quote = ctx.quote;
    const now = Date.now();
    if (quote.status !== "sent" || pageState(quote, now) !== "open") return { ok: false as const, message: "This quote is no longer open." };
    const reason = args.reason?.trim().slice(0, 500) || undefined;
    await ctx.db.patch(quote._id, { status: "declined", declined: { version: quote.sentVersion ?? quote.currentVersion, reason, at: now }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "quote.declined", actor: SYSTEM, subject: { table: "salesQuotes", id: quote._id }, data: { via: "quote_link" } });
    const opportunity = await ctx.db.get(quote.opportunityId);
    if (opportunity && opportunity.stage !== "won" && opportunity.stage !== "closed_lost") {
      // A decline ends it. Nothing more is sent, and the reason is kept as the customer gave it.
      await quiet(ctx, opportunity, "The customer declined the quote.", SYSTEM);
      await setStage(ctx, (await ctx.db.get(opportunity._id))!, "closed_lost", SYSTEM, { reason: reason ? lostReasonFrom(reason) : "other", note: reason });
    }
    return { ok: true as const, message: "Thanks for letting us know." };
  },
});

export const ask = quoteMutation({
  args: { question: v.string() },
  handler: async (ctx, args) => {
    const quote = ctx.quote;
    const question = args.question.trim().replace(/\s+/g, " ");
    if (question.length < 3 || question.length > 1000) return { ok: false as const, message: "Type your question, up to 1,000 characters." };
    if (quote.status === "revoked") return { ok: false as const, message: "This quote was withdrawn. Contact the company directly." };
    // A few questions an hour per quote, so the page cannot be used to flood the company. A refusal is returned, never thrown.
    if (!(await allow(ctx, `quote-question:${quote._id}`, 5, HOUR))) return { ok: false as const, message: "That's a lot of questions at once. Give us a little time to answer, or call us." };
    const now = Date.now();
    const opportunity = await ctx.db.get(quote.opportunityId);
    if (!opportunity) return { ok: false as const, message: "This quote is no longer open." };
    await ctx.db.patch(quote._id, { question: { text: question, at: now }, updatedAt: now });
    const messageId = await ctx.db.insert("salesMessages", { companyId: ctx.companyId, opportunityId: opportunity._id, customerId: quote.customerId, direction: "in", channel: "form", author: { kind: "customer" }, subject: `Question about quote Q-${quote.number}`, body: question, at: now });
    await ctx.db.patch(opportunity._id, { lastInboundAt: Math.max(opportunity.lastInboundAt ?? 0, now), revision: opportunity.revision + 1, updatedAt: now });
    await quiet(ctx, opportunity, "The customer asked a question.", SYSTEM);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "opportunity.reply_received", actor: SYSTEM, subject: { table: "salesOpportunities", id: opportunity._id }, data: { channel: "quote_page" } });
    const fresh = (await ctx.db.get(opportunity._id))!;
    if (!fresh.takeover && fresh.stage !== "won" && fresh.stage !== "closed_lost") await enqueueRun(ctx, fresh, { trigger: "reply", key: `reply:${messageId}`, messageId });
    return { ok: true as const, message: "Thanks. We'll reply shortly." };
  },
});
