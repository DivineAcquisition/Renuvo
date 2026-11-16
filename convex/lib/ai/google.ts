/**
 * Google Gemini: uploaded-video understanding (gemini-3.8-flash) and generated video (gemini-omni-1.2-flash),
 * both through the Interactions API, shaped after Google's current documentation (registry.ts).
 *
 *  - Understanding: a video up to 18 MB goes inline; a larger one goes through the Files API (resumable
 *    upload, then wait for ACTIVE). Timestamps are asked for as MM:SS.
 *  - Generation: one interaction per job. Its id is stored before anything else happens, so a job is
 *    polled and reconciled, never started twice. Output arrives inline as base64; Selestial copies it
 *    into its own storage at once.
 *
 * NOT VERIFIED against the live API in this build: no key was available. Response parsing is
 * deliberately tolerant and fails closed (invalid_output) when no video or text is found.
 */
import { aiError } from "./errors";
import { base64ToBytes, bytesToBase64, providerFetch, readJson } from "./http";
import type { ModelEntry } from "./registry";

const BASE = "https://generativelanguage.googleapis.com";
export const INLINE_VIDEO_LIMIT = 18 * 1024 * 1024;

function key(): string {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw aiError("not_configured", "This AI model isn’t available right now.");
  return value;
}
const headers = () => ({ "x-goog-api-key": key(), "Content-Type": "application/json" });

type Part = { type?: string; text?: string; data?: string; mime_type?: string; uri?: string };
export type Interaction = { id?: string; name?: string; status?: string; steps?: { content?: Part[] }[]; outputs?: Part[]; output_video?: { data?: string; mime_type?: string }; error?: { message?: string }; usage?: Record<string, unknown> };

const allParts = (interaction: Interaction): Part[] => [...(interaction.steps ?? []).flatMap((step) => step.content ?? []), ...(interaction.outputs ?? [])];

export function interactionText(interaction: Interaction): string {
  return allParts(interaction)
    .filter((part) => typeof part.text === "string" && (part.type === undefined || part.type === "text"))
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function interactionVideo(interaction: Interaction): { bytes: Uint8Array; mimeType: string } | null {
  if (interaction.output_video?.data) return { bytes: base64ToBytes(interaction.output_video.data), mimeType: interaction.output_video.mime_type ?? "video/mp4" };
  const part = allParts(interaction).find((row) => row.type === "video" && typeof row.data === "string" && row.data.length > 0);
  return part ? { bytes: base64ToBytes(part.data!), mimeType: part.mime_type ?? "video/mp4" } : null;
}

async function uploadFile(model: ModelEntry, bytes: Uint8Array, mimeType: string): Promise<string> {
  const start = await providerFetch("google", `${BASE}/upload/v1beta/files`, {
    method: "POST",
    timeoutMs: 60_000,
    headers: { ...headers(), "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start", "X-Goog-Upload-Header-Content-Length": String(bytes.length), "X-Goog-Upload-Header-Content-Type": mimeType },
    body: JSON.stringify({ file: { display_name: "selestial-upload" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw aiError("invalid_output", "Google did not return an upload address.");
  const done = await providerFetch("google", uploadUrl, { method: "POST", timeoutMs: model.timeoutMs, headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: bytes.slice().buffer });
  const file = (await readJson<{ file?: { uri?: string; name?: string; state?: string } }>(done)).file;
  if (!file?.uri || !file.name) throw aiError("invalid_output", "Google did not return the uploaded file.");
  for (let attempt = 0; attempt < 60 && file.state !== "ACTIVE"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const check = await readJson<{ state?: string }>(await providerFetch("google", `${BASE}/v1beta/${file.name}`, { method: "GET", timeoutMs: 30_000, idempotent: true, headers: headers() }));
    if (check.state === "FAILED") throw aiError("rejected_input", "Google could not process this video.");
    file.state = check.state;
  }
  if (file.state !== "ACTIVE") throw aiError("timeout", "Google took too long to prepare this video.");
  return file.uri;
}

/** What is visible in an uploaded video, with MM:SS timestamps for each point. */
export async function analyzeVideo(model: ModelEntry, input: { prompt: string; bytes: Uint8Array; mimeType: string }): Promise<{ text: string; usage: Record<string, unknown> | null }> {
  const video = input.bytes.length <= INLINE_VIDEO_LIMIT ? { type: "video", data: bytesToBase64(input.bytes), mime_type: input.mimeType } : { type: "video", uri: await uploadFile(model, input.bytes, input.mimeType), mime_type: input.mimeType };
  const response = await providerFetch("google", `${BASE}/v1beta/interactions`, {
    method: "POST",
    timeoutMs: model.timeoutMs,
    headers: headers(),
    body: JSON.stringify({ model: model.model, input: [video, { type: "text", text: input.prompt }] }),
  });
  const interaction = await readJson<Interaction>(response);
  const text = interactionText(interaction);
  if (!text) throw aiError("invalid_output", "Google returned no description of the video.");
  return { text, usage: interaction.usage ?? null };
}

export type VideoRequest = { prompt: string; aspectRatio: "16:9" | "9:16"; durationSeconds: number; resolution?: "720p" | "1080p"; image?: { bytes: Uint8Array; mimeType: string } };

/** Starts a generated video. The interaction id is the job's provider reference from here on. */
export async function startVideo(model: ModelEntry, input: VideoRequest): Promise<Interaction> {
  const parts: Part[] = [{ type: "text", text: input.prompt }];
  if (input.image) parts.unshift({ type: "image", data: bytesToBase64(input.image.bytes), mime_type: input.image.mimeType });
  const response = await providerFetch("google", `${BASE}/v1beta/interactions`, {
    method: "POST",
    timeoutMs: model.timeoutMs,
    headers: headers(),
    body: JSON.stringify({ model: model.model, input: parts, response_format: { type: "video", aspect_ratio: input.aspectRatio, resolution: input.resolution ?? "720p", duration: `${input.durationSeconds}s` } }),
  });
  return readJson<Interaction>(response);
}

/** Reads a generation's state. Safe to repeat: it changes nothing. */
export async function readVideo(id: string): Promise<Interaction> {
  if (!/^[\w./-]{1,200}$/.test(id)) throw aiError("rejected_input", "The provider reference is not valid.");
  const response = await providerFetch("google", `${BASE}/v1beta/interactions/${encodeURIComponent(id)}`, { method: "GET", timeoutMs: 60_000, idempotent: true, headers: headers() });
  return readJson<Interaction>(response);
}

export function interactionId(interaction: Interaction): string | null {
  return interaction.id ?? interaction.name ?? null;
}

/** "completed", "failed", or still working. */
export function interactionState(interaction: Interaction): "completed" | "failed" | "working" {
  const status = (interaction.status ?? "").toLowerCase();
  if (interaction.error || status === "failed" || status === "cancelled") return "failed";
  if (status === "completed" || status === "succeeded" || interactionVideo(interaction)) return "completed";
  return "working";
}
