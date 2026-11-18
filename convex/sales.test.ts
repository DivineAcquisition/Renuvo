import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, readyCleaner, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { cadenceDates, cadenceProblem, localInstant, previewVisits, pricingSchedule, visitsPerMonth } from "./lib/sales/cadence";
import { blankSpec, type Spec } from "./lib/services/spec";

const notice = { required: false, note: "" };

export function homeSpec(patch: Partial<Spec> = {}): Spec {
  return {
    ...blankSpec("residential"),
    name: "Standard clean",
    summary: "A full clean of the living areas, kitchen and bathrooms.",
    included: [{ id: "counters", label: "Wipe kitchen counters", section: "Kitchen", requiresPhoto: false }],
    excluded: ["Inside the oven"],
    pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1000, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 },
    ...patch,
  };
}

type As = Awaited<ReturnType<typeof company>>["as"];

export async function publish(as: As, companyId: Id<"companies">, spec: Spec) {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch it.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  const service = await as.query(api.services.service, { companyId, serviceId });
  return service.service.key;
}

describe("cadences", () => {
  it("keeps every four weeks apart from monthly and every two weeks apart from twice a month", () => {
    expect(pricingSchedule({ kind: "every_4_weeks", weekday: 2 })).toBe("every_28_days");
    expect(pricingSchedule({ kind: "monthly", dayOfMonth: 2 })).toBe("once_per_month");
    expect(pricingSchedule({ kind: "every_2_weeks", weekday: 2 })).toBe("every_14_days");
    expect(pricingSchedule({ kind: "twice_monthly", days: [1, 15] })).toBe("twice_per_month");
    const fourWeekly = cadenceDates({ kind: "every_4_weeks", weekday: 2 }, "2027-03-02", "2027-03-02", "2028-02-28");
    const monthly = cadenceDates({ kind: "monthly", dayOfMonth: 2 }, "2027-03-02", "2027-03-02", "2028-02-28");
    expect(fourWeekly).toHaveLength(13);
    expect(monthly).toHaveLength(12);
  });

  it("counts real dates per month instead of assuming four weekly visits", () => {
    const weekly = cadenceDates({ kind: "weekly", weekdays: [1] }, "2027-03-01", "2027-03-01", "2027-05-31");
    expect(visitsPerMonth(weekly)).toEqual([
      { month: "2027-03", visits: 5 },
      { month: "2027-04", visits: 4 },
      { month: "2027-05", visits: 5 },
    ]);
  });

  it("supports several visits a week, anchored on the first date", () => {
    expect(cadenceDates({ kind: "weekly", weekdays: [1, 4] }, "2027-03-01", "2027-03-01", "2027-03-14")).toEqual(["2027-03-01", "2027-03-04", "2027-03-08", "2027-03-11"]);
    // Every two weeks stays on the anchor's weeks even when the window starts later.
    expect(cadenceDates({ kind: "every_2_weeks", weekday: 2 }, "2027-03-02", "2027-03-10", "2027-04-01")).toEqual(["2027-03-16", "2027-03-30"]);
  });

  it("uses the month's last day for day 31 and for 'last day'", () => {
    expect(cadenceDates({ kind: "monthly", dayOfMonth: 31 }, "2027-01-31", "2027-01-31", "2027-04-30")).toEqual(["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
    expect(cadenceDates({ kind: "twice_monthly", days: [15, 0] }, "2028-02-01", "2028-02-01", "2028-02-29")).toEqual(["2028-02-15", "2028-02-29"]);
  });

  it("rejects cadences a person could not mean", () => {
    expect(cadenceProblem({ kind: "weekly", weekdays: [] })).toMatch(/at least one/);
    expect(cadenceProblem({ kind: "twice_monthly", days: [10, 12] })).toMatch(/a week apart/);
    expect(cadenceProblem({ kind: "twice_monthly", days: [5, 5] })).toMatch(/different/);
  });

  it("keeps the clock time across daylight-saving changes", () => {
    const before = localInstant("2027-03-13", 9 * 60, "America/Chicago");
    const after = localInstant("2027-03-15", 9 * 60, "America/Chicago");
    expect(new Date(before).getUTCHours()).toBe(15);
    expect(new Date(after).getUTCHours()).toBe(14);
  });

  it("marks closed days as conflicts in the preview and never moves them", () => {
    const visits = previewVisits({ cadence: { kind: "weekly", weekdays: [0] }, firstDate: "2027-03-07", count: 3, closedWeekdays: [0] });
    expect(visits.map((v) => v.date)).toEqual(["2027-03-07", "2027-03-14", "2027-03-21"]);
    expect(visits.every((v) => v.conflict)).toBe(true);
    expect(visits[0]!.first).toBe(true);
  });
});

describe("sales workspace drafts and quotes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const t = start();
    const owner = await company(t, "owner-a", "Alpha Cleaning");
    const key = await publish(owner.as, owner.companyId, homeSpec());
    return { t, ...owner, key };
  }

  it("prices a booking on the server from the published service and lists what is still needed", async () => {
    const { as, companyId, key } = await setup();
    const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "booking" });
    let draft = await as.query(api.sales.draft, { companyId, draftId });
    expect(draft.catalog.map((s) => s.key)).toContain(key);
    let summary = await as.query(api.sales.price, { companyId, draftId });
    expect(summary.mode).toBe("booking");
    if (summary.mode !== "booking") throw new Error();
    expect(summary.needs.map((n) => n.key)).toEqual(expect.arrayContaining(["customer", "property", "service", "date", "time", "payment"]));

    const created = await as.mutation(api.sales.quickCreate, {
      companyId,
      draftId,
      customer: { name: "Dana Whitfield", email: "dana@example.com" },
      property: { address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" } },
      confirmedNew: false,
    });
    if (!created.created) throw new Error();
    draft = await as.query(api.sales.draft, { companyId, draftId });
    await as.mutation(api.sales.saveDraft, { companyId, draftId, revision: draft.draft.revision, customerId: created.customerId, propertyId: created.propertyId, body: { service: { key, input: { bedrooms: 3, bathrooms: 2 } }, payment: { policy: "deposit", depositCents: 5000 }, schedule: { date: "2027-03-02", arrivalMinute: 9 * 60 } } });
    summary = await as.query(api.sales.price, { companyId, draftId });
    if (summary.mode !== "booking") throw new Error();
    // 120 + 2 bedrooms × 20 + 1 bathroom × 25 = 185.
    expect(summary.firstCents).toBe(18500);
    expect(summary.dueNowCents).toBe(5000);
    expect(summary.dueLaterCents).toBe(13500);
    expect(summary.needs.find((n) => n.key === "service")).toBeUndefined();
    // Nobody has set availability, so capacity is unknown rather than guessed.
    expect(summary.capacity?.state).toBe("unknown");
    // The Owner sees contribution; costs are not set up, so it says so instead of claiming a profit.
    expect(summary.contribution).not.toBeNull();
  });

  it("warns about duplicates instead of merging, and creates only when the person confirms", async () => {
    const { as, companyId } = await setup();
    await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home", email: "dana@example.com" });
    const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "booking" });
    const first = await as.mutation(api.sales.quickCreate, { companyId, draftId, customer: { name: "D. Whitfield", email: "DANA@example.com" }, confirmedNew: false });
    expect(first.created).toBe(false);
    if (first.created) throw new Error();
    expect(first.duplicates[0]!.why).toMatch(/email/);
    const second = await as.mutation(api.sales.quickCreate, { companyId, draftId, customer: { name: "D. Whitfield", email: "dana@example.com" }, confirmedNew: true });
    expect(second.created).toBe(true);
    const found = await as.query(api.sales.findCustomers, { companyId, q: "whitfield" });
    expect(found).toHaveLength(2);
  });

  it("prices recurring service with a different first visit and saves a quote with both", async () => {
    const { as, companyId, key } = await setup();
    const deepKey = await publish(as, companyId, homeSpec({ name: "Deep clean", pricing: { method: "bed_bath", baseCents: 20000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 3000, perBathroomCents: 3000, perHalfBathCents: 1000, baseLaborMinutes: 200, perBedroomMinutes: 40, perBathroomMinutes: 40, perHalfBathMinutes: 20 } }));
    const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "booking", bookingKind: "recurring" });
    const riya = await as.mutation(api.sales.quickCreate, { companyId, draftId, customer: { name: "Riya Shah", phone: "512-555-0100" }, property: { address: { line1: "4 Oak Ave", city: "Austin", region: "TX", postalCode: "78702" } }, confirmedNew: false });
    if (!riya.created) throw new Error();
    const draft = await as.query(api.sales.draft, { companyId, draftId });
    await as.mutation(api.sales.saveDraft, {
      companyId,
      draftId,
      revision: draft.draft.revision,
      customerId: riya.customerId,
      propertyId: riya.propertyId,
      body: {
        service: { key, input: { bedrooms: 2, bathrooms: 1 } },
        firstVisit: { mode: "different", service: { key: deepKey, input: { bedrooms: 2, bathrooms: 1 } } },
        recurring: { cadence: { kind: "every_4_weeks", weekday: 2 }, billing: "per_visit" },
        payment: { policy: "after_service" },
      },
    });
    const summary = await as.query(api.sales.price, { companyId, draftId });
    if (summary.mode !== "booking") throw new Error();
    expect(summary.first?.name).toBe("Deep clean");
    expect(summary.firstCents).toBe(23000);
    expect(summary.ongoingCents).toBe(14000);
    expect(summary.dueNowCents).toBe(0);
    // The service has no every-4-weeks rate, which is said rather than borrowed from monthly.
    expect(summary.recurringNote).toMatch(/no recurring rate/);
    const latest = await as.query(api.sales.draft, { companyId, draftId });
    const saved = await as.mutation(api.sales.saveQuoteFromDraft, { companyId, draftId, revision: latest.draft.revision });
    const list = await as.query(api.sales.quotes, { companyId });
    expect(list[0]!._id).toBe(saved.quoteId);
    expect(list[0]!.firstCents).toBe(23000);
    expect(list[0]!.cadence).toMatch(/Every 4 weeks/);
  });

  it("refuses a stale revision and keeps other companies' drafts out of reach", async () => {
    const { t, as, companyId } = await setup();
    const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "booking" });
    await as.mutation(api.sales.saveDraft, { companyId, draftId, revision: 0, body: { notes: { office: "first" } } });
    expect(await refusal(as.mutation(api.sales.saveDraft, { companyId, draftId, revision: 0, body: { notes: { office: "second" } } }))).toMatch(/another window/);
    const other = await company(t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.sales.draft, { companyId: other.companyId, draftId }))).toMatch(/not found/i);
  });

  it("lets office staff take a booking draft and records who did", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-1", "office");
    const draftId = await office.mutation(api.sales.startDraft, { companyId, mode: "booking" });
    const view = await office.query(api.sales.draft, { companyId, draftId });
    expect(view.createdBy).not.toBe("A team member");
    const summary = await office.query(api.sales.price, { companyId, draftId });
    if (summary.mode !== "booking") throw new Error();
    expect(summary.contribution).toBeNull();
  });

  it("reports capacity from cleaners' availability", async () => {
    const { as, companyId } = await setup();
    await readyCleaner(as, companyId, "Ana");
    const at = localInstant("2027-03-02", 9 * 60, "America/Chicago");
    const fits = await as.query(api.sales.capacity, { companyId, startsAt: at, minutes: 120, crew: 1 });
    expect(fits.state).toBe("tight");
    const full = await as.query(api.sales.capacity, { companyId, startsAt: at, minutes: 120, crew: 2 });
    expect(full.state).toBe("full");
  });
});
