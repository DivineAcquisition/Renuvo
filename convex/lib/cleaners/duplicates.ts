/**
 * Finding a person who may already be in the record, before a second row is made for them. A shared email
 * or phone number is a strong sign; a shared name alone is only worth a look. Nothing is merged or skipped
 * without a person deciding.
 */
export type PersonKey = { id?: string; name: string; email?: string; phone?: string };
export type Match = { id: string; name: string; why: ("email" | "phone" | "name")[]; strong: boolean };

export function normalName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The last ten digits, so +1 (512) 555-0101 and 512.555.0101 are the same number. */
export function normalPhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function normalEmail(email: string | undefined): string | null {
  const cleaned = email?.trim().toLowerCase();
  return cleaned && cleaned.includes("@") ? cleaned : null;
}

export function matchesFor(candidate: PersonKey, existing: PersonKey[]): Match[] {
  const name = normalName(candidate.name);
  const email = normalEmail(candidate.email);
  const phone = normalPhone(candidate.phone);
  const out: Match[] = [];
  for (const row of existing) {
    if (candidate.id && row.id === candidate.id) continue;
    const why: Match["why"] = [];
    if (email && normalEmail(row.email) === email) why.push("email");
    if (phone && normalPhone(row.phone) === phone) why.push("phone");
    if (name && normalName(row.name) === name) why.push("name");
    if (why.length > 0) out.push({ id: row.id ?? "", name: row.name, why, strong: why.includes("email") || why.includes("phone") });
  }
  return out.sort((a, b) => Number(b.strong) - Number(a.strong) || b.why.length - a.why.length);
}

export const WHY_WORDS: Record<Match["why"][number], string> = { email: "same email", phone: "same phone number", name: "same name" };
