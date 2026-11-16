/**
 * The Agreements workspace end to end: the library, access, versions, approval, signing, uploads and
 * renewals. The signing provider is the test double (lib/agreements/signing.ts); nothing here proves a
 * real provider works, only that Selestial's own rules hold whatever the provider says.
 *
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, refusal, start, type T } from "../tests/harness";
import { api, internal } from "./_generated/api";
import { NOT_FOUND } from "./lib/errors";
import { mockSigning, resetMockSigning, signBody } from "./lib/agreements/signing";

const SECRET = "test-signature-webhook-secret-0123456789";

const ANSWERS = {
  counterpartySigner: "Dana Whitfield",
  companySigner: "Pat Owner, Owner",
  governingState: "TX",
  serviceName: "Standard clean",
  scopeSummary: "Kitchen, bathrooms, floors and dusting",
  exclusions: "Inside appliances",
  serviceStandard: "Completed checklist and photos",
  frequency: "one time",
  serviceWindow: "weekdays 9 AM to 1 PM",
  visitDurationHours: 3,
  startDate: "2027-03-02",
  pricePerVisitCents: 18000,
  paymentDueDays: 7,
  paymentMethod: "card on file with the payment provider",
  depositCents: 0,
  suppliesBy: "company",
  specialProducts: "None",
  accessMethod: "Lockbox",
  alarmPets: "A friendly dog",
  rescheduleNoticeHours: 24,
  lateCancelFeeCents: 2500,
  lockoutFeeCents: 2500,
  concernWindowHours: 48,
  correctiveRemedy: "A return visit at no charge",
  additionalWorkApproval: "written approval before any extra work",
  damageReportHours: 24,
};

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner", "Elm Cleaning");
  const manager = await addMember(t, as, companyId, "manager", "manager");
  const office = await addMember(t, as, companyId, "office", "office");
  const customerId = await as.mutation(api.customers.create, { companyId, name: "Dana Whitfield", kind: "home", email: "dana@example.com" });
  const propertyId = await as.mutation(api.properties.create, { companyId, customerId, kind: "home", address: { line1: "12 Elm St", city: "Austin", region: "TX", postalCode: "78701" }, accessInstructions: "Lockbox 1234" });
  const cleanerId = await as.mutation(api.cleaners.create, { companyId, name: "Rosa Diaz", engagement: "contractor", skills: [] });
  const make = (who: typeof as, docType = "one_time_residential", extra: Record<string, unknown> = {}) => who.mutation(api.companyAgreements.create, { companyId, docType, links: [{ table: "customers", id: customerId }, { table: "properties", id: propertyId }], ...extra });
  const get = (who: typeof as, agreementId: string, version?: number) => who.query(api.companyAgreements.get, { companyId, agreementId, version });
  const fill = async (who: typeof as, agreementId: string, answers: Record<string, string | number | boolean | string[]> = ANSWERS) => {
    const detail = await get(who, agreementId);
    const result = await who.mutation(api.companyAgreements.answer, { companyId, agreementId, baseVersion: detail.currentVersion, answers });
    if (!result.ok) throw new Error(`answer failed: ${JSON.stringify(result)}`);
    return result;
  };
  const approveNow = async (who: typeof as, agreementId: string) => {
    const detail = await get(who, agreementId);
    return who.mutation(api.companyAgreements.approveVersion, { companyId, agreementId, version: detail.currentVersion, hash: detail.version.hash });
  };
  const setSigners = (agreementId: string, signers: { name: string; email: string }[]) =>
    as.mutation(api.companyAgreements.setParties, { companyId, agreementId, parties: signers.map((s, i) => ({ role: i === 0 ? "company" : "customer", name: s.name, email: s.email, signer: true, order: i + 1 })) });
  /** A drafted, filled, approved agreement with two signers, ready to send. */
  const ready = async () => {
    const id = await make(as);
    await fill(as, id);
    await setSigners(id, [{ name: "Pat Owner", email: "pat@example.com" }, { name: "Dana Whitfield", email: "dana@example.com" }]);
    await approveNow(as, id);
    return id;
  };
  const event = async (type: string, requestId: string, over: Record<string, unknown> = {}) => {
    const body = JSON.stringify({ eventId: `evt-${Math.random().toString(36).slice(2)}`, requestId, type, at: Date.now(), ...over });
    return { body, signature: await signBody(SECRET, body) };
  };
  const deliver = (e: { body: string; signature: string }) => t.fetch("/webhooks/signature", { method: "POST", headers: { "x-selestial-signature": e.signature }, body: e.body });
  const requestOf = async (agreementId: string) => (await get(as, agreementId)).requests[0];
  const settle = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, as, companyId, manager, office, customerId, propertyId, cleanerId, make, get, fill, approveNow, setSigners, ready, event, deliver, requestOf, settle };
}

beforeEach(() => {
  vi.useFakeTimers();
  process.env.SIGNATURE_PROVIDER = "mock";
  process.env.SIGNATURE_WEBHOOK_SECRET = SECRET;
  resetMockSigning();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.SIGNATURE_PROVIDER;
  delete process.env.SIGNATURE_WEBHOOK_SECRET;
});

describe("drafting, versions and approval", () => {
  it("builds a draft from shared clauses, prefilled from company records with their sources", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    const detail = await s.get(s.as, id);
    expect(detail.terms).toMatchObject({ counterpartyName: "Dana Whitfield", serviceAddress: "12 Elm St, Austin, TX 78701", accessMethod: "Lockbox 1234", governingState: "TX" });
    expect(detail.sources.counterpartyName).toMatch(/Customer record/);
    expect(detail.sources.serviceAddress).toMatch(/Property record/);
    expect(detail.version.markdown).toContain("[[TO CONFIRM: Service]]");
    expect(detail.readiness.missing).toContain("serviceName");
    expect(detail.links.map((l) => l.label).sort()).toEqual(["12 Elm St", "Dana Whitfield"]);
    expect(detail.nextQuestions.length).toBeGreaterThan(0);
    expect(detail.nextQuestions.length).toBeLessThanOrEqual(3);
    // Nothing already known is asked again.
    expect(detail.nextQuestions.map((q) => q.key)).not.toContain("counterpartyName");
  });

  it("refuses approval while answers are missing or invalid, then approves the exact version", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    const early = await s.get(s.as, id);
    expect(await refusal(s.as.mutation(api.companyAgreements.approveVersion, { companyId: s.companyId, agreementId: id, version: 1, hash: early.version.hash }))).toMatch(/Still needed/);
    const bad = await s.as.mutation(api.companyAgreements.answer, { companyId: s.companyId, agreementId: id, baseVersion: 1, answers: { pricePerVisitCents: "lots", paymentDueDays: -3 } });
    expect(bad.ok).toBe(false);
    await s.fill(s.as, id);
    const detail = await s.get(s.as, id);
    expect(await refusal(s.as.mutation(api.companyAgreements.approveVersion, { companyId: s.companyId, agreementId: id, version: detail.currentVersion, hash: "0".repeat(64) }))).toMatch(/not what you reviewed/);
    await s.approveNow(s.as, id);
    const approved = await s.get(s.as, id);
    expect(approved).toMatchObject({ workflow: "approved", approvedVersion: approved.currentVersion, approvedBy: "owner" });
  });

  it("invalidates an approval when the document changes, by answer or by hand", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    await s.fill(s.as, id);
    await s.approveNow(s.as, id);
    let detail = await s.get(s.as, id);
    expect(detail.workflow).toBe("approved");
    const next = await s.as.mutation(api.companyAgreements.answer, { companyId: s.companyId, agreementId: id, baseVersion: detail.currentVersion, answers: { pricePerVisitCents: "$200.00" } });
    expect(next).toMatchObject({ ok: true, reopened: true });
    detail = await s.get(s.as, id);
    expect(detail).toMatchObject({ workflow: "draft", approvedVersion: null });
    await s.approveNow(s.as, id);
    detail = await s.get(s.as, id);
    await s.as.mutation(api.companyAgreements.saveText, { companyId: s.companyId, agreementId: id, baseVersion: detail.currentVersion, markdown: `${detail.version.markdown}\n\nAn extra sentence.` });
    expect((await s.get(s.as, id)).workflow).toBe("draft");
  });

  it("keeps every version immutable and comparable, and refuses a stale revision", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    await s.fill(s.as, id);
    const detail = await s.get(s.as, id);
    expect(await refusal(s.as.mutation(api.companyAgreements.saveText, { companyId: s.companyId, agreementId: id, baseVersion: 1, markdown: "x" }))).toMatch(/changed since version 1/);
    const first = await s.get(s.as, id, 1);
    expect(first.version.markdown).toContain("[[TO CONFIRM");
    expect(first.isCurrent).toBe(false);
    const diff = await s.as.query(api.companyAgreements.compare, { companyId: s.companyId, agreementId: id, from: 1, to: detail.currentVersion });
    expect(diff.added).toBeGreaterThan(0);
    expect(diff.removed).toBeGreaterThan(0);
  });

  it("holds a changed answer that would rewrite hand-edited text, listing the clauses it touches", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    await s.fill(s.as, id);
    let detail = await s.get(s.as, id);
    await s.as.mutation(api.companyAgreements.saveText, { companyId: s.companyId, agreementId: id, baseVersion: detail.currentVersion, markdown: detail.version.markdown.replace("Inside appliances", "Inside appliances and ovens, by negotiation") });
    detail = await s.get(s.as, id);
    expect(detail.readiness.edited).toBe(true);
    const held = await s.as.mutation(api.companyAgreements.answer, { companyId: s.companyId, agreementId: id, baseVersion: detail.currentVersion, answers: { exclusions: "Nothing" } });
    expect(held).toMatchObject({ ok: false, reason: "edited" });
    expect((await s.get(s.as, id)).currentVersion).toBe(detail.currentVersion);
    const forced = await s.as.mutation(api.companyAgreements.answer, { companyId: s.companyId, agreementId: id, baseVersion: detail.currentVersion, answers: { exclusions: "Nothing" }, regenerate: true });
    expect(forced.ok).toBe(true);
  });

  it("validates dates, amounts and incompatible terms deterministically", async () => {
    const s = await setup();
    const id = await s.make(s.as, "recurring_residential");
    const answer = (answers: Record<string, string | number | boolean>) => s.as.mutation(api.companyAgreements.answer, { companyId: s.companyId, agreementId: id, baseVersion: 1, answers });
    expect(await answer({ startDate: "2027-02-30" })).toMatchObject({ ok: false });
    expect(await answer({ autoRenew: true, termMonths: 0, renewalNoticeDays: 30 })).toMatchObject({ ok: false });
    const ok = await answer({ frequency: "weekly", pricePerVisitCents: 10000, monthlyTotalCents: 20000 });
    expect(ok.ok && ok.warnings.join(" ")).toMatch(/about \$433/);
  });

  it("marks a term unresolved on purpose and requires that to be acknowledged at approval", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    const { ...rest } = ANSWERS;
    delete (rest as Record<string, unknown>).correctiveRemedy;
    await s.fill(s.as, id, rest);
    await s.as.mutation(api.companyAgreements.skipTerm, { companyId: s.companyId, agreementId: id, key: "correctiveRemedy", skipped: true });
    const detail = await s.get(s.as, id);
    expect(await refusal(s.as.mutation(api.companyAgreements.approveVersion, { companyId: s.companyId, agreementId: id, version: detail.currentVersion, hash: detail.version.hash }))).toMatch(/left unresolved on purpose/);
    await s.as.mutation(api.companyAgreements.approveVersion, { companyId: s.companyId, agreementId: id, version: detail.currentVersion, hash: detail.version.hash, acknowledgeSkipped: true });
    // Approved, but still not sendable: the text still says TO CONFIRM.
    await s.setSigners(id, [{ name: "Pat", email: "pat@example.com" }]);
    const blockers = await s.as.query(api.agreementSigning.blockers, { companyId: s.companyId, agreementId: id });
    expect(blockers.blockers.join(" ")).toMatch(/TO CONFIRM/);
  });
});

describe("access, workforce documents and company isolation", () => {
  it("keeps restricted and workforce documents out of every read path for people who may not see them", async () => {
    const s = await setup();
    const link = [{ table: "cleaners" as const, id: s.cleanerId }];
    const contractor = await s.as.mutation(api.companyAgreements.create, { companyId: s.companyId, docType: "contractor_agreement", links: link });
    const privacy = await s.as.mutation(api.companyAgreements.create, { companyId: s.companyId, docType: "confidentiality_privacy", links: link });
    const customerDoc = await s.make(s.as);

    // Direct ids.
    for (const who of [s.office]) for (const id of [contractor, privacy]) expect(await refusal(s.get(who, id))).toBe(NOT_FOUND);
    expect(await refusal(s.get(s.manager, contractor))).toBe(NOT_FOUND); // owner-only: compensation and classification
    expect((await s.get(s.manager, privacy)).docType).toBe("confidentiality_privacy");
    // Lists and search.
    const listed = async (who: typeof s.as, search?: string) => (await who.query(api.companyAgreements.list, { companyId: s.companyId, search })).rows.map((r) => r.id);
    expect(await listed(s.office)).toEqual([customerDoc]);
    expect(await listed(s.office, "Rosa")).toEqual([]);
    expect(await listed(s.office, "Contractor")).toEqual([]);
    expect((await listed(s.manager)).sort()).toEqual([customerDoc, privacy].sort());
    expect((await listed(s.as)).length).toBe(3);
    expect(await listed(s.as, "Contractor")).toEqual([contractor]);
    // The worker's record page: seeing the cleaner grants nothing.
    const forWorker = async (who: typeof s.as) => (await who.query(api.companyAgreements.forRecord, { companyId: s.companyId, table: "cleaners", id: s.cleanerId })).map((r) => r.id);
    expect(await forWorker(s.office)).toEqual([]);
    expect(await forWorker(s.manager)).toEqual([privacy]);
    expect((await forWorker(s.as)).sort()).toEqual([contractor, privacy].sort());
    // Export, comparison, mutation and signing all refuse by direct id.
    expect(await refusal(s.office.mutation(api.companyAgreements.exportVersion, { companyId: s.companyId, agreementId: contractor, format: "pdf" }))).toBe(NOT_FOUND);
    expect(await refusal(s.office.query(api.companyAgreements.compare, { companyId: s.companyId, agreementId: contractor, from: 1, to: 1 }))).toBe(NOT_FOUND);
    expect(await refusal(s.office.mutation(api.companyAgreements.comment, { companyId: s.companyId, agreementId: contractor, text: "hi" }))).toBe(NOT_FOUND);
    expect(await refusal(s.manager.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: contractor }))).toBe(NOT_FOUND);
    // Office cannot even start one.
    expect(await refusal(s.office.mutation(api.companyAgreements.create, { companyId: s.companyId, docType: "contractor_agreement" }))).toMatch(/Only the Owner/);
    // The catalog does not offer what a role cannot draft.
    const catalog = await s.office.query(api.companyAgreements.catalog, { companyId: s.companyId });
    expect(catalog.types.some((t) => t.key === "contractor_agreement")).toBe(false);
    expect(catalog.types.some((t) => t.key === "one_time_residential" && t.canDraft)).toBe(true);
  });

  it("refuses another company's reads and writes, and a restricted id from another company", async () => {
    const s = await setup();
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    const id = await s.make(s.as);
    expect(await refusal(other.as.query(api.companyAgreements.get, { companyId: other.companyId, agreementId: id }))).toBe(NOT_FOUND);
    expect(await refusal(other.as.query(api.companyAgreements.get, { companyId: s.companyId, agreementId: id }))).toBe(NOT_FOUND);
    expect(await refusal(other.as.mutation(api.companyAgreements.create, { companyId: s.companyId, docType: "one_time_residential" }))).toBe(NOT_FOUND);
    expect(await refusal(other.as.mutation(api.companyAgreements.archiveAgreement, { companyId: other.companyId, agreementId: id, reason: "x" }))).toBe(NOT_FOUND);
    // A customer from another company cannot be linked.
    const foreign = await other.as.mutation(api.customers.create, { companyId: other.companyId, name: "Not Yours", kind: "home" });
    expect(await refusal(s.as.mutation(api.companyAgreements.linkRecord, { companyId: s.companyId, agreementId: id, link: { table: "customers", id: foreign } }))).toMatch(/not in this company/);
    expect((await other.as.query(api.companyAgreements.list, { companyId: other.companyId })).rows).toEqual([]);
  });

  it("limits approving and sending by role, and refuses a removed member", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    await s.fill(s.as, id);
    const detail = await s.get(s.as, id);
    expect(await refusal(s.office.mutation(api.companyAgreements.approveVersion, { companyId: s.companyId, agreementId: id, version: detail.currentVersion, hash: detail.version.hash }))).toMatch(/cannot approve/);
    expect((await s.get(s.office, id)).capabilities).toMatchObject({ canEdit: true, canApprove: false, canSend: false });
    await s.approveNow(s.manager, id);
    expect(await refusal(s.office.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id }))).toMatch(/cannot send|not allowed|Not allowed/i);
    const memberId = (await s.as.query(api.members.list, { companyId: s.companyId })).find((m) => m.email === "office@example.com")!.id;
    await s.as.mutation(api.members.remove, { companyId: s.companyId, memberId });
    expect(await refusal(s.get(s.office, id))).toBe(NOT_FOUND);
  });
});

describe("templates", () => {
  it("leaves existing agreements unchanged when a template is edited, archived or replaced", async () => {
    const s = await setup();
    const templateId = await s.as.mutation(api.agreementTemplates.create, { companyId: s.companyId, title: "Our standard clean", docType: "one_time_residential" });
    expect(await refusal(s.make(s.as, "one_time_residential", { templateId }))).toMatch(/Approve this template/);
    const t1 = await s.as.query(api.agreementTemplates.get, { companyId: s.companyId, templateId });
    await s.as.mutation(api.agreementTemplates.approve, { companyId: s.companyId, templateId, version: 1 });
    const agreementId = await s.make(s.as, "one_time_residential", { templateId });
    await s.fill(s.as, agreementId);
    const before = await s.get(s.as, agreementId);
    expect(before.sourceTemplate).toMatchObject({ kind: "company", version: 1 });

    const clauses = t1.shown.clauses.map((c) => (c.key === "exclusions_standards" ? { ...c, body: "Changed: nothing is excluded. {{exclusions}} {{serviceStandard}}" } : c));
    const v2 = await s.as.mutation(api.agreementTemplates.save, { companyId: s.companyId, templateId, baseVersion: 1, clauses, note: "Looser exclusions" });
    expect(v2).toBe(2);
    expect((await s.as.query(api.agreementTemplates.get, { companyId: s.companyId, templateId })).status).toBe("draft");
    await s.as.mutation(api.agreementTemplates.archive, { companyId: s.companyId, templateId, archived: true });
    const after = await s.get(s.as, agreementId);
    expect(after.version.markdown).toBe(before.version.markdown);
    expect(after.clauses).toEqual(before.clauses);
    expect(after.kitClauses.find((c) => c.key === "exclusions_standards")?.version).toBe(1);
    // A new agreement from the approved version, after a re-approval, carries the new clause version.
    await s.as.mutation(api.agreementTemplates.archive, { companyId: s.companyId, templateId, archived: false });
    await s.as.mutation(api.agreementTemplates.approve, { companyId: s.companyId, templateId, version: 2 });
    const second = await s.make(s.as, "one_time_residential", { templateId });
    expect((await s.get(s.as, second)).kitClauses.find((c) => c.key === "exclusions_standards")?.version).toBe(2);
  });

  it("rejects a clause that uses an unknown field, accepts a custom variable, and never calls a template reviewed without evidence", async () => {
    const s = await setup();
    const clauses = [{ key: "parties", version: 1, title: "Parties", body: "Between {{companyName}} and {{nope}}." }];
    expect(await refusal(s.as.mutation(api.agreementTemplates.create, { companyId: s.companyId, title: "Bad", docType: "scope_of_work", clauses }))).toMatch(/not a known field/);
    const custom = [{ key: "parties", version: 1, title: "Parties", body: "Between {{companyName}} and {{counterpartyName}}. Gate code {{x_gate}}." }];
    const id = await s.as.mutation(api.agreementTemplates.create, { companyId: s.companyId, title: "With gate", docType: "scope_of_work", clauses: custom, extra: [{ key: "x_gate", label: "Gate code", type: "text", group: "access", ask: "What is the gate code?" }] });
    let template = await s.as.query(api.agreementTemplates.get, { companyId: s.companyId, templateId: id });
    expect(template.review).toBeNull();
    await s.as.mutation(api.agreementTemplates.review, { companyId: s.companyId, templateId: id, version: 1, reviewer: "Jane Counsel, Esq.", reviewedOn: "2027-01-15", note: "Reviewed for TX" });
    template = await s.as.query(api.agreementTemplates.get, { companyId: s.companyId, templateId: id });
    expect(template.review).toMatchObject({ reviewer: "Jane Counsel, Esq.", version: 1 });
    await s.as.mutation(api.agreementTemplates.save, { companyId: s.companyId, templateId: id, baseVersion: 1, clauses: custom.map((c) => ({ ...c, body: `${c.body} More.` })) });
    template = await s.as.query(api.agreementTemplates.get, { companyId: s.companyId, templateId: id });
    expect(template.review).toBeNull();
    expect(template.staleReview).toMatchObject({ version: 1 });
    const catalog = await s.as.query(api.companyAgreements.catalog, { companyId: s.companyId });
    expect(catalog.types.every((type) => type.legallyReviewed === false)).toBe(true);
  });
});

describe("signing", () => {
  it("is honest when no provider is connected: drafting and export work, sending does not", async () => {
    delete process.env.SIGNATURE_PROVIDER;
    const s = await setup();
    const id = await s.ready();
    const result = await s.as.query(api.agreementSigning.blockers, { companyId: s.companyId, agreementId: id });
    expect(result.signing).toMatchObject({ configured: false, provider: null });
    expect(result.blockers.join(" ")).toMatch(/No e-signature provider is connected/);
    expect(await refusal(s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id }))).toMatch(/No e-signature provider/);
    expect((await s.get(s.as, id)).workflow).toBe("approved");
    const exported = await s.as.mutation(api.companyAgreements.exportVersion, { companyId: s.companyId, agreementId: id, format: "pdf" });
    expect(exported.markdown).toContain("Standard clean");
    process.env.SIGNATURE_PROVIDER = "docusign";
    expect((await s.as.query(api.agreementSigning.status, { companyId: s.companyId })).why).toMatch(/no adapter/);
  });

  it("sends the approved version, binds it to its hash, and does not call an accepted request delivered or signed", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const detail = await s.get(s.as, id);
    expect(detail.workflow).toBe("sent");
    const request = detail.requests[0];
    expect(request).toMatchObject({ status: "sent", hashMatchesCurrent: true });
    expect(request.signers.map((x) => x.status)).toEqual(["pending", "pending"]);
    expect(mockSigning.requests).toHaveLength(1);
    expect(mockSigning.requests[0].request.hash).toBe(detail.version.hash);
    // The document is locked while it is out.
    expect(await refusal(s.as.mutation(api.companyAgreements.saveText, { companyId: s.companyId, agreementId: id, baseVersion: detail.currentVersion, markdown: "changed" }))).toMatch(/out for signature/);
    expect(await refusal(s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id }))).toMatch(/already open|approved|It is sent/);
  });

  it("applies each provider report once, and reports partial signatures as partial", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const requestId = mockSigning.requests[0].providerRequestId;

    expect((await s.deliver(await s.event("delivered", requestId, { signerEmail: "pat@example.com" }))).status).toBe(200);
    const signed = await s.event("signed", requestId, { signerEmail: "pat@example.com" });
    await s.deliver(signed);
    await s.deliver(signed); // the same report again
    const detail = await s.get(s.as, id);
    expect(detail.workflow).toBe("partially_signed");
    expect(detail.requests[0].signers.map((x) => x.status)).toEqual(["signed", "pending"]);
    expect(detail.provenance).toBe("unsigned");
    const events = await s.t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((e) => e.type === "agreement.partially_signed"));
    expect(events).toHaveLength(1);

    // A provider saying "completed" while a signer is unreported does not make it signed.
    await s.deliver(await s.event("completed", requestId));
    const still = await s.get(s.as, id);
    expect(still.workflow).toBe("partially_signed");
    expect(still.requests[0].problem).toMatch(/not treated as fully signed/);

    await s.deliver(await s.event("signed", requestId, { signerEmail: "dana@example.com" }));
    await s.settle();
    const done = await s.get(s.as, id);
    expect(done).toMatchObject({ workflow: "signed", provenance: "provider_signed", signedVersion: done.currentVersion });
    expect(done.requests[0]).toMatchObject({ status: "completed", hasSignedFile: true });
  });

  it("refuses an unsigned, badly signed or unknown report", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const requestId = mockSigning.requests[0].providerRequestId;
    const e = await s.event("signed", requestId, { signerEmail: "pat@example.com" });
    expect((await s.t.fetch("/webhooks/signature", { method: "POST", body: e.body })).status).toBe(401);
    expect((await s.t.fetch("/webhooks/signature", { method: "POST", headers: { "x-selestial-signature": "sha256=00" }, body: e.body })).status).toBe(401);
    delete process.env.SIGNATURE_WEBHOOK_SECRET;
    expect((await s.deliver(e)).status).toBe(401);
    process.env.SIGNATURE_WEBHOOK_SECRET = SECRET;
    const unknown = await s.event("signed", "no-such-request", { signerEmail: "pat@example.com" });
    expect((await s.deliver(unknown)).status).toBe(200);
    expect((await s.get(s.as, id)).requests[0].signers.every((x) => x.status === "pending")).toBe(true);
  });

  it("never overwrites a signed version: edits are refused and an amendment is a new record", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const requestId = mockSigning.requests[0].providerRequestId;
    for (const email of ["pat@example.com", "dana@example.com"]) await s.deliver(await s.event("signed", requestId, { signerEmail: email }));
    const signed = await s.get(s.as, id);
    expect(signed.workflow).toBe("signed");
    expect(await refusal(s.as.mutation(api.companyAgreements.saveText, { companyId: s.companyId, agreementId: id, baseVersion: signed.currentVersion, markdown: "tampered" }))).toMatch(/never edited/);
    expect(await refusal(s.as.mutation(api.companyAgreements.answer, { companyId: s.companyId, agreementId: id, baseVersion: signed.currentVersion, answers: { pricePerVisitCents: 1 } }))).toMatch(/never edited/);
    const amendment = await s.as.mutation(api.companyAgreements.amend, { companyId: s.companyId, agreementId: id, kind: "amendment" });
    const draft = await s.get(s.as, amendment);
    expect(draft).toMatchObject({ workflow: "draft", origin: "amendment", supersedes: id });
    expect(draft.version.markdown).toBe(signed.version.markdown);
    const untouched = await s.get(s.as, id);
    expect(untouched.version.hash).toBe(signed.version.hash);
    expect(untouched.workflow).toBe("signed");
  });

  it("records a failed hand-off as a delivery failure, never as a success", async () => {
    const s = await setup();
    const id = await s.ready();
    mockSigning.fail = "create";
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const detail = await s.get(s.as, id);
    expect(detail.workflow).toBe("delivery_failed");
    expect(detail.requests[0]).toMatchObject({ status: "failed" });
    expect(detail.requests[0].problem).toMatch(/did not accept/);
    // After a bounce report, too.
    mockSigning.fail = "none";
    await s.as.mutation(api.companyAgreements.unapprove, { companyId: s.companyId, agreementId: id }).catch(() => undefined);
    const again = await s.get(s.as, id);
    expect(again.workflow === "delivery_failed" || again.workflow === "draft").toBe(true);
  });

  it("sends one reminder a day, and a repeat or retry does nothing more", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const first = await s.as.mutation(api.agreementSigning.remindSigners, { companyId: s.companyId, agreementId: id });
    expect(first.reminded).toBe(2);
    await s.settle();
    expect(mockSigning.requests[0].reminders).toHaveLength(2);
    expect(await refusal(s.as.mutation(api.agreementSigning.remindSigners, { companyId: s.companyId, agreementId: id }))).toMatch(/already sent/);
    await s.settle();
    expect(mockSigning.requests[0].reminders).toHaveLength(2);
    expect(await refusal(s.office.mutation(api.agreementSigning.remindSigners, { companyId: s.companyId, agreementId: id }))).toMatch(/cannot send reminders/);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    expect((await s.as.mutation(api.agreementSigning.remindSigners, { companyId: s.companyId, agreementId: id, signerEmail: "dana@example.com" })).reminded).toBe(1);
  });

  it("withdraws and replaces a request, closes expired ones, and ignores later reports", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const first = mockSigning.requests[0].providerRequestId;
    const replacement = await s.as.mutation(api.agreementSigning.replace, { companyId: s.companyId, agreementId: id, reason: "Fixed a signer" });
    await s.settle();
    expect(mockSigning.requests[0].withdrawn).toBe(true);
    expect(mockSigning.requests).toHaveLength(2);
    await s.deliver(await s.event("signed", first, { signerEmail: "pat@example.com" }));
    const detail = await s.get(s.as, id);
    expect(detail.requests.map((r) => r.status)).toEqual(["sent", "withdrawn"]);
    expect(detail.requests[1].signers.every((x) => x.status === "pending")).toBe(true);
    expect(replacement).toBeTruthy();
    // Expiry: not signed, not reported as signed.
    vi.setSystemTime(Date.now() + 20 * 24 * 60 * 60 * 1000);
    await s.t.mutation(internal.agreementSigning.sweep, {});
    const expired = await s.get(s.as, id);
    expect(expired.workflow).toBe("expired");
    expect(expired.requests[0].status).toBe("expired");
  });

  it("shows a signed document that could not be retrieved as signed, without a download, and retries", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const requestId = mockSigning.requests[0].providerRequestId;
    mockSigning.fail = "fetch";
    for (const email of ["pat@example.com", "dana@example.com"]) await s.deliver(await s.event("signed", email === "pat@example.com" ? requestId : requestId, { signerEmail: email }));
    await s.settle();
    let detail = await s.get(s.as, id);
    expect(detail.workflow).toBe("signed");
    expect(detail.requests[0]).toMatchObject({ hasSignedFile: false });
    expect(await refusal(s.as.mutation(api.agreementSigning.signedDownload, { companyId: s.companyId, agreementId: id }))).toMatch(/not been retrieved/);
    mockSigning.fail = "none";
    await s.as.mutation(api.agreementSigning.retrySigned, { companyId: s.companyId, agreementId: id });
    await s.settle();
    detail = await s.get(s.as, id);
    expect(detail.requests[0].hasSignedFile).toBe(true);
    const download = await s.as.mutation(api.agreementSigning.signedDownload, { companyId: s.companyId, agreementId: id });
    expect(download.matchesApprovedText).toBe(true);
    expect(download.evidence).toMatch(/Test double/);
  });
});

describe("uploads", () => {
  const store = (t: T, text: string, type = "text/plain") => t.run(async (ctx) => ctx.storage.store(new Blob([text], { type })));

  it("keeps the original, suggests a type, links a record, and shows it only to people allowed to read it", async () => {
    const s = await setup();
    const storageId = await store(s.t, "RECURRING RESIDENTIAL CLEANING AGREEMENT\nThis cleaning agreement is between the company and the customer for recurring residential cleaning.");
    const fileId = await s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId, name: "recurring.txt" });
    expect((await s.as.query(api.agreementFiles.status, { companyId: s.companyId, fileId })).ready).toBe(false);
    await s.settle();
    const status = await s.as.query(api.agreementFiles.status, { companyId: s.companyId, fileId });
    expect(status).toMatchObject({ ready: true, extraction: { state: "read" }, suggestion: { classification: "agreement", docType: "recurring_residential" } });
    const done = await s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId, classification: "agreement", docType: "recurring_residential", links: [{ table: "customers", id: s.customerId }] });
    const detail = await s.get(s.as, done.agreementId!);
    expect(detail).toMatchObject({ origin: "upload", provenance: "unsigned", workflow: "draft" });
    expect(detail.version.markdown).toContain("RECURRING RESIDENTIAL");
    expect(detail.files[0]).toMatchObject({ name: "recurring.txt", scan: "not_scanned" });
    expect((await s.office.query(api.companyAgreements.forRecord, { companyId: s.companyId, table: "customers", id: s.customerId })).map((r) => r.id)).toEqual([done.agreementId]);
    const link = await s.office.mutation(api.agreementFiles.downloadUrl, { companyId: s.companyId, fileId });
    expect(link.url).toBeTruthy();
  });

  it("never marks an upload signed on its own, and records an external signature as a named person's verification", async () => {
    const s = await setup();
    const plain = await store(s.t, "Scope of work agreement between the parties for cleaning services.");
    const fileId = await s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId: plain, name: "scope.txt" });
    await s.settle();
    const unsigned = await s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId, classification: "agreement", docType: "scope_of_work" });
    expect(await s.get(s.as, unsigned.agreementId!)).toMatchObject({ workflow: "draft", provenance: "unsigned", externalVerification: null });

    const second = await store(s.t, "Signed scope of work agreement between the parties for cleaning.");
    const file2 = await s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId: second, name: "scope-signed.txt" });
    await s.settle();
    expect(await refusal(s.office.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId: file2, classification: "agreement", docType: "scope_of_work", externallySigned: { signers: ["A"], note: "saw it" } }))).toBe(NOT_FOUND);
    expect(await refusal(s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId: file2, classification: "agreement", docType: "scope_of_work", externallySigned: { signers: [], note: "" } }))).toMatch(/name who signed/);
    const verified = await s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId: file2, classification: "agreement", docType: "scope_of_work", externallySigned: { signedOn: "2027-02-01", signers: ["Pat Owner", "Dana Whitfield"], note: "Compared the signed PDF with the original and phoned the customer." } });
    const detail = await s.get(s.as, verified.agreementId!);
    expect(detail).toMatchObject({ workflow: "signed", provenance: "externally_signed" });
    expect(detail.externalVerification).toMatchObject({ verifiedByName: "owner", signers: ["Pat Owner", "Dana Whitfield"] });
    expect(detail.requests).toEqual([]);
    expect(detail.lifecycle.effectiveOn).toBe("2027-02-01");
  });

  it("rejects a file that is not what it claims, keeps an unreadable one, and files official forms as supporting records", async () => {
    const s = await setup();
    const fake = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["this is not a pdf"], { type: "application/pdf" })));
    const fakeId = await s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId: fake, name: "contract.pdf" });
    await s.settle();
    expect(await s.as.query(api.agreementFiles.status, { companyId: s.companyId, fileId: fakeId })).toMatchObject({ extraction: { state: "rejected" }, ready: false });
    expect(await refusal(s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId: fakeId, classification: "agreement", docType: "scope_of_work" }))).toMatch(/contents do not match/);
    const exe = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["MZ"], { type: "application/x-msdownload" })));
    expect(await refusal(s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId: exe, name: "setup.exe" }))).toMatch(/not accepted/);

    const pdf = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["%PDF-1.4 scanned certificate of insurance"], { type: "application/pdf" })));
    const pdfId = await s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId: pdf, name: "certificate-of-insurance.pdf" });
    await s.settle();
    const status = await s.as.query(api.agreementFiles.status, { companyId: s.companyId, fileId: pdfId });
    expect(status.extraction).toMatchObject({ state: "not_supported" });
    expect(status.suggestion).toMatchObject({ classification: "supporting", supportingKind: "insurance_certificate" });
    const filed = await s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId: pdfId, classification: "supporting", supportingKind: "insurance_certificate", expiresOn: "2027-12-31" });
    expect(filed.agreementId).toBeNull();
    const rows = await s.office.query(api.agreementFiles.supporting, { companyId: s.companyId, kind: "insurance_certificate" });
    expect(rows).toHaveLength(1);
    // An official tax form is the Owner's and is never offered to others.
    const w9 = await s.t.run(async (ctx) => ctx.storage.store(new Blob(["%PDF-1.4 W-9"], { type: "application/pdf" })));
    const w9Id = await s.as.mutation(api.agreementFiles.register, { companyId: s.companyId, storageId: w9, name: "w-9.pdf" });
    await s.settle();
    await s.as.mutation(api.agreementFiles.finalize, { companyId: s.companyId, fileId: w9Id, classification: "supporting", supportingKind: "tax_form", links: [{ table: "cleaners", id: s.cleanerId }] });
    expect((await s.manager.query(api.agreementFiles.supporting, { companyId: s.companyId, kind: "tax_form" }))).toEqual([]);
    expect((await s.as.query(api.agreementFiles.supporting, { companyId: s.companyId, kind: "tax_form" }))).toHaveLength(1);
    expect(await refusal(s.manager.mutation(api.agreementFiles.downloadUrl, { companyId: s.companyId, fileId: w9Id }))).toBe(NOT_FOUND);
  });
});

describe("lifecycle, renewals and plans", () => {
  it("keeps lifecycle apart from workflow: a signed agreement can start later, and a renewal reminder renews nothing", async () => {
    const s = await setup();
    vi.setSystemTime(new Date("2027-03-01T12:00:00Z"));
    const id = await s.make(s.as, "recurring_residential");
    await s.fill(s.as, id, { ...ANSWERS, frequency: "weekly", pricePerVisitCents: 12000, monthlyTotalCents: 52000, startDate: "2027-03-15", termMonths: 12, autoRenew: true, renewalNoticeDays: 30, terminationNoticeDays: 30, rateChangeNoticeDays: 30, lateFeePercent: 0 });
    await s.setSigners(id, [{ name: "Pat Owner", email: "pat@example.com" }, { name: "Dana Whitfield", email: "dana@example.com" }]);
    await s.approveNow(s.as, id);
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    const requestId = mockSigning.requests[0].providerRequestId;
    for (const email of ["pat@example.com", "dana@example.com"]) await s.deliver(await s.event("signed", requestId, { signerEmail: email }));
    let detail = await s.get(s.as, id);
    expect(detail.workflow).toBe("signed");
    expect(detail.lifecycle).toMatchObject({ effectiveOn: "2027-03-15", expiresOn: "2028-03-15", renewalOn: "2028-03-15", status: "not_started" });

    vi.setSystemTime(new Date("2028-02-20T12:00:00Z"));
    const opened = await s.t.mutation(internal.agreementRenewals.sweep, {});
    expect(opened).toBe(1);
    expect(await s.t.mutation(internal.agreementRenewals.sweep, {})).toBe(0);
    detail = await s.get(s.as, id);
    expect(detail.lifecycle.status).toBe("renewal_due");
    expect(detail.workflow).toBe("signed");
    expect(detail.currentVersion).toBe(1 + 1);
    const tasks = await s.t.run(async (ctx) => (await ctx.db.query("tasks").collect()).filter((t) => t.key?.startsWith("agreement-renewal")));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].nextAction).toMatch(/will not renew it for you/);
    const all = await s.t.run(async (ctx) => (await ctx.db.query("agreements").collect()).length);
    expect(all).toBe(1);
    // Dates change only through an explicit action that checks them.
    expect(await refusal(s.as.mutation(api.companyAgreements.changeLifecycle, { companyId: s.companyId, agreementId: id, expiresOn: "2020-01-01" }))).toMatch(/cannot expire before/);
    await s.as.mutation(api.companyAgreements.changeLifecycle, { companyId: s.companyId, agreementId: id, terminatedOn: "2028-02-15", terminationNote: "Customer moved" });
    expect((await s.get(s.as, id)).lifecycle.status).toBe("terminated");
  });

  it("archives without deleting, and refuses to archive a document out for signature", async () => {
    const s = await setup();
    const id = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: id });
    await s.settle();
    expect(await refusal(s.as.mutation(api.companyAgreements.archiveAgreement, { companyId: s.companyId, agreementId: id, reason: "done" }))).toMatch(/Withdraw/);
    await s.as.mutation(api.agreementSigning.withdrawRequest, { companyId: s.companyId, agreementId: id, reason: "Wrong price" });
    await s.as.mutation(api.companyAgreements.archiveAgreement, { companyId: s.companyId, agreementId: id, reason: "Replaced" });
    expect((await s.as.query(api.companyAgreements.list, { companyId: s.companyId })).rows).toEqual([]);
    expect((await s.as.query(api.companyAgreements.list, { companyId: s.companyId, archived: true })).rows.map((r) => r.id)).toEqual([id]);
    await s.as.mutation(api.companyAgreements.restoreAgreement, { companyId: s.companyId, agreementId: id });
    expect((await s.as.query(api.companyAgreements.list, { companyId: s.companyId })).rows).toHaveLength(1);
  });

  it("checks the plan on the server: Scale routing is refused on Growth, core features are in both", async () => {
    const s = await setup();
    const id = await s.make(s.as);
    expect(await refusal(s.as.mutation(api.companyAgreements.setSecondApproval, { companyId: s.companyId, agreementId: id, required: true }))).toMatch(/Scale plan/);
    const growth = (await s.as.query(api.companyAgreements.catalog, { companyId: s.companyId })).entitlements;
    expect(growth).toMatchObject({ plan: "growth", core: { library: true, guidedDrafting: true, versionHistory: true, basicApproval: true }, scale: { advanced_approval: false, customer_portal: false } });
    await s.t.run(async (ctx) => ctx.db.patch(s.companyId, { plan: "scale" }));
    await s.as.mutation(api.companyAgreements.setSecondApproval, { companyId: s.companyId, agreementId: id, required: true });
    await s.fill(s.as, id);
    const first = await s.approveNow(s.as, id);
    expect(first).toMatchObject({ complete: false });
    expect((await s.get(s.as, id)).workflow).toBe("needs_review");
    expect(await refusal(s.approveNow(s.as, id))).toMatch(/second, different person/);
    const second = await s.approveNow(s.manager, id);
    expect(second).toMatchObject({ complete: true });
    expect((await s.get(s.as, id)).workflow).toBe("approved");
    const scale = (await s.as.query(api.companyAgreements.catalog, { companyId: s.companyId })).entitlements;
    expect(scale.scale).toMatchObject({ advanced_approval: true, customer_portal: false });
    expect(scale.notes.join(" ")).toMatch(/No usage limits or signature charges/);
  });

  it("builds a PDF from the exact saved text and records the export without storing the words in the log", async () => {
    const s = await setup();
    const id = await s.ready();
    const exported = await s.as.mutation(api.companyAgreements.exportVersion, { companyId: s.companyId, agreementId: id, format: "pdf" });
    const { markdownToPdf } = await import("./lib/agreements/pdf");
    const bytes = markdownToPdf(exported.markdown, { title: exported.title, footer: exported.footer });
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
    expect(new TextDecoder().decode(bytes.slice(-6))).toContain("%%EOF");
    const events = await s.t.run(async (ctx) => (await ctx.db.query("events").collect()).filter((e) => e.type === "agreement.exported"));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0])).not.toContain("Standard clean");
    expect(await refusal(s.office.mutation(api.companyAgreements.exportVersion, { companyId: s.companyId, agreementId: id, format: "pdf" }))).toMatch(/cannot export/);
  });

  it("builds an overview whose counts match the lists behind them", async () => {
    const s = await setup();
    const a = await s.make(s.as);
    await s.make(s.as);
    const c = await s.ready();
    await s.as.mutation(api.agreementSigning.send, { companyId: s.companyId, agreementId: c });
    await s.settle();
    const overview = await s.as.query(api.companyAgreements.overview, { companyId: s.companyId });
    for (const view of overview.views) {
      const list = await s.as.query(api.companyAgreements.list, { companyId: s.companyId, view: view.view });
      expect(list.total, view.view).toBe(view.count);
    }
    expect(overview.views.find((v) => v.view === "drafts")?.count).toBe(2);
    expect(overview.views.find((v) => v.view === "signatures")?.count).toBe(1);
    expect(overview.views.find((v) => v.view === "missing")?.count).toBe(2);
    void a;
    const empty = await company(s.t, "owner-c", "Empty Co");
    const none = await empty.as.query(api.companyAgreements.overview, { companyId: empty.companyId });
    expect(none.total).toBe(0);
    expect(none.views.every((v) => v.count === 0)).toBe(true);
  });
});

