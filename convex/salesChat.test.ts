/**
 * Sales in Company Chat, with the scripted model: Chat reads the draft from the server's prices, prepares
 * a change that waits for the person's approval, and can't send, charge or confirm anything.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { company, NOW, start, type T } from "../tests/harness";
import { homeSpec, publish } from "../tests/salesHarness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockChat } from "./lib/chat/model";

let keys = 0;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

describe("Sales tools in Chat", () => {
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
    mockChat.script = [];
  });

  it("reads a draft, prepares a change for approval, and never books from chat", async () => {
    const t = start();
    const { as, companyId } = await company(t, "owner", "Elm Cleaning");
    const key = await publish(as, companyId, homeSpec());
    const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home", email: "dana@example.com" });
    const propertyId = await as.mutation(api.properties.create, { companyId, customerId, kind: "home", address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" } });
    const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "booking", customerId, propertyId });
    await as.mutation(api.sales.saveDraft, { companyId, draftId, revision: 0, body: { service: { key, input: { bedrooms: 2, bathrooms: 1 } } } });

    mockChat.script = [{ toolCalls: [{ name: "read_sales_draft", input: { draftId } }] }, { text: "Read it." }];
    const sent = await as.mutation(api.chat.send, { companyId, text: "What's missing?", clientKey: `k-${(keys += 1)}`, origin: { kind: "sales_draft", draftId } });
    await settle(t);
    const reads = await t.run(async (ctx) => (await ctx.db.query("chatActionSteps").collect()).filter((row) => row.tool === "read_sales_draft"));
    const data = JSON.parse(reads[0]!.result!) as { facts: { firstCents: number }; unresolved: string[] };
    // 120 + 1 bedroom × 20 = 140, from the server, not the model.
    expect(data.facts.firstCents).toBe(14000);
    expect(data.unresolved.join(" ")).toMatch(/date/);
    const conversation = await t.run((ctx) => ctx.db.get(sent.conversationId as Id<"conversations">));
    expect(conversation?.origin).toEqual({ kind: "sales_draft", draftId });

    mockChat.script = [{ toolCalls: [{ name: "update_sales_draft", input: { draftId, answers: { bedrooms: 3, bathrooms: 2 }, payment: "after_service" } }] }, { text: "Prepared." }];
    await as.mutation(api.chat.send, { companyId, text: "Make it 3 bed 2 bath, pay after.", clientKey: `k-${(keys += 1)}`, conversationId: sent.conversationId });
    await settle(t);
    const view = await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
    const step = (Object.values(view.steps) as { stepId: string; tool: string; status: string; preview: { lines: string[] } | null }[]).find((s) => s.tool === "update_sales_draft")!;
    expect(step.status).toBe("awaiting_approval");
    expect(step.preview?.lines.join(" ")).toMatch(/bedrooms: 3/);
    // Nothing changed until the person approves.
    let draft = await as.query(api.sales.draft, { companyId, draftId });
    expect((draft.draft.body as { service: { input: { bedrooms: number } } }).service.input.bedrooms).toBe(2);
    await as.mutation(api.chat.decideStep, { companyId, stepId: step.stepId as Id<"chatActionSteps">, approve: true });
    await settle(t);
    draft = await as.query(api.sales.draft, { companyId, draftId });
    expect((draft.draft.body as { service: { input: { bedrooms: number } } }).service.input.bedrooms).toBe(3);
    const summary = await as.query(api.sales.price, { companyId, draftId });
    if (summary.mode !== "booking") throw new Error();
    expect(summary.firstCents).toBe(18500);
    // Chat made no booking.
    expect(await t.run((ctx) => ctx.db.query("bookings").collect())).toHaveLength(0);
  });
});
