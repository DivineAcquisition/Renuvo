import { describe, expect, it } from "vitest";

import { ago, centsFrom, greeting, money, until, whenLabel, zonedInstant } from "./format";

const tz = "America/Chicago";
const now = Date.UTC(2027, 2, 2, 15); // 9:00 AM in Chicago

describe("formatting", () => {
  it("places a date and time on the company's clock", () => {
    expect(zonedInstant("2027-03-02", "10:00", tz)).toBe(Date.UTC(2027, 2, 2, 16));
    // After the clocks go forward on March 14, Chicago is five hours behind UTC.
    expect(zonedInstant("2027-03-15", "10:00", tz)).toBe(Date.UTC(2027, 2, 15, 15));
    // 2:30 AM on the day the clocks go forward does not exist.
    expect(zonedInstant("2027-03-14", "02:30", tz)).toBeNull();
    expect(zonedInstant("tomorrow", "10:00", tz)).toBeNull();
  });

  it("reads money without floating point", () => {
    expect(centsFrom("72")).toBe(7200);
    expect(centsFrom("$1,250.5")).toBe(125050);
    expect(centsFrom("19.99")).toBe(1999);
    expect(centsFrom("0.1")).toBe(10);
    expect(centsFrom("12.345")).toBeNull();
    expect(centsFrom("about 50")).toBeNull();
    expect(money(7200)).toBe("$72");
    expect(money(1999)).toBe("$19.99");
  });

  it("says when", () => {
    expect(whenLabel(Date.UTC(2027, 2, 2, 20), now, tz)).toBe("today at 2:00 PM");
    expect(whenLabel(Date.UTC(2027, 2, 3, 15), now, tz)).toBe("tomorrow at 9:00 AM");
    expect(ago(now - 30_000, now, tz)).toBe("just now");
    expect(ago(now - 5 * 60_000, now, tz)).toBe("5 min ago");
    expect(until(now + 2 * 3_600_000, now)).toEqual({ text: "in 2 h", late: false, soon: true });
    expect(until(now - 10 * 60_000, now)).toEqual({ text: "10 min overdue", late: true, soon: true });
    expect(greeting(now, tz)).toBe("Good morning");
    expect(greeting(now + 9 * 3_600_000, tz)).toBe("Good evening");
  });
});
