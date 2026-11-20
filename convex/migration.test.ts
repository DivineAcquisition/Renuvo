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
import { dateOrderOf, guessKind, guessMapping, isOptOut, parseCents, parseDay, parseFrequency, parseMinutes, parseTime, suggestCategory } from "./lib/migration/rules";
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
    await as.mutation(api.migration.release, { companyId, confirm: true });
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
    expect(await refusal(manager.mutation(api.migration.release, { companyId, confirm: true }))).toBe("Not allowed.");
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
