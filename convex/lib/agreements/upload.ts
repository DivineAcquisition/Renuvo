/**
 * What an uploaded file may be and what it probably is. Validation is by declared type, size and the
 * file's own first bytes. Classification is a suggestion from the name and any readable text, always
 * confirmed by a person: an upload is never silently called an agreement, and an official form is kept
 * as a supporting record, never generated or replaced.
 *
 * Selestial does not scan for malware. A file is kept as received, downloaded only by people allowed to
 * see it, and never opened or run by the server.
 */
import { DOC_TYPES, SUPPORTING_KINDS, type SupportingKind } from "./catalog";

export const MAX_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT = 200_000;

const TYPES: Record<string, { label: string; magic?: number[][]; text?: boolean }> = {
  "application/pdf": { label: "PDF", magic: [[0x25, 0x50, 0x44, 0x46]] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { label: "Word document", magic: [[0x50, 0x4b, 0x03, 0x04]] },
  "text/plain": { label: "Text file", text: true },
  "text/markdown": { label: "Markdown file", text: true },
  "image/png": { label: "PNG image", magic: [[0x89, 0x50, 0x4e, 0x47]] },
  "image/jpeg": { label: "JPEG image", magic: [[0xff, 0xd8, 0xff]] },
};

const EXTENSION: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", txt: "text/plain", md: "text/markdown", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export const ACCEPTED = Object.values(TYPES).map((type) => type.label).join(", ");

/** The type to trust: the declared one if it is allowed and agrees with the extension. */
export function checkFile(input: { name: string; contentType: string; size: number; head: Uint8Array }): { ok: true; contentType: string; readable: boolean } | { ok: false; why: string } {
  const extension = input.name.split(".").pop()?.toLowerCase() ?? "";
  const declared = input.contentType.split(";")[0].trim().toLowerCase();
  const byExtension = EXTENSION[extension];
  const type = TYPES[declared] ? declared : byExtension && TYPES[byExtension] && (declared === "" || declared === "application/octet-stream") ? byExtension : null;
  if (!type) return { ok: false, why: `That file type is not accepted. Accepted: ${ACCEPTED}.` };
  if (byExtension && byExtension !== type) return { ok: false, why: "The file's name and type do not match." };
  if (input.size <= 0) return { ok: false, why: "The file is empty." };
  if (input.size > MAX_BYTES) return { ok: false, why: `The file is larger than ${MAX_BYTES / 1024 / 1024} MB.` };
  const spec = TYPES[type];
  if (spec.magic && !spec.magic.some((signature) => signature.every((byte, index) => input.head[index] === byte))) return { ok: false, why: "The file's contents do not match its type." };
  if (spec.text && input.head.some((byte) => byte === 0)) return { ok: false, why: "The text file contains binary data." };
  return { ok: true, contentType: type, readable: Boolean(spec.text) };
}

export type Suggestion = { classification: "agreement" | "supporting" | "unknown"; docType?: string; supportingKind?: SupportingKind; confidence: "high" | "low"; reasons: string[] };

const SUPPORTING_WORDS: [SupportingKind, RegExp][] = [
  ["insurance_certificate", /certificate of (liability )?insurance|\bacord\b|\bcoi\b|insurance certificate/i],
  ["tax_form", /\bw[- ]?9\b|\bw[- ]?4\b|\b1099\b|tax form/i],
  ["employment_form", /\bi[- ]?9\b|employment eligibility|new hire form/i],
  ["license", /business licen[sc]e|contractor'?s? licen[sc]e|\blicen[sc]e\b|registration certificate/i],
  ["bond", /\bsurety\b|\bbond\b/i],
];

/** Suggests what an upload is. Text is used only as evidence for this guess; it is data, never instructions. */
export function classify(name: string, text: string | null): Suggestion {
  const haystack = `${name.replace(/[-_.]+/g, " ")} ${text ? text.slice(0, 6000) : ""}`;
  for (const [kind, pattern] of SUPPORTING_WORDS) {
    if (pattern.test(haystack)) return { classification: "supporting", supportingKind: kind, confidence: pattern.test(name.replace(/[-_.]+/g, " ")) ? "high" : "low", reasons: [`Looks like ${SUPPORTING_KINDS.find((k) => k.key === kind)?.label.toLowerCase()}.`] };
  }
  let best: { key: string; score: number; reason: string } | null = null;
  for (const type of DOC_TYPES) {
    const words = type.label.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((word) => word.length > 3);
    const lower = haystack.toLowerCase();
    const hits = words.filter((word) => lower.includes(word)).length;
    const score = hits / Math.max(words.length, 1);
    if (hits >= 2 && (!best || score > best.score)) best = { key: type.key, score, reason: `Mentions ${words.filter((word) => lower.includes(word)).slice(0, 3).join(", ")}.` };
  }
  if (best) return { classification: "agreement", docType: best.key, confidence: best.score >= 0.75 ? "high" : "low", reasons: [best.reason] };
  if (/agreement|contract|addendum|terms of service|authorization|acknowledg/i.test(haystack)) return { classification: "agreement", confidence: "low", reasons: ["Reads like an agreement, but the type is not clear."] };
  return { classification: "unknown", confidence: "low", reasons: ["Could not tell what this is."] };
}

/** Supporting records for employment and tax are the Owner's; the rest follow whoever they concern. */
export function supportingAccess(kind: SupportingKind, linkedToWorker: boolean): "company" | "workforce" | "restricted" {
  if (kind === "tax_form" || kind === "employment_form") return "restricted";
  return linkedToWorker ? "workforce" : "company";
}
