/**
 * Reading a receipt with the photo-understanding model (convex/lib/ai/registry.ts). Tests replace the
 * model call with a stand-in, the same way they replace Stripe, so no test ever reaches a provider.
 */
import { readReceipt, type ReceiptFile, type ReceiptReading } from "../ai/anthropic";
import { AiError } from "../ai/errors";
import { resolve, type ModelEntry } from "../ai/registry";

export type ReadOutcome =
  | { ok: true; reading: ReceiptReading; usage: { inputTokens: number; outputTokens: number }; model: Pick<ModelEntry, "provider" | "model" | "rates"> }
  | { ok: false; state: "not_available" | "failed"; note: string; model?: Pick<ModelEntry, "provider" | "model" | "rates"> };

type Reader = (file: ReceiptFile, categories: string[]) => Promise<ReadOutcome>;
let override: Reader | null = null;

/** Tests only. */
export function setReceiptReaderForTests(reader: Reader | null) {
  override = reader;
}

/** The magic bytes of the files a receipt may be. Anything else isn't sent anywhere. */
export function sniffReceipt(head: Uint8Array): ReceiptFile["mimeType"] | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) return "image/webp";
  return null;
}

/** The largest image the model takes. PDFs may be larger. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;

export async function readReceiptFile(file: ReceiptFile, categories: string[]): Promise<ReadOutcome> {
  if (override) return override(file, categories);
  const resolved = resolve("image_understanding");
  if (!resolved.ready) return { ok: false, state: "not_available", note: "Selestial can't read receipts right now. Enter the details from the receipt." };
  try {
    const { reading, usage } = await readReceipt(resolved.model, { file, categories });
    return { ok: true, reading, usage, model: resolved.model };
  } catch (error) {
    if (error instanceof AiError && error.kind === "not_configured") return { ok: false, state: "not_available", note: "Selestial can't read receipts right now. Enter the details from the receipt." };
    return { ok: false, state: "failed", note: "Selestial couldn't read this receipt. Enter the details from it.", model: resolved.model };
  }
}
