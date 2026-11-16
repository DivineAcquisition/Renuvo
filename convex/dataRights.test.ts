/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accepted, dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, company, JOB_START, refusal, seedVisit, start, type T } from "../tests/harness";
import { ADMIN, staffSetup } from "../tests/trustHarness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { EXPORT_LIFETIME_MS, EXPORTS_PER_COMPANY_PER_DAY } from "./dataRights";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { ERASED_CLEANER, ERASED_CUSTOMER } from "./lib/trust/erase";
import { EXPORT_TABLES, NOT_EXPORTED } from "./lib/trust/exportTables";
import schema from "./schema";

const MINUTE = 60 * 1000;

let undo = () => {};
beforeEach(() => {
  undo = dispatchTestEnv();
  vi.stubEnv("STAFF_BOOTSTRAP_EMAIL", ADMIN.email);
});
afterEach(() => {
  undo();
  vi.unstubAllEnvs();
});

/** The export file as the Owner would download it. */
async function exportFile(t: T, exportId: Id<"dataExports">) {
  return t.run(async (ctx) => {
    const row = await ctx.db.get(exportId);
    const blob = row?.storageId ? await ctx.storage.get(row.storageId) : null;
    return blob ? (JSON.parse(await blob.text()) as { companyId: string; company: Record<string, unknown>; tables: Record<string, Record<string, unknown>[]> }) : null;
  });
}

async function twoCompanies() {
  const t = start();
  const a = await company(t, "owner-a", "Alpha Cleaning");
  const b = await company(t, "owner-b", "Beta Cleaning");
  const visitA = await seedVisit(a.as, a.companyId);
  const visitB = await seedVisit(b.as, b.companyId);
  await b.as.mutation(api.customers.update, { companyId: b.companyId, customerId: visitB.customerId, name: "Bianca Beta-Customer" });
  await a.as.mutation(api.cleaners.setPay, { companyId: a.companyId, cleanerId: visitA.cleanerId, pay: { kind: "share", shareBps: 4500 } });
  const manager = await addMember(t, a.as, a.companyId, "mgr-a", "manager");
  const office = await addMember(t, a.as, a.companyId, "office-a", "office");
  return { t, a, b, visitA, visitB, manager, office };
}

describe("the company export", () => {
  it("covers every company table: each is exported or left out with a reason", () => {
    const tables = schema.tables as unknown as Record<string, { validator: { fields?: Record<string, unknown> }; " indexes"(): { indexDescriptor: string; fields: string[] }[] }>;
    const companyTables = Object.keys(tables).filter((name) => tables[name].validator.fields && "companyId" in tables[name].validator.fields!);
    const listed = new Set([...EXPORT_TABLES.map((row) => row.table), ...Object.keys(NOT_EXPORTED)]);
    expect(companyTables.filter((name) => !listed.has(name))).toEqual([]);
    for (const entry of EXPORT_TABLES) {
      if (!tables[entry.table]) continue;
      const index = tables[entry.table][" indexes"]().find((row) => row.indexDescriptor === entry.index);
      expect(index?.fields[0], `${entry.table}.${entry.index}`).toBe("companyId");
    }
  });

  it("holds this company's records only, with pay, and no link parts or secrets", async () => {
    const { t, a, b, visitA } = await twoCompanies();
    // A cleaner link in each company, as Dispatch would issue them.
    const publicIds = await t.run(async (ctx) => {
      const out: string[] = [];
      for (const [companyId, visit] of [[a.companyId, visitA]] as const) {
        const assignmentId = await ctx.db.insert("assignments", { companyId, jobId: visit.jobId, cleanerId: visit.cleanerId, status: "offered", scope: "x", payCents: 1, offeredAt: 1, respondBy: 2 });
        await ctx.db.insert("actionLinks", { companyId, publicId: "LINK-PUBLIC-ID-ALPHA", purpose: "offer", cleanerId: visit.cleanerId, jobId: visit.jobId, assignmentId, allowed: ["accept"], expiresAt: 2, issuedAt: 1 });
        out.push("LINK-PUBLIC-ID-ALPHA");
      }
      for (const invitation of await ctx.db.query("invitations").collect()) out.push(invitation.publicId);
      await ctx.db.patch(a.companyId, { setupKey: "SETUP-KEY-ALPHA" });
      return out;
    });

    const { exportId } = await a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId });
    expect(await a.as.query(api.dataRights.exports, { companyId: a.companyId })).toMatchObject([{ id: exportId, status: "preparing" }]);
    await flush(t);
    const [listed] = await a.as.query(api.dataRights.exports, { companyId: a.companyId });
    expect(listed.status).toBe("ready");
    // Ready for a day from when it was made, and no longer.
    expect(listed.expiresAt).toBeGreaterThan(listed.createdAt + EXPORT_LIFETIME_MS - 1);
    expect(listed.expiresAt).toBeLessThanOrEqual(Date.now() + EXPORT_LIFETIME_MS);
    expect(listed.sizeBytes).toBeGreaterThan(100);

    const file = (await exportFile(t, exportId))!;
    expect(file.companyId).toBe(a.companyId);
    expect(file.company).toMatchObject({ name: "Alpha Cleaning" });
    expect(file.tables.customers.map((row) => row.name)).toEqual(["Dana Whitfield"]);
    expect(file.tables.cleaners[0]).toMatchObject({ name: "Rosa", pay: { kind: "share", shareBps: 4500 } });
    expect(file.tables.members.map((row) => row.name).sort()).toEqual(["mgr-a", "office-a", "owner-a"]);
    expect(file.tables.jobs).toHaveLength(1);
    expect(file.tables.events.length).toBeGreaterThan(3);
    for (const [table, rows] of Object.entries(file.tables)) for (const row of rows) expect(row.companyId, table).toBe(a.companyId);
    const words = JSON.stringify(file);
    expect(words).not.toContain(b.companyId);
    expect(words).not.toContain("Beta");
    expect(words).not.toContain("SETUP-KEY-ALPHA");
    for (const id of publicIds) expect(words).not.toContain(id);
    expect(file.tables.actionLinks).toBeUndefined();
    expect(file.tables.trustRequests).toBeUndefined();
  });

  it("gives a download address only to this company's Owner, only until it expires, and then deletes the file", async () => {
    const { t, a, b, manager, office } = await twoCompanies();
    const { exportId } = await a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId });
    expect(await refusal(a.as.mutation(api.dataRights.downloadUrl, { companyId: a.companyId, exportId }))).toBe("This export is still being prepared.");
    await flush(t);

    const { url } = await a.as.mutation(api.dataRights.downloadUrl, { companyId: a.companyId, exportId });
    expect(url).toMatch(/^https?:\/\//);
    expect((await a.as.query(api.dataRights.exports, { companyId: a.companyId }))[0].downloadedAt).toBe(Date.now());

    // Another company's Owner, naming this export from inside their own company or from this one.
    expect(await refusal(b.as.mutation(api.dataRights.downloadUrl, { companyId: b.companyId, exportId }))).toBe(NOT_FOUND);
    expect(await refusal(b.as.mutation(api.dataRights.downloadUrl, { companyId: a.companyId, exportId }))).toBe(NOT_FOUND);
    expect(await refusal(b.as.query(api.dataRights.exports, { companyId: a.companyId }))).toBe(NOT_FOUND);
    // A Manager or Office member of this company.
    for (const who of [manager, office]) {
      expect(await refusal(who.mutation(api.dataRights.downloadUrl, { companyId: a.companyId, exportId }))).toBe(NOT_ALLOWED);
      expect(await refusal(who.mutation(api.dataRights.requestExport, { companyId: a.companyId }))).toBe(NOT_ALLOWED);
      expect(await refusal(who.query(api.dataRights.exports, { companyId: a.companyId }))).toBe(NOT_ALLOWED);
    }

    vi.advanceTimersByTime(EXPORT_LIFETIME_MS);
    expect(await refusal(a.as.mutation(api.dataRights.downloadUrl, { companyId: a.companyId, exportId }))).toBe("This export has expired. Ask for a new one.");
    expect((await a.as.query(api.dataRights.exports, { companyId: a.companyId }))[0].status).toBe("expired");
    expect(await t.mutation(internal.dataRights.expireExports, {})).toEqual({ expired: 1, failed: 0 });
    expect(await exportFile(t, exportId)).toBeNull();
    expect(await t.run(async (ctx) => (await ctx.db.get(exportId))?.storageId ?? null)).toBeNull();
  });

  it("makes one export at a time and a few a day", async () => {
    const { t, a } = await twoCompanies();
    const first = await a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId });
    expect(await a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId })).toEqual(first);
    await flush(t);
    for (let i = 1; i < EXPORTS_PER_COMPANY_PER_DAY; i += 1) {
      await a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId });
      await flush(t);
    }
    expect(await refusal(a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId }))).toContain("exports a day");
  });
});

describe("erasing a customer", () => {
  it("refuses while visits are upcoming, then clears personal details, keeps the visits, and records each step", async () => {
    const { t, a, visitA } = await twoCompanies();
    await a.as.mutation(api.customers.update, { companyId: a.companyId, customerId: visitA.customerId, email: "dana@example.com", phone: "+15551234567", preferences: "Dog named Biscuit" });
    await a.as.mutation(api.properties.update, { companyId: a.companyId, propertyId: visitA.propertyId, label: "Dana's house", accessInstructions: "Key under the mat" });
    await t.run(async (ctx) => {
      await ctx.db.patch(visitA.jobId, { instructions: "Gate code 1234" });
      await ctx.db.insert("tasks", { companyId: a.companyId, agent: "dispatch", title: "Call Dana Whitfield about Tuesday", completionCondition: "Called", status: "open", dueAt: JOB_START, createdAt: 1 });
    });
    await a.as.mutation(api.dataRights.requestExport, { companyId: a.companyId });
    await flush(t);

    expect(await refusal(a.as.mutation(api.dataRights.eraseCustomer, { companyId: a.companyId, customerId: visitA.customerId, confirm: "ERASE" }))).toBe(
      "This customer has 1 upcoming or active visit. Cancel it first, then erase the customer.",
    );
    await a.as.mutation(api.jobs.cancel, { companyId: a.companyId, jobId: visitA.jobId, reason: "Dana Whitfield moved away" });
    const result = await a.as.mutation(api.dataRights.eraseCustomer, { companyId: a.companyId, customerId: visitA.customerId, confirm: "ERASE" });

    const after = await t.run(async (ctx) => ({
      customer: await ctx.db.get(visitA.customerId),
      property: await ctx.db.get(visitA.propertyId),
      job: await ctx.db.get(visitA.jobId),
      tasks: (await ctx.db.query("tasks").collect()).filter((row) => row.companyId === a.companyId),
      exports: await ctx.db.query("dataExports").collect(),
    }));
    expect(after.customer).toMatchObject({ name: ERASED_CUSTOMER, status: "archived" });
    expect(after.customer?.email).toBeUndefined();
    expect(after.customer?.phone).toBeUndefined();
    expect(after.customer?.preferences).toBeUndefined();
    expect(after.property).toMatchObject({ address: { line1: "Erased address", city: "", region: "", postalCode: "" }, status: "archived" });
    expect(after.property?.accessInstructions).toBeUndefined();
    expect(after.property?.label).toBeUndefined();
    // The visit stays and still points at the customer, without the personal text.
    expect(after.job).toMatchObject({ customerId: visitA.customerId, status: "cancelled", cancelReason: `${ERASED_CUSTOMER} moved away` });
    expect(after.job?.instructions).toBeUndefined();
    expect(JSON.stringify(after.tasks)).not.toContain("Dana Whitfield");
    // The export made before still held her details, so its file is gone.
    expect(after.exports).toMatchObject([{ status: "expired" }]);
    expect(after.exports[0].storageId).toBeUndefined();

    const [record] = await a.as.query(api.dataRights.deletions, { companyId: a.companyId });
    expect(record).toMatchObject({ _id: result.deletionRecordId, subject: { kind: "customer", id: visitA.customerId } });
    expect(record.steps.map((step) => [step.step, step.state])).toEqual(expect.arrayContaining([["Customer details", "done"], ["Properties", "done"], ["Visits", "kept"], ["Event log", "kept"], ["Opt-out records", "kept"], ["Backups", "kept"]]));
    expect(record.keptReasons.join(" ")).toContain("Backups are managed by Convex");
    expect(JSON.stringify(record)).not.toContain("Dana");
    const events = await a.as.query(api.events.recent, { companyId: a.companyId, limit: 200 });
    expect(events.map((row) => row.type)).toContain("customer.erased");
    expect(JSON.stringify(events)).not.toContain("Dana Whitfield");
  });

  it("is the Owner's alone, and another company's customer is not found", async () => {
    const { a, b, visitB, manager } = await twoCompanies();
    expect(await refusal(a.as.mutation(api.dataRights.eraseCustomer, { companyId: a.companyId, customerId: visitB.customerId, confirm: "ERASE" }))).toBe(NOT_FOUND);
    expect(await refusal(a.as.mutation(api.dataRights.eraseCustomer, { companyId: b.companyId, customerId: visitB.customerId, confirm: "ERASE" }))).toBe(NOT_FOUND);
    expect(await refusal(manager.mutation(api.dataRights.eraseCustomer, { companyId: a.companyId, customerId: visitB.customerId, confirm: "ERASE" }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.query(api.dataRights.deletions, { companyId: a.companyId }))).toBe(NOT_ALLOWED);
    expect(await refusal(a.as.mutation(api.dataRights.eraseCustomer, { companyId: a.companyId, customerId: visitB.customerId, confirm: "erase" as "ERASE" }))).toBeTruthy();
  });
});

describe("erasing a cleaner", () => {
  it("refuses while the cleaner has upcoming work, then removes details, photos, queued messages and links, and says what it kept", async () => {
    const s = await setup();
    const a = await accepted(s);
    vi.setSystemTime(JOB_START - 10 * MINUTE);
    await s.t.mutation(api.links.reportDelayJob, { token: a.jobToken, etaMinutes: 15, reason: "Dentist ran late" });
    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken, lat: 30.27, lng: -97.74, accuracyM: 12 });
    const storageId = await s.t.run((ctx) => ctx.storage.store(new Blob(["jpeg-bytes"], { type: "image/jpeg" })));
    await s.t.mutation(api.links.attachPhoto, { token: a.jobToken, storageId, kind: "before", clientKey: "photo-0001" });
    const lena = s.cleaners.Lena;
    await s.as.mutation(api.cleaners.update, { companyId: s.companyId, cleanerId: lena, email: "lena@example.com" });

    expect(await refusal(s.as.mutation(api.dataRights.eraseCleaner, { companyId: s.companyId, cleanerId: lena, confirm: "ERASE" }))).toContain("Cancel the job or release the cleaner");

    await s.as.mutation(api.jobs.cancel, { companyId: s.companyId, jobId: a.jobId, reason: "Customer cancelled" });
    // Something still waiting to go to her, and a link that is somehow still open, to show both are closed.
    const { waiting, openLink } = await s.t.run(async (ctx) => {
      const waiting = await ctx.db.insert("messages", { companyId: s.companyId, purpose: "reminder", cleanerId: lena, to: "+15550101010", body: "Reminder: {link}", dedupeKey: "test-waiting", status: "queued", attempts: 0, queuedAt: Date.now() });
      const openLink = await ctx.db.insert("actionLinks", { companyId: s.companyId, publicId: "still-open-link", purpose: "job", cleanerId: lena, jobId: a.jobId, assignmentId: a.assignmentId, allowed: ["check_in"], expiresAt: JOB_START + 99 * 60 * MINUTE, issuedAt: Date.now() });
      await ctx.db.insert("tasks", { companyId: s.companyId, agent: "dispatch", title: "Ask Lena about Friday", completionCondition: "Asked", status: "open", dueAt: JOB_START, createdAt: 1 });
      return { waiting, openLink };
    });

    const result = await s.as.mutation(api.dataRights.eraseCleaner, { companyId: s.companyId, cleanerId: lena, confirm: "ERASE" });
    const after = await s.t.run(async (ctx) => ({
      cleaner: await ctx.db.get(lena),
      windows: (await ctx.db.query("availabilityWindows").collect()).filter((row) => row.cleanerId === lena),
      evidence: (await ctx.db.query("evidence").collect()).filter((row) => row.cleanerId === lena),
      file: await ctx.storage.get(storageId),
      waiting: await ctx.db.get(waiting),
      messages: (await ctx.db.query("messages").collect()).filter((row) => row.cleanerId === lena),
      link: await ctx.db.get(openLink),
      assignment: await ctx.db.get(a.assignmentId),
      tasks: await ctx.db.query("tasks").collect(),
    }));
    expect(after.cleaner).toMatchObject({ name: ERASED_CLEANER, status: "ended", skills: [], serviceAreas: [] });
    expect(after.cleaner?.phone).toBeUndefined();
    expect(after.cleaner?.email).toBeUndefined();
    expect(after.cleaner?.pay).toBeUndefined();
    expect(after.windows).toEqual([]);
    expect(after.evidence).toEqual([]);
    expect(after.file).toBeNull();
    expect(after.waiting).toMatchObject({ status: "not_sent", problem: "Withdrawn: the cleaner's details were erased." });
    expect(after.messages.every((row) => row.to === undefined)).toBe(true);
    expect(after.link?.revokedAt).toBeDefined();
    // The assignment and its pay stay; where she was and what she wrote do not.
    expect(after.assignment).toMatchObject({ cleanerId: lena, payCents: 8000, checkIn: { at: JOB_START } });
    expect(after.assignment?.checkIn?.lat).toBeUndefined();
    expect(after.assignment?.late?.reason).toBeUndefined();
    expect(JSON.stringify(after.tasks)).not.toContain("Lena");

    const [record] = await s.as.query(api.dataRights.deletions, { companyId: s.companyId });
    expect(record._id).toBe(result.deletionRecordId);
    const steps = Object.fromEntries(record.steps.map((step) => [step.step, step]));
    expect(steps["Photos"].detail).toContain("1 photo");
    expect(steps["Queued messages"].detail).toContain("1 waiting message");
    expect(steps["Action links"].detail).toContain("1 link");
    expect(steps["Assignments and pay"].state).toBe("kept");
    expect(steps["Opt-out records"].state).toBe("kept");
    expect(JSON.stringify(record)).not.toContain("Lena");
    expect(JSON.stringify(record)).not.toContain("+1555");
  });

  it("refuses another company's cleaner as not found", async () => {
    const { a, visitB } = await twoCompanies();
    expect(await refusal(a.as.mutation(api.dataRights.eraseCleaner, { companyId: a.companyId, cleanerId: visitB.cleanerId, confirm: "ERASE" }))).toBe(NOT_FOUND);
  });
});

describe("asking for the company to be deleted", () => {
  it("opens one request for staff, already verified as the Owner, and deletes nothing itself", async () => {
    const { t, a, manager, visitA } = await twoCompanies();
    const { reviewer } = await staffSetup(t);
    const first = await a.as.mutation(api.dataRights.requestCompanyDeletion, { companyId: a.companyId, note: "We are closing." });
    expect(first.alreadyOpen).toBe(false);
    expect(await a.as.mutation(api.dataRights.requestCompanyDeletion, { companyId: a.companyId })).toEqual({ reference: first.reference, alreadyOpen: true });
    expect(await refusal(manager.mutation(api.dataRights.requestCompanyDeletion, { companyId: a.companyId }))).toBe(NOT_ALLOWED);

    const [row] = await reviewer.query(api.requests.queue, { kind: "privacy" });
    expect(row).toMatchObject({ reference: first.reference, subtype: "deletion", routing: "selestial", verified: true, businessName: "Alpha Cleaning", requester: { email: "owner-a@example.com", relationship: "cleaning_company_customer" } });
    expect((await reviewer.query(api.requests.get, { requestId: row.id })).companyId).toBe(a.companyId);
    // Nothing of the company changed.
    expect((await a.as.query(api.customers.get, { companyId: a.companyId, customerId: visitA.customerId })).customer.name).toBe("Dana Whitfield");
  });
});
