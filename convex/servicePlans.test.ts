import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, refusal, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { blankSpec, defaultModifiers, type Spec } from "./lib/services/spec";

const notice = { required: false, note: "" };
const DAY = 24 * 60 * 60 * 1000;
const address = (line1: string, postalCode = "78701") => ({ line1, city: "Austin", region: "TX", postalCode });

/** A home clean: $120 for 1 bed 1 bath, +$20 a bedroom; 10% off every 7 days; the first clean is 25% more and 50% longer. */
function homeSpec(): Spec {
  return {
    ...blankSpec("residential"),
    name: "Standard clean",
    summary: "A full clean.",
    included: [{ id: "counters", label: "Wipe kitchen counters", section: "Kitchen", requiresPhoto: false }],
    pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1000, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 },
    modifiers: { ...defaultModifiers(), recurring: { enabled: true, options: [{ schedule: "every_7_days", discount: { kind: "percent", value: 10 } }] }, firstClean: { enabled: true, price: { kind: "percent", value: 25 }, timePercent: 50 } },
  };
}

function turnoverSpec(): Spec {
  return { ...blankSpec("short_term_rental"), name: "Airbnb turnover", summary: "Turnover.", included: [{ id: "beds", label: "Make the beds", section: "Bedrooms", requiresPhoto: false }], pricing: { method: "fixed", amountCents: 14000, laborMinutes: 150 } };
}

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  return { t, ...owner };
}
type As = Awaited<ReturnType<typeof setup>>["as"];

async function publish(as: As, companyId: Id<"companies">, spec: Spec) {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  return serviceId;
}

async function client(as: As, companyId: Id<"companies">, name = "Dana Whitfield", kind: "home" | "short_term_rental" | "office" = "home") {
  const result = await as.mutation(api.clients.create, { companyId, type: "person", name, kind: kind === "office" ? "commercial" : kind, contact: { name, phone: "512-555-0100" }, property: { address: address("12 Elm St"), kind }, addAnyway: true });
  if (!result.created) throw new Error("not created");
  const profile = await as.query(api.clients.profile, { companyId, customerId: result.customerId });
  return { customerId: result.customerId, propertyId: profile.properties[0].id as Id<"properties"> };
}

async function weekly(as: As, companyId: Id<"companies">, start = true) {
  const serviceId = await publish(as, companyId, homeSpec());
  const where = await client(as, companyId);
  const created = await as.mutation(api.servicePlans.create, { companyId, ...where, serviceId, kind: "recurring", cadence: "every_7_days", startsOn: "2027-03-02", startTime: "10:00", arrivalWindowMinutes: 30, quoteInput: { bedrooms: 2, bathrooms: 1 }, scopeNote: "Use the side door.", start });
  return { serviceId, ...where, planId: created.planId, created };
}

const planOf = async (as: As, companyId: Id<"companies">, customerId: Id<"customers">) => (await as.query(api.servicePlans.forClient, { companyId, customerId })).plans[0];
const booked = async (t: Awaited<ReturnType<typeof setup>>["t"], planId: Id<"servicePlans">) =>
  (await t.run(async (ctx) => ctx.db.query("jobs").collect())).filter((j) => j.planId === planId).sort((a, b) => a.startsAt - b.startsAt);

describe("Service plans", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("books a weekly plan four weeks ahead at its agreed price, the first visit priced as a first visit", async () => {
    const { t, as, companyId } = await setup();
    // Price preview, from the engine: 2 bed 1 bath = $140, 10% off weekly = $126; the first clean is 25% more.
    const serviceId = await publish(as, companyId, homeSpec());
    const where = await client(as, companyId);
    const preview = await as.query(api.servicePlans.preview, { companyId, propertyId: where.propertyId, serviceId, kind: "recurring", cadence: "every_7_days", startsOn: "2027-03-02", quoteInput: { bedrooms: 2, bathrooms: 1 } });
    expect(preview.perVisitCents).toBe(12600);
    expect(preview.firstVisit?.priceCents).toBeGreaterThan(12600);
    expect(preview.firstDays.slice(0, 3)).toEqual(["2027-03-02", "2027-03-09", "2027-03-16"]);
    const { planId, booked: count } = await as.mutation(api.servicePlans.create, { companyId, ...where, serviceId, kind: "recurring", cadence: "every_7_days", startsOn: "2027-03-02", startTime: "10:00", arrivalWindowMinutes: 30, quoteInput: { bedrooms: 2, bathrooms: 1 }, start: true });
    expect(count).toBe(4);
    const jobs = await booked(t, planId);
    expect(jobs.map((j) => j.planDate)).toEqual(["2027-03-02", "2027-03-09", "2027-03-16", "2027-03-23"]);
    expect(jobs[0].priceCents).toBe(preview.firstVisit!.priceCents);
    expect(jobs.slice(1).every((j) => j.priceCents === 12600)).toBe(true);
    expect(jobs[0].serviceSnapshot).toMatchObject({ priceSource: "plan" });
    expect(jobs[0].arrivalWindowMinutes).toBe(30);
    // Dispatch is staffing each one, as for any visit.
    const covers = (await t.run(async (ctx) => ctx.db.query("tasks").collect())).filter((task) => task.key?.startsWith("dispatch.cover:"));
    expect(covers.length).toBe(4);
    // The client is now recurring in the directory, and the profile shows the plan.
    const directory = await as.query(api.clients.directory, { companyId, view: "residential_recurring", paginationOpts: { numItems: 10, cursor: null } });
    expect(directory.page.map((r) => r.name)).toEqual(["Dana Whitfield"]);
    const plan = await planOf(as, companyId, where.customerId);
    expect(plan).toMatchObject({ state: "active", cadence: "every_7_days", priceCents: 12600, booked: 4, next: { outcome: "Booked" } });
    // Running the daily booking again books nothing twice.
    expect(await t.mutation(internal.servicePlans.bookAll, {})).toEqual({ booked: 0 });
    vi.setSystemTime(NOW + 7 * DAY);
    expect(await t.mutation(internal.servicePlans.bookAll, {})).toEqual({ booked: 1 });
  });

  it("books nothing until a plan being set up is started", async () => {
    const { t, as, companyId } = await setup();
    const { planId, customerId } = await weekly(as, companyId, false);
    expect(await booked(t, planId)).toEqual([]);
    expect((await as.query(api.clients.summary, { companyId, customerId })).attention.map((a) => a.title)).toContain("A plan is still being set up");
    const plan = await planOf(as, companyId, customerId);
    expect(await as.mutation(api.servicePlans.start, { companyId, planId, expectedRevision: plan.revision })).toMatchObject({ booked: 4 });
  });

  it("skips one visit only, and never books that day again", async () => {
    const { t, as, companyId } = await setup();
    const { planId, customerId } = await weekly(as, companyId);
    const second = (await booked(t, planId))[1];
    const plan = await planOf(as, companyId, customerId);
    await as.mutation(api.servicePlans.skipVisit, { companyId, planId, expectedRevision: plan.revision, jobId: second._id, reason: "Client travelling" });
    const after = await booked(t, planId);
    expect(after.find((j) => j._id === second._id)).toMatchObject({ status: "cancelled", skipped: true });
    expect(after.filter((j) => j.status === "scheduled").map((j) => j.planDate)).toEqual(["2027-03-02", "2027-03-16", "2027-03-23"]);
    await t.mutation(internal.servicePlans.bookAll, {});
    expect((await booked(t, planId)).filter((j) => j.planDate === "2027-03-09")).toHaveLength(1);
    const history = await as.query(api.clientProperties.visits, { companyId, customerId, when: "history" });
    expect(history.visits.find((v) => v.id === second._id)?.outcome).toBe("Skipped");
  });

  it("pauses only after the person saw exactly which visits it cancels, and resumes on its own", async () => {
    const { t, as, companyId } = await setup();
    const { planId, customerId } = await weekly(as, companyId);
    let plan = await planOf(as, companyId, customerId);
    const shown = await as.query(api.servicePlans.affected, { companyId, planId, from: "2027-03-09", until: "2027-03-23" });
    expect(shown.visits.map((v) => new Date(v.startsAt).toISOString().slice(0, 10))).toEqual(["2027-03-09", "2027-03-16"]);
    // A list that is not what is booked now is refused, and nothing changes.
    expect(await refusal(as.mutation(api.servicePlans.pause, { companyId, planId, expectedRevision: plan.revision, from: "2027-03-09", until: "2027-03-23", shown: [shown.visits[0].id] }))).toContain("changed after you looked");
    expect((await booked(t, planId)).filter((j) => j.status === "cancelled")).toEqual([]);
    await as.mutation(api.servicePlans.pause, { companyId, planId, expectedRevision: plan.revision, from: "2027-03-09", until: "2027-03-23", shown: shown.visits.map((v) => v.id) });
    expect((await booked(t, planId)).filter((j) => j.status === "scheduled").map((j) => j.planDate)).toEqual(["2027-03-02", "2027-03-23"]);
    // Two weeks on, the pause is over and the plan books ahead again; the paused days stay unbooked.
    vi.setSystemTime(NOW + 14 * DAY);
    await t.mutation(internal.servicePlans.bookAll, {});
    const days = (await booked(t, planId)).filter((j) => j.status === "scheduled").map((j) => j.planDate);
    expect(days).toEqual(["2027-03-02", "2027-03-23", "2027-03-30", "2027-04-06"]);
    // Once the pause is over, the plan is running again with no pause left on it.
    vi.setSystemTime(NOW + 23 * DAY);
    await t.mutation(internal.servicePlans.bookAll, {});
    plan = await planOf(as, companyId, customerId);
    expect(plan.pausedFrom).toBeNull();
  });

  it("pauses until resumed, then books from today", async () => {
    const { t, as, companyId } = await setup();
    const { planId, customerId } = await weekly(as, companyId);
    let plan = await planOf(as, companyId, customerId);
    const shown = await as.query(api.servicePlans.affected, { companyId, planId, from: "2027-03-09" });
    await as.mutation(api.servicePlans.pause, { companyId, planId, expectedRevision: plan.revision, from: "2027-03-09", shown: shown.visits.map((v) => v.id) });
    plan = await planOf(as, companyId, customerId);
    expect(plan.state).toBe("paused");
    vi.setSystemTime(NOW + 21 * DAY);
    expect(await t.mutation(internal.servicePlans.bookAll, {})).toEqual({ booked: 0 });
    await as.mutation(api.servicePlans.resume, { companyId, planId, expectedRevision: plan.revision });
    const days = (await booked(t, planId)).filter((j) => j.status === "scheduled").map((j) => j.planDate);
    // Booking starts again from today. March 23 was cancelled by the pause on purpose, so it stays unbooked.
    expect(days).toEqual(["2027-03-02", "2027-03-30", "2027-04-06", "2027-04-13"]);
  });

  it("changes this and future visits from a day, and ends a plan without touching history", async () => {
    const { t, as, companyId } = await setup();
    const { planId, customerId } = await weekly(as, companyId);
    let plan = await planOf(as, companyId, customerId);
    const shown = await as.query(api.servicePlans.affected, { companyId, planId, from: "2027-03-16" });
    const result = await as.mutation(api.servicePlans.changeSeries, { companyId, planId, expectedRevision: plan.revision, from: "2027-03-16", shown: shown.visits.map((v) => v.id), startTime: "14:00", cadence: "every_14_days" });
    expect(result.cancelled).toBe(2);
    const live = (await booked(t, planId)).filter((j) => j.status === "scheduled");
    expect(live.map((j) => j.planDate)).toEqual(["2027-03-02", "2027-03-09", "2027-03-16"]);
    // 2 PM on the company's clock (America/Chicago, UTC-5 in mid March).
    expect(new Date(live[2].startsAt).toISOString()).toBe("2027-03-16T19:00:00.000Z");
    plan = await planOf(as, companyId, customerId);
    const ending = await as.query(api.servicePlans.affected, { companyId, planId, from: "2027-03-09" });
    await as.mutation(api.servicePlans.end, { companyId, planId, expectedRevision: plan.revision, from: "2027-03-09", shown: ending.visits.map((v) => v.id), reason: "Moving away" });
    plan = await planOf(as, companyId, customerId);
    expect(plan.state).toBe("ended");
    expect((await booked(t, planId)).filter((j) => j.status === "scheduled").map((j) => j.planDate)).toEqual(["2027-03-02"]);
    expect(await t.mutation(internal.servicePlans.bookAll, {})).toEqual({ booked: 0 });
  });

  it("keeps an STR standing arrangement as terms only: turnovers are booked one by one", async () => {
    const { t, as, companyId } = await setup();
    const serviceId = await publish(as, companyId, turnoverSpec());
    const where = await client(as, companyId, "Lakeview Rentals", "short_term_rental");
    const { planId, booked: count } = await as.mutation(api.servicePlans.create, { companyId, ...where, serviceId, kind: "standing", cadence: null, startsOn: "2027-03-02", startTime: "11:00", arrivalWindowMinutes: 0, quoteInput: { beds: 4 }, start: true });
    const preview = await as.query(api.servicePlans.preview, { companyId, propertyId: where.propertyId, serviceId, kind: "standing", cadence: null, startsOn: "2027-03-02", quoteInput: { beds: 4 } });
    expect(preview.firstDays).toEqual([]);
    expect(count).toBe(0);
    expect(await booked(t, planId)).toEqual([]);
    expect(await planOf(as, companyId, where.customerId)).toMatchObject({ kind: "standing", state: "active", priceCents: preview.perVisitCents, cadence: null });
    expect(await t.mutation(internal.servicePlans.bookAll, {})).toEqual({ booked: 0 });
  });

  it("is set up and changed by Owners and Managers only, and refuses what cannot be priced", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-a", "office");
    const serviceId = await publish(as, companyId, homeSpec());
    const where = await client(as, companyId);
    const args = { companyId, ...where, serviceId, kind: "recurring" as const, cadence: "every_7_days" as const, startsOn: "2027-03-02", startTime: "10:00", arrivalWindowMinutes: 30, quoteInput: { bedrooms: 2, bathrooms: 1 }, start: true };
    expect(await refusal(office.mutation(api.servicePlans.create, args))).toBe("Not allowed.");
    expect(await refusal(as.mutation(api.servicePlans.create, { ...args, quoteInput: { bedrooms: 2 } }))).toContain("The price needs: Bathrooms");
    expect(await refusal(as.mutation(api.servicePlans.create, { ...args, startsOn: "2027-02-01" }))).toContain("cannot be in the past");
    // Office still reads plans.
    await as.mutation(api.servicePlans.create, args);
    expect((await office.query(api.servicePlans.forClient, { companyId, customerId: where.customerId })).canChange).toBe(false);
  });
});

describe("Properties", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps details by kind, and access instructions to Owners and Managers", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-a", "office");
    const { customerId, propertyId } = await client(as, companyId, "Lakeview Rentals", "short_term_rental");
    let detail = await as.query(api.clientProperties.detail, { companyId, propertyId });
    await as.mutation(api.clientProperties.save, { companyId, customerId, propertyId, expectedRevision: detail.property.revision, kind: "short_term_rental", label: "Lake house", details: { beds: 4, laundry: "on_site", checkoutTime: "10:00", checkinTime: "16:00" }, parking: "Driveway", crewNotes: "Linens in the hall closet", accessInstructions: "Lockbox 4417", officeNotes: "Owner is particular about towels" });
    detail = await office.query(api.clientProperties.detail, { companyId, propertyId });
    expect(detail.property).toMatchObject({ name: "Lake house", details: { beds: 4, laundry: "on_site", checkoutTime: "10:00" }, parking: "Driveway", crewNotes: "Linens in the hall closet", accessInstructions: null, officeNotes: null, hasAccessInstructions: true });
    expect(await refusal(office.mutation(api.clientProperties.save, { companyId, customerId, propertyId, expectedRevision: detail.property.revision, kind: "short_term_rental", details: {}, accessInstructions: "new" }))).toContain("Only an Owner or Manager");
    expect(await refusal(as.mutation(api.clientProperties.save, { companyId, customerId, propertyId, expectedRevision: 0, kind: "short_term_rental", details: {} }))).toContain("Someone else saved this property");
    expect(await refusal(as.mutation(api.clientProperties.save, { companyId, customerId, propertyId, expectedRevision: detail.property.revision, kind: "short_term_rental", details: { checkoutTime: "25:00" } }))).toContain("time of day");
    // Search never finds the access code.
    expect((await as.query(api.clients.directory, { companyId, view: "all", q: "4417", paginationOpts: { numItems: 5, cursor: null } })).page).toEqual([]);
  });

  it("shows what an address change affects first, rechecks booked visits, and holds the service area", async () => {
    const { t, as, companyId } = await setup();
    const office = await addMember(t, as, companyId, "office-a", "office");
    await t.run(async (ctx) => {
      const company = (await ctx.db.get(companyId))!;
      await ctx.db.patch(companyId, { businessSettings: { ...(company.businessSettings ?? {}), serviceAreas: ["78701", "78702"] } });
    });
    const { planId, propertyId } = await weekly(as, companyId);
    void planId;
    let detail = await as.query(api.clientProperties.detail, { companyId, propertyId });
    const impact = await as.query(api.clientProperties.addressImpact, { companyId, propertyId, postalCode: "78702" });
    expect(impact).toMatchObject({ inArea: true, plans: 1 });
    expect(impact.upcoming).toHaveLength(4);
    await as.mutation(api.clientProperties.changeAddress, { companyId, propertyId, expectedRevision: detail.property.revision, address: address("40 Oak Ave", "78702"), shown: impact.upcoming.map((v) => v.id) });
    const tasks = (await t.run(async (ctx) => ctx.db.query("tasks").collect())).filter((task) => task.key === `property.moved:${propertyId}`);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("Recheck 4 visits after an address change");
    detail = await as.query(api.clientProperties.detail, { companyId, propertyId });
    const far = await office.query(api.clientProperties.addressImpact, { companyId, propertyId, postalCode: "90210" });
    expect(far.inArea).toBe(false);
    expect(await refusal(office.mutation(api.clientProperties.changeAddress, { companyId, propertyId, expectedRevision: detail.property.revision, address: address("1 Far Rd", "90210"), shown: far.upcoming.map((v) => v.id), outsideArea: true }))).toContain("outside the company's service area");
    await as.mutation(api.clientProperties.changeAddress, { companyId, propertyId, expectedRevision: detail.property.revision, address: address("1 Far Rd", "90210"), shown: far.upcoming.map((v) => v.id), outsideArea: true });
  });

  it("will not archive a property with a running plan", async () => {
    const { as, companyId } = await setup();
    const { propertyId } = await weekly(as, companyId);
    const detail = await as.query(api.clientProperties.detail, { companyId, propertyId });
    expect(await refusal(as.mutation(api.clientProperties.archive, { companyId, propertyId, expectedRevision: detail.property.revision }))).toContain("Not archived");
  });
});
