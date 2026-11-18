/**
 * The Sales agent on main: the behaviours that had no test after the rebuild, and what was brought back
 * with them. Reminder sequences, a person's reply, stale approvals, roles, missing connections,
 * delivery failures, pausing, credits, imports, forged reply addresses, erasure, Google leads, the
 * pipeline's stage rules, the discount band, the sidebar and Chat.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, AREA, company, HOUR, refusal } from "../tests/harness";
import { agentSetup, agentTestEnv, flush, PROSPECT, quoteLink } from "../tests/salesHarness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";
import { NOT_ALLOWED } from "./lib/errors";
import { mockEmails } from "./lib/messaging/email";
import { mockOutbox } from "./lib/messaging/provider";
import { mockSalesModel } from "./lib/sales/model";
import { discountInBand } from "./lib/sales/settings";

type S = Awaited<ReturnType<typeof agentSetup>>;

/** A prospect who has been sent a quote, by text. */
async function quoted(s: S, phone: string = PROSPECT.phone, eventId = "evt-q") {
  await s.text(phone, `House cleaning please, 3 bed 2 bath, ${AREA}`, eventId);
  await flush(s.t);
  const opportunity = (await s.opportunities()).at(-1)!;
  return { opportunityId: opportunity._id };
}

describe("Sales agent: behaviours restored after the rebuild", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = agentTestEnv();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.SALES_REPLY_DOMAIN;
    undo();
  });

  it("sends each reminder once, ends the sequence, and then leaves it with a person", async () => {
    const s = await agentSetup({ autonomous: true });
    const { opportunityId } = await quoted(s);
    const before = s.textsTo(PROSPECT.phone).length;
    const first = (await s.followUps()).find((row) => row.status === "scheduled")!;
    expect(first).toMatchObject({ purpose: "quote", attempt: 1, maxAttempts: 2 });
    vi.setSystemTime(first.dueAt + 1000);
    await s.t.mutation(internal.salesFollowUps.due, { followUpId: first._id });
    await s.t.mutation(internal.salesFollowUps.due, { followUpId: first._id });
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(before + 1);
    const second = (await s.followUps()).find((row) => row.status === "scheduled")!;
    expect(second).toMatchObject({ attempt: 2 });
    vi.setSystemTime(second.dueAt + 1000);
    await s.t.mutation(internal.salesFollowUps.due, { followUpId: second._id });
    await flush(s.t);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(before + 2);
    // No third reminder exists, and the opportunity is a person's to decide.
    expect((await s.followUps()).filter((row) => row.status === "scheduled")).toHaveLength(0);
    expect((await s.opportunity(opportunityId)).card.nextAction).toMatchObject({ by: "owner" });
  });

  it("takes the conversation for a person who simply replies, so two voices never answer", async () => {
    const s = await agentSetup({ autonomous: true });
    await s.text(PROSPECT.phone, `How much for a house cleaning in ${AREA}?`, "evt-1");
    await flush(s.t);
    const [opportunity] = await s.opportunities();
    await s.as.mutation(api.salesConversations.send, { companyId: s.companyId, opportunityId: opportunity._id, channel: "sms", body: "Hi, this is Dana. Happy to help by phone if easier.", clientKey: "k1-manual-reply" });
    await flush(s.t);
    expect((await s.opportunity(opportunity._id)).card.takenOver).toBe(true);
    expect((await s.followUps()).every((row) => row.status !== "scheduled")).toBe(true);
    const count = mockOutbox.length;
    await s.text(PROSPECT.phone, "3 bed 2 bath", "evt-2");
    await flush(s.t);
    expect(mockOutbox).toHaveLength(count);
  });

  it("does not carry an approval over to a quote that changed after it was requested", async () => {
    const s = await agentSetup();
    await s.reviewed();
    await quoted(s);
    const first = await s.as.query(api.approvals.list, { companyId: s.companyId });
    expect(first).toHaveLength(1);
    // Before anyone decides, the customer changes the details.
    await s.text(PROSPECT.phone, "Sorry, it's 4 bedrooms not 3", "evt-change");
    await flush(s.t);
    expect(await refusal(s.as.mutation(api.approvals.decide, { companyId: s.companyId, approvalId: first[0]._id, decision: "approved" }))).toMatch(/already|no longer/i);
    expect(s.textsTo(PROSPECT.phone)).toHaveLength(0);
    const next = await s.as.query(api.approvals.list, { companyId: s.companyId });
    expect(next).toHaveLength(1);
    expect(next[0]._id).not.toBe(first[0]._id);
  });

  it("keeps the Playbook to the Owner and booking decisions away from Office", async () => {
    const s = await agentSetup({ autonomous: true });
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    const playbook = await s.as.query(api.salesInquiries.playbook, { companyId: s.companyId });
    expect(playbook.canEdit).toBe(true);
    expect(await refusal(manager.mutation(api.salesInquiries.savePlaybook, { companyId: s.companyId, expectedRevision: playbook.settings.revision, settings: {} }))).toBe(NOT_ALLOWED);
    expect(await refusal(office.mutation(api.salesInquiries.savePlaybook, { companyId: s.companyId, expectedRevision: playbook.settings.revision, settings: {} }))).toBe(NOT_ALLOWED);
    // Office works the pipeline but does not decide what Sales sends, or import a list.
    expect((await office.query(api.salesActions.waiting, { companyId: s.companyId })).canDecide).toBe(false);
    expect(await refusal(office.mutation(api.salesInquiries.importProspects, { companyId: s.companyId, rows: [{ name: "Old Lead", phone: "+15550106060", kind: "residential", note: "" }] }))).toBe(NOT_ALLOWED);
    // Money received is Finance's, which only the Owner reads.
    expect((await manager.query(api.salesInquiries.overview, { companyId: s.companyId, asOf: Date.now() })).measures.collectedCents).toBeNull();
    expect((await s.as.query(api.salesInquiries.overview, { companyId: s.companyId, asOf: Date.now() })).measures.collectedCents).toBe(0);
  });

  it("says texting is not connected instead of drafting a message that cannot go", async () => {
    const s = await agentSetup({ autonomous: true });
    delete process.env.MESSAGING_PROVIDER;
    delete process.env.EMAIL_PROVIDER;
    await s.text(PROSPECT.phone, `House cleaning please, 3 bed 2 bath, ${AREA}`, "evt-1");
    await flush(s.t);
    const [opportunity] = await s.opportunities();
    const detail = await s.opportunity(opportunity._id);
    expect(detail.card.nextAction).toMatchObject({ by: "owner" });
    expect(mockOutbox).toHaveLength(0);
    const ready = await s.as.query(api.salesInquiries.readiness, { companyId: s.companyId });
    expect(ready.find((row) => row.key === "texting")).toMatchObject({ ok: false });
    expect(ready.find((row) => row.key === "services")).toMatchObject({ ok: true });
  });

  it("tells the Owner when a message did not arrive, and never resends one whose fate is unknown", async () => {
    const s = await agentSetup({ autonomous: true });
    // 0001: the carrier refuses the number. 0003: the send dies with no answer.
    const failed = await quoted(s, "+15550100001", "evt-fail");
    const lost = await quoted(s, "+15550100003", "evt-lost");
    const one = await s.opportunity(failed.opportunityId);
    expect(one.thread.at(-1)!.delivery).toMatchObject({ state: "failed" });
    expect(one.card.nextAction).toMatchObject({ by: "owner" });
    expect((await s.followUps()).filter((row) => row.opportunityId === failed.opportunityId && row.status === "scheduled")).toHaveLength(0);
    // The other: nobody knows. It is marked so and not sent again.
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await s.t.mutation(internal.messaging.sweepStuck, {});
    await flush(s.t);
    const two = await s.opportunity(lost.opportunityId);
    expect(two.thread.at(-1)!.delivery).toMatchObject({ state: "unknown" });
    expect(two.card.nextAction).toMatchObject({ by: "owner" });
    expect(mockOutbox.filter((row) => row.to === "+15550100003")).toHaveLength(1);
  });

  it("stops a message already queued when Sales is paused before it leaves", async () => {
    const s = await agentSetup({ autonomous: true });
    // This company holds work messages for quiet hours too. The message is planned at night, so it is held.
    await s.t.run(async (ctx) => {
      const profile = (await ctx.db.query("complianceProfiles").collect()).find((row) => row.companyId === s.companyId)!;
      await ctx.db.patch(profile._id, { messaging: { ...profile.messaging, quietHours: { start: "21:00", end: "08:00", appliesToOperational: true } } });
    });
    vi.setSystemTime(Date.UTC(2027, 2, 2, 4, 0));
    await s.text(PROSPECT.phone, `House cleaning please, 3 bed 2 bath, ${AREA}`, "evt-night");
    await flush(s.t);
    const held = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).find((row) => row.opportunityId !== undefined)!);
    expect(held.status).toBe("held");
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["sales"] });
    // Morning comes: the held message is taken up again, and the policy is asked again.
    vi.advanceTimersByTime(11 * HOUR);
    await flush(s.t);
    expect(mockOutbox).toHaveLength(0);
    expect(await s.t.run(async (ctx) => (await ctx.db.get(held._id))!)).toMatchObject({ status: "not_sent", refusal: "agent_paused" });
  });

  describe("the AI reader's credits", () => {
    const executions = (s: S) => s.t.run(async (ctx) => (await ctx.db.query("aiExecutions").collect()).filter((row) => row.task === "sales_message_reading"));

    it("charges one credit for a message it read", async () => {
      vi.stubEnv("SALES_MODEL", "mock");
      const s = await agentSetup({ autonomous: true });
      await s.text(PROSPECT.phone, `How much for a house cleaning in ${AREA}? 3 bed 2 bath`, "evt-1");
      await flush(s.t);
      expect(mockSalesModel.calls).toBe(1);
      const [execution] = await executions(s);
      expect(execution).toMatchObject({ agent: "sales", state: "completed", charged: 1, autonomous: true });
    });

    it("falls back to the rules, charging nothing, when there are no credits", async () => {
      vi.stubEnv("SALES_MODEL", "mock");
      const s = await agentSetup({ autonomous: true });
      billing.seed(s.companyId, { plan: "operate", grant: 0 });
      await s.text(PROSPECT.phone, `How much for a house cleaning in ${AREA}? 3 bed 2 bath`, "evt-1");
      await flush(s.t);
      expect(mockSalesModel.calls).toBe(0);
      const [execution] = await executions(s);
      expect(execution.charged ?? 0).toBe(0);
      // The inquiry was still read and answered.
      expect(s.textsTo(PROSPECT.phone).length).toBeGreaterThan(0);
    });
  });

  it("writes to an imported prospect only after a person records how they agreed", async () => {
    const s = await agentSetup({ autonomous: true });
    await s.as.mutation(api.salesInquiries.importProspects, { companyId: s.companyId, rows: [{ name: "Old Lead", phone: "+15550106060", kind: "residential", note: "Asked about a clean in the spring." }] });
    await flush(s.t);
    const imported = (await s.opportunities()).find((row) => row.intake?.kind === "import")!;
    const before = await s.opportunity(imported._id);
    expect(before.reach).toMatchObject({ ok: false, code: "no_permission" });
    await s.as.mutation(api.salesInquiries.work, { companyId: s.companyId, opportunityId: imported._id });
    await flush(s.t);
    expect(s.textsTo("+15550106060")).toHaveLength(0);
    // An import is never accepted as the way someone agreed.
    await expect(s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: { kind: "customer", id: before.customer!.customerId }, channel: "sms", category: "operational", status: "granted", source: "import" })).rejects.toThrow();
    await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: { kind: "customer", id: before.customer!.customerId }, channel: "sms", category: "operational", status: "granted", source: "verbal", evidence: "Asked us to text a price on the call of March 1." });
    await s.as.mutation(api.salesInquiries.work, { companyId: s.companyId, opportunityId: imported._id });
    await flush(s.t);
    expect(s.textsTo("+15550106060").length).toBeGreaterThan(0);
  });

  it("ignores a reply address nobody was given, an automatic reply, and the right key on the wrong domain", async () => {
    process.env.SALES_REPLY_DOMAIN = "reply.selestial.test";
    const s = await agentSetup({ autonomous: true });
    const { opportunityId } = await s.as.mutation(api.salesInquiries.create, { companyId: s.companyId, name: "Maria Lopez", email: PROSPECT.email, kind: "residential", inquiry: `3 bed 2 bath house cleaning in ${AREA}`, channel: "email", consent: { source: "verbal", note: "Asked us to email the quote." }, clientKey: "manual-email-1" });
    await flush(s.t);
    const replyTo = mockEmails.filter((row) => row.to === PROSPECT.email).at(-1)!.replyTo!;
    expect(replyTo).toMatch(/^r-[0-9a-f]{32}@reply\.selestial\.test$/);
    const arrive = (to: string, automatic = false) => s.t.mutation(internal.salesInbound.receive, { providerId: `resend-in:${to}:${automatic}`, from: `Maria Lopez <${PROSPECT.email}>`, recipients: [to], subject: "Re: Your quote", text: "Sounds good, thank you!", automatic, failedAuthentication: false, receivedAt: Date.now() });
    expect(await arrive(`r-${"0".repeat(32)}@reply.selestial.test`)).toEqual({ taken: false, why: "no_conversation" });
    expect(await arrive("hello@reply.selestial.test")).toEqual({ taken: false, why: "no_conversation" });
    expect(await arrive(replyTo.replace("reply.selestial.test", "elsewhere.test"))).toEqual({ taken: false, why: "no_conversation" });
    expect(await arrive(replyTo, true)).toEqual({ taken: false, why: "automatic" });
    expect((await s.opportunity(opportunityId)).thread.filter((row) => row.direction === "in" && row.channel === "email")).toHaveLength(0);
    // With no receiving domain, readiness says replies do not come back.
    delete process.env.SALES_REPLY_DOMAIN;
    expect((await s.as.query(api.salesInquiries.readiness, { companyId: s.companyId })).find((row) => row.key === "replies")).toMatchObject({ ok: false });
  });

  it("removes a customer's Sales conversation when their details are erased, and stops what was waiting", async () => {
    const s = await agentSetup({ autonomous: true });
    const { opportunityId } = await quoted(s);
    const before = await s.opportunity(opportunityId);
    expect(before.thread.length).toBeGreaterThan(1);
    expect((await s.followUps()).some((row) => row.status === "scheduled")).toBe(true);
    const result = await s.as.mutation(api.dataRights.eraseCustomer, { companyId: s.companyId, customerId: before.customer!.customerId, confirm: "ERASE" });
    expect(JSON.stringify(result)).toContain("Sales conversations");
    await flush(s.t);
    const rows = await s.t.run(async (ctx) => ({
      messages: (await ctx.db.query("salesMessages").collect()).filter((row) => row.opportunityId === opportunityId),
      opportunity: (await ctx.db.get(opportunityId))!,
      outbox: (await ctx.db.query("messages").collect()).filter((row) => row.opportunityId === opportunityId),
    }));
    expect(rows.messages.every((row) => row.body === "Erased.")).toBe(true);
    expect(rows.outbox.every((row) => row.body === "Erased." && row.to === undefined)).toBe(true);
    expect(rows.opportunity).toMatchObject({ inquiry: "Erased.", facts: [], stage: "lost", followUps: "stopped" });
    expect((await s.followUps()).filter((row) => row.status === "scheduled")).toHaveLength(0);
    // Nothing more is sent to them.
    const sent = mockOutbox.length;
    vi.setSystemTime(Date.now() + 10 * 24 * HOUR);
    await flush(s.t);
    expect(mockOutbox).toHaveLength(sent);
  });

  it("files a Google lead as one opportunity in the pipeline, without assuming permission to contact", async () => {
    const s = await agentSetup({ autonomous: true });
    const lead = { companyId: s.companyId, source: "lead_form" as const, externalId: "lead-1", name: "Priya Nair", phone: "+15550109090", postalCode: AREA };
    const first = await s.t.mutation(internal.googleAds.ingestLead, lead);
    await s.t.mutation(internal.googleAds.ingestLead, lead);
    await flush(s.t);
    const opportunities = (await s.opportunities()).filter((row) => row.intake?.kind === "google_lead");
    expect(opportunities).toHaveLength(1);
    expect(first).toMatchObject({ created: true, opportunityId: opportunities[0]._id });
    // A lead is not consent: nothing is texted until a person records it.
    expect(s.textsTo("+15550109090")).toHaveLength(0);
    expect((await s.opportunity(opportunities[0]._id)).reach).toMatchObject({ ok: false });
  });

  it("keeps the agent's stage rules when a card is moved on the pipeline", async () => {
    const s = await agentSetup({ autonomous: true });
    const { opportunityId } = await quoted(s);
    // Won follows a confirmed booking, never a hand on the board.
    expect(await refusal(s.as.mutation(api.pipeline.update, { companyId: s.companyId, opportunityId, stage: "won" }))).toContain("booking is confirmed");
    // A stage whose condition does not hold is refused with the reason.
    expect(await refusal(s.as.mutation(api.pipeline.update, { companyId: s.companyId, opportunityId, stage: "new" }))).toContain("cannot move straight");
    expect((await s.opportunities())[0].stage).toBe("quoting");
    // Losing it by hand closes it properly: reminders stop and the reason is kept.
    await s.as.mutation(api.pipeline.update, { companyId: s.companyId, opportunityId, stage: "lost", closedReason: "Went with a friend's cleaner." });
    await flush(s.t);
    expect((await s.opportunities())[0]).toMatchObject({ stage: "lost", lostReason: "other" });
    expect((await s.followUps()).filter((row) => row.status === "scheduled")).toHaveLength(0);
  });

  it("lets a price be lowered inside the Owner's discount band, and nothing beyond it", () => {
    const band = (maxPercent: number) => ({ sales: { discounts: { maxPercent, reasons: [] } } });
    const change = (proposedCents: number, reason = "First-time customer") => ({ referenceCents: 20000, proposedCents, reason });
    // The band starts at 0: every change is asked about.
    expect(discountInBand(band(0), change(19000))).toBe(false);
    expect(discountInBand(band(10), change(18000))).toBe(true);
    expect(discountInBand(band(10), change(17999))).toBe(false);
    // A higher price, a missing reason, or nothing to compare against is never in band.
    expect(discountInBand(band(10), change(21000))).toBe(false);
    expect(discountInBand(band(10), change(19000, " "))).toBe(false);
    expect(discountInBand(band(10), { referenceCents: null, proposedCents: 19000, reason: "x" })).toBe(false);
  });

  it("shows a Sales proposal in the approvals panel with the exact words, and counts it in the sidebar", async () => {
    const s = await agentSetup();
    await s.reviewed();
    await quoted(s);
    const approvals = await s.as.query(api.approvals.list, { companyId: s.companyId });
    expect(approvals).toHaveLength(1);
    const detail = await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "approval", id: approvals[0]._id }, asOf: Date.now() });
    const facts = Object.fromEntries(detail.context.map((row) => [row.label, row.value]));
    expect(facts.To).toContain("by text");
    expect(facts.Message).toContain("$185.00");
    // The link is a placeholder until the message is really sent.
    expect(facts.Message).not.toContain("/c/quote/");
    expect((await s.as.query(api.overview.sidebar, { companyId: s.companyId, asOf: Date.now() })).sales).toMatchObject({ paused: false, withYou: 1 });
  });

  it("offers an opportunity to Chat as context inside its own company only", async () => {
    const s = await agentSetup({ autonomous: true });
    const { opportunityId } = await quoted(s);
    const mine = await s.as.query(api.chat.resolveContext, { companyId: s.companyId, refs: [{ table: "salesOpportunities", id: opportunityId }] });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ table: "salesOpportunities", id: opportunityId, label: expect.stringContaining("The sales opportunity for") });
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await other.as.query(api.chat.resolveContext, { companyId: other.companyId, refs: [{ table: "salesOpportunities", id: opportunityId }] })).toEqual([]);
    expect(quoteLink(PROSPECT.phone)).toBeTruthy();
  });
});
