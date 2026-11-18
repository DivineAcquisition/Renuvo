/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, dispatchJob, dispatchPlace, NOW, refusal, start } from "../tests/harness";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { NOT_ALLOWED } from "./lib/errors";
import { describeRecord } from "./lib/chat/tools";
import { CLIENT_TOOLS } from "./lib/chat/clientTools";

const DAY = 86_400_000;

async function setup() {
  const t = start();
  const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
  const place = await dispatchPlace(as, companyId);
  return { t, as, companyId, place };
}

/** A completed, priced visit, invoiced and issued with the company's terms. */
async function invoiced(s: Awaited<ReturnType<typeof setup>>, cents: number, daysAgo: number) {
  const jobId = await dispatchJob(s.as, s.companyId, s.place, { priceCents: cents });
  await s.t.run(async (ctx) => ctx.db.patch(jobId, { status: "completed" }));
  const { invoiceId } = await s.as.mutation(api.finance.createInvoice, { companyId: s.companyId, jobId });
  const draft = await s.as.query(api.finance.invoice, { companyId: s.companyId, invoiceId });
  await s.as.mutation(api.finance.issueInvoice, { companyId: s.companyId, invoiceId, revision: draft.revision, dueDate: null });
  if (daysAgo) await s.t.run(async (ctx) => ctx.db.patch(invoiceId, { dueAt: Date.now() - daysAgo * DAY }));
  return invoiceId;
}

describe("Client billing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("keeps invoiced, collected, overdue, due and estimated apart, and shows no card details", async () => {
    const s = await setup();
    const paid = await invoiced(s, 20000, 0);
    await s.as.mutation(api.finance.recordPayment, { companyId: s.companyId, invoiceId: paid, amountCents: 20000, method: "check", receivedOn: "2027-03-01", reference: null, note: null, confirmedReceived: true, clientKey: "client-key-paid-0001" });
    await invoiced(s, 15000, 10); // ten days past due
    await invoiced(s, 9000, 0); // not due yet
    // A booked visit next week: its price is an estimate, not an invoice.
    const later = await dispatchJob(s.as, s.companyId, s.place, { priceCents: 18000 });
    await s.t.run(async (ctx) => {
      const job = (await ctx.db.get(later))!;
      await ctx.db.patch(later, { startsAt: Date.now() + 7 * DAY, endsAt: Date.now() + 7 * DAY + (job.endsAt - job.startsAt) });
    });

    const billing = await s.as.query(api.clientBilling.summary, { companyId: s.companyId, customerId: s.place.customerId });
    expect(billing.amounts).toMatchObject({ invoicedCents: 44000, collectedCents: 20000, overdueCents: 15000, dueCents: 9000, processingCents: 0, estimatedCents: 18000, estimatedVisits: 1 });
    expect(billing.invoices.map((i) => i.stateWords).sort()).toEqual(["Overdue", "Paid", "Requested"]);
    expect(billing.methods).toEqual(["Check"]);
    expect(JSON.stringify(billing)).not.toMatch(/last4|methodLabel|paymentMethodId/);
  });

  it("is the Owner's: a Manager or Office member is refused by the server, not just shown less", async () => {
    const s = await setup();
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const office = await addMember(s.t, s.as, s.companyId, "office-a", "office");
    for (const who of [manager, office]) expect(await refusal(who.query(api.clientBilling.summary, { companyId: s.companyId, customerId: s.place.customerId }))).toBe(NOT_ALLOWED);
  });
});

describe("Clients in Chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("never gives Chat a property's access instructions, and keeps billing to the Owner", async () => {
    const s = await setup();
    await s.as.mutation(api.properties.update, { companyId: s.companyId, propertyId: s.place.propertyId, accessInstructions: "Lockbox 4417, alarm 2580" });
    const manager = await addMember(s.t, s.as, s.companyId, "manager-a", "manager");
    const read = (role: "owner" | "manager", table: "customers" | "properties", id: string) =>
      s.t.run(async (ctx) => {
        const company = (await ctx.db.get(s.companyId))!;
        return describeRecord({ ...ctx, company, role }, table, id);
      });
    for (const role of ["owner", "manager"] as const) {
      const property = await read(role, "properties", s.place.propertyId);
      expect(JSON.stringify(property)).not.toContain("4417");
      expect(property!.data.accessDetails).toContain("never shared in Chat");
    }
    const asOwner = await read("owner", "customers", s.place.customerId);
    const asManager = await read("manager", "customers", s.place.customerId);
    expect(asOwner!.data.billing).toMatchObject({ openInvoices: 0 });
    expect(asManager!.data.billing).toBe("Shown to the Owner only.");
    expect(asOwner!.link).toEqual({ href: `/app/clients/${s.place.customerId}`, label: "Open Dana Whitfield" });
    void manager;
  });

  it("drafts a client message without sending it, and links to Conversations to review it", async () => {
    const s = await setup();
    const tool = CLIENT_TOOLS.find((t) => t.name === "draft_client_message")!;
    expect(tool.kind).toBe("draft");
    const outcome = await s.t.run(async (ctx) => {
      const company = (await ctx.db.get(s.companyId))!;
      const member = (await ctx.db.query("members").first())!;
      return tool.run({ ...ctx, company, member, role: "owner" } as never, { customerId: s.place.customerId, channel: "sms", body: "Running 10 minutes late today." });
    });
    expect(outcome).toMatchObject({ status: "done", summary: "Drafted a text to Dana Whitfield. Nothing was sent." });
    expect((outcome as { link: { href: string } }).link.href).toBe(`/app/clients/${s.place.customerId}/conversations?draft=Running+10+minutes+late+today.&channel=sms`);
    expect(await s.t.run(async (ctx) => (await ctx.db.query("messages").collect()).length)).toBe(0);
    void (s.place.customerId as Id<"customers">);
  });
});
