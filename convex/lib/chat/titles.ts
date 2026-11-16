/**
 * A chat's generated title is the start of the first question, with anything that looks like contact
 * details or an account number taken out, so a title shown in a list does not carry them. A person can
 * rename it; their title is never replaced.
 */

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const LONG_NUMBER = /\b\d{5,}\b/g;

export function redacted(text: string): string {
  return text.replace(EMAIL, "[email]").replace(PHONE, "[number]").replace(LONG_NUMBER, "[number]");
}

export function titleFrom(text: string, max = 60): string {
  const clean = redacted(text).replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  const sentence = clean.split(/(?<=[.?!])\s/)[0] ?? clean;
  if (sentence.length <= max) return sentence.replace(/[.?!]+$/, "") || "New chat";
  const cut = sentence.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, "")}…`;
}

/** What search reads: the title and the first things the person asked. Never the model's words. */
export function searchTextFor(title: string, asked: string[]): string {
  return [title, ...asked].join(" \n").slice(0, 4000);
}
