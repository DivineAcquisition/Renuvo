/**
 * Property prices: one property's own base price for a service, reviewed and approved like any other
 * change to prices (lib/services/propertyPrices.ts has the rules and the owner's decisions behind them).
 *
 * Who may do what (checked here, whatever a screen shows):
 *  - everyone in the company reads them, because they price visits the office books;
 *  - Owners and Managers propose one; it waits in Services & Pricing › Changes;
 *  - only the Owner approves one (services.approve) or ends one early.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type QueryCtx } from "./_generated/server";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isManager, isOwner } from "./lib/roles";
import { activePrice, dayOf, dayWords, endPropertyPrice, engineInput, extrasView, priceInForce, propertyName, proposePropertyPrice, reminderDue, untilWords } from "./lib/services/propertyPrices";
import { propertyExtraValidator, untilValidator } from "./lib/services/schema";
import type { Spec } from "./lib/services/spec";
import { ownedService, publishedByKey, publishedSpec } from "./lib/services/store";
import { formatCents } from "./lib/services/words";
import { openTask } from "./lib/taskState";

async function describe(ctx: QueryCtx, row: Doc<"propertyPrices">, service: Doc<"services">, today: string, spec: Spec | null) {
  const property = await ctx.db.get(row.propertyId);
  const customer = await ctx.db.get(row.customerId);
  const approver = await ctx.db.get(row.approvedBy);
  return {
    id: row._id,
    propertyId: row.propertyId,
    property: property ? propertyName(property) : "A property",
    address: property ? `${property.address.line1}, ${property.address.city}` : "",
    customerId: row.customerId,
    customer: customer?.name ?? "A customer",
    baseCents: row.baseCents,
    laborMinutes: row.laborMinutes,
    addedTasks: row.addedTasks ?? [],
    extras: spec ? extrasView(row.extras ?? [], spec) : [],
    until: row.until,
    untilWords: untilWords(row.until),
    /** The review or end date is within two weeks, or already passed. */
    dueSoon: row.until !== null && row.state === "active" && row.until.date <= addDaysIso(today, 14),
    /** An end date already passed: visits from then on pay the service's price. */
    lapsed: row.until?.kind === "end" && row.until.date < today,
    reason: row.reason,
    state: row.state,
    approvedAt: row.approvedAt,
    approvedBy: approver?.name ?? "The Owner",
    catalogVersion: row.catalogVersion,
    /** The service's price changed since this was approved. The property kept its own. */
    catalogMoved: row.catalogVersion !== null && service.publishedVersion !== undefined && service.publishedVersion !== row.catalogVersion,
    endedAt: row.endedAt ?? null,
    endedReason: row.endedReason ?? null,
    changeId: row.changeId,
  };
}

function addDaysIso(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** A service's property prices: those in force, those waiting for the Owner, and the last few that ended. */
export const forService = companyQuery({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const today = dayOf(Date.now(), ctx.company.timezone);
    const spec = (await publishedSpec(ctx, service))?.spec ?? null;
    const active = await ctx.db
      .query("propertyPrices")
      .withIndex("by_company_service_state", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", service._id).eq("state", "active"))
      .take(200);
    const past = [
      ...(await ctx.db
        .query("propertyPrices")
        .withIndex("by_company_service_state", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", service._id).eq("state", "ended"))
        .order("desc")
        .take(10)),
      ...(await ctx.db
        .query("propertyPrices")
        .withIndex("by_company_service_state", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", service._id).eq("state", "replaced"))
        .order("desc")
        .take(10)),
    ]
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, 10);
    const changes = await ctx.db
      .query("serviceChanges")
      .withIndex("by_company_service", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", service._id))
      .order("desc")
      .take(100);
    const waiting = [];
    for (const change of changes) {
      if (change.kind !== "property_price" || !change.propertyPrice || !(change.state === "in_review" || change.state === "approved")) continue;
      const property = await ctx.db.get(change.propertyPrice.propertyId);
      const customer = property ? await ctx.db.get(property.customerId) : null;
      waiting.push({ changeId: change._id, state: change.state, property: property ? propertyName(property) : "A property", customer: customer?.name ?? "A customer", baseCents: change.propertyPrice.baseCents, untilWords: untilWords(change.propertyPrice.until), submittedAt: change.submittedAt, replacesOwnPrice: change.propertyPrice.replaces !== null });
    }
    const rows = await Promise.all(active.map((row) => describe(ctx, row, service, today, spec)));
    return {
      live: service.status === "active" && service.publishedVersion !== undefined,
      active: rows.sort((a, b) => Number(b.dueSoon) - Number(a.dueSoon) || a.property.localeCompare(b.property)),
      waiting,
      past: await Promise.all(past.map((row) => describe(ctx, row, service, today, spec))),
      today,
      canPropose: isManager(ctx.role),
      canEnd: isOwner(ctx.role),
    };
  },
});

/**
 * The approved price for a visit at this property on this day, for the visit form's preview. The server
 * looks it up again when the visit is made; what a screen sends is never trusted for it.
 */
export const forVisit = companyQuery({
  args: { serviceKey: v.string(), propertyId: v.id("properties"), day: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.companyId !== ctx.companyId) return null;
    const catalog = await publishedByKey(ctx, ctx.companyId, args.serviceKey);
    if (!catalog) return null;
    const day = args.day && /^\d{4}-\d{2}-\d{2}$/.test(args.day) ? args.day : dayOf(Date.now(), ctx.company.timezone);
    const row = await priceInForce(ctx, ctx.companyId, property._id, catalog.service._id, day);
    const lapsed = row ? null : await activePrice(ctx, ctx.companyId, property._id, catalog.service._id);
    return {
      price: row ? { ...engineInput(row), addedTasks: row.addedTasks ?? [], untilWords: untilWords(row.until), approvedAt: row.approvedAt } : null,
      /** The property has its own price, but it ends before this visit's day. */
      endsBefore: lapsed?.until?.kind === "end" ? dayWords(lapsed.until.date) : null,
    };
  },
});

/** Every service price this property has of its own, for its customer's page. */
export const forProperty = companyQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await ctx.db.get(args.propertyId);
    if (!property || property.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    const rows = await ctx.db
      .query("propertyPrices")
      .withIndex("by_company_property_service", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id))
      .take(50);
    const out = [];
    for (const row of rows.filter((r) => r.state === "active")) {
      const service = await ctx.db.get(row.serviceId);
      out.push({ id: row._id, serviceId: row.serviceId, service: service?.name ?? "A service", baseCents: row.baseCents, untilWords: untilWords(row.until) });
    }
    return out;
  },
});

/** Every property price in force, by customer, for Customers & Properties. Everyone reads them: they price visits the office books. */
export const forCompany = companyQuery({
  args: {},
  handler: async (ctx) => {
    const today = dayOf(Date.now(), ctx.company.timezone);
    const rows = await ctx.db
      .query("propertyPrices")
      .withIndex("by_company_state", (q) => q.eq("companyId", ctx.companyId).eq("state", "active"))
      .take(500);
    const byCustomer: Record<string, { id: Id<"propertyPrices">; serviceId: Id<"services">; service: string; property: string; baseCents: number; untilWords: string | null; dueSoon: boolean; tasks: number; extras: number }[]> = {};
    for (const row of rows) {
      const [service, property] = [await ctx.db.get(row.serviceId), await ctx.db.get(row.propertyId)];
      (byCustomer[row.customerId] ??= []).push({
        id: row._id,
        serviceId: row.serviceId,
        service: service?.name ?? "A service",
        property: property ? propertyName(property) : "A property",
        baseCents: row.baseCents,
        untilWords: untilWords(row.until),
        dueSoon: row.until !== null && row.until.date <= addDaysIso(today, 14),
        tasks: row.addedTasks?.length ?? 0,
        extras: row.extras?.length ?? 0,
      });
    }
    for (const list of Object.values(byCustomer)) list.sort((a, b) => a.property.localeCompare(b.property) || a.service.localeCompare(b.service));
    return byCustomer;
  },
});

/** Proposes a property's own base price for a service. It waits for the Owner in Changes; nothing prices a visit until it is approved. */
export const propose = managerMutation({
  args: { serviceId: v.id("services"), propertyId: v.id("properties"), baseCents: v.number(), laborMinutes: v.union(v.number(), v.null()), until: untilValidator, reason: v.string(), addedTasks: v.optional(v.array(v.string())), extras: v.optional(v.array(propertyExtraValidator)) },
  handler: async (ctx, args) => proposePropertyPrice(ctx, { ...args, actor: byMember(ctx), via: "workspace" }),
});

/** The Owner ends a property's own price now. Its next visits pay the service's price; booked visits keep theirs. */
export const end = ownerMutation({
  args: { priceId: v.id("propertyPrices"), reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.priceId);
    if (!row || row.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (row.state !== "active") throw userError("This price has already ended.");
    const reason = args.reason.trim();
    if (!reason) throw userError("Say why it ends, so the history shows it.");
    await endPropertyPrice(ctx, row, reason, byMember(ctx));
    return null;
  },
});

/**
 * Once a day: a property price whose review or end date is two weeks away (or nearer) opens one task for
 * a person to decide; it never changes or extends the price. A price whose end date passed is marked
 * ended. Visits already stop using it after its end date, whether or not this has run.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    let reminded = 0;
    let ended = 0;
    const companies = await ctx.db.query("companies").take(500);
    for (const company of companies) {
      if (company.suspendedAt) continue;
      const today = dayOf(Date.now(), company.timezone);
      const rows = await ctx.db
        .query("propertyPrices")
        .withIndex("by_company_state", (q) => q.eq("companyId", company._id).eq("state", "active"))
        .take(500);
      for (const row of rows) {
        if (!row.until) continue;
        if (row.until.kind === "end" && row.until.date < today) {
          await endPropertyPrice(ctx, row, `Its end date, ${dayWords(row.until.date)}, passed.`, { kind: "system" });
          ended += 1;
          continue;
        }
        if (!reminderDue(row, today)) continue;
        const property = await ctx.db.get(row.propertyId);
        const service = await ctx.db.get(row.serviceId);
        if (!property || !service) continue;
        const name = propertyName(property);
        const date = dayWords(row.until.date);
        const ends = row.until.kind === "end";
        await openTask(ctx, {
          companyId: company._id,
          agent: "retention",
          title: `${ends ? "Own price ends" : "Review the own price"} for ${name} (${service.name})`.slice(0, 200),
          nextAction: ends
            ? `It ends after ${date}; from then on visits pay the service's price. To keep a price of its own, propose one in Services & Pricing › ${service.name} › Property prices. Selestial will not extend it for you.`
            : `Its review date is ${date} (now ${formatCents(row.baseCents)} base). Keep it, propose a new price, or end it, in Services & Pricing › ${service.name} › Property prices. Selestial will not change it for you.`,
          dueAt: Math.max(Date.now() + 24 * 60 * 60 * 1000, new Date(`${row.until.date}T12:00:00Z`).getTime()),
          completionCondition: "A person has decided, and any new price was proposed and approved in Changes.",
          about: { table: "properties", id: property._id },
          key: `property-price:${row._id}:${row.until.kind}:${row.until.date}`,
          actor: { kind: "system" },
        });
        await ctx.db.patch(row._id, { remindedFor: `${row.until.kind}:${row.until.date}`, updatedAt: Date.now() });
        await recordEvent(ctx, { companyId: company._id, type: "service.property_price_reminder", actor: { kind: "system" }, subject: { table: "propertyPrices", id: row._id }, data: { kind: row.until.kind, date: row.until.date } });
        reminded += 1;
      }
    }
    return { reminded, ended };
  },
});
