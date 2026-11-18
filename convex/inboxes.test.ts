/**
 * @vitest-environment edge-runtime
 *
 * Connected inboxes shared by every agent (convex/inboxes.ts, convex/lib/inbox): connecting with
 * purposes, routing each message one way only, waiting (not switching) when the inbox breaks, threading
 * replies, disconnecting and Google's grant, and the hardening around Gmail. Every Google call goes to a
 * fake; nothing reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeGoogle } from "../tests/fakeGoogle";
import { refusal } from "../tests/harness";
import { flush, HOUR, indeedApplication, MONDAY_10AM, recruiterTestEnv, setup, type Setup } from "../tests/recruiterHarness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { forgetGoogleKeys, googleKeys } from "./lib/google/pubsub";
import { mockEmails } from "./lib/messaging/email";
import { rateLimited, rawMessage, sendFromGmail } from "./lib/recruiter/gmail";
import { MailboxProviderError } from "./lib/recruiter/mailbox";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
const ENV = { GOOGLE_CLIENT_ID: "client-id.apps.test", GOOGLE_CLIENT_SECRET: "client-secret-not-real", MAILBOX_TOKEN_KEY: KEY, CONVEX_SITE_URL: "https://deployment.convex.site.test", APP_ORIGIN: "https://app.selestial.test" };
const MARIA = "maria.lopez@example.test";

let undo = () => {};
let google: ReturnType<typeof fakeGoogle>;
beforeEach(() => {
  undo = recruiterTestEnv();
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  google = fakeGoogle();
  vi.stubGlobal("fetch", google.fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  undo();
});

type Purpose = "sales" | "hiring" | "care" | "operations";

/** Connects the fake Gmail through Connected apps, with purposes. */
async function connectShared(s: Setup, purposes: Purpose[], canSend = true) {
  google.state.codes.add("good-code");
  const { url } = await s.as.mutation(api.inboxes.startConnect, { companyId: s.companyId, purposes, historyDays: 0, canSend });
  const state = new URL(url).searchParams.get("state")!;
  const response = await s.t.fetch(`/oauth/google/callback?state=${encodeURIComponent(state)}&code=good-code`, { method: "GET" });
  await flush(s.t);
  const connectionId = (await s.t.run(async (ctx) => (await ctx.db.query("mailboxConnections").collect()).find((row) => row.provider === "gmail")!._id)) as Id<"mailboxConnections">;
  return { url, response, connectionId };
}

const invitation = (s: Setup) => s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.purpose === "application_invitation"));
const notices = (s: Setup) => s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).filter((m) => m.purpose === "member_notice"));

describe("connecting an inbox with purposes", () => {
  it("only the Owner starts it; Google is asked for read, and send only when allowed; never modify or compose", async () => {
    const s = await setup();
    const manager = await s.manager();
    expect(await refusal(manager.mutation(api.inboxes.startConnect, { companyId: s.companyId, purposes: ["sales"], historyDays: 0, canSend: true }))).toBe("Not allowed.");
    expect(await refusal(s.as.mutation(api.inboxes.startConnect, { companyId: s.companyId, purposes: [], historyDays: 0, canSend: true }))).toContain("Choose at least one");
    expect(await refusal(s.as.mutation(api.inboxes.startConnect, { companyId: s.companyId, purposes: ["sales"], historyDays: 365, canSend: true }))).toContain("how far back");
    const readOnly = new URL((await s.as.mutation(api.inboxes.startConnect, { companyId: s.companyId, purposes: ["hiring"], historyDays: 7, canSend: false })).url);
    expect(readOnly.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly openid email");
    const sending = new URL((await s.as.mutation(api.inboxes.startConnect, { companyId: s.companyId, purposes: ["sales"], historyDays: 0, canSend: true })).url);
    expect(sending.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send openid email");
    expect(sending.searchParams.get("scope")).not.toMatch(/modify|compose/);
  });

  it("comes back to Connected apps, keeps the purposes, tells the Owner, and lists the agents that use it", async () => {
    const s = await setup();
    const { response, connectionId } = await connectShared(s, ["sales", "care"]);
    expect(response.headers.get("Location")).toBe("https://app.selestial.test/app/settings/integrations?tool=gmail&result=connected");
    const listed = await s.as.query(api.inboxes.list, { companyId: s.companyId });
    const inbox = listed.inboxes.find((row) => row.id === connectionId)!;
    expect(inbox).toMatchObject({ status: "connected", state: "Connected", legacy: false, canSend: true, agents: ["sales", "retention"], findings: null });
    expect(inbox.purposes.map((p) => p.label)).toEqual(["Sales", "Care & Retention"]);
    // A security notice to the Owner: an inbox was connected.
    expect((await notices(s)).map((n) => n.notice?.facts?.kind)).toContain("inbox_connected");
  });

  it("Recruiter reads only an inbox connected for hiring, and applicant email follows the purposes", async () => {
    const s = await setup();
    google.add(indeedApplication({ id: "g1", receivedAt: Date.now() }));
    const { connectionId } = await connectShared(s, ["sales"]);
    expect(await s.t.action(internal.recruiterInbox.sync, { connectionId })).toBeNull();
    // Hiring isn't one of its purposes: Maria's invitation goes through Selestial's shared sender.
    await s.receive(indeedApplication());
    await s.approveAll();
    expect(google.state.sent).toEqual([]);
    expect((await invitation(s))[0]).toMatchObject({ provider: "mock-email", status: "delivered" });
  });
});

describe("one way only, and waiting rather than switching", () => {
  it("holds a message for a broken inbox, sends nothing anywhere, and sends it from the inbox once reconnected", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["hiring"]);
    await s.t.run((ctx) => ctx.db.patch(connectionId, { status: "expired", problem: "The mailbox's authorization has ended." }));
    await s.receive(indeedApplication());
    await s.approveAll();
    const [held] = await invitation(s);
    expect(held).toMatchObject({ status: "held", refusal: "inbox_disconnected" });
    expect(held.problem).toContain("waiting");
    expect(google.state.sent).toEqual([]);
    expect(mockEmails.filter((m) => m.to === MARIA)).toEqual([]);
    expect((await s.as.query(api.inboxes.list, { companyId: s.companyId })).waiting).toBe(1);
    // The integrations card says "Reconnect needed", not "ready to connect".
    const overview = await s.as.query(api.integrations.overview, { companyId: s.companyId });
    expect((overview.live as Record<string, { state: string; detail: string | null }>).gmail).toEqual({ state: "in_progress", detail: "Reconnect needed" });

    await connectShared(s, ["hiring"]);
    expect(google.state.sent).toHaveLength(1);
    expect(google.state.sent[0].decoded).toContain(`To: <${MARIA}>`);
    expect((await invitation(s))[0]).toMatchObject({ status: "sent", provider: "gmail" });
  });

  it("when Google withdraws access mid-send, the message waits (it never went) and the Owner is told to reconnect", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["hiring"]);
    google.state.refreshRevoked = true;
    await s.receive(indeedApplication());
    await s.approveAll();
    expect(google.state.sent).toEqual([]);
    expect((await invitation(s))[0]).toMatchObject({ status: "held", refusal: "inbox_disconnected" });
    expect(await s.t.run((ctx) => ctx.db.get(connectionId))).toMatchObject({ status: "expired" });
    const reconnect = (await notices(s)).filter((n) => n.notice?.event === "inbox_reconnect");
    expect(reconnect).toHaveLength(1);
    expect(reconnect[0].to).toBe("owner-a@example.com");
  });
});

describe("replying in the applicant's own thread", () => {
  it("joins the thread Maria started with In-Reply-To, References and a matching subject; a job board's thread is never joined", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["hiring"]);
    // The application comes from Indeed (a job board's thread), then Maria writes in herself.
    google.add(indeedApplication({ id: "board-1", threadId: "board-thread", receivedAt: Date.now() }));
    await s.t.action(internal.recruiterInbox.sync, { connectionId });
    await flush(s.t);
    google.add({ id: "maria-1", threadId: "thr-maria", receivedAt: Date.now() + 1000, from: `Maria Lopez <${MARIA}>`, subject: "Question about the House Cleaner job", text: "Hi, is the job still open?", attachments: [], messageIdHeader: "<maria-1@example.test>", references: "<earlier@example.test>" });
    await s.t.action(internal.recruiterInbox.sync, { connectionId });
    await flush(s.t);
    await s.approveAll();
    expect(google.state.sent).toHaveLength(1);
    const sent = google.state.sent[0];
    expect(sent.threadId).toBe("thr-maria");
    const headers = sent.decoded.split("\r\n\r\n")[0];
    expect(headers).toContain("In-Reply-To: <maria-1@example.test>");
    expect(headers).toContain("References: <earlier@example.test> <maria-1@example.test>");
    expect(headers).toContain("Subject: Re: Question about the House Cleaner job");
  });

  it("builds reply headers no value can break", () => {
    const raw = rawMessage({ from: "hiring@alpha.test", fromName: "Alpha", to: MARIA, subject: "Hi", text: "Body", messageId: "m1", inReplyTo: "<ok@example.test>\r\nBcc: x@example.test", references: "<a@b.c> not-an-id <d@e.f>" });
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const headers = decoded.split("\r\n\r\n")[0];
    expect(headers).not.toMatch(/^bcc:/im);
    expect(headers).not.toContain("In-Reply-To");
    expect(headers).toContain("References: <a@b.c> <d@e.f>");
  });
});

describe("Gmail's answers", () => {
  it("never sends again after a server error: the result is unknown, so it stays unconfirmed", async () => {
    const answer = (status: number, reason?: string) => async () => new Response(JSON.stringify(reason ? { error: { errors: [{ reason }] } } : {}), { status });
    await expect(sendFromGmail({ token: "t", raw: "r", fetch: answer(503) as typeof fetch })).rejects.toBeInstanceOf(MailboxProviderError);
    expect(await sendFromGmail({ token: "t", raw: "r", fetch: answer(429) as typeof fetch })).toMatchObject({ ok: false, retryable: true });
    // A 403 is a rate limit or a lost permission; only the second needs a reconnect.
    expect(await sendFromGmail({ token: "t", raw: "r", fetch: answer(403, "userRateLimitExceeded") as typeof fetch })).toMatchObject({ ok: false, retryable: true });
    expect(await sendFromGmail({ token: "t", raw: "r", fetch: answer(403, "insufficientPermissions") as typeof fetch })).toMatchObject({ ok: false, retryable: false, problem: expect.stringContaining("no longer lets Selestial send") });
    expect(await rateLimited(new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 403 }))).toBe(true);
  });

  it("an outbox send that hits a server error is left unconfirmed by the sweep and never resent", async () => {
    const s = await setup();
    await connectShared(s, ["hiring"]);
    google.state.sendStatus = 500;
    await s.receive(indeedApplication());
    await s.approveAll().catch(() => undefined);
    vi.advanceTimersByTime(6 * 60_000);
    await s.t.mutation(internal.messaging.sweepStuck, {});
    await flush(s.t);
    google.state.sendStatus = 200;
    await flush(s.t);
    expect((await invitation(s))[0]).toMatchObject({ status: "unconfirmed" });
    expect(google.state.sent).toEqual([]);
  });
});

describe("disconnecting", () => {
  it("stops at once, deletes the stored authorization, ends Google's grant, and sends waiting mail the shared way", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["hiring"]);
    await s.t.run((ctx) => ctx.db.patch(connectionId, { status: "expired" }));
    await s.receive(indeedApplication());
    await s.approveAll();
    expect((await invitation(s))[0].status).toBe("held");
    const manager = await s.manager();
    expect(await refusal(manager.mutation(api.inboxes.disconnect, { companyId: s.companyId, connectionId }))).toBe("Not allowed.");
    expect(await s.as.mutation(api.inboxes.disconnect, { companyId: s.companyId, connectionId })).toEqual({ grant: "revoking" });
    await flush(s.t);
    const after = await s.t.run(async (ctx) => ({ row: await ctx.db.get(connectionId), credentials: await ctx.db.query("mailboxCredentials").collect() }));
    expect(after.row).toMatchObject({ status: "disconnected", canSend: false, grant: "revoked" });
    expect(after.credentials).toEqual([]);
    expect(google.state.revoked).toEqual(["refresh-secret-token"]);
    // The waiting invitation went through Selestial's shared sender instead, once.
    expect(mockEmails.filter((m) => m.to === MARIA && m.result === "accepted")).toHaveLength(1);
    expect((await notices(s)).map((n) => n.notice?.facts?.kind)).toContain("inbox_disconnected");
  });

  it("keeps Google's grant when the company's Google connection uses the same account, and says so", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["sales"]);
    await s.t.run(async (ctx) => {
      const member = (await ctx.db.query("members").collect()).find((m) => m.companyId === s.companyId)!;
      await ctx.db.insert("googleConnections", { companyId: s.companyId, feature: "drive", googleSub: "sub-1", email: "hiring@alpha-cleaning.test", status: "connected", grantedScopes: [], connectedBy: member._id, connectedAt: Date.now() });
    });
    expect(await s.as.mutation(api.inboxes.disconnect, { companyId: s.companyId, connectionId })).toEqual({ grant: "kept_shared" });
    await flush(s.t);
    expect(google.state.revoked).toEqual([]);
    expect((await s.as.query(api.inboxes.list, { companyId: s.companyId })).inboxes.find((i) => i.id === connectionId)?.grant).toBe("kept_shared");
  });

  it("can't touch another company's inbox", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["sales"]);
    const other = await setup();
    expect(await refusal(other.as.mutation(api.inboxes.disconnect, { companyId: other.companyId, connectionId }))).toContain("isn't connected to this company");
    expect(await refusal(other.as.mutation(api.inboxes.update, { companyId: other.companyId, connectionId, purposes: ["hiring"] }))).toContain("isn't connected to this company");
    expect((await other.as.query(api.inboxes.list, { companyId: other.companyId })).inboxes.some((i) => i.id === connectionId)).toBe(false);
  });
});

describe("reading", () => {
  it("runs one read at a time per inbox", async () => {
    const s = await setup();
    const { connectionId } = await connectShared(s, ["hiring"]);
    expect(await s.t.mutation(internal.recruiterInbox.lease, { connectionId })).toBe(true);
    expect(await s.t.action(internal.recruiterInbox.sync, { connectionId })).toBeNull();
    await s.t.mutation(internal.recruiterInbox.release, { connectionId });
    expect(await s.t.action(internal.recruiterInbox.sync, { connectionId })).toMatchObject({ filed: expect.any(Number) });
  });

  it("finds the inbox a push names by its address", async () => {
    const s = await setup();
    await connectShared(s, ["hiring"]);
    expect(await s.t.mutation(internal.recruiterGmailWatch.notified, { emailAddress: "Hiring@Alpha-Cleaning.test" })).toBe(1);
    expect(await s.t.mutation(internal.recruiterGmailWatch.notified, { emailAddress: "someone@else.test" })).toBe(0);
  });

  it("keeps Google's signing keys between pushes, and fetches again for a key it hasn't seen", async () => {
    forgetGoogleKeys();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({ keys: [{ kid: "k1", n: "n", e: "AQAB", kty: "RSA" }] }), { status: 200, headers: { "cache-control": "public, max-age=3600" } });
    });
    await googleKeys("k1", MONDAY_10AM);
    await googleKeys("k1", MONDAY_10AM + 60_000);
    expect(calls).toHaveLength(1);
    await googleKeys("k2", MONDAY_10AM + 120_000);
    expect(calls).toHaveLength(2);
    await googleKeys("k1", MONDAY_10AM + 2 * HOUR);
    expect(calls).toHaveLength(3);
    forgetGoogleKeys();
  });
});
