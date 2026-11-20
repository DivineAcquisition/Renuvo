/**
 * @vitest-environment edge-runtime
 *
 * Importing appointments, recurring service and history: each row matched to one client or held back,
 * imported once however often a batch is sent, and nothing booked, started or billed because of it.
 */
import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/lib/app/csv";
import { addMember, company, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import { NOT_ALLOWED } from "./lib/errors";
import { guessRecordMapping, readCadence, readCents, readDay, readMinutes, readTime, toRecordRow } from "./lib/migration/records";

/** The columns Jobber's help center lists for its Visits report. */
const JOBBER_VISITS = `Job #,Date,Visit title,Client name,Client email,Client phone,Service street,Service city,Service state/province,Service ZIP/postal code,Visit completed,Assigned to,Scheduled duration
55,2099-03-04,Biweekly clean,Dana Whitfield,dana@example.com,512-555-0101,12 Elm St,Austin,TX,78701,No,Rosa,2.5
56,03/05/2099,Deep clean,Nobody Known,nobody@example.com,,1 Main St,Austin,TX,78701,No,,1
57,2001-01-02,Old visit,Dana Whitfield,dana@example.com,,12 Elm St,Austin,TX,78701,Yes,,1
58,not a date,Bad row,Dana Whitfield,,,,,,,,,`;

/** Jobber's Recurring jobs report columns. */
const JOBBER_RECURRING = `Job #,Job title,Client name,Client email,Visit frequency,Schedule start date,Schedule end date,Total ($)
70,Weekly home,Dana Whitfield,dana@example.com,Every 2 weeks,2099-01-06,,"$180.00"
71,Odd,Dana Whitfield,dana@example.com,Every 3rd Tuesday,2099-01-06,,`;

describe("Reading other systems' values", () => {
  it("reads dates, times, durations, money and frequencies as exports write them", () => {
    expect(readDay("2026-12-03")).toBe("2026-12-03");
    expect(readDay("12/03/2026")).toBe("2026-12-03");
    expect(readDay("Thu, Dec 3, 2026 9:00 AM")).toBe("2026-12-03");
    expect(readDay("2026-02-30")).toBeNull();
    expect(readDay("soon")).toBeNull();
    expect(readTime("2:05 pm")).toBe("14:05");
    expect(readTime("12:00 AM")).toBe("00:00");
    expect(readTime("2026-12-03 09:30")).toBe("09:30");
    expect(readMinutes("2.5")).toBe(150);
    expect(readMinutes("90")).toBe(90);
    expect(readMinutes("1:30")).toBe(90);
    expect(readMinutes("45 min")).toBe(45);
    expect(readCents("$1,234.50")).toBe(123450);
    expect(readCents("(45.00)")).toBe(-4500);
    expect(readCents("abc")).toBeNull();
    expect(readCadence("Weekly")).toBe("every_7_days");
    expect(readCadence("Every 2 weeks")).toBe("every_14_days");
    expect(readCadence("Every 4 weeks")).toBe("every_28_days");
    expect(readCadence("Monthly")).toBe("once_per_month");
    expect(readCadence("Twice a month")).toBe("twice_per_month");
    // Not said plainly: kept as written, never guessed.
    expect(readCadence("Every 3rd Tuesday")).toBeNull();
  });

  it("maps Jobber's report columns as suggestions", () => {
    const csv = parseCsv(JOBBER_VISITS);
    const mapping = guessRecordMapping("appointment", csv[0]);
    expect(toRecordRow(csv[1], mapping)).toMatchObject({ clientName: "Dana Whitfield", clientEmail: "dana@example.com", street: "12 Elm St", date: "2099-03-04", duration: "2.5", description: "Biweekly clean", assignedTo: "Rosa", reference: "55" });
    const recurring = parseCsv(JOBBER_RECURRING);
    expect(toRecordRow(recurring[1], guessRecordMapping("recurring", recurring[0]))).toMatchObject({ frequency: "Every 2 weeks", date: "2099-01-06", amount: "$180.00" });
  });
});

describe("Records import", () => {
  async function seeded() {
    const t = start();
    const owner = await company(t, "owner-a", "Alpha Cleaning");
    await owner.as.mutation(api.clientImports.commit, {
      companyId: owner.companyId,
      importKey: "clients:0",
      source: "jobber",
      label: "Jobber clients",
      rows: [{ index: 0, row: { name: "Dana Whitfield", email: "dana@example.com", phone: "512-555-0101", line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" } }],
      addAnyway: [],
      skip: [],
    });
    return { t, ...owner };
  }

  it("matches each row to one client, keeps past visits as history, and imports once", async () => {
    const { t, as, companyId } = await seeded();
    const csv = parseCsv(JOBBER_VISITS);
    const mapping = guessRecordMapping("appointment", csv[0]);
    const rows = csv.slice(1).map((cells) => toRecordRow(cells, mapping));

    const check = await as.query(api.migrationImports.check, { companyId, kind: "appointment", rows });
    expect(check.rows[0]).toMatchObject({ client: { name: "Dana Whitfield", by: "email" }, problems: [] });
    expect(check.rows[1].problems[0]).toMatch(/No client in Selestial matches/);
    expect(check.rows[2].notes[0]).toMatch(/has passed/);
    expect(check.rows[3].problems[0]).toMatch(/isn't a date/);
    expect(check.willCreate).toBe(2);

    const batch = rows.map((row, index) => ({ index, row }));
    const first = await as.mutation(api.migrationImports.commit, { companyId, importKey: "visits:0", kind: "appointment", source: "jobber", label: "Visits", rows: batch });
    expect(first).toMatchObject({ repeated: false, created: 2, failed: 2 });
    const again = await as.mutation(api.migrationImports.commit, { companyId, importKey: "visits:0", kind: "appointment", source: "jobber", label: "Visits", rows: batch });
    expect(again).toMatchObject({ repeated: true, created: 2 });
    // The same file under a new key adds nothing new.
    const other = await as.mutation(api.migrationImports.commit, { companyId, importKey: "visits-again:0", kind: "appointment", source: "jobber", label: "Visits", rows: batch });
    expect(other).toMatchObject({ created: 0, skipped: 2 });

    const summary = await as.query(api.migrationImports.summary, { companyId });
    expect(summary).toMatchObject({ clients: 1, appointments: { waiting: 1 }, history: 1 });
    // Nothing was booked: importing an appointment is not a visit.
    const jobs = await t.run(async (ctx) => ctx.db.query("jobs").collect());
    expect(jobs).toEqual([]);
    const records = await t.run(async (ctx) => ctx.db.query("migrationRecords").collect());
    expect(records.find((row) => row.kind === "appointment")).toMatchObject({ day: "2099-03-04", durationMinutes: 150, review: "review" });
    expect(records.find((row) => row.kind === "appointment")?.propertyId).toBeDefined();
  });

  it("keeps a recurring schedule for review with its cadence, and starts no plan", async () => {
    const { t, as, companyId } = await seeded();
    const csv = parseCsv(JOBBER_RECURRING);
    const mapping = guessRecordMapping("recurring", csv[0]);
    const rows = csv.slice(1).map((cells) => toRecordRow(cells, mapping));
    const check = await as.query(api.migrationImports.check, { companyId, kind: "recurring", rows });
    expect(check.rows[1].notes[0]).toMatch(/kept as written/);
    await as.mutation(api.migrationImports.commit, { companyId, importKey: "recurring:0", kind: "recurring", source: "jobber", label: "Recurring", rows: rows.map((row, index) => ({ index, row })) });
    const waiting = await as.query(api.migrationImports.waiting, { companyId, kind: "recurring" });
    expect(waiting.map((row) => row.cadence)).toEqual(["every_14_days", null]);
    expect(waiting[0].amountCents).toBe(18000);
    expect(await t.run(async (ctx) => ctx.db.query("servicePlans").collect())).toEqual([]);
  });

  it("refuses an Office member, and a row that matches two clients", async () => {
    const { t, as, companyId } = await seeded();
    const office = await addMember(t, as, companyId, "office-a", "office");
    expect(await refusal(office.query(api.migrationImports.check, { companyId, kind: "history", rows: [] }))).toBe(NOT_ALLOWED);
    await as.mutation(api.clients.create, { companyId, type: "person", name: "Dana Whitfield", kind: "home", contact: { name: "Dana Whitfield" }, addAnyway: true });
    const check = await as.query(api.migrationImports.check, { companyId, kind: "history", rows: [{ clientName: "Dana Whitfield", date: "2025-01-02", amount: "120" }] });
    expect(check.rows[0].problems[0]).toMatch(/More than one client/);
  });
});

describe("Selestial's templates", () => {
  it("map every column without the owner choosing any", async () => {
    const { readFileSync } = await import("node:fs");
    const read = (name: string) => parseCsv(readFileSync(new URL(`../public/templates/${name}`, import.meta.url), "utf8"));
    for (const [kind, name] of [["appointment", "selestial-appointments.csv"], ["recurring", "selestial-recurring.csv"], ["history", "selestial-history.csv"]] as const) {
      const [header] = read(name);
      expect(Object.keys(guessRecordMapping(kind, header)).length, name).toBe(header.length);
    }
    const { guessMapping } = await import("./lib/clients/importing");
    const [clients] = read("selestial-clients.csv");
    expect(Object.keys(guessMapping(clients)).length).toBe(clients.length);
  });
});
