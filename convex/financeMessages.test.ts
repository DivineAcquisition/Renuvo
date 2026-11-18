/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchJob, dispatchPlace, NOW, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED } from "./lib/errors";
import { stageDue } from "./lib/finance/collections";
import { mockEmails } from "./lib/messaging/email";
import { FINANCE_TOOLS } from "./lib/chat/financeTools";
import { toolsFor, type ToolCtx } from "./lib/chat/tools";

const SECRET = "test-only-secret-for-action-links-0123456789";
const DAY = 86_400_000;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.ACTION_LINK_SECRET = SECRET;
  process.env.LINK_ORIGIN = "https://link.selestial.test";
  process.env.EMAIL_PROVIDER = "mock";
  mockEmails.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  for (const name of ["ACTION_LINK_SECRET", "LINK_ORIGIN", "EMAIL_PROVIDER"]) delete process.env[name];
});

async function setup(options: { email?: string } = {}) {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const place = await dispatchPlace(as, companyId);
  await t.run(async (ctx) => ctx.db.patch(place.customerId, { email: options.email ?? "dana@example.com" }));
  const jobId = await dispatchJob(as, companyId, place, { priceCents: 24000 });
  await t.run(async (ctx) => ctx.db.patch(jobId, { status: "completed" }));
  const { invoiceId } = await as.mutation(api.finance.createInvoice, { companyId, jobId });
  const draft = await as.query(api.finance.invoice, { companyId, invoiceId });
  await as.mutation(api.finance.issueInvoice, { companyId, invoiceId, revision: draft.revision, dueDate: null });
  return { t, as, companyId, customerId: place.customerId, invoiceId };
}

/** The company can email: a from address, and the customer's recorded permission for billing email. */
async function readyToEmail(s: Awaited<ReturnType<typeof setup>>) {
  await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, emailFromAddress: "billing@alpha.example", quietHours: null });
  await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: { kind: "customer", id: s.customerId }, channel: "email", category: "operational", status: "granted", source: "web_form" });
}

const sweep = (t: T) => t.mutation(internal.financeMessages.sweep, {});

describe("the reminder schedule", () => {
  it("is 3 days before, then 1, 7 and 14 days overdue, and nothing before the window for an invoice just issued", () => {
    const due = NOW + 10 * DAY;
    const invoice = { status: "open" as const, dueAt: due, issuedAt: NOW, totals: { subtotalCents: 0, discountCents: 0, taxCents: 0, totalCents: 1000, paidCents: 0, refundedCents: 0, creditedCents: 0, balanceCents: 1000, processingCents: 0 }, depositCents: undefined, balanceRequestedAt: undefined };
    expect(stageDue(invoice, due - 5 * DAY)).toBeNull();
    expect(stageDue(invoice, due - 2 * DAY)).toBe("before_due");
    expect(stageDue(invoice, due + 2 * 3_600_000)).toBeNull();
    expect(stageDue(invoice, due + 1 * DAY)).toBe("overdue_1");
    expect(stageDue(invoice, due + 8 * DAY)).toBe("overdue_7");
    expect(stageDue(invoice, due + 30 * DAY)).toBe("overdue_14");
    // Issued with two days to pay: it was just sent, so no "3 days before" note.
    expect(stageDue({ ...invoice, issuedAt: due - 2 * DAY }, due - 1 * DAY)).toBeNull();
    // Paid, or nothing asked for: nothing to remind about.
    expect(stageDue({ ...invoice, totals: { ...invoice.totals, balanceCents: 0 } }, due + 8 * DAY)).toBeNull();
  });
});

describe("Selestial prepares, the Owner approves", () => {
  it("prepares each step once, never sends on its own, and sets a draft aside when the invoice is paid", async () => {
    const s = await setup();
    vi.setSystemTime(NOW + 5 * DAY); // terms are 7 days: inside the 3-day window
    expect(await sweep(s.t)).toEqual({ prepared: 1, setAside: 0 });
    expect(await sweep(s.t)).toEqual({ prepared: 0, setAside: 0 });
    let queue = await s.as.query(api.financeMessages.queue, { companyId: s.companyId });
    expect(queue.waiting).toHaveLength(1);
    expect(queue.waiting[0]).toMatchObject({ stage: "before_due", channel: "email", to: "dana@example.com", requestedCents: 24000, preparedBySelestial: true });
    expect(queue.waiting[0].body).toContain("$240.00");
    expect(queue.waiting[0].body).toContain("{link}");
    // Nothing went anywhere.
    expect(await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(0);

    // A week late, the overdue step replaces the waiting note.
    vi.setSystemTime(NOW + 15 * DAY);
    await sweep(s.t);
    queue = await s.as.query(api.financeMessages.queue, { companyId: s.companyId });
    expect(queue.waiting.map((d) => d.stage)).toEqual(["overdue_7"]);

    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId: s.invoiceId, amountCents: 24000, method: "check", receivedOn: "2027-03-16", reference: null, note: null, confirmedReceived: true, clientKey: "client-key-paid-0001" });
    expect((await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting).toHaveLength(0);
    expect((await sweep(s.t)).setAside).toBe(1);
  });

  it("prepares nothing when the Owner switched reminders off, and only the Owner can see or approve", async () => {
    const s = await setup();
    await s.as.mutation(api.financeMessages.saveReminders, { companyId: s.companyId, remindersOn: false, replyTo: null });
    vi.setSystemTime(NOW + 9 * DAY);
    expect((await sweep(s.t)).prepared).toBe(0);
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    expect(await refusal(manager.query(api.financeMessages.queue, { companyId: s.companyId }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: s.invoiceId, kind: "reminder" }))).toBe(NOT_ALLOWED);
  });

  it("sends exactly what was approved, with the pay link made at sending time and replies to the Owner", async () => {
    const s = await setup();
    await readyToEmail(s);
    const { draftId } = await s.as.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: s.invoiceId, kind: "invoice" });
    const queue = await s.as.query(api.financeMessages.queue, { companyId: s.companyId });
    const item = queue.waiting.find((d) => d.id === draftId)!;
    expect(item.canSend).toMatchObject({ ok: true });
    expect(item.subject).toBe("Invoice INV-1001 from Alpha Cleaning");
    const result = await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId, bindsTo: item.bindsTo! });
    expect(result.ok).toBe(true);
    await settle(s.t);
    expect(mockEmails).toHaveLength(1);
    expect(mockEmails[0]).toMatchObject({ to: "dana@example.com", fromName: "Alpha Cleaning", replyTo: "owner-a@example.com", subject: "Invoice INV-1001 from Alpha Cleaning" });
    expect(mockEmails[0].text).toMatch(/https:\/\/link\.selestial\.test\/c\/pay\/[\w-]+\.[\w-]+/);
    expect(mockEmails[0].text).not.toContain("{link}");
    // Sent through Selestial's shared sender: the company's name "via Selestial", in the company's own frame.
    expect(mockEmails[0].from).toBe('"Alpha Cleaning via Selestial" <messages@mail.selestial.test>');
    expect(mockEmails[0].html).toContain("Alpha Cleaning · sent via Selestial");
    expect(mockEmails[0].html).toContain("You&#39;re getting this because you&#39;re a customer of Alpha Cleaning.");
    expect(mockEmails[0].html).toMatch(/<a href="https:\/\/link\.selestial\.test\/c\/pay\//);
    const history = await s.as.query(api.financeMessages.forInvoice, { companyId: s.companyId, invoiceId: s.invoiceId });
    expect(history.history[0].delivery).toMatchObject({ state: "completed", words: "Delivered" });
    expect(history.invoiceDelivered).toBe(true);
    // Approving the same draft again does nothing more.
    expect((await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId, bindsTo: item.bindsTo! })).ok).toBe(false);
    await settle(s.t);
    expect(mockEmails).toHaveLength(1);
  });

  it("says plainly why a message can't go, before and after approving, and never sends without permission", async () => {
    const s = await setup();
    const { draftId } = await s.as.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: s.invoiceId, kind: "reminder" });
    let item = (await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting[0];
    expect(item.canSend).toMatchObject({ ok: false, code: "sender_not_ready" });
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, emailFromAddress: "billing@alpha.example", quietHours: null });
    item = (await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting[0];
    expect(item.canSend).toMatchObject({ ok: false, code: "no_permission" });
    // Approved anyway: the sending policy refuses it, and it shows as needing attention with the same words.
    const result = await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId, bindsTo: item.bindsTo! });
    expect(result).toMatchObject({ ok: false });
    expect(result.words).toMatch(/permission/);
    await settle(s.t);
    expect(mockEmails).toHaveLength(0);
    const history = await s.as.query(api.financeMessages.forInvoice, { companyId: s.companyId, invoiceId: s.invoiceId });
    expect(history.history[0].delivery?.state).toBe("needs_attention");
  });

  it("refuses an approval when what's owed changed after review, and rewrites Selestial's words to match", async () => {
    const s = await setup();
    await readyToEmail(s);
    const { draftId } = await s.as.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: s.invoiceId, kind: "reminder" });
    const reviewed = (await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting[0];
    expect(reviewed.body).toContain("$240.00");
    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId: s.invoiceId, amountCents: 10000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: "client-key-part-0001" });
    const refused = await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId, bindsTo: reviewed.bindsTo! });
    expect(refused.ok).toBe(false);
    await settle(s.t);
    expect(mockEmails).toHaveLength(0);
    // The words are rewritten from the record; reviewed again, it goes.
    let again = (await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting[0];
    if (again.body.includes("$240.00")) {
      await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId, bindsTo: again.bindsTo! });
      again = (await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting[0];
    }
    expect(again.body).toContain("$140.00");
    expect((await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId, bindsTo: again.bindsTo! })).ok).toBe(true);
    await settle(s.t);
    expect(mockEmails[0].text).toContain("$140.00");
  });

  it("Send all sends each one that is still true and reports the others, and a voided invoice stops a scheduled message", async () => {
    const s = await setup();
    await readyToEmail(s);
    const a = await s.as.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: s.invoiceId, kind: "reminder" });
    // A second customer with no permission recorded.
    const other = await dispatchPlace(s.as, s.companyId);
    await s.t.run(async (ctx) => ctx.db.patch(other.customerId, { email: "sam@example.com", name: "Sam Okafor" }));
    const job2 = await dispatchJob(s.as, s.companyId, other, { priceCents: 18000 });
    await s.t.run(async (ctx) => ctx.db.patch(job2, { status: "completed" }));
    const { invoiceId: invoice2 } = await s.as.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId: job2 });
    const d2 = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId: invoice2 });
    await s.as.mutation(api.finance.issueInvoice, { companyId: s.companyId, invoiceId: invoice2, revision: d2.revision, dueDate: null });
    const b = await s.as.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: invoice2, kind: "reminder" });
    const queue = await s.as.query(api.financeMessages.queue, { companyId: s.companyId });
    const all = await s.as.mutation(api.financeMessages.approveAll, { companyId: s.companyId, items: queue.waiting.map((d) => ({ draftId: d.id, bindsTo: d.bindsTo! })) });
    expect(all.sent).toBe(1);
    expect(all.results.find((r) => r.draftId === a.draftId)?.ok).toBe(true);
    expect(all.results.find((r) => r.draftId === b.draftId)).toMatchObject({ ok: false });
    await settle(s.t);
    expect(mockEmails.map((m) => m.to)).toEqual(["dana@example.com"]);

    // Quiet hours hold a message; the invoice is voided before they end, so it never goes.
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: { start: "00:00", end: "23:59", appliesToOperational: true } });
    const c = await s.as.mutation(api.financeMessages.prepare, { companyId: s.companyId, invoiceId: s.invoiceId, kind: "invoice" });
    const item = (await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting.find((d) => d.id === c.draftId)!;
    const held = await s.as.mutation(api.financeMessages.approve, { companyId: s.companyId, draftId: c.draftId, bindsTo: item.bindsTo! });
    expect(held.words).toMatch(/^Scheduled/);
    const preview = await s.as.query(api.finance.voidPreview, { companyId: s.companyId, invoiceId: s.invoiceId });
    await s.as.mutation(api.finance.voidInvoice, { companyId: s.companyId, invoiceId: s.invoiceId, reason: "Booked by mistake", bindsTo: preview.bindsTo });
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: null });
    await settle(s.t);
    expect(mockEmails).toHaveLength(1);
    const history = await s.as.query(api.financeMessages.forInvoice, { companyId: s.companyId, invoiceId: s.invoiceId });
    expect(history.history.find((h) => h.id === c.draftId)?.delivery).toMatchObject({ state: "needs_attention", detail: "The invoice was voided before the message went out." });
  });
});

describe("Chat over Finance", () => {
  it("is offered to the Owner only, reads the record, and prepares drafts without sending", async () => {
    const s = await setup();
    const names = FINANCE_TOOLS.map((tool) => tool.name);
    expect(toolsFor("office", {}).filter((tool) => names.includes(tool.name))).toHaveLength(0);
    expect(toolsFor("manager", {}).filter((tool) => names.includes(tool.name))).toHaveLength(0);
    expect(toolsFor("owner", {}).filter((tool) => names.includes(tool.name)).map((t) => t.name).sort()).toEqual([...names].sort());

    vi.setSystemTime(NOW + 12 * DAY);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Done = { status: string; data: any };
    const run = (name: string, args: Record<string, unknown>): Promise<Done> =>
      s.t.run(async (ctx) => {
        const company = (await ctx.db.get(s.companyId))!;
        const member = (await ctx.db.query("members").withIndex("by_company", (q) => q.eq("companyId", s.companyId)).first())!;
        const tool = FINANCE_TOOLS.find((t) => t.name === name)!;
        return (await tool.run({ ...ctx, company, member, role: "owner", conversationId: "c" as Id<"conversations">, runId: "r" as Id<"chatRuns">, idempotencyKey: "k" } as unknown as ToolCtx, args)) as unknown as Done;
      });
    const listed = await run("list_unpaid_invoices", { overdueOnly: true });
    expect(listed).toMatchObject({ status: "done" });
    expect(listed.data.invoices[0]).toMatchObject({ number: "INV-1001", daysLate: 4 });
    const explained = await run("explain_invoice", { invoice: "INV-1001" });
    expect(explained.data.askingForNow).toBe("$240.00");
    const prepared = await run("prepare_payment_reminders", { overdueOnly: true });
    expect(prepared.data).toMatchObject({ sent: 0 });
    expect(prepared.data.prepared).toHaveLength(1);
    expect((await s.as.query(api.financeMessages.queue, { companyId: s.companyId })).waiting).toHaveLength(1);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(0);
  });
});
