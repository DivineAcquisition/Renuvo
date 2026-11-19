/**
 * Getting a cleaning company a texting number and its carrier registration (A2P 10DLC), in its own name.
 *
 * The Owner searches for a number and fills in who the company is. Nothing is bought or filed then:
 * the request waits for Selestial staff, because the number and the registration are charged to
 * Selestial's Telnyx account. When an admin approves, `provision` works through the steps (buy the
 * number, file the brand, wait for it to be verified, file the campaign, wait for carriers, put the
 * number on the campaign) and keeps every Telnyx reference, so running it again continues where it was
 * and never buys or files twice. The company can text from the number only once carriers have approved.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { companyQuery, ownerMutation, staffMutation, staffQuery } from "./lib/builders";
import { e164, readProfile, writeProfile } from "./lib/compliance/profile";
import { brandDetailsValidator } from "./lib/compliance/schema";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { campaignFor, consentGaps } from "./lib/messaging/campaign";
import { telnyxWebhookUrl } from "./lib/messaging/telnyx";
import {
  ASSIGNED,
  ASSIGNMENT_FAILED,
  assignNumber,
  BRAND_FAILED,
  BRAND_READY,
  CAMPAIGN_FAILED,
  CAMPAIGN_READY,
  createBrand,
  createCampaign,
  getAssignment,
  getBrand,
  getCampaign,
  getNumberOrder,
  orderNumber,
  searchNumbers,
  type Answer,
} from "./lib/messaging/telnyxAccount";
import { meteringOn, postAdjustment } from "./lib/messagingBilling/ledger";
import { rateCardAt } from "./lib/messagingBilling/rates";
import { numberFeesWording } from "./lib/messagingBilling/wording";
import { localParts } from "./lib/availability";
import { billingState } from "./lib/billing/access";
import { allow } from "./lib/rateLimit";
import { email, optionalText, text } from "./lib/text";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Carriers usually answer within days. After this long a request is handed back to staff. */
const GIVE_UP_AFTER = 30 * DAY;
const OPEN: Doc<"textingRequests">["status"][] = ["requested", "approved", "provisioning", "waiting_on_carriers"];
export const VERTICALS = ["PROFESSIONAL", "REAL_ESTATE", "HOSPITALITY", "CONSTRUCTION", "RETAIL", "TECHNOLOGY"] as const;

// ── Searching for a number ───────────────────────────────────────────────────────────────────────

/** Looks for local numbers in an area code. Nothing is held or bought. The results arrive on `search`. */
export const searchNumbersFor = ownerMutation({
  args: { areaCode: v.string() },
  handler: async (ctx, args) => {
    const areaCode = args.areaCode.trim();
    if (!/^[2-9]\d{2}$/.test(areaCode)) throw userError("Enter a three-digit US area code, for example 512.");
    if (!(await allow(ctx, `number-search:${ctx.companyId}`, 20, HOUR))) throw userError("That is a lot of searches in an hour. Try again a little later.");
    const searchId = await ctx.db.insert("numberSearches", { companyId: ctx.companyId, areaCode, status: "pending", createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.texting.runSearch, { searchId });
    return searchId;
  },
});

export const search = companyQuery({
  args: { searchId: v.id("numberSearches") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.searchId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    return { status: row.status, areaCode: row.areaCode, results: row.results ?? [], problem: row.problem ?? null };
  },
});

export const runSearch = internalAction({
  args: { searchId: v.id("numberSearches") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.texting.searchRow, { searchId: args.searchId });
    if (!row || row.status !== "pending") return null;
    const found = await searchNumbers(fetch, { areaCode: row.areaCode, limit: 12 });
    await ctx.runMutation(internal.texting.searchDone, { searchId: args.searchId, ...(found.ok ? { results: found.value } : { problem: found.problem }) });
    return null;
  },
});

export const searchRow = internalQuery({
  args: { searchId: v.id("numberSearches") },
  handler: async (ctx, args) => ctx.db.get(args.searchId),
});

export const searchDone = internalMutation({
  args: {
    searchId: v.id("numberSearches"),
    results: v.optional(v.array(v.object({ phoneNumber: v.string(), locality: v.union(v.string(), v.null()), region: v.union(v.string(), v.null()), upfrontCents: v.union(v.number(), v.null()), monthlyCents: v.union(v.number(), v.null()) }))),
    problem: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.searchId, args.results ? { status: "done", results: args.results } : { status: "failed", problem: args.problem ?? "The search did not work." });
    return null;
  },
});

// ── The Owner's request ──────────────────────────────────────────────────────────────────────────

function checkedBrand(input: typeof brandDetailsValidator.type): typeof brandDetailsValidator.type {
  const ein = input.ein.replace(/\D/g, "");
  if (ein.length !== 9) throw userError("The EIN is the 9-digit federal tax ID, for example 12-3456789.");
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw userError("The state is the two-letter code, for example TX.");
  const postalCode = input.postalCode.trim();
  if (!/^\d{5}$/.test(postalCode)) throw userError("The ZIP code is five digits.");
  const website = input.website.trim();
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/.test(website)) throw userError("The website must be a full address, for example https://example.com.");
  if (!(VERTICALS as readonly string[]).includes(input.vertical)) throw userError("Choose the kind of business.");
  return {
    displayName: text(input.displayName, "The name texts are sent under", 60),
    companyName: text(input.companyName, "The legal company name", 120),
    ein,
    phone: e164(input.phone, "The business phone"),
    street: text(input.street, "The street address", 120),
    city: text(input.city, "The city", 60),
    state,
    postalCode,
    email: email(input.email, "The support email"),
    website,
    vertical: input.vertical,
  };
}

/**
 * Asks Selestial for the chosen number and a carrier registration in the company's own name. Only a
 * number from one of this company's own searches can be asked for, and only one request is open at once.
 */
export const request = ownerMutation({
  args: { searchId: v.id("numberSearches"), phoneNumber: v.string(), brand: brandDetailsValidator, consentWording: v.string(), feesWording: v.optional(v.string()) },
  handler: async (ctx, args) => {
    // The number's fees come from the messaging balance, so the Owner authorizes them in exactly these words first.
    const feesWording = numberFeesWording(rateCardAt(Date.now()).numberMonthly);
    if (meteringOn() && args.feesWording !== feesWording) throw userError("Read and accept the number and registration fees to ask for a number.");
    const fees = args.feesWording === feesWording ? { authorizedAt: Date.now(), authorizedBy: ctx.member._id, wording: feesWording } : undefined;
    const searched = await ctx.db.get(args.searchId);
    const chosen = searched && searched.companyId === ctx.companyId ? searched.results?.find((row) => row.phoneNumber === args.phoneNumber) : undefined;
    if (!chosen) throw userError("Choose a number from your search.");
    const open = (await requestsFor(ctx, ctx.companyId)).find((row) => OPEN.includes(row.status));
    if (open) throw userError("There is already a request open for this company. Cancel it, or wait for Selestial to finish it.");
    const brand = checkedBrand(args.brand);
    const consentWording = text(args.consentWording, "The consent wording", 1000);
    const gaps = consentGaps(consentWording, brand.displayName);
    if (gaps.length > 0) throw userError(`Carriers require the consent wording to ${gaps.join(", ")}.`);
    const requestId = await ctx.db.insert("textingRequests", {
      companyId: ctx.companyId,
      status: "requested",
      phoneNumber: chosen.phoneNumber,
      upfrontCents: chosen.upfrontCents ?? undefined,
      monthlyCents: chosen.monthlyCents ?? undefined,
      brand,
      consentWording,
      requestedBy: ctx.member._id,
      requestedAt: Date.now(),
      ...(fees ? { fees } : {}),
      step: "Waiting for Selestial to approve the request.",
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "texting.requested", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { phoneNumber: chosen.phoneNumber } });
    return requestId;
  },
});

/** What the Owner authorizes with a number request, and whether it is required now. */
export const feeTerms = companyQuery({
  args: {},
  handler: async () => {
    const card = rateCardAt(Date.now());
    return { required: meteringOn(), monthly: card.numberMonthly, wording: numberFeesWording(card.numberMonthly) };
  },
});

/**
 * Charges an active number's monthly fee for the calendar month `at` falls in, once. Only with the Owner's
 * authorization, and only while messaging is metered. A low balance never stops or releases the number: the
 * fee may take the balance below zero, and outbound messages then wait for funds.
 */
async function chargeNumberMonth(ctx: MutationCtx, row: Doc<"textingRequests">, at: number) {
  if (!meteringOn() || row.status !== "active") return;
  const state = billingState();
  if (!state.connected) return;
  const company = await ctx.db.get(row.companyId);
  if (!company) return;
  const month = localParts(at, company.timezone).day.slice(0, 7);
  if (row.feeMonth === month) return;
  if (!row.fees) {
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.fee_not_authorized", actor: SYSTEM, subject: { table: "companies", id: row.companyId }, data: { month } });
    return;
  }
  await postAdjustment(ctx, { companyId: row.companyId, env: state.env, kind: "number_monthly", amount: rateCardAt(at).numberMonthly, activity: `Texting number ${row.phoneNumber}, ${month}`, reason: "Monthly fee for your business texting number.", key: `number:${row._id}:${month}` });
  await ctx.db.patch(row._id, { feeMonth: month });
}

/** Once a day: each active number's fee for the new month, charged once. */
export const chargeNumbers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("textingRequests")
      .withIndex("by_status_requested", (q) => q.eq("status", "active"))
      .take(1000);
    for (const row of active) await chargeNumberMonth(ctx, row, now);
    return active.length;
  },
});

/**
 * Selestial staff: a carrier registration fee at Selestial's actual cost, as the carrier registry billed it,
 * taken from the messaging balance under the Owner's authorization. Posted once per key.
 */
export const chargeRegistrationFee = staffMutation({
  args: { requestId: v.id("textingRequests"), cents: v.number(), description: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (!row.fees) throw userError("The Owner did not authorize registration fees from the messaging balance for this request. Ask them first; nothing was charged.");
    if (!Number.isSafeInteger(args.cents) || args.cents <= 0 || args.cents > 50_000) throw userError("Enter the fee in cents, as billed by the carrier registry (up to $500).");
    const description = text(args.description, "What the fee is", 120);
    const state = billingState();
    if (!state.connected) throw userError("Billing isn't connected, so nothing was charged.");
    const chargeId = await postAdjustment(ctx, { companyId: row.companyId, env: state.env, kind: "registration_fee", amount: args.cents * 100, activity: `Carrier registration: ${description}`, reason: "At Selestial's actual cost, as billed by the carrier registry.", key: `registration:${row._id}:${args.key}`, note: `staff ${ctx.staff._id}` });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.registration_fee", actor: SYSTEM, subject: { table: "companies", id: row.companyId }, data: { cents: args.cents } });
    return chargeId;
  },
});

/** The Owner withdraws a request Selestial has not acted on yet. */
export const cancel = ownerMutation({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    if (row.status !== "requested") throw userError("Selestial has already started on this request, so it can no longer be withdrawn here. Write to support.");
    await ctx.db.patch(row._id, { status: "cancelled", step: "Withdrawn by the company." });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "texting.cancelled", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return null;
  },
});

async function requestsFor(ctx: { db: QueryCtx["db"] }, companyId: Id<"companies">) {
  return ctx.db
    .query("textingRequests")
    .withIndex("by_company_requested", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(20);
}

const view = (row: Doc<"textingRequests">) => ({
  requestId: row._id,
  status: row.status,
  phoneNumber: row.phoneNumber,
  upfrontCents: row.upfrontCents ?? null,
  monthlyCents: row.monthlyCents ?? null,
  brand: { ...row.brand, ein: `•••••${row.brand.ein.slice(-4)}` },
  consentWording: row.consentWording,
  requestedAt: row.requestedAt,
  decidedAt: row.decidedAt ?? null,
  note: row.note ?? null,
  step: row.step ?? null,
  problem: row.problem ?? null,
  activeAt: row.activeAt ?? null,
});

/** The company's latest request and where it stands. */
export const mine = companyQuery({
  args: {},
  handler: async (ctx) => {
    const latest = (await requestsFor(ctx, ctx.companyId))[0];
    return latest ? view(latest) : null;
  },
});

// ── Selestial staff ──────────────────────────────────────────────────────────────────────────────

export const queue = staffQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const status of [...OPEN, "failed"] as const) {
      const rows = await ctx.db
        .query("textingRequests")
        .withIndex("by_status_requested", (q) => q.eq("status", status))
        .take(100);
      for (const row of rows) out.push({ ...view(row), company: (await ctx.db.get(row.companyId))?.name ?? "A company", companyId: row.companyId, numberOrderId: row.numberOrderId ?? null, brandId: row.brandId ?? null, campaignId: row.campaignId ?? null });
    }
    return out.sort((a, b) => a.requestedAt - b.requestedAt);
  },
});

/** An admin approves the spend. Provisioning starts at once. */
export const approve = staffMutation({
  adminOnly: true,
  args: { requestId: v.id("textingRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "requested") throw userError("Only a request waiting for approval can be approved.");
    await ctx.db.patch(row._id, { status: "approved", decidedAt: Date.now(), decidedBy: ctx.staff._id, note: optionalText(args.note, "The note", 500), step: "Approved. Buying the number.", problem: undefined });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.approved", actor: { kind: "system" }, subject: { table: "companies", id: row.companyId }, data: { staffId: ctx.staff._id, phoneNumber: row.phoneNumber } });
    await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
    return null;
  },
});

export const reject = staffMutation({
  args: { requestId: v.id("textingRequests"), note: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "requested") throw userError("Only a request waiting for approval can be turned down.");
    const note = text(args.note, "The reason", 500);
    await ctx.db.patch(row._id, { status: "rejected", decidedAt: Date.now(), decidedBy: ctx.staff._id, note, step: "Turned down by Selestial." });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.rejected", actor: { kind: "system" }, subject: { table: "companies", id: row.companyId }, data: { staffId: ctx.staff._id, note } });
    return null;
  },
});

/** Runs a failed request again from the step it stopped at. Nothing already bought or filed is repeated. */
export const retry = staffMutation({
  adminOnly: true,
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "failed") throw userError("Only a request that stopped can be run again.");
    await ctx.db.patch(row._id, { status: "provisioning", problem: undefined, step: "Running again from where it stopped." });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.retried", actor: { kind: "system" }, subject: { table: "companies", id: row.companyId }, data: { staffId: ctx.staff._id } });
    await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
    return null;
  },
});

// ── Provisioning ─────────────────────────────────────────────────────────────────────────────────

export const provisionRow = internalQuery({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => ctx.db.get(args.requestId),
});

const progressFields = v.object({
  status: v.optional(v.union(v.literal("provisioning"), v.literal("waiting_on_carriers"), v.literal("failed"))),
  step: v.optional(v.string()),
  problem: v.optional(v.string()),
  numberOrderId: v.optional(v.string()),
  brandId: v.optional(v.string()),
  campaignId: v.optional(v.string()),
  assignedAt: v.optional(v.number()),
});

/** Saves one step's outcome. A request that was cancelled or finished meanwhile is left as it is. */
export const progress = internalMutation({
  args: { requestId: v.id("textingRequests"), change: progressFields },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || !["approved", "provisioning", "waiting_on_carriers"].includes(row.status)) return false;
    await ctx.db.patch(row._id, { ...args.change, lastCheckedAt: Date.now() });
    if (args.change.status === "failed") {
      await recordEvent(ctx, { companyId: row.companyId, type: "texting.failed", actor: { kind: "system" }, subject: { table: "companies", id: row.companyId }, data: { problem: (args.change.problem ?? "").slice(0, 300) } });
    }
    return true;
  },
});

const SYSTEM: Actor = { kind: "system" };

/**
 * The number is on an approved campaign: the company texts from it from now on. The registration is
 * recorded as approved by Selestial, and the consent wording filed with carriers is kept on file as the
 * company's work-text wording, so what cleaners agree to is what was filed.
 */
export const activate = internalMutation({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || !["provisioning", "waiting_on_carriers"].includes(row.status)) return null;
    const taken = await ctx.db
      .query("complianceProfiles")
      .withIndex("by_sms_number", (q) => q.eq("messaging.smsNumber", row.phoneNumber))
      .take(2);
    if (taken.some((profile) => profile.companyId !== row.companyId)) {
      await ctx.db.patch(row._id, { status: "failed", problem: "This number is set up for another company on Selestial. Staff need to look at it." });
      return null;
    }
    const current = (await readProfile(ctx, row.companyId)).messaging;
    const now = Date.now();
    await writeProfile(ctx, row.companyId, {
      messaging: {
        ...current,
        smsNumber: row.phoneNumber,
        senderName: current.senderName ?? row.brand.displayName,
        registration: { status: "approved", reference: row.campaignId, updatedAt: now, updatedBy: "staff", note: "Registered with the carriers through Selestial." },
      },
    });
    const latest = await ctx.db
      .query("consentDisclosures")
      .withIndex("by_company_channel_category", (q) => q.eq("companyId", row.companyId).eq("channel", "sms").eq("category", "operational"))
      .order("desc")
      .first();
    if (latest?.text !== row.consentWording) {
      await ctx.db.insert("consentDisclosures", { companyId: row.companyId, channel: "sms", category: "operational", text: row.consentWording, version: (latest?.version ?? 0) + 1, createdAt: now, createdBy: row.requestedBy });
    }
    await ctx.db.patch(row._id, { status: "active", activeAt: now, step: "Active. Texts go out from this number.", problem: undefined });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.active", actor: SYSTEM, subject: { table: "companies", id: row.companyId }, data: { phoneNumber: row.phoneNumber } });
    // The first month's fee, from the day it goes live.
    await chargeNumberMonth(ctx, (await ctx.db.get(row._id))!, now);
    return null;
  },
});

/**
 * One pass through the steps. Each pass does at most one thing at Telnyx and then either continues, or
 * schedules itself again to check on something carriers have not answered yet.
 */
export const provision = internalAction({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const save = (change: typeof progressFields.type) => ctx.runMutation(internal.texting.progress, { requestId: args.requestId, change });
    const later = async (delay: number, change: typeof progressFields.type) => {
      if (await save(change)) await ctx.scheduler.runAfter(delay, internal.texting.provision, args);
    };
    const stopped = async <T>(answer: Answer<T>, what: string) => {
      if (answer.ok) return false;
      if (answer.retryable) await later(5 * MINUTE, { status: "provisioning", step: `${what}: Telnyx did not answer. Trying again shortly.` });
      else await save({ status: "failed", problem: `${what}: ${answer.problem}` });
      return true;
    };

    for (let pass = 0; pass < 8; pass += 1) {
      const row = await ctx.runQuery(internal.texting.provisionRow, args);
      if (!row || !["approved", "provisioning", "waiting_on_carriers"].includes(row.status)) return null;
      if (Date.now() - (row.decidedAt ?? row.requestedAt) > GIVE_UP_AFTER) {
        await save({ status: "failed", problem: "Carriers have not finished in 30 days. Staff need to check the registration with Telnyx." });
        return null;
      }

      // 1. The number.
      if (!row.numberOrderId) {
        const ordered = await orderNumber(fetch, { phoneNumber: row.phoneNumber, messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID?.trim() || null, idempotencyKey: `selestial-number-${row._id}` });
        if (await stopped(ordered, "Buying the number")) return null;
        if (!ordered.ok) return null;
        await save({ status: "provisioning", numberOrderId: ordered.value.orderId, step: "Buying the number." });
        continue;
      }
      if (!row.brandId) {
        const order = await getNumberOrder(fetch, row.numberOrderId);
        if (await stopped(order, "Checking the number order")) return null;
        if (!order.ok) return null;
        if (order.value.status === "pending") return void (await later(MINUTE, { status: "provisioning", step: "Telnyx is still buying the number." }));
        if (order.value.status === "failure") return void (await save({ status: "failed", problem: "Telnyx could not buy this number. It may have been taken; the company can search again." }));

        // 2. The company's brand.
        const brand = await createBrand(fetch, { ...row.brand, webhookURL: null });
        if (await stopped(brand, "Filing the company with the carriers")) return null;
        if (!brand.ok) return null;
        await save({ status: "waiting_on_carriers", brandId: brand.value.brandId, step: "The company is filed with the carriers and is being verified." });
        continue;
      }
      if (!row.campaignId) {
        const brand = await getBrand(fetch, row.brandId);
        if (await stopped(brand, "Checking the company's verification")) return null;
        if (!brand.ok) return null;
        const status = brand.value.identityStatus ?? "";
        if (BRAND_FAILED.has(status)) return void (await save({ status: "failed", problem: `The carriers could not verify the company (${status}). ${brand.value.failureReasons ?? "Check the legal name, EIN and address match the IRS record exactly."}` }));
        if (!BRAND_READY.has(status)) return void (await later(30 * MINUTE, { status: "waiting_on_carriers", step: "Waiting for the carriers to verify the company." }));

        // 3. The campaign: what the company texts, and how cleaners agreed to it.
        const campaign = await createCampaign(fetch, campaignFor({ brandId: row.brandId, company: row.brand.displayName, supportEmail: row.brand.email, consentWording: row.consentWording, webhookURL: telnyxWebhookUrl() }));
        if (await stopped(campaign, "Filing the texting campaign")) return null;
        if (!campaign.ok) return null;
        await save({ status: "waiting_on_carriers", campaignId: campaign.value.campaignId, step: "The texting campaign is filed and waiting for carrier approval." });
        continue;
      }
      if (!row.assignedAt) {
        const campaign = await getCampaign(fetch, row.campaignId);
        if (await stopped(campaign, "Checking the campaign")) return null;
        if (!campaign.ok) return null;
        const status = campaign.value.campaignStatus ?? "";
        if (CAMPAIGN_FAILED.has(status)) return void (await save({ status: "failed", problem: `The carriers did not approve the campaign (${status}). ${campaign.value.failureReasons ?? ""}`.trim() }));
        if (!CAMPAIGN_READY.has(status)) return void (await later(30 * MINUTE, { status: "waiting_on_carriers", step: "Waiting for the carriers to approve the texting campaign." }));

        // 4. The number on the campaign.
        const assigned = await assignNumber(fetch, { phoneNumber: row.phoneNumber, campaignId: row.campaignId });
        if (await stopped(assigned, "Putting the number on the campaign")) return null;
        await save({ status: "waiting_on_carriers", assignedAt: Date.now(), step: "Putting the number on the approved campaign." });
        continue;
      }
      const assignment = await getAssignment(fetch, row.phoneNumber);
      if (await stopped(assignment, "Checking the number's registration")) return null;
      if (!assignment.ok) return null;
      const status = assignment.value.assignmentStatus ?? "";
      if (ASSIGNMENT_FAILED.has(status)) return void (await save({ status: "failed", problem: `The number could not be put on the campaign (${status}). ${assignment.value.failureReasons ?? ""}`.trim() }));
      if (status !== ASSIGNED) return void (await later(10 * MINUTE, { status: "waiting_on_carriers", step: "Waiting for the carriers to add the number." }));
      await ctx.runMutation(internal.texting.activate, args);
      return null;
    }
    return null;
  },
});
