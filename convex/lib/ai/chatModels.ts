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
 * a different model cannot do more than the default.
 *
 * IDs and prices were read from OpenRouter's public model list on 2026-11-16; Claude IDs and prices from
 * Anthropic's model overview.
 */
import type { Doc } from "../../_generated/dataModel";
import { DEFAULT_OPENROUTER_CHAT_MODEL, providerConfigured, REGISTRY, type ModelEntry, type Override } from "./registry";

/** The model makers people may choose from. Icons for each are in src/components/app/chat/model-icons.tsx. */
export const MAKERS = ["anthropic", "openai", "google", "xai", "deepseek", "moonshot"] as const;
export type Maker = (typeof MAKERS)[number];
export const MAKER_NAMES: Record<Maker, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", xai: "xAI", deepseek: "DeepSeek", moonshot: "Moonshot AI" };

/** How expensive a model is to run, in words. Prices themselves are not shown to people choosing. */
export type CostLevel = "Lowest cost" | "Low cost" | "Low to moderate cost" | "Moderate cost" | "Higher cost";

export type ChatModelOption = {
  key: string;
  label: string;
  maker: Maker;
  /** "anthropic": called directly. "openrouter": through OpenRouter. */
  route: "anthropic" | "openrouter";
  entry: ModelEntry;
  cost: CostLevel;
  /** What it is best used for, in a few words. */
  bestFor: string;
};

/**
 * Every listed model reads what a person uploads: PDFs, images and text files. Text files travel as
 * text; images and PDFs as files. OpenAI, Gemini and Grok read PDFs natively. DeepSeek and Kimi take
 * images but not PDFs, so OpenRouter's own text extraction ("pdf-text", which sends nothing to another
 * company) reads a PDF's text layer for them.
 */
const via = (model: string, inputPerMTok: number, outputPerMTok: number, pdfEngine?: "pdf-text"): ModelEntry => ({
  provider: "openrouter",
  model,
  verification: { state: "verified", on: "2026-11-16", how: "OpenRouter public model list (tool calling and image input supported)" },
  rates: { inputPerMTok, outputPerMTok },
  timeoutMs: 120_000,
  ...(pdfEngine ? { pdfEngine } : {}),
});

export const DEFAULT_CHAT_MODEL = "claude-sonnet";

export const CHAT_MODELS: readonly ChatModelOption[] = [
  { key: "claude-sonnet", label: "Claude Sonnet 5.5", maker: "anthropic", route: "anthropic", entry: REGISTRY.chat.primary, cost: "Moderate cost", bestFor: "Best all-round: everyday questions, drafts and actions." },
  { key: "claude-opus", label: "Claude Opus 5.5", maker: "anthropic", route: "anthropic", entry: REGISTRY.reasoning.primary, cost: "Higher cost", bestFor: "Best for hard problems, planning and long documents." },
  { key: "claude-haiku", label: "Claude Haiku 5.5", maker: "anthropic", route: "anthropic", entry: { ...REGISTRY.classify.primary, timeoutMs: 120_000 }, cost: "Low cost", bestFor: "Best for quick answers and simple lookups." },
  { key: "gpt-6.1-sol", label: "GPT-6.1 Sol", maker: "openai", route: "openrouter", entry: via("openai/gpt-6.1-sol", 2, 10), cost: "Moderate cost", bestFor: "Best for writing, analysis and general questions." },
  { key: "gemini-3.8-flash", label: "Gemini 3.8 Flash", maker: "google", route: "openrouter", entry: via("google/gemini-3.8-flash", 0.825, 4.125), cost: "Low to moderate cost", bestFor: "Best for fast answers over long files and photos." },
  { key: "grok-4.7", label: "Grok 4.7", maker: "xai", route: "openrouter", entry: via("x-ai/grok-4.7", 2, 6), cost: "Moderate cost", bestFor: "Best for direct, conversational answers." },
  { key: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", maker: "deepseek", route: "openrouter", entry: via("deepseek/deepseek-v4.1-flash", 0.14, 0.42, "pdf-text"), cost: "Lowest cost", bestFor: "Best for high-volume, routine questions." },
  { key: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", maker: "moonshot", route: "openrouter", entry: via("moonshotai/kimi-k3.1-pro", 0.2403, 8.4023, "pdf-text"), cost: "Low to moderate cost", bestFor: "Best for step-by-step reasoning." },
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
