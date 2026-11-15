/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, HOUR, NOW, refusal, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { authorityFor } from "./lib/authority";
import { ACTIONS, initialLevel, PERSON_ONLY, rank } from "./lib/permissionCatalog";

describe("permissions per action", () => {
  it("starts every company with review for anything an outsider sees", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const { actions, personOnly } = await as.query(api.permissions.list, { companyId });
    expect(actions.length).toBe(ACTIONS.length);
    for (const def of ACTIONS.filter((entry) => entry.outsider)) {
      expect(rank(actions.find((row) => row.key === def.key)!.level), def.key).toBeLessThanOrEqual(rank("propose"));
    }
    // Something no outsider sees starts where the brief puts it.
    expect(actions.find((row) => row.key === "dispatch.close_visit")).toMatchObject({ level: "execute_and_report", changed: false });
    expect(personOnly).toEqual(PERSON_ONLY);
    // The catalog itself is consistent: no starting level above an action's ceiling.
    for (const def of ACTIONS) expect(rank(initialLevel(def)), def.key).toBeLessThanOrEqual(rank(def.ceiling));
  });

  it("is granular, capped, and never opens what always needs a person", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const level = (action: string) => t.run((ctx) => authorityFor(ctx, companyId, action));

    await as.mutation(api.permissions.set, { companyId, action: "dispatch.send_reminder", level: "execute" });
    expect(await level("dispatch.send_reminder")).toEqual({ kind: "level", level: "execute" });
    // Permission to send a reminder grants nothing else.
    expect(await level("dispatch.reassign_confirmed_visit")).toEqual({ kind: "level", level: "propose" });
    expect(await level("sales.discount_in_band")).toEqual({ kind: "level", level: "propose" });

    expect(await refusal(as.mutation(api.permissions.set, { companyId, action: "retention.refund_above_limit", level: "execute" }))).toContain("cannot be set higher than Propose");
    expect(await refusal(as.mutation(api.permissions.set, { companyId, action: "person.pay_run", level: "execute" }))).toContain("always needs a person");
    expect(await refusal(as.mutation(api.permissions.set, { companyId, action: "dispatch.fire_cleaner", level: "execute" }))).toContain("not an action");
    expect(await level("person.pay_run")).toEqual({ kind: "person_only" });
    expect(await level("dispatch.fire_cleaner")).toEqual({ kind: "unknown" });

    // Money needs the Owner's limits before it runs without review, and the limits are whole cents.
    const money = (fields: object) => as.mutation(api.permissions.set, { companyId, action: "sales.discount_in_band", level: "execute_and_report", ...fields });
    expect(await refusal(money({}))).toContain("Set a limit");
    expect(await refusal(money({ perActionCents: 5000, perDayCents: 2000 }))).toContain("cannot be more than");
    expect(await refusal(money({ perActionCents: 10.5, perDayCents: 2000 }))).toContain("whole number of cents");
    expect(await refusal(as.mutation(api.permissions.set, { companyId, action: "dispatch.send_reminder", level: "execute", perDayCents: 100 }))).toContain("only to actions that move money");
    await money({ perActionCents: 2000, perDayCents: 10000 });
    expect(await level("sales.discount_in_band")).toEqual({ kind: "level", level: "execute_and_report", perActionCents: 2000, perDayCents: 10000 });

    // Off is a level too, and pausing an agent stops all of its actions without touching the others.
    await as.mutation(api.permissions.set, { companyId, action: "dispatch.send_reminder", level: "off" });
    expect(await level("dispatch.send_reminder")).toEqual({ kind: "level", level: "off" });
    await as.mutation(api.companies.setPausedAgents, { companyId, agents: ["sales"] });
    expect(await level("sales.discount_in_band")).toEqual({ kind: "paused" });
    expect(await level("dispatch.send_reminder")).toEqual({ kind: "level", level: "off" });

    const changes = (await as.query(api.events.recent, { companyId })).filter((event) => event.type === "permission.changed");
    expect(changes.map((event) => event.data)).toContainEqual({ action: "dispatch.send_reminder", from: "propose", to: "execute" });
  });
});

describe("approvals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts a proposal in one queue and records who decided what", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const manager = await addMember(t, as, companyId, "manager-a", "manager");
    const propose = (summary: string) =>
      t.mutation(internal.approvals.request, { companyId, action: "dispatch.reassign_confirmed_visit", summary, reason: "Rosa called in sick; Lena is free and has cleaned this home before.", decideBy: NOW + 2 * HOUR });

    const first = await propose("Move Tuesday's visit from Rosa to Lena");
    const second = await propose("Move Wednesday's visit from Rosa to Lena");
    const third = await propose("Move Thursday's visit from Rosa to Lena");
    expect((await as.query(api.approvals.list, { companyId })).map((row) => row._id)).toEqual([first, second, third]);

    await manager.mutation(api.approvals.decide, { companyId, approvalId: first, decision: "approved" });
    expect(await refusal(as.mutation(api.approvals.decide, { companyId, approvalId: second, decision: "changed" }))).toContain("Say what to change");
    await as.mutation(api.approvals.decide, { companyId, approvalId: second, decision: "changed", note: "Use Maya instead; Lena is at capacity." });
    await as.mutation(api.approvals.decide, { companyId, approvalId: third, decision: "skipped", note: "Customer rescheduled." });

    const managerId = (await as.query(api.members.list, { companyId })).find((row) => row.role === "manager")!.id;
    expect(await as.query(api.approvals.get, { companyId, approvalId: first })).toMatchObject({ status: "approved", agent: "dispatch", decidedBy: managerId });
    expect(await as.query(api.approvals.get, { companyId, approvalId: second })).toMatchObject({ status: "changed", note: "Use Maya instead; Lena is at capacity." });
    // A decision is made once.
    expect(await refusal(as.mutation(api.approvals.decide, { companyId, approvalId: first, decision: "skipped" }))).toContain("already approved");
    expect(await as.query(api.approvals.list, { companyId })).toEqual([]);

    const history = await as.query(api.events.forSubject, { companyId, subject: { table: "approvals", id: first } });
    expect(history.map((event) => [event.type, event.actor.kind])).toEqual([
      ["approval.requested", "agent"],
      ["approval.approved", "member"],
    ]);
  });

  it("never treats silence as approval", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const approvalId = await t.mutation(internal.approvals.request, { companyId, action: "sales.discount_out_of_band", summary: "Offer 20% off the first clean", reason: "Customer has a competing quote.", decideBy: NOW + HOUR });
    await expect(t.mutation(internal.approvals.request, { companyId, action: "sales.invent_discount", summary: "x", reason: "y", decideBy: NOW + HOUR })).rejects.toThrow("Unknown action");

    vi.setSystemTime(NOW + HOUR + 1);
    expect(await t.mutation(internal.approvals.expireDue, {})).toBe(1);
    expect(await as.query(api.approvals.get, { companyId, approvalId })).toMatchObject({ status: "expired" });
    expect(await refusal(as.mutation(api.approvals.decide, { companyId, approvalId, decision: "approved" }))).toContain("already expired");
  });
});
