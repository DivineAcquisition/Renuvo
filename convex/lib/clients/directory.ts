/**
 * The client directory, kept in step with the records. A client's view rows say which views it is in
 * (it can be in several), with the name and searchable text the directory reads. They are rebuilt from
 * the client, its contacts, its properties, its plans and its visits whenever any of those change, and
 * are never edited by hand.
 *
 * What the views mean (shown to people in the same words):
 *  - Residential: a home property, or a home client with no property yet.
 *  - Recurring: residential, with a recurring plan that is set up, running or paused.
 *  - One-time: residential, with a visit not booked by a plan in the last year or ahead, or no recurring plan.
 *  - Commercial: a commercial or office property, or a commercial client with no property yet.
 *  - Office: an office property. Office clients are also commercial.
 *  - STR: a short-term rental property.
 *  - Prospects: the relationship is "prospect". Archived: the record is archived. Neither is in "All clients".
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import type { ClientView, Relationship } from "./schema";

const YEAR = 365 * 24 * 60 * 60 * 1000;

/** The relationship, with the default for a client made before relationships existed. */
export function relationshipOf(customer: Doc<"customers">): Relationship {
  if (customer.relationship) return customer.relationship;
  return customer.status === "archived" ? "former" : "active";
}

export const RELATIONSHIP_WORDS: Record<Relationship, string> = { prospect: "Prospect", active: "Active client", paused: "Paused", former: "Former client" };

export const digits = (value: string | undefined | null) => (value ?? "").replace(/\D/g, "").slice(-10);

export async function contactsOf(ctx: QueryCtx, companyId: Id<"companies">, customerId: Id<"customers">) {
  return (
    await ctx.db
      .query("clientContacts")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
      .take(50)
  ).filter((contact) => contact.status === "active");
}

export async function propertiesOf(ctx: QueryCtx, companyId: Id<"companies">, customerId: Id<"customers">, includeArchived = false) {
  const rows = await ctx.db
    .query("properties")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .take(200);
  return includeArchived ? rows : rows.filter((p) => p.status === "active");
}

export async function plansOf(ctx: QueryCtx, companyId: Id<"companies">, customerId: Id<"customers">) {
  return ctx.db
    .query("servicePlans")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .take(100);
}

/** The views a client is in, worked out from its records. */
export async function viewsOf(ctx: QueryCtx, customer: Doc<"customers">): Promise<ClientView[]> {
  if (customer.status === "archived") return ["archived"];
  const relationship = relationshipOf(customer);
  if (relationship === "prospect") return ["prospects"];
  const properties = await propertiesOf(ctx, customer.companyId, customer._id);
  const kinds = new Set(properties.map((p) => p.kind));
  if (properties.length === 0) kinds.add(customer.kind);
  const views = new Set<ClientView>(["all"]);
  const residential = kinds.has("home");
  if (residential) {
    views.add("residential");
    const plans = await plansOf(ctx, customer.companyId, customer._id);
    const recurring = plans.some((plan) => plan.kind === "recurring" && plan.state !== "ended" && properties.some((p) => p._id === plan.propertyId && p.kind === "home"));
    if (recurring) views.add("residential_recurring");
    const recent = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", customer.companyId).eq("customerId", customer._id).gte("startsAt", Date.now() - YEAR))
      .take(200);
    const oneTime = recent.some((job) => job.planId === undefined && job.status !== "cancelled");
    if (oneTime || !recurring) views.add("residential_one_time");
  }
  if (kinds.has("commercial") || kinds.has("office")) views.add("commercial");
  if (kinds.has("office")) views.add("office");
  if (kinds.has("short_term_rental")) views.add("str");
  return [...views];
}

/** Name, contacts and addresses. Never access instructions, notes or anything private. */
export async function searchTextOf(ctx: QueryCtx, customer: Doc<"customers">): Promise<string> {
  const contacts = await contactsOf(ctx, customer.companyId, customer._id);
  const properties = await propertiesOf(ctx, customer.companyId, customer._id);
  const parts = [
    customer.name,
    customer.email,
    digits(customer.phone),
    ...contacts.flatMap((c) => [c.name, c.email, digits(c.phone)]),
    ...properties.flatMap((p) => [p.label, p.address.line1, p.address.city, p.address.postalCode]),
  ];
  return parts
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .slice(0, 4000);
}

/** Rebuilds a client's directory rows from its records. Call after anything that changes them. */
export async function refreshClient(ctx: MutationCtx, customerId: Id<"customers">): Promise<void> {
  const customer = await ctx.db.get(customerId);
  const old = customer
    ? await ctx.db
        .query("clientViews")
        .withIndex("by_company_customer", (q) => q.eq("companyId", customer.companyId).eq("customerId", customerId))
        .take(20)
    : [];
  if (!customer) {
    for (const row of old) await ctx.db.delete(row._id);
    return;
  }
  const views = await viewsOf(ctx, customer);
  const properties = await propertiesOf(ctx, customer.companyId, customer._id);
  const plans = await plansOf(ctx, customer.companyId, customer._id);
  const anyVisit = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer_start", (q) => q.eq("companyId", customer.companyId).eq("customerId", customer._id))
    .first();
  const relationship = relationshipOf(customer);
  const needsSetup = relationship === "active" && customer.status === "active" && (properties.length === 0 || (!anyVisit && !plans.some((p) => p.state !== "ended")) || plans.some((p) => p.state === "setup"));
  const fields = {
    name: customer.name,
    sortName: customer.name.trim().toLowerCase(),
    searchText: await searchTextOf(ctx, customer),
    relationship,
    needsSetup,
    ...(customer.accountOwnerId ? { ownerId: customer.accountOwnerId } : {}),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt ?? customer.createdAt,
  };
  for (const row of old) {
    if (!views.includes(row.view)) await ctx.db.delete(row._id);
  }
  for (const view of views) {
    const existing = old.find((row) => row.view === view);
    if (existing) await ctx.db.replace(existing._id, { companyId: customer.companyId, customerId, view, ...fields });
    else await ctx.db.insert("clientViews", { companyId: customer.companyId, customerId, view, ...fields });
  }
}

/** Clients already on file who look like this one: same email, same phone, or the same name. */
export async function possibleDuplicates(ctx: QueryCtx, companyId: Id<"companies">, input: { name?: string; email?: string; phone?: string }, except?: Id<"customers">) {
  const email = input.email?.trim().toLowerCase();
  const phone = digits(input.phone);
  const name = input.name?.trim().toLowerCase().replace(/\s+/g, " ");
  if (!email && phone.length < 10 && (!name || name.length < 3)) return [];
  const found = new Map<string, { customerId: Id<"customers">; name: string; reason: string; status: string }>();
  const note = (customer: Doc<"customers">, reason: string) => {
    if (customer._id === except || found.has(customer._id)) return;
    found.set(customer._id, { customerId: customer._id, name: customer.name, reason, status: customer.status });
  };
  if (name && name.length >= 3) {
    const byName = await ctx.db
      .query("clientViews")
      .withSearchIndex("search_text", (q) => q.search("searchText", name).eq("companyId", companyId))
      .take(20);
    for (const row of byName) {
      if (row.sortName !== name) continue;
      const customer = await ctx.db.get(row.customerId);
      if (customer) note(customer, "Same name");
    }
  }
  if (email || phone.length === 10) {
    for (const status of ["active", "archived"] as const) {
      const rows = await ctx.db
        .query("customers")
        .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
        .take(5000);
      for (const customer of rows) {
        if (email && customer.email?.toLowerCase() === email) note(customer, "Same email");
        else if (phone.length === 10 && digits(customer.phone) === phone) note(customer, "Same phone");
      }
    }
    const contacts = await ctx.db.query("clientContacts").withIndex("by_company_customer", (q) => q.eq("companyId", companyId)).take(5000);
    for (const contact of contacts) {
      const sameEmail = email && contact.email?.toLowerCase() === email;
      const samePhone = phone.length === 10 && digits(contact.phone) === phone;
      if (!sameEmail && !samePhone) continue;
      const customer = await ctx.db.get(contact.customerId);
      if (customer) note(customer, sameEmail ? `Same email as ${contact.name}` : `Same phone as ${contact.name}`);
    }
  }
  return [...found.values()].slice(0, 5);
}

/**
 * A visit was booked for this client, by a person, a plan or the online booking page. Booking makes a
 * prospect a client, on the same record with its history, and the directory is rebuilt for them.
 */
export async function visitBooked(ctx: MutationCtx, customerId: Id<"customers">, actor: Actor): Promise<void> {
  const customer = await ctx.db.get(customerId);
  if (!customer) return;
  if (customer.relationship === "prospect") {
    const now = Date.now();
    await ctx.db.patch(customer._id, { relationship: "active", relationshipAt: now, revision: (customer.revision ?? 0) + 1, updatedAt: now });
    await recordEvent(ctx, { companyId: customer.companyId, type: "customer.became_client", actor, subject: { table: "customers", id: customer._id }, data: { reason: "first visit booked" } });
  }
  await refreshClient(ctx, customer._id);
}
