/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, refusal, start } from "../tests/harness";
import { ADMIN, REVIEWER } from "../tests/trustHarness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";
import { consentGaps, defaultConsentWording } from "./lib/messaging/campaign";
import { numberFeesWording } from "./lib/messagingBilling/wording";

/** Lets the scheduled search run: the clock moves a moment, then whatever started is finished. */
async function flush(t: ReturnType<typeof start>) {
  for (let i = 0; i < 4; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

/**
 * A stand-in for Telnyx's account API that answers like the real one over time: a number order is
 * pending once, a brand and a campaign are pending until checked a second time. It records every
 * call so the test can see that nothing is bought or filed twice.
 */
function fakeTelnyx(options: { brandResult?: string } = {}) {
  const calls: { method: string; path: string; body: unknown; key: string | null }[] = [];
  const seen: Record<string, number> = {};
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const { pathname, search } = new URL(url);
    const path = decodeURIComponent(pathname).replace("/v2", "");
    const method = init.method ?? "GET";
    calls.push({ method, path: `${path}${search}`, body: init.body ? JSON.parse(String(init.body)) : null, key: (init.headers as Record<string, string>)["idempotency-key"] ?? null });
    const times = (seen[`${method} ${path}`] = (seen[`${method} ${path}`] ?? 0) + 1);
    if (method === "GET" && path === "/available_phone_numbers") {
      return json({ data: [{ phone_number: "+15125550142", region_information: [{ region_type: "location", region_name: "AUSTIN" }, { region_type: "state", region_name: "TX" }], cost_information: { upfront_cost: "1.00000", monthly_cost: "1.00000", currency: "USD" } }] });
    }
    if (method === "POST" && path === "/number_orders") return json({ data: { id: "order-1", status: "pending" } });
    if (method === "GET" && path === "/number_orders/order-1") return json({ data: { id: "order-1", status: times === 1 ? "pending" : "success" } });
    if (method === "POST" && path === "/10dlc/brand") return json({ brandId: "brand-1", identityStatus: null });
    if (method === "GET" && path === "/10dlc/brand/brand-1") return json({ brandId: "brand-1", identityStatus: times === 1 ? null : (options.brandResult ?? "VERIFIED"), failureReasons: options.brandResult === "UNVERIFIED" ? [{ description: "EIN does not match the legal name." }] : null });
    if (method === "POST" && path === "/10dlc/campaignBuilder") return json({ campaignId: "campaign-1", campaignStatus: "TCR_PENDING" });
    if (method === "GET" && path === "/10dlc/campaign/campaign-1") return json({ campaignId: "campaign-1", campaignStatus: times === 1 ? "TCR_ACCEPTED" : "MNO_PROVISIONED" });
    if (method === "POST" && path === "/10dlc/phone_number_campaigns") return json({ phoneNumber: "+15125550142", campaignId: "campaign-1", assignmentStatus: "PENDING_ASSIGNMENT" });
    if (method === "GET" && path === "/10dlc/phone_number_campaigns/+15125550142") return json({ phoneNumber: "+15125550142", assignmentStatus: "ASSIGNED" });
    return json({ errors: [{ code: "10005", title: "Resource not found" }] }, 404);
  };
  return { fetcher, calls };
}

const brand = {
  displayName: "Alpha Cleaning",
  companyName: "Alpha Cleaning LLC",
  ein: "12-3456789",
  phone: "+15125550100",
  street: "1 Main St",
  city: "Austin",
  state: "tx",
  postalCode: "78701",
  email: "help@alpha.example",
  website: "https://alpha.example",
  vertical: "PROFESSIONAL",
};

describe("Texting: a number and a carrier registration, asked for by the Owner and approved by Selestial", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TELNYX_API_KEY = "KEY_test";
    process.env.STAFF_BOOTSTRAP_EMAIL = ADMIN.email;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.TELNYX_API_KEY;
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  it("buys nothing until an admin approves, then files the company's own brand and campaign once each", async () => {
    const telnyx = fakeTelnyx();
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const manager = await addMember(t, as, companyId, "manager-1", "manager");
    const admin = t.withIdentity(ADMIN);
    await admin.mutation(api.staff.add, { email: REVIEWER.email, name: REVIEWER.name, role: "reviewer" });
    const reviewer = t.withIdentity(REVIEWER);

    // Searching: only the Owner, and only a real area code.
    expect(await refusal(as.mutation(api.texting.searchNumbersFor, { companyId, areaCode: "12" }))).toContain("three-digit US area code");
    expect(await refusal(manager.mutation(api.texting.searchNumbersFor, { companyId, areaCode: "512" }))).toBe("Not allowed.");
    const searchId = await as.mutation(api.texting.searchNumbersFor, { companyId, areaCode: "512" });
    await flush(t);
    const found = await as.query(api.texting.search, { companyId, searchId });
    expect(found).toMatchObject({ status: "done", results: [{ phoneNumber: "+15125550142", locality: "AUSTIN", region: "TX", upfrontCents: 100, monthlyCents: 100 }] });

    // Asking: the consent wording must say what carriers require, and only a searched number can be asked for.
    const ask = (fields: Partial<Parameters<typeof as.mutation<typeof api.texting.request>>[1]> = {}) => as.mutation(api.texting.request, { companyId, searchId, phoneNumber: "+15125550142", brand, consentWording: defaultConsentWording("Alpha Cleaning"), ...fields });
    expect(await refusal(ask({ phoneNumber: "+15125559999" }))).toBe("Choose a number from your search.");
    expect(await refusal(ask({ consentWording: "You agree to texts from Alpha Cleaning." }))).toContain("say how to opt out (STOP)");
    expect(await refusal(ask({ brand: { ...brand, ein: "123" } }))).toContain("9-digit");
    const requestId = await ask();
    expect(await refusal(ask())).toContain("already a request open");
    expect(await as.query(api.texting.mine, { companyId })).toMatchObject({ status: "requested", phoneNumber: "+15125550142", brand: { ein: "•••••6789", state: "TX" } });
    // Searching is the only call Telnyx has had. Nothing is bought or filed by asking.
    expect(telnyx.calls.map((call) => `${call.method} ${call.path.split("?")[0]}`)).toEqual(["GET /available_phone_numbers"]);

    // Approving: staff only, and only an admin, because it spends money.
    expect(await refusal(as.mutation(api.texting.approve, { requestId }))).toBe("Not found.");
    expect(await refusal(reviewer.mutation(api.texting.approve, { requestId }))).toBe("Not allowed.");
    expect((await admin.query(api.texting.queue, {})).map((row) => [row.company, row.status])).toEqual([["Alpha Cleaning", "requested"]]);
    await admin.mutation(api.texting.approve, { requestId, note: "Checked the EIN." });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const done = await as.query(api.texting.mine, { companyId });
    expect(done).toMatchObject({ status: "active", step: "Active. Texts go out from this number." });
    const profile = await as.query(api.compliance.profile, { companyId });
    expect(profile.messaging).toMatchObject({ smsNumber: "+15125550142", senderName: "Alpha Cleaning", registration: { status: "approved", updatedBy: "staff", reference: "campaign-1" } });
    const disclosures = await as.query(api.compliance.disclosures, { companyId });
    expect(disclosures.find((row) => row.channel === "sms" && row.category === "operational")?.text).toBe(defaultConsentWording("Alpha Cleaning"));

    // Each thing that costs money happened once, with the company's own details.
    const posts = telnyx.calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.path)).toEqual(["/number_orders", "/10dlc/brand", "/10dlc/campaignBuilder", "/10dlc/phone_number_campaigns"]);
    expect(posts[0].key).toBe(`selestial-number-${requestId}`);
    expect(posts[1].body).toMatchObject({ entityType: "PRIVATE_PROFIT", country: "US", displayName: "Alpha Cleaning", companyName: "Alpha Cleaning LLC", ein: "123456789", state: "TX" });
    expect(posts[2].body).toMatchObject({ brandId: "brand-1", usecase: "ACCOUNT_NOTIFICATION" });
    expect((posts[2].body as { sample1: string }).sample1).toMatch(/^Alpha Cleaning: job offer\./);
    expect((posts[2].body as { messageFlow: string }).messageFlow).toContain(defaultConsentWording("Alpha Cleaning"));
    expect(posts[3].body).toEqual({ phoneNumber: "+15125550142", campaignId: "campaign-1" });
  });

  it("stops and says why when the carriers cannot verify the company, and a retry files nothing twice", async () => {
    const telnyx = fakeTelnyx({ brandResult: "UNVERIFIED" });
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const admin = t.withIdentity(ADMIN);
    const searchId = await as.mutation(api.texting.searchNumbersFor, { companyId, areaCode: "512" });
    await flush(t);
    const requestId = await as.mutation(api.texting.request, { companyId, searchId, phoneNumber: "+15125550142", brand, consentWording: defaultConsentWording("Alpha Cleaning") });
    // A request nobody has acted on can be withdrawn; one Selestial has started cannot.
    await admin.mutation(api.texting.approve, { requestId });
    expect(await refusal(as.mutation(api.texting.cancel, { companyId, requestId }))).toContain("already started");
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const failed = await as.query(api.texting.mine, { companyId });
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed!.problem).toContain("could not verify the company (UNVERIFIED). EIN does not match the legal name.");
    const profile = await as.query(api.compliance.profile, { companyId });
    expect(profile.messaging.smsNumber).toBeUndefined();

    await admin.mutation(api.texting.retry, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // The number was bought and the brand filed once, however many times it ran.
    const posts = telnyx.calls.filter((call) => call.method === "POST").map((call) => call.path);
    expect(posts).toEqual(["/number_orders", "/10dlc/brand"]);
  });

  it("charges the number and its registration from the messaging balance only with the Owner's authorization, each once", async () => {
    process.env.MESSAGING_BILLING = "on";
    try {
      vi.setSystemTime(Date.UTC(2026, 10, 19, 15));
      const telnyx = fakeTelnyx();
      vi.stubGlobal("fetch", telnyx.fetcher);
      const t = start();
      const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
      await t.action(internal.billing.syncCompany, { companyId });
      billing.seed(companyId, { messaging: { purchased: 10_000, promo: 0, promoExpiresAt: null, used: 0 } });
      await t.action(internal.billing.syncCompany, { companyId });
      const admin = t.withIdentity(ADMIN);
      const searchId = await as.mutation(api.texting.searchNumbersFor, { companyId, areaCode: "512" });
      await flush(t);
      // Telnyx's own price is Selestial's cost and is not what the company pays.
      const terms = await as.query(api.texting.feeTerms, { companyId });
      expect(terms).toMatchObject({ required: true, monthly: 30_000, wording: numberFeesWording(30_000) });
      expect(terms.wording).toContain("$3.00 a month");
      expect(terms.wording).toContain("A low balance never releases the number.");
      const ask = (feesWording?: string) => as.mutation(api.texting.request, { companyId, searchId, phoneNumber: "+15125550142", brand, consentWording: defaultConsentWording("Alpha Cleaning"), ...(feesWording ? { feesWording } : {}) });
      expect(await refusal(ask())).toMatch(/accept the number and registration fees/);
      expect(await refusal(ask("I agree"))).toMatch(/accept the number and registration fees/);
      const requestId = await ask(terms.wording);
      // Nothing is charged by asking.
      expect(await t.run(async (ctx) => ctx.db.query("messagingCharges").collect())).toHaveLength(0);
      await admin.mutation(api.texting.approve, { requestId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect(await as.query(api.texting.mine, { companyId })).toMatchObject({ status: "active" });
      const fees = async () => (await t.run(async (ctx) => ctx.db.query("messagingCharges").collect())).filter((row) => row.kind === "number_monthly" || row.kind === "registration_fee");
      expect((await fees()).map((row) => [row.kind, row.amount])).toEqual([["number_monthly", 30_000]]);
      // The daily sweep doesn't charge the same month twice; the next month is charged once.
      await t.mutation(internal.texting.chargeNumbers, {});
      expect(await fees()).toHaveLength(1);
      vi.setSystemTime(Date.UTC(2026, 11, 2, 15));
      await t.mutation(internal.texting.chargeNumbers, {});
      await t.mutation(internal.texting.chargeNumbers, {});
      expect((await fees()).map((row) => row.activity)).toEqual(["Texting number +15125550142, 2026-11", "Texting number +15125550142, 2026-12"]);
      // A registration fee at actual cost, entered by staff, once per key.
      await admin.mutation(api.texting.chargeRegistrationFee, { requestId, cents: 1_550, description: "Campaign vetting", key: "vetting" });
      await admin.mutation(api.texting.chargeRegistrationFee, { requestId, cents: 1_550, description: "Campaign vetting", key: "vetting" });
      expect(await refusal(as.mutation(api.texting.chargeRegistrationFee, { requestId, cents: 100, description: "x", key: "y" }))).toBe("Not found.");
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await fees()).filter((row) => row.kind === "registration_fee").map((row) => [row.activity, row.amount])).toEqual([["Carrier registration: Campaign vetting", 155_000]]);
      // The fees took the $1.00 balance below zero. The number is still active: a low balance never releases it.
      expect(billing.messagingLeft(billing.customerFor(`company_${companyId}`))).toBe(10_000 - 30_000 - 30_000 - 155_000);
      expect(await as.query(api.texting.mine, { companyId })).toMatchObject({ status: "active" });
    } finally {
      delete process.env.MESSAGING_BILLING;
    }
  });

  it("checks consent wording for what carriers require", () => {
    expect(consentGaps(defaultConsentWording("Bravo Maids"), "Bravo Maids")).toEqual([]);
    expect(consentGaps("Texts from someone. Reply STOP.", "Bravo Maids")).toEqual(["name the business (Bravo Maids)", "say how to get help (HELP)", 'say "Msg & data rates may apply"', 'say how often texts come (for example "Msg frequency varies")']);
  });
});
