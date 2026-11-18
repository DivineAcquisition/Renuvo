/**
 * Clients & Properties: the shared directory of the company's clients and the identity of each one.
 *
 * Who may do what (checked here, whatever a screen shows):
 *  - everyone in the company reads clients, adds them and edits their contacts and service details;
 *  - access instructions and private notes are the Owner's and Managers' only, and are never in search,
 *    previews or anything an agent summarizes;
 *  - archiving, restoring and changing a relationship to paused or former are the Owner's and Managers';
 *  - billing stays in Finance, which is the Owner's (clientBilling.ts).
 *
 * A client is the `customers` record every other module already points at. Nothing here copies it.
 */
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, managerMutation, managerQuery, type MemberAccess } from "./lib/builders";
import { contactsOf, plansOf, possibleDuplicates, propertiesOf, refreshClient, relationshipOf, RELATIONSHIP_WORDS, viewsOf } from "./lib/clients/directory";
import { CLIENT_VIEWS, clientViewValidator, communicationValidator, CONTACT_ROLES, propertyKindValidator, relationshipValidator, type ClientView } from "./lib/clients/schema";
import { ATTENTION_WORDS, clientTasks, companyAttention, pendingApprovalFor, taskCard, visitSummary, type AttentionKind } from "./lib/clients/signals";
import { userError } from "./lib/errors";
import { describeEvents } from "./lib/eventWords";
import { byMember, recordEvent } from "./lib/events";
import { isManager } from "./lib/roles";
import { literals, workKindValidator } from "./lib/statuses";
import { optionalEmail, optionalText, text } from "./lib/text";
import { addressValidator } from "./schema";
import { cleanAddress } from "./properties";

type Ctx = QueryCtx & MemberAccess;
const DAY = 24 * 60 * 60 * 1000;
const STALE = "Someone else saved this client after you opened it. Reload to see their changes, then make yours again.";

const attentionValidator = v.union(v.literal("followup"), v.literal("setup"), v.literal("schedule"), v.literal("issues"));
const sortValidator = v.union(v.literal("name"), v.literal("name_desc"), v.literal("newest"), v.literal("updated"));

const CATEGORY_WORDS: Partial<Record<ClientView, string>> = { residential: "Residential", residential_recurring: "Recurring", residential_one_time: "One-time", commercial: "Commercial", office: "Office", str: "STR" };

/** A property as anyone in the company may see it: access instructions and office notes only for Owners and Managers. */
export function propertyView(property: Doc<"properties">, role: MemberAccess["role"]) {
  const manager = isManager(role);
  return {
    id: property._id,
    customerId: property.customerId,
    name: property.label?.trim() || property.address.line1,
    label: property.label ?? null,
    address: property.address,
    kind: property.kind,
    status: property.status,
    timezone: property.timezone ?? null,
    details: property.details ?? {},
    parking: property.parking ?? null,
    crewNotes: property.crewNotes ?? null,
    clientNotes: property.clientNotes ?? null,
    siteContactId: property.siteContactId ?? null,
    hasAccessInstructions: Boolean(property.accessInstructions?.trim()),
    accessInstructions: manager ? (property.accessInstructions ?? null) : null,
    officeNotes: manager ? (property.officeNotes ?? null) : null,
    revision: property.revision ?? 0,
    createdAt: property.createdAt,
  };
}

function contactView(contact: Doc<"clientContacts">) {
  return { id: contact._id, name: contact.name, title: contact.title ?? null, email: contact.email ?? null, phone: contact.phone ?? null, roles: contact.roles, propertyIds: contact.propertyIds };
}

async function memberName(ctx: QueryCtx, id: Id<"members"> | undefined) {
  if (!id) return null;
  const member = await ctx.db.get(id);
  return member ? { id: member._id, name: member.name } : null;
}

// ── The directory ───────────────────────────────────────────────────────────────────────────────────

/** One page of a view, searched, filtered and sorted on the server, with what each row shows. */
export const directory = companyQuery({
  args: {
    view: clientViewValidator,
    q: v.optional(v.string()),
    relationship: v.optional(v.union(v.literal("current"), relationshipValidator)),
    ownerId: v.optional(v.union(v.id("members"), v.literal("none"))),
    attention: v.optional(attentionValidator),
    sort: v.optional(sortValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const q = args.q?.trim().slice(0, 100);
    const sort = args.sort ?? "name";
    const relationship = args.relationship ?? (args.view === "prospects" || args.view === "archived" ? undefined : "current");
    const only = args.attention ? [...(await companyAttention(ctx, ctx.companyId))[args.attention]] : null;
    const base = q
      ? ctx.db.query("clientViews").withSearchIndex("search_text", (s) => s.search("searchText", q).eq("companyId", ctx.companyId).eq("view", args.view))
      : sort === "newest"
        ? ctx.db.query("clientViews").withIndex("by_company_view_created", (i) => i.eq("companyId", ctx.companyId).eq("view", args.view)).order("desc")
        : sort === "updated"
          ? ctx.db.query("clientViews").withIndex("by_company_view_updated", (i) => i.eq("companyId", ctx.companyId).eq("view", args.view)).order("desc")
          : ctx.db.query("clientViews").withIndex("by_company_view_name", (i) => i.eq("companyId", ctx.companyId).eq("view", args.view)).order(sort === "name_desc" ? "desc" : "asc");
    const filtered = base.filter((f) => {
      const conditions = [];
      if (relationship === "current") conditions.push(f.or(f.eq(f.field("relationship"), "active"), f.eq(f.field("relationship"), "paused")));
      else if (relationship) conditions.push(f.eq(f.field("relationship"), relationship));
      if (args.ownerId === "none") conditions.push(f.eq(f.field("ownerId"), undefined));
      else if (args.ownerId) conditions.push(f.eq(f.field("ownerId"), args.ownerId));
      if (only) conditions.push(only.length ? f.or(...only.slice(0, 300).map((id) => f.eq(f.field("customerId"), id))) : f.eq(f.field("customerId"), "none" as Id<"customers">));
      return conditions.length ? f.and(...conditions) : true;
    });
    const page = await filtered.paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map((row) => directoryRow(ctx, row, args.view))) };
  },
});

async function directoryRow(ctx: Ctx, row: Doc<"clientViews">, view: ClientView) {
  const customer = (await ctx.db.get(row.customerId))!;
  const contacts = await contactsOf(ctx, ctx.companyId, customer._id);
  const primary = contacts.find((c) => c.roles.includes("primary")) ?? null;
  const properties = await propertiesOf(ctx, ctx.companyId, customer._id);
  const plans = (await plansOf(ctx, ctx.companyId, customer._id)).filter((p) => p.state !== "ended");
  const now = Date.now();
  const next = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).gte("startsAt", now - 12 * 60 * 60 * 1000))
    .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
    .first();
  const recent = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).lt("startsAt", now))
    .order("desc")
    .take(5);
  const nameOf = (id: Id<"properties">) => properties.find((p) => p._id === id)?.label ?? properties.find((p) => p._id === id)?.address.line1 ?? "A property";
  const nextVisit = next ? await visitSummary(ctx, ctx.company, next, nameOf) : null;
  const services = [...new Set([...plans.map((p) => p.serviceId as string), ...recent.map((j) => j.serviceType)])];
  const serviceNames: string[] = [];
  for (const id of services.slice(0, 4)) {
    const service = ctx.db.normalizeId("services", id) ? await ctx.db.get(id as Id<"services">) : null;
    serviceNames.push(service ? service.name : id);
  }
  const tasks = await clientTasks(ctx, ctx.companyId, { customerId: customer._id, propertyIds: properties.map((p) => p._id) }, next ? [next._id] : []);
  const attention = nextVisit?.staffing && nextVisit.staffing.state !== "full" && next!.startsAt < now + 14 * DAY ? { kind: "schedule", text: `Next visit: ${nextVisit.staffing.words}` } : tasks[0] ? { kind: "task", text: tasks[0].title } : row.needsSetup ? { kind: "setup", text: properties.length === 0 ? "No property yet" : "No service set up yet" } : null;
  const relevant = view === "str" ? properties.filter((p) => p.kind === "short_term_rental") : view === "office" ? properties.filter((p) => p.kind === "office") : view === "commercial" ? properties.filter((p) => p.kind === "commercial" || p.kind === "office") : view.startsWith("residential") ? properties.filter((p) => p.kind === "home") : properties;
  const main = relevant[0] ?? properties[0] ?? null;
  return {
    customerId: customer._id,
    name: customer.name,
    type: customer.type ?? (customer.kind === "commercial" || customer.kind === "property_manager" ? "business" : "person"),
    primaryContact: primary ? { name: primary.name, email: primary.email ?? null, phone: primary.phone ?? null } : customer.email || customer.phone ? { name: customer.name, email: customer.email ?? null, phone: customer.phone ?? null } : null,
    properties: { count: properties.length, relevant: relevant.length, main: main ? { id: main._id, name: main.label?.trim() || main.address.line1, city: main.address.city, kind: main.kind, details: main.details ?? null } : null },
    services: serviceNames,
    plans: plans.map((p) => ({ id: p._id, kind: p.kind, state: p.state, cadence: p.cadence })),
    nextVisit,
    lastVisit: recent[0] ? { id: recent[0]._id, startsAt: recent[0].startsAt, service: recent[0].serviceType, status: recent[0].status } : null,
    attention,
    relationship: row.relationship,
    owner: await memberName(ctx, customer.accountOwnerId),
    categories: (await viewsOf(ctx, customer)).filter((view) => CATEGORY_WORDS[view]).map((view) => CATEGORY_WORDS[view]!),
  };
}

export type DirectoryRow = Awaited<ReturnType<typeof directoryRow>>;

/** What the directory's frame shows: view counts, the attention strip, owners to filter by, and whether the directory still needs preparing. */
export const overview = companyQuery({
  args: {},
  handler: async (ctx) => {
    const counts: Partial<Record<ClientView, number>> = {};
    const CAP = 999;
    for (const view of CLIENT_VIEWS) {
      const rows = await ctx.db
        .query("clientViews")
        .withIndex("by_company_view_name", (q) => q.eq("companyId", ctx.companyId).eq("view", view))
        .filter((f) => (view === "prospects" || view === "archived" ? true : f.or(f.eq(f.field("relationship"), "active"), f.eq(f.field("relationship"), "paused"))))
        .take(CAP + 1);
      counts[view] = rows.length;
    }
    const attention = await companyAttention(ctx, ctx.companyId);
    const anyCustomer = await ctx.db
      .query("customers")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .first();
    const anyRow = await ctx.db
      .query("clientViews")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId))
      .first();
    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
        .take(200)
    ).filter((m) => m.status === "active");
    return {
      counts,
      cap: CAP,
      attention: (Object.keys(ATTENTION_WORDS) as AttentionKind[]).map((kind) => ({ kind, ...ATTENTION_WORDS[kind], count: attention[kind].size })),
      owners: members.map((m) => ({ id: m._id, name: m.name })).sort((a, b) => a.name.localeCompare(b.name)),
      needsPrepare: anyCustomer !== null && anyRow === null,
      role: ctx.role,
      canManage: isManager(ctx.role),
    };
  },
});

/** Builds the directory for clients made before it existed, a batch at a time. The screen calls it until it says done. */
export const prepareDirectory = companyMutation({
  args: {},
  handler: async (ctx) => {
    let prepared = 0;
    for (const status of ["active", "archived"] as const) {
      const rows = await ctx.db
        .query("customers")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .take(2000);
      for (const customer of rows) {
        if (prepared >= 100) return { done: false, prepared };
        const has = await ctx.db
          .query("clientViews")
          .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
          .first();
        if (has) continue;
        await refreshClient(ctx, customer._id);
        prepared += 1;
      }
    }
    return { done: true, prepared };
  },
});

// ── One client ──────────────────────────────────────────────────────────────────────────────────────

/** A client's identity, contacts and properties: everything the profile header and side column show. */
export const profile = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const contacts = await contactsOf(ctx, ctx.companyId, customer._id);
    const properties = await propertiesOf(ctx, ctx.companyId, customer._id, true);
    const views = await viewsOf(ctx, customer);
    const manager = isManager(ctx.role);
    return {
      id: customer._id,
      name: customer.name,
      type: customer.type ?? (customer.kind === "commercial" || customer.kind === "property_manager" ? "business" : "person"),
      kind: customer.kind,
      status: customer.status,
      relationship: relationshipOf(customer),
      relationshipWords: RELATIONSHIP_WORDS[relationshipOf(customer)],
      relationshipNote: customer.relationshipNote ?? null,
      relationshipAt: customer.relationshipAt ?? null,
      categories: views.filter((view) => CATEGORY_WORDS[view]).map((view) => ({ view, label: CATEGORY_WORDS[view]! })),
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      preferences: customer.preferences ?? null,
      communication: customer.communication ?? { preferredChannel: null },
      privateNotes: manager ? (customer.privateNotes ?? null) : null,
      source: customer.source ?? null,
      owner: await memberName(ctx, customer.accountOwnerId),
      contacts: contacts.map(contactView),
      properties: properties.map((p) => propertyView(p, ctx.role)),
      archivedAt: customer.archivedAt ?? null,
      archivedReason: customer.archivedReason ?? null,
      conversationHeld: customer.conversationHeld ? { by: (await memberName(ctx, customer.conversationHeld.by))?.name ?? "A team member", since: customer.conversationHeld.since } : null,
      revision: customer.revision ?? 0,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt ?? customer.createdAt,
      role: ctx.role,
      canManage: manager,
      canSeeBilling: ctx.role === "owner",
    };
  },
});

/**
 * The Overview's operational summary: the next visit and its staffing, the arrangements in force, what
 * needs attention, what Selestial is handling, and recent activity. Each item names its record.
 */
export const summary = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const properties = await propertiesOf(ctx, ctx.companyId, customer._id);
    const nameOf = (id: Id<"properties">) => {
      const p = properties.find((row) => row._id === id);
      return p ? p.label?.trim() || p.address.line1 : "A property no longer active";
    };
    const now = Date.now();
    const upcomingJobs = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id).gte("startsAt", now - 12 * 60 * 60 * 1000))
      .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
      .take(40);
    const upcoming = await Promise.all(upcomingJobs.slice(0, 12).map((job) => visitSummary(ctx, ctx.company, job, nameOf)));
    const plans = (await plansOf(ctx, ctx.companyId, customer._id)).filter((p) => p.state !== "ended");
    const planCards = [];
    for (const plan of plans) {
      const service = await ctx.db.get(plan.serviceId);
      const next = upcomingJobs.find((job) => job.planId === plan._id);
      planCards.push({ id: plan._id, kind: plan.kind, state: plan.state, cadence: plan.cadence, service: service?.name ?? "A service", property: nameOf(plan.propertyId), propertyId: plan.propertyId, priceCents: plan.priceCents, nextAt: next?.startsAt ?? null, pausedUntil: plan.pausedUntil ?? null });
    }
    const tasks = await clientTasks(ctx, ctx.companyId, { customerId: customer._id, propertyIds: properties.map((p) => p._id) }, upcomingJobs.slice(0, 20).map((j) => j._id));
    const handling = [];
    for (const task of tasks.slice(0, 12)) handling.push(taskCard(task, ctx.company, isManager(ctx.role) ? await pendingApprovalFor(ctx, ctx.companyId, task._id) : null));
    const attention: { kind: string; title: string; detail: string; at: number; action: string; ref: { kind: "job" | "task" | "property" | "plan"; id: string } }[] = [];
    for (const visit of upcoming) {
      if (visit.staffing && visit.staffing.state !== "full" && visit.startsAt < now + 14 * DAY) attention.push({ kind: "schedule", title: `${visit.service} at ${visit.property} is not fully staffed`, detail: [visit.staffing.words, visit.staffing.handling].filter(Boolean).join(". "), at: visit.startsAt, action: "Open the visit", ref: { kind: "job", id: visit.id } });
    }
    for (const plan of plans) if (plan.state === "setup") attention.push({ kind: "setup", title: "A plan is still being set up", detail: `${nameOf(plan.propertyId)}: no visits are booked until it is started.`, at: plan.updatedAt, action: "Open the plan", ref: { kind: "plan", id: plan._id } });
    if (properties.length === 0 && relationshipOf(customer) === "active") attention.push({ kind: "setup", title: "No property yet", detail: "Visits need a property. Add the address the client wants cleaned.", at: customer.createdAt, action: "Add a property", ref: { kind: "property", id: "new" } });
    for (const task of tasks) if (task.status === "needs_decision" && !handling.some((h) => h.id === task._id && h.state === "Needs approval")) attention.push({ kind: "decision", title: task.title, detail: task.openQuestion ?? task.nextAction ?? "A person needs to decide.", at: task.dueAt, action: "Open the task", ref: { kind: "task", id: task._id } });
    const subjects = [customer._id as string, ...properties.map((p) => p._id as string)];
    const events: Doc<"events">[] = [];
    for (const id of subjects.slice(0, 20)) {
      events.push(
        ...(await ctx.db
          .query("events")
          .withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", id))
          .order("desc")
          .take(15)),
      );
    }
    events.sort((a, b) => b.at - a.at);
    const activity = await describeEvents(ctx, ctx.company, events.slice(0, 15), now);
    return { upcoming, nextVisit: upcoming[0] ?? null, plans: planCards, handling, attention: attention.slice(0, 8), activity: activity.map((e) => ({ id: e.id, at: e.at, actor: e.actor.label, text: e.text, described: e.described, type: e.type })) };
  },
});

export const duplicates = companyQuery({
  args: { name: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()), except: v.optional(v.id("customers")) },
  handler: async (ctx, args) => possibleDuplicates(ctx, ctx.companyId, args, args.except),
});

// ── Adding and editing ──────────────────────────────────────────────────────────────────────────────

const contactInput = v.object({ name: v.string(), title: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()) });
const propertyInput = v.object({ address: addressValidator, kind: propertyKindValidator, label: v.optional(v.string()) });

/**
 * Adds a client with its primary contact and, optionally, its first property. A client who looks like one
 * already on file is refused with who it matches, unless the person chose to add it anyway.
 */
export const create = companyMutation({
  args: {
    type: v.union(v.literal("person"), v.literal("business")),
    name: v.string(),
    kind: workKindValidator,
    relationship: v.optional(v.union(v.literal("prospect"), v.literal("active"))),
    contact: v.optional(contactInput),
    property: v.optional(propertyInput),
    accountOwnerId: v.optional(v.id("members")),
    communication: v.optional(communicationValidator),
    addAnyway: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const name = text(args.name, "Name", 160);
    const contact = args.contact ? { name: text(args.contact.name || name, "Contact name", 160), title: optionalText(args.contact.title, "Title", 80), email: optionalEmail(args.contact.email), phone: optionalText(args.contact.phone, "Phone", 40) } : null;
    if (!args.addAnyway) {
      const matches = await possibleDuplicates(ctx, ctx.companyId, { name, email: contact?.email, phone: contact?.phone });
      if (matches.length) return { created: false as const, duplicates: matches };
    }
    if (args.accountOwnerId) await checkMember(ctx, args.accountOwnerId);
    const now = Date.now();
    const relationship = args.relationship ?? "active";
    const customerId = await ctx.db.insert("customers", {
      companyId: ctx.companyId,
      name,
      kind: args.kind,
      type: args.type,
      email: contact?.email,
      phone: contact?.phone,
      status: "active",
      relationship,
      relationshipAt: now,
      ...(args.accountOwnerId ? { accountOwnerId: args.accountOwnerId } : {}),
      ...(args.communication ? { communication: args.communication } : {}),
      source: "manual",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (contact) await ctx.db.insert("clientContacts", { companyId: ctx.companyId, customerId, ...contact, roles: ["primary", "billing"], propertyIds: [], status: "active", createdAt: now, updatedAt: now });
    if (args.property) {
      const propertyId = await ctx.db.insert("properties", { companyId: ctx.companyId, customerId, address: cleanAddress(args.property.address), kind: args.property.kind, label: optionalText(args.property.label, "Label", 120), status: "active", revision: 1, createdAt: now, updatedAt: now });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "property.created", actor: byMember(ctx), subject: { table: "properties", id: propertyId } });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: relationship === "prospect" ? "customer.prospect_added" : "customer.created", actor: byMember(ctx), subject: { table: "customers", id: customerId }, data: { addedAnyway: args.addAnyway === true } });
    await refreshClient(ctx, customerId);
    return { created: true as const, customerId };
  },
});

async function checkMember(ctx: Ctx, memberId: Id<"members">) {
  const member = await ctx.db.get(memberId);
  if (!member || member.companyId !== ctx.companyId || member.status !== "active") throw userError("Choose someone on the team.");
}

function checkRevision(customer: Doc<"customers">, expected: number) {
  if ((customer.revision ?? 0) !== expected) throw userError(STALE);
}

/** Edits who the client is and how they like to be served. Private notes are the Owner's and Managers'. */
export const update = companyMutation({
  args: {
    customerId: v.id("customers"),
    expectedRevision: v.number(),
    name: v.optional(v.string()),
    type: v.optional(v.union(v.literal("person"), v.literal("business"))),
    kind: v.optional(workKindValidator),
    preferences: v.optional(v.string()),
    communication: v.optional(communicationValidator),
    privateNotes: v.optional(v.string()),
    accountOwnerId: v.optional(v.union(v.id("members"), v.null())),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    checkRevision(customer, args.expectedRevision);
    if (args.privateNotes !== undefined && !isManager(ctx.role)) throw userError("Only an Owner or Manager can edit private notes.", "not_allowed");
    if (args.accountOwnerId) await checkMember(ctx, args.accountOwnerId);
    const changed: string[] = [];
    const patch: Partial<Doc<"customers">> = {};
    const change = <K extends keyof Doc<"customers">>(key: K, value: Doc<"customers">[K], label: string) => {
      patch[key] = value;
      changed.push(label);
    };
    if (args.name !== undefined) change("name", text(args.name, "Name", 160), "name");
    if (args.type !== undefined) change("type", args.type, "type");
    if (args.kind !== undefined) change("kind", args.kind, "kind");
    if (args.preferences !== undefined) change("preferences", optionalText(args.preferences, "Service preferences", 2000), "service preferences");
    if (args.communication !== undefined) {
      const bestTime = optionalText(args.communication.bestTime, "Best time", 120);
      const language = optionalText(args.communication.language, "Language", 60);
      change("communication", { preferredChannel: args.communication.preferredChannel, ...(bestTime ? { bestTime } : {}), ...(language ? { language } : {}) }, "communication preferences");
    }
    if (args.privateNotes !== undefined) change("privateNotes", optionalText(args.privateNotes, "Private notes", 4000), "private notes");
    if (args.accountOwnerId !== undefined) change("accountOwnerId", args.accountOwnerId ?? undefined, "account owner");
    if (!changed.length) return { revision: customer.revision ?? 0 };
    const revision = (customer.revision ?? 0) + 1;
    await ctx.db.patch(customer._id, { ...patch, revision, updatedAt: Date.now() });
    // The event names what changed, never the values: private notes stay private.
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.updated", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { changed: changed.join(", ") } });
    await refreshClient(ctx, customer._id);
    return { revision };
  },
});

/**
 * Changes the relationship. Anyone may turn a prospect into a client; pausing, ending or reopening a
 * relationship is the Owner's or a Manager's. It changes no plan, visit or invoice: those are their own.
 */
export const setRelationship = companyMutation({
  args: { customerId: v.id("customers"), expectedRevision: v.number(), relationship: relationshipValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    checkRevision(customer, args.expectedRevision);
    const from = relationshipOf(customer);
    if (from === args.relationship) return { revision: customer.revision ?? 0 };
    const promotion = from === "prospect" && args.relationship === "active";
    if (!promotion && !isManager(ctx.role)) throw userError("Only an Owner or Manager can change a client's relationship this way.", "not_allowed");
    if (customer.status === "archived") throw userError("Restore the client first.");
    const revision = (customer.revision ?? 0) + 1;
    const now = Date.now();
    await ctx.db.patch(customer._id, { relationship: args.relationship, relationshipNote: optionalText(args.note, "Note", 500), relationshipAt: now, revision, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: promotion ? "customer.became_client" : "customer.relationship_changed", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { from, to: args.relationship } });
    await refreshClient(ctx, customer._id);
    return { revision };
  },
});

// ── Contacts ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Adds or edits a contact. There is always one primary contact: making someone primary takes it from
 * whoever had it. The primary contact's email and phone are the client's, which Finance and messaging read.
 */
export const saveContact = companyMutation({
  args: {
    customerId: v.id("customers"),
    contactId: v.optional(v.id("clientContacts")),
    name: v.string(),
    title: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    roles: v.array(literals(CONTACT_ROLES)),
    propertyIds: v.array(v.id("properties")),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const contacts = await contactsOf(ctx, ctx.companyId, customer._id);
    const existing = args.contactId ? contacts.find((c) => c._id === args.contactId) : null;
    if (args.contactId && !existing) throw userError("Not found.", "not_found");
    for (const id of args.propertyIds) {
      const property = await ctx.db.get(id);
      if (!property || property.customerId !== customer._id) throw userError("That property belongs to a different client.");
    }
    const email = optionalEmail(args.email);
    const phone = optionalText(args.phone, "Phone", 40);
    if (!email && !phone) throw userError("Give the contact an email or a phone number.");
    const roles = [...new Set(args.roles)];
    const becomesPrimary = roles.includes("primary") || (!existing && contacts.length === 0);
    if (becomesPrimary && !roles.includes("primary")) roles.unshift("primary");
    if (existing?.roles.includes("primary") && !roles.includes("primary")) throw userError("A client always has a primary contact. Make someone else primary first.");
    const now = Date.now();
    const fields = { name: text(args.name, "Name", 160), title: optionalText(args.title, "Title", 80), email, phone, roles, propertyIds: [...new Set(args.propertyIds)], updatedAt: now };
    const contactId = existing ? existing._id : await ctx.db.insert("clientContacts", { companyId: ctx.companyId, customerId: customer._id, ...fields, status: "active", createdAt: now });
    if (existing) await ctx.db.patch(existing._id, fields);
    if (becomesPrimary) {
      for (const other of contacts) if (other._id !== contactId && other.roles.includes("primary")) await ctx.db.patch(other._id, { roles: other.roles.filter((r) => r !== "primary"), updatedAt: now });
    }
    if (roles.includes("primary")) await ctx.db.patch(customer._id, { email, phone, revision: (customer.revision ?? 0) + 1, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: existing ? "customer.contact_updated" : "customer.contact_added", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { contact: fields.name, roles: roles.join(", ") } });
    await refreshClient(ctx, customer._id);
    return { contactId };
  },
});

export const removeContact = companyMutation({
  args: { contactId: v.id("clientContacts") },
  handler: async (ctx, args) => {
    const contact = await owned(ctx, args.contactId);
    if (contact.roles.includes("primary")) throw userError("Make someone else the primary contact first.");
    await ctx.db.patch(contact._id, { status: "archived", updatedAt: Date.now() });
    const sites = await propertiesOf(ctx, ctx.companyId, contact.customerId);
    for (const property of sites) if (property.siteContactId === contact._id) await ctx.db.patch(property._id, { siteContactId: undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.contact_removed", actor: byMember(ctx), subject: { table: "customers", id: contact.customerId }, data: { contact: contact.name } });
    await refreshClient(ctx, contact.customerId);
    return null;
  },
});

// ── Archiving ───────────────────────────────────────────────────────────────────────────────────────

/** What archiving would leave behind. Archiving never cancels a visit, ends a plan or touches an invoice. */
export const archivePreview = managerQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    return archiveBlockers(ctx, customer);
  },
});

async function archiveBlockers(ctx: QueryCtx & { companyId: Id<"companies"> }, customer: Doc<"customers">) {
  const now = Date.now();
  const upcoming = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer_start", (q) => q.eq("companyId", customer.companyId).eq("customerId", customer._id).gte("startsAt", now - 12 * 60 * 60 * 1000))
    .filter((f) => f.or(f.eq(f.field("status"), "scheduled"), f.eq(f.field("status"), "in_progress")))
    .take(50);
  const plans = (await plansOf(ctx, customer.companyId, customer._id)).filter((p) => p.state !== "ended");
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_company_customer", (q) => q.eq("companyId", customer.companyId).eq("customerId", customer._id))
    .take(200);
  const openInvoices = invoices.filter((i) => i.status === "open").length;
  const blockers = [
    ...(upcoming.length ? [`${upcoming.length} upcoming visit${upcoming.length === 1 ? "" : "s"}. Cancel or finish ${upcoming.length === 1 ? "it" : "them"} first.`] : []),
    ...(plans.length ? [`${plans.length} plan${plans.length === 1 ? "" : "s"} still running or paused. End ${plans.length === 1 ? "it" : "them"} first.`] : []),
  ];
  const notes = [
    ...(openInvoices ? [`${openInvoices} open invoice${openInvoices === 1 ? "" : "s"} stay${openInvoices === 1 ? "s" : ""} open in Finance.`] : []),
    "Visit history, agreements, messages and invoices are kept. The client can be restored.",
  ];
  return { blockers, notes };
}

export const archive = managerMutation({
  args: { customerId: v.id("customers"), expectedRevision: v.number(), reason: v.string() },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    checkRevision(customer, args.expectedRevision);
    if (customer.status === "archived") return null;
    const { blockers } = await archiveBlockers(ctx, customer);
    if (blockers.length) throw userError(`Not archived: ${blockers.join(" ")}`);
    const reason = text(args.reason, "The reason", 500);
    const now = Date.now();
    await ctx.db.patch(customer._id, { status: "archived", archivedAt: now, archivedReason: reason, revision: (customer.revision ?? 0) + 1, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.archived", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { reason } });
    await refreshClient(ctx, customer._id);
    return null;
  },
});

export const restore = managerMutation({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    if (customer.status !== "archived") return null;
    const now = Date.now();
    await ctx.db.patch(customer._id, { status: "active", archivedAt: undefined, archivedReason: undefined, revision: (customer.revision ?? 0) + 1, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.restored", actor: byMember(ctx), subject: { table: "customers", id: customer._id } });
    await refreshClient(ctx, customer._id);
    return null;
  },
});

/** Search for a client by name, contact or address, for pickers (Chat, booking). Never searches access instructions. */
export const find = companyQuery({
  args: { q: v.string() },
  handler: async (ctx, args) => {
    const q = args.q.trim().slice(0, 100);
    if (!q) return [];
    const rows = await ctx.db
      .query("clientViews")
      .withSearchIndex("search_text", (s) => s.search("searchText", q).eq("companyId", ctx.companyId))
      .take(30);
    const seen = new Set<string>();
    const out = [];
    for (const row of rows) {
      if (seen.has(row.customerId)) continue;
      seen.add(row.customerId);
      out.push({ customerId: row.customerId, name: row.name, relationship: row.relationship, archived: row.view === "archived" });
    }
    return out.slice(0, 10);
  },
});

/** Assigns an account owner to several clients at once, after the screen showed exactly which. Owners and Managers. */
export const assignOwner = managerMutation({
  args: { customerIds: v.array(v.id("customers")), accountOwnerId: v.union(v.id("members"), v.null()) },
  handler: async (ctx, args) => {
    if (args.customerIds.length === 0 || args.customerIds.length > 100) throw userError("Choose from 1 to 100 clients.");
    if (args.accountOwnerId) await checkMember(ctx, args.accountOwnerId);
    const now = Date.now();
    for (const id of new Set(args.customerIds)) {
      const customer = await owned(ctx, id);
      if (customer.accountOwnerId === (args.accountOwnerId ?? undefined)) continue;
      await ctx.db.patch(customer._id, { accountOwnerId: args.accountOwnerId ?? undefined, revision: (customer.revision ?? 0) + 1, updatedAt: now });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.updated", actor: byMember(ctx), subject: { table: "customers", id: customer._id }, data: { changed: "account owner" } });
      await refreshClient(ctx, customer._id);
    }
    return { updated: args.customerIds.length };
  },
});
