/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { company, HOUR, NOW, refusal, seedVisit, start } from "../tests/harness";
import { api } from "./_generated/api";

describe("tasks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("always has a responsible agent, a next action, a deadline and a completion condition", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const { jobId } = await seedVisit(as, companyId);
    const base = { companyId, agent: "dispatch" as const, title: "Cover Tuesday's visit", nextAction: "Offer the visit to Rosa", dueAt: NOW + HOUR, completionCondition: "A cleaner accepted the visit" };

    expect(await refusal(as.mutation(api.tasks.create, { ...base, nextAction: " " }))).toContain("next action is required");
    expect(await refusal(as.mutation(api.tasks.create, { ...base, completionCondition: "" }))).toContain("completion condition is required");
    expect(await refusal(as.mutation(api.tasks.create, { ...base, dueAt: 0 }))).toContain("not a valid time");

    const taskId = await as.mutation(api.tasks.create, { ...base, about: { table: "jobs", id: jobId } });
    expect(await as.query(api.tasks.get, { companyId, taskId })).toMatchObject({ status: "open", agent: "dispatch", nextAction: "Offer the visit to Rosa", dueAt: NOW + HOUR, about: { table: "jobs", id: jobId } });
  });

  it("makes waiting an explicit state with a follow-up time, and surfaces what is late", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const taskId = await as.mutation(api.tasks.create, { companyId, agent: "sales", title: "Quote for Dana", nextAction: "Send the quote", dueAt: NOW + HOUR, completionCondition: "Booked, declined or handed to a person" });
    const read = () => as.query(api.tasks.get, { companyId, taskId });

    expect(await refusal(as.mutation(api.tasks.wait, { companyId, taskId, waitingOn: "customer", followUpAt: NOW - 1 }))).toContain("in the future");
    await as.mutation(api.tasks.wait, { companyId, taskId, waitingOn: "customer", followUpAt: NOW + 24 * HOUR });
    const waiting = await read();
    expect(waiting).toMatchObject({ status: "waiting", waitingOn: "customer", followUpAt: NOW + 24 * HOUR });
    // A waiting task does not keep a stale next action.
    expect(waiting.nextAction).toBeUndefined();

    expect(await as.query(api.tasks.overdue, { companyId, asOf: NOW + 2 * HOUR })).toEqual([]);
    expect((await as.query(api.tasks.overdue, { companyId, asOf: NOW + 25 * HOUR })).map((row) => row._id)).toEqual([taskId]);

    // Back to work needs a next action and a deadline again.
    await as.mutation(api.tasks.setNextAction, { companyId, taskId, nextAction: "Follow up by text", dueAt: NOW + 26 * HOUR });
    const open = await read();
    expect(open).toMatchObject({ status: "open", nextAction: "Follow up by text", dueAt: NOW + 26 * HOUR });
    expect(open.waitingOn).toBeUndefined();
    expect(open.followUpAt).toBeUndefined();
    expect((await as.query(api.tasks.overdue, { companyId, asOf: NOW + 27 * HOUR })).map((row) => row._id)).toEqual([taskId]);
  });

  it("hands a task to a person with the open question, and closes with an outcome", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const taskId = await as.mutation(api.tasks.create, { companyId, agent: "retention", title: "Complaint about Tuesday", nextAction: "Gather the visit evidence", dueAt: NOW + HOUR, completionCondition: "The customer's concern is resolved" });

    await as.mutation(api.tasks.escalate, { companyId, taskId, openQuestion: "The customer asked for a refund above your limit. Approve it?", decideBy: NOW + 3 * HOUR });
    expect(await as.query(api.tasks.get, { companyId, taskId })).toMatchObject({ status: "needs_decision", dueAt: NOW + 3 * HOUR, openQuestion: "The customer asked for a refund above your limit. Approve it?" });
    expect((await as.query(api.tasks.list, { companyId, status: "needs_decision", agent: "retention" })).length).toBe(1);
    expect(await as.query(api.tasks.list, { companyId, status: "needs_decision", agent: "sales" })).toEqual([]);

    expect(await refusal(as.mutation(api.tasks.complete, { companyId, taskId, outcome: "" }))).toContain("outcome is required");
    await as.mutation(api.tasks.complete, { companyId, taskId, outcome: "Owner approved a partial refund; customer accepted." });
    const done = await as.query(api.tasks.get, { companyId, taskId });
    expect(done).toMatchObject({ status: "done", outcome: "Owner approved a partial refund; customer accepted." });
    expect(done.closedAt).toBeGreaterThanOrEqual(NOW);
    expect(done.openQuestion).toBeUndefined();

    // A closed task stays closed.
    expect(await refusal(as.mutation(api.tasks.setNextAction, { companyId, taskId, nextAction: "Again", dueAt: NOW + HOUR }))).toContain("cannot become open");
    expect(await refusal(as.mutation(api.tasks.cancel, { companyId, taskId, reason: "no" }))).toContain("cannot become cancelled");

    const history = await as.query(api.events.forSubject, { companyId, subject: { table: "tasks", id: taskId } });
    expect(history.map((event) => event.type)).toEqual(["task.opened", "task.needs_decision", "task.done"]);
  });
});
