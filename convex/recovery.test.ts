import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockEmailOutbox } from "./lib/email/provider";
import type { Check } from "./lib/operations/catalog";
import { addMember, company, refusal, start, type T } from "../tests/harness";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const run = (t: T, check: Check) => t.mutation(internal.operations.runCheck, { check });

async function ownerOf(t: T, companyId: Id<"companies">) {
  return t.run(async (ctx) => (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", companyId)).first())!);
}

async function mailbox(t: T, companyId: Id<"companies">, status: "connected" | "expired", failures = 0) {
  const owner = await ownerOf(t, companyId);
  return t.run((ctx) => ctx.db.insert("mailboxConnections", { companyId, provider: "gmail", address: "jobs@alpha.example", sources: [], processFrom: Date.now(), status, failures, purposes: ["hiring"], createdBy: owner._id, createdAt: Date.now() - HOUR }));
}

async function googleConnection(t: T, companyId: Id<"companies">, status: "connected" | "expired") {
  const owner = await ownerOf(t, companyId);
  return t.run((ctx) => ctx.db.insert("googleConnections", { companyId, feature: "calendar", googleSub: "sub-1", email: "owner@alpha.example", status, grantedScopes: [], connectedBy: owner._id, connectedAt: Date.now() - HOUR }));
}

const notices = (t: T, kind: string) => t.run(async (ctx) => (await ctx.db.query("memberNotices").collect()).filter((row) => row.kind === kind));
const emails = (t: T, event: string) => t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((row) => row.notice?.event === event));

describe("Owner recovery and notifications", () => {
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = "mock";
    mockEmailOutbox.length = 0;
  });
  afterEach(() => {
    delete process.env.EMAIL_PROVIDER;
    delete process.env.ADMIN_ORIGIN;
  });

  test("an expired hiring inbox becomes one plain card with one real next step, and none of Selestial's internals", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const boxId = await mailbox(t, companyId, "expired");
    await run(t, "mailboxes");
    const { open } = await owner.query(api.operations.issues, { companyId });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      title: "Your hiring inbox needs reconnecting",
      affected: "Recruiter can't check new applications. Your existing applicants are saved.",
      action: { kind: "link", label: "Reconnect Gmail", href: "/app/settings/integrations?tool=gmail" },
      tone: "action",
    });
    expect(open[0].places).toEqual(["home", "integrations"]);
    expect(open[0].reference).toMatch(/^INC-[A-Z0-9]{6}$/);
    // Provider codes, record ids and addresses stay with staff.
    const shown = JSON.stringify(open);
    expect(shown).not.toContain(boxId);
    expect(shown).not.toContain("jobs@alpha.example");
    expect(shown).not.toContain("mailbox_reconnect");
  });

  test("only the company's Owner and Managers see its problems", async () => {
    const t = start();
    const a = await company(t, "owner_a", "Alpha");
    const b = await company(t, "owner_b", "Bravo");
    await mailbox(t, a.companyId, "expired");
    await run(t, "mailboxes");
    const office = await addMember(t, a.as, a.companyId, "office_a", "office");
    expect(await refusal(office.query(api.operations.issues, { companyId: a.companyId }))).toBe("Not allowed.");
    const manager = await addMember(t, a.as, a.companyId, "manager_a", "manager");
    expect((await manager.query(api.operations.issues, { companyId: a.companyId })).open).toHaveLength(1);
    expect((await b.as.query(api.operations.issues, { companyId: b.companyId })).open).toHaveLength(0);
    expect(await refusal(b.as.query(api.operations.issues, { companyId: a.companyId }))).toBe("Not found.");
    const [incident] = await t.run((ctx) => ctx.db.query("incidents").collect());
    expect(await refusal(b.as.mutation(api.operations.contactSupport, { companyId: b.companyId, incidentId: incident._id }))).toBe("Not found.");
  });

  test("the owner is told once that they must act, emailed once for a problem with no email of its own, and told once when it is fixed", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const connectionId = await googleConnection(t, companyId, "expired");
    await run(t, "google");
    await run(t, "google");
    await run(t, "google");
    expect(await notices(t, "service_issue")).toHaveLength(1);
    expect(await emails(t, "service_attention")).toHaveLength(1);

    await t.run((ctx) => ctx.db.patch(connectionId, { status: "connected" }));
    await run(t, "google");
    await run(t, "google");
    const fixed = await notices(t, "service_recovered");
    expect(fixed).toHaveLength(1);
    expect(fixed[0].headline).toBe("Fixed: google needs reconnecting");
    const { open, fixed: recent } = await owner.query(api.operations.issues, { companyId });
    expect(open).toHaveLength(0);
    expect(recent[0].updates.map((row) => row.words)).toEqual(["Fixed, and checked.", "Selestial noticed the problem."]);
  });

  test("an inbox that already sends its own reconnect email is not emailed twice", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    await mailbox(t, companyId, "expired");
    await run(t, "mailboxes");
    expect(await notices(t, "service_issue")).toHaveLength(1);
    expect(await emails(t, "service_attention")).toHaveLength(0);
  });

  test("when retries run out, Selestial staff get one grouped alert and the timeline says the team took over", async () => {
    const t = start();
    await t.mutation(internal.staff.grant, { email: "ops@selestial.example", name: "Ops", role: "admin" });
    await t.mutation(internal.staff.grant, { email: "help@selestial.example", name: "Help", role: "support" });
    await t.mutation(internal.staff.grant, { email: "queue@selestial.example", name: "Queue", role: "reviewer" });
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const boxId = await mailbox(t, companyId, "connected", 3);
    await run(t, "mailboxes");
    expect(await t.run((ctx) => ctx.db.query("staffAlerts").collect())).toHaveLength(0);
    await t.run((ctx) => ctx.db.patch(boxId, { failures: 6 }));
    await run(t, "mailboxes");
    await run(t, "mailboxes");
    const alerts = await t.run((ctx) => ctx.db.query("staffAlerts").collect());
    expect(alerts.map((row) => row.reason)).toEqual(["recovery_exhausted"]);

    process.env.ADMIN_ORIGIN = "https://admin.example.test";
    expect(await t.action(internal.operations.sendStaffAlerts, {})).toEqual({ sent: 1 });
    // One message to each admin and support person; reviewers work the request queues.
    expect(mockEmailOutbox.map((row) => row.to).sort()).toEqual(["help@selestial.example", "ops@selestial.example"]);
    expect(mockEmailOutbox[0].subject).toBe("1 incident needs Selestial staff");
    expect(mockEmailOutbox[0].text).toContain("Automatic recovery ran out");
    expect(mockEmailOutbox[0].text).toContain("https://admin.example.test/staff/operations");
    expect(mockEmailOutbox[0].text).not.toContain("jobs@alpha.example");
    // Nothing waits, so the next run sends nothing.
    expect(await t.action(internal.operations.sendStaffAlerts, {})).toEqual({ sent: 0 });
    expect(mockEmailOutbox).toHaveLength(2);

    const { open } = await owner.query(api.operations.issues, { companyId });
    expect(open[0].updates.map((row) => row.words)).toContain("Selestial's team took over.");
  });

  test("Contact support hands over what Selestial knows, without secrets, and tells staff once a day", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    await mailbox(t, companyId, "expired");
    await run(t, "mailboxes");
    const [incident] = await t.run((ctx) => ctx.db.query("incidents").collect());
    const handoff = await owner.mutation(api.operations.contactSupport, { companyId, incidentId: incident._id });
    expect(handoff.subject).toContain(handoff.reference);
    expect(handoff.body).toContain(`Reference: ${handoff.reference}`);
    expect(handoff.body).toContain("Problem: Your hiring inbox needs reconnecting");
    expect(handoff.body).toContain("First noticed:");
    expect(handoff.body).not.toContain("jobs@alpha.example");
    await owner.mutation(api.operations.contactSupport, { companyId, incidentId: incident._id });
    const alerts = await t.run((ctx) => ctx.db.query("staffAlerts").collect());
    expect(alerts.filter((row) => row.reason === "owner_asked")).toHaveLength(1);
    expect((await owner.query(api.operations.issues, { companyId })).open[0].supportAsked).toBe(true);
  });

  test("failed first agent work offers the real retry, which re-queues it", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const ownerRow = await ownerOf(t, companyId);
    const now = Date.now();
    const taskId = await t.run(async (ctx) => {
      const activationId = await ctx.db.insert("activations", { companyId, focus: "sales", secondary: [], source: "setup", contextVersion: "v1", context: [], status: "partial", startedBy: ownerRow._id, startedAt: now - HOUR, budget: { estimatedCredits: 1, ceilingCredits: 2, allowance: "none" }, noticed: {}, updatedAt: now - HOUR });
      return ctx.db.insert("activationTasks", { companyId, activationId, template: "sales.booking_page", agent: "sales", title: "Make a booking page", objective: "x", sources: [], expectedOutput: "x", prerequisites: [], authority: { action: null, words: "x" }, estimate: { credits: 1, externalCents: 0, words: "x" }, priority: 1, dependsOn: [], completion: "x", state: "failed", statusLine: "Failed", steps: [], outputs: [], attempts: 3, nextRunAt: now, charges: [], approvals: [], createdAt: now - HOUR, updatedAt: now - 10 * MINUTE });
    });
    await run(t, "agent_work");
    const { open } = await owner.query(api.operations.issues, { companyId });
    expect(open[0]).toMatchObject({ title: "A piece of your agents' first work couldn't finish", action: { kind: "retry", label: "Try again", taskId } });
    await owner.mutation(api.activation.retry, { companyId, taskId: open[0].action.kind === "retry" ? (open[0].action.taskId as Id<"activationTasks">) : taskId });
    expect((await t.run((ctx) => ctx.db.get(taskId)))!.state).toBe("queued");
  });

  test("Selestial's own bookkeeping has no card for the company", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    await t.run((ctx) => ctx.db.insert("aiExecutions", { companyId, env: "sandbox", key: "e1", agent: "recruiter", task: "applicant_evaluation", units: 1, rateCardVersion: "v1", rate: 2, credits: 2, autonomous: true, state: "completed", lockAttempts: 0, settlement: "unverified", settleAttempts: 6, createdAt: Date.now() - HOUR, updatedAt: Date.now() - HOUR }));
    await run(t, "ai_billing");
    expect(await t.run((ctx) => ctx.db.query("incidents").collect())).toHaveLength(1);
    expect((await owner.query(api.operations.issues, { companyId })).open).toHaveLength(0);
    expect(await notices(t, "service_issue")).toHaveLength(0);
  });
});
