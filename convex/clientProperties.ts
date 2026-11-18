/**
 * A client's properties: what each is like, how the crew gets in, what is serviced there, and its visits.
 *
 * Who may do what (checked here, whatever a screen shows):
 *  - everyone reads a property and edits its description, details, parking and crew notes;
 *  - access instructions and office notes are the Owner's and Managers' only, to read and to change;
 *  - changing an address shows the visits it affects first, and is refused outside the company's area
 *    unless an Owner or Manager confirms it; archiving is the Owner's or a Manager's.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, managerMutation } from "./lib/builders";
import { contactsOf, refreshClient } from "./lib/clients/directory";
import { propertyDetailsValidator, propertyKindValidator } from "./lib/clients/schema";
import { clientTasks, pendingApprovalFor, taskCard, visitSummary } from "./lib/clients/signals";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isManager } from "./lib/roles";
import { businessSettingsOf, normalizePostalCode } from "./lib/settings/business";
import { dayOf, untilWords } from "./lib/services/propertyPrices";
import { liveTaskByKey, openTask } from "./lib/taskState";
import { optionalText } from "./lib/text";
import { propertyView } from "./clients";
import { cleanAddress } from "./properties";
import { addressValidator } from "./schema";

const STALE = "Someone else saved this property after you opened it. Reload to see their changes, then make yours again.";
const DAY = 24 * 60 * 60 * 1000;

/** One property in depth: its facts, contacts, plans, visits, open work and its own prices. */
export const detail = companyQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    const customer = (await ctx.db.get(property.customerId))!;
    const name = property.label?.trim() || property.address.line1;
    const now = Date.now();
    const upcomingJobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).gte("startsAt", now - 12 * 60 * 60 * 1000))
      .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
      .take(10);
    const pastJobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).lt("startsAt", now))
      .order("desc")
      .take(10);
    const contacts = await contactsOf(ctx, ctx.companyId, customer._id);
    const site = contacts.filter((c) => c.roles.includes("site") && (c.propertyIds.length === 0 || c.propertyIds.includes(property._id)));
    const plans = await ctx.db
      .query("servicePlans")
      .withIndex("by_company_property", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id))
      .take(20);
    const planRows = [];
    for (const plan of plans.filter((p) => p.state !== "ended")) planRows.push({ id: plan._id, kind: plan.kind, state: plan.state, cadence: plan.cadence, service: (await ctx.db.get(plan.serviceId))?.name ?? "A service", priceCents: plan.priceCents });
    const ownPrices = (
      await ctx.db
        .query("propertyPrices")
        .withIndex("by_company_property_service", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id))
        .take(20)
    ).filter((row) => row.state === "active");
    const prices = [];
    for (const row of ownPrices) prices.push({ id: row._id, service: (await ctx.db.get(row.serviceId))?.name ?? "A service", serviceId: row.serviceId, baseCents: row.baseCents, untilWords: untilWords(row.until), tasks: row.addedTasks ?? [] });
    const tasks = await clientTasks(ctx, ctx.companyId, { customerId: customer._id, propertyIds: [property._id] }, upcomingJobs.map((j) => j._id));
    const work = [];
    for (const task of tasks.filter((t) => t.about?.id !== customer._id).slice(0, 8)) work.push(taskCard(task, ctx.company, isManager(ctx.role) ? await pendingApprovalFor(ctx, ctx.companyId, task._id) : null));
    return {
      property: propertyView(property, ctx.role),
      client: { id: customer._id, name: customer.name, status: customer.status },
      siteContacts: site.map((c) => ({ id: c._id, name: c.name, phone: c.phone ?? null, email: c.email ?? null, title: c.title ?? null })),
      plans: planRows,
      prices,
      upcoming: await Promise.all(upcomingJobs.map((job) => visitSummary(ctx, ctx.company, job, () => name))),
      history: await Promise.all(pastJobs.map((job) => visitSummary(ctx, ctx.company, job, () => name))),
      work,
      canManage: isManager(ctx.role),
      companyTimezone: ctx.company.timezone,
    };
  },
});

const detailsInput = propertyDetailsValidator;

function cleanDetails(details: typeof detailsInput.type): typeof detailsInput.type {
  const n = (value: number | undefined, label: string, max: number) => {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value) || value < 0 || value > max) throw userError(`${label} must be a number from 0 to ${max}.`);
    return Math.round(value * 10) / 10;
  };
  const t = (value: string | undefined, label: string, max = 200) => optionalText(value, label, max);
  const time = (value: string | undefined, label: string) => {
    if (value === undefined || value === "") return undefined;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw userError(`${label} must be a time of day.`);
    return value;
  };
  const out: typeof detailsInput.type = {
    bedrooms: n(details.bedrooms, "Bedrooms", 50),
    bathrooms: n(details.bathrooms, "Bathrooms", 50),
    halfBaths: n(details.halfBaths, "Half baths", 50),
    squareFeet: n(details.squareFeet, "Size", 10_000_000),
    floors: n(details.floors, "Floors", 200),
    pets: t(details.pets, "Pets"),
    beds: n(details.beds, "Beds", 100),
    maxGuests: n(details.maxGuests, "Guests", 200),
    laundry: details.laundry,
    supplies: t(details.supplies, "Supplies", 500),
    checkoutTime: time(details.checkoutTime, "Checkout"),
    checkinTime: time(details.checkinTime, "Check-in"),
    serviceDays: details.serviceDays ? [...new Set(details.serviceDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : undefined,
    serviceWindow: details.serviceWindow && details.serviceWindow.from && details.serviceWindow.to ? { from: time(details.serviceWindow.from, "The service window")!, to: time(details.serviceWindow.to, "The service window")! } : undefined,
    taskSchedule: details.taskSchedule?.filter((row) => row.task.trim()).slice(0, 30).map((row) => ({ task: row.task.trim().slice(0, 120), frequency: row.frequency.trim().slice(0, 60) || "Every visit" })),
    occupants: n(details.occupants, "Occupants", 100_000),
  };
  for (const key of Object.keys(out) as (keyof typeof out)[]) if (out[key] === undefined) delete out[key];
  return out;
}

/**
 * Adds a property, or edits everything about one except its address (changeAddress). Access instructions
 * and office notes are the Owner's and Managers' only.
 */
export const save = companyMutation({
  args: {
    customerId: v.id("customers"),
    propertyId: v.optional(v.id("properties")),
    expectedRevision: v.optional(v.number()),
    address: v.optional(addressValidator),
    kind: propertyKindValidator,
    label: v.optional(v.string()),
    timezone: v.optional(v.string()),
    details: detailsInput,
    parking: v.optional(v.string()),
    crewNotes: v.optional(v.string()),
    clientNotes: v.optional(v.string()),
    officeNotes: v.optional(v.string()),
    accessInstructions: v.optional(v.string()),
    siteContactId: v.optional(v.union(v.id("clientContacts"), v.null())),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const manager = isManager(ctx.role);
    if ((args.accessInstructions !== undefined || args.officeNotes !== undefined) && !manager) throw userError("Only an Owner or Manager can change access instructions or office notes.", "not_allowed");
    if (args.siteContactId) {
      const contact = await owned(ctx, args.siteContactId);
      if (contact.customerId !== customer._id) throw userError("That contact belongs to a different client.");
    }
    const fields = {
      kind: args.kind,
      label: optionalText(args.label, "Nickname", 120),
      ...(args.timezone ? { timezone: args.timezone.slice(0, 60) } : {}),
      details: cleanDetails(args.details),
      parking: optionalText(args.parking, "Parking", 500),
      crewNotes: optionalText(args.crewNotes, "Notes for the crew", 2000),
      clientNotes: optionalText(args.clientNotes, "What the client asked for", 2000),
      ...(args.officeNotes !== undefined ? { officeNotes: optionalText(args.officeNotes, "Office notes", 2000) } : {}),
      ...(args.accessInstructions !== undefined ? { accessInstructions: optionalText(args.accessInstructions, "Access instructions", 2000) } : {}),
      ...(args.siteContactId !== undefined ? { siteContactId: args.siteContactId ?? undefined } : {}),
      updatedAt: Date.now(),
    };
    if (!args.propertyId) {
      if (!args.address) throw userError("Give the property's address.");
      const propertyId = await ctx.db.insert("properties", { companyId: ctx.companyId, customerId: customer._id, address: cleanAddress(args.address), status: "active", revision: 1, createdAt: Date.now(), ...fields });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "property.created", actor: byMember(ctx), subject: { table: "properties", id: propertyId } });
      await refreshClient(ctx, customer._id);
      return { propertyId, revision: 1 };
    }
    const property = await owned(ctx, args.propertyId);
    if (property.customerId !== customer._id) throw userError("That property belongs to a different client.");
    if ((property.revision ?? 0) !== args.expectedRevision) throw userError(STALE);
    const revision = (property.revision ?? 0) + 1;
    await ctx.db.patch(property._id, { ...fields, revision });
    const changed = [args.accessInstructions !== undefined && args.accessInstructions !== (property.accessInstructions ?? "") ? "access instructions" : null, args.kind !== property.kind ? "kind" : null, "details"].filter(Boolean).join(", ");
    // The event names what changed, never access codes.
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.updated", actor: byMember(ctx), subject: { table: "properties", id: property._id }, data: { changed } });
    await refreshClient(ctx, customer._id);
    return { propertyId: property._id, revision };
  },
});

/** What changing a property's address would affect, before anything is changed. */
export const addressImpact = companyQuery({
  args: { propertyId: v.id("properties"), postalCode: v.string() },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    const now = Date.now();
    const upcoming = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).gte("startsAt", now))
      .filter((f) => f.eq(f.field("status"), "scheduled"))
      .take(100);
    const plans = (
      await ctx.db
        .query("servicePlans")
        .withIndex("by_company_property", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id))
        .take(20)
    ).filter((p) => p.state !== "ended");
    const areas = businessSettingsOf(ctx.company).serviceAreas;
    const inArea = areas.length === 0 || areas.includes(normalizePostalCode(args.postalCode));
    const name = property.label?.trim() || property.address.line1;
    return {
      upcoming: await Promise.all(upcoming.map((job) => visitSummary(ctx, ctx.company, job, () => name))),
      plans: plans.length,
      inArea,
      areaWords: areas.length === 0 ? "The company has not limited its service area." : inArea ? "Inside the company's service area." : `${args.postalCode.trim().toUpperCase()} is outside the company's service area.`,
      canOverride: isManager(ctx.role),
    };
  },
});

/**
 * Moves a property to a new address. Booked visits go to the new address at the price they were booked
 * with; Dispatch is asked to recheck their crews and travel. Outside the service area only an Owner or
 * Manager can confirm it.
 */
export const changeAddress = companyMutation({
  args: { propertyId: v.id("properties"), expectedRevision: v.number(), address: addressValidator, shown: v.array(v.id("jobs")), outsideArea: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    if ((property.revision ?? 0) !== args.expectedRevision) throw userError(STALE);
    const address = cleanAddress(args.address);
    const areas = businessSettingsOf(ctx.company).serviceAreas;
    const inArea = areas.length === 0 || areas.includes(normalizePostalCode(address.postalCode));
    if (!inArea && !(args.outsideArea && isManager(ctx.role))) throw userError(`${address.postalCode} is outside the company's service area. An Owner or Manager can confirm the move anyway, or add the area under Business & hours.`);
    const upcoming = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).gte("startsAt", Date.now()))
      .filter((f) => f.eq(f.field("status"), "scheduled"))
      .take(100);
    if (upcoming.map((j) => j._id as string).sort().join(",") !== [...args.shown].map(String).sort().join(",")) throw userError("The property's booked visits changed after you looked. Review them again before changing the address.");
    const revision = (property.revision ?? 0) + 1;
    await ctx.db.patch(property._id, { address, revision, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.address_changed", actor: byMember(ctx), subject: { table: "properties", id: property._id }, data: { visits: upcoming.length, outsideArea: !inArea } });
    if (upcoming.length) {
      const key = `property.moved:${property._id}`;
      if (!(await liveTaskByKey(ctx, ctx.companyId, key))) {
        await openTask(ctx, {
          companyId: ctx.companyId,
          agent: "dispatch",
          title: `Recheck ${upcoming.length} visit${upcoming.length === 1 ? "" : "s"} after an address change`,
          nextAction: `${property.label?.trim() || "A property"} moved to ${address.line1}, ${address.city}. Check each booked visit's crew and travel still work, and its price if the area pricing differs.`,
          dueAt: Math.min(upcoming[0].startsAt - DAY, Date.now() + DAY),
          completionCondition: "Every booked visit at the new address has a crew that can reach it.",
          about: { table: "properties", id: property._id },
          key,
          actor: byMember(ctx),
        });
      }
    }
    await refreshClient(ctx, property.customerId);
    return { revision, visits: upcoming.length };
  },
});

/** Archives a property. Refused while visits or plans there are still to come. */
export const archive = managerMutation({
  args: { propertyId: v.id("properties"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    if ((property.revision ?? 0) !== args.expectedRevision) throw userError(STALE);
    const upcoming = await ctx.db
      .query("jobs")
      .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).gte("startsAt", Date.now() - 12 * 60 * 60 * 1000))
      .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
      .first();
    const plans = (
      await ctx.db
        .query("servicePlans")
        .withIndex("by_company_property", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id))
        .take(20)
    ).filter((p) => p.state !== "ended");
    if (upcoming || plans.length) throw userError(`Not archived: ${[upcoming ? "a visit is still to come" : null, plans.length ? "a plan is still running or paused" : null].filter(Boolean).join(" and ")}. Cancel or end ${upcoming && plans.length ? "them" : "it"} first.`);
    await ctx.db.patch(property._id, { status: "archived", archivedAt: Date.now(), revision: (property.revision ?? 0) + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.archived", actor: byMember(ctx), subject: { table: "properties", id: property._id } });
    await refreshClient(ctx, property.customerId);
    return null;
  },
});

/** Visits for a client, or one of its properties, a page at a time: upcoming, or history. */
export const visits = companyQuery({
  args: { customerId: v.id("customers"), propertyId: v.optional(v.id("properties")), when: v.union(v.literal("upcoming"), v.literal("history")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const now = Date.now();
    const limit = Math.min(Math.max(1, args.limit ?? 25), 100);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(200);
    const nameOf = (id: Id<"properties">) => {
      const p = properties.find((row) => row._id === id);
      return p ? p.label?.trim() || p.address.line1 : "A property";
    };
    let rows: Doc<"jobs">[];
    if (args.propertyId) {
      const property = await owned(ctx, args.propertyId);
      if (property.customerId !== customer._id) throw userError("Not found.", "not_found");
      rows =
        args.when === "upcoming"
          ? await ctx.db
              .query("jobs")
              .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).gte("startsAt", now - 12 * 60 * 60 * 1000))
              .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
              .take(limit + 1)
          : await ctx.db
              .query("jobs")
              .withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).lt("startsAt", now))
              .order("desc")
              .take(limit + 1);
    } else {
      rows =
        args.when === "upcoming"
          ? await ctx.db
              .query("jobs")
              .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).gte("startsAt", now - 12 * 60 * 60 * 1000))
              .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
              .take(limit + 1)
          : await ctx.db
              .query("jobs")
              .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).lt("startsAt", now))
              .order("desc")
              .take(limit + 1);
    }
    // History includes visits cancelled before they were due, which sit in the future: shown with their outcome.
    if (args.when === "history" && !args.propertyId) {
      const cancelledAhead = await ctx.db
        .query("jobs")
        .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).gte("startsAt", now))
        .filter((f) => f.eq(f.field("status"), "cancelled"))
        .take(20);
      rows = [...cancelledAhead, ...rows].sort((a, b) => b.startsAt - a.startsAt);
    }
    const more = rows.length > limit;
    return { visits: await Promise.all(rows.slice(0, limit).map((job) => visitSummary(ctx, ctx.company, job, nameOf))), more, today: dayOf(now, ctx.company.timezone) };
  },
});
