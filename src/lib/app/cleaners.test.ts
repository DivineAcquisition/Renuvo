import { describe, expect, it } from "vitest";

import { activeFilterCount, cleanerPath, EMPTY_STATE, filterRows, guessColumns, parseCsv, parseDirectory, writeDirectory, type FilterableRow } from "./cleaners";

const row = (over: Partial<FilterableRow>): FilterableRow => ({
  cleanerId: "c1aaaaaaaa",
  name: "Rosa Diaz",
  preferredName: null,
  engagement: "contractor",
  status: "ready",
  readiness: { state: "ready" },
  serviceAreas: ["78701"],
  skills: ["deep clean"],
  crews: [],
  subcontractor: null,
  phone: "(512) 555-0100",
  email: "rosa@example.com",
  attention: 0,
  workingToday: false,
  ...over,
});

describe("the directory's address", () => {
  it("round-trips every filter, the view, the window and the open worker, and keeps other parameters", () => {
    const state = { ...EMPTY_STATE, q: "rosa", view: "table" as const, type: ["contractor"], readiness: ["blocked" as const], crew: ["crew1"], quick: "attention" as const, window: { date: "2027-03-05", from: "13:00", to: "17:00" }, open: "abcdefgh12" };
    const query = writeDirectory(state, new URLSearchParams("open=job:abc12345"));
    const parsed = parseDirectory(new URLSearchParams(query));
    expect(parsed).toEqual(state);
    expect(new URLSearchParams(query).get("open")).toBe("job:abc12345");
    expect(writeDirectory(EMPTY_STATE)).toBe("");
    expect(activeFilterCount(state)).toBe(5);
  });

  it("ignores anything malformed instead of guessing", () => {
    const parsed = parseDirectory(new URLSearchParams("view=grid&readiness=ready,nonsense&quick=everyone&avail=2027-03-05,17:00,13:00&cleaner=../../x"));
    expect(parsed.view).toBe("cards");
    expect(parsed.readiness).toEqual(["ready"]);
    expect(parsed.quick).toBeNull();
    expect(parsed.window).toBeNull();
    expect(parsed.open).toBeNull();
  });

  it("deep-links a profile section", () => {
    expect(cleanerPath("abc")).toBe("/app/cleaners/abc");
    expect(cleanerPath("abc", "overview")).toBe("/app/cleaners/abc");
    expect(cleanerPath("abc", "availability")).toBe("/app/cleaners/abc?section=availability");
  });
});

describe("filtering", () => {
  const rows = [
    row({}),
    row({ cleanerId: "c2", name: "José Ruiz", engagement: "employee", status: "onboarding", readiness: { state: "onboarding" }, serviceAreas: ["78702"], skills: [], phone: null, attention: 1 }),
    row({ cleanerId: "c3", name: "Lena Park", engagement: "subcontracted", subcontractor: { id: "s1", name: "Sparkle Partners" }, crews: [{ id: "k1" }], workingToday: true }),
  ];
  it("searches names without accents, contact details, areas, skills and company", () => {
    expect(filterRows(rows, { ...EMPTY_STATE, q: "jose" }).map((r) => r.name)).toEqual(["José Ruiz"]);
    expect(filterRows(rows, { ...EMPTY_STATE, q: "5550100" }).map((r) => r.cleanerId)).toEqual(["c1aaaaaaaa", "c3"]);
    expect(filterRows(rows, { ...EMPTY_STATE, q: "sparkle" }).map((r) => r.name)).toEqual(["Lena Park"]);
    expect(filterRows(rows, { ...EMPTY_STATE, q: "deep 78701" }).length).toBe(2);
  });
  it("applies each filter, and an availability window only with an answer for it", () => {
    expect(filterRows(rows, { ...EMPTY_STATE, type: ["employee"] }).map((r) => r.name)).toEqual(["José Ruiz"]);
    expect(filterRows(rows, { ...EMPTY_STATE, quick: "attention" }).map((r) => r.name)).toEqual(["José Ruiz"]);
    expect(filterRows(rows, { ...EMPTY_STATE, quick: "working_today" }).map((r) => r.name)).toEqual(["Lena Park"]);
    expect(filterRows(rows, { ...EMPTY_STATE, crew: ["k1"] }).map((r) => r.name)).toEqual(["Lena Park"]);
    const window = { ...EMPTY_STATE, window: { date: "2027-03-05", from: "09:00", to: "12:00" } };
    expect(filterRows(rows, window, { c1aaaaaaaa: { available: true }, c3: { available: false } }).map((r) => r.name)).toEqual(["Rosa Diaz"]);
  });
});

describe("reading a list", () => {
  it("reads quoted fields, doubled quotes, tabs and blank lines", () => {
    expect(parseCsv('﻿Name,Skills\r\n"Diaz, Rosa","deep clean; ""windows"""\n\nLena\tPark\n')).toEqual([
      ["Name", "Skills"],
      ["Diaz, Rosa", 'deep clean; "windows"'],
      ["Lena", "Park"],
    ]);
  });
  it("places columns by their headers and leaves unknown ones unused", () => {
    expect(guessColumns(["Full Name", "Mobile", "E-mail", "Zip Codes", "Favorite color", "Worker_Type"])).toEqual({ name: 0, phone: 1, email: 2, serviceAreas: 3, workerType: 5 });
  });
});
