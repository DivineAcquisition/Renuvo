/**
 * Undoing what a migration imported, for records nobody has touched since. Undo is not a universal
 * rollback: a record that was edited, paid, messaged, offered, linked or used by anything else stays,
 * and says why, so the owner resolves it on the record itself.
 *
 * Order matters: visits, plans, history and balances go before the properties and customers they belong
 * to, and a customer goes only when everything it owns from the import is gone and nothing else has
 * appeared. Documented opt-outs (suppressions) are never removed: an undo must not make anyone reachable.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { closeChange } from "../services/workflow";

type Ctx = QueryCtx | MutationCtx;

/** The order undo works through a migration's links. Dependents first. */
export const UNDO_ORDER = ["jobs", "servicePlans", "importedHistory", "openingBalances", "properties", "cleaners", "customers"] as const;
export type UndoTable = (typeof UNDO_ORDER)[number];

/** How long after a customer was created a property or contact still counts as made by the same import. */
const SAME_IMPORT_MS = 5 * 60 * 1000;

/** Which kinds of migration rows each table's records came from, for choosing what to undo. */
export const TABLE_KIND: Record<UndoTable, string> = { jobs: "bookings", servicePlans: "recurring", importedHistory: "history", openingBalances: "balances", properties: "properties", cleaners: "cleaners", customers: "customers" };

async function own<T extends "jobs" | "servicePlans" | "importedHistory" | "openingBalances" | "properties" | "cleaners" | "customers">(ctx: Ctx, table: T, id: string, companyId: Id<"companies">): Promise<Doc<T> | null> {
  const normal = ctx.db.normalizeId(table, id);
  if (!normal) return null;
  const doc = (await ctx.db.get(normal)) as Doc<T> | null;
  return doc && (doc as unknown as { companyId: Id<"companies"> }).companyId === companyId ? doc : null;
}

/**
 * Which other records are what. `own`: every record this migration created and still has. `going`: those
 * the same undo removes (or already removed), which no longer count. A dependent in `own` but not `going`
 * is an imported record being kept; one in neither came from somewhere else.
 */
export type UndoSets = { own: Set<string>; going: Set<string> };

function classify(sets: UndoSets, id: string): "going" | "kept" | "outside" {
  return sets.going.has(id) ? "going" : sets.own.has(id) ? "kept" : "outside";
}

/** Why this imported record can't be undone, or null when it can. */
export async function undoBlocker(ctx: Ctx, link: Doc<"migrationLinks">, sets: UndoSets): Promise<string | null> {
  const companyId = link.companyId;
  const table = link.table as UndoTable;
  switch (table) {
    case "jobs": {
      const job = await own(ctx, "jobs", link.recordId, companyId);
      if (!job) return null;
      if (job.status !== "scheduled") return "It started, finished or was cancelled. Change it on the schedule.";
      if (!job.migration?.held) return "It was released to Dispatch. Cancel it on the schedule instead.";
      if (await ctx.db.query("assignments").withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id)).first()) return "A cleaner was offered it.";
      if (await ctx.db.query("invoices").withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id)).first()) return "It has an invoice.";
      if (await ctx.db.query("messages").withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id)).first()) return "Messages were sent about it.";
      return null;
    }
    case "servicePlans": {
      const plan = await own(ctx, "servicePlans", link.recordId, companyId);
      if (!plan) return null;
      if (!plan.migration?.held || plan.state !== "setup") return "It was started. Pause or end it on the client instead.";
      if (plan.revision > 1) return "It was changed after the import.";
      const visits = await ctx.db.query("jobs").withIndex("by_company_plan", (q) => q.eq("companyId", companyId).eq("planId", plan._id)).take(50);
      if (visits.some((v) => classify(sets, v._id) === "outside")) return "It has booked visits of its own.";
      if (visits.some((v) => classify(sets, v._id) === "kept")) return "Some of its imported visits can't be undone.";
      return null;
    }
    case "importedHistory":
    case "openingBalances":
      // Reference only: nothing else builds on them.
      return null;
    case "properties": {
      const property = await own(ctx, "properties", link.recordId, companyId);
      if (!property) return null;
      return propertyBlocker(ctx, property, sets);
    }
    case "cleaners": {
      const cleaner = await own(ctx, "cleaners", link.recordId, companyId);
      if (!cleaner) return null;
      if (!cleaner.migration?.held) return "They were released to your team. End their engagement on their profile instead.";
      if (cleaner.status !== "onboarding") return "Their status was changed after the import.";
      if (await ctx.db.query("assignments").withIndex("by_company_cleaner_status", (q) => q.eq("companyId", companyId).eq("cleanerId", cleaner._id)).first()) return "They were offered work.";
      const requirements = await ctx.db.query("workerRequirements").withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleaner._id)).take(50);
      if (requirements.some((r) => r.submittedAt !== undefined || r.evidence !== undefined)) return "They've started their onboarding steps.";
      if (await ctx.db.query("messages").withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleaner._id)).first()) return "Messages were sent to them.";
      if (await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", companyId).eq("table", "cleaners").eq("recordId", cleaner._id)).first()) return "An agreement is linked to them.";
      return null;
    }
    case "customers": {
      const customer = await own(ctx, "customers", link.recordId, companyId);
      if (!customer) return null;
      return customerBlocker(ctx, customer, sets);
    }
  }
  return "Selestial doesn't undo this kind of record.";
}

async function propertyBlocker(ctx: Ctx, property: Doc<"properties">, sets: UndoSets): Promise<string | null> {
  const companyId = property.companyId;
  if ((property.revision ?? 1) > 1) return "It was edited after the import.";
  const visits = await ctx.db.query("jobs").withIndex("by_company_property_start", (q) => q.eq("companyId", companyId).eq("propertyId", property._id)).take(100);
  if (visits.some((v) => classify(sets, v._id) === "outside")) return "It has visits from outside this import.";
  if (visits.some((v) => classify(sets, v._id) === "kept")) return "Some of its imported visits can't be undone.";
  const plans = await ctx.db.query("servicePlans").withIndex("by_company_property", (q) => q.eq("companyId", companyId).eq("propertyId", property._id)).take(50);
  if (plans.some((p) => classify(sets, p._id) === "outside")) return "It has a recurring service from outside this import.";
  if (plans.some((p) => classify(sets, p._id) === "kept")) return "Some of its imported recurring services can't be undone.";
  const prices = await ctx.db.query("propertyPrices").withIndex("by_company_property_service", (q) => q.eq("companyId", companyId).eq("propertyId", property._id)).take(10);
  if (prices.length) return "It has an approved price of its own.";
  if (await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", companyId).eq("table", "properties").eq("recordId", property._id)).first()) return "An agreement is linked to it.";
  return null;
}

async function customerBlocker(ctx: Ctx, customer: Doc<"customers">, sets: UndoSets): Promise<string | null> {
  const companyId = customer.companyId;
  const by = <T>(rows: T[]) => rows.length > 0;
  if ((customer.revision ?? 1) > 1) return "It was edited after the import.";
  if (by(await ctx.db.query("invoices").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(1))) return "It has invoices.";
  if (by(await ctx.db.query("messages").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(1))) return "It was messaged.";
  if (by(await ctx.db.query("clientNotes").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(1))) return "Notes were added to it.";
  if (by(await ctx.db.query("salesOpportunities").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(1))) return "It's in your sales pipeline.";
  if (by(await ctx.db.query("retentionCases").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(1))) return "It has a customer care case.";
  if (await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", companyId).eq("table", "customers").eq("recordId", customer._id)).first()) return "An agreement is linked to it.";
  if (by(await ctx.db.query("migrationRecords").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(1))) return "It has records from the quick setup import.";
  const owned = async (rows: { _id: string }[], outside: string, kept: string) => {
    if (rows.some((r) => classify(sets, r._id) === "outside")) return outside;
    if (rows.some((r) => classify(sets, r._id) === "kept")) return kept;
    return null;
  };
  const visits = await ctx.db.query("jobs").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(200);
  const plans = await ctx.db.query("servicePlans").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(50);
  const history = await ctx.db.query("importedHistory").withIndex("by_company_customer_day", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(500);
  const owed = await ctx.db.query("openingBalances").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(200);
  const dependents =
    (await owned(visits, "It has visits from outside this import.", "Some of its imported visits can't be undone.")) ??
    (await owned(plans, "It has a recurring service from outside this import.", "Some of its imported recurring services can't be undone.")) ??
    (await owned([...history, ...owed], "It has history or balances from outside this import.", "Some of its imported history or balances weren't undone."));
  if (dependents) return dependents;
  const properties = await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(100);
  for (const property of properties) {
    // A property with its own link (another site of a grouped account) is judged on its own; one made with the customer goes with it.
    const where = classify(sets, property._id);
    if (where === "going") continue;
    if (where === "kept") return "Some of its imported properties can't be undone.";
    if (property.createdAt > customer.createdAt + SAME_IMPORT_MS) return "A property was added to it after the import.";
    const blocker = await propertyBlocker(ctx, property, sets);
    if (blocker) return `Its property at ${property.address.line1}: ${blocker.charAt(0).toLowerCase()}${blocker.slice(1)}`;
  }
  const contacts = await ctx.db.query("clientContacts").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(50);
  if (contacts.some((c) => c.createdAt > customer.createdAt + SAME_IMPORT_MS || c.updatedAt > c.createdAt + SAME_IMPORT_MS)) return "Its contacts were changed after the import.";
  return null;
}

/** Removes one untouched imported record and what the import made with it. Opt-outs stay. */
export async function undoRecord(ctx: MutationCtx, link: Doc<"migrationLinks">): Promise<void> {
  const companyId = link.companyId;
  switch (link.table as UndoTable) {
    case "jobs": {
      const job = await own(ctx, "jobs", link.recordId, companyId);
      if (job) await ctx.db.delete(job._id);
      return;
    }
    case "servicePlans": {
      const plan = await own(ctx, "servicePlans", link.recordId, companyId);
      if (!plan) return;
      // The price this import proposed for the property is withdrawn with it.
      const changes = await ctx.db.query("serviceChanges").withIndex("by_company_service", (q) => q.eq("companyId", companyId).eq("serviceId", plan.serviceId)).order("desc").take(100);
      for (const change of changes) {
        if (change.kind === "property_price" && change.state === "in_review" && change.propertyPrice?.propertyId === plan.propertyId && change.reason.startsWith("Imported from")) await closeChange(ctx, change, "withdrawn", "The import that proposed this price was undone.");
      }
      await ctx.db.delete(plan._id);
      return;
    }
    case "importedHistory": {
      const id = ctx.db.normalizeId("importedHistory", link.recordId);
      const row = id ? await ctx.db.get(id) : null;
      if (row && row.companyId === companyId) await ctx.db.delete(row._id);
      return;
    }
    case "openingBalances": {
      const id = ctx.db.normalizeId("openingBalances", link.recordId);
      const row = id ? await ctx.db.get(id) : null;
      if (row && row.companyId === companyId) await ctx.db.delete(row._id);
      return;
    }
    case "properties": {
      const property = await own(ctx, "properties", link.recordId, companyId);
      if (!property) return;
      await removeProperty(ctx, property);
      return;
    }
    case "cleaners": {
      const cleaner = await own(ctx, "cleaners", link.recordId, companyId);
      if (!cleaner) return;
      for (const table of ["workerRequirements", "availabilityWindows"] as const) {
        const rows = await ctx.db.query(table).withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleaner._id)).take(200);
        for (const row of rows) await ctx.db.delete(row._id);
      }
      const followUps = await ctx.db.query("followUps").withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleaner._id)).take(50);
      for (const row of followUps) await ctx.db.delete(row._id);
      await ctx.db.delete(cleaner._id);
      return;
    }
    case "customers": {
      const customer = await own(ctx, "customers", link.recordId, companyId);
      if (!customer) return;
      for (const property of await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(100)) await removeProperty(ctx, property);
      for (const contact of await ctx.db.query("clientContacts").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(50)) await ctx.db.delete(contact._id);
      for (const view of await ctx.db.query("clientViews").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customer._id)).take(20)) await ctx.db.delete(view._id);
      const records = await ctx.db.query("importedRecords").withIndex("by_company_source_external", (q) => q.eq("companyId", companyId).eq("source", link.source)).take(5000);
      for (const record of records) if (record.customerId === customer._id) await ctx.db.delete(record._id);
      await ctx.db.delete(customer._id);
      return;
    }
  }
}

async function removeProperty(ctx: MutationCtx, property: Doc<"properties">) {
  const contacts = await ctx.db.query("clientContacts").withIndex("by_company_customer", (q) => q.eq("companyId", property.companyId).eq("customerId", property.customerId)).take(50);
  for (const contact of contacts) if (contact.roles.length === 1 && contact.roles[0] === "site" && contact.propertyIds.length === 1 && contact.propertyIds[0] === property._id) await ctx.db.delete(contact._id);
  await ctx.db.delete(property._id);
}
