/**
 * The guided questions. The same engine serves the visual builder and Company Chat's tools, so an owner
 * is asked the same things either way and never asked twice for something already known. It asks two or
 * three questions at a time, in the order a conversation naturally goes, and only about terms the chosen
 * clauses actually use. A value taken from a company record carries its source so the owner can correct it.
 */
import type { DocType } from "./catalog";
import { defOf, kitFor, missingRequired, relevantVariables, type Kit } from "./compose";
import { isAnswered, type Terms, type VarDef } from "./variables";

export const GROUP_ORDER = ["parties", "worker", "location", "scope", "str", "commercial", "schedule", "term", "pricing", "access", "supplies", "cancellation", "concerns", "photo", "change"] as const;

export const GROUP_LABEL: Record<string, string> = {
  parties: "Parties and signers",
  worker: "The worker and the work",
  location: "Where the work is",
  scope: "Scope and standards",
  str: "Rental turnovers",
  commercial: "Sites and commercial terms",
  schedule: "Schedule",
  term: "Start, term and renewal",
  pricing: "Price and payment",
  access: "Access",
  supplies: "Supplies and responsibilities",
  cancellation: "Rescheduling and cancellation",
  concerns: "Concerns and extra work",
  photo: "Photos and permissions",
  change: "The change",
};

export type Question = {
  key: string;
  label: string;
  ask: string;
  type: VarDef["type"];
  group: string;
  groupLabel: string;
  choices?: readonly string[];
  help?: string;
};

export type Known = { value: string | number | boolean | string[]; source: string };

const toQuestion = (def: VarDef): Question => ({ key: def.key, label: def.label, ask: def.ask, type: def.type, group: def.group, groupLabel: GROUP_LABEL[def.group] ?? def.group, choices: def.choices, help: def.help });

/** Questions still open, in conversational order. */
export function openQuestions(type: DocType, terms: Terms, skipped: readonly string[] = [], kit: Kit = kitFor(type)): Question[] {
  const relevant = relevantVariables(type, terms, kit);
  const rank = (group: string) => {
    const at = GROUP_ORDER.indexOf(group as (typeof GROUP_ORDER)[number]);
    return at === -1 ? GROUP_ORDER.length : at;
  };
  return relevant
    .map((key) => defOf(kit, key))
    .filter((def): def is VarDef => Boolean(def) && !isAnswered(terms[def!.key]) && !skipped.includes(def!.key))
    .sort((a, b) => rank(a.group) - rank(b.group))
    .map(toQuestion);
}

/**
 * The next two or three questions, kept within one or two topics so they read as a conversation rather
 * than a form. Questions in the same group as the first are taken first.
 */
export function nextQuestions(type: DocType, terms: Terms, skipped: readonly string[] = [], max = 3, kit: Kit = kitFor(type)): Question[] {
  const open = openQuestions(type, terms, skipped, kit);
  if (open.length === 0) return [];
  const first = open[0].group;
  const same = open.filter((question) => question.group === first).slice(0, max);
  return same.length >= 2 || open.length === same.length ? same : [...same, ...open.filter((q) => q.group !== first).slice(0, max - same.length)];
}

export type Progress = { answered: number; total: number; missing: string[]; percent: number };

export function progress(type: DocType, terms: Terms, kit: Kit = kitFor(type)): Progress {
  const relevant = relevantVariables(type, terms, kit);
  const missing = missingRequired(type, terms, kit);
  const total = relevant.length;
  const answered = relevant.filter((key) => isAnswered(terms[key])).length;
  return { answered, total, missing, percent: total === 0 ? 100 : Math.round((answered / total) * 100) };
}

/** Groups with their questions, for the builder's section list. */
export function sections(type: DocType, terms: Terms, kit: Kit = kitFor(type)) {
  const relevant = relevantVariables(type, terms, kit).map((key) => defOf(kit, key)).filter((def): def is VarDef => Boolean(def));
  const byGroup = new Map<string, VarDef[]>();
  for (const def of relevant) byGroup.set(def.group, [...(byGroup.get(def.group) ?? []), def]);
  return [...byGroup.entries()]
    .sort(([a], [b]) => GROUP_ORDER.indexOf(a as never) - GROUP_ORDER.indexOf(b as never))
    .map(([group, defs]) => ({ group, label: GROUP_LABEL[group] ?? group, questions: defs.map(toQuestion), answered: defs.filter((def) => isAnswered(terms[def.key])).length }));
}

/** Coerces a typed answer to the term's type, or says why it cannot. Dollars become cents; yes/no become booleans. */
export function coerce(def: VarDef, raw: unknown): { ok: true; value: string | number | boolean | string[] } | { ok: false; why: string } {
  switch (def.type) {
    case "money": {
      if (typeof raw === "number") return Number.isSafeInteger(raw) && raw >= 0 ? { ok: true, value: raw } : { ok: false, why: `${def.label} must be an amount of zero or more.` };
      const cleaned = String(raw).trim().replace(/^\$/, "").replace(/,/g, "");
      if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false, why: `${def.label}: "${String(raw)}" is not an amount in dollars.` };
      const [whole, fraction = ""] = cleaned.split(".");
      return { ok: true, value: Number(whole) * 100 + Number(fraction.padEnd(2, "0")) };
    }
    case "int": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false, why: `${def.label} must be a whole number.` };
    }
    case "bool": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const word = String(raw).trim().toLowerCase();
      if (["yes", "y", "true"].includes(word)) return { ok: true, value: true };
      if (["no", "n", "false"].includes(word)) return { ok: true, value: false };
      return { ok: false, why: `${def.label} must be yes or no.` };
    }
    case "list": {
      const items = Array.isArray(raw) ? raw.map(String) : String(raw).split(/[\n;,]+/);
      const cleaned = items.map((item) => item.trim()).filter(Boolean);
      return cleaned.length ? { ok: true, value: cleaned } : { ok: false, why: `${def.label} needs at least one entry.` };
    }
    case "choice": {
      const word = String(raw).trim();
      if (def.key === "governingState") return /^[A-Za-z]{2}$/.test(word) ? { ok: true, value: word.toUpperCase() } : { ok: false, why: "Use the two-letter state code, for example TX." };
      const match = def.choices?.find((choice) => choice.toLowerCase() === word.toLowerCase());
      return match ? { ok: true, value: match } : { ok: false, why: `${def.label} must be one of: ${def.choices?.join(", ")}.` };
    }
    default: {
      const word = String(raw).trim();
      if (!word) return { ok: false, why: `${def.label} is empty.` };
      if (word.length > 4000) return { ok: false, why: `${def.label} is too long.` };
      return { ok: true, value: word };
    }
  }
}
