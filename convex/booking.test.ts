/**
 * @vitest-environment edge-runtime
 *
 * Booking Experiences end to end: owners build and publish, customers book through a private link, and
 * a finished booking becomes the company's records once. Payments go through the fake Stripe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchCleaner, NOW, refusal, start, type T } from "../tests/harness";
import { fakeStripe } from "../tests/fakeStripe";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeDefinition, defaultDefinition, type Definition } from "./lib/booking/definition";
import { confirmationGate, sizePlan } from "./lib/booking/logic";
import { bookingPaymentChanged } from "./lib/booking/payments";
import { setStripeTransportForTests, signForTests } from "./lib/finance/stripe";
import { blankSpec, type Spec } from "./lib/services/spec";

const SECRET = "public-form-secret-for-tests-0123456789";
const WEBHOOK_SECRET = "whsec_booking_tests";
const HOUR = 60 * 60 * 1000;
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const notice = { required: false, note: "" };
const attribution = { source: "google", medium: "cpc", campaign: "spring", referrer: "https://www.google.com/search?q=x", landing: "/b/alpha-clean/home?utm_source=google" };

let stripe = fakeStripe();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  stripe = fakeStripe();
  setStripeTransportForTests(stripe.fetch);
  process.env.PUBLIC_FORM_SECRET = SECRET;
  process.env.ACTION_LINK_SECRET = "test-only-secret-for-action-links-0123456789";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_fake";
  process.env.STRIPE_CONNECT_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.LINK_ORIGIN = "https://link.selestial.test";
});
afterEach(() => {
  vi.useRealTimers();
  setStripeTransportForTests(null);
  for (const name of ["PUBLIC_FORM_SECRET", "ACTION_LINK_SECRET", "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_CONNECT_WEBHOOK_SECRET", "LINK_ORIGIN"]) delete process.env[name];
});

function homeSpec(patch: Partial<Spec> = {}): Spec {
  return {
    ...blankSpec("residential"),
    name: "Standard clean",
    summary: "Kitchen, bathrooms and living areas.",
    included: [
      { id: "counters", label: "Wipe counters", section: "Kitchen", requiresPhoto: false },
      { id: "floors", label: "Mop floors", section: "Living areas", requiresPhoto: false },
    ],
    excluded: ["Inside the oven"],
    pricing: { method: "bed_bath", baseCents: 12000, includedBedrooms: 1, includedBathrooms: 1, perBedroomCents: 2000, perBathroomCents: 2500, perHalfBathCents: 1000, baseLaborMinutes: 120, perBedroomMinutes: 30, perBathroomMinutes: 30, perHalfBathMinutes: 15 },
    addOns: [{ id: "oven", label: "Inside the oven", priceCents: 3500, per: "visit", laborMinutes: 30, maxQuantity: 1 }],
    team: { crewSize: 1, maxCrew: 3, maxVisitMinutes: 360, skills: [], arrivalWindowMinutes: 60 },
    ...patch,
  };
}

type As = Awaited<ReturnType<typeof company>>["as"];

async function publishService(as: As, companyId: Id<"companies">, spec: Spec): Promise<string> {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  const catalog = await as.query(api.services.catalog, { companyId });
  return catalog.services.find((s: { id: Id<"services"> }) => s.id === serviceId)!.key as string;
}

const RULES = (patch: Record<string, unknown> = {}) => ({
  handle: "alpha-clean",
  profile: { displayName: "Alpha Cleaning", phone: "(512) 555-0100", email: "hello@alpha.example", website: "alpha.example", brandColor: "#1f6feb", accentColor: "#8e5bff" },
  scheduling: { mode: "capacity" as const, noticeHours: 12, horizonDays: 30, slotMinutes: 60, holdMinutes: 15, defaultWindowMinutes: 60 },
  paymentPolicies: [] as { id: string; label: string; kind: "none" | "deposit_percent" | "deposit_fixed" | "full"; percent?: number; cents?: number; balanceTerms: string }[],
  agreements: [],
  ...patch,
});

async function saveRules(as: As, companyId: Id<"companies">, patch: Record<string, unknown> = {}) {
  const current = await as.query(api.bookingExperiences.rules, { companyId });
  await as.mutation(api.bookingExperiences.saveRules, { companyId, expectedRevision: current.revision, ...RULES(patch) } as never);
}

async function edit(as: As, companyId: Id<"companies">, experienceId: Id<"bookingExperiences">, change: (def: Definition) => void) {
  const got = await as.query(api.bookingExperiences.get, { companyId, experienceId });
  const def = structuredClone(got.draft) as Definition;
  change(def);
  const saved = await as.mutation(api.bookingExperiences.saveDraft, { companyId, experienceId, expectedRevision: got.experience.draftRevision, definition: def });
  if (!saved.ok) throw new Error("conflict");
  return saved.revision;
}

async function publish(as: As, companyId: Id<"companies">, experienceId: Id<"bookingExperiences">) {
  const got = await as.query(api.bookingExperiences.get, { companyId, experienceId });
  return as.mutation(api.bookingExperiences.publish, { companyId, experienceId, expectedRevision: got.experience.draftRevision });
}

async function setup(options: { kind?: "residential" | "commercial" | "short_term_rental"; spec?: Spec; cleaners?: number } = {}) {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  await t.run(async (ctx) => ctx.db.patch(companyId, { plan: "operate" }));
  const serviceKey = await publishService(as, companyId, options.spec ?? homeSpec());
  for (let i = 0; i < (options.cleaners ?? 1); i += 1) await dispatchCleaner(as, companyId, `Cleaner ${i + 1}`);
  await saveRules(as, companyId);
  const experienceId = await as.mutation(api.bookingExperiences.create, { companyId, kind: options.kind ?? "residential", name: "Home cleaning" });
  return { t, as, companyId, serviceKey, experienceId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function begin(s: Setup, visitorKey = "visitor-1") {
  const got = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId });
  const started = await s.t.mutation(api.bookingPublic.start, { secret: SECRET, handle: "alpha-clean", slug: got.experience.slug, postalCode: "78701", attribution, visitorKey });
  if (!started.token) throw new Error("refused");
  return started.token;
}

async function contact(t: T, token: string, email = "dana@example.com") {
  await t.mutation(api.bookingSessions.setContact, { token, firstName: "Dana", lastName: "Whitfield", email, phone: "(512) 555-0199", textOk: false });
}

async function view(t: T, token: string) {
  const v = await t.query(api.bookingSessions.view, { token });
  if (v.ended) throw new Error("ended");
  return v;
}

const TUESDAY = "2027-03-02";

/** Location → size → service and time → details: everything before payment or confirmation. */
async function throughDetails(s: Setup, token: string, options: { addOns?: { id: string; quantity: number }[]; email?: string } = {}) {
  await contact(s.t, token, options.email);
  await s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
  await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: options.addOns ?? [], answers: {} });
  const slots = await s.t.query(api.bookingSessions.slots, { token, date: TUESDAY });
  const slot = slots!.find((x) => x.available)!;
  const chosen = await s.t.mutation(api.bookingSessions.chooseTime, { token, startsAt: slot.startsAt });
  expect(chosen).toMatchObject({ ok: true, preferredOnly: false });
  const v = await view(s.t, token);
  await s.t.mutation(api.bookingSessions.acceptQuote, { token, inputHash: v.quote!.inputHash, grandTotalCents: v.quote!.grandTotalCents! });
  await s.t.mutation(api.bookingSessions.setDetails, { token, address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" }, answers: { pets: "No pets", access: "Key under the mat" } });
  return { slot };
}

async function connectStripe(s: Setup) {
  await s.as.mutation(api.financeStripe.connect, { companyId: s.companyId });
  await settle(s.t);
  const accountId = [...stripe.state.accounts.keys()][0];
  stripe.activate(accountId);
  await s.as.mutation(api.financeStripe.refreshAccount, { companyId: s.companyId });
  await settle(s.t);
  return accountId;
}

async function webhook(t: T, event: Record<string, unknown>) {
  const body = JSON.stringify(event);
  const signature = await signForTests(WEBHOOK_SECRET, body, Math.floor(Date.now() / 1000));
  return t.fetch("/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body });
}

describe("the experience definition", () => {
  it("starts from the reference layout with no company's content, and refuses markup and impossible orders", () => {
    const def = normalizeDefinition(defaultDefinition("residential"));
    expect(def.steps.map((s) => s.id)).toEqual(["location", "size", "service", "details", "checkout", "confirmation"]);
    const text = JSON.stringify(def);
    for (const word of ["Novara", "Glow", "50%", "301", "re-clean guarantee"]) expect(text).not.toContain(word);
    const bad = structuredClone(def);
    bad.steps[0].copy.title = "<script>alert(1)</script>";
    expect(() => normalizeDefinition(bad)).toThrow(/plain text/);
    const reordered = structuredClone(def);
    [reordered.steps[1], reordered.steps[2]] = [reordered.steps[2], reordered.steps[1]];
    expect(() => normalizeDefinition(reordered)).toThrow(/Size comes before/);
    const misplaced = structuredClone(def);
    misplaced.steps[1].sections.push({ id: "comparison", hidden: false });
    expect(() => normalizeDefinition(misplaced)).toThrow(/can't go on/);
  });

  it("derives size cards from the services' own bands, so every card prices exactly", () => {
    const banded = (bands: [number, number | null, number][]) => homeSpec({ pricing: { method: "size_bands", unit: "sq_ft", bands: bands.map(([from, to, amountCents]) => ({ from, to, amountCents, laborMinutes: 120 })) } });
    const plan = sizePlan([banded([[0, 1000, 10000], [1000, 2500, 15000], [2500, 4000, 20000]]), banded([[0, 2000, 12000], [2000, 4000, 18000]])], [], null);
    expect(plan.area?.kind).toBe("cards");
    const cards = plan.area?.kind === "cards" ? plan.area : null;
    expect(cards!.cards.map((c) => c.facts.area)).toEqual([1, 1000, 2000, 2500]);
    expect(cards!.customQuoteFrom).toBe(4000);
    expect(sizePlan([homeSpec({ pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 8500, laborMinutesPer1000: 60, walkthroughAbove: null } })], [], null).area?.kind).toBe("input");
  });

  it("keeps paid, held and confirmed apart", () => {
    const base = { request: false, answersComplete: true, quote: { outcome: "firm", grandTotalCents: 100, inputHash: "h" }, accepted: { inputHash: "h", grandTotalCents: 100 }, agreementRequired: false, agreementAccepted: false, paymentRequired: true, paymentSucceeded: true, capacity: "held" as const, eligible: true };
    expect(confirmationGate(base).ready).toBe(true);
    expect(confirmationGate({ ...base, capacity: "expired" }).blockers).toContain("The reserved time expired.");
    expect(confirmationGate({ ...base, paymentSucceeded: false }).blockers).toContain("The payment hasn't been received.");
    expect(confirmationGate({ ...base, accepted: { inputHash: "h", grandTotalCents: 90 } }).blockers).toContain("The price changed and needs to be accepted again.");
    expect(confirmationGate({ ...base, paymentMismatch: true }).blockers).toContain("The payment received doesn't match this booking as it now stands.");
  });
});

describe("building and publishing", () => {
  it("starts from the company's published services and keeps each company's experiences to itself", async () => {
    const s = await setup();
    const got = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId });
    expect(got.draft.services.offered.map((o) => o.serviceKey)).toEqual([s.serviceKey]);
    expect(got.draft.services.featuredKey).toBe(s.serviceKey);
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.bookingExperiences.get, { companyId: other.companyId, experienceId: s.experienceId }))).toBe("Not found.");
    expect(await refusal(other.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId }))).toBe("Not found.");
  });

  it("refuses a stale save and says who saved, and lets only the Owner publish", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "mgr", "manager");
    const got = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId });
    const def = structuredClone(got.draft);
    def.steps[0].copy.title = "Book a sparkling clean.";
    await manager.mutation(api.bookingExperiences.saveDraft, { companyId: s.companyId, experienceId: s.experienceId, expectedRevision: got.experience.draftRevision, definition: def });
    const stale = await s.as.mutation(api.bookingExperiences.saveDraft, { companyId: s.companyId, experienceId: s.experienceId, expectedRevision: got.experience.draftRevision, definition: got.draft });
    expect(stale).toMatchObject({ ok: false, conflict: { savedBy: "mgr" } });
    expect(await refusal(manager.mutation(api.bookingExperiences.publish, { companyId: s.companyId, experienceId: s.experienceId, expectedRevision: got.experience.draftRevision + 1 }))).toBe("Not allowed.");
  });

  it("explains what blocks publishing and points to where it is fixed", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => ctx.db.patch(s.companyId, { plan: undefined }));
    await edit(s.as, s.companyId, s.experienceId, (def) => {
      def.content.trust.push({ id: "insured", text: "Fully insured", confirmed: false });
    });
    const got = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId });
    const blockers = got.items.filter((i) => i.severity === "blocker").map((i) => i.message);
    expect(blockers).toEqual(expect.arrayContaining([expect.stringContaining("Operate or Expand"), expect.stringContaining("Fully insured")]));
    expect(await refusal(publish(s.as, s.companyId, s.experienceId))).toContain("can't be published yet");
  });

  it("serves only the published version publicly, and a preview never exposes the draft", async () => {
    const s = await setup();
    const slug = (await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId })).experience.slug;
    expect(await s.t.query(api.bookingPublic.page, { handle: "alpha-clean", slug })).toBeNull();
    await publish(s.as, s.companyId, s.experienceId);
    await edit(s.as, s.companyId, s.experienceId, (def) => {
      def.steps[0].copy.title = "Unpublished words";
    });
    const page = await s.t.query(api.bookingPublic.page, { handle: "alpha-clean", slug });
    expect(page?.company.name).toBe("Alpha Cleaning");
    expect(JSON.stringify(page)).not.toContain("Unpublished words");
    expect(JSON.stringify(page)).not.toMatch(/teamNotes|pricingProfiles|payCents/);
  });
});

describe("a residential booking with no payment", () => {
  it("prices from the engine, holds the time, confirms once, and hands the visit to Dispatch", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    const { slot } = await throughDetails(s, token);
    const before = await view(s.t, token);
    expect(before.quote).toMatchObject({ outcome: "firm", grandTotalCents: 14000, dueNowCents: 0 });
    expect(before.states).toMatchObject({ capacity: "held", answers: "complete", quote: "firm" });
    expect(JSON.stringify(before)).not.toContain("Key under the mat");

    const first = await s.t.mutation(api.bookingSessions.confirm, { token });
    expect(first).toMatchObject({ ok: true });
    await s.t.mutation(api.bookingSessions.confirm, { token }).catch(() => undefined);
    await settle(s.t);
    const after = await view(s.t, token);
    expect(after.status).toBe("confirmed");
    const records = await s.t.run(async (ctx) => ({
      jobs: await ctx.db.query("jobs").collect(),
      customers: await ctx.db.query("customers").collect(),
      holds: await ctx.db.query("bookingHolds").collect(),
      quotes: await ctx.db.query("serviceQuotes").collect(),
      tasks: await ctx.db.query("tasks").collect(),
    }));
    expect(records.jobs).toHaveLength(1);
    expect(records.jobs[0]).toMatchObject({ startsAt: slot.startsAt, priceCents: 14000, arrivalWindowMinutes: 60, status: "scheduled" });
    expect(records.jobs[0].instructions).toContain("Key under the mat");
    expect(records.jobs[0].serviceSnapshot).toMatchObject({ priceSource: "quote" });
    expect(records.customers).toHaveLength(1);
    expect(records.holds[0]).toMatchObject({ status: "committed", jobId: records.jobs[0]._id });
    expect(records.quotes).toHaveLength(1);
    // Paid is not confirmed, and confirmed is not "a cleaner accepted": that is only ever Dispatch's record.
    expect(after.confirmation.visitScheduled).toBe(true);

    // A second booking by the same customer reuses their record.
    const again = await begin(s, "visitor-2");
    await throughDetails(s, again);
    await s.t.mutation(api.bookingSessions.confirm, { token: again });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("customers").collect()).length)).toBe(1);
  });

  it("gives one time to one customer when two reach for it together", async () => {
    const s = await setup({ cleaners: 1 });
    await publish(s.as, s.companyId, s.experienceId);
    const a = await begin(s, "a");
    const b = await begin(s, "b");
    for (const token of [a, b]) {
      await contact(s.t, token, `${token.slice(-5)}@example.com`);
      await s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
      await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [], answers: {} });
    }
    const slot = (await s.t.query(api.bookingSessions.slots, { token: a, date: TUESDAY }))!.find((x) => x.available)!;
    const results = await Promise.all([s.t.mutation(api.bookingSessions.chooseTime, { token: a, startsAt: slot.startsAt }), s.t.mutation(api.bookingSessions.chooseTime, { token: b, startsAt: slot.startsAt })]);
    expect(results.filter((r) => "ok" in r && r.ok)).toHaveLength(1);
    expect(results.find((r) => "ok" in r && !r.ok)).toMatchObject({ why: expect.stringContaining("just taken") });
  });

  it("counts every holder of a time: with three cleaners the fourth customer is refused, and a holder still sees their own time", async () => {
    const s = await setup({ cleaners: 3 });
    await publish(s.as, s.companyId, s.experienceId);
    const tokens: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const token = await begin(s, `v${i}`);
      await contact(s.t, token, `c${i}@example.com`);
      await s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
      await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [], answers: {} });
      tokens.push(token);
    }
    const slot = (await s.t.query(api.bookingSessions.slots, { token: tokens[0], date: TUESDAY }))!.find((x) => x.available)!;
    const results = [];
    for (const token of tokens) results.push(await s.t.mutation(api.bookingSessions.chooseTime, { token, startsAt: slot.startsAt }));
    expect(results.map((r) => ("ok" in r ? r.ok : false))).toEqual([true, true, true, false]);
    const own = (await s.t.query(api.bookingSessions.slots, { token: tokens[0], date: TUESDAY }))!.find((x) => x.startsAt === slot.startsAt)!;
    expect(own.available).toBe(true);
    const outsider = (await s.t.query(api.bookingSessions.slots, { token: tokens[3], date: TUESDAY }))!.find((x) => x.startsAt === slot.startsAt)!;
    expect(outsider.available).toBe(false);
  });

  it("counts confirmed visits as well as holds", async () => {
    const s = await setup({ cleaners: 3 });
    await publish(s.as, s.companyId, s.experienceId);
    const pick = async (i: number, startsAt?: number) => {
      const token = await begin(s, `w${i}`);
      await contact(s.t, token, `w${i}@example.com`);
      await s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
      await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [], answers: {} });
      const at = startsAt ?? (await s.t.query(api.bookingSessions.slots, { token, date: TUESDAY }))!.find((x) => x.available)!.startsAt;
      return { token, at, result: await s.t.mutation(api.bookingSessions.chooseTime, { token, startsAt: at }) };
    };
    const first = await pick(0);
    const v = await view(s.t, first.token);
    await s.t.mutation(api.bookingSessions.acceptQuote, { token: first.token, inputHash: v.quote!.inputHash, grandTotalCents: v.quote!.grandTotalCents! });
    await s.t.mutation(api.bookingSessions.setDetails, { token: first.token, address: { line1: "1 A St", city: "Austin", region: "TX", postalCode: "78701" }, answers: { pets: "No pets" } });
    expect(await s.t.mutation(api.bookingSessions.confirm, { token: first.token })).toMatchObject({ ok: true });
    await settle(s.t);
    const results = [];
    for (let i = 1; i < 4; i += 1) results.push((await pick(i, first.at)).result);
    expect(results.map((r) => ("ok" in r ? r.ok : false))).toEqual([true, true, false]);
  });

  it("still sees a live hold when many released holds sit around the same day", async () => {
    const s = await setup({ cleaners: 1 });
    await publish(s.as, s.companyId, s.experienceId);
    const first = await begin(s, "holder");
    await contact(s.t, first, "holder@example.com");
    await s.t.mutation(api.bookingSessions.setHome, { token: first, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
    await s.t.mutation(api.bookingSessions.selectService, { token: first, serviceKey: s.serviceKey, addOns: [], answers: {} });
    const slot = (await s.t.query(api.bookingSessions.slots, { token: first, date: TUESDAY }))!.find((x) => x.available)!;
    // Customers changing their minds earlier that day leave released holds behind, more than one read takes.
    await s.t.run(async (ctx) => {
      const session = (await ctx.db.query("bookingSessions").first())!;
      for (let i = 0; i < 600; i += 1) await ctx.db.insert("bookingHolds", { companyId: s.companyId, sessionId: session._id, startsAt: slot.startsAt - 6 * HOUR + i, endsAt: slot.startsAt - 5 * HOUR, crew: 1, status: "released", expiresAt: NOW, createdAt: NOW, updatedAt: NOW });
    });
    expect(await s.t.mutation(api.bookingSessions.chooseTime, { token: first, startsAt: slot.startsAt })).toMatchObject({ ok: true });
    const second = await begin(s, "second");
    await contact(s.t, second, "second@example.com");
    await s.t.mutation(api.bookingSessions.setHome, { token: second, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
    await s.t.mutation(api.bookingSessions.selectService, { token: second, serviceKey: s.serviceKey, addOns: [], answers: {} });
    expect(await s.t.mutation(api.bookingSessions.chooseTime, { token: second, startsAt: slot.startsAt })).toMatchObject({ ok: false });
  });

  it("matches an existing customer by email without changing their record from what a visitor typed", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    const customerId = await s.as.mutation(api.customers.create, { companyId: s.companyId, name: "Dana Whitfield-Lee", kind: "home", email: "dana@example.com" });
    const token = await begin(s, "same-email");
    await throughDetails(s, token);
    expect(await s.t.mutation(api.bookingSessions.confirm, { token })).toMatchObject({ ok: true });
    const records = await s.t.run(async (ctx) => ({ customers: await ctx.db.query("customers").collect(), jobs: await ctx.db.query("jobs").collect() }));
    expect(records.customers).toHaveLength(1);
    expect(records.customers[0]._id).toBe(customerId);
    // The visitor's phone is not written onto someone else's record; the visit says what they gave.
    expect(records.customers[0].phone).toBeUndefined();
    expect(records.customers[0].name).toBe("Dana Whitfield-Lee");
    expect(records.jobs[0]).toMatchObject({ customerId });
    expect(records.jobs[0].instructions).toMatch(/Booked as Dana Whitfield, \+15125550199 \(differs from the customer record/);
  });

  it("shows only images the company itself uploaded, and never SVG", async () => {
    const s = await setup();
    const store = (type: string) => s.t.run(async (ctx) => ctx.storage.store(new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type })));
    const png = await store("image/png");
    expect(await s.as.mutation(api.bookingExperiences.checkUpload, { companyId: s.companyId, storageId: png })).toMatchObject({ url: expect.any(String) });
    await edit(s.as, s.companyId, s.experienceId, (def) => {
      def.theme.heroImage = png;
    });
    expect(await refusal(s.as.mutation(api.bookingExperiences.checkUpload, { companyId: s.companyId, storageId: await store("image/svg+xml") }))).toContain("PNG, JPEG or WebP");

    // Another company can't put the first company's image (or any file it learned the id of) on its page.
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    const otherExperience = await other.as.mutation(api.bookingExperiences.create, { companyId: other.companyId, kind: "residential", name: "Homes" });
    expect(await refusal(edit(other.as, other.companyId, otherExperience, (def) => {
      def.theme.heroImage = png;
    }))).toContain("wasn't found");
    const rules = await other.as.query(api.bookingExperiences.rules, { companyId: other.companyId });
    expect(await refusal(other.as.mutation(api.bookingExperiences.saveRules, { companyId: other.companyId, expectedRevision: rules.revision, ...RULES({ handle: "beta-clean" }), profile: { ...RULES().profile, logo: png } } as never))).toContain("wasn't found");

    // An old file nobody registered is not accepted either.
    const stale = await store("image/png");
    vi.setSystemTime(NOW + 2 * HOUR);
    expect(await refusal(s.as.mutation(api.bookingExperiences.checkUpload, { companyId: s.companyId, storageId: stale }))).toContain("wasn't found");
  });

  it("keeps an archived experience off the public site until it is restored, including through rollback", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    await s.as.mutation(api.bookingExperiences.archive, { companyId: s.companyId, experienceId: s.experienceId, archived: true });
    expect(await refusal(s.as.mutation(api.bookingExperiences.rollback, { companyId: s.companyId, experienceId: s.experienceId, version: 1 }))).toContain("Restore this experience");
    const got = await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId });
    expect(got.experience.status).toBe("archived");
    expect(await s.t.query(api.bookingPublic.page, { handle: "alpha-clean", slug: got.experience.slug })).toBeNull();
  });

  it("emails the confirmation to a new customer under the words the page showed, and asks nothing of an existing one", async () => {
    process.env.EMAIL_PROVIDER = "mock";
    try {
      const s = await setup({ cleaners: 2 });
      await publish(s.as, s.companyId, s.experienceId);
      await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, emailFromAddress: "hello@alpha.example", quietHours: null });
      const token = await begin(s, "new-customer");
      await throughDetails(s, token);
      expect(await s.t.mutation(api.bookingSessions.confirm, { token })).toMatchObject({ ok: true });
      const records = await s.t.run(async (ctx) => ({ customers: await ctx.db.query("customers").collect(), messages: await ctx.db.query("messages").collect(), permissions: await ctx.db.query("contactPermissions").collect() }));
      expect(records.permissions.filter((p) => p.recipient.kind === "customer")).toEqual([expect.objectContaining({ recipient: { kind: "customer", id: records.customers[0]._id }, channel: "email", category: "operational", status: "granted", source: "web_form", disclosureText: "Alpha Cleaning will email your booking details, confirmation and updates to this address.", recordedBy: { kind: "recipient" } })]);
      expect(records.messages).toEqual([expect.objectContaining({ purpose: "booking_confirmation", status: "queued", to: "dana@example.com" })]);
      await settle(s.t);
      const sent = await s.t.run(async (ctx) => (await ctx.db.query("messages").collect())[0]);
      expect(sent.body).toContain("{link}");
      expect(sent.status).not.toBe("not_sent");

      // An existing customer matched by email: nothing is recorded on their behalf, so without their own
      // permission the confirmation waits for the office instead of going out.
      const existing = await s.as.mutation(api.customers.create, { companyId: s.companyId, name: "Lee Park", kind: "home", email: "lee@example.com" });
      const second = await begin(s, "existing-customer");
      await throughDetails(s, second, { email: "lee@example.com" });
      expect(await s.t.mutation(api.bookingSessions.confirm, { token: second })).toMatchObject({ ok: true });
      const after = await s.t.run(async (ctx) => ({ messages: await ctx.db.query("messages").collect(), permissions: await ctx.db.query("contactPermissions").collect() }));
      expect(after.permissions.filter((p) => p.recipient.id === existing)).toHaveLength(0);
      expect(after.messages.find((m) => m.customerId === existing)).toMatchObject({ status: "not_sent" });
    } finally {
      delete process.env.EMAIL_PROVIDER;
    }
  });

  it("sends a finish-your-booking reminder only with recorded permission for marketing email", async () => {
    process.env.EMAIL_PROVIDER = "mock";
    try {
      const s = await setup();
      await publish(s.as, s.companyId, s.experienceId);
      await s.as.mutation(api.compliance.updateMessaging, { companyId: s.companyId, emailFromAddress: "hello@alpha.example", quietHours: null });
      const sessionOf = async (email: string) => s.t.run(async (ctx) => (await ctx.db.query("bookingSessions").collect()).find((x) => x.contact?.email === email)!._id);

      // A visitor with no customer record can't have given permission: nothing is sent and no record is made.
      const stranger = await begin(s, "walked-away");
      await contact(s.t, stranger, "new@example.com");
      const refused = await s.as.mutation(api.bookingExperiences.sendRecovery, { companyId: s.companyId, sessionId: await sessionOf("new@example.com") });
      expect(refused).toMatchObject({ status: "not_sent", problem: expect.stringContaining("marketing") });
      expect(await s.t.run(async (ctx) => (await ctx.db.query("customers").collect()).length)).toBe(0);

      // An existing customer without marketing permission: refused by the sending policy.
      const customerId = await s.as.mutation(api.customers.create, { companyId: s.companyId, name: "Dana Whitfield", kind: "home", email: "dana@example.com" });
      const known = await begin(s, "known");
      await contact(s.t, known, "dana@example.com");
      const blocked = await s.as.mutation(api.bookingExperiences.sendRecovery, { companyId: s.companyId, sessionId: await sessionOf("dana@example.com") });
      expect(blocked.status).toBe("not_sent");

      // With recorded permission it goes, once, and says how to stop.
      const third = await begin(s, "allowed");
      await contact(s.t, third, "lee@example.com");
      const leeId = await s.as.mutation(api.customers.create, { companyId: s.companyId, name: "Lee Park", kind: "home", email: "lee@example.com" });
      await s.t.run(async (ctx) => {
        await ctx.db.insert("contactPermissions", { companyId: s.companyId, recipient: { kind: "customer", id: leeId }, channel: "email", category: "marketing", status: "granted", source: "web_form", recordedBy: { kind: "system" }, at: Date.now() });
      });
      const sent = await s.as.mutation(api.bookingExperiences.sendRecovery, { companyId: s.companyId, sessionId: await sessionOf("lee@example.com") });
      expect(sent).toMatchObject({ status: "queued" });
      const messages = await s.t.run(async (ctx) => ctx.db.query("messages").collect());
      expect(messages.filter((m) => m.purpose === "booking_recovery" && m.status !== "not_sent")).toHaveLength(1);
      expect(messages.find((m) => m.customerId === leeId)!.body).toMatch(/reply "unsubscribe"/);
      void customerId;
    } finally {
      delete process.env.EMAIL_PROVIDER;
    }
  });

  it("asks again when a price-affecting answer changes after the price was accepted", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    await throughDetails(s, token);
    await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [{ id: "oven", quantity: 1 }], answers: {} });
    const v = await view(s.t, token);
    expect(v.states.quote).toBe("changed");
    expect(v.quote?.grandTotalCents).toBe(17500);
    const result = await s.t.mutation(api.bookingSessions.confirm, { token });
    expect(result).toMatchObject({ ok: false, blockers: expect.arrayContaining(["The price changed and needs to be accepted again."]) });
    expect(await s.t.run(async (ctx) => (await ctx.db.query("jobs").collect()).length)).toBe(0);
  });

  it("refuses a booking whose hold expired and whose time was taken", async () => {
    const s = await setup({ cleaners: 1 });
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s, "slow");
    const { slot } = await throughDetails(s, token);
    vi.setSystemTime(NOW + 20 * 60_000);
    const other = await begin(s, "fast");
    await contact(s.t, other, "fast@example.com");
    await s.t.mutation(api.bookingSessions.setHome, { token: other, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
    await s.t.mutation(api.bookingSessions.selectService, { token: other, serviceKey: s.serviceKey, addOns: [], answers: {} });
    expect(await s.t.mutation(api.bookingSessions.chooseTime, { token: other, startsAt: slot.startsAt })).toMatchObject({ ok: true });
    const result = await s.t.mutation(api.bookingSessions.confirm, { token });
    expect(result).toMatchObject({ ok: false });
    expect((await view(s.t, token)).states.capacity).toBe("expired");
  });
});

describe("a deposit through Finance and Stripe", () => {
  async function paidSetup() {
    const s = await setup();
    await connectStripe(s);
    await saveRules(s.as, s.companyId, { paymentPolicies: [{ id: "deposit", label: "25% deposit", kind: "deposit_percent", percent: 25, balanceTerms: "Invoiced after the visit." }] });
    await edit(s.as, s.companyId, s.experienceId, (def) => {
      def.behavior.paymentPolicyId = "deposit";
    });
    await publish(s.as, s.companyId, s.experienceId);
    return s;
  }

  it("charges the accepted deposit once, and confirms only when Stripe says it was received", async () => {
    const s = await paidSetup();
    const token = await begin(s);
    await throughDetails(s, token);
    const v = await view(s.t, token);
    expect(v.quote).toMatchObject({ grandTotalCents: 14000, dueNowCents: 3500, balanceCents: 10500 });
    const confirmed = await refusal(s.t.mutation(api.bookingSessions.confirm, { token }));
    expect(confirmed).toContain("needs its payment");

    const started = await s.t.mutation(api.bookingSessions.startPayment, { token, clientKey: "client-key-1-0000" });
    const repeat = await s.t.mutation(api.bookingSessions.startPayment, { token, clientKey: "client-key-1-0000" });
    expect(repeat).toEqual(started);
    const paymentId = (started as { paymentId: Id<"payments"> }).paymentId;
    await settle(s.t);
    const attempt = await s.t.query(api.bookingSessions.paymentAttempt, { token, paymentId });
    expect(attempt).toMatchObject({ status: "awaiting_customer", amountCents: 3500 });
    expect(attempt?.clientSecret).toMatch(/_secret_/);
    const [intent] = stripe.intentsFor(paymentId);
    expect(intent.amount).toBe(3500);

    // Returning from the card form proves nothing; only Stripe's answer does.
    await s.t.mutation(api.bookingSessions.paymentReturned, { token, paymentId });
    await settle(s.t);
    expect((await view(s.t, token)).status).toBe("active");

    stripe.settle(intent.id, "succeeded");
    const event = { id: "evt_book_1", type: "payment_intent.succeeded", account: [...stripe.state.accounts.keys()][0], livemode: false, data: { object: { id: intent.id, object: "payment_intent" } } };
    await webhook(s.t, event);
    await webhook(s.t, event);
    await settle(s.t);
    const after = await view(s.t, token);
    expect(after.status).toBe("confirmed");
    expect(after.states.payment).toBe("succeeded");
    const records = await s.t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), invoices: await ctx.db.query("invoices").collect() }));
    expect(records.jobs).toHaveLength(1);
    expect(records.invoices).toHaveLength(1);
    expect(records.invoices[0]).toMatchObject({ depositCents: 3500, jobId: records.jobs[0]._id, status: "open" });
    expect(records.invoices[0].totals).toMatchObject({ totalCents: 14000, paidCents: 3500, balanceCents: 10500 });
  });

  const succeeded = (s: Setup, intentId: string, id: string) => webhook(s.t, { id, type: "payment_intent.succeeded", account: [...stripe.state.accounts.keys()][0], livemode: false, data: { object: { id: intentId, object: "payment_intent" } } });

  it("keeps what was paid for: nothing priced can change once the money is in, and finishing the details confirms it", async () => {
    const s = await paidSetup();
    await edit(s.as, s.companyId, s.experienceId, (def) => {
      def.behavior.detailsTiming = "after_payment";
    });
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s, "details-later");
    await contact(s.t, token);
    await s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
    await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [], answers: {} });
    const slot = (await s.t.query(api.bookingSessions.slots, { token, date: TUESDAY }))!.find((x) => x.available)!;
    await s.t.mutation(api.bookingSessions.chooseTime, { token, startsAt: slot.startsAt });
    const v = await view(s.t, token);
    await s.t.mutation(api.bookingSessions.acceptQuote, { token, inputHash: v.quote!.inputHash, grandTotalCents: v.quote!.grandTotalCents! });
    const started = await s.t.mutation(api.bookingSessions.startPayment, { token, clientKey: "client-key-lock-000" });
    await settle(s.t);
    const [intent] = stripe.intentsFor((started as { paymentId: Id<"payments"> }).paymentId);
    stripe.settle(intent.id, "succeeded");
    await succeeded(s, intent.id, "evt_lock");
    await settle(s.t);
    expect(await view(s.t, token)).toMatchObject({ status: "active", states: { payment: "succeeded" } });

    // A bigger clean, another size, another time or another ZIP would no longer match the $35 received.
    expect(await refusal(s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [{ id: "oven", quantity: 1 }], answers: {} }))).toContain("payment for this booking has been received");
    expect(await refusal(s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 4 }))).toContain("has been received");
    expect(await refusal(s.t.mutation(api.bookingSessions.chooseTime, { token, startsAt: slot.startsAt + HOUR }))).toContain("has been received");
    expect(await refusal(s.t.mutation(api.bookingSessions.setLocation, { token, postalCode: "78702" }))).toContain("has been received");

    await s.t.mutation(api.bookingSessions.setDetails, { token, address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" }, answers: { pets: "No pets", access: "Key under the mat" } });
    expect((await view(s.t, token)).status).toBe("confirmed");
    const records = await s.t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), invoices: await ctx.db.query("invoices").collect() }));
    expect(records.jobs).toHaveLength(1);
    expect(records.invoices[0].totals).toMatchObject({ totalCents: 14000, paidCents: 3500 });
  });

  it("cancels an unfinished card form when the choice changes, and never confirms against money paid for the old choice", async () => {
    const s = await paidSetup();
    const token = await begin(s, "changes-mind");
    await throughDetails(s, token);
    const started = await s.t.mutation(api.bookingSessions.startPayment, { token, clientKey: "client-key-change-0" });
    await settle(s.t);
    const oldPaymentId = (started as { paymentId: Id<"payments"> }).paymentId;
    const [intent] = stripe.intentsFor(oldPaymentId);

    await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [{ id: "oven", quantity: 1 }], answers: {} });
    await settle(s.t);
    expect(intent.status).toBe("canceled");
    const changed = await view(s.t, token);
    expect(changed.states.payment).toBe("pending");
    expect(changed.quote!.grandTotalCents).toBe(17500);

    // Even if the old $35 had gone through before the cancel reached Stripe, it doesn't confirm the $175 booking.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(oldPaymentId, { status: "succeeded" });
      await bookingPaymentChanged(ctx, (await ctx.db.get(oldPaymentId))!);
    });
    await settle(s.t);
    const after = await view(s.t, token);
    expect(after.status).toBe("needs_attention");
    const records = await s.t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), tasks: await ctx.db.query("tasks").collect() }));
    expect(records.jobs).toHaveLength(0);
    expect(records.tasks.find((task) => task.key?.startsWith("booking-recovery:"))?.nextAction ?? "").toMatch(/doesn't match/);
  });

  it("opens a visible recovery case when payment arrives after the hold ended and the time is gone", async () => {
    const s = await paidSetup();
    const token = await begin(s, "slow-payer");
    const { slot } = await throughDetails(s, token);
    const started = await s.t.mutation(api.bookingSessions.startPayment, { token, clientKey: "client-key-2-0000" });
    await settle(s.t);
    vi.setSystemTime(NOW + 2 * HOUR);
    // While the customer was away, the only cleaner took that time off: the time can't be committed now.
    await s.t.run(async (ctx) => {
      const cleaner = (await ctx.db.query("cleaners").first())!;
      await ctx.db.insert("timeOff", { companyId: s.companyId, cleanerId: cleaner._id, startsAt: slot.startsAt - HOUR, endsAt: slot.startsAt + 6 * HOUR, note: "Appointment" });
    });

    const [intent] = stripe.intentsFor((started as { paymentId: Id<"payments"> }).paymentId);
    stripe.settle(intent.id, "succeeded");
    await webhook(s.t, { id: "evt_late", type: "payment_intent.succeeded", account: [...stripe.state.accounts.keys()][0], livemode: false, data: { object: { id: intent.id, object: "payment_intent" } } });
    await settle(s.t);
    const after = await view(s.t, token);
    expect(after.status).toBe("needs_attention");
    expect(after.states.payment).toBe("succeeded");
    const records = await s.t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), tasks: await ctx.db.query("tasks").collect() }));
    expect(records.jobs).toHaveLength(0);
    expect(records.tasks.find((task) => task.key?.startsWith("booking-recovery:"))).toMatchObject({ agent: "sales", status: "open" });
  });

  it("never lets a test booking charge, create a visit or message anyone", async () => {
    const s = await paidSetup();
    const { token } = await s.as.mutation(api.bookingExperiences.startTest, { companyId: s.companyId, experienceId: s.experienceId });
    await s.t.mutation(api.bookingSessions.setLocation, { token, postalCode: "78701" });
    await throughDetails(s, token);
    expect(await refusal(s.t.mutation(api.bookingSessions.startPayment, { token, clientKey: "client-key-3-0000" }))).toContain("test booking");
    await s.t.mutation(api.bookingSessions.simulatePayment, { token });
    expect((await view(s.t, token)).status).toBe("confirmed");
    const records = await s.t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), messages: await ctx.db.query("messages").collect(), payments: await ctx.db.query("payments").collect() }));
    expect(records).toMatchObject({ jobs: [], messages: [], payments: [] });
    const live = await s.as.query(api.bookingExperiences.analytics, { companyId: s.companyId, experienceId: s.experienceId, days: 30 });
    expect(live.confirmed).toBe(0);
    const test = await s.as.query(api.bookingExperiences.analytics, { companyId: s.companyId, experienceId: s.experienceId, days: 30, test: true });
    expect(test.confirmed).toBe(1);
  });
});

describe("requests and other kinds", () => {
  it("sends a commercial walkthrough request to Sales without a visit, a hold or a payment", async () => {
    const commercial = homeSpec({ ...blankSpec("commercial"), name: "Office cleaning", summary: "Offices.", category: "commercial", pricing: { method: "custom_quote", fromCents: 25000, laborMinutes: null } });
    const s = await setup({ kind: "commercial", spec: commercial });
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    await contact(s.t, token);
    await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [], answers: {} });
    const v = await view(s.t, token);
    expect(v.request).toBe(true);
    expect(v.steps).not.toContain("size");
    await s.t.mutation(api.bookingSessions.setDetails, { token, address: { line1: "500 Main St", city: "Austin", region: "TX", postalCode: "78701" }, answers: { facility_type: "Office", operating_hours: "8 to 6 weekdays" } });
    await s.t.mutation(api.bookingSessions.sendRequest, { token });
    const records = await s.t.run(async (ctx) => ({ jobs: await ctx.db.query("jobs").collect(), tasks: await ctx.db.query("tasks").collect(), holds: await ctx.db.query("bookingHolds").collect() }));
    expect(records.jobs).toHaveLength(0);
    expect(records.holds).toHaveLength(0);
    expect(records.tasks.find((t) => t.key?.startsWith("booking-request:"))).toMatchObject({ agent: "sales" });
    expect((await view(s.t, token)).status).toBe("requested");
  });

  it("books a short-term rental turnover with beds from the size step", async () => {
    const str = homeSpec({ ...blankSpec("short_term_rental"), name: "Turnover", summary: "Between guests.", category: "short_term_rental", pricing: { method: "fixed", amountCents: 9000, laborMinutes: 120 }, str: { enabled: true, linenSetsPerBed: 1, setsPerLoad: 2, laundry: { location: "on_site", loadCents: 1500, loadMinutes: 15, maxLoads: 4 }, restock: [], checkoutTime: "11:00", checkinTime: "16:00", deepCleanEveryTurnovers: null, conditionCharges: [] } });
    const s = await setup({ kind: "short_term_rental", spec: str });
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    await contact(s.t, token);
    expect((await view(s.t, token)).size.beds).toBe(true);
    await s.t.mutation(api.bookingSessions.setHome, { token, beds: 4 });
    await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, addOns: [], answers: {} });
    const v = await view(s.t, token);
    expect(v.request).toBe(false);
    expect(v.quote?.outcome).toBe("firm");
    expect(v.quote!.grandTotalCents).toBeGreaterThan(9000);
  });

  it("sends a recurring schedule as a request, because recurring billing doesn't exist yet", async () => {
    const recurring = homeSpec({ modifiers: { ...blankSpec("residential").modifiers, recurring: { enabled: true, options: [{ schedule: "every_14_days", discount: { kind: "percent", value: 10 } }] } } });
    const s = await setup({ spec: recurring });
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    await contact(s.t, token);
    await s.t.mutation(api.bookingSessions.setHome, { token, bedrooms: 2, bathrooms: 1, halfBaths: 0 });
    const offer = (await view(s.t, token)).offers[0];
    expect(offer.frequencies).toEqual([{ schedule: "every_14_days", label: expect.any(String), discount: "10% off each visit" }]);
    await s.t.mutation(api.bookingSessions.selectService, { token, serviceKey: s.serviceKey, schedule: "every_14_days", addOns: [], answers: {} });
    const v = await view(s.t, token);
    expect(v.request).toBe(true);
    expect(v.requestWords).toContain("set up by the team");
  });
});

describe("private links", () => {
  it("ends a link when it expires or is revoked, and never answers another session", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    expect((await s.t.query(api.bookingSessions.view, { token: `${token.slice(0, -2)}xx` })).ended).toBe(true);
    const sessionId = await s.t.run(async (ctx) => (await ctx.db.query("bookingSessions").first())!._id);
    await s.as.mutation(api.bookingExperiences.revokeLink, { companyId: s.companyId, sessionId });
    expect((await s.t.query(api.bookingSessions.view, { token })).ended).toBe(true);
    expect(await refusal(s.t.mutation(api.bookingSessions.setContact, { token, firstName: "A", lastName: "B", email: "a@example.com", phone: "5125550100", textOk: false }))).toContain("ended");

    const second = await begin(s, "visitor-9");
    vi.setSystemTime(NOW + 8 * 24 * HOUR);
    expect((await s.t.query(api.bookingSessions.view, { token: second })).ended).toBe(true);
  });

  it("keeps a session on the version it started with when a new one is published, and stops it when the page closes", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    const token = await begin(s);
    await edit(s.as, s.companyId, s.experienceId, (def) => {
      def.steps[0].copy.title = "Version two words";
    });
    await publish(s.as, s.companyId, s.experienceId);
    const v = await view(s.t, token);
    expect(v.definition.steps[0].copy.title).not.toBe("Version two words");
    await s.as.mutation(api.bookingExperiences.unpublish, { companyId: s.companyId, experienceId: s.experienceId });
    await throughDetails(s, token).catch(() => undefined);
    const closed = await view(s.t, token);
    expect(closed.blockers).toContain("This booking page has been closed. Please contact the company.");
  });

  it("starts only through Selestial's server, and limits how many a visitor can start", async () => {
    const s = await setup();
    await publish(s.as, s.companyId, s.experienceId);
    const slug = (await s.as.query(api.bookingExperiences.get, { companyId: s.companyId, experienceId: s.experienceId })).experience.slug;
    expect(await refusal(s.t.mutation(api.bookingPublic.start, { secret: "wrong", handle: "alpha-clean", slug, postalCode: "78701", attribution, visitorKey: "x" }))).toBe("Not found.");
    let refused = null;
    for (let i = 0; i < 14; i += 1) {
      const r = await s.t.mutation(api.bookingPublic.start, { secret: SECRET, handle: "alpha-clean", slug, postalCode: "78701", attribution, visitorKey: "same" });
      if ("refused" in r) refused = r.refused;
    }
    expect(refused).toContain("Too many");
    const session = await s.t.run(async (ctx) => (await ctx.db.query("bookingSessions").first())!);
    expect(session.attribution).toEqual({ source: "google", medium: "cpc", campaign: "spring", referrer: "www.google.com", landing: "/b/alpha-clean/home" });
  });
});
