/**
 * The AI layer (docs/ai/01-verification.md). Provider HTTP is stubbed at fetch with each provider's
 * documented response shape, so the real adapters, the job engine and the allowance logic all run. No
 * provider is contacted, nothing is billed, and no real person is messaged.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchPlace, NOW, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { allowedUrl } from "./lib/ai/http";
import { fromOpenAi, toOpenAi } from "./lib/ai/openrouter";
import { resolve } from "./lib/ai/registry";
import { mockChat, ModelError } from "./lib/chat/model";
import { NOT_ALLOWED, NOT_FOUND } from "./lib/errors";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MP4 = btoa("not really an mp4, but bytes");

type Call = { url: string; method: string; body: string };
let calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response> = () => new Response("{}", { status: 404 });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let keys = 0;
const key = () => `ai-key-${(keys += 1)}`;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  return { t, ...owner };
}

/** A visit with two evidence photos and a checklist, as a cleaner's link would leave them. */
async function visitWithPhotos(t: T, as: Awaited<ReturnType<typeof setup>>["as"], companyId: Id<"companies">) {
  const place = await dispatchPlace(as, companyId);
  const jobId = await as.mutation(api.jobs.create, { companyId, ...place, serviceType: "standard", scope: "Kitchen and two bathrooms", startsAt: NOW + 3_600_000, endsAt: NOW + 7_200_000 });
  return t.run(async (ctx) => {
    const cleanerId = await ctx.db.insert("cleaners", { companyId, name: "Rosa", engagement: "contractor", status: "ready", skills: [], serviceAreas: [], createdAt: NOW });
    const assignmentId = await ctx.db.insert("assignments", { companyId, jobId, cleanerId, status: "accepted", scope: "x", payCents: 8000, offeredAt: NOW, respondBy: NOW + 1 });
    const itemId = await ctx.db.insert("checklistItems", { companyId, jobId, order: 1, label: "Wipe the kitchen counters", requiresPhoto: true, state: "done" });
    const photos = [];
    for (const kind of ["before", "after"] as const) {
      const storageId = await ctx.storage.store(new Blob([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0))], { type: "image/png" }));
      photos.push(await ctx.db.insert("evidence", { companyId, jobId, assignmentId, cleanerId, kind, checklistItemId: kind === "after" ? itemId : undefined, storageId, clientKey: `${kind}-1`, uploadedAt: NOW }));
    }
    return { jobId, cleanerId, photos };
  });
}

describe("the AI layer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    calls = [];
    respond = () => new Response("{}", { status: 404 });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const call = { url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : "" };
      calls.push(call);
      return respond(call);
    });
    process.env.CHAT_MODEL = "mock";
    mockChat.script = [];
    mockChat.seen = [];
    mockChat.fallbackScript = [];
    mockChat.fallbackSeen = [];
    mockChat.onRespond = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const name of ["CHAT_MODEL", "CHAT_MOCK_FALLBACK", "OPENAI_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "MEDIA_IMAGES_PER_MONTH", "STAFF_BOOTSTRAP_EMAIL"]) delete process.env[name];
  });

  describe("registry and honest states", () => {
    it("says what is not connected or not built, and never calls a provider without its key", () => {
      expect(resolve("image_generate")).toMatchObject({ ready: false, reason: "not_configured" });
      expect(resolve("transcribe")).toMatchObject({ ready: false, reason: "not_implemented" });
      expect(resolve("reasoning")).toMatchObject({ ready: false, reason: "disabled" });
      process.env.OPENAI_API_KEY = "test";
      expect(resolve("image_generate")).toMatchObject({ ready: true, model: { provider: "openai", model: "gpt-image-2.6-sunburst" } });
      expect(resolve("image_generate", { enabled: false, evaluation: "rejected" })).toMatchObject({ ready: false, reason: "disabled" });
      expect(resolve("chat").entry.primary.model).toBe("claude-sonnet-5-5");
      expect(resolve("classify").entry.primary.model).toBe("claude-haiku-5-5");
      expect(calls).toEqual([]);
    });

    it("only reaches the providers' own hosts over https", () => {
      expect(allowedUrl("openai", "https://api.openai.com/v1/images/generations").hostname).toBe("api.openai.com");
      for (const bad of ["http://api.openai.com/v1", "https://api.openai.com.evil.test/x", "https://user:pw@api.openai.com/", "https://169.254.169.254/latest", "file:///etc/passwd"]) expect(() => allowedUrl("openai", bad), bad).toThrow();
      expect(() => allowedUrl("google", "https://storage.googleapis.com/x")).toThrow();
    });
  });

  describe("chat on the shared layer", () => {
    it("continues on the backup model after an outage, carrying the tool result instead of repeating it", async () => {
      const { t, as, companyId } = await setup();
      process.env.CHAT_MOCK_FALLBACK = "1";
      const task = { agent: "dispatch", title: "Confirm gate code", nextAction: "Call", due: "2027-03-05", completionCondition: "Code confirmed" };
      mockChat.script = [{ toolCalls: [{ name: "create_task", input: task }] }, { error: "Overloaded", outage: true }];
      mockChat.fallbackScript = [{ text: "The task is in place." }];
      const sent = await as.mutation(api.chat.send, { companyId, text: "Make a task to confirm the gate code.", clientKey: key() });
      await settle(t);
      const view = await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
      expect(view.run?.status).toBe("completed");
      const words = JSON.stringify(view.messages.at(-1)!.parts);
      expect(words).toContain("a backup model (mock-fallback) continued this answer");
      expect(words).toContain("The task is in place.");
      // The backup saw the completed tool result, and the task exists once.
      expect(JSON.stringify(mockChat.fallbackSeen[0].messages)).toContain("Created the task");
      expect((await as.query(api.tasks.list, { companyId, status: "open", agent: "dispatch" })).filter((row) => row.title === "Confirm gate code")).toHaveLength(1);
      const usage = await t.run((ctx) => ctx.db.query("aiUsage").collect());
      expect(usage.map((row) => row.feature)).toEqual(["chat", "chat"]);
    });

    it("never switches providers after a refusal", async () => {
      const { t, as, companyId } = await setup();
      process.env.CHAT_MOCK_FALLBACK = "1";
      mockChat.script = [{ text: "", stop: "refusal" }];
      const sent = await as.mutation(api.chat.send, { companyId, text: "Something the model declines.", clientKey: key() });
      await settle(t);
      const view = await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
      expect(JSON.stringify(view.messages.at(-1)!.parts)).toContain("declined");
      expect(mockChat.fallbackSeen).toEqual([]);
    });

    it("stops honestly when Selestial staff switch chat off", async () => {
      const { t, as, companyId } = await setup();
      const staff = { subject: "user_staff", email: "staff@selestial.example", emailVerified: true, name: "Staff" };
      process.env.STAFF_BOOTSTRAP_EMAIL = staff.email;
      delete process.env.CHAT_MODEL;
      process.env.ANTHROPIC_API_KEY = "test";
      await t.withIdentity(staff).mutation(api.aiAdmin.setCapability, { capability: "chat", enabled: false, evaluation: "evaluating" });
      const sent = await as.mutation(api.chat.send, { companyId, text: "Hello", clientKey: key() });
      await settle(t);
      expect((await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId })).run).toMatchObject({ status: "failed", error: expect.stringMatching(/switched off/) });
      expect(calls).toEqual([]);
      // A company member cannot touch platform settings.
      expect(await refusal(as.mutation(api.aiAdmin.setCapability, { capability: "chat", enabled: true, evaluation: "approved" }))).toBe(NOT_FOUND);
    });

    it("reviews a visit's photos as data, describes them, and decides nothing about the cleaner", async () => {
      const { t, as, companyId } = await setup();
      const visit = await visitWithPhotos(t, as, companyId);
      process.env.ANTHROPIC_API_KEY = "test";
      const review = { photos: [{ label: "before 1", visible: "Cluttered counter", notVisible: "Sink" }], checklist: [{ item: "Wipe the kitchen counters", status: "visible_done", evidence: "after 2 shows a clear counter" }], insufficientEvidence: ["Bathrooms are not in any photo"], summary: "Counters look wiped; bathrooms are not shown." };
      respond = (call) => (call.url.startsWith("https://api.anthropic.com/") ? json(200, { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(review) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 900, output_tokens: 120 } }) : json(404, {}));
      mockChat.script = [{ toolCalls: [{ name: "review_visit_photos", input: { jobId: visit.jobId } }] }, { text: "The counters look done; the bathrooms are not shown." }];
      const sent = await as.mutation(api.chat.send, { companyId, text: "Check the photos from this visit.", clientKey: key() });
      await settle(t);
      const view = await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
      const step = Object.values(view.steps)[0] as { tool: string; status: string; summary: string; agent: string };
      expect(step).toMatchObject({ tool: "review_visit_photos", status: "done", agent: "quality" });
      expect(step.summary).toContain("bathrooms are not shown");
      const request = JSON.parse(calls.find((call) => call.url.includes("api.anthropic.com"))!.body);
      expect(request.model).toBe("claude-sonnet-5-5");
      expect(request.system).toContain("Do not judge or blame the worker");
      expect(request.messages[0].content.filter((block: { type: string }) => block.type === "image")).toHaveLength(2);
      // Nothing about the cleaner or the visit changed.
      const after = await t.run(async (ctx) => ({ cleaner: await ctx.db.get(visit.cleanerId), tasks: await ctx.db.query("tasks").collect() }));
      expect(after.cleaner?.status).toBe("ready");
      expect(after.tasks.filter((task) => task.agent === "dispatch" && /quality|photo/i.test(task.title))).toEqual([]);
      expect((await t.run((ctx) => ctx.db.query("aiUsage").collect())).map((row) => row.feature)).toContain("photo_review");
    });
  });

  describe("Creative Studio", () => {
    it("generates an image through a durable job, stores it as generated, and counts it once", async () => {
      const { t, as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      respond = (call) => (call.url === "https://api.openai.com/v1/images/generations" ? json(200, { data: [{ b64_json: PNG, revised_prompt: "A tidy kitchen" }], usage: { input_tokens: 20, output_tokens: 4000 } }) : json(404, {}));
      const jobId = await as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "A tidy kitchen illustration", params: { size: "1024x1024" } });
      expect((await as.query(api.creative.allowance, { companyId })).images).toMatchObject({ used: 0, reserved: 1, limit: 40 });
      await settle(t);
      const job = await t.run((ctx) => ctx.db.get(jobId));
      expect(job).toMatchObject({ state: "completed", provider: "openai", model: "gpt-image-2.6-sunburst" });
      const [asset] = (await as.query(api.creative.library, { companyId, paginationOpts: { numItems: 10, cursor: null } })).page;
      expect(asset).toMatchObject({ origin: "generated", realWork: false, generation: { model: "gpt-image-2.6-sunburst", prompt: "A tidy kitchen illustration" } });
      expect(asset.generation?.provenance).toMatch(/Generated by OpenAI/);
      expect((await as.query(api.creative.allowance, { companyId })).images).toMatchObject({ used: 1, reserved: 0 });
      expect(JSON.parse(calls[0].body)).toMatchObject({ model: "gpt-image-2.6-sunburst", size: "1024x1024", n: 1 });
      // A late, repeated completion is ignored: the job stays as it was.
      const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
      await t.mutation(internal.media.complete, { jobId, outputs: [{ storageId, contentType: "image/png", size: 1 }] });
      expect((await t.run((ctx) => ctx.db.get(jobId)))?.outputs).toHaveLength(1);
    });

    it("never resends a generation whose answer was lost, and counts it as possibly billed", async () => {
      const { t, as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      respond = () => {
        throw new TypeError("network connection lost");
      };
      const jobId = await as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "A sparkling bathroom", params: {} });
      await settle(t);
      expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "uncertain", errorKind: "uncertain" });
      expect(calls.filter((call) => call.url.includes("images/generations"))).toHaveLength(1);
      expect((await as.query(api.creative.allowance, { companyId })).images).toMatchObject({ used: 1, reserved: 0 });
    });

    it("refuses past the plan's allowance, and lets nothing start once it is reached", async () => {
      const { as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      process.env.MEDIA_IMAGES_PER_MONTH = "1";
      await as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "One", params: {} });
      expect(await refusal(as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "Two", params: {} }))).toMatch(/used this month's 1 image generations/);
      expect(await refusal(as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "Three", params: { n: 2 } }))).toMatch(/used this month's 1/);
    });

    it("keeps real job photos out of generation, and needs marketing permission to compose them", async () => {
      const { t, as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      const visit = await visitWithPhotos(t, as, companyId);
      expect(await as.mutation(api.creative.importJobPhotos, { companyId, jobId: visit.jobId })).toEqual({ added: 2, found: 2 });
      const real = (await as.query(api.creative.library, { companyId, paginationOpts: { numItems: 10, cursor: null } })).page;
      expect(real.every((asset) => asset.realWork && asset.origin === "original")).toBe(true);
      const before = real.find((asset) => asset.label.startsWith("Before"))!;
      const originalBytes = await t.run(async (ctx) => {
        const asset = await ctx.db.get(before.assetId as Id<"mediaAssets">);
        return { storageId: asset!.storageId, size: (await ctx.storage.get(asset!.storageId))!.size };
      });
      expect(await refusal(as.mutation(api.creative.generate, { companyId, kind: "image_edit", prompt: "Make it cleaner", sources: [before.assetId], params: {} }))).toMatch(/real job photo/);
      expect(await refusal(as.mutation(api.creative.generate, { companyId, kind: "video_generate", prompt: "Animate it", sources: [before.assetId], params: {} }))).toMatch(/real job photo/);

      const composed = await t.run((ctx) => ctx.storage.store(new Blob([Uint8Array.from(atob(PNG), (c) => c.charCodeAt(0))], { type: "image/png" })));
      expect(await refusal(as.mutation(api.creative.register, { companyId, storageId: composed, label: "Before/after", kind: "image", composedFrom: real.map((asset) => asset.assetId) }))).toMatch(/without permission/);
      for (const asset of real) await as.mutation(api.creative.grantMarketingPermission, { companyId, assetId: asset.assetId, note: "Customer agreed by email." });
      await as.mutation(api.creative.register, { companyId, storageId: composed, label: "Before/after", kind: "image", composedFrom: real.map((asset) => asset.assetId), layout: JSON.stringify({ format: "1080x1080" }) });
      const library = (await as.query(api.creative.library, { companyId, paginationOpts: { numItems: 10, cursor: null } })).page;
      expect(library.find((asset) => asset.origin === "composed")).toMatchObject({ realWork: true, sources: expect.arrayContaining([before.assetId]) });
      // The original is the same file, unchanged.
      const after = await t.run(async (ctx) => {
        const asset = await ctx.db.get(before.assetId as Id<"mediaAssets">);
        return { storageId: asset!.storageId, size: (await ctx.storage.get(asset!.storageId))!.size };
      });
      expect(after).toEqual(originalBytes);
      // A composition containing real work cannot be sent to a generator either.
      const composition = library.find((asset) => asset.origin === "composed")!;
      expect(await refusal(as.mutation(api.creative.generate, { companyId, kind: "image_edit", prompt: "Brighten", sources: [composition.assetId], params: {} }))).toMatch(/real job photo/);
      expect(calls).toEqual([]);
    });

    it("follows a video by its saved reference, survives repeated polls, and never starts it twice", async () => {
      const { t, as, companyId } = await setup();
      process.env.GEMINI_API_KEY = "test";
      let polls = 0;
      respond = (call) => {
        if (call.method === "POST" && call.url === "https://generativelanguage.googleapis.com/v1beta/interactions") return json(200, { id: "int_7", status: "in_progress" });
        if (call.method === "GET" && call.url.endsWith("/v1beta/interactions/int_7")) return json(200, (polls += 1) < 2 ? { id: "int_7", status: "in_progress" } : { id: "int_7", status: "completed", steps: [{ content: [{ type: "video", data: MP4, mime_type: "video/mp4" }] }] });
        return json(404, {});
      };
      const jobId = await as.mutation(api.creative.generate, { companyId, kind: "video_generate", prompt: "A calm, tidy living room, slow pan", params: { aspectRatio: "9:16", durationSeconds: 6 } });
      await settle(t);
      const job = await t.run((ctx) => ctx.db.get(jobId));
      expect(job).toMatchObject({ state: "completed", providerRef: "int_7", model: "gemini-omni-1.2-flash" });
      expect(JSON.parse(calls[0].body)).toMatchObject({ model: "gemini-omni-1.2-flash", response_format: { type: "video", aspect_ratio: "9:16", duration: "6s" } });
      // A poll arriving after it finished changes nothing and starts nothing.
      await t.action(internal.media.poll, { jobId });
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
      const [video] = (await as.query(api.creative.library, { companyId, paginationOpts: { numItems: 10, cursor: null } })).page;
      expect(video).toMatchObject({ kind: "video", origin: "generated" });
      expect(video.generation?.provenance).toMatch(/SynthID/);
      expect((await as.query(api.creative.allowance, { companyId })).videos).toMatchObject({ used: 1, reserved: 0, limit: 4 });
    });

    it("stops a queued job before anything is sent, and gives its allowance back", async () => {
      const { t, as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      const jobId = await as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "Stop me", params: {} });
      expect(await as.mutation(api.creative.cancel, { companyId, jobId })).toMatchObject({ note: expect.stringMatching(/before anything was sent/) });
      await settle(t);
      expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "cancelled" });
      expect(calls).toEqual([]);
      expect((await as.query(api.creative.allowance, { companyId })).images).toMatchObject({ used: 0, reserved: 0 });
    });

    it("keeps each company's studio to itself, and spending to Owners and Managers", async () => {
      const { t, as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      respond = () => json(200, { data: [{ b64_json: PNG }] });
      const jobId = await as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "Ours", params: {} });
      await settle(t);
      const [mine] = (await as.query(api.creative.library, { companyId, paginationOpts: { numItems: 10, cursor: null } })).page;
      const beta = await company(t, "owner-b", "Beta Cleaning");
      expect((await beta.as.query(api.creative.library, { companyId: beta.companyId, paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
      expect(await refusal(beta.as.mutation(api.creative.generate, { companyId: beta.companyId, kind: "image_edit", prompt: "Steal", sources: [mine.assetId], params: {} }))).toBe(NOT_FOUND);
      expect(await refusal(beta.as.mutation(api.creative.cancel, { companyId: beta.companyId, jobId }))).toBe(NOT_FOUND);
      const office = await addMember(t, as, companyId, "office-a", "office");
      expect(await refusal(office.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "Mine", params: {} }))).toBe(NOT_ALLOWED);
      // The Owner can switch generation off entirely.
      await as.mutation(api.ai.setFeatures, { companyId, imageGeneration: false, videoGeneration: true, photoReview: true, documentSearch: true });
      expect(await refusal(as.mutation(api.creative.generate, { companyId, kind: "image_generate", prompt: "Off", params: {} }))).toMatch(/switched image generation off/);
      expect(await refusal(office.mutation(api.ai.setFeatures, { companyId, imageGeneration: true, videoGeneration: true, photoReview: true, documentSearch: true }))).toBe(NOT_ALLOWED);
    });
  });

  describe("knowledge search", () => {
    it("finds only confirmed knowledge of this company and the asker's own drafts", async () => {
      const { t, as, companyId } = await setup();
      process.env.OPENAI_API_KEY = "test";
      // Embeddings that put every text on the same axis, so everything allowed is a match.
      respond = (call) => {
        if (call.url !== "https://api.openai.com/v1/embeddings") return json(404, {});
        const input = JSON.parse(call.body).input as string[];
        return json(200, { data: input.map((_, index) => ({ index, embedding: Array.from({ length: 1536 }, (__, i) => (i === 0 ? 1 : 0)) })), usage: { prompt_tokens: 12 } });
      };
      const office = await addMember(t, as, companyId, "office-a", "office");
      const beta = await company(t, "owner-b", "Beta Cleaning");
      for (const [who, id, words] of [
        [as, companyId, "Move-out cleans need 48 hours notice."],
        [beta.as, beta.companyId, "BETA SECRET: we never clean on Sundays."],
      ] as const) {
        const proposed = await t.run((ctx) => ctx.db.query("members").collect());
        const member = proposed.find((row) => row.companyId === id && row.role === "owner")!;
        const knowledgeId = await t.run((ctx) => ctx.db.insert("companyKnowledge", { companyId: id, text: words, status: "proposed", proposedBy: member._id, createdAt: NOW }));
        await who.mutation(api.chat.decideKnowledge, { companyId: id, knowledgeId, status: "confirmed" });
      }
      await office.mutation(api.chatArtifacts.create, { companyId, title: "Office's private notes", kind: "other", content: "OFFICE ONLY: draft rota idea." });
      await settle(t);
      expect(await t.run((ctx) => ctx.db.query("knowledgeChunks").collect())).toHaveLength(3);

      mockChat.script = [{ toolCalls: [{ name: "search_company_documents", input: { query: "notice for move-out" } }] }, { text: "Move-outs need 48 hours." }];
      const sent = await as.mutation(api.chat.send, { companyId, text: "What notice do move-outs need?", clientKey: key() });
      await settle(t);
      const view = await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
      expect(Object.values(view.steps)[0]).toMatchObject({ tool: "search_company_documents", status: "done" });
      const shown = JSON.stringify(mockChat.seen.at(-1)!.messages.at(-1));
      expect(shown).toContain("48 hours notice");
      expect(shown).not.toContain("BETA SECRET");
      expect(shown).not.toContain("OFFICE ONLY");
    });
  });

  describe("the OpenRouter stand-in's conversion", () => {
    it("carries text and tool results across, and refuses an action it cannot read", () => {
      const converted = toOpenAi("system words", [
        { role: "user", content: "Make a task" },
        { role: "assistant", content: [{ type: "thinking", thinking: "" }, { type: "text", text: "On it." }, { type: "tool_use", id: "t1", name: "create_task", input: { title: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '{"status":"done"}' }] },
      ]);
      expect(converted).toEqual([
        { role: "system", content: "system words" },
        { role: "user", content: "Make a task" },
        { role: "assistant", content: "On it.", tool_calls: [{ id: "t1", type: "function", function: { name: "create_task", arguments: '{"title":"x"}' } }] },
        { role: "tool", tool_call_id: "t1", content: '{"status":"done"}' },
      ]);
      const reply = fromOpenAi({ model: "m", choices: [{ finish_reason: "tool_calls", message: { content: null, tool_calls: [{ id: "c1", function: { name: "list_tasks", arguments: '{"status":"open"}' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }, "m");
      expect(reply).toMatchObject({ stop: "tool_use", toolCalls: [{ id: "c1", name: "list_tasks", input: { status: "open" } }] });
      expect(() => fromOpenAi({ choices: [{ message: { content: null, tool_calls: [{ id: "c2", function: { name: "create_task", arguments: "{not json" } }] } }] }, "m")).toThrow(ModelError);
      expect(fromOpenAi({ choices: [{ finish_reason: "content_filter", message: { content: "" } }] }, "m").stop).toBe("refusal");
    });
  });
});
