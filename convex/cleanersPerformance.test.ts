/**
 * @vitest-environment edge-runtime
 *
 * Phase 4 of the Cleaners workspace: performance from verified records, disputes, coaching and feedback,
 * idle-worker check-ins, and Chat's Cleaners tools.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, company, HOUR, JOB_END, JOB_START, NOW, PRICE, refusal } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mockChat } from "./lib/chat/model";
import { mockOutbox } from "./lib/messaging/provider";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

type S = Awaited<ReturnType<typeof setup>>;
const DAY = 24 * HOUR;
const settle = (s: S) => s.t.finishAllScheduledFunctions(vi.runAllTimers);

/** A finished job in the past with this cleaner's assignment as the records would hold it. */
async function pastJob(s: S, cleanerId: Id<"cleaners">, daysAgo: number, assignment: Partial<Doc<"assignments">> = {}, job: Partial<Doc<"jobs">> = {}) {
  return s.t.run(async (ctx) => {
    const template = (await ctx.db.query("jobs").first())!;
    const startsAt = NOW - daysAgo * DAY;
    const { _id, _creationTime, ...rest } = template;
    void _id;
    void _creationTime;
    const jobId = await ctx.db.insert("jobs", { ...rest, startsAt, endsAt: startsAt + 2 * HOUR, status: "completed", ...job });
    const assignmentId = await ctx.db.insert("assignments", {
      companyId: s.companyId,
      jobId,
      cleanerId,
      status: "accepted",
      scope: template.scope,
      payCents: 8000,
      offeredAt: startsAt - 2 * DAY,
      respondBy: startsAt - DAY,
      respondedAt: startsAt - 2 * DAY + HOUR,
      jobStartsAt: startsAt,
      offerKind: "initial",
      role: "lead",
      checkIn: { at: startsAt - 5 * 60_000 },
      completion: { submittedAt: startsAt + 2 * HOUR, incomplete: false },
      ...assignment,
    });
    return { jobId, assignmentId };
  });
}

/** A job to clone, created the way the product creates one, held so Dispatch makes no offers. */
async function template(s: S) {
  const jobId = await s.as.mutation(api.jobs.create, { companyId: s.companyId, ...s.place, serviceType: "standard", scope: "3 bed, 2 bath standard clean", startsAt: JOB_START, endsAt: JOB_END, priceCents: PRICE });
  await s.as.mutation(api.dispatch.takeOver, { companyId: s.companyId, jobId });
  await flush(s.t);
  return jobId;
}

const perf = (s: S, cleanerId: Id<"cleaners">, as = s.as) => as.query(api.cleanerPerformance.forCleaner, { companyId: s.companyId, cleanerId, asOf: NOW });

async function portalToken(s: S, cleanerId: Id<"cleaners">) {
  const { linkId } = (await s.as.mutation(api.portalAccess.invite, { companyId: s.companyId, cleanerId })) as { linkId: Id<"portalLinks"> };
  return (await s.as.mutation(api.portalAccess.reveal, { companyId: s.companyId, linkId })).url.split("/c/portal/")[1];
}

describe("Cleaners: performance, coaching and check-ins", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => undo());

  it("says 'Not enough history' for someone new, then explains a score from the records, to Owners and Managers only", async () => {
    const s = await setup(["Lena", "Rosa"]);
    await template(s);
    expect((await perf(s, s.cleaners.Lena)).score).toMatchObject({ state: "not_enough", have: 0 });

    for (const day of [3, 5, 7, 9, 11, 13]) await pastJob(s, s.cleaners.Lena, day);
    await pastJob(s, s.cleaners.Lena, 15, { status: "cancelled", endCause: "no_show", checkIn: undefined, completion: undefined });
    // A job the company cancelled is not hers to answer for.
    await pastJob(s, s.cleaners.Lena, 17, { status: "cancelled", endCause: "job_cancelled", checkIn: undefined }, { status: "cancelled" });
    // Late twice without word, once with notice beforehand, and once with no check-in at all.
    await pastJob(s, s.cleaners.Lena, 19, { checkIn: { at: NOW - 19 * DAY + 40 * 60_000 } });
    await pastJob(s, s.cleaners.Lena, 21, { checkIn: { at: NOW - 21 * DAY + 30 * 60_000 } });
    await pastJob(s, s.cleaners.Lena, 23, { checkIn: { at: NOW - 23 * DAY + 30 * 60_000 }, late: { reportedAt: NOW - 23 * DAY - HOUR, etaAt: NOW - 23 * DAY + 30 * 60_000 } });
    await pastJob(s, s.cleaners.Lena, 25, { checkIn: undefined });

    const view = await perf(s, s.cleaners.Lena);
    if (view.score.state !== "scored") throw new Error("expected a score");
    const reliability = view.measures.find((row) => row.key === "reliability")!;
    expect([reliability.numerator, reliability.denominator]).toEqual([10, 11]);
    expect(reliability.words).toContain("1 job the company released, cancelled or moved is left out");
    const punctuality = view.measures.find((row) => row.key === "punctuality")!;
    expect([punctuality.numerator, punctuality.denominator]).toEqual([6, 9]);
    expect(punctuality.breakdown.map((row) => [row.label, row.count])).toEqual([
      ["On time", 6],
      ["Checked in late, told the office beforehand", 1],
      ["Checked in late, without word", 2],
      ["No check-in recorded (not counted)", 1],
    ]);
    expect(view.score.lines.map((line) => line.key)).toEqual(["reliability", "punctuality", "responsiveness"]);
    expect(view.method.words).toContain("Not used to rank people or decide who is offered work");
    expect(view.recommendations.map((row) => row.key)).toEqual(["no_show", "late"]);

    // Office never sees performance; another company finds nothing.
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    expect(await refusal(perf(s, s.cleaners.Lena, office))).toBe(NOT_ALLOWED);
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.cleanerPerformance.forCleaner, { companyId: other.companyId, cleanerId: s.cleaners.Lena, asOf: NOW }))).toBe(NOT_FOUND);
  });

  it("leaves a disputed record out until someone other than whoever raised it decides, and lets a cleaner dispute their own", async () => {
    const s = await setup(["Lena", "Rosa"]);
    await template(s);
    for (const day of [3, 5, 7, 9, 11]) await pastJob(s, s.cleaners.Lena, day);
    const { assignmentId } = await pastJob(s, s.cleaners.Lena, 13, { status: "cancelled", endCause: "no_show", checkIn: undefined });
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");

    const raised = await manager.mutation(api.cleanerPerformance.raiseDispute, { companyId: s.companyId, assignmentId, measure: "reliability", reason: "She was there; the customer let her in late." });
    expect(await manager.mutation(api.cleanerPerformance.raiseDispute, { companyId: s.companyId, assignmentId, measure: "reliability", reason: "Again" })).toEqual({ disputeId: raised.disputeId, already: true });
    let view = await perf(s, s.cleaners.Lena);
    expect(view.measures.find((row) => row.key === "reliability")).toMatchObject({ numerator: 5, denominator: 5, disputed: 1 });
    expect(view.recommendations.map((row) => row.key)).toEqual(["disputes"]);

    expect(await refusal(manager.mutation(api.cleanerPerformance.decideDispute, { companyId: s.companyId, disputeId: raised.disputeId, decision: "corrected", resolution: "x" }))).toContain("Someone other than the person who raised it");
    await s.as.mutation(api.cleanerPerformance.decideDispute, { companyId: s.companyId, disputeId: raised.disputeId, decision: "upheld", resolution: "The customer's camera shows nobody arrived." });
    view = await perf(s, s.cleaners.Lena);
    expect(view.measures.find((row) => row.key === "reliability")).toMatchObject({ numerator: 5, denominator: 6, disputed: 0 });
    expect(view.disputes[0]).toMatchObject({ status: "upheld", decidedBy: "owner-a" });
    expect(await refusal(s.as.mutation(api.cleanerPerformance.decideDispute, { companyId: s.companyId, disputeId: raised.disputeId, decision: "corrected", resolution: "x" }))).toContain("already decided");

    // From her portal, the whole record; only her own records.
    const token = await portalToken(s, s.cleaners.Lena);
    const late = await pastJob(s, s.cleaners.Lena, 15, { checkIn: { at: NOW - 15 * DAY + 50 * 60_000 } });
    await s.t.mutation(api.portal.disputeRecord, { token, assignmentId: late.assignmentId, reason: "I checked in on arrival; the app was slow." });
    view = await perf(s, s.cleaners.Lena);
    expect(view.measures.find((row) => row.key === "punctuality")!.records.find((row) => row.assignmentId === late.assignmentId)).toMatchObject({ counts: false, dispute: { status: "open" } });
    const rosas = await pastJob(s, s.cleaners.Rosa, 3);
    expect(await refusal(s.t.mutation(api.portal.disputeRecord, { token, assignmentId: rosas.assignmentId, reason: "x" }))).toBe(NOT_FOUND);
  });

  it("drafts coaching from records for a person to publish, shows only published feedback to the cleaner, and takes their reply", async () => {
    const s = await setup(["Lena"]);
    await template(s);
    for (const day of [3, 5, 7, 9, 11]) await pastJob(s, s.cleaners.Lena, day);
    await pastJob(s, s.cleaners.Lena, 13, { status: "cancelled", endCause: "no_show", checkIn: undefined });
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    expect(await refusal(office.mutation(api.coaching.draftFromRecords, { companyId: s.companyId, cleanerId: s.cleaners.Lena, key: "no_show" }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.query(api.coaching.list, { companyId: s.companyId, cleanerId: s.cleaners.Lena }))).toBe(NOT_ALLOWED);
    expect(await refusal(s.as.mutation(api.coaching.draftFromRecords, { companyId: s.companyId, cleanerId: s.cleaners.Lena, key: "late" }))).toContain("no longer show this");

    const drafted = await s.as.mutation(api.coaching.draftFromRecords, { companyId: s.companyId, cleanerId: s.cleaners.Lena, key: "no_show" });
    expect(await s.as.mutation(api.coaching.draftFromRecords, { companyId: s.companyId, cleanerId: s.cleaners.Lena, key: "no_show" })).toEqual({ noteId: drafted.noteId, already: true });
    const [note] = await s.as.query(api.coaching.list, { companyId: s.companyId, cleanerId: s.cleaners.Lena });
    expect(note).toMatchObject({ status: "draft", fromSelestial: true, visibility: "shared", sharedAt: null, title: "A job recorded as missed" });
    expect(note.body).toContain("we would like to hear what happened");
    expect(note.evidence).toHaveLength(1);

    const token = await portalToken(s, s.cleaners.Lena);
    const portal = async () => {
      const view = await s.t.query(api.portal.view, { token, asOf: NOW });
      if (view.state !== "active") throw new Error(view.state);
      return view;
    };
    // A draft is the office's alone.
    expect((await portal()).feedback).toEqual([]);
    await s.as.mutation(api.coaching.edit, { companyId: s.companyId, noteId: drafted.noteId, body: "Hi Lena, we have the job on Feb 16 recorded as missed. What happened?" });
    await s.as.mutation(api.coaching.publish, { companyId: s.companyId, noteId: drafted.noteId });
    expect((await portal()).feedback).toMatchObject([{ title: "A job recorded as missed", body: "Hi Lena, we have the job on Feb 16 recorded as missed. What happened?" }]);
    await s.t.mutation(api.portal.respondToFeedback, { token, noteId: drafted.noteId, text: "My car broke down and my phone was dead. Sorry." });
    expect((await s.as.query(api.coaching.list, { companyId: s.companyId, cleanerId: s.cleaners.Lena }))[0].response).toMatchObject({ text: "My car broke down and my phone was dead. Sorry." });
    // Shared feedback cannot quietly become internal; withdrawing takes it out of their portal.
    expect(await refusal(s.as.mutation(api.coaching.edit, { companyId: s.companyId, noteId: drafted.noteId, visibility: "internal" }))).toContain("Withdraw it instead");
    await s.as.mutation(api.coaching.withdraw, { companyId: s.companyId, noteId: drafted.noteId });
    expect((await portal()).feedback).toEqual([]);
    expect(await refusal(s.t.mutation(api.portal.respondToFeedback, { token, noteId: drafted.noteId, text: "Hello?" }))).toContain("not yours to answer");
    // Office never sees coaching in the history either.
    const seen = await office.query(api.cleanerProfile.activity, { companyId: s.companyId, cleanerId: s.cleaners.Lena });
    expect(seen.some((row) => /coaching|feedback|disputed/.test(row.text))).toBe(false);
  });

  it("takes a finding through to an outcome: a request names its records, and a disputed or corrected record stops approval", async () => {
    const s = await setup(["Lena", "Rosa"]);
    await template(s);
    for (const day of [3, 5, 7, 9, 11]) await pastJob(s, s.cleaners.Lena, day);
    const noShow = await pastJob(s, s.cleaners.Lena, 13, { status: "cancelled", endCause: "no_show", checkIn: undefined, completion: undefined });
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");

    // The finding and its source record; the score says how fresh it is.
    const view = await perf(s, s.cleaners.Lena);
    expect(view.recommendations.find((row) => row.key === "no_show")!.evidence.map((row) => row.assignmentId)).toEqual([noShow.assignmentId]);
    expect(view.score).toMatchObject({ state: "scored", newestRecordAt: NOW - 3 * DAY });
    expect(view.computedAt).toBe(NOW);

    // A disciplinary record that rests on it. Another person's record, or records on a pay change, are refused.
    const rosas = await pastJob(s, s.cleaners.Rosa, 3);
    const ask = (evidence: Id<"assignments">[]) => manager.mutation(api.personnel.request, { companyId: s.companyId, cleanerId: s.cleaners.Lena, kind: "disciplinary", reason: "Second no-show this quarter.", summary: "Did not arrive for the visit on the date shown; no message.", evidence });
    expect(await refusal(ask([rosas.assignmentId]))).toBe(NOT_FOUND);
    expect(await refusal(s.as.mutation(api.personnel.request, { companyId: s.companyId, cleanerId: s.cleaners.Lena, kind: "pay_change", reason: "x", pay: { kind: "share", shareBps: 4000 }, evidence: [noShow.assignmentId] }))).toContain("rests on job records");
    const requestId = await ask([noShow.assignmentId]);
    const pending = async () => (await s.as.query(api.personnel.list, { companyId: s.companyId, cleanerId: s.cleaners.Lena })).find((row) => row.requestId === requestId)!;
    expect((await pending()).evidence).toMatchObject([{ assignmentId: noShow.assignmentId, dispute: null }]);
    expect((await pending()).evidence[0].label).toMatch(/standard/i);

    // Lena disputes the record from her portal: nobody can approve until the dispute is decided.
    await s.t.mutation(api.portal.disputeRecord, { token: await portalToken(s, s.cleaners.Lena), assignmentId: noShow.assignmentId, reason: "I was there; the customer did not answer the door." });
    expect((await pending()).evidence[0].dispute).toBe("open");
    expect(await refusal(s.as.mutation(api.personnel.decide, { companyId: s.companyId, requestId, decision: "approved" }))).toContain("disputed and not decided yet");
    // The Owner finds she was right: the record is corrected, so the request cannot be approved on it.
    const disputeId = (await perf(s, s.cleaners.Lena)).disputes[0].disputeId;
    await s.as.mutation(api.cleanerPerformance.decideDispute, { companyId: s.companyId, disputeId, decision: "corrected", resolution: "The doorbell camera shows her at the door at 9:58." });
    expect(await refusal(s.as.mutation(api.personnel.decide, { companyId: s.companyId, requestId, decision: "approved" }))).toContain("was corrected after a dispute");
    await s.as.mutation(api.personnel.decide, { companyId: s.companyId, requestId, decision: "declined", note: "The record was corrected." });
    // Nor can a new request rest on the corrected record. Nothing about her changed.
    expect(await refusal(ask([noShow.assignmentId]))).toContain("Leave it out");
    expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleaners.Lena, asOf: NOW })).status).toBe("ready");

    // A record that stands carries the request through to its outcome.
    const second = await pastJob(s, s.cleaners.Lena, 20, { status: "cancelled", endCause: "no_show", checkIn: undefined, completion: undefined });
    const next = await ask([second.assignmentId]);
    const decided = await s.as.mutation(api.personnel.decide, { companyId: s.companyId, requestId: next, decision: "approved" });
    expect(decided.carriedOut).toMatchObject({ ok: true });
    expect((await s.as.query(api.personnel.list, { companyId: s.companyId, cleanerId: s.cleaners.Lena })).find((row) => row.requestId === next)).toMatchObject({ status: "approved", evidence: [{ assignmentId: second.assignmentId, dispute: null }] });
  });

  it("shows the Owner pay read from Team Pay: approved earnings, adjustments waiting, and payments with references masked", async () => {
    const s = await setup(["Lena"]);
    await template(s);
    const done = await pastJob(s, s.cleaners.Lena, 10);
    const waiting = await pastJob(s, s.cleaners.Lena, 4);
    await s.t.run(async (ctx) => {
      const owner = (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", s.companyId)).first())!;
      const base = (assignmentId: Id<"assignments">, jobId: Id<"jobs">, startsAt: number) => ({
        companyId: s.companyId,
        cleanerId: s.cleaners.Lena,
        jobId,
        assignmentId,
        method: "share" as const,
        basis: "50% of the job price",
        facts: { priceCents: 16000, crewSize: 1, lead: true, scheduledMinutes: 120, workedMinutes: 120, paidMinutes: 120, minutesSource: "worked" as const, offeredCents: 8000, checkInAt: null, completedAt: null },
        baseCents: 8000,
        tipCents: 0,
        flags: [],
        jobStartsAt: startsAt,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const earningId = await ctx.db.insert("earnings", { ...base(done.assignmentId, done.jobId, NOW - 10 * DAY), status: "paid", adjustments: [], totalCents: 8000, approved: { by: owner._id, at: NOW - 8 * DAY, totalCents: 8000 } });
      await ctx.db.insert("earnings", { ...base(waiting.assignmentId, waiting.jobId, NOW - 4 * DAY), status: "needs_review", adjustments: [{ id: "a1", cents: 1500, reason: "Parking at the building", by: owner._id, at: NOW - 3 * DAY }], totalCents: 9500 });
      await ctx.db.insert("teamPayments", { companyId: s.companyId, cleanerId: s.cleaners.Lena, parts: [{ earningId, jobCents: 8000, tipCents: 0 }], amountCents: 8000, method: "bank_transfer", status: "paid", reference: "021000021 4400123456789", startedAt: NOW - 7 * DAY, paidOn: "2027-02-22", paidAt: NOW - 7 * DAY, recordedBy: owner._id, clientKey: "pay-1", createdAt: NOW - 7 * DAY, updatedAt: NOW - 7 * DAY });
    });
    const pay = await s.as.query(api.cleanerPay.summary, { companyId: s.companyId, cleanerId: s.cleaners.Lena, asOf: NOW });
    expect(pay.finance).toMatchObject({ approvedCents: 8000, paidCents: 8000, paidCount: 1, reviewCents: 9500 });
    expect(pay.adjustmentsPending).toMatchObject([{ cents: 1500, reasons: ["Parking at the building"] }]);
    expect(pay.payments).toMatchObject([{ amountCents: 8000, method: "Bank transfer", status: "Paid", jobs: 1, reference: "ending 6789" }]);
    // The account and routing numbers typed into the reference never reach the screen.
    expect(JSON.stringify(pay)).not.toContain("4400123456789");
    expect(JSON.stringify(pay)).not.toContain("021000021");
    // Each job keeps the pay its offer stated, beside where Team Pay has it.
    expect(pay.jobs.find((row) => row.jobId === done.jobId)).toMatchObject({ payCents: 8000, teamPay: { state: "Paid", totalCents: 8000 } });
    expect(pay.jobs.find((row) => row.jobId === waiting.jobId)).toMatchObject({ payCents: 8000, teamPay: { state: "Being reviewed", totalCents: 9500 } });
    // The Owner's alone.
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    expect(await refusal(manager.query(api.cleanerPay.summary, { companyId: s.companyId, cleanerId: s.cleaners.Lena, asOf: NOW }))).toBe(NOT_ALLOWED);
  });

  it("checks in with an idle cleaner on Dispatch's permission, records the answer, and never treats silence or 'stop' as ending anything", async () => {
    const s = await setup(["Lena", "Rosa", "Mia"]);
    await s.t.run(async (ctx) => {
      for (const id of Object.values(s.cleaners)) await ctx.db.patch(id, { createdAt: NOW - 40 * DAY, availabilityConfirmedAt: NOW - DAY });
    });
    // Mia had a job last week, so she is not idle.
    await template(s);
    await pastJob(s, s.cleaners.Mia, 6);
    await s.t.mutation(internal.cleanerFollowUps.sweep, {});
    const idle = async (cleanerId: Id<"cleaners">) => (await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId })).filter((row) => row.topic === "idle_check_in");
    expect(await idle(s.cleaners.Mia)).toEqual([]);
    expect(await idle(s.cleaners.Lena)).toMatchObject([{ status: "awaiting_approval", agent: "Dispatch" }]);
    await s.t.mutation(internal.cleanerFollowUps.sweep, {});
    expect(await idle(s.cleaners.Lena)).toHaveLength(1);
    const approval = (await s.as.query(api.approvals.list, { companyId: s.companyId })).find((row) => row.about?.id === s.cleaners.Lena && row.summary.includes("check-in"))!;
    expect(approval.summary).toBe("Send Lena a check-in: are they still available for work?");
    await s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: approval._id, decision: "approved" });
    await settle(s);
    const text = mockOutbox.filter((row) => row.to.endsWith("5550101010")).at(-1)!;
    expect(text.body).toContain("we have not had work with you for a while");
    const token = text.body.match(/\/c\/portal\/([A-Za-z0-9_.-]+)/)![1];

    // Lena takes a break: recorded as time away, and no more check-ins until she is back.
    await s.t.mutation(api.portal.respondCheckIn, { token, answer: "break", until: NOW + 20 * DAY, note: "Visiting family" });
    const profile = await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleaners.Lena, asOf: NOW });
    expect(profile.availability.timeOff).toMatchObject([{ note: "Visiting family", source: "cleaner" }]);
    vi.setSystemTime(NOW + 3 * DAY);
    await s.t.mutation(internal.cleanerFollowUps.sweep, {});
    expect((await idle(s.cleaners.Lena))[0]).toMatchObject({ status: "resolved" });

    // Rosa says she wants to stop: a person is told, and nothing about her engagement changes.
    const rosa = await portalToken(s, s.cleaners.Rosa);
    expect(await s.t.mutation(api.portal.respondCheckIn, { token: rosa, answer: "stop", note: "Moving to Dallas." })).toMatchObject({ words: "Thanks. The office knows you are wanting to stop working with the company." });
    expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleaners.Rosa, asOf: Date.now() })).status).toBe("ready");
    const tasks = await s.as.query(api.tasks.list, { companyId: s.companyId, status: "open", agent: "dispatch" });
    expect(tasks.find((task) => task.title === "Rosa said they want to stop working with you")!.nextAction).toContain("Ending the engagement is a request the Owner decides; nothing has changed yet");
    const { attention } = await s.as.query(api.workforce.directory, { companyId: s.companyId, asOf: Date.now() });
    expect(attention.find((row) => row.cleanerId === s.cleaners.Rosa && row.kind === "wants_to_stop")).toBeTruthy();
  });

  it("waits with routine reminders while the cleaner's own question to the office is unanswered", async () => {
    const s = await setup(["Lena"]);
    // Ready, with weekly hours not confirmed for 40 days: Dispatch would ask her to confirm them.
    await s.t.run(async (ctx) => ctx.db.patch(s.cleaners.Lena, { createdAt: NOW - 60 * DAY, availabilityConfirmedAt: NOW - 40 * DAY }));
    await s.as.mutation(api.permissions.set, { companyId: s.companyId, action: "dispatch.availability_check_in", level: "execute" });
    const token = await portalToken(s, s.cleaners.Lena);
    await s.t.mutation(api.portal.askForHelp, { token, text: "Do I need my own vacuum for commercial jobs?" });
    const hoursReminders = () => mockOutbox.filter((item) => item.body.includes("confirm the days and hours you can work")).length;
    // Past the window that the portal invitation itself started, so only the open question can hold the reminder back.
    for (let i = 0; i < 2; i += 1) {
      vi.setSystemTime(Date.now() + 49 * HOUR);
      await s.t.mutation(internal.cleanerFollowUps.sweep, {});
      await settle(s);
    }
    // Their question comes first: nothing routine goes to them while it waits for a person, and nothing is handed over as unanswered.
    expect(hoursReminders()).toBe(0);
    const rows = await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId: s.cleaners.Lena });
    expect(rows.every((item) => item.status !== "stopped" && item.attempt === 0)).toBe(true);
    const help = (await s.as.query(api.tasks.list, { companyId: s.companyId, status: "open", agent: "recruiter" })).find((task) => task.title === "Lena asked for help")!;
    await s.as.mutation(api.tasks.complete, { companyId: s.companyId, taskId: help._id, outcome: "Replied by text: the company brings the machines." });
    vi.setSystemTime(Date.now() + 49 * HOUR);
    await s.t.mutation(internal.cleanerFollowUps.sweep, {});
    await settle(s);
    // Once a person has answered, the routine reminder goes as usual.
    expect(hoursReminders()).toBe(1);
  });

  it("hands unanswered check-ins to a person and leaves the cleaner exactly as they were", async () => {
    const s = await setup(["Lena"]);
    await s.t.run(async (ctx) => ctx.db.patch(s.cleaners.Lena, { createdAt: NOW - 40 * DAY, availabilityConfirmedAt: NOW - DAY }));
    await s.as.mutation(api.permissions.set, { companyId: s.companyId, action: "dispatch.availability_check_in", level: "execute" });
    for (let i = 0; i < 5; i += 1) {
      await s.t.mutation(internal.cleanerFollowUps.sweep, {});
      await settle(s);
      vi.setSystemTime(Date.now() + 49 * HOUR);
    }
    const [row] = (await s.as.query(api.cleanerFollowUps.forCleaner, { companyId: s.companyId, cleanerId: s.cleaners.Lena })).filter((item) => item.topic === "idle_check_in");
    expect(row).toMatchObject({ status: "stopped", attempt: 3 });
    expect(mockOutbox.filter((item) => item.body.includes("Still available") || item.body.includes("not had work with you"))).toHaveLength(3);
    expect((await s.as.query(api.cleanerProfile.profile, { companyId: s.companyId, cleanerId: s.cleaners.Lena, asOf: Date.now() })).status).toBe("ready");
    const { attention } = await s.as.query(api.workforce.directory, { companyId: s.companyId, asOf: Date.now() });
    expect(attention.find((item) => item.cleanerId === s.cleaners.Lena && item.kind === "check_in_unanswered")!.detail).toContain("Not answering is not the same as leaving");
  });

  it("answers the brief's questions in Chat with the workspace's own functions, asking before any reminder is prepared", async () => {
    process.env.CHAT_MODEL = "mock";
    mockChat.script = [];
    mockChat.seen = [];
    mockChat.onRespond = null;
    try {
      const s = await setup(["Lena", "Rosa"]);
      const jobId = await template(s);
      for (const day of [3, 5, 7, 9, 11]) await pastJob(s, s.cleaners.Lena, day);
      // Mia is onboarding and owes steps she can do from her portal.
      const { cleanerId: mia } = await s.as.mutation(api.workforce.add, { companyId: s.companyId, person: { name: "Mia Chen", engagement: "contractor", phone: "+15550103030" } });
      await s.t.run(async (ctx) => ctx.db.patch(mia, { createdAt: NOW - 3 * DAY }));
      let keyCount = 0;
      const ask = async (as: typeof s.as, text: string) => {
        const sent = await as.mutation(api.chat.send, { companyId: s.companyId, text, clientKey: `k${(keyCount += 1)}` });
        await settle(s);
        const view = await as.query(api.chat.thread, { companyId: s.companyId, conversationId: sent.conversationId });
        return { view, steps: Object.values(view.steps) as { stepId: string; tool: string; status: string; summary: string | null; preview: { summary: string; lines: string[] } | null; result: string | null }[] };
      };

      mockChat.script = [{ toolCalls: [{ name: "cleaners_free_at", input: { date: "2027-03-02", from: "13:00", to: "16:00" } }] }, { text: "Lena and Rosa are free." }];
      let answer = await ask(s.as, "Who can work Tuesday afternoon?");
      expect(answer.steps[0]).toMatchObject({ tool: "cleaners_free_at", status: "done" });
      expect(answer.steps[0].summary).toBe("2 cleaners free and ready Tue, Mar 2 1:00 PM–4:00 PM");

      mockChat.script = [{ toolCalls: [{ name: "cleaner_readiness_blockers", input: {} }] }, { text: "Mia has steps left." }];
      answer = await ask(s.as, "What is stopping these cleaners from becoming ready?");
      expect(answer.steps[0].summary).toBe("1 person not yet ready for work");

      mockChat.script = [{ toolCalls: [{ name: "suggest_crew_for_job", input: { jobId } }] }, { text: "Here is who can take it." }];
      answer = await ask(s.as, "Suggest a crew for this job");
      expect(answer.steps[0]).toMatchObject({ tool: "suggest_crew_for_job", status: "done" });

      mockChat.script = [{ toolCalls: [{ name: "explain_cleaner_score", input: { cleanerId: s.cleaners.Lena } }] }, { text: "Here is how it is worked out." }];
      answer = await ask(s.as, "Explain Lena's score");
      expect(answer.steps[0].summary).toContain("Lena: 100 out of 100 from 3 of 3 parts");

      mockChat.script = [{ toolCalls: [{ name: "draft_coaching_follow_up", input: { cleanerId: s.cleaners.Lena } }] }, { text: "Nothing to draft." }];
      answer = await ask(s.as, "Draft a coaching follow-up for Lena");
      expect(answer.steps[0].status).toBe("refused");

      // Reminders: the exact list is approved in chat first; then they follow Recruiter's permission (Propose).
      mockChat.script = [{ toolCalls: [{ name: "prepare_onboarding_reminders", input: {} }] }];
      answer = await ask(s.as, "Prepare reminders for incomplete onboarding");
      const step = answer.steps[0];
      expect(step).toMatchObject({ tool: "prepare_onboarding_reminders", status: "awaiting_approval" });
      expect(step.preview!.lines[0]).toContain("Each reminder waits in Approvals");
      expect(step.preview!.lines.some((line) => line.startsWith("Mia Chen:"))).toBe(true);
      expect((await s.as.query(api.approvals.list, { companyId: s.companyId })).filter((row) => row.action === "recruiter.onboarding_reminder")).toHaveLength(0);
      await s.as.mutation(api.chat.decideStep, { companyId: s.companyId, stepId: step.stepId, approve: true });
      expect((await s.as.query(api.approvals.list, { companyId: s.companyId })).filter((row) => row.action === "recruiter.onboarding_reminder")).toHaveLength(1);
      // Asked again, nobody gets a second reminder.
      mockChat.script = [{ toolCalls: [{ name: "prepare_onboarding_reminders", input: {} }] }];
      const again = (await ask(s.as, "Prepare reminders again")).steps[0];
      await s.as.mutation(api.chat.decideStep, { companyId: s.companyId, stepId: again.stepId, approve: true });
      expect((await s.as.query(api.approvals.list, { companyId: s.companyId })).filter((row) => row.action === "recruiter.onboarding_reminder")).toHaveLength(1);

      // Office is not offered performance, coaching or reminders at all.
      const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
      mockChat.seen = [];
      mockChat.script = [{ text: "I can tell you who is free." }];
      await ask(office, "How is Lena doing?");
      const offered = mockChat.seen[0].tools;
      expect(offered).toEqual(expect.arrayContaining(["cleaners_free_at", "cleaner_readiness_blockers", "suggest_crew_for_job"]));
      expect(offered).not.toEqual(expect.arrayContaining(["explain_cleaner_score"]));
      expect(offered.some((name: string) => ["explain_cleaner_score", "draft_coaching_follow_up", "prepare_onboarding_reminders"].includes(name))).toBe(false);
    } finally {
      delete process.env.CHAT_MODEL;
    }
  });
});
