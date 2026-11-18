import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, readyCleaner, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { localInstant } from "./lib/sales/cadence";
import { homeSpec, publish } from "../tests/salesHarness";

type As = Awaited<ReturnType<typeof company>>["as"];
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

/** A draft for an existing customer's home, ready to book on the seeded Tuesday at 9:00. */
async function readyDraft(as: As, companyId: Id<"companies">, key: string, body: Record<string, unknown> = {}, kind: "one_time" | "recurring" = "one_time") {
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home", email: "dana@example.com" });
  const propertyId = await as.mutation(api.properties.create, { companyId, customerId, kind: "home", address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" } });
  const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "booking", customerId, propertyId, bookingKind: kind });
  const { revision } = await as.mutation(api.sales.saveDraft, {
    companyId,
    draftId,
    revision: 0,
    body: { service: { key, input: { bedrooms: 3, bathrooms: 2 } }, schedule: { date: "2027-03-02", arrivalMinute: 9 * 60, windowMinutes: 60 }, payment: { policy: "deposit", depositCents: 5000 }, ...body },
  });
  return { customerId, propertyId, draftId, revision };
}

describe("bookings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  async function setup(cleaners = 2) {
    const t = start();
    const owner = await company(t, "owner-a", "Alpha Cleaning");
    const key = await publish(owner.as, owner.companyId, homeSpec());
    for (let i = 0; i < cleaners; i += 1) await readyCleaner(owner.as, owner.companyId, `Cleaner ${i + 1}`);
    return { t, ...owner, key };
  }

  it("takes an existing customer from quote to deposit to a confirmed visit handed to Dispatch", async () => {
    const { t, as, companyId, key } = await setup();
    const { draftId, revision } = await readyDraft(as, companyId, key);
    await as.mutation(api.sales.saveQuoteFromDraft, { companyId, draftId, revision });
    const { bookingId } = await as.mutation(api.bookings.request, { companyId, draftId, revision, sendLinks: false });
    // Asking again for the same revision is the same booking.
    expect((await as.mutation(api.bookings.request, { companyId, draftId, revision, sendLinks: false })).bookingId).toBe(bookingId);
    let view = await as.query(api.bookings.get, { companyId, bookingId });
    expect(view.booking.status).toBe("awaiting");
    expect(view.booking.requirements.payment.state).toBe("awaiting");
    expect(view.blockers.join(" ")).toMatch(/deposit of \$50\.00/);
    // Choosing a payment method is not payment, and a person cannot confirm before the deposit is in.
    expect(await refusal(as.mutation(api.bookings.confirmNow, { companyId, bookingId }))).toMatch(/deposit/);
    const invoiceId = view.booking.invoiceId!;
    await as.mutation(api.finance.recordPayment, { companyId, invoiceId, amountCents: 5000, method: "cash", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: "deposit-0001" });
    await settle(t);
    view = await as.query(api.bookings.get, { companyId, bookingId });
    expect(view.booking.status).toBe("confirmed");
    expect(view.booking.handoff.state).toBe("done");
    const job = await t.run((ctx) => ctx.db.get(view.booking.jobId!));
    expect(job?.priceCents).toBe(18500);
    expect(job?.serviceSnapshot?.priceSource).toBe("quote");
    // Dispatch looked at the visit in the same step it was made.
    const task = await t.run((ctx) => ctx.db.query("tasks").withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", `dispatch.cover:${job!._id}`)).first());
    expect(task).not.toBeNull();
    const invoice = await t.run((ctx) => ctx.db.get(invoiceId));
    expect(invoice?.jobId).toBe(job?._id);
    expect(invoice?.status).toBe("open");
  });

  it("holds the last crew for one booking and refuses a second booking at the same time", async () => {
    const { as, companyId, key } = await setup(1);
    const a = await readyDraft(as, companyId, key);
    await as.mutation(api.bookings.request, { companyId, draftId: a.draftId, revision: a.revision, sendLinks: false });
    const b = await readyDraft(as, companyId, key);
    expect(await refusal(as.mutation(api.bookings.request, { companyId, draftId: b.draftId, revision: b.revision, sendLinks: false }))).toMatch(/No cleaners are free/);
    // A proposed time holds nothing and is not refused.
    const c = await readyDraft(as, companyId, key, { schedule: { date: "2027-03-02", arrivalMinute: 9 * 60, proposed: true } });
    const { bookingId } = await as.mutation(api.bookings.request, { companyId, draftId: c.draftId, revision: c.revision, sendLinks: false });
    const view = await as.query(api.bookings.get, { companyId, bookingId });
    expect(view.booking.requirements.schedule.state).toBe("proposed");
    expect(view.blockers.join(" ")).toMatch(/only proposed/);
  });

  it("keeps a late payment on the invoice and tells staff when the time was taken meanwhile", async () => {
    const { t, as, companyId, key } = await setup(1);
    const a = await readyDraft(as, companyId, key);
    const { bookingId } = await as.mutation(api.bookings.request, { companyId, draftId: a.draftId, revision: a.revision, sendLinks: false });
    // The hold lapses and someone else books the time.
    await t.run(async (ctx) => {
      const holds = await ctx.db.query("capacityHolds").withIndex("by_company_booking", (q) => q.eq("companyId", companyId).eq("bookingId", bookingId)).take(5);
      for (const hold of holds) await ctx.db.patch(hold._id, { expiresAt: NOW - 1 });
    });
    const b = await readyDraft(as, companyId, key, { payment: { policy: "after_service" } });
    const other = await as.mutation(api.bookings.request, { companyId, draftId: b.draftId, revision: b.revision, sendLinks: false });
    await as.mutation(api.bookings.confirmNow, { companyId, bookingId: other.bookingId });
    await settle(t);
    const view = await as.query(api.bookings.get, { companyId, bookingId });
    await as.mutation(api.finance.recordPayment, { companyId, invoiceId: view.booking.invoiceId!, amountCents: 5000, method: "check", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: "late-pay-0001" });
    await settle(t);
    const after = await as.query(api.bookings.get, { companyId, bookingId });
    expect(after.booking.status).toBe("awaiting");
    expect(after.booking.requirements.schedule.state).toBe("conflict");
    expect(after.booking.problem).toMatch(/no longer available/);
    expect(after.payment.paidCents).toBe(5000);
    expect(after.booking.jobId).toBeUndefined();
  });

  it("lets Office take a booking but sends the payment link only after an Owner or Manager approves", async () => {
    const { t, as, companyId, key } = await setup();
    const office = await addMember(t, as, companyId, "office-1", "office");
    const manager = await addMember(t, as, companyId, "manager-1", "manager");
    const { draftId } = await readyDraft(as, companyId, key);
    const draft = await office.query(api.sales.draft, { companyId, draftId });
    const { bookingId } = await office.mutation(api.bookings.request, { companyId, draftId, revision: draft.draft.revision, sendLinks: true });
    let booking = (await office.query(api.bookings.get, { companyId, bookingId })).booking;
    expect(booking.requirements.payment.state).toBe("approval_needed");
    expect(booking.invoiceId).toBeUndefined();
    await manager.mutation(api.approvals.decide, { companyId, approvalId: booking.requirements.payment.approvalId!, decision: "approved" });
    booking = (await office.query(api.bookings.get, { companyId, bookingId })).booking;
    expect(booking.requirements.payment.state).toBe("awaiting");
    expect(booking.invoiceId).toBeDefined();
    const invoice = await t.run((ctx) => ctx.db.get(booking.invoiceId!));
    expect(invoice?.depositCents).toBe(5000);
    expect(invoice?.createdBy).toBe(booking.createdBy);
  });

  it("needs the Owner for a changed price, and never treats telling them afterward as approval", async () => {
    const { t, as, companyId, key } = await setup();
    const manager = await addMember(t, as, companyId, "manager-1", "manager");
    const { draftId } = await readyDraft(as, companyId, key, { override: { priceCents: 15000, reason: "Returning customer" } });
    const draft = await manager.query(api.sales.draft, { companyId, draftId });
    const { bookingId } = await manager.mutation(api.bookings.request, { companyId, draftId, revision: draft.draft.revision, sendLinks: false });
    let booking = (await manager.query(api.bookings.get, { companyId, bookingId })).booking;
    expect(booking.override?.state).toBe("waiting");
    expect(booking.invoiceId).toBeUndefined();
    expect(await refusal(manager.mutation(api.approvals.decide, { companyId, approvalId: booking.override!.approvalId!, decision: "approved" }))).toMatch(/Only the Owner/);
    await as.mutation(api.approvals.decide, { companyId, approvalId: booking.override!.approvalId!, decision: "approved" });
    booking = (await manager.query(api.bookings.get, { companyId, bookingId })).booking;
    expect(booking.override?.state).toBe("approved");
    const invoice = await t.run((ctx) => ctx.db.get(booking.invoiceId!));
    expect(invoice?.totals.totalCents).toBe(15000);
  });

  it("waits for the customer's own signature on a required agreement", async () => {
    const { t, as, companyId, key } = await setup();
    const { draftId, revision } = await readyDraft(as, companyId, key, { payment: { policy: "after_service" }, agreement: { required: true, docType: "one_time_residential" } });
    const { bookingId } = await as.mutation(api.bookings.request, { companyId, draftId, revision, sendLinks: false });
    const view = await as.query(api.bookings.get, { companyId, bookingId });
    expect(view.booking.requirements.agreement.state).toBe("to_send");
    expect(view.agreement.id).not.toBeNull();
    expect(await refusal(as.mutation(api.bookings.confirmNow, { companyId, bookingId }))).toMatch(/hasn't signed/);
    // Signing is recorded by the agreement module; a staff note can't stand in for it.
    await t.run(async (ctx) => {
      await ctx.db.patch(view.agreement.id!, { workflow: "signed" });
    });
    await t.mutation(internal.bookings.agreementChanged, { agreementId: view.agreement.id! });
    await settle(t);
    expect((await as.query(api.bookings.get, { companyId, bookingId })).booking.status).toBe("confirmed");
  });

  it("keeps bookings to their own company", async () => {
    const { t, as, companyId, key } = await setup();
    const { draftId, revision } = await readyDraft(as, companyId, key, { payment: { policy: "after_service" } });
    const { bookingId } = await as.mutation(api.bookings.request, { companyId, draftId, revision, sendLinks: false });
    const other = await company(t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.bookings.get, { companyId: other.companyId, bookingId }))).toMatch(/not found/i);
    expect(await refusal(other.as.mutation(api.bookings.confirmNow, { companyId: other.companyId, bookingId }))).toMatch(/not found/i);
  });
});

describe("recurring plans", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  async function confirmedPlan(cadence: Record<string, unknown> = { kind: "every_2_weeks", weekday: 2 }) {
    const t = start();
    const owner = await company(t, "owner-a", "Alpha Cleaning");
    const key = await publish(owner.as, owner.companyId, homeSpec({ modifiers: { ...homeSpec().modifiers, recurring: { enabled: true, options: [{ schedule: "every_14_days", discount: { kind: "percent", value: 10 } }] } } }));
    const deepKey = await publish(owner.as, owner.companyId, homeSpec({ name: "Deep clean", pricing: { method: "bed_bath", baseCents: 20000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 3000, perBathroomCents: 3000, perHalfBathCents: 1000, baseLaborMinutes: 200, perBedroomMinutes: 40, perBathroomMinutes: 40, perHalfBathMinutes: 20 } }));
    await readyCleaner(owner.as, owner.companyId, "Ana");
    await readyCleaner(owner.as, owner.companyId, "Bo");
    const { draftId, revision } = await readyDraft(owner.as, owner.companyId, key, { payment: { policy: "after_service" }, firstVisit: { mode: "different", service: { key: deepKey, input: { bedrooms: 3, bathrooms: 2 } } }, recurring: { cadence, billing: "per_visit" } }, "recurring");
    const { bookingId } = await owner.as.mutation(api.bookings.request, { companyId: owner.companyId, draftId, revision, sendLinks: false });
    await owner.as.mutation(api.bookings.confirmNow, { companyId: owner.companyId, bookingId });
    await settle(t);
    const booking = (await owner.as.query(api.bookings.get, { companyId: owner.companyId, bookingId })).booking;
    return { t, ...owner, planId: booking.planId!, bookingId };
  }

  it("makes the deep first visit, then the ongoing visits at the recurring price, each date once", async () => {
    const { t, as, companyId, planId } = await confirmedPlan();
    let plan = await as.query(api.plans.get, { companyId, planId });
    const visits = plan.upcoming;
    expect(visits[0]!.first).toBe(true);
    expect(visits[0]!.job?.service).toBe("Deep clean");
    // Deep first: 200 + 2×30 + 1×30 = 290. Ongoing standard: 185 less 10% for every 2 weeks = 166.50.
    expect(visits[0]!.job?.priceCents).toBe(29000);
    expect(visits[1]!.job?.priceCents).toBe(16650);
    expect(visits.map((v) => v.date).slice(0, 3)).toEqual(["2027-03-02", "2027-03-16", "2027-03-30"]);
    // Staffing is Dispatch's: a planned visit is not claimed as covered.
    expect(visits[1]!.staffing).not.toBe("covered");
    // Running the sweep again makes nothing twice.
    const before = await t.run((ctx) => ctx.db.query("planVisits").withIndex("by_plan_date", (q) => q.eq("planId", planId)).collect());
    await t.mutation(internal.plans.generateOne, { planId });
    await t.mutation(internal.plans.generateOne, { planId });
    const after = await t.run((ctx) => ctx.db.query("planVisits").withIndex("by_plan_date", (q) => q.eq("planId", planId)).collect());
    expect(after.length).toBe(before.length);
    const jobs = await t.run((ctx) => ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", companyId)).collect());
    expect(jobs.length).toBe(before.length);
    plan = await as.query(api.plans.get, { companyId, planId });
    expect(plan.current?.cadenceWords).toMatch(/Every 2 weeks/);
  });

  it("skips one visit, pauses and resumes, without touching the rest", async () => {
    const { t, as, companyId, planId } = await confirmedPlan();
    let plan = await as.query(api.plans.get, { companyId, planId });
    const second = plan.upcoming[1]!;
    await as.mutation(api.plans.skipVisit, { companyId, visitId: second._id, reason: "Customer away" });
    const job = await t.run((ctx) => ctx.db.get(second.job!._id));
    expect(job?.status).toBe("cancelled");
    await as.mutation(api.plans.pause, { companyId, planId, from: "2027-03-20", until: "2027-04-05", reason: "Renovation" });
    plan = await as.query(api.plans.get, { companyId, planId });
    expect(plan.upcoming.find((v) => v.date === "2027-03-30")?.state).toBe("skipped");
    expect(plan.upcoming.find((v) => v.date === "2027-04-13")?.state).toBe("scheduled");
    expect(plan.upcoming.find((v) => v.date === "2027-03-02")?.state).toBe("scheduled");
  });

  it("changes the future price only with the Owner's approval and keeps earlier visits as they were", async () => {
    const { t, as, companyId, planId } = await confirmedPlan();
    const manager = await addMember(t, as, companyId, "manager-1", "manager");
    const preview = await manager.query(api.plans.changePreview, { companyId, planId, effectiveFrom: "2027-03-29", quoteInput: { bedrooms: 4, bathrooms: 2 } });
    expect(preview.priceChanges).toBe(true);
    expect(preview.needsApproval).toBe(true);
    const result = await manager.mutation(api.plans.changeFuture, { companyId, planId, effectiveFrom: "2027-03-29", quoteInput: { bedrooms: 4, bathrooms: 2 }, reason: "Added a bedroom" });
    expect(result.waitingForApproval).toBe(true);
    let plan = await as.query(api.plans.get, { companyId, planId });
    expect(plan.upcoming.find((v) => v.date === "2027-03-30")?.job?.priceCents).toBe(16650);
    const approval = await t.run((ctx) => ctx.db.query("approvals").withIndex("by_company_status_decideBy", (q) => q.eq("companyId", companyId).eq("status", "pending")).first());
    await as.mutation(api.approvals.decide, { companyId, approvalId: approval!._id, decision: "approved" });
    plan = await as.query(api.plans.get, { companyId, planId });
    // 205 less 10% = 184.50 from the 29th; the 16th keeps its price.
    expect(plan.upcoming.find((v) => v.date === "2027-03-30")?.job?.priceCents).toBe(18450);
    expect(plan.upcoming.find((v) => v.date === "2027-03-16")?.job?.priceCents).toBe(16650);
  });

  it("ends the plan and cancels only the visits after the last date", async () => {
    const { as, companyId, planId } = await confirmedPlan({ kind: "weekly", weekdays: [2] });
    const result = await as.mutation(api.plans.end, { companyId, planId, lastDate: "2027-03-16", reason: "Moving away" });
    expect(result.cancelled).toBeGreaterThan(0);
    const plan = await as.query(api.plans.get, { companyId, planId });
    expect(plan.upcoming.filter((v) => v.state === "scheduled").every((v) => v.date <= "2027-03-16")).toBe(true);
  });

  it("puts the time on the company's clock across the daylight-saving change", async () => {
    const { as, companyId, planId } = await confirmedPlan({ kind: "weekly", weekdays: [2] });
    const plan = await as.query(api.plans.get, { companyId, planId });
    const before = plan.upcoming.find((v) => v.date === "2027-03-09")!;
    const after = plan.upcoming.find((v) => v.date === "2027-03-16")!;
    expect(before.job!.startsAt).toBe(localInstant("2027-03-09", 9 * 60, "America/Chicago"));
    expect(after.job!.startsAt).toBe(localInstant("2027-03-16", 9 * 60, "America/Chicago"));
    expect(after.job!.startsAt - before.job!.startsAt).toBe(7 * 86_400_000 - 3_600_000);
  });
});
