import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, NOW, readyCleaner, refusal, start, withLinkSecret, type T } from "../tests/harness";
import { homeSpec, publish } from "../tests/salesHarness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { linkToken } from "./lib/sales/links";
import { blankSpec, type Spec } from "./lib/services/spec";

type As = Awaited<ReturnType<typeof company>>["as"];
const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const DAY = 86_400_000;

/** Commercial cleaning by area: $0.10 a square foot, 30 labor-minutes per 1,000, walkthrough above 20,000. */
function officeSpec(patch: Partial<Spec> = {}): Spec {
  return {
    ...blankSpec("commercial"),
    name: "Office cleaning",
    summary: "Nightly office cleaning.",
    included: [{ id: "trash", label: "Empty trash and recycling", section: "Every visit", requiresPhoto: false }],
    excluded: ["Window exteriors"],
    pricing: { method: "per_area", unit: "sq_ft", rateMillicents: 10_000, laborMinutesPer1000: 30, walkthroughAbove: 20_000 },
    modifiers: { ...blankSpec("commercial").modifiers, recurring: { enabled: true, options: [{ schedule: "every_7_days", discount: { kind: "percent", value: 0 } }] } },
    ...patch,
  };
}

function turnoverSpec(): Spec {
  return {
    ...blankSpec("short_term_rental"),
    name: "Turnover",
    summary: "Clean and reset between stays.",
    visitWord: "turnover",
    included: [{ id: "beds", label: "Make the beds", section: "Bedrooms", requiresPhoto: true }],
    excluded: [],
    pricing: { method: "per_unit", unitWord: "turnover", unitCents: 0, baseCents: 9500, minimumUnits: 0, laborMinutesPerUnit: 0, baseLaborMinutes: 120 },
  };
}

async function setup() {
  const t = start();
  const owner = await company(t, "owner-a", "Alpha Cleaning");
  const office = await publish(owner.as, owner.companyId, officeSpec());
  const turnover = await publish(owner.as, owner.companyId, turnoverSpec());
  const home = await publish(owner.as, owner.companyId, homeSpec());
  await readyCleaner(owner.as, owner.companyId, "Ana");
  await readyCleaner(owner.as, owner.companyId, "Bo");
  return { t, ...owner, keys: { office, turnover, home } };
}

async function client(as: As, companyId: Id<"companies">, segment: "commercial" | "office" | "str", sites: { line1: string }[]) {
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Northwind Offices", kind: segment === "str" ? "short_term_rental" : "commercial", email: "ops@northwind.example" });
  const propertyIds: Id<"properties">[] = [];
  for (const site of sites) propertyIds.push(await as.mutation(api.properties.create, { companyId, customerId, kind: segment === "str" ? "short_term_rental" : "commercial", address: { line1: site.line1, city: "Austin", region: "TX", postalCode: "78701" } }));
  const draftId = await as.mutation(api.sales.startDraft, { companyId, mode: "proposal", segment, customerId });
  return { customerId, propertyIds, draftId };
}

async function saveBody(as: As, companyId: Id<"companies">, draftId: Id<"salesDrafts">, proposal: Record<string, unknown>) {
  const draft = await as.query(api.sales.draft, { companyId, draftId });
  return as.mutation(api.sales.saveDraft, { companyId, draftId, revision: draft.draft.revision, body: { ...draft.draft.body, proposal } });
}

describe("proposals", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("takes a new business through a walkthrough, an approved custom rate, acceptance and the first service", async () => {
    await withLinkSecret(async () => {
      const { t, as, companyId, keys } = await setup();
      const manager = await addMember(t, as, companyId, "manager-1", "manager");
      const { propertyIds, draftId } = await client(as, companyId, "commercial", [{ line1: "1 Main St" }]);
      await saveBody(manager, companyId, draftId, { sites: [{ key: "s1", propertyId: propertyIds[0], label: "Main office", serviceKey: keys.office, input: {}, cadence: { kind: "weekly", weekdays: [1, 3, 5] }, assessment: "needed" }], terms: { invoiceFrequency: "monthly", netDays: 15, contractTermMonths: 12, expiresInDays: 14 } });
      // The area is unknown, so the rate is unresolved, never $0.
      let preview = await manager.query(api.proposals.preview, { companyId, draftId });
      expect(preview.content.sites[0]!.priceCents).toBeNull();
      expect(preview.content.unresolved.join(" ")).toMatch(/walkthrough not completed/);

      const assessmentId = await manager.mutation(api.assessments.request, { companyId, draftId, siteKey: "s1", scheduledAt: NOW + DAY, siteContact: { name: "Lee", phone: "512-555-0111" } });
      const [walk] = await manager.query(api.assessments.forDraft, { companyId, draftId });
      expect(walk!.required.map((f) => f.key)).toContain("area");
      // The assessor records from their phone through the link.
      const row = await t.run((ctx) => ctx.db.get(assessmentId));
      const token = (await linkToken("assess", row!.publicId))!;
      expect(await refusal(t.mutation(api.assessments.linkRecord, { token, findings: { notes: "Two floors" }, finish: true, name: "Sam" }))).toMatch(/Still to record/);
      await t.mutation(api.assessments.linkRecord, { token, findings: { area: 12_000, notes: "Two floors, badge entry" }, finish: true, name: "Sam" });
      let draft = await manager.query(api.sales.draft, { companyId, draftId });
      await manager.mutation(api.assessments.applyToSite, { companyId, assessmentId, revision: draft.draft.revision });
      preview = await manager.query(api.proposals.preview, { companyId, draftId });
      // 12,000 sq ft × $0.10 = $1,200 per visit; three visits a week ≈ 13.04 a month.
      expect(preview.content.sites[0]!.priceCents).toBe(120_000);
      expect(preview.content.sites[0]!.monthlyVisits).toBeCloseTo(13.04, 1);

      // A custom rate from a Manager waits for the Owner's approval of this exact version.
      draft = await manager.query(api.sales.draft, { companyId, draftId });
      const body = draft.draft.body as { proposal: { sites: Record<string, unknown>[] } };
      await saveBody(manager, companyId, draftId, { ...body.proposal, sites: [{ ...body.proposal.sites[0], customRateCents: 110_000, customReason: "Three-year relationship" }] });
      draft = await manager.query(api.sales.draft, { companyId, draftId });
      const saved = await manager.mutation(api.proposals.saveVersion, { companyId, draftId, revision: draft.draft.revision });
      expect(saved.waitingForApproval).toBe(true);
      expect(await refusal(manager.mutation(api.proposals.send, { companyId, proposalId: saved.proposalId, version: saved.version }))).toMatch(/waiting for the Owner/);
      const approval = await t.run((ctx) => ctx.db.query("approvals").withIndex("by_company_status_decideBy", (q) => q.eq("companyId", companyId).eq("status", "pending")).first());
      expect(await refusal(manager.mutation(api.approvals.decide, { companyId, approvalId: approval!._id, decision: "approved" }))).toMatch(/Only the Owner/);
      await as.mutation(api.approvals.decide, { companyId, approvalId: approval!._id, decision: "approved" });
      const sent = await manager.mutation(api.proposals.send, { companyId, proposalId: saved.proposalId, version: saved.version });
      expect(sent.url).toMatch(/\/c\/proposal\//);

      // The client's page shows no internal notes, reference prices or reasons.
      const ptoken = sent.url!.split("/c/proposal/")[1]!;
      const page = (await t.query(api.proposals.publicView, { token: ptoken }))!;
      const json = JSON.stringify(page);
      expect(json).not.toMatch(/badge entry|Three-year|referenceCents|customReason|internal/);
      expect(page.content.sites[0]!.priceCents).toBe(110_000);

      // Accepting needs authority; accepting twice records once.
      expect(await refusal(t.mutation(api.proposals.respond, { token: ptoken, version: page.version, hash: page.hash, kind: "accept", name: "Jo Park", authorized: false }))).toMatch(/authorized/);
      await t.mutation(api.proposals.respond, { token: ptoken, version: page.version, hash: page.hash, kind: "accept", name: "Jo Park", title: "Office manager", authorized: true });
      expect((await t.mutation(api.proposals.respond, { token: ptoken, version: page.version, hash: page.hash, kind: "accept", name: "Jo Park", authorized: true })).already).toBe(true);
      const accepted = await as.query(api.proposals.get, { companyId, proposalId: saved.proposalId });
      expect(accepted.proposal.status).toBe("accepted");
      expect(accepted.responses.filter((r) => r.kind === "accept")).toHaveLength(1);

      // Service setup: nothing is scheduled until the agreement is signed, billing set and access confirmed.
      const setupId = accepted.proposal.setupId!;
      expect(await refusal(as.mutation(api.proposals.activateSite, { companyId, setupId, siteKey: "s1", startDate: "2027-03-08", arrivalMinute: 18 * 60 }))).toMatch(/agreement/);
      const agreementId = await as.mutation(api.proposals.prepareAgreement, { companyId, setupId });
      await t.run((ctx) => ctx.db.patch(agreementId, { workflow: "signed" }));
      await as.mutation(api.proposals.markStep, { companyId, setupId, step: "billing", done: true });
      await as.mutation(api.proposals.markStep, { companyId, setupId, step: "access", siteKey: "s1", done: true });
      const planId = await as.mutation(api.proposals.activateSite, { companyId, setupId, siteKey: "s1", startDate: "2027-03-08", arrivalMinute: 18 * 60 });
      await settle(t);
      const plan = await as.query(api.plans.get, { companyId, planId });
      expect(plan.upcoming[0]!.job?.priceCents).toBe(110_000);
      expect(plan.upcoming.slice(0, 3).map((v) => v.date)).toEqual(["2027-03-08", "2027-03-10", "2027-03-12"]);
    });
  });

  it("refuses answers to an older version, and expired proposals", async () => {
    await withLinkSecret(async () => {
      const { t, as, companyId, keys } = await setup();
      const { propertyIds, draftId } = await client(as, companyId, "commercial", [{ line1: "1 Main St" }]);
      await saveBody(as, companyId, draftId, { sites: [{ key: "s1", propertyId: propertyIds[0], label: "HQ", serviceKey: keys.office, input: { area: 5000 }, cadence: { kind: "weekly", weekdays: [2] } }], terms: { invoiceFrequency: "monthly", expiresInDays: 7 } });
      let draft = await as.query(api.sales.draft, { companyId, draftId });
      const v1 = await as.mutation(api.proposals.saveVersion, { companyId, draftId, revision: draft.draft.revision });
      const sent = await as.mutation(api.proposals.send, { companyId, proposalId: v1.proposalId, version: v1.version });
      const token = sent.url!.split("/c/proposal/")[1]!;
      const first = (await t.query(api.proposals.publicView, { token }))!;
      await t.mutation(api.proposals.respond, { token, version: first.version, hash: first.hash, kind: "changes", name: "Jo", authorized: false, note: "Can you do Thursdays?" });
      await saveBody(as, companyId, draftId, { ...(draft.draft.body as { proposal: object }).proposal, sites: [{ key: "s1", propertyId: propertyIds[0], label: "HQ", serviceKey: keys.office, input: { area: 5000 }, cadence: { kind: "weekly", weekdays: [4] } }] });
      draft = await as.query(api.sales.draft, { companyId, draftId });
      const v2 = await as.mutation(api.proposals.saveVersion, { companyId, draftId, revision: draft.draft.revision });
      expect(v2.version).toBe(2);
      await as.mutation(api.proposals.send, { companyId, proposalId: v1.proposalId, version: 2 });
      expect(await refusal(t.mutation(api.proposals.respond, { token, version: 1, hash: first.hash, kind: "accept", name: "Jo", authorized: true }))).toMatch(/newer version/);
      vi.setSystemTime(NOW + 8 * DAY);
      const second = (await t.query(api.proposals.publicView, { token }))!;
      expect(second.status).toBe("expired");
      expect(await refusal(t.mutation(api.proposals.respond, { token, version: 2, hash: second.hash, kind: "accept", name: "Jo", authorized: true }))).toMatch(/expired/);
    });
  });

  it("starts each office site on its own, and holds back a site that isn't ready", async () => {
    await withLinkSecret(async () => {
      const { t, as, companyId, keys } = await setup();
      const { propertyIds, draftId } = await client(as, companyId, "office", [{ line1: "1 Main St" }, { line1: "9 Side St" }]);
      const site = (key: string, i: number) => ({ key, propertyId: propertyIds[i], label: `Floor ${i + 1}`, serviceKey: keys.office, input: { area: 4000 }, cadence: { kind: "weekly", weekdays: [1] }, details: { workstations: 40, restrooms: 2, afterHoursAccess: "Badge 4411" }, matrix: [{ task: "Vacuum carpets", frequency: "each_visit" }, { task: "Wipe blinds", frequency: "monthly" }] });
      await saveBody(as, companyId, draftId, { sites: [site("a", 0), site("b", 1)], terms: { invoiceFrequency: "monthly", startTogether: false } });
      const draft = await as.query(api.sales.draft, { companyId, draftId });
      const saved = await as.mutation(api.proposals.saveVersion, { companyId, draftId, revision: draft.draft.revision });
      const sent = await as.mutation(api.proposals.send, { companyId, proposalId: saved.proposalId, version: saved.version });
      const token = sent.url!.split("/c/proposal/")[1]!;
      const page = (await t.query(api.proposals.publicView, { token }))!;
      expect(page.content.sites[0]!.matrix.map((m) => m.frequency)).toEqual(["Each visit", "Monthly"]);
      expect(JSON.stringify(page)).not.toMatch(/Badge 4411/);
      await t.mutation(api.proposals.respond, { token, version: page.version, hash: page.hash, kind: "accept", name: "Jo", authorized: true, signer: { name: "Pat Lee", email: "pat@northwind.example", title: "COO" } });
      const setupId = (await as.query(api.proposals.get, { companyId, proposalId: saved.proposalId })).proposal.setupId!;
      const agreementId = await as.mutation(api.proposals.prepareAgreement, { companyId, setupId });
      const agreement = await t.run((ctx) => ctx.db.get(agreementId));
      // The named signer signs; the contract party is still the client.
      expect(agreement!.parties.some((p) => p.name === "Pat Lee" && p.signer)).toBe(true);
      await t.run((ctx) => ctx.db.patch(agreementId, { workflow: "signed" }));
      await as.mutation(api.proposals.markStep, { companyId, setupId, step: "billing", done: true });
      await as.mutation(api.proposals.markStep, { companyId, setupId, step: "access", siteKey: "a", done: true });
      await as.mutation(api.proposals.activateSite, { companyId, setupId, siteKey: "a", startDate: "2027-03-08", arrivalMinute: 19 * 60 });
      expect(await refusal(as.mutation(api.proposals.activateSite, { companyId, setupId, siteKey: "b", startDate: "2027-03-08", arrivalMinute: 19 * 60 }))).toMatch(/Access/);
      const view = await as.query(api.proposals.setup, { companyId, setupId });
      expect(view.sites.find((s) => s.key === "a")?.plan).not.toBeNull();
      expect(view.sites.find((s) => s.key === "b")?.ready).toBe(false);
    });
  });

  it("accepts a standing STR rate without booking turnovers, then books one from a real stay", async () => {
    await withLinkSecret(async () => {
      const { t, as, companyId, keys } = await setup();
      const { propertyIds, draftId } = await client(as, companyId, "str", [{ line1: "5 Lake Rd" }]);
      await saveBody(as, companyId, draftId, { sites: [{ key: "h1", propertyId: propertyIds[0], label: "Lake house", serviceKey: keys.turnover, input: {}, perTurnover: true, initialChargeCents: 25_000, details: { beds: 4, laundry: "On site" } }], terms: { invoiceFrequency: "monthly", rushTerms: "Same-day turnovers by request, when a crew is free." } });
      const draft = await as.query(api.sales.draft, { companyId, draftId });
      const saved = await as.mutation(api.proposals.saveVersion, { companyId, draftId, revision: draft.draft.revision });
      const preview = await as.query(api.proposals.preview, { companyId, draftId });
      // Variable volume: no monthly total is promised.
      expect(preview.content.totals.fixedMonthlyEstimateCents).toBeNull();
      expect(preview.content.totals.anyVariable).toBe(true);
      expect(preview.content.totals.initialCents).toBe(25_000);
      const sent = await as.mutation(api.proposals.send, { companyId, proposalId: saved.proposalId, version: saved.version });
      const token = sent.url!.split("/c/proposal/")[1]!;
      const page = (await t.query(api.proposals.publicView, { token }))!;
      await t.mutation(api.proposals.respond, { token, version: page.version, hash: page.hash, kind: "accept", name: "Host", authorized: true });
      const setupId = (await as.query(api.proposals.get, { companyId, proposalId: saved.proposalId })).proposal.setupId!;
      const jobsBefore = await t.run((ctx) => ctx.db.query("jobs").collect());
      expect(jobsBefore).toHaveLength(0);
      const agreementId = await as.mutation(api.proposals.prepareAgreement, { companyId, setupId });
      await t.run((ctx) => ctx.db.patch(agreementId, { workflow: "signed" }));
      await as.mutation(api.proposals.markStep, { companyId, setupId, step: "billing", done: true });
      await as.mutation(api.proposals.markStep, { companyId, setupId, step: "access", siteKey: "h1", done: true });
      expect(await refusal(as.mutation(api.proposals.activateSite, { companyId, setupId, siteKey: "h1", startDate: "2027-03-08", arrivalMinute: 11 * 60 }))).toMatch(/one at a time/);
      const jobId = await as.mutation(api.proposals.scheduleTurnover, { companyId, setupId, siteKey: "h1", date: "2027-03-02", startMinute: 11 * 60, deadlineMinute: 16 * 60 });
      const job = await t.run((ctx) => ctx.db.get(jobId));
      expect(job?.priceCents).toBe(9500);
      expect(job?.hardDeadlineAt).toBeDefined();
    });
  });

  it("keeps proposals to their company", async () => {
    const { t, as, companyId, keys } = await setup();
    const { propertyIds, draftId } = await client(as, companyId, "commercial", [{ line1: "1 Main St" }]);
    await saveBody(as, companyId, draftId, { sites: [{ key: "s1", propertyId: propertyIds[0], label: "HQ", serviceKey: keys.office, input: { area: 1000 }, cadence: { kind: "weekly", weekdays: [2] } }], terms: { invoiceFrequency: "monthly" } });
    const draft = await as.query(api.sales.draft, { companyId, draftId });
    const saved = await as.mutation(api.proposals.saveVersion, { companyId, draftId, revision: draft.draft.revision });
    const other = await company(t, "owner-b", "Beta Cleaning");
    expect(await refusal(other.as.query(api.proposals.get, { companyId: other.companyId, proposalId: saved.proposalId }))).toMatch(/not found/i);
    expect(await refusal(other.as.mutation(api.proposals.send, { companyId: other.companyId, proposalId: saved.proposalId, version: 1 }))).toMatch(/not found/i);
  });
});
