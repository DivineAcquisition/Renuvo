import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, JOB_END, JOB_START, NOW, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mockChat } from "./lib/chat/model";
import { blankSpec, type Spec } from "./lib/services/spec";

vi.mock("./lib/services/webResearch", () => ({
  ResearchError: class ResearchError extends Error {},
  searchAndWrite: vi.fn(async () => ({
    text: '```json\n{"sources":[{"url":"https://a.example/pricing","title":"A Clean","publisher":"A Clean","geography":"Austin","excerpt":"Standard clean from $129","limitation":"Starting price"},{"url":"https://invented.example/x","title":"Invented","geography":"Austin","excerpt":"","limitation":""}],"findings":[{"statement":"A Clean advertises standard cleans from $129.","basis":"advertised_starting","sourceUrls":["https://a.example/pricing"],"geography":"Austin","scope":"Standard clean, 2 bed","limitation":"Starting price","priceDollars":129,"unit":"per visit","comparable":true},{"statement":"Competitors earn a 50% margin.","basis":"firm_published","sourceUrls":["https://invented.example/x"],"geography":"Austin","scope":"","limitation":"","priceDollars":null,"unit":"","comparable":false}],"summary":{"found":["One advertised starting price."],"comparable":["A Clean\'s standard clean"],"uncertain":["Only one business showed a price."],"options":[{"label":"Hold your price","tradeoff":"One source is not a market."}]}}\n```',
    pages: [{ url: "https://a.example/pricing", title: "A Clean pricing", pageAge: null }],
    usage: { inputTokens: 1000, outputTokens: 500 },
    model: "claude-sonnet-5-5",
  })),
}));

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const notice = { required: false, note: "" };

/** A complete home service priced by bedrooms and bathrooms. */
function readySpec(patch: Partial<Spec> = {}): Spec {
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

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  return { t, ...owner };
}

type As = Awaited<ReturnType<typeof setup>>["as"];

/** Drafts, submits, approves and publishes a spec. Answers with the service and change. */
async function publishNew(as: As, companyId: Id<"companies">, spec: Spec) {
  const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: spec.category, spec, origin: "manual" });
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Launch it.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  return { serviceId, changeId };
}

/** Opens a draft of the live version, writes `spec` into it, and publishes it. */
async function publishUpdate(as: As, companyId: Id<"companies">, serviceId: Id<"services">, spec: Spec) {
  const { revision } = await as.mutation(api.services.editLive, { companyId, serviceId });
  const saved = await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: revision, spec, step: "review" });
  if (!saved.ok) throw new Error("conflict");
  const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: saved.revision, reason: "Update.", customerNotice: notice, contractReview: notice });
  const change = await as.query(api.services.change, { companyId, changeId });
  await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
  return changeId;
}

async function place(as: As, companyId: Id<"companies">) {
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home" });
  const propertyId = await as.mutation(api.properties.create, { companyId, customerId, kind: "home", address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" } });
  return { customerId, propertyId };
}

describe("Services & Pricing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe("who may see and change what", () => {
    it("keeps each company's services to itself", async () => {
      const { t, as, companyId } = await setup();
      const other = await company(t, "owner-b", "Beta Cleaning");
      const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
      expect(await refusal(other.as.query(api.services.service, { companyId: other.companyId, serviceId }))).toBe("Not found.");
      expect(await refusal(other.as.mutation(api.services.saveDraft, { companyId: other.companyId, serviceId, expectedRevision: 1, spec: readySpec({ name: "Hijack" }), step: "basics" }))).toBe("Not found.");
      expect(await refusal(other.as.query(api.services.service, { companyId, serviceId }))).not.toBe("");
      expect((await other.as.query(api.services.catalog, { companyId: other.companyId })).services).toEqual([]);
    });

    it("lets Managers draft and submit, and only the Owner approve and publish", async () => {
      const { t, as, companyId } = await setup();
      const office = await addMember(t, as, companyId, "office-a", "office");
      const manager = await addMember(t, as, companyId, "manager-a", "manager");
      expect(await refusal(office.mutation(api.services.startDraft, { companyId, category: "residential", origin: "manual" }))).toBe("Not allowed.");
      const { serviceId } = await manager.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
      const { changeId } = await manager.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "New service.", customerNotice: notice, contractReview: notice });
      const change = await manager.query(api.services.change, { companyId, changeId });
      expect(await refusal(manager.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true }))).toBe("Not allowed.");
      expect((await office.query(api.services.catalog, { companyId })).services[0]).toMatchObject({ status: "draft", openChange: { state: "in_review" } });
      await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
      const catalog = await office.query(api.services.catalog, { companyId });
      expect(catalog.services[0]).toMatchObject({ status: "active", live: { version: 1 }, draft: null, openChange: null });
      expect(catalog.canDraft).toBe(false);
    });

    it("keeps costs and profitability to the Owner, like pay", async () => {
      const { t, as, companyId } = await setup();
      const manager = await addMember(t, as, companyId, "manager-a", "manager");
      const { serviceId } = await publishNew(as, companyId, readySpec());
      const profile = await as.query(api.services.profile, { companyId });
      await as.mutation(api.services.saveProfile, { companyId, expectedRevision: profile.revision, context: profile.context, costs: { ...profile.costs!, pay: { model: "hourly", hourlyCents: 2000, burdenPercent: 10 }, suppliesPerVisitCents: 800 }, strategy: "cost_plus", positioning: "standard", researchDuringSetup: false });
      expect((await manager.query(api.services.profile, { companyId })).costs).toBeNull();
      expect(await refusal(manager.mutation(api.services.saveProfile, { companyId, expectedRevision: 1, context: profile.context, costs: profile.costs!, strategy: null, positioning: null, researchDuringSetup: false }))).toBe("Not allowed.");
      const input = { bedrooms: 3, bathrooms: 2 };
      expect((await manager.query(api.services.quote, { companyId, serviceId, input, from: "live" })).profit).toBeNull();
      const forOwner = await as.query(api.services.quote, { companyId, serviceId, input, from: "live" });
      expect(forOwner.quote.totalCents).toBe(12000 + 2 * 2000 + 2500);
      expect(forOwner.profit?.costs.find((c) => c.key === "labor")).toBeDefined();
    });
  });

  describe("drafts", () => {
    it("autosaves with a revision, refuses a stale save, and says who saved", async () => {
      const { t, as, companyId } = await setup();
      const manager = await addMember(t, as, companyId, "manager-a", "manager");
      const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
      const mine = await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 1, spec: readySpec({ name: "Standard home clean" }), step: "pricing" });
      expect(mine).toMatchObject({ ok: true, revision: 2, changed: true });
      const theirs = await manager.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 1, spec: readySpec({ name: "Overwrite" }), step: "basics" });
      expect(theirs).toMatchObject({ ok: false, conflict: { revision: 2, by: "owner-a" } });
      // Nothing was lost, and the builder reopens where it was left.
      const view = await manager.query(api.services.service, { companyId, serviceId });
      expect(view.draft).toMatchObject({ revision: 2, step: "pricing", spec: { name: "Standard home clean" } });
      // Saving the same content again writes nothing.
      expect(await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 2, spec: readySpec({ name: "Standard home clean" }), step: "pricing" })).toMatchObject({ ok: true, revision: 2, changed: false });
    });

    it("refuses malformed amounts before anything is saved", async () => {
      const { as, companyId } = await setup();
      const bad = readySpec({ pricing: { method: "fixed", amountCents: 12.5, laborMinutes: 60 } });
      expect(await refusal(as.mutation(api.services.startDraft, { companyId, category: "residential", spec: bad, origin: "manual" }))).toContain("whole number");
    });

    it("will not submit a service with blockers: overlapping bands or unconfirmed illustrative amounts", async () => {
      const { as, companyId } = await setup();
      const overlap = readySpec({ pricing: { method: "size_bands", unit: "sq_ft", bands: [{ from: 0, to: 1500, amountCents: 100, laborMinutes: 60 }, { from: 1000, to: 2000, amountCents: 200, laborMinutes: 90 }] } });
      const a = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: overlap, origin: "manual" });
      expect(await refusal(as.mutation(api.services.submit, { companyId, serviceId: a.serviceId, expectedRevision: 1, reason: "x", customerNotice: notice, contractReview: notice }))).toContain("overlap");
      const b = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec({ name: "From a template", illustrative: true }), origin: "template" });
      expect(await refusal(as.mutation(api.services.submit, { companyId, serviceId: b.serviceId, expectedRevision: 1, reason: "x", customerNotice: notice, contractReview: notice }))).toContain("illustrative");
    });
  });

  describe("review and approval", () => {
    it("returns a submitted change when its draft is edited, so an approval never covers older content", async () => {
      const { as, companyId } = await setup();
      const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
      const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "New.", customerNotice: notice, contractReview: notice });
      const before = await as.query(api.services.change, { companyId, changeId });
      expect(await refusal(as.mutation(api.services.approve, { companyId, changeId, hash: "not-the-hash", publish: false }))).toContain("different from the one you reviewed");
      await as.mutation(api.services.approve, { companyId, changeId, hash: before.hash, publish: false });
      await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 1, spec: readySpec({ summary: "Changed after approval." }), step: "review" });
      const after = await as.query(api.services.change, { companyId, changeId });
      expect(after.state).toBe("returned");
      expect(after.closedReason).toContain("edited after it was submitted");
      expect(await refusal(as.mutation(api.services.publish, { companyId, changeId, hash: before.hash }))).toBe("This change cannot be published now.");
      expect((await as.query(api.services.service, { companyId, serviceId })).live).toBeNull();
    });

    it("refuses to approve over a live version that moved since submission", async () => {
      const { t, as, companyId } = await setup();
      const { serviceId } = await publishNew(as, companyId, readySpec());
      await as.mutation(api.services.editLive, { companyId, serviceId });
      await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 1, spec: readySpec({ summary: "Version two." }), step: "review" });
      const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 2, reason: "Two.", customerNotice: notice, contractReview: notice });
      await t.run(async (ctx) => {
        await ctx.db.patch(serviceId, { publishedVersion: 9 });
      });
      const change = await as.query(api.services.change, { companyId, changeId });
      expect(change.liveMoved).toBe(true);
      expect(await refusal(as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true }))).toContain("live version changed");
    });

    it("publishes on its start date, and not at all if the draft moved first", async () => {
      const { t, as, companyId } = await setup();
      const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
      const later = NOW + 3 * 24 * 60 * 60 * 1000;
      const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "From Thursday.", customerNotice: notice, contractReview: notice, effectiveAt: later });
      const change = await as.query(api.services.change, { companyId, changeId });
      expect(await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true })).toEqual({ state: "scheduled" });
      expect((await as.query(api.services.service, { companyId, serviceId })).live).toBeNull();
      await settle(t);
      expect((await as.query(api.services.service, { companyId, serviceId })).live?.version).toBe(1);
      expect((await as.query(api.services.change, { companyId, changeId })).state).toBe("published");

      // A second scheduled change, then an edit: the edit cancels it and nothing goes live.
      await as.mutation(api.services.editLive, { companyId, serviceId });
      await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 1, spec: readySpec({ summary: "Two." }), step: "review" });
      const second = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 2, reason: "Later.", customerNotice: notice, contractReview: notice, effectiveAt: Date.now() + 24 * 60 * 60 * 1000 });
      const secondChange = await as.query(api.services.change, { companyId, changeId: second.changeId });
      await as.mutation(api.services.approve, { companyId, changeId: second.changeId, hash: secondChange.hash, publish: true });
      await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 2, spec: readySpec({ summary: "Three." }), step: "review" });
      await settle(t);
      expect((await as.query(api.services.change, { companyId, changeId: second.changeId })).state).toBe("returned");
      expect((await as.query(api.services.service, { companyId, serviceId })).live?.version).toBe(1);
    });

    it("rolls back by writing a new version based on the old one, keeping history", async () => {
      const { as, companyId } = await setup();
      const { serviceId } = await publishNew(as, companyId, readySpec());
      await publishUpdate(as, companyId, serviceId, readySpec({ pricing: { ...(readySpec().pricing as Extract<Spec["pricing"], { method: "bed_bath" }>), baseCents: 15000 } }));
      await as.mutation(api.services.startRollback, { companyId, serviceId, version: 1, replaceDraft: false });
      const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Back to the old price.", customerNotice: notice, contractReview: notice });
      const change = await as.query(api.services.change, { companyId, changeId });
      await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
      const view = await as.query(api.services.service, { companyId, serviceId });
      expect(view.versions.map((v) => [v.version, v.source, v.basedOn, v.live])).toEqual([
        [3, "rollback", 1, true],
        [2, "draft", 1, false],
        [1, "draft", null, false],
      ]);
      expect(view.live?.spec).toEqual((await as.query(api.services.version, { companyId, serviceId, version: 1 })).spec);
    });

    it("lists the specialists' checks, with a structured edit a person can apply", async () => {
      const { as, companyId } = await setup();
      const spec = readySpec({ pricing: { method: "fixed", amountCents: 30000, laborMinutes: 600 }, team: { ...blankSpec().team, crewSize: 1, maxVisitMinutes: 240, maxCrew: 4 } });
      const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec, origin: "manual" });
      const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId, expectedRevision: 1, reason: "Big job.", customerNotice: notice, contractReview: notice });
      const change = await as.query(api.services.change, { companyId, changeId });
      const dispatch = change.agentNotes.find((note) => note.agent === "dispatch");
      expect(dispatch).toMatchObject({ status: "concern", suggestion: { field: "team.crewSize", value: 3 } });
      expect(change.agentNotes.find((note) => note.agent === "sales")?.status).toBe("unavailable");
      await as.mutation(api.services.applySuggestion, { companyId, serviceId, field: "team.crewSize", value: 3 });
      expect((await as.query(api.services.change, { companyId, changeId })).state).toBe("returned");
      expect((await as.query(api.services.service, { companyId, serviceId })).draft?.spec.team.crewSize).toBe(3);
    });
  });

  describe("visits keep what they were sold under", () => {
    it("prices a visit from the live version, stores the version and quote, and leaves it alone when prices change", async () => {
      const { as, companyId } = await setup();
      const { serviceId } = await publishNew(as, companyId, readySpec());
      const key = (await as.query(api.services.service, { companyId, serviceId })).service.key;
      const where = await place(as, companyId);
      const jobId = await as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, quoteInput: { bedrooms: 3, bathrooms: 2 }, expectedTotalCents: 18500, startsAt: JOB_START, endsAt: JOB_END });
      const first = (await as.query(api.jobs.get, { companyId, jobId })).job;
      expect(first.priceCents).toBe(18500);
      expect(first.serviceSnapshot).toMatchObject({ serviceId: key, version: 1, priceSource: "quote" });
      expect(first.scope).toContain("Wipe kitchen counters");

      await publishUpdate(as, companyId, serviceId, readySpec({ pricing: { ...(readySpec().pricing as Extract<Spec["pricing"], { method: "bed_bath" }>), baseCents: 14000 } }));
      const again = (await as.query(api.jobs.get, { companyId, jobId })).job;
      expect(again.priceCents).toBe(18500);
      expect(again.serviceSnapshot?.version).toBe(1);

      // The price the person saw is checked: an old screen cannot book at a new price unnoticed.
      expect(await refusal(as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, quoteInput: { bedrooms: 3, bathrooms: 2 }, expectedTotalCents: 18500, startsAt: JOB_START + 86_400_000, endsAt: JOB_END + 86_400_000 }))).toContain("The price is now $205.00");
      const next = await as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, quoteInput: { bedrooms: 3, bathrooms: 2 }, startsAt: JOB_START + 86_400_000, endsAt: JOB_END + 86_400_000 });
      expect((await as.query(api.jobs.get, { companyId, jobId: next })).job.serviceSnapshot?.version).toBe(2);
    });

    it("asks for what the price needs, and sends a walkthrough job to a typed price", async () => {
      const { as, companyId } = await setup();
      const spec = readySpec({ questions: [{ id: "pets", label: "Pets", kind: "number", required: false, options: [], walkthroughIf: { atLeast: 4 } }] });
      const { serviceId } = await publishNew(as, companyId, spec);
      const key = (await as.query(api.services.service, { companyId, serviceId })).service.key;
      const where = await place(as, companyId);
      expect(await refusal(as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, quoteInput: { bedrooms: 3 }, startsAt: JOB_START, endsAt: JOB_END }))).toContain("Bathrooms");
      expect(await refusal(as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, quoteInput: { bedrooms: 3, bathrooms: 2, answers: { pets: 5 } }, startsAt: JOB_START, endsAt: JOB_END }))).toContain("walkthrough");
      const typed = await as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, priceCents: 31000, startsAt: JOB_START, endsAt: JOB_END });
      expect((await as.query(api.jobs.get, { companyId, jobId: typed })).job).toMatchObject({ priceCents: 31000, serviceSnapshot: { priceSource: "manual", version: 1 } });
    });

    it("refuses an archived service for new visits and keeps booked ones", async () => {
      const { as, companyId } = await setup();
      const { serviceId } = await publishNew(as, companyId, readySpec({ pricing: { method: "fixed", amountCents: 10000, laborMinutes: 90 } }));
      const key = (await as.query(api.services.service, { companyId, serviceId })).service.key;
      const where = await place(as, companyId);
      const booked = await as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, startsAt: JOB_START, endsAt: JOB_END });
      const { changeId } = await as.mutation(api.services.requestArchive, { companyId, serviceId, reason: "No longer offered." });
      const change = await as.query(api.services.change, { companyId, changeId });
      await as.mutation(api.services.approve, { companyId, changeId, hash: change.hash, publish: true });
      expect(await refusal(as.mutation(api.jobs.create, { companyId, ...where, serviceId: key, startsAt: JOB_START + 86_400_000, endsAt: JOB_END + 86_400_000 }))).toContain("archived");
      expect((await as.query(api.jobs.get, { companyId, jobId: booked })).job.priceCents).toBe(10000);
    });
  });

  describe("moving out of Settings", () => {
    it("copies Settings services into the one catalog once, keeping their keys so visits still find them", async () => {
      const { t, as, companyId } = await setup();
      await t.run(async (ctx) => {
        await ctx.db.patch(companyId, { businessSettings: { services: [{ id: "deep-clean", name: "Deep clean", scope: "Top to bottom", durationMinutes: 180, defaultCrew: 2, skills: ["deep"], startingPriceCents: 25000, status: "active" }, { id: "old-one", name: "Old service", scope: "Gone", durationMinutes: 60, defaultCrew: 1, skills: [], status: "archived" }] } });
      });
      const where = await place(as, companyId);
      // Before the move the old list still serves visits.
      await as.mutation(api.jobs.create, { companyId, ...where, serviceId: "deep-clean", startsAt: JOB_START, endsAt: JOB_END });
      expect((await as.query(api.services.catalog, { companyId })).legacyWaiting).toBe(2);
      expect(await as.mutation(api.services.migrateFromSettings, { companyId })).toEqual({ migrated: 2 });
      expect(await as.mutation(api.services.migrateFromSettings, { companyId })).toEqual({ migrated: 0 });
      const catalog = await as.query(api.services.catalog, { companyId });
      expect(catalog.legacyWaiting).toBe(0);
      expect(catalog.services.map((s) => [s.key, s.status, s.live?.version, s.live?.summary])).toEqual([
        ["deep-clean", "active", 1, "$250.00 per visit"],
        ["old-one", "archived", 1, "Priced after a walkthrough"],
      ]);
      const jobId = await as.mutation(api.jobs.create, { companyId, ...where, serviceId: "deep-clean", startsAt: JOB_START + 86_400_000, endsAt: JOB_END + 86_400_000 });
      expect((await as.query(api.jobs.get, { companyId, jobId })).job).toMatchObject({ priceCents: 25000, requiredCrew: 2, serviceSnapshot: { version: 1, priceSource: "quote" } });
    });
  });

  describe("Company Chat works on the same draft", () => {
    beforeEach(() => {
      process.env.CHAT_MODEL = "mock";
      mockChat.script = [];
      mockChat.seen = [];
      mockChat.onRespond = null;
    });
    afterEach(() => {
      delete process.env.CHAT_MODEL;
    });

    it("edits the draft the workspace shows, wins over a stale screen without overwriting it, and submits only after the person approves", async () => {
      const { t, as, companyId } = await setup();
      const { serviceId } = await as.mutation(api.services.startDraft, { companyId, category: "residential", spec: readySpec(), origin: "manual" });
      mockChat.script = [
        { toolCalls: [{ name: "edit_service_draft", input: { service: "Standard clean", changes: { addIncluded: [{ label: "Inside the microwave", section: "Kitchen" }], pricing: { method: "bed_bath", baseCents: 13000 } } } }] },
        { text: "Added the microwave and set the base to $130." },
      ];
      const sent = await as.mutation(api.chat.send, { companyId, text: "Add inside the microwave and make the base $130.", clientKey: "svc-1" });
      await settle(t);
      const view = await as.query(api.services.service, { companyId, serviceId });
      expect(view.draft).toMatchObject({ revision: 2, by: "Selestial, asked by owner-a in Chat", spec: { pricing: { method: "bed_bath", baseCents: 13000 } } });
      expect(view.draft?.spec.included.map((i) => i.label)).toContain("Inside the microwave");
      // The workspace tab was open at revision 1: its autosave is refused and says who saved.
      const stale = await as.mutation(api.services.saveDraft, { companyId, serviceId, expectedRevision: 1, spec: readySpec({ name: "Typed in the tab" }), step: "basics" });
      expect(stale).toMatchObject({ ok: false, conflict: { revision: 2, by: "Selestial, asked by owner-a in Chat" } });

      mockChat.script = [{ toolCalls: [{ name: "submit_service_for_review", input: { service: "Standard clean", reason: "New microwave task and price." } }] }];
      const again = await as.mutation(api.chat.send, { companyId, text: "Submit it.", clientKey: "svc-2", conversationId: sent.conversationId });
      await settle(t);
      const chat = await as.query(api.chat.thread, { companyId, conversationId: again.conversationId });
      const step = Object.values(chat.steps).find((s) => (s as { tool: string }).tool === "submit_service_for_review") as { stepId: string; status: string };
      expect(step.status).toBe("awaiting_approval");
      expect((await as.query(api.services.changes, { companyId })).changes).toEqual([]);
      await as.mutation(api.chat.decideStep, { companyId, stepId: step.stepId, approve: true });
      const changes = (await as.query(api.services.changes, { companyId })).changes;
      expect(changes).toMatchObject([{ state: "in_review", version: 1 }]);
      // Chat never publishes: that stays the Owner's act in the workspace.
      expect((await as.query(api.services.service, { companyId, serviceId })).live).toBeNull();
      expect(mockChat.seen[0].tools).not.toContain("publish_service");
    });

    it("proposes a property's own price only after the person approves, quotes with it once the Owner approves, and never approves it itself", async () => {
      const { t, as, companyId } = await setup();
      const { serviceId } = await publishNew(as, companyId, readySpec());
      const where = await place(as, companyId);
      const manager = await addMember(t, as, companyId, "manager-a", "manager");
      const input = { service: "Standard clean", propertyId: where.propertyId, baseCents: 18500, endsAfter: "2027-06-30", reason: "Walkthrough on Feb 26." };
      mockChat.script = [{ toolCalls: [{ name: "propose_property_price", input }] }, { text: "Sent to the Owner." }];
      const sent = await manager.mutation(api.chat.send, { companyId, text: "Give 12 Elm St its own price of $185 until the end of June.", clientKey: "pp-1" });
      await settle(t);
      const chat = await manager.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
      const step = Object.values(chat.steps).find((s) => (s as { tool: string }).tool === "propose_property_price") as { stepId: string; status: string; preview?: { summary: string; lines: string[] } };
      expect(step.status).toBe("awaiting_approval");
      expect(step.preview?.summary).toBe("Propose $185.00 as 12 Elm St, Austin's own base price for Standard clean");
      expect(step.preview?.lines.join(" ")).toContain("After June 30, 2027, the property pays the service's price again.");
      expect((await as.query(api.services.changes, { companyId })).changes.filter((c) => c.kind === "property_price")).toEqual([]);
      await manager.mutation(api.chat.decideStep, { companyId, stepId: step.stepId, approve: true });
      await settle(t);
      const [change] = (await as.query(api.services.changes, { companyId })).changes.filter((c) => c.kind === "property_price");
      expect(change).toMatchObject({ state: "in_review", title: "Own price for 12 Elm St, Austin" });
      // Chat has no tool to approve it: the Owner does, in Changes.
      expect(mockChat.seen[0].tools).not.toContain("approve_property_price");
      const review = await as.query(api.services.change, { companyId, changeId: change.id });
      expect(review.evidence).toEqual([expect.objectContaining({ label: "Proposed in Chat" })]);
      await as.mutation(api.services.approve, { companyId, changeId: change.id, hash: review.hash, publish: true });

      // Quoting at the property uses its own approved price; a price the model makes up is refused as input.
      mockChat.script = [
        { toolCalls: [{ name: "quote_service", input: { service: "Standard clean", propertyId: where.propertyId, input: { bedrooms: 2, bathrooms: 1, propertyPrice: { baseCents: 100 } } } }] },
        { toolCalls: [{ name: "quote_service", input: { service: "Standard clean", propertyId: where.propertyId, input: { bedrooms: 2, bathrooms: 1 } } }] },
        { text: "$185." },
      ];
      await as.mutation(api.chat.send, { companyId, text: "What does a clean at 12 Elm St cost?", clientKey: "pp-2" });
      await settle(t);
      const results = (mockChat.seen.at(-1)!.messages as { role: string; content: { type: string; content?: string }[] | string }[])
        .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
        .filter((c) => c.type === "tool_result")
        .map((c) => JSON.parse(c.content!));
      expect(results[0]).toMatchObject({ status: "invalid_input", why: "input.input.propertyPrice is not expected." });
      expect(results[1].summary).toBe("Standard clean: $185.00 per visit");
      expect(results[1].result.propertyPrice).toBe("12 Elm St, Austin has its own base price of $185.00, approved by the Owner (ends after June 30, 2027).");
      expect(results[1].result.lines[0]).toMatchObject({ label: "Base price for this property", amountCents: 18500 });
      expect((await as.query(api.services.service, { companyId, serviceId })).live?.version).toBe(1);
    });

    it("gives every reply the business, the person and where the conversation started, even after its first messages scroll away", async () => {
      const { t, as, companyId } = await setup();
      await publishNew(as, companyId, readySpec());
      const profile = await as.query(api.services.profile, { companyId });
      await as.mutation(api.services.saveProfile, { companyId, expectedRevision: 0, context: { ...profile.context, serviceAreas: "Austin, TX", customerKinds: ["home"], teamStructure: "one_crew" }, costs: { ...profile.costs!, suppliesPerVisitCents: 800, targetMarginPercent: 40 }, strategy: "positioning", positioning: "premium", researchDuringSetup: false, completeSetup: true });
      mockChat.script = [{ text: "Happy to look into it." }, { text: "Still on it." }];
      const sent = await as.mutation(api.chat.send, { companyId, text: "What do businesses near me charge for move-out cleans?", clientKey: "ctx-1", origin: { kind: "research" } });
      await settle(t);
      const first = mockChat.seen[0].system;
      expect(first).toContain("<business>");
      expect(first).toContain("Areas served: Austin, TX");
      expect(first).toContain("Standard clean (Residential, version 1): From $120.00 per visit, by bedrooms and bathrooms");
      expect(first).toContain("Team: one crew");
      expect(first).toContain("Pricing approach: positioning-led, premium positioning");
      expect(first).toContain("supplies entered");
      expect(first).toContain("<person>\n- owner-a, the company's owner");
      expect(first).toContain('with the question: "What do businesses near me charge for move-out cleans?"');
      // Amounts stay out of the prompt; the Owner's own margin targets are given to the Owner only.
      expect(first).not.toContain("$8.00");
      expect(first).toContain("target 40%");

      // Forty-four more messages push the first question out of the window the model reads.
      await t.run(async (ctx) => {
        const conversation = (await ctx.db.get(sent.conversationId as Id<"conversations">))!;
        const last = await ctx.db
          .query("chatMessages")
          .withIndex("by_company_conversation_seq", (q) => q.eq("companyId", companyId).eq("conversationId", conversation._id))
          .order("desc")
          .first();
        for (let i = 1; i <= 44; i++) await ctx.db.insert("chatMessages", { companyId, conversationId: conversation._id, seq: last!.seq + i, role: i % 2 ? "user" : "assistant", status: "complete", ...(i % 2 ? { text: `Filler question ${i}` } : { parts: [{ kind: "text" as const, text: `Filler answer ${i}` }] }), createdAt: Date.now() });
      });
      await as.mutation(api.chat.send, { companyId, text: "Where were we?", clientKey: "ctx-2", conversationId: sent.conversationId });
      await settle(t);
      const later = mockChat.seen[1];
      expect(JSON.stringify(later.messages)).not.toContain("move-out cleans");
      expect(later.system).toContain('with the question: "What do businesses near me charge for move-out cleans?"');
      expect(later.system).toContain("Areas served: Austin, TX");
    });

    it("keeps a Manager's prompt free of the Owner's margins", async () => {
      const { t, as, companyId } = await setup();
      const profile = await as.query(api.services.profile, { companyId });
      await as.mutation(api.services.saveProfile, { companyId, expectedRevision: 0, context: { ...profile.context, serviceAreas: "Austin, TX" }, costs: { ...profile.costs!, targetMarginPercent: 40 }, strategy: null, positioning: null, researchDuringSetup: false });
      const manager = await addMember(t, as, companyId, "manager-a", "manager");
      mockChat.script = [{ text: "Sure." }];
      await manager.mutation(api.chat.send, { companyId, text: "Hello", clientKey: "ctx-m" });
      await settle(t);
      expect(mockChat.seen[0].system).toContain("manager-a, the company's manager");
      expect(mockChat.seen[0].system).not.toContain("target 40%");
    });

    it("starts research only after the person approves, and tells the conversation when it is ready", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      try {
        const { t, as, companyId } = await setup();
        const profile = await as.query(api.services.profile, { companyId });
        await as.mutation(api.services.saveProfile, { companyId, expectedRevision: 0, context: { ...profile.context, serviceAreas: "Austin, TX" }, costs: profile.costs!, strategy: null, positioning: null, researchDuringSetup: false });
        mockChat.script = [{ toolCalls: [{ name: "start_research", input: { question: "What do businesses near me charge for a standard clean?", web: true } }] }, { text: "Started. I'll let you know." }, { text: "Here is what it found." }];
        const sent = await as.mutation(api.chat.send, { companyId, text: "Research standard clean prices near me.", clientKey: "res-1", origin: { kind: "research" } });
        await settle(t);
        const chat = await as.query(api.chat.thread, { companyId, conversationId: sent.conversationId });
        const step = Object.values(chat.steps).find((s) => (s as { tool: string }).tool === "start_research") as { stepId: string; status: string; preview: { summary: string; lines: string[] } };
        expect(step.status).toBe("awaiting_approval");
        expect(step.preview.summary).toBe("Start web research (10 Selestial Credits)");
        expect(step.preview.lines).toContain("Where: Austin, TX");
        expect((await as.query(api.servicesResearch.briefs, { companyId })).briefs).toEqual([]);

        await as.mutation(api.chat.decideStep, { companyId, stepId: step.stepId, approve: true });
        await settle(t);
        const [brief] = (await as.query(api.servicesResearch.briefs, { companyId })).briefs;
        expect(brief).toMatchObject({ origin: "chat", state: "ready", geography: "Austin, TX" });
        const stored = await t.run((ctx) => ctx.db.get(brief.id as Id<"researchBriefs">));
        expect(stored?.conversationId).toBe(sent.conversationId);
        const messages = await t.run((ctx) => ctx.db.query("chatMessages").collect());
        const ready = messages.find((m) => m.parts?.some((p) => p.kind === "text" && p.text.startsWith("**Research ready:**")));
        expect(ready?.conversationId).toBe(sent.conversationId);
        expect(JSON.stringify(ready?.parts)).toContain(`/app/services/research/${brief.id}`);

        // The next reply knows the brief this conversation started, and can read it.
        mockChat.script = [{ toolCalls: [{ name: "read_research_brief", input: { briefId: brief.id } }] }, { text: "One advertised starting price so far." }];
        await as.mutation(api.chat.send, { companyId, text: "What did it find?", clientKey: "res-2", conversationId: sent.conversationId });
        await settle(t);
        const last = mockChat.seen.at(-1)!;
        expect(last.system).toContain(`Research brief ${brief.id} started here`);
        expect(JSON.stringify(last.messages)).toContain("A Clean advertises standard cleans from $129.");
      } finally {
        delete process.env.ANTHROPIC_API_KEY;
      }
    });

    it("does not offer drafting tools to an Office member", async () => {
      const { t, as, companyId } = await setup();
      const office = await addMember(t, as, companyId, "office-a", "office");
      mockChat.script = [{ text: "Here is the catalog." }];
      await office.mutation(api.chat.send, { companyId, text: "What services do we sell?", clientKey: "svc-3" });
      await settle(t);
      const tools = mockChat.seen[0].tools;
      expect(tools).toEqual(expect.arrayContaining(["list_services", "read_service", "quote_service"]));
      expect(tools).not.toContain("edit_service_draft");
      expect(tools).not.toContain("submit_service_for_review");
      // Office reads research but does not start it.
      expect(tools).toContain("read_research_brief");
      expect(tools).not.toContain("start_research");
    });
  });

  describe("imports", () => {
    it("keeps a file it cannot read as a failed import with the reason, and creates nothing", async () => {
      const { as, companyId } = await setup();
      const empty = await as.mutation(api.servicesImports.create, { companyId, kind: "csv", name: "prices.csv", source: "   " });
      expect(empty).toMatchObject({ state: "failed", error: "The file or text was empty." });
      const binary = await as.mutation(api.servicesImports.create, { companyId, kind: "csv", name: "prices.xlsx", source: "PK\u0003\u0004\u0000\u0000binary" });
      expect(binary.error).toContain("CSV");
      const noNames = await as.mutation(api.servicesImports.create, { companyId, kind: "text", name: "notes", source: "We are a small team.\nCall us for prices." });
      expect(noNames.state).toBe("failed");
      expect((await as.query(api.services.catalog, { companyId })).services).toEqual([]);
    });

    it("drafts a reviewed row with its source attached, and never publishes it", async () => {
      const { as, companyId } = await setup();
      const { importId } = await as.mutation(api.servicesImports.create, { companyId, kind: "csv", name: "prices.csv", source: "Service,Price,Unit,Description\nStandard clean,$150,per visit,Kitchen and baths\nHelp,$60,per hour," });
      const read = await as.query(api.servicesImports.get, { companyId, importId });
      expect(read.rows[1].flagWords).toEqual(["Unit unclear", "No scope"]);
      const { serviceId } = await as.mutation(api.servicesImports.decide, { companyId, importId, rowId: read.rows[1].id, decision: "draft", method: "hourly_per_cleaner" });
      const view = await as.query(api.services.service, { companyId, serviceId: serviceId! });
      expect(view.live).toBeNull();
      expect(view.draft?.spec.pricing).toMatchObject({ method: "hourly_per_cleaner", rateCents: 6000 });
      expect(view.draft?.spec.illustrative).toBe(false);
      await as.mutation(api.servicesImports.decide, { companyId, importId, rowId: read.rows[0].id, decision: "skip" });
      expect((await as.query(api.servicesImports.get, { companyId, importId })).state).toBe("done");
      // The source travels into the review.
      await as.mutation(api.services.saveDraft, { companyId, serviceId: serviceId!, expectedRevision: 1, spec: { ...view.draft!.spec, summary: "Help by the hour.", included: [{ id: "tidy", label: "Tidy rooms", requiresPhoto: false }], excluded: ["Deep cleaning"] }, step: "review" });
      const { changeId } = await as.mutation(api.services.submit, { companyId, serviceId: serviceId!, expectedRevision: 2, reason: "Imported.", customerNotice: notice, contractReview: notice });
      const change = await as.query(api.services.change, { companyId, changeId });
      expect(change.evidence[0]).toMatchObject({ kind: "import", detail: "Row 3: Help, $60, per hour, " });
    });
  });

  describe("research", () => {
    it("builds a free brief from the team's sources and the company's records, with a range only from three comparable prices", async () => {
      const { as, companyId } = await setup();
      const source = (title: string, cents: number) => ({ title, geography: "Austin", excerpt: "", priceCents: cents, priceKind: "advertised_starting" as const, unit: "per visit", comparable: true, limitation: "" });
      const { briefId } = await as.mutation(api.servicesResearch.start, { companyId, question: "What do others charge?", geography: "Austin", web: false, sources: [source("A", 12900), source("B", 14900)] });
      let brief = await as.query(api.servicesResearch.brief, { companyId, briefId });
      expect(brief.findings.some((f) => f.id === "range")).toBe(false);
      expect(brief.summary?.uncertain.join(" ")).toContain("Fewer than three");
      await as.mutation(api.servicesResearch.addSource, { companyId, briefId, source: source("C", 17900) });
      brief = await as.query(api.servicesResearch.brief, { companyId, briefId });
      const range = brief.findings.find((f) => f.id === "range");
      expect(range?.statement).toContain("$129.00 to $179.00");
      expect(range?.statement).toContain("not a market average");
      expect(range?.basisLabel).toBe("Advertised starting price");
    });

    it("says why web research did not run instead of pretending", async () => {
      const { t, as, companyId } = await setup();
      const { briefId, blocked } = await as.mutation(api.servicesResearch.start, { companyId, question: "Prices?", geography: "Austin", web: true, sources: [] });
      expect(blocked).toContain("no AI model is connected");
      expect((await as.query(api.servicesResearch.brief, { companyId, briefId })).mode).toBe("sources");
      expect(await t.run((ctx) => ctx.db.query("aiExecutions").collect())).toEqual([]);
    });

    it("keeps only claims backed by pages it retrieved, and charges one brief", async () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      const { t, as, companyId } = await setup();
      const { briefId } = await as.mutation(api.servicesResearch.start, { companyId, question: "Prices?", geography: "Austin", web: true, sources: [] });
      await settle(t);
      const brief = await as.query(api.servicesResearch.brief, { companyId, briefId });
      expect(brief.state).toBe("ready");
      expect(brief.findings.map((f) => f.statement)).toEqual(["A Clean advertises standard cleans from $129."]);
      expect(brief.sources.map((s) => s.url)).toEqual(["https://a.example/pricing"]);
      expect(brief.summary?.uncertain.join(" ")).toContain("1 statement was dropped");
      const [execution] = await t.run((ctx) => ctx.db.query("aiExecutions").collect());
      expect(execution).toMatchObject({ task: "research_brief", agent: "services", state: "completed", completedUnits: 1 });
    });

    it("runs on its own when setup finishes, unless the Owner switched it off", async () => {
      const { t, as, companyId } = await setup();
      const profile = await as.query(api.services.profile, { companyId });
      const result = await as.mutation(api.services.saveProfile, { companyId, expectedRevision: 0, context: { ...profile.context, serviceAreas: "Austin, TX" }, costs: profile.costs!, strategy: "positioning", positioning: "premium", researchDuringSetup: true, completeSetup: true });
      expect(result.research).not.toBeNull();
      const briefs = await as.query(api.servicesResearch.briefs, { companyId });
      expect(briefs.briefs[0]).toMatchObject({ origin: "setup" });
      void t;
      void internal;
    });
  });
});
