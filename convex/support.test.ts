import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { redactingDb } from "./lib/support/access";
import { HIDDEN_WORDS, SUPPORT_NAME } from "./lib/support/catalog";
import { company, person, refusal, start, type T } from "../tests/harness";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** A staff admin whose second factor was confirmed a minute ago (the sign-in token's fva claim). */
const admin = { subject: "user_support_admin", email: "support@selestial.example", emailVerified: true, name: "Sam Support", fva: [1, 1] };
const helperIdentity = { subject: "user_helper", email: "helper@selestial.example", emailVerified: true, name: "Helper", fva: [1, 1] };

async function ownerOf(t: T, companyId: Id<"companies">) {
  return t.run(async (ctx) => (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", companyId)).first())!);
}

async function failedTask(t: T, companyId: Id<"companies">) {
  const owner = await ownerOf(t, companyId);
  const now = Date.now();
  return t.run(async (ctx) => {
    const activationId = await ctx.db.insert("activations", { companyId, focus: "sales", secondary: [], source: "setup", contextVersion: "v1", context: [], status: "partial", startedBy: owner._id, startedAt: now - HOUR, budget: { estimatedCredits: 1, ceilingCredits: 2, allowance: "none" }, noticed: {}, updatedAt: now - HOUR });
    return ctx.db.insert("activationTasks", { companyId, activationId, template: "sales.booking_page", agent: "sales", title: "Make a booking page", objective: "x", sources: [], expectedOutput: "x", prerequisites: [], authority: { action: null, words: "x" }, estimate: { credits: 1, externalCents: 0, words: "x" }, priority: 1, dependsOn: [], completion: "x", state: "failed", statusLine: "Failed", steps: [], outputs: [], attempts: 3, nextRunAt: now, charges: [], approvals: [], createdAt: now - HOUR, updatedAt: now - HOUR });
  });
}

async function openIncident(t: T, companyId: Id<"companies">) {
  const now = Date.now();
  return t.run((ctx) => ctx.db.insert("incidents", { key: `mailbox_reconnect:${companyId}`, check: "mailboxes", kind: "mailbox_reconnect", area: "connections", companyId, severity: "high", state: "waiting_owner", title: "Inbox needs reconnecting", impact: "x", nextAction: "x", related: [], occurrences: 1, recoveryAttempts: 0, firstSeenAt: now, lastSeenAt: now, lastCheckedAt: now, resolvedAt: 0, updatedAt: now }));
}

describe("Admin Support Sessions", () => {
  beforeEach(() => {
    process.env.STAFF_BOOTSTRAP_EMAIL = admin.email;
    process.env.SUPPORT_ACCESS = "on";
  });
  afterEach(() => {
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
    delete process.env.SUPPORT_ACCESS;
  });

  test("only staff with workspace access, a recent second factor and a reason can start one; it is off unless the deployment turns it on", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const staff = t.withIdentity(admin);
    // A member of the company is not staff.
    expect(await refusal(owner.mutation(api.support.start, { companyId, reason: "Checking the inbox setup" }))).toBe("Not found.");
    expect(await refusal(staff.mutation(api.support.start, { companyId, reason: "short" }))).toContain("Say why");
    expect(await refusal(t.withIdentity({ ...admin, fva: [30, 30] }).mutation(api.support.start, { companyId, reason: "Checking the inbox setup" }))).toContain("last confirmed 30 minutes ago");
    expect(await refusal(t.withIdentity({ ...admin, fva: [1, -1] }).mutation(api.support.start, { companyId, reason: "Checking the inbox setup" }))).toContain("two-step verification");
    const noClaim = { subject: admin.subject, email: admin.email, emailVerified: true, name: admin.name };
    expect(await refusal(t.withIdentity(noClaim).mutation(api.support.start, { companyId, reason: "Checking the inbox setup" }))).toContain("doesn't say when");
    // A reviewer works the request queues and opens no workspace.
    await staff.mutation(api.staff.add, { email: helperIdentity.email, name: "Helper", role: "reviewer" });
    expect(await refusal(t.withIdentity(helperIdentity).mutation(api.support.start, { companyId, reason: "Checking the inbox setup" }))).toBe("Not allowed.");
    process.env.SUPPORT_ACCESS = "off";
    expect(await refusal(staff.mutation(api.support.start, { companyId, reason: "Checking the inbox setup" }))).toContain("turned off");
    process.env.SUPPORT_ACCESS = "on";
    expect(await staff.mutation(api.support.start, { companyId, reason: "Checking the inbox setup" })).toBeTruthy();
  });

  test("View reads what the owner sees, refuses every write at the backend, and is bound to its company", async () => {
    const t = start();
    const a = await company(t, "owner_a", "Alpha");
    const b = await company(t, "owner_b", "Bravo");
    const staff = t.withIdentity(admin);
    const sessionId = await staff.mutation(api.support.start, { companyId: a.companyId, reason: "Owner reported a setup problem" });
    const read = await staff.query(api.companies.get, { companyId: a.companyId, supportSessionId: sessionId });
    expect(read.name).toBe("Alpha");
    // Without the session, staff are not members.
    expect(await refusal(staff.query(api.companies.get, { companyId: a.companyId }))).toBe("Not found.");
    // The session cannot be pointed at another company.
    expect(await refusal(staff.query(api.companies.get, { companyId: b.companyId, supportSessionId: sessionId }))).toBe("Not found.");
    expect(await refusal(staff.mutation(api.companies.setPausedAgents, { companyId: a.companyId, supportSessionId: sessionId, agents: ["sales"] }))).toContain("view only");
    // Another person cannot use this staff member's session.
    expect(await refusal(a.as.query(api.companies.get, { companyId: a.companyId, supportSessionId: sessionId }))).toBe("Not found.");
  });

  test("Manage needs the owner's grant or an open incident, and only opened changes work, as Selestial Support", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const ownerRow = await ownerOf(t, companyId);
    const staff = t.withIdentity(admin);
    const sessionId = await staff.mutation(api.support.start, { companyId, reason: "Owner reported a setup problem" });
    expect(await refusal(staff.mutation(api.support.switchToManage, { sessionId, reason: "Pause sales while we look" }))).toContain("owner's permission");

    await owner.mutation(api.support.grantManage, { companyId, hours: 4 });
    await staff.mutation(api.support.switchToManage, { sessionId, reason: "Pause sales while we look" });
    // The owner is told in the app at once.
    const notices = await t.run((ctx) => ctx.db.query("memberNotices").collect());
    expect(notices.filter((row) => row.kind === "support_access" && row.memberId === ownerRow._id)).toHaveLength(1);

    // An opened change works, and is recorded as Selestial Support, never the owner.
    await staff.mutation(api.companies.setPausedAgents, { companyId, supportSessionId: sessionId, agents: ["sales"] });
    const after = await t.run(async (ctx) => {
      const event = (await ctx.db.query("events").collect()).find((row) => row.type === "company.agents_paused_changed")!;
      const actor = event.actor.kind === "member" ? await ctx.db.get(event.actor.memberId) : null;
      const changes = await ctx.db.query("supportEvents").collect();
      return { actor, changes, company: await ctx.db.get(companyId) };
    });
    expect(after.company!.pausedAgents).toEqual(["sales"]);
    expect(after.actor).toMatchObject({ name: SUPPORT_NAME, status: "support" });
    expect(after.actor!._id).not.toBe(ownerRow._id);
    const change = after.changes.find((row) => row.kind === "change")!;
    expect(change).toMatchObject({ summary: "paused agents", fields: ["agents"] });
    // The actual admin is kept with every change.
    const staffRow = await t.run(async (ctx) => (await ctx.db.query("staff").collect())[0]);
    expect(change.staffId).toBe(staffRow._id);

    // Support can pause, never resume.
    expect(await refusal(staff.mutation(api.companies.setPausedAgents, { companyId, supportSessionId: sessionId, agents: [] }))).toContain("Only the company can resume");
    // Changes not opened to support sessions stay closed, even in Manage: owner-only settings and anything else.
    expect(await refusal(staff.mutation(api.companies.update, { companyId, supportSessionId: sessionId, name: "Renamed", timezone: "America/Chicago" }))).toContain("can't do this");
    // Approvals stay the company's: staff never decide one, even in Manage.
    const approvalId = await t.run((ctx) => ctx.db.insert("approvals", { companyId, agent: "sales", action: "sales.discount_out_of_band", summary: "Discount", reason: "Asked", status: "pending", decideBy: Date.now() + HOUR, createdAt: Date.now() }));
    expect(await refusal(staff.mutation(api.approvals.decide, { companyId, supportSessionId: sessionId, approvalId, decision: "approved" }))).toContain("can't do this");
    expect((await t.run((ctx) => ctx.db.get(approvalId)))!.status).toBe("pending");
    // The Selestial Support member is not on the team list.
    const team = await owner.query(api.members.list, { companyId });
    expect(team.map((row) => row.name)).not.toContain(SUPPORT_NAME);
  });

  test("an open incident allows Manage, and resolving it ends the ability to change things", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const incidentId = await openIncident(t, companyId);
    const taskId = await failedTask(t, companyId);
    const staff = t.withIdentity(admin);
    const sessionId = await staff.mutation(api.support.start, { companyId, reason: "Incident: first work failed", incidentId });
    await staff.mutation(api.support.switchToManage, { sessionId, reason: "Retry the failed booking page work" });
    await staff.mutation(api.activation.retry, { companyId, supportSessionId: sessionId, taskId });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task!.state).toBe("queued");
    expect(task!.steps.at(-1)!.words).toBe("Selestial Support tried it again.");
    // Retrying what is already going does not run it twice.
    expect(await refusal(staff.mutation(api.activation.retry, { companyId, supportSessionId: sessionId, taskId }))).toContain("already going");

    await t.run((ctx) => ctx.db.patch(incidentId, { resolvedAt: Date.now(), state: "resolved" }));
    expect(await refusal(staff.mutation(api.companies.setPausedAgents, { companyId, supportSessionId: sessionId, agents: ["sales"] }))).toContain("Manage access has ended");
  });

  test("the owner revoking Manage drops the session back to View at once", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const staff = t.withIdentity(admin);
    await owner.mutation(api.support.grantManage, { companyId });
    const sessionId = await staff.mutation(api.support.start, { companyId, reason: "Help with booking settings" });
    await staff.mutation(api.support.switchToManage, { sessionId, reason: "Fix the booking hours" });
    await owner.mutation(api.support.revokeManage, { companyId });
    expect(await refusal(staff.mutation(api.companies.setPausedAgents, { companyId, supportSessionId: sessionId, agents: ["sales"] }))).toContain("view only");
  });

  test("expired, exited and revoked sessions stop working, and removing staff ends theirs", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const staff = t.withIdentity(admin);
    const expired = await staff.mutation(api.support.start, { companyId, reason: "Looking at the setup" });
    await t.run((ctx) => ctx.db.patch(expired, { expiresAt: Date.now() - 1 }));
    expect(await refusal(staff.query(api.companies.get, { companyId, supportSessionId: expired }))).toContain("has ended");
    expect(await t.mutation(internal.support.expireDue, {})).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(expired)))!.endReason).toBe("expired");

    const exited = await staff.mutation(api.support.start, { companyId, reason: "Looking at the setup" });
    await staff.mutation(api.support.exit, { sessionId: exited });
    expect(await refusal(staff.query(api.companies.get, { companyId, supportSessionId: exited }))).toContain("has ended");

    // A support staff member, removed while a session is open.
    await staff.mutation(api.staff.add, { email: helperIdentity.email, name: "Helper", role: "support" });
    const helper = t.withIdentity(helperIdentity);
    const theirs = await helper.mutation(api.support.start, { companyId, reason: "Looking at the setup" });
    expect((await helper.query(api.companies.get, { companyId, supportSessionId: theirs })).name).toBe("Alpha");
    const helperRow = await t.run(async (ctx) => (await ctx.db.query("staff").withIndex("by_email", (q) => q.eq("email", helperIdentity.email)).first())!);
    await staff.mutation(api.staff.remove, { staffId: helperRow._id });
    expect(await refusal(helper.query(api.companies.get, { companyId, supportSessionId: theirs }))).toBe("Not found.");
    expect((await t.run((ctx) => ctx.db.get(theirs)))!.endReason).toBe("staff_removed");
  });

  test("two sessions for two companies keep their own company, as two browser tabs would", async () => {
    const t = start();
    const a = await company(t, "owner_a", "Alpha");
    const b = await company(t, "owner_b", "Bravo");
    const staff = t.withIdentity(admin);
    const first = await staff.mutation(api.support.start, { companyId: a.companyId, reason: "Looking at Alpha's setup" });
    const second = await staff.mutation(api.support.start, { companyId: b.companyId, reason: "Looking at Bravo's setup" });
    expect((await staff.query(api.companies.get, { companyId: a.companyId, supportSessionId: first })).name).toBe("Alpha");
    expect((await staff.query(api.companies.get, { companyId: b.companyId, supportSessionId: second })).name).toBe("Bravo");
    expect(await refusal(staff.query(api.companies.get, { companyId: a.companyId, supportSessionId: second }))).toBe("Not found.");
    expect((await staff.query(api.support.mine, {})).map((row) => row.companyName).sort()).toEqual(["Alpha", "Bravo"]);
  });

  test("the owner sees each session in Support access history, and a Manage session that changed something sends one summary", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const staff = t.withIdentity(admin);
    await owner.mutation(api.support.grantManage, { companyId, hours: 2 });
    const sessionId = await staff.mutation(api.support.start, { companyId, reason: "Owner asked for help pausing Sales", ticket: "T-1042" });
    await staff.mutation(api.support.switchToManage, { sessionId, reason: "Pause Sales as asked" });
    await staff.mutation(api.companies.setPausedAgents, { companyId, supportSessionId: sessionId, agents: ["sales"] });
    await staff.mutation(api.support.exit, { sessionId });
    await staff.mutation(api.support.exit, { sessionId });
    const history = await owner.query(api.support.history, { companyId });
    expect(history.sessions[0]).toMatchObject({ mode: "manage", reason: "Owner asked for help pausing Sales", ticket: "T-1042", basis: "owner_grant", open: false });
    expect(history.sessions[0].changes.map((row) => row.summary)).toEqual(["paused agents"]);
    const summaries = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((row) => row.notice?.event === "support_summary"));
    expect(summaries).toHaveLength(1);
    // Only the Owner reads the history.
    await t.run(async (ctx) => {
      const ownerRow = (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", companyId)).first())!;
      await ctx.db.insert("members", { companyId, userId: "office_1", userIssuer: ownerRow.userIssuer, email: "office_1@example.com", name: "Office", role: "office", status: "active", createdAt: Date.now() });
    });
    expect(await refusal(t.withIdentity(person("office_1")).query(api.support.history, { companyId }))).toBe("Not allowed.");
  });

  test("customer message content is hidden from support reads, and the stored record is untouched", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const messageId = await t.run((ctx) => ctx.db.insert("messages", { companyId, purpose: "customer_message", body: "Your gate code is 4471", subject: "Gate", to: "+15125550123", dedupeKey: "m1", status: "sent", attempts: 1, queuedAt: Date.now() }));
    const seen = await t.run(async (ctx) => {
      const db = redactingDb(ctx.db);
      const one = await db.get(messageId);
      const listed = await db.query("messages").withIndex("by_company_queued", (q) => q.eq("companyId", companyId)).collect();
      const page = await db.query("messages").withIndex("by_company_queued", (q) => q.eq("companyId", companyId)).paginate({ numItems: 5, cursor: null });
      const iterated: unknown[] = [];
      for await (const row of db.query("messages").withIndex("by_company_queued", (q) => q.eq("companyId", companyId))) iterated.push(row);
      const company = await db.get(companyId);
      return { one, listed, page, iterated, company, stored: await ctx.db.get(messageId) };
    });
    expect(seen.one).toMatchObject({ body: HIDDEN_WORDS, subject: HIDDEN_WORDS, to: "•••0123", status: "sent" });
    // The company's welcome notice is in the same list; look at the customer message itself.
    const mine = (rows: unknown[]) => (rows as { _id: string }[]).find((row) => row._id === messageId);
    expect(mine(seen.listed)).toMatchObject({ body: HIDDEN_WORDS });
    expect(mine(seen.page.page)).toMatchObject({ body: HIDDEN_WORDS });
    expect(mine(seen.iterated)).toMatchObject({ body: HIDDEN_WORDS });
    // Other tables read as they are.
    expect(seen.company!.name).toBe("Alpha");
    expect(seen.stored!.body).toBe("Your gate code is 4471");
  });

  test("revealing content needs a reason and is shown to the owner", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    const staff = t.withIdentity(admin);
    const sessionId = await staff.mutation(api.support.start, { companyId, reason: "Customer says a text never arrived" });
    expect(await refusal(staff.mutation(api.support.reveal, { sessionId, reason: "x" }))).toContain("Say why");
    await staff.mutation(api.support.reveal, { sessionId, reason: "Check the wording of the missing text" });
    const history = await owner.query(api.support.history, { companyId });
    expect(history.sessions[0].revealed[0].summary).toContain("Check the wording");
  });
});
