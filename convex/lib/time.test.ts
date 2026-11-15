import { describe, expect, it } from "vitest";

import { addLocalDays, clock, startOfLocalDay, when } from "./time";

const tz = "America/Chicago";

describe("company clock", () => {
  it("finds the start of the local day", () => {
    // 03:00 UTC on March 3 is 9 PM on March 2 in Chicago; that day began at 06:00 UTC on March 2.
    expect(startOfLocalDay(Date.UTC(2027, 2, 3, 3), tz)).toBe(Date.UTC(2027, 2, 2, 6));
    expect(startOfLocalDay(Date.UTC(2027, 2, 2, 6), tz)).toBe(Date.UTC(2027, 2, 2, 6));
  });

  it("steps over the day the clocks change", () => {
    // Clocks go forward on March 14, 2027: that local day is 23 hours long.
    const saturday = startOfLocalDay(Date.UTC(2027, 2, 13, 18), tz);
    const sunday = addLocalDays(saturday, 1, tz);
    const monday = addLocalDays(saturday, 2, tz);
    expect(saturday).toBe(Date.UTC(2027, 2, 13, 6));
    expect(sunday).toBe(Date.UTC(2027, 2, 14, 6));
    expect(monday).toBe(Date.UTC(2027, 2, 15, 5));
    expect(startOfLocalDay(Date.UTC(2027, 2, 14, 20), tz)).toBe(sunday);
    expect(addLocalDays(monday, -1, tz)).toBe(sunday);
  });

  it("says times the way a person would", () => {
    const asOf = Date.UTC(2027, 2, 2, 15);
    expect(clock(Date.UTC(2027, 2, 2, 20), tz)).toBe("2:00 PM");
    expect(when(Date.UTC(2027, 2, 2, 20), asOf, tz)).toBe("today at 2:00 PM");
    expect(when(Date.UTC(2027, 2, 3, 15), asOf, tz)).toBe("tomorrow at 9:00 AM");
    expect(when(Date.UTC(2027, 2, 5, 15), asOf, tz)).toBe("Fri, Mar 5 at 9:00 AM");
  });
});
