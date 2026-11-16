/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { company, HOUR, JOB_END, JOB_START, NOW, readyCleaner, refusal, seedVisit, start, TUESDAY } from "../tests/harness";
import { api, internal } from "./_generated/api";

const respondBy = NOW + 4 * HOUR;

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const seeded = await seedVisit(as, companyId);
  const job = () => as.query(api.jobs.get, { companyId, jobId: seeded.jobId });
  const offer = (cleanerId = seeded.cleanerId, jobId = seeded.jobId) => as.mutation(api.assignments.offer, { companyId, jobId, cleanerId, respondBy, payCents: 7200 });
  return { t, as, companyId, ...seeded, job, offer };
}

describe("jobs and assignments", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats a job as covered only when a cleaner accepts", async () => {
    const s = await setup();
    expect((await s.job()).coverage).toBe("uncovered");
    // Scheduled never meant covered: the job cannot start without an accepted cleaner.
    expect(await refusal(s.as.mutation(api.jobs.start, { companyId: s.companyId, jobId: s.jobId }))).toContain("No cleaner has accepted");

    const assignmentId = await s.offer();
    const offered = await s.job();
    expect(offered.coverage).toBe("offered");
    expect(offered.job.status).toBe("scheduled");
    // The offer keeps what the cleaner was told: the scope and their own pay.
    expect(offered.assignments[0]).toMatchObject({ status: "offered", scope: "3 bed, 2 bath standard clean", payCents: 7200, respondBy });
    expect(await refusal(s.as.mutation(api.jobs.start, { companyId: s.companyId, jobId: s.jobId }))).toContain("No cleaner has accepted");

    expect(await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId, answer: "accepted" })).toEqual({ status: "accepted" });
    const covered = await s.job();
    expect(covered.coverage).toBe("covered");
    expect(covered.job.status).toBe("scheduled");

    await s.as.mutation(api.jobs.start, { companyId: s.companyId, jobId: s.jobId });
    await s.as.mutation(api.jobs.closeWithoutReview, { companyId: s.companyId, jobId: s.jobId, reason: "Done without the cleaner link; the owner checked in person." });
    const done = await s.job();
    expect(done.job.status).toBe("completed");
    // Completing the service does not rewrite the assignment, and a finished job cannot be reopened.
    expect(done.assignments[0].status).toBe("accepted");
    expect(await refusal(s.as.mutation(api.jobs.cancel, { companyId: s.companyId, jobId: s.jobId, reason: "oops" }))).toContain("cannot become cancelled");

    const history = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "assignments", id: assignmentId } });
    expect(history.map((event) => event.type)).toEqual(["assignment.offered", "assignment.accepted"]);
    expect(history[0].actor.kind).toBe("member");
  });

  it("leaves a recoverable job when the cleaner declines or drops out", async () => {
    const s = await setup();
    const first = await s.offer();
    expect(await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: first, answer: "declined" })).toEqual({ status: "declined" });
    expect((await s.job()).coverage).toBe("uncovered");
    expect(await refusal(s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: first, answer: "accepted" }))).toContain("declined");

    // The next eligible cleaner can be offered the same job.
    const lena = await readyCleaner(s.as, s.companyId, "Lena");
    const second = await s.offer(lena);
    await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: second, answer: "accepted" });
    expect((await s.job()).coverage).toBe("covered");

    // She drops out: the job is still scheduled, plainly uncovered, and can be offered again.
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: second, reason: "Cleaner is sick" });
    const after = await s.job();
    expect(after.job.status).toBe("scheduled");
    expect(after.coverage).toBe("uncovered");
    expect(after.assignments.map((row) => row.status).sort()).toEqual(["cancelled", "declined"]);
    await s.offer(s.cleanerId);
    expect((await s.job()).coverage).toBe("offered");
  });

  it("never offers a cleaner a time they cannot work", async () => {
    const s = await setup();
    const { as, companyId } = s;

    const onboarding = await as.mutation(api.cleaners.create, { companyId, name: "New", engagement: "employee" });
    expect(await refusal(s.offer(onboarding))).toContain("not marked ready");

    const noHours = await as.mutation(api.cleaners.create, { companyId, name: "No hours", engagement: "contractor" });
    await as.mutation(api.cleaners.setStatus, { companyId, cleanerId: noHours, status: "ready" });
    expect(await refusal(s.offer(noHours))).toContain("has not said they can work");

    const mornings = await readyCleaner(as, companyId, "Mornings");
    await as.mutation(api.availability.setWeek, { companyId, cleanerId: mornings, windows: [{ weekday: TUESDAY, startMinute: 6 * 60, endMinute: 11 * 60 }] });
    expect(await refusal(s.offer(mornings))).toContain("has not said they can work");

    const away = await readyCleaner(as, companyId, "Away");
    const timeOffId = await as.mutation(api.availability.addTimeOff, { companyId, cleanerId: away, startsAt: JOB_START - HOUR, endsAt: JOB_START + HOUR });
    expect(await refusal(s.offer(away))).toContain("time off");
    await as.mutation(api.availability.removeTimeOff, { companyId, timeOffId });
    await s.offer(away);

    // Skills the job needs.
    const deepJob = await as.mutation(api.jobs.create, { companyId, customerId: s.customerId, propertyId: s.propertyId, serviceType: "deep", scope: "Deep clean", requiredSkills: ["Deep Clean"], startsAt: JOB_START, endsAt: JOB_END });
    expect(await refusal(s.offer(s.cleanerId, deepJob))).toContain("deep clean");

    // One cleaner cannot hold two jobs at the same time, whether offered or accepted.
    const overlapping = await as.mutation(api.jobs.create, { companyId, customerId: s.customerId, propertyId: s.propertyId, serviceType: "standard", scope: "Second home", startsAt: JOB_START + HOUR, endsAt: JOB_END + HOUR });
    await s.offer(s.cleanerId);
    expect(await refusal(s.offer(s.cleanerId))).toContain("already has an open offer");
    expect(await refusal(s.offer(s.cleanerId, overlapping))).toContain("overlaps");
    // Back to back leaves no time between jobs. A person may set that rule aside for one offer, by saying so.
    const after = await as.mutation(api.jobs.create, { companyId, customerId: s.customerId, propertyId: s.propertyId, serviceType: "standard", scope: "Later", startsAt: JOB_END, endsAt: JOB_END + HOUR });
    expect(await refusal(s.offer(s.cleanerId, after))).toContain("within 30 minutes");
    const tight = await as.mutation(api.assignments.offer, { companyId, jobId: after, cleanerId: s.cleanerId, respondBy, payCents: 7200, allowTightSchedule: true });
    const offered = (await as.query(api.events.forSubject, { companyId, subject: { table: "assignments", id: tight } }))[0];
    expect(offered.data).toMatchObject({ timeBetweenJobsSetAside: true });
    // Setting the time between jobs aside never allows a real overlap.
    expect(await refusal(as.mutation(api.assignments.offer, { companyId, jobId: overlapping, cleanerId: s.cleanerId, respondBy, payCents: 7200, allowTightSchedule: true }))).toContain("overlaps");

    // Deadlines and pay are checked numbers.
    const lena = await readyCleaner(as, companyId, "Lena");
    const bad = (fields: { respondBy?: number; payCents?: number }) => as.mutation(api.assignments.offer, { companyId, jobId: s.jobId, cleanerId: lena, respondBy, payCents: 7200, ...fields });
    expect(await refusal(bad({ respondBy: NOW - 1 }))).toContain("in the future");
    expect(await refusal(bad({ respondBy: JOB_START + 1 }))).toContain("before the job starts");
    expect(await refusal(bad({ payCents: 72.5 }))).toContain("whole number of cents");
    expect(await refusal(bad({ payCents: -1 }))).toContain("whole number of cents");
  });

  it("gives a job to one cleaner and withdraws the other offers", async () => {
    const s = await setup();
    const lena = await readyCleaner(s.as, s.companyId, "Lena");
    const first = await s.offer();
    const second = await s.offer(lena);
    await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: second, answer: "accepted" });

    const state = await s.job();
    expect(state.assignments.find((row) => row._id === first)).toMatchObject({ status: "cancelled", endReason: "Another cleaner accepted the job." });
    expect(await refusal(s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: first, answer: "accepted" }))).toContain("cancelled");
    const third = await readyCleaner(s.as, s.companyId, "Third");
    expect(await refusal(s.offer(third))).toContain("already accepted");
  });

  it("expires an unanswered offer and does not count a late answer", async () => {
    const s = await setup();
    const lena = await readyCleaner(s.as, s.companyId, "Lena");
    const first = await s.offer();
    const second = await s.offer(lena);

    vi.setSystemTime(respondBy + 1);
    // A late "yes" is recorded as expired, and the caller is told.
    expect(await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: first, answer: "accepted" })).toEqual({ status: "expired" });
    // The schedule expires the rest.
    expect(await s.t.mutation(internal.assignments.expireDue, {})).toBe(1);
    expect(await s.t.mutation(internal.assignments.expireDue, {})).toBe(0);

    const state = await s.job();
    expect(state.assignments.map((row) => row.status)).toEqual(["expired", "expired"]);
    expect(state.coverage).toBe("uncovered");
    const history = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "assignments", id: second } });
    expect(history.at(-1)).toMatchObject({ type: "assignment.expired", actor: { kind: "system" } });
  });

  it("does not move or cancel a job underneath a cleaner silently", async () => {
    const s = await setup();
    const assignmentId = await s.offer();
    const move = () => s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId: s.jobId, startsAt: JOB_START + HOUR, endsAt: JOB_END + HOUR });
    // The move is refused until a person has seen what it does to the cleaner who holds an offer.
    expect(await refusal(move())).toContain("Review what the move does to them");
    expect((await s.job()).job.startsAt).toBe(JOB_START);
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId, reason: "Customer moved the time" });
    await move();
    expect((await s.job()).job.startsAt).toBe(JOB_START + HOUR);

    const again = await s.offer();
    await s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId: again, answer: "accepted" });
    await s.as.mutation(api.jobs.cancel, { companyId: s.companyId, jobId: s.jobId, reason: "Customer cancelled" });
    const state = await s.job();
    expect(state.job).toMatchObject({ status: "cancelled", cancelReason: "Customer cancelled" });
    expect(state.assignments.find((row) => row._id === again)).toMatchObject({ status: "cancelled", endReason: "The job was cancelled." });
    expect(await refusal(s.offer())).toContain("Only a scheduled job");
  });

  it("checks a job's own facts", async () => {
    const s = await setup();
    const other = await s.as.mutation(api.customers.create, { companyId: s.companyId, name: "Other", kind: "commercial" });
    const make = (fields: object) => s.as.mutation(api.jobs.create, { companyId: s.companyId, customerId: s.customerId, propertyId: s.propertyId, serviceType: "standard", scope: "x", startsAt: JOB_START, endsAt: JOB_END, ...fields });
    expect(await refusal(make({ customerId: other }))).toContain("different customer");
    expect(await refusal(make({ endsAt: JOB_START }))).toContain("start before it ends");
    expect(await refusal(make({ startsAt: 1.5 }))).toContain("not a valid time");
    expect(await refusal(make({ scope: "  " }))).toContain("Scope is required");
    const listed = await s.as.query(api.jobs.list, { companyId: s.companyId, from: JOB_START, to: JOB_END });
    expect(listed.map((row) => row.coverage)).toEqual(["uncovered"]);
  });
});
