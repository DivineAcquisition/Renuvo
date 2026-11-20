// The parser lives with the server, which reads uploaded files too (convex/lib/csv.ts).
export { parseCsv } from "../../../convex/lib/csv";

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
