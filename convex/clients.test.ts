import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, JOB_END, JOB_START, NOW, refusal, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const page = { numItems: 25, cursor: null };
const address = (line1: string, postalCode = "78701") => ({ line1, city: "Austin", region: "TX", postalCode });

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  return { t, ...owner };
}
type As = Awaited<ReturnType<typeof setup>>["as"];

async function client(as: As, companyId: Id<"companies">, input: { name: string; type?: "person" | "business"; kind?: "home" | "commercial" | "short_term_rental" | "property_manager"; email?: string; phone?: string; property?: { line1: string; kind: "home" | "commercial" | "office" | "short_term_rental" } }) {
  const result = await as.mutation(api.clients.create, {
    companyId,
    type: input.type ?? "person",
    name: input.name,
    kind: input.kind ?? "home",
    contact: { name: input.name, email: input.email, phone: input.phone ?? "512-555-0100" },
    ...(input.property ? { property: { address: address(input.property.line1), kind: input.property.kind } } : {}),
    addAnyway: true,
  });
  if (!result.created) throw new Error("not created");
  return result.customerId;
}

type View = "all" | "residential" | "residential_recurring" | "residential_one_time" | "commercial" | "office" | "str" | "prospects" | "archived";
const names = async (as: As, companyId: Id<"companies">, view: View, extra: Record<string, unknown> = {}) =>
  (await as.query(api.clients.directory, { companyId, view, paginationOpts: page, ...extra })).page.map((row) => row.name);

describe("Clients & Properties", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("files one client into every view it belongs to, without copying it", async () => {
    const { as, companyId } = await setup();
    const dana = await client(as, companyId, { name: "Dana Whitfield", property: { line1: "12 Elm St", kind: "home" } });
    const acme = await client(as, companyId, { name: "Acme Holdings", type: "business", kind: "commercial", property: { line1: "1 Main St", kind: "office" } });
    await as.mutation(api.properties.create, { companyId, customerId: acme, address: address("9 Lake Rd"), kind: "short_term_rental", label: "Lake house" });
    await client(as, companyId, { name: "Brightside Retail", type: "business", kind: "commercial", property: { line1: "40 Oak Ave", kind: "commercial" } });

    expect(await names(as, companyId, "all")).toEqual(["Acme Holdings", "Brightside Retail", "Dana Whitfield"]);
    expect(await names(as, companyId, "residential")).toEqual(["Dana Whitfield"]);
    // No plan yet, so Dana is one-time; nobody is recurring.
    expect(await names(as, companyId, "residential_one_time")).toEqual(["Dana Whitfield"]);
    expect(await names(as, companyId, "residential_recurring")).toEqual([]);
    expect(await names(as, companyId, "commercial")).toEqual(["Acme Holdings", "Brightside Retail"]);
    expect(await names(as, companyId, "office")).toEqual(["Acme Holdings"]);
    expect(await names(as, companyId, "str")).toEqual(["Acme Holdings"]);

    const acmeRow = (await as.query(api.clients.directory, { companyId, view: "all", paginationOpts: page })).page.find((row) => row.customerId === acme)!;
    expect(acmeRow.categories).toEqual(["Commercial", "Office", "STR"]);
    expect(acmeRow.properties.count).toBe(2);
    const strRow = (await as.query(api.clients.directory, { companyId, view: "str", paginationOpts: page })).page[0];
    expect(strRow.properties.main?.name).toBe("Lake house");
    // Counts are per view and overlap: they never add up to the total.
    const overview = await as.query(api.clients.overview, { companyId });
    expect(overview.counts).toMatchObject({ all: 3, residential: 1, commercial: 2, office: 1, str: 1 });
    expect(dana).toBeTruthy();
  });

  it("searches names, contacts and addresses on the server, never access instructions", async () => {
    const { as, companyId } = await setup();
    const dana = await client(as, companyId, { name: "Dana Whitfield", email: "dana@example.com", property: { line1: "12 Elm St", kind: "home" } });
    await client(as, companyId, { name: "Sam Lee", property: { line1: "77 Pine Rd", kind: "home" } });
    const [property] = (await as.query(api.clients.profile, { companyId, customerId: dana })).properties;
    await as.mutation(api.properties.update, { companyId, propertyId: property.id as Id<"properties">, accessInstructions: "Lockbox 4417 behind the gate" });
    expect(await names(as, companyId, "all", { q: "Elm" })).toEqual(["Dana Whitfield"]);
    expect(await names(as, companyId, "all", { q: "dana@example.com" })).toEqual(["Dana Whitfield"]);
    expect(await names(as, companyId, "all", { q: "Pine" })).toEqual(["Sam Lee"]);
    expect(await names(as, companyId, "all", { q: "Lockbox" })).toEqual([]);
    expect(await names(as, companyId, "all", { q: "4417" })).toEqual([]);
  });

  it("pages through a view on the server", async () => {
    const { as, companyId } = await setup();
    for (let i = 0; i < 7; i++) await client(as, companyId, { name: `Client ${String.fromCharCode(65 + i)}`, phone: `512-555-01${10 + i}` });
    const first = await as.query(api.clients.directory, { companyId, view: "all", paginationOpts: { numItems: 3, cursor: null } });
    expect(first.page.map((r) => r.name)).toEqual(["Client A", "Client B", "Client C"]);
    expect(first.isDone).toBe(false);
    const second = await as.query(api.clients.directory, { companyId, view: "all", paginationOpts: { numItems: 3, cursor: first.continueCursor } });
    expect(second.page.map((r) => r.name)).toEqual(["Client D", "Client E", "Client F"]);
    expect((await names(as, companyId, "all", { sort: "name_desc" }))[0]).toBe("Client G");
  });

  it("stops at a likely duplicate and says which client it matches", async () => {
    const { as, companyId } = await setup();
    await client(as, companyId, { name: "Dana Whitfield", email: "dana@example.com", phone: "(512) 555-0199" });
    const again = await as.mutation(api.clients.create, { companyId, type: "person", name: "D. Whitfield", kind: "home", contact: { name: "D. Whitfield", phone: "512.555.0199" } });
    expect(again).toMatchObject({ created: false, duplicates: [{ name: "Dana Whitfield", reason: "Same phone" }] });
    const byName = await as.mutation(api.clients.create, { companyId, type: "person", name: "dana  whitfield", kind: "home", contact: { name: "Dana", email: "other@example.com" } });
    expect(byName).toMatchObject({ created: false, duplicates: [{ name: "Dana Whitfield", reason: "Same name" }] });
    expect(await as.mutation(api.clients.create, { companyId, type: "person", name: "D. Whitfield", kind: "home", contact: { name: "D. Whitfield", phone: "512.555.0199" }, addAnyway: true })).toMatchObject({ created: true });
  });

  it("keeps a prospect on the same record when it becomes a client, history and all", async () => {
    const { t, as, companyId } = await setup();
    await t.mutation(internal.googleAds.ingestLead, { companyId, source: "lead_form", externalId: "lead-1", name: "Priya Nair", email: "priya@example.com", postalCode: "78701" });
    expect(await names(as, companyId, "all")).toEqual([]);
    expect(await names(as, companyId, "prospects")).toEqual(["Priya Nair"]);
    const [row] = (await as.query(api.clients.directory, { companyId, view: "prospects", paginationOpts: page })).page;
    const customerId = row.customerId;
    // The lead's Sales task is about this record and shows as follow-up.
    expect((await as.query(api.clients.overview, { companyId })).attention.find((a) => a.kind === "followup")?.count).toBe(1);
    // Booking the first visit makes the prospect a client, on the same record.
    const propertyId = await as.mutation(api.properties.create, { companyId, customerId, address: address("5 River Rd"), kind: "home" });
    await as.mutation(api.jobs.create, { companyId, customerId, propertyId, serviceType: "Standard clean", scope: "Whole home", startsAt: JOB_START, endsAt: JOB_END });
    const profile = await as.query(api.clients.profile, { companyId, customerId });
    expect(profile.relationship).toBe("active");
    expect(await names(as, companyId, "prospects")).toEqual([]);
    expect(await names(as, companyId, "all")).toEqual(["Priya Nair"]);
    const summary = await as.query(api.clients.summary, { companyId, customerId });
    expect(summary.activity.map((a) => a.type)).toEqual(expect.arrayContaining(["customer.became_client", "google.lead_received"]));
    expect(summary.nextVisit).toMatchObject({ service: "Standard clean", outcome: "Booked", staffing: { state: "none", words: "No cleaner yet" } });
  });

  it("shows access instructions and private notes only to Owners and Managers", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-a", "office");
    const customerId = await client(as, companyId, { name: "Dana Whitfield", property: { line1: "12 Elm St", kind: "home" } });
    const [property] = (await as.query(api.clients.profile, { companyId, customerId })).properties;
    await as.mutation(api.properties.update, { companyId, propertyId: property.id as Id<"properties">, accessInstructions: "Lockbox 4417" });
    const { revision } = await as.query(api.clients.profile, { companyId, customerId });
    await as.mutation(api.clients.update, { companyId, customerId, expectedRevision: revision, privateNotes: "Prefers we never mention the dog." });
    const mine = await as.query(api.clients.profile, { companyId, customerId });
    expect(mine.properties[0].accessInstructions).toBe("Lockbox 4417");
    expect(mine.privateNotes).toBe("Prefers we never mention the dog.");
    const theirs = await office.query(api.clients.profile, { companyId, customerId });
    expect(theirs.properties[0]).toMatchObject({ accessInstructions: null, hasAccessInstructions: true });
    expect(theirs.privateNotes).toBeNull();
    expect((await office.query(api.customers.get, { companyId, customerId })).properties[0].accessInstructions).toBeUndefined();
    expect((await office.query(api.properties.get, { companyId, propertyId: property.id as Id<"properties"> })).accessInstructions).toBeUndefined();
    expect(await refusal(office.mutation(api.properties.update, { companyId, propertyId: property.id as Id<"properties">, accessInstructions: "new code" }))).toContain("Only an Owner or Manager");
    expect(await refusal(office.mutation(api.clients.update, { companyId, customerId, expectedRevision: theirs.revision, privateNotes: "x" }))).toContain("Only an Owner or Manager");
    // Office still edits the client itself.
    await office.mutation(api.clients.update, { companyId, customerId, expectedRevision: theirs.revision, preferences: "Unscented products" });
  });

  it("refuses a save made from an older copy instead of overwriting it", async () => {
    const { as, companyId } = await setup();
    const customerId = await client(as, companyId, { name: "Dana Whitfield" });
    const { revision } = await as.query(api.clients.profile, { companyId, customerId });
    await as.mutation(api.clients.update, { companyId, customerId, expectedRevision: revision, preferences: "Mornings" });
    expect(await refusal(as.mutation(api.clients.update, { companyId, customerId, expectedRevision: revision, preferences: "Evenings" }))).toContain("Someone else saved this client");
    expect((await as.query(api.clients.profile, { companyId, customerId })).preferences).toBe("Mornings");
  });

  it("keeps exactly one primary contact, whose details are the client's", async () => {
    const { as, companyId } = await setup();
    const customerId = await client(as, companyId, { name: "Acme Holdings", type: "business", kind: "commercial", email: "front@acme.test" });
    const { contactId } = await as.mutation(api.clients.saveContact, { companyId, customerId, name: "Jo Park", email: "jo@acme.test", roles: ["billing", "signer"], propertyIds: [] });
    let profile = await as.query(api.clients.profile, { companyId, customerId });
    expect(profile.contacts.map((c) => [c.name, c.roles])).toEqual([
      ["Acme Holdings", ["primary", "billing"]],
      ["Jo Park", ["billing", "signer"]],
    ]);
    await as.mutation(api.clients.saveContact, { companyId, customerId, contactId, name: "Jo Park", email: "jo@acme.test", roles: ["primary", "signer"], propertyIds: [] });
    profile = await as.query(api.clients.profile, { companyId, customerId });
    expect(profile.contacts.filter((c) => c.roles.includes("primary")).map((c) => c.name)).toEqual(["Jo Park"]);
    expect(profile.email).toBe("jo@acme.test");
    expect(await refusal(as.mutation(api.clients.removeContact, { companyId, contactId }))).toContain("Make someone else the primary contact first");
  });

  it("will not archive a client with visits or plans still to come, and keeps its history when it does", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-a", "office");
    const customerId = await client(as, companyId, { name: "Dana Whitfield", property: { line1: "12 Elm St", kind: "home" } });
    const propertyId = (await as.query(api.clients.profile, { companyId, customerId })).properties[0].id as Id<"properties">;
    const jobId = await as.mutation(api.jobs.create, { companyId, customerId, propertyId, serviceType: "Standard clean", scope: "Whole home", startsAt: JOB_START, endsAt: JOB_END });
    expect((await as.query(api.clients.archivePreview, { companyId, customerId })).blockers).toEqual(["1 upcoming visit. Cancel or finish it first."]);
    let { revision } = await as.query(api.clients.profile, { companyId, customerId });
    expect(await refusal(as.mutation(api.clients.archive, { companyId, customerId, expectedRevision: revision, reason: "Moved away" }))).toContain("1 upcoming visit");
    expect(await refusal(office.mutation(api.clients.archive, { companyId, customerId, expectedRevision: revision, reason: "Moved away" }))).toBe("Not allowed.");
    await as.mutation(api.jobs.cancel, { companyId, jobId, reason: "Client moved" });
    ({ revision } = await as.query(api.clients.profile, { companyId, customerId }));
    await as.mutation(api.clients.archive, { companyId, customerId, expectedRevision: revision, reason: "Moved away" });
    expect(await names(as, companyId, "all")).toEqual([]);
    expect(await names(as, companyId, "archived")).toEqual(["Dana Whitfield"]);
    expect((await as.query(api.jobs.get, { companyId, jobId })).job.status).toBe("cancelled");
    await as.mutation(api.clients.restore, { companyId, customerId });
    expect(await names(as, companyId, "all")).toEqual(["Dana Whitfield"]);
  });

  it("only changes a relationship the way the role allows", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-a", "office");
    const result = await as.mutation(api.clients.create, { companyId, type: "person", name: "Priya Nair", kind: "home", relationship: "prospect", contact: { name: "Priya Nair", phone: "512-555-0142" } });
    if (!result.created) throw new Error("not created");
    let profile = await office.query(api.clients.profile, { companyId, customerId: result.customerId });
    await office.mutation(api.clients.setRelationship, { companyId, customerId: result.customerId, expectedRevision: profile.revision, relationship: "active" });
    profile = await office.query(api.clients.profile, { companyId, customerId: result.customerId });
    expect(profile.relationship).toBe("active");
    expect(await refusal(office.mutation(api.clients.setRelationship, { companyId, customerId: result.customerId, expectedRevision: profile.revision, relationship: "former" }))).toContain("Only an Owner or Manager");
    await as.mutation(api.clients.setRelationship, { companyId, customerId: result.customerId, expectedRevision: profile.revision, relationship: "paused", note: "Travelling until June" });
    expect(await names(as, companyId, "all", { relationship: "paused" })).toEqual(["Priya Nair"]);
  });

  it("keeps each company's clients to itself", async () => {
    const { t, as, companyId } = await setup();
    const customerId = await client(as, companyId, { name: "Dana Whitfield" });
    const rival = await company(t, "owner-b", "Beta Cleaning");
    expect(await refusal(rival.as.query(api.clients.profile, { companyId: rival.companyId, customerId }))).toBe("Not found.");
    expect(await names(rival.as, rival.companyId, "all", { q: "Dana" })).toEqual([]);
    expect(await refusal(rival.as.mutation(api.clients.saveContact, { companyId: rival.companyId, customerId, name: "X", email: "x@example.com", roles: [], propertyIds: [] }))).toBe("Not found.");
  });

  it("prepares the directory for clients made before it existed", async () => {
    const { t, as, companyId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("customers", { companyId, name: "Old Client", kind: "home", status: "active", createdAt: Date.now() });
    });
    expect((await as.query(api.clients.overview, { companyId })).needsPrepare).toBe(true);
    expect(await as.mutation(api.clients.prepareDirectory, { companyId })).toEqual({ done: true, prepared: 1 });
    expect(await names(as, companyId, "all")).toEqual(["Old Client"]);
    expect((await as.query(api.clients.overview, { companyId })).needsPrepare).toBe(false);
  });
});
