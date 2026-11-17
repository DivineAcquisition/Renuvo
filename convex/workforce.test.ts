/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, AREA, company, HOUR, JOB_END, JOB_START, NOW, refusal, seedVisit, start, TUESDAY, type T } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { findMatches, nameKey, phoneKey } from "./lib/workforce/duplicates";
import { readinessOf, type WorkerFacts } from "./lib/workforce/readiness";
import { parseEngagement } from "./lib/workforce/records";

const base: WorkerFacts = {
  status: "ready",
  engagement: "contractor",
  phone: "+15125550100",
  serviceAreas: ["78701"],
  skills: ["deep clean"],
  windowCount: 3,
  hasPay: true,
  workTexts: "granted",
  subcontractor: null,
  handoffOutstanding: [],
};

describe("readiness", () => {
  it("separates being active from being ready, and names exactly what blocks", () => {
    expect(readinessOf(base)).toMatchObject({ state: "ready", eligible: true, headline: "Ready for assignments", blockers: [] });
    const blocked = readinessOf({ ...base, windowCount: 0, hasPay: false });
    // Active is a person's decision; it does not mean every requirement is met.
    expect(blocked.state).toBe("blocked");
    expect(blocked.eligible).toBe(false);
    expect(blocked.headline).toBe("Needs weekly hours and a pay arrangement");
    expect(blocked.blockers.map((check) => check.key)).toEqual(["hours", "pay"]);
    expect(readinessOf({ ...base, status: "onboarding" }).state).toBe("onboarding");
    expect(readinessOf({ ...base, status: "paused" })).toMatchObject({ state: "paused", eligible: false });
  });

  it("does not let a missing nice-to-have block work", () => {
    const facts = readinessOf({ ...base, phone: undefined, skills: [], workTexts: "none" });
    expect(facts.state).toBe("ready");
    const info = facts.checks.filter((check) => check.state === "unmet");
    expect(info.map((check) => check.key).sort()).toEqual(["phone", "skills", "work_texts"]);
    expect(info.every((check) => check.blocks === "info")).toBe(true);
    // Payout readiness is Finance's, which is not built: never claimed either way.
    expect(facts.payout).toBe("not_tracked");
  });
});

describe("duplicate matching", () => {
  it("matches on phone, email and a normalized name, and never on nothing", () => {
    expect(phoneKey("(512) 555-0100")).toBe("15125550100");
    expect(phoneKey("+1 512 555 0100")).toBe("15125550100");
    expect(phoneKey("555-0100")).toBeNull();
    expect(nameKey("  José  O'Neil ")).toBe("jose oneil");
    const existing = [{ id: "a", name: "Rosa Diaz", phone: "512-555-0100", email: "rosa@example.com" }];
    expect(findMatches({ name: "R. Diaz", phone: "+15125550100" }, existing)[0].reasons).toEqual(["phone"]);
    expect(findMatches({ name: "rosa diaz" }, existing)[0].reasons).toEqual(["name"]);
    expect(findMatches({ name: "Someone Else", email: "other@example.com" }, existing)).toEqual([]);
  });

  it("reads worker types as spreadsheets write them, and refuses to guess", () => {
    expect(parseEngagement("W2 employee")).toBe("employee");
    expect(parseEngagement("1099")).toBe("contractor");
    expect(parseEngagement("Subcontractor")).toBe("subcontracted");
    expect(parseEngagement("part time")).toBeNull();
    expect(parseEngagement("")).toBeNull();
  });
});

const week = (weekday = TUESDAY) => [{ weekday, startMinute: 8 * 60, endMinute: 17 * 60 }];

async function setup(t: T = start()) {
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  return { t, as, companyId };
}

describe("the Cleaners workspace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a worker once, and asks before adding someone who may already be on record", async () => {
    const { as, companyId } = await setup();
    const first = await as.mutation(api.workforce.add, { companyId, addKey: "add-0001-rosa", name: "Rosa Diaz", engagement: "contractor", phone: "(512) 555-0100", serviceAreas: ["78701"], windows: week() });
    expect(first.status).toBe("created");
    // The same add sent twice (a double click) is the same record.
    const again = await as.mutation(api.workforce.add, { companyId, addKey: "add-0001-rosa", name: "Rosa Diaz", engagement: "contractor", phone: "(512) 555-0100" });
    expect(again).toEqual(first);

    const maybe = await as.mutation(api.workforce.add, { companyId, addKey: "add-0002-rosa", name: "R Diaz", engagement: "employee", phone: "+1 512 555 0100" });
    expect(maybe.status).toBe("possible_duplicates");
    if (maybe.status !== "possible_duplicates" || first.status !== "created") throw new Error("unexpected");
    expect(maybe.matches[0]).toMatchObject({ cleanerId: first.cleanerId, name: "Rosa Diaz", reasons: ["same phone number"] });
    const rows = () => as.query(api.workforce.workspace, { companyId, asOf: NOW });
    expect((await rows()).rows).toHaveLength(1);

    const confirmed = await as.mutation(api.workforce.add, { companyId, addKey: "add-0002-rosa", name: "R Diaz", engagement: "employee", phone: "+1 512 555 0100", acknowledged: [first.cleanerId] });
    expect(confirmed.status).toBe("created");
    const workspace = await rows();
    expect(workspace.rows.map((row) => row.name)).toEqual(["R Diaz", "Rosa Diaz"]);
    // A new worker is onboarding: nobody is offered work until a person makes them active.
    expect(workspace.rows.every((row) => row.status === "onboarding" && !row.readiness.eligible)).toBe(true);
    expect(workspace.counts).toMatchObject({ onboarding: 2, ready: 0 });
  });

  it("keeps a subcontractor, its contact and its workers apart, and keeps affiliation history", async () => {
    const { as, companyId } = await setup();
    expect(await refusal(as.mutation(api.workforce.add, { companyId, addKey: "add-sub-0001", name: "Lena Park", engagement: "subcontracted" }))).toContain("Choose the subcontractor company");
    const sparkle = await as.mutation(api.subcontractors.create, { companyId, name: "Sparkle Partners", contactName: "Jo Reyes", contactEmail: "jo@sparkle.example" });
    const shine = await as.mutation(api.subcontractors.create, { companyId, name: "Shine Co" });
    expect(await refusal(as.mutation(api.subcontractors.create, { companyId, name: "sparkle  partners" }))).toContain("already on record");
    const added = await as.mutation(api.workforce.add, { companyId, addKey: "add-sub-0002", name: "Lena Park", engagement: "subcontracted", subcontractorId: sparkle });
    if (added.status !== "created") throw new Error("not created");
    // The contact is not a worker.
    expect((await as.query(api.workforce.workspace, { companyId, asOf: NOW })).rows.map((row) => row.name)).toEqual(["Lena Park"]);

    await as.mutation(api.subcontractors.moveWorker, { companyId, cleanerId: added.cleanerId, subcontractorId: shine });
    const profile = await as.query(api.workforce.profile, { companyId, cleanerId: added.cleanerId, asOf: NOW });
    expect(profile.subcontractor?.name).toBe("Shine Co");
    expect(profile.affiliationHistory.map((row) => [row.subcontractor, row.until === null])).toEqual([
      ["Shine Co", true],
      ["Sparkle Partners", false],
    ]);

    await as.mutation(api.subcontractors.setStatus, { companyId, subcontractorId: shine, status: "ended", reason: "Contract ended" });
    const workspace = await as.query(api.workforce.workspace, { companyId, asOf: NOW });
    expect(workspace.attention.map((item) => item.kind)).toContain("subcontractor_inactive");
    expect(await refusal(as.mutation(api.workforce.add, { companyId, addKey: "add-sub-0003", name: "New Person", engagement: "subcontracted", subcontractorId: shine }))).toContain("Shine Co is ended");
  });

  it("counts ready, onboarding, attention and working today by their definitions", async () => {
    const { as, companyId } = await setup();
    const seeded = await seedVisit(as, companyId);
    await as.mutation(api.cleaners.update, { companyId, cleanerId: seeded.cleanerId, serviceAreas: [AREA] });
    // Rosa is active with hours and an area, but no pay: active and blocked, not ready.
    let workspace = await as.query(api.workforce.workspace, { companyId, asOf: NOW });
    const rosa = () => workspace.rows.find((row) => row.cleanerId === seeded.cleanerId)!;
    expect(rosa().status).toBe("ready");
    expect(rosa().readiness.state).toBe("blocked");
    expect(workspace.counts.ready).toBe(0);
    expect(workspace.attention).toEqual([expect.objectContaining({ kind: "blocked_active", cleanerId: seeded.cleanerId })]);

    await as.mutation(api.cleaners.setPay, { companyId, cleanerId: seeded.cleanerId, pay: { kind: "share", shareBps: 4500 } });
    const assignmentId = await as.mutation(api.assignments.offer, { companyId, jobId: seeded.jobId, cleanerId: seeded.cleanerId, respondBy: NOW + 4 * HOUR, payCents: 7200 });
    await as.mutation(api.assignments.recordAnswer, { companyId, assignmentId, answer: "accepted" });

    workspace = await as.query(api.workforce.workspace, { companyId, asOf: NOW });
    expect(rosa().readiness.state).toBe("ready");
    expect(workspace.counts).toMatchObject({ ready: 1, attention: 0, workingToday: 0 });
    expect(rosa().next).toMatchObject({ jobId: seeded.jobId, status: "accepted" });

    // On the day of the visit she is working today.
    workspace = await as.query(api.workforce.workspace, { companyId, asOf: JOB_START - HOUR });
    expect(workspace.counts.workingToday).toBe(1);

    // Time off added after she accepted is a conflict a person decides. Nothing is changed for them.
    await as.mutation(api.availability.addTimeOff, { companyId, cleanerId: seeded.cleanerId, startsAt: JOB_START - HOUR, endsAt: JOB_END + HOUR });
    workspace = await as.query(api.workforce.workspace, { companyId, asOf: NOW });
    expect(workspace.attention).toEqual([expect.objectContaining({ kind: "conflict", key: `conflict.time_off:${assignmentId}` })]);
    expect(workspace.attention[0].evidence[0].jobId).toBe(seeded.jobId);
    expect((await as.query(api.jobs.get, { companyId, jobId: seeded.jobId })).assignments[0].status).toBe("accepted");
  });

  it("answers availability only for a stated window", async () => {
    const { as, companyId } = await setup();
    const seeded = await seedVisit(as, companyId);
    const onboarding = await as.mutation(api.workforce.add, { companyId, addKey: "add-avail-01", name: "New Hire", engagement: "employee", windows: week() });
    if (onboarding.status !== "created") throw new Error("not created");
    const tuesday = await as.query(api.workforce.availableFor, { companyId, startsAt: JOB_START, endsAt: JOB_END });
    expect(tuesday.answers[seeded.cleanerId]).toMatchObject({ available: true });
    expect(tuesday.answers[onboarding.cleanerId]).toMatchObject({ available: false, reason: "Still onboarding" });
    const wednesday = await as.query(api.workforce.availableFor, { companyId, startsAt: JOB_START + 24 * HOUR, endsAt: JOB_END + 24 * HOUR });
    expect(wednesday.answers[seeded.cleanerId]).toMatchObject({ available: false, reason: "Outside the hours they gave" });
    const assignmentId = await as.mutation(api.assignments.offer, { companyId, jobId: seeded.jobId, cleanerId: seeded.cleanerId, respondBy: NOW + 4 * HOUR, payCents: 7200 });
    void assignmentId;
    const booked = await as.query(api.workforce.availableFor, { companyId, startsAt: JOB_START, endsAt: JOB_END });
    expect(booked.answers[seeded.cleanerId]).toMatchObject({ available: false, reason: "Already has work then" });
    expect(await refusal(as.query(api.workforce.availableFor, { companyId, startsAt: JOB_END, endsAt: JOB_START }))).toContain("start before it ends");
  });

  it("needs a reason to pause or end, keeps the reason from office staff, and leaves accepted visits alone", async () => {
    const t = start();
    const { as, companyId } = await setup(t);
    const office = await addMember(t, as, companyId, "office-a", "office");
    const manager = await addMember(t, as, companyId, "manager-a", "manager");
    const seeded = await seedVisit(as, companyId);
    const assignmentId = await as.mutation(api.assignments.offer, { companyId, jobId: seeded.jobId, cleanerId: seeded.cleanerId, respondBy: NOW + 4 * HOUR, payCents: 7200 });
    await as.mutation(api.assignments.recordAnswer, { companyId, assignmentId, answer: "accepted" });

    expect(await refusal(manager.mutation(api.workforce.setStatus, { companyId, cleanerId: seeded.cleanerId, status: "paused" }))).toContain("Say why");
    expect((await manager.query(api.workforce.statusImpact, { companyId, cleanerId: seeded.cleanerId, asOf: NOW })).held).toHaveLength(1);
    await manager.mutation(api.workforce.setStatus, { companyId, cleanerId: seeded.cleanerId, status: "paused", reason: "Family leave, back in April" });
    expect(await refusal(office.mutation(api.workforce.setStatus, { companyId, cleanerId: seeded.cleanerId, status: "ready" }))).toBe(NOT_ALLOWED);

    const asManager = await manager.query(api.workforce.profile, { companyId, cleanerId: seeded.cleanerId, asOf: NOW });
    expect(asManager.statusChange?.note).toBe("Family leave, back in April");
    const asOffice = await office.query(api.workforce.profile, { companyId, cleanerId: seeded.cleanerId, asOf: NOW });
    expect(asOffice.statusChange).toMatchObject({ note: null, noteHidden: true });
    // The visit she accepted is still hers, and the workspace says so instead of quietly dropping it.
    expect((await as.query(api.jobs.get, { companyId, jobId: seeded.jobId })).assignments[0].status).toBe("accepted");
    const workspace = await as.query(api.workforce.workspace, { companyId, asOf: NOW });
    expect(workspace.attention.map((item) => item.kind)).toContain("held_while_inactive");
    expect(await refusal(as.mutation(api.workforce.setStatus, { companyId, cleanerId: seeded.cleanerId, status: "onboarding" }))).toContain("cannot go back to onboarding");
  });

  it("shows pay and classification to the Owner only, everywhere", async () => {
    const t = start();
    const { as, companyId } = await setup(t);
    const office = await addMember(t, as, companyId, "office-b", "office");
    const manager = await addMember(t, as, companyId, "manager-b", "manager");
    const seeded = await seedVisit(as, companyId);
    await as.mutation(api.cleaners.setPay, { companyId, cleanerId: seeded.cleanerId, pay: { kind: "share", shareBps: 4500 } });

    for (const viewer of [office, manager]) {
      expect(await refusal(viewer.query(api.workforce.pay, { companyId, cleanerId: seeded.cleanerId, asOf: NOW }))).toBe(NOT_ALLOWED);
      expect(await refusal(viewer.mutation(api.workforce.setEngagement, { companyId, cleanerId: seeded.cleanerId, engagement: "employee" }))).toBe(NOT_ALLOWED);
      const workspace = await viewer.query(api.workforce.workspace, { companyId, asOf: NOW });
      expect(JSON.stringify(workspace)).not.toContain("shareBps");
      const profile = await viewer.query(api.workforce.profile, { companyId, cleanerId: seeded.cleanerId, asOf: NOW });
      expect(JSON.stringify(profile)).not.toContain("shareBps");
      expect(profile.viewer.seesPay).toBe(false);
      // Readiness may say pay is set. It never says what it is.
      expect(profile.readiness.checks.find((check) => check.key === "pay")).toMatchObject({ state: "met", detail: "The Owner has set how they are paid." });
    }
    expect(await refusal(office.mutation(api.workforce.add, { companyId, addKey: "add-office-01", name: "X", engagement: "contractor" }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.query(api.workforce.previewImport, { companyId, rows: [] }))).toBe(NOT_ALLOWED);

    const pay = await as.query(api.workforce.pay, { companyId, cleanerId: seeded.cleanerId, asOf: NOW });
    expect(pay.arrangement).toMatchObject({ kind: "share", words: "45% of each job's price" });
    expect(pay.finance.built).toBe(false);
    // A share is for contractors: the Owner changes pay before calling them an employee.
    expect(await refusal(as.mutation(api.workforce.setEngagement, { companyId, cleanerId: seeded.cleanerId, engagement: "employee" }))).toContain("Change their pay first");
  });

  it("imports a list with a review of problems and possible duplicates, once", async () => {
    const { as, companyId } = await setup();
    await as.mutation(api.workforce.add, { companyId, addKey: "add-import-00", name: "Rosa Diaz", engagement: "contractor", email: "rosa@example.com" });
    await as.mutation(api.subcontractors.create, { companyId, name: "Sparkle Partners" });
    const rows = [
      { name: "Lena Park", phone: "512-555-0101", workerType: "1099", serviceAreas: "78701, 78702", skills: "Deep clean; Windows" },
      { name: "Rosa Diaz", email: "ROSA@example.com", workerType: "contractor" },
      { name: "Kai Moore", workerType: "part timer" },
      { name: "Ana Ruiz", workerType: "subcontractor", subcontractor: "sparkle partners" },
      { name: "Lena Park", phone: "(512) 555-0101", workerType: "1099" },
      { name: "Bo Chen", workerType: "" },
    ];
    const preview = await as.query(api.workforce.previewImport, { companyId, rows });
    expect(preview.rows[0]).toMatchObject({ problems: [], matches: [], sameAsRows: [], serviceAreas: ["78701", "78702"], skills: ["deep clean", "windows"], engagement: "contractor" });
    expect(preview.rows[1].matches[0]).toMatchObject({ name: "Rosa Diaz", reasons: ["same email", "same name"] });
    expect(preview.rows[2].problems[0]).toContain("not a worker type");
    expect(preview.rows[3]).toMatchObject({ engagement: "subcontracted", subcontractorName: "Sparkle Partners", problems: [] });
    expect(preview.rows[4].sameAsRows).toEqual([0]);
    expect(preview.rows[5].problems[0]).toContain("No worker type");
    // A worker type chosen for blank rows is the person's choice, not a guess.
    expect((await as.query(api.workforce.previewImport, { companyId, rows, defaultEngagement: "employee" })).rows[5]).toMatchObject({ engagement: "employee", problems: [] });

    const decide = (indexes: number[], different: number[] = []) => rows.map((_, index) => ({ index, add: indexes.includes(index), differentPerson: different.includes(index) }));
    const refused = await as.mutation(api.workforce.commitImport, { companyId, key: "import-key-0001", rows, decisions: decide([0, 1, 3, 4]) });
    expect(refused.status).toBe("needs_review");
    expect((await as.query(api.workforce.workspace, { companyId, asOf: NOW })).rows).toHaveLength(1);
    expect((await as.mutation(api.workforce.commitImport, { companyId, key: "import-key-0001", rows, decisions: decide([2]) })).status).toBe("needs_review");

    const done = await as.mutation(api.workforce.commitImport, { companyId, key: "import-key-0001", rows, decisions: decide([0, 3]) });
    expect(done).toMatchObject({ status: "imported", created: 2, skipped: 4 });
    // The same import sent again adds nobody.
    const repeat = await as.mutation(api.workforce.commitImport, { companyId, key: "import-key-0001", rows, decisions: decide([0, 3]) });
    expect(repeat).toMatchObject({ status: "already_imported", created: 2 });
    const workspace = await as.query(api.workforce.workspace, { companyId, asOf: NOW });
    expect(workspace.rows.map((row) => row.name)).toEqual(["Ana Ruiz", "Lena Park", "Rosa Diaz"]);
    expect(workspace.rows.find((row) => row.name === "Ana Ruiz")?.subcontractor?.name).toBe("Sparkle Partners");
    expect(workspace.rows.find((row) => row.name === "Lena Park")?.source).toBe("import");
  });

  it("keeps crews as membership history, with one lead", async () => {
    const { as, companyId } = await setup();
    const ids: Id<"cleaners">[] = [];
    for (const name of ["Ann", "Ben", "Cy"]) {
      const added = await as.mutation(api.workforce.add, { companyId, addKey: `add-crew-${name}-1`, name, engagement: "employee" });
      if (added.status === "created") ids.push(added.cleanerId);
    }
    expect(await refusal(as.mutation(api.crews.create, { companyId, name: "North", memberIds: [ids[0]], leadId: ids[1] }))).toContain("lead must be one of");
    const crewId = await as.mutation(api.crews.create, { companyId, name: "North", memberIds: [ids[0], ids[1]], leadId: ids[0] });
    await as.mutation(api.crews.addMember, { companyId, crewId, cleanerId: ids[2], lead: true });
    let crews = await as.query(api.crews.list, { companyId });
    expect(crews[0].members.map((row) => [row.name, row.role])).toEqual([
      ["Cy", "lead"],
      ["Ann", "member"],
      ["Ben", "member"],
    ]);
    await as.mutation(api.crews.removeMember, { companyId, crewId, cleanerId: ids[1] });
    crews = await as.query(api.crews.list, { companyId });
    expect(crews[0].members.map((row) => row.name)).toEqual(["Cy", "Ann"]);
    const rows = (await as.query(api.workforce.workspace, { companyId, asOf: NOW })).rows;
    expect(rows.find((row) => row.name === "Ben")?.crews).toEqual([]);
    expect(rows.find((row) => row.name === "Cy")?.crews).toEqual([expect.objectContaining({ name: "North", role: "lead" })]);
    const activity = await as.query(api.workforce.activity, { companyId, cleanerId: ids[1], asOf: NOW });
    expect(activity.map((row) => row.text)).toEqual(expect.arrayContaining(["took Ben off a crew", "added Ben to a crew"]));
  });

  it("answers another company's records exactly like missing ones", async () => {
    const t = start();
    const a = await company(t, "owner-x", "Alpha Cleaning");
    const b = await company(t, "owner-y", "Beta Cleaning");
    const inB = await seedVisit(b.as, b.companyId);
    const subB = await b.as.mutation(api.subcontractors.create, { companyId: b.companyId, name: "Beta Partners" });
    const crewB = await b.as.mutation(api.crews.create, { companyId: b.companyId, name: "Beta crew", memberIds: [inB.cleanerId] });
    const added = await a.as.mutation(api.workforce.add, { companyId: a.companyId, addKey: "add-iso-0001", name: "Ann", engagement: "subcontracted", subcontractorId: await a.as.mutation(api.subcontractors.create, { companyId: a.companyId, name: "Alpha Partners" }) });
    if (added.status !== "created") throw new Error("not created");
    const A = a.companyId;
    const calls = [
      () => a.as.query(api.workforce.workspace, { companyId: b.companyId, asOf: NOW }),
      () => a.as.query(api.workforce.profile, { companyId: A, cleanerId: inB.cleanerId, asOf: NOW }),
      () => a.as.query(api.workforce.jobs, { companyId: A, cleanerId: inB.cleanerId, asOf: NOW }),
      () => a.as.query(api.workforce.activity, { companyId: A, cleanerId: inB.cleanerId, asOf: NOW }),
      () => a.as.query(api.workforce.pay, { companyId: A, cleanerId: inB.cleanerId, asOf: NOW }),
      () => a.as.query(api.workforce.statusImpact, { companyId: A, cleanerId: inB.cleanerId, asOf: NOW }),
      () => a.as.mutation(api.workforce.setStatus, { companyId: A, cleanerId: inB.cleanerId, status: "ended", reason: "taken" }),
      () => a.as.mutation(api.workforce.update, { companyId: A, cleanerId: inB.cleanerId, name: "Taken" }),
      () => a.as.mutation(api.workforce.setEngagement, { companyId: A, cleanerId: inB.cleanerId, engagement: "employee" }),
      () => a.as.mutation(api.workforce.add, { companyId: A, addKey: "add-iso-0002", name: "Bo", engagement: "subcontracted", subcontractorId: subB }),
      () => a.as.mutation(api.subcontractors.moveWorker, { companyId: A, cleanerId: added.cleanerId, subcontractorId: subB }),
      () => a.as.mutation(api.subcontractors.setStatus, { companyId: A, subcontractorId: subB, status: "ended", reason: "taken" }),
      () => a.as.mutation(api.crews.addMember, { companyId: A, crewId: crewB, cleanerId: added.cleanerId }),
      () => a.as.mutation(api.crews.create, { companyId: A, name: "Mixed", memberIds: [added.cleanerId, inB.cleanerId] }),
    ];
    for (const call of calls) expect(await refusal(call())).toBe(NOT_FOUND);
    // Nothing of Beta's shows in Alpha's directory, or the other way round.
    expect((await a.as.query(api.workforce.workspace, { companyId: A, asOf: NOW })).rows.map((row) => row.name)).toEqual(["Ann"]);
    expect((await a.as.query(api.subcontractors.list, { companyId: A })).map((row) => row.name)).toEqual(["Alpha Partners"]);
    expect((await b.as.query(api.crews.list, { companyId: b.companyId }))[0].members).toHaveLength(1);
  });
});
