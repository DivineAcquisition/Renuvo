/**
 * Writing one checked migration row into Selestial's own tables: customers, contacts, properties, service
 * plans and visits. Every check runs before the first write, so a row that fails leaves nothing half made.
 *
 * What a migration writes never starts work on its own:
 *  - a plan is set up and held, never started: it books nothing until the owner releases it;
 *  - a visit is held: Dispatch doesn't offer it, no confirmation is sent, nothing is invoiced;
 *  - an imported price on a plan is proposed as the property's own price, for the Owner to approve;
 *  - no permission to text or email anyone is created. A documented opt-out is kept as an opt-out.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { MemberAccess } from "../builders";
import { refreshClient } from "../clients/directory";
import { addSuppression } from "../compliance/permissions";
import { type Actor } from "../events";
import { quote } from "../services/engine";
import { visitScope } from "../services/operations";
import { instantOn } from "../clients/plans";
import { proposePropertyPrice } from "../services/propertyPrices";
import { publishedSpec } from "../services/store";
import type { Schedule } from "../services/spec";
import { optionalEmail, optionalText, text } from "../text";
import { cleanAddress } from "../../properties";
import { addressComplete, addressKey, customerNameOf, firstEmail, firstPhone, isOptOut, nameKey, type Category } from "./rules";

export type WriteCtx = MutationCtx & MemberAccess;
export type Outcome = { outcome: "created" | "updated" | "linked" | "skipped" | "failed"; table?: string; id?: string; reason?: string };

class RowFailure extends Error {}
const failRow = (reason: string): never => {
  throw new RowFailure(reason);
};

/** Values with the owner's edits over them. */
export const effective = (row: Doc<"migrationRows">): Record<string, string> => ({ ...row.values, ...row.edits });

/** The old system's name for links: what importing the same export again is matched by. */
export function linkSource(migration: Doc<"migrations">): string {
  return migration.source === "jobber" || migration.source === "housecall_pro" ? migration.source : "csv";
}

/** The key a record is found again by: the old system's id, or else what identifies it in the file. */
export function stableKey(row: Doc<"migrationRows">): string {
  const values = effective(row);
  if (values.externalId?.trim()) return values.externalId.trim().slice(0, 120);
  if (row.kind === "customers") return `name:${nameKey(customerNameOf(values))}|${(firstEmail(values.email) ?? "").toLowerCase()}|${(values.phone ?? "").replace(/\D/g, "")}`.slice(0, 120);
  if (row.kind === "properties") return `address:${addressKey(values)}`.slice(0, 120);
  const p = row.parsed ?? {};
  return `${row.kind}:${row.parent?.customerId ?? row.parent?.rowId ?? ""}|${row.parent?.propertyId ?? row.parent?.propertyRowId ?? ""}|${p.serviceId ?? ""}|${p.day ?? p.startsOn ?? ""}|${p.time ?? ""}`.slice(0, 120);
}

async function linked(ctx: WriteCtx, migration: Doc<"migrations">, row: Doc<"migrationRows">) {
  return ctx.db
    .query("migrationLinks")
    .withIndex("by_company_source_kind_external", (q) => q.eq("companyId", ctx.companyId).eq("source", linkSource(migration)).eq("kind", row.kind).eq("externalId", stableKey(row)))
    .first();
}

async function link(ctx: WriteCtx, migration: Doc<"migrations">, row: Doc<"migrationRows">, table: string, recordId: string) {
  if (await linked(ctx, migration, row)) return;
  await ctx.db.insert("migrationLinks", { companyId: ctx.companyId, source: linkSource(migration), kind: row.kind, externalId: stableKey(row), table, recordId, migrationId: migration._id, rowId: row._id, createdAt: Date.now() });
}

function kinds(category: Category | undefined): { customer: Doc<"customers">["kind"]; property: Doc<"properties">["kind"] } {
  switch (category) {
    case "commercial":
      return { customer: "commercial", property: "commercial" };
    case "office":
      return { customer: "commercial", property: "office" };
    case "short_term_rental":
      return { customer: "short_term_rental", property: "short_term_rental" };
    case "property_manager":
      return { customer: "property_manager", property: "property_manager" };
    default:
      return { customer: "home", property: "home" };
  }
}

function addressOf(values: Record<string, string>) {
  return cleanAddress({ line1: values.line1.trim(), ...(values.line2?.trim() ? { line2: values.line2.trim() } : {}), city: values.city.trim(), region: values.region.trim(), postalCode: values.postalCode.trim() });
}

async function ownCustomer(ctx: WriteCtx, id: string | undefined): Promise<Doc<"customers"> | null> {
  if (!id) return null;
  const customer = await ctx.db.get(id as Id<"customers">).catch(() => null);
  return customer && customer.companyId === ctx.companyId ? (customer as Doc<"customers">) : null;
}
async function ownProperty(ctx: WriteCtx, id: string | undefined): Promise<Doc<"properties"> | null> {
  if (!id) return null;
  const property = await ctx.db.get(id as Id<"properties">).catch(() => null);
  return property && property.companyId === ctx.companyId ? (property as Doc<"properties">) : null;
}

/** The choice that applies to a row: the owner's, or the default for a row that needs none. Null: it waits for the owner. */
export function choiceFor(row: Doc<"migrationRows">): string | null {
  if (row.decision) return row.decision.choice === "review" ? null : row.decision.choice;
  if (row.state === "ready") return "create";
  // Imported before: kept as it is unless the owner chooses to update fields.
  if (row.state === "update") return "keep_existing";
  if (row.state === "skip") return "skip";
  return null;
}

/** The existing record a "keep" or "update" applies to: the owner's pick, or the only match. */
function target(row: Doc<"migrationRows">, table: string): string | undefined {
  if (row.decision?.targetId) return row.decision.targetId;
  const matches = row.matches.filter((m) => m.table === table);
  return matches.length === 1 ? matches[0].id : undefined;
}

async function customerOfParent(ctx: WriteCtx, row: Doc<"migrationRows">): Promise<Doc<"customers">> {
  if (row.parent?.customerId) return (await ownCustomer(ctx, row.parent.customerId)) ?? failRow("Its customer is no longer in Selestial.");
  if (row.parent?.rowId) {
    const parent = await ctx.db.get(row.parent.rowId);
    if (!parent || parent.migrationId !== row.migrationId) failRow("Its customer row is gone.");
    const result = parent!.result;
    if (!result || result.outcome === "failed" || result.outcome === "skipped") failRow(`Its customer, ${customerNameOf(effective(parent!))}, wasn't imported${result?.reason ? `: ${result.reason}` : ""}.`);
    const id = result!.table === "customers" ? result!.id : undefined;
    return (await ownCustomer(ctx, id)) ?? failRow("Its customer wasn't imported.");
  }
  return failRow("It isn't linked to a customer yet.");
}

async function propertyOfParent(ctx: WriteCtx, row: Doc<"migrationRows">, customer: Doc<"customers">): Promise<Doc<"properties">> {
  if (row.parent?.propertyId) {
    const property = await ownProperty(ctx, row.parent.propertyId);
    if (!property || property.customerId !== customer._id) failRow("Its property is no longer this customer's.");
    return property!;
  }
  if (row.parent?.propertyRowId) {
    const parent = await ctx.db.get(row.parent.propertyRowId);
    const result = parent?.result;
    if (!result || result.table !== "properties" || !result.id) failRow(`Its property wasn't imported${result?.reason ? `: ${result.reason}` : ""}.`);
    return (await ownProperty(ctx, result!.id)) ?? failRow("Its property wasn't imported.");
  }
  // The customer's own property, chosen by address, or the only one.
  const list = (await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).take(100)).filter((p) => p.status === "active");
  const key = addressKey(effective(row));
  const same = key ? list.filter((p) => addressKey({ line1: p.address.line1, line2: p.address.line2 ?? "", postalCode: p.address.postalCode }) === key) : list;
  if (same.length === 1) return same[0];
  return failRow(same.length ? `${customer.name} has several properties. Say which one.` : `${customer.name} has no matching property.`);
}

async function keepOptOuts(ctx: WriteCtx, values: Record<string, string>, migration: Doc<"migrations">, actor: Actor, email?: string, phone?: string) {
  if (!isOptOut(values.doNotContact)) return;
  const note = `Opted out in the ${migration.source === "spreadsheet" || !migration.source ? "imported file" : `${migration.source.replace("_", " ")} export`} ("${values.doNotContact.slice(0, 40)}").`;
  if (email) await addSuppression(ctx, { companyId: ctx.companyId, channel: "email", address: email.toLowerCase(), scope: "all", reason: "manual", note, at: Date.now(), actor });
  const digits = (phone ?? "").replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : null;
  if (e164) await addSuppression(ctx, { companyId: ctx.companyId, channel: "sms", address: e164, scope: "all", reason: "manual", note, at: Date.now(), actor });
}

// ── Customers ────────────────────────────────────────────────────────────────────────────────────────

async function writeCustomer(ctx: WriteCtx, migration: Doc<"migrations">, row: Doc<"migrationRows">, choice: string, actor: Actor): Promise<Outcome> {
  const values = effective(row);
  const category = row.category?.value;
  // Another site of a commercial account the owner grouped: a property of that account.
  if (row.parent?.rowId && choice === "create") {
    const account = await customerOfParent(ctx, row);
    if (!addressComplete(values)) failRow("The address is incomplete, so it can't be added as a property.");
    const address = addressOf(values);
    const id = await ctx.db.insert("properties", { companyId: ctx.companyId, customerId: account._id, address, kind: kinds(category).property, ...(values.notes ? { crewNotes: values.notes.slice(0, 2000) } : {}), status: "active", revision: 1, createdAt: Date.now(), updatedAt: Date.now() });
    await refreshClient(ctx, account._id);
    return { outcome: "created", table: "properties", id, reason: `Added to ${account.name}` };
  }
  if (choice === "keep_existing") {
    const existing = await ownCustomer(ctx, target(row, "customers"));
    if (!existing) failRow("Choose which existing customer this is.");
    return { outcome: "linked", table: "customers", id: existing!._id, reason: "Kept the existing customer as it is." };
  }
  if (choice === "update_fields") {
    const existing = (await ownCustomer(ctx, target(row, "customers"))) ?? failRow("Choose which existing customer to update.");
    const fields = row.decision?.fields ?? [];
    if (!fields.length) failRow("Choose which fields to update.");
    const patch: Partial<Doc<"customers">> = {};
    if (fields.includes("email")) patch.email = optionalEmail(firstEmail(values.email));
    if (fields.includes("phone")) patch.phone = optionalText(firstPhone(values.phone), "Phone", 40);
    if (fields.includes("notes") && values.notes) patch.preferences = [existing.preferences, values.notes].filter(Boolean).join("\n").slice(0, 2000);
    if (fields.includes("category") && category) patch.kind = kinds(category).customer;
    const now = Date.now();
    await ctx.db.patch(existing._id, { ...patch, revision: (existing.revision ?? 0) + 1, updatedAt: now });
    if (fields.includes("address") && addressComplete(values)) {
      const list = await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", existing._id)).take(100);
      if (!list.some((p) => addressKey({ line1: p.address.line1, line2: p.address.line2 ?? "", postalCode: p.address.postalCode }) === addressKey(values))) {
        await ctx.db.insert("properties", { companyId: ctx.companyId, customerId: existing._id, address: addressOf(values), kind: kinds(category).property, status: "active", revision: 1, createdAt: now, updatedAt: now });
      }
    }
    await refreshClient(ctx, existing._id);
    return { outcome: "updated", table: "customers", id: existing._id, reason: `Updated ${fields.join(", ")}.` };
  }
  // create, or separate: a new customer.
  const name = text(customerNameOf(values), "Name", 160);
  const email = optionalEmail(firstEmail(values.email));
  const phone = optionalText(firstPhone(values.phone), "Phone", 40);
  const address = addressComplete(values) ? addressOf(values) : null;
  const now = Date.now();
  const kind = kinds(category);
  const business = category === "commercial" || category === "office" || category === "property_manager" || Boolean(values.company && !values.firstName && !values.lastName);
  const customerId = await ctx.db.insert("customers", {
    companyId: ctx.companyId,
    name,
    kind: kind.customer,
    type: business ? "business" : "person",
    email,
    phone,
    ...(values.notes ? { preferences: values.notes.slice(0, 2000) } : {}),
    status: "active",
    relationship: "active",
    relationshipAt: now,
    // No communication permission is set: an import is never consent to text or email.
    source: `import:${linkSource(migration)}`,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  if (email || phone) await ctx.db.insert("clientContacts", { companyId: ctx.companyId, customerId, name: values.company && (values.firstName || values.lastName) ? [values.firstName, values.lastName].filter(Boolean).join(" ") : name, email, phone, roles: ["primary", "billing"], propertyIds: [], status: "active", createdAt: now, updatedAt: now });
  if (address) await ctx.db.insert("properties", { companyId: ctx.companyId, customerId, address, kind: kind.property, status: "active", revision: 1, createdAt: now, updatedAt: now });
  await keepOptOuts(ctx, values, migration, actor, email, phone);
  // The older client import finds these too, so the two never make a second copy.
  if (values.externalId?.trim()) await ctx.db.insert("importedRecords", { companyId: ctx.companyId, source: linkSource(migration), externalId: values.externalId.trim().slice(0, 120), customerId, createdAt: now });
  await refreshClient(ctx, customerId);
  return { outcome: "created", table: "customers", id: customerId };
}

// ── Properties ───────────────────────────────────────────────────────────────────────────────────────

async function writeProperty(ctx: WriteCtx, row: Doc<"migrationRows">, choice: string): Promise<Outcome> {
  const values = effective(row);
  if (choice === "keep_existing") {
    const existing = await ownProperty(ctx, target(row, "properties"));
    if (!existing) failRow("Choose which existing property this is.");
    return { outcome: "linked", table: "properties", id: existing!._id, reason: "Kept the existing property." };
  }
  if (choice === "update_fields") failRow("Properties can be kept or added, not updated, in this import.");
  const customer = await customerOfParent(ctx, row);
  if (!addressComplete(values)) failRow("The address is incomplete.");
  const address = addressOf(values);
  const parentRow = row.parent?.rowId ? await ctx.db.get(row.parent.rowId) : null;
  const kindWords = `${values.kind ?? ""}`.toLowerCase();
  const kind: Doc<"properties">["kind"] = /office/.test(kindWords) ? "office" : /airbnb|vacation|short|rental|str/.test(kindWords) ? "short_term_rental" : /commercial|retail|business/.test(kindWords) ? "commercial" : /home|house|apartment|condo|residential/.test(kindWords) ? "home" : kinds(parentRow?.category?.value).property;
  const details: NonNullable<Doc<"properties">["details"]> = {};
  const p = row.parsed ?? {};
  if (typeof p.bedrooms === "number") details.bedrooms = p.bedrooms;
  if (typeof p.bathrooms === "number") details.bathrooms = p.bathrooms;
  if (typeof p.squareFeet === "number") details.squareFeet = p.squareFeet;
  const now = Date.now();
  const id = await ctx.db.insert("properties", {
    companyId: ctx.companyId,
    customerId: customer._id,
    address,
    kind,
    ...(values.label ? { label: values.label.slice(0, 120) } : {}),
    ...(values.accessNotes ? { accessInstructions: values.accessNotes.slice(0, 2000) } : {}),
    ...(values.crewNotes ? { crewNotes: values.crewNotes.slice(0, 2000) } : {}),
    ...(Object.keys(details).length ? { details } : {}),
    status: "active",
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  if (values.siteContactName) {
    const contactId = await ctx.db.insert("clientContacts", { companyId: ctx.companyId, customerId: customer._id, name: values.siteContactName.slice(0, 160), email: optionalEmail(firstEmail(values.siteContactEmail)), phone: optionalText(firstPhone(values.siteContactPhone), "Phone", 40), roles: ["site"], propertyIds: [id], status: "active", createdAt: now, updatedAt: now });
    await ctx.db.patch(id, { siteContactId: contactId });
  }
  await refreshClient(ctx, customer._id);
  return { outcome: "created", table: "properties", id };
}

// ── Recurring services ───────────────────────────────────────────────────────────────────────────────

async function liveService(ctx: WriteCtx, id: unknown) {
  const service = typeof id === "string" ? await ctx.db.get(id as Id<"services">).catch(() => null) : null;
  if (!service || (service as Doc<"services">).companyId !== ctx.companyId || (service as Doc<"services">).status !== "active") failRow("Its Selestial service isn't live. Choose a live service.");
  const live = await publishedSpec(ctx, service as Doc<"services">);
  if (!live) failRow("Its Selestial service has no published version.");
  return { service: service as Doc<"services">, live: live! };
}

function serviceMinutes(spec: Doc<"serviceVersions">["spec"], schedule?: Schedule): number | null {
  const result = quote(spec, schedule ? { schedule } : {});
  return result.outcome === "incomplete" ? null : Math.max(15, result.time.elapsedMinutes);
}

async function writePlan(ctx: WriteCtx, migration: Doc<"migrations">, row: Doc<"migrationRows">, choice: string, actor: Actor): Promise<Outcome & { proposal?: string }> {
  if (choice !== "create" && choice !== "separate") failRow("A recurring service can be added or skipped.");
  const p = row.parsed ?? {};
  const customer = await customerOfParent(ctx, row);
  const property = await propertyOfParent(ctx, row, customer);
  const { service, live } = await liveService(ctx, p.serviceId);
  const schedule = p.schedule as Schedule | undefined;
  const startsOn = typeof p.startsOn === "string" ? p.startsOn : null;
  const time = typeof p.time === "string" ? p.time : null;
  if (!schedule || !startsOn || !time) failRow("It needs a schedule, a next visit and a time.");
  const minutes = typeof p.minutes === "number" ? p.minutes : serviceMinutes(live.spec, schedule);
  const values = effective(row);
  const now = Date.now();
  const planId = await ctx.db.insert("servicePlans", {
    companyId: ctx.companyId,
    customerId: customer._id,
    propertyId: property._id,
    serviceId: service._id,
    kind: "recurring",
    // Set up, never started: it books nothing until the owner releases the migration.
    state: "setup",
    cadence: schedule!,
    startsOn: startsOn!,
    startTime: time!,
    durationMinutes: minutes ?? 120,
    arrivalWindowMinutes: live.spec.team.arrivalWindowMinutes ?? 0,
    crewSize: live.spec.team.crewSize,
    quoteInput: JSON.stringify({ schedule }),
    // The price is the property's own price once approved; a typed plan price would bill before approval.
    priceCents: null,
    firstVisit: null,
    scopeNote: (values.notes ?? "").slice(0, 1000),
    preferredCleanerIds: [],
    ...(typeof p.endsOn === "string" ? { endsOn: p.endsOn } : {}),
    ...(p.paused ? { pausedFrom: startsOn! } : {}),
    skipped: [],
    migration: { migrationId: migration._id, held: true },
    revision: 1,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  });
  let proposal: string | undefined;
  if (typeof p.cents === "number" && p.cents >= 100) {
    try {
      const made = await proposePropertyPrice(ctx, { serviceId: service._id, propertyId: property._id, baseCents: p.cents, laborMinutes: null, until: null, reason: `Imported from your ${migration.source === "spreadsheet" || !migration.source ? "spreadsheet" : migration.source.replace("_", " ")}: the price this property paid per visit (${values.price}).`, actor, via: "workspace" });
      proposal = made.changeId;
    } catch (error) {
      // The plan is still set up; the price waits for a person.
      proposal = undefined;
      void error;
    }
  }
  await refreshClient(ctx, customer._id);
  return { outcome: "created", table: "servicePlans", id: planId, reason: [`Set up, waiting for release${minutes === null ? ". Length set to 2 hours: change it on the plan" : ""}.`, proposal ? "Its price is waiting for your approval in Services & Pricing." : typeof p.cents === "number" ? "Its price couldn't be proposed; set it in Services & Pricing." : ""].filter(Boolean).join(" "), proposal };
}

// ── Upcoming visits ──────────────────────────────────────────────────────────────────────────────────

async function writeVisit(ctx: WriteCtx, migration: Doc<"migrations">, row: Doc<"migrationRows">, choice: string): Promise<Outcome> {
  if (choice !== "create" && choice !== "separate") failRow("A booking can be added or skipped.");
  const p = row.parsed ?? {};
  const customer = await customerOfParent(ctx, row);
  const property = await propertyOfParent(ctx, row, customer);
  const { service, live } = await liveService(ctx, p.serviceId);
  const day = typeof p.day === "string" ? p.day : failRow("It has no date.");
  const time = typeof p.time === "string" ? p.time : failRow("It has no start time.");
  const minutes = typeof p.minutes === "number" ? p.minutes : (serviceMinutes(live.spec) ?? failRow("Add a length: the service doesn't give one."));
  const startsAt = instantOn(day, time, migration.timezone);
  const endsAt = startsAt + minutes * 60_000;
  // A visit of an imported plan joins that plan's series, so the plan never books the same day again.
  let plan: { planId: Id<"servicePlans">; planDate: string } | null = null;
  if (row.parent?.planRowId && row.parent.planDate) {
    const planRow = await ctx.db.get(row.parent.planRowId);
    if (planRow?.result?.table === "servicePlans" && planRow.result.id) plan = { planId: planRow.result.id as Id<"servicePlans">, planDate: row.parent.planDate };
  }
  const already = await ctx.db.query("jobs").withIndex("by_company_property_start", (q) => q.eq("companyId", ctx.companyId).eq("propertyId", property._id).gte("startsAt", startsAt - 60_000).lte("startsAt", startsAt + 60_000)).first();
  if (already && already.status !== "cancelled") return { outcome: "linked", table: "jobs", id: already._id, reason: "A visit at this property and time was already on the schedule." };
  const values = effective(row);
  const cents = typeof p.cents === "number" ? p.cents : undefined;
  const id = await ctx.db.insert("jobs", {
    companyId: ctx.companyId,
    customerId: customer._id,
    propertyId: property._id,
    serviceType: live.spec.name.slice(0, 80),
    scope: visitScope(live.spec).slice(0, 2000),
    requiredSkills: live.spec.team.skills,
    serviceSnapshot: { serviceId: service.key, name: live.spec.name, scope: visitScope(live.spec), durationMinutes: minutes, defaultCrew: live.spec.team.crewSize, skills: live.spec.team.skills, capturedAt: Date.now(), versionId: live._id, version: live.version, priceSource: cents !== undefined ? "manual" : "none" },
    ...(cents !== undefined ? { priceCents: cents } : {}),
    startsAt,
    endsAt,
    status: "scheduled",
    ...(live.spec.team.crewSize > 1 ? { requiredCrew: live.spec.team.crewSize } : {}),
    ...(values.notes ? { instructions: values.notes.slice(0, 4000) } : {}),
    ...(plan ? plan : {}),
    // Held: Dispatch doesn't offer it and nothing is sent about it until the owner releases the migration.
    migration: { migrationId: migration._id, held: true },
    createdAt: Date.now(),
  });
  await refreshClient(ctx, customer._id);
  return { outcome: "created", table: "jobs", id, reason: plan ? "Part of its recurring service." : undefined };
}

/**
 * Writes one row. Already written (a retry, a second run): the earlier result. Imported before under the
 * same key: linked, not copied. A row's problem fails that row only.
 */
export async function writeRow(ctx: WriteCtx, migration: Doc<"migrations">, row: Doc<"migrationRows">, actor: Actor): Promise<Outcome | null> {
  if (row.result) return null;
  const choice = choiceFor(row);
  if (choice === null || row.state === "error" || row.state === "held") return null;
  if (choice === "skip") return { outcome: "skipped", reason: row.decision ? "You chose to skip it." : (row.notes[0] ?? "Skipped.") };
  // Imported before under the same key: what it became, whatever kind of record that was. A person's own choice wins.
  const prior = choice === "create" || (choice === "keep_existing" && !row.decision) ? await linked(ctx, migration, row) : null;
  if (prior) return { outcome: "linked", table: prior.table, id: prior.recordId, reason: "Imported before; not copied again." };
  try {
    const result = row.kind === "customers" ? await writeCustomer(ctx, migration, row, choice, actor) : row.kind === "properties" ? await writeProperty(ctx, row, choice) : row.kind === "recurring" ? await writePlan(ctx, migration, row, choice, actor) : row.kind === "bookings" ? await writeVisit(ctx, migration, row, choice) : null;
    if (!result) return null;
    if (result.id && result.table && (result.outcome === "created" || result.outcome === "linked" || result.outcome === "updated")) await link(ctx, migration, row, result.table, result.id);
    return { outcome: result.outcome, table: result.table, id: result.id, reason: result.reason };
  } catch (error) {
    if (error instanceof RowFailure) return { outcome: "failed", reason: error.message };
    const words = (error as { data?: { message?: string } }).data?.message;
    if (words) return { outcome: "failed", reason: words };
    throw error;
  }
}
