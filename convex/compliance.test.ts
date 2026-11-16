/**
 * @vitest-environment edge-runtime
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, PHONES, setup } from "../tests/dispatchHarness";
import { addMember, company, dispatchJob, HOUR, NOW, person, refusal, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { Actor } from "./lib/events";
import { queueMessage } from "./lib/messaging/outbox";
import { POLICY_CODES, POLICY_WORDS } from "./lib/messaging/policy";
import { mockOutbox } from "./lib/messaging/provider";
import { currentVersion } from "./lib/trust/documents";

const DISPATCH: Actor = { kind: "agent", agent: "dispatch" };
const STAFF = { subject: "user_staff", email: "staff@selestial.example", emailVerified: true, name: "Staff" };
const DAY = 24 * HOUR;
/** 10:00 in Chicago on the test day, outside the default quiet hours. */
const MORNING = NOW + 4 * HOUR;

type S = Awaited<ReturnType<typeof setup>>;

/** A plain text to Lena, planned the way Dispatch plans one. */
function queue(s: S, key: string, actor: Actor = DISPATCH) {
  return s.t.run(async (ctx) => {
    const cleaner = (await ctx.db.get(s.cleaners.Lena))!;
    return queueMessage(ctx, { companyId: s.companyId, purpose: "reminder", cleaner, body: "Alpha Cleaning: reminder.", dedupeKey: key, actor });
  });
}

function message(s: S, id: Id<"messages">) {
  return s.t.run(async (ctx) => (await ctx.db.get(id))!);
}

function inbound(s: S, body: string, from: string = PHONES.Lena) {
  return s.t.mutation(internal.inbound.sms, { to: s.smsNumber, from, body, receivedAt: Date.now() });
}

function textsTo(phone: string) {
  return mockOutbox.filter((row) => row.to === phone && row.result === "accepted");
}

const lena = (s: S) => ({ kind: "cleaner" as const, id: s.cleaners.Lena as string });

function check(s: S, input: Partial<{ category: "operational" | "marketing" | "recruiting"; origin: "agent" | "manual" | "dispatch"; agent: "dispatch"; to: string }> = {}) {
  return s.as.query(api.consent.check, {
    companyId: s.companyId,
    channel: "sms",
    to: input.to ?? PHONES.Lena,
    recipient: input.to ? undefined : lena(s),
    category: input.category ?? "operational",
    origin: input.origin ?? "manual",
    agent: input.agent,
  });
}

async function marketingWording(s: S) {
  const made = await s.as.mutation(api.compliance.addDisclosure, { companyId: s.companyId, channel: "sms", category: "marketing", text: "Yes, text me offers from Alpha Cleaning. Up to 2 a week. Reply STOP to stop." });
  return made.disclosureId;
}

describe("Messaging consent and the sending policy", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
  });
  afterEach(() => {
    undo();
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  it("stops a queued Dispatch text and every later one after STOP, and confirms once", async () => {
    const s = await setup(["Lena"]);
    await s.autonomous();
    await dispatchJob(s.as, s.companyId, s.place);
    // The offer is planned and waiting to be sent when the cleaner texts STOP.
    const planned = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((row) => row.cleanerId === s.cleaners.Lena));
    expect(planned.map((row) => row.status)).toEqual(["queued"]);
    expect(await inbound(s, "  stop ")).toEqual({ kind: "stop", replied: true });
    await flush(s.t);

    const offer = await message(s, planned[0]._id);
    expect(offer).toMatchObject({ status: "not_sent", problem: "This number replied STOP, so it gets no texts from this business until it replies START." });
    // Only the confirmation reached the phone, and it names the business.
    expect(textsTo(PHONES.Lena).map((row) => row.body)).toEqual(["You will no longer receive texts from Alpha Cleaning. Reply START to resubscribe."]);

    // A second STOP changes nothing and sends nothing.
    expect(await inbound(s, "STOP")).toEqual({ kind: "stop", replied: false });
    await flush(s.t);
    expect(textsTo(PHONES.Lena)).toHaveLength(1);

    // A later text is refused when it is planned, and nothing is scheduled for it.
    const later = await queue(s, "later");
    expect(later).toMatchObject({ status: "not_sent" });
    expect(await check(s)).toMatchObject({ ok: false, code: "suppressed" });
    const view = await s.as.query(api.consent.forRecipient, { companyId: s.companyId, recipient: lena(s) });
    expect(view.permissions.find((row) => row.category === "operational")).toMatchObject({ status: "withdrawn", source: "text_reply", stopKeyword: true });
    expect(view.suppressions).toMatchObject([{ reason: "stop_keyword", scope: "all", address: PHONES.Lena, sourceMessage: "stop" }]);
    // The Owner cannot undo a STOP for the person.
    expect(await refusal(s.as.mutation(api.consent.lift, { companyId: s.companyId, suppressionId: view.suppressions[0]._id, note: "They called" }))).toBe("Only the person can undo STOP, by replying START.");
  });

  it("answers HELP with who is texting and how to reach them, and limits automatic answers", async () => {
    const s = await setup(["Lena"]);
    await s.as.mutation(api.compliance.updateIdentity, { companyId: s.companyId, supportPhone: "+1 512 555 0199", supportEmail: "Help@Alpha.example" });
    expect(await inbound(s, "help")).toEqual({ kind: "help", replied: true });
    await flush(s.t);
    expect(textsTo(PHONES.Lena).map((row) => row.body)).toEqual(["Alpha Cleaning: for help, call +15125550199 or email help@alpha.example. Reply STOP to stop texts."]);
    for (let i = 0; i < 6; i += 1) {
      vi.advanceTimersByTime(1000);
      await inbound(s, "INFO");
    }
    await flush(s.t);
    expect(textsTo(PHONES.Lena).length).toBe(5);
    // A number that is not a company's texting number is not handled at all.
    expect(await s.t.mutation(internal.inbound.sms, { to: "+15125559999", from: PHONES.Lena, body: "STOP", receivedAt: Date.now() })).toEqual({ kind: "unknown_number", replied: false });
    // Anything that is not a keyword is left alone and nothing about it is stored.
    expect(await inbound(s, "running 5 min late")).toEqual({ kind: "ignored", replied: false });
    expect(await s.as.query(api.consent.suppressions, { companyId: s.companyId })).toEqual([]);
  });

  it("restores on START only what the STOP withdrew", async () => {
    const s = await setup(["Lena"]);
    const wording = await marketingWording(s);
    await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "marketing", status: "granted", source: "web_form", disclosureId: wording });
    // Lena told the office she wants no marketing texts, before she ever texted STOP.
    await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "marketing", status: "withdrawn", source: "verbal" });
    expect(await inbound(s, "Start")).toEqual({ kind: "ignored", replied: false });

    await inbound(s, "STOP");
    await inbound(s, "START");
    await flush(s.t);
    const view = await s.as.query(api.consent.forRecipient, { companyId: s.companyId, recipient: lena(s) });
    const byCategory = Object.fromEntries(view.permissions.map((row) => [row.category, row]));
    expect(byCategory.operational).toMatchObject({ status: "granted", source: "text_reply" });
    expect(byCategory.operational.stopKeyword).toBeUndefined();
    // Marketing stays withdrawn: START is never a new marketing permission.
    expect(byCategory.marketing).toMatchObject({ status: "withdrawn", source: "verbal" });
    expect(byCategory.recruiting).toBeUndefined();
    expect(view.suppressions).toMatchObject([{ reason: "stop_keyword", liftedBy: { kind: "recipient" } }]);
    expect(textsTo(PHONES.Lena).map((row) => row.body)).toEqual([
      "You will no longer receive texts from Alpha Cleaning. Reply START to resubscribe.",
      "You will receive texts from Alpha Cleaning again. Reply STOP to stop.",
    ]);
    expect(await check(s)).toEqual({ ok: true });
    expect(await check(s, { category: "marketing" })).toMatchObject({ ok: false, code: "no_permission" });
  });

  it("stops texts on a plain-words request and asks a person to check it", async () => {
    const s = await setup(["Lena"]);
    expect(await inbound(s, "Please stop texting me, I found other work https://example.com/x?token=abc")).toEqual({ kind: "plain_stop", replied: false });
    const [task] = await s.tasks("needs_decision");
    expect(task).toMatchObject({ title: "Check a request to stop texts from Lena", about: { table: "cleaners", id: s.cleaners.Lena } });
    expect(task.openQuestion).toContain("Please stop texting me, I found other work [link]");
    expect(task.openQuestion).not.toContain("token");
    const [row] = await s.as.query(api.consent.suppressions, { companyId: s.companyId, channel: "sms" });
    expect(row).toMatchObject({ reason: "natural_language", scope: "all" });
    expect(await check(s)).toMatchObject({ ok: false, code: "suppressed" });
    // Nothing is texted back, and a second message does not open a second task.
    await inbound(s, "no more texts");
    await flush(s.t);
    expect(textsTo(PHONES.Lena)).toEqual([]);
    expect(await s.tasks("needs_decision")).toHaveLength(1);

    // Office cannot lift a stop; the Owner can, with a reason. Permission is not given back by lifting.
    const office = await addMember(s.t, s.as, s.companyId, "ola", "office");
    expect(await refusal(office.mutation(api.consent.lift, { companyId: s.companyId, suppressionId: row._id, note: "Checked" }))).toBe("Not allowed.");
    await s.as.mutation(api.consent.lift, { companyId: s.companyId, suppressionId: row._id, note: "She meant a different job board." });
    expect(await check(s)).toMatchObject({ ok: false, code: "no_permission" });
  });

  it("never counts an imported contact as permission, and keeps the wording for marketing texts", async () => {
    const s = await setup(["Lena"]);
    const imported = await s.as.mutation(api.cleaners.create, { companyId: s.companyId, name: "Ivy", engagement: "contractor", phone: "+15550109090" });
    const ivy = { kind: "cleaner" as const, id: imported as string };
    expect(await refusal(s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: ivy, channel: "sms", category: "operational", status: "granted", source: "import" }))).toBe(
      "An imported contact is not permission. Record how the person agreed.",
    );
    // A row that says "import" however it got there still does not count.
    await s.t.run(async (ctx) => {
      await ctx.db.insert("contactPermissions", { companyId: s.companyId, recipient: ivy, channel: "sms", category: "operational", status: "granted", source: "import", recordedBy: { kind: "system" }, at: Date.now() });
    });
    expect(await s.as.query(api.consent.check, { companyId: s.companyId, channel: "sms", to: "+15550109090", category: "operational", origin: "manual" })).toMatchObject({ ok: false, code: "no_permission" });
    // A number nobody in the record has is blocked too.
    expect(await check(s, { to: "+15550100077" })).toMatchObject({ ok: false, code: "no_permission" });

    expect(await refusal(s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "marketing", status: "granted", source: "web_form" }))).toBe(
      "Marketing texts need the exact wording the person agreed to. Choose it before recording.",
    );
    expect(await refusal(s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "recruiting", status: "granted", source: "verbal" }))).toBe("Say where the proof of this agreement is kept.");
    await s.t.run(async (ctx) => {
      await ctx.db.insert("contactPermissions", { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "marketing", status: "granted", source: "web_form", recordedBy: { kind: "system" }, at: Date.now() });
    });
    vi.setSystemTime(MORNING);
    expect(await check(s, { category: "marketing" })).toMatchObject({ ok: false, code: "no_permission", words: "Marketing texts need the exact wording the person agreed to, and none is recorded." });
  });

  it("blocks texting while registration is pending, and every other screen still reads", async () => {
    const s = await setup(["Lena"]);
    await s.as.mutation(api.compliance.recordRegistration, { companyId: s.companyId, status: "submitted", reference: "BRAND-1" });
    expect(await check(s)).toMatchObject({ ok: false, code: "sender_not_ready", words: "Texting needs carrier registration approval. It was submitted and is waiting." });
    expect(await queue(s, "pending")).toMatchObject({ status: "not_sent", problem: "Texting needs carrier registration approval. It was submitted and is waiting." });
    const profile = await s.as.query(api.compliance.profile, { companyId: s.companyId });
    expect(profile.messaging.registration).toMatchObject({ status: "submitted", reference: "BRAND-1", updatedBy: "owner" });
    const sms = profile.readiness.operations.find((row) => row.key === "sms")!;
    expect(sms).toMatchObject({ state: "blocked", label: "Texting needs carrier registration approval" });
    expect(JSON.stringify(profile.readiness)).not.toMatch(/compliant/i);
    // The schedule and the rest of the record still read.
    await dispatchJob(s.as, s.companyId, s.place);
    expect((await s.as.query(api.jobs.list, { companyId: s.companyId, from: NOW, to: NOW + 7 * DAY })).length).toBe(1);
    expect(await s.as.query(api.agreements.status, { companyId: s.companyId })).toMatchObject({ terms: { current: false } });
    // An owner cannot mark it approved; staff can, after checking with the provider.
    await expect(s.as.mutation(api.compliance.recordRegistration, { companyId: s.companyId, status: "approved" as "submitted" })).rejects.toThrow();
    expect(await refusal(s.as.mutation(api.compliance.setRegistration, { companyId: s.companyId, status: "approved" }))).toBe("Not found.");
    process.env.STAFF_BOOTSTRAP_EMAIL = STAFF.email;
    await s.t.withIdentity(STAFF).mutation(api.compliance.setRegistration, { companyId: s.companyId, status: "approved", note: "Confirmed with the provider." });
    expect(await check(s)).toEqual({ ok: true });
    expect((await s.as.query(api.compliance.readiness, { companyId: s.companyId })).operations.find((row) => row.key === "sms")).toMatchObject({ state: "ready", label: "Ready for SMS" });
  });

  it("holds a text for quiet hours and sends it when they end, unless it is stopped meanwhile", async () => {
    const s = await setup(["Lena"]);
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: { start: "21:00", end: "08:00", appliesToOperational: true } });
    // It is 6:00 in Chicago. Quiet hours end at 8:00, which is 14:00 UTC.
    const eight = NOW + 2 * HOUR;
    expect(await check(s)).toMatchObject({ ok: false, code: "quiet_hours", retryAt: eight });
    const first = await queue(s, "first");
    const second = await queue(s, "second");
    expect(first).toMatchObject({ status: "held" });
    expect(first.problem).toContain("It can go at 8:00 AM.");
    await flush(s.t);
    expect(mockOutbox).toEqual([]);
    // While they are held, Lena calls and asks not to get work texts.
    await s.as.mutation(api.consent.suppress, { companyId: s.companyId, channel: "sms", address: "(555) 010-1010", scope: "operational", note: "Asked by phone not to get the second one." });
    vi.advanceTimersByTime(2 * HOUR);
    await flush(s.t);
    // The suppression stops both: it came before either went.
    expect(await message(s, first._id)).toMatchObject({ status: "not_sent" });
    expect(await message(s, second._id)).toMatchObject({ status: "not_sent", problem: "This number is on the do-not-contact list for work messages." });
    expect(mockOutbox).toEqual([]);
  });

  it("sends a held text at the end of quiet hours", async () => {
    const s = await setup(["Lena"]);
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: { start: "21:00", end: "08:00", appliesToOperational: true } });
    const held = await queue(s, "held");
    expect(held.status).toBe("held");
    vi.advanceTimersByTime(HOUR);
    await flush(s.t);
    expect(mockOutbox).toEqual([]);
    vi.advanceTimersByTime(HOUR);
    await flush(s.t);
    expect(await message(s, held._id)).toMatchObject({ status: "delivered" });
    expect(textsTo(PHONES.Lena)).toHaveLength(1);
    // Operational texts are not held when the Owner leaves them out of quiet hours.
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: { start: "07:00", end: "23:00", appliesToOperational: false } });
    expect(await check(s)).toEqual({ ok: true });
    expect(await refusal(s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: { start: "7pm", end: "08:00", appliesToOperational: false } }))).toBe("Quiet hours must be times like 21:00 and 08:00.");
  });

  it("keeps marketing and recruiting texts within the weekly limits", async () => {
    const s = await setup(["Lena"]);
    vi.setSystemTime(MORNING);
    const wording = await marketingWording(s);
    await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "marketing", status: "granted", source: "web_form", disclosureId: wording });
    expect(await check(s, { category: "marketing" })).toEqual({ ok: true });
    const sent = async (at: number) =>
      s.t.run(async (ctx) => {
        const messageId = await ctx.db.insert("messages", { companyId: s.companyId, purpose: "reminder", to: PHONES.Lena, body: "Offer", dedupeKey: `m${at}`, status: "delivered", attempts: 1, queuedAt: at });
        await ctx.db.insert("sendIntents", { companyId: s.companyId, messageId, channel: "sms", address: PHONES.Lena, category: "marketing", origin: "win_back", at });
      });
    await sent(MORNING - 8 * DAY); // Older than a week: not counted.
    await sent(MORNING - 2 * DAY);
    expect(await check(s, { category: "marketing" })).toEqual({ ok: true });
    await sent(MORNING - DAY);
    expect(await check(s, { category: "marketing" })).toMatchObject({ ok: false, code: "frequency", words: "This person already has 2 marketing messages in the last 7 days. The company allows 2 a week." });
    expect(await refusal(s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, frequency: { marketingPerWeek: 15, recruitingPerWeek: 7 } }))).toBe("Marketing messages per week must be a whole number from 0 to 14.");
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, frequency: { marketingPerWeek: 3, recruitingPerWeek: 7 } });
    expect(await check(s, { category: "marketing" })).toEqual({ ok: true });
  });

  it("holds an agent's texts while it is paused, but not a person's", async () => {
    const s = await setup(["Lena"]);
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["dispatch"] });
    expect(await check(s, { origin: "dispatch", agent: "dispatch" })).toMatchObject({ ok: false, code: "agent_paused", words: "Dispatch is paused, so it sends nothing. A person can still send." });
    expect(await check(s, { origin: "manual" })).toEqual({ ok: true });
    expect(await queue(s, "agent")).toMatchObject({ status: "not_sent" });
    const member = await s.t.run(async (ctx) => (await ctx.db.query("members").collect())[0]._id);
    expect(await queue(s, "person", { kind: "member", memberId: member })).toMatchObject({ status: "queued" });
    // Paused after a text was planned: it does not go.
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: [] });
    const planned = await queue(s, "before-pause");
    await s.as.mutation(api.companies.setPausedAgents, { companyId: s.companyId, agents: ["dispatch"] });
    await flush(s.t);
    expect(await message(s, planned._id)).toMatchObject({ status: "not_sent", problem: "Dispatch is paused, so it sends nothing. A person can still send." });
    expect(textsTo(PHONES.Lena)).toHaveLength(1);
  });

  it("sends nothing for a suspended company, and only staff suspend or lift it", async () => {
    const s = await setup(["Lena"]);
    const planned = await queue(s, "before");
    expect(await refusal(s.as.mutation(api.compliance.setSuspended, { companyId: s.companyId, suspended: true, note: "x" }))).toBe("Not found.");
    process.env.STAFF_BOOTSTRAP_EMAIL = STAFF.email;
    await s.t.withIdentity(STAFF).mutation(api.compliance.setSuspended, { companyId: s.companyId, suspended: true, note: "Carrier complaint under review." });
    await flush(s.t);
    expect(await message(s, planned._id)).toMatchObject({ status: "not_sent", problem: "Sending is suspended for this company by Selestial. Nothing is sent until Selestial lifts it." });
    expect(await check(s)).toMatchObject({ ok: false, code: "company_suspended" });
    const profile = await s.as.query(api.compliance.profile, { companyId: s.companyId });
    expect(profile.suspendedAt).toBeGreaterThanOrEqual(NOW);
    expect(profile.readiness.operations.find((row) => row.key === "sms")).toMatchObject({ state: "blocked", label: "Texting is suspended" });
    await s.t.withIdentity(STAFF).mutation(api.compliance.setSuspended, { companyId: s.companyId, suspended: false, note: "Resolved." });
    expect(await check(s)).toEqual({ ok: true });
    expect(mockOutbox).toEqual([]);
  });

  it("checks again at sending time and never retries around a refusal", async () => {
    const s = await setup(["Lena"]);
    const planned = await queue(s, "recheck");
    expect(planned.status).toBe("queued");
    await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "operational", status: "withdrawn", source: "verbal" });
    await flush(s.t);
    expect(await message(s, planned._id)).toMatchObject({ status: "not_sent", problem: "There is no recorded permission to send work texts to this person." });
    vi.advanceTimersByTime(DAY);
    await flush(s.t);
    expect(await message(s, planned._id)).toMatchObject({ status: "not_sent", attempts: 0 });
    expect(mockOutbox).toEqual([]);
    const events = await s.as.query(api.events.forSubject, { companyId: s.companyId, subject: { table: "messages", id: planned._id } });
    expect(events.map((row) => [row.type, row.data?.policy ?? null])).toEqual([["message.queued", null], ["message.not_sent", "no_permission"]]);
  });

  it("keeps a STOP by the number itself, so a change of provider cannot get around it", async () => {
    const s = await setup(["Lena"]);
    const planned = await queue(s, "switch");
    await inbound(s, "UNSUBSCRIBE");
    process.env.MESSAGING_PROVIDER = "telnyx";
    await flush(s.t);
    expect(await message(s, planned._id)).toMatchObject({ status: "not_sent", problem: "This number replied STOP, so it gets no texts from this business until it replies START." });
    expect(textsTo(PHONES.Lena)).toEqual([]);
    // Written in another form, it is the same number.
    expect(await check(s, { to: "555-010-1010" })).toMatchObject({ ok: false, code: "suppressed" });
  });

  it("lets the Owner change the profile, managers record permissions, and Office neither", async () => {
    const s = await setup(["Lena"]);
    const manager = await addMember(s.t, s.as, s.companyId, "max", "manager");
    const office = await addMember(s.t, s.as, s.companyId, "ola", "office");
    for (const as of [manager, office]) {
      expect(await refusal(as.mutation(api.compliance.updateIdentity, { companyId: s.companyId, legalName: "X LLC" }))).toBe("Not allowed.");
      expect(await refusal(as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, senderName: "X" }))).toBe("Not allowed.");
      expect(await refusal(as.mutation(api.compliance.addDisclosure, { companyId: s.companyId, channel: "sms", category: "marketing", text: "x" }))).toBe("Not allowed.");
      expect(await refusal(as.mutation(api.agreements.accept, { companyId: s.companyId, documentId: currentVersion("terms").id }))).toBe("Not allowed.");
    }
    expect(await refusal(office.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "recruiting", status: "granted", source: "onboarding" }))).toBe("Not allowed.");
    expect(await refusal(office.mutation(api.consent.suppress, { companyId: s.companyId, channel: "sms", address: PHONES.Lena, scope: "all" }))).toBe("Not allowed.");
    await manager.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "sms", category: "recruiting", status: "granted", source: "onboarding" });
    const { suppressionId } = await manager.mutation(api.consent.suppress, { companyId: s.companyId, channel: "sms", address: PHONES.Lena, scope: "marketing" });
    expect(await refusal(manager.mutation(api.consent.lift, { companyId: s.companyId, suppressionId, note: "x" }))).toBe("Not allowed.");
    // Every member reads the profile and a recipient's choices.
    expect((await office.query(api.compliance.profile, { companyId: s.companyId })).messaging.senderName).toBe("Alpha Cleaning");
    expect((await office.query(api.consent.forRecipient, { companyId: s.companyId, recipient: lena(s) })).permissions).toHaveLength(2);

    await s.as.mutation(api.compliance.updateIdentity, {
      companyId: s.companyId,
      legalName: "Alpha Cleaning LLC",
      address: { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" },
      representative: { name: "Ann Owner", title: "Owner", email: "Ann@Alpha.example" },
      supportEmail: "help@alpha.example",
    });
    expect(await refusal(s.as.mutation(api.compliance.updateIdentity, { companyId: s.companyId, supportPhone: "512 555" }))).toBe("The support phone must be in international form, for example +15125550100.");
    expect(await refusal(s.as.mutation(api.compliance.updateIdentity, { companyId: s.companyId, supportEmail: "nope" }))).toBe("The support email is not a valid email address.");
    const identity = (await s.as.query(api.compliance.profile, { companyId: s.companyId })).readiness.operations.find((row) => row.key === "identity");
    expect(identity).toMatchObject({ state: "ready", label: "Business details complete" });
    // A new texting number needs its registration confirmed again.
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, smsNumber: "+15125550111" });
    expect((await s.as.query(api.compliance.profile, { companyId: s.companyId })).messaging.registration.status).toBe("not_started");
  });

  it("keeps one company's profile, permissions and stops out of another's reach", async () => {
    const s = await setup(["Lena"]);
    await inbound(s, "STOP");
    const [stop] = await s.as.query(api.consent.suppressions, { companyId: s.companyId });
    const { as: other, companyId: otherCompany } = await company(s.t, "owner-b", "Beta Cleaning");
    for (const companyId of [s.companyId, otherCompany]) {
      expect(await refusal(other.query(api.consent.forRecipient, { companyId, recipient: lena(s) }))).toBe("Not found.");
      expect(await refusal(other.mutation(api.consent.record, { companyId, recipient: lena(s), channel: "sms", category: "operational", status: "granted", source: "onboarding" }))).toBe("Not found.");
      expect(await refusal(other.mutation(api.consent.lift, { companyId, suppressionId: stop._id, note: "x" }))).toBe("Not found.");
      expect(await refusal(other.query(api.consent.check, { companyId, channel: "sms", to: PHONES.Lena, recipient: lena(s), category: "operational", origin: "manual" }))).toBe("Not found.");
    }
    expect(await refusal(other.query(api.compliance.profile, { companyId: s.companyId }))).toBe("Not found.");
    expect(await refusal(other.mutation(api.compliance.updateMessaging, { companyId: s.companyId, senderName: "Mine" }))).toBe("Not found.");
    expect(await refusal(other.query(api.consent.suppressions, { companyId: s.companyId }))).toBe("Not found.");
    expect(await other.query(api.consent.suppressions, { companyId: otherCompany })).toEqual([]);
    // Another company cannot take this company's texting number.
    expect(await refusal(other.mutation(api.compliance.updateMessaging, { companyId: otherCompany, smsNumber: s.smsNumber }))).toBe("That texting number is already set up for another account.");
    // Someone signed out gets nothing either.
    expect(await refusal(s.t.query(api.compliance.profile, { companyId: s.companyId }))).toBe("Not found.");
  });

  it("reads defaults for a company that never saved a profile, with readiness by operation", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner-c", "Gamma Cleaning");
    const profile = await as.query(api.compliance.profile, { companyId });
    expect(profile).toMatchObject({ saved: false, updatedAt: null, suspendedAt: null, messaging: { registration: { status: "not_started" }, quietHours: { start: "21:00", end: "08:00", appliesToOperational: false }, frequency: { marketingPerWeek: 2, recruitingPerWeek: 7 } } });
    expect(profile.readiness.operations.map((row) => [row.key, row.state])).toEqual([
      ["sms", "blocked"],
      ["email", "blocked"],
      ["agents", "attention"],
      ["data", "attention"],
      ["agreements", "attention"],
      ["identity", "attention"],
    ]);
    expect(profile.readiness.operations[0].blockers.map((row) => row.key)).toEqual(["sender_name", "sms_number", "registration"]);
    for (const operation of profile.readiness.operations) for (const blocker of operation.blockers) expect(blocker.next.length).toBeGreaterThan(0);
    expect(POLICY_CODES.every((code) => POLICY_WORDS[code].length > 0)).toBe(true);
  });

  it("answers what each channel and category would do for one person", async () => {
    const s = await setup(["Lena"]);
    const view = await s.as.query(api.consent.forRecipient, { companyId: s.companyId, recipient: lena(s) });
    const answer = (channel: string, category: string) => view.explain.find((row) => row.channel === channel && row.category === category)!;
    expect(answer("sms", "operational")).toMatchObject({ address: PHONES.Lena, answer: { ok: true } });
    expect(answer("sms", "marketing").answer).toMatchObject({ ok: false });
    expect(answer("email", "operational")).toMatchObject({ address: null, answer: { ok: false, code: "sender_not_ready" } });
    expect(view.history).toMatchObject([{ status: "granted", previousStatus: null, source: "onboarding" }]);
    expect(await refusal(s.as.query(api.consent.forRecipient, { companyId: s.companyId, recipient: { kind: "applicant", id: "a1" } }))).toBe("Not found.");
  });

  it("stops email of one kind after an unsubscribe", async () => {
    const s = await setup(["Lena"]);
    await s.as.mutation(api.cleaners.update, { companyId: s.companyId, cleanerId: s.cleaners.Lena, email: "lena@example.com" });
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, emailFromAddress: "team@alpha.example", quietHours: null });
    for (const category of ["operational", "recruiting"] as const) {
      await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: lena(s), channel: "email", category, status: "granted", source: "onboarding" });
    }
    await s.t.mutation(internal.inbound.emailUnsubscribe, { companyId: s.companyId, address: "LENA@example.com", category: "recruiting" });
    const email = (category: "operational" | "recruiting") => s.as.query(api.consent.check, { companyId: s.companyId, channel: "email", to: "lena@example.com", category, origin: "manual" });
    expect(await email("recruiting")).toMatchObject({ ok: false, code: "suppressed" });
    expect(await email("operational")).toEqual({ ok: true });
  });
});

describe("Selestial agreements", () => {
  const terms = currentVersion("terms");

  it("accepts the current version only, once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const t = start();
      const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
      expect(await as.query(api.agreements.status, { companyId })).toEqual({ terms: { documentId: terms.id, title: terms.title, effectiveOn: terms.effectiveOn, latestAcceptance: null, current: false } });
      expect(await refusal(as.mutation(api.agreements.accept, { companyId, documentId: "terms-2025-01-01" }))).toBe("That is not the current version.");
      expect(await refusal(as.mutation(api.agreements.accept, { companyId, documentId: "privacy-2026-11-16" }))).toBe("That is not the current version.");
      expect(await as.mutation(api.agreements.accept, { companyId, documentId: terms.id })).toMatchObject({ alreadyAccepted: false });
      expect(await as.mutation(api.agreements.accept, { companyId, documentId: terms.id })).toMatchObject({ alreadyAccepted: true });
      expect(await as.query(api.agreements.status, { companyId })).toMatchObject({ terms: { current: true, latestAcceptance: { documentId: terms.id, acceptedByName: "owner-a", at: NOW } } });
      expect(await t.run(async (ctx) => (await ctx.db.query("agreementAcceptances").collect()).length)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records the exact version on company creation, and a repeated setup adds nothing", async () => {
    const t = start();
    const as = t.withIdentity(person("owner-z"));
    expect(await refusal(as.mutation(api.companies.create, { name: "Zed", timezone: "America/Chicago", setupKey: "setup-key-1", acceptTerms: "terms-2020-01-01" }))).toBe("That is not the current version.");
    expect(await t.run(async (ctx) => (await ctx.db.query("companies").collect()).length)).toBe(0);
    const first = await as.mutation(api.companies.create, { name: "Zed", timezone: "America/Chicago", setupKey: "setup-key-1", acceptTerms: terms.id });
    const again = await as.mutation(api.companies.create, { name: "Zed", timezone: "America/Chicago", setupKey: "setup-key-1", acceptTerms: terms.id });
    expect(again).toBe(first);
    const rows = await t.run(async (ctx) => ctx.db.query("agreementAcceptances").collect());
    const owner = await t.run(async (ctx) => (await ctx.db.query("members").collect())[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: first, documentId: terms.id, kind: "terms", acceptedBy: { memberId: owner._id, userId: "owner-z" } });
  });
});

// ── Append-only records ───────────────────────────────────────────────────────────────────────────

function filesUnder(dir: string): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !full.includes("_generated")) out.push({ path: full, source: readFileSync(full, "utf8") });
  }
  return out;
}

describe("append-only consent records", () => {
  const tree = filesUnder(path.join(process.cwd(), "convex"));

  it("has one writer for the history and the acceptances, and it only inserts", () => {
    const writers = tree.filter((file) => /insert\(\s*["'](permissionHistory|agreementAcceptances)["']/.test(file.source)).map((file) => path.basename(file.path));
    expect(writers).toEqual(["ledger.ts"]);
    const ledger = tree.find((file) => file.path.endsWith(path.join("compliance", "ledger.ts")))!;
    expect(ledger.source).not.toMatch(/\.(patch|replace|delete)\(/);
    for (const file of tree) {
      expect(file.source, file.path).not.toMatch(/(Doc|Id)<"(permissionHistory|agreementAcceptances)">[^;\n]*\n?[^;\n]*\.(patch|replace|delete)\(/);
    }
  });

  it("keeps every change with what it was before, and never rewrites one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.ACTION_LINK_SECRET = "test-only-secret-for-action-links-0123456789";
    try {
      const t = start();
      const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
      const cleanerId = await as.mutation(api.cleaners.create, { companyId, name: "Lena", engagement: "contractor" });
      const recipient = { kind: "cleaner" as const, id: cleanerId as string };
      const change = (status: "granted" | "withdrawn") => as.mutation(api.consent.record, { companyId, recipient, channel: "sms", category: "operational", status, source: "onboarding" });
      await change("granted");
      const before = JSON.stringify(await t.run(async (ctx) => ctx.db.query("permissionHistory").collect()));
      vi.advanceTimersByTime(1000);
      await change("withdrawn");
      vi.advanceTimersByTime(1000);
      await change("granted");
      const rows = await t.run(async (ctx) => ctx.db.query("permissionHistory").collect());
      expect(rows.map((row) => [row.previousStatus, row.status])).toEqual([[null, "granted"], ["granted", "withdrawn"], ["withdrawn", "granted"]]);
      expect(JSON.stringify([rows[0]])).toBe(before);
      expect(await t.run(async (ctx) => (await ctx.db.query("contactPermissions").collect()).length)).toBe(1);
    } finally {
      vi.useRealTimers();
      delete process.env.ACTION_LINK_SECRET;
    }
  });
});
