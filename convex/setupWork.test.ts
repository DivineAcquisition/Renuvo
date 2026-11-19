/**
 * @vitest-environment edge-runtime
 *
 * Each agent's first work in setup: real counts from the company's records, an honest state when there is
 * nothing to review, and no contact with anyone. Runs are started with `start` and then run one by one, so
 * nothing else that is scheduled (such as Dispatch's own work on a new visit) runs alongside them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchCleaner, dispatchJob, dispatchPlace, JOB_START, NOW, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const DAY = 86_400_000;

/** A company on a plan that includes every built agent. */
async function onPlan(t: T, name = "Alpha", subject = "owner") {
  const made = await company(t, subject, name);
  await t.run(async (ctx) => ctx.db.patch(made.companyId, { plan: "expand" } as never));
  return made;
}

async function prepareAll(t: T, as: ReturnType<T["withIdentity"]>, companyId: Id<"companies">, agent?: "sales" | "recruiter" | "dispatch" | "retention") {
  await as.mutation(api.setupWork.start, { companyId, agent });
  const rows = await t.run(async (ctx) => (await ctx.db.query("setupWork").collect()).filter((row) => row.companyId === companyId && row.status === "preparing"));
  for (const row of rows) await t.mutation(internal.setupWork.prepare, { workId: row._id });
  const status = await as.query(api.setupWork.status, { companyId });
  return Object.fromEntries(status.map((row) => [row.agent, row]));
}

/** Everything that would mean someone was contacted or offered work. */
async function contactCounts(t: T) {
  return t.run(async (ctx) => ({
    assignments: (await ctx.db.query("assignments").collect()).length,
    approvals: (await ctx.db.query("approvals").collect()).length,
    salesActions: (await ctx.db.query("salesActions").collect()).length,
    messages: (await ctx.db.query("messages").collect()).length,
  }));
}

describe("agent first work in setup", () => {
  let t: T;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    t = start();
  });
  afterEach(() => vi.useRealTimers());

  it("shows each run as preparing until it runs, then says plainly when there is nothing to review yet", async () => {
    const { as, companyId } = await onPlan(t);
    await as.mutation(api.setupWork.start, { companyId });
    const preparing = await as.query(api.setupWork.status, { companyId });
    expect(preparing.map((row) => [row.agent, row.work?.status, row.work?.activity])).toEqual([
      ["sales", "preparing", "Reviewing your open inquiries and follow-ups"],
      ["recruiter", "preparing", "Checking your hiring brief and waiting applications"],
      ["dispatch", "preparing", "Checking the next two weeks of visits for missing coverage"],
      ["retention", "preparing", "Reviewing your clients' service history"],
    ]);
    // Starting again while they are preparing starts nothing twice.
    expect((await as.mutation(api.setupWork.start, { companyId })).started).toEqual([]);

    const work = await prepareAll(t, as, companyId);
    expect(work.sales.work).toMatchObject({ status: "waiting", result: { counts: { open: 0, services: 0 }, next: { words: "Publish one service so Sales can quote" } } });
    expect(work.sales.work!.result!.uncertain.join(" ")).toMatch(/quote requests/);
    expect(work.recruiter.work).toMatchObject({ status: "waiting", result: { next: { words: "Prepare a hiring brief" } } });
    expect(work.dispatch.work).toMatchObject({ status: "waiting", result: { counts: { upcoming: 0, short: 0 } } });
    expect(work.retention.work).toMatchObject({ status: "waiting", result: { summary: "No completed visits yet, so there is no service history to review." } });
    // Readiness is shown beside the work, not replaced by it.
    expect(work.retention.readiness.state).not.toBe("ready_to_work");
    expect(work.retention.work!.result!.uncertain.join(" ")).toMatch(/Nothing is drafted or sent from setup/);
  });

  it("only the Owner starts it, and one company never sees another's work", async () => {
    const { as, companyId } = await onPlan(t);
    const manager = await addMember(t, as, companyId, "manager", "manager");
    await refusal(manager.mutation(api.setupWork.start, { companyId }));
    await prepareAll(t, as, companyId);
    const other = await company(t, "owner-b", "Beta");
    expect((await other.as.query(api.setupWork.status, { companyId: other.companyId })).every((row) => row.work === null)).toBe(true);
    // Staff can see where things stand.
    expect((await manager.query(api.setupWork.status, { companyId })).every((row) => row.work !== null)).toBe(true);
  });

  it("Dispatch finds visits short of people and who could cover them, without offering anyone the work", async () => {
    const { as, companyId } = await onPlan(t);
    const place = await dispatchPlace(as, companyId);
    await dispatchCleaner(as, companyId, "Rosa Diaz");
    await dispatchCleaner(as, companyId, "Ana Ruiz");
    await as.mutation(api.cleaners.create, { companyId, name: "Owen Price", engagement: "contractor", skills: [] }).then((cleanerId) => as.mutation(api.cleaners.setStatus, { companyId, cleanerId, status: "ready" }));
    await dispatchJob(as, companyId, place);
    const before = await contactCounts(t);

    const work = await prepareAll(t, as, companyId, "dispatch");
    expect(work.dispatch.work).toMatchObject({ status: "ready_for_review", result: { counts: { upcoming: 1, short: 1, noHours: 1, cleaners: 3 } } });
    expect(work.dispatch.work!.result!.items[0].detail).toMatch(/1 person still needed\. Could cover: .*(Rosa Diaz|Ana Ruiz)/);
    expect(work.dispatch.work!.result!.items[0].href).toMatch(/^\/app\/cleaners\/crews\?job=/);
    expect(work.dispatch.work!.result!.uncertain.join(" ")).toMatch(/1 cleaner has no weekly hours/);
    expect(await contactCounts(t)).toEqual(before);
  });

  it("Retention lists clients whose last visit was a while ago with nothing booked, and drafts nothing", async () => {
    const { as, companyId } = await onPlan(t);
    const lapsed = await dispatchPlace(as, companyId);
    const recent = await as.mutation(api.customers.create, { companyId, name: "Recent Client", kind: "home" });
    const recentHome = await as.mutation(api.properties.create, { companyId, customerId: recent, kind: "home", address: { line1: "3 Oak St", city: "Austin", region: "TX", postalCode: "78701" } });
    // Two past visits, made the usual way and then marked done.
    const old = await dispatchJob(as, companyId, lapsed, { startsAt: NOW - 70 * DAY, endsAt: NOW - 70 * DAY + 2 * 3600_000 });
    const newer = await dispatchJob(as, companyId, { customerId: recent, propertyId: recentHome }, { startsAt: NOW - 10 * DAY, endsAt: NOW - 10 * DAY + 2 * 3600_000 });
    await t.run(async (ctx) => {
      await ctx.db.patch(old, { status: "completed" });
      await ctx.db.patch(newer, { status: "completed" });
    });
    const before = await contactCounts(t);
    const work = await prepareAll(t, as, companyId, "retention");
    expect(work.retention.work).toMatchObject({ status: "ready_for_review", result: { counts: { withHistory: 2, lapsed: 1, cases: 0 }, next: { href: "/app/agents/retention/re-engagement" } } });
    expect(work.retention.work!.result!.items).toEqual([{ label: "Dana Whitfield", detail: "Last visit 70 days ago; nothing booked.", href: `/app/clients/${lapsed.customerId}` }]);
    expect(await contactCounts(t)).toEqual(before);
  });

  it("Sales counts open inquiries and follow-ups that are due", async () => {
    const { as, companyId } = await onPlan(t);
    await t.run(async (ctx) => {
      const base = { companyId, segment: "residential", followUps: "on" as const, createdAt: NOW - DAY, updatedAt: NOW - DAY };
      await ctx.db.insert("salesOpportunities", { ...base, title: "Deep clean for a 3 bed", stage: "new", nextAction: "Call back", nextActionAt: NOW - 2 * DAY } as never);
      await ctx.db.insert("salesOpportunities", { ...base, title: "Office quote", stage: "qualifying" } as never);
      await ctx.db.insert("salesOpportunities", { ...base, title: "Won already", stage: "won" } as never);
    });
    const work = await prepareAll(t, as, companyId, "sales");
    expect(work.sales.work).toMatchObject({ status: "ready_for_review", result: { counts: { open: 2, due: 1, noNext: 1, waiting: 0 }, next: { words: "Decide the next step for 2 inquiries" } } });
    expect(work.sales.work!.result!.items.map((item) => item.detail)).toEqual(["A follow-up was due 2 days ago.", "No next step is set."]);
  });

  it("prepares a hiring brief once, as a draft, from what the owner confirmed, and Recruiter then points at opening it", async () => {
    const { as, companyId } = await onPlan(t);
    const setup = (await as.query(api.setup.state, { companyId })).setup!;
    await as.mutation(api.setup.save, { companyId, expectedRevision: setup.revision, step: setup.step, facts: { "services.categories": ["commercial"], "workforce.arrangement": ["contractors"], "company.location": "Austin, TX" } });
    const first = await as.mutation(api.setup.prepareHiringBrief, { companyId });
    expect(await as.mutation(api.setup.prepareHiringBrief, { companyId })).toEqual({ needId: first.needId, already: true });
    const need = await t.run(async (ctx) => ctx.db.get(first.needId));
    expect(need).toMatchObject({ status: "draft", title: "Commercial cleaner", engagement: "contractor", location: "Austin, TX", serviceTypes: ["commercial"], openings: 1 });
    expect(need!.compensation).toBeUndefined();
    expect((await as.query(api.setup.state, { companyId }))!.prepared.hiringBrief).toMatchObject({ status: "draft", title: "Commercial cleaner" });

    const work = await prepareAll(t, as, companyId, "recruiter");
    expect(work.recruiter.work).toMatchObject({ status: "ready_for_review", result: { counts: { needs: 1, open: 0 }, next: { words: "Review the brief and open it when you're ready to hire" } } });
    expect(work.recruiter.work!.result!.uncertain.join(" ")).toMatch(/Pay for the role isn't approved yet/);
  });

  it("an agent the plan doesn't include gets no review, only the reason", async () => {
    const { as, companyId } = await company(t, "owner", "Alpha");
    const work = await prepareAll(t, as, companyId, "sales");
    expect(work.sales.readiness.state).toBe("plan_needed");
    expect(work.sales.work).toMatchObject({ status: "waiting", result: { title: "Not on your plan", items: [] } });
  });

  it("an agent the Owner paused gets no review, only the reason", async () => {
    const { as, companyId } = await onPlan(t);
    await t.run(async (ctx) => ctx.db.patch(companyId, { pausedAgents: ["dispatch"] } as never));
    const work = await prepareAll(t, as, companyId, "dispatch");
    expect(work.dispatch.readiness.state).toBe("paused");
    expect(work.dispatch.work).toMatchObject({ status: "waiting", result: { title: "Paused", items: [] } });
  });

  it("a later visit in the window is counted against the same rules as Dispatch's own", async () => {
    const { as, companyId } = await onPlan(t);
    const place = await dispatchPlace(as, companyId);
    await dispatchJob(as, companyId, place, { startsAt: JOB_START + 20 * DAY, endsAt: JOB_START + 20 * DAY + 2 * 3600_000 });
    const work = await prepareAll(t, as, companyId, "dispatch");
    // Outside the next 14 days: not counted.
    expect(work.dispatch.work!.result!.counts.upcoming).toBe(0);
  });
});
