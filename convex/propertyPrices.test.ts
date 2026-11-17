import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, JOB_END, JOB_START, NOW, refusal, start } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { blankSpec, type Spec } from "./lib/services/spec";

const notice = { required: false, note: "" };
const DAY = 24 * 60 * 60 * 1000;

/** A home service priced by bedrooms and bathrooms, with an extra and a minimum. */
function readySpec(patch: Partial<Spec> = {}): Spec {
  const base = blankSpec("residential");
  return {
    ...base,
    name: "Standard clean",
    summary: "A full clean of the living areas, kitchen and bathrooms.",
    included: [{ id: "counters", label: "Wipe kitchen counters", section: "Kitchen", requiresPhoto: false }],
    pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1000, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 },
    addOns: [{ id: "oven", label: "Inside the oven", priceCents: 3500, per: "item", itemWord: "oven", laborMinutes: 30, maxQuantity: 1 }],
    ...patch,
  };
}

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  return { t, ...owner };
}

type As = Awaited<ReturnType<typeof setup>>["as"];

async function publishNew(as: As, companyId: Id<"companies">, spec: Spec) {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch it.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  const key = (await as.query(api.services.service, { companyId, serviceId })).service.key;
  return { serviceId, key };
}

async function place(as: As, companyId: Id<"companies">, line1 = "12 Elm St") {
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home" });
  const propertyId = await as.mutation(api.properties.create, { companyId, customerId, kind: "home", address: { line1, city: "Austin", region: "TX", postalCode: "78701" } });
  return { customerId, propertyId };
}

async function approve(as: As, companyId: Id<"companies">, changeId: Id<"serviceChanges">) {
  const change = await as.query(api.services.change, { companyId, changeId });
  return as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
}

describe("A property's own price", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prices a visit only once the Owner approves it, and replaces only the base", async () => {
    const { t, as, companyId } = await setup();
    const { serviceId, key } = await publishNew(as, companyId, readySpec());
    const home = await place(as, companyId);
    const other = await place(as, companyId, "40 Oak Ave");
    const manager = await addMember(t, as, companyId, "manager-a", "manager");

    const { changeId } = await manager.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough on Feb 26: large open-plan home." });
    const review = await as.query(api.services.change, { companyId, changeId });
    expect(review.kind).toBe("property_price");
    expect(review.title).toBe("Own price for 12 Elm St, Austin");
    expect(review.propertyPrice).toMatchObject({ baseCents: 18500, customer: { name: "Dana Whitfield" }, current: null, moved: null });
    expect(review.impact.join(" ")).toContain("Extras, rush, discounts, the minimum charge and rounding still come from the service.");

    // Not yet approved: the visit pays the service's price ($120 + 2 more bedrooms + 1 more bathroom = $185 is a coincidence avoided here: 2 bed 1 bath).
    const before = await as.mutation(api.jobs.create, { companyId, ...home, serviceId: key, quoteInput: { bedrooms: 2, bathrooms: 1 }, startsAt: JOB_START, endsAt: JOB_END });
    expect((await as.query(api.jobs.get, { companyId, jobId: before })).job.priceCents).toBe(14000);

    // A Manager cannot approve it; the Owner does.
    expect(await refusal(manager.mutation(api.services.approve, { companyId, changeId, hash: review.hash, publish: true }))).toBe("Not allowed.");
    expect(await approve(as, companyId, changeId)).toEqual({ state: "published" });

    // Now the property's base is its own; the extra still comes from the service.
    const own = await as.mutation(api.jobs.create, { companyId, ...home, serviceId: key, quoteInput: { bedrooms: 2, bathrooms: 1, addOns: [{ id: "oven", quantity: 1 }] }, expectedTotalCents: 22000, startsAt: JOB_START + DAY, endsAt: JOB_END + DAY });
    const job = (await as.query(api.jobs.get, { companyId, jobId: own })).job;
    expect(job.priceCents).toBe(22000);
    const saved = await t.run(async (ctx) => ctx.db.get(job.serviceSnapshot!.quoteId!));
    expect(saved!.lines.find((l) => l.key === "base")).toMatchObject({ label: "Base price for this property", amountCents: 18500 });
    expect(JSON.parse(saved!.input).propertyPrice.baseCents).toBe(18500);
    // The visit booked before approval keeps its price; another property pays the service's price.
    expect((await as.query(api.jobs.get, { companyId, jobId: before })).job.priceCents).toBe(14000);
    const elsewhere = await as.mutation(api.jobs.create, { companyId, ...other, serviceId: key, quoteInput: { bedrooms: 2, bathrooms: 1 }, startsAt: JOB_START + DAY, endsAt: JOB_END + DAY });
    expect((await as.query(api.jobs.get, { companyId, jobId: elsewhere })).job.priceCents).toBe(14000);

    // The visit form reads the same price the server uses.
    const forVisit = await as.query(api.propertyPrices.forVisit, { companyId, serviceKey: key, propertyId: home.propertyId, day: "2027-03-03" });
    expect(forVisit?.price?.baseCents).toBe(18500);
  });

  it("keeps who may propose and end it", async () => {
    const { t, as, companyId } = await setup();
    const { serviceId } = await publishNew(as, companyId, readySpec());
    const home = await place(as, companyId);
    const office = await addMember(t, as, companyId, "office-a", "office");
    const manager = await addMember(t, as, companyId, "manager-a", "manager");
    expect(await refusal(office.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough." }))).toBe("Not allowed.");
    expect(await refusal(manager.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: " " }))).toContain("Say why");
    expect(await refusal(manager.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18.5, laborMinutes: null, until: null, reason: "Walkthrough." }))).toContain("whole cents");
    expect(await refusal(manager.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: { kind: "end", date: "2027-03-01" }, reason: "Walkthrough." }))).toContain("after today");
    const { changeId } = await manager.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough." });
    await approve(as, companyId, changeId);
    const [row] = (await office.query(api.propertyPrices.forService, { companyId, serviceId })).active;
    expect(row).toMatchObject({ property: "12 Elm St, Austin", baseCents: 18500, approvedBy: "owner-a" });
    expect(await refusal(manager.mutation(api.propertyPrices.end, { companyId, priceId: row.id, reason: "No longer agreed." }))).toBe("Not allowed.");
    await as.mutation(api.propertyPrices.end, { companyId, priceId: row.id, reason: "No longer agreed." });
    const after = await as.query(api.propertyPrices.forService, { companyId, serviceId });
    expect(after.active).toEqual([]);
    expect(after.past[0]).toMatchObject({ state: "ended", endedReason: "No longer agreed." });
  });

  it("keeps its price when the catalog changes, and the catalog review lists it", async () => {
    const { as, companyId } = await setup();
    const { serviceId, key } = await publishNew(as, companyId, readySpec());
    const home = await place(as, companyId);
    const proposal = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough." });
    await approve(as, companyId, proposal.changeId);

    // A catalog change, submitted and reviewed while the property has its own price.
    const { revision } = await as.mutation(api.services.editLive, { companyId, serviceId });
    const saved = await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: revision, spec: readySpec({ pricing: { ...(readySpec().pricing as Extract<Spec["pricing"], { method: "bed_bath" }>), baseCents: 14000 } }), step: "review" });
    if (!saved.ok) throw new Error("conflict");
    const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: saved.revision, reason: "Costs went up.", customerNotice: notice, contractReview: notice });
    const review = await as.query(api.services.change, { companyId, changeId });
    expect(review.impact.join(" ")).toContain("1 property has its own price for this service and keeps it.");
    expect(review.ownPrices).toEqual([expect.objectContaining({ property: "12 Elm St, Austin", customer: "Dana Whitfield", baseCents: 18500 })]);
    await approve(as, companyId, changeId);

    const jobId = await as.mutation(api.jobs.create, { companyId, ...home, serviceId: key, quoteInput: { bedrooms: 2, bathrooms: 1 }, startsAt: JOB_START, endsAt: JOB_END });
    expect((await as.query(api.jobs.get, { companyId, jobId })).job).toMatchObject({ priceCents: 18500, serviceSnapshot: { version: 2 } });
    const [row] = (await as.query(api.propertyPrices.forService, { companyId, serviceId })).active;
    expect(row.catalogMoved).toBe(true);
  });

  it("replaces an older proposal, and refuses to approve over a price that changed since", async () => {
    const { as, companyId } = await setup();
    const { serviceId } = await publishNew(as, companyId, readySpec());
    const home = await place(as, companyId);
    const other = await place(as, companyId, "40 Oak Ave");
    const first = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18000, laborMinutes: null, until: null, reason: "First look." });
    const elsewhere = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: other.propertyId, baseCents: 15000, laborMinutes: null, until: null, reason: "Small flat." });
    const second = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "After the walkthrough." });
    expect((await as.query(api.services.change, { companyId, changeId: first.changeId })).state).toBe("superseded");
    expect((await as.query(api.services.change, { companyId, changeId: elsewhere.changeId })).state).toBe("in_review");

    // Two open proposals for the same property can only come from a race; approving one makes the other stale.
    const third = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: other.propertyId, baseCents: 15500, laborMinutes: null, until: null, reason: "Recount." });
    expect((await as.query(api.services.change, { companyId, changeId: elsewhere.changeId })).state).toBe("superseded");
    await approve(as, companyId, second.changeId);
    await approve(as, companyId, third.changeId);
    const replacing = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 19000, laborMinutes: null, until: null, reason: "Extension built." });
    const stale = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: other.propertyId, baseCents: 16000, laborMinutes: null, until: null, reason: "Recount again." });
    // Approving one property's price leaves the other property's proposal open.
    await approve(as, companyId, replacing.changeId);
    expect((await as.query(api.services.change, { companyId, changeId: stale.changeId })).state).toBe("in_review");
    const prices = await as.query(api.propertyPrices.forService, { companyId, serviceId });
    expect(prices.active.map((r) => [r.property, r.baseCents])).toEqual([
      ["12 Elm St, Austin", 19000],
      ["40 Oak Ave, Austin", 15500],
    ]);
    // Only the home's first approved price was replaced; the flat's proposals never went live until the last one.
    expect(prices.past.map((r) => [r.property, r.state, r.baseCents])).toEqual([["12 Elm St, Austin", "replaced", 18500]]);

    // Someone else's approved price lands between proposing and approving: the review says so and approval is refused.
    const late = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 20000, laborMinutes: null, until: null, reason: "Late." });
    const [active] = (await as.query(api.propertyPrices.forService, { companyId, serviceId })).active;
    await as.mutation(api.propertyPrices.end, { companyId, priceId: active.id, reason: "Ended meanwhile." });
    const review = await as.query(api.services.change, { companyId, changeId: late.changeId });
    expect(review.propertyPrice?.moved).toContain("changed after this was proposed");
    expect(await refusal(as.mutation(api.services.approve, { companyId, changeId: late.changeId, hash: review.hash, publish: true }))).toContain("changed after this was proposed");
  });

  it("is left alone by an archive request", async () => {
    const { as, companyId } = await setup();
    const { serviceId } = await publishNew(as, companyId, readySpec());
    const home = await place(as, companyId);
    const proposal = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough." });
    await as.mutation(api.services.requestArchive, { companyId, serviceId, reason: "Maybe stop offering it." });
    expect((await as.query(api.services.change, { companyId, changeId: proposal.changeId })).state).toBe("in_review");
  });

  it("stops after its end date, reminds the Owner two weeks before, once, and never extends itself", async () => {
    const { t, as, companyId } = await setup();
    const { serviceId, key } = await publishNew(as, companyId, readySpec());
    const home = await place(as, companyId);
    // Ends after March 20, 2027. Today is March 1.
    const proposal = await as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: 200, until: { kind: "end", date: "2027-03-20" }, reason: "Spring offer agreed with the customer." });
    expect((await as.query(api.services.change, { companyId, changeId: proposal.changeId })).impact.join(" ")).toContain("After March 20, 2027, the property pays the service's price again.");
    await approve(as, companyId, proposal.changeId);

    // A visit on the last day uses it, with the property's own time; a visit the day after pays the service's price.
    const lastDay = Date.UTC(2027, 2, 20, 16, 0);
    const onIt = await as.mutation(api.jobs.create, { companyId, ...home, serviceId: key, quoteInput: { bedrooms: 2, bathrooms: 1 }, startsAt: lastDay, endsAt: lastDay + 4 * 3_600_000 });
    expect((await as.query(api.jobs.get, { companyId, jobId: onIt })).job).toMatchObject({ priceCents: 18500, serviceSnapshot: { durationMinutes: 200 } });
    const after = await as.mutation(api.jobs.create, { companyId, ...home, serviceId: key, quoteInput: { bedrooms: 2, bathrooms: 1 }, startsAt: lastDay + DAY, endsAt: lastDay + DAY + 2 * 3_600_000 });
    expect((await as.query(api.jobs.get, { companyId, jobId: after })).job.priceCents).toBe(14000);
    expect(await as.query(api.propertyPrices.forVisit, { companyId, serviceKey: key, propertyId: home.propertyId, day: "2027-03-21" })).toEqual({ price: null, endsBefore: "March 20, 2027" });

    // Nineteen days out: no reminder yet. Fourteen days out: one task, about the property, and only one.
    expect(await t.mutation(internal.propertyPrices.sweep, {})).toEqual({ reminded: 0, ended: 0 });
    vi.setSystemTime(Date.UTC(2027, 2, 6, 18, 0));
    expect(await t.mutation(internal.propertyPrices.sweep, {})).toEqual({ reminded: 1, ended: 0 });
    expect(await t.mutation(internal.propertyPrices.sweep, {})).toEqual({ reminded: 0, ended: 0 });
    const tasks = await as.query(api.tasks.list, { companyId, status: "open" });
    const task = tasks.find((row) => row.key?.startsWith("property-price:"));
    expect(task).toMatchObject({ title: "Own price ends for 12 Elm St, Austin (Standard clean)", about: { table: "properties", id: home.propertyId } });
    expect(task!.nextAction).toContain("Selestial will not extend it for you.");

    // After the end date it is marked ended. Nothing new is proposed or approved by the sweep.
    vi.setSystemTime(Date.UTC(2027, 2, 21, 18, 0));
    expect(await t.mutation(internal.propertyPrices.sweep, {})).toEqual({ reminded: 0, ended: 1 });
    const prices = await as.query(api.propertyPrices.forService, { companyId, serviceId });
    expect(prices.active).toEqual([]);
    expect(prices.past[0]).toMatchObject({ state: "ended", endedReason: "Its end date, March 20, 2027, passed." });
    expect(prices.waiting).toEqual([]);
  });

  it("asks for a live service and a property of the same company", async () => {
    const { t, as, companyId } = await setup();
    const { serviceId: draftId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
    const home = await place(as, companyId);
    expect(await refusal(as.mutation(api.propertyPrices.propose, { companyId, serviceId: draftId, propertyId: home.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough." }))).toContain("Only a live service");
    const { serviceId } = await publishNew(as, companyId, readySpec({ name: "Deep clean" }));
    const rival = await company(t, "owner-b", "Beta Cleaning");
    const theirs = await place(rival.as, rival.companyId);
    expect(await refusal(as.mutation(api.propertyPrices.propose, { companyId, serviceId, propertyId: theirs.propertyId, baseCents: 18500, laborMinutes: null, until: null, reason: "Walkthrough." }))).toBe("Not found.");
  });
});
