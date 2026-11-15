/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, AREA, company, dispatchCleaner, dispatchJob, dispatchPlace, HOUR, JOB_END, JOB_START, NOW, refusal, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

const MINUTE = 60 * 1000;
const DAY = 24 * HOUR;

/** A company with a customer's home and cleaners Dispatch can ask. With equal standing, it asks by name: Lena, then Rosa. */
async function setup(names: string[] = ["Rosa", "Lena"]) {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const place = await dispatchPlace(as, companyId);
  const cleaners: Record<string, Id<"cleaners">> = {};
  for (const name of names) cleaners[name] = await dispatchCleaner(as, companyId, name);

  const pending = () => as.query(api.approvals.list, { companyId });
  const job = (jobId: Id<"jobs">) => as.query(api.jobs.get, { companyId, jobId });
  const tasks = async (status: "open" | "waiting" | "needs_decision" | "done" | "cancelled", agent: "dispatch" | "recruiter" = "dispatch") =>
    as.query(api.tasks.list, { companyId, status, agent });
  const cover = (jobId: Id<"jobs">) => t.mutation(internal.dispatch.cover, { jobId });
  const decide = (approvalId: Id<"approvals">, decision: "approved" | "changed" | "skipped", note?: string) =>
    as.mutation(api.approvals.decide, { companyId, approvalId, decision, note });
  const answer = (assignmentId: Id<"assignments">, value: "accepted" | "declined") => as.mutation(api.assignments.recordAnswer, { companyId, assignmentId, answer: value });
  const allow = (level: "off" | "propose" | "execute_and_report" | "execute", action = "dispatch.request_acceptance") =>
    as.mutation(api.permissions.set, { companyId, action, level });
  const proposedCleaner = async () => {
    const rows = await pending();
    return rows.map((row) => (row.proposal?.kind === "offer_assignment" ? row.proposal.cleanerId : null));
  };
  return { t, as, companyId, place, cleaners, pending, job, tasks, cover, decide, answer, allow, proposedCleaner };
}

describe("Dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("turns a cleaner declining midway into a recoverable task, not a broken booking", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);

    // A new company starts on Propose: Dispatch prepares the offer and a person approves it.
    const [first] = await s.pending();
    expect(await s.pending()).toHaveLength(1);
    expect(first).toMatchObject({
      agent: "dispatch",
      action: "dispatch.request_acceptance",
      summary: "Offer Dana Whitfield's standard visit on Tue, Mar 2, 10:00 AM to Lena",
      proposal: { kind: "offer_assignment", jobId, cleanerId: s.cleaners.Lena, payCents: 8000, respondWithinMinutes: 120 },
      about: { table: "jobs", id: jobId },
    });
    expect(first.reason).toBe("Lena is free then, works in 78701 and has no other visits that day. 1 other cleaner is also eligible.");
    expect(first.authorizes).toContain("Dispatch will offer this visit to Lena: 3 bed, 2 bath standard clean.");
    expect(first.authorizes).toContain("Their pay is $80.00 (50% of the $160.00 job price).");
    expect(first.authorizes).toContain("The visit is confirmed only if they accept.");
    expect(first.ifWaiting).toContain("The visit stays without a cleaner.");
    const [task] = await s.tasks("needs_decision");
    expect(task).toMatchObject({
      agent: "dispatch",
      title: "Cover the standard visit for Dana Whitfield on Tue, Mar 2, 10:00 AM",
      completionCondition: "A cleaner accepted the visit",
      openQuestion: `${first.summary}?`,
      dueAt: first.decideBy,
      about: { table: "jobs", id: jobId },
    });
    expect(first.taskId).toBe(task._id);
    // Nothing has been offered on a proposal alone.
    expect((await s.job(jobId)).assignments).toEqual([]);

    // Approved: the offer goes out from Dispatch, and the task waits on the cleaner with a follow-up time.
    expect(await s.decide(first._id, "approved")).toMatchObject({ carriedOut: { ok: true } });
    const offered = (await s.job(jobId)).assignments;
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ cleanerId: s.cleaners.Lena, status: "offered", payCents: 8000, scope: "3 bed, 2 bath standard clean" });
    expect(offered[0].respondBy - NOW).toBeGreaterThanOrEqual(120 * MINUTE);
    expect(offered[0].respondBy - NOW).toBeLessThan(121 * MINUTE);
    const offerEvents = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "assignments", id: offered[0]._id } });
    expect(offerEvents[0]).toMatchObject({ type: "assignment.offered", actor: { kind: "agent", agent: "dispatch" }, data: { approvalId: first._id } });
    expect(await s.tasks("waiting")).toMatchObject([{ _id: task._id, waitingOn: "cleaner", followUpAt: offered[0].respondBy }]);
    expect(await s.as.query(api.approvals.get, { companyId: s.companyId, approvalId: first._id })).toMatchObject({ status: "approved", carriedOut: { ok: true } });

    // Lena declines. The booking is not broken: the job is still scheduled, plainly uncovered, and the same
    // task now carries a proposal for the next cleaner.
    await s.answer(offered[0]._id, "declined");
    const after = await s.job(jobId);
    expect(after.job.status).toBe("scheduled");
    expect(after.coverage).toBe("uncovered");
    const [second] = await s.pending();
    expect(second.proposal).toMatchObject({ cleanerId: s.cleaners.Rosa });
    expect(second.reason).toBe("Rosa is free then, works in 78701 and has no other visits that day. Nobody else is eligible.");
    expect(await s.tasks("needs_decision")).toMatchObject([{ _id: task._id, openQuestion: `${second.summary}?` }]);
    const seen = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId });
    expect(seen.excluded).toMatchObject([{ cleanerId: s.cleaners.Lena, code: "already_asked", reason: "already declined this visit" }]);

    // Rosa accepts. The task is done and says who has the visit.
    await s.decide(second._id, "approved");
    const rosaOffer = (await s.job(jobId)).assignments.find((row) => row.status === "offered")!;
    await s.answer(rosaOffer._id, "accepted");
    expect((await s.job(jobId)).coverage).toBe("covered");
    expect(await s.tasks("done")).toMatchObject([{ _id: task._id, outcome: "Rosa accepted the visit." }]);
    expect(await s.tasks("needs_decision")).toEqual([]);
    expect(await s.pending()).toEqual([]);
    const history = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "tasks", id: task._id } });
    expect(history.map((event) => event.type)).toEqual(["task.opened", "task.needs_decision", "task.waiting", "task.needs_decision", "task.waiting", "task.done"]);
  });

  it("does the same thing once, however often it runs", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const before = await s.as.query(api.events.recent, { companyId: s.companyId, limit: 200 });
    expect(await s.cover(jobId)).toBe("awaiting_decision");
    expect(await s.cover(jobId)).toBe("awaiting_decision");
    expect(await s.pending()).toHaveLength(1);
    expect(await s.tasks("needs_decision")).toHaveLength(1);
    // Running again wrote nothing at all.
    expect(await s.as.query(api.events.recent, { companyId: s.companyId, limit: 200 })).toHaveLength(before.length);

    const [approval] = await s.pending();
    await s.decide(approval._id, "approved");
    expect(await s.cover(jobId)).toBe("offer_out");
    expect(await s.cover(jobId)).toBe("offer_out");
    expect((await s.job(jobId)).assignments).toHaveLength(1);
    expect(await s.tasks("waiting")).toHaveLength(1);
  });

  it("offers without asking once the owner allows it, and moves to the next cleaner when nobody answers", async () => {
    const s = await setup();
    await s.allow("execute");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);

    expect(await s.pending()).toEqual([]);
    const [lena] = (await s.job(jobId)).assignments;
    expect(lena).toMatchObject({ cleanerId: s.cleaners.Lena, status: "offered", payCents: 8000 });
    expect(await s.tasks("waiting")).toMatchObject([{ waitingOn: "cleaner", followUpAt: lena.respondBy }]);
    // Plain Execute shows in the action history only; nothing is reported.
    const types = async () => (await s.as.query(api.events.recent, { companyId: s.companyId, limit: 200 })).map((event) => event.type);
    expect(await types()).not.toContain("dispatch.reported");

    // Nobody answers in time. The schedule expires the offer and Dispatch asks Rosa.
    vi.setSystemTime(lena.respondBy + 1);
    expect(await s.t.mutation(internal.assignments.expireDue, {})).toBe(1);
    const afterFirst = (await s.job(jobId)).assignments;
    expect(afterFirst.map((row) => [row.cleanerId, row.status])).toEqual([
      [s.cleaners.Lena, "expired"],
      [s.cleaners.Rosa, "offered"],
    ]);

    // Rosa does not answer either. Nobody is left, so a person is asked, with the reasons, and Recruiter hears of the gap.
    vi.setSystemTime(afterFirst[1].respondBy + 1);
    expect(await s.t.mutation(internal.assignments.expireDue, {})).toBe(1);
    expect((await s.job(jobId)).coverage).toBe("uncovered");
    const [stuck] = await s.tasks("needs_decision");
    expect(stuck.openQuestion).toBe(
      "No cleaner can be asked to take this visit. Lena did not answer an earlier offer for this visit; Rosa did not answer an earlier offer for this visit. Decide how to cover it.",
    );
    expect(await s.tasks("open", "recruiter")).toMatchObject([{ title: `Staffing gap: no cleaner could take a visit in ${AREA} on Tue, Mar 2`, about: { table: "jobs", id: jobId } }]);
    expect(await s.cover(jobId)).toBe("no_candidate");
    expect(await s.tasks("open", "recruiter")).toHaveLength(1);
  });

  it("reports each offer when the owner chose Execute and report", async () => {
    const s = await setup();
    await s.allow("execute_and_report");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [offer] = (await s.job(jobId)).assignments;
    const events = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "assignments", id: offer._id } });
    expect(events.map((event) => event.type)).toEqual(["assignment.offered", "dispatch.reported"]);
    expect(events[1]).toMatchObject({ actor: { kind: "agent", agent: "dispatch" }, data: { action: "dispatch.request_acceptance", jobId, cleanerId: s.cleaners.Lena } });
  });

  it("hands the visit to a person when nobody can take it, and tells Recruiter once per area and day", async () => {
    const s = await setup([]);
    await dispatchCleaner(s.as, s.companyId, "Far", { areas: ["99999"] });
    await dispatchCleaner(s.as, s.companyId, "Unset", { areas: [] });
    const jobId = await dispatchJob(s.as, s.companyId, s.place);

    expect(await s.pending()).toEqual([]);
    expect((await s.job(jobId)).assignments).toEqual([]);
    const [task] = await s.tasks("needs_decision");
    expect(task.openQuestion).toBe("No cleaner can be asked to take this visit. Far does not work in 78701; Unset has no service area set. Decide how to cover it.");
    expect(task.dueAt).toBe(JOB_START);
    expect(await s.tasks("open", "recruiter")).toHaveLength(1);

    // A second uncovered visit in the same area on the same day is the same gap.
    await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START + 3 * HOUR, endsAt: JOB_END + 3 * HOUR });
    expect(await s.tasks("needs_decision")).toHaveLength(2);
    expect(await s.tasks("open", "recruiter")).toHaveLength(1);

    // The gap closes when someone can take the visit: the next look finds them.
    await dispatchCleaner(s.as, s.companyId, "Near");
    expect(await s.cover(jobId)).toBe("proposed");
    expect(await s.proposedCleaner()).toHaveLength(1);
  });

  it("does not call a missing price or pay rate a staffing gap", async () => {
    const s = await setup(["Rosa"]);
    await dispatchCleaner(s.as, s.companyId, "Unpaid", { shareBps: null });
    const unpriced = await dispatchJob(s.as, s.companyId, s.place, { priceCents: null });

    const seen = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId: unpriced });
    expect(seen.candidates).toEqual([]);
    expect(seen.excluded.map((entry) => [entry.name, entry.code, entry.reason])).toEqual([
      ["Rosa", "no_pay", "is paid a share of the job, and this job has no price"],
      ["Unpaid", "no_pay", "has no pay set, so their pay for this visit cannot be worked out"],
    ]);
    const [task] = await s.tasks("needs_decision");
    expect(task.openQuestion).toContain("Rosa is paid a share of the job, and this job has no price");
    expect(await s.tasks("open", "recruiter")).toEqual([]);
    expect(await s.pending()).toEqual([]);
  });

  it("stays still while paused, and picks the visit up when resumed", async () => {
    const s = await setup();
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["dispatch"] });
    const jobId = await dispatchJob(s.as, s.companyId, s.place);

    expect(await s.pending()).toEqual([]);
    expect((await s.job(jobId)).assignments).toEqual([]);
    expect(await s.tasks("open")).toMatchObject([{ nextAction: "Dispatch is paused. Resume Dispatch, or offer this visit to a cleaner yourself." }]);
    expect(await s.cover(jobId)).toBe("paused");

    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: [] });
    // The scheduled look over the coming days finds it.
    expect(await s.t.mutation(internal.dispatch.sweep, {})).toBe(1);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.proposedCleaner()).toEqual([s.cleaners.Lena]);
    expect(await s.tasks("open")).toEqual([]);
  });

  it("asks a person when the owner switched the action off", async () => {
    const s = await setup();
    await s.allow("off");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    expect(await s.pending()).toEqual([]);
    expect((await s.job(jobId)).assignments).toEqual([]);
    expect(await s.tasks("needs_decision")).toMatchObject([{ openQuestion: "Dispatch is not allowed to request acceptance for this company. Offer this visit to a cleaner yourself." }]);
    expect(await s.cover(jobId)).toBe("off");
  });

  it("checks an approved proposal again before acting, and says so when it can no longer be done", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [forLena] = await s.pending();

    // Between the proposal and the approval, Lena takes the day off.
    await s.as.mutation(api.availability.addTimeOff, { companyId: s.companyId, cleanerId: s.cleaners.Lena, startsAt: JOB_START - HOUR, endsAt: JOB_END });
    const result = await s.decide(forLena._id, "approved");
    expect(result).toEqual({ carriedOut: { ok: false, detail: "Not carried out. This cleaner has time off then." } });
    // The decision is kept, with what became of it. Nothing was offered to Lena.
    expect(await s.as.query(api.approvals.get, { companyId: s.companyId, approvalId: forLena._id })).toMatchObject({ status: "approved", carriedOut: { ok: false } });
    expect((await s.job(jobId)).assignments).toEqual([]);
    const types = (await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "approvals", id: forLena._id } })).map((event) => event.type);
    expect(types).toEqual(["approval.requested", "approval.approved", "approval.not_carried_out"]);

    // Dispatch went straight to the next cleaner.
    const [forRosa] = await s.pending();
    expect(forRosa.proposal).toMatchObject({ cleanerId: s.cleaners.Rosa, payCents: 8000 });

    // The Owner changes Rosa's pay before approving. The approved number is no longer her pay, so it is not offered.
    await s.as.mutation(api.cleaners.setPay, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, pay: { kind: "share", shareBps: 6000 } });
    expect(await s.decide(forRosa._id, "approved")).toEqual({
      carriedOut: { ok: false, detail: "Not carried out. Rosa's pay for this visit changed from $80.00 to $96.00 after this was proposed." },
    });
    const [again] = await s.pending();
    expect(again.proposal).toMatchObject({ cleanerId: s.cleaners.Rosa, payCents: 9600 });
    expect(await s.decide(again._id, "approved")).toMatchObject({ carriedOut: { ok: true } });
    expect((await s.job(jobId)).assignments).toMatchObject([{ cleanerId: s.cleaners.Rosa, status: "offered", payCents: 9600 }]);
  });

  it("does not ask a cleaner the person passed over, and leaves the visit with a person who changes the plan", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [forLena] = await s.pending();

    // Skipped: not Lena for this visit. Dispatch proposes Rosa.
    expect(await s.decide(forLena._id, "skipped", "Lena asked for a lighter week.")).toEqual({ carriedOut: null });
    expect(await s.proposedCleaner()).toEqual([s.cleaners.Rosa]);
    const seen = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId });
    expect(seen.excluded).toMatchObject([{ name: "Lena", reason: "was passed over for this visit by a person" }]);
    expect(seen).toMatchObject({ withPerson: false, proposedCleanerId: s.cleaners.Rosa, authority: "propose", action: "dispatch.request_acceptance", coverage: "uncovered" });

    // Changed: the person will do it their way. Dispatch stops, and the task says whose move it is.
    const [forRosa] = await s.pending();
    await s.decide(forRosa._id, "changed", "I will call Rosa myself.");
    expect(await s.pending()).toEqual([]);
    expect(await s.tasks("needs_decision")).toMatchObject([
      { openQuestion: "You changed Dispatch's proposal to offer this visit to Rosa. Offer the visit yourself, or hand it back to Dispatch." },
    ]);
    expect(await s.cover(jobId)).toBe("with_person");
    expect(await s.t.mutation(internal.dispatch.sweep, {})).toBe(1);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await s.pending()).toEqual([]);
    expect((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).withPerson).toBe(true);

    // The person's own offer and its decline keep the visit with the person.
    const mine = await s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId, cleanerId: s.cleaners.Rosa, respondBy: NOW + HOUR, payCents: 9000 });
    expect(await s.tasks("waiting")).toHaveLength(1);
    await s.answer(mine, "declined");
    expect(await s.pending()).toEqual([]);
    expect(await s.tasks("needs_decision")).toMatchObject([{ openQuestion: "You are handling this visit yourself and it has no cleaner yet. Offer it to a cleaner, or hand it back to Dispatch." }]);

    // Handed back: Dispatch looks again. Lena was passed over and Rosa declined, so it says nobody is left.
    expect(await s.as.mutation(api.dispatch.handBack, { companyId: s.companyId, jobId })).toBe("no_candidate");
    expect((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).withPerson).toBe(false);
    // A person's choice is not a staffing gap.
    expect(await s.tasks("open", "recruiter")).toEqual([]);
  });

  it("lets a person take a visit over, and keeps approvals with Owners and Managers", async () => {
    const s = await setup();
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [approval] = await s.pending();

    // Taking over closes the waiting proposal, which is a decision Office cannot make.
    expect(await refusal(office.mutation(api.dispatch.takeOver, { companyId: s.companyId, jobId }))).toBe(NOT_ALLOWED);
    expect(await s.as.mutation(api.dispatch.takeOver, { companyId: s.companyId, jobId, note: "Regular cleaner only." })).toBe("with_person");
    expect(await s.as.query(api.approvals.get, { companyId: s.companyId, approvalId: approval._id })).toMatchObject({ status: "changed", note: "Regular cleaner only." });
    expect(await s.tasks("needs_decision")).toMatchObject([{ openQuestion: "You took this visit over. Offer it to a cleaner yourself, or hand it back to Dispatch." }]);
    // With nothing waiting on a decision, Office may hand it back.
    expect(await office.mutation(api.dispatch.handBack, { companyId: s.companyId, jobId })).toBe("proposed");
    expect(await s.proposedCleaner()).toEqual([s.cleaners.Lena]);
  });

  it("never treats an undecided proposal as approved", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [approval] = await s.pending();
    // With more than a day to spare, the decision is asked for within a day.
    expect(approval.decideBy - NOW).toBeGreaterThanOrEqual(DAY);
    expect(approval.decideBy - NOW).toBeLessThan(DAY + MINUTE);

    vi.setSystemTime(approval.decideBy + 1);
    expect(await s.t.mutation(internal.approvals.expireDue, {})).toBe(1);
    expect((await s.job(jobId)).assignments).toEqual([]);
    expect(await s.pending()).toEqual([]);
    expect(await s.tasks("needs_decision")).toMatchObject([
      { openQuestion: "Nobody decided on offering this visit to Lena before the deadline. Offer the visit yourself, or hand it back to Dispatch." },
    ]);
    // It waits for a person. Dispatch does not raise the same proposal again by itself.
    expect(await s.cover(jobId)).toBe("with_person");
    expect(await s.pending()).toEqual([]);
  });

  it("keeps the company's time between jobs, and follows the owner's settings", async () => {
    const s = await setup(["Lena"]);
    await s.allow("execute");
    const morning = await dispatchJob(s.as, s.companyId, s.place);
    await s.answer((await s.job(morning)).assignments[0]._id, "accepted");

    // 15 minutes after the morning visit ends is too close for the default 30 minutes.
    const next = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_END + 15 * MINUTE, endsAt: JOB_END + 75 * MINUTE });
    expect((await s.job(next)).assignments).toEqual([]);
    expect((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId: next })).excluded).toMatchObject([
      { name: "Lena", code: "too_close", reason: "has another job within 30 minutes of this one" },
    ]);

    expect(await s.as.query(api.dispatch.settings, { companyId: s.companyId })).toMatchObject({ offerWindowMinutes: 120, travelBufferMinutes: 30, lookAheadDays: 7, usingDefaults: true });
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const change = { companyId: s.companyId, offerWindowMinutes: 60, travelBufferMinutes: 10, lookAheadDays: 3 };
    expect(await refusal(manager.mutation(api.dispatch.setSettings, change))).toBe(NOT_ALLOWED);
    expect(await refusal(s.as.mutation(api.dispatch.setSettings, { ...change, travelBufferMinutes: -5 }))).toContain("from 0 to 240");
    expect(await refusal(s.as.mutation(api.dispatch.setSettings, { ...change, offerWindowMinutes: 7.5 }))).toContain("whole number from 15");
    expect(await refusal(s.as.mutation(api.dispatch.setSettings, { ...change, lookAheadDays: 90 }))).toContain("from 1 to 30");
    await s.as.mutation(api.dispatch.setSettings, change);
    expect(await s.as.query(api.dispatch.settings, { companyId: s.companyId })).toMatchObject({ offerWindowMinutes: 60, travelBufferMinutes: 10, usingDefaults: false });

    // With 10 minutes between jobs, Lena can take it, and she gets the new 60 minutes to answer.
    expect(await s.cover(next)).toBe("offered");
    const [offer] = (await s.job(next)).assignments;
    expect(offer.cleanerId).toBe(s.cleaners.Lena);
    expect(offer.respondBy - NOW).toBeLessThan(61 * MINUTE);
  });

  it("shows who it would ask and why, with pay amounts for the Owner only", async () => {
    const s = await setup(["Rosa"]);
    const hourly = await dispatchCleaner(s.as, s.companyId, "Hana", { hourlyCents: 2200 });
    await dispatchCleaner(s.as, s.companyId, "Skilled", { skills: ["windows"] });
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");

    // Rosa has taken a visit for this customer before, so she is asked first next time.
    await s.allow("execute");
    const earlier = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START - 2 * HOUR, endsAt: JOB_START - HOUR });
    const offers = (await s.job(earlier)).assignments;
    expect(offers[0].cleanerId).toBe(hourly);
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: offers[0]._id, reason: "Wrong cleaner", keepWithMe: true });
    const rosaFirst = await s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId: earlier, cleanerId: s.cleaners.Rosa, respondBy: NOW + HOUR, payCents: 4000 });
    await s.answer(rosaFirst, "accepted");
    await s.allow("propose");

    const jobId = await dispatchJob(s.as, s.companyId, s.place, { requiredSkills: [] });
    const forOwner = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId });
    expect(forOwner.candidates.map((entry) => [entry.rank, entry.name, entry.pay])).toEqual([
      [1, "Rosa", { payCents: 8000, basis: "50% of the $160.00 job price" }],
      [2, "Hana", { payCents: 4400, basis: "$22.00 an hour for 2 hours" }],
      [3, "Skilled", { payCents: 8000, basis: "50% of the $160.00 job price" }],
    ]);
    expect(forOwner.candidates[0].reasons).toEqual(["is free then", "works in 78701", "has taken 1 visit for this customer before", "has 1 other visit that day"]);
    expect(await s.proposedCleaner()).toEqual([s.cleaners.Rosa]);

    const forManager = await manager.query(api.dispatch.candidates, { companyId: s.companyId, jobId });
    expect(forManager.candidates.map((entry) => [entry.name, entry.pay])).toEqual([
      ["Rosa", null],
      ["Hana", null],
      ["Skilled", null],
    ]);

    // A visit that needs a skill asks only who has it.
    const windows = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START + 3 * HOUR, endsAt: JOB_END + 3 * HOUR, requiredSkills: ["windows"] });
    const forWindows = await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId: windows });
    expect(forWindows.candidates.map((entry) => entry.name)).toEqual(["Skilled"]);
    expect(forWindows.candidates[0].reasons).toContain("has the skills this visit needs");
    expect(forWindows.excluded.map((entry) => entry.code)).toEqual(["missing_skill", "missing_skill"]);
  });

  it("answers another company's job like one that does not exist", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const other = await company(s.t, "owner-b", "Beta Cleaning");

    const outside = [
      () => other.as.query(api.dispatch.candidates, { companyId: other.companyId, jobId }),
      () => other.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId }),
      () => other.as.query(api.dispatch.settings, { companyId: s.companyId }),
      () => other.as.mutation(api.dispatch.setSettings, { companyId: s.companyId, offerWindowMinutes: 60, travelBufferMinutes: 0, lookAheadDays: 1 }),
      () => other.as.mutation(api.dispatch.takeOver, { companyId: other.companyId, jobId }),
      () => other.as.mutation(api.dispatch.handBack, { companyId: other.companyId, jobId }),
      () => s.t.query(api.dispatch.candidates, { companyId: s.companyId, jobId }),
    ];
    for (const call of outside) expect(await refusal(call())).toBe(NOT_FOUND);
    // Nothing of Alpha's moved.
    expect(await s.pending()).toHaveLength(1);
    expect(await other.as.query(api.approvals.list, { companyId: other.companyId })).toEqual([]);
  });

  it("asks before replacing a cleaner who had accepted, even when first offers go out without asking", async () => {
    const s = await setup();
    await s.allow("execute");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [lena] = (await s.job(jobId)).assignments;
    await s.answer(lena._id, "accepted");
    expect(await s.tasks("done")).toHaveLength(1);

    // Lena drops out of a confirmed visit. That is a different action, and it starts on Propose.
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: lena._id, reason: "Lena is sick" });
    const [approval] = await s.pending();
    expect(approval).toMatchObject({
      action: "dispatch.reassign_confirmed_visit",
      summary: "Reassign Dana Whitfield's standard visit on Tue, Mar 2, 10:00 AM to Rosa",
      proposal: { cleanerId: s.cleaners.Rosa },
    });
    expect(approval.reason).toContain("The cleaner who had accepted this visit is no longer on it.");
    expect((await s.job(jobId)).assignments.filter((row) => row.status === "offered")).toEqual([]);
    // The first task stays done as history. A new one carries the visit now.
    expect(await s.tasks("done")).toHaveLength(1);
    expect(await s.tasks("needs_decision")).toHaveLength(1);
    expect((await s.as.query(api.dispatch.candidates, { companyId: s.companyId, jobId })).excluded).toMatchObject([{ name: "Lena", reason: "was released from this visit" }]);
  });

  it("lets a person move a visit without Dispatch offering the old time behind them", async () => {
    const s = await setup();
    await s.allow("execute");
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [lena] = (await s.job(jobId)).assignments;

    // Released and kept: Dispatch does not turn round and offer the old time to Rosa.
    await s.as.mutation(api.assignments.release, { companyId: s.companyId, assignmentId: lena._id, reason: "Customer wants another time", keepWithMe: true });
    expect((await s.job(jobId)).assignments.filter((row) => row.status === "offered")).toEqual([]);
    await s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, startsAt: JOB_START + 2 * HOUR, endsAt: JOB_END + 2 * HOUR });
    expect((await s.job(jobId)).assignments.filter((row) => row.status === "offered")).toEqual([]);
    expect(await s.tasks("needs_decision")).toMatchObject([{ title: "Cover the standard visit for Dana Whitfield on Tue, Mar 2, 12:00 PM" }]);

    // Handed back: Lena was released from the old time, not the new one, so she can be asked again.
    expect(await s.as.mutation(api.dispatch.handBack, { companyId: s.companyId, jobId })).toBe("offered");
    const offered = (await s.job(jobId)).assignments.filter((row) => row.status === "offered");
    expect(offered).toMatchObject([{ cleanerId: s.cleaners.Lena, jobStartsAt: JOB_START + 2 * HOUR }]);
  });

  it("withdraws a proposal about a time the visit no longer has", async () => {
    const s = await setup();
    const jobId = await dispatchJob(s.as, s.companyId, s.place);
    const [old] = await s.pending();
    await s.as.mutation(api.jobs.reschedule, { companyId: s.companyId, jobId, startsAt: JOB_START + HOUR, endsAt: JOB_END + HOUR });
    expect(await s.as.query(api.approvals.get, { companyId: s.companyId, approvalId: old._id })).toMatchObject({ status: "expired", note: "The visit was moved to another time." });
    const [fresh] = await s.pending();
    expect(fresh.summary).toBe("Offer Dana Whitfield's standard visit on Tue, Mar 2, 11:00 AM to Lena");
    expect(await s.tasks("needs_decision")).toHaveLength(1);
  });

  it("waits until a visit is inside the look-ahead, then finds it on the schedule", async () => {
    const s = await setup();
    // Two weeks later is also a Tuesday. Daylight time has started, so 16:00 UTC is 11:00 in Chicago.
    const startsAt = JOB_START + 14 * DAY;
    const jobId = await dispatchJob(s.as, s.companyId, s.place, { startsAt, endsAt: startsAt + 2 * HOUR });
    expect(await s.pending()).toEqual([]);
    expect(await s.tasks("open")).toMatchObject([{ nextAction: "Find a cleaner once the visit is within 7 days", dueAt: startsAt - 7 * DAY }]);
    expect(await s.cover(jobId)).toBe("too_early");

    vi.setSystemTime(startsAt - 7 * DAY + MINUTE);
    expect(await s.t.mutation(internal.dispatch.sweep, {})).toBe(1);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const [approval] = await s.pending();
    expect(approval.summary).toBe("Offer Dana Whitfield's standard visit on Tue, Mar 16, 11:00 AM to Lena");
    // With days to spare, a decision is asked for within a day.
    expect(approval.decideBy - (startsAt - 7 * DAY + MINUTE)).toBeLessThanOrEqual(DAY + MINUTE);
  });

  it("closes its work when the visit is cancelled or a person covers it", async () => {
    const s = await setup();
    const cancelled = await dispatchJob(s.as, s.companyId, s.place);
    const [approval] = await s.pending();
    await s.as.mutation(api.jobs.cancel, { companyId: s.companyId, jobId: cancelled, reason: "Customer cancelled" });
    expect(await s.as.query(api.approvals.get, { companyId: s.companyId, approvalId: approval._id })).toMatchObject({ status: "expired", note: "The visit was cancelled." });
    expect(await s.tasks("cancelled")).toMatchObject([{ outcome: "The visit was cancelled." }]);
    expect(await s.cover(cancelled)).toBe("closed");

    // A person offers by hand while a proposal is still waiting. Approving the proposal now does not
    // send a second offer: Dispatch asks one cleaner at a time.
    const twice = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START - 2 * HOUR, endsAt: JOB_START - HOUR });
    const [late] = await s.pending();
    await s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId: twice, cleanerId: s.cleaners.Rosa, respondBy: NOW + HOUR, payCents: 8000 });
    expect(await s.decide(late._id, "approved")).toEqual({ carriedOut: { ok: false, detail: "Not carried out. An offer for this visit is already out to a cleaner." } });
    expect((await s.job(twice)).assignments).toHaveLength(1);
    await s.as.mutation(api.jobs.cancel, { companyId: s.companyId, jobId: twice, reason: "Test over" });

    // A person offers and the cleaner accepts while a proposal is still waiting: the proposal is withdrawn.
    const byHand = await dispatchJob(s.as, s.companyId, s.place, { startsAt: JOB_START + 3 * HOUR, endsAt: JOB_END + 3 * HOUR });
    const [waiting] = await s.pending();
    const mine = await s.as.mutation(api.assignments.offer, { companyId: s.companyId, jobId: byHand, cleanerId: s.cleaners.Rosa, respondBy: NOW + HOUR, payCents: 8000 });
    await s.answer(mine, "accepted");
    expect(await s.as.query(api.approvals.get, { companyId: s.companyId, approvalId: waiting._id })).toMatchObject({ status: "expired", note: "A cleaner accepted this visit." });
    expect(await s.tasks("done")).toMatchObject([{ outcome: "Rosa accepted the visit." }]);
    expect(await s.pending()).toEqual([]);
    expect(await s.tasks("needs_decision")).toEqual([]);
  });
});
