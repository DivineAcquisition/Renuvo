/**
 * The model behind Company Chat, chosen by the deployment's settings:
 *  - CHAT_MODEL=mock: a scripted model for tests (no network, no key).
 *  - CHAT_MODEL=off, or no ANTHROPIC_API_KEY: no model. Chat says so; it never writes a canned answer.
 *  - otherwise, with ANTHROPIC_API_KEY set: Claude (claude.ts).
 *
 * A model only ever returns text and tool calls. It writes nothing: tools do, after their own checks.
 */
import { openRouterChatModel } from "../ai/openrouter";
import { resolve, type Override } from "../ai/registry";
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
 * The chat model, from the registry (lib/ai/registry.ts): Claude Sonnet 5.5 by default. With an
 * OpenRouter key and OPENROUTER_CHAT_MODEL set, OpenRouter is the stand-in for outages and rate limits.
 * `override` is the platform administrator's setting for the chat capability, if any.
 */
export function chatModel(override?: Override | null): ModelChoice {
  const choice = process.env.CHAT_MODEL?.trim().toLowerCase();
  if (choice === "mock") return { model: mock, label: "mock", fallback: process.env.CHAT_MOCK_FALLBACK === "1" ? { model: mockFallback, label: "mock-fallback" } : null };
  if (choice === "off") return { model: null, why: "Company Chat's model is switched off on this deployment." };
  const resolved = resolve("chat", override);
  if (!resolved.ready) return { model: null, why: resolved.reason === "not_configured" ? "No model is connected to Company Chat on this deployment yet, so no answer was written. An administrator needs to set ANTHROPIC_API_KEY." : resolved.words };
  const backup = resolved.fallbacks.find((row) => row.provider === "openrouter");
  return {
    model: claudeChatModel(process.env.ANTHROPIC_API_KEY!.trim(), resolved.model),
    label: `${resolved.model.provider}:${resolved.model.model}`,
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
