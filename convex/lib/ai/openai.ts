/**
 * OpenAI: image generation and editing (Images API) and embeddings. Raw HTTPS through providerFetch,
 * shaped after OpenAI's current documentation (registry.ts records when it was read). Images come back
 * as base64 bytes, never as a link Selestial would have to fetch.
 *
 * NOT VERIFIED against the live API in this build: no key was available.
 */
import { aiError } from "./errors";
import { base64ToBytes, providerFetch, readJson } from "./http";
import type { ModelEntry } from "./registry";

const BASE = "https://api.openai.com/v1";

function key(): string {
  const value = process.env.OPENAI_API_KEY?.trim();
  if (!value) throw aiError("not_configured", "OpenAI is not connected on this deployment (OPENAI_API_KEY).");
  return value;
}

export type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";
export type ImageResult = { images: { bytes: Uint8Array; mimeType: string }[]; usage: Record<string, unknown> | null; revisedPrompt: string | null };

type ImagesResponse = { data?: { b64_json?: string; revised_prompt?: string }[]; usage?: Record<string, unknown> };

function images(body: ImagesResponse, format: string): ImageResult {
  const data = body.data ?? [];
  const out = data.filter((row) => typeof row.b64_json === "string" && row.b64_json.length > 0).map((row) => ({ bytes: base64ToBytes(row.b64_json!), mimeType: `image/${format === "jpeg" ? "jpeg" : format}` }));
  if (out.length === 0) throw aiError("invalid_output", "The image provider returned no image.");
  return { images: out, usage: body.usage ?? null, revisedPrompt: data[0]?.revised_prompt ?? null };
}

/**
 * One generation request. Not retried: if the answer is lost, the provider may still have made (and
 * billed) the image, so the job is marked uncertain instead of being sent again.
 */
export async function generateImage(model: ModelEntry, input: { prompt: string; size: ImageSize; quality?: "low" | "medium" | "high"; format?: "png" | "jpeg" | "webp"; n?: number; safetyIdentifier?: string }): Promise<ImageResult> {
  const format = input.format ?? "png";
  const response = await providerFetch("openai", `${BASE}/images/generations`, {
    method: "POST",
    timeoutMs: model.timeoutMs,
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.model, prompt: input.prompt, size: input.size, quality: input.quality ?? "high", output_format: format, n: input.n ?? 1, safety_identifier: input.safetyIdentifier }),
  });
  return images(await readJson<ImagesResponse>(response), format);
}

/** An edit of images Selestial supplies (multipart). Real job photos are never sent here: see creative.ts. */
export async function editImage(model: ModelEntry, input: { prompt: string; size: ImageSize; images: { bytes: Uint8Array; mimeType: string; name: string }[]; format?: "png" | "jpeg" | "webp"; safetyIdentifier?: string }): Promise<ImageResult> {
  const format = input.format ?? "png";
  const form = new FormData();
  form.set("model", model.model);
  form.set("prompt", input.prompt);
  form.set("size", input.size);
  form.set("output_format", format);
  if (input.safetyIdentifier) form.set("safety_identifier", input.safetyIdentifier);
  for (const image of input.images) form.append("image[]", new Blob([image.bytes.slice().buffer], { type: image.mimeType }), image.name);
  const response = await providerFetch("openai", `${BASE}/images/edits`, { method: "POST", timeoutMs: model.timeoutMs, headers: { Authorization: `Bearer ${key()}` }, body: form });
  return images(await readJson<ImagesResponse>(response), format);
}

type EmbeddingsResponse = { data?: { embedding?: number[]; index?: number }[]; usage?: { prompt_tokens?: number; total_tokens?: number } };

/** Embeddings for up to 64 texts. Safe to retry: it changes nothing. */
export async function embed(model: ModelEntry, texts: string[]): Promise<{ vectors: number[][]; inputTokens: number }> {
  if (texts.length === 0) return { vectors: [], inputTokens: 0 };
  if (texts.length > 64) throw aiError("rejected_input", "Too many texts to embed at once.");
  const response = await providerFetch("openai", `${BASE}/embeddings`, {
    method: "POST",
    timeoutMs: model.timeoutMs,
    idempotent: true,
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.model, input: texts.map((text) => text.slice(0, 24_000)) }),
  });
  const body = await readJson<EmbeddingsResponse>(response);
  const rows = (body.data ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== texts.length || rows.some((row) => !Array.isArray(row.embedding) || row.embedding.length !== EMBEDDING_DIMENSIONS)) throw aiError("invalid_output", "The embedding provider's answer did not match what was asked.");
  return { vectors: rows.map((row) => row.embedding!), inputTokens: body.usage?.prompt_tokens ?? 0 };
}

export const EMBEDDING_DIMENSIONS = 1536;
