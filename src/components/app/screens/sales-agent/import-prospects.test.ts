import { describe, expect, it } from "vitest";

import { readProspects } from "./import-prospects";

describe("reading pasted prospects", () => {
  it("finds the name, a phone or an email, and keeps the rest as a note", () => {
    expect(readProspects("Dana Whitfield, 512-555-0142, asked about a deep clean, in May\nSam Ortiz; sam@example.com\n\n")).toEqual([
      { name: "Dana Whitfield", phone: "512-555-0142", note: "asked about a deep clean, in May", problem: null },
      { name: "Sam Ortiz", email: "sam@example.com", note: "", problem: null },
    ]);
  });

  it("marks a line with nobody to reach or no name, instead of guessing", () => {
    expect(readProspects("Just A Name\n512-555-0142").map((row) => row.problem)).toEqual(["No phone number or email address", "No name"]);
  });
});
