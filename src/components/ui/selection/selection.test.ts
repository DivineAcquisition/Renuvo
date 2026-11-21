import { describe, expect, it } from "vitest";

import { sourceWords, suggestionState } from "./assist";
import { joinIds } from "./field-context";
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
