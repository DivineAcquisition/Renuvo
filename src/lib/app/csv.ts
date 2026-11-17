/**
 * Reads a CSV the way spreadsheets write it: commas or semicolons, quoted fields with commas and line breaks
 * inside, doubled quotes for a quote, and a header row. Pure, so it is tested without a browser.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = [
  { key: "name", label: "Name", guesses: ["name", "full name", "cleaner", "worker", "employee name"] },
  { key: "engagement", label: "Relationship type", guesses: ["type", "relationship", "worker type", "engagement", "classification", "employment type"] },
  { key: "phone", label: "Phone", guesses: ["phone", "mobile", "cell", "phone number", "mobile phone"] },
  { key: "email", label: "Email", guesses: ["email", "e-mail", "email address"] },
  { key: "serviceAreas", label: "Service areas", guesses: ["areas", "service areas", "zip", "zips", "zip codes", "postal codes"] },
  { key: "skills", label: "Skills", guesses: ["skills", "services", "specialties"] },
  { key: "subcontractor", label: "Subcontractor company", guesses: ["subcontractor", "company", "agency", "vendor"] },
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

/** Which column each field most likely is, from the header names. */
export function guessColumns(header: string[]): Partial<Record<ImportField, number>> {
  const out: Partial<Record<ImportField, number>> = {};
  const names = header.map((cell) => cell.trim().toLowerCase());
  for (const field of IMPORT_FIELDS) {
    const index = names.findIndex((name) => (field.guesses as readonly string[]).includes(name));
    if (index >= 0 && !Object.values(out).includes(index)) out[field.key] = index;
  }
  if (out.name === undefined) {
    const first = names.findIndex((name) => name === "first name" || name === "first");
    const last = names.findIndex((name) => name === "last name" || name === "last");
    if (first >= 0 && last >= 0) out.name = -(first * 1000 + last) - 1;
  }
  return out;
}

/** The value for a field in one row. A negative column is "first name" and "last name" joined. */
export function cell(row: string[], column: number | undefined): string {
  if (column === undefined) return "";
  if (column < 0) {
    const packed = -column - 1;
    return `${row[Math.floor(packed / 1000)] ?? ""} ${row[packed % 1000] ?? ""}`.trim();
  }
  return row[column] ?? "";
}
