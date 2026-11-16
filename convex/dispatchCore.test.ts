/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { accepted, dispatchTestEnv, flush, PHONES, setup } from "../tests/dispatchHarness";
import { addMember, company, HOUR, JOB_END, JOB_START, NOW, PRICE, refusal } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockOutbox } from "./lib/messaging/provider";

type S = Awaited<ReturnType<typeof setup>>;

/** A visit a person holds, so Dispatch makes no offers of its own while the test makes them by hand. */
async function heldJob(s: S, fields: { requiredCrew?: number; instructions?: string; arrivalWindowMinutes?: number; hardDeadlineAt?: number } = {}) {
  const jobId = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...s.place, serviceType: "standard", scope: "3 bed, 2 bath standard clean", startsAt: JOB_START, endsAt: JOB_END, priceCents: PRICE, ...fields });
  await s.as.mutation(api.dispatch.takeOver, { companyId: s.companyId, jobId });
  await flush(s.t);
  return jobId;
}

const offer = (s: S, jobId: Id<"jobs">, name: keyof typeof PHONES, payCents = 8000) => s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId, cleanerId: s.cleaners[name], respondBy: NOW + 4 * HOUR, payCents });
const answer = (s: S, assignmentId: Id<"assignments">, value: "accepted" | "declined" = "accepted") => s.as.mutation(api.assignments.recordAnswer, { companyId: s.companyId, assignmentId, answer: value });

/** What each owner-facing read says about one job's staffing. They must never disagree. */
async function everywhere(s: S, jobId: Id<"jobs">) {
  const candidates = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId });
  const visit = (await s.as.query(api.overview.schedule, { companyId: s.companyId, asOf: NOW, view: "tomorrow" })).visits.find((row) => row.jobId === jobId)!;
  const detail = await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "job", id: jobId }, asOf: NOW });
  return {
    candidates: candidates.coverage,
    counted: `${candidates.staffing.accepted}/${candidates.staffing.required}`,
    job: (await s.job(jobId)).coverage,
    board: (await s.board(jobId)).group,
    visit: visit.state,
    visitCrew: visit.crew,
    detail: detail.status.label,
    detailCrew: detail.job!.assignments.filter((row) => row.status === "accepted").map((row) => `${row.cleaner}:${row.role}`),
  };
}

describe("Dispatch: one staffing count, a reviewed completion, and a guided move", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("keeps a three-cleaner job partial at 1 of 3 and 2 of 3 on every read, and never overfills the last place", async () => {
    const s = await setup(["Lena", "Rosa", "Mia", "Noor"]);
    const jobId = await heldJob(s, { requiredCrew: 3 });
    expect(await everywhere(s, jobId)).toMatchObject({ candidates: "uncovered", counted: "0/3", job: "uncovered", board: "needs_staffing", visit: "needs_coverage", detail: "Needs coverage" });

    await answer(s, await offer(s, jobId, "Lena"));
    expect(await everywhere(s, jobId)).toEqual({ candidates: "uncovered", counted: "1/3", job: "uncovered", board: "partially_staffed", visit: "partly_staffed", visitCrew: ["Lena"], detail: "Partly staffed · 1 of 3", detailCrew: ["Lena:lead"] });
    // One acceptance is not coverage, so the visit cannot be started and today's count does not include it.
    expect(await refusal(s.as.mutation(api.jobs.start, { companyId: s.companyId, jobId }))).toBe("Not every place on this job has an accepted cleaner yet, so it cannot start.");

    // Lena is on the job, so she is not offered as a candidate for its other places, and the run trace
    // does not call a visit covered that has one of its three cleaners.
    const partial = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId });
    expect(partial.candidates.map((row) => row.name)).not.toContain("Lena");
    expect(partial.excluded.find((row) => row.name === "Lena")).toMatchObject({ code: "on_this_job", reason: "has already accepted this visit" });
    const run = (await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "job", id: jobId }, asOf: NOW })).job!.run;
    expect(run.at(-1)).toMatchObject({ key: "accept", state: "todo", detail: "Lena accepted: 1 of 3 places. The visit is not covered until every place is accepted." });
    expect(run.map((row) => row.detail).join(" ")).not.toContain("The visit is covered");

    // The owner can still staff the remaining places: an acceptance does not close the job to offers.
    const rosa = await offer(s, jobId, "Rosa");
    expect(await everywhere(s, jobId)).toMatchObject({ candidates: "offered", counted: "1/3", board: "offers_out", visit: "awaiting_acceptance", detail: "Partly staffed · 1 of 3" });
    await answer(s, rosa);
    expect(await everywhere(s, jobId)).toMatchObject({ candidates: "uncovered", counted: "2/3", job: "uncovered", board: "partially_staffed", visit: "partly_staffed", visitCrew: ["Lena", "Rosa"], detail: "Partly staffed · 2 of 3" });

    // Two cleaners are asked for the one place left. The first answer takes it; the second is refused.
    const [mia, noor] = [await offer(s, jobId, "Mia"), await offer(s, jobId, "Noor")];
    expect(await answer(s, mia)).toEqual({ status: "accepted" });
    expect(await refusal(answer(s, noor))).toBe("This offer is cancelled, so it can no longer be answered.");
    expect(await everywhere(s, jobId)).toMatchObject({ candidates: "covered", counted: "3/3", job: "covered", board: "fully_staffed", visit: "accepted", detail: "Fully staffed · 3 of 3", detailCrew: expect.arrayContaining(["Lena:lead", "Rosa:support", "Mia:support"]) });
    expect(await refusal(offer(s, jobId, "Noor"))).toBe("This job already has every cleaner it needs.");
    const full = (await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "job", id: jobId }, asOf: NOW })).job!.run;
    expect(full.at(-1)!.detail).toContain("All 3 places are accepted.");
    expect((await s.job(jobId)).assignments.filter((row) => row.status === "accepted")).toHaveLength(3);
  });

  it("moves a visit in one step: offers withdrawn, the crew asked again, and a stale preview refused", async () => {
    const s = await setup(["Lena", "Rosa"]);
    const jobId = await heldJob(s, { requiredCrew: 2 });
    const lena = await offer(s, jobId, "Lena", 9100);
    await answer(s, lena);
    const rosa = await offer(s, jobId, "Rosa");
    await flush(s.t);

    const to = { startsAt: JOB_START + HOUR, endsAt: JOB_END + HOUR };
    const preview = await s.as.query(api.jobs.reschedulePreview, { companyId: s.companyId, jobId, ...to });
    expect(preview).toMatchObject({ problems: [], proposalsClosed: 0, placesOpenAfter: 2, from: { startsAt: JOB_START }, to });
    expect(preview.offersWithdrawn.map((row) => row.name)).toEqual(["Rosa"]);
    expect(preview.crew).toMatchObject([{ name: "Lena", role: "lead", payCents: 9100, outcome: "asked_again", reason: null }]);

    // A move that touches someone's agreement needs the preview's version, and the version must still be true.
    expect(await refusal(s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, ...to }))).toContain("Review what the move does to them");
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: rosa, reason: "Asked someone else", keepWithMe: true });
    expect(await refusal(s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, ...to, version: preview.version }))).toContain("changed since you looked");
    expect((await s.job(jobId)).job.startsAt).toBe(JOB_START);

    const rosaAgain = await offer(s, jobId, "Rosa");
    const fresh = await s.as.query(api.jobs.reschedulePreview, { companyId: s.companyId, jobId, ...to });
    expect(await s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, ...to, version: fresh.version })).toEqual({ offersWithdrawn: 1, askedAgain: 1, placesReopened: 0 });
    await flush(s.t);

    const moved = await s.job(jobId);
    expect(moved.job).toMatchObject(to);
    expect(moved.assignments.find((row) => row._id === lena)).toMatchObject({ status: "cancelled", endCause: "job_moved" });
    expect(moved.assignments.find((row) => row._id === rosaAgain)).toMatchObject({ status: "cancelled", endCause: "job_moved" });
    // Lena is not accepted for a time she never agreed to. She is asked again, as lead, at the pay she accepted.
    const asked = moved.assignments.filter((row) => row.status === "offered");
    expect(asked).toMatchObject([{ cleanerId: s.cleaners.Lena, payCents: 9100, role: "lead", jobStartsAt: to.startsAt }]);
    expect(moved.staffing).toMatchObject({ required: 2, accepted: 0, offersOut: 1 });
    const toLena = mockOutbox.filter((row) => row.to === PHONES.Lena).at(-1)!;
    expect(toLena.body).toContain("Alpha Cleaning: the job you accepted has moved. Please confirm the new time. standard, Tue, Mar 2 at 11:00 AM");
    expect(mockOutbox.filter((row) => row.to === PHONES.Rosa).at(-1)!.body).toContain("is no longer open");
    // Her old link is closed, and being moved does not count against asking Rosa again.
    expect((await s.record(jobId)).links.filter((link) => link.assignmentId === lena).every((link) => link.status === "revoked")).toBe(true);
    await answer(s, asked[0]._id);
    await offer(s, jobId, "Rosa");

    // A time outside her hours: she cannot be asked, so the preview says her place reopens, and why.
    const evening = { startsAt: JOB_START + 9 * HOUR, endsAt: JOB_END + 9 * HOUR };
    const late = await s.as.query(api.jobs.reschedulePreview, { companyId: s.companyId, jobId, ...evening });
    expect(late.crew).toMatchObject([{ name: "Lena", outcome: "place_reopens", respondBy: null }]);
    expect(late.crew[0].reason).toMatch(/^This cleaner /);
    expect(await s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, ...evening, version: late.version })).toEqual({ offersWithdrawn: 1, askedAgain: 0, placesReopened: 1 });
    expect((await s.job(jobId)).staffing).toMatchObject({ accepted: 0, offersOut: 0, open: 2 });

    // A visit nobody holds is simply moved, and the past is never a new time.
    const back = await s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, ...to });
    expect(back).toEqual({ offersWithdrawn: 0, askedAgain: 0, placesReopened: 0 });
    expect(await refusal(s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, startsAt: NOW - HOUR, endsAt: NOW }))).toBe("The new start must be in the future.");
  });

  it("closes a visit only by a person's review, and sends it back without closing it", async () => {
    const s = await setup();
    const a = await accepted(s);
    const office = await addMember(s.t, s.as, s.companyId, "office-1", "office");
    const review = (as: typeof s.as, decision: "close" | "return", note?: string) => as.mutation(api.jobs.reviewCompletion, { companyId: s.companyId, jobId: a.jobId, decision, note });
    const submit = async () => {
      for (const item of (await s.t.query(api.links.job, { token: a.jobToken })).detail!.checklist) await s.t.mutation(api.links.setChecklistItem, { token: a.jobToken, itemId: item.id, state: "done" });
      return s.t.mutation(api.links.submitJob, { token: a.jobToken, incomplete: false });
    };

    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken });
    // Underway is not reported, and reported is not reviewed.
    expect(await refusal(review(s.as, "close"))).toBe("The crew has not all reported this visit done yet, so there is nothing to review.");
    expect(await submit()).toMatchObject({ status: "submitted_for_review" });
    expect((await s.job(a.jobId)).job.status).toBe("in_progress");
    expect(await refusal(review(office, "close"))).toBe("Not allowed.");

    // Sent back: the visit stays open, the crew's report is cleared, and the cleaner can submit again.
    expect(await refusal(review(s.as, "return"))).toBe("Say what needs correcting, so the crew knows.");
    expect(await review(s.as, "return", "The oven was missed.")).toEqual({ status: "returned" });
    let state = await s.job(a.jobId);
    expect(state.job).toMatchObject({ status: "in_progress", completionReturns: 1 });
    expect(state.job.completionReportedAt).toBeUndefined();
    expect(state.assignments[0].completion).toBeUndefined();
    expect((await s.tasks("needs_decision")).filter((task) => task.handoffTo === "quality")).toEqual([]);
    expect((await s.tasks("done")).find((task) => task.handoffTo === "quality")!.outcome).toBe("Sent back for correction: The oven was missed.");
    expect(await refusal(review(s.as, "close"))).toContain("nothing to review");
    expect(await submit()).toMatchObject({ status: "submitted_for_review" });
    expect((await s.tasks("needs_decision")).filter((task) => task.handoffTo === "quality")).toHaveLength(1);

    // A report from the job that nobody decided stops the visit from being closed.
    const detail = await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "job", id: a.jobId }, asOf: JOB_START });
    expect(detail.status.label).toBe("Awaiting completion review");
    expect(detail.job!.completion).toMatchObject({ crew: [{ cleaner: "Lena", incomplete: false }], reports: [] });
    expect(detail.job!.completion.crew[0].submittedAt).not.toBeNull();

    expect(await review(s.as, "close", "Checked the photos.")).toEqual({ status: "closed" });
    state = await s.job(a.jobId);
    expect(state.job).toMatchObject({ status: "completed", completionReview: { decision: "closed", note: "Checked the photos." } });
    expect((await s.tasks("needs_decision")).filter((task) => task.handoffTo === "quality")).toEqual([]);
    const types = (await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "jobs", id: a.jobId } })).map((event) => event.type);
    expect(types).toEqual(expect.arrayContaining(["job.completion_reported", "job.completion_returned", "job.completed"]));
    expect(types).not.toContain("job.closed_without_review");
    expect(types.join(" ")).not.toMatch(/pay|payout|invoice/);
  });

  it("keeps the override apart from a review: it needs a manager and a reason, and says what it was", async () => {
    const s = await setup();
    const jobId = await heldJob(s);
    await answer(s, await offer(s, jobId, "Lena"));
    await s.as.mutation(api.jobs.start, { companyId: s.companyId, jobId });
    const office = await addMember(s.t, s.as, s.companyId, "office-1", "office");
    const close = (as: typeof s.as, reason: string) => as.mutation(api.jobs.closeWithoutReview, { companyId: s.companyId, jobId, reason });
    expect(await refusal(close(office, "The owner checked the home in person."))).toBe("Not allowed.");
    expect(await refusal(close(s.as, "ok"))).toBe("Give the reason this visit is closed without a review, in a sentence.");
    await close(s.as, "The owner checked the home in person.");
    expect((await s.job(jobId)).job).toMatchObject({ status: "completed", completionReview: { decision: "closed_without_review", note: "The owner checked the home in person." } });
    const events = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "jobs", id: jobId } });
    expect(events.find((event) => event.type === "job.closed_without_review")!.data).toMatchObject({ reason: "The owner checked the home in person.", crewReported: false });
    const detail = await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "job", id: jobId }, asOf: NOW });
    expect(detail.situation[0]).toBe("The visit was closed without a review of the crew's evidence. The reason given: The owner checked the home in person.");
  });

  it("changes a visit's details without changing what a cleaner already agreed to", async () => {
    const s = await setup(["Lena", "Rosa"]);
    const deadline = JOB_END + 2 * HOUR;
    const jobId = await heldJob(s, { requiredCrew: 2, instructions: "Gate code 4411.", arrivalWindowMinutes: 30, hardDeadlineAt: deadline });
    // The fields the form now sends are stored, and read back where a person looks.
    const detail = await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "job", id: jobId }, asOf: NOW });
    const fact = (label: string) => detail.context.find((row) => row.label === label)!.value;
    expect([fact("Cleaners needed"), fact("Crew instructions"), fact("Arrival"), fact("Must finish by")]).toEqual(["2 · 0 accepted", "Gate code 4411.", "Any time from tomorrow at 10:00 AM to 10:30 AM", "tomorrow at 2:00 PM"]);

    const edit = (fields: Record<string, unknown>, expectedStartsAt = JOB_START) => s.as.mutation(api.jobs.edit, { companyId: s.companyId, jobId, expectedStartsAt, ...fields });
    expect(await edit({ scope: "4 bed deep clean", instructions: "Gate code 5522." })).toEqual({ changed: ["scope", "instructions"] });
    expect(await refusal(edit({ instructions: "x" }, JOB_START + 1))).toContain("was moved since you opened it");

    await answer(s, await offer(s, jobId, "Lena"));
    await answer(s, await offer(s, jobId, "Rosa"));
    // Two cleaners agreed to this scope and this arrival time.
    expect(await refusal(edit({ scope: "Whole house" }))).toContain("before changing the scope");
    expect(await refusal(edit({ arrivalWindowMinutes: 60 }))).toContain("Move the visit to change when they arrive");
    expect(await refusal(edit({ requiredCrew: 1 }))).toBe("2 cleaners have already accepted this visit. Release one before lowering the number it needs.");
    expect(await refusal(edit({ hardDeadlineAt: JOB_END - 1 }))).toContain("at or after the visit's end");
    // What they were not told can still change, and a third place reopens the visit.
    expect(await edit({ instructions: "Gate code 6633.", priceCents: 21000, requiredCrew: 3, scope: "4 bed deep clean" })).toEqual({ changed: ["price", "crew", "instructions"] });
    const after = await s.job(jobId);
    expect(after.job).toMatchObject({ scope: "4 bed deep clean", instructions: "Gate code 6633.", priceCents: 21000, requiredCrew: 3 });
    expect(after.coverage).toBe("uncovered");
    expect(after.staffing).toMatchObject({ required: 3, accepted: 2, open: 1, state: "partial" });
  });
});

describe("Dispatch: what a person does on the day", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("texts a cleaner who has not checked in at most once a quarter hour, and records a drop-out as one", async () => {
    const s = await setup();
    const a = await accepted(s);
    const office = await addMember(s.t, s.as, s.companyId, "office-2", "office");
    vi.setSystemTime(JOB_START + 5 * 60_000);
    const ask = (as: typeof s.as) => as.mutation(api.dispatchOps.askCleaner, { companyId: s.companyId, assignmentId: a.assignmentId });
    expect(await refusal(ask(office))).toBe("Not allowed.");
    const before = mockOutbox.length;
    expect(await ask(s.as)).toMatchObject({ repeated: false, problem: null });
    expect(await ask(s.as)).toMatchObject({ repeated: true });
    await flush(s.t);
    const sent = mockOutbox.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatch(/^Alpha Cleaning: we don't have a check-in for your 10:00 AM job yet\. .*\/c\/job\/.*\/delay$/);
    vi.setSystemTime(JOB_START + 21 * 60_000);
    expect(await ask(s.as)).toMatchObject({ repeated: false });

    // The live read shows the phone to a manager only, and what still stands before a no-show.
    const live = async (as: typeof s.as) => (await as.query(api.dispatchViews.liveJobs, { companyId: s.companyId, from: JOB_START - HOUR, to: JOB_END })).jobs[0].crew[0];
    expect(await live(s.as)).toMatchObject({ phone: PHONES.Lena, hasPhone: true });
    expect((await live(office)).phone).toBeNull();
    expect((await live(s.as)).noShowNotYet).toEqual(expect.arrayContaining(["the cleaner has not been asked yet"]));

    expect(await refusal(s.as.mutation(api.dispatchOps.recordCannotAttend, { companyId: s.companyId, assignmentId: a.assignmentId, reason: "" }))).toContain("required");
    await s.as.mutation(api.dispatchOps.recordCannotAttend, { companyId: s.companyId, assignmentId: a.assignmentId, reason: "Called in sick at 9:50" });
    const after = await s.job(a.jobId);
    expect(after.assignments.find((row) => row._id === a.assignmentId)).toMatchObject({ status: "cancelled", endCause: "dropped" });
    expect(after.staffing.open).toBe(1);
    const events = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "assignments", id: a.assignmentId } });
    expect(events.at(-1)).toMatchObject({ type: "assignment.cancelled", actor: { kind: "member" } });
    expect(await refusal(ask(s.as))).toBe("This only applies to an accepted cleaner who has not checked in.");
  });
});

describe("Dispatch: how a crew is paid is the Owner's setting", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("pays each cleaner their share of the whole price unless the Owner splits it, with a lead premium on top", async () => {
    const s = await setup(["Lena", "Rosa", "Mia"]);
    const jobId = await heldJob(s, { requiredCrew: 3 });
    const pay = async () => Object.fromEntries((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).candidates.map((row) => [row.name, row.pay]));

    // The starting rule is today's: 50% of the $160 price, whatever the crew size.
    expect((await pay()).Lena).toEqual({ payCents: 8000, basis: "50% of the $160.00 job price" });

    await s.as.mutation(api.dispatchOps.setPolicy, { companyId: s.companyId, policy: { crewPayMode: "split_by_crew", leadPremiumPercent: 10 } });
    // Nobody holds the lead yet, so the next offer is the lead's: split three ways, plus 10%.
    expect((await pay()).Lena).toEqual({ payCents: 2933, basis: "50% of the $160.00 job price, split 3 ways, plus 10% as lead" });
    const lead = await s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId, cleanerId: s.cleaners.Lena, respondBy: NOW + 4 * HOUR, payCents: 2933 });
    expect((await s.job(jobId)).assignments.find((row) => row._id === lead)!.role).toBe("lead");
    // With the lead offered, the others are support, and support gets the split alone.
    expect((await pay()).Rosa).toEqual({ payCents: 2667, basis: "50% of the $160.00 job price, split 3 ways" });

    // A solo job is never split and never has a lead premium.
    const solo = await heldJob(s);
    const soloPay = (await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId: solo })).candidates.find((row) => row.name === "Mia")!.pay;
    expect(soloPay).toEqual({ payCents: 8000, basis: "50% of the $160.00 job price" });

    // Only the Owner sets it, and only to a known rule.
    expect(await refusal(s.as.mutation(api.dispatchOps.setPolicy, { companyId: s.companyId, policy: { leadPremiumPercent: 150 } }))).toBe("The lead's extra pay must be a whole number from 0 to 100.");
    const manager = await addMember(s.t, s.as, s.companyId, "manager-1", "manager");
    expect(await refusal(manager.mutation(api.dispatchOps.setPolicy, { companyId: s.companyId, policy: { crewPayMode: "share_of_whole" } }))).toBe("Not allowed.");
  });
});

describe("Dispatch: checklists come from the service's template, as it was when the visit was made", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("copies the current version onto new visits and leaves older visits alone", async () => {
    const s = await setup();
    const items = async (jobId: Id<"jobs">) => (await s.as.query(api.dispatchViews.liveJobs, { companyId: s.companyId, from: JOB_START - HOUR, to: JOB_END + 48 * HOUR })).jobs.find((row) => row.jobId === jobId)!.checklist.total;
    const v1 = await s.as.mutation(api.dispatchOps.setChecklistTemplate, { companyId: s.companyId, serviceType: "Standard", items: [{ label: "Kitchen counters", section: "Kitchen" }, { label: "Oven", section: "Kitchen", requiresPhoto: true }] });
    expect(v1.version).toBe(1);
    // "standard" and "Standard" are the same service.
    const first = await heldJob(s);
    expect(await items(first)).toBe(2);
    expect((await s.job(first)).job.checklistTemplate).toMatchObject({ version: 1 });

    const v2 = await s.as.mutation(api.dispatchOps.setChecklistTemplate, { companyId: s.companyId, serviceType: "standard ", items: [{ label: "Kitchen counters" }, { label: "Oven" }, { label: "Balcony" }] });
    expect(v2.version).toBe(2);
    const second = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...s.place, serviceType: "standard", scope: "x", startsAt: JOB_START + 24 * HOUR, endsAt: JOB_END + 24 * HOUR });
    expect(await items(second)).toBe(3);
    // The first visit keeps the checklist it was given.
    expect(await items(first)).toBe(2);

    const [listed] = await s.as.query(api.dispatchOps.checklistTemplates, { companyId: s.companyId });
    expect(listed).toMatchObject({ serviceType: "standard", version: 2, retired: false });
    await s.as.mutation(api.dispatchOps.retireChecklistTemplate, { companyId: s.companyId, templateId: listed.templateId });
    const third = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...s.place, serviceType: "Standard", scope: "x", startsAt: JOB_START + 48 * HOUR, endsAt: JOB_END + 48 * HOUR });
    expect(await items(third)).toBe(0);
    expect(await items(second)).toBe(3);
    expect(await refusal(s.as.mutation(api.dispatchOps.setChecklistTemplate, { companyId: s.companyId, serviceType: "Deep", items: [] }))).toContain("at least one item");
  });
});

describe("Dispatch: the crew's photos are the company's to see, and only theirs", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("lists each photo with who took it and for which item, and refuses another company", async () => {
    const s = await setup();
    const a = await accepted(s);
    await s.as.mutation(api.dispatchOps.setChecklist, { companyId: s.companyId, jobId: a.jobId, items: [{ label: "Oven", requiresPhoto: true }] });
    vi.setSystemTime(JOB_START);
    await s.t.mutation(api.links.checkInJob, { token: a.jobToken });
    const [oven] = (await s.t.query(api.links.job, { token: a.jobToken })).detail!.checklist;
    for (const [kind, key, itemId] of [["before", "before-photo-0001", undefined], ["item", "oven-photo-00001", oven.id]] as const) {
      const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["jpeg-bytes"], { type: "image/jpeg" })));
      await s.t.mutation(api.links.attachPhoto, { token: a.jobToken, storageId, kind, clientKey: key, itemId });
    }
    const photos = await s.as.query(api.dispatchViews.jobPhotos, { companyId: s.companyId, jobId: a.jobId });
    expect(photos.map((row) => [row.kind, row.by, row.item, typeof row.url])).toEqual([
      ["before", "Lena", null, "string"],
      ["item", "Lena", "Oven", "string"],
    ]);
    const other = await company(s.t, "owner-b", "Bravo Cleaning");
    expect(await refusal(other.as.query(api.dispatchViews.jobPhotos, { companyId: other.companyId, jobId: a.jobId }))).toBe("Not found.");
  });
});
