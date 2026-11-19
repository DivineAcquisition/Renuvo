/**
 * @vitest-environment edge-runtime
 *
 * Importing clients from a spreadsheet or another system: checked first, committed in batches that import
 * once however often they are sent, partial failures reported, and never consent to be contacted.
 */
import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/lib/app/csv";
import { addMember, company, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import { detectSource, guessMapping, toRow } from "./lib/clients/importing";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

const JOBBER = `J-ID,Display Name,Company Name,First Name,Last Name,Main Phone #s,E-mails,Service Street 1,Service Street 2,Service City,Service State,Service Zip code
101,Dana Whitfield,,Dana,Whitfield,512-555-0101,dana@example.com,12 Elm St,,Austin,TX,78701
102,Harbor Dental,Harbor Dental,,,,frontdesk@harbordental.example,400 Congress Ave,Suite 200,Austin,TX,78701
103,No Email Person,,No Email,Person,512-555-0103,not-an-email,,,,,`;

describe("Client import", () => {
  it("recognizes exports from Jobber, Housecall Pro and BookingKoala, and maps their columns as suggestions", () => {
    const jobber = parseCsv(JOBBER);
    expect(detectSource(jobber[0])).toBe("jobber");
    const mapping = guessMapping(jobber[0]);
    expect(toRow(jobber[1], mapping)).toMatchObject({ name: "Dana Whitfield", email: "dana@example.com", phone: "512-555-0101", line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701", externalId: "101" });
    expect(toRow(jobber[2], mapping)).toMatchObject({ name: "Harbor Dental", line2: "Suite 200" });
    expect(detectSource(["First Name", "Last Name", "Display Name", "Email", "Mobile Number", "Home Number", "Address", "City", "State", "Zip"])).toBe("housecall_pro");
    expect(detectSource(["First Name", "Last Name", "Email", "Phone", "Address", "Apt", "City", "State", "Zip Code", "Frequency"])).toBe("bookingkoala");
    expect(detectSource(["Name", "Phone"])).toBeNull();
    // First and last names are joined when there is no full-name column.
    expect(toRow(["Ana", "Ruiz", "ana@example.com"], guessMapping(["First Name", "Last Name", "Email"])).name).toBe("Ana Ruiz");
  });

  it("checks rows first, imports once however often a batch is sent, and reports partial failures", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await as.mutation(api.clients.create, { companyId, type: "person", name: "Existing Client", kind: "home", contact: { name: "Existing Client", email: "dana@example.com" } });
    const csv = parseCsv(JOBBER);
    const mapping = guessMapping(csv[0]);
    const rows = csv.slice(1).map((cells) => toRow(cells, mapping));

    const check = await as.query(api.clientImports.check, { companyId, source: "jobber", rows });
    expect(check.rows[0].matches.map((row) => row.why)).toEqual(["Same email"]);
    expect(check.rows[1]).toMatchObject({ problems: [], matches: [], property: true });
    expect(check.rows[2].problems).toEqual(["The email doesn't look like an email address."]);
    expect(check.willCreate).toBe(1);

    const batch = rows.map((row, index) => ({ index, row }));
    const first = await as.mutation(api.clientImports.commit, { companyId, importKey: "file-1:0", source: "jobber", label: "Jobber export", rows: batch, addAnyway: [], skip: [] });
    expect(first).toMatchObject({ repeated: false, created: 1, skipped: 1, failed: 1 });
    expect(first.results.map((row) => [row.name, row.outcome])).toEqual([["Dana Whitfield", "skipped"], ["Harbor Dental", "created"], ["No Email Person", "failed"]]);
    // Sent again (a double click, a retry): the same answer, nothing written twice.
    expect(await as.mutation(api.clientImports.commit, { companyId, importKey: "file-1:0", source: "jobber", label: "Jobber export", rows: batch, addAnyway: [], skip: [] })).toMatchObject({ repeated: true, created: 1 });
    // The same export imported again under a new key finds what it already imported.
    const again = await as.mutation(api.clientImports.commit, { companyId, importKey: "file-2:0", source: "jobber", label: "Jobber export", rows: batch, addAnyway: [0], skip: [] });
    expect(again.results.map((row) => [row.name, row.outcome, row.reason])).toEqual([
      ["Dana Whitfield", "created", undefined],
      ["Harbor Dental", "skipped", "Already imported from this system."],
      ["No Email Person", "failed", "The email doesn't look like an email address."],
    ]);

    const harbor = await t.run(async (ctx) => (await ctx.db.query("customers").collect()).find((row) => row.name === "Harbor Dental")!);
    expect(harbor).toMatchObject({ type: "business", source: "import:jobber" });
    expect(harbor.communication).toBeUndefined();
    const property = await t.run(async (ctx) => (await ctx.db.query("properties").collect()).find((row) => row.customerId === harbor._id)!);
    expect(property.address).toMatchObject({ line1: "400 Congress Ave", line2: "Suite 200", postalCode: "78701" });
    // An imported contact is never permission to be texted or emailed.
    const consent = await t.run(async (ctx) => ctx.db.query("contactPermissions").collect());
    expect(consent).toEqual([]);
  });

  it("keeps a row without a complete address as a client with no property, and lets only Owners and Managers import", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const done = await as.mutation(api.clientImports.commit, { companyId, importKey: "k", source: "csv", label: "Spreadsheet", rows: [{ index: 0, row: { name: "Rosa Diaz", line1: "5 Oak St", city: "Austin", schedule: "Every 2 weeks" } }], addAnyway: [], skip: [] });
    expect(done.created).toBe(1);
    const rosa = await t.run(async (ctx) => (await ctx.db.query("customers").collect())[0]);
    expect(rosa.preferences).toBe("Schedule in the old system: Every 2 weeks");
    expect(await t.run(async (ctx) => (await ctx.db.query("properties").collect()).length)).toBe(0);

    const office = await addMember(t, as, companyId, "office-a", "office");
    expect(await refusal(office.query(api.clientImports.check, { companyId, source: "csv", rows: [] }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.mutation(api.clientImports.commit, { companyId, importKey: "x", source: "csv", label: "x", rows: [], addAnyway: [], skip: [] }))).toBe(NOT_ALLOWED);
    const other = await company(t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.mutation(api.clientImports.commit, { companyId, importKey: "x", source: "csv", label: "x", rows: [], addAnyway: [], skip: [] }))).toBe(NOT_FOUND);
    // A batch that is too large is refused before anything is written.
    const big = Array.from({ length: 101 }, (_, index) => ({ index, row: { name: `Client ${index}` } }));
    expect(await refusal(as.mutation(api.clientImports.commit, { companyId, importKey: "big", source: "csv", label: "x", rows: big, addAnyway: [], skip: [] }))).toContain("up to 100");
  });
});
