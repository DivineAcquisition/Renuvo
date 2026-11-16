/**
 * Which model answers which kind of work (docs/ai/00-architecture.md). Screens never name a model: they
 * ask for a capability, and this registry says who serves it, whether that is verified and configured,
 * and what may stand in when the first choice is down.
 *
 * Every entry records how it was checked. "verified" means the model ID and endpoint were read in the
 * provider's current documentation on the date given. It does not mean a live call succeeded: no
 * provider key was available in the build environment (see docs/ai/02-status.md).
 *
 * Rates are USD per million tokens from the provider's published list on the verification date, used
 * only for estimates. A null rate is unknown and shown as unknown, never as zero.
 */

export const PROVIDERS = ["anthropic", "openai", "google", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The environment variable that holds each provider's key, on the Convex deployment only. */
export const PROVIDER_KEYS: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export const PROVIDER_NAMES: Record<Provider, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", openrouter: "OpenRouter" };

/** The only hosts the AI layer may call. Output downloads are limited to the same list. */
export const PROVIDER_HOSTS: Record<Provider, readonly string[]> = {
  anthropic: ["api.anthropic.com"],
  openai: ["api.openai.com"],
  google: ["generativelanguage.googleapis.com"],
  openrouter: ["openrouter.ai"],
};

export const CAPABILITIES = [
  "chat",
  "reasoning",
  "classify",
  "image_understanding",
  "video_understanding",
  "image_generate",
  "image_edit",
  "image_fast",
  "video_generate",
  "embed",
  "video_edit",
  "transcribe",
  "speech",
  "document_ocr",
  "rerank",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export type Rates = { inputPerMTok: number | null; outputPerMTok: number | null; cacheReadPerMTok?: number | null; perImage?: number | null; perVideoSecond?: number | null };

export type ModelEntry = {
  provider: Provider;
  /** The provider's own model ID. An OpenRouter or fal ID is not interchangeable with a direct one. */
  model: string;
  apiVersion?: string;
  verification: { state: "verified" | "unverified"; on: string | null; how: string };
  rates: Rates;
  timeoutMs: number;
};

export type CapabilityEntry = {
  capability: Capability;
  label: string;
  /** Optional capabilities are off until a feature needs them and an adapter, key, terms and tests exist. */
  optional: boolean;
  /** Whether Selestial has code that can call it. An optional capability without one is never shown as connected. */
  implemented: boolean;
  primary: ModelEntry;
  /**
   * What may answer instead, and only for these failures. Never for a refusal or a processing
   * restriction: a different model is not a way around a "no".
   */
  fallbacks: (ModelEntry & { when: readonly ("outage" | "rate_limit")[] })[];
  inputs: readonly string[];
  outputs: readonly string[];
  aspectRatios?: readonly string[];
  durations?: readonly string[];
  editModes?: readonly string[];
  formats?: readonly string[];
  cancellation: "stops_stream" | "provider_finishes_and_bills" | "not_applicable";
  dataNote: string;
};

const VERIFIED_ON = "2026-11-16";
const docs = (how: string): ModelEntry["verification"] => ({ state: "verified", on: VERIFIED_ON, how });
const unverified = (how: string): ModelEntry["verification"] => ({ state: "unverified", on: null, how });

const SONNET: ModelEntry = { provider: "anthropic", model: "claude-sonnet-5-5", verification: docs("Anthropic model overview and SDK reference"), rates: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1 }, timeoutMs: 120_000 };
const HAIKU: ModelEntry = { provider: "anthropic", model: "claude-haiku-5-5", verification: docs("Anthropic model overview"), rates: { inputPerMTok: 0.1, outputPerMTok: 0.5 }, timeoutMs: 60_000 };
const OPUS: ModelEntry = { provider: "anthropic", model: "claude-opus-5-5", verification: docs("Anthropic model overview"), rates: { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 }, timeoutMs: 180_000 };

/**
 * OpenRouter answers chat when the chosen model's own provider is down or rate limited (never after a
 * refusal). The default stand-in is Claude Sonnet 5.5 through OpenRouter, which can reach it through
 * other hosts when Anthropic's own API is down; OPENROUTER_CHAT_MODEL names a different one. The ID was
 * read from OpenRouter's public model list on 2026-11-16.
 */
export const DEFAULT_OPENROUTER_CHAT_MODEL = "anthropic/claude-sonnet-5.5";
export function openRouterChatModel(): ModelEntry | null {
  const model = process.env.OPENROUTER_CHAT_MODEL?.trim() || DEFAULT_OPENROUTER_CHAT_MODEL;
  const known = model === DEFAULT_OPENROUTER_CHAT_MODEL;
  return {
    provider: "openrouter",
    model,
    verification: known ? docs("OpenRouter public model list") : unverified("Set by the deployment; confirm the ID in OpenRouter's model list"),
    rates: known ? { inputPerMTok: 2, outputPerMTok: 10 } : { inputPerMTok: null, outputPerMTok: null },
    timeoutMs: 120_000,
  };
}

export const REGISTRY: Record<Capability, CapabilityEntry> = {
  chat: {
    capability: "chat",
    label: "Company chat and agent reasoning",
    optional: false,
    implemented: true,
    primary: SONNET,
    fallbacks: [],
    inputs: ["text", "image", "pdf", "tools"],
    outputs: ["text", "tool calls"],
    cancellation: "stops_stream",
    dataNote: "Anthropic. With OPENROUTER_CHAT_MODEL set, OpenRouter may continue a reply when Anthropic is down; tool results already carried out go with it and are never repeated.",
  },
  reasoning: {
    capability: "reasoning",
    label: "Difficult planning and synthesis",
    optional: true,
    implemented: true,
    primary: OPUS,
    fallbacks: [],
    inputs: ["text", "image", "pdf", "tools"],
    outputs: ["text"],
    cancellation: "stops_stream",
    dataNote: "Anthropic. Off until an owner turns on deeper answers; budgeted per run.",
  },
  classify: {
    capability: "classify",
    label: "Routine classification and extraction",
    optional: false,
    implemented: true,
    primary: HAIKU,
    fallbacks: [],
    inputs: ["text"],
    outputs: ["structured JSON"],
    cancellation: "not_applicable",
    dataNote: "Anthropic. Recruiter's hiring-mail reader; the rules reader answers whenever the model cannot.",
  },
  image_understanding: {
    capability: "image_understanding",
    label: "Photo understanding",
    optional: false,
    implemented: true,
    primary: SONNET,
    fallbacks: [],
    inputs: ["image"],
    outputs: ["structured JSON"],
    cancellation: "not_applicable",
    dataNote: "Anthropic. Job evidence photos stay in Selestial storage and are sent only for the review asked for.",
  },
  video_understanding: {
    capability: "video_understanding",
    label: "Uploaded video understanding",
    optional: false,
    implemented: true,
    primary: { provider: "google", model: "gemini-3.8-flash", verification: docs("Gemini 3.8 Flash model page and video understanding guide (Interactions API)"), rates: { inputPerMTok: null, outputPerMTok: null }, timeoutMs: 300_000 },
    fallbacks: [],
    inputs: ["video/mp4", "video/mov", "video/webm", "video/mpeg"],
    outputs: ["text with MM:SS timestamps"],
    cancellation: "not_applicable",
    dataNote: "Google. Videos over 18 MB go through Google's Files API, which keeps them for a limited time.",
  },
  image_generate: {
    capability: "image_generate",
    label: "Detailed image creation",
    optional: false,
    implemented: true,
    primary: { provider: "openai", model: "gpt-image-2.6-sunburst", verification: docs("OpenAI image generation guide: /v1/images/generations, b64_json output"), rates: { inputPerMTok: null, outputPerMTok: null, perImage: null }, timeoutMs: 180_000 },
    fallbacks: [],
    inputs: ["text"],
    outputs: ["png", "jpeg", "webp"],
    aspectRatios: ["1024x1024", "1536x1024", "1024x1536"],
    formats: ["png", "jpeg", "webp"],
    cancellation: "provider_finishes_and_bills",
    dataNote: "OpenAI. The prompt is sent; no job photo is sent for a generated image.",
  },
  image_edit: {
    capability: "image_edit",
    label: "Image editing",
    optional: false,
    implemented: true,
    primary: { provider: "openai", model: "gpt-image-2.6-sunburst", verification: docs("OpenAI image generation guide: /v1/images/edits multipart"), rates: { inputPerMTok: null, outputPerMTok: null, perImage: null }, timeoutMs: 180_000 },
    fallbacks: [],
    inputs: ["text", "image"],
    outputs: ["png", "jpeg", "webp"],
    aspectRatios: ["1024x1024", "1536x1024", "1024x1536"],
    editModes: ["prompt edit of a chosen image"],
    formats: ["png", "jpeg", "webp"],
    cancellation: "provider_finishes_and_bills",
    dataNote: "OpenAI. Real job photos are never sent for editing: an edit of a real photo would no longer be evidence.",
  },
  image_fast: {
    capability: "image_fast",
    label: "Fast image variants",
    optional: false,
    implemented: true,
    primary: { provider: "openai", model: "gpt-image-2.6-flare", verification: docs("OpenAI image generation guide (edit example names gpt-image-2.6-flare)"), rates: { inputPerMTok: null, outputPerMTok: null, perImage: null }, timeoutMs: 120_000 },
    fallbacks: [],
    inputs: ["text"],
    outputs: ["png", "jpeg", "webp"],
    aspectRatios: ["1024x1024", "1536x1024", "1024x1536"],
    formats: ["png", "jpeg", "webp"],
    cancellation: "provider_finishes_and_bills",
    dataNote: "OpenAI.",
  },
  video_generate: {
    capability: "video_generate",
    label: "Generated video",
    optional: false,
    implemented: true,
    primary: { provider: "google", model: "gemini-omni-1.2-flash", verification: docs("Gemini Omni docs: POST /v1beta/interactions, response_format video"), rates: { inputPerMTok: null, outputPerMTok: null, perVideoSecond: null }, timeoutMs: 600_000 },
    fallbacks: [],
    inputs: ["text", "image"],
    outputs: ["video/mp4"],
    aspectRatios: ["16:9", "9:16"],
    durations: ["4s", "6s", "8s", "10s"],
    formats: ["mp4"],
    cancellation: "provider_finishes_and_bills",
    dataNote: "Google. Every generated video carries Google's SynthID watermark, and Selestial labels it as generated.",
  },
  embed: {
    capability: "embed",
    label: "Knowledge search embeddings",
    optional: false,
    implemented: true,
    primary: { provider: "openai", model: "text-embedding-3-small", verification: docs("OpenAI embeddings API (1536 dimensions)"), rates: { inputPerMTok: 0.02, outputPerMTok: null }, timeoutMs: 30_000 },
    fallbacks: [],
    inputs: ["text"],
    outputs: ["1536-dimension vector"],
    cancellation: "not_applicable",
    dataNote: "OpenAI. Only confirmed company knowledge and a member's own drafts are embedded.",
  },
  // ── Optional extensions: contracts only, off by default, never shown as connected ──
  video_edit: optionalEntry("video_edit", "Editing existing video", { provider: "google", model: "gemini-omni-1.2-flash" }, "Runway Aleph 2.0 or Gemini Omni edit mode. No adapter yet."),
  transcribe: optionalEntry("transcribe", "Recorded-audio transcription", { provider: "openai", model: "unset" }, "ElevenLabs scribe_v3 candidate. No adapter yet."),
  speech: optionalEntry("speech", "Narration", { provider: "openai", model: "unset" }, "ElevenLabs eleven_v4 candidate. No adapter yet."),
  document_ocr: optionalEntry("document_ocr", "Scanned-document OCR", { provider: "openai", model: "unset" }, "Mistral OCR 4.1 candidate. PDFs with a text layer are read by Claude without OCR. No adapter yet."),
  rerank: optionalEntry("rerank", "Search reranking", { provider: "openai", model: "unset" }, "Voyage rerank-3-lite candidate. Would reorder only already-authorized results. No adapter yet."),
};

function optionalEntry(capability: Capability, label: string, model: { provider: Provider; model: string }, note: string): CapabilityEntry {
  return {
    capability,
    label,
    optional: true,
    implemented: false,
    primary: { ...model, verification: unverified("Not implemented"), rates: { inputPerMTok: null, outputPerMTok: null }, timeoutMs: 60_000 },
    fallbacks: [],
    inputs: [],
    outputs: [],
    cancellation: "not_applicable",
    dataNote: note,
  };
}

export function providerConfigured(provider: Provider): boolean {
  return Boolean(process.env[PROVIDER_KEYS[provider]]?.trim());
}

export type Override = { enabled: boolean; evaluation: "not_evaluated" | "evaluating" | "approved" | "rejected" };

export type Resolved =
  | { ready: true; entry: CapabilityEntry; model: ModelEntry; fallbacks: ModelEntry[] }
  | { ready: false; entry: CapabilityEntry; reason: "not_implemented" | "disabled" | "not_configured"; words: string };

/**
 * Who serves a capability right now. An optional capability is on only when an administrator turned it
 * on; any capability is off when an administrator turned it off; none is "ready" without its key.
 */
export function resolve(capability: Capability, override?: Override | null): Resolved {
  const entry = REGISTRY[capability];
  if (!entry.implemented) return { ready: false, entry, reason: "not_implemented", words: `${entry.label} is not built in Selestial yet.` };
  const enabled = override ? override.enabled : !entry.optional;
  if (!enabled) return { ready: false, entry, reason: "disabled", words: `${entry.label} is switched off for Selestial right now.` };
  if (!providerConfigured(entry.primary.provider)) {
    return { ready: false, entry, reason: "not_configured", words: `${entry.label} needs ${PROVIDER_NAMES[entry.primary.provider]}, which is not connected on this deployment (${PROVIDER_KEYS[entry.primary.provider]}).` };
  }
  const extra = capability === "chat" ? [openRouterChatModel()].filter((row): row is ModelEntry => row !== null) : [];
  const fallbacks = [...entry.fallbacks, ...extra].filter((row) => providerConfigured(row.provider));
  return { ready: true, entry, model: entry.primary, fallbacks };
}

/** An estimate in micro-dollars from published token rates. Null when a rate is unknown. */
export function estimateMicros(model: ModelEntry, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number }): number | null {
  const { inputPerMTok, outputPerMTok, cacheReadPerMTok } = model.rates;
  if (inputPerMTok === null || (usage.outputTokens && outputPerMTok === null)) return null;
  const micros = (usage.inputTokens ?? 0) * inputPerMTok + (usage.outputTokens ?? 0) * (outputPerMTok ?? 0) + (usage.cacheReadTokens ?? 0) * (cacheReadPerMTok ?? inputPerMTok);
  return Math.round(micros);
}
