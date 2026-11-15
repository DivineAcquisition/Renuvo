import { describe, expect, it } from "vitest";

import { assess, DISPATCH_RULES, isStaffingGap, rankCleaners, type CleanerFacts, type JobFacts } from "./eligibility";
import { money, payFor } from "./pay";

const tz = "America/Chicago";
// Chicago is UTC-6 in early March 2027. March 2 is a Tuesday.
const at = (hour: number, minute = 0, day = 2) => Date.UTC(2027, 2, day, hour + 6, minute);

const job: JobFacts = { span: { startsAt: at(10), endsAt: at(12) }, requiredSkills: [], postalCode: "78701", timezone: tz, travelBufferMinutes: 30 };

function cleaner(name: string, changes: Partial<CleanerFacts> = {}): CleanerFacts {
  return {
    id: name.toLowerCase(),
    name,
    status: "ready",
    skills: [],
    serviceAreas: ["78701"],
    windows: [{ weekday: 2, startMinute: 8 * 60, endMinute: 17 * 60 }],
    timeOff: [],
    held: [],
    endedForJob: null,
    priorVisitsForCustomer: 0,
    pay: { ok: true, payCents: 8000, basis: "50% of the $160.00 job price" },
    ...changes,
  };
}

describe("who can take a visit", () => {
  it("rules a cleaner out for the first reason that applies, in plain words", () => {
    expect(assess(cleaner("Rosa"), job)).toBeNull();
    const cases: [Partial<CleanerFacts>, string, string][] = [
      [{ status: "paused" }, "not_ready", "is not marked ready for work"],
      [{ endedForJob: "declined" }, "already_asked", "already declined this visit"],
      [{ endedForJob: "expired" }, "already_asked", "did not answer an earlier offer for this visit"],
      [{ endedForJob: "released" }, "already_asked", "was released from this visit"],
      [{ endedForJob: "skipped" }, "already_asked", "was passed over for this visit by a person"],
      [{ serviceAreas: ["78702"] }, "outside_area", "does not work in 78701"],
      [{ serviceAreas: [] }, "outside_area", "has no service area set"],
      [{ windows: [] }, "outside_hours", "has not said they can work at that time"],
      [{ windows: [{ weekday: 2, startMinute: 8 * 60, endMinute: 11 * 60 }] }, "outside_hours", "has not said they can work at that time"],
      [{ timeOff: [{ startsAt: at(11), endsAt: at(15) }] }, "time_off", "has time off then"],
      [{ held: [{ startsAt: at(11), endsAt: at(13) }] }, "already_booked", "already has an offer or a job that overlaps this one"],
      [{ pay: { ok: false, code: "no_pay_set", reason: "has no pay set, so their pay for this visit cannot be worked out" } }, "no_pay", "has no pay set, so their pay for this visit cannot be worked out"],
    ];
    for (const [changes, code, reason] of cases) expect(assess(cleaner("Rosa", changes), job)).toMatchObject({ code, reason });
    expect(assess(cleaner("Rosa", { skills: ["windows"] }), { ...job, requiredSkills: ["windows", "deep clean"] })).toMatchObject({
      code: "missing_skill",
      reason: "does not have a skill the job needs: deep clean",
    });
  });

  it("keeps the company's time between two jobs, before and after", () => {
    const before = cleaner("Rosa", { held: [{ startsAt: at(8), endsAt: at(9, 45) }] });
    const after = cleaner("Rosa", { held: [{ startsAt: at(12, 29), endsAt: at(14) }] });
    expect(assess(before, job)).toMatchObject({ code: "too_close", reason: "has another job within 30 minutes of this one" });
    expect(assess(after, job)).toMatchObject({ code: "too_close" });
    // Exactly the buffer apart is enough.
    expect(assess(cleaner("Rosa", { held: [{ startsAt: at(8), endsAt: at(9, 30) }] }), job)).toBeNull();
    expect(assess(cleaner("Rosa", { held: [{ startsAt: at(12, 30), endsAt: at(14) }] }), job)).toBeNull();
    // A company that keeps no time between jobs allows back to back, and nothing else.
    expect(assess(before, { ...job, travelBufferMinutes: 0 })).toBeNull();
    expect(assess(cleaner("Rosa", { held: [{ startsAt: at(11, 59), endsAt: at(14) }] }), { ...job, travelBufferMinutes: 0 })).toMatchObject({ code: "already_booked" });
  });

  it("lets a person set some rules aside, never the ones that protect a cleaner's time", () => {
    const person = { serviceArea: false, travelBuffer: false, ended: false, pay: false };
    const rosa = cleaner("Rosa", { serviceAreas: [], endedForJob: "declined", pay: { ok: false, code: "no_pay_set", reason: "x" }, held: [{ startsAt: at(12), endsAt: at(13) }] });
    expect(assess(rosa, job, DISPATCH_RULES)).not.toBeNull();
    expect(assess(rosa, job, person)).toBeNull();
    expect(assess({ ...rosa, timeOff: [{ startsAt: at(9), endsAt: at(11) }] }, job, person)).toMatchObject({ code: "time_off" });
    expect(assess({ ...rosa, windows: [] }, job, person)).toMatchObject({ code: "outside_hours" });
    expect(assess({ ...rosa, held: [{ startsAt: at(11), endsAt: at(13) }] }, job, person)).toMatchObject({ code: "already_booked" });
    expect(assess({ ...rosa, status: "onboarding" }, job, person)).toMatchObject({ code: "not_ready" });
  });

  it("asks the cleaner the customer knows first, then the lighter day, then by name", () => {
    const { candidates, excluded } = rankCleaners(
      [
        cleaner("Zoe"),
        cleaner("Ana", { held: [{ startsAt: at(14), endsAt: at(16) }] }),
        cleaner("Bea", { priorVisitsForCustomer: 2, held: [{ startsAt: at(14), endsAt: at(16) }] }),
        cleaner("Cam", { priorVisitsForCustomer: 2 }),
        cleaner("Dee", { priorVisitsForCustomer: 5, held: [{ startsAt: at(14), endsAt: at(16) }, { startsAt: at(10, 0, 3), endsAt: at(12, 0, 3) }] }),
        cleaner("Eve"),
        cleaner("Off", { timeOff: [{ startsAt: at(0), endsAt: at(23) }] }),
      ],
      job,
    );
    expect(candidates.map((entry) => entry.name)).toEqual(["Dee", "Cam", "Bea", "Eve", "Zoe", "Ana"]);
    // Only that day's visits count as the day's load.
    expect(candidates[0]).toMatchObject({ priorVisitsForCustomer: 5, otherVisitsThatDay: 1 });
    expect(candidates[0].reasons).toEqual(["is free then", "works in 78701", "has taken 5 visits for this customer before", "has 1 other visit that day"]);
    expect(candidates[3].reasons).toEqual(["is free then", "works in 78701", "has no other visits that day"]);
    expect(excluded).toEqual([{ cleanerId: "off", name: "Off", code: "time_off", reason: "has time off then" }]);
    // The same people in another order rank the same.
    const again = rankCleaners([cleaner("Eve"), cleaner("Zoe"), cleaner("Cam", { priorVisitsForCustomer: 2 })], job);
    expect(again.candidates.map((entry) => entry.name)).toEqual(["Cam", "Eve", "Zoe"]);
  });

  it("tells a staffing gap from a setup problem or a person's choice", () => {
    const gap = rankCleaners([cleaner("Ana", { serviceAreas: ["1"] }), cleaner("Bea", { endedForJob: "declined" })], job);
    expect(gap.candidates).toEqual([]);
    expect(isStaffingGap(gap.excluded)).toBe(true);
    expect(isStaffingGap([])).toBe(true);
    const noPay = rankCleaners([cleaner("Ana", { serviceAreas: ["1"] }), cleaner("Bea", { pay: { ok: false, code: "no_pay_set", reason: "x" } })], job);
    expect(isStaffingGap(noPay.excluded)).toBe(false);
    const passedOver = rankCleaners([cleaner("Ana", { endedForJob: "skipped" })], job);
    expect(isStaffingGap(passedOver.excluded)).toBe(false);
  });
});

describe("a cleaner's pay for a visit", () => {
  const visit = { priceCents: 16000, startsAt: at(10), endsAt: at(12) };

  it("is a share of the job for a contractor, to the whole cent", () => {
    expect(payFor({ pay: { kind: "share", shareBps: 5500 } }, visit)).toEqual({ ok: true, payCents: 8800, basis: "55% of the $160.00 job price" });
    expect(payFor({ pay: { kind: "share", shareBps: 3333 } }, { ...visit, priceCents: 10001 })).toEqual({ ok: true, payCents: 3333, basis: "33.33% of the $100.01 job price" });
    expect(payFor({ pay: { kind: "share", shareBps: 0 } }, visit)).toMatchObject({ ok: true, payCents: 0 });
  });

  it("is the hourly rate times the length of the visit for an employee", () => {
    expect(payFor({ pay: { kind: "hourly", hourlyCents: 2200 } }, visit)).toEqual({ ok: true, payCents: 4400, basis: "$22.00 an hour for 2 hours" });
    expect(payFor({ pay: { kind: "hourly", hourlyCents: 2200 } }, { startsAt: at(10), endsAt: at(11, 30) })).toEqual({ ok: true, payCents: 3300, basis: "$22.00 an hour for 1.5 hours" });
    expect(payFor({ pay: { kind: "hourly", hourlyCents: 2001 } }, { startsAt: at(10), endsAt: at(10, 50) })).toMatchObject({ ok: true, payCents: 1668 });
  });

  it("gives no number when the price or the rate is missing", () => {
    expect(payFor({}, visit)).toMatchObject({ ok: false, code: "no_pay_set" });
    expect(payFor({ pay: { kind: "share", shareBps: 5000 } }, { startsAt: at(10), endsAt: at(12) })).toEqual({
      ok: false,
      code: "no_job_price",
      reason: "is paid a share of the job, and this job has no price",
    });
    expect(money(123456)).toBe("$1,234.56");
    expect(money(5)).toBe("$0.05");
  });
});
