/**
 * Activation, end to end on the mock text and email services and the rules reader: the Owner picks a
 * focus, confirms, presses Start and leaves; scheduled steps (no browser) make real drafts through the
 * workspace's builders and run the agents' own workflows; Home, the in-app inbox and the email all point
 * at the same records. Then the hard cases: double starts, failures and retries, abandoned workers,
 * revoked authority, cancellation, blocked work that resumes, and other companies.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, refusal, seedVisit, start, type T } from "../tests/harness";
import { agentSetup, agentTestEnv, flush, PROSPECT } from "../tests/salesHarness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { mockNotices } from "./lib/messaging/email";
import { planFor, type Snapshot } from "./lib/activation/plan";

/** Runs the background work as the server would, with time moving forward, and no page open. */
async function drain(t: T, rounds = 30, stepMs = 20_000) {
  for (let i = 0; i < rounds; i += 1) {
    vi.advanceTimersByTime(stepMs);
    await t.finishInProgressScheduledFunctions();
  }
}

const tasksOf = (t: T, activationId: Id<"activations">) => t.run(async (ctx) => (await ctx.db.query("activationTasks").collect()).filter((row) => row.activationId === activationId));
const byTemplate = async (t: T, activationId: Id<"activations">) => Object.fromEntries((await tasksOf(t, activationId)).map((row) => [row.template, row]));

/** Setup as the Owner would leave it: a focus, the facts they confirmed, and the summary confirmed. */
async function confirmSetup(as: Awaited<ReturnType<typeof company>>["as"], companyId: Id<"companies">, priority: "sales" | "recruiter" | "dispatch" | "retention", facts: Record<string, string | string[]> = {}) {
  let { revision } = await as.mutation(api.setup.save, { companyId, expectedRevision: 0, step: "team", methods: ["manual"], facts: { "company.areas": "Austin and Round Rock", "services.categories": ["residential"], "contact.phone": "(512) 555-0100", ...facts } });
  ({ revision } = await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "priority", priority, secondary: [] }));
  await as.mutation(api.setup.save, { companyId, expectedRevision: revision, step: "review", confirmContext: true });
}

describe("Activation", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = agentTestEnv();
  });
  afterEach(() => undo());

  it("starts once, keeps working with the page closed, makes real drafts, and links every notice to them", async () => {
    const s = await agentSetup();
    const { t, as, companyId } = s;
    // Two inquiries waiting, as if imported.
    for (const [name, phone] of [
      ["Maria Lopez", PROSPECT.phone],
      ["Sam Ortiz", "+15550107071"],
    ]) {
      await as.mutation(api.salesInquiries.create, { companyId, name, phone, kind: "residential", inquiry: "How much for a standard clean of a 3 bed home?", channel: "sms", clientKey: `k-${phone}` });
    }
    await flush(t);
    // Sales asked each customer a question; both are now overdue for Sales' next step (as after an import).
    await t.run(async (ctx) => {
      for (const row of (await ctx.db.query("salesOpportunities").collect()).filter((o) => o.companyId === companyId)) await ctx.db.patch(row._id, { nextBy: "sales", nextAction: "Follow up", nextActionAt: Date.now() - 60_000 });
    });
    await confirmSetup(as, companyId, "sales");

    // The review shows what will start, why, and what it may cost, before anything runs.
    const preview = await as.query(api.activation.preview, { companyId });
    expect(preview.focus).toMatchObject({ id: "sales", words: "Get more bookings" });
    const planned = preview.tasks.map((row) => row.template);
    expect(planned).toEqual(expect.arrayContaining(["sales.inquiry_follow_through", "sales.booking_page", "sales.faq_answers", "dispatch.coverage_review"]));
    // A published service exists, so no example-price draft is planned on top of it.
    expect(planned).not.toContain("sales.service_draft");
    expect(preview.budget).toMatchObject({ credits: 0 });
    expect(preview.budget!.words.allowance).toContain("No separate setup allowance");

    const textsBefore = s.textsTo("+15550107071").length + s.textsTo(PROSPECT.phone).length;
    // Double-click: one batch. Start also opens the workspace (setup stops being a gate).
    const first = await as.mutation(api.activation.start, { companyId, source: "setup" });
    const again = await as.mutation(api.activation.start, { companyId, source: "setup" });
    expect(again).toEqual({ activationId: first.activationId, already: true });
    expect((await as.query(api.setup.state, { companyId })).required).toBe(false);
    expect(await t.run(async (ctx) => (await ctx.db.query("activations").collect()).length)).toBe(1);

    // The browser is closed here. Only the server's scheduled work runs from now on.
    await drain(t);

    const tasks = await byTemplate(t, first.activationId);
    // Sales' booking page: a real draft in the workspace, marked as unable to take bookings until published.
    expect(tasks["sales.booking_page"]).toMatchObject({ state: "ready_for_review", statusLine: "Your booking page is ready for review." });
    const page = tasks["sales.booking_page"].outputs[0];
    const experience = await t.run(async (ctx) => ctx.db.get(page.ref.id as Id<"bookingExperiences">));
    expect(experience).toMatchObject({ companyId, status: "draft" });
    expect(page.ref.href).toBe(`/app/agents/sales/booking-forms/${experience!._id}`);

    // Proposed answers come only from confirmed facts, and Sales uses none until the Owner approves.
    const playbook = await as.query(api.salesInquiries.playbook, { companyId });
    expect(playbook.settings.answers).toEqual([]);
    expect(playbook.settings.proposedAnswers.map((row) => row.topic)).toEqual(["Service area", "Services", "Contact"]);
    expect(playbook.settings.proposedAnswers[0].answer).toBe("We serve Austin and Round Rock.");

    // Inquiries went through Sales' own workflow (its runs), and the result is counted from its records.
    const runs = await t.run(async (ctx) => (await ctx.db.query("salesRuns").collect()).filter((row) => row.key.startsWith(`activation:${first.activationId}`)));
    expect(runs).toHaveLength(2);
    expect(runs.every((row) => row.status !== "queued" && row.status !== "running")).toBe(true);
    const inquiry = tasks["sales.inquiry_follow_through"];
    expect(["ready_for_review", "completed"]).toContain(inquiry.state);
    expect(inquiry.steps.some((row) => row.words.startsWith("Read 2 open inquiries: 2 were missing a next step."))).toBe(true);
    // Nothing new was sent by this batch: before the Owner's first review, Sales holds what it prepares.
    expect(s.textsTo("+15550107071").length + s.textsTo(PROSPECT.phone).length).toBe(textsBefore);

    // Dispatch has no upcoming visits: it waits for exactly that, with the way to fix it.
    expect(tasks["dispatch.coverage_review"]).toMatchObject({ state: "waiting_info", blocker: { kind: "information", action: { href: "/app/schedule" } } });

    // The batch settled as partial (one task is waiting), and Home shows the same records.
    const home = await as.query(api.activation.current, { companyId });
    expect(home.activation).toMatchObject({ status: "partial", focus: { words: "Get more bookings" } });
    expect(home.activation!.tasks.find((row) => row.title === "Prepare your booking page")!.outputs[0].ref.id).toBe(experience!._id);

    // In-app: the first result, pointing at the same record; one per person, however often it's reported.
    const inbox = await as.query(api.notifications.inbox, { companyId });
    expect(inbox.unread).toBeGreaterThan(0);
    const firstNotice = inbox.notices.find((row) => row.kind === "first_result")!;
    expect(firstNotice).toBeDefined();
    expect(inbox.notices.filter((row) => row.kind === "first_result")).toHaveLength(1);
    expect(inbox.notices.some((row) => row.kind === "needs_information" && row.href === "/app/schedule")).toBe(true);
    expect(inbox.notices.some((row) => row.kind === "batch_finished")).toBe(true);
    await as.mutation(api.notifications.markRead, { companyId, noticeId: firstNotice.id });
    expect((await as.query(api.notifications.inbox, { companyId })).notices.find((row) => row.id === firstNotice.id)!.read).toBe(true);

    // Email: the first result and the summary are planned once each, as member notices (no business balance).
    const notices = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((row) => row.purpose === "member_notice" && row.notice?.event.startsWith("activation_")));
    expect(notices.map((row) => row.notice!.event).sort()).toEqual(["activation_result", "activation_summary"]);
    // 6 AM in Chicago: held for the morning, then sent with the real outputs and a link to the work.
    process.env.APP_ORIGIN = "https://app.selestial.test";
    vi.advanceTimersByTime(3 * 60 * 60_000);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const email = mockNotices.find((row) => row.subject?.startsWith("Your first Sales"))!;
    expect(email).toBeDefined();
    expect(email.subject).toMatch(/^Your first Sales (assets are|result is) ready$/);
    expect(email.result).toBe("accepted");
    // The real outputs, by name and state, and one link into the work behind sign-in.
    expect(email.text).toContain(`${experience!.name} (draft)`);
    expect(email.text).toMatch(/https:\/\/app\.selestial\.test\/app/);
    delete process.env.APP_ORIGIN;
    // No customer details travel in the email.
    expect(email.text).not.toContain(PROSPECT.phone);
    expect(email.text).not.toContain("Maria");
  });

  it("reuses what the Owner already has, and a changed context starts a new batch without duplicating drafts", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await confirmSetup(as, companyId, "sales");
    // The Owner already prepared a booking page during setup and renamed it.
    const { experienceId } = await as.mutation(api.setup.prepareBooking, { companyId, kind: "residential" });
    await t.run(async (ctx) => ctx.db.patch(experienceId, { name: "Book with Alpha" }));

    const first = await as.mutation(api.activation.start, { companyId, source: "workspace" });
    await drain(t);
    let tasks = await byTemplate(t, first.activationId);
    expect(tasks["sales.booking_page"].outputs[0]).toMatchObject({ created: false, ref: { id: experienceId, label: "Book with Alpha" } });
    // No published service yet: a service draft with example prices, clearly marked.
    expect(tasks["sales.service_draft"].outputs[0]).toMatchObject({ created: true, state: "draft", flags: ["Example prices from a template: review them before publishing."] });
    expect(tasks["sales.inquiry_follow_through"]).toMatchObject({ state: "waiting_info" });

    // The same context, pressed again after it settled: the same batch.
    expect((await as.mutation(api.activation.start, { companyId, source: "workspace" })).activationId).toBe(first.activationId);

    // An inquiry arrives: the waiting task resumes on its own, without restarting finished ones.
    await as.mutation(api.salesInquiries.create, { companyId, name: "Maria Lopez", phone: PROSPECT.phone, kind: "residential", inquiry: "Do you clean on Saturdays?", channel: "sms", clientKey: "k1" });
    await drain(t);
    tasks = await byTemplate(t, first.activationId);
    expect(["ready_for_review", "completed"]).toContain(tasks["sales.inquiry_follow_through"].state);
    expect(tasks["sales.service_draft"].attempts).toBe(1);

    // A changed context (another inquiry) is a new batch, and it still makes no second draft.
    await as.mutation(api.salesInquiries.create, { companyId, name: "Sam Ortiz", phone: "+15550107071", kind: "residential", inquiry: "Price for a deep clean?", channel: "sms", clientKey: "k2" });
    const second = await as.mutation(api.activation.start, { companyId, source: "workspace" });
    expect(second.activationId).not.toBe(first.activationId);
    await drain(t);
    const counts = await t.run(async (ctx) => ({
      pages: (await ctx.db.query("bookingExperiences").collect()).filter((row) => row.companyId === companyId).length,
      services: (await ctx.db.query("services").collect()).filter((row) => row.companyId === companyId).length,
      proposed: ((await ctx.db.get(companyId))!.sales?.proposedAnswers ?? []).length,
    }));
    expect(counts).toEqual({ pages: 1, services: 1, proposed: 3 });

    // Approving a proposal makes it an answer Sales may use; saving the Playbook keeps the rest proposed.
    const playbook = await as.query(api.salesInquiries.playbook, { companyId });
    const proposal = playbook.settings.proposedAnswers[0];
    await as.mutation(api.salesInquiries.decideProposedAnswer, { companyId, id: proposal.id, decision: "approve", answer: "We serve Austin, Round Rock and Pflugerville." });
    const after = await as.query(api.salesInquiries.playbook, { companyId });
    expect(after.settings.answers).toMatchObject([{ topic: "Service area", answer: "We serve Austin, Round Rock and Pflugerville." }]);
    await as.mutation(api.salesInquiries.savePlaybook, { companyId, expectedRevision: after.settings.revision, settings: { voice: { tone: "direct" } } as never });
    expect((await as.query(api.salesInquiries.playbook, { companyId })).settings.proposedAnswers).toHaveLength(2);
  });

  it("drafts a hiring role without publishing it, and waits for the hiring inbox with the exact next step", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await confirmSetup(as, companyId, "recruiter", { "workforce.arrangement": ["contractors"] });
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "setup" });
    await drain(t);
    const tasks = await byTemplate(t, activationId);
    expect(tasks["recruiter.role_draft"]).toMatchObject({ state: "ready_for_review", statusLine: "Your application form is ready." });
    const needs = await as.query(api.hiringNeeds.list, { companyId });
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ status: "draft", engagement: "contractor", title: "Cleaner" });
    expect(needs[0].compensation).toBeUndefined();
    expect(needs[0].questions.map((q) => q.key)).toEqual(["transport", "supplies"]);
    // A draft role doesn't make Recruiter "ready": nothing is open to applicants.
    const recruiter = (await as.query(api.setup.state, { companyId })).agents.find((row) => row.agent === "recruiter")!;
    expect(recruiter.gaps.some((gap) => gap.words.startsWith("No hiring need is open"))).toBe(true);

    expect(tasks["recruiter.applicant_review"]).toMatchObject({
      state: "waiting_connection",
      blocker: { kind: "connection", words: "I prepared your hiring application. Connect your hiring inbox to identify applicants who should receive it." },
    });
    // It never claims applicants it didn't read.
    expect(tasks["recruiter.applicant_review"].outputs).toEqual([]);

    // The inbox connects: the blocked task is re-checked and goes again, once.
    await t.run(async (ctx) => {
      const owner = (await ctx.db.query("members").collect()).find((row) => row.companyId === companyId)!;
      await ctx.db.insert("mailboxConnections", { companyId, provider: "mock", address: "jobs@alpha.example", sources: [], processFrom: Date.now(), status: "connected", failures: 0, purposes: ["hiring"], createdBy: owner._id, createdAt: Date.now() });
    });
    await t.mutation(internal.activation.reevaluate, { companyId });
    await t.mutation(internal.activation.reevaluate, { companyId });
    const resumed = (await byTemplate(t, activationId))["recruiter.applicant_review"];
    expect(["queued", "working"]).toContain(resumed.state);
    expect(resumed.steps.filter((row) => row.words.startsWith("What it was waiting for is in place")).length).toBe(1);

    // Publishing is a separate, explicit act; a published role is never turned back into a draft.
    await as.mutation(api.hiringNeeds.setStatus, { companyId, needId: needs[0]._id, status: "open" });
    expect(await refusal(as.mutation(api.hiringNeeds.setStatus, { companyId, needId: needs[0]._id, status: "draft" }))).toContain("not turned back into a draft");
  });

  it("reuses the hiring brief setup prepared, so there is only ever one role", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await confirmSetup(as, companyId, "recruiter");
    const { needId } = await as.mutation(api.setup.prepareHiringBrief, { companyId });
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "setup" });
    await drain(t);
    const role = (await byTemplate(t, activationId))["recruiter.role_draft"];
    expect(role.outputs[0]).toMatchObject({ created: false, state: "draft, not published", ref: { id: needId } });
    expect(await as.query(api.hiringNeeds.list, { companyId })).toHaveLength(1);
  });

  it("checks coverage through Dispatch's own workflow and lists only real readiness gaps", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await seedVisit(as, companyId);
    await confirmSetup(as, companyId, "dispatch");
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "workspace" });
    await drain(t);
    const tasks = await byTemplate(t, activationId);
    const coverage = tasks["dispatch.coverage_review"];
    expect(["ready_for_review", "completed"]).toContain(coverage.state);
    expect(coverage.outputs[0]).toMatchObject({ kind: "coverage_plan", ref: { href: "/app/schedule" } });
    expect(coverage.steps.some((row) => row.words.startsWith("Checked coverage for 1 upcoming visit"))).toBe(true);
    // The one ready cleaner has availability; texting isn't set up, so that is the one gap.
    const readiness = tasks["dispatch.readiness"];
    expect(readiness.outputs.map((row) => row.ref.label)).toEqual(["Set up texting so job offers reach cleaners"]);
    const gap = await t.run(async (ctx) => ctx.db.get(readiness.outputs[0].ref.id as Id<"tasks">));
    expect(gap).toMatchObject({ agent: "dispatch", status: "open", key: "activation.ready:texting" });
    expect(readiness.outputs[0].ref.href).toBe(`/app/agents/dispatch?open=task:${gap!._id}`);
  });

  it("recovers from failures: bounded retries, abandoned workers, and one task's failure doesn't stop the rest", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await confirmSetup(as, companyId, "retention");
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "workspace" });
    // A task whose work throws every time (as a broken dependency would).
    const victim = (await tasksOf(t, activationId)).find((row) => row.template === "retention.care_setup")!;
    await t.run(async (ctx) => ctx.db.patch(victim._id, { template: "retention.broken" }));
    await drain(t, 40, 30_000);
    const tasks = await tasksOf(t, activationId);
    const failed = tasks.find((row) => row._id === victim._id)!;
    expect(failed).toMatchObject({ state: "failed", attempts: 3 });
    expect(failed.steps.filter((row) => row.kind === "failed")).toHaveLength(3);
    // Nothing half-made: no task rows or items from the failed attempts.
    expect(await t.run(async (ctx) => (await ctx.db.query("tasks").collect()).filter((row) => row.key?.startsWith("activation.care")).length)).toBe(0);
    // The other task still ran, and the batch is partial, not failed.
    expect(tasks.find((row) => row.template === "retention.review")!.state).toBe("waiting_info");
    expect((await as.query(api.activation.current, { companyId })).activation!.status).toBe("partial");
    expect((await as.query(api.notifications.inbox, { companyId })).notices.some((row) => row.kind === "failed")).toBe(true);

    // The Owner fixes it and retries: it runs again, once.
    await t.run(async (ctx) => ctx.db.patch(victim._id, { template: "retention.care_setup" }));
    await as.mutation(api.activation.retry, { companyId, taskId: victim._id });
    await drain(t);
    const fixed = (await tasksOf(t, activationId)).find((row) => row._id === victim._id)!;
    expect(fixed.state).toBe("ready_for_review");
    expect(fixed.outputs.map((row) => row.kind)).toEqual(["feedback_request", "checklist_item", "checklist_item"]);
    expect(await refusal(as.mutation(api.activation.retry, { companyId, taskId: victim._id }))).toContain("already finished");

    // A worker that stopped without reporting: its lease runs out and the sweep picks it up.
    const other = await company(t, "owner-b", "Beta Cleaning");
    await confirmSetup(other.as, other.companyId, "retention");
    const b = await other.as.mutation(api.activation.start, { companyId: other.companyId, source: "workspace" });
    const stuck = (await tasksOf(t, b.activationId)).find((row) => row.template === "retention.care_setup")!;
    await t.run(async (ctx) => ctx.db.patch(stuck._id, { state: "working", attempts: 1, leaseUntil: Date.now() - 60_000 }));
    await t.mutation(internal.activation.sweep, {});
    expect((await t.run(async (ctx) => ctx.db.get(stuck._id)))!).toMatchObject({ state: "queued", lastError: "The step stopped without reporting back." });
  });

  it("stops when the starter loses authority, when canceled, and at the credit ceiling", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await confirmSetup(as, companyId, "recruiter");
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "workspace" });
    // Before any step runs, the Owner's access is removed.
    await t.run(async (ctx) => {
      const owner = (await ctx.db.query("members").collect()).find((row) => row.companyId === companyId)!;
      await ctx.db.patch(owner._id, { status: "removed" });
    });
    await drain(t, 5);
    expect(await t.run(async (ctx) => (await ctx.db.get(activationId))!.status)).toBe("canceled");
    expect(await t.run(async (ctx) => (await ctx.db.query("hiringNeeds").collect()).length)).toBe(0);

    // Cancel: future work stops, finished work is kept and says so.
    const c = await company(t, "owner-c", "Gamma Cleaning");
    await confirmSetup(c.as, c.companyId, "sales");
    const run = await c.as.mutation(api.activation.start, { companyId: c.companyId, source: "workspace" });
    await c.as.mutation(api.activation.cancel, { companyId: c.companyId, activationId: run.activationId });
    await drain(t, 5);
    const canceled = await tasksOf(t, run.activationId);
    expect(canceled.every((row) => ["canceled", "waiting_info", "unavailable"].includes(row.state) || row.state === "canceled")).toBe(true);
    expect(await t.run(async (ctx) => (await ctx.db.query("bookingExperiences").collect()).filter((row) => row.companyId === c.companyId).length)).toBe(0);
    // A canceled batch sends no email.
    expect(await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((row) => row.companyId === c.companyId && row.notice?.event.startsWith("activation_")).length)).toBe(0);

    // A task that would pass the approved ceiling stops cleanly before spending anything.
    const d = await company(t, "owner-d", "Delta Cleaning");
    await confirmSetup(d.as, d.companyId, "retention");
    const batch = await d.as.mutation(api.activation.start, { companyId: d.companyId, source: "workspace" });
    const care = (await tasksOf(t, batch.activationId)).find((row) => row.template === "retention.care_setup")!;
    await t.run(async (ctx) => ctx.db.patch(care._id, { estimate: { credits: 5, externalCents: 0, words: "test" } }));
    await drain(t, 5);
    expect((await t.run(async (ctx) => ctx.db.get(care._id)))!).toMatchObject({ state: "waiting_info", blocker: { kind: "credits" } });
  });

  it("keeps companies and people apart, and only the Owner starts work", async () => {
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const b = await company(t, "owner-b", "Beta Cleaning");
    const manager = await addMember(t, a.as, a.companyId, "manager-a", "manager");
    const office = await addMember(t, a.as, a.companyId, "office-a", "office");
    await confirmSetup(a.as, a.companyId, "retention");
    expect(await refusal(manager.mutation(api.activation.start, { companyId: a.companyId, source: "workspace" }))).toBe(NOT_ALLOWED);
    const { activationId } = await a.as.mutation(api.activation.start, { companyId: a.companyId, source: "workspace" });
    await drain(t, 10);
    const [task] = await tasksOf(t, activationId);
    // Another company's Owner can't read, retry or cancel it.
    expect(await refusal(b.as.query(api.activation.task, { companyId: b.companyId, taskId: task._id }))).toBe(NOT_FOUND);
    expect(await refusal(b.as.mutation(api.activation.retry, { companyId: b.companyId, taskId: task._id }))).toBe(NOT_FOUND);
    expect(await refusal(b.as.mutation(api.activation.cancel, { companyId: b.companyId, activationId }))).toBe(NOT_FOUND);
    expect((await b.as.query(api.activation.current, { companyId: b.companyId, activationId })).activation).toBeNull();
    // Managers get their own notices; Office gets none; nobody can mark another person's notice.
    const mine = await manager.query(api.notifications.inbox, { companyId: a.companyId });
    expect(mine.notices.length).toBeGreaterThan(0);
    expect((await office.query(api.notifications.inbox, { companyId: a.companyId })).notices).toEqual([]);
    const ownerNotice = (await a.as.query(api.notifications.inbox, { companyId: a.companyId })).notices[0];
    expect(await refusal(manager.mutation(api.notifications.markRead, { companyId: a.companyId, noticeId: ownerNotice.id }))).toBe(NOT_FOUND);
    expect(await refusal(b.as.mutation(api.notifications.markRead, { companyId: b.companyId, noticeId: ownerNotice.id }))).toBe(NOT_FOUND);
  });

  it("an email that can't be sent leaves the finished work exactly as it is", async () => {
    const t = start();
    delete process.env.EMAIL_PROVIDER;
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await confirmSetup(as, companyId, "recruiter");
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "workspace" });
    await drain(t);
    const tasks = await byTemplate(t, activationId);
    expect(tasks["recruiter.role_draft"].state).toBe("ready_for_review");
    const emails = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((row) => row.notice?.event === "activation_result"));
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ status: "not_sent", problem: "Email is not connected." });
    expect((await as.query(api.notifications.inbox, { companyId })).notices.some((row) => row.kind === "first_result")).toBe(true);
  });

  it("lets an Owner who never went through setup start their first agent tasks from the workspace", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("companySetups").collect()) await ctx.db.delete(row._id);
    });
    expect(await refusal(as.mutation(api.activation.start, { companyId, source: "workspace" }))).toContain("Choose what Selestial should focus on first");
    const { activationId } = await as.mutation(api.activation.start, { companyId, source: "workspace", focus: "retention" });
    await drain(t);
    expect((await as.query(api.activation.current, { companyId })).activation).toMatchObject({ id: activationId, focus: { words: "Keep more customers" } });
  });
});

describe("Activation plan", () => {
  const base: Snapshot = {
    now: NOW,
    companyName: "Alpha",
    plan: { sales: { ok: true, words: "" }, recruiter: { ok: true, words: "" }, dispatch: { ok: true, words: "" }, retention: { ok: true, words: "" } },
    paused: [],
    facts: { areas: "Austin", categories: ["residential"], phone: null, email: null, location: null, workforce: [] },
    sales: { activeServices: 1, draftServiceId: null, bookingPageId: null, agreementId: null, openInquiries: 0, inquiryIds: [], approvedAnswers: 0, proposedAnswers: 0, firstBatchDecided: false, replyLevel: "propose" },
    recruiter: { openNeeds: 0, openNeedId: null, draftNeedId: null, inbox: "none", applications: 0, inviteLevel: "execute" },
    dispatch: { upcomingJobs: 0, uncoveredJobs: 0, uncoveredJobIds: [], readyCleaners: 0, cleanersWithoutAvailability: 0, canText: false, offerLevel: "propose" },
    retention: { completedJobs: 0, activePlans: 0, customers: 0, openCases: 0, guaranteeWritten: false, reviewLink: false, feedbackAfterFirst: true, feedbackLevel: "propose" },
    canEmail: false,
  };

  it("prioritizes the focus, adds bounded supporting work, and never plans what the plan or a pause rules out", () => {
    const hire = planFor("recruiter", [], base);
    expect(hire.map((row) => [row.template, row.priority])).toEqual([
      ["recruiter.role_draft", 1],
      ["recruiter.applicant_review", 1],
      ["dispatch.coverage_review", 2],
      ["dispatch.readiness", 3],
    ]);
    // "Stop chasing cleaners" with nobody ready also drafts a role, as supporting work.
    expect(planFor("dispatch", [], base).map((row) => row.template)).toContain("recruiter.role_draft");
    expect(planFor("dispatch", [], { ...base, dispatch: { ...base.dispatch, readyCleaners: 3 } }).map((row) => row.template)).not.toContain("recruiter.role_draft");
    // A secondary priority adds one task, not every task its agent could do.
    expect(planFor("sales", ["retention"], base).filter((row) => row.agent === "retention")).toHaveLength(1);
    // Paused and off-plan agents are shown as such, never queued.
    const paused = planFor("retention", [], { ...base, paused: ["retention"] });
    expect(paused.every((row) => row.state === "paused")).toBe(true);
    const offPlan = planFor("sales", [], { ...base, plan: { ...base.plan, sales: { ok: false, words: "Sales needs an active Operate or Expand plan." } } });
    expect(offPlan.filter((row) => row.agent === "sales").every((row) => row.state === "unavailable")).toBe(true);
    // Every planned task carries what the brief asks for.
    for (const row of planFor("sales", ["recruiter", "dispatch", "retention"], base)) {
      expect(row.objective && row.expectedOutput && row.completion && row.authority.words && row.estimate.words).toBeTruthy();
    }
    expect(planFor("sales", ["recruiter", "dispatch", "retention", "pricing", "booking"], base).length).toBeLessThanOrEqual(8);
  });
});
