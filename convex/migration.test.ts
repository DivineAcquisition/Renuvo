/**
 * @vitest-environment edge-runtime
 *
 * "Bring your business to Selestial": the rules that read files, and a migration end to end. Repeated
 * files, interrupted imports, ambiguous dates, several properties for one company, duplicate contacts,
 * recurring visits that are also listed as bookings, partial failures, another company's access, kept
 * opt-outs and, above all, that nothing imported starts agent work until the Owner releases it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { analyze, type RowIn } from "./lib/migration/analyze";
import { dateOrderOf, guessKind, guessMapping, isOptOut, parseAvailability, parseCents, parseDay, parseEngagement, parseFrequency, parseMinutes, parseTime, suggestCategory } from "./lib/migration/rules";
import { SOURCE_CARDS, templateCsv } from "./lib/migration/sources";
import { blankSpec, type Spec } from "./lib/services/spec";

const notice = { required: false, note: "" };

describe("Reading a file: deterministic rules", () => {
  it("never guesses an ambiguous date, and reads one only in the order the files prove or the owner chose", () => {
    expect(parseDay("2027-03-04", null)).toEqual({ day: "2027-03-04" });
    expect(parseDay("03/04/2027", null)).toEqual({ ambiguous: true });
    expect(parseDay("03/04/2027", "mdy")).toEqual({ day: "2027-03-04" });
    expect(parseDay("03/04/2027", "dmy")).toEqual({ day: "2027-04-03" });
    expect(parseDay("13/04/2027", null)).toEqual({ day: "2027-04-13" });
    expect(parseDay("Mar 5, 2027", null)).toEqual({ day: "2027-03-05" });
    expect(parseDay("02/30/2027", "mdy")).toMatchObject({ error: expect.stringContaining("not a real date") });
    expect(dateOrderOf(["03/04/2027", "3/19/2027"])).toMatchObject({ order: "mdy", proof: "3/19/2027", ambiguous: 1 });
    expect(dateOrderOf(["03/04/2027", "19/03/2027"])).toMatchObject({ order: "dmy" });
    expect(dateOrderOf(["03/04/2027", "19/03/2027", "3/19/2027"]).order).toBeNull();
    expect(dateOrderOf(["03/04/2027"]).order).toBeNull();
  });

  it("reads times, lengths and money exactly, and leaves a missing price missing", () => {
    expect(parseTime("9:00 AM")).toBe("09:00");
    expect(parseTime("2:30pm - 4:00pm")).toBe("14:30");
    expect(parseTime("12:00 AM")).toBe("00:00");
    expect(parseTime("18:45")).toBe("18:45");
    expect(parseTime("2027-03-04 09:15")).toBe("09:15");
    expect(parseTime("9")).toBeNull();
    expect(parseMinutes("2 hours")).toBe(120);
    expect(parseMinutes("2.5")).toBe(150);
    expect(parseMinutes("90")).toBe(90);
    expect(parseMinutes("1:30")).toBe(90);
    expect(parseCents("$1,234.50")).toEqual({ cents: 123450 });
    expect(parseCents("")).toEqual({ cents: null });
    expect(parseCents("-5")).toMatchObject({ error: expect.any(String) });
    expect(parseCents("call for price")).toMatchObject({ error: expect.any(String) });
  });

  it("keeps every four weeks and once a month apart, and says when a word has two meanings", () => {
    expect(parseFrequency("Weekly")).toEqual({ schedule: "every_7_days" });
    expect(parseFrequency("Every other week")).toEqual({ schedule: "every_14_days" });
    expect(parseFrequency("Biweekly")).toMatchObject({ schedule: "every_14_days", note: expect.stringContaining("twice a week") });
    expect(parseFrequency("Every 4 weeks")).toEqual({ schedule: "every_28_days" });
    expect(parseFrequency("Monthly")).toEqual({ schedule: "once_per_month" });
    expect(parseFrequency("Twice a month")).toEqual({ schedule: "twice_per_month" });
    expect(parseFrequency("Bimonthly")).toMatchObject({ error: expect.stringContaining("Choose") });
    expect(parseFrequency("Every 3 weeks")).toMatchObject({ error: expect.stringContaining("isn't a schedule") });
    expect(parseFrequency("One time")).toMatchObject({ error: expect.any(String) });
  });

  it("recognizes what a file is and suggests columns, as suggestions", () => {
    const customers = ["J-ID", "Display Name", "First Name", "Last Name", "E-mails", "Main Phone #s", "Service Street 1", "Service City", "Service State", "Service Zip code"];
    expect(guessKind(customers).kind).toBe("customers");
    expect(guessMapping("customers", customers)).toMatchObject({ externalId: 0, name: 1, firstName: 2, lastName: 3, email: 4, phone: 5, line1: 6, city: 7, region: 8, postalCode: 9 });
    expect(guessKind(["Recurring ID", "Customer ID", "Service", "Frequency", "Next Visit"]).kind).toBe("recurring");
    expect(guessKind(["Booking ID", "Customer", "Service", "Date", "Start Time"]).kind).toBe("bookings");
    expect(guessKind(["Employee", "Hire Date", "Pay Rate"]).kind).toBe("cleaners");
    expect(guessKind(["Invoice", "Amount Due", "Balance"]).kind).toBe("balances");
    expect(guessKind(["foo", "bar"]).kind).toBe("other");
  });

  it("reads documented opt-outs and suggests customer types with their reason", () => {
    expect(isOptOut("Yes")).toBe(true);
    expect(isOptOut("Unsubscribed")).toBe(true);
    expect(isOptOut("No")).toBe(false);
    expect(isOptOut("")).toBe(false);
    expect(suggestCategory({ company: "Harbor Dental", name: "Harbor Dental" }, false)).toMatchObject({ category: "commercial", because: expect.stringContaining("Harbor Dental") });
    expect(suggestCategory({ category: "Airbnb", name: "Lake House" }, false).category).toBe("short_term_rental");
    expect(suggestCategory({ name: "Dana Whitfield", firstName: "Dana" }, true).category).toBe("residential_recurring");
    expect(suggestCategory({ name: "Dana Whitfield", firstName: "Dana" }, false).category).toBe("residential_one_time");
    expect(suggestCategory({ category: "Office", name: "Acme" }, false).category).toBe("office");
  });

  it("doesn't link a booking to a customer when several could match", () => {
    const rows: RowIn[] = [
      { id: "c1", kind: "customers", index: 0, values: { name: "Pat Lee", email: "pat1@example.com" } },
      { id: "c2", kind: "customers", index: 1, values: { name: "Pat Lee", email: "pat2@example.com" } },
      { id: "b1", kind: "bookings", index: 0, values: { customerName: "Pat Lee", service: "Standard", date: "2027-03-05", time: "9:00 AM" } },
    ];
    const result = analyze({ rows, existing: { customers: [], contacts: [], properties: [], plans: [], jobs: [], links: [], services: [{ id: "s1", name: "Standard" }] }, context: { today: "2027-03-01", dateOrder: null, serviceMap: [], groups: [] } });
    const booking = result.rows.find((r) => r.id === "b1")!;
    expect(booking.state).toBe("review");
    expect(booking.parent).toBeUndefined();
    expect(booking.matches.map((m) => m.id)).toEqual(["c1", "c2"]);
  });

  it("describes sources honestly: a CSV is not an integration, and saved cards never move", () => {
    for (const card of Object.values(SOURCE_CARDS)) expect(card.notSupported.join(" ")).toMatch(/Saved cards|can't approve/);
    expect(SOURCE_CARDS.bookingkoala.connector).toBeNull();
    expect(SOURCE_CARDS.housecall_pro.verifiedFrom?.url).toContain("help.housecallpro.com");
    expect(SOURCE_CARDS.jobber.verifiedFrom).toBeNull();
    expect(templateCsv("customers").split("\n")[0]).toContain("Do Not Contact");
  });
});

// ── End to end ───────────────────────────────────────────────────────────────────────────────────────

const CUSTOMERS = `J-ID,Display Name,Company Name,First Name,Last Name,Client Type,Main Phone #s,E-mails,Service Street 1,Service Street 2,Service City,Service State,Service Zip code,Do Not Contact
101,Dana Whitfield,,Dana,Whitfield,Residential,512-555-0101,dana@example.com,12 Elm St,,Austin,TX,78701,No
102,Harbor Dental,Harbor Dental,,,Commercial,512-555-0102,frontdesk@harbordental.example,400 Congress Ave,Suite 200,Austin,TX,78701,
103,Harbor Dental,Harbor Dental,,,Commercial,512-555-0102,frontdesk@harbordental.example,900 Lamar Blvd,,Austin,TX,78703,
104,Sam Existing,,Sam,Existing,Residential,512-555-0199,sam@example.com,5 Oak St,,Austin,TX,78701,
105,Opted Out,,Opted,Out,Residential,512-555-0105,optout@example.com,7 Pine St,,Austin,TX,78701,Yes
106,,,,,,,,,,,,,
`;

const RECURRING = `Recurring ID,Customer ID,Service,Frequency,Next Visit,Start Time,Duration,Price,Status
R1,101,Standard Clean,Weekly,2027-03-05,9:00 AM,2 hours,$140.00,Active
R2,102,Office Clean,Biweekly,2027-03-08,6:00 PM,3 hours,$220,Active
`;

const BOOKINGS = `Booking ID,Customer ID,Service,Date,Start Time,End Time,Price,Status,Recurring ID
B1,101,Standard Clean,03/12/2027,9:00 AM,11:00 AM,$140.00,Scheduled,R1
B2,101,Standard Clean,3/19/2027,9:00 AM,11:00 AM,$140.00,Scheduled,
B3,104,Deep Clean,2027-03-10,1:00 PM,4:00 PM,$300,Scheduled,
B4,102,Office Clean,2027-03-09,6:00 PM,,$220,Cancelled,
B5,101,Standard Clean,2027-02-20,9:00 AM,,$140,Completed,
`;

function homeSpec(): Spec {
  return {
    ...blankSpec("residential"),
    name: "Standard clean",
    summary: "A full clean.",
    included: [{ id: "counters", label: "Wipe kitchen counters", section: "Kitchen", requiresPhoto: false }],
    pricing: { method: "fixed", amountCents: 15000, laborMinutes: 120 },
  };
}

type As = Awaited<ReturnType<typeof company>>["as"];

async function publish(as: As, companyId: Id<"companies">, spec: Spec) {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  return serviceId;
}

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function upload(t: T, as: As, companyId: Id<"companies">, name: string, csv: string) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([csv], { type: "text/csv" })));
  const fileId = await as.mutation(api.migration.addFile, { companyId, storageId, name });
  await settle(t);
  return fileId;
}

async function confirmColumns(t: T, as: As, companyId: Id<"companies">) {
  const view = (await as.query(api.migration.view, { companyId }))!;
  for (const file of view.files) await as.mutation(api.migration.setMapping, { companyId, fileId: file.id, mapping: file.mapping, confirm: true });
  await settle(t);
}

async function rowsOf(as: As, companyId: Id<"companies">, kind: "customers" | "recurring" | "bookings" | "properties") {
  return (await as.query(api.migration.rows, { companyId, kind, filter: "all", offset: 0, limit: 100 })).rows;
}

async function prepared() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const serviceId = await publish(as, companyId, homeSpec());
  await as.mutation(api.clients.create, { companyId, type: "person", name: "Sam Existing", kind: "home", contact: { name: "Sam Existing", email: "sam@example.com" }, property: { address: { line1: "5 Oak St", city: "Austin", region: "TX", postalCode: "78701" }, kind: "home" }, addAnyway: true });
  const migrationId = await as.mutation(api.migration.open, { companyId });
  expect(await as.mutation(api.migration.open, { companyId })).toBe(migrationId);
  await as.mutation(api.migration.save, { companyId, revision: 1, source: "jobber", wants: ["customers", "recurring", "bookings"] });
  await upload(t, as, companyId, "jobber-clients.csv", CUSTOMERS);
  await upload(t, as, companyId, "recurring.csv", RECURRING);
  await upload(t, as, companyId, "bookings.csv", BOOKINGS);
  return { t, as, companyId, serviceId, migrationId };
}

describe("A migration, end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("reads the files on the server and recognizes what each contains", async () => {
    const { as, companyId } = await prepared();
    const view = (await as.query(api.migration.view, { companyId }))!;
    expect(view.files.map((f) => [f.name, f.status, f.kind, f.rowCount])).toEqual([
      ["jobber-clients.csv", "ready", "customers", 6],
      ["recurring.csv", "ready", "recurring", 2],
      ["bookings.csv", "ready", "bookings", 5],
    ]);
    expect(view.files[0].looksLike).toBe("jobber");
    // Dates proved month/day by "3/19/2027"; nothing was guessed.
    expect(view.migration.dateInfo).toMatchObject({ inferred: "mdy", proof: "3/19/2027" });
  });

  it("refuses Excel files, oversize files and the same file twice, on the server", async () => {
    const { t, as, companyId } = await prepared();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["PK\u0003\u0004"])));
    expect(await refusal(as.mutation(api.migration.addFile, { companyId, storageId, name: "clients.xlsx" }))).toContain("CSV");
    const again = await t.run((ctx) => ctx.storage.store(new Blob([CUSTOMERS], { type: "text/csv" })));
    expect(await refusal(as.mutation(api.migration.addFile, { companyId, storageId: again, name: "copy.csv" }))).toContain("exact file");
    // A zipped file renamed .csv is still caught when it's read.
    const disguised = await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])])));
    const fileId = await as.mutation(api.migration.addFile, { companyId, storageId: disguised, name: "sneaky.csv" });
    await settle(t);
    const file = (await as.query(api.migration.view, { companyId }))!.files.find((f) => f.id === fileId)!;
    expect(file).toMatchObject({ status: "failed", problem: expect.stringContaining("not a CSV") });
  });

  it("flags duplicates, groups commercial sites for review, and imports only what the owner settled, without starting any agent work", async () => {
    const { t, as, companyId } = await prepared();
    // Services: one matched by name, two by the owner.
    const view = (await as.query(api.migration.view, { companyId }))!;
    const serviceId = view.services[0].id;
    expect(view.migration.serviceNames.find((s) => s.name === "Standard Clean")?.suggested).toBe(serviceId);
    await as.mutation(api.migration.mapService, { companyId, name: "Deep Clean", serviceId });
    await as.mutation(api.migration.mapService, { companyId, name: "Office Clean", serviceId });
    await settle(t);

    const customers = await rowsOf(as, companyId, "customers");
    const by = (id: string) => customers.find((r) => r.values.externalId === id)!;
    expect(by("101")).toMatchObject({ state: "ready", category: { value: "residential_recurring" } });
    expect(by("102")).toMatchObject({ state: "ready", category: { value: "commercial" } });
    expect(by("103").state).toBe("review");
    expect(by("103").notes.join(" ")).toContain("I've grouped them under one commercial account for your review");
    // Sam is already a client: matched, never merged.
    expect(by("104").state).toBe("duplicate");
    expect(by("104").matches[0].why).toMatch(/Same email.*name|Same name/);
    expect(by("106")).toMatchObject({ state: "error", problems: ["It has no customer or company name."] });

    // The owner decides.
    const group = (await as.query(api.migration.view, { companyId }))!.migration.groups[0];
    expect(group).toMatchObject({ name: "Harbor Dental", properties: 2, accepted: null });
    await as.mutation(api.migration.decideGroup, { companyId, key: group.key, accepted: true });
    await settle(t);
    // Once grouped, Harbor Dental has two sites;  the recurring row gives no address: Selestial doesn't pick one.
    let recurring = await rowsOf(as, companyId, "recurring");
    const r2 = recurring.find((r) => r.values.externalId === "R2")!;
    expect(r2.state).toBe("review");
    expect(r2.parent?.propertyRowId ?? r2.parent?.propertyId).toBeUndefined();

    await as.mutation(api.migration.decide, { companyId, rowIds: [by("104").id], choice: "keep_existing" });
    await as.mutation(api.migration.decide, { companyId, rowIds: [by("106").id], choice: "skip" });
    await as.mutation(api.migration.edit, { companyId, rowIds: [r2.id], field: "line1", value: "400 Congress Ave" });
    await as.mutation(api.migration.edit, { companyId, rowIds: [r2.id], field: "line2", value: "Suite 200" });
    await as.mutation(api.migration.edit, { companyId, rowIds: [r2.id], field: "postalCode", value: "78701" });
    await settle(t);
    recurring = await rowsOf(as, companyId, "recurring");
    expect(recurring.find((r) => r.values.externalId === "R2")!.state).toBe("ready");
    // The original cell is kept beside the correction.
    expect(recurring.find((r) => r.values.externalId === "R2")!.edited).toEqual(["line1", "line2", "postalCode"]);

    const bookings = await rowsOf(as, companyId, "bookings");
    const b = (id: string) => bookings.find((r) => r.values.externalId === id)!;
    expect(b("B1").parent?.planDate).toBe("2027-03-12");
    expect(b("B2").parent?.planDate).toBe("2027-03-19");
    expect(b("B4").state).toBe("skip");
    expect(b("B5").state).toBe("skip");
    expect(b("B5").notes[0]).toContain("Past visits are service history");

    // Not ready until the columns and the timezone are confirmed.
    expect(await refusal(as.mutation(api.migration.startImport, { companyId }))).toContain("timezone");
    const readiness = (await as.query(api.migration.readiness, { companyId }))!;
    expect(readiness.blockers.join(" ")).toContain("Confirm the columns");
    await confirmColumns(t, as, companyId);
    const revision = (await as.query(api.migration.view, { companyId }))!.migration.revision;
    await as.mutation(api.migration.save, { companyId, revision, timezoneConfirmed: true });

    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);

    const report = (await as.query(api.migration.report, { companyId }))!;
    const tally = Object.fromEntries(report.kinds.map((k) => [k.kind, k]));
    expect(tally.customers).toMatchObject({ source: 6, created: 4, linked: 1, skipped: 1, failed: 0, awaiting: 0, balanced: true });
    expect(tally.recurring).toMatchObject({ source: 2, created: 2, balanced: true });
    expect(tally.bookings).toMatchObject({ source: 5, created: 3, skipped: 2, balanced: true });

    const all = await t.run(async (ctx) => ({
      customers: await ctx.db.query("customers").collect(),
      properties: await ctx.db.query("properties").collect(),
      plans: await ctx.db.query("servicePlans").collect(),
      jobs: await ctx.db.query("jobs").collect(),
      permissions: await ctx.db.query("contactPermissions").collect(),
      suppressions: await ctx.db.query("suppressions").collect(),
      messages: (await ctx.db.query("messages").collect()).filter((m) => m.purpose !== "member_notice"),
      coverage: await ctx.db.query("coverageRequests").collect(),
      assignments: await ctx.db.query("assignments").collect(),
      changes: await ctx.db.query("serviceChanges").collect(),
    }));
    expect(all.customers.map((c) => c.name).sort()).toEqual(["Dana Whitfield", "Harbor Dental", "Opted Out", "Sam Existing"]);
    const harbor = all.customers.find((c) => c.name === "Harbor Dental")!;
    expect(harbor).toMatchObject({ type: "business", kind: "commercial", source: "import:jobber" });
    expect(all.properties.filter((p) => p.customerId === harbor._id).map((p) => p.address.line1).sort()).toEqual(["400 Congress Ave", "900 Lamar Blvd"]);
    // Sam's existing record was kept as it was.
    const sam = all.customers.find((c) => c.name === "Sam Existing")!;
    expect(sam.source).not.toContain("import");

    // No permission to message anyone was created; the documented opt-out was kept.
    expect(all.permissions).toEqual([]);
    expect(all.suppressions.map((s) => [s.channel, s.address, s.scope]).sort()).toEqual([["email", "optout@example.com", "all"], ["sms", "+15125550105", "all"]]);

    // Plans set up and held, with no typed price; their imported prices wait for the Owner's approval.
    expect(all.plans.map((p) => [p.state, p.cadence, p.priceCents, p.migration?.held])).toEqual([
      ["setup", "every_7_days", null, true],
      ["setup", "every_14_days", null, true],
    ]);
    expect(all.changes.filter((c) => c.kind === "property_price").map((c) => [c.state, c.propertyPrice?.baseCents]).sort()).toEqual([["in_review", 14000], ["in_review", 22000]]);

    // Visits held: one per booking, linked to its plan; Dispatch leaves them alone; nothing was sent.
    expect(all.jobs).toHaveLength(3);
    expect(all.jobs.every((j) => j.migration?.held)).toBe(true);
    const b1 = all.jobs.find((j) => j.planDate === "2027-03-12")!;
    expect(b1.planId).toBe(all.plans[0]._id);
    expect(new Date(b1.startsAt).toISOString()).toBe("2027-03-12T15:00:00.000Z");
    for (const job of all.jobs) await t.mutation(internal.dispatch.cover, { jobId: job._id });
    await t.mutation(internal.servicePlans.bookAll, {});
    await settle(t);
    const after = await t.run(async (ctx) => ({ coverage: await ctx.db.query("coverageRequests").collect(), assignments: await ctx.db.query("assignments").collect(), messages: (await ctx.db.query("messages").collect()).filter((m) => m.purpose !== "member_notice"), jobs: await ctx.db.query("jobs").collect() }));
    expect(after.coverage).toEqual([]);
    expect(after.assignments).toEqual([]);
    expect(after.messages).toEqual([]);
    expect(after.jobs).toHaveLength(3);

    // In-app notice for the Owner.
    const notices = await t.run((ctx) => ctx.db.query("memberNotices").collect());
    expect(notices.map((n) => n.headline)).toContain("Your import is ready to review");

    // Running it again writes nothing new.
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("customers").collect()).length)).toBe(4);
    expect(await t.run(async (ctx) => (await ctx.db.query("jobs").collect()).length)).toBe(3);

    // The same export uploaded again finds what it imported: matched, not copied.
    await as.mutation(api.migration.reopen, { companyId });
    await upload(t, as, companyId, "jobber-clients-again.csv", `${CUSTOMERS}\n`);
    await confirmColumns(t, as, companyId);
    const fresh = (await rowsOf(as, companyId, "customers")).filter((r) => !r.result);
    expect(fresh.filter((r) => r.values.externalId && r.values.externalId !== "106").every((r) => r.state === "update")).toBe(true);
    await as.mutation(api.migration.decide, { companyId, rowIds: fresh.filter((r) => r.state === "error").map((r) => r.id), choice: "skip" });
    await settle(t);
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    expect(await t.run(async (ctx) => (await ctx.db.query("customers").collect()).length)).toBe(4);
    expect(await t.run(async (ctx) => (await ctx.db.query("properties").collect()).length)).toBe(5);

    // The Owner releases the schedule: visits go to Dispatch, and plans start booking ahead without doubling imported days.
    await as.mutation(api.migration.release, { companyId, confirm: true, visits: true, plans: true, team: true });
    await settle(t);
    const released = await t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), plans: await ctx.db.query("servicePlans").collect() }));
    expect(released.plans.every((p) => p.state === "active" && p.migration?.held === false)).toBe(true);
    const weekly = released.jobs.filter((j) => j.planId === released.plans[0]._id).map((j) => j.planDate);
    expect(new Set(weekly).size).toBe(weekly.length);
    expect(weekly).toContain("2027-03-12");
  });

  it("keeps the release for the Owner", async () => {
    const { t, as, companyId } = await prepared();
    const manager = await addMember(t, as, companyId, "mgr", "manager");
    const office = await addMember(t, as, companyId, "desk", "office");
    expect(await refusal(office.query(api.migration.view, { companyId }))).toBe("Not allowed.");
    expect(await refusal(manager.mutation(api.migration.release, { companyId, confirm: true, visits: true, plans: true, team: false }))).toBe("Not allowed.");
  });

  it("picks an interrupted import up from its checkpoint, without writing anything twice", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-b", "Beta Cleaning");
    await as.mutation(api.migration.open, { companyId });
    const many = ["Customer ID,First Name,Last Name,Email", ...Array.from({ length: 95 }, (_, i) => `C${i},Person,Number${i},p${i}@example.com`)].join("\n");
    await upload(t, as, companyId, "customers.csv", many);
    await confirmColumns(t, as, companyId);
    await as.mutation(api.migration.startImport, { companyId });
    // The worker dies after the first batch: its lease runs out, and the sweep resumes it. A late duplicate step is harmless.
    await t.finishInProgressScheduledFunctions();
    await t.run(async (ctx) => {
      const run = (await ctx.db.query("migrationRuns").first())!;
      await ctx.db.patch(run._id, { leaseUntil: 0 });
    });
    await t.mutation(internal.migration.sweep, {});
    await settle(t);
    const customers = await t.run((ctx) => ctx.db.query("customers").collect());
    expect(customers).toHaveLength(95);
    expect(new Set(customers.map((c) => c.email)).size).toBe(95);
    const run = await t.run(async (ctx) => (await ctx.db.query("migrationRuns").first())!);
    expect(run).toMatchObject({ status: "done", counts: { created: 95, failed: 0 } });
  });

  it("keeps each company's migration to itself", async () => {
    const { t, as, companyId } = await prepared();
    const other = await company(t, "owner-z", "Zeta Cleaning");
    await other.as.mutation(api.migration.open, { companyId: other.companyId });
    const rowId = (await rowsOf(as, companyId, "customers"))[0].id;
    expect(await refusal(other.as.mutation(api.migration.decide, { companyId: other.companyId, rowIds: [rowId], choice: "skip" }))).toBe("Not found.");
    expect(await refusal(other.as.query(api.migration.view, { companyId }))).toBe("Not found.");
    expect((await other.as.query(api.migration.rows, { companyId: other.companyId, kind: "customers", filter: "all", offset: 0, limit: 10 })).total).toBe(0);
  });
});

// ── Phase 5: team, history, balances, consent, assisted migration ────────────────────────────────────

describe("More records: rules", () => {
  it("never guesses employment status, and reads availability only when it's clear", () => {
    expect(parseEngagement("W-2 employee")).toEqual({ engagement: "employee" });
    expect(parseEngagement("1099")).toEqual({ engagement: "contractor" });
    expect(parseEngagement("Subcontractor")).toEqual({ engagement: "subcontractor" });
    expect(parseEngagement("Cleaner")).toMatchObject({ error: expect.stringContaining("Choose one") });
    expect(parseEngagement("")).toMatchObject({ error: expect.stringContaining("doesn't guess") });
    expect(parseAvailability("Mon-Fri 8am-4pm")).toEqual([1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 960 })));
    expect(parseAvailability("Sat 9:00-13:00; Sun 10am-2pm")).toEqual([{ weekday: 6, startMinute: 540, endMinute: 780 }, { weekday: 0, startMinute: 600, endMinute: 840 }]);
    expect(parseAvailability("mornings mostly")).toBeNull();
    expect(parseAvailability("")).toEqual([]);
  });
});

const TEAM = `Employee ID,First Name,Last Name,Email,Phone,Worker Type,Skills,Service Areas,Availability,Status
E1,Maria,Lopez,maria@example.com,512-555-0177,W-2 Employee,deep clean|move out,"78701, 78703",Mon-Fri 8am-4pm,Active
E2,Jo,Park,jo@example.com,512-555-0178,,windows,78701,mornings mostly,Active
E3,Old,Hand,old@example.com,512-555-0179,1099,,,,Terminated
`;

const HISTORY = `Visit ID,Customer ID,Service,Completed Date,Price,Cleaner,Status
H1,101,Standard Clean,2027-02-12,$140.00,Maria,Completed
H2,101,Standard Clean,2027-02-19,$140.00,Maria,Completed
H3,101,Standard Clean,2027-04-02,$140.00,Maria,Completed
`;

const BALANCES = `Invoice #,Customer ID,Balance Due,Invoice Date,Due Date
INV-9,101,$140.00,2027-02-12,2027-02-26
INV-10,101,$280.00,2027-02-19,2027-03-05
INV-10,101,$280.00,2027-02-19,2027-03-05
INV-11,102,$0.00,2027-02-20,2027-03-06
`;

const CONSENT = `Customer ID,First Name,Last Name,Email,Phone,SMS Opt Out,Marketing Opt Out,SMS Consent
201,Text,Stopper,ts@example.com,512-555-0201,Yes,,
202,Promo,Avoider,pa@example.com,512-555-0202,,Unsubscribed,
203,Said,Yes,sy@example.com,512-555-0203,,,Opted in 2024-05-01 via booking form
`;

describe("More records, end to end", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("adds the team as onboarding and held, keeps history read-only and balances as reference, and keeps consent scope", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-c", "Gamma Cleaning");
    await as.mutation(api.migration.open, { companyId });
    await as.mutation(api.migration.save, { companyId, revision: 1, source: "jobber" });
    await upload(t, as, companyId, "clients.csv", CUSTOMERS);
    await upload(t, as, companyId, "team.csv", TEAM);
    await upload(t, as, companyId, "history.csv", HISTORY);
    await upload(t, as, companyId, "balances.csv", BALANCES);
    await upload(t, as, companyId, "consent.csv", CONSENT);
    const view = (await as.query(api.migration.view, { companyId }))!;
    expect(view.files.map((f) => f.kind)).toEqual(["customers", "cleaners", "history", "balances", "customers"]);

    const team = (await as.query(api.migration.rows, { companyId, kind: "cleaners", filter: "all", offset: 0, limit: 10 })).rows;
    const person = (id: string) => team.find((r) => r.values.externalId === id)!;
    expect(person("E1").state).toBe("ready");
    expect(person("E2")).toMatchObject({ state: "error", problems: [expect.stringContaining("doesn't guess")] });
    expect(person("E2").notes.join(" ")).toContain("couldn't read the availability");
    expect(person("E3").state).toBe("skip");

    const history = (await as.query(api.migration.rows, { companyId, kind: "history", filter: "all", offset: 0, limit: 10 })).rows;
    expect(history.find((r) => r.values.externalId === "H3")).toMatchObject({ state: "skip" });
    const balances = (await as.query(api.migration.rows, { companyId, kind: "balances", filter: "all", offset: 0, limit: 10 })).rows;
    expect(balances.map((r) => r.state)).toEqual(["ready", "ready", "duplicate", "skip"]);
    expect((await as.query(api.migration.view, { companyId }))!.migration.notes.map((n) => n.words).join(" ")).toContain("not a running total");

    // The owner fills in Jo's employment status; skips the duplicate balance, the empty customer row and Harbor's second site question.
    await as.mutation(api.migration.edit, { companyId, rowIds: [person("E2").id], field: "engagement", value: "Contractor" });
    await as.mutation(api.migration.decide, { companyId, rowIds: [balances[2].id], choice: "skip" });
    const clients = (await as.query(api.migration.rows, { companyId, kind: "customers", filter: "all", offset: 0, limit: 20 })).rows;
    await as.mutation(api.migration.decide, { companyId, rowIds: clients.filter((r) => r.state === "error" || r.state === "review").map((r) => r.id).slice(0, 1), choice: "skip" });
    await as.mutation(api.migration.decide, { companyId, rowIds: clients.filter((r) => r.state === "review").map((r) => r.id), choice: "skip" });
    await settle(t);
    await confirmColumns(t, as, companyId);
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);

    const all = await t.run(async (ctx) => ({
      cleaners: await ctx.db.query("cleaners").collect(),
      windows: await ctx.db.query("availabilityWindows").collect(),
      history: await ctx.db.query("importedHistory").collect(),
      balances: await ctx.db.query("openingBalances").collect(),
      invoices: await ctx.db.query("invoices").collect(),
      jobs: await ctx.db.query("jobs").collect(),
      followUps: await ctx.db.query("followUps").collect(),
      suppressions: await ctx.db.query("suppressions").collect(),
      permissions: await ctx.db.query("contactPermissions").collect(),
      customers: await ctx.db.query("customers").collect(),
      invitations: await ctx.db.query("invitations").collect(),
    }));
    expect(all.cleaners.map((c) => [c.name, c.engagement, c.status, c.migration?.held]).sort()).toEqual([["Jo Park", "contractor", "onboarding", true], ["Maria Lopez", "employee", "onboarding", true]]);
    expect(all.windows).toHaveLength(5);
    // History is read-only: no jobs, no invoices.
    expect(all.history.map((h) => h.day).sort()).toEqual(["2027-02-12", "2027-02-19"]);
    expect(all.jobs).toEqual([]);
    expect(all.invoices).toEqual([]);
    // Balances are reference only, once per old invoice.
    expect(all.balances.map((b) => [b.reference, b.amountCents]).sort()).toEqual([["INV-10", 28000], ["INV-9", 14000]]);
    // Consent scope: a texts-only stop, a marketing-only stop, and a recorded consent kept as a note, never a permission.
    expect(all.permissions).toEqual([]);
    const stops = all.suppressions.map((x) => [x.channel, x.address, x.scope]).sort();
    expect(stops).toEqual([["email", "pa@example.com", "marketing"], ["email", "optout@example.com", "all"], ["sms", "+15125550105", "all"], ["sms", "+15125550201", "all"], ["sms", "+15125550202", "marketing"]].sort());
    expect(all.customers.find((c) => c.name === "Said Yes")?.privateNotes).toContain("doesn't treat it as permission");
    expect(all.invitations.filter((i) => i.email.includes("maria"))).toEqual([]);

    // Held cleaners get no onboarding follow-up until the team is released.
    await t.mutation(internal.cleanerFollowUps.sweep, {});
    expect((await t.run((ctx) => ctx.db.query("followUps").collect())).length).toBe(all.followUps.length);
    const report = (await as.query(api.migration.report, { companyId }))!;
    expect(report.held.cleaners).toBe(2);
    expect(report.kinds.every((k) => k.balanced)).toBe(true);
    await as.mutation(api.migration.release, { companyId, confirm: true, visits: false, plans: false, team: true });
    await settle(t);
    expect((await t.run((ctx) => ctx.db.query("cleaners").collect())).every((c) => c.migration?.held === false && c.status === "onboarding")).toBe(true);

    // On the client: history for everyone in the company, balances for the Owner.
    const dana = all.customers.find((c) => c.name === "Dana Whitfield")!;
    expect((await as.query(api.migration.clientHistory, { companyId, customerId: dana._id })).map((h) => h.day)).toEqual(["2027-02-19", "2027-02-12"]);
    expect((await as.query(api.migration.clientBalances, { companyId, customerId: dana._id })).totalCents).toBe(42000);
  });
});

describe("Assisted migration", () => {
  const admin = { subject: "user_support_admin", email: "support@selestial.example", emailVerified: true, name: "Sam Support", fva: [1, 1] };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.STAFF_BOOTSTRAP_EMAIL = admin.email;
    process.env.SUPPORT_ACCESS = "on";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
    delete process.env.SUPPORT_ACCESS;
  });

  it("lets staff prepare with the owner's permission, attributed to them, while the owner imports and releases", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-d", "Delta Cleaning");
    const staff = t.withIdentity(admin);
    const supportSessionId = await staff.mutation(api.support.start, { companyId, reason: "Assisted migration from Jobber" });
    // View mode can read but not prepare.
    expect(await refusal(staff.mutation(api.migration.open, { companyId, supportSessionId }))).toContain("view only");
    await owner.mutation(api.support.grantManage, { companyId, hours: 4 });
    await staff.mutation(api.support.switchToManage, { sessionId: supportSessionId, reason: "Prepare the migration with the owner" });
    await staff.mutation(api.migration.open, { companyId, supportSessionId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([CUSTOMERS], { type: "text/csv" })));
    await staff.mutation(api.migration.addFile, { companyId, supportSessionId, storageId, name: "clients.csv" });
    await settle(t);
    const rows = (await staff.query(api.migration.rows, { companyId, supportSessionId, kind: "customers", filter: "all", offset: 0, limit: 20 })).rows;
    const empty = rows.find((r) => r.state === "error")!;
    const sam = rows.find((r) => r.values.externalId === "104")!;
    await staff.mutation(api.migration.decide, { companyId, supportSessionId, rowIds: [empty.id], choice: "skip" });
    await staff.mutation(api.migration.askOwner, { companyId, supportSessionId, rowIds: [sam.id], text: "Is Sam Existing the same person as your current client?" });
    await settle(t);

    // The owner sees the question and who decided what, as Selestial Support.
    const mine = (await owner.query(api.migration.rows, { companyId, kind: "customers", filter: "questions", offset: 0, limit: 20 })).rows;
    expect(mine.map((r) => r.question?.text)).toEqual(["Is Sam Existing the same person as your current client?"]);
    const skipped = (await owner.query(api.migration.rows, { companyId, kind: "customers", filter: "skip", offset: 0, limit: 20 })).rows;
    expect(skipped[0].decision).toMatchObject({ choice: "skip", bySupport: true });
    const view = (await owner.query(api.migration.view, { companyId }))!;
    expect(view.migration.assisted).toHaveLength(1);
    expect(view.migration.summary.customers.questions).toBe(1);
    // The record keeps the actual staff member; the session log shows each change.
    const stored = await t.run(async (ctx) => (await ctx.db.get(empty.id))!);
    expect(stored.decision?.staff?.staffId).toBeTruthy();
    const events = await t.run((ctx) => ctx.db.query("supportEvents").collect());
    expect(events.filter((e) => e.kind === "change").map((e) => e.summary)).toEqual(expect.arrayContaining(["added a file to the migration", "decided records in the migration", "asked the owner about records in the migration"]));

    // Staff can't import or release: the owner does.
    expect(await refusal(staff.mutation(api.migration.startImport, { companyId, supportSessionId }))).toContain("support session can't");
    expect(await refusal(staff.mutation(api.migration.release, { companyId, supportSessionId, confirm: true, visits: true, plans: true, team: true }))).toContain("support session can't");
    // Answering the question as the owner clears it.
    await owner.mutation(api.migration.decide, { companyId, rowIds: [sam.id], choice: "skip" });
    await settle(t);
    expect((await owner.query(api.migration.rows, { companyId, kind: "customers", filter: "questions", offset: 0, limit: 20 })).total).toBe(0);
  });
});

// ── Phase 6: undo, activation review, completion email ───────────────────────────────────────────────

describe("Undo, activation review and the completion email", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  async function imported() {
    const { t, as, companyId, migrationId } = await prepared();
    const view = (await as.query(api.migration.view, { companyId }))!;
    const serviceId = view.services[0].id;
    await as.mutation(api.migration.mapService, { companyId, name: "Deep Clean", serviceId });
    await as.mutation(api.migration.mapService, { companyId, name: "Office Clean", serviceId });
    await settle(t);
    const customers = await rowsOf(as, companyId, "customers");
    const by = (id: string) => customers.find((r) => r.values.externalId === id)!;
    const group = (await as.query(api.migration.view, { companyId }))!.migration.groups[0];
    await as.mutation(api.migration.decideGroup, { companyId, key: group.key, accepted: true });
    await as.mutation(api.migration.decide, { companyId, rowIds: [by("104").id], choice: "keep_existing" });
    await as.mutation(api.migration.decide, { companyId, rowIds: [by("106").id], choice: "skip" });
    await settle(t);
    const r2 = (await rowsOf(as, companyId, "recurring")).find((r) => r.values.externalId === "R2")!;
    for (const [field, value] of [["line1", "400 Congress Ave"], ["line2", "Suite 200"], ["postalCode", "78701"]]) await as.mutation(api.migration.edit, { companyId, rowIds: [r2.id], field, value });
    await settle(t);
    await confirmColumns(t, as, companyId);
    const revision = (await as.query(api.migration.view, { companyId }))!.migration.revision;
    await as.mutation(api.migration.save, { companyId, revision, timezoneConfirmed: true });
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    return { t, as, companyId, migrationId };
  }

  it("emails the Owner a branded completion notice through the notice router", async () => {
    const { t } = await imported();
    const notices = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.notice?.event === "migration_complete"));
    expect(notices).toHaveLength(1);
    expect(notices[0].to).toBe("owner-a@example.com");
  });

  it("reviews each workflow before release, then releases only what the Owner chose", async () => {
    const { t, as, companyId } = await imported();
    const review = (await as.query(api.migration.activationReview, { companyId }))!;
    const flow = Object.fromEntries(review.workflows.map((w) => [w.id, w]));
    expect(flow.visits).toMatchObject({ count: 3, messages: 3 });
    expect(flow.visits.missing.join(" ")).toContain("No cleaner is active");
    expect(flow.plans.count).toBe(2);
    expect(flow.plans.approvals.join(" ")).toContain("waiting for your approval");
    expect(flow.team.count).toBe(0);
    expect(review.untouched.join(" ")).toContain("Customers aren't messaged");
    // Plans only: visits stay held, so Dispatch still leaves the imported ones alone.
    await as.mutation(api.migration.release, { companyId, confirm: true, visits: false, plans: true, team: false });
    await settle(t);
    const after = await t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), plans: await ctx.db.query("servicePlans").collect() }));
    expect(after.plans.every((p) => p.state === "active")).toBe(true);
    const importedVisits = after.jobs.filter((j) => j.migration);
    expect(importedVisits.every((j) => j.migration?.held)).toBe(true);
    expect((await as.query(api.migration.activationReview, { companyId }))!.workflows.find((w) => w.id === "plans")!.released).not.toBeNull();
  });

  it("undoes untouched records, keeps touched or pre-existing ones with the reason, and never lifts an opt-out", async () => {
    const { t, as, companyId } = await imported();
    // The owner edits Dana after the import: she stays, with everything she owns.
    const dana = await t.run(async (ctx) => (await ctx.db.query("customers").collect()).find((c) => c.name === "Dana Whitfield")!);
    await t.run((ctx) => ctx.db.patch(dana._id, { revision: 2 }));
    const preview = (await as.query(api.migration.undoPreview, { companyId }))!;
    expect(preview.canUndo).toBe(true);
    expect(preview.kinds.customers.kept.map((k) => [k.name, k.reason])).toEqual([["Dana Whitfield", "It was edited after the import."]]);
    expect(preview.kinds.customers.undoable).toBe(2);
    // Managers can look but not undo; the import isn't undone by a manager.
    const manager = await addMember(t, as, companyId, "mgr2", "manager");
    expect(await refusal(manager.mutation(api.migration.undo, { companyId, confirm: true, kinds: ["customers"] }))).toBe("Not allowed.");

    await as.mutation(api.migration.undo, { companyId, confirm: true, kinds: ["customers"] });
    await settle(t);
    const left = await t.run(async (ctx) => ({
      customers: (await ctx.db.query("customers").collect()).map((c) => c.name).sort(),
      jobs: await ctx.db.query("jobs").collect(),
      plans: await ctx.db.query("servicePlans").collect(),
      suppressions: await ctx.db.query("suppressions").collect(),
      changes: (await ctx.db.query("serviceChanges").collect()).filter((c) => c.kind === "property_price"),
      views: await ctx.db.query("clientViews").collect(),
    }));
    // Sam was matched, not created: never undone. Dana was edited: kept. Harbor Dental and Opted Out are gone.
    expect(left.customers).toEqual(["Dana Whitfield", "Sam Existing"]);
    expect(left.views.every((v) => left.customers.length >= 1 && v.customerId)).toBe(true);
    // Each record is judged on its own: Dana's imported plan and visits were untouched, so they go even though she stays.
    // Their price proposals are withdrawn with them.
    expect(left.plans).toEqual([]);
    expect(left.jobs).toEqual([]);
    expect(left.changes.map((c) => c.state)).toEqual(["withdrawn", "withdrawn"]);
    // The opt-out from the file stays in force.
    expect(left.suppressions.map((s) => s.address).sort()).toEqual(["+15125550105", "optout@example.com"]);
    const report = (await as.query(api.migration.report, { companyId }))!;
    const customers = report.kinds.find((k) => k.kind === "customers")!;
    expect(customers).toMatchObject({ balanced: true });
    expect(customers.undone).toBe(3);
    expect(report.kinds.find((k) => k.kind === "bookings")).toMatchObject({ undone: 3, balanced: true });
    expect(report.problems.some((p) => p.outcome === "Kept by undo" && p.name === "Dana Whitfield")).toBe(true);
    // Importing again doesn't bring undone rows back on its own.
    await as.mutation(api.migration.reopen, { companyId });
    await settle(t);
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    expect((await t.run((ctx) => ctx.db.query("customers").collect())).length).toBe(2);
  });

  it("keeps a visit already released to Dispatch, and flags an appointment the quick setup import already brought in", async () => {
    const { t, as, companyId } = await imported();
    await as.mutation(api.migration.release, { companyId, confirm: true, visits: true, plans: false, team: false });
    await settle(t);
    const preview = (await as.query(api.migration.undoPreview, { companyId }))!;
    expect(preview.kinds.bookings.undoable).toBe(0);
    expect(preview.kinds.bookings.kept[0].reason).toContain("released to Dispatch");
    // Customers with released visits stay too.
    expect(preview.kinds.customers.kept.map((k) => k.reason).join(" ")).toContain("visits can't be undone");

    // The quick importer's waiting appointment for Sam on March 10 makes the guided booking for that day a possible duplicate.
    const sam = await t.run(async (ctx) => (await ctx.db.query("customers").collect()).find((c) => c.name === "Sam Existing")!);
    const owner = await t.run(async (ctx) => (await ctx.db.query("members").collect())[0]);
    await t.run(async (ctx) => {
      const runId = await ctx.db.insert("migrationImportRuns", { companyId, importKey: "quick-1", kind: "appointment", source: "csv", label: "Quick", results: [], created: 1, skipped: 0, failed: 0, by: owner._id, createdAt: Date.now() });
      await ctx.db.insert("migrationRecords", { companyId, customerId: sam._id, kind: "appointment", source: "csv", key: "q1", day: "2027-03-17", review: "review", runId, createdAt: Date.now() });
    });
    await as.mutation(api.migration.reopen, { companyId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["Booking ID,Customer ID,Service,Date,Start Time,Price\nB9,104,Deep Clean,2027-03-17,1:00 PM,$300\n"], { type: "text/csv" })));
    await as.mutation(api.migration.addFile, { companyId, storageId, name: "more-bookings.csv" });
    await settle(t);
    const b9 = (await rowsOf(as, companyId, "bookings")).find((r) => r.values.externalId === "B9")!;
    expect(b9.state).toBe("duplicate");
    expect(b9.matches.map((m) => m.why).join(" ")).toContain("quick import in setup");
  });
});

// ── Phase 7: the rest of the brief's checklist ───────────────────────────────────────────────────────

describe("Phase 7: assignments, partial failures, recurrence conflicts, households, ambiguous dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  async function start7(files: [string, string][]) {
    const t = start();
    const { as, companyId } = await company(t, "owner-7", "Seven Cleaning");
    const serviceId = await publish(as, companyId, homeSpec());
    await as.mutation(api.migration.open, { companyId });
    await as.mutation(api.migration.save, { companyId, revision: 1, source: "spreadsheet" });
    for (const [name, csv] of files) await upload(t, as, companyId, name, csv);
    return { t, as, companyId, serviceId };
  }
  async function ready(t: T, as: As, companyId: Id<"companies">) {
    await confirmColumns(t, as, companyId);
    const revision = (await as.query(api.migration.view, { companyId }))!.migration.revision;
    await as.mutation(api.migration.save, { companyId, revision, timezoneConfirmed: true });
    await settle(t);
  }

  it("matches the old system's cleaner, flags double-bookings, time off their hours and unknown names, and keeps the match as preferred", async () => {
    const clients = "Customer ID,First Name,Last Name,Email,Street,City,State,Zip\nA1,Ann,Lee,ann@example.com,1 Oak St,Austin,TX,78701\nA2,Bo,Diaz,bo@example.com,2 Oak St,Austin,TX,78701\n";
    const team = "Employee ID,First Name,Last Name,Email,Phone,Worker Type,Availability\nE1,Maria,Lopez,maria@example.com,512-555-0177,Employee,Mon-Fri 8am-4pm\n";
    const visits = [
      "Booking ID,Customer ID,Service,Date,Start Time,End Time,Cleaner",
      "V1,A1,Standard clean,2027-03-03,9:00 AM,11:00 AM,Maria",
      "V2,A2,Standard clean,2027-03-03,10:00 AM,12:00 PM,Maria Lopez",
      "V3,A1,Standard clean,2027-03-06,9:00 AM,11:00 AM,Maria Lopez",
      "V4,A2,Standard clean,2027-03-10,9:00 AM,11:00 AM,Zed",
    ].join("\n");
    const { t, as, companyId } = await start7([["clients.csv", clients], ["team.csv", team], ["visits.csv", visits]]);
    const rows = await rowsOf(as, companyId, "bookings");
    const v = (id: string) => rows.find((r) => r.values.externalId === id)!;
    expect(v("V1").notes.join(" ")).toContain('Maria Lopez (matched from "Maria") is kept as the preferred cleaner');
    expect(v("V1").notes.join(" ")).toContain("also down for row 3");
    expect(v("V2").notes.join(" ")).toContain("also down for row 2");
    expect(v("V3").notes.join(" ")).toContain("outside Maria Lopez's availability: Saturday");
    expect(v("V4").notes.join(" ")).toContain("no one by that name is on your team");
    expect((await as.query(api.migration.view, { companyId }))!.migration.notes.map((n) => n.words).join(" ")).toContain("double-booked");
    // Flags don't block: every visit is still ready.
    expect(rows.map((r) => r.state)).toEqual(["ready", "ready", "ready", "ready"]);
    await ready(t, as, companyId);
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    const state = await t.run(async (ctx) => ({ maria: (await ctx.db.query("cleaners").collect())[0], jobs: await ctx.db.query("jobs").collect(), assignments: await ctx.db.query("assignments").collect() }));
    expect(state.jobs.filter((j) => j.preferredCleanerIds?.[0] === state.maria._id)).toHaveLength(3);
    expect(state.jobs.find((j) => !j.preferredCleanerIds)).toBeTruthy();
    // Nothing is assigned.
    expect(state.assignments).toEqual([]);
  });

  it("asks a qualifying preferred cleaner first, and never lets the preference bypass a check", async () => {
    const { rankCleaners } = await import("./lib/dispatch/eligibility");
    const base = { status: "ready" as const, skills: [], serviceAreas: ["78701"], windows: [{ weekday: 3, startMinute: 0, endMinute: 24 * 60 }], timeOff: [], held: [], blocking: [], ended: null, pay: { ok: true as const } };
    const job = { span: { startsAt: Date.UTC(2027, 2, 3, 15), endsAt: Date.UTC(2027, 2, 3, 17) }, requiredSkills: [], postalCode: "78701", timezone: "America/Chicago", travelBufferMinutes: 0 };
    const cleaners = [
      { ...base, id: "veteran", name: "Vera", priorVisitsForCustomer: 9 },
      { ...base, id: "usual", name: "Uma", priorVisitsForCustomer: 0 },
      { ...base, id: "away", name: "Ava", priorVisitsForCustomer: 0, serviceAreas: ["99999"] },
    ] as unknown as Parameters<typeof rankCleaners>[0];
    expect(rankCleaners(cleaners, job).candidates.map((c) => c.cleanerId)).toEqual(["veteran", "usual"]);
    const preferred = rankCleaners(cleaners, { ...job, preferredCleanerIds: ["usual", "away"] });
    expect(preferred.candidates.map((c) => c.cleanerId)).toEqual(["usual", "veteran"]);
    expect(preferred.candidates[0].reasons[0]).toBe("is this customer's usual cleaner");
    // Out of area stays excluded even though preferred.
    expect(preferred.excluded.map((e) => e.cleanerId)).toEqual(["away"]);
  });

  it("fails only the rows that can't be written, keeps the rest, and lets the owner import them again once fixed", async () => {
    const clients = "Customer ID,First Name,Last Name,Email,Street,City,State,Zip\nA1,Ann,Lee,ann@example.com,1 Oak St,Austin,TX,78701\n";
    const visits = "Booking ID,Customer ID,Service,Date,Start Time,End Time\nV1,A1,Standard clean,2027-03-03,9:00 AM,11:00 AM\nV2,A1,Standard clean,2027-03-04,9:00 AM,11:00 AM\n";
    const { t, as, companyId, serviceId } = await start7([["clients.csv", clients], ["visits.csv", visits]]);
    await ready(t, as, companyId);
    // The service is archived after the check: the visits can't be written, the customer still can.
    await t.run((ctx) => ctx.db.patch(serviceId, { status: "archived" }));
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    let report = (await as.query(api.migration.report, { companyId }))!;
    expect(report.kinds.find((k) => k.kind === "customers")).toMatchObject({ created: 1, balanced: true });
    expect(report.kinds.find((k) => k.kind === "bookings")).toMatchObject({ failed: 2, created: 0, balanced: true });
    expect(report.problems.filter((p) => p.outcome === "Failed").map((p) => p.reason)).toEqual([expect.stringContaining("isn't live"), expect.stringContaining("isn't live")]);
    // Fixed: the service is live again; the owner decides the failed rows again and imports.
    await t.run((ctx) => ctx.db.patch(serviceId, { status: "active" }));
    await as.mutation(api.migration.reopen, { companyId });
    await as.mutation(api.migration.recheck, { companyId });
    await settle(t);
    const failed = (await as.query(api.migration.rows, { companyId, kind: "bookings", filter: "failed", offset: 0, limit: 10 })).rows;
    await as.mutation(api.migration.decide, { companyId, rowIds: failed.map((r) => r.id), choice: "create" });
    await settle(t);
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    report = (await as.query(api.migration.report, { companyId }))!;
    expect(report.kinds.find((k) => k.kind === "bookings")).toMatchObject({ failed: 0, created: 2, balanced: true });
    expect(await t.run(async (ctx) => (await ctx.db.query("customers").collect()).length)).toBe(1);
  });

  it("reconciles bookings with recurring series: one booking per series day, moved visits stand for their day", async () => {
    const clients = "Customer ID,First Name,Last Name,Email,Street,City,State,Zip\nA1,Ann,Lee,ann@example.com,1 Oak St,Austin,TX,78701\n";
    const recurring = "Recurring ID,Customer ID,Service,Frequency,Next Visit,Start Time,Duration\nR1,A1,Standard clean,Every 2 weeks,2027-03-03,9:00 AM,2 hours\n";
    const visits = [
      "Booking ID,Customer ID,Service,Date,Start Time,End Time,Recurring ID",
      "V1,A1,Standard clean,2027-03-03,9:00 AM,11:00 AM,R1",
      "V2,A1,Standard clean,2027-03-03,1:00 PM,3:00 PM,R1",
      "V3,A1,Standard clean,2027-03-18,9:00 AM,11:00 AM,R1",
      "V4,A1,Standard clean,2027-03-24,9:00 AM,11:00 AM,R1",
    ].join("\n");
    const { t, as, companyId } = await start7([["clients.csv", clients], ["recurring.csv", recurring], ["visits.csv", visits]]);
    const rows = await rowsOf(as, companyId, "bookings");
    const v = (id: string) => rows.find((r) => r.values.externalId === id)!;
    expect(v("V1").parent?.planDate).toBe("2027-03-03");
    // A second booking claiming the same series day is a duplicate, not a second plan visit.
    expect(v("V2").state).toBe("duplicate");
    // Moved by a day: it stands for the March 17 visit, so the plan won't book the 17th too.
    expect(v("V3").parent?.planDate).toBe("2027-03-17");
    expect(v("V3").notes.join(" ")).toContain("moved visit");
    // Not near a series day: a separate visit, and it says so.
    expect(v("V4").parent?.planDate).toBeUndefined();
    expect(v("V4").notes.join(" ")).toContain("isn't near one of its visits");
    await as.mutation(api.migration.decide, { companyId, rowIds: [v("V2").id], choice: "skip" });
    await ready(t, as, companyId);
    await as.mutation(api.migration.startImport, { companyId });
    await settle(t);
    await as.mutation(api.migration.release, { companyId, confirm: true, visits: false, plans: true, team: false });
    await settle(t);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").collect());
    const days = jobs.filter((j) => j.planDate).map((j) => j.planDate!).sort();
    expect(new Set(days).size).toBe(days.length);
    expect(days).toContain("2027-03-17");
  });

  it("never merges a household on a shared email, and waits for the owner on ambiguous dates", async () => {
    const t0 = start();
    const { as, companyId } = await company(t0, "owner-8", "Eight Cleaning");
    await publish(as, companyId, homeSpec());
    await as.mutation(api.clients.create, { companyId, type: "person", name: "Pat Rivera", kind: "home", contact: { name: "Pat Rivera", email: "rivera.family@example.com" }, addAnyway: true });
    await as.mutation(api.migration.open, { companyId });
    await upload(t0, as, companyId, "clients.csv", "Customer ID,First Name,Last Name,Email\nH1,Sam,Rivera,rivera.family@example.com\n");
    await upload(t0, as, companyId, "visits.csv", "Booking ID,Customer ID,Service,Date,Start Time\nV1,H1,Standard clean,03/04/2027,9:00 AM\n");
    const sam = (await rowsOf(as, companyId, "customers"))[0];
    expect(sam.state).toBe("duplicate");
    expect(sam.matches[0].why).toBe("Same email");
    expect(sam.notes.join(" ")).toContain("household member");
    // 03/04/2027 has no proof either way: the row waits, and nothing guesses.
    let visit = (await rowsOf(as, companyId, "bookings"))[0];
    expect(visit.state).toBe("error");
    expect(visit.problems.join(" ")).toContain("Choose how your dates are written");
    const revision = (await as.query(api.migration.view, { companyId }))!.migration.revision;
    await as.mutation(api.migration.save, { companyId, revision, dateOrder: "dmy" });
    await settle(t0);
    visit = (await rowsOf(as, companyId, "bookings"))[0];
    expect(visit.parsed.day).toBe("2027-04-03");
  });
});
