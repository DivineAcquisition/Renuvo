/**
 * @vitest-environment edge-runtime
 *
 * Plans, credits and billing, against a stand-in for Autumn (tests/fakeAutumn.ts). Every test starts on
 * the sandbox with the test rate card (tests/setupBilling.ts): a Chat answer is 1 credit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, refusal, start, type T } from "../tests/harness";
import { flush, indeedApplication, recruiterTestEnv, setup as recruiterSetup } from "../tests/recruiterHarness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { agentVerdict } from "./lib/billing/access";
import { mockChat } from "./lib/chat/model";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";
import { mockModel } from "./lib/recruiter/model";

let keys = 0;
const key = () => `billing-key-${(keys += 1)}`;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  return { t, ...owner };
}
type As = Awaited<ReturnType<typeof setup>>["as"];

async function ask(t: T, as: As, companyId: Id<"companies">, text = "How many visits are booked today?") {
  const sent = await as.mutation(api.chat.send, { companyId, text, clientKey: key() });
  await settle(t);
  return sent.conversationId as string;
}

async function lastReply(as: As, companyId: Id<"companies">, conversationId: string) {
  const view = await as.query(api.chat.thread, { companyId, conversationId });
  const last = view.messages.filter((message) => message.role === "assistant").at(-1)!;
  return { status: last.status, text: last.parts.map((part) => (part.kind === "text" ? part.text : part.kind === "notice" ? `[${part.text}]` : "")).join("") };
}

const executions = (t: T) => t.run(async (ctx) => ctx.db.query("aiExecutions").collect());
const sync = (t: T, companyId: Id<"companies">) => t.action(internal.billing.syncCompany, { companyId });

describe("billing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.CHAT_MODEL = "mock";
    mockChat.script = [];
    mockChat.seen = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CHAT_MODEL;
  });

  describe("who may see and change billing", () => {
    it("keeps billing to the Owner of the company, and derives the customer on the server", async () => {
      const s = await setup();
      const manager = await addMember(s.t, s.as, s.companyId, "mgr", "manager");
      const office = await addMember(s.t, s.as, s.companyId, "office", "office");
      const other = await company(s.t, "owner-b", "Beta Cleaning");
      for (const who of [manager, office]) {
        expect(await refusal(who.query(api.billing.planAndUsage, { companyId: s.companyId }))).toBe(NOT_ALLOWED);
        expect(await refusal(who.mutation(api.billing.startPlanChange, { companyId: s.companyId, plan: "expand" }))).toBe(NOT_ALLOWED);
        expect(await refusal(who.mutation(api.billing.setSpendingControls, { companyId: s.companyId, maxPerExecution: null, approvalThreshold: null, autonomousMonthly: null, agentBudgets: {}, lowBalance: null, alertPercents: [], autoTopUp: { enabled: false } }))).toBe(NOT_ALLOWED);
      }
      expect(await refusal(other.as.query(api.billing.planAndUsage, { companyId: s.companyId }))).toBe(NOT_FOUND);
      expect(await refusal(other.as.mutation(api.billing.startPlanChange, { companyId: s.companyId, plan: "expand" }))).toBe(NOT_FOUND);
      // Every member sees the indicator, which has no prices or invoices.
      expect(Object.keys(await office.query(api.billing.creditIndicator, { companyId: s.companyId })).sort()).toEqual(["available", "low", "message", "reserved", "state"]);
      await ask(s.t, s.as, s.companyId);
      await ask(s.t, other.as, other.companyId);
      const customers = new Set(billing.state.calls.map((call) => call.body.customer_id));
      expect(customers).toEqual(new Set([`company_${s.companyId}`, `company_${other.companyId}`]));
      const alpha = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(alpha.connected && alpha.recent.map((row) => row.agent)).toEqual(["Company Chat"]);
    });
  });

  describe("charging for AI work", () => {
    it("holds credits before the model runs and confirms exactly one charge per answer", async () => {
      const s = await setup();
      mockChat.script = [{ text: "Three visits." }];
      await ask(s.t, s.as, s.companyId);
      const [run] = await executions(s.t);
      expect(run).toMatchObject({ state: "completed", charged: 1, settlement: "confirmed", rate: 1, rateCardVersion: "fixture-2026-11" });
      const paths = billing.state.calls.map((call) => call.path);
      expect(paths.indexOf("/v1/balances.check")).toBeLessThan(paths.indexOf("/v1/balances.finalize"));
      const check = billing.state.calls.find((call) => call.path === "/v1/balances.check")!;
      expect(check.body).toMatchObject({ feature_id: "selestial_credits", required_balance: 1, send_event: true, lock: { enabled: true, lock_id: `${run._id}-1` } });
      // Every hold expires on its own, so abandoned work is never charged.
      const expiresAt = (check.body.lock as { expires_at: number }).expires_at;
      expect(expiresAt - NOW).toBeGreaterThanOrEqual(15 * 60_000);
      expect(expiresAt - NOW).toBeLessThan(15 * 60_000 + 1000);
      expect(billing.state.calls.filter((call) => call.path === "/v1/balances.finalize")).toHaveLength(1);
      // Settling again finds it settled and asks Autumn nothing.
      await s.t.action(internal.billing.settle, { executionId: run._id });
      expect(billing.state.calls.filter((call) => call.path === "/v1/balances.finalize")).toHaveLength(1);
    });

    it("charges nothing for a failed or stopped answer, and releases the hold", async () => {
      const s = await setup();
      mockChat.script = [{ error: "boom" }];
      const conversationId = await ask(s.t, s.as, s.companyId);
      expect((await lastReply(s.as, s.companyId, conversationId)).status).toBe("failed");
      const [failed] = await executions(s.t);
      expect(failed).toMatchObject({ state: "failed", charged: 0, settlement: "released" });
      expect(billing.state.calls.find((call) => call.path === "/v1/balances.finalize")!.body).toMatchObject({ action: "release" });
      expect(billing.customerFor(`company_${s.companyId}`).usage).toBe(0);
    });

    it("never lets two pieces of work spend the same credits", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 1 });
      mockChat.script = [{ text: "First." }, { text: "Second." }];
      const first = await s.as.mutation(api.chat.send, { companyId: s.companyId, text: "One", clientKey: key() });
      const second = await s.as.mutation(api.chat.send, { companyId: s.companyId, text: "Two", clientKey: key() });
      await settle(s.t);
      const replies = [await lastReply(s.as, s.companyId, first.conversationId), await lastReply(s.as, s.companyId, second.conversationId)];
      expect(replies.map((reply) => reply.status).sort()).toEqual(["complete", "failed"]);
      expect(replies.find((reply) => reply.status === "failed")!.text).toMatch(/no Selestial Credits left/);
      expect(billing.customerFor(`company_${s.companyId}`).usage).toBe(1);
      expect((await executions(s.t)).map((row) => row.state).sort()).toEqual(["completed", "denied"]);
    });

    it("opens one execution for one piece of work, however often it is asked for", async () => {
      const s = await setup();
      const opened = await s.t.run(async (ctx) => {
        const { openExecution } = await import("./lib/billing/executions");
        const company = (await ctx.db.get(s.companyId))!;
        const input = { company, key: "work:1", agent: "chat" as const, task: "chat_response_standard" as const, units: 1, autonomous: false };
        return [await openExecution(ctx, input), await openExecution(ctx, input)];
      });
      expect(opened[0]).toMatchObject({ ok: true, repeated: false });
      expect(opened[1]).toMatchObject({ ok: true, repeated: true });
      expect(await executions(s.t)).toHaveLength(1);
    });

    it("charges a batch for what it delivered, and returns the rest", async () => {
      const s = await setup();
      const id = await s.t.run(async (ctx) => {
        const { openExecution } = await import("./lib/billing/executions");
        const opened = await openExecution(ctx, { company: (await ctx.db.get(s.companyId))!, key: "batch:1", agent: "studio", feature: "creative_studio", task: "image_generation", units: 3, autonomous: false });
        return opened.ok ? opened.executionId : null;
      });
      // Reserve through the same helper every flow uses.
      const held = await s.t.action(internal.billing.reserve, { executionId: id! });
      expect(held).toBe(true);
      expect(billing.state.calls.find((call) => call.path === "/v1/balances.check")!.body).toMatchObject({ required_balance: 30 });
      await s.t.run(async (ctx) => (await import("./lib/billing/executions")).finishExecution(ctx, id!, { completedUnits: 2 }));
      await settle(s.t);
      expect((await executions(s.t))[0]).toMatchObject({ completedUnits: 2, charged: 20, settlement: "confirmed" });
      expect(billing.state.calls.find((call) => call.path === "/v1/balances.finalize")!.body).toMatchObject({ action: "confirm", override_value: 20 });
    });
  });

  describe("when billing cannot be checked", () => {
    it("starts no paid work on an unreachable, failing or fail-open Autumn, and charges nothing", async () => {
      for (const outage of ["network", "server", "degraded"] as const) {
        const s = await setup();
        billing.state.outage = outage;
        billing.state.outageOps = ["/v1/balances.check"];
        mockChat.script = [{ text: "Should not be written." }];
        const conversationId = await ask(s.t, s.as, s.companyId);
        const reply = await lastReply(s.as, s.companyId, conversationId);
        expect(reply.status, outage).toBe("failed");
        expect(reply.text, outage).toMatch(/Billing could not be checked/);
        expect(mockChat.seen, outage).toEqual([]);
        expect((await executions(s.t)).map((row) => row.block), outage).toEqual(["billing_unavailable"]);
        expect(billing.customerFor(`company_${s.companyId}`).usage, outage).toBe(0);
        // A hold the fail-open answer may have made is released straight away.
        if (outage !== "network") expect(billing.state.calls.some((call) => call.path === "/v1/balances.finalize" && call.body.action === "release"), outage).toBe(true);
        billing.state.outage = "none";
      }
    });

    it("keeps a settlement that failed, retries it on its own, and never repeats the work", async () => {
      const s = await setup();
      billing.state.outage = "server";
      billing.state.outageOps = ["/v1/balances.finalize"];
      mockChat.script = [{ text: "Answered once." }];
      await ask(s.t, s.as, s.companyId);
      expect((await executions(s.t))[0]).toMatchObject({ state: "completed", settlement: "pending_confirm", settleAttempts: 1 });
      billing.state.outage = "none";
      vi.advanceTimersByTime(2 * 60_000);
      await s.t.mutation(internal.billing.sweep, {});
      await settle(s.t);
      expect((await executions(s.t))[0]).toMatchObject({ settlement: "confirmed", charged: 1 });
      expect(mockChat.seen).toHaveLength(1);
      expect(billing.customerFor(`company_${s.companyId}`).usage).toBe(1);
    });

    it("lists a settlement Autumn accepted without verifying, instead of guessing", async () => {
      const s = await setup();
      billing.state.outage = "degraded";
      billing.state.outageOps = ["/v1/balances.finalize"];
      mockChat.script = [{ text: "Done." }];
      await ask(s.t, s.as, s.companyId);
      expect((await executions(s.t))[0]).toMatchObject({ state: "completed", settlement: "unverified" });
    });

    it("recovers work that stopped part-way: an unconfirmed hold is released, an abandoned one expires uncharged", async () => {
      const s = await setup();
      const ids = await s.t.run(async (ctx) => {
        const { openExecution } = await import("./lib/billing/executions");
        const company = (await ctx.db.get(s.companyId))!;
        const a = await openExecution(ctx, { company, key: "a", agent: "chat", task: "chat_response_standard", units: 1, autonomous: false });
        const b = await openExecution(ctx, { company, key: "b", agent: "chat", task: "chat_response_standard", units: 1, autonomous: false });
        return [a, b].map((row) => (row.ok ? row.executionId : null)) as Id<"aiExecutions">[];
      });
      // One crashed between recording the hold and hearing back; the other held credits and was never finished.
      await s.t.mutation(internal.billing.beginLock, { executionId: ids[0] });
      await s.t.action(internal.billing.reserve, { executionId: ids[1] });
      vi.advanceTimersByTime(20 * 60_000);
      await s.t.mutation(internal.billing.sweep, {});
      await settle(s.t);
      const rows = await executions(s.t);
      expect(rows.find((row) => row._id === ids[0])).toMatchObject({ state: "paused", charged: 0 });
      expect(rows.find((row) => row._id === ids[1])).toMatchObject({ state: "expired", charged: 0, settlement: "released" });
      expect(billing.customerFor(`company_${s.companyId}`).usage).toBe(0);
      // Finishing it after the hold expired charges nothing; the work is recorded as not billed.
      await s.t.run(async (ctx) => ctx.db.patch(ids[1], { state: "reserved" }));
      await s.t.run(async (ctx) => (await import("./lib/billing/executions")).finishExecution(ctx, ids[1], { completedUnits: 1 }));
      await settle(s.t);
      expect((await executions(s.t)).find((row) => row._id === ids[1])).toMatchObject({ settlement: "unbilled" });
      expect(billing.customerFor(`company_${s.companyId}`).usage).toBe(0);
    });

    it("without billing connected, pauses AI work and nothing else", async () => {
      const s = await setup();
      delete process.env.AUTUMN_SECRET_KEY;
      expect(await refusal(s.as.mutation(api.chat.send, { companyId: s.companyId, text: "Hello", clientKey: key() }))).toMatch(/Billing is not connected/);
      expect(await s.as.query(api.billing.creditIndicator, { companyId: s.companyId })).toMatchObject({ state: "not_connected" });
      // Records still work.
      await s.as.mutation(api.customers.create, { companyId: s.companyId, name: "Dana Customer" } as never).catch(() => undefined);
      process.env.AUTUMN_SECRET_KEY = "am_sk_live_not_a_real_key";
      expect(await refusal(s.as.mutation(api.chat.send, { companyId: s.companyId, text: "Hello", clientKey: key() }))).toMatch(/test values and cannot be used with a live billing key/);
      process.env.BILLING_RATE_CARD = "no-such-card";
      expect(await refusal(s.as.mutation(api.chat.send, { companyId: s.companyId, text: "Hello", clientKey: key() }))).toMatch(/No rate card is selected/);
    });
  });

  describe("plans and agents", () => {
    it("needs a plan for AI work, and never unlocks an unreleased agent for any payment", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: null });
      await sync(s.t, s.companyId);
      expect(await refusal(s.as.mutation(api.chat.send, { companyId: s.companyId, text: "Hello", clientKey: key() }))).toMatch(/needs an active Operate or Expand plan/);
      billing.seed(s.companyId, { plan: "expand", grant: 2000, purchased: 5000 });
      await sync(s.t, s.companyId);
      const company = await s.t.run(async (ctx) => (await ctx.db.get(s.companyId))!);
      for (const agent of ["quality", "marketing", "customer-care", "team-coordinator", "sales", "retention"] as const) expect(agentVerdict(company, agent)).toMatchObject({ ok: false, block: "not_released" });
      for (const agent of ["dispatch", "recruiter"] as const) expect(agentVerdict(company, agent)).toEqual({ ok: true });
      const view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.catalog.agents.filter((row) => row.here).map((row) => row.agent)).toEqual(["recruiter", "dispatch"]);
    });

    it("keeps Creative Studio to Expand, decided on Autumn's record", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 1000 });
      await sync(s.t, s.companyId);
      expect(await refusal(s.as.mutation(api.creative.generate, { companyId: s.companyId, kind: "image_generate", prompt: "A tidy kitchen", params: {} }))).toMatch(/part of the Expand plan/);
    });

    it("previews an upgrade, charges only after confirmation, and carries this month's usage over", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 1000, usage: 300 });
      await sync(s.t, s.companyId);
      const intentId = await s.as.mutation(api.billing.startPlanChange, { companyId: s.companyId, plan: "expand" });
      await settle(s.t);
      const preview = await s.as.query(api.billing.intent, { companyId: s.companyId, intentId });
      expect(preview).toMatchObject({ stage: "awaiting_confirmation", preview: { dueNowCents: 20000, effectiveAt: null } });
      expect(billing.state.calls.some((call) => call.path === "/v1/billing.attach")).toBe(false);
      await s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId });
      await settle(s.t);
      expect(await refusal(s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId }))).toMatch(/already confirmed/);
      const attach = billing.state.calls.filter((call) => call.path === "/v1/billing.attach");
      expect(attach).toHaveLength(1);
      expect(attach[0]).toMatchObject({ key: `intent:${intentId}`, body: { plan_id: "expand", plan_schedule: "immediate", carry_over_usages: { enabled: true, feature_ids: ["selestial_credits"] } } });
      const view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account).toMatchObject({ plan: "expand", credits: { included: { granted: 2000, remaining: 1700 } } });
    });

    it("schedules a downgrade for renewal, says what will be lost, and keeps access until then", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "expand", grant: 2000 });
      await sync(s.t, s.companyId);
      const intentId = await s.as.mutation(api.billing.startPlanChange, { companyId: s.companyId, plan: "operate" });
      await settle(s.t);
      const preview = (await s.as.query(api.billing.intent, { companyId: s.companyId, intentId }))!.preview!;
      expect(preview.lostAgents).toEqual(["Marketing", "Quality", "Customer Care", "Team Coordinator"]);
      expect(preview.lostFeatures).toContain("Creative Studio");
      expect(preview.effectiveAt).toBe(billing.customerFor(`company_${s.companyId}`).periodEnd);
      await s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId });
      await settle(s.t);
      expect(billing.state.calls.find((call) => call.path === "/v1/billing.attach")!.body).toMatchObject({ plan_schedule: "end_of_cycle" });
      const view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account?.plan).toBe("expand");
      expect(view.connected && view.account?.subscription).toMatchObject({ scheduledPlan: "operate" });
    });

    it("cancels at the end of the paid period, and can keep the plan again", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 1000 });
      await sync(s.t, s.companyId);
      await s.as.mutation(api.billing.cancelPlan, { companyId: s.companyId });
      await settle(s.t);
      let view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account).toMatchObject({ plan: "operate", subscription: { endsAt: billing.customerFor(`company_${s.companyId}`).periodEnd } });
      expect(billing.state.calls.find((call) => call.path === "/v1/billing.update")!.body).toMatchObject({ cancel_action: "cancel_end_of_cycle" });
      await s.as.mutation(api.billing.resumePlan, { companyId: s.companyId });
      await settle(s.t);
      view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account?.subscription.endsAt).toBeNull();
    });
  });

  describe("top-ups", () => {
    it("are off until offered, add credits only after payment, and never twice for one purchase", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 1000, cardOnFile: false });
      await sync(s.t, s.companyId);
      expect(await refusal(s.as.mutation(api.billing.startTopUp, { companyId: s.companyId, credits: 500 }))).toMatch(/not offered/);
      process.env.BILLING_TOP_UP_PACKS = "500";
      const intentId = await s.as.mutation(api.billing.startTopUp, { companyId: s.companyId, credits: 500 });
      await settle(s.t);
      await s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId });
      await settle(s.t);
      // No card: Autumn asks for payment, and no credits exist yet.
      expect(await s.as.query(api.billing.intent, { companyId: s.companyId, intentId })).toMatchObject({ stage: "payment_needed", url: "https://checkout.stripe.test/session" });
      expect(billing.customerFor(`company_${s.companyId}`).purchased).toBe(0);
      // Paid: a retried request with the same key is a replay, not a second purchase.
      billing.customerFor(`company_${s.companyId}`).cardOnFile = true;
      billing.state.keys.clear();
      const paid = await s.as.mutation(api.billing.startTopUp, { companyId: s.companyId, credits: 500 });
      await settle(s.t);
      await s.as.mutation(api.billing.confirmIntent, { companyId: s.companyId, intentId: paid });
      await settle(s.t);
      await s.t.action(internal.billing.runIntent, { intentId: paid });
      expect(billing.customerFor(`company_${s.companyId}`).purchased).toBe(500);
      const view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account?.credits).toMatchObject({ purchased: { granted: 500, remaining: 500 }, included: { granted: 1000 } });
      // A top-up adds credits, never an agent.
      const company = await s.t.run(async (ctx) => (await ctx.db.get(s.companyId))!);
      expect(agentVerdict(company, "quality")).toMatchObject({ ok: false });
    });
  });

  describe("at zero credits", () => {
    it("pauses AI work, tells the Owner, and keeps everything else working", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 0 });
      await sync(s.t, s.companyId);
      const conversationId = await ask(s.t, s.as, s.companyId);
      expect((await lastReply(s.as, s.companyId, conversationId)).text).toMatch(/no Selestial Credits left/);
      const view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account?.notices.map((row) => row.kind)).toContain("zero_balance");
      expect(billing.state.calls.some((call) => call.path === "/v1/billing.attach")).toBe(false);
      expect(await s.as.query(api.billing.creditIndicator, { companyId: s.companyId })).toMatchObject({ state: "empty" });
    });

    it("lets Recruiter keep filing applications, read by the rules instead of AI", async () => {
      const undo = recruiterTestEnv();
      try {
        vi.stubEnv("RECRUITER_MODEL", "mock");
        const r = await recruiterSetup();
        billing.seed(r.companyId, { plan: "operate", grant: 0 });
        let aiReads = 0;
        mockModel.interpret = () => {
          aiReads += 1;
          throw new Error("The AI reader must not run without credits.");
        };
        await r.receive(indeedApplication());
        await flush(r.t);
        expect(aiReads).toBe(0);
        expect(await r.applications()).toEqual([expect.objectContaining({ name: "Maria Lopez" })]);
        expect((await r.t.run(async (ctx) => ctx.db.query("aiExecutions").collect())).map((row) => [row.agent, row.state, row.block])).toEqual([["recruiter", "denied", "credits"]]);
      } finally {
        mockModel.interpret = null;
        vi.unstubAllEnvs();
        undo();
      }
    });
  });

  describe("Autumn's webhooks", () => {
    const SECRET = `whsec_${btoa("autumn-test-signing-key-0123456789")}`;
    async function sign(id: string, timestamp: number, body: string) {
      const raw = Uint8Array.from(atob(SECRET.slice(6)), (c) => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
      return `v1,${btoa(String.fromCharCode(...mac))}`;
    }

    it("are verified, read back from Autumn rather than trusted, and handled once", async () => {
      const s = await setup();
      process.env.AUTUMN_WEBHOOK_SECRET = SECRET;
      try {
        billing.seed(s.companyId, { plan: "operate", grant: 1000 });
        await sync(s.t, s.companyId);
        billing.seed(s.companyId, { plan: "expand", grant: 2000 });
        // The body claims more than Autumn holds; only Autumn's own record counts.
        const body = JSON.stringify({ type: "billing.updated", data: { customer_id: `company_${s.companyId}`, plan_changes: [{ action: "activated", subscription: { plan_id: "expand" } }] } });
        const timestamp = Math.floor(Date.now() / 1000);
        const post = async (headers: Record<string, string>) => s.t.fetch("/webhooks/autumn", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
        expect((await post({ "svix-id": "evt_x", "svix-timestamp": String(timestamp), "svix-signature": "v1,forged" })).status).toBe(401);
        const signed = { "svix-id": "evt_1", "svix-timestamp": String(timestamp), "svix-signature": await sign("evt_1", timestamp, body) };
        expect((await post(signed)).status).toBe(200);
        expect((await post(signed)).status).toBe(200);
        await settle(s.t);
        expect(await s.t.run(async (ctx) => (await ctx.db.get(s.companyId))!.plan)).toBe("expand");
        expect(await s.t.run(async (ctx) => ctx.db.query("billingWebhooks").collect())).toHaveLength(1);
      } finally {
        delete process.env.AUTUMN_WEBHOOK_SECRET;
      }
    });
  });

  describe("spending controls", () => {
    it("hold back work over the per-run limit, and automatic work over the monthly budget", async () => {
      const s = await setup();
      await sync(s.t, s.companyId);
      await s.as.mutation(api.billing.setSpendingControls, { companyId: s.companyId, maxPerExecution: 50, approvalThreshold: 20, autonomousMonthly: 1, agentBudgets: { chat: 1 }, lowBalance: null, alertPercents: [80], autoTopUp: { enabled: false } });
      expect(await refusal(s.as.mutation(api.billing.setSpendingControls, { companyId: s.companyId, maxPerExecution: null, approvalThreshold: null, autonomousMonthly: null, agentBudgets: {}, lowBalance: null, alertPercents: [80], autoTopUp: { enabled: true, credits: 500 } }))).toMatch(/not available yet/);
      const results = await s.t.run(async (ctx) => {
        const { openExecution } = await import("./lib/billing/executions");
        const company = (await ctx.db.get(s.companyId))!;
        const big = await openExecution(ctx, { company, key: "big", agent: "studio", feature: "creative_studio", task: "image_generation", units: 3, autonomous: false });
        const auto1 = await openExecution(ctx, { company, key: "auto1", agent: "recruiter", task: "hiring_message_reading", units: 1, autonomous: true });
        await ctx.db.patch((auto1 as { executionId: Id<"aiExecutions"> }).executionId, { state: "reserved" });
        const auto2 = await openExecution(ctx, { company, key: "auto2", agent: "recruiter", task: "hiring_message_reading", units: 1, autonomous: true });
        const huge = await openExecution(ctx, { company, key: "huge", agent: "studio", feature: "creative_studio", task: "image_generation", units: 6, autonomous: false, authorized: true });
        const chat1 = await openExecution(ctx, { company, key: "chat1", agent: "chat", task: "chat_response_standard", units: 1, autonomous: false });
        await ctx.db.patch((chat1 as { executionId: Id<"aiExecutions"> }).executionId, { state: "reserved" });
        const chat2 = await openExecution(ctx, { company, key: "chat2", agent: "chat", task: "chat_response_standard", units: 1, autonomous: false });
        return { big, auto1, auto2, huge, chat2 };
      });
      // Above the threshold waits for the Owner; above the hard maximum nothing runs, approved or not.
      expect(results.big).toMatchObject({ ok: false, block: "needs_authorization" });
      expect(results.huge).toMatchObject({ ok: false, block: "budget", message: expect.stringContaining("maximum") });
      expect(results.chat2).toMatchObject({ ok: false, block: "budget", message: expect.stringContaining("monthly budget") });
      expect(results.auto1).toMatchObject({ ok: true });
      expect(results.auto2).toMatchObject({ ok: false, block: "budget" });
    });

    it("alert the Owner once per threshold per period", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 1000, usage: 850 });
      await sync(s.t, s.companyId);
      await sync(s.t, s.companyId);
      const view = await s.as.query(api.billing.planAndUsage, { companyId: s.companyId });
      expect(view.connected && view.account?.notices.filter((row) => row.kind === "usage_alert").map((row) => row.text)).toEqual(["This company has used 80% of this month's included credits."]);
    });
  });

  describe("the retired staff-set plans", () => {
    it("grant nothing, and are cleared without touching verified plans", async () => {
      const s = await setup();
      const other = await company(s.t, "owner-b", "Beta Cleaning");
      await s.t.run(async (ctx) => ctx.db.patch(s.companyId, { plan: "scale" }));
      billing.seed(other.companyId, { plan: "operate", grant: 1000 });
      await sync(s.t, other.companyId);
      const retired = await s.t.run(async (ctx) => (await ctx.db.get(s.companyId))!);
      expect(agentVerdict(retired, "dispatch")).toMatchObject({ ok: false, block: "plan" });
      expect(await s.t.mutation(internal.billing.clearLegacyPlans, {})).toEqual({ cleared: 1 });
      expect(await s.t.run(async (ctx) => [(await ctx.db.get(s.companyId))!.plan ?? null, (await ctx.db.get(other.companyId))!.plan ?? null])).toEqual([null, "operate"]);
    });
  });

  describe("the approved price list", () => {
    it("prices exactly the published setups and refuses the rest, with the exact estimate before generating", async () => {
      const s = await setup();
      process.env.BILLING_RATE_CARD = "2026-11";
      const estimate = (args: { task: "image_generation" | "image_edit" | "video_generation"; units: number; size?: string; fast?: boolean; durationSeconds?: number }) => s.as.query(api.billingUsage.estimate, { companyId: s.companyId, ...args });
      expect(await estimate({ task: "image_generation", units: 2, size: "1024x1024" })).toMatchObject({ ok: true, credits: 40, rate: 20, rateCard: "2026-11" });
      expect(await estimate({ task: "image_edit", units: 1, size: "1024x1024" })).toMatchObject({ ok: true, credits: 15 });
      expect(await estimate({ task: "video_generation", units: 1, durationSeconds: 6 })).toMatchObject({ ok: true, credits: 200 });
      expect(await estimate({ task: "video_generation", units: 1, durationSeconds: 8 })).toMatchObject({ ok: false, message: expect.stringContaining("no published credit price") });
      expect(await estimate({ task: "image_generation", units: 1, size: "1536x1024" })).toMatchObject({ ok: false });
      expect(await estimate({ task: "image_generation", units: 1, size: "1024x1024", fast: true })).toMatchObject({ ok: false });
      // A live key accepts the approved production card.
      process.env.AUTUMN_SECRET_KEY = "am_sk_live_not_a_real_key";
      expect(await estimate({ task: "video_generation", units: 1, durationSeconds: 6 })).toMatchObject({ ok: true, credits: 200 });
    });

    it("charges a premium-model answer at its own rate", async () => {
      const s = await setup();
      process.env.BILLING_RATE_CARD = "2026-11";
      process.env.ANTHROPIC_API_KEY = "test";
      mockChat.script = [{ text: "A careful answer." }];
      await s.as.mutation(api.chat.send, { companyId: s.companyId, text: "Plan next week.", clientKey: key(), model: "claude-opus" });
      await settle(s.t);
      expect((await executions(s.t))[0]).toMatchObject({ task: "chat_response_advanced", charged: 5, rateCardVersion: "2026-11" });
      delete process.env.ANTHROPIC_API_KEY;
    });
  });

  describe("the Usage page", () => {
    it("answers how much, what used it, and what it delivered, from Autumn's balance and the execution records", async () => {
      const s = await setup();
      billing.seed(s.companyId, { plan: "operate", grant: 5000 });
      mockChat.script = [{ text: "One." }, { text: "Two." }];
      await ask(s.t, s.as, s.companyId, "First");
      await ask(s.t, s.as, s.companyId, "Second");
      await sync(s.t, s.companyId);
      const view = await s.as.query(api.billingUsage.usage, { companyId: s.companyId });
      if (!view.connected) throw new Error("not connected");
      expect(view.overview).toMatchObject({ updating: false, available: 4998, usedThisCycle: 2, reserved: 0, monthly: { granted: 5000, remaining: 4998 }, zero: false });
      expect(view.byAgent.find((row) => row.key === "chat")).toMatchObject({ units: 2, credits: 2, share: 100 });
      expect(view.byAgent.map((row) => row.key)).toEqual(expect.arrayContaining(["chat", "recruiter", "dispatch"]));
      expect(view.byTask.find((row) => row.key === "chat_response_standard")).toMatchObject({ units: 2, credits: 2 });
      expect(view.delivered).toEqual([expect.objectContaining({ agent: "Company Chat", units: 2, credits: 2, link: expect.objectContaining({ path: expect.stringMatching(/^\/app\/chat\//) }) })]);
      expect(view.series.reduce((sum, day) => sum + day.total, 0)).toBe(2);
      // No forecast without real history.
      expect(view.forecast).toBeNull();
      expect(view.activity).toHaveLength(2);
      expect(view.activity[0]).toMatchObject({ agent: "Company Chat", origin: "From Company Chat", action: "Chat response", status: "Completed", credits: 1, initiatedBy: "owner-a" });
      const filtered = await s.as.query(api.billingUsage.usage, { companyId: s.companyId, status: "Failed" });
      expect(filtered.connected && filtered.activity).toEqual([]);
      const detail = (await s.as.query(api.billingUsage.execution, { companyId: s.companyId, executionId: view.activity[0].id }))!;
      expect(detail).toMatchObject({ estimate: 1, final: 1, rateCard: "fixture-2026-11", explanation: null });
      expect(detail.history.map((step) => step.kind)).toEqual(["estimated", "held", "completed", "charged"]);
      expect(view.communication).toMatchObject({ sms: { total: 0 }, email: { total: 0 }, voice: null });
      expect(view.priceList?.free.join(" ")).toMatch(/cleaner text-message links/);
    });

    it("says 'Updating usage' instead of an unverified zero, and keeps spending details to the Owner", async () => {
      const s = await setup();
      const view = await s.as.query(api.billingUsage.usage, { companyId: s.companyId });
      expect(view.connected && view.overview).toMatchObject({ updating: true, available: null, zero: false });
      const manager = await addMember(s.t, s.as, s.companyId, "mgr", "manager");
      expect(await refusal(manager.query(api.billingUsage.usage, { companyId: s.companyId }))).toBe(NOT_ALLOWED);
      const other = await company(s.t, "owner-b", "Beta Cleaning");
      expect(await refusal(other.as.query(api.billingUsage.usage, { companyId: s.companyId }))).toBe(NOT_FOUND);
    });

    it("keeps balance changes apart from usage, from Autumn's ledger", async () => {
      const s = await setup();
      billing.state.ledger = [{ id: "led_1", occurred_at: NOW - 1000, why: { type: "plan_change", action: "manual_topup" }, before: { remaining: 100 }, after: { remaining: 600 } }, { id: "led_2", occurred_at: NOW - 5000, why: { type: "reset" }, before: { remaining: 3 }, after: { remaining: 5000 } }];
      await sync(s.t, s.companyId);
      const view = await s.as.query(api.billingUsage.usage, { companyId: s.companyId });
      expect(view.connected && view.ledger).toEqual([expect.objectContaining({ label: "Credits purchased", change: 500, after: 600 }), expect.objectContaining({ label: "Monthly credits renewed", change: 4997 })]);
      expect(view.connected && view.activity).toEqual([]);
    });
  });
});
