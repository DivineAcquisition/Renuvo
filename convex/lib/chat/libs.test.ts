import { describe, expect, it } from "vitest";

import { CalcError, evaluate } from "./calc";
import { compareScenarios, marginFromMarkup, markupFromMargin, PricingError, pricing } from "./pricing";
import { redacted, titleFrom } from "./titles";

describe("pricing calculator", () => {
  it("keeps labor-hours and elapsed time apart, and shows its working", () => {
    const result = pricing({ crewSize: 3, elapsedHours: 2, laborCostPerHourCents: 2000, suppliesCents: 1500, travelCents: 1000, overheadPercent: 10, targetMarginPercent: 40 });
    expect(result.laborHours).toBe(6);
    expect(result.elapsedHours).toBe(2);
    expect(result.laborCents).toBe(12_000);
    expect(result.directCents).toBe(14_500);
    expect(result.overheadCents).toBe(1_450);
    expect(result.totalCostCents).toBe(15_950);
    // 15,950 ÷ 0.6 = 26,583.33, rounded up to the cent.
    expect(result.priceAtMarginCents).toBe(26_584);
    expect(result.checks[0]).toMatchObject({ basis: "margin", marginPercent: 40, perLaborHourCents: 4431, perElapsedHourCents: 13_292 });
    expect(result.formulas.join("\n")).toMatch(/crew 3 × elapsed 2 h = 6 labor-hours/);
  });

  it("does not confuse margin with markup", () => {
    const result = pricing({ laborHours: 4, laborCostPerHourCents: 2500, markupPercent: 50, targetMarginPercent: 50, overheadPercent: 0, suppliesCents: 0, travelCents: 0 });
    expect(result.totalCostCents).toBe(10_000);
    expect(result.priceAtMarkupCents).toBe(15_000);
    expect(result.priceAtMarginCents).toBe(20_000);
    const markup = result.checks.find((row) => row.basis === "markup")!;
    expect(markup.marginPercent).toBeCloseTo(33.3, 1);
    expect(marginFromMarkup(50)).toBe(33.3);
    expect(markupFromMargin(50)).toBe(100);
  });

  it("refuses inputs that disagree or are missing, instead of inventing them", () => {
    expect(() => pricing({ crewSize: 2, elapsedHours: 3, laborHours: 5, laborCostPerHourCents: 2000, targetMarginPercent: 30 })).toThrow(PricingError);
    expect(() => pricing({ laborCostPerHourCents: 2000, targetMarginPercent: 30 })).toThrow(/labor-hours/);
    expect(() => pricing({ laborHours: 2, laborCostPerHourCents: 2000 })).toThrow(/margin or a markup/);
    expect(() => pricing({ laborHours: 2, laborCostPerHourCents: 2000.5, targetMarginPercent: 20 })).toThrow(/whole cents/);
    expect(() => pricing({ laborHours: 2, laborCostPerHourCents: 2000, targetMarginPercent: 100 })).toThrow();
    // Missing costs are said out loud.
    expect(pricing({ laborHours: 2, laborCostPerHourCents: 2000, targetMarginPercent: 20 }).assumptions.join(" ")).toMatch(/supplies.*\$0/i);
  });

  it("prices recurring service per month and rounds up to a step", () => {
    const result = pricing({ laborHours: 3, laborCostPerHourCents: 2200, suppliesCents: 800, targetMarginPercent: 35, visitsPerMonth: 2, roundToCents: 500 });
    expect(result.priceAtMarginCents! % 500).toBe(0);
    expect(result.monthly).toMatchObject({ visits: 2, priceAtMarginCents: result.priceAtMarginCents! * 2 });
  });

  it("compares scenarios and reports a bad one without dropping the rest", () => {
    const out = compareScenarios([
      { name: "Hourly crew of 2", crewSize: 2, elapsedHours: 2.5, laborCostPerHourCents: 2000, targetMarginPercent: 40 },
      { name: "Broken", laborCostPerHourCents: 2000, targetMarginPercent: 40 },
    ]);
    expect(out.scenarios.map((row) => row.name)).toEqual(["Hourly crew of 2"]);
    expect(out.errors[0].name).toBe("Broken");
  });
});

describe("arithmetic", () => {
  it("computes plain arithmetic and nothing else", () => {
    expect(evaluate("(120 + 80) * 1.08")).toBe(216);
    expect(evaluate("2 ^ 3 ^ 2")).toBe(512);
    expect(evaluate("-4 + 10 / 4")).toBe(-1.5);
    expect(evaluate("$1,250 × 3")).toBe(3750);
    expect(() => evaluate("process.exit()")).toThrow(CalcError);
    expect(() => evaluate("1 / 0")).toThrow(/zero/);
    expect(() => evaluate("(1 + 2")).toThrow(CalcError);
    expect(() => evaluate("")).toThrow(CalcError);
  });
});

describe("chat titles", () => {
  it("starts from the question and leaves contact details out", () => {
    expect(titleFrom("Help me price a recurring cleaning service. It is biweekly.")).toBe("Help me price a recurring cleaning service");
    expect(titleFrom("Draft a reply to dana@example.com at 512-555-0199 about her refund")).not.toMatch(/dana@|555/);
    expect(titleFrom("   ")).toBe("New chat");
    expect(titleFrom("a".repeat(30) + " " + "b".repeat(40)).length).toBeLessThanOrEqual(61);
    expect(redacted("card 4111111111111111")).toBe("card [number]");
  });
});
