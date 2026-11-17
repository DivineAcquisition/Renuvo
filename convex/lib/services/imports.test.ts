import { describe, expect, it } from "vitest";

import { flagDuplicates, parseCsv, readPrice, readUnit, rowsFromCsv, rowsFromText, specFromRow } from "./imports";

describe("reading existing pricing", () => {
  it("parses CSV with quotes, commas inside quotes and blank lines", () => {
    expect(parseCsv('Service,Price\n"Deep clean, 2 bed","$250"\n\nWindows,$8\r\n')).toEqual([
      ["Service", "Price"],
      ["Deep clean, 2 bed", "$250"],
      ["Windows", "$8"],
    ]);
  });

  it("reads prices to the tenth of a cent, so area rates survive", () => {
    expect(readPrice("$1,250.50")?.millicents).toBe(125_050_000);
    expect(readPrice("from $0.085 per sq ft")?.millicents).toBe(8_500);
    expect(readPrice("call us")).toBeNull();
  });

  it("never decides whose hour an hourly price is", () => {
    expect(readUnit("$60/hr").method).toBeNull();
    expect(readUnit("per hour per cleaner").method).toBe("hourly_per_cleaner");
    expect(readUnit("$120 an hour for the team").method).toBe("hourly_per_crew");
    expect(readUnit("per sq ft").method).toBe("per_area");
    expect(readUnit("per window")).toEqual({ method: "per_unit", unitWord: "window" });
    expect(readUnit("per visit").method).toBe("fixed");
    expect(readUnit("monthly").method).toBe("recurring_package");
  });

  it("keeps where each row came from and flags what is unclear", () => {
    const rows = rowsFromCsv("Service,Price,Unit,Description\nStandard clean,$150,per visit,Kitchen and baths\nHourly help,$60,per hour,\nStandard Clean,$160,per visit,Dupe\nWindows,,,");
    expect(rows.map((r) => [r.sourceRef, r.name, r.priceCents, r.method, r.flags])).toEqual([
      ["Row 2", "Standard clean", 15000, "fixed", []],
      ["Row 3", "Hourly help", 6000, null, ["unclear_unit", "missing_scope"]],
      ["Row 4", "Standard Clean", 16000, "fixed", []],
      ["Row 5", "Windows", null, null, ["missing_price", "missing_scope"]],
    ]);
    const flagged = flagDuplicates(rows, ["windows"]);
    expect(flagged[0].flags).toContain("duplicate");
    expect(flagged[2].flags).toContain("duplicate");
    expect(flagged[3].flags).toContain("matches_existing");
  });

  it("reads one service per line of pasted text", () => {
    const rows = rowsFromText("Our prices:\n- Standard clean — $150 per visit — kitchen, baths, floors\n- Carpet: $45 per room\n- Office cleaning $0.10 per sq ft");
    expect(rows.map((r) => [r.sourceRef, r.name, r.method, r.priceCents])).toEqual([
      ["Line 2", "Standard clean", "fixed", 15000],
      ["Line 3", "Carpet", "per_unit", 4500],
      ["Line 4", "Office cleaning", "per_area", 10_000],
    ]);
    expect(rows[0].scope).toBe("kitchen, baths, floors");
  });

  it("makes a draft that holds an unclear value as illustrative, with the source in the notes", () => {
    const [clear, unclear] = rowsFromCsv("Service,Price,Unit\nStandard clean,$150,per visit\nHourly help,$60,/hr");
    expect(specFromRow(clear, "residential")).toMatchObject({ illustrative: false, pricing: { method: "fixed", amountCents: 15000 } });
    const spec = specFromRow(unclear, "residential");
    expect(spec.illustrative).toBe(true);
    expect(spec.teamNotes).toContain("Imported from Row 3");
    expect(spec.teamNotes).toContain("unclear");
  });
});
