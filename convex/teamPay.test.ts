/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchCleaner, dispatchJob, dispatchPlace, NOW, refusal, start, type T } from "../tests/harness";
import { fakeStripe } from "../tests/fakeStripe";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED } from "./lib/errors";
import { payToken } from "./lib/finance/payLinks";
import { setStripeTransportForTests } from "./lib/finance/stripe";
import { splitEvenly, workedMinutes } from "./lib/finance/teamPay";

const SECRET = "test-only-secret-for-action-links-0123456789";
const HOUR = 3_600_000;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
let stripe = fakeStripe();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.ACTION_LINK_SECRET = SECRET;
  process.env.LINK_ORIGIN = "https://link.selestial.test";
  stripe = fakeStripe();
  setStripeTransportForTests(stripe.fetch);
});
afterEach(() => {
  vi.useRealTimers();
  setStripeTransportForTests(null);
  for (const name of ["ACTION_LINK_SECRET", "LINK_ORIGIN", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "APP_ORIGIN"]) delete process.env[name];
});

/** A completed job worked by the given cleaners, each with a check-in and a completion time. */
async function workedJob(t: T, as: ReturnType<T["withIdentity"]>, companyId: Id<"companies">, crew: { cleanerId: Id<"cleaners">; minutes?: number | null; offered?: number }[], priceCents = 24000) {
  const place = await dispatchPlace(as, companyId);
  const jobId = await dispatchJob(as, companyId, place, { priceCents });
  await t.run(async (ctx) => {
    const job = (await ctx.db.get(jobId))!;
    await ctx.db.patch(jobId, { status: "completed", requiredCrew: crew.length });
    // Offers Dispatch may have made for this job are not the crew used here.
    for (const a of await ctx.db.query("assignments").withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", jobId)).collect()) await ctx.db.patch(a._id, { status: "cancelled" });
    for (const [i, member] of crew.entries()) {
      const checkIn = job.startsAt + 5 * 60_000;
      await ctx.db.insert("assignments", {
        companyId,
        jobId,
        cleanerId: member.cleanerId,
        status: "accepted",
        scope: "x",
        payCents: member.offered ?? 12000,
        offeredAt: job.startsAt - 48 * HOUR,
        respondBy: job.startsAt - 24 * HOUR,
        respondedAt: job.startsAt - 47 * HOUR + i,
        role: i === 0 ? "lead" : "support",
        ...(member.minutes === null ? {} : { checkIn: { at: checkIn }, completion: { submittedAt: checkIn + (member.minutes ?? 120) * 60_000, incomplete: false } }),
      });
    }
  });
  return jobId;
}

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const rosa = await dispatchCleaner(as, companyId, "Rosa Diaz", { shareBps: 5000 });
  return { t, as, companyId, rosa };
}

const rowsFor = async (s: Awaited<ReturnType<typeof setup>>, filter: "review" | "approved" | "started" | "paid" | "all" = "all") => (await s.as.query(api.teamPay.overview, { companyId: s.companyId, filter })).rows;

describe("working out pay", () => {
  it("measures hours from check-in to completion and splits tips evenly", () => {
    expect(workedMinutes({ checkIn: { at: 0 }, completion: { submittedAt: 150 * 60_000, incomplete: false } })).toBe(150);
    expect(workedMinutes({ checkIn: undefined, completion: { submittedAt: 1, incomplete: false } })).toBeNull();
    expect(splitEvenly(1001, ["a", "b", "c"] as Id<"cleaners">[]).map((x) => x.cents)).toEqual([334, 334, 333]);
  });

  it("works out a share, a tier, a fixed amount and an hourly rate, and keeps each job's rate when the rate changes", async () => {
    const s = await setup();
    await s.as.mutation(api.teamPay.saveTiers, { companyId: s.companyId, tiers: [{ id: null, name: "Starter", sharePercent: 35 }, { id: null, name: "Proven", sharePercent: 40 }] });
    const tiers = (await s.t.run(async (ctx) => ctx.db.get(s.companyId)))!.payTiers!;
    const proven = tiers.find((t) => t.name === "Proven")!;
    const ana = await dispatchCleaner(s.as, s.companyId, "Ana Lima", { shareBps: null });
    await s.as.mutation(api.cleaners.setPay, { companyId: s.companyId, cleanerId: ana, pay: { kind: "tier", tierId: proven.id } });
    const ben = await dispatchCleaner(s.as, s.companyId, "Ben Ford", { shareBps: null });
    await s.as.mutation(api.cleaners.setPay, { companyId: s.companyId, cleanerId: ben, pay: { kind: "fixed", perJobCents: 9000 } });
    const eli = await dispatchCleaner(s.as, s.companyId, "Eli Park", { hourlyCents: 2400 });
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa, offered: 12000 }]);
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: ana, offered: 9600 }]);
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: ben, offered: 9000 }]);
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: eli, minutes: 150, offered: 4800 }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    const rows = await rowsFor(s);
    const by = (name: string) => rows.find((r) => r.cleaner === name)!;
    expect(by("Rosa Diaz")).toMatchObject({ totalCents: 12000, status: "calculated", basis: "50% of the $240.00 job price" });
    expect(by("Ana Lima")).toMatchObject({ totalCents: 9600, basis: "Proven tier, 40% of the $240.00 job price", method: "tier" });
    expect(by("Ben Ford")).toMatchObject({ totalCents: 9000, basis: "$90.00 for the job" });
    // 150 minutes worked at $24/h, against 120 scheduled: within the tolerance, so no flag.
    expect(by("Eli Park")).toMatchObject({ totalCents: 6000, minutes: 150, minutesSource: "worked", status: "calculated" });

    // Proven goes up to 45%: the job already worked keeps 40% until the Owner asks for the current rate.
    await s.as.mutation(api.teamPay.saveTiers, { companyId: s.companyId, tiers: [{ id: tiers[0].id, name: "Starter", sharePercent: 35 }, { id: proven.id, name: "Proven", sharePercent: 45 }] });
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    expect(by("Ana Lima").totalCents).toBe(9600);
    await s.as.mutation(api.teamPay.useCurrentPay, { companyId: s.companyId, earningId: by("Ana Lima").id });
    const ana2 = (await rowsFor(s)).find((r) => r.cleaner === "Ana Lima")!;
    expect(ana2).toMatchObject({ totalCents: 10800, status: "needs_review" });
  });

  it("never guesses: no pay method or no check-in is flagged for review, and the Owner corrects hours with a reason", async () => {
    const s = await setup();
    const noPay = await dispatchCleaner(s.as, s.companyId, "Nia Cole", { shareBps: null });
    const eli = await dispatchCleaner(s.as, s.companyId, "Eli Park", { hourlyCents: 2400 });
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: noPay }]);
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: eli, minutes: null }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    const rows = await rowsFor(s, "review");
    const nia = rows.find((r) => r.cleaner === "Nia Cole")!;
    expect(nia).toMatchObject({ status: "needs_review", totalCents: null, bindsTo: null });
    expect(nia.flags[0]).toMatch(/no pay set/);
    const eliRow = rows.find((r) => r.cleaner === "Eli Park")!;
    expect(eliRow.flags).toContain("No check-in or completion time, so the scheduled hours were used.");
    expect(await refusal(s.as.mutation(api.teamPay.correctHours, { companyId: s.companyId, earningId: eliRow.id, minutes: 135, reason: "" }))).toMatch(/Say why/);
    await s.as.mutation(api.teamPay.correctHours, { companyId: s.companyId, earningId: eliRow.id, minutes: 135, reason: "Texted at 11:20 that she was done" });
    const corrected = (await rowsFor(s)).find((r) => r.cleaner === "Eli Park")!;
    expect(corrected).toMatchObject({ totalCents: 5400, minutesSource: "corrected", status: "calculated" });
  });
});

describe("approving and paying", () => {
  it("keeps approved, payment started and paid apart, and sends a changed total back to review", async () => {
    const s = await setup();
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    let row = (await rowsFor(s))[0];
    expect(await s.as.mutation(api.teamPay.approve, { companyId: s.companyId, earningId: row.id, bindsTo: "stale" })).toMatchObject({ ok: false, words: "It changed since you reviewed it. Review it again." });
    const approved = await s.as.mutation(api.teamPay.approve, { companyId: s.companyId, earningId: row.id, bindsTo: row.bindsTo! });
    expect(approved.ok).toBe(true);
    let overview = await s.as.query(api.teamPay.overview, { companyId: s.companyId, filter: "approved" });
    expect(overview.totals.approvedUnpaidCents).toBe(12000);
    expect(overview.owed).toEqual([expect.objectContaining({ cleaner: "Rosa Diaz", cents: 12000 })]);

    // An adjustment after approval changes the total: it needs approving again.
    await s.as.mutation(api.teamPay.addAdjustment, { companyId: s.companyId, earningId: row.id, cents: 1500, reason: "Extra time on the oven" });
    row = (await rowsFor(s))[0];
    expect(row.status).toBe("needs_review");
    expect(row.flags[0]).toMatch(/Changed after you approved it: \$120\.00 then, \$135\.00 now/);
    await s.as.mutation(api.teamPay.approve, { companyId: s.companyId, earningId: row.id, bindsTo: row.bindsTo! });

    // Payment started is not paid; paid needs the Owner's confirmation.
    const preview = await s.as.query(api.teamPay.paymentPreview, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [row.id] });
    expect(preview).toMatchObject({ blocked: null, totalCents: 13500 });
    const key = "client-key-teampay-0001";
    const { paymentId } = await s.as.mutation(api.teamPay.recordPayment, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [row.id], method: "zelle", stage: "started", paidOn: null, reference: null, note: null, confirmedPaid: false, bindsTo: preview.bindsTo, clientKey: key });
    expect((await s.as.mutation(api.teamPay.recordPayment, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [row.id], method: "zelle", stage: "started", paidOn: null, reference: null, note: null, confirmedPaid: false, bindsTo: preview.bindsTo, clientKey: key })).paymentId).toBe(paymentId);
    expect((await rowsFor(s))[0].status).toBe("payment_started");
    // Frozen while being paid.
    expect(await refusal(s.as.mutation(api.teamPay.addAdjustment, { companyId: s.companyId, earningId: row.id, cents: 100, reason: "x" }))).toMatch(/payment was already started/);
    // The transfer didn't go: canceled with a reason, owed again.
    await s.as.mutation(api.teamPay.cancelPayment, { companyId: s.companyId, paymentId, reason: "Zelle limit reached" });
    expect((await rowsFor(s))[0].status).toBe("approved");
    const again = await s.as.query(api.teamPay.paymentPreview, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [row.id] });
    expect(await refusal(s.as.mutation(api.teamPay.recordPayment, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [row.id], method: "check", stage: "paid", paidOn: "2027-03-01", reference: "#311", note: null, confirmedPaid: false, bindsTo: again.bindsTo, clientKey: "client-key-teampay-0002" }))).toMatch(/Confirm/);
    await s.as.mutation(api.teamPay.recordPayment, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [row.id], method: "check", stage: "paid", paidOn: "2027-03-01", reference: "#311", note: null, confirmedPaid: true, bindsTo: again.bindsTo, clientKey: "client-key-teampay-0002" });
    expect((await rowsFor(s))[0].status).toBe("paid");
    overview = await s.as.query(api.teamPay.overview, { companyId: s.companyId, filter: "paid" });
    expect(overview.totals.approvedUnpaidCents).toBe(0);
  });

  it("splits a tip across the crew, and a tip that comes after paying is owed on its own", async () => {
    const s = await setup();
    const ana = await dispatchCleaner(s.as, s.companyId, "Ana Lima", { shareBps: 4000 });
    const jobId = await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa }, { cleanerId: ana }]);
    await s.as.mutation(api.teamPay.recordTip, { companyId: s.companyId, jobId, amountCents: 3001, note: "Cash on the counter", confirmedReceived: true });
    let rows = await rowsFor(s);
    expect(rows.map((r) => [r.cleaner, r.tipCents]).sort()).toEqual([["Ana Lima", 1500], ["Rosa Diaz", 1501]]);
    const rosa = rows.find((r) => r.cleaner === "Rosa Diaz")!;
    await s.as.mutation(api.teamPay.approve, { companyId: s.companyId, earningId: rosa.id, bindsTo: rosa.bindsTo! });
    const preview = await s.as.query(api.teamPay.paymentPreview, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [rosa.id] });
    await s.as.mutation(api.teamPay.recordPayment, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [rosa.id], method: "zelle", stage: "paid", paidOn: "2027-03-01", reference: null, note: null, confirmedPaid: true, bindsTo: preview.bindsTo, clientKey: "client-key-teampay-0003" });
    await s.as.mutation(api.teamPay.recordTip, { companyId: s.companyId, jobId, amountCents: 1000, note: null, confirmedReceived: true });
    rows = await rowsFor(s);
    const paid = rows.find((r) => r.cleaner === "Rosa Diaz")!;
    expect(paid).toMatchObject({ status: "paid", lateTipCents: 500, owedCents: 500 });
    const late = await s.as.query(api.teamPay.paymentPreview, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [paid.id] });
    expect(late.totalCents).toBe(500);
    await s.as.mutation(api.teamPay.recordPayment, { companyId: s.companyId, cleanerId: s.rosa, earningIds: [paid.id], method: "cash", stage: "paid", paidOn: "2027-03-01", reference: null, note: null, confirmedPaid: true, bindsTo: late.bindsTo, clientKey: "client-key-teampay-0004" });
    expect((await rowsFor(s)).find((r) => r.cleaner === "Rosa Diaz")).toMatchObject({ status: "paid", owedCents: 0 });
  });

  it("takes a tip paid with the invoice on the pay page, keeps it out of the invoice, and gives it to the crew", async () => {
    const s = await setup();
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_fake";
    process.env.APP_ORIGIN = "https://app.selestial.test";
    const jobId = await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa }]);
    await s.as.mutation(api.financeStripe.connect, { companyId: s.companyId });
    await settle(s.t);
    stripe.activate([...stripe.state.accounts.keys()][0]);
    await s.as.mutation(api.financeStripe.refreshAccount, { companyId: s.companyId });
    await settle(s.t);
    const { invoiceId } = await s.as.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId });
    const draft = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    await s.as.mutation(api.finance.issueInvoice, { companyId: s.companyId, invoiceId, revision: draft.revision, dueDate: null });
    const token = (await payToken((await s.t.run(async (ctx) => ctx.db.get(invoiceId)))!))!;
    const page = await s.t.query(api.pay.view, { token });
    expect(page?.tips).toMatchObject({ crew: ["Rosa"] });
    const { paymentId } = await s.t.mutation(api.pay.start, { token, amountCents: 24000, tipCents: 3600, clientKey: "client-key-tip-0001" });
    await settle(s.t);
    const [intent] = stripe.intentsFor(paymentId!);
    expect(intent.amount).toBe(27600);
    stripe.settle(intent.id, "succeeded");
    await s.t.mutation(api.pay.returned, { token, paymentId: paymentId! });
    await settle(s.t);
    const invoice = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
    expect(invoice.totals).toMatchObject({ paidCents: 24000, balanceCents: 0 });
    expect(invoice.state).toBe("paid");
    const rosa = (await rowsFor(s)).find((r) => r.cleaner === "Rosa Diaz")!;
    expect(rosa).toMatchObject({ tipCents: 3600, totalCents: 15600 });
  });

  it("is the Owner's only", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    expect(await refusal(manager.query(api.teamPay.overview, { companyId: s.companyId, filter: "all" }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.mutation(api.teamPay.refresh, { companyId: s.companyId }))).toBe(NOT_ALLOWED);
  });
});

describe("a cleaner's statement", () => {
  it("shows that cleaner's own jobs and payments only, and a new link closes the old one", async () => {
    const s = await setup();
    const ana = await dispatchCleaner(s.as, s.companyId, "Ana Lima", { shareBps: 4000 });
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa }, { cleanerId: ana }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    const { url } = await s.as.mutation(api.teamPay.issueStatement, { companyId: s.companyId, cleanerId: s.rosa });
    const token = url.split("/c/earnings/")[1];
    const page = await s.t.query(api.statement.view, { token });
    expect(page).toMatchObject({ cleaner: "Rosa Diaz", company: "Alpha Cleaning" });
    expect(page!.jobs).toHaveLength(1);
    expect(page!.jobs[0]).toMatchObject({ totalCents: 12000, state: "Being reviewed", town: "Austin" });
    expect(JSON.stringify(page)).not.toContain("Ana");
    expect(await s.t.query(api.statement.view, { token: `${token}x` })).toBeNull();
    await s.as.mutation(api.teamPay.issueStatement, { companyId: s.companyId, cleanerId: s.rosa });
    expect(await s.t.query(api.statement.view, { token })).toBeNull();
  });
});

describe("team pay on the Overview", () => {
  it("shows what's waiting on the Owner, names the records, and flags approved pay left unpaid", async () => {
    const s = await setup();
    const nia = await dispatchCleaner(s.as, s.companyId, "Nia Cole", { shareBps: null });
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa }]);
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: nia }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    let overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.teamPay).toMatchObject({ reviewCents: 12000, reviewCount: 2, reviewMissing: 1, approvedUnpaidCents: 0, any: true });
    const review = overview.findings.find((f) => f.id === "team_review")!;
    expect(review).toMatchObject({ state: "needs_your_approval", tone: "warning", totalCents: 12000 });
    expect(review.records.map((r) => r.label).sort()).toEqual(["Nia Cole", "Rosa Diaz"]);
    expect(overview.findings.find((f) => f.id === "team_nopay")?.records[0]).toMatchObject({ kind: "cleaner", id: nia });

    const rosaRow = (await rowsFor(s)).find((r) => r.cleaner === "Rosa Diaz")!;
    await s.as.mutation(api.teamPay.approve, { companyId: s.companyId, earningId: rosaRow.id, bindsTo: rosaRow.bindsTo! });
    overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.teamPay.approvedUnpaidCents).toBe(12000);
    expect(overview.findings.find((f) => f.id === "team_unpaid")).toBeUndefined();
    // Two days on and still no payment recorded: Selestial points it out.
    vi.setSystemTime(NOW + 2 * 24 * HOUR + 60_000);
    overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.findings.find((f) => f.id === "team_unpaid")).toMatchObject({ totalCents: 12000, action: { kind: "team_pay", filter: "approved" } });
  });

  it("tells the Owner when a job was worked out with pay that has since changed, and counts cleaners on each tier", async () => {
    const s = await setup();
    await s.as.mutation(api.teamPay.saveTiers, { companyId: s.companyId, tiers: [{ id: null, name: "Proven", sharePercent: 40 }] });
    const proven = (await s.t.run(async (ctx) => ctx.db.get(s.companyId)))!.payTiers![0];
    await s.as.mutation(api.cleaners.setPay, { companyId: s.companyId, cleanerId: s.rosa, pay: { kind: "tier", tierId: proven.id } });
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: s.rosa }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    const row = (await rowsFor(s))[0];
    expect((await s.as.query(api.teamPay.earning, { companyId: s.companyId, earningId: row.id })).payUsedDiffers).toBe(false);
    expect((await s.as.query(api.finance.settings, { companyId: s.companyId })).tiers).toMatchObject([{ name: "Proven", shareBps: 4000, cleaners: 1 }]);
    await s.as.mutation(api.teamPay.saveTiers, { companyId: s.companyId, tiers: [{ id: proven.id, name: "Proven", sharePercent: 45 }] });
    expect((await s.as.query(api.teamPay.earning, { companyId: s.companyId, earningId: row.id })).payUsedDiffers).toBe(true);
  });
});

describe("workers supplied by a subcontractor company", () => {
  it("explains that their pay goes through the company instead of calling it missing", async () => {
    const s = await setup();
    const worker = await s.t.run(async (ctx) => {
      const sub = await ctx.db.insert("subcontractors", { companyId: s.companyId, name: "Sparkle Partners LLC", status: "active", contact: { name: "Lee Chan" }, serviceAreas: [], pay: { kind: "share", shareBps: 5500 }, createdAt: NOW });
      return ctx.db.insert("cleaners", { companyId: s.companyId, name: "Sam Ortiz", engagement: "subcontractor", subcontractorId: sub, status: "ready", skills: [], serviceAreas: [], createdAt: NOW });
    });
    await workedJob(s.t, s.as, s.companyId, [{ cleanerId: worker }]);
    await s.as.mutation(api.teamPay.refresh, { companyId: s.companyId });
    const row = (await rowsFor(s)).find((r) => r.cleaner === "Sam Ortiz")!;
    expect(row).toMatchObject({ totalCents: null, status: "needs_review" });
    expect(row.flags[0]).toMatch(/works through Sparkle Partners LLC/);
    expect((await s.as.query(api.teamPay.overview, { companyId: s.companyId, filter: "review" })).noPay).toEqual([]);
    const overview = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(overview.findings.find((f) => f.id === "team_nopay")).toBeUndefined();
    expect(await refusal(s.as.mutation(api.cleaners.setPay, { companyId: s.companyId, cleanerId: worker, pay: { kind: "fixed", perJobCents: 9000 } }))).toMatch(/contractors/);
  });
});
