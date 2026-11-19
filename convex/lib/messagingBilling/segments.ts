/**
 * How many SMS segments a text uses, the way carriers and Telnyx count them:
 *
 * - GSM-7 when every character is in the GSM 03.38 basic set or its extension table. One segment holds
 *   160 septets; split messages hold 153 each. Extension characters (^ { } \ [ ] ~ | € and form feed) take
 *   two septets, and the escape and its character are never split across segments.
 * - Otherwise UCS-2 (UTF-16): one segment holds 70 code units; split messages hold 67 each. Characters
 *   outside the Basic Multilingual Plane (most emoji) are two code units and are never split.
 * - At most 10 segments per message.
 *
 * This is the estimate shown before sending and used to reserve balance. The charge itself uses the
 * segment count the provider reports (`parts`), which can be lower if the provider's smart encoding
 * replaced characters.
 */

const BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const EXTENSION = "^{}\\[]~|€\f";
const BASIC_SET = new Set(BASIC);
const EXTENSION_SET = new Set(EXTENSION);

export const MAX_SEGMENTS = 10;

export type Encoding = "gsm7" | "ucs2";
export type SegmentCount = { encoding: Encoding; segments: number; units: number; perSegment: number; tooLong: boolean; nonGsm: string[] };

export function isGsm(text: string): boolean {
  for (const ch of text) if (!BASIC_SET.has(ch) && !EXTENSION_SET.has(ch)) return false;
  return true;
}

/** Packs items (each 1 or 2 wide, never split) into segments of `size`. */
function pack(widths: number[], single: number, size: number): { segments: number; total: number } {
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (total === 0) return { segments: 1, total };
  if (total <= single) return { segments: 1, total };
  let segments = 1;
  let used = 0;
  for (const w of widths) {
    if (used + w > size) {
      segments += 1;
      used = 0;
    }
    used += w;
  }
  return { segments, total };
}

export function countSegments(text: string): SegmentCount {
  const chars = [...text];
  if (isGsm(text)) {
    const { segments, total } = pack(
      chars.map((ch) => (EXTENSION_SET.has(ch) ? 2 : 1)),
      160,
      153,
    );
    return { encoding: "gsm7", segments, units: total, perSegment: segments === 1 ? 160 : 153, tooLong: segments > MAX_SEGMENTS, nonGsm: [] };
  }
  const { segments, total } = pack(
    chars.map((ch) => ch.length),
    70,
    67,
  );
  const nonGsm = [...new Set(chars.filter((ch) => !BASIC_SET.has(ch) && !EXTENSION_SET.has(ch)))].slice(0, 8);
  return { encoding: "ucs2", segments, units: total, perSegment: segments === 1 ? 70 : 67, tooLong: segments > MAX_SEGMENTS, nonGsm };
}

/**
 * Replaces punctuation that silently switches a text to UCS-2 (curly quotes, dashes, ellipses, non-breaking
 * spaces) with plain equivalents that mean the same. Emoji and accented letters are left alone: changing
 * them could change the meaning. Used for agent-written texts; a person's own words are never rewritten.
 */
export function plainPunctuation(text: string): string {
  return text
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[      ]/g, " ")
    .replace(/[​‌‍﻿]/g, "");
}

/** "This message uses 2 SMS segments." */
export function segmentWords(count: SegmentCount): string {
  return `This message uses ${count.segments} SMS segment${count.segments === 1 ? "" : "s"}${count.encoding === "ucs2" ? " (it contains characters such as emoji, so each segment holds fewer characters)" : ""}.`;
}
