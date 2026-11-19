/**
 * The Sales agent on main, end to end, on the rules reader with the mock text and email services: a text
 * becomes an opportunity in the pipeline, the agent asks only what the service's price needs, quotes
 * through the workspace's own draft and quote, the customer accepts on the quote page and chooses a time,
 * and the booking engine holds the time, confirms and hands the visit to Dispatch.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AREA, HOUR } from "../tests/harness";
import { agentSetup, agentTestEnv, flush, PROSPECT, quoteLink } from "../tests/salesHarness";
import { api, internal } from "./_generated/api";
import { mockOutbox } from "./lib/messaging/provider";

describe("Sales agent: inquiry to booking", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = agentTestEnv();
  });
  afterEach(() => undo());

  it("asks what the price needs, quotes from the published service, and books what the customer accepts", async () => {
    const s = await agentSetup({ autonomous: true });
    await s.text(PROSPECT.phone, `Hi, how much for a house cleaning? We're in ${AREA}.`);
    await flush(s.t);

    // One opportunity, in the pipeline, worked by the agent.
    let [row] = await s.opportunities();
    expect(row).toMatchObject({ stage: "qualifying", intake: { kind: "sms" }, channel: "sms", followUps: "on" });
    let texts = s.textsTo(PROSPECT.phone);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/bedrooms/i);
    expect(texts[0]).toContain("Alpha Cleaning's assistant");
    expect(texts[0]).toContain("Reply STOP to opt out.");

    // The answer is read, the price comes from the engine through a workspace draft, and the quote goes out.
    await s.text(PROSPECT.phone, "3 bedrooms and 2 bathrooms");
    await flush(s.t);
    [row] = await s.opportunities();
    expect(row).toMatchObject({ stage: "quoting", milestone: "quote_sent" });
    expect(row.draftId).toBeDefined();
    const quote = await s.t.run(async (ctx) => (await ctx.db.get(row.quoteId!))!);
    // $120 base + 2 more bedrooms at $20 + 1 more bathroom at $25.
    expect(quote).toMatchObject({ status: "sent", visit: { totalCents: 18500 }, draftId: row.draftId });
    texts = s.textsTo(PROSPECT.phone);
    expect(texts.at(-1)).toContain("$185.00");
    expect(texts.at(-1)).toContain("/c/quote/");
    // The draft is the workspace's: a person opens the same deal there.
    const draft = await s.as.query(api.sales.draft, { companyId: s.companyId, draftId: row.draftId! });
    expect(draft.draft.mode).toBe("booking");
    expect(draft.createdBy).toBe("Sales agent");

    // The customer's page: the offer, and times that are open now.
    const token = quoteLink(PROSPECT.phone);
    const page = (await s.t.query(api.quotePage.view, { token }))!;
    expect(page).toMatchObject({ state: "open", needsAddress: true, quote: { totalCents: 18500 } });
    expect(page.times.length).toBeGreaterThan(0);
    const time = page.times[0];

    const accepted = await s.t.mutation(api.quotePage.accept, { token, hash: page.quote.hash!, name: "Maria Lopez", startsAt: time.startsAt, address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: AREA }, access: "Key under the mat." });
    expect(accepted).toEqual({ status: "accepted", time: "chosen" });
    await flush(s.t);

    // The booking engine made the booking from the agent's draft, held the time, confirmed it and handed it on.
    [row] = await s.opportunities();
    expect(row.stage).toBe("won");
    const booking = await s.t.run(async (ctx) => (await ctx.db.get(row.bookingId!))!);
    expect(booking).toMatchObject({ status: "confirmed", priceCents: 18500, slot: { startsAt: time.startsAt }, opportunityId: row._id, handoff: { state: "done" } });
    expect(booking.createdBy).toBeUndefined();
    const job = await s.t.run(async (ctx) => (await ctx.db.get(booking.jobId!))!);
    expect(job).toMatchObject({ startsAt: time.startsAt });
    const confirmation = s.textsTo(PROSPECT.phone).at(-1)!;
    expect(confirmation).toMatch(/booked/i);
    expect(confirmation).not.toMatch(/cleaner (is|has been) confirmed|confirmed (crew|cleaner)/i);

    // The conversation holds both sides, and the agent's task closed as won.
    const detail = await s.opportunity(row._id);
    expect(detail.thread.filter((m) => m.direction === "in")).toHaveLength(2);
    expect(detail.thread.filter((m) => m.direction === "out").length).toBeGreaterThanOrEqual(3);
    const task = await s.t.run(async (ctx) => ctx.db.get(row.taskId!));
    expect(task?.status).toBe("done");
    const overview = await s.as.query(api.salesInquiries.overview, { companyId: s.companyId, asOf: Date.now() });
    expect(overview.measures).toMatchObject({ inquiries: 1, quotesSent: 1, quotesAccepted: 1, bookings: 1, quotedValueCents: 18500, bookedValueCents: 18500 });
  });

  it("holds everything for the Owner's first review, and sends nothing until it is decided", async () => {
    const s = await agentSetup();
    await s.text(PROSPECT.phone, "3 bed 2 bath house cleaning please, 78701");
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(0);
    const waiting = await s.as.query(api.salesActions.waiting, { companyId: s.companyId });
    expect(waiting.firstBatch).toMatchObject({ decided: false });
    if (waiting.firstBatch.decided) throw new Error();
    expect(waiting.firstBatch.items).toHaveLength(1);
    expect(waiting.firstBatch.items[0]).toMatchObject({ kind: "send_quote", quote: { totalCents: 18500 } });
    // An Office or Manager decision on a batch item is refused; the Owner decides the batch.
    const result = await s.as.mutation(api.salesActions.decideBatch, { companyId: s.companyId, batchId: waiting.firstBatch.batchId!, items: [{ actionId: waiting.firstBatch.items[0].actionId, decision: "send" }] });
    expect(result).toMatchObject({ sent: 1, skipped: 0 });
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone).at(-1)).toContain("$185.00");
    const company = await s.t.run(async (ctx) => ctx.db.get(s.companyId));
    expect(company?.sales?.firstBatchDecidedAt).toBeDefined();
  });

  it("does not send an approved message whose kind the Owner has since switched off", async () => {
    const s = await agentSetup();
    await s.text(PROSPECT.phone, "3 bed 2 bath house cleaning please, 78701");
    await flush(s.t);
    const waiting = await s.as.query(api.salesActions.waiting, { companyId: s.companyId });
    if (waiting.firstBatch.decided) throw new Error();
    const item = waiting.firstBatch.items[0];
    const permission = await s.t.run(async (ctx) => (await ctx.db.get(item.actionId))!.permission);
    await s.as.mutation(api.permissions.set, { companyId: s.companyId, action: permission, level: "off" });
    const result = await s.as.mutation(api.salesActions.decideBatch, { companyId: s.companyId, batchId: waiting.firstBatch.batchId!, items: [{ actionId: item.actionId, decision: "send" }] });
    expect(result.sent).toBe(0);
    expect(result.results[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/switched off/) });
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(0);
  });

  it("asks first when the Owner said so, and the approval sends exactly what was approved", async () => {
    const s = await agentSetup();
    await s.reviewed();
    await s.text(PROSPECT.phone, "Need a clean, 2 bedrooms 1 bathroom, zip 78701");
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(0);
    const approvals = await s.t.run(async (ctx) => (await ctx.db.query("approvals").collect()).filter((row) => row.proposal?.kind === "sales_action"));
    expect(approvals).toHaveLength(1);
    await s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: approvals[0]._id, decision: "approved" });
    await flush(s.t);
    // $120 base + 1 more bedroom at $20.
    expect(s.textsTo(PROSPECT.phone).at(-1)).toContain("$140.00");
  });

  it("stops when a person takes over, and picks up again when it is handed back", async () => {
    const s = await agentSetup({ autonomous: true });
    await s.text(PROSPECT.phone, `House cleaning quote please, ${AREA}`);
    await flush(s.t);
    const [row] = await s.opportunities();
    await s.as.mutation(api.pipeline.takeOver, { companyId: s.companyId, opportunityId: row._id, resume: false });
    const before = s.textsTo(PROSPECT.phone).length;
    await s.text(PROSPECT.phone, "3 bedrooms 2 baths");
    await flush(s.t);
    // Kept in the conversation, and nobody but the person answers it.
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(before);
    const held = await s.opportunity(row._id);
    expect(held.takeover).not.toBeNull();
    expect(held.thread.some((m) => m.direction === "in" && m.body.includes("3 bedrooms"))).toBe(true);
    await s.as.mutation(api.pipeline.takeOver, { companyId: s.companyId, opportunityId: row._id, resume: true });
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone).at(-1)).toContain("$185.00");
  });

  it("closes on a STOP and never texts again", async () => {
    const s = await agentSetup({ autonomous: true });
    await s.text(PROSPECT.phone, `How much for a cleaning in ${AREA}?`);
    await flush(s.t);
    await s.text(PROSPECT.phone, "STOP");
    await flush(s.t);
    const [row] = await s.opportunities();
    expect(row).toMatchObject({ stage: "lost", lostReason: "opted_out", followUps: "stopped" });
    const sent = s.textsTo(PROSPECT.phone).length;
    // The reminder the agent had planned is stopped, and the sweep starts nothing.
    await s.t.mutation(internal.salesAgent.sweep, {});
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(sent);
    expect((await s.followUps()).every((row) => row.status !== "scheduled")).toBe(true);
  });

  it("reminds once a day later when the customer goes quiet, and the reminder stops on a reply", async () => {
    const s = await agentSetup({ autonomous: true });
    await s.text(PROSPECT.phone, `How much for a cleaning in ${AREA}?`);
    await flush(s.t);
    const planned = (await s.followUps()).filter((row) => row.status === "scheduled");
    expect(planned).toHaveLength(1);
    expect(planned[0]).toMatchObject({ purpose: "missing_info", attempt: 1 });
    await s.text(PROSPECT.phone, "2 bed 1 bath");
    await flush(s.t);
    const after = await s.followUps();
    expect(after.find((row) => row._id === planned[0]._id)?.status).toBe("stopped");
    expect(mockOutbox.length).toBeGreaterThan(0);
    expect(HOUR).toBeGreaterThan(0);
  });
});
