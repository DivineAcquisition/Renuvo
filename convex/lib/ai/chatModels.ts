/**
 * The models a person may choose for Company Chat. This list is the whole of what can be chosen: a
 * client sends only a key from it, never a model ID, so nobody can point chat at an arbitrary model.
 *
 * Claude models are called directly with Anthropic's key. The others go through OpenRouter, with
 * `data_collection: "deny"`, so only hosts that do not keep or train on the data are used. A model is
 * offered only while:
 *  - Selestial staff have not switched it off (chatModelSettings);
 *  - its provider's key is set on the deployment;
 *  - for a model outside Anthropic, the company's Owner allows other chat models (aiFeatures).
 *
 * Every model gets the same instructions and the same tools, and every tool keeps its own checks, so
 * a different model cannot do more than the default. Only Claude models read attached PDFs and images:
 * the conversion to OpenRouter's format names an attachment and does not send it.
 *
 * IDs and prices were read from OpenRouter's public model list on 2026-11-16; Claude IDs and prices from
 * Anthropic's model overview.
 */
import type { Doc } from "../../_generated/dataModel";
import { DEFAULT_OPENROUTER_CHAT_MODEL, providerConfigured, REGISTRY, type ModelEntry, type Override } from "./registry";

export type ChatModelOption = {
  key: string;
  label: string;
  /** Who made the model, in a person's words. */
  maker: string;
  /** "anthropic": called directly. "openrouter": through OpenRouter. */
  route: "anthropic" | "openrouter";
  entry: ModelEntry;
  /** Whether attached PDFs and images reach the model. */
  readsFiles: boolean;
  /** One plain line on what it is good for. */
  blurb: string;
};

const via = (model: string, inputPerMTok: number, outputPerMTok: number, timeoutMs = 120_000): ModelEntry => ({
  provider: "openrouter",
  model,
  verification: { state: "verified", on: "2026-11-16", how: "OpenRouter public model list (tool calling supported)" },
  rates: { inputPerMTok, outputPerMTok },
  timeoutMs,
});

export const DEFAULT_CHAT_MODEL = "claude-sonnet";

export const CHAT_MODELS: readonly ChatModelOption[] = [
  { key: "claude-sonnet", label: "Claude Sonnet 5.5", maker: "Anthropic", route: "anthropic", entry: REGISTRY.chat.primary, readsFiles: true, blurb: "Selestial's default. Balanced, careful with actions." },
  { key: "claude-opus", label: "Claude Opus 5.5", maker: "Anthropic", route: "anthropic", entry: REGISTRY.reasoning.primary, readsFiles: true, blurb: "Deeper reasoning for hard questions. Slower, costs more." },
  { key: "claude-haiku", label: "Claude Haiku 5.5", maker: "Anthropic", route: "anthropic", entry: { ...REGISTRY.classify.primary, timeoutMs: 120_000 }, readsFiles: true, blurb: "Fastest Claude for quick questions." },
  { key: "gpt-6.1-sol", label: "GPT-6.1 Sol", maker: "OpenAI", route: "openrouter", entry: via("openai/gpt-6.1-sol", 2, 10), readsFiles: false, blurb: "OpenAI's general model." },
  { key: "gemini-3.8-flash", label: "Gemini 3.8 Flash", maker: "Google", route: "openrouter", entry: via("google/gemini-3.8-flash", 0.825, 4.125), readsFiles: false, blurb: "Google's fast model." },
  { key: "grok-4.7", label: "Grok 4.7", maker: "xAI", route: "openrouter", entry: via("x-ai/grok-4.7", 2, 6), readsFiles: false, blurb: "xAI's general model." },
  { key: "mistral-large-4", label: "Mistral Large 4", maker: "Mistral", route: "openrouter", entry: via("mistralai/mistral-large-4-0", 0.7, 2.1), readsFiles: false, blurb: "Mistral's largest model." },
  { key: "qwen4-max", label: "Qwen4 Max", maker: "Alibaba", route: "openrouter", entry: via("qwen/qwen4-max", 1.5, 4.5), readsFiles: false, blurb: "Alibaba's largest model." },
  { key: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", maker: "DeepSeek", route: "openrouter", entry: via("deepseek/deepseek-v4.1-flash", 0.14, 0.42), readsFiles: false, blurb: "Low-cost and quick." },
  { key: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", maker: "Moonshot AI", route: "openrouter", entry: via("moonshotai/kimi-k3.1-pro", 0.2403, 8.4023), readsFiles: false, blurb: "Moonshot's reasoning model." },
];

export function chatModelOption(key: string | null | undefined): ChatModelOption | null {
  return CHAT_MODELS.find((row) => row.key === (key ?? DEFAULT_CHAT_MODEL)) ?? null;
}

/** The catalog entry behind a model ID that answered, for pricing usage. Covers the outage stand-in too. */
export function chatEntryFor(provider: string, model: string): ModelEntry | null {
  const listed = CHAT_MODELS.find((row) => row.entry.provider === provider && row.entry.model === model);
  if (listed) return listed.entry;
  if (provider === "openrouter" && model === DEFAULT_OPENROUTER_CHAT_MODEL) return { ...REGISTRY.chat.primary, provider: "openrouter", model };
  return null;
}

export type ChatModelState = { available: true } | { available: false; why: string };

/**
 * Whether this company may use this model now. `staffOff` holds the keys Selestial staff switched off;
 * `chat` is staff's setting for chat as a whole.
 */
export function chatModelState(option: ChatModelOption, company: Doc<"companies">, staffOff: ReadonlySet<string>, chat: Override | null): ChatModelState {
  if (chat && !chat.enabled) return { available: false, why: "Company Chat is switched off for Selestial right now." };
  if (staffOff.has(option.key)) return { available: false, why: `${option.label} is switched off by Selestial right now.` };
  if (option.route === "openrouter" && company.aiFeatures?.otherChatModels === false) return { available: false, why: "Your Owner has turned off models from other providers. Settings › AI & usage." };
  if (!providerConfigured(option.entry.provider)) return { available: false, why: `${option.label} is not connected on this deployment yet.` };
  return { available: true };
}
