/**
 * The model behind Company Chat, chosen by the deployment's settings:
 *  - CHAT_MODEL=mock: a scripted model for tests (no network, no key).
 *  - CHAT_MODEL=off, or no ANTHROPIC_API_KEY: no model. Chat says so; it never writes a canned answer.
 *  - otherwise, with ANTHROPIC_API_KEY set: Claude (claude.ts).
 *
 * A model only ever returns text and tool calls. It writes nothing: tools do, after their own checks.
 */
import { openRouterChatModel } from "../ai/openrouter";
import { chatModelOption, DEFAULT_CHAT_MODEL } from "../ai/chatModels";
import { providerConfigured, REGISTRY, resolve, type Override } from "../ai/registry";
import { claudeChatModel } from "./claude";

/** One message in the provider's own shape. The run loop appends the model's own content unchanged. */
export type ModelMessage = { role: "user" | "assistant"; content: unknown };

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };

export type ToolCall = { id: string; name: string; input: unknown };

export type ModelReply = {
  /** end: answered. tool_use: wants tools run. max_tokens: cut off. refusal: declined. */
  stop: "end" | "tool_use" | "max_tokens" | "refusal";
  text: string;
  toolCalls: ToolCall[];
  /** The assistant turn exactly as returned, to send back on the next request in this run. */
  content: unknown;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
};

export type ModelRequest = {
  system: string;
  messages: ModelMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
  onText: (delta: string) => void;
};

export interface ChatModel {
  name: string;
  respond(request: ModelRequest): Promise<ModelReply>;
  /** The user-turn message that carries tool results back. */
  toolResults(results: { id: string; content: string; isError: boolean }[]): ModelMessage;
}

/** A failure a person can be told about in plain words. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    /** True only for an outage or a rate limit: another allowed provider may continue. Never for a refusal. */
    readonly fallbackEligible = false,
  ) {
    super(message);
  }
}

// ── The scripted model for tests ─────────────────────────────────────────────────────────────────

export type MockTurn = { text?: string; toolCalls?: { name: string; input: unknown }[]; stop?: "refusal" | "max_tokens"; error?: string; outage?: boolean };

/** What the mock model answers, turn by turn, and what it was shown. Tests set `script`. */
export const mockChat: { script: MockTurn[]; seen: { system: string; messages: ModelMessage[]; tools: string[] }[]; onRespond: (() => void | Promise<void>) | null; fallbackScript: MockTurn[]; fallbackSeen: { system: string; messages: ModelMessage[]; tools: string[] }[] } = { script: [], seen: [], onRespond: null, fallbackScript: [], fallbackSeen: [] };

let mockCounter = 0;

const mock: ChatModel = {
  name: "mock",
  async respond(request) {
    mockChat.seen.push({ system: request.system, messages: JSON.parse(JSON.stringify(request.messages)), tools: request.tools.map((tool) => tool.name) });
    if (mockChat.onRespond) await mockChat.onRespond();
    const turn = mockChat.script.shift() ?? { text: "Mock answer." };
    if (turn.error) throw new ModelError(turn.error, true, Boolean(turn.outage));
    const text = turn.text ?? "";
    // Delivered in pieces, the way a stream arrives.
    for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) request.onText(piece);
    const toolCalls = (turn.toolCalls ?? []).map((call) => ({ id: `mock_tool_${(mockCounter += 1)}`, name: call.name, input: call.input }));
    const content = [...(text ? [{ type: "text", text }] : []), ...toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.input }))];
    return { stop: turn.stop ?? (toolCalls.length ? "tool_use" : "end"), text, toolCalls, content, usage: { inputTokens: 100, outputTokens: 20 }, model: "mock" };
  },
  toolResults(results) {
    return { role: "user", content: results.map((result) => ({ type: "tool_result", tool_use_id: result.id, content: result.content, is_error: result.isError })) };
  },
};

export type ModelChoice = { model: ChatModel; label: string; fallback: { model: ChatModel; label: string } | null } | { model: null; why: string };

/**
 * The chat model for one run. `key` is the person's choice from lib/ai/chatModels.ts (unset: Claude
 * Sonnet 5.5); `override` is the platform administrators' setting for chat as a whole.
 *  - A Claude model is called directly. On an outage or rate limit, OpenRouter continues (Claude Sonnet
 *    5.5 through OpenRouter unless OPENROUTER_CHAT_MODEL names another).
 *  - Any other model goes through OpenRouter. On an outage or rate limit, Claude Sonnet 5.5 continues
 *    directly, when Anthropic is connected.
 * Never after a refusal. Under CHAT_MODEL=mock the scripted model answers whatever was chosen.
 */
export function chatModel(override?: Override | null, key?: string | null): ModelChoice {
  const choice = process.env.CHAT_MODEL?.trim().toLowerCase();
  const option = chatModelOption(key) ?? chatModelOption(DEFAULT_CHAT_MODEL)!;
  if (choice === "mock") return { model: mock, label: option.key === DEFAULT_CHAT_MODEL ? "mock" : `mock:${option.key}`, fallback: process.env.CHAT_MOCK_FALLBACK === "1" ? { model: mockFallback, label: "mock-fallback" } : null };
  if (choice === "off") return { model: null, why: "Company Chat's model is switched off on this deployment." };
  const resolved = resolve("chat", override);
  if (!resolved.ready && resolved.reason !== "not_configured") return { model: null, why: resolved.words };
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (option.route === "openrouter") {
    if (!providerConfigured("openrouter")) return { model: null, why: `${option.label} is not connected on this deployment yet. An administrator needs to set OPENROUTER_API_KEY.` };
    return {
      model: openRouterChatModel(option.entry),
      label: `openrouter:${option.entry.model}`,
      fallback: anthropicKey ? { model: claudeChatModel(anthropicKey, REGISTRY.chat.primary), label: `anthropic:${REGISTRY.chat.primary.model}` } : null,
    };
  }
  if (!resolved.ready || !anthropicKey) return { model: null, why: "No model is connected to Company Chat on this deployment yet, so no answer was written. An administrator needs to set ANTHROPIC_API_KEY." };
  const backup = resolved.fallbacks.find((row) => row.provider === "openrouter");
  return {
    model: claudeChatModel(anthropicKey, option.entry),
    label: `${option.entry.provider}:${option.entry.model}`,
    fallback: backup ? { model: openRouterChatModel(backup), label: `openrouter:${backup.model}` } : null,
  };
}

/** A second scripted model for tests of the outage stand-in. It answers from `mockChat.fallbackScript`. */
const mockFallback: ChatModel = {
  name: "mock-fallback",
  async respond(request) {
    mockChat.fallbackSeen.push({ system: request.system, messages: JSON.parse(JSON.stringify(request.messages)), tools: request.tools.map((tool) => tool.name) });
    const turn = mockChat.fallbackScript.shift() ?? { text: "Backup answer." };
    const text = turn.text ?? "";
    if (text) request.onText(text);
    const toolCalls = (turn.toolCalls ?? []).map((call) => ({ id: `mock_fb_${(mockCounter += 1)}`, name: call.name, input: call.input }));
    const content = [...(text ? [{ type: "text", text }] : []), ...toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.input }))];
    return { stop: toolCalls.length ? "tool_use" : "end", text, toolCalls, content, usage: { inputTokens: 50, outputTokens: 10 }, model: "mock-fallback" };
  },
  toolResults: (results) => mock.toolResults(results),
};
