import { describe, expect, it } from "vitest";

import { sourceWords, suggestionState } from "./assist";
import { joinIds } from "./field-context";
import { addressLine, agreementTypeOptions, cleanerOption, customerOption, propertyOption, serviceOption } from "./records";
import { groupOptions, matches } from "./types";

describe("suggestions", () => {
  it("offers a proposal that differs from the field", () => {
    expect(suggestionState({ current: "Austin", proposed: "Austin, TX", dismissed: [] })).toEqual({ offer: true, stale: false });
  });

  it("offers nothing when the field already holds it, or it was dismissed", () => {
    expect(suggestionState({ current: "Austin, TX", proposed: "Austin, TX", dismissed: [] }).offer).toBe(false);
    expect(suggestionState({ current: "", proposed: "Austin, TX", dismissed: [JSON.stringify("Austin, TX")] }).offer).toBe(false);
    expect(suggestionState({ current: "", proposed: null, dismissed: [] }).offer).toBe(false);
  });

  it("stays an offer after the owner edits, and goes stale when its inputs change", () => {
    const owner = suggestionState({ current: "Round Rock", proposed: "Austin, TX", basedOn: "v1", inputs: "v1", dismissed: [] });
    expect(owner).toEqual({ offer: true, stale: false });
    expect(suggestionState({ current: "Round Rock", proposed: "Austin, TX", basedOn: "v1", inputs: "v2", dismissed: [] }).stale).toBe(true);
  });

  it("compares lists by content", () => {
    expect(suggestionState({ current: ["residential"], proposed: ["residential"], dismissed: [] }).offer).toBe(false);
  });

  it("names the source in words, and an agent by name", () => {
    expect(sourceWords({ kind: "agent", agent: "Dispatch" })).toBe("Suggested by Dispatch");
    expect(sourceWords({ kind: "import", detail: "clients.csv" })).toBe("Imported from clients.csv");
    expect(sourceWords({ kind: "website" })).toBe("Found on your website");
    expect(sourceWords({ kind: "confirmed" })).toBe("Confirmed by you");
  });
});

describe("options", () => {
  const options = [
    { value: "a", label: "Ana Ortiz", keywords: ["512-555-0101"], group: "Customers" },
    { value: "b", label: "Élan Properties", group: "Customers" },
    { value: "c", label: "Main St", group: "Properties" },
  ];

  it("matches label, keywords and accents", () => {
    expect(matches(options[0], "ortiz")).toBe(true);
    expect(matches(options[0], "555-0101")).toBe(true);
    expect(matches(options[1], "elan")).toBe(true);
    expect(matches(options[2], "ortiz")).toBe(false);
  });

  it("groups consecutive options without reordering them", () => {
    expect(groupOptions(options).map((row) => [row.group, row.options.length])).toEqual([
      ["Customers", 2],
      ["Properties", 1],
    ]);
  });

  it("joins description ids without blanks or repeats", () => {
    expect(joinIds("a", undefined, "a b", null, "")).toBe("a b");
    expect(joinIds(undefined, false)).toBeUndefined();
  });
});

describe("record options", () => {
  it("tells customers apart by contact details, and searches them", () => {
    const option = customerOption({ _id: "c1", name: "Ana Ortiz", type: "business", email: "ana@example.com", phone: "512-555-0101" });
    expect(option).toMatchObject({ value: "c1", label: "Ana Ortiz", meta: "Business · ana@example.com · 512-555-0101" });
    expect(matches(option, "555-0101")).toBe(true);
    expect(customerOption({ _id: "c2", name: "Ben" }).meta).toBeUndefined();
  });

  it("shows a property's full address and its customer", () => {
    const address = { line1: "12 Main St", line2: "Apt 4", city: "Austin", region: "TX", postalCode: "78701" };
    expect(addressLine(address)).toBe("12 Main St, Apt 4, Austin, TX 78701");
    expect(propertyOption({ _id: "p1", label: "Lake house", address }, "Ana Ortiz")).toMatchObject({ label: "Lake house", meta: "12 Main St, Apt 4, Austin, TX 78701 · Ana Ortiz" });
    expect(propertyOption({ _id: "p2", address }).label).toBe("12 Main St, Austin");
    expect(matches(propertyOption({ _id: "p2", address }), "78701")).toBe(true);
  });

  it("lists a cleaner's confirmed skills and never claims availability it doesn't have", () => {
    const option = cleanerOption({ _id: "k1", name: "Rosa", skills: ["deep", "move-out", "windows", "ovens"] });
    expect(option.meta).toBe("deep, move-out, windows +1");
    expect(String(option.meta)).not.toMatch(/available/i);
    expect(matches(option, "ovens")).toBe(true);
    expect(cleanerOption({ _id: "k2", name: "Sam" }).meta).toBeUndefined();
  });

  it("shows a service's published price only when it has one", () => {
    expect(serviceOption({ id: "s1", name: "Standard", startingPriceCents: 15000, durationMinutes: 120 }).meta).toBe("From $150 · 120 min");
    expect(serviceOption({ id: "s2", name: "Custom" }).meta).toBeUndefined();
  });

  it("keeps each family of agreement kinds together without changing their keys", () => {
    const options = agreementTypeOptions([
      { key: "a", label: "Service agreement", family: "Customers" },
      { key: "b", label: "Contractor agreement", family: "Workers" },
      { key: "c", label: "Cancellation policy", family: "Customers" },
    ]);
    expect(options.map((o) => o.value)).toEqual(["a", "c", "b"]);
    expect(groupOptions(options).map((g) => g.group)).toEqual(["Customers", "Workers"]);
  });
});
