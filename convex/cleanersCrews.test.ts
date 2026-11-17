/**
 * @vitest-environment edge-runtime
 *
 * Phase 3 of the Cleaners workspace: availability as the office keeps it, permanent crews and teams for a
 * job, Dispatch reading the same readiness and availability, and a subcontractor company's contact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, company, HOUR, JOB_END, JOB_START, NOW, PRICE, refusal } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

type S = Awaited<ReturnType<typeof setup>>;
const DAY = 24 * HOUR;
const tokenOf = (url: string) => url.split("/c/portal/")[1];
/** JOB_START is Tuesday, March 2, 2027, 10:00 in Chicago. */
const JOB_DAY = "2027-03-02";

/** A visit a person holds, so Dispatch makes no offers of its own while the test assembles the crew. */
async function heldJob(s: S, fields: { requiredCrew?: number; startsAt?: number; endsAt?: number } = {}) {
  const jobId = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...s.place, serviceType: "standard", scope: "3 bed, 2 bath standard clean", startsAt: JOB_START, endsAt: JOB_END, priceCents: PRICE, ...fields });
  await s.as.mutation(api.dispatch.takeOver, { companyId: s.companyId, jobId });
  await flush(s.t);
  return jobId;
}

const excluded = async (s: S, jobId: Id<"jobs">) => (await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).excluded.map((row) => ({ name: row.name, code: row.code }));
const asked = async (s: S, jobId: Id<"jobs">) => (await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).candidates.map((row) => row.name);

describe("Cleaners: crews, availability and Dispatch", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("assembles a crew for a job from members Dispatch would ask, with conflicts and open places visible", async () => {
    const s = await setup(["Lena", "Rosa", "Mia", "Noor"]);
    const jobId = await heldJob(s, { requiredCrew: 3 });
    const crewId = await s.as.mutation(api.crews.create, { companyId: s.companyId, name: "North", memberIds: [s.cleaners.Lena, s.cleaners.Rosa, s.cleaners.Mia], leadId: s.cleaners.Lena });
    // Mia is away that morning: she stays in the crew, and the crew is not taken as free because it is a crew.
    await s.as.mutation(api.availability.addTimeOff, { companyId: s.companyId, cleanerId: s.cleaners.Mia, startsAt: JOB_START - HOUR, endsAt: JOB_END });

    const view = await s.as.query(api.crews.forJob, { companyId: s.companyId, jobId });
    expect(view.staffing).toMatchObject({ required: 3, accepted: 0, open: 3 });
    const north = view.crews.find((row) => row.crewId === crewId)!;
    expect(north).toMatchObject({ eligible: 2, coversOpen: false });
    expect(north.members.find((row) => row.name === "Mia")).toMatchObject({ eligible: false });
    expect(north.members.find((row) => row.name === "Mia")!.reason).toMatch(/time off/i);
    expect(view.suggestion.kind).toBe("people");
    expect(view.suggestion.words).toContain("3 people are eligible on their own");
    expect(view.people.find((row) => row.name === "Noor")).toMatchObject({ eligible: true, crews: [] });

    // Mia is refused with her reason; the other three are offered through Dispatch and kept as a team.
    const tooMany = await refusal(s.as.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Lena, s.cleaners.Rosa, s.cleaners.Mia, s.cleaners.Noor] }));
    expect(tooMany).toContain("needs 3 more cleaners; you chose 4");
    const result = await s.as.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Rosa, s.cleaners.Mia, s.cleaners.Lena], leadId: s.cleaners.Lena, fromCrewId: crewId });
    expect(result.results.map((row) => [row.name, row.offered])).toEqual([["Lena", true], ["Rosa", true], ["Mia", false]]);
    expect(result.results.find((row) => row.name === "Mia")!.words).toMatch(/^Not offered: This cleaner .*time off/i);
    expect(result.words).toBe("3 places are still without an accepted cleaner; 2 offers are out.");
    const job = await s.job(jobId);
    expect(job.assignments.map((row) => [row.cleanerId, row.status, row.role])).toEqual([
      [s.cleaners.Lena, "offered", "lead"],
      [s.cleaners.Rosa, "offered", "support"],
    ]);
    const team = await s.as.query(api.crews.get, { companyId: s.companyId, crewId: result.crewId! });
    expect(team).toMatchObject({ kind: "temporary", jobId, name: "North for Mar 2" });
    expect(team.members.map((row) => [row.name, row.role])).toEqual([["Lena", "lead"], ["Rosa", "member"]]);

    // Pressing again for the same people offers nobody twice, and the job keeps one team.
    const again = await s.as.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Lena], leadId: s.cleaners.Lena });
    expect(again.results[0]).toMatchObject({ offered: false });
    expect(again.results[0].words).toContain("already has an open offer");
    expect((await s.job(jobId)).assignments).toHaveLength(2);

    // Rosa declines: her place opens again, and Noor is added to the same team, not a second one.
    const rosa = (await s.job(jobId)).assignments.find((row) => row.cleanerId === s.cleaners.Rosa)!;
    await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: rosa._id, answer: "declined" });
    const after = await s.as.query(api.crews.forJob, { companyId: s.companyId, jobId });
    expect(after.people.find((row) => row.name === "Rosa")).toMatchObject({ onJob: null });
    expect(after.people.find((row) => row.name === "Lena")).toMatchObject({ onJob: "offered" });
    const refill = await s.as.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Noor] });
    expect(refill.crewId).toBe(result.crewId);
    const teams = (await s.as.query(api.crews.list, { companyId: s.companyId, asOf: NOW })).filter((row) => row.kind === "temporary");
    expect(teams).toHaveLength(1);
    expect(teams[0].members.map((row) => row.name)).toEqual(["Lena", "Noor", "Rosa"]);
  });

  it("keeps a team for a job as it was when the permanent crew changes, and dates every change of lead", async () => {
    const s = await setup(["Lena", "Rosa", "Mia"]);
    const jobId = await heldJob(s, { requiredCrew: 2 });
    const crewId = await s.as.mutation(api.crews.create, { companyId: s.companyId, name: "North", memberIds: [s.cleaners.Lena, s.cleaners.Rosa], leadId: s.cleaners.Lena });
    expect(await refusal(s.as.mutation(api.crews.create, { companyId: s.companyId, name: "north", memberIds: [s.cleaners.Mia] }))).toContain("already a crew called");
    const { crewId: teamId } = await s.as.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Lena, s.cleaners.Rosa], leadId: s.cleaners.Lena, fromCrewId: crewId });

    vi.advanceTimersByTime(HOUR);
    await s.as.mutation(api.crews.changeMembers, { companyId: s.companyId, crewId, remove: [s.cleaners.Rosa], add: [s.cleaners.Mia], leadId: s.cleaners.Mia });
    const crew = await s.as.query(api.crews.get, { companyId: s.companyId, crewId });
    const shape = (rows: typeof crew.members) => rows.map((row) => `${row.name}:${row.role}`).sort();
    // Now: Lena (no longer lead) and Mia (lead). Ended: Rosa's time in the crew, and Lena's time as lead.
    expect(shape(crew.members.filter((row) => row.to === null))).toEqual(["Lena:member", "Mia:lead"]);
    expect(shape(crew.members.filter((row) => row.to !== null))).toEqual(["Lena:lead", "Rosa:member"]);

    // The team for the job is untouched, and cannot be changed as a crew.
    const team = await s.as.query(api.crews.get, { companyId: s.companyId, crewId: teamId! });
    expect(team.members.filter((row) => row.to === null).map((row) => row.name)).toEqual(["Lena", "Rosa"]);
    expect(await refusal(s.as.mutation(api.crews.changeMembers, { companyId: s.companyId, crewId: teamId!, add: [s.cleaners.Mia] }))).toContain("keeps the people it was assembled with");
    // Nobody is taken off the job by any of this.
    expect((await s.job(jobId)).assignments.map((row) => row.status)).toEqual(["offered", "offered"]);

    // An ended engagement cannot join a crew.
    await s.as.mutation(api.personnel.request, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, kind: "end_engagement", reason: "Moved away." }).then((requestId) =>
      s.as.mutation(api.personnel.decide, { companyId: s.companyId, requestId, decision: "approved" }),
    );
    expect(await refusal(s.as.mutation(api.crews.changeMembers, { companyId: s.companyId, crewId, add: [s.cleaners.Rosa] }))).toContain("engagement has ended");
  });

  it("stops Dispatch offering to a cleaner whose requirements are not met, and reads date exceptions both ways", async () => {
    const s = await setup(["Lena", "Rosa"]);
    const jobId = await heldJob(s);
    expect(await asked(s, jobId)).toEqual(["Lena", "Rosa"]);

    // Rosa is given an identity check she has not done: Dispatch leaves her out with that reason.
    await s.as.mutation(api.workforce.applyTemplateTo, { companyId: s.companyId, cleanerIds: [s.cleaners.Rosa], keys: ["documents"] });
    expect(await excluded(s, jobId)).toEqual([{ name: "Rosa", code: "requirements" }]);
    expect(await refusal(s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId, cleanerId: s.cleaners.Rosa, respondBy: NOW + 4 * HOUR, payCents: 8000 }))).toMatch(/identity documents/i);
    await s.as.mutation(api.requirements.review, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, key: "documents", decision: "waive", note: "Checked in person at the office." });
    expect(await asked(s, jobId)).toEqual(["Lena", "Rosa"]);

    // Lena cannot work that day: a date exception outside her weekly pattern.
    const { exceptionId } = await s.as.mutation(api.availability.addException, { companyId: s.companyId, cleanerId: s.cleaners.Lena, exception: { date: JOB_DAY, kind: "unavailable" }, note: "Family event" });
    expect(await excluded(s, jobId)).toEqual([{ name: "Lena", code: "date_exception" }]);
    await s.as.mutation(api.availability.removeException, { companyId: s.companyId, exceptionId });
    expect(await asked(s, jobId)).toEqual(["Lena", "Rosa"]);

    // A Wednesday job is outside both their weekly hours, until Rosa says she can work that one day.
    const wednesday = await heldJob(s, { startsAt: JOB_START + DAY, endsAt: JOB_END + DAY });
    expect((await excluded(s, wednesday)).map((row) => row.code)).toEqual(["outside_hours", "outside_hours"]);
    await s.as.mutation(api.availability.addException, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, exception: { date: "2027-03-03", kind: "available", startMinute: 9 * 60, endMinute: 13 * 60 } });
    expect(await asked(s, wednesday)).toEqual(["Rosa"]);
    // A date in the past, or half a time range, is refused.
    expect(await refusal(s.as.mutation(api.availability.addException, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, exception: { date: "2027-02-01", kind: "unavailable" } }))).toContain("today or a later date");
    expect(await refusal(s.as.mutation(api.availability.addException, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, exception: { date: JOB_DAY, kind: "unavailable", startMinute: 600 } }))).toContain("both a start and an end");
  });

  it("previews the booked work a change touches before it is saved, and never removes anyone from a job", async () => {
    const s = await setup(["Lena", "Rosa"]);
    const jobId = await heldJob(s);
    const offer = await s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId, cleanerId: s.cleaners.Lena, respondBy: NOW + 4 * HOUR, payCents: 8000 });
    await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: offer, answer: "accepted" });

    const preview = (change: object) => s.as.query(api.availability.preview, { companyId: s.companyId, cleanerId: s.cleaners.Lena, ...change });
    expect(await preview({ timeAway: { startsAt: JOB_START + DAY, endsAt: JOB_END + DAY } })).toEqual([]);
    const away = await preview({ timeAway: { startsAt: JOB_START - HOUR, endsAt: JOB_START + HOUR } });
    expect(away).toHaveLength(1);
    expect(away[0]).toMatchObject({ jobId, status: "accepted", alreadyClashing: false });
    expect(away[0].reason).toMatch(/time away/i);
    // Moving her hours off Tuesday mornings would also leave the visit outside them.
    const hours = await preview({ windows: [{ weekday: 2, startMinute: 13 * 60, endMinute: 17 * 60 }] });
    expect(hours[0].reason).toMatch(/outside the hours they said/i);

    // Saved anyway: the clash is reported, the visit stays hers, and the directory shows it for a person to decide.
    const timeOffId = await s.as.mutation(api.availability.addTimeOff, { companyId: s.companyId, cleanerId: s.cleaners.Lena, startsAt: JOB_START - HOUR, endsAt: JOB_START + HOUR, note: "Dentist" });
    expect((await s.job(jobId)).assignments.find((row) => row.cleanerId === s.cleaners.Lena)!.status).toBe("accepted");
    const { attention } = await s.as.query(api.workforce.directory, { companyId: s.companyId, asOf: NOW });
    expect(attention.some((row) => row.cleanerId === s.cleaners.Lena && row.kind === "conflict")).toBe(true);
    // The preview of taking it away again says this clash is the one already there.
    const undoPreview = await preview({ removeTimeOffId: timeOffId });
    expect(undoPreview).toEqual([]);
    const still = await preview({ timeAway: { startsAt: JOB_START, endsAt: JOB_START + 30 * 60 * 1000 } });
    expect(still[0].alreadyClashing).toBe(true);

    // Confirming hours on the cleaner's behalf says how, and clears "not confirmed".
    await s.as.mutation(api.availability.confirm, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, how: "Called her on Monday" });
    const activity = await s.as.query(api.cleanerProfile.activity, { companyId: s.companyId, cleanerId: s.cleaners.Rosa });
    expect(activity.some((row) => row.text.includes("confirmed as still right (Called her on Monday)"))).toBe(true);

    // Office reads the preview and cannot change anyone's availability.
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    expect(await office.query(api.availability.preview, { companyId: s.companyId, cleanerId: s.cleaners.Lena, timeAway: { startsAt: JOB_START, endsAt: JOB_END } })).toHaveLength(1);
    for (const run of [
      () => office.mutation(api.availability.setWeek, { companyId: s.companyId, cleanerId: s.cleaners.Lena, windows: [] }),
      () => office.mutation(api.availability.addTimeOff, { companyId: s.companyId, cleanerId: s.cleaners.Lena, startsAt: JOB_START, endsAt: JOB_END }),
      () => office.mutation(api.availability.addException, { companyId: s.companyId, cleanerId: s.cleaners.Lena, exception: { date: JOB_DAY, kind: "unavailable" } }),
      () => office.mutation(api.availability.confirm, { companyId: s.companyId, cleanerId: s.cleaners.Lena, how: "x" }),
      () => office.mutation(api.crews.create, { companyId: s.companyId, name: "South", memberIds: [s.cleaners.Rosa] }),
      () => office.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Rosa] }),
    ]) {
      expect(await refusal(run())).toBe(NOT_ALLOWED);
    }
  });

  it("shows a crew member who else is on their job, and a lead the places still open", async () => {
    const s = await setup(["Lena", "Rosa", "Mia"]);
    const jobId = await heldJob(s, { requiredCrew: 3 });
    await s.as.mutation(api.crews.create, { companyId: s.companyId, name: "North", memberIds: [s.cleaners.Lena, s.cleaners.Rosa], leadId: s.cleaners.Lena });
    await s.as.mutation(api.crews.assembleForJob, { companyId: s.companyId, jobId, cleanerIds: [s.cleaners.Lena, s.cleaners.Rosa, s.cleaners.Mia], leadId: s.cleaners.Lena });
    for (const row of (await s.job(jobId)).assignments.filter((item) => item.cleanerId !== s.cleaners.Mia)) {
      await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: row._id, answer: "accepted" });
    }
    const portal = async (cleanerId: Id<"cleaners">) => {
      const { linkId } = (await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId })) as { linkId: Id<"portalLinks"> };
      const { url } = await s.as.mutation(api.portalAccess.reveal, { companyId: s.companyId, linkId });
      return s.t.query(api.portal.view, { token: tokenOf(url), asOf: NOW });
    };
    const lena = await portal(s.cleaners.Lena);
    if (lena.state !== "active") throw new Error(lena.state);
    expect(lena.jobs[0].team).toEqual({ with: ["Rosa"], lead: true, open: 1, offersOut: 1 });
    expect(lena.crews).toEqual([{ name: "North", lead: true, with: ["Rosa"] }]);
    const rosa = await portal(s.cleaners.Rosa);
    if (rosa.state !== "active") throw new Error(rosa.state);
    expect(rosa.jobs[0].team).toMatchObject({ with: ["Lena (lead)"], lead: false });
    // Mia has only an offer: no team, and the area rather than the street.
    const mia = await portal(s.cleaners.Mia);
    if (mia.state !== "active") throw new Error(mia.state);
    expect(mia.jobs[0]).toMatchObject({ status: "offered", team: null, where: "Austin 78701" });
  });

  it("gives a subcontractor's contact their own workers and nothing else, and ends access with the relationship", async () => {
    const s = await setup(["Lena"]);
    {
      const subId = await s.as.mutation(api.subcontractors.create, { companyId: s.companyId, name: "Bright Crew LLC", contact: { name: "Ana Ortiz", email: "ana@brightcrew.example" } });
      const { cleanerId: worker } = await s.as.mutation(api.workforce.add, { companyId: s.companyId, person: { name: "Tomas Reyes", engagement: "subcontractor", subcontractorId: subId, phone: "+15550109090", serviceAreas: ["78701"] }, windows: [{ weekday: 2, startMinute: 480, endMinute: 1020 }] });

      const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
      expect(await refusal(office.mutation(api.portalAccess.inviteContact, { companyId: s.companyId, subcontractorId: subId }))).toBe(NOT_ALLOWED);
      // Selestial does not message a contact yet: the link is made and the office sends it, which is recorded.
      const first = await s.as.mutation(api.portalAccess.inviteContact, { companyId: s.companyId, subcontractorId: subId });
      expect(first).toMatchObject({ status: "link_ready" });
      expect(first.words).toContain("send it to Ana Ortiz yourself");
      expect(await s.as.mutation(api.portalAccess.inviteContact, { companyId: s.companyId, subcontractorId: subId })).toMatchObject({ status: "already", linkId: first.linkId });
      const access = await s.as.query(api.portalAccess.contactAccess, { companyId: s.companyId, subcontractorId: subId });
      expect(access.links.map((row) => row.state)).toEqual(["active"]);
      const { url } = await s.as.mutation(api.portalAccess.reveal, { companyId: s.companyId, linkId: access.links[0].linkId });
      const token = tokenOf(url);

      const view = await s.t.query(api.contactPortal.view, { token, asOf: NOW });
      if (view.state !== "active") throw new Error(view.state);
      expect(view.subcontractor).toBe("Bright Crew LLC");
      expect(view.workers.map((row) => row.name)).toEqual(["Tomas Reyes"]);
      // What is still needed, by name; never the files or the notes.
      expect(view.workers[0].ready).toBe(false);
      expect(view.workers[0].needs.length).toBeGreaterThan(0);
      expect(JSON.stringify(view)).not.toContain("Lena");
      expect(view.allowed).toEqual(["add_time_away", "ask_for_help"]);
      // The cleaner portal's own functions refuse a contact's link.
      expect((await s.t.query(api.portal.view, { token, asOf: NOW })).state).toBe("subcontractor");
      expect(await refusal(s.t.mutation(api.portal.requestCode, { token }))).toBe(NOT_ALLOWED);

      // Telling the office a worker will be away: their own worker only, and anyone else is "Not found.".
      await s.t.mutation(api.contactPortal.addTimeAway, { token, cleanerId: worker, startsAt: JOB_START, endsAt: JOB_END, note: "Visa appointment" });
      expect(await refusal(s.t.mutation(api.contactPortal.addTimeAway, { token, cleanerId: s.cleaners.Lena, startsAt: JOB_START, endsAt: JOB_END }))).toBe(NOT_FOUND);
      const other = await company(s.t, "owner-b", "Beta Cleaning");
      const { cleanerId: elsewhere } = await other.as.mutation(api.workforce.add, { companyId: other.companyId, person: { name: "Kai Moss", engagement: "contractor" } });
      expect(await refusal(s.t.mutation(api.contactPortal.addTimeAway, { token, cleanerId: elsewhere, startsAt: JOB_START, endsAt: JOB_END }))).toBe(NOT_FOUND);

      // A cleaner's link is not a contact's.
      const { linkId } = (await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId: s.cleaners.Lena })) as { linkId: Id<"portalLinks"> };
      const cleanerToken = tokenOf((await s.as.mutation(api.portalAccess.reveal, { companyId: s.companyId, linkId })).url);
      expect((await s.t.query(api.contactPortal.view, { token: cleanerToken, asOf: NOW })).state).toBe("not_contact");
      expect(await refusal(s.t.mutation(api.contactPortal.addTimeAway, { token: cleanerToken, cleanerId: worker, startsAt: JOB_START, endsAt: JOB_END }))).toContain("not a subcontractor company");

      // Ending the relationship ends the contact's access. The worker keeps their record.
      await s.as.mutation(api.subcontractors.setStatus, { companyId: s.companyId, subcontractorId: subId, status: "ended", reason: "Contract finished." });
      expect((await s.t.query(api.contactPortal.view, { token, asOf: NOW })).state).toBe("revoked");
      expect(await refusal(s.t.mutation(api.contactPortal.askForHelp, { token, text: "Hello?" }))).toContain("no longer active");
      expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: worker, asOf: NOW })).name).toBe("Tomas Reyes");
    }
  });

  it("answers another company's crews, jobs and previews exactly like missing ones", async () => {
    const s = await setup(["Lena"]);
    const jobId = await heldJob(s);
    const crewId = await s.as.mutation(api.crews.create, { companyId: s.companyId, name: "North", memberIds: [s.cleaners.Lena] });
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    const B = other.companyId;
    for (const run of [
      () => other.as.query(api.crews.get, { companyId: B, crewId }),
      () => other.as.query(api.crews.forJob, { companyId: B, jobId }),
      () => other.as.mutation(api.crews.assembleForJob, { companyId: B, jobId, cleanerIds: [s.cleaners.Lena] }),
      () => other.as.mutation(api.crews.changeMembers, { companyId: B, crewId, remove: [s.cleaners.Lena] }),
      () => other.as.mutation(api.crews.archive, { companyId: B, crewId }),
      () => other.as.query(api.availability.preview, { companyId: B, cleanerId: s.cleaners.Lena, timeAway: { startsAt: JOB_START, endsAt: JOB_END } }),
      () => other.as.mutation(api.availability.addException, { companyId: B, cleanerId: s.cleaners.Lena, exception: { date: JOB_DAY, kind: "unavailable" } }),
      () => other.as.mutation(api.availability.confirm, { companyId: B, cleanerId: s.cleaners.Lena, how: "x" }),
    ]) {
      expect(await refusal(run())).toBe(NOT_FOUND);
    }
    // Nor can a crew in B take A's cleaner.
    const { cleanerId: own } = await other.as.mutation(api.workforce.add, { companyId: B, person: { name: "Kai Moss", engagement: "contractor" } });
    expect(await refusal(other.as.mutation(api.crews.create, { companyId: B, name: "Mixed", memberIds: [own, s.cleaners.Lena] }))).toBe(NOT_FOUND);
  });
});
