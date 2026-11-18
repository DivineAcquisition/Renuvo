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
async function throughDetails(s: Setup, token: string, options: { addOns?: { id: string; quantity: number }[] } = {}) {
  await contact(s.t, token);
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
