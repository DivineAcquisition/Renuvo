import { describe, expect, it } from "vitest";

import { availabilityFor, isTimezone, localParts, overlaps, withinWeeklyWindows } from "./availability";

const tz = "America/Chicago";
const at = (day: number, hour: number, minute = 0) => Date.UTC(2027, 2, day, hour + 6, minute); // Chicago is UTC-6 in early March 2027.
const tuesday = [{ weekday: 2, startMinute: 8 * 60, endMinute: 17 * 60 }];

describe("availability", () => {
  it("reads an instant on the company's clock", () => {
    expect(localParts(at(2, 10, 30), tz)).toEqual({ weekday: 2, minute: 630, day: "2027-03-02" });
    // 03:00 UTC on Wednesday is still Tuesday evening in Chicago.
    expect(localParts(Date.UTC(2027, 2, 3, 3), tz)).toEqual({ weekday: 2, minute: 21 * 60, day: "2027-03-02" });
    expect(isTimezone(tz)).toBe(true);
    expect(isTimezone("Mars/Olympus")).toBe(false);
  });

  it("needs the whole job inside one window", () => {
    expect(withinWeeklyWindows(tuesday, { startsAt: at(2, 8), endsAt: at(2, 17) }, tz)).toBe(true);
    expect(withinWeeklyWindows(tuesday, { startsAt: at(2, 7, 59), endsAt: at(2, 10) }, tz)).toBe(false);
    expect(withinWeeklyWindows(tuesday, { startsAt: at(2, 16), endsAt: at(2, 17, 1) }, tz)).toBe(false);
    expect(withinWeeklyWindows(tuesday, { startsAt: at(3, 10), endsAt: at(3, 12) }, tz)).toBe(false);
    expect(withinWeeklyWindows([], { startsAt: at(2, 10), endsAt: at(2, 12) }, tz)).toBe(false);
    // Two windows that touch do not add up to one the job can straddle.
    const split = [
      { weekday: 2, startMinute: 8 * 60, endMinute: 12 * 60 },
      { weekday: 2, startMinute: 12 * 60, endMinute: 17 * 60 },
    ];
    expect(withinWeeklyWindows(split, { startsAt: at(2, 11), endsAt: at(2, 13) }, tz)).toBe(false);
  });

  it("gives the reason a cleaner is not free", () => {
    const span = { startsAt: at(2, 10), endsAt: at(2, 12) };
    const base = { windows: tuesday, timeOff: [], booked: [], span, timezone: tz };
    expect(availabilityFor(base)).toEqual({ available: true });
    expect(availabilityFor({ ...base, windows: [] })).toEqual({ available: false, reason: "outside_hours" });
    expect(availabilityFor({ ...base, timeOff: [{ startsAt: at(2, 11), endsAt: at(2, 23) }] })).toEqual({ available: false, reason: "time_off" });
    expect(availabilityFor({ ...base, booked: [{ startsAt: at(2, 11, 59), endsAt: at(2, 14) }] })).toEqual({ available: false, reason: "already_booked" });
    // Back to back is not an overlap.
    expect(availabilityFor({ ...base, booked: [{ startsAt: at(2, 12), endsAt: at(2, 14) }] })).toEqual({ available: true });
    expect(overlaps({ startsAt: 1, endsAt: 2 }, { startsAt: 2, endsAt: 3 })).toBe(false);
  });
});
