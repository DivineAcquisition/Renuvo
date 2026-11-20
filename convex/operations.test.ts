import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { Check } from "./lib/operations/catalog";
import { company, refusal, start, type T } from "../tests/harness";

const admin = { subject: "user_ops_admin", email: "ops@selestial.example", emailVerified: true, name: "Ops Admin" };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const BRAND = { displayName: "Alpha Cleaning", companyName: "Alpha Cleaning LLC", phone: "+15125550199", street: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", email: "owner@alpha.example", website: "https://alpha.example", vertical: "PROFESSIONAL" };

async function ownerOf(t: T, companyId: Id<"companies">) {
  return t.run(async (ctx) => (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", companyId)).first())!);
}

async function openIncidents(t: T) {
  return t.run((ctx) => ctx.db.query("incidents").withIndex("by_resolved_seen", (q) => q.eq("resolvedAt", 0)).collect());
}

async function mailbox(t: T, companyId: Id<"companies">, status: "connected" | "expired" | "error", failures = 0) {
  const owner = await ownerOf(t, companyId);
  return t.run((ctx) => ctx.db.insert("mailboxConnections", { companyId, provider: "gmail", address: "jobs@alpha.example", sources: [], processFrom: Date.now(), status, failures, purposes: ["hiring"], createdBy: owner._id, createdAt: Date.now() - HOUR }));
}

async function message(t: T, companyId: Id<"companies">, key: string, status: "unconfirmed" | "sending" | "failed" | "delivered", attemptedAt: number, extra: Record<string, unknown> = {}) {
  return t.run((ctx) => ctx.db.insert("messages", { companyId, purpose: "reminder", body: "See you tomorrow", dedupeKey: key, status, attempts: 1, provider: "telnyx", queuedAt: attemptedAt, attemptedAt, ...extra }));
}

const run = (t: T, check: Check) => t.mutation(internal.operations.runCheck, { check });

describe("Operations incidents", () => {
  beforeEach(() => {
    process.env.STAFF_BOOTSTRAP_EMAIL = admin.email;
  });
  afterEach(() => {
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  test("only Selestial staff can read or act on incidents, and members get Not found.", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner_a", "Alpha");
    await mailbox(t, companyId, "expired");
    await run(t, "mailboxes");
    const [incident] = await openIncidents(t);
    expect(await refusal(as.query(api.operations.overview, {}))).toBe("Not found.");
    expect(await refusal(as.query(api.operations.incident, { id: incident._id }))).toBe("Not found.");
    expect(await refusal(as.mutation(api.operations.resolve, { id: incident._id, reason: "I fixed it myself somehow" }))).toBe("Not found.");
    expect(await refusal(t.query(api.operations.list, {}))).toBe("Not found.");
    const overview = await t.withIdentity(admin).query(api.operations.overview, {});
    expect(overview.openCount).toBe(1);
  });

  test("an expired inbox opens one incident waiting for the owner, is not duplicated, and resolves only once reconnected", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const boxId = await mailbox(t, companyId, "expired");
    await run(t, "mailboxes");
    await run(t, "mailboxes");
    const open = await openIncidents(t);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "mailbox_reconnect", state: "waiting_owner", companyId, area: "connections" });
    expect(open[0].impact).toContain("Recruiter cannot check new applications");
    // Diagnostics mask the address.
    expect(open[0].diagnostics).toContain("j•••@alpha.example");
    expect(open[0].diagnostics).not.toContain("jobs@alpha.example");

    // Staff cannot close it while the inbox is still expired.
    const staff = t.withIdentity(admin);
    expect(await refusal(staff.mutation(api.operations.resolve, { id: open[0]._id, reason: "Told the owner to reconnect it" }))).toContain("still happening");
    expect((await staff.mutation(api.operations.recheck, { id: open[0]._id })).resolved).toBe(false);

    // The owner reconnects: the next check verifies it and resolves it with evidence.
    await t.run((ctx) => ctx.db.patch(boxId, { status: "connected", failures: 0 }));
    await run(t, "mailboxes");
    expect(await openIncidents(t)).toHaveLength(0);
    const resolved = await t.run(async (ctx) => (await ctx.db.query("incidents").collect())[0]);
    expect(resolved).toMatchObject({ state: "resolved", resolvedBy: "system" });
    expect(resolved.evidence).toContain("none still shows it");

    // It comes back the same day: the same incident is reopened, not a second one.
    await t.run((ctx) => ctx.db.patch(boxId, { status: "expired" }));
    await run(t, "mailboxes");
    const all = await t.run((ctx) => ctx.db.query("incidents").collect());
    expect(all).toHaveLength(1);
    expect(all[0].resolvedAt).toBe(0);
    const detail = await staff.query(api.operations.incident, { id: all[0]._id });
    expect(detail.updates.map((u) => u.kind)).toEqual(["reopened", "resolved", "opened"]);
  });

  test("an inbox whose reads keep failing is recovering at first and needs staff once retries pile up", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const boxId = await mailbox(t, companyId, "connected", 3);
    await run(t, "mailboxes");
    expect((await openIncidents(t))[0]).toMatchObject({ kind: "mailbox_read_failing", state: "recovering", recoveryAttempts: 3 });
    await t.run((ctx) => ctx.db.patch(boxId, { failures: 6 }));
    await run(t, "mailboxes");
    const [incident] = await openIncidents(t);
    expect(incident).toMatchObject({ state: "needs_staff", recoveryAttempts: 6 });
    const detail = await t.withIdentity(admin).query(api.operations.incident, { id: incident._id });
    expect(detail.updates.map((u) => u.kind)).toEqual(expect.arrayContaining(["state", "recovery"]));
  });

  test("messages with an uncertain outcome are one incident per company, and a delivery report resolves it", async () => {
    const t = start();
    const a = await company(t, "owner_a", "Alpha");
    const b = await company(t, "owner_b", "Bravo");
    const now = Date.now();
    const m1 = await message(t, a.companyId, "a1", "unconfirmed", now - 10 * MINUTE);
    const m2 = await message(t, a.companyId, "a2", "unconfirmed", now - 2 * HOUR);
    await message(t, b.companyId, "b1", "unconfirmed", now - 5 * MINUTE);
    // A member notice is not a business message: it is watched by its own check.
    await message(t, a.companyId, "a3", "unconfirmed", now - 5 * MINUTE, { purpose: "member_notice" });
    await run(t, "uncertain_messages");
    const open = await openIncidents(t);
    expect(open).toHaveLength(2);
    const alpha = open.find((row) => row.companyId === a.companyId)!;
    // One is waiting for its delivery report, one has waited too long: the worse decides.
    expect(alpha).toMatchObject({ occurrences: 2, state: "needs_staff" });
    expect(alpha.title).toContain("2 messages");
    expect(open.find((row) => row.companyId === b.companyId)).toMatchObject({ occurrences: 1, state: "recovering" });

    await t.run(async (ctx) => {
      await ctx.db.patch(m1, { status: "delivered", deliveredAt: Date.now() });
      await ctx.db.patch(m2, { status: "failed", failedAt: Date.now() });
    });
    await run(t, "uncertain_messages");
    const left = await openIncidents(t);
    expect(left.map((row) => row.companyId)).toEqual([b.companyId]);
  });

  test("normal waiting is not an incident: a registration with the carriers that is being checked", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const owner = await ownerOf(t, companyId);
    const now = Date.now();
    const requestId = await t.run((ctx) => ctx.db.insert("textingRequests", { companyId, phoneNumber: "+15125550100", status: "waiting_on_carriers", brand: BRAND, consentWording: "Reply STOP to opt out.", requestedBy: owner._id, requestedAt: now - 3 * 24 * HOUR, lastCheckedAt: now - HOUR }));
    await run(t, "texting");
    expect(await openIncidents(t)).toHaveLength(0);

    // Nobody has read the carriers' answer back for a day: the reconcile has stopped.
    await t.run((ctx) => ctx.db.patch(requestId, { lastCheckedAt: now - 24 * HOUR }));
    await run(t, "texting");
    expect((await openIncidents(t))[0]).toMatchObject({ kind: "texting_stalled", state: "needs_staff" });

    // The carriers asked for a correction: it is the owner's move, with the fields named.
    await t.run((ctx) => ctx.db.patch(requestId, { status: "needs_you", needs: { kind: "correction", words: "Fix the address", fields: ["street"], at: now } }));
    await run(t, "texting");
    const open = await openIncidents(t);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ kind: "texting_needs_owner", state: "waiting_owner" });
    expect(open[0].impact).toContain("street");
  });

  test("a worker that stopped mid-task is found, and the incident resolves once recovery moves the task on", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const owner = await ownerOf(t, companyId);
    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      const activationId = await ctx.db.insert("activations", { companyId, focus: "sales", secondary: [], source: "setup", contextVersion: "v1", context: [], status: "running", startedBy: owner._id, startedAt: now - HOUR, budget: { estimatedCredits: 1, ceilingCredits: 2, allowance: "none" }, noticed: {}, updatedAt: now - HOUR });
      return ctx.db.insert("activationTasks", { companyId, activationId, template: "sales.booking_page", agent: "sales", title: "Make a booking page", objective: "x", sources: [], expectedOutput: "x", prerequisites: [], authority: { action: null, words: "x" }, estimate: { credits: 1, externalCents: 0, words: "x" }, priority: 1, dependsOn: [], completion: "x", state: "working", statusLine: "Working", steps: [], outputs: [], attempts: 1, leaseUntil: now - 30 * MINUTE, nextRunAt: now - HOUR, charges: [], approvals: [], createdAt: now - HOUR, updatedAt: now - 30 * MINUTE });
    });
    await run(t, "agent_work");
    expect((await openIncidents(t))[0]).toMatchObject({ kind: "agent_task_lease_expired", area: "agents", severity: "high", state: "needs_staff" });
    // A lease that ran out a moment ago is the recovery job's to handle: not an incident yet.
    await t.run((ctx) => ctx.db.patch(taskId, { leaseUntil: Date.now() - MINUTE }));
    await run(t, "agent_work");
    expect(await openIncidents(t)).toHaveLength(0);
  });

  test("a failed final record can be closed by staff with a reason; that is recorded with the staff member", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    await t.run((ctx) => ctx.db.insert("googleJobs", { companyId, kind: "sheet_export", key: "k1", status: "failed", payload: "{}", attempts: 5, nextAt: 0, lastError: "403 from Sheets", createdAt: Date.now() - HOUR, updatedAt: Date.now() - HOUR }));
    await run(t, "google");
    const [incident] = await openIncidents(t);
    expect(incident).toMatchObject({ kind: "google_job_failed", state: "needs_staff", recoveryAttempts: 5 });
    const staff = t.withIdentity(admin);
    expect(await refusal(staff.mutation(api.operations.resolve, { id: incident._id, reason: "ok" }))).toContain("Say what was done");
    await staff.mutation(api.operations.resolve, { id: incident._id, reason: "Owner re-shared the sheet; export ran again fine." });
    const detail = await staff.query(api.operations.incident, { id: incident._id });
    expect(detail).toMatchObject({ state: "resolved", resolvedBy: "Ops Admin", evidence: "Owner re-shared the sheet; export ran again fine." });
  });

  test("the same provider failure in three companies is one shared incident, and each company keeps its own", async () => {
    const t = start();
    const companies = [await company(t, "owner_a", "Alpha"), await company(t, "owner_b", "Bravo"), await company(t, "owner_c", "Charlie")];
    const jobs: Id<"googleJobs">[] = [];
    for (const { companyId } of companies) {
      jobs.push(await t.run((ctx) => ctx.db.insert("googleJobs", { companyId, kind: "calendar_event", key: "k", status: "uncertain", payload: "{}", attempts: 1, nextAt: 0, createdAt: Date.now(), updatedAt: Date.now() - 2 * HOUR })));
    }
    await run(t, "google");
    const open = await openIncidents(t);
    const parent = open.find((row) => row.kind === "provider_outage")!;
    // Three companies with the same medium problem: the shared incident is one step more serious.
    expect(parent).toMatchObject({ provider: "google", severity: "high", occurrences: 3 });
    expect(parent.companyId).toBeUndefined();
    const children = open.filter((row) => row.kind === "google_job_uncertain");
    expect(children).toHaveLength(3);
    expect(children.every((row) => row.parentId === parent._id)).toBe(true);
    const detail = await t.withIdentity(admin).query(api.operations.incident, { id: parent._id });
    expect(detail.children.map((c) => c.company?.name).sort()).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Staff cannot close the shared one while companies under it are still affected.
    expect(await refusal(t.withIdentity(admin).mutation(api.operations.resolve, { id: parent._id, reason: "Google says it is fixed now" }))).toContain("still have open incidents");
    await t.run(async (ctx) => {
      for (const id of jobs) await ctx.db.patch(id, { status: "done" });
    });
    await run(t, "google");
    expect(await openIncidents(t)).toHaveLength(0);
  });

  test("callbacks that cannot be processed become a platform incident, and quiet resolves it", async () => {
    const t = start();
    for (let i = 0; i < 3; i += 1) await t.mutation(internal.operations.webhookFailed, { source: "/webhooks/telnyx", detail: "Uncaught Error: boom\n    at handler (secret stack)" });
    await run(t, "inbound_processing");
    const [incident] = await openIncidents(t);
    expect(incident).toMatchObject({ kind: "inbound_processing_failed", provider: "telnyx", state: "investigating", occurrences: 1 });
    expect(incident.companyId).toBeUndefined();
    // Only the first line of the error is kept.
    expect(incident.diagnostics).not.toContain("secret stack");
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("opsSignals").collect()) await ctx.db.patch(row._id, { at: Date.now() - HOUR });
    });
    await run(t, "inbound_processing");
    expect(await openIncidents(t)).toHaveLength(0);
  });

  test("a charge that could not be settled says the work itself is done and will not run again", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    await t.run((ctx) => ctx.db.insert("aiExecutions", { companyId, env: "sandbox", key: "e1", agent: "recruiter", task: "applicant_evaluation", units: 1, rateCardVersion: "v1", rate: 2, credits: 2, autonomous: true, state: "completed", lockAttempts: 0, settlement: "unverified", settleAttempts: 6, settleProblem: "Autumn could not be reached.", createdAt: Date.now() - HOUR, updatedAt: Date.now() - HOUR }));
    await run(t, "ai_billing");
    const [incident] = await openIncidents(t);
    expect(incident).toMatchObject({ kind: "ai_settlement_unverified", area: "billing", state: "needs_staff", recoveryAttempts: 6 });
    expect(incident.impact).toContain("will not run again");
  });

  test("monitoring shows each check's freshness: never run, ok, and stale once it stops finishing", async () => {
    const t = start();
    const staff = t.withIdentity(admin);
    let overview = await staff.query(api.operations.overview, {});
    expect(overview.checks.every((check) => check.freshness === "never_run")).toBe(true);
    expect(overview.monitoringHealthy).toBe(false);

    const started = await t.mutation(internal.operations.tick, {});
    expect(started).toBe(overview.checks.length);
    // A tick right after starts nothing: every check is on its own schedule.
    expect(await t.mutation(internal.operations.tick, {})).toBe(0);
    for (const check of overview.checks) await t.mutation(internal.operations.runCheck, { check: check.check });
    overview = await staff.query(api.operations.overview, {});
    expect(overview.monitoringHealthy).toBe(true);

    await t.run(async (ctx) => {
      const row = (await ctx.db.query("monitorChecks").withIndex("by_check", (q) => q.eq("check", "mailboxes")).first())!;
      await ctx.db.patch(row._id, { lastStartedAt: Date.now() - 2 * HOUR, lastFinishedAt: Date.now() - 2 * HOUR });
      const failing = (await ctx.db.query("monitorChecks").withIndex("by_check", (q) => q.eq("check", "texting")).first())!;
      await ctx.db.patch(failing._id, { lastStartedAt: Date.now(), lastFinishedAt: Date.now() - HOUR });
    });
    overview = await staff.query(api.operations.overview, {});
    expect(overview.checks.find((check) => check.check === "mailboxes")!.freshness).toBe("stale");
    expect(overview.checks.find((check) => check.check === "texting")!.freshness).toBe("failing");
    expect(overview.monitoringHealthy).toBe(false);
  });

  test("the overview counts only real open incidents and names the companies affected", async () => {
    const t = start();
    const a = await company(t, "owner_a", "Alpha");
    const b = await company(t, "owner_b", "Bravo");
    await mailbox(t, a.companyId, "expired");
    await message(t, b.companyId, "b1", "unconfirmed", Date.now() - 2 * HOUR);
    await message(t, b.companyId, "b2", "sending", Date.now() - HOUR);
    await run(t, "mailboxes");
    await run(t, "uncertain_messages");
    await run(t, "stuck_sends");
    const overview = await t.withIdentity(admin).query(api.operations.overview, {});
    expect(overview.openCount).toBe(3);
    expect(overview.byArea).toMatchObject({ connections: 1, communications: 1, platform: 1 });
    expect(overview.platform.map((row) => row.kind)).toEqual(["send_recovery_stopped"]);
    expect(overview.waitingOwner.map((row) => row.company?.name)).toEqual(["Alpha"]);
    expect(overview.affectedCompanies.map((row) => row.name).sort()).toEqual(["Alpha", "Bravo"]);
    expect(overview.needsStaff.map((row) => row.nextActor)).toEqual(["Selestial staff", "Selestial staff"]);
  });

  test("owner notifications that keep failing are found, and one that goes through again clears it", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const owner = await ownerOf(t, companyId);
    const now = Date.now();
    for (let i = 0; i < 3; i += 1) await message(t, companyId, `n${i}`, "failed", now - (i + 1) * MINUTE, { purpose: "member_notice", memberId: owner._id, channel: "email", provider: "resend", problem: "Mailbox full" });
    await run(t, "owner_notices");
    const [incident] = await openIncidents(t);
    expect(incident).toMatchObject({ kind: "owner_notice_failing", severity: "high", state: "needs_staff" });
    expect(incident.impact).not.toContain(owner.email);
    await message(t, companyId, "n-ok", "delivered", now, { purpose: "member_notice", memberId: owner._id, channel: "email", provider: "resend" });
    await run(t, "owner_notices");
    expect(await openIncidents(t)).toHaveLength(0);
  });
});
