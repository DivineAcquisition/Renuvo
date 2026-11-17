/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it } from "vitest";

import { addMember, company, HOUR, JOB_END, JOB_START, NOW, refusal, seedVisit, start } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 17 * 60 }));

describe("adding workers", () => {
  it("gives a new worker the template for their relationship type, and nothing makes them ready by itself", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    const { cleanerId } = await as.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "contractor", phone: "512-555-0101", serviceAreas: ["78701"] }, windows: week });
    const profile = await as.query(api.cleanerProfile.profile, { companyId, cleanerId, asOf: NOW });
    expect(profile.status).toBe("onboarding");
    expect(profile.readiness.state).toBe("onboarding");
    expect(profile.readiness.eligible).toBe(false);
    // Availability and areas are read from the record; the rest wait for the person and a review.
    const states = Object.fromEntries(profile.requirements.map((row) => [row.key, row.state]));
    expect(states).toMatchObject({ contact: "not_started", agreement: "not_started", availability: "accepted", service_areas: "accepted", tax_form: "not_started" });
    expect(profile.readiness.blockers.map((row) => row.key)).toEqual(["contact", "agreement", "documents", "policies"]);

    // Making the engagement active does not make them eligible: the blockers still stand.
    await as.mutation(api.cleanerProfile.setEngagementStatus, { companyId, cleanerId, status: "ready" });
    const directory = await as.query(api.workforce.directory, { companyId, asOf: NOW });
    expect(directory.rows[0]).toMatchObject({ name: "Rosa Diaz", statusWords: "Active", readiness: { state: "blocked" } });
    expect(directory.overview.ready.count).toBe(0);
    expect(directory.overview.attention.count).toBe(1);
    expect(directory.attention.find((item) => item.kind === "missing_requirements")).toMatchObject({ severity: "urgent", title: "Active but cannot be offered work" });
  });

  it("refuses a likely duplicate unless a person says why it is someone else", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    await as.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "contractor", phone: "+1 (512) 555-0101" } });
    const matches = await as.query(api.workforce.possibleDuplicates, { companyId, name: "Rosa M. Diaz", phone: "512.555.0101" });
    expect(matches).toMatchObject([{ name: "Rosa Diaz", why: "same phone number", strong: true }]);
    expect(await refusal(as.mutation(api.workforce.add, { companyId, person: { name: "Rosa M. Diaz", engagement: "employee", phone: "5125550101" } }))).toContain("already in the record");
    const { cleanerId } = await as.mutation(api.workforce.add, { companyId, person: { name: "Rosa M. Diaz", engagement: "employee", phone: "5125550101" }, notDuplicateBecause: "Her daughter; they share the family phone." });
    const events = await as.query(api.events.forSubject, { companyId, subject: { table: "cleaners", id: cleanerId } });
    expect(events.map((event) => event.type)).toContain("cleaner.duplicate_overridden");
  });

  it("imports with a review: bad rows and duplicates are not written, and running it again adds nobody", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    await as.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "contractor", email: "rosa@example.com" } });
    const rows = [
      { name: "Lena Park", engagement: "employee", phone: "512 555 0102", serviceAreas: "78701; 78702", skills: "deep clean, windows" },
      { name: "Rosa Diaz", email: "ROSA@example.com" },
      { name: "Lena Park", phone: "5125550102" },
      { name: "", phone: "5125550103" },
      { name: "Sam Ortiz", engagement: "freelancer" },
      { name: "Kai Moore", engagement: "subcontractor", subcontractor: "Sparkle Partners" },
    ];
    const checked = await as.query(api.workforce.checkImport, { companyId, rows });
    expect(checked.map((row) => ({ problems: row.problems.length > 0, matches: row.matches.length, same: row.sameAsRow }))).toEqual([
      { problems: false, matches: 0, same: null },
      { problems: false, matches: 1, same: null },
      { problems: false, matches: 0, same: 0 },
      { problems: true, matches: 0, same: null },
      { problems: true, matches: 0, same: null },
      { problems: true, matches: 0, same: null },
    ]);
    const first = await as.mutation(api.workforce.importRows, { companyId, rows, addAnyway: [], skip: [] });
    expect(first.added).toBe(1);
    expect(first.skipped.map((row) => row.index)).toEqual([1, 2, 3, 4, 5]);
    const again = await as.mutation(api.workforce.importRows, { companyId, rows, addAnyway: [], skip: [] });
    expect(again.added).toBe(0);
    const directory = await as.query(api.workforce.directory, { companyId, asOf: NOW });
    expect(directory.rows.map((row) => row.name)).toEqual(["Lena Park", "Rosa Diaz"]);
    expect(directory.rows[0]).toMatchObject({ engagement: "employee", serviceAreas: ["78701", "78702"], skills: ["deep clean", "windows"] });
  });

  it("links a subcontractor worker to their company and keeps the affiliation's history", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    expect(await refusal(as.mutation(api.workforce.add, { companyId, person: { name: "Kai", engagement: "subcontractor" } }))).toContain("needs the subcontractor company");
    const sparkle = await as.mutation(api.subcontractors.create, { companyId, name: "Sparkle Partners", contact: { name: "Maya Lee", email: "maya@sparkle.example" } });
    const bright = await as.mutation(api.subcontractors.create, { companyId, name: "Bright Crew LLC", contact: { name: "Omar" } });
    const { cleanerId } = await as.mutation(api.workforce.add, { companyId, person: { name: "Kai Moore", engagement: "subcontractor", subcontractorId: sparkle } });
    // Pay, tax and the working agreement are the subcontractor company's, not each worker's.
    const keys = (await as.query(api.cleanerProfile.profile, { companyId, cleanerId, asOf: NOW })).requirements.map((row) => row.key);
    expect(keys).not.toContain("tax_form");
    expect(keys).not.toContain("agreement");
    await as.mutation(api.cleanerProfile.changeEngagementType, { companyId, cleanerId, engagement: "subcontractor", subcontractorId: bright, reason: "Moved to Bright Crew" });
    const profile = await as.query(api.cleanerProfile.profile, { companyId, cleanerId, asOf: NOW });
    expect(profile.subcontractor?.name).toBe("Bright Crew LLC");
    expect(profile.affiliations.map((row) => [row.name, row.to === null])).toEqual([
      ["Sparkle Partners", false],
      ["Bright Crew LLC", true],
    ]);
    expect((await as.query(api.subcontractors.get, { companyId, subcontractorId: sparkle })).former.map((row) => row.name)).toEqual(["Kai Moore"]);
  });
});

describe("who sees what", () => {
  it("keeps pay and personnel requests away from Office and Managers as the rules say, on every read", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    const manager = await addMember(t, owner, companyId, "manager-1", "manager");
    const office = await addMember(t, owner, companyId, "office-1", "office");
    const { cleanerId } = await owner.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "contractor", phone: "5125550101" } });
    await owner.mutation(api.cleaners.setPay, { companyId, cleanerId, pay: { kind: "share", shareBps: 4500 } });

    // Office reads the directory and the profile, with no pay anywhere in what comes back.
    const seen = JSON.stringify([await office.query(api.workforce.directory, { companyId, asOf: NOW }), await office.query(api.cleanerProfile.profile, { companyId, cleanerId, asOf: NOW }), await office.query(api.cleaners.get, { companyId, cleanerId })]);
    expect(seen).not.toContain("4500");
    expect(seen).not.toContain("shareBps");
    // Office cannot add, change, or open personnel requests.
    expect(await refusal(office.mutation(api.workforce.add, { companyId, person: { name: "X", engagement: "contractor" } }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.mutation(api.cleanerProfile.updateDetails, { companyId, cleanerId, name: "Y" }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.query(api.personnel.list, { companyId }))).toBe(NOT_ALLOWED);
    // A Manager may not propose pay, and does not see pay requests.
    expect(await refusal(manager.mutation(api.personnel.request, { companyId, kind: "pay_change", cleanerId, reason: "Raise", pay: { kind: "share", shareBps: 5000 } }))).toBe(NOT_ALLOWED);
    await owner.mutation(api.personnel.request, { companyId, kind: "pay_change", cleanerId, reason: "Six months of good work", pay: { kind: "share", shareBps: 5000 } });
    expect(await manager.query(api.personnel.list, { companyId })).toEqual([]);
    expect((await owner.query(api.personnel.list, { companyId }))[0]).toMatchObject({ kindWords: "Change pay", pay: "50% of each job's price", youMayDecide: true });
    // The Owner alone changes the relationship type.
    expect(await refusal(manager.mutation(api.cleanerProfile.changeEngagementType, { companyId, cleanerId, engagement: "employee", reason: "x" }))).toBe(NOT_ALLOWED);
    // And the activity history leaves pay changes out for everyone else.
    await owner.mutation(api.personnel.decide, { companyId, requestId: (await owner.query(api.personnel.list, { companyId }))[0].requestId, decision: "approved" });
    const history = await manager.query(api.cleanerProfile.activity, { companyId, cleanerId });
    expect(history.some((row) => row.text.includes("pay"))).toBe(false);
    expect((await owner.query(api.cleanerProfile.activity, { companyId, cleanerId })).some((row) => row.text.includes("pay arrangement"))).toBe(true);
  });

  it("answers another company's workers exactly like missing ones", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const b = await company(t, "owner-b", "Beta Cleaning");
    const { cleanerId } = await b.as.mutation(api.workforce.add, { companyId: b.companyId, person: { name: "Beta's Rosa", engagement: "contractor" } });
    const sub = await b.as.mutation(api.subcontractors.create, { companyId: b.companyId, name: "Beta Subs", contact: { name: "B" } });
    const A = a.companyId;
    const calls = [
      () => a.as.query(api.cleanerProfile.profile, { companyId: A, cleanerId, asOf: NOW }),
      () => a.as.query(api.cleanerProfile.activity, { companyId: A, cleanerId }),
      () => a.as.mutation(api.cleanerProfile.updateDetails, { companyId: A, cleanerId, name: "Taken" }),
      () => a.as.mutation(api.cleanerProfile.setEngagementStatus, { companyId: A, cleanerId, status: "ready" }),
      () => a.as.mutation(api.workforce.applyTemplateTo, { companyId: A, cleanerIds: [cleanerId] }),
      () => a.as.query(api.subcontractors.get, { companyId: A, subcontractorId: sub }),
      () => a.as.mutation(api.workforce.add, { companyId: A, person: { name: "Kai", engagement: "subcontractor", subcontractorId: sub } }),
      () => a.as.mutation(api.personnel.request, { companyId: A, kind: "suspend", cleanerId, reason: "x" }),
      () => a.as.query(api.personnel.impact, { companyId: A, cleanerId }),
      () => a.as.query(api.workforce.directory, { companyId: b.companyId, asOf: NOW }),
    ];
    for (const call of calls) {
      const answer = await refusal(call());
      expect([NOT_FOUND, "That subcontractor company is not in this business."]).toContain(answer);
    }
    expect((await a.as.query(api.workforce.directory, { companyId: A, asOf: NOW })).rows).toEqual([]);
  });
});

describe("sensitive changes", () => {
  it("needs an authorized person to suspend or end, and never removes anyone from an accepted job silently", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    const manager = await addMember(t, owner, companyId, "manager-1", "manager");
    const visit = await seedVisit(owner, companyId);
    await owner.mutation(api.cleaners.setPay, { companyId, cleanerId: visit.cleanerId, pay: { kind: "share", shareBps: 5000 } });
    const assignmentId = await owner.mutation(api.assignments.offer, { companyId, jobId: visit.jobId, cleanerId: visit.cleanerId, respondBy: JOB_START - HOUR, payCents: 8000 });
    await owner.mutation(api.assignments.recordAnswer, { companyId, assignmentId, answer: "accepted" });

    // The routine path refuses: suspending and ending are requests.
    expect(await refusal(manager.mutation(api.cleaners.setStatus, { companyId, cleanerId: visit.cleanerId, status: "ended" }))).toContain("personnel request");
    const requestId = await manager.mutation(api.personnel.request, { companyId, kind: "suspend", cleanerId: visit.cleanerId, reason: "Two documented no-shows in March." });
    expect(await refusal(manager.mutation(api.personnel.decide, { companyId, requestId, decision: "approved" }))).toBe(NOT_ALLOWED);
    expect(await refusal(owner.mutation(api.personnel.decide, { companyId, requestId, decision: "declined" }))).toContain("Say why");
    const { carriedOut } = await owner.mutation(api.personnel.decide, { companyId, requestId, decision: "approved", note: "Reviewed the records." });
    expect(carriedOut).toMatchObject({ ok: true });
    expect(carriedOut?.detail).toContain("left as they are");
    // The assignment is untouched; a person decides it in Dispatch.
    const job = await owner.query(api.jobs.get, { companyId, jobId: visit.jobId });
    expect(job.assignments.find((row) => row._id === assignmentId)?.status).toBe("accepted");
    const tasks = await owner.query(api.tasks.list, { companyId, status: "needs_decision" });
    expect(tasks.some((task) => task.title.startsWith("Decide Rosa's upcoming jobs"))).toBe(true);
    const profile = await owner.query(api.cleanerProfile.profile, { companyId, cleanerId: visit.cleanerId, asOf: NOW });
    expect(profile).toMatchObject({ status: "suspended", readiness: { state: "not_active" } });
    // A suspension is lifted only by an approved reinstatement.
    expect(await refusal(manager.mutation(api.cleanerProfile.setEngagementStatus, { companyId, cleanerId: visit.cleanerId, status: "ready" }))).toContain("reinstatement");
    void JOB_END;
  });

  it("keeps the pay that applied to a job, and dates every arrangement", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    const { cleanerId } = await owner.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "employee" } });
    expect(await refusal(owner.mutation(api.personnel.request, { companyId, kind: "pay_change", cleanerId, reason: "x", pay: { kind: "hourly", hourlyCents: 2200 }, effectiveAt: Date.now() - 3 * 24 * HOUR }))).toContain("never earlier");
    const requestId = await owner.mutation(api.personnel.request, { companyId, kind: "pay_change", cleanerId, reason: "Starting rate", pay: { kind: "hourly", hourlyCents: 2200 } });
    await owner.mutation(api.personnel.decide, { companyId, requestId, decision: "approved" });
    const second = await owner.mutation(api.personnel.request, { companyId, kind: "pay_change", cleanerId, reason: "Raise", pay: { kind: "hourly", hourlyCents: 2400 } });
    await owner.mutation(api.personnel.decide, { companyId, requestId: second, decision: "approved" });
    const rows = await t.run((ctx) => ctx.db.query("payArrangements").collect());
    expect(rows.map((row) => [row.pay.kind === "hourly" ? row.pay.hourlyCents : 0, row.effectiveTo === undefined])).toEqual([
      [2200, false],
      [2400, true],
    ]);
    expect((await owner.query(api.cleaners.get, { companyId, cleanerId })).pay).toEqual({ kind: "hourly", hourlyCents: 2400 });
  });

  it("refuses a Manager deciding their own request and an Office member requesting at all", async () => {
    const t = start();
    const { as: owner, companyId } = await company(t, "owner-1", "Alpha Cleaning");
    await owner.mutation(api.companies.update, { companyId, name: "Alpha Cleaning" });
    await t.run(async (ctx) => ctx.db.patch(companyId as Id<"companies">, { cleaners: { personnelDecider: "owner_or_manager" } }));
    const manager = await addMember(t, owner, companyId, "manager-1", "manager");
    const other = await addMember(t, owner, companyId, "manager-2", "manager");
    const office = await addMember(t, owner, companyId, "office-1", "office");
    const { cleanerId } = await owner.mutation(api.workforce.add, { companyId, person: { name: "Rosa Diaz", engagement: "contractor" } });
    expect(await refusal(office.mutation(api.personnel.request, { companyId, kind: "disciplinary", cleanerId, reason: "x", summary: "y" }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.mutation(api.personnel.request, { companyId, kind: "disciplinary", cleanerId, reason: "Late twice" }))).toContain("Describe what happened");
    const requestId = await manager.mutation(api.personnel.request, { companyId, kind: "disciplinary", cleanerId, reason: "Late twice", summary: "Arrived 40 minutes late on Mar 2 and Mar 9 without notice." });
    expect(await refusal(manager.mutation(api.personnel.decide, { companyId, requestId, decision: "approved" }))).toContain("Someone else decides");
    const { carriedOut } = await other.mutation(api.personnel.decide, { companyId, requestId, decision: "approved" });
    expect(carriedOut?.detail).toContain("Nothing else was changed");
    expect((await owner.query(api.cleanerProfile.profile, { companyId, cleanerId, asOf: NOW })).status).toBe("onboarding");
  });
});
