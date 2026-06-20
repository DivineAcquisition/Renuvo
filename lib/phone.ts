/** Normalize a phone string to E.164 (US-friendly), or null if invalid. */
export function toE164(input: string): string | null {
  const t = (input ?? "").trim();
  if (/^\+[1-9]\d{1,14}$/.test(t)) return t;
  const d = t.replace(/[^\d]/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
