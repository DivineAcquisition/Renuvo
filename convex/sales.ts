/**
 * Sales workspace, part one: drafts, finding or adding the customer, live server-side pricing, and saved
 * quotes. Bookings (convex/bookings.ts), recurring plans (convex/plans.ts) and proposals
 * (convex/proposals.ts) build on the same draft.
 *
 * Any member can take a booking. The member who saves is recorded from their sign-in, never from a typed
 * name. Money shown here is always the engine's, on the published service version.
 */
import { discountInBand } from "./lib/sales/settings";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, type MemberAccess } from "./lib/builders";
import { matchesFor, normalPhone, WHY_WORDS } from "./lib/cleaners/duplicates";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { checkCapacity } from "./lib/sales/capacity";
import { cadenceLabel } from "./lib/sales/cadence";
import { bookingNeeds, cleanBody, proposalNeeds, type DraftBody } from "./lib/sales/draft";
import { contributionFor, priceBooking, priceChoice, type PricedVisit } from "./lib/sales/pricing";
import { BOOKING_KINDS, DRAFT_MODES, MILESTONES, segmentValidator, type Milestone, type Segment } from "./lib/sales/schema";
import { saveQuote } from "./lib/services/operations";
import { publishedByKey, publishedCatalog } from "./lib/services/store";
import { businessSettingsOf, normalizePostalCode } from "./lib/settings/business";
import { literals, type WORK_KINDS } from "./lib/statuses";

type WorkKind = (typeof WORK_KINDS)[number];
import { optionalEmail, optionalText, text } from "./lib/text";
import { addressValidator } from "./schema";

type Ctx = (QueryCtx | MutationCtx) & MemberAccess;

export const KIND_FOR_SEGMENT: Record<Segment, WorkKind> = { residential: "home", commercial: "commercial", office: "commercial", str: "short_term_rental" };
const SEGMENT_FOR_KIND: Record<WorkKind, Segment> = { home: "residential", commercial: "commercial", property_manager: "commercial", short_term_rental: "str" };

async function ownedDraft(ctx: Ctx, draftId: Id<"salesDrafts">): Promise<Doc<"salesDrafts">> {
  return owned(ctx, draftId);
}

export async function setMilestone(ctx: MutationCtx & MemberAccess, opportunityId: Id<"salesOpportunities"> | undefined, milestone: Milestone, nextAction?: string) {
  if (!opportunityId) return;
  const opportunity = await ctx.db.get(opportunityId);
  if (!opportunity || opportunity.companyId !== ctx.companyId) return;
  const stage = milestone === "service_activated" ? "won" : milestone === "declined" || milestone === "expired" ? opportunity.stage : opportunity.stage === "new" || opportunity.stage === "qualifying" ? "quoting" : opportunity.stage;
  await ctx.db.patch(opportunityId, { milestone, stage, ...(nextAction ? { nextAction } : {}), updatedAt: Date.now() });
}

// ── Drafts ────────────────────────────────────────────────────────────────────────────────────────

export const startDraft = companyMutation({
  args: {
    mode: literals(DRAFT_MODES),
    segment: v.optional(segmentValidator),
    bookingKind: v.optional(literals(BOOKING_KINDS)),
    customerId: v.optional(v.id("customers")),
    propertyId: v.optional(v.id("properties")),
    opportunityId: v.optional(v.id("salesOpportunities")),
    jobId: v.optional(v.id("jobs")),
    from: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const customer = args.customerId ? await owned(ctx, args.customerId) : null;
    const opportunity = args.opportunityId ? await owned(ctx, args.opportunityId) : null;
    // One open draft per opportunity: opening it again returns the same draft, never a duplicate.
    if (opportunity) {
      const existing = await ctx.db
        .query("salesDrafts")
        .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", opportunity._id))
        .order("desc")
        .first();
      if (existing && (existing.status === "open" || existing.status === "quoted")) return existing._id;
    }
    let propertyId = args.propertyId;
    if (propertyId) {
      const property = await owned(ctx, propertyId);
      if (customer && property.customerId !== customer._id) throw userError("That property belongs to a different customer.");
    }
    const body: DraftBody = {};
    // From Dispatch: start from a visit the customer already had (same service and answers, new date).
    if (args.jobId) {
      const job = await owned(ctx, args.jobId);
      propertyId = propertyId ?? job.propertyId;
      const quoteId = job.serviceSnapshot?.quoteId;
      const saved = quoteId ? await ctx.db.get(quoteId) : null;
      if (job.serviceSnapshot?.serviceId && saved) body.service = { key: job.serviceSnapshot.serviceId, input: JSON.parse(saved.input) };
    }
    const segment = args.segment ?? (opportunity ? opportunity.segment : customer ? SEGMENT_FOR_KIND[customer.kind] : "residential");
    const mode = args.mode === "proposal" && segment === "residential" ? "booking" : args.mode;
    if (mode === "proposal") body.proposal = { sites: [], terms: { invoiceFrequency: "monthly", expiresInDays: 30 } };
    const now = Date.now();
    const draftId = await ctx.db.insert("salesDrafts", {
      companyId: ctx.companyId,
      mode,
      segment,
      bookingKind: args.bookingKind ?? "one_time",
      ...(opportunity ? { opportunityId: opportunity._id } : {}),
      ...(customer ? { customerId: customer._id } : opportunity?.customerId ? { customerId: opportunity.customerId } : {}),
      ...(propertyId ? { propertyId } : {}),
      ...(args.from ? { entry: { from: args.from.slice(0, 40), ...(args.opportunityId ? { id: args.opportunityId } : args.customerId ? { id: args.customerId } : {}) } } : {}),
      body,
      revision: 0,
      status: "open",
      createdBy: ctx.member._id,
      updatedBy: ctx.member._id,
      createdAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "sales_draft.started", actor: byMember(ctx), subject: { table: "salesDrafts", id: draftId }, data: { mode, segment } });
    return draftId;
  },
});

export const drafts = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("salesDrafts")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(60);
    const out = [];
    for (const row of rows) {
      if (row.status === "archived") continue;
      const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
      const by = row.updatedBy ? await ctx.db.get(row.updatedBy) : null;
      out.push({ _id: row._id, mode: row.mode, segment: row.segment, bookingKind: row.bookingKind, status: row.status, customer: customer?.name ?? null, updatedAt: row.updatedAt, by: by?.name ?? (row.updatedBy ? null : "Sales agent"), bookingId: row.bookingId ?? null, proposalId: row.proposalId ?? null, quoteId: row.quoteId ?? null });
    }
    return out;
  },
});

export const draft = companyQuery({
  args: { draftId: v.id("salesDrafts") },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    const customer = draft.customerId ? await ctx.db.get(draft.customerId) : null;
    const properties = customer
      ? await ctx.db
          .query("properties")
          .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
          .take(50)
      : [];
    const creator = draft.createdBy ? await ctx.db.get(draft.createdBy) : null;
    const editor = draft.updatedBy ? await ctx.db.get(draft.updatedBy) : null;
    const opportunity = draft.opportunityId ? await ctx.db.get(draft.opportunityId) : null;
    const catalog = (await publishedCatalog(ctx, ctx.companyId))
      .filter((row) => row.service.status === "active")
      .map((row) => ({ key: row.service.key, name: row.version.spec.name, category: row.version.spec.category, spec: row.version.spec, version: row.version.version }));
    return {
      draft,
      customer,
      properties: properties.filter((p) => p.status === "active"),
      opportunity: opportunity ? { _id: opportunity._id, title: opportunity.title, milestone: opportunity.milestone ?? null, stage: opportunity.stage } : null,
      createdBy: creator?.name ?? (draft.createdBy ? "A team member" : "Sales agent"),
      updatedBy: editor?.name ?? (draft.updatedBy ? "A team member" : "Sales agent"),
      catalog,
      timezone: ctx.company.timezone,
      role: ctx.role,
      serviceAreas: businessSettingsOf(ctx.company).serviceAreas,
      hours: businessSettingsOf(ctx.company).hours,
    };
  },
});

export const saveDraft = companyMutation({
  args: {
    draftId: v.id("salesDrafts"),
    revision: v.number(),
    mode: v.optional(literals(DRAFT_MODES)),
    segment: v.optional(segmentValidator),
    bookingKind: v.optional(literals(BOOKING_KINDS)),
    customerId: v.optional(v.union(v.id("customers"), v.null())),
    propertyId: v.optional(v.union(v.id("properties"), v.null())),
    body: v.any(),
  },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    if (draft.status === "archived") throw userError("This draft was archived.");
    if (draft.revision !== args.revision) throw userError("This draft was changed in another window. Reload to see the latest before saving.");
    let body: DraftBody;
    try {
      body = cleanBody(args.body);
    } catch (caught) {
      throw userError(caught instanceof Error ? caught.message : "This draft could not be saved.");
    }
    const customerId = args.customerId === undefined ? draft.customerId : args.customerId ?? undefined;
    let propertyId = args.propertyId === undefined ? draft.propertyId : args.propertyId ?? undefined;
    if (customerId) await owned(ctx, customerId);
    if (propertyId) {
      const property = await owned(ctx, propertyId);
      if (property.customerId !== customerId) propertyId = undefined;
    }
    const mode = args.mode ?? draft.mode;
    const segment = args.segment ?? draft.segment;
    if (mode === "proposal" && segment === "residential") throw userError("Proposals are for commercial, office and short-term rental work. Book residential service directly.");
    // Switching modes keeps everything compatible; a proposal draft gets its section if it has none.
    if (mode === "proposal" && !body.proposal) body.proposal = { sites: [], terms: { invoiceFrequency: "monthly", expiresInDays: 30 } };
    await ctx.db.replace(draft._id, {
      ...draft,
      mode,
      segment,
      bookingKind: args.bookingKind ?? draft.bookingKind,
      customerId,
      propertyId,
      body,
      revision: draft.revision + 1,
      updatedBy: ctx.member._id,
      updatedAt: Date.now(),
    });
    return { revision: draft.revision + 1 };
  },
});

export const archiveDraft = companyMutation({
  args: { draftId: v.id("salesDrafts") },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    if (draft.status === "requested" || draft.status === "confirmed") throw userError("This draft has a booking. Cancel the booking instead.");
    await ctx.db.patch(draft._id, { status: "archived", updatedAt: Date.now(), updatedBy: ctx.member._id });
    return null;
  },
});

// ── Customers ─────────────────────────────────────────────────────────────────────────────────────

/** Customers and their addresses matching a name, email, phone or postal code. Archived customers are left out. */
export const findCustomers = companyQuery({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const q = args.q.trim().toLowerCase();
    if (q.length < 2) return [];
    const phone = normalPhone(q);
    const rows = await ctx.db
      .query("customers")
      .withIndex("by_company_status", (r) => r.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(2000);
    const out = [];
    for (const customer of rows) {
      const properties = await ctx.db
        .query("properties")
        .withIndex("by_company_customer", (r) => r.eq("companyId", ctx.companyId).eq("customerId", customer._id))
        .take(20);
      const hit =
        customer.name.toLowerCase().includes(q) ||
        (customer.email ?? "").toLowerCase().includes(q) ||
        (phone !== null && phone.length >= 7 && normalPhone(customer.phone) === phone) ||
        properties.some((p) => `${p.address.line1} ${p.address.city} ${p.address.postalCode}`.toLowerCase().includes(q));
      if (!hit) continue;
      out.push({ _id: customer._id, name: customer.name, kind: customer.kind, email: customer.email ?? null, phone: customer.phone ?? null, properties: properties.filter((p) => p.status === "active").map((p) => ({ _id: p._id, label: p.label ?? null, line1: p.address.line1, city: p.address.city, postalCode: p.address.postalCode })) });
      if (out.length >= 12) break;
    }
    return out;
  },
});

/** The customer's history for the person on the phone: recent visits, open quotes and bookings. */
export const customerContext = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(6);
    const quotes = await ctx.db
      .query("salesQuotes")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(5);
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .order("desc")
      .take(5);
    const plans = await ctx.db
      .query("recurringPlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(5);
    return {
      visits: jobs.map((job) => ({ _id: job._id, service: job.serviceSnapshot?.name ?? job.serviceType, startsAt: job.startsAt, status: job.status, priceCents: job.priceCents ?? null })),
      quotes: quotes.map((row) => ({ _id: row._id, status: row.status, totalCents: row.visit.totalCents, expiresAt: row.expiresAt, createdAt: row.createdAt })),
      bookings: bookings.map((row) => ({ _id: row._id, status: row.status, startsAt: row.slot.startsAt, priceCents: row.priceCents })),
      plans: plans.map((row) => ({ _id: row._id, status: row.status })),
    };
  },
});

/** Possible duplicates for a new customer. Shown as a warning; nothing is merged. */
export const duplicates = companyQuery({
  args: { name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.name.trim().length < 2 && !args.email && !args.phone) return [];
    return duplicatesOf(ctx, args);
  },
});

async function duplicatesOf(ctx: Ctx, person: { name: string; email?: string; phone?: string }) {
  const rows = await ctx.db
    .query("customers")
    .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
    .take(2000);
  const matches = matchesFor(person, rows.map((row) => ({ id: row._id, name: row.name, email: row.email, phone: row.phone })));
  return matches.slice(0, 5).map((match) => ({ customerId: match.id as Id<"customers">, name: match.name, strong: match.strong, why: match.why.map((w) => WHY_WORDS[w]).join(", ") }));
}

/**
 * Adds a customer (and their address) without leaving the workspace, and puts them on the draft. A strong
 * duplicate (same email or phone) is returned for the person to choose instead, unless they confirm this
 * is a different customer. Nothing is ever merged automatically.
 */
export const quickCreate = companyMutation({
  args: {
    draftId: v.id("salesDrafts"),
    customer: v.object({ name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()), preferences: v.optional(v.string()) }),
    property: v.optional(v.object({ address: addressValidator, label: v.optional(v.string()), accessInstructions: v.optional(v.string()) })),
    confirmedNew: v.boolean(),
  },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    if (!args.confirmedNew) {
      const found = (await duplicatesOf(ctx, args.customer)).filter((m) => m.strong);
      if (found.length) return { created: false as const, duplicates: found };
    }
    const email = optionalEmail(args.customer.email);
    const phone = optionalText(args.customer.phone, "Phone", 40);
    if (!email && !phone) throw userError("Add an email or a phone number, so the customer can be reached.");
    const kind = KIND_FOR_SEGMENT[draft.segment];
    const customerId = await ctx.db.insert("customers", { companyId: ctx.companyId, name: text(args.customer.name, "Name", 160), kind, email, phone, preferences: optionalText(args.customer.preferences, "Preferences"), status: "active", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.created", actor: byMember(ctx), subject: { table: "customers", id: customerId }, data: { from: "sales_workspace" } });
    let propertyId: Id<"properties"> | undefined;
    if (args.property) propertyId = await insertProperty(ctx, customerId, kind, args.property);
    // The workspace puts the new customer on the draft with its next save, so the draft's revision stays the person's.
    if (draft.opportunityId) await ctx.db.patch(draft.opportunityId, { customerId, updatedAt: Date.now() });
    return { created: true as const, customerId, propertyId: propertyId ?? null };
  },
});

async function insertProperty(ctx: MutationCtx & MemberAccess, customerId: Id<"customers">, kind: WorkKind, input: { address: typeof addressValidator.type; label?: string; accessInstructions?: string }) {
  const a = input.address;
  const located = typeof a.lat === "number" && typeof a.lng === "number" && Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180;
  const propertyId = await ctx.db.insert("properties", {
    companyId: ctx.companyId,
    customerId,
    address: { line1: text(a.line1, "Street address", 200), line2: optionalText(a.line2, "Address line 2", 200), city: text(a.city, "City", 120), region: text(a.region, "State or region", 80), postalCode: text(a.postalCode, "Postal code", 20).toUpperCase(), ...(a.placeId ? { placeId: a.placeId.slice(0, 300) } : {}), ...(located ? { lat: a.lat, lng: a.lng } : {}) },
    kind,
    label: optionalText(input.label, "Label", 120),
    accessInstructions: optionalText(input.accessInstructions, "Access instructions"),
    status: "active",
    createdAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "property.created", actor: byMember(ctx), subject: { table: "properties", id: propertyId }, data: { from: "sales_workspace" } });
  return propertyId;
}

export const addProperty = companyMutation({
  args: { draftId: v.id("salesDrafts"), address: addressValidator, label: v.optional(v.string()), accessInstructions: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    if (!draft.customerId) throw userError("Choose the customer first.");
    const customer = await owned(ctx, draft.customerId);
    return insertProperty(ctx, customer._id, customer.kind, args);
  },
});

// ── Live pricing and readiness ────────────────────────────────────────────────────────────────────

function visitView(priced: PricedVisit | null) {
  if (!priced) return null;
  const q = priced.quote;
  return { serviceKey: priced.serviceKey, name: priced.name, version: priced.version, outcome: q.outcome, reasons: q.reasons, totalCents: q.totalCents, per: q.per, lines: q.lines.filter((line) => line.kind !== "info" || line.amountCents !== 0), includedScope: q.includedScope, extras: q.extras, time: q.time, warnings: q.warnings, missing: q.missing, str: q.str };
}

/**
 * The live summary for a draft, priced on the server from the published services. Recomputed whenever
 * the draft is saved. Estimated costs are included for the Owner only.
 */
export const price = companyQuery({
  args: { draftId: v.id("salesDrafts") },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    const body = draft.body as DraftBody;
    const customer = draft.customerId ? await ctx.db.get(draft.customerId) : null;
    const property = draft.propertyId ? await ctx.db.get(draft.propertyId) : null;
    const settings = businessSettingsOf(ctx.company);
    const inServiceArea = property ? (settings.serviceAreas.length === 0 ? true : settings.serviceAreas.includes(normalizePostalCode(property.address.postalCode))) : null;
    const reachable = Boolean(customer && (customer.email || customer.phone));

    if (draft.mode === "proposal") {
      const sitePrices: Record<string, { outcome: string | null; cents: number | null; per: string | null; name: string | null; lines: { label: string; amountCents: number }[]; reasons: string[] }> = {};
      for (const site of body.proposal?.sites ?? []) {
        const siteProperty = site.propertyId ? await ctx.db.get(site.propertyId as Id<"properties">) : null;
        const postal = siteProperty && siteProperty.companyId === ctx.companyId ? { postalCode: siteProperty.address.postalCode } : {};
        const priced = site.serviceKey ? await priceChoice(ctx, ctx.company, { key: site.serviceKey, input: site.input ?? {} }, postal, null) : null;
        sitePrices[site.key] = { outcome: priced?.quote.outcome ?? null, cents: priced?.quote.totalCents ?? null, per: priced?.quote.per ?? null, name: priced?.name ?? null, lines: priced ? priced.quote.lines.filter((l) => l.amountCents !== 0).map((l) => ({ label: l.label, amountCents: l.amountCents })) : [], reasons: priced?.quote.reasons ?? [] };
      }
      return { mode: "proposal" as const, sitePrices, needs: proposalNeeds(body, { hasCustomer: Boolean(customer), customerReachable: Boolean(customer?.email), sitePrices }) };
    }

    const pricing = await priceBooking(ctx, ctx.company, body, draft.bookingKind, property?.address.postalCode ?? null);
    const capacity = pricing.startsAt !== null && pricing.endsAt !== null && pricing.crew !== null ? await checkCapacity(ctx, ctx.company, { startsAt: pricing.startsAt, endsAt: pricing.endsAt }, pricing.crew, draft.bookingId) : null;
    const lead = pricing.first ?? pricing.visit;
    const needs = bookingNeeds(body, {
      hasCustomer: Boolean(customer),
      hasProperty: Boolean(property),
      customerReachable: reachable,
      inServiceArea,
      serviceFound: Boolean(pricing.visit),
      outcome: pricing.visit?.quote.outcome ?? null,
      missing: pricing.visit?.quote.missing ?? [],
      firstOutcome: pricing.first?.quote.outcome ?? null,
      capacity: capacity?.state ?? null,
      overrideNeedsApproval: Boolean(pricing.override) && !isOwner(ctx.role) && !discountInBand(ctx.company, pricing.override!),
      segment: draft.segment,
      bookingKind: draft.bookingKind,
    });
    return {
      mode: "booking" as const,
      visit: visitView(pricing.visit),
      first: visitView(pricing.first),
      firstNote: pricing.firstNote,
      recurringNote: pricing.recurringNote,
      cadence: draft.bookingKind === "recurring" && body.recurring?.cadence ? cadenceLabel(body.recurring.cadence) : null,
      firstCents: pricing.firstCents,
      ongoingCents: pricing.ongoingCents,
      dueNowCents: pricing.dueNowCents,
      dueLaterCents: pricing.dueLaterCents,
      override: pricing.override,
      startsAt: pricing.startsAt,
      endsAt: pricing.endsAt,
      crew: pricing.crew,
      durationMinutes: pricing.durationMinutes,
      capacity,
      inServiceArea,
      needs,
      contribution: isOwner(ctx.role) ? await contributionFor(ctx, ctx.companyId, lead, pricing.firstCents) : null,
    };
  },
});

/** Capacity for a time before it is saved, for the schedule picker. */
export const capacity = companyQuery({
  args: { startsAt: v.number(), minutes: v.number(), crew: v.number() },
  handler: async (ctx, args) => {
    if (args.minutes <= 0 || args.minutes > 24 * 60 || args.crew < 1 || args.crew > 12) throw userError("Check the visit's length and crew.");
    return checkCapacity(ctx, ctx.company, { startsAt: args.startsAt, endsAt: args.startsAt + args.minutes * 60_000 }, args.crew);
  },
});

// ── Quotes ────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;

/**
 * Saves the draft's price as a quote: the engine's result on the published version, with its exact
 * inputs, held until it expires. It does not book anything or reserve time.
 */
export const saveQuoteFromDraft = companyMutation({
  args: { draftId: v.id("salesDrafts"), revision: v.number(), expiresInDays: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const draft = await ownedDraft(ctx, args.draftId);
    if (draft.revision !== args.revision) throw userError("The draft changed since this was shown. Review the summary again.");
    if (draft.mode !== "booking") throw userError("Save quotes from Book service. Proposals are sent as proposals.");
    if (!draft.customerId || !draft.propertyId) throw userError("Choose the customer and address first.");
    const property = await owned(ctx, draft.propertyId);
    const body = draft.body as DraftBody;
    const pricing = await priceBooking(ctx, ctx.company, body, draft.bookingKind, property.address.postalCode);
    if (!pricing.visit) throw userError("Choose a published service first.");
    for (const priced of [pricing.visit, pricing.first]) {
      if (!priced) continue;
      if (priced.quote.outcome === "incomplete") throw userError(`This price needs: ${priced.quote.missing.join(", ")}.`);
      if (priced.quote.outcome === "walkthrough" || priced.quote.totalCents === null) throw userError(`${priced.quote.reasons.join(" ")} Prepare a proposal or schedule an assessment instead.`);
    }
    if (pricing.override) throw userError("A quote is saved at the calculated price. Remove the price change, or send it with the booking for approval.");
    const days = Math.min(Math.max(Math.round(args.expiresInDays ?? 14), 1), 90);
    const saveOne = async (priced: PricedVisit) => {
      const found = (await publishedByKey(ctx, ctx.companyId, priced.serviceKey))!;
      const id = await saveQuote(ctx, { companyId: ctx.companyId, service: found.service, version: found.version, quoteInput: priced.input, result: priced.quote, purpose: "sales", actor: byMember(ctx) });
      return { serviceKey: priced.serviceKey, versionId: priced.versionId, serviceQuoteId: id, totalCents: priced.quote.totalCents!, outcome: priced.quote.outcome };
    };
    // Earlier saved quotes for this draft are superseded, so only one is live.
    const earlier = await ctx.db
      .query("salesQuotes")
      .withIndex("by_company_draft", (q) => q.eq("companyId", ctx.companyId).eq("draftId", draft._id))
      .take(20);
    for (const row of earlier) if (row.status === "saved" || row.status === "sent") await ctx.db.patch(row._id, { status: "superseded" });
    const visit = await saveOne(pricing.visit);
    const first = pricing.first ? await saveOne(pricing.first) : undefined;
    const now = Date.now();
    const quoteId = await ctx.db.insert("salesQuotes", {
      companyId: ctx.companyId,
      draftId: draft._id,
      ...(draft.opportunityId ? { opportunityId: draft.opportunityId } : {}),
      customerId: draft.customerId,
      propertyId: draft.propertyId,
      kind: draft.bookingKind,
      visit,
      ...(first ? { first } : {}),
      ...(draft.bookingKind === "recurring" && body.recurring?.cadence ? { cadence: body.recurring.cadence } : {}),
      snapshot: {
        service: pricing.visit.name,
        scope: pricing.visit.quote.includedScope,
        lines: pricing.visit.quote.lines.filter((l) => l.amountCents !== 0).map((l) => ({ label: l.label, amountCents: l.amountCents })),
        first: pricing.first ? { service: pricing.first.name, totalCents: pricing.first.quote.totalCents, lines: pricing.first.quote.lines.filter((l) => l.amountCents !== 0).map((l) => ({ label: l.label, amountCents: l.amountCents })) } : null,
        firstNote: pricing.firstNote,
        cadence: draft.bookingKind === "recurring" && body.recurring?.cadence ? cadenceLabel(body.recurring.cadence) : null,
        per: pricing.visit.quote.per,
      },
      status: "saved",
      expiresAt: now + days * DAY,
      createdBy: ctx.member._id,
      createdAt: now,
    });
    await ctx.db.patch(draft._id, { quoteId, status: draft.status === "open" ? "quoted" : draft.status, updatedAt: now });
    await setMilestone(ctx, draft.opportunityId, "quote_saved", "Send the quote or book the service");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "sales_quote.saved", actor: byMember(ctx), subject: { table: "salesQuotes", id: quoteId }, data: { totalCents: visit.totalCents, firstCents: first?.totalCents ?? null } });
    return { quoteId, expiresAt: now + days * DAY };
  },
});

export const quotes = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("salesQuotes")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(100);
    const now = Date.now();
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      const by = row.createdBy ? await ctx.db.get(row.createdBy) : null;
      const status = (row.status === "saved" || row.status === "sent") && row.expiresAt < now ? ("expired" as const) : row.status;
      out.push({ _id: row._id, draftId: row.draftId, customer: customer?.name ?? "Customer", kind: row.kind, status, totalCents: row.visit.totalCents, firstCents: row.first?.totalCents ?? null, service: (row.snapshot as { service?: string })?.service ?? row.visit.serviceKey, cadence: (row.snapshot as { cadence?: string | null })?.cadence ?? null, expiresAt: row.expiresAt, createdAt: row.createdAt, by: by?.name ?? (row.createdBy ? null : "Sales agent") });
    }
    return out;
  },
});

export const MILESTONE_LIST = MILESTONES;
