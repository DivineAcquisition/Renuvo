/**
 * @vitest-environment edge-runtime
 */
import { describe, expect, it } from "vitest";

import { addMember, company, HOUR, JOB_END, JOB_START, NOW, person, refusal, seedVisit, start, withLinkSecret } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

describe("company isolation", () => {
  it("answers another company's id exactly like a missing one", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const b = await company(t, "owner-b", "Beta Cleaning");
    const inA = await seedVisit(a.as, a.companyId);
    const inB = await seedVisit(b.as, b.companyId);
    const taskB = await b.as.mutation(api.tasks.create, { companyId: b.companyId, agent: "dispatch", title: "Cover Tuesday", nextAction: "Offer to Rosa", dueAt: JOB_START, completionCondition: "A cleaner accepted" });
    const approvalB = await t.mutation(internal.approvals.request, { companyId: b.companyId, action: "dispatch.request_acceptance", summary: "Offer Tuesday to Rosa", reason: "She is free", decideBy: JOB_START });
    const memberB = (await b.as.query(api.members.list, { companyId: b.companyId }))[0].id;
    const missing = await t.run(async (ctx) => {
      const id = await ctx.db.insert("companies", { name: "Gone", timezone: "UTC", pausedAgents: [], createdAt: 1 });
      await ctx.db.delete(id);
      return id;
    });

    const A = a.companyId;
    const address = { line1: "1 Main", city: "Austin", region: "TX", postalCode: "78701" };
    for (const companyId of [b.companyId, missing]) {
      // Owner A reaching into a company that is not theirs, or not there.
      const calls = [
        () => a.as.query(api.companies.get, { companyId }),
        () => a.as.query(api.members.list, { companyId }),
        () => a.as.query(api.customers.list, { companyId }),
        () => a.as.query(api.cleaners.list, { companyId }),
        () => a.as.query(api.jobs.list, { companyId, from: 0, to: JOB_END }),
        () => a.as.query(api.tasks.list, { companyId, status: "open" }),
        () => a.as.query(api.approvals.list, { companyId }),
        () => a.as.query(api.permissions.list, { companyId }),
        () => a.as.query(api.events.recent, { companyId }),
        () => a.as.mutation(api.customers.create, { companyId, name: "X", kind: "home" }),
        () => a.as.mutation(api.permissions.set, { companyId, action: "dispatch.send_reminder", level: "execute" }),
        () => a.as.mutation(api.companies.update, { companyId, name: "Mine now" }),
      ];
      for (const call of calls) expect(await refusal(call())).toBe(NOT_FOUND);
    }

    // Owner A, inside their own company, naming Beta's records.
    const crossed = [
      () => a.as.query(api.customers.get, { companyId: A, customerId: inB.customerId }),
      () => a.as.query(api.properties.get, { companyId: A, propertyId: inB.propertyId }),
      () => a.as.query(api.cleaners.get, { companyId: A, cleanerId: inB.cleanerId }),
      () => a.as.query(api.availability.forCleaner, { companyId: A, cleanerId: inB.cleanerId, from: 0 }),
      () => a.as.query(api.jobs.get, { companyId: A, jobId: inB.jobId }),
      () => a.as.query(api.tasks.get, { companyId: A, taskId: taskB }),
      () => a.as.query(api.approvals.get, { companyId: A, approvalId: approvalB }),
      () => a.as.mutation(api.customers.update, { companyId: A, customerId: inB.customerId, name: "Taken" }),
      () => a.as.mutation(api.properties.create, { companyId: A, customerId: inB.customerId, kind: "home", address }),
      () => a.as.mutation(api.properties.update, { companyId: A, propertyId: inB.propertyId, label: "Taken" }),
      () => a.as.mutation(api.cleaners.setStatus, { companyId: A, cleanerId: inB.cleanerId, status: "ended" }),
      () => a.as.mutation(api.cleaners.setPay, { companyId: A, cleanerId: inB.cleanerId, pay: { kind: "share", shareBps: 1 } }),
      () => a.as.mutation(api.availability.setWeek, { companyId: A, cleanerId: inB.cleanerId, windows: [] }),
      () => a.as.mutation(api.availability.addTimeOff, { companyId: A, cleanerId: inB.cleanerId, startsAt: JOB_START, endsAt: JOB_END }),
      () => a.as.mutation(api.jobs.create, { companyId: A, customerId: inA.customerId, propertyId: inB.propertyId, serviceType: "standard", scope: "x", startsAt: JOB_START, endsAt: JOB_END }),
      () => a.as.mutation(api.jobs.cancel, { companyId: A, jobId: inB.jobId, reason: "no" }),
      () => a.as.mutation(api.assignments.offer, { companyId: A, jobId: inA.jobId, cleanerId: inB.cleanerId, respondBy: JOB_START - HOUR, payCents: 100 }),
      () => a.as.mutation(api.assignments.offer, { companyId: A, jobId: inB.jobId, cleanerId: inA.cleanerId, respondBy: JOB_START - HOUR, payCents: 100 }),
      () => a.as.mutation(api.tasks.complete, { companyId: A, taskId: taskB, outcome: "done" }),
      () => a.as.mutation(api.tasks.create, { companyId: A, agent: "dispatch", title: "t", nextAction: "n", dueAt: JOB_START, completionCondition: "c", about: { table: "jobs", id: inB.jobId } }),
      () => a.as.mutation(api.approvals.decide, { companyId: A, approvalId: approvalB, decision: "approved" }),
      () => a.as.mutation(api.members.remove, { companyId: A, memberId: memberB }),
    ];
    for (const call of crossed) expect(await refusal(call())).toBe(NOT_FOUND);

    // One record's history is read through the company, so Beta's job has no history in Alpha.
    expect(await a.as.query(api.events.forSubject, { companyId: A, subject: { table: "jobs", id: inB.jobId } })).toEqual([]);
    expect((await b.as.query(api.events.forSubject, { companyId: b.companyId, subject: { table: "jobs", id: inB.jobId } })).length).toBe(1);
    // Nothing of Alpha's changed, and nothing of Beta's either.
    expect((await b.as.query(api.customers.get, { companyId: b.companyId, customerId: inB.customerId })).customer.name).toBe("Dana Whitfield");
    expect(await a.as.query(api.companies.mine, {})).toEqual([{ companyId: A, name: "Alpha Cleaning", role: "owner" }]);
  });

  it("answers someone who is signed out with not found", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    expect(await refusal(t.query(api.companies.get, { companyId: a.companyId }))).toBe(NOT_FOUND);
    expect(await refusal(t.query(api.companies.mine, {}))).toBe(NOT_FOUND);
    expect(await refusal(t.mutation(api.companies.create, { name: "X", timezone: "UTC" }))).toBe(NOT_FOUND);
  });

  it("lets a person in only by an invitation to their verified email, and out when removed", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const A = a.companyId;
    await withLinkSecret(() => a.as.mutation(api.invitations.create, { companyId: A, email: "Mia@Example.com", name: "Mia", role: "office" }));

    const stranger = t.withIdentity(person("stranger"));
    expect(await refusal(stranger.mutation(api.members.join, { companyId: A }))).toBe(NOT_FOUND);
    const unverified = t.withIdentity(person("mia", { emailVerified: false }));
    expect(await refusal(unverified.mutation(api.members.join, { companyId: A }))).toBe(NOT_FOUND);
    expect(await unverified.query(api.members.invitations, {})).toEqual([]);

    const mia = t.withIdentity(person("mia"));
    expect(await refusal(mia.query(api.companies.get, { companyId: A }))).toBe(NOT_FOUND);
    expect(await mia.query(api.members.invitations, {})).toEqual([{ companyId: A, companyName: "Alpha Cleaning", role: "office" }]);
    const memberId = await mia.mutation(api.members.join, { companyId: A });
    expect((await mia.query(api.companies.get, { companyId: A })).role).toBe("office");
    expect(await refusal(mia.mutation(api.members.join, { companyId: A }))).toBe(NOT_FOUND);
    expect(await refusal(withLinkSecret(() => a.as.mutation(api.invitations.create, { companyId: A, email: "mia@example.com", name: "Mia", role: "manager" })))).toContain("already");

    await a.as.mutation(api.members.remove, { companyId: A, memberId });
    expect(await refusal(mia.query(api.companies.get, { companyId: A }))).toBe(NOT_FOUND);
    expect(await mia.query(api.companies.mine, {})).toEqual([]);
  });

  it("keeps each role to its own work", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const A = a.companyId;
    const manager = await addMember(t, a.as, A, "manager-a", "manager");
    const office = await addMember(t, a.as, A, "office-a", "office");
    const { cleanerId } = await seedVisit(a.as, A);
    await a.as.mutation(api.cleaners.setPay, { companyId: A, cleanerId, pay: { kind: "share", shareBps: 5500 } });
    const approvalId = await t.mutation(internal.approvals.request, { companyId: A, action: "dispatch.request_acceptance", summary: "Offer Tuesday to Rosa", reason: "She is free", decideBy: NOW + HOUR });
    const ownerMember = (await a.as.query(api.members.list, { companyId: A })).find((row) => row.role === "owner")!.id;

    // Office works the queue: customers, jobs and tasks. Not workforce records, approvals or settings.
    await office.mutation(api.customers.create, { companyId: A, name: "New lead", kind: "home" });
    const officeRefused = [
      () => office.mutation(api.cleaners.create, { companyId: A, name: "Sam", engagement: "employee" }),
      () => office.mutation(api.cleaners.setStatus, { companyId: A, cleanerId, status: "ended" }),
      () => office.query(api.approvals.list, { companyId: A }),
      () => office.mutation(api.approvals.decide, { companyId: A, approvalId, decision: "approved" }),
    ];
    for (const call of officeRefused) expect(await refusal(call())).toBe(NOT_ALLOWED);

    // A Manager runs operations and approvals. Authority, pay and people stay with the Owner.
    const managerRefused = [
      () => manager.mutation(api.permissions.set, { companyId: A, action: "dispatch.send_reminder", level: "execute" }),
      () => manager.mutation(api.cleaners.setPay, { companyId: A, cleanerId, pay: { kind: "share", shareBps: 9000 } }),
      () => manager.mutation(api.invitations.create, { companyId: A, email: "friend@example.com", name: "Friend", role: "manager" }),
      () => manager.mutation(api.companies.setPausedAgents, { companyId: A, agents: [] }),
      () => manager.mutation(api.companies.update, { companyId: A, name: "Renamed" }),
    ];
    for (const call of managerRefused) expect(await refusal(call())).toBe(NOT_ALLOWED);
    await manager.mutation(api.approvals.decide, { companyId: A, approvalId, decision: "approved" });

    // Pay is shown to the Owner only.
    expect((await a.as.query(api.cleaners.get, { companyId: A, cleanerId })).pay).toEqual({ kind: "share", shareBps: 5500 });
    expect("pay" in (await manager.query(api.cleaners.get, { companyId: A, cleanerId }))).toBe(false);
    expect((await office.query(api.cleaners.list, { companyId: A })).some((row) => "pay" in row)).toBe(false);

    // Nobody becomes an Owner by a role change, and the Owner cannot be removed.
    expect(await refusal(a.as.mutation(api.members.setRole, { companyId: A, memberId: ownerMember, role: "office" }))).toContain("Owner");
    expect(await refusal(a.as.mutation(api.members.remove, { companyId: A, memberId: ownerMember }))).toContain("Owner");
  });
});
