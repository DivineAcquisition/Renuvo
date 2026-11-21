import { describe, expect, it } from "vitest";

import { changedFigures, organizeIntoSteps } from "./assisted-text";
import { emailProblem, formatUsPhone, phoneProblem } from "./contact";
import { zipProblem } from "./list-input";
import { durationWords, numberProblem, parseNumber } from "./number";
import { crossesClockChange, timeRange } from "./schedule";

describe("numbers", () => {
  it("keeps blank apart from zero", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("   ")).toBeNull();
    expect(parseNumber("0")).toBe(0);
    expect(numberProblem("", {})).toBeNull();
    expect(numberProblem("", { required: true })).toBe("Enter a number.");
  });

  it("respects precision without rounding what was typed", () => {
    expect(parseNumber("12.5", 2)).toBe(12.5);
    expect(parseNumber("12.555", 2)).toBeNaN();
    expect(parseNumber("1,250.50", 2)).toBe(1250.5);
    expect(parseNumber("3.5")).toBeNaN();
    expect(numberProblem("3.5", {})).toBe("Enter a whole number.");
  });

  it("explains range problems in words", () => {
    expect(numberProblem("5", { min: 15, max: 2880 })).toBe("Enter a number from 15 to 2,880.");
    expect(numberProblem("1", { min: 2 })).toBe("Enter 2 or more.");
  });

  it("reads minutes back as hours and minutes", () => {
    expect(durationWords(120)).toBe("2 hours");
    expect(durationWords(150)).toBe("2 hours 30 minutes");
    expect(durationWords(45)).toBe("45 minutes");
    expect(durationWords(61)).toBe("1 hour 1 minute");
  });
});

describe("lists", () => {
  it("keeps ZIP codes as five-digit text, leading zeroes and all", () => {
    expect(zipProblem("02134")).toBeNull();
    expect(zipProblem("2134")).toMatch(/5-digit/);
    expect(zipProblem("02134-1234")).toMatch(/5-digit/);
  });
});

describe("contact details", () => {
  it("formats a complete US number and leaves anything else as typed", () => {
    expect(formatUsPhone("5125550100")).toBe("(512) 555-0100");
    expect(formatUsPhone("+1 512 555 0100")).toBe("(512) 555-0100");
    expect(formatUsPhone("555-01")).toBe("555-01");
  });

  it("explains what is wrong with a number or address", () => {
    expect(phoneProblem("")).toBeNull();
    expect(phoneProblem("555-0100")).toMatch(/10-digit/);
    expect(phoneProblem("(012) 555-0100")).toMatch(/area code/);
    expect(phoneProblem("(512) 555-0100")).toBeNull();
    expect(emailProblem("dana@example")).toMatch(/like name@example.com/);
    expect(emailProblem("dana @example.com")).toMatch(/spaces/);
    expect(emailProblem("dana@example.com")).toBeNull();
  });
});

describe("assisted writing", () => {
  it("organizes text into steps without dropping words", () => {
    expect(organizeIntoSteps("Dust the shelves. Mop the floor.\n- Empty the bins")).toBe("1. Dust the shelves.\n2. Mop the floor.\n3. Empty the bins");
  });

  it("flags a rewrite that changes a price, number or time", () => {
    expect(changedFigures("Clean 3 rooms for $120 by 9:30 am", "Clean three rooms by 9:30 am")).toEqual({ removed: ["$120", "3"].sort(), added: [] });
    expect(changedFigures("1. Dust\n2. Mop", "1. Dust\n2. Mop")).toEqual({ removed: [], added: [] });
  });
});

describe("schedules", () => {
  it("shares AM or PM across a range on the same side of noon", () => {
    const nine = Date.UTC(2027, 2, 5, 15, 0); // 9:00 AM in Chicago (CST)
    // Intl may put a narrow no-break space before AM/PM; compare with plain spaces.
    const plain = (text: string) => text.replace(/\u202f/g, " ");
    expect(plain(timeRange(nine, nine + 150 * 60000, "America/Chicago"))).toBe("9:00–11:30 AM");
    expect(plain(timeRange(nine, nine + 5 * 3600000, "America/Chicago"))).toBe("9:00 AM–2:00 PM");
  });

  it("notices when the clocks change during a visit", () => {
    // New York springs forward at 2:00 AM on March 8, 2026.
    expect(crossesClockChange(Date.UTC(2026, 2, 8, 6, 0), Date.UTC(2026, 2, 8, 8, 0), "America/New_York")).toBe(true);
    expect(crossesClockChange(Date.UTC(2026, 2, 9, 14, 0), Date.UTC(2026, 2, 9, 16, 0), "America/New_York")).toBe(false);
  });
});
