/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchJob, dispatchPlace, NOW, refusal, start, type T } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ReceiptReading } from "./lib/ai/anthropic";
import { NOT_ALLOWED } from "./lib/errors";
import { vendorKey } from "./lib/finance/expenses";
import { setReceiptReaderForTests } from "./lib/finance/receiptReader";

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, n + 1, n + 2, 7, 7, 7, 7, 7, 7, 7, 7, 7]);
const key = (n: number | string) => `client-key-${n}-0000`;

/** What the stand-in reader returns for the next receipts, in order. */
let readings: ReceiptReading[] = [];
let calls = 0;
const clear = <T,>(value: T) => ({ value, clear: true });
function receipt(vendor: string, date: string, total: number, extra: Partial<ReceiptReading> = {}): ReceiptReading {
  return { isReceipt: true, vendor: clear(vendor), date: clear(date), total: clear(total), tax: clear(Math.round(total * 0.0825 * 100) / 100), paidWith: clear("Visa ending 4242"), items: "Microfiber cloths, glass cleaner", category: { name: "Supplies", why: "Cleaning supplies on the receipt." }, ...extra };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  readings = [];
  calls = 0;
  setReceiptReaderForTests(async () => {
    calls += 1;
    const reading = readings.shift();
    if (!reading) return { ok: false, state: "not_available", note: "Selestial can't read receipts right now. Enter the details from the receipt." };
    return { ok: true, reading, usage: { inputTokens: 1200, outputTokens: 180 }, model: { provider: "anthropic", model: "test-model", rates: { inputPerMTok: 3, outputPerMTok: 15 } } };
  });
});
afterEach(() => {
  vi.useRealTimers();
  setReceiptReaderForTests(null);
});

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  return { t, as, companyId };
}
type S = Awaited<ReturnType<typeof setup>>;

async function upload(s: S, bytes: Uint8Array, name = "receipt.jpg", type = "image/jpeg") {
  const storageId = await s.t.run(async (ctx) => ctx.storage.store(new Blob([bytes as BlobPart], { type })));
  const { results } = await s.as.mutation(api.expenses.addReceipts, { companyId: s.companyId, files: [{ storageId, name }] });
  await settle(s.t);
  return results[0];
}
const get = (s: S, expenseId: Id<"expenses">) => s.as.query(api.expenses.expense, { companyId: s.companyId, expenseId });
const overview = (s: S, filter: "review" | "recorded" | "owed_back" | "void" | "all" = "all") => s.as.query(api.expenses.overview, { companyId: s.companyId, period: "last_90_days", filter });
type Fields = { vendor: string | null; spentOn: string | null; amountCents: number | null; taxCents: number | null; description: string | null; categoryId: string | null; link: { kind: "job"; jobId: Id<"jobs"> } | { kind: "overhead" } | null; paidWith: "business_card" | "bank" | "cash" | "personal" | "other" | null; paidWithNote: string | null };
const blank: Fields = { vendor: null, spentOn: null, amountCents: null, taxCents: null, description: null, categoryId: null, link: null, paidWith: null, paidWithNote: null };

describe("receipts", () => {
  it("reads a receipt into a draft that waits for the Owner, with the category only suggested", async () => {
    const s = await setup();
    readings = [receipt("The Home Depot #4521", "2027-02-27", 48.37)];
    const added = await upload(s, JPEG(1));
    expect(added.problem).toBeNull();
    const e = await get(s, added.expenseId!);
    expect(e).toMatchObject({ status: "to_review", vendor: "The Home Depot #4521", spentOn: "2027-02-27", amountCents: 4837, taxCents: 399, paidWithNote: "Visa ending 4242", category: null, suggestion: { id: "supplies", name: "Supplies" }, flags: [], reading: "read" });
    expect(e.missing).toEqual(["a category"]);
    // Ready to record once the Owner accepts the suggestion; nothing recorded on its own.
    const o = await overview(s, "review");
    expect(o.totals).toMatchObject({ reviewCount: 1, reviewCents: 4837, spentCents: 0 });
    expect(o.readyToRecord).toEqual([{ expenseId: added.expenseId, revision: e.revision, acceptSuggestion: true }]);
    const usage = await s.t.run(async (ctx) => ctx.db.query("aiUsage").collect());
    expect(usage.map((u) => u.feature)).toEqual(["receipt_read"]);
    const done = await s.as.mutation(api.expenses.recordMany, { companyId: s.companyId, items: o.readyToRecord });
    expect(done.recorded).toBe(1);
    expect(await get(s, added.expenseId!)).toMatchObject({ status: "recorded", category: { id: "supplies", by: "person" }, recordedWords: "Recorded by You" });
  });

  it("marks what it couldn't read clearly, keeps what the Owner typed, and notices the same file twice", async () => {
    const s = await setup();
    readings = [receipt("Costco", "2027-02-26", 112.4, { total: { value: 112.4, clear: false } })];
    const first = await upload(s, JPEG(2));
    const e = await get(s, first.expenseId!);
    expect(e.unclear).toEqual(["amount"]);
    expect(e.flags[0]).toMatch(/Check the amount/);
    // Not ready for a bulk record while the amount is unclear.
    expect((await overview(s, "review")).readyToRecord).toEqual([]);
    const again = await upload(s, JPEG(2));
    expect(again.problem).toMatch(/already added/);
    // A file that isn't a photo, though it says it is, is never sent anywhere.
    const before = calls;
    const fake = await upload(s, new TextEncoder().encode("not really a photo at all"), "x.jpg");
    expect(calls).toBe(before);
    expect(await get(s, fake.expenseId!)).toMatchObject({ status: "to_review", reading: "failed", amountCents: null });
    // When reading isn't available the receipt is still kept, waiting for the Owner to type the details.
    const unread = await upload(s, JPEG(3));
    expect(await get(s, unread.expenseId!)).toMatchObject({ reading: "not_available", status: "to_review" });
  });
});

describe("the Owner's rules", () => {
  it("files a clear, complete receipt by rule, but never an unclear one or a possible repeat", async () => {
    const s = await setup();
    readings = [receipt("The Home Depot #4521", "2027-02-27", 48.37)];
    const first = await upload(s, JPEG(10));
    const e = await get(s, first.expenseId!);
    const saved = await s.as.mutation(api.expenses.saveExpense, { companyId: s.companyId, expenseId: e.id, revision: e.revision, ...blank, vendor: e.vendor, spentOn: e.spentOn, amountCents: e.amountCents, taxCents: e.taxCents, categoryId: "supplies", paidWith: "business_card", paidWithNote: e.paidWithNote, record: true, rule: { autoFile: true } });
    expect(saved).toMatchObject({ ok: true, words: "Recorded" });
    expect((await s.as.query(api.expenses.rules, { companyId: s.companyId }))[0]).toMatchObject({ vendorContains: "home depot", categoryName: "Supplies", autoFile: true });

    readings = [receipt("HOME DEPOT 0310", "2027-02-28", 22.1), receipt("Home Depot", "2027-02-28", 61, { total: { value: 61, clear: false } }), receipt("The Home Depot", "2027-02-27", 48.37)];
    const filed = await upload(s, JPEG(11));
    expect(await get(s, filed.expenseId!)).toMatchObject({ status: "recorded", byRule: true, category: { id: "supplies", by: "rule" }, paidWith: "business_card" });
    const unclear = await upload(s, JPEG(12));
    expect(await get(s, unclear.expenseId!)).toMatchObject({ status: "to_review", category: { id: "supplies", by: "rule" } });
    const repeat = await upload(s, JPEG(13));
    const r = await get(s, repeat.expenseId!);
    expect(r.status).toBe("to_review");
    expect(r.repeat).toMatchObject({ amountCents: 4837, statusWords: "Recorded" });
    const events = await s.t.run(async (ctx) => ctx.db.query("events").collect());
    expect(events.filter((ev) => ev.type === "expense.filed_by_rule")).toHaveLength(1);
  });
});

describe("adding by hand", () => {
  it("records a complete expense, flags a repeat until the Owner says otherwise, and adds once per click", async () => {
    const s = await setup();
    const base = { ...blank, vendor: "Shell", spentOn: "2027-02-25", amountCents: 6000, categoryId: "vehicle", paidWith: "business_card" as const };
    const a = await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...base, record: true, clientKey: key(1) });
    expect(a).toMatchObject({ recorded: true, repeatOf: null });
    expect((await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...base, record: true, clientKey: key(1) })).expenseId).toBe(a.expenseId);
    const b = await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...base, spentOn: "2027-02-26", record: true, clientKey: key(2) });
    expect(b).toMatchObject({ recorded: false, repeatOf: a.expenseId });
    const e = await get(s, b.expenseId);
    expect(await s.as.mutation(api.expenses.saveExpense, { companyId: s.companyId, expenseId: e.id, revision: e.revision, ...base, spentOn: "2027-02-26", record: true })).toMatchObject({ ok: false, words: expect.stringMatching(/repeat/) });
    const e2 = await get(s, b.expenseId);
    expect(await s.as.mutation(api.expenses.saveExpense, { companyId: s.companyId, expenseId: e2.id, revision: e2.revision, ...base, spentOn: "2027-02-26", record: true, notARepeat: true })).toMatchObject({ ok: true });
    // A stale revision is refused rather than overwriting.
    expect(await s.as.mutation(api.expenses.saveExpense, { companyId: s.companyId, expenseId: e2.id, revision: e2.revision, ...base, record: false })).toMatchObject({ ok: false, words: expect.stringMatching(/changed/) });
    expect((await overview(s)).totals).toMatchObject({ spentCents: 12000, spentCount: 2 });
  });

  it("checks what's entered", async () => {
    const s = await setup();
    const add = (fields: Partial<Fields>, n: number) => refusal(s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, ...fields, record: true, clientKey: key(`v${n}`) }));
    expect(await add({ amountCents: 0 }, 1)).toMatch(/more than \$0/);
    expect(await add({ spentOn: "2027-04-01" }, 2)).toMatch(/future/);
    expect(await add({ categoryId: "nope" }, 3)).toMatch(/your categories/);
    const place = await dispatchPlace(s.as, s.companyId);
    const jobId = await dispatchJob(s.as, s.companyId, place);
    expect(await add({ categoryId: "insurance", link: { kind: "job", jobId } }, 4)).toMatch(/overhead/);
  });

  it("tracks what the Owner paid personally until they're paid back", async () => {
    const s = await setup();
    const one = await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, vendor: "Walmart", spentOn: "2027-02-20", amountCents: 3150, categoryId: "supplies", paidWith: "personal", record: true, clientKey: key(5) });
    await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, vendor: "Uline", spentOn: "2027-02-21", amountCents: 8900, categoryId: "supplies", paidWith: "personal", record: true, clientKey: key(6) });
    expect((await overview(s)).totals).toMatchObject({ owedBackCents: 12050, owedBackCount: 2 });
    expect(await s.as.mutation(api.expenses.markRepaid, { companyId: s.companyId, expenseIds: [one.expenseId], on: "2027-02-28" })).toEqual({ totalCents: 3150 });
    expect((await overview(s, "owed_back")).rows.map((r) => r.vendor)).toEqual(["Uline"]);
    expect(await refusal(s.as.mutation(api.expenses.voidExpense, { companyId: s.companyId, expenseId: one.expenseId, reason: "oops" }))).toMatch(/paid back/);
  });
});

describe("visits", () => {
  it("suggests the only visit that day, links it only when accepted, and suggests none for overhead", async () => {
    const s = await setup();
    const place = await dispatchPlace(s.as, s.companyId);
    const jobId = await dispatchJob(s.as, s.companyId, place);
    const a = await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, vendor: "City parking", spentOn: "2027-03-02", amountCents: 1200, record: false, clientKey: key(7) });
    const e = await get(s, a.expenseId);
    expect(e.jobSuggestion).toMatchObject({ jobId, why: expect.stringMatching(/only visit that day/) });
    expect(e.linked).toBe(false);
    await s.as.mutation(api.expenses.saveExpense, { companyId: s.companyId, expenseId: e.id, revision: e.revision, ...blank, vendor: e.vendor, spentOn: e.spentOn, amountCents: e.amountCents, categoryId: "parking", link: { kind: "job", jobId }, record: true });
    const linked = await s.t.run(async (ctx) => ctx.db.query("expenses").withIndex("by_company_job", (q) => q.eq("companyId", s.companyId).eq("jobId", jobId)).collect());
    expect(linked).toHaveLength(1);
    const b = await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, vendor: "State Farm", spentOn: "2027-03-02", amountCents: 21000, categoryId: "insurance", record: false, clientKey: key(8) });
    expect((await get(s, b.expenseId)).jobSuggestion).toBeNull();
  });
});

describe("statement import", () => {
  it("adds new rows to review, ties rows to receipts already added, skips money in, and adds nothing twice", async () => {
    const s = await setup();
    readings = [receipt("The Home Depot #4521", "2027-02-27", 48.37)];
    const fromReceipt = await upload(s, JPEG(20));
    await s.as.mutation(api.expenses.saveRule, { companyId: s.companyId, ruleId: null, vendorContains: "Shell Oil", categoryId: "vehicle", paidWith: null, autoFile: true, active: true });
    const rows = [
      { on: "2027-02-28", description: "HOME DEPOT #4521 AUSTIN TX", amountCents: 4837, moneyIn: false },
      { on: "2027-02-25", description: "SHELL OIL 5741", amountCents: 6000, moneyIn: false },
      { on: "2027-02-24", description: "SPARKLE SUPPLY CO", amountCents: 15025, moneyIn: false },
      { on: "2027-02-23", description: "PAYMENT THANK YOU", amountCents: 50000, moneyIn: true },
    ];
    const preview = await s.as.query(api.expenses.statementPreview, { companyId: s.companyId, rows });
    expect(preview.counts).toEqual({ new: 2, matches: 1, imported: 0, money_in: 1, invalid: 0 });
    const result = await s.as.mutation(api.expenses.importStatement, { companyId: s.companyId, name: "Chase Feb.csv", paidWith: "business_card", paidWithNote: "Chase Ink", rows, clientKey: key(9) });
    expect(result).toMatchObject({ added: 2, matched: 1, skipped: 1, filed: 1 });
    expect(await get(s, fromReceipt.expenseId!)).toMatchObject({ statementLine: { description: "HOME DEPOT #4521 AUSTIN TX" }, paidWith: "business_card" });
    const o = await overview(s, "all");
    expect(o.rows.find((r) => r.vendor === "SHELL OIL 5741")).toMatchObject({ status: "recorded", byRule: true });
    expect(o.rows.find((r) => r.vendor === "SPARKLE SUPPLY CO")).toMatchObject({ status: "to_review" });
    // The same file again, as a new import: nothing new.
    const again = await s.as.mutation(api.expenses.importStatement, { companyId: s.companyId, name: "Chase Feb.csv", paidWith: "business_card", paidWithNote: null, rows, clientKey: key(10) });
    expect(again).toMatchObject({ added: 0 });
  });
});

describe("categories and access", () => {
  it("renames and adds categories, and hides a removed one so past expenses keep their meaning", async () => {
    const s = await setup();
    await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, vendor: "Spotless Laundry", spentOn: "2027-02-20", amountCents: 4500, categoryId: "laundry", record: true, clientKey: key(11) });
    const current = (await s.as.query(api.finance.settings, { companyId: s.companyId })).settings.expenseCategories;
    const next = current.filter((c) => c.id !== "laundry").map((c) => (c.id === "supplies" ? { ...c, name: "Cleaning supplies" } : c));
    await s.as.mutation(api.expenses.saveCategories, { companyId: s.companyId, categories: [...next, { id: "", name: "Uniforms", kind: "job" }] });
    const saved = (await s.as.query(api.finance.settings, { companyId: s.companyId })).settings.expenseCategories;
    expect(saved.find((c) => c.id === "supplies")?.name).toBe("Cleaning supplies");
    expect(saved.find((c) => c.id === "laundry")?.hidden).toBe(true);
    expect(saved.find((c) => c.name === "Uniforms")).toMatchObject({ kind: "job" });
    expect((await overview(s)).byCategory[0]).toMatchObject({ name: "Laundry", cents: 4500 });
  });

  it("is the Owner's alone", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    expect(await refusal(manager.query(api.expenses.overview, { companyId: s.companyId, period: "this_month", filter: "all" }))).toBe(NOT_ALLOWED);
    expect(await refusal(manager.mutation(api.expenses.addExpense, { companyId: s.companyId, ...blank, record: false, clientKey: key(12) }))).toBe(NOT_ALLOWED);
  });

  it("matches vendors across spellings", () => {
    expect(vendorKey("The Home Depot #4521")).toBe("home depot");
    expect(vendorKey("HOME DEPOT 0310")).toBe("home depot 0310");
    expect(vendorKey("Sparkle Supply Co.")).toBe("sparkle supply");
  });
});

describe("on the Overview", () => {
  it("counts recorded spending and points at what waits: review, possible repeats, and money owed back", async () => {
    const s = await setup();
    const base = { ...blank, vendor: "Walmart", spentOn: "2027-03-01", amountCents: 3150, categoryId: "supplies", paidWith: "personal" as const };
    await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...base, record: true, clientKey: key("o1") });
    await s.as.mutation(api.expenses.addExpense, { companyId: s.companyId, ...base, record: true, clientKey: key("o2") });
    readings = [receipt("Uline", "2027-03-01", 89)];
    await upload(s, JPEG(40));
    let o = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(o.expenses).toMatchObject({ spentCents: 3150, spentCount: 1, reviewCount: 2, owedBackCents: 3150, any: true });
    expect(o.findings.find((f) => f.id === "expense_repeats")?.records[0]).toMatchObject({ kind: "expense", label: "Walmart" });
    expect(o.findings.find((f) => f.id === "expenses_review")).toMatchObject({ state: "needs_your_approval", totalCents: 8900 });
    expect(o.findings.find((f) => f.id === "owed_back")).toBeUndefined();
    // Two weeks on and still not paid back: Selestial points it out.
    vi.setSystemTime(NOW + 15 * 24 * 3_600_000);
    o = await s.as.query(api.finance.overview, { companyId: s.companyId, period: "this_month" });
    expect(o.findings.find((f) => f.id === "owed_back")).toMatchObject({ totalCents: 3150, action: { kind: "expenses", filter: "owed_back" } });
    expect(o.activity.map((a) => a.title)).toContain("Expense recorded");
  });
});
