/**
 * Getting a cleaning company a texting number and its carrier registration (A2P 10DLC), in its own name.
 *
 * The owner prepares everything in "Set up business texting" (convex/textingSetup.ts) and submits it.
 * Nothing is filed, bought or charged then: the request waits for Selestial review, because the
 * registration and the number are filed through Selestial's Telnyx account. Once approved, `provision`
 * works through the steps in this order:
 *
 *   1. file the company's brand (its own business details), and confirm a sole proprietor's one-time code
 *   2. file the campaign (what it texts, its own pages and replies) and wait for the carriers to approve
 *   3. check the chosen number is still available, then buy it
 *   4. put the number on the approved campaign and wait for the carriers to connect it
 *
 * The number is bought only after approval, so a company never pays for a number it cannot use. Every
 * Telnyx reference is kept, and a call whose answer was lost is never simply repeated: before trying again,
 * provisioning looks for what that call may have created (an order by its customer reference, a campaign by
 * its reference, a brand by its name and email). One pass runs at a time per request (a lease). Telnyx's
 * callbacks only wake provisioning up; what it does next is decided by what it reads back from Telnyx.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { companyQuery, ownerMutation, staffMutation, staffQuery } from "./lib/builders";
import { readProfile, writeProfile } from "./lib/compliance/profile";
import { numberResultValidator } from "./lib/compliance/schema";
import { notFound, userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";
import { campaignCorrection, campaignFor, campaignShape } from "./lib/messaging/campaign";
import { telnyxWebhookUrl } from "./lib/messaging/telnyx";
import {
  appealCampaign,
  ASSIGNED,
  ASSIGNMENT_FAILED,
  assignNumber,
  BRAND_READY,
  brandFailed,
  CAMPAIGN_APPEALABLE,
  CAMPAIGN_INTERRUPTED,
  CAMPAIGN_READY,
  CAMPAIGN_REJECTED,
  createBrand,
  createCampaign,
  findBrands,
  findCampaigns,
  findOrders,
  getAssignment,
  getBrand,
  getCampaign,
  getNumberOrder,
  orderNumber,
  revetBrand,
  searchNumbers,
  sendBrandCode,
  stillAvailable,
  updateBrand,
  updateCampaign,
  verifyBrandCode,
  type Answer,
  type BrandInput,
} from "./lib/messaging/telnyxAccount";
import { meteringOn, postAdjustment } from "./lib/messagingBilling/ledger";
import { rateCardAt } from "./lib/messagingBilling/rates";
import { localParts } from "./lib/availability";
import { billingState } from "./lib/billing/access";
import { allow } from "./lib/rateLimit";
import { unseal } from "./lib/recruiter/secrets";
import { coverageOf } from "./lib/texting/plan";
import { registrationPrices, registrationPricesAt } from "./lib/texting/prices";
import { optionalText, text } from "./lib/text";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Carriers usually answer within days. After this long a request is handed back to staff. */
const GIVE_UP_AFTER = 45 * DAY;
/** How long a create call's answer is waited for before looking for what it may have made. */
const SETTLE = 3 * MINUTE;
const LEASE = 2 * MINUTE;
const WORKING: Doc<"textingRequests">["status"][] = ["approved", "provisioning", "waiting_on_carriers"];
const OPEN: Doc<"textingRequests">["status"][] = ["requested", ...WORKING, "needs_you"];
const SYSTEM: Actor = { kind: "system" };

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
    return { status: row.status, areaCode: row.areaCode, results: row.results ?? [], nearbyRegion: row.nearbyRegion ?? null, problem: row.problem ?? null };
  },
});

export const runSearch = internalAction({
  args: { searchId: v.id("numberSearches") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.texting.searchRow, { searchId: args.searchId });
    if (!row || row.status !== "pending") return null;
    const found = await searchNumbers(fetch, { areaCode: row.areaCode, limit: 12 });
    if (found.ok && found.value.length === 0 && row.state) {
      // Nothing in that area code right now: offer numbers elsewhere in the same state, and say so.
      const nearby = await searchNumbers(fetch, { state: row.state, limit: 12 });
      if (nearby.ok && nearby.value.length > 0) {
        await ctx.runMutation(internal.texting.searchDone, { searchId: args.searchId, results: nearby.value, nearbyRegion: row.state });
        return null;
      }
    }
    await ctx.runMutation(internal.texting.searchDone, { searchId: args.searchId, ...(found.ok ? { results: found.value } : { problem: found.problem }) });
    return null;
  },
});

export const searchRow = internalQuery({
  args: { searchId: v.id("numberSearches") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.searchId);
    if (!row) return null;
    // The company's state, for nearby numbers when the area code has none: the setup's address first, then the profile's.
    const setup = await ctx.db
      .query("textingSetups")
      .withIndex("by_company", (q) => q.eq("companyId", row.companyId))
      .unique();
    const profile = await readProfile(ctx, row.companyId);
    const state = setup?.business.state ?? (profile.identity.address?.country === "US" ? profile.identity.address.region.toUpperCase() : undefined);
    return { ...row, state: state && /^[A-Z]{2}$/.test(state) ? state : null };
  },
});

export const searchDone = internalMutation({
  args: {
    searchId: v.id("numberSearches"),
    results: v.optional(v.array(numberResultValidator)),
    nearbyRegion: v.optional(v.string()),
    problem: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.searchId, args.results ? { status: "done", results: args.results, ...(args.nearbyRegion ? { nearbyRegion: args.nearbyRegion } : {}) } : { status: "failed", problem: args.problem ?? "The search did not work." });
    return null;
  },
});

// ── Charges ──────────────────────────────────────────────────────────────────────────────────────

function pricesOf(row: Doc<"textingRequests">) {
  return (row.pricesVersion ? registrationPrices(row.pricesVersion) : null) ?? registrationPricesAt(row.requestedAt);
}

/**
 * The registration fee for filing with the carriers: the setup fee the first time, the correction fee each
 * time a corrected registration is filed again. Each is posted once (by its key), only under the owner's
 * authorization, and only while messaging is metered.
 */
async function chargeFiling(ctx: MutationCtx, row: Doc<"textingRequests">, kind: "setup" | "resubmission") {
  if (!meteringOn() || !row.fees || !row.setupId) return;
  const state = billingState();
  if (!state.connected) return;
  const prices = pricesOf(row);
  await postAdjustment(ctx, {
    companyId: row.companyId,
    env: state.env,
    kind: "registration_fee",
    amount: kind === "setup" ? prices.setup : prices.resubmission,
    activity: kind === "setup" ? "Texting registration setup" : "Corrected texting registration",
    reason: kind === "setup" ? "Filing your business texting registration with the carriers." : "Filing your corrected texting registration with the carriers.",
    key: kind === "setup" ? `texting-setup:${row._id}` : `texting-resubmission:${row._id}:${row.submissionVersion ?? 1}`,
  });
}

/**
 * An active number's monthly fee, and its registration's monthly fee, for the calendar month `at` falls
 * in, each once. Only with the owner's authorization, and only while messaging is metered. A low balance
 * never stops or releases the number: a fee may take the balance below zero, and texts then wait for funds.
 */
async function chargeMonth(ctx: MutationCtx, row: Doc<"textingRequests">, at: number) {
  if (!meteringOn() || row.status !== "active") return;
  const state = billingState();
  if (!state.connected) return;
  const company = await ctx.db.get(row.companyId);
  if (!company) return;
  const month = localParts(at, company.timezone).day.slice(0, 7);
  if (!row.fees) {
    if (row.feeMonth !== month) await recordEvent(ctx, { companyId: row.companyId, type: "texting.fee_not_authorized", actor: SYSTEM, subject: { table: "companies", id: row.companyId }, data: { month } });
    return;
  }
  const patch: Partial<Doc<"textingRequests">> = {};
  if (row.feeMonth !== month) {
    await postAdjustment(ctx, { companyId: row.companyId, env: state.env, kind: "number_monthly", amount: rateCardAt(at).numberMonthly, activity: `Texting number ${row.phoneNumber}, ${month}`, reason: "Monthly fee for your business texting number.", key: `number:${row._id}:${month}` });
    patch.feeMonth = month;
  }
  if (row.setupId && row.registrationMonth !== month) {
    await postAdjustment(ctx, { companyId: row.companyId, env: state.env, kind: "registration_fee", amount: pricesOf(row).monthly, activity: `Texting registration, ${month}`, reason: "Monthly fee for your business texting registration.", key: `texting-registration:${row._id}:${month}` });
    patch.registrationMonth = month;
  }
  if (Object.keys(patch).length) await ctx.db.patch(row._id, patch);
}

/** Every few hours: each active number's fees for the new month, charged once. */
export const chargeNumbers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const active = await ctx.db
      .query("textingRequests")
      .withIndex("by_status_requested", (q) => q.eq("status", "active"))
      .take(1000);
    for (const row of active) await chargeMonth(ctx, row, now);
    return active.length;
  },
});

/**
 * Selestial staff: a one-off registration charge, for a case the automatic fees don't cover. Taken from the
 * messaging balance under the owner's authorization, at most $500, posted once per key.
 */
export const chargeRegistrationFee = staffMutation({
  args: { requestId: v.id("textingRequests"), cents: v.number(), description: v.string(), key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (!row.fees) throw userError("The owner did not authorize registration fees from the messaging balance for this request. Ask them first; nothing was charged.");
    if (!Number.isSafeInteger(args.cents) || args.cents <= 0 || args.cents > 50_000) throw userError("Enter the fee in cents (up to $500).");
    const description = text(args.description, "What the fee is", 120);
    const state = billingState();
    if (!state.connected) throw userError("Billing isn't connected, so nothing was charged.");
    const chargeId = await postAdjustment(ctx, { companyId: row.companyId, env: state.env, kind: "registration_fee", amount: args.cents * 100, activity: `Texting registration: ${description}`, reason: "A texting registration charge from Selestial.", key: `registration:${row._id}:${args.key}`, note: `staff ${ctx.staff._id}` });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.registration_fee", actor: SYSTEM, subject: { table: "companies", id: row.companyId }, data: { cents: args.cents } });
    return chargeId;
  },
});

// ── Selestial review ─────────────────────────────────────────────────────────────────────────────

const staffView = (row: Doc<"textingRequests">, company: string) => ({
  requestId: row._id,
  companyId: row.companyId,
  company,
  status: row.status,
  phoneNumber: row.phoneNumber,
  requestedAt: row.requestedAt,
  decidedAt: row.decidedAt ?? null,
  note: row.note ?? null,
  step: row.step ?? null,
  problem: row.problem ?? null,
  guided: row.setupId !== undefined,
  version: row.submissionVersion ?? 1,
  entityType: row.entityType ?? "PRIVATE_PROFIT",
  usecase: row.usecase ?? null,
  subUsecases: row.subUsecases ?? [],
  activities: row.activities ?? [],
  brand: { displayName: row.brand.displayName, companyName: row.brand.companyName, phone: row.brand.phone, street: row.brand.street, city: row.brand.city, state: row.brand.state, postalCode: row.brand.postalCode, email: row.brand.email, website: row.brand.website, vertical: row.brand.vertical },
  taxIdLast4: row.taxIdLast4 ?? (row.brand.ein ? row.brand.ein.slice(-4) : null),
  links: { privacy: row.privacyLink ?? null, terms: row.termsLink ?? null, signup: row.signupLink ?? null },
  consentWording: row.consentWording,
  samples: row.samples ?? [],
  needs: row.needs ?? null,
  diagnostics: row.diagnostics ?? null,
  numberOrderId: row.numberOrderId ?? null,
  brandId: row.brandId ?? null,
  campaignId: row.campaignId ?? null,
  feesAuthorized: row.fees !== undefined,
});

export const queue = staffQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const status of [...OPEN, "failed", "interrupted"] as const) {
      const rows = await ctx.db
        .query("textingRequests")
        .withIndex("by_status_requested", (q) => q.eq("status", status))
        .take(100);
      for (const row of rows) out.push(staffView(row, (await ctx.db.get(row.companyId))?.name ?? "A company"));
    }
    return out.sort((a, b) => a.requestedAt - b.requestedAt);
  },
});

/** Selestial review approves: the registration is filed and provisioning starts at once. */
export const approve = staffMutation({
  adminOnly: true,
  args: { requestId: v.id("textingRequests"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "requested") throw userError("Only a request waiting for Selestial review can be approved.");
    if (!row.setupId && !row.campaignId) throw userError("This request came from the older form, which filed Selestial's own privacy links. Ask the company to finish Set up business texting instead.");
    await ctx.db.patch(row._id, { status: "approved", decidedAt: Date.now(), decidedBy: ctx.staff._id, note: optionalText(args.note, "The note", 500), step: "Approved by Selestial review. Filing with the carriers.", problem: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.approved", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { staffId: ctx.staff._id, phoneNumber: row.phoneNumber, version: row.submissionVersion ?? 1 } });
    await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
    return null;
  },
});

/** Selestial review turns the request down. Nothing was filed or charged. */
export const reject = staffMutation({
  args: { requestId: v.id("textingRequests"), note: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "requested") throw userError("Only a request waiting for Selestial review can be turned down.");
    const note = text(args.note, "The reason", 500);
    await ctx.db.patch(row._id, { status: "rejected", decidedAt: Date.now(), decidedBy: ctx.staff._id, note, step: "Not approved by Selestial review.", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.rejected", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { staffId: ctx.staff._id, note } });
    return null;
  },
});

/** Selestial review asks the owner to change something before anything is filed. Their answers are kept. */
export const sendBack = staffMutation({
  args: { requestId: v.id("textingRequests"), words: v.string(), fields: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "requested" || !row.setupId) throw userError("Only a guided request waiting for Selestial review can be sent back.");
    const words = text(args.words, "What needs to change", 500);
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "needs_you", needs: { kind: "correction", words, fields: (args.fields ?? []).slice(0, 20), at: now }, step: "Selestial review asked for a change.", updatedAt: now });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.needs_you", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { kind: "correction", staffId: ctx.staff._id } });
    return null;
  },
});

/** Runs a stopped request again from the step it stopped at. Nothing already bought or filed is repeated. */
export const retry = staffMutation({
  adminOnly: true,
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) notFound();
    if (row.status !== "failed" && row.status !== "interrupted") throw userError("Only a request that stopped can be run again.");
    await ctx.db.patch(row._id, { status: "provisioning", problem: undefined, step: "Running again from where it stopped.", leaseUntil: undefined, leaseToken: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.retried", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { staffId: ctx.staff._id } });
    await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
    return null;
  },
});

// ── Provisioning ─────────────────────────────────────────────────────────────────────────────────

const otpValidator = v.object({ referenceId: v.optional(v.string()), sentAt: v.number(), verifiedAt: v.optional(v.number()), attempts: v.number() });
const needsValidator = v.object({ kind: v.union(v.literal("correction"), v.literal("code"), v.literal("number")), words: v.string(), fields: v.array(v.string()), at: v.number() });

const progressFields = v.object({
  status: v.optional(v.union(v.literal("provisioning"), v.literal("waiting_on_carriers"), v.literal("needs_you"), v.literal("failed"), v.literal("interrupted"))),
  step: v.optional(v.string()),
  problem: v.optional(v.string()),
  numberOrderId: v.optional(v.string()),
  orderReference: v.optional(v.string()),
  orderAttemptAt: v.optional(v.number()),
  numberOrderedAt: v.optional(v.number()),
  brandId: v.optional(v.string()),
  brandAttemptAt: v.optional(v.number()),
  brandVerifiedAt: v.optional(v.number()),
  brandShape: v.optional(v.string()),
  campaignId: v.optional(v.string()),
  campaignReference: v.optional(v.string()),
  campaignAttemptAt: v.optional(v.number()),
  campaignFiledAt: v.optional(v.number()),
  campaignApprovedAt: v.optional(v.number()),
  campaignShape: v.optional(v.string()),
  assignedAt: v.optional(v.number()),
  filedVersion: v.optional(v.number()),
  otp: v.optional(otpValidator),
  needs: v.optional(needsValidator),
  diagnostics: v.optional(v.object({ brand: v.optional(v.string()), campaign: v.optional(v.string()), assignment: v.optional(v.string()), order: v.optional(v.string()) })),
  /** Fields to remove, for example a number order that failed. */
  clear: v.optional(v.array(v.string())),
  /** A registration fee this step makes due. */
  charge: v.optional(v.union(v.literal("setup"), v.literal("resubmission"))),
  /** An event to record for this step (which may also notify the owner). */
  event: v.optional(v.string()),
});
type Progress = typeof progressFields.type;
const CLEARABLE = new Set(["numberOrderId", "orderReference", "orderAttemptAt", "numberOrderedAt", "brandVerifiedAt", "campaignId", "campaignReference", "campaignAttemptAt", "campaignFiledAt", "campaignApprovedAt", "assignedAt", "needs", "otp", "problem"]);

/** Takes the request for one pass. Answers with it, or null if another pass holds it or it is not being worked on. */
export const claim = internalMutation({
  args: { requestId: v.id("textingRequests"), token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || !WORKING.includes(row.status)) return null;
    const now = Date.now();
    if (row.leaseUntil !== undefined && row.leaseUntil > now && row.leaseToken !== args.token) return null;
    await ctx.db.patch(row._id, { leaseUntil: now + LEASE, leaseToken: args.token });
    return (await ctx.db.get(row._id))!;
  },
});

export const release = internalMutation({
  args: { requestId: v.id("textingRequests"), token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (row && row.leaseToken === args.token) await ctx.db.patch(row._id, { leaseUntil: undefined, leaseToken: undefined });
    return null;
  },
});

/** Saves one step's outcome, only while this pass holds the request. Answers with the request as it is now. */
export const progress = internalMutation({
  args: { requestId: v.id("textingRequests"), token: v.string(), change: progressFields },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || !WORKING.includes(row.status) || row.leaseToken !== args.token) return null;
    const { clear, charge, event, diagnostics, ...fields } = args.change;
    const now = Date.now();
    const patch: Record<string, unknown> = { ...fields, lastCheckedAt: now, updatedAt: now, leaseUntil: now + LEASE };
    for (const field of clear ?? []) if (CLEARABLE.has(field)) patch[field] = undefined;
    if (diagnostics) patch.diagnostics = { ...(row.diagnostics ?? {}), ...diagnostics, at: now };
    if (fields.status === "needs_you" || fields.status === "failed" || fields.status === "interrupted") Object.assign(patch, { leaseUntil: undefined, leaseToken: undefined });
    await ctx.db.patch(row._id, patch as Partial<Doc<"textingRequests">>);
    const fresh = (await ctx.db.get(row._id))!;
    if (charge) await chargeFiling(ctx, fresh, charge);
    if (fields.status === "failed") await recordEvent(ctx, { companyId: row.companyId, type: "texting.failed", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { problem: (fields.problem ?? "").slice(0, 300) } });
    if (fields.status === "needs_you" && fields.needs) await recordEvent(ctx, { companyId: row.companyId, type: "texting.needs_you", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { kind: fields.needs.kind } });
    if (event) await recordEvent(ctx, { companyId: row.companyId, type: event, actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { phoneNumber: row.phoneNumber } });
    return fresh;
  },
});

/**
 * The number is on the approved campaign: the company texts from it from now on. The registration is
 * recorded as approved, with exactly what it covers, so the sending policy lets only those texts go.
 */
export const activate = internalMutation({
  args: { requestId: v.id("textingRequests"), token: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || !WORKING.includes(row.status) || row.leaseToken !== args.token) return null;
    const taken = await ctx.db
      .query("complianceProfiles")
      .withIndex("by_sms_number", (q) => q.eq("messaging.smsNumber", row.phoneNumber))
      .take(2);
    if (taken.some((profile) => profile.companyId !== row.companyId)) {
      await ctx.db.patch(row._id, { status: "failed", problem: "This number is set up for another company on Selestial. Staff need to look at it.", leaseUntil: undefined, leaseToken: undefined });
      return null;
    }
    const current = (await readProfile(ctx, row.companyId)).messaging;
    const now = Date.now();
    const guided = row.setupId !== undefined;
    await writeProfile(ctx, row.companyId, {
      messaging: {
        ...current,
        smsNumber: row.phoneNumber,
        senderName: row.brand.displayName,
        registration: {
          status: "approved",
          reference: row.campaignId,
          updatedAt: now,
          updatedBy: "staff",
          note: "Registered with the carriers through Selestial.",
          // An older request filed cleaner work texts only, so that is all it covers.
          coverage: guided ? coverageOf(row.activities ?? []) : [{ audience: "cleaner", category: "operational" }],
          activities: guided ? (row.activities ?? []) : ["job_offers", "job_confirmations", "arrival_reminders", "coverage_requests"],
        },
      },
    });
    if (!guided) {
      // The older form kept its consent wording on the request; the guided setup recorded it when the sign-up page was published.
      const latest = await ctx.db
        .query("consentDisclosures")
        .withIndex("by_company_channel_category", (q) => q.eq("companyId", row.companyId).eq("channel", "sms").eq("category", "operational"))
        .order("desc")
        .first();
      if (latest?.text !== row.consentWording) await ctx.db.insert("consentDisclosures", { companyId: row.companyId, channel: "sms", category: "operational", text: row.consentWording, version: (latest?.version ?? 0) + 1, createdAt: now, createdBy: row.requestedBy });
    }
    await ctx.db.patch(row._id, { status: "active", activeAt: now, step: "Ready. Texts go out from this number.", problem: undefined, needs: undefined, updatedAt: now, leaseUntil: undefined, leaseToken: undefined });
    await recordEvent(ctx, { companyId: row.companyId, type: "texting.active", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { phoneNumber: row.phoneNumber } });
    // The first month's fees, from the day texting is ready.
    await chargeMonth(ctx, (await ctx.db.get(row._id))!, now);
    return null;
  },
});

/** What the brand was filed with, to tell whether a correction changed it. The tax ID is represented by its last four digits only. */
function brandShape(row: Doc<"textingRequests">): string {
  const { ein, ...brand } = row.brand;
  return JSON.stringify([row.entityType ?? "PRIVATE_PROFIT", brand, row.taxIdLast4 ?? ein?.slice(-4) ?? null]);
}

async function brandInput(row: Doc<"textingRequests">): Promise<BrandInput | null> {
  let ein = row.brand.ein?.replace(/\D/g, "");
  if (row.taxIdSealed) ein = (await unseal(row.taxIdSealed, `taxid:${row.companyId}`)) ?? undefined;
  const entityType = row.entityType ?? "PRIVATE_PROFIT";
  if (entityType !== "SOLE_PROPRIETOR" && !ein) return null;
  const b = row.brand;
  return {
    entityType,
    displayName: b.displayName,
    companyName: b.companyName,
    ein,
    firstName: b.firstName,
    lastName: b.lastName,
    mobilePhone: b.mobilePhone,
    phone: b.phone,
    street: b.street,
    city: b.city,
    state: b.state,
    postalCode: b.postalCode,
    email: b.email,
    website: b.website || undefined,
    vertical: b.vertical,
    stockSymbol: b.stockSymbol,
    stockExchange: b.stockExchange,
    businessContactEmail: entityType === "PUBLIC_PROFIT" ? b.email : undefined,
    ...(telnyxWebhookUrl() ? { webhookURL: telnyxWebhookUrl()! } : {}),
  };
}

/** Brand fields Telnyx names, in the setup's words, so the owner is shown exactly which details to check. */
const BRAND_FIELDS: Record<string, string> = { ein: "taxId", companyName: "legalName", displayName: "displayName", street: "street", city: "city", state: "state", postalCode: "postalCode", website: "website", email: "supportEmail", phone: "supportPhone", mobilePhone: "mobilePhone", firstName: "contactFirstName", lastName: "contactLastName" };

/**
 * One provisioning run: up to eight steps, each doing at most one thing at Telnyx, then either continuing
 * or scheduling itself to check again on something the carriers have not answered yet.
 */
export const provision = internalAction({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    let row = await ctx.runMutation(internal.texting.claim, { requestId: args.requestId, token });
    if (!row) return null;
    const save = async (change: Progress) => {
      const fresh = await ctx.runMutation(internal.texting.progress, { requestId: args.requestId, token, change });
      if (fresh) row = fresh;
      return fresh !== null;
    };
    const later = async (delay: number, change: Progress) => {
      if (await save(change)) await ctx.scheduler.runAfter(delay, internal.texting.provision, args);
    };
    /** A failed call ends the run: a retryable failure is tried again shortly, anything else goes to staff. */
    const fail = async (answer: Extract<Answer<unknown>, { ok: false }>, what: string) => {
      if (answer.retryable) await later(5 * MINUTE, { status: "provisioning", step: "Selestial is waiting on the carriers' systems and will try again shortly." });
      else await save({ status: "failed", problem: `${what}: ${answer.problem}`, step: "Selestial ran into a problem and is looking into it. Nothing more is charged." });
    };
    try {
      for (let pass = 0; pass < 8 && row; pass += 1) {
        const r: Doc<"textingRequests"> = row;
        if (Date.now() - (r.decidedAt ?? r.requestedAt) > GIVE_UP_AFTER) {
          await save({ status: "failed", problem: "The carriers have not finished in 45 days. Check the registration with Telnyx.", step: "This is taking much longer than usual. Selestial is looking into it." });
          return null;
        }
        if (!r.setupId && !r.campaignId) {
          await save({ status: "failed", problem: "Filed with the older form, which used Selestial's own privacy links. Ask the company to finish Set up business texting.", step: "Selestial needs you to finish Set up business texting." });
          return null;
        }
        const sole = r.entityType === "SOLE_PROPRIETOR";

        // A. A correction: file what changed. What was bought or approved stays.
        if (r.filedVersion !== undefined && (r.submissionVersion ?? 1) > r.filedVersion) {
          let refiled = false;
          if (r.brandId && brandShape(r) !== r.brandShape) {
            const input = await brandInput(r);
            if (!input) return void (await save({ status: "failed", problem: "The tax ID could not be read (MAILBOX_TOKEN_KEY changed?).", step: "Selestial ran into a problem and is looking into it." }));
            const updated = await updateBrand(fetch, r.brandId, input);
            if (!updated.ok) return void (await fail(updated, "Correcting the business details"));
            const revet = await revetBrand(fetch, r.brandId);
            if (!revet.ok) return void (await fail(revet, "Asking for the business to be verified again"));
            await save({ brandShape: brandShape(r), clear: ["brandVerifiedAt"], diagnostics: { brand: "revet requested" } });
            refiled = true;
          }
          if (r.campaignId && !r.campaignApprovedAt) {
            if (campaignShape(r) !== r.campaignShape) {
              // What it covers changed, so it is filed as a new campaign; the turned-down one is left as it is.
              await save({ clear: ["campaignId", "campaignReference", "campaignAttemptAt", "campaignFiledAt"], diagnostics: { campaign: `replaced ${r.campaignId}` } });
            } else {
              const updated = await updateCampaign(fetch, r.campaignId, campaignCorrection(r, telnyxWebhookUrl()));
              if (!updated.ok) return void (await fail(updated, "Correcting the campaign"));
              if (CAMPAIGN_APPEALABLE.has(updated.value.campaignStatus ?? "")) {
                const appealed = await appealCampaign(fetch, r.campaignId, "The business corrected its texting registration (samples, opt-in description and replies) and asks for it to be reviewed again.");
                if (!appealed.ok) return void (await fail(appealed, "Asking for the campaign to be reviewed again"));
              }
              await save({ diagnostics: { campaign: updated.value.campaignStatus ?? "updated" } });
            }
            refiled = true;
          }
          await save({ status: "waiting_on_carriers", filedVersion: r.submissionVersion ?? 1, step: refiled ? "Your corrected details are filed. Waiting for the carriers." : "Continuing with your updated details.", ...(refiled ? { charge: "resubmission" as const } : {}) });
          continue;
        }

        // B. The brand: the company itself.
        if (!r.brandId) {
          const input = await brandInput(r);
          if (!input) return void (await save({ status: "failed", problem: "No readable tax ID for a business that needs one.", step: "Selestial ran into a problem and is looking into it." }));
          if (r.brandAttemptAt !== undefined) {
            // An earlier attempt's answer was lost. Look for the brand it may have made before filing again.
            const found = await findBrands(fetch, input.displayName);
            if (!found.ok) return void (await fail(found, "Looking for the business filing"));
            const mine = found.value.find((brand) => brand.email?.toLowerCase() === input.email.toLowerCase());
            if (mine) {
              await save({ brandId: mine.brandId, brandShape: brandShape(r), filedVersion: r.submissionVersion ?? 1, charge: "setup", status: "waiting_on_carriers", step: "Your business is filed and being verified." });
              continue;
            }
            if (Date.now() - r.brandAttemptAt < SETTLE) return void (await later(SETTLE, { status: "provisioning" }));
          }
          await save({ brandAttemptAt: Date.now(), status: "provisioning", step: "Filing your business with the carriers." });
          const brand = await createBrand(fetch, input);
          if (!brand.ok) return void (await fail(brand, "Filing the business"));
          await save({ brandId: brand.value.brandId, brandShape: brandShape(r), filedVersion: r.submissionVersion ?? 1, charge: "setup", status: "waiting_on_carriers", step: "Your business is filed and being verified.", diagnostics: { brand: `${brand.value.identityStatus ?? ""} ${brand.value.status ?? ""}`.trim() } });
          continue;
        }
        if (r.brandVerifiedAt === undefined && !r.campaignId) {
          const brand = await getBrand(fetch, r.brandId);
          if (!brand.ok) return void (await fail(brand, "Checking the business verification"));
          const diag = { brand: `${brand.value.identityStatus ?? ""} ${brand.value.status ?? ""}`.trim() };
          if (BRAND_READY.has(brand.value.identityStatus ?? "")) {
            await save({ brandVerifiedAt: Date.now(), diagnostics: diag, step: "Your business is verified." });
            continue;
          }
          if (brandFailed(brand.value)) {
            const fields = [...new Set(brand.value.fields.map((field) => BRAND_FIELDS[field]).filter(Boolean))];
            const words = sole
              ? "The carriers couldn't verify your details. Check that your name, address and mobile number are exactly right, then send them again."
              : "The carriers couldn't match your business to IRS records. Check that your legal name and EIN match your IRS letter exactly (for example your CP 575 or 147C), and that the address is the one the IRS has.";
            return void (await save({ status: "needs_you", needs: { kind: "correction", words, fields, at: Date.now() }, diagnostics: { brand: `${diag.brand}: ${brand.value.failure ?? ""}`.slice(0, 500) }, step: "The carriers asked for a correction." }));
          }
          if (sole && !r.otp) {
            // A sole proprietor confirms it is them with a code the carriers text to their own mobile.
            const name = r.brand.displayName;
            const sent = await sendBrandCode(fetch, r.brandId, { pinSms: `${name}: your code to confirm your business texting registration is @OTP_PIN@. It works for 24 hours.`, successSms: `${name}: you're confirmed. Your texting registration continues.` });
            if (!sent.ok) return void (await fail(sent, "Sending the confirmation code"));
            const ending = (r.brand.mobilePhone ?? "").slice(-4);
            return void (await save({ status: "needs_you", otp: { ...(sent.value.referenceId ? { referenceId: sent.value.referenceId } : {}), sentAt: Date.now(), attempts: 0 }, needs: { kind: "code", words: `The carriers texted a code to your mobile ending in ${ending}. Enter it here to confirm it's you. It works for 24 hours.`, fields: [], at: Date.now() }, diagnostics: diag, step: "Waiting for your confirmation code." }));
          }
          return void (await later(30 * MINUTE, { status: "waiting_on_carriers", diagnostics: diag, step: "The carriers are verifying your business." }));
        }

        // C. The campaign: what the company texts, and how people agree to it.
        if (!r.campaignId) {
          const reference = r.campaignReference ?? `sel-${r._id}-v${r.submissionVersion ?? 1}`;
          if (r.campaignAttemptAt !== undefined && r.campaignReference) {
            const found = await findCampaigns(fetch, r.brandId);
            if (!found.ok) return void (await fail(found, "Looking for the campaign filing"));
            const mine = found.value.find((campaign) => campaign.referenceId === r.campaignReference);
            if (mine) {
              await save({ campaignId: mine.campaignId, campaignFiledAt: Date.now(), campaignShape: campaignShape(r), status: "waiting_on_carriers", step: "How you'll text is filed and waiting for carrier review." });
              continue;
            }
            if (Date.now() - r.campaignAttemptAt < SETTLE) return void (await later(SETTLE, { status: "waiting_on_carriers" }));
          }
          await save({ campaignReference: reference, campaignAttemptAt: Date.now() });
          const campaign = await createCampaign(fetch, campaignFor(r, { brandId: r.brandId, reference, webhookURL: telnyxWebhookUrl() }));
          if (!campaign.ok) return void (await fail(campaign, "Filing the campaign"));
          await save({ campaignId: campaign.value.campaignId, campaignFiledAt: Date.now(), campaignShape: campaignShape(r), status: "waiting_on_carriers", step: "How you'll text is filed and waiting for carrier review.", diagnostics: { campaign: campaign.value.campaignStatus ?? "" } });
          continue;
        }
        if (r.campaignApprovedAt === undefined) {
          const campaign = await getCampaign(fetch, r.campaignId);
          if (!campaign.ok) return void (await fail(campaign, "Checking the campaign"));
          const status = campaign.value.campaignStatus ?? "";
          const diag = { campaign: `${status}${campaign.value.failure ? `: ${campaign.value.failure}` : ""}`.slice(0, 500) };
          if (CAMPAIGN_READY.has(status)) {
            await save({ campaignApprovedAt: Date.now(), diagnostics: diag, step: "The carriers approved how you'll text.", event: "texting.campaign_approved" });
            continue;
          }
          if (CAMPAIGN_REJECTED.has(status)) {
            const said = campaign.value.failure ? ` The carriers said: "${campaign.value.failure.slice(0, 300)}"` : "";
            return void (await save({ status: "needs_you", needs: { kind: "correction", words: `The carriers asked for changes to how you'll text.${said} Review your sign-up wording, pages and sample messages, then send them again. Selestial can help: reply to the email about this.`, fields: [], at: Date.now() }, diagnostics: diag, step: "The carriers asked for a correction." }));
          }
          return void (await later(30 * MINUTE, { status: "waiting_on_carriers", diagnostics: diag, step: "The carriers are reviewing how you'll text." }));
        }

        // D. The number: checked again, then bought, only now that the carriers approved.
        if (r.numberOrderedAt === undefined) {
          if (!r.numberOrderId) {
            const reference = r.orderReference ?? `sel-num-${r._id}-${r.phoneNumber.replace(/\D/g, "")}`;
            if (r.orderAttemptAt !== undefined && r.orderReference) {
              const found = await findOrders(fetch, r.orderReference);
              if (!found.ok) return void (await fail(found, "Looking for the number order"));
              const mine = found.value.find((order) => order.status === "success" || order.status === "pending");
              if (mine) {
                await save({ numberOrderId: mine.orderId, diagnostics: { order: mine.status } });
                continue;
              }
              if (Date.now() - r.orderAttemptAt < SETTLE) return void (await later(SETTLE, { status: "provisioning" }));
            }
            const available = await stillAvailable(fetch, r.phoneNumber);
            if (!available.ok) return void (await fail(available, "Checking the number is still available"));
            if (!available.value) {
              return void (await save({ status: "needs_you", needs: { kind: "number", words: `The number you chose, ${r.phoneNumber}, was taken while the carriers reviewed your registration. Choose another number; nothing was bought or charged for it.`, fields: [], at: Date.now() }, clear: ["orderReference", "orderAttemptAt"], step: "Choose another number." }));
            }
            await save({ orderReference: reference, orderAttemptAt: Date.now(), status: "provisioning", step: "Buying your number." });
            const ordered = await orderNumber(fetch, { phoneNumber: r.phoneNumber, messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID?.trim() || null, reference });
            if (!ordered.ok) return void (await fail(ordered, "Buying the number"));
            await save({ numberOrderId: ordered.value.orderId, diagnostics: { order: ordered.value.status } });
            continue;
          }
          const order = await getNumberOrder(fetch, r.numberOrderId);
          if (!order.ok) return void (await fail(order, "Checking the number order"));
          if (order.value.status === "pending") return void (await later(MINUTE, { status: "provisioning", diagnostics: { order: "pending" }, step: "Buying your number." }));
          if (order.value.status !== "success") {
            return void (await save({ status: "needs_you", needs: { kind: "number", words: `The number ${r.phoneNumber} couldn't be bought after all. Choose another number; nothing was charged for it.`, fields: [], at: Date.now() }, clear: ["numberOrderId", "orderReference", "orderAttemptAt"], diagnostics: { order: order.value.status }, step: "Choose another number." }));
          }
          await save({ numberOrderedAt: Date.now(), diagnostics: { order: "success" }, step: "Your number is bought." });
          continue;
        }

        // E. The number on the approved campaign. This can stay pending for days after approval.
        if (r.assignedAt === undefined) {
          const assigned = await assignNumber(fetch, { phoneNumber: r.phoneNumber, campaignId: r.campaignId });
          if (!assigned.ok && assigned.status === 409) {
            // Already on the campaign from an earlier attempt whose answer was lost.
            await save({ assignedAt: Date.now(), diagnostics: { assignment: "already requested" } });
            continue;
          }
          if (!assigned.ok) return void (await fail(assigned, "Connecting the number"));
          await save({ assignedAt: Date.now(), status: "waiting_on_carriers", diagnostics: { assignment: assigned.value.assignmentStatus ?? "" }, step: "The carriers are connecting your number." });
          continue;
        }
        const assignment = await getAssignment(fetch, r.phoneNumber);
        if (!assignment.ok) return void (await fail(assignment, "Checking the number connection"));
        const status = assignment.value.assignmentStatus ?? "";
        if (ASSIGNMENT_FAILED.has(status)) return void (await save({ status: "failed", problem: `The number could not be put on the campaign (${status}). ${assignment.value.failure ?? ""}`.trim(), diagnostics: { assignment: status }, step: "Connecting your number ran into a problem. Selestial is looking into it." }));
        if (status !== ASSIGNED) return void (await later(30 * MINUTE, { status: "waiting_on_carriers", diagnostics: { assignment: status }, step: "The carriers are connecting your number. Texts wait until it's done." }));
        await ctx.runMutation(internal.texting.activate, { requestId: args.requestId, token });
        return null;
      }
      // Eight steps in one run: keep going in a fresh run.
      if (row) await ctx.scheduler.runAfter(0, internal.texting.provision, args);
      return null;
    } finally {
      await ctx.runMutation(internal.texting.release, { requestId: args.requestId, token });
    }
  },
});

// ── A sole proprietor's one-time code ────────────────────────────────────────────────────────────

/** The owner enters the code the carriers texted them. */
export const confirmCode = ownerMutation({
  args: { requestId: v.id("textingRequests"), code: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    if (row.status !== "needs_you" || row.needs?.kind !== "code" || !row.otp) throw userError("No code is needed right now.");
    const code = args.code.replace(/\s/g, "");
    if (!/^[0-9A-Za-z]{4,10}$/.test(code)) throw userError("Enter the code exactly as it was texted to you.");
    if (!(await allow(ctx, `texting-code:${row._id}`, 10, HOUR))) throw userError("Too many tries. Wait a little, or send a new code.");
    if (Date.now() - row.otp.sentAt > DAY) throw userError("That code has expired. Send a new one.");
    await ctx.scheduler.runAfter(0, internal.texting.checkCode, { requestId: row._id, code });
    return null;
  },
});

export const resendCode = ownerMutation({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    if (row.status !== "needs_you" || row.needs?.kind !== "code") throw userError("No code is needed right now.");
    if (!(await allow(ctx, `texting-code-send:${row._id}`, 5, DAY))) throw userError("That's several codes today. Try again tomorrow, or write to support.");
    // Back to working without a code: the next run sends a fresh one.
    await ctx.db.patch(row._id, { status: "waiting_on_carriers", otp: undefined, needs: undefined, step: "Sending you a new code.", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
    return null;
  },
});

export const checkCode = internalAction({
  args: { requestId: v.id("textingRequests"), code: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.texting.requestRow, { requestId: args.requestId });
    if (!row || row.status !== "needs_you" || row.needs?.kind !== "code" || !row.brandId) return null;
    const answer = await verifyBrandCode(fetch, row.brandId, args.code);
    await ctx.runMutation(internal.texting.codeChecked, { requestId: args.requestId, ok: answer.ok, retryable: !answer.ok && answer.retryable });
    return null;
  },
});

export const requestRow = internalQuery({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => ctx.db.get(args.requestId),
});

export const codeChecked = internalMutation({
  args: { requestId: v.id("textingRequests"), ok: v.boolean(), retryable: v.boolean() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || row.status !== "needs_you" || row.needs?.kind !== "code" || !row.otp) return null;
    const now = Date.now();
    if (args.ok) {
      await ctx.db.patch(row._id, { status: "waiting_on_carriers", needs: undefined, otp: { ...row.otp, verifiedAt: now }, step: "You're confirmed. The carriers are finishing your verification.", updatedAt: now });
      await recordEvent(ctx, { companyId: row.companyId, type: "texting.code_confirmed", actor: SYSTEM, subject: { table: "textingRequests", id: row._id } });
      await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
      return null;
    }
    await ctx.db.patch(row._id, {
      otp: { ...row.otp, attempts: row.otp.attempts + 1 },
      needs: { ...row.needs, words: args.retryable ? "The carriers' system didn't answer. Enter the code again in a minute." : "That code didn't work. Check it and enter it again, or send a new code.", at: now },
      updatedAt: now,
    });
    return null;
  },
});

// ── Callbacks and reconciliation ─────────────────────────────────────────────────────────────────

/**
 * A signed 10DLC callback from Telnyx: recorded once, then the request it is about is checked at once.
 * The callback's own status is not trusted; provisioning reads the state back from Telnyx.
 */
export const registrationEvent = internalMutation({
  args: { eventId: v.string(), type: v.string(), brandId: v.optional(v.string()), campaignId: v.optional(v.string()), phoneNumber: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const seen = await ctx.db
      .query("telnyxEvents")
      .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seen) return null;
    let row: Doc<"textingRequests"> | null = null;
    if (args.campaignId) {
      row = await ctx.db
        .query("textingRequests")
        .withIndex("by_campaign", (q) => q.eq("campaignId", args.campaignId))
        .first();
    }
    if (!row && args.brandId) {
      row = await ctx.db
        .query("textingRequests")
        .withIndex("by_brand", (q) => q.eq("brandId", args.brandId))
        .first();
    }
    await ctx.db.insert("telnyxEvents", { eventId: args.eventId, type: args.type.slice(0, 60), ...(args.campaignId || args.brandId ? { ref: (args.campaignId ?? args.brandId)!.slice(0, 100) } : {}), ...(row ? { requestId: row._id } : {}), receivedAt: Date.now() });
    if (!row) return null;
    if (WORKING.includes(row.status)) await ctx.scheduler.runAfter(0, internal.texting.provision, { requestId: row._id });
    else if (row.status === "active") await ctx.scheduler.runAfter(0, internal.texting.checkActive, { requestId: row._id });
    return null;
  },
});

/** Every half hour: any request the carriers are working on that has not been checked for six hours is checked. Callbacks can be lost. */
export const reconcile = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let scheduled = 0;
    for (const status of WORKING) {
      const rows = await ctx.db
        .query("textingRequests")
        .withIndex("by_status_requested", (q) => q.eq("status", status))
        .take(200);
      for (const row of rows) {
        const leased = row.leaseUntil !== undefined && row.leaseUntil > now;
        if (leased || (row.lastCheckedAt ?? 0) > now - 6 * HOUR) continue;
        await ctx.scheduler.runAfter(scheduled * 2_000, internal.texting.provision, { requestId: row._id });
        scheduled += 1;
      }
    }
    return scheduled;
  },
});

/** Once a day for each active registration, and on a callback: still approved? A suspension stops texts until it is restored. */
export const checkActive = internalAction({
  args: { requestId: v.id("textingRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.texting.requestRow, args);
    if (!row || (row.status !== "active" && row.status !== "interrupted") || !row.campaignId) return null;
    const campaign = await getCampaign(fetch, row.campaignId);
    if (!campaign.ok) return null;
    const stopped = CAMPAIGN_INTERRUPTED.has(campaign.value.campaignStatus ?? "") || campaign.value.status === "EXPIRED";
    await ctx.runMutation(internal.texting.activeChecked, { requestId: args.requestId, stopped, status: `${campaign.value.campaignStatus ?? ""} ${campaign.value.status ?? ""}`.trim() });
    return null;
  },
});

export const activeChecked = internalMutation({
  args: { requestId: v.id("textingRequests"), stopped: v.boolean(), status: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row) return null;
    const now = Date.now();
    const profile = (await readProfile(ctx, row.companyId)).messaging;
    if (args.stopped && row.status === "active") {
      await ctx.db.patch(row._id, { status: "interrupted", step: "The carriers paused texting from your number. Selestial is looking into it and will tell you what's needed.", diagnostics: { ...(row.diagnostics ?? {}), campaign: args.status, at: now }, updatedAt: now, lastCheckedAt: now });
      await writeProfile(ctx, row.companyId, { messaging: { ...profile, registration: { ...profile.registration, status: "suspended", updatedAt: now, updatedBy: "staff", note: "The carriers suspended the registration." } } });
      await recordEvent(ctx, { companyId: row.companyId, type: "texting.interrupted", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { status: args.status.slice(0, 100) } });
    } else if (!args.stopped && row.status === "interrupted") {
      await ctx.db.patch(row._id, { status: "active", step: "Ready. Texts go out from this number.", updatedAt: now, lastCheckedAt: now });
      await writeProfile(ctx, row.companyId, { messaging: { ...profile, registration: { ...profile.registration, status: "approved", updatedAt: now, updatedBy: "staff", note: "Registered with the carriers through Selestial." } } });
      await recordEvent(ctx, { companyId: row.companyId, type: "texting.active", actor: SYSTEM, subject: { table: "textingRequests", id: row._id }, data: { phoneNumber: row.phoneNumber } });
    } else {
      await ctx.db.patch(row._id, { lastCheckedAt: now });
    }
    return null;
  },
});

export const checkAllActive = internalMutation({
  args: {},
  handler: async (ctx) => {
    let n = 0;
    for (const status of ["active", "interrupted"] as const) {
      const rows = await ctx.db
        .query("textingRequests")
        .withIndex("by_status_requested", (q) => q.eq("status", status))
        .take(500);
      for (const row of rows) {
        await ctx.scheduler.runAfter(n * 2_000, internal.texting.checkActive, { requestId: row._id });
        n += 1;
      }
    }
    return n;
  },
});

/** The company's texting request in a few words, for any member: what agents can rely on. Details stay with the owner. */
export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("textingRequests")
      .withIndex("by_company_requested", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .first();
    if (!row) return null;
    return { status: row.status, phoneNumber: row.status === "active" ? row.phoneNumber : null, step: row.step ?? null, needsOwner: row.status === "needs_you" };
  },
});

export type { Id };
