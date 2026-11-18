/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { company } from "../tests/harness";
import { flush, PROSPECT, salesTestEnv, setup } from "../tests/salesHarness";
import { api } from "./_generated/api";

describe("Sales in the shared workspace", () => {
  let undo: () => void;
  beforeEach(() => {
    undo = salesTestEnv();
  });
  afterEach(() => undo());

  it("writes to an imported prospect only after a person records how they agreed", async () => {
    const s = await setup({ autonomous: true });
    await s.as.mutation(api.sales.importProspects, { companyId: s.companyId, rows: [{ name: "Old Lead", phone: "+15550106060", kind: "residential", note: "Asked about a clean in the spring." }] });
    await flush(s.t);
    const imported = (await s.opportunities()).find((row) => row.source.kind === "import")!;
    const before = await s.opportunity(imported._id);
    expect(before.reach).toMatchObject({ ok: false, code: "no_permission", channel: "sms" });
    expect(s.textsTo("+15550106060")).toHaveLength(0);
    // An import is never accepted as the way someone agreed.
    await expect(s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: { kind: "customer", id: before.customer!.customerId }, channel: "sms", category: "operational", status: "granted", source: "import" })).rejects.toThrow();
    await s.as.mutation(api.consent.record, { companyId: s.companyId, recipient: { kind: "customer", id: before.customer!.customerId }, channel: "sms", category: "operational", status: "granted", source: "verbal", evidence: "Asked us to text a price on the call of March 1." });
    await s.as.mutation(api.sales.work, { companyId: s.companyId, opportunityId: imported._id });
    await flush(s.t);
    expect((await s.opportunity(imported._id)).reach).toMatchObject({ ok: true });
    expect(s.textsTo("+15550106060").length).toBeGreaterThan(0);
  });

  it("shows a Sales proposal in the approvals panel with who it goes to and the exact words", async () => {
    const s = await setup();
    await s.reviewed();
    const { publicId } = await s.publishForm();
    await s.submit(publicId);
    await flush(s.t);
    const approvals = await s.as.query(api.approvals.list, { companyId: s.companyId });
    expect(approvals).toHaveLength(1);
    const detail = await s.as.query(api.details.get, { companyId: s.companyId, ref: { kind: "approval", id: approvals[0]._id }, asOf: Date.now() });
    const facts = Object.fromEntries(detail.context.map((row) => [row.label, row.value]));
    expect(facts.To).toBe(`${PROSPECT.name} by text`);
    expect(facts.Message).toContain("$185.00");
    // The link is a placeholder until the message is really sent.
    expect(facts.Message).toContain("[quote link]");
    expect(facts.Message).not.toContain("/c/quote/");
    // The sidebar counts the same opportunity as waiting on a person.
    expect((await s.as.query(api.overview.sidebar, { companyId: s.companyId, asOf: Date.now() })).sales).toMatchObject({ paused: false, withYou: 1 });
  });

  it("offers an opportunity to Chat as context inside its own company only", async () => {
    const s = await setup({ autonomous: true });
    const { publicId } = await s.publishForm();
    await s.submit(publicId);
    await flush(s.t);
    const opportunity = (await s.opportunities())[0];
    const mine = await s.as.query(api.chat.resolveContext, { companyId: s.companyId, refs: [{ table: "salesOpportunities", id: opportunity._id }] });
    expect(mine).toEqual([{ table: "salesOpportunities", id: opportunity._id, label: `The sales opportunity for ${PROSPECT.name}` }]);
    const other = await company(s.t, "owner-b", "Beta Cleaning");
    expect(await other.as.query(api.chat.resolveContext, { companyId: other.companyId, refs: [{ table: "salesOpportunities", id: opportunity._id }] })).toEqual([]);
  });
});
