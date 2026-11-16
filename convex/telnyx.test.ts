/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTestEnv, flush, PHONES, setup } from "../tests/dispatchHarness";
import { dispatchJob } from "../tests/harness";
import { api } from "./_generated/api";
import { telnyxEvent, telnyxProvider, verifyTelnyx } from "./lib/messaging/telnyx";

const b64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

async function signer() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = b64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (timestamp: string, body: string) => b64(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(`${timestamp}|${body}`)));
  return { publicKey, sign };
}

const finalized = (id: string, messageId: string, status: string, code?: string) =>
  JSON.stringify({ data: { id, event_type: "message.finalized", record_type: "event", occurred_at: new Date().toISOString(), payload: { id: messageId, to: [{ phone_number: "+15550101010", status }], errors: code ? [{ code, title: "x" }] : [] } }, meta: { attempt: 1 } });
const received = (id: string, from: string, to: string, text: string) =>
  JSON.stringify({ data: { id, event_type: "message.received", record_type: "event", occurred_at: new Date().toISOString(), payload: { id: `in-${id}`, from: { phone_number: from }, to: [{ phone_number: to, status: "webhook_delivered" }], text } }, meta: { attempt: 1 } });

describe("Telnyx: sending", () => {
  afterEach(() => {
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_WEBHOOK_URL;
  });

  it("sends from the company's number with an idempotency key, and reads the message id", async () => {
    process.env.TELNYX_API_KEY = "KEY_test";
    process.env.TELNYX_WEBHOOK_URL = "https://happy-otter-123.convex.site/";
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = telnyxProvider(async (url, init) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ data: { id: "tx-1", to: [{ phone_number: "+15550101010", status: "queued" }] } }), { status: 200 });
    });
    expect(await provider.send({ to: "+15550101010", from: "+15125551000", body: "Hello", idempotencyKey: "msg123", attempt: 1 })).toEqual({ ok: true, providerMessageId: "tx-1", delivered: false });
    expect(calls[0].url).toBe("https://api.telnyx.com/v2/messages");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer KEY_test");
    expect(headers["idempotency-key"]).toBe("selestial-msg123");
    // Delivery reports for this text come to this deployment, whatever the number's profile points at.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ from: "+15125551000", to: "+15550101010", text: "Hello", type: "SMS", webhook_url: "https://happy-otter-123.convex.site/webhooks/telnyx" });
  });

  it("says why a text did not go, and retries only what may work later", async () => {
    process.env.TELNYX_API_KEY = "KEY_test";
    const answer = (status: number, code?: string) => telnyxProvider(async () => new Response(JSON.stringify(code ? { errors: [{ code, title: "t" }] } : {}), { status }));
    const send = (provider: ReturnType<typeof telnyxProvider>) => provider.send({ to: "+15550101010", from: "+15125551000", body: "x", idempotencyKey: "m", attempt: 1 });
    expect(await send(answer(403, "40300"))).toMatchObject({ ok: false, retryable: false, problem: expect.stringContaining("opted out with STOP") });
    expect(await send(answer(400, "40310"))).toMatchObject({ ok: false, retryable: false, problem: "The phone number on file is not valid." });
    expect(await send(answer(400, "49999"))).toMatchObject({ ok: false, retryable: false, problem: "Telnyx would not send this text (code 49999)." });
    expect(await send(answer(429))).toMatchObject({ ok: false, retryable: true });
    expect(await send(answer(503))).toMatchObject({ ok: false, retryable: true });
    expect(await send(answer(401))).toMatchObject({ ok: false, retryable: false, problem: "Texting isn’t available right now." });
    expect(await telnyxProvider(async () => new Response("{}")).send({ to: "+15550101010", body: "x", idempotencyKey: "m", attempt: 1 })).toMatchObject({ ok: false, problem: "The company has no texting number to send from." });
    delete process.env.TELNYX_API_KEY;
    expect(await send(answer(200))).toMatchObject({ ok: false, problem: expect.stringContaining("API key is not set") });
  });
});

describe("Telnyx: webhooks", () => {
  it("accepts only a recent, correctly signed body", async () => {
    const { publicKey, sign } = await signer();
    const other = await signer();
    const now = Date.now();
    const ts = String(Math.floor(now / 1000));
    const body = finalized("ev-1", "tx-1", "delivered");
    const signature = await sign(ts, body);
    expect(await verifyTelnyx({ publicKey, signature, timestamp: ts, body, now })).toBe(true);
    expect(await verifyTelnyx({ publicKey, signature, timestamp: ts, body: body.replace("delivered", "delivery_failed"), now })).toBe(false);
    expect(await verifyTelnyx({ publicKey: other.publicKey, signature, timestamp: ts, body, now })).toBe(false);
    expect(await verifyTelnyx({ publicKey, signature, timestamp: ts, body, now: now + 6 * 60_000 })).toBe(false);
    expect(await verifyTelnyx({ publicKey, signature: null, timestamp: ts, body, now })).toBe(false);
    expect(await verifyTelnyx({ publicKey: "not base64!", signature, timestamp: ts, body, now })).toBe(false);
  });

  it("reads delivery reports and incoming texts, and ignores the rest", () => {
    expect(telnyxEvent(finalized("e1", "tx-1", "delivered"))).toMatchObject({ kind: "receipt", outcome: "delivered", providerMessageId: "tx-1" });
    expect(telnyxEvent(finalized("e2", "tx-1", "delivery_failed", "40001"))).toMatchObject({ kind: "receipt", outcome: "failed", problem: expect.stringContaining("landline") });
    expect(telnyxEvent(finalized("e3", "tx-1", "delivery_unconfirmed"))).toEqual({ kind: "ignored" });
    expect(telnyxEvent(received("e4", "+15550101010", "+15125551000", "STOP"))).toMatchObject({ kind: "inbound", from: "+15550101010", to: "+15125551000", text: "STOP" });
    expect(telnyxEvent("not json")).toEqual({ kind: "ignored" });
    expect(telnyxEvent(JSON.stringify({ data: { id: "e5", event_type: "message.sent", payload: {} } }))).toEqual({ kind: "ignored" });
  });
});

describe("Telnyx: end to end through the webhook route", () => {
  let undo = () => {};
  let publicKey = "";
  let sign: (timestamp: string, body: string) => Promise<string> = async () => "";
  beforeEach(async () => {
    undo = dispatchTestEnv();
    const keys = await signer();
    publicKey = keys.publicKey;
    sign = keys.sign;
    process.env.MESSAGING_PROVIDER = "telnyx";
    process.env.TELNYX_API_KEY = "KEY_test";
    process.env.TELNYX_PUBLIC_KEY = publicKey;
    let next = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      next += 1;
      const sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: { id: `tx-${next}`, to: [{ phone_number: sent.to, status: "queued" }] } }), { status: 200 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_PUBLIC_KEY;
    undo();
  });

  it("sends the offer through Telnyx, records delivery once, and turns a cleaner's reply into a task for a person", async () => {
    const s = await setup();
    await s.autonomous();
    const post = async (body: string, signed = true) => {
      const ts = String(Math.floor(Date.now() / 1000));
      return s.t.fetch("/webhooks/telnyx", { method: "POST", headers: signed ? { "telnyx-signature-ed25519": await sign(ts, body), "telnyx-timestamp": ts } : {}, body });
    };
    const jobId = await dispatchJob(s.as, s.companyId, s.place, {});
    await flush(s.t);
    const offerText = async () => (await s.record(jobId)).messages.find((row) => row.purpose === "offer")!;
    expect(await offerText()).toMatchObject({ status: "sent" });
    const providerId = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).find((row) => row.purpose === "offer")!.providerMessageId!);
    expect(providerId).toMatch(/^tx-/);

    // An unsigned report is refused and changes nothing.
    expect((await post(finalized("ev-1", providerId, "delivered"), false)).status).toBe(401);
    expect(await offerText()).toMatchObject({ status: "sent" });
    // Signed: delivered, once. The same event again changes nothing.
    expect((await post(finalized("ev-1", providerId, "delivered"))).status).toBe(200);
    expect(await offerText()).toMatchObject({ status: "delivered" });
    expect((await post(finalized("ev-1", providerId, "delivered"))).status).toBe(200);
    const deliveredEvents = (await s.as.query(api.events.recent, { companyId: s.companyId, limit: 400 })).filter((event) => event.type === "message.delivered");
    expect(deliveredEvents).toHaveLength(1);

    // A plain reply from a cleaner is a task for a person. It is not an answer to the offer.
    expect((await post(received("ev-2", PHONES.Lena, s.smsNumber, "running 20 min late sorry"))).status).toBe(200);
    expect((await post(received("ev-2", PHONES.Lena, s.smsNumber, "running 20 min late sorry"))).status).toBe(200);
    const tasks = (await s.tasks("needs_decision")).filter((task) => task.title === "Text from Lena");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].openQuestion).toContain('Lena texted the company\'s number: "running 20 min late sorry"');
    expect((await s.job(jobId)).assignments.every((row) => row.status === "offered")).toBe(true);
    // A second text updates the same task.
    await post(received("ev-3", PHONES.Lena, s.smsNumber, "ok can do it"));
    const again = (await s.tasks("needs_decision")).filter((task) => task.title === "Text from Lena");
    expect(again).toHaveLength(1);
    expect(again[0].openQuestion).toContain('"ok can do it"');

    // STOP from the same number stops texts to it.
    await post(received("ev-4", PHONES.Lena, s.smsNumber, "STOP"));
    const suppressed = await s.t.run(async (ctx) => (await ctx.db.query("suppressions").collect()).filter((row) => row.address === PHONES.Lena && row.liftedAt === undefined));
    expect(suppressed).toHaveLength(1);
    // A text to a number no company owns is ignored.
    expect((await post(received("ev-5", PHONES.Rosa, "+19995550000", "hello"))).status).toBe(200);
  });
});
