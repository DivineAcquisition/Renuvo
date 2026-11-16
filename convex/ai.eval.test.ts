/**
 * The live evaluation (brief §12). Skipped unless AI_EVAL=1 and the needed provider keys are set, so the
 * normal test run never calls a provider or spends money. When it runs, it calls the real models with
 * synthetic inputs only, scores each case automatically, and writes docs/ai/eval-results.json.
 *
 *   AI_EVAL=1 ANTHROPIC_API_KEY=… OPENAI_API_KEY=… npx vitest run convex/ai.eval.test.ts
 *
 * Cases a person must judge (photos, video, creatives, generated video) are in cases.ts with rubrics.
 */
import { writeFileSync } from "node:fs";

import { afterAll, describe, expect, it } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import { AGREEMENTS, CLASSIFICATION, EXTRACTION, PRICING, RETRIEVAL, TOOLS, type EvalRecord } from "./lib/ai/eval/cases";
import { embed } from "./lib/ai/openai";
import { REGISTRY } from "./lib/ai/registry";
import { claudeChatModel } from "./lib/chat/claude";
import { pricing, type PricingInput } from "./lib/chat/pricing";
import { systemPrompt } from "./lib/chat/prompt";
import { toolSpecs } from "./lib/chat/tools";
import { claudeModel } from "./lib/recruiter/claude";

const live = process.env.AI_EVAL === "1";
const anthropic = live && Boolean(process.env.ANTHROPIC_API_KEY);
const openai = live && Boolean(process.env.OPENAI_API_KEY);
const records: EvalRecord[] = [];

const company = { _id: "c1" as Id<"companies">, name: "Alpha Cleaning", timezone: "America/Chicago", pausedAgents: [] } as unknown as Doc<"companies">;
const member = { _id: "m1" as Id<"members">, name: "Avery" } as unknown as Doc<"members">;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T | null; ms: number; error?: string }> {
  const started = Date.now();
  try {
    return { value: await work(), ms: Date.now() - started };
  } catch (error) {
    return { value: null, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function firstTool(role: "owner" | "manager" | "office", ask: string) {
  const model = claudeChatModel(process.env.ANTHROPIC_API_KEY!, REGISTRY.chat.primary);
  return model.respond({ system: systemPrompt({ company, member, role, knowledge: [], now: Date.now() }), messages: [{ role: "user", content: ask }], tools: toolSpecs(role), maxTokens: 16_000, onText: () => undefined });
}

describe.skipIf(!anthropic)("live: hiring mail (classify route)", () => {
  const model = () => claudeModel(process.env.ANTHROPIC_API_KEY!);
  for (const item of CLASSIFICATION) {
    it(item.id, async () => {
      const run = await timed(() => model().looksLikeHiring({ from: item.from, subject: item.subject }));
      records.push({ suite: "classification", caseId: item.id, provider: "anthropic", model: REGISTRY.classify.primary.model, valid: run.value !== null, correct: run.value?.hiring === item.expectHiring, latencyMs: run.ms, note: run.error });
    });
  }
  for (const item of EXTRACTION) {
    it(item.id, async () => {
      const run = await timed(() => model().interpret({ from: item.from, subject: item.subject, text: item.text, attachments: [] } as never, null));
      const addresses = run.value?.addresses ?? [];
      const direct = addresses.filter((row) => row.kind === "direct").map((row) => row.address.toLowerCase());
      const correct = Boolean(run.value) && (!item.expect.name || run.value!.name === item.expect.name) && (!item.expect.applicantEmail || direct.includes(item.expect.applicantEmail)) && !(item.expect.notApplicantEmail ?? []).some((email) => direct.includes(email));
      records.push({ suite: "extraction", caseId: item.id, provider: "anthropic", model: REGISTRY.classify.primary.model, valid: run.value !== null, correct, latencyMs: run.ms, note: run.error });
    });
  }
});

describe.skipIf(!anthropic)("live: chat tool selection, refusals, pricing and drafts", () => {
  for (const item of TOOLS) {
    it(item.id, async () => {
      const run = await timed(() => firstTool(item.role, item.ask));
      const called = run.value?.toolCalls[0] ?? null;
      const forbidden = (run.value?.toolCalls ?? []).some((call) => item.forbiddenTools?.includes(call.name));
      const argsOk = !item.expectArgs || Object.entries(item.expectArgs).every(([key, value]) => (called?.input as Record<string, unknown> | undefined)?.[key] === value);
      const correct = !forbidden && argsOk && (item.expectTool === null ? !called || !["create_task", "create_hiring_need", "request_dispatch_offer"].includes(called.name) : called?.name === item.expectTool);
      records.push({ suite: "tools", caseId: item.id, provider: "anthropic", model: REGISTRY.chat.primary.model, valid: run.value !== null, correct, latencyMs: run.ms, inputTokens: run.value?.usage.inputTokens, outputTokens: run.value?.usage.outputTokens, note: run.error ?? called?.name });
    });
  }
  for (const item of PRICING) {
    it(item.id, async () => {
      const run = await timed(() => firstTool("owner", item.ask));
      const call = run.value?.toolCalls.find((row) => row.name === "price_service");
      let price: number | null = null;
      try {
        const scenario = ((call?.input as { scenarios?: PricingInput[] })?.scenarios ?? [])[0];
        const result = scenario ? pricing(scenario) : null;
        price = result?.priceAtMarginCents ?? result?.priceAtMarkupCents ?? null;
      } catch {
        price = null;
      }
      records.push({ suite: "pricing", caseId: item.id, provider: "anthropic", model: REGISTRY.chat.primary.model, valid: Boolean(call), correct: price !== null && Math.abs(price - item.expectPriceCents) <= item.toleranceCents, latencyMs: run.ms, note: run.error ?? (price === null ? "no calculator call" : `priced ${price}`) });
    });
  }
  for (const item of AGREEMENTS) {
    it(item.id, async () => {
      const run = await timed(() => firstTool("owner", item.ask));
      const content = String(((run.value?.toolCalls.find((row) => row.name === "save_draft")?.input ?? {}) as { content?: string }).content ?? "");
      const unresolved = [...content.matchAll(/\[\[TO CONFIRM:\s*([^\]]+)\]\]/g)].map((match) => match[1].toLowerCase()).join(" ");
      const correct = Boolean(content) && item.mustContain.every((text) => content.includes(text)) && item.mustMarkUnresolved.every((term) => unresolved.includes(term)) && !item.mustNotContain.some((text) => content.includes(text));
      records.push({ suite: "agreements", caseId: item.id, provider: "anthropic", model: REGISTRY.chat.primary.model, valid: Boolean(content), correct, latencyMs: run.ms, note: run.error });
    });
  }
});

describe.skipIf(!openai)("live: retrieval embeddings", () => {
  const cosine = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0) / (Math.hypot(...a) * Math.hypot(...b));
  for (const item of RETRIEVAL) {
    it(item.id, async () => {
      const run = await timed(() => embed(REGISTRY.embed.primary, [item.query, ...item.documents.map((doc) => doc.text)]));
      const vectors = run.value?.vectors ?? [];
      const ranked = item.documents.map((doc, index) => ({ id: doc.id, score: vectors.length ? cosine(vectors[0], vectors[index + 1]) : 0 })).sort((a, b) => b.score - a.score);
      records.push({ suite: "retrieval", caseId: item.id, provider: "openai", model: REGISTRY.embed.primary.model, valid: vectors.length === item.documents.length + 1, correct: ranked[0]?.id === item.expectTop, latencyMs: run.ms, inputTokens: run.value?.inputTokens, note: run.error });
    });
  }
});

describe("the evaluation set itself", () => {
  it("has known answers that the calculator agrees with", () => {
    expect(pricing({ crewSize: 2, elapsedHours: 3, laborCostPerHourCents: 2000, suppliesCents: 1000, targetMarginPercent: 40 }).priceAtMarginCents).toBe(PRICING[0].expectPriceCents);
    expect(pricing({ laborHours: 4, laborCostPerHourCents: 2500, markupPercent: 50 }).priceAtMarkupCents).toBe(PRICING[1].expectPriceCents);
    expect(pricing({ crewSize: 1, elapsedHours: 2.5, laborCostPerHourCents: 2200, suppliesCents: 800, travelCents: 1200, overheadPercent: 15, targetMarginPercent: 35 }).priceAtMarginCents).toBe(PRICING[2].expectPriceCents);
  });
});

afterAll(() => {
  if (!live || records.length === 0) return;
  const summary = Object.entries(Object.groupBy(records, (row) => row.suite)).map(([suite, rows]) => ({ suite, cases: rows!.length, validRate: rows!.filter((row) => row.valid).length / rows!.length, correctRate: rows!.filter((row) => row.correct).length / rows!.length, medianLatencyMs: rows!.map((row) => row.latencyMs).sort((a, b) => a - b)[Math.floor(rows!.length / 2)] }));
  writeFileSync("docs/ai/eval-results.json", JSON.stringify({ ranAt: new Date().toISOString(), summary, records }, null, 2));
});
