/**
 * Who a new worker might already be. A match is a question for a person, never a merge: two people can
 * share a name, and one person can change their number. Pure functions, so the add form, the import
 * preview and the commit all ask the same question.
 */
export type Identity = { name: string; email?: string | null; phone?: string | null };

export type MatchReason = "phone" | "email" | "name";

/** Digits only, with a US country code added to a ten-digit number. Null when it cannot be a phone. */
export function phoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return digits.length === 10 ? `1${digits}` : digits;
}

export function emailKey(email: string | null | undefined): string | null {
  const cleaned = email?.trim().toLowerCase();
  return cleaned ? cleaned : null;
}

/** Lower case, accents and punctuation removed, single spaces. "José  O'Neil" and "jose oneil" are the same. */
export function nameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The reasons `candidate` may be the same person as `existing`, strongest first. Empty when none. */
export function matchReasons(candidate: Identity, existing: Identity): MatchReason[] {
  const reasons: MatchReason[] = [];
  const phone = phoneKey(candidate.phone);
  if (phone && phone === phoneKey(existing.phone)) reasons.push("phone");
  const email = emailKey(candidate.email);
  if (email && email === emailKey(existing.email)) reasons.push("email");
  const name = nameKey(candidate.name);
  if (name && name === nameKey(existing.name)) reasons.push("name");
  return reasons;
}

export const MATCH_WORDS: Record<MatchReason, string> = { phone: "same phone number", email: "same email", name: "same name" };

/** Every existing record the candidate may be, with why. */
export function findMatches<T extends Identity & { id: string }>(candidate: Identity, existing: T[]): { id: string; name: string; reasons: MatchReason[] }[] {
  const out: { id: string; name: string; reasons: MatchReason[] }[] = [];
  for (const row of existing) {
    const reasons = matchReasons(candidate, row);
    if (reasons.length > 0) out.push({ id: row.id, name: row.name, reasons });
  }
  // Phone and email matches before name-only matches.
  return out.sort((a, b) => Number(b.reasons[0] !== "name") - Number(a.reasons[0] !== "name"));
}
