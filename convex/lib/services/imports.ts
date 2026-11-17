/**
 * Reading existing pricing from a spreadsheet (CSV) or pasted text, in code: no AI, no credits. Each row
 * keeps where it came from ("Row 4", "Line 7") and the original text. What is unclear is flagged, never
 * guessed: "$60/hour" without saying per cleaner or per crew is an unclear unit, not a choice made here.
 * Nothing read here is a service until a person drafts it, and nothing drafted is live until reviewed.
 */
import type { Doc } from "../../_generated/dataModel";
import { blankSpec, defaultPricing, type Category, type Spec } from "./spec";

export type ImportRow = Doc<"serviceImports">["rows"][number];
type Method = ImportRow["method"];

export const IMPORT_LIMITS = { characters: 100_000, rows: 200 } as const;

/** Splits CSV text into rows of cells, honouring quotes and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

const PRICE = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,3}))?|(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})\b/;

/** The first price in a piece of text, in thousandths of a cent so "$0.085" survives. Null when none. */
export function readPrice(text: string): { millicents: number; match: string } | null {
  const m = PRICE.exec(text);
  if (!m) return null;
  const whole = (m[1] ?? m[3]).replace(/,/g, "");
  const fraction = (m[2] ?? m[4] ?? "").padEnd(3, "0").slice(0, 3);
  return { millicents: Number(whole) * 100_000 + Number(fraction) * 100, match: m[0] };
}

/** What a unit phrase means, or null with the word kept when it is unclear. */
export function readUnit(text: string): { method: Method; unitWord?: string } {
  const t = text.toLowerCase();
  if (/sq\.?\s*f(oo|ee)?t|sqft|square\s*f(oo|ee)t|\/\s*sf\b/.test(t)) return { method: "per_area" };
  if (/(per|\/|an?)\s*(hour|hr)\b.*(cleaner|person|tech|worker)|per\s*cleaner\s*(per\s*)?(hour|hr)/.test(t)) return { method: "hourly_per_cleaner" };
  if (/(per|\/|an?)\s*(hour|hr)\b.*(crew|team)|per\s*(crew|team)\s*(per\s*)?(hour|hr)/.test(t)) return { method: "hourly_per_crew" };
  if (/\b(per|\/|an?)\s*(hour|hr)\b|hourly/.test(t)) return { method: null };
  if (/\b(per|\/|a)\s*(month|mo)\b|monthly/.test(t)) return { method: "recurring_package" };
  const unit = /\b(?:per|\/|each)\s*(room|window|load|unit|turnover|bed|bathroom|floor|sofa|door)s?\b/.exec(t);
  if (unit) return { method: unit[1] === "turnover" ? "fixed" : "per_unit", unitWord: unit[1] };
  if (/\b(per|\/|each)\s*(visit|clean|cleaning|job|service|time)\b|\bflat\b|\bfixed\b/.test(t)) return { method: "fixed" };
  return { method: null };
}

const normal = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function row(index: number, sourceRef: string, raw: string, name: string, priceText: string, unitText: string, scope: string): ImportRow {
  const price = readPrice(priceText);
  const unit = readUnit(`${unitText} ${priceText}`);
  const method = unit.method;
  const flags: ImportRow["flags"] = [];
  if (!price) flags.push("missing_price");
  if (price && method === null) flags.push("unclear_unit");
  if (!scope.trim()) flags.push("missing_scope");
  const priceCents = price === null ? null : method === "per_area" ? price.millicents : Math.round(price.millicents / 1000);
  return { id: `r${index}`, sourceRef, raw: raw.slice(0, 500), name: name.slice(0, 80), priceCents, unitRaw: unitText.slice(0, 80) || (price ? priceText.replace(price.match, "").trim().slice(0, 80) : ""), method, ...(unit.unitWord ? { unitWord: unit.unitWord } : {}), scope: scope.slice(0, 1000), flags, decision: "pending" };
}

const HEADERS = { name: /^(service|name|item|service name|description of service)$/i, price: /^(price|rate|cost|amount|\$)$/i, unit: /^(unit|per|billing|basis|charged)$/i, scope: /^(scope|description|includes|details|notes)$/i };

export function rowsFromCsv(text: string): ImportRow[] {
  const table = parseCsv(text);
  if (table.length === 0) return [];
  const header = table[0];
  const find = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  const hasHeader = find(HEADERS.name) >= 0 || find(HEADERS.price) >= 0;
  const col = hasHeader ? { name: Math.max(0, find(HEADERS.name)), price: find(HEADERS.price), unit: find(HEADERS.unit), scope: find(HEADERS.scope) } : { name: 0, price: 1, unit: 2, scope: 3 };
  const body = hasHeader ? table.slice(1) : table;
  return body
    .map((cells, i) => {
      const get = (index: number) => (index >= 0 ? (cells[index] ?? "") : "");
      const priceText = col.price >= 0 ? get(col.price) : cells.find((c) => PRICE.test(c)) ?? "";
      return row(i + 1, `Row ${i + (hasHeader ? 2 : 1)}`, cells.join(", "), get(col.name), priceText, get(col.unit), get(col.scope));
    })
    .filter((r) => r.name.trim());
}

/** One service per line: "Standard clean — $150 per visit — kitchen, baths, floors". */
export function rowsFromText(text: string): ImportRow[] {
  const out: ImportRow[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!raw) return;
    const price = readPrice(raw);
    if (!price) {
      if (raw.length <= 80 && !/[.:]$/.test(raw)) out.push(row(i, `Line ${i + 1}`, line, raw, "", "", ""));
      return;
    }
    const at = raw.indexOf(price.match);
    const name = raw.slice(0, at).replace(/[\s:–—-]+$/, "").trim();
    const after = raw.slice(at + price.match.length);
    const [unitPart, ...rest] = after.split(/\s[–—-]\s|;|\(/);
    out.push(row(i, `Line ${i + 1}`, line, name || `Service on line ${i + 1}`, price.match + (unitPart ?? ""), unitPart ?? "", rest.join(" ").replace(/\)$/, "").trim()));
  });
  return out;
}

/** Marks rows that repeat each other or a service already in the catalog. */
export function flagDuplicates(rows: ImportRow[], existingNames: string[]): ImportRow[] {
  const existing = new Set(existingNames.map(normal));
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(normal(r.name), (seen.get(normal(r.name)) ?? 0) + 1);
  return rows.map((r) => ({ ...r, flags: [...r.flags, ...((seen.get(normal(r.name)) ?? 0) > 1 ? (["duplicate"] as const) : []), ...(existing.has(normal(r.name)) ? (["matches_existing"] as const) : [])] }));
}

/**
 * A draft from one row. Clear values are copied; anything flagged is marked illustrative, so it cannot be
 * published until a person confirms it. The original text goes into the team notes.
 */
export function specFromRow(r: ImportRow, category: Category): Spec {
  const base = blankSpec(category);
  const cents = r.priceCents ?? 0;
  let pricing: Spec["pricing"];
  switch (r.method) {
    case "hourly_per_cleaner":
      pricing = { ...(defaultPricing("hourly_per_cleaner") as Extract<Spec["pricing"], { method: "hourly_per_cleaner" }>), rateCents: cents };
      break;
    case "hourly_per_crew":
      pricing = { ...(defaultPricing("hourly_per_crew") as Extract<Spec["pricing"], { method: "hourly_per_crew" }>), rateCents: cents };
      break;
    case "per_area":
      pricing = { ...(defaultPricing("per_area") as Extract<Spec["pricing"], { method: "per_area" }>), rateMillicents: r.priceCents ?? 0 };
      break;
    case "per_unit":
      pricing = { ...(defaultPricing("per_unit") as Extract<Spec["pricing"], { method: "per_unit" }>), unitWord: r.unitWord ?? "unit", unitCents: cents };
      break;
    case "recurring_package":
      pricing = { ...(defaultPricing("recurring_package") as Extract<Spec["pricing"], { method: "recurring_package" }>), monthlyCents: cents };
      break;
    case "fixed":
      pricing = { ...(defaultPricing("fixed") as Extract<Spec["pricing"], { method: "fixed" }>), amountCents: cents };
      break;
    default:
      pricing = r.priceCents === null ? defaultPricing("custom_quote") : { ...(defaultPricing("fixed") as Extract<Spec["pricing"], { method: "fixed" }>), amountCents: cents };
  }
  const uncertain = r.flags.some((flag) => flag === "unclear_unit" || flag === "missing_price");
  return {
    ...base,
    name: r.name,
    summary: r.scope,
    visitWord: r.unitWord === "turnover" ? "turnover" : base.visitWord,
    pricing,
    teamNotes: `Imported from ${r.sourceRef}: "${r.raw.slice(0, 300)}"${uncertain ? `\nThe unit or price was unclear ("${r.unitRaw || "not stated"}"). Confirm it before publishing.` : ""}`.slice(0, 2000),
    illustrative: uncertain,
  };
}

export const FLAG_WORDS: Record<ImportRow["flags"][number], string> = {
  unclear_unit: "Unit unclear",
  missing_scope: "No scope",
  duplicate: "Listed twice",
  missing_price: "No price",
  matches_existing: "Already in your catalog",
};
