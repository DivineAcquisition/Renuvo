/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AREA, HOUR, JOB_START } from "../tests/harness";
import { flush, PROSPECT, quoteLink, salesTestEnv, setup } from "../tests/salesHarness";
import { api } from "./_generated/api";

/**
 * The whole journey, on the rules reader with the mock text service: a form submission becomes an
 * opportunity, Sales quotes it from the published service, the customer accepts on the quote page and
 * chooses a time, Sales checks every requirement and capacity, makes the job, and Dispatch has it.
 */
describe("Sales: inquiry to booking", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = salesTestEnv();
  });
  afterEach(() => undo());

  it("takes a form inquiry through a quote, an acceptance and a booking Dispatch can staff", async () => {
    const s = await setup({ autonomous: true });
    const { publicId } = await s.publishForm();
    expect(await s.submit(publicId)).toMatchObject({ status: "saved" });
    await flush(s.t);

    // The form's answers are facts already, so nothing is asked again: Sales goes straight to the price.
    const [opportunity] = await s.opportunities();
    expect(opportunity).toMatchObject({ stage: "quote_sent", channel: "sms", source: { kind: "form" } });
    const detail = await s.opportunity(opportunity._id);
    expect(detail.checklist.filter((row) => row.phase === "quote").every((row) => row.state === "known")).toBe(true);
    // $120 base + 2 more bedrooms at $20 + 1 more bathroom at $25.
    expect(detail.quote).toMatchObject({ status: "sent", sentVersion: 1 });
    expect(detail.quote!.versions[0]).toMatchObject({ totalCents: 18500, serviceName: "Standard clean", outcome: "firm" });
    const texts = s.textsTo(PROSPECT.phone);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("$185.00");
    expect(texts[0]).toContain("Alpha Cleaning's assistant");
    expect(texts[0]).toContain("Reply STOP to opt out.");

    // The customer's page: the offer, and times that are open now.
    const token = quoteLink(PROSPECT.phone);
    const page = (await s.t.query(api.salesQuotePages.view, { token }))!;
    expect(page).toMatchObject({ state: "open", needsAddress: true, quote: { totalCents: 18500 } });
    expect(page.slots.length).toBeGreaterThan(0);
    const slot = page.slots.find((row) => row.startsAt === JOB_START) ?? page.slots[0];

    const accepted = await s.t.mutation(api.salesQuotePages.accept, { token, version: page.quote.version, hash: page.quote.hash, name: "Maria Lopez", slotStartsAt: slot.startsAt, address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: AREA }, access: "Key under the mat." });
    expect(accepted).toEqual({ status: "accepted", slot: "reserved" });
    await flush(s.t);

    // One job, made from the accepted version, at the accepted price, on the chosen time.
    const won = (await s.opportunities())[0];
    expect(won.stage).toBe("won");
    const job = await s.t.run(async (ctx) => (await ctx.db.get(won.jobId!))!);
    expect(job).toMatchObject({ status: "scheduled", priceCents: 18500, startsAt: slot.startsAt, serviceType: "Standard clean", sales: { opportunityId: won._id, quoteVersion: 1 } });
    expect(job.instructions).toContain("Key under the mat.");
    expect(job.serviceSnapshot).toMatchObject({ priceSource: "quote" });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("jobs").collect()).length)).toBe(1);

    // Dispatch took it in the same step: the visit has its cover task. Nobody has accepted it yet, and Sales did not say so.
    const tasks = await s.t.run(async (ctx) => ctx.db.query("tasks").collect());
    expect(tasks.some((task) => task.agent === "dispatch" && task.key === `dispatch.cover:${job._id}`)).toBe(true);
    const confirmation = s.textsTo(PROSPECT.phone).at(-1)!;
    expect(confirmation).toContain("You're booked");
    expect(confirmation).toContain("arranging your cleaning team");
    expect(confirmation).not.toMatch(/cleaner (is|has been) confirmed|confirmed (crew|cleaner)/i);

    const overview = await s.as.query(api.sales.overview, { companyId: s.companyId, asOf: Date.now() });
    expect(overview.measures).toMatchObject({ inquiries: 1, quotesSent: 1, quotesAccepted: 1, bookings: 1, quotedValueCents: 18500, bookedValueCents: 18500 });
    expect(overview.recentBookings[0]).toMatchObject({ jobId: job._id, capacityVerified: true });
    // Asking again for the same booking makes nothing new.
    expect(await s.as.mutation(api.sales.confirm, { companyId: s.companyId, opportunityId: won._id })).toMatchObject({ ok: true, jobId: job._id });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("jobs").collect()).length)).toBe(1);
  });

  it("asks only what the service's price needs, reads the answer, and never asks it twice", async () => {
    const s = await setup({ autonomous: true });
    await s.text(PROSPECT.phone, "Hi, how much for a house cleaning? We're in 78701.");
    await flush(s.t);
    const [opportunity] = await s.opportunities();
    expect(opportunity).toMatchObject({ stage: "qualifying", source: { kind: "sms" } });
    // The postal code was in the message, so it is not asked for. Bedrooms and bathrooms are.
    const first = s.textsTo(PROSPECT.phone)[0];
    expect(first).toContain("How many bedrooms?");
    expect(first).toContain("How many bathrooms");
    expect(first).not.toMatch(/ZIP|postal/i);

    await s.text(PROSPECT.phone, "3 bed 2 bath");
    await flush(s.t);
    const after = (await s.opportunities())[0];
    expect(after.stage).toBe("quote_sent");
    expect(after.facts.find((fact) => fact.key === "bedrooms")).toMatchObject({ value: 3, status: "stated", source: { kind: "customer", excerpt: "3 bed" } });
    expect(s.textsTo(PROSPECT.phone).at(-1)).toContain("$185.00");
    // First response is measured from the inquiry to the first message that actually left.
    expect(after.firstResponseAt! - after.receivedAt).toBeLessThan(HOUR);
  });
});
