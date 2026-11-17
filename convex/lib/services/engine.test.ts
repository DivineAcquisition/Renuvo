import { describe, expect, it } from "vitest";

import { checkSpec, demandPercent, quote, roundCents, scheduleDates, scheduleFacts, startingCents, sumOfLines, visitsByMonth, type QuoteInput } from "./engine";
import { emptyCosts, priceForMargin, profitability, type Costs } from "./profit";
import { blankSpec, defaultModifiers, defaultStr, type Spec } from "./spec";
import { formatCents, formatMillicents } from "./words";

function service(patch: Partial<Spec> = {}): Spec {
  return { ...blankSpec("residential"), name: "Standard clean", summary: "A tidy home.", ...patch };
}

const bands: Spec["pricing"] = {
  method: "size_bands",
  unit: "sq_ft",
  bands: [
    { from: 0, to: 1000, amountCents: 12000, laborMinutes: 120 },
    { from: 1000, to: 2000, amountCents: 16000, laborMinutes: 180 },
    { from: 2000, to: 3000, amountCents: 21000, laborMinutes: 240 },
  ],
};

describe("arithmetic", () => {
  it("rounds half away from zero, to whole cents, ignoring float noise", () => {
    expect(roundCents(49.5)).toBe(50);
    expect(roundCents(49.4999)).toBe(49);
    // A difference under a millionth of a cent is float noise, not a value.
    expect(roundCents(49.4999999)).toBe(50);
    expect(roundCents(-49.5)).toBe(-50);
    expect(roundCents(0.1 * 3 * 100)).toBe(30);
    expect(roundCents((333 * 15) / 100)).toBe(50);
  });

  it("writes money and rates with their precision", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-500)).toBe("−$5.00");
    expect(formatMillicents(8500)).toBe("$0.085");
    expect(formatMillicents(12000)).toBe("$0.12");
  });
});

describe("the same inputs give the same quote", () => {
  it("is deterministic, whatever order the inputs are written in", () => {
    const spec = service({ pricing: bands, modifiers: { ...defaultModifiers(), minimumCents: 13000 } });
    const a: QuoteInput = { area: 1500, addOns: [], schedule: "every_14_days" };
    const b: QuoteInput = { schedule: "every_14_days", addOns: [], area: 1500 };
    expect(quote(spec, a)).toEqual(quote(spec, b));
    expect(JSON.stringify(quote(spec, a))).toBe(JSON.stringify(quote(spec, a)));
  });

  it("always totals exactly the lines it shows", () => {
    const spec = service({
      pricing: { method: "bed_bath", baseCents: 9999, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 1333, perBathroomCents: 1777, perHalfBathCents: 555, baseLaborMinutes: 90, perBedroomMinutes: 25, perBathroomMinutes: 35, perHalfBathMinutes: 10 },
      addOns: [{ id: "oven", label: "Inside the oven", priceCents: 3333, per: "item", itemWord: "oven", laborMinutes: 30, maxQuantity: 2 }],
      modifiers: {
        ...defaultModifiers(),
        condition: { enabled: true, levels: [{ id: "ok", label: "Maintained", pricePercent: 0, timePercent: 0, requiresWalkthrough: false }, { id: "heavy", label: "Heavy", pricePercent: 17.5, timePercent: 20, requiresWalkthrough: false }] },
        recurring: { enabled: true, options: [{ schedule: "every_14_days", discount: { kind: "percent", value: 12.5 } }] },
        rush: { enabled: true, adjustment: { kind: "percent", value: 7 } },
        promotions: [{ id: "spring", label: "Spring", discount: { kind: "fixed", value: 1001 }, startsOn: null, endsOn: null, approved: true }],
        discounts: { stacking: "stack", maxTotalPercent: 40 },
        rounding: { stepCents: 0, mode: "nearest" },
      },
    });
    for (let beds = 1; beds <= 5; beds += 1) {
      for (let baths = 1; baths <= 3; baths += 1) {
        for (const condition of ["ok", "heavy"]) {
          const result = quote(spec, { bedrooms: beds, bathrooms: baths, halfBaths: beds % 2, condition, addOns: [{ id: "oven", quantity: beds % 3 }], rush: beds > 2, schedule: baths > 1 ? "every_14_days" : undefined, promotionId: "spring" });
          expect(result.outcome).toBe("firm");
          expect(sumOfLines(result.lines)).toBe(result.totalCents);
          expect(Number.isInteger(result.totalCents)).toBe(true);
        }
      }
    }
  });
});

describe("size bands", () => {
  const spec = service({ pricing: bands });

  it("covers a band's lower bound and stops just before its upper bound", () => {
    expect(quote(spec, { area: 999 }).totalCents).toBe(12000);
    expect(quote(spec, { area: 999.99 }).totalCents).toBe(12000);
    expect(quote(spec, { area: 1000 }).totalCents).toBe(16000);
    expect(quote(spec, { area: 2999 }).totalCents).toBe(21000);
  });

  it("sends a property above the largest band to a walkthrough, with no invented price", () => {
    const result = quote(spec, { area: 3000 });
    expect(result.outcome).toBe("walkthrough");
    expect(result.totalCents).toBeNull();
  });

  it("refuses overlaps and gaps, and warns about drops and jumps", () => {
    const overlap = checkSpec(service({ pricing: { ...bands, bands: [{ from: 0, to: 1200, amountCents: 1, laborMinutes: 1 }, { from: 1000, to: 2000, amountCents: 2, laborMinutes: 1 }] } as Spec["pricing"] }));
    expect(overlap.find((p) => p.code === "band_overlap")?.severity).toBe("blocker");
    const gap = checkSpec(service({ pricing: { ...bands, bands: [{ from: 0, to: 1000, amountCents: 1, laborMinutes: 1 }, { from: 1100, to: 2000, amountCents: 2, laborMinutes: 1 }] } as Spec["pricing"] }));
    expect(gap.find((p) => p.code === "band_gap")?.message).toContain("1000 up to 1100");
    const drop = checkSpec(service({ pricing: { ...bands, bands: [{ from: 0, to: 1000, amountCents: 20000, laborMinutes: 1 }, { from: 1000, to: 2000, amountCents: 15000, laborMinutes: 1 }] } as Spec["pricing"] }));
    expect(drop.find((p) => p.code === "band_drop")?.severity).toBe("warning");
    const jump = checkSpec(service({ pricing: { ...bands, bands: [{ from: 0, to: 1000, amountCents: 10000, laborMinutes: 1 }, { from: 1000, to: 2000, amountCents: 20000, laborMinutes: 1 }] } as Spec["pricing"] }));
    expect(jump.some((p) => p.code === "band_jump")).toBe(true);
    expect(checkSpec(spec).filter((p) => p.severity === "blocker")).toEqual([]);
  });

  it("asks for the size instead of guessing it", () => {
    const result = quote(spec, {});
    expect(result.outcome).toBe("incomplete");
    expect(result.missing).toEqual(["Property size (sq ft)"]);
    expect(result.totalCents).toBeNull();
  });
});

describe("hourly pricing says whose hour it is", () => {
  it("charges each cleaner's hour, rounded up to the increment, with a minimum", () => {
    const spec = service({ pricing: { method: "hourly_per_cleaner", rateCents: 4000, minimumHours: 3, incrementMinutes: 30, estimatedLaborMinutes: 200 }, team: { ...blankSpec().team, crewSize: 2 } });
    const result = quote(spec, {});
    // 200 labor-minutes rounds up to 210: 3.5 cleaner-hours × $40.
    expect(result.totalCents).toBe(14000);
    expect(result.outcome).toBe("estimate");
    expect(result.lines[0].detail).toContain("per cleaner per hour");
    expect(result.time).toEqual({ laborMinutes: 200, crewSize: 2, elapsedMinutes: 100 });
    // The minimum: 60 labor-minutes still bills 3 cleaner-hours.
    expect(quote(spec, { laborMinutes: 60 }).totalCents).toBe(12000);
  });

  it("charges the crew's hour once, however many people are in it", () => {
    const spec = service({ pricing: { method: "hourly_per_crew", rateCents: 7000, crewSize: 2, minimumHours: 2, incrementMinutes: 15, estimatedElapsedMinutes: 170 } });
    const result = quote(spec, {});
    // 170 minutes on site rounds up to 180: 3 hours × $70 for the crew.
    expect(result.totalCents).toBe(21000);
    expect(result.lines[0].detail).toContain("for the crew of 2");
    expect(result.time.laborMinutes).toBe(340);
  });

  it("does not bill an extra's time when the extra has its own price", () => {
    const spec = service({
      pricing: { method: "hourly_per_cleaner", rateCents: 4000, minimumHours: 0, incrementMinutes: 1, estimatedLaborMinutes: 120 },
      addOns: [{ id: "fridge", label: "Inside the fridge", priceCents: 3000, per: "visit", laborMinutes: 30, maxQuantity: 1 }],
    });
    const result = quote(spec, { addOns: [{ id: "fridge", quantity: 1 }] });
    expect(result.totalCents).toBe(8000 + 3000);
    expect(result.time.laborMinutes).toBe(150);
  });
});

describe("extras", () => {
  it("never charges for something the service already includes", () => {
    const spec = service({
      pricing: { method: "fixed", amountCents: 30000, laborMinutes: 300 },
      included: [{ id: "inside-oven", label: "Inside the oven", section: "Kitchen", requiresPhoto: false }],
      addOns: [{ id: "oven", label: "Oven interior", priceCents: 4000, per: "visit", laborMinutes: 30, maxQuantity: 1, coversItemId: "inside-oven" }],
    });
    const result = quote(spec, { addOns: [{ id: "oven", quantity: 1 }] });
    expect(result.totalCents).toBe(30000);
    expect(result.extras[0]).toMatchObject({ included: true, amountCents: 0 });
    expect(result.lines.find((l) => l.key === "addon:oven")?.detail).toContain("Already included");
    expect(checkSpec(spec).some((p) => p.message.includes("never be charged"))).toBe(true);
  });

  it("caps a quantity at the extra's maximum", () => {
    const spec = service({ pricing: { method: "fixed", amountCents: 10000, laborMinutes: 60 }, addOns: [{ id: "window", label: "Window", priceCents: 500, per: "item", itemWord: "window", laborMinutes: 5, maxQuantity: 10 }] });
    expect(quote(spec, { addOns: [{ id: "window", quantity: 40 }] }).totalCents).toBe(10000 + 5000);
  });
});

describe("discounts", () => {
  const withDiscounts = (stacking: "best_only" | "stack", maxTotalPercent = 50) =>
    service({
      pricing: { method: "fixed", amountCents: 20000, laborMinutes: 120 },
      modifiers: {
        ...defaultModifiers(),
        recurring: { enabled: true, options: [{ schedule: "every_7_days", discount: { kind: "percent", value: 15 } }] },
        promotions: [{ id: "new", label: "New customer", discount: { kind: "percent", value: 10 }, startsOn: null, endsOn: null, approved: true }],
        discounts: { stacking, maxTotalPercent },
      },
    });

  it("applies only the larger discount under best-only", () => {
    const result = quote(withDiscounts("best_only"), { schedule: "every_7_days", promotionId: "new" });
    expect(result.totalCents).toBe(17000);
    expect(result.lines.some((l) => l.label === "New customer not combined")).toBe(true);
  });

  it("applies the recurring discount first, then the promotion on what remains, when stacking", () => {
    const result = quote(withDiscounts("stack"), { schedule: "every_7_days", promotionId: "new" });
    // $200 − 15% = $170, then 10% of $170 = $17 → $153.
    expect(result.totalCents).toBe(15300);
    expect(result.warnings.some((w) => w.code === "discount_stacking")).toBe(true);
  });

  it("never discounts past the limit", () => {
    const result = quote(withDiscounts("stack", 20), { schedule: "every_7_days", promotionId: "new" });
    expect(result.totalCents).toBe(16000);
    expect(result.warnings.some((w) => w.code === "discount_capped")).toBe(true);
  });

  it("never applies an unapproved or out-of-date promotion", () => {
    const spec = withDiscounts("stack");
    spec.modifiers.promotions = [
      { id: "draft", label: "Draft", discount: { kind: "percent", value: 50 }, startsOn: null, endsOn: null, approved: false },
      { id: "may", label: "May", discount: { kind: "percent", value: 50 }, startsOn: "2027-05-01", endsOn: "2027-05-31", approved: true },
    ];
    expect(quote(spec, { promotionId: "draft" }).totalCents).toBe(20000);
    expect(quote(spec, { promotionId: "may", date: "2027-06-01" }).totalCents).toBe(20000);
    expect(quote(spec, { promotionId: "may", date: "2027-05-31" }).totalCents).toBe(10000);
  });

  it("discounts the cleaning, not the fees", () => {
    const spec = withDiscounts("best_only");
    spec.modifiers.area = { enabled: true, zones: [{ id: "far", label: "North county", postalCodes: ["78750"], adjustment: { kind: "fixed", value: 2500 } }], outside: "standard" };
    const result = quote(spec, { schedule: "every_7_days", postalCode: "78750" });
    expect(result.totalCents).toBe(20000 + 2500 - 3000);
  });
});

describe("minimum and rounding", () => {
  it("brings a small job up to the minimum, then rounds", () => {
    const spec = service({ pricing: { method: "per_unit", unitWord: "room", unitCents: 2999, baseCents: 0, minimumUnits: 1, laborMinutesPerUnit: 20, baseLaborMinutes: 0 }, modifiers: { ...defaultModifiers(), minimumCents: 9000, rounding: { stepCents: 500, mode: "up" } } });
    const small = quote(spec, { units: 2 });
    expect(small.totalCents).toBe(9000);
    expect(small.lines.find((l) => l.kind === "minimum")?.amountCents).toBe(9000 - 5998);
    const large = quote(spec, { units: 4 });
    expect(large.totalCents).toBe(12000);
    expect(sumOfLines(large.lines)).toBe(12000);
  });

  it("prices area at sub-cent rates without losing a cent", () => {
    const spec = service({ category: "commercial", pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 8500, laborMinutesPer1000: 45, walkthroughAbove: 20000 } });
    expect(quote(spec, { area: 1234 }).totalCents).toBe(10489);
    expect(quote(spec, { area: 20000 }).outcome).toBe("walkthrough");
  });
});

describe("recurring schedules are calendars, not 'four a month'", () => {
  it("counts every 7 days as 52.18 visits a year, about 4.35 a month on average", () => {
    const weekly = scheduleFacts("every_7_days");
    expect(weekly.visitsPerYear).toBeCloseTo(52.18, 2);
    expect(weekly.monthlyAverage).toBeCloseTo(4.35, 2);
    expect(weekly.monthlyAverage).not.toBe(4);
    expect(scheduleFacts("every_14_days").monthlyAverage).toBeCloseTo(2.17, 2);
    expect(scheduleFacts("twice_per_month").monthlyAverage).toBe(2);
  });

  it("lists real dates, with months of four and five visits", () => {
    const dates = scheduleDates("every_7_days", "2027-01-05", 12);
    const months = visitsByMonth(dates);
    expect(months).toHaveLength(12);
    expect(months.some((m) => m.visits === 5)).toBe(true);
    expect(months.some((m) => m.visits === 4)).toBe(true);
    expect(dates.length).toBe(52);
    const fortnight = visitsByMonth(scheduleDates("every_14_days", "2027-01-01", 12));
    expect(fortnight.some((m) => m.visits === 3)).toBe(true);
  });

  it("clamps calendar-month days to the month's length", () => {
    expect(scheduleDates("once_per_month", "2027-01-31", 3)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(scheduleDates("twice_per_month", "2027-02-01", 1, [1, 30])).toEqual(["2027-02-01", "2027-02-28"]);
  });

  it("prices a monthly package per calendar month and shows the per-visit annual average", () => {
    const spec = service({ pricing: { method: "recurring_package", monthlyCents: 60000, basis: "schedule", schedule: "every_7_days", includedVisits: 0, extraVisitCents: null, laborMinutesPerVisit: 120 } });
    const result = quote(spec, {});
    expect(result.per).toBe("month");
    expect(result.totalCents).toBe(60000);
    expect(result.visits).toBeCloseTo(4.35, 2);
    // $600 × 12 ÷ (365.25 ÷ 7) = $137.99, not $150.
    expect(result.lines.find((l) => l.key === "per_visit")?.detail).toContain("$137.99");
  });
});

describe("demand pricing", () => {
  const modifiers = (): Spec["modifiers"] => ({
    ...defaultModifiers(),
    demand: { enabled: true, peakDays: [{ id: "fri", label: "Fridays", weekdays: [5], from: null, to: null, percent: 10 }], busyDay: { enabled: true, thresholdPercent: 80, percent: 15 }, capPercent: 12, endsOn: null },
  });

  it("uses the larger trigger, never both, and holds to the cap", () => {
    // 2027-03-05 is a Friday.
    expect(demandPercent(modifiers(), "2027-03-05", 50).percent).toBe(10);
    expect(demandPercent(modifiers(), "2027-03-05", 90).percent).toBe(12);
    expect(demandPercent(modifiers(), "2027-03-04", 90).percent).toBe(12);
    expect(demandPercent(modifiers(), "2027-03-04", 10).percent).toBe(0);
  });

  it("does nothing while switched off, and never reads anything about the customer", () => {
    const off = modifiers();
    off.demand.enabled = false;
    expect(demandPercent(off, "2027-03-05", 99).percent).toBe(0);
    const spec = service({ pricing: { method: "fixed", amountCents: 10000, laborMinutes: 60 }, modifiers: modifiers() });
    expect(quote(spec, { date: "2027-03-05", dayFullnessPercent: 0 }).totalCents).toBe(11000);
  });

  it("refuses to switch on without a cap or a trigger", () => {
    const spec = service({ pricing: { method: "fixed", amountCents: 10000, laborMinutes: 60 }, modifiers: { ...modifiers(), demand: { enabled: true, peakDays: [], busyDay: { enabled: false, thresholdPercent: 80, percent: 0 }, capPercent: 0, endsOn: null } } });
    const problems = checkSpec(spec).filter((p) => p.field === "modifiers.demand");
    expect(problems.map((p) => p.severity)).toEqual(["blocker", "blocker"]);
  });
});

describe("walkthroughs and missing information", () => {
  it("needs a walkthrough for severe condition or a flagged answer", () => {
    const spec = service({
      pricing: { method: "fixed", amountCents: 20000, laborMinutes: 120 },
      modifiers: { ...defaultModifiers(), condition: { enabled: true, levels: defaultModifiers().condition.levels } },
      questions: [{ id: "pets", label: "Pets in the home", kind: "number", required: true, options: [], walkthroughIf: { atLeast: 4 } }],
    });
    expect(quote(spec, { condition: "severe", answers: { pets: 0 } }).outcome).toBe("walkthrough");
    expect(quote(spec, { answers: { pets: 5 } }).outcome).toBe("walkthrough");
    expect(quote(spec, {}).outcome).toBe("incomplete");
    expect(quote(spec, { answers: { pets: 1 } }).outcome).toBe("estimate");
    expect(quote(spec, { condition: "standard", answers: { pets: 1 } }).outcome).toBe("firm");
  });

  it("shows a custom quote's starting price as an estimate, never as a quote", () => {
    const spec = service({ category: "post_construction", pricing: { method: "custom_quote", fromCents: 45000, laborMinutes: null } });
    const result = quote(spec, {});
    expect(result.outcome).toBe("walkthrough");
    expect(result.totalCents).toBe(45000);
    expect(result.lines[0].label).toBe("Starting price");
  });
});

describe("short-term rental turnovers", () => {
  const spec = (): Spec => ({
    ...blankSpec("short_term_rental"),
    name: "Turnover",
    pricing: { method: "fixed", amountCents: 9500, laborMinutes: 150 },
    str: { ...defaultStr(), linenSetsPerBed: 1, setsPerLoad: 2, laundry: { location: "on_site", loadCents: 800, loadMinutes: 15, maxLoads: 2 }, checkoutTime: "11:00", checkinTime: "14:00", restock: [{ id: "coffee", label: "Coffee pods", perTurnover: 6, rule: "at_cost", markupPercent: 0 }] },
  });

  it("charges laundry by load and bills restocking after the visit, outside the total", () => {
    const result = quote(spec(), { beds: 3 });
    expect(result.str?.loads).toBe(2);
    expect(result.totalCents).toBe(9500 + 1600);
    const restock = result.lines.find((l) => l.kind === "billed_later");
    expect(restock?.detail).toContain("billed at cost after the visit");
    expect(sumOfLines(result.lines)).toBe(result.totalCents);
  });

  it("warns when the turnover cannot fit between checkout and check-in, or the laundry cannot finish", () => {
    const tight = spec();
    tight.pricing = { method: "fixed", amountCents: 9500, laborMinutes: 240 };
    const result = quote(tight, { beds: 6 });
    expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["turnover_window", "laundry_capacity"]));
  });

  it("needs the beds to make before it can price", () => {
    expect(quote(spec(), {}).outcome).toBe("incomplete");
  });
});

describe("profitability", () => {
  const costs = (patch: Partial<Costs> = {}): Costs => ({ ...emptyCosts(), suppliesPerVisitCents: 800, travelPerVisitCents: 500, equipmentPerVisitCents: 0, paymentFeePercent: 3, paymentFeeFixedCents: 30, targetMarginPercent: 40, floorMarginPercent: 25, minimumJobCents: null, ...patch });
  const spec = service({ pricing: { method: "fixed", amountCents: 20000, laborMinutes: 180 }, team: { ...blankSpec().team, crewSize: 2 } });

  it("keeps margin and markup apart, and calls the remainder contribution", () => {
    const result = profitability(quote(spec, {}), costs({ pay: { model: "hourly", hourlyCents: 2000, burdenPercent: 10 } }))!;
    // Labor: 3 labor-hours × $22 = $66. Fees: 3% of $200 + $0.30 = $6.30. Direct: $66 + $8 + $5 + $6.30 = $85.30.
    expect(result.directCents).toBe(8530);
    expect(result.contributionCents).toBe(11470);
    expect(result.contributionMarginPercent).toBe(57.4);
    expect(result.markupPercent).toBe(134.5);
    expect(result.afterOverheadCents).toBeNull();
    expect(result.warnings.some((w) => w.code === "no_overhead")).toBe(true);
  });

  it("calculates each pay model on its own terms", () => {
    const quoted = quote(spec, {});
    const perVisit = profitability(quoted, costs({ pay: { model: "per_visit", amountCents: 4500 } }))!;
    expect(perVisit.costs.find((c) => c.key === "labor")?.cents).toBe(9000);
    const share = profitability(quoted, costs({ pay: { model: "revenue_share", sharePercent: 45 } }))!;
    expect(share.costs.find((c) => c.key === "labor")?.cents).toBe(9000);
    expect(share.costs.find((c) => c.key === "labor")?.detail).toContain("45% of the $200.00 price");
  });

  it("solves the floor price including costs that grow with the price", () => {
    // Fixed $13.30 (supplies, travel, card fixed fee), 45% share + 3% fee, 25% floor margin: 1330 ÷ 0.27.
    expect(priceForMargin(1330, 48, 25)).toBe(4926);
    expect(priceForMargin(1000, 80, 25)).toBeNull();
    const result = profitability(quote(spec, {}), costs({ pay: { model: "revenue_share", sharePercent: 65 }, floorMarginPercent: 30 }))!;
    expect(result.warnings.find((w) => w.code === "below_floor")).toBeDefined();
  });

  it("lists what was not entered instead of counting it as zero", () => {
    const result = profitability(quote(spec, {}), emptyCosts())!;
    expect(result.missing).toEqual(["What you pay cleaners", "Supplies per visit", "Travel cost per visit", "Equipment per visit", "Card or payment fees"]);
  });

  it("shows operating profit before taxes only when overhead is entered", () => {
    const result = profitability(quote(spec, {}), costs({ pay: { model: "per_visit", amountCents: 4000 }, overheadPerVisitCents: 2500 }))!;
    expect(result.afterOverheadCents).toBe(result.contributionCents - 2500);
  });

  it("has no profitability for a quote with no price", () => {
    expect(profitability(quote(service({ pricing: bands }), {}), costs())).toBeNull();
  });
});

describe("services that are not ready", () => {
  it("blocks publishing illustrative amounts and unconfirmed requirements", () => {
    const spec = service({ pricing: { method: "fixed", amountCents: 1000, laborMinutes: 60 }, illustrative: true, requirements: [{ id: "ladder", label: "Ladder training for work above one story", confirmed: false }] });
    const codes = checkSpec(spec).filter((p) => p.severity === "blocker").map((p) => p.code);
    expect(codes).toEqual(["illustrative", "unconfirmed"]);
  });
});

describe("a starting price only where one exists", () => {
  it("reads the lowest advertised price from methods that have one, and none from rates", () => {
    expect(startingCents(service({ pricing: { method: "fixed", amountCents: 15000, laborMinutes: 120 } }))).toBe(15000);
    expect(startingCents(service({ pricing: { method: "size_bands", unit: "sq_ft", bands: [{ from: 1000, to: 2000, amountCents: 18000, laborMinutes: 180 }, { from: 0, to: 1000, amountCents: 12000, laborMinutes: 120 }] } }))).toBe(12000);
    expect(startingCents(service({ pricing: { method: "custom_quote", fromCents: null, laborMinutes: null } }))).toBeNull();
    expect(startingCents(service({ pricing: { method: "hourly_per_cleaner", rateCents: 4500, minimumHours: 2, incrementMinutes: 30, estimatedLaborMinutes: 240 } }))).toBeNull();
  });
});
