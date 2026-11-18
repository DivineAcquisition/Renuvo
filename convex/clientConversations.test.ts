/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, setup } from "../tests/dispatchHarness";
import { addMember, HOUR, NOW, refusal } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockOutbox } from "./lib/messaging/provider";

/** 10:00 in Chicago on the test day, outside the default quiet hours. */
const MORNING = NOW + 4 * HOUR;
const DANA = "+15125550188";
const SITE = "+15125550177";

type S = Awaited<ReturnType<typeof setup>>;

async function client(s: S) {
  const customerId = s.place.customerId;
  // The first contact is the primary one, and their phone is the client's own.
  await s.as.mutation(api.clients.saveContact, { companyId: s.companyId, customerId, name: "Dana Whitfield", phone: DANA, roles: ["primary"], propertyIds: [] });
  await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: { kind: "customer", id: customerId }, channel: "sms", category: "operational", status: "granted", source: "web_form" });
  const { contactId } = await s.as.mutation(api.clients.saveContact, { companyId: s.companyId, customerId, name: "Sam (site)", phone: SITE, roles: ["site"], propertyIds: [] });
  return { customerId, contactId: contactId as Id<"clientContacts"> };
}

const text = (s: S, customerId: Id<"customers">, body: string, extra: Record<string, unknown> = {}) =>
  s.as.mutation(api.clientConversations.send, { companyId: s.companyId, customerId, contactId: null, channel: "sms", to: DANA, body, ...extra });

const thread = (s: S, customerId: Id<"customers">, as = s.as) => as.query(api.clientConversations.thread, { companyId: s.companyId, customerId });

describe("Client conversations", () => {
  let undo = () => {};
  beforeEach(() => {
    undo = dispatchTestEnv();
    vi.setSystemTime(MORNING);
  });
  afterEach(() => undo());

  it("sends to the client's own number through the sending policy, and refuses a contact with no permission of their own", async () => {
    const s = await setup(["Lena"]);
    const { customerId, contactId } = await client(s);
    const composer = await s.as.query(api.clientConversations.composer, { companyId: s.companyId, customerId });
    expect(composer.recipients[0]).toMatchObject({ contactId: null, sms: { address: DANA, ok: true } });
    const site = composer.recipients.find((r) => r.contactId === contactId)!;
    expect(site.sms.ok).toBe(false);
    expect(site.sms.words).toContain("this contact has none of their own yet");

    const sent = await text(s, customerId, "Hi Dana, Lena is on her way.");
    expect(sent.status).toBe("queued");
    await flush(s.t);
    expect(mockOutbox.filter((m) => m.to === DANA).map((m) => m.body)).toEqual(["Hi Dana, Lena is on her way."]);
    const items = (await thread(s, customerId)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "out", toName: "Dana Whitfield", channel: "sms", by: "owner-a", draftedBy: "person" });

    expect(await refusal(s.as.mutation(api.clientConversations.send, { companyId: s.companyId, customerId, contactId, channel: "sms", to: SITE, body: "Hello" }))).toContain("Not sent");
    // The address shown is the address used: a change in between stops the send.
    expect(await refusal(s.as.mutation(api.clientConversations.send, { companyId: s.companyId, customerId, contactId: null, channel: "sms", to: "+15125550000", body: "Hello" }))).toContain("address changed");
  });

  it("holds a message for quiet hours instead of sending it at night, and refuses once the client texts STOP", async () => {
    vi.setSystemTime(NOW); // 06:00 in Chicago. The test clock only moves forward.
    const s = await setup(["Lena"]);
    const { customerId } = await client(s);
    await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, quietHours: { start: "21:00", end: "08:00", appliesToOperational: true } });
    const held = await text(s, customerId, "Running early today?");
    expect(held.status).toBe("held");
    expect(held.words).toContain("quiet hours");

    vi.setSystemTime(MORNING);
    await s.t.mutation(internal.inbound.sms, { to: s.smsNumber, from: DANA, body: "STOP", receivedAt: Date.now() });
    expect(await refusal(text(s, customerId, "Are you there?"))).toContain("replied STOP");
    const items = (await thread(s, customerId)).items;
    expect(items.filter((i) => i.type === "in").map((i) => (i.type === "in" ? i.kind : null))).toEqual(["opt_out"]);
  });

  it("stops a scheduled follow-up when the client replies first, and files the reply in the thread", async () => {
    const s = await setup(["Lena"]);
    const { customerId } = await client(s);
    await text(s, customerId, "Checking in: how was the clean?", { sendAt: MORNING + 2 * HOUR });
    expect((await thread(s, customerId)).scheduled).toHaveLength(1);

    vi.setSystemTime(MORNING + HOUR);
    await s.t.mutation(internal.inbound.sms, { to: s.smsNumber, from: DANA, body: "All good, thanks! See https://example.com/photo", receivedAt: Date.now() });
    const after = await thread(s, customerId);
    expect(after.scheduled).toHaveLength(0);
    const out = after.items.find((i) => i.type === "out")!;
    expect(out).toMatchObject({ status: "not_sent", problem: "The client replied before it was due, so it was not sent." });
    const reply = after.items.find((i) => i.type === "in")!;
    // Kept as an excerpt, links taken out, as for every inbound text; and a person has a task to read it.
    expect(reply).toMatchObject({ kind: "message", fromName: "Dana Whitfield", body: "All good, thanks! See [link]" });
    expect(reply.type === "in" && reply.taskId).toBeTruthy();

    vi.setSystemTime(MORNING + 3 * HOUR);
    await flush(s.t);
    expect(mockOutbox.filter((m) => m.to === DANA && m.body.includes("Checking in"))).toHaveLength(0);
  });

  it("files a text from a contact's number under the client, and stops follow-ups on it too", async () => {
    const s = await setup(["Lena"]);
    const { customerId } = await client(s);
    await text(s, customerId, "Is Friday still good?", { sendAt: MORNING + 2 * HOUR });
    await s.t.mutation(internal.inbound.sms, { to: s.smsNumber, from: SITE, body: "Gate code changed, call me", receivedAt: Date.now() });
    const after = await thread(s, customerId);
    expect(after.items.find((i) => i.type === "in")).toMatchObject({ fromName: "Sam (site)" });
    expect(after.scheduled).toHaveLength(0);
    const tasks = await s.t.run(async (ctx) => (await ctx.db.query("tasks").collect()).filter((t) => t.about?.id === customerId).map((t) => t.title));
    expect(tasks).toContain("Text from Sam (site) at Dana Whitfield");
  });

  it("a takeover stops the agents' follow-ups and their drafts, keeps the person's own, and can be handed back", async () => {
    const s = await setup(["Lena"]);
    const { customerId } = await client(s);
    await text(s, customerId, "Agent drafted: book your next deep clean?", { sendAt: MORNING + 2 * HOUR, fromAgentDraft: true });
    await text(s, customerId, "Reminder: Friday 9am.", { sendAt: MORNING + 3 * HOUR });
    expect(await s.as.mutation(api.clientConversations.takeOver, { companyId: s.companyId, customerId })).toEqual({ stopped: 1 });
    const held = await thread(s, customerId);
    expect(held.held).toMatchObject({ by: "owner-a", mine: true });
    expect(held.scheduled.map((m) => m.body)).toEqual(["Reminder: Friday 9am."]);
    expect(await refusal(text(s, customerId, "Another agent draft", { fromAgentDraft: true }))).toContain("taken over");

    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    expect(await refusal(office.mutation(api.clientConversations.resume, { companyId: s.companyId, customerId }))).toContain("Only the person who took over");
    await s.as.mutation(api.clientConversations.resume, { companyId: s.companyId, customerId });
    expect((await thread(s, customerId)).held).toBeNull();
  });

  it("keeps internal notes apart from messages, and billing messages to the Owner", async () => {
    const s = await setup(["Lena"]);
    const { customerId } = await client(s);
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    await office.mutation(api.clientConversations.addNote, { companyId: s.companyId, customerId, body: "Prefers texts after 5pm." });
    await s.t.run(async (ctx) =>
      ctx.db.insert("messages", { companyId: s.companyId, purpose: "payment_reminder", channel: "email", customerId, to: "dana@example.com", body: "You owe $240.00", dedupeKey: "inv-1", status: "sent", attempts: 1, queuedAt: Date.now() }),
    );
    const asOffice = await thread(s, customerId, office);
    expect(asOffice.items.map((i) => i.type)).toEqual(["note"]);
    expect(asOffice.hiddenBilling).toBe(1);
    const asOwner = await thread(s, customerId);
    expect(asOwner.items.map((i) => i.type).sort()).toEqual(["note", "out"]);
    expect(asOwner.hiddenBilling).toBe(0);
    // A note is never a message.
    expect(await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.body.includes("5pm")).length)).toBe(0);
  });
});
