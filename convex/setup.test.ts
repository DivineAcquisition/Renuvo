/**
 * @vitest-environment edge-runtime
 *
 * Company setup, phase 1: a new company starts in setup and an older one never does; progress is saved,
 * resumed and protected from an older tab; context goes to the record that owns it; only the Owner changes
 * it; agents are reported as ready only when what they need exists.
 */
import { describe, expect, it } from "vitest";

import { addMember, company, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { questionsFor, stepsFor } from "./lib/setup/path";

describe("Company setup", () => {
  it("starts a new company in setup, saves each step, and resumes where the owner left off", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    let view = await as.query(api.setup.state, { companyId });
    expect(view).toMatchObject({ required: true, canEdit: true, setup: { status: "in_progress", step: "start", revision: 0, priority: null } });

    // Company basics: the name and clock go to the company itself; the rest become confirmed facts.
    let { revision } = await as.mutation(api.setup.save, {
      companyId,
      expectedRevision: 0,
      step: "team",
      methods: ["manual"],
      company: { name: "Alpha Cleaning Co.", timezone: "America/Denver" },
      facts: { "company.location": "Denver, CO", "company.areas": "Denver and Aurora", "services.categories": ["residential", "short_term_rental"] },
    });
    expect((await as.query(api.companies.get, { companyId })).name).toBe("Alpha Cleaning Co.");
    view = await as.query(api.setup.state, { companyId });
    expect(view.company).toMatchObject({ name: "Alpha Cleaning Co.", timezone: "America/Denver" });
    expect(view.facts["services.categories"]).toMatchObject({ value: ["residential", "short_term_rental"], state: "confirmed", source: "owner" });
    expect(view.setup).toMatchObject({ step: "team", methods: ["manual"] });

    // The priority decides which questions follow. Dispatch asks about the schedule, not about hiring.
    ({ revision } = await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "priority", priority: "dispatch", secondary: ["recruiter", "dispatch"] }));
    view = await as.query(api.setup.state, { companyId });
    expect(view.setup!.secondary).toEqual(["recruiter"]);
    const ids = view.setup!.steps.map((step) => step.id);
    expect(ids).toContain("q:jobs.where");
    expect(ids).toContain("q:hiring.now");
    expect(ids).not.toContain("q:inquiries.channels");
    expect(view.setup!.stillNeeded).toEqual(["jobs.where", "hiring.now"]);
    // A question from another path is refused, and "I'm not sure" is an answer.
    expect(await refusal(as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "priority", answers: { "inquiries.channels": ["phone"] } }))).toContain("not part of your setup");
    ({ revision } = await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "q:jobs.assigning", answers: { "jobs.where": "unsure" }, skip: "q:jobs.assigning" }));
    view = await as.query(api.setup.state, { companyId });
    expect(view.setup).toMatchObject({ step: "q:jobs.assigning", skipped: ["q:jobs.assigning"], stillNeeded: ["hiring.now"] });

    // Saving the same step again changes nothing; an older tab is refused and nothing is overwritten.
    expect(await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "q:jobs.assigning" })).toEqual({ revision });
    expect(await refusal(as.mutation(api.setup.save, { companyId, expectedRevision: revision - 1, step: "start", priority: "sales" }))).toContain("changed somewhere else");
    expect((await as.query(api.setup.state, { companyId })).setup).toMatchObject({ step: "q:jobs.assigning", priority: "dispatch" });

    // Changing priority keeps earlier answers for when they are relevant again.
    ({ revision } = await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "priority", priority: "sales", secondary: [] }));
    ({ revision } = await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "priority", priority: "dispatch", secondary: [] }));
    expect((await as.query(api.setup.state, { companyId })).setup!.answers["jobs.where"]).toBe("unsure");

    // Confirming the context is recorded once; entering the workspace ends the gate and switches nothing on.
    await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "review", confirmContext: true });
    expect((await as.query(api.setup.state, { companyId })).setup!.contextConfirmed).toBe(true);
    await as.mutation(api.setup.enter, { companyId });
    await as.mutation(api.setup.enter, { companyId });
    view = await as.query(api.setup.state, { companyId });
    expect(view).toMatchObject({ required: false, setup: { status: "entered" } });
    expect((await as.query(api.permissions.list, { companyId })).actions.filter((row) => row.changed)).toEqual([]);
    const events = await t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((row) => row.type.startsWith("setup.")).map((row) => row.type));
    expect(events).toEqual(["setup.context_confirmed", "setup.workspace_entered"]);
  });

  it("never sends an existing company or invited staff through setup, and lets only the Owner change it", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const manager = await addMember(t, as, companyId, "manager-a", "manager");
    const office = await addMember(t, as, companyId, "office-a", "office");
    for (const staff of [manager, office]) {
      expect(await staff.query(api.setup.state, { companyId })).toMatchObject({ required: false, canEdit: false });
      expect(await refusal(staff.mutation(api.setup.save, { companyId, expectedRevision: 0, step: "basics" }))).toBe(NOT_ALLOWED);
      expect(await refusal(staff.mutation(api.setup.enter, { companyId }))).toBe(NOT_ALLOWED);
    }
    // A company made before setup existed has no row: nothing is required of anyone.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("companySetups").collect()) await ctx.db.delete(row._id);
    });
    expect(await as.query(api.setup.state, { companyId })).toMatchObject({ required: false, setup: null });
    expect(await refusal(as.mutation(api.setup.save, { companyId, expectedRevision: 0, step: "basics" }))).toContain("has not been started");
    // The Owner can choose to go through it; it is a place they visit, not a gate.
    await as.mutation(api.setup.begin, { companyId });
    await as.mutation(api.setup.begin, { companyId });
    expect(await as.query(api.setup.state, { companyId })).toMatchObject({ required: false, setup: { status: "entered", step: "start" } });
    expect(await t.run(async (ctx) => (await ctx.db.query("companySetups").collect()).length)).toBe(1);

    // Another company's setup answers exactly like a missing one.
    const other = await company(t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.setup.state, { companyId }))).toBe(NOT_FOUND);
    expect(await refusal(other.as.mutation(api.setup.save, { companyId, expectedRevision: 0, step: "basics" }))).toBe(NOT_FOUND);
  });

  it("refuses bad input before writing anything, and removes a fact the owner clears", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const save = (fields: object) => as.mutation(api.setup.save, { companyId, expectedRevision: 0, step: "basics", ...fields });
    expect(await refusal(save({ company: { timezone: "Mars/Olympus" }, facts: { "company.location": "Denver" } }))).toContain("time zone");
    expect(await refusal(save({ facts: { "pay.rate": "50%" } }))).toContain("not something setup records");
    expect(await refusal(save({ facts: { "services.categories": "residential" } }))).toContain("right form");
    expect(await refusal(save({ step: "q:hiring.now" }))).toContain("not part of your setup");
    expect((await as.query(api.setup.state, { companyId })).facts).toEqual({});
    const { revision } = await save({ facts: { "company.location": "Denver, CO", "tools.current": ["spreadsheets"] } });
    await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "basics", facts: { "company.location": "", "tools.current": [] } });
    expect((await as.query(api.setup.state, { companyId })).facts).toEqual({});
  });

  it("reports each agent as ready only when what it needs exists, and Retention as not available", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const agents = (await as.query(api.setup.state, { companyId })).agents;
    const of = (agent: string) => agents.find((row) => row.agent === agent)!;
    expect(of("retention")).toMatchObject({ state: "not_available", gaps: [] });
    // No plan, no service, no jobs, no cleaners, no sender: each is named, and none is called ready.
    expect(agents.filter((row) => row.state === "ready_to_work")).toEqual([]);
    expect(of("dispatch").gaps.map((gap) => gap.kind)).toEqual(expect.arrayContaining(["information", "connection"]));
    expect(of("sales").gaps.some((gap) => gap.words.includes("No service is published"))).toBe(true);
    expect(of("recruiter").gaps.some((gap) => gap.words.includes("No hiring need"))).toBe(true);
    // A paused agent says so, whatever else is missing.
    await as.mutation(api.companies.setPausedAgents, { companyId, agents: ["dispatch"] });
    expect((await as.query(api.setup.state, { companyId })).agents.find((row) => row.agent === "dispatch")!.state).toBe("paused");
  });

  it("asks each question once, and only for what the owner chose", () => {
    expect(questionsFor(undefined, [])).toEqual([]);
    const sales = questionsFor("sales", []).map((question) => question.id);
    expect(sales).toEqual(["inquiries.channels", "pricing.state", "customers.where"]);
    // Pricing is wanted by both Sales and Booking: asked once.
    const both = questionsFor("sales", ["booking"]).map((question) => question.id);
    expect(both.filter((id) => id === "pricing.state")).toHaveLength(1);
    // A secondary priority adds its required questions only, never its optional ones.
    expect(questionsFor("pricing", ["recruiter"]).map((question) => question.id)).toEqual(["pricing.state", "hiring.now"]);
    expect(stepsFor(undefined, []).map((step) => step.id)).toEqual(["start", "basics", "team", "priority", "prepare", "review"]);
  });
});
