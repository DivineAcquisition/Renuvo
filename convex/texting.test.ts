/**
 * @vitest-environment edge-runtime
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addMember, company, refusal, start, type T } from "../tests/harness";
import { ADMIN } from "../tests/trustHarness";
import { billing } from "../tests/setupBilling";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { draftFor, draftGaps } from "./lib/texting/drafts";
import { planFor } from "./lib/texting/plan";

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 7)));
const NUMBER = "+15125550142";
const OTHER = "+15125550143";

type Call = { method: string; path: string; body: Record<string, unknown> | null };

/**
 * A stand-in for Telnyx's account API that keeps state like the real one: orders, brands and campaigns
 * exist once created, can be listed by their references, and answer "pending" until checked again. Every
 * call is recorded, so a test can see that nothing paid for happened twice.
 */
function fakeTelnyx(options: { brand?: (checks: number) => Record<string, unknown>; campaign?: (checks: number) => string; assignment?: (checks: number) => string; available?: () => boolean; loseFirstOrderAnswer?: boolean } = {}) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
  const orders: { id: string; reference: string; checks: number }[] = [];
  const campaigns: { campaignId: string; referenceId: string }[] = [];
  let brandMade = false;
  let lostOne = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const count = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);
  const fetcher = async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname !== "api.telnyx.com") return new Response("<html><body><h1>Alpha Cleaning</h1></body></html>", { status: 200 });
    const path = decodeURIComponent(url.pathname).replace("/v2", "");
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path: `${path}${url.search ? decodeURIComponent(url.search) : ""}`, body });
    if (method === "GET" && path === "/available_phone_numbers") {
      const endsWith = url.searchParams.get("filter[phone_number][ends_with]");
      const all = [
        { phone_number: NUMBER, region_information: [{ region_type: "location", region_name: "AUSTIN" }, { region_type: "state", region_name: "TX" }], cost_information: { upfront_cost: "1.00", monthly_cost: "1.00", currency: "USD" }, features: [{ name: "sms" }, { name: "mms" }, { name: "voice" }] },
        { phone_number: OTHER, region_information: [{ region_type: "location", region_name: "AUSTIN" }, { region_type: "state", region_name: "TX" }], cost_information: { upfront_cost: "1.00", monthly_cost: "1.00", currency: "USD" }, features: [{ name: "sms" }] },
      ];
      if (endsWith) return json({ data: all.filter((row) => row.phone_number.endsWith(endsWith) && (options.available?.() ?? true)) });
      return json({ data: all });
    }
    if (method === "POST" && path === "/number_orders") {
      const order = { id: `order-${orders.length + 1}`, reference: String(body?.customer_reference), checks: 0 };
      orders.push(order);
      if (options.loseFirstOrderAnswer && !lostOne) {
        lostOne = true;
        throw new TypeError("network connection lost");
      }
      return json({ data: { id: order.id, status: "pending" } });
    }
    if (method === "GET" && path === "/number_orders") {
      const reference = url.searchParams.get("filter[customer_reference]");
      return json({ data: orders.filter((row) => row.reference === reference).map((row) => ({ id: row.id, status: "pending" })) });
    }
    if (method === "GET" && path.startsWith("/number_orders/")) {
      const order = orders.find((row) => row.id === path.split("/")[2])!;
      order.checks += 1;
      return json({ data: { id: order.id, status: order.checks === 1 ? "pending" : "success" } });
    }
    if (method === "POST" && path === "/10dlc/brand") {
      brandMade = true;
      return json({ brandId: "brand-1", identityStatus: null, status: "REGISTRATION_PENDING" });
    }
    if (method === "GET" && path === "/10dlc/brand") return json({ records: brandMade ? [{ brandId: "brand-1", displayName: body?.displayName ?? "Alpha Cleaning", email: "help@alpha.example" }] : [], page: 1, totalRecords: brandMade ? 1 : 0 });
    if (method === "GET" && path === "/10dlc/brand/brand-1") {
      const n = count("brand");
      return json({ brandId: "brand-1", ...(options.brand?.(n) ?? (n === 1 ? { identityStatus: null, status: "REGISTRATION_PENDING" } : { identityStatus: "VERIFIED", status: "OK" })) });
    }
    if (method === "PUT" && (path === "/10dlc/brand/brand-1" || path === "/10dlc/brand/brand-1/revet")) {
      counts.brand = 0;
      return json({ brandId: "brand-1", identityStatus: null, status: "REGISTRATION_PENDING" });
    }
    if (method === "POST" && path === "/10dlc/brand/brand-1/smsOtp") return json({ referenceId: "otp-1" });
    if (method === "PUT" && path === "/10dlc/brand/brand-1/smsOtp") return body?.otpPin === "123456" ? json({}) : json({ errors: [{ code: "10015", title: "Invalid OTP" }] }, 400);
    if (method === "POST" && path === "/10dlc/campaignBuilder") {
      const campaign = { campaignId: `campaign-${campaigns.length + 1}`, referenceId: String(body?.referenceId) };
      campaigns.push(campaign);
      return json({ ...campaign, campaignStatus: "TCR_PENDING" });
    }
    if (method === "GET" && path === "/10dlc/campaign") return json({ records: campaigns.map((row) => ({ ...row, campaignStatus: "TCR_PENDING" })), page: 1 });
    if (method === "GET" && path.startsWith("/10dlc/campaign/")) {
      const id = path.split("/")[3];
      const n = count(`campaign:${id}`);
      return json({ campaignId: id, campaignStatus: options.campaign?.(n) ?? (n === 1 ? "TCR_ACCEPTED" : "MNO_PROVISIONED"), status: "ACTIVE" });
    }
    if (method === "PUT" && path.startsWith("/10dlc/campaign/")) {
      counts[`campaign:${path.split("/")[3]}`] = 10;
      return json({ campaignId: path.split("/")[3], campaignStatus: "MNO_REJECTED" });
    }
    if (method === "POST" && path.endsWith("/appeal")) return json({});
    if (method === "POST" && path === "/10dlc/phone_number_campaigns") return json({ phoneNumber: body?.phoneNumber, campaignId: body?.campaignId, assignmentStatus: "PENDING_ASSIGNMENT" });
    if (method === "GET" && path.startsWith("/10dlc/phone_number_campaigns/")) return json({ phoneNumber: NUMBER, assignmentStatus: options.assignment?.(count("assignment")) ?? "ASSIGNED" });
    return json({ errors: [{ code: "10005", title: "Resource not found" }] }, 404);
  };
  const posts = () => calls.filter((call) => call.method !== "GET").map((call) => `${call.method} ${call.path}`);
  return { fetcher, calls, posts, counts };
}

async function settle(t: T) {
  for (let i = 0; i < 4; i += 1) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

type As = ReturnType<T["withIdentity"]>;

async function revision(as: As, companyId: Id<"companies">) {
  return (await as.query(api.textingSetup.view, { companyId }))!.setup.revision;
}

const BUSINESS = { entityType: "PRIVATE_PROFIT", displayName: "Alpha Cleaning", legalName: "Alpha Cleaning LLC", street: "1 Main St", city: "Austin", state: "tx", postalCode: "78701", website: "alpha.example", supportEmail: "Help@Alpha.example", supportPhone: "(512) 555-0100" };

/** Everything an owner does before submitting: their business, what they'll send, permission and pages, a number. */
async function prepare(t: T, as: As, companyId: Id<"companies">, change: { business?: Record<string, string>; activities?: string[]; taxId?: string | null } = {}) {
  await as.mutation(api.textingSetup.open, { companyId });
  await as.mutation(api.textingSetup.save, { companyId, revision: await revision(as, companyId), business: { ...BUSINESS, ...change.business } });
  if (change.taxId !== null) await as.mutation(api.textingSetup.setTaxId, { companyId, revision: await revision(as, companyId), taxId: change.taxId ?? "12-3456789" });
  await as.mutation(api.textingSetup.save, { companyId, revision: await revision(as, companyId), activities: change.activities ?? ["inquiry_replies", "job_offers", "arrival_reminders", "promotions"], places: ["booking_form", "team_onboarding"] });
  await as.mutation(api.textingSetup.publish, { companyId, revision: await revision(as, companyId) });
  await settle(t);
  const searchId = await as.mutation(api.texting.searchNumbersFor, { companyId, areaCode: "512" });
  await settle(t);
  await as.mutation(api.textingSetup.chooseNumber, { companyId, revision: await revision(as, companyId), searchId, phoneNumber: NUMBER });
  return searchId;
}

async function submit(as: As, companyId: Id<"companies">) {
  const view = (await as.query(api.textingSetup.view, { companyId }))!;
  return as.mutation(api.textingSetup.submit, { companyId, revision: view.setup.revision, authorization: view.charges.wording });
}

describe("Set up business texting", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TELNYX_API_KEY = "KEY_test";
    process.env.MAILBOX_TOKEN_KEY = KEY;
    process.env.STAFF_BOOTSTRAP_EMAIL = ADMIN.email;
    process.env.TELNYX_WEBHOOK_URL = "https://deployment.convex.site.test";
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const name of ["TELNYX_API_KEY", "MAILBOX_TOKEN_KEY", "STAFF_BOOTSTRAP_EMAIL", "TELNYX_WEBHOOK_URL", "MESSAGING_BILLING"]) delete process.env[name];
  });

  it("opens one saved setup, prefilled with where each detail came from, and resumes it after a reload", async () => {
    vi.stubGlobal("fetch", fakeTelnyx().fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await as.mutation(api.compliance.updateIdentity, { companyId, legalName: "Alpha Cleaning LLC", address: { line1: "1 Main St", city: "Austin", region: "TX", postalCode: "78701", country: "US" }, supportEmail: "help@alpha.example" });
    const first = await as.mutation(api.textingSetup.open, { companyId });
    expect(await as.mutation(api.textingSetup.open, { companyId })).toBe(first);
    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(view.setup.step).toBe("business");
    expect(view.setup.business).toMatchObject({ displayName: "Alpha Cleaning", legalName: "Alpha Cleaning LLC", street: "1 Main St", city: "Austin", state: "TX", postalCode: "78701", supportEmail: "help@alpha.example" });
    expect(view.sources.find((row) => row.field === "street")).toMatchObject({ source: "profile", confirmed: false });
    expect(view.setup.notes.map((note) => note.words)).toContain("I filled in your business address from your company profile. Please confirm it matches your registration records.");
    expect(view.sources.find((row) => row.field === "displayName")).toMatchObject({ confirmed: false });
    // Selestial says what it did, and only that.
    expect(view.setup.notes.some((note) => /^I filled in your business name from/.test(note.words))).toBe(true);
    expect(view.setup.notes.some((note) => /Professional services/.test(note.words))).toBe(true);

    // Confirming and moving on is saved; a stale revision is refused rather than overwriting.
    const r1 = await revision(as, companyId);
    await as.mutation(api.textingSetup.save, { companyId, revision: r1, confirm: ["displayName"], step: "activities" });
    expect(await refusal(as.mutation(api.textingSetup.save, { companyId, revision: r1, step: "number" }))).toContain("another window");
    const again = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(again.setup.step).toBe("activities");
    expect(again.sources.find((row) => row.field === "displayName")?.confirmed).toBe(true);

    // Only the owner can see or change it.
    const manager = await addMember(t, as, companyId, "manager-1", "manager");
    expect(await refusal(manager.query(api.textingSetup.view, { companyId }))).toBe("Not allowed.");
    expect(await refusal(manager.mutation(api.textingSetup.save, { companyId, revision: await revision(as, companyId), step: "number" }))).toBe("Not allowed.");
  });

  it("seals the EIN and only ever shows its last four digits", async () => {
    vi.stubGlobal("fetch", fakeTelnyx().fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await as.mutation(api.textingSetup.open, { companyId });
    expect(await refusal(as.mutation(api.textingSetup.setTaxId, { companyId, revision: await revision(as, companyId), taxId: "123" }))).toContain("9 digits");
    await as.mutation(api.textingSetup.setTaxId, { companyId, revision: await revision(as, companyId), taxId: "12-3456789" });
    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(view.setup.taxIdLast4).toBe("6789");
    expect(JSON.stringify(view)).not.toContain("123456789");
    const stored = await t.run(async (ctx) => ({ setups: await ctx.db.query("textingSetups").collect(), events: await ctx.db.query("events").collect() }));
    expect(JSON.stringify(stored)).not.toContain("123456789");
    expect(stored.setups[0].taxId?.sealed).toBeTruthy();
    // Without the key, nothing is stored in the clear: it is refused.
    delete process.env.MAILBOX_TOKEN_KEY;
    expect(await refusal(as.mutation(api.textingSetup.setTaxId, { companyId, revision: await revision(as, companyId), taxId: "98-7654321" }))).toContain("can't store your EIN securely");
  });

  it("drafts the company's own pages and wording, keeps the owner's edits, and records sign-ups against the exact version shown", async () => {
    vi.stubGlobal("fetch", fakeTelnyx().fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await prepare(t, as, companyId);
    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(view.drafts.every((row) => row.gaps.length === 0)).toBe(true);
    expect(view.setup.drafts.privacy.text).toContain("Alpha Cleaning LLC (doing business as Alpha Cleaning)");
    expect(view.setup.drafts.privacy.text).toMatch(/do not sell or share your mobile phone number/);
    expect(view.setup.drafts.marketing_consent.text).toContain("offers and promotions");
    expect(view.setup.drafts.sms_consent.text).not.toMatch(/promotion|offer/);
    // The company's own pages, on its own public address. Never Selestial's policy.
    const links = Object.fromEntries(view.pages.map((row) => [row.kind, row.url]));
    expect(links.privacy).toMatch(/\/b\/alpha-cleaning\/legal\/privacy$/);
    expect(JSON.stringify(view.pages)).not.toContain("selestial.io/privacy");
    expect(view.pages.every((row) => row.state === "published" && row.check?.ok)).toBe(true);
    expect(view.places.map((row) => [row.place, row.state])).toEqual([
      ["booking_form", "records"],
      ["team_onboarding", "records"],
    ]);

    // An edit is the owner's: changing their details later never rewrites it.
    await as.mutation(api.textingSetup.save, { companyId, revision: await revision(as, companyId), drafts: { help_reply: "Alpha Cleaning: call (512) 555-0100 for help. Reply STOP to opt out." } });
    await as.mutation(api.textingSetup.save, { companyId, revision: await revision(as, companyId), business: { supportPhone: "(512) 555-0199" } });
    const edited = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(edited.setup.drafts.help_reply).toMatchObject({ edited: true, text: "Alpha Cleaning: call (512) 555-0100 for help. Reply STOP to opt out." });
    expect(edited.setup.drafts.terms.text).toContain("(512) 555-0199".replace(/\D/g, "").slice(-4));

    // Anyone can read the published pages; a sign-up records exactly what that version said.
    const page = await t.query(api.textingPublic.page, { handle: "alpha-cleaning", kind: "signup" });
    expect(page).toMatchObject({ company: { name: "Alpha Cleaning" }, kind: "signup", version: 1 });
    expect(await t.query(api.textingPublic.page, { handle: "nobody-here", kind: "privacy" })).toBeNull();
    process.env.PUBLIC_FORM_SECRET = "form-secret";
    try {
      const sign = (fields: Partial<{ version: number; texts: boolean; marketing: boolean; phone: string }> = {}) => t.mutation(api.textingPublic.signup, { secret: "form-secret", handle: "alpha-cleaning", version: 1, name: "Casey Park", phone: "(512) 555-0177", texts: true, marketing: false, visitorKey: "v1", ...fields });
      expect(await sign({ version: 2 })).toMatchObject({ refused: expect.stringContaining("just updated") });
      expect(await sign({ texts: false })).toMatchObject({ refused: expect.stringContaining("Nothing was recorded") });
      expect(await sign()).toMatchObject({ ok: true });
      const permissions = await t.run(async (ctx) => ctx.db.query("contactPermissions").collect());
      const disclosure = await t.run(async (ctx) => ctx.db.get(permissions[0].disclosureId!));
      expect(permissions).toHaveLength(1);
      expect(permissions[0]).toMatchObject({ channel: "sms", category: "operational", status: "granted", source: "web_form", recordedBy: { kind: "recipient" } });
      expect(permissions[0].evidence).toContain("version 1");
      expect(disclosure?.text).toBe(page!.body);
      // Marketing is its own permission, only when the person checks its own box.
      await sign({ marketing: true });
      const marketing = await t.run(async (ctx) => (await ctx.db.query("contactPermissions").collect()).filter((row) => row.category === "marketing"));
      expect(marketing).toHaveLength(1);
    } finally {
      delete process.env.PUBLIC_FORM_SECRET;
    }
  });

  it("recommends one registration for what was chosen, by content and audience", () => {
    expect(planFor(["job_offers", "arrival_reminders"], "PRIVATE_PROFIT")).toMatchObject({ usecase: "ACCOUNT_NOTIFICATION", subUsecases: [], coverage: [{ audience: "cleaner", category: "operational" }] });
    expect(planFor(["inquiry_replies", "job_offers", "promotions"], "PRIVATE_PROFIT")).toMatchObject({ usecase: "MIXED", subUsecases: ["CUSTOMER_CARE", "ACCOUNT_NOTIFICATION", "MARKETING"], marketing: true });
    expect(planFor(["inquiry_replies"], "SOLE_PROPRIETOR")).toMatchObject({ usecase: "SOLE_PROPRIETOR" });
    expect(planFor([], "PRIVATE_PROFIT")).toBeNull();
    const input = { name: "Bravo Maids", activities: ["inquiry_replies"], marketingPerWeek: 2, links: { privacy: "https://x.test/p", terms: "https://x.test/t" }, places: [] };
    expect(draftGaps("sms_consent", draftFor("sms_consent", input), input)).toEqual([]);
    expect(draftGaps("sms_consent", "Texts from us. Reply STOP. Get our best deals!", input)).toEqual(expect.arrayContaining(["name your business (Bravo Maids)", "say how to get help (HELP)", "leave promotions out (they need their own, separate permission)"]));
  });

  it("files nothing until Selestial review approves, then registers, buys and connects in order, each once", async () => {
    const telnyx = fakeTelnyx();
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const admin = t.withIdentity(ADMIN);

    // Submitting needs everything, and the charges accepted in the exact words shown.
    await as.mutation(api.textingSetup.open, { companyId });
    const early = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(await refusal(as.mutation(api.textingSetup.submit, { companyId, revision: early.setup.revision, authorization: early.charges.wording }))).toBeTruthy();
    await prepare(t, as, companyId);
    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(await refusal(as.mutation(api.textingSetup.submit, { companyId, revision: view.setup.revision, authorization: "I agree" }))).toContain("accept the charges");
    const { requestId } = await submit(as, companyId);
    expect(await refusal(submit(as, companyId))).toContain("already with Selestial");
    // Searching is all Telnyx has seen: nothing is filed or bought by submitting.
    expect(telnyx.posts()).toEqual([]);
    const progress = (await as.query(api.textingSetup.view, { companyId }))!.request!;
    expect(progress.milestones.map((row) => [row.key, row.state])).toEqual([
      ["submitted", "working"],
      ["business", "waiting"],
      ["messaging", "waiting"],
      ["purchase", "waiting"],
      ["connection", "waiting"],
      ["ready", "waiting"],
    ]);

    expect(await refusal(as.mutation(api.texting.approve, { requestId }))).toBe("Not found.");
    await admin.mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const done = (await as.query(api.textingSetup.view, { companyId }))!.request!;
    expect(done.status).toBe("active");
    expect(done.milestones.every((row) => row.state === "done")).toBe(true);
    // In order: the business, then the campaign, then (only after approval) the number, then the connection.
    expect(telnyx.posts()).toEqual(["POST /10dlc/brand", "POST /10dlc/campaignBuilder", "POST /number_orders", "POST /10dlc/phone_number_campaigns"]);
    const brand = telnyx.calls.find((call) => call.path === "/10dlc/brand" && call.method === "POST")!.body!;
    expect(brand).toMatchObject({ entityType: "PRIVATE_PROFIT", displayName: "Alpha Cleaning", companyName: "Alpha Cleaning LLC", ein: "12-3456789", state: "TX", website: "https://alpha.example", email: "help@alpha.example", webhookURL: "https://deployment.convex.site.test/webhooks/telnyx" });
    const campaign = telnyx.calls.find((call) => call.path === "/10dlc/campaignBuilder")!.body!;
    expect(campaign).toMatchObject({ brandId: "brand-1", usecase: "MIXED", subUsecases: ["CUSTOMER_CARE", "ACCOUNT_NOTIFICATION", "MARKETING"], referenceId: `sel-${requestId}-v1` });
    expect(String(campaign.privacyPolicyLink)).toMatch(/\/b\/alpha-cleaning\/legal\/privacy$/);
    expect(String(campaign.termsAndConditionsLink)).toMatch(/\/b\/alpha-cleaning\/legal\/texting$/);
    expect(JSON.stringify(campaign)).not.toContain("selestial.io/privacy");
    expect(String(campaign.description)).toContain("Promotional texts go only to people who separately agreed");
    // The number was checked again right before it was bought.
    const availability = telnyx.calls.findIndex((call) => call.path.includes("ends_with"));
    expect(availability).toBeGreaterThan(-1);
    expect(availability).toBeLessThan(telnyx.calls.findIndex((call) => call.path === "/number_orders" && call.method === "POST"));

    // Texting is ready, and covers exactly what was registered.
    const profile = await as.query(api.compliance.profile, { companyId });
    expect(profile.messaging).toMatchObject({ smsNumber: NUMBER, senderName: "Alpha Cleaning", registration: { status: "approved", reference: "campaign-1" } });
    expect(profile.messaging.registration.coverage).toEqual(expect.arrayContaining([{ audience: "customer", category: "operational" }, { audience: "cleaner", category: "operational" }, { audience: "customer", category: "marketing" }]));
    expect(profile.messaging.registration.coverage).not.toContainEqual({ audience: "applicant", category: "recruiting" });
  });

  it("asks the owner to choose again when the chosen number was taken, and never swaps it silently", async () => {
    let available = false;
    const telnyx = fakeTelnyx({ available: () => available });
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    const admin = t.withIdentity(ADMIN);
    const searchId = await prepare(t, as, companyId);
    const { requestId } = await submit(as, companyId);
    await admin.mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(view.request).toMatchObject({ status: "needs_you", needs: { kind: "number" } });
    expect(view.request!.milestones.find((row) => row.key === "purchase")).toMatchObject({ state: "needs_you", ownerAction: true });
    expect(telnyx.posts()).not.toContain("POST /number_orders");

    // The owner chooses another; it goes back through Selestial review; the brand and campaign are not filed again.
    available = true;
    await as.mutation(api.textingSetup.chooseNumber, { companyId, revision: await revision(as, companyId), searchId, phoneNumber: OTHER });
    await submit(as, companyId);
    await admin.mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await t.run(async (ctx) => ctx.db.get(requestId));
    expect(after).toMatchObject({ status: "active", phoneNumber: OTHER });
    expect(telnyx.posts().filter((post) => post === "POST /10dlc/brand" || post === "POST /10dlc/campaignBuilder")).toHaveLength(2);
    expect(telnyx.posts().filter((post) => post === "POST /number_orders")).toHaveLength(1);
  });

  it("finds a number order whose answer was lost instead of buying a second one", async () => {
    const telnyx = fakeTelnyx({ loseFirstOrderAnswer: true });
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await prepare(t, as, companyId);
    const { requestId } = await submit(as, companyId);
    await t.withIdentity(ADMIN).mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run(async (ctx) => ctx.db.get(requestId)))?.status).toBe("active");
    expect(telnyx.posts().filter((post) => post === "POST /number_orders")).toHaveLength(1);
    expect(telnyx.calls.some((call) => call.method === "GET" && call.path.startsWith("/number_orders?filter[customer_reference]="))).toBe(true);
  });

  it("runs one provisioning pass at a time", async () => {
    const telnyx = fakeTelnyx();
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await prepare(t, as, companyId);
    const { requestId } = await submit(as, companyId);
    await t.withIdentity(ADMIN).mutation(api.texting.approve, { requestId });
    // A second run (a callback, the reconciler) while the first holds the request does nothing.
    await t.mutation(internal.texting.claim, { requestId, token: "other-pass" });
    await t.action(internal.texting.provision, { requestId });
    expect(telnyx.posts()).toEqual([]);
    await t.mutation(internal.texting.release, { requestId, token: "other-pass" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(telnyx.posts().filter((post) => post === "POST /10dlc/brand")).toHaveLength(1);
  });

  it("keeps texts waiting while the number connection is pending after approval", async () => {
    const telnyx = fakeTelnyx({ assignment: () => "PENDING_ASSIGNMENT" });
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await prepare(t, as, companyId);
    const { requestId } = await submit(as, companyId);
    await t.withIdentity(ADMIN).mutation(api.texting.approve, { requestId });
    for (let i = 0; i < 20; i += 1) {
      vi.advanceTimersByTime(31 * 60_000);
      await t.finishInProgressScheduledFunctions();
    }
    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(view.request!.status).toBe("waiting_on_carriers");
    expect(view.request!.milestones.map((row) => [row.key, row.state])).toEqual([
      ["submitted", "done"],
      ["business", "done"],
      ["messaging", "done"],
      ["purchase", "done"],
      ["connection", "working"],
      ["ready", "waiting"],
    ]);
    // Nothing can be texted yet: the profile has no number.
    expect((await as.query(api.compliance.profile, { companyId })).messaging.smsNumber).toBeUndefined();
  });

  it("asks for a correction in plain words, keeps everything else, and refiles only what changed, charging once", async () => {
    process.env.MESSAGING_BILLING = "on";
    vi.setSystemTime(Date.UTC(2026, 10, 19, 15));
    let fixed = false;
    const telnyx = fakeTelnyx({ brand: (n) => (fixed ? (n === 1 ? { identityStatus: null, status: "REGISTRATION_PENDING" } : { identityStatus: "VERIFIED", status: "OK" }) : n === 1 ? { identityStatus: null } : { identityStatus: "UNVERIFIED", status: "OK", failureReasons: [{ fields: ["ein", "companyName"], description: "EIN does not match the legal name." }] }) });
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await t.action(internal.billing.syncCompany, { companyId });
    billing.seed(companyId, { messaging: { purchased: 1_000_000, promo: 0, promoExpiresAt: null, used: 0 } });
    await t.action(internal.billing.syncCompany, { companyId });
    const admin = t.withIdentity(ADMIN);
    await prepare(t, as, companyId);
    const { requestId } = await submit(as, companyId);
    await admin.mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const view = (await as.query(api.textingSetup.view, { companyId }))!;
    expect(view.request).toMatchObject({ status: "needs_you", needs: { kind: "correction", fields: ["taxId", "legalName"] } });
    expect(view.request!.needs!.words).toContain("legal name and EIN match your IRS letter");
    expect(view.editable).toBe(true);
    expect(view.setup.business.street).toBe("1 Main St");
    // The raw provider reason is for staff, not the owner's screen.
    expect(JSON.stringify(view)).not.toContain("UNVERIFIED");

    fixed = true;
    await as.mutation(api.textingSetup.save, { companyId, revision: await revision(as, companyId), business: { legalName: "Alpha Cleaning Services LLC" } });
    await submit(as, companyId);
    expect((await t.run(async (ctx) => ctx.db.get(requestId)))).toMatchObject({ status: "requested", submissionVersion: 2 });
    await admin.mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run(async (ctx) => ctx.db.get(requestId)))?.status).toBe("active");
    expect(telnyx.posts()).toEqual(["POST /10dlc/brand", "PUT /10dlc/brand/brand-1", "PUT /10dlc/brand/brand-1/revet", "POST /10dlc/campaignBuilder", "POST /number_orders", "POST /10dlc/phone_number_campaigns"]);
    const submissions = await t.run(async (ctx) => ctx.db.query("textingSubmissions").collect());
    expect(submissions.map((row) => [row.version, row.business.legalName])).toEqual([
      [1, "Alpha Cleaning LLC"],
      [2, "Alpha Cleaning Services LLC"],
    ]);
    // Registration fees: setup once, the correction once, then the monthly fees from the day texting is ready.
    const fees = (await t.run(async (ctx) => ctx.db.query("messagingCharges").collect())).filter((row) => row.kind === "registration_fee" || row.kind === "number_monthly");
    expect(fees.map((row) => [row.activity, row.amount])).toEqual([
      ["Texting registration setup", 190_000],
      ["Corrected texting registration", 150_000],
      ["Texting number +15125550142, 2026-11", 30_000],
      ["Texting registration, 2026-11", 100_000],
    ]);
    await t.mutation(internal.texting.chargeNumbers, {});
    expect((await t.run(async (ctx) => ctx.db.query("messagingCharges").collect())).filter((row) => row.kind === "registration_fee" || row.kind === "number_monthly")).toHaveLength(4);
  });

  it("confirms a sole proprietor with the carriers' one-time code", async () => {
    const telnyx = fakeTelnyx({ brand: (n) => (n < 3 ? { identityStatus: "SELF_DECLARED", status: "OK" } : { identityStatus: "VERIFIED", status: "OK" }) });
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Casey's Cleaning");
    await prepare(t, as, companyId, { business: { entityType: "SOLE_PROPRIETOR", displayName: "Casey's Cleaning", contactFirstName: "Casey", contactLastName: "Park", mobilePhone: "(512) 555-0188" }, activities: ["inquiry_replies", "job_offers"], taxId: null });
    const { requestId } = await submit(as, companyId);
    await t.withIdentity(ADMIN).mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const brand = telnyx.calls.find((call) => call.path === "/10dlc/brand" && call.method === "POST")!.body!;
    expect(brand).toMatchObject({ entityType: "SOLE_PROPRIETOR", firstName: "Casey", lastName: "Park", mobilePhone: "+15125550188" });
    expect(brand.ein).toBeUndefined();
    expect(brand.companyName).toBeUndefined();
    const waiting = (await as.query(api.textingSetup.view, { companyId }))!.request!;
    expect(waiting).toMatchObject({ status: "needs_you", needs: { kind: "code" } });
    expect(waiting.needs!.words).toContain("ending in 0188");
    expect(String(telnyx.calls.find((call) => call.path.endsWith("/smsOtp") && call.method === "POST")!.body!.pinSms)).toContain("@OTP_PIN@");
    // While a code is awaited, the setup can't be changed.
    expect((await as.query(api.textingSetup.view, { companyId }))!.editable).toBe(false);

    await as.mutation(api.texting.confirmCode, { companyId, requestId, code: "000000" });
    await settle(t);
    expect((await as.query(api.textingSetup.view, { companyId }))!.request!.needs!.words).toContain("didn't work");
    await as.mutation(api.texting.confirmCode, { companyId, requestId, code: "123456" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run(async (ctx) => ctx.db.get(requestId)))?.status).toBe("active");
    const campaign = telnyx.calls.find((call) => call.path === "/10dlc/campaignBuilder")!.body!;
    expect(campaign.usecase).toBe("SOLE_PROPRIETOR");
  });

  it("acts on a signed 10DLC callback once, and only as a hint", async () => {
    const telnyx = fakeTelnyx();
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await prepare(t, as, companyId);
    const { requestId } = await submit(as, companyId);
    await t.withIdentity(ADMIN).mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (let i = 0; i < 2; i += 1) await t.mutation(internal.texting.registrationEvent, { eventId: "evt-1", type: "10dlc.campaign.update", campaignId: "campaign-1" });
    expect(await t.run(async (ctx) => ctx.db.query("telnyxEvents").collect())).toEqual([expect.objectContaining({ eventId: "evt-1", requestId })]);
  });

  it("stops texts that the registration doesn't cover, and when the carriers suspend it", async () => {
    const telnyx = fakeTelnyx();
    vi.stubGlobal("fetch", telnyx.fetcher);
    const t = start();
    const { as, companyId } = await company(t, "owner-a", "Alpha Cleaning");
    await prepare(t, as, companyId, { activities: ["job_offers", "arrival_reminders"] });
    const { requestId } = await submit(as, companyId);
    await t.withIdentity(ADMIN).mutation(api.texting.approve, { requestId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const customerId = await t.run(async (ctx) => ctx.db.insert("customers", { companyId, name: "Pat", kind: "home", phone: "+15125550170", status: "active", createdAt: Date.now() }));
    const check = (category: "operational" | "marketing") => as.query(api.consent.check, { companyId, channel: "sms", to: "+15125550170", recipient: { kind: "customer", id: customerId }, category, origin: "manual" });
    // Registered for cleaner work texts only: a text to a customer is refused before consent is even checked.
    expect(await check("operational")).toMatchObject({ ok: false, code: "not_registered" });
    expect((await check("marketing")) as { words: string }).toMatchObject({ ok: false, code: "not_registered" });

    // The carriers suspend it: texts stop, and the owner sees why.
    const stoppedTelnyx = fakeTelnyx({ campaign: () => "TCR_SUSPENDED" });
    vi.stubGlobal("fetch", stoppedTelnyx.fetcher);
    await t.action(internal.texting.checkActive, { requestId });
    expect((await t.run(async (ctx) => ctx.db.get(requestId)))?.status).toBe("interrupted");
    expect((await as.query(api.compliance.profile, { companyId })).messaging.registration.status).toBe("suspended");
    const milestones = (await as.query(api.textingSetup.view, { companyId }))!.request!.milestones;
    expect(milestones.find((row) => row.key === "ready")).toMatchObject({ state: "problem" });
  });

  it("keeps each company's setup, searches and requests to itself", async () => {
    vi.stubGlobal("fetch", fakeTelnyx().fetcher);
    const t = start();
    const a = await company(t, "owner-a", "Alpha Cleaning");
    const b = await company(t, "owner-b", "Bravo Maids");
    const searchId = await prepare(t, a.as, a.companyId);
    const { requestId } = await submit(a.as, a.companyId);
    await b.as.mutation(api.textingSetup.open, { companyId: b.companyId });
    expect(await refusal(b.as.mutation(api.textingSetup.chooseNumber, { companyId: b.companyId, revision: await revision(b.as, b.companyId), searchId, phoneNumber: NUMBER }))).toBe("Choose a number from your search.");
    expect(await refusal(b.as.query(api.texting.search, { companyId: b.companyId, searchId }))).toBe("Not found.");
    expect(await refusal(b.as.mutation(api.texting.confirmCode, { companyId: b.companyId, requestId, code: "123456" }))).toBe("Not found.");
    expect((await b.as.query(api.textingSetup.view, { companyId: b.companyId }))!.request).toBeNull();
    expect(await b.as.query(api.texting.status, { companyId: b.companyId })).toBeNull();
    expect(await refusal(b.as.query(api.textingSetup.view, { companyId: a.companyId }))).toBe("Not found.");
  });
});
