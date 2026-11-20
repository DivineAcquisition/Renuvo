import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { autumnConfig } from "./lib/billing/autumn";
import { emailProvider } from "./lib/email/provider";
import { environment, NOT_SENT_ON_TEST, PRODUCTION_DEPLOYMENTS, testRecipientAllowed } from "./lib/environment";
import { stripeConfig } from "./lib/finance/stripe";
import { orderNumber, searchNumbers } from "./lib/messaging/telnyxAccount";
import { telnyxProvider } from "./lib/messaging/telnyx";
import { recipientOf, sendFromGmail } from "./lib/recruiter/gmail";
import { company, readyMessaging, refusal, start, staffWith } from "../tests/harness";

const TEST_BACKEND = "https://happy-otter-123.convex.cloud";
const LIVE_BACKEND = `https://${PRODUCTION_DEPLOYMENTS[0]}.convex.cloud`;
const SAVED = ["CONVEX_CLOUD_URL", "TEST_RECIPIENTS", "EMAIL_PROVIDER", "RESEND_API_KEY", "EMAIL_FROM", "TELNYX_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "AUTUMN_SECRET_KEY", "STAFF_BOOTSTRAP_EMAIL"];
const raw = (to: string) => btoa(`To: Customer <${to}>\r\nSubject: Hi\r\n\r\nHello`).replace(/\+/g, "-").replace(/\//g, "_");

describe("Which backend this is, and what a backend that is not production may do", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const name of SAVED) saved[name] = process.env[name];
  });
  afterEach(() => {
    for (const name of SAVED) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
    vi.restoreAllMocks();
  });

  test("production is the live deployment by name; every other deployment is not; the test harness is unknown", () => {
    expect(environment({})).toBe("unknown");
    expect(environment({ CONVEX_CLOUD_URL: LIVE_BACKEND })).toBe("production");
    expect(environment({ CONVEX_CLOUD_URL: TEST_BACKEND })).toBe("non_production");
    expect(environment({ CONVEX_CLOUD_URL: "https://restored-copy-9.convex.cloud" })).toBe("non_production");
  });

  test("the build script names the same live deployment", () => {
    const script = readFileSync(path.join(process.cwd(), "scripts/build.mjs"), "utf8");
    const listed = /const PRODUCTION_DEPLOYMENTS = (\[[^\]]*\])/.exec(script)?.[1];
    expect(JSON.parse(listed!.replace(/'/g, '"'))).toEqual([...PRODUCTION_DEPLOYMENTS]);
  });

  test("a preview built against the live backend is built with no backend; against the test backend it keeps it", () => {
    const bin = mkdtempSync(path.join(tmpdir(), "fake-npx-"));
    writeFileSync(path.join(bin, "npx"), '#!/bin/sh\necho "BACKEND=[${NEXT_PUBLIC_CONVEX_URL}]"\n');
    chmodSync(path.join(bin, "npx"), 0o755);
    const build = (url: string) =>
      execFileSync(process.execPath, [path.join(process.cwd(), "scripts/build.mjs")], { env: { PATH: `${bin}:${process.env.PATH}`, VERCEL_ENV: "preview", NEXT_PUBLIC_CONVEX_URL: url } as unknown as NodeJS.ProcessEnv, encoding: "utf8" });
    const live = build(LIVE_BACKEND);
    expect(live).toContain("left out");
    expect(live).toContain("BACKEND=[]");
    expect(build(TEST_BACKEND)).toContain(`BACKEND=[${TEST_BACKEND}]`);
  });

  test("email from a test backend reaches only its test recipients", async () => {
    process.env.CONVEX_CLOUD_URL = TEST_BACKEND;
    process.env.TEST_RECIPIENTS = "qa@selestial.example, +1 512 555 0100";
    Object.assign(process.env, { EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_test", EMAIL_FROM: "Selestial <hello@selestial.io>" });
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const provider = emailProvider()!;
    const blocked = await provider.send({ to: "real.customer@gmail.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "k1" });
    expect(blocked).toEqual({ ok: false, retryable: false, problem: NOT_SENT_ON_TEST });
    expect(fetched).not.toHaveBeenCalled();
    expect((await provider.send({ to: "QA@selestial.example", subject: "Hi", html: "<p>Hi</p>", text: "Hi", idempotencyKey: "k2" })).ok).toBe(true);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(testRecipientAllowed("(512) 555-0100")).toBe(true);
    expect(testRecipientAllowed("+15125550199")).toBe(false);
  });

  test("texts and Gmail sends from a test backend never reach a real person; on the live backend they go", async () => {
    process.env.CONVEX_CLOUD_URL = TEST_BACKEND;
    process.env.TELNYX_API_KEY = "KEY_TEST";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { id: "m1" } }), { status: 200 }));
    const text = await telnyxProvider(fetcher as unknown as typeof fetch).send({ to: "+15125550199", from: "+15125550100", body: "Hi", idempotencyKey: "k", attempt: 1 });
    expect(text).toEqual({ ok: false, retryable: false, problem: NOT_SENT_ON_TEST });
    expect(recipientOf(raw("someone@gmail.com"))).toBe("someone@gmail.com");
    expect(await sendFromGmail({ token: "t", raw: raw("someone@gmail.com"), fetch: fetcher as unknown as typeof fetch })).toEqual({ ok: false, retryable: false, problem: NOT_SENT_ON_TEST });
    expect(fetcher).not.toHaveBeenCalled();
    process.env.CONVEX_CLOUD_URL = LIVE_BACKEND;
    await telnyxProvider(fetcher as unknown as typeof fetch).send({ to: "+15125550199", from: "+15125550100", body: "Hi", idempotencyKey: "k", attempt: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("a test backend may look numbers up at Telnyx but never buys one", async () => {
    process.env.CONVEX_CLOUD_URL = TEST_BACKEND;
    process.env.TELNYX_API_KEY = "KEY_TEST";
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const order = await orderNumber(fetcher as unknown as typeof fetch, { phoneNumber: "+15125550100", messagingProfileId: null, reference: "r1" });
    expect(order).toMatchObject({ ok: false, retryable: false });
    expect(fetcher).not.toHaveBeenCalled();
    await searchNumbers(fetcher as unknown as typeof fetch, { areaCode: "512", limit: 5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("a test backend ignores live Stripe and Autumn keys, so it can never charge a real card", () => {
    process.env.CONVEX_CLOUD_URL = TEST_BACKEND;
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_live_example";
    process.env.AUTUMN_SECRET_KEY = "am_sk_live_example";
    expect(stripeConfig()).toBeNull();
    expect(autumnConfig()).toBeNull();
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_example";
    process.env.AUTUMN_SECRET_KEY = "am_sk_test_example";
    expect(stripeConfig()).toMatchObject({ livemode: false });
    expect(autumnConfig()).toMatchObject({ env: "sandbox" });
    process.env.CONVEX_CLOUD_URL = LIVE_BACKEND;
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    expect(stripeConfig()).toMatchObject({ livemode: true });
  });
});

describe("Staff controls need their capability", () => {
  const STAFF = { subject: "user_ops", email: "ops@selestial.example", emailVerified: true, name: "Ops" };
  afterEach(() => {
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  test("emergency suspension needs outbound.suspend and a reason; a reviewer cannot", async () => {
    const t = start();
    const { companyId } = await company(t, "owner_a", "Alpha");
    const reviewer = { subject: "user_rev", email: "rev@selestial.example", emailVerified: true, name: "Rev" };
    await t.run((ctx) => ctx.db.insert("staff", { userId: reviewer.subject, email: reviewer.email, name: "Rev", role: "reviewer", status: "active", addedAt: 0, addedBy: "console" }));
    expect(await refusal(t.withIdentity(reviewer).mutation(api.compliance.setSuspended, { companyId, suspended: true, note: "Carrier complaint under review" }))).toBe("Not allowed.");
    await staffWith(t, STAFF, []);
    // Admins hold outbound.suspend by their role.
    expect(await refusal(t.withIdentity(STAFF).mutation(api.compliance.setSuspended, { companyId, suspended: true, note: "spam" }))).toContain("Say why");
    await t.withIdentity(STAFF).mutation(api.compliance.setSuspended, { companyId, suspended: true, note: "Carrier complaint under review" });
    expect((await t.run((ctx) => ctx.db.get(companyId)))!.suspendedAt).toBeDefined();
  });

  test("a paused agent's planned message is refused when it would go, and resuming does not release it", async () => {
    const t = start();
    const { companyId, as: owner } = await company(t, "owner_a", "Alpha");
    await readyMessaging(t, companyId);
    const messageId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("messages", { companyId, purpose: "sales_follow_up", body: "Still interested?", to: "+15125550123", dedupeKey: "f1", status: "queued", attempts: 0, queuedAt: Date.now() });
      await ctx.db.insert("sendIntents", { companyId, messageId: id, channel: "sms", address: "+15125550123", category: "operational", origin: "follow_up", agent: "sales", at: Date.now() });
      return id;
    });
    await owner.mutation(api.companies.setPausedAgents, { companyId, agents: ["sales"] });
    expect(await t.mutation(internal.messaging.claim, { messageId })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(messageId))).toMatchObject({ status: "not_sent", refusal: "agent_paused" });
    await owner.mutation(api.companies.setPausedAgents, { companyId, agents: [] });
    expect(await t.mutation(internal.messaging.claim, { messageId })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(messageId)))!.status).toBe("not_sent");
  });
});

describe("Restoring without replaying anything", () => {
  test("lock-down suspends sending and pauses every agent, remembering each company's settings, and release puts them back", async () => {
    const t = start();
    const a = await company(t, "owner_a", "Alpha");
    const b = await company(t, "owner_b", "Bravo");
    await a.as.mutation(api.companies.setPausedAgents, { companyId: a.companyId, agents: ["recruiter"] });
    await t.run((ctx) => ctx.db.insert("messages", { companyId: b.companyId, purpose: "reminder", body: "x", to: "+15125550123", dedupeKey: "s1", status: "sending", attempts: 1, queuedAt: Date.now(), attemptedAt: Date.now() }));
    const locked = await t.mutation(internal.restoration.lockDown, { reason: "Restored from the 03:00 backup" });
    expect(locked).toMatchObject({ locked: 2, done: true });
    // Running it again changes nothing.
    expect(await t.mutation(internal.restoration.lockDown, { reason: "again" })).toMatchObject({ lockdownId: locked.lockdownId, locked: 0 });
    for (const id of [a.companyId, b.companyId]) {
      const row = (await t.run((ctx) => ctx.db.get(id)))!;
      expect(row.suspendedAt).toBeDefined();
      expect([...row.pausedAgents].sort()).toEqual(["dispatch", "recruiter", "retention", "sales"]);
    }
    const status = await t.query(internal.restoration.status, {});
    expect(status.lockdown).toMatchObject({ lockedCompanies: 2 });
    expect(status.toReconcile.messages.sending).toBe(1);
    const verified = await t.action(internal.restoration.verify, {});
    expect(verified.problems).toEqual([]);
    expect(verified.companies).toBe(2);

    await expect(t.mutation(internal.restoration.release, { lockdownId: locked.lockdownId, note: "ok" })).rejects.toThrow(/reconciled/);
    await t.mutation(internal.restoration.release, { lockdownId: locked.lockdownId, note: "Reconciled the outbox with Telnyx and Resend, charges with Autumn" });
    const alpha = (await t.run((ctx) => ctx.db.get(a.companyId)))!;
    expect(alpha.suspendedAt).toBeUndefined();
    expect(alpha.pausedAgents).toEqual(["recruiter"]);
    expect((await t.run((ctx) => ctx.db.get(b.companyId)))!.pausedAgents).toEqual([]);
  });
});
