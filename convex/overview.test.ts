/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchCleaner, dispatchJob, dispatchPlace, HOUR, JOB_START, NOW, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

// NOW is Monday morning in Chicago; the seeded visit is Tuesday at 10:00 AM, so it is "tomorrow".
const TUESDAY_MORNING = JOB_START - 2 * HOUR;

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const place = await dispatchPlace(as, companyId);
  const rosa = await dispatchCleaner(as, companyId, "Rosa");
  const jobId = await dispatchJob(as, companyId, place);
  const at = (asOf = NOW) => ({ companyId, asOf });
  return { t, as, companyId, place, rosa, jobId, at };
}

describe("the Overview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows one visit from a proposal to an accepted cleaner, saying only what the record says", async () => {
    const s = await setup();
    const { as, companyId } = s;

    // Scheduled, and Dispatch has proposed a cleaner. Nobody has been asked yet, so it is not covered.
    const first = await as.query(api.overview.today, s.at());
    expect(first.indicators.jobs.total).toBe(0);
    expect(first.indicators.payments).toEqual({ state: "not_set_up" });
    expect(first.briefing.map((row) => row.text)).toEqual(["No visits are scheduled today.", "Tomorrow has 1 visit without an accepted cleaner.", expect.stringMatching(/^1 decision is waiting for you; the earliest is due /)]);
    expect(first.briefing[1]).toMatchObject({ certainty: "attention", link: { kind: "view", view: "schedule_tomorrow" } });
    expect(await as.query(api.overview.decisionCount, { companyId })).toBe(1);
    // The sidebar's badges come from the same record: one decision, and one visit nobody has been asked to take.
    expect(await as.query(api.overview.sidebar, s.at())).toEqual({ decisions: 1, dispatch: { paused: false, withYou: 1, inProgress: 0, waiting: 0, unfilled: 1, unfilledWithinDay: 0, awaitingAnswer: 0 } });
    const departments = (await as.query(api.overview.team, { companyId })).departments;
    expect(departments.map((row) => [row.id, row.agents.map((agent) => agent.agent)])).toEqual([
      ["growth", ["sales", "retention"]],
      ["operations", ["dispatch"]],
      ["team", ["recruiter"]],
    ]);

    const tomorrow = await as.query(api.overview.schedule, { ...s.at(), view: "tomorrow" });
    expect(tomorrow.visits).toMatchObject([{ jobId: s.jobId, customer: "Dana Whitfield", state: "needs_coverage", cleaner: null, respondBy: null }]);
    expect((await as.query(api.overview.schedule, { ...s.at(), view: "today" })).visits).toEqual([]);
    expect((await as.query(api.overview.schedule, { ...s.at(), view: "week" })).dayStarts).toHaveLength(7);

    // The decision says what approving authorizes and what waiting costs, and it is one item, not two.
    const [decision] = await as.query(api.overview.decisions, s.at());
    expect(decision).toMatchObject({ agent: "dispatch", department: "Operations", canDecide: true, carriesOut: true });
    expect(decision.ref.kind).toBe("approval");
    expect(decision.authorizes).toContain("Rosa");
    expect(decision.ifWaiting).toBeTruthy();
    expect(decision.context.map((row) => row.label)).toEqual(["Visit", "Customer", "Cleaner"]);
    // The agent's run is the steps it took, and it stops where it is waiting on a person.
    expect(decision.run.map((step) => [step.key, step.state])).toEqual([
      ["read", "done"],
      ["check", "done"],
      ["choose", "done"],
      ["permission", "needs_you"],
      ["ask", "todo"],
      ["accept", "todo"],
    ]);
    expect(decision.run[1].detail).toBe("1 can take it, 0 cannot.");
    expect(decision.run[2].detail).toMatch(/^Rosa first: Rosa /);
    expect((await as.query(api.overview.team, { companyId })).departments.find((row) => row.id === "operations")).toMatchObject({
      summary: "1 item needs your decision.",
      agents: [{ agent: "dispatch", state: "needs_you" }],
    });

    // Approving carries it out: the offer goes to Rosa. Offered is still not accepted.
    if (decision.ref.kind !== "approval") throw new Error("expected an approval");
    await as.mutation(api.approvals.decide, { companyId, approvalId: decision.ref.id, decision: "approved" });
    const offered = (await as.query(api.overview.schedule, { ...s.at(), view: "tomorrow" })).visits[0];
    expect(offered).toMatchObject({ state: "awaiting_acceptance", cleaner: "Rosa" });
    expect(offered.respondBy).toBeGreaterThan(NOW);
    expect(await as.query(api.overview.decisions, s.at())).toEqual([]);
    expect(await as.query(api.overview.sidebar, s.at())).toMatchObject({ decisions: 0, dispatch: { withYou: 0, waiting: 1, unfilled: 0, awaitingAnswer: 1 } });
    expect((await as.query(api.overview.team, { companyId })).departments.find((row) => row.id === "operations")!.agents[0]).toMatchObject({ state: "waiting", counts: { waiting: 1 } });

    const detail = await as.query(api.details.get, { ...s.at(), ref: { kind: "job", id: s.jobId } });
    expect(detail.status).toEqual({ label: "Awaiting acceptance", tone: "pending" });
    expect(detail.responsible).toEqual({ label: "Dispatch", agent: "dispatch" });
    expect(detail.next).toMatchObject({ action: "Wait for Rosa's answer.", when: offered.respondBy });
    expect(detail.context.find((row) => row.label === "Payment")).toMatchObject({ missing: true });
    expect(detail.job!.run.map((step) => step.state)).toEqual(["done", "done", "done", "done", "waiting", "todo"]);
    expect(detail.job!.run[4].detail).toMatch(/^Offer out to Rosa; answer due /);
    const assignmentId = detail.job!.assignments[0].id;

    // Rosa accepts. On Tuesday morning the briefing can say today is covered, and nothing waits on the owner.
    await as.mutation(api.assignments.recordAnswer, { companyId, assignmentId, answer: "accepted" });
    vi.setSystemTime(TUESDAY_MORNING);
    const covered = await as.query(api.overview.today, s.at(TUESDAY_MORNING));
    expect(covered.briefing.map((row) => [row.certainty, row.text])).toEqual([
      ["confirmed", "Today's one visit has a cleaner who accepted it."],
      ["confirmed", "Nothing is waiting on your decision."],
    ]);
    expect(covered.indicators.coverage).toEqual({ needing: 1, accepted: 1, awaiting: 0, uncovered: 0 });
    expect(covered.lastChangeAt).not.toBeNull();

    const done = await as.query(api.details.get, { ...s.at(TUESDAY_MORNING), ref: { kind: "job", id: s.jobId } });
    expect(done.status.label).toBe("Accepted");
    expect(done.job!.run.map((step) => [step.key, step.state])).toEqual([
      ["read", "done"],
      ["ask", "done"],
      ["accept", "done"],
    ]);
    expect(done.job!.run[2].detail).toBe("Rosa accepted. The visit is covered.");
    // The history reads as sentences, newest first, with the agent named where the agent acted.
    const told = done.history.map((row) => `${row.actor.label} ${row.text}`);
    expect(told[0]).toBe("owner-a recorded that Rosa accepted the visit today at 10:00 AM for Dana Whitfield");
    expect(told).toContain("Dispatch offered the visit today at 10:00 AM for Dana Whitfield to Rosa");
    expect(told.at(-1)).toBe("owner-a scheduled the visit today at 10:00 AM for Dana Whitfield");

    const team = await as.query(api.overview.agents, { companyId });
    const dispatch = team.agents.find((row) => row.agent === "dispatch")!;
    expect(dispatch).toMatchObject({ state: "clear", department: { id: "operations" } });
    expect(dispatch.recentOutcomes[0].outcome).toContain("Rosa");
    expect(team.agents.filter((row) => row.state === "not_built").map((row) => row.agent)).toEqual(["sales", "recruiter", "retention"]);
  });

  it("says who is on an uncovered visit today, and stops the run where nobody can be asked", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const place = await dispatchPlace(as, companyId);
    await dispatchCleaner(as, companyId, "Rosa");
    vi.setSystemTime(TUESDAY_MORNING - HOUR);
    const proposed = await dispatchJob(as, companyId, place);
    const at = { companyId, asOf: TUESDAY_MORNING - HOUR };
    const briefing = (await as.query(api.overview.today, at)).briefing;
    expect(briefing[1]).toMatchObject({ text: "The 10:00 AM visit for Dana Whitfield has no cleaner.", handling: { agent: "dispatch", text: "Dispatch proposed a cleaner and is waiting for your approval." } });

    // A visit that needs a skill nobody has: the run stops at choosing, and says why.
    await as.mutation(api.jobs.cancel, { companyId, jobId: proposed, reason: "Customer cancelled" });
    const stuck = await dispatchJob(as, companyId, place, { requiredSkills: ["move-out"] });
    const detail = await as.query(api.details.get, { ...at, ref: { kind: "job", id: stuck } });
    expect(detail.job!.run.map((step) => step.state)).toEqual(["done", "done", "blocked", "todo", "todo", "todo"]);
    expect(detail.job!.run[2].detail).toMatch(/^Nobody can be asked\. Rosa /);
    expect((await as.query(api.overview.today, at)).briefing[1].handling).toEqual({ agent: "dispatch", text: "Dispatch could not cover it and handed it to you." });
    expect((await as.query(api.details.get, { ...at, ref: { kind: "job", id: proposed } })).job!.run).toEqual([]);
  });

  it("measures only what it can and says what is not set up", async () => {
    const s = await setup();
    const { as, companyId } = s;
    const [decision] = await as.query(api.overview.decisions, s.at());
    if (decision.ref.kind !== "approval") throw new Error("expected an approval");
    await as.mutation(api.approvals.decide, { companyId, approvalId: decision.ref.id, decision: "approved" });
    const detail = await as.query(api.details.get, { ...s.at(), ref: { kind: "job", id: s.jobId } });
    await as.mutation(api.assignments.recordAnswer, { companyId, assignmentId: detail.job!.assignments[0].id, answer: "accepted" });
    vi.setSystemTime(JOB_START);
    await as.mutation(api.jobs.start, { companyId, jobId: s.jobId });
    await as.mutation(api.jobs.complete, { companyId, jobId: s.jobId });

    const week = await as.query(api.overview.week, s.at(JOB_START + HOUR));
    const measure = (key: string) => week.measures.find((row) => row.key === key)!;
    expect(measure("completed_visits")).toMatchObject({ state: "measured", value: 1, previous: 0 });
    expect(measure("completed_revenue")).toMatchObject({ state: "measured", kind: "cents", value: 16000, limitation: null });
    expect(measure("coverage_gaps")).toMatchObject({ value: 0 });
    for (const key of ["conversion", "cash", "recurring", "issues"]) expect(measure(key)).toMatchObject({ state: "not_set_up", value: null });
  });

  it("keeps approvals to Owners and Managers, and another company out entirely", async () => {
    const s = await setup();
    const { t, as, companyId } = s;
    const office = await addMember(t, as, companyId, "office-a", "office");
    const [decision] = await as.query(api.overview.decisions, s.at());

    // Office sees the visit and the team's work, not the approval queue.
    expect(await office.query(api.overview.decisions, s.at())).toEqual([]);
    expect(await office.query(api.overview.decisionCount, { companyId })).toBe(0);
    expect(await refusal(office.query(api.details.get, { ...s.at(), ref: decision.ref }))).toBe(NOT_ALLOWED);
    expect((await office.query(api.details.get, { ...s.at(), ref: { kind: "job", id: s.jobId } })).title).toBe("Dana Whitfield · standard");

    const other = await company(t, "owner-b", "Beta Cleaning");
    const B = other.companyId;
    for (const ref of [decision.ref, { kind: "job" as const, id: s.jobId }]) {
      expect(await refusal(other.as.query(api.details.get, { companyId: B, asOf: NOW, ref }))).toBe(NOT_FOUND);
    }
    for (const call of [
      () => other.as.query(api.overview.today, s.at()),
      () => other.as.query(api.overview.decisions, s.at()),
      () => other.as.query(api.overview.schedule, { ...s.at(), view: "week" }),
      () => other.as.query(api.overview.team, { companyId }),
      () => other.as.query(api.overview.agents, { companyId }),
      () => other.as.query(api.overview.week, s.at()),
      () => other.as.query(api.overview.sidebar, s.at()),
      () => other.as.query(api.details.activity, s.at()),
    ]) {
      expect(await refusal(call())).toBe(NOT_FOUND);
    }
    // Beta's own feed holds only Beta's events.
    const feed = await other.as.query(api.details.activity, { companyId: B, asOf: NOW });
    expect(feed.map((row) => row.text)).toEqual(["created the company"]);
    expect((await as.query(api.details.activity, { ...s.at(), limit: 3 })).length).toBe(3);
  });
});
