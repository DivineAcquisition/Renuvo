/**
 * "Set up business texting": the owner's guided, saved setup (docs/texting/00-audit.md §5).
 *
 * Every change is saved as it is made, so leaving and coming back from any entry point resumes on the same
 * step with the same answers. Nothing here buys, files or charges anything: submitting creates a request
 * for Selestial review (convex/texting.ts), and provisioning works from the submission copied at that
 * moment. A correction edits this setup again and becomes a new submission version.
 *
 * The tax ID arrives only through `setTaxId`, is sealed before it is stored, and is never returned, logged,
 * put in an event or shown to a model. Only its last four digits are.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import { ownerMutation, ownerQuery } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { meteringOn } from "./lib/messagingBilling/ledger";
import { allow } from "./lib/rateLimit";
import { seal, secretsConfigured } from "./lib/recruiter/secrets";
import { ACTIVITIES, GROUP_WORDS, isActivityKey } from "./lib/texting/activities";
import { activityProblems, businessProblems, draftProblems, ENTITY_WORDS, needsTaxId, usPhone, VERTICALS, type PlaceState } from "./lib/texting/checks";
import { draftFor, type DraftInput } from "./lib/texting/drafts";
import { milestones } from "./lib/texting/milestones";
import { currentPage, ensureHandle, handleOf, linksFor, publishPage, type Links } from "./lib/texting/pages";
import { describe, planFor, sampleFor, sampleKeys } from "./lib/texting/plan";
import { findDetails, fill, sourceWords } from "./lib/texting/prefill";
import { chargesAt, registrationPricesAt, registrationWording } from "./lib/texting/prices";
import { BUSINESS_FIELDS, businessValidator, DRAFT_KEYS, PERMISSION_PLACES, SETUP_STEPS, type Business, type DraftKey, type EntityType, type SetupStep } from "./lib/texting/schema";
import { literals } from "./lib/statuses";

const HOUR = 3_600_000;
/** A request in one of these states is with Selestial or the carriers: the setup is read-only until it comes back. */
const EDITABLE_REQUEST: Doc<"textingRequests">["status"][] = ["needs_you", "rejected", "cancelled"];
const DRAFT_MAX: Record<DraftKey, number> = { sms_consent: 1000, marketing_consent: 1000, terms: 8000, privacy: 12000, help_reply: 255, stop_reply: 255, start_reply: 255, opt_in_flow: 2048 };

type Ctx = QueryCtx | MutationCtx;

export async function setupOf(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"textingSetups"> | null> {
  return ctx.db
    .query("textingSetups")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .unique();
}

async function latestRequest(ctx: Ctx, companyId: Id<"companies">): Promise<Doc<"textingRequests"> | null> {
  return ctx.db
    .query("textingRequests")
    .withIndex("by_company_requested", (q) => q.eq("companyId", companyId))
    .order("desc")
    .first();
}

async function requestOf(ctx: Ctx, setup: Doc<"textingSetups">): Promise<Doc<"textingRequests"> | null> {
  return setup.requestId ? ctx.db.get(setup.requestId) : null;
}

/** The owner can change their answers when nothing is filed yet, or when a correction or a new number is asked for. Not while a code is awaited. */
const editable = (request: Doc<"textingRequests"> | null) => !request || (EDITABLE_REQUEST.includes(request.status) && request.needs?.kind !== "code");

async function draftInput(ctx: Ctx, setup: Pick<Doc<"textingSetups">, "business" | "activities" | "places" | "otherPlace" | "hosting" | "ownSite">, company: Doc<"companies">, handle: string | null): Promise<DraftInput> {
  const profile = await readProfile(ctx, company._id);
  const b = setup.business;
  const links: Links = linksFor(setup, handle) ?? { privacy: "(your privacy policy link)", terms: "(your texting terms link)", signup: "(your sign-up link)" };
  return {
    name: b.displayName || company.name,
    legalName: b.entityType === "SOLE_PROPRIETOR" ? [b.contactFirstName, b.contactLastName].filter(Boolean).join(" ") || undefined : b.legalName,
    website: b.website,
    supportEmail: b.supportEmail,
    supportPhone: b.supportPhone,
    street: b.street,
    city: b.city,
    state: b.state,
    postalCode: b.postalCode,
    activities: setup.activities,
    marketingPerWeek: profile.messaging.frequency.marketingPerWeek,
    links,
    places: setup.places,
    otherPlace: setup.otherPlace,
  };
}

/** Rewrites every draft the owner has not edited, from the details as they are now. Their own words are never replaced. */
function regenerated(drafts: Doc<"textingSetups">["drafts"], input: DraftInput, now: number): Doc<"textingSetups">["drafts"] {
  const out = { ...drafts };
  for (const key of DRAFT_KEYS) {
    if (out[key]?.edited) continue;
    const text = draftFor(key, input);
    if (out[key]?.text !== text) out[key] = { text, edited: false, at: now };
  }
  return out;
}

// ── Opening ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Opens the company's setup, creating it the first time from what Selestial already knows. Every entry
 * point calls this and lands on the same saved setup.
 */
export const open = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await setupOf(ctx, ctx.companyId);
    if (existing) return existing._id;
    const now = Date.now();
    const found = await findDetails(ctx, ctx.company, ctx.member);
    const filled = fill({}, found);
    const business: Business = { ...filled.business, vertical: "PROFESSIONAL" };
    const sources = [...filled.sources, { field: "vertical", source: "company" as const, confirmed: false }];
    const notes = filled.notes.map((words, i) => ({ key: `prefill-${i}`, step: "business" as const, words, at: now }));
    notes.push({ key: "vertical", step: "business", words: "Carriers don't list cleaning as a kind of business, so I chose Professional services, the closest fit. Change it if another fits better.", at: now });
    // A company that already asked for a number through the older form keeps that request here.
    const earlier = await latestRequest(ctx, ctx.companyId);
    const handle = await handleOf(ctx, ctx.companyId);
    const base = { business, activities: [] as string[], places: [] as string[], hosting: "selestial" as const, ownSite: undefined, otherPlace: undefined };
    const drafts = regenerated({}, await draftInput(ctx, base, ctx.company, handle), now);
    return ctx.db.insert("textingSetups", {
      companyId: ctx.companyId,
      step: earlier && !["rejected", "cancelled"].includes(earlier.status) ? "progress" : "business",
      business,
      sources,
      activities: [],
      places: [],
      drafts,
      samples: {},
      hosting: "selestial",
      checks: [],
      notes,
      ...(earlier && !["rejected", "cancelled"].includes(earlier.status) ? { requestId: earlier._id } : {}),
      revision: 1,
      updatedAt: now,
      updatedBy: ctx.member._id,
    });
  },
});

// ── Saving ──────────────────────────────────────────────────────────────────────────────────────────

function cleanBusiness(patch: Business): Business {
  const out: Business = {};
  for (const field of BUSINESS_FIELDS) {
    const raw = patch[field];
    if (raw === undefined) continue;
    let value = raw.trim().replace(/\s+/g, " ").slice(0, 120);
    if (field === "state") value = value.toUpperCase().slice(0, 2);
    if (field === "postalCode") value = value.replace(/[^\d]/g, "").slice(0, 5);
    if ((field === "supportPhone" || field === "mobilePhone") && value) value = usPhone(value) ?? value;
    if (field === "website" && value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
    if ((field === "supportEmail" || field === "contactEmail") && value) value = value.toLowerCase();
    if (field === "entityType" && value && !(value in ENTITY_WORDS)) throw userError("Choose what kind of business this is.");
    if (field === "vertical" && value && !VERTICALS.some((row) => row.value === value)) throw userError("Choose the kind of business that fits best.");
    out[field] = value;
  }
  return out;
}

function checkUrl(value: string | undefined, label: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw userError(`${label} isn't a web address.`);
  }
  if (url.protocol !== "https:") throw userError(`${label} must start with https://.`);
  return url.toString().slice(0, 300);
}

async function writable(ctx: MutationCtx, companyId: Id<"companies">, revision: number) {
  const setup = await setupOf(ctx, companyId);
  if (!setup) notFound();
  if (setup.revision !== revision) throw userError("This setup was changed in another window. The latest is shown now; make your change again.");
  return setup;
}

export const save = ownerMutation({
  support: { capability: "records.edit", summary: "corrected your texting registration details" },
  args: {
    revision: v.number(),
    step: v.optional(literals(SETUP_STEPS)),
    business: v.optional(businessValidator),
    /** Fields the owner confirmed as correct. */
    confirm: v.optional(v.array(v.string())),
    noTaxId: v.optional(v.boolean()),
    activities: v.optional(v.array(v.string())),
    places: v.optional(v.array(v.string())),
    otherPlace: v.optional(v.string()),
    drafts: v.optional(v.record(v.string(), v.string())),
    samples: v.optional(v.record(v.string(), v.string())),
    hosting: v.optional(v.union(v.literal("selestial"), v.literal("own_site"))),
    ownSite: v.optional(v.object({ privacyUrl: v.optional(v.string()), termsUrl: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const setup = await writable(ctx, ctx.companyId, args.revision);
    const request = await requestOf(ctx, setup);
    const changesAnswers = Object.keys(args).some((key) => !["revision", "step", "companyId"].includes(key));
    if (changesAnswers && !editable(request)) throw userError("Your details are with Selestial and the carriers now, so they can't be changed here. If something is wrong, withdraw the request or write to support.");
    const now = Date.now();
    const patch: Partial<Doc<"textingSetups">> = { revision: setup.revision + 1, updatedAt: now, updatedBy: ctx.member._id };
    if (args.step) patch.step = args.step;

    let business = setup.business;
    let sources = setup.sources;
    if (args.business) {
      const cleaned = cleanBusiness(args.business);
      business = { ...business };
      for (const [field, value] of Object.entries(cleaned) as [keyof Business, string][]) {
        if (business[field] === value) continue;
        if (value) business[field] = value;
        else delete business[field];
        // A detail the owner typed is theirs, and confirmed by typing it.
        sources = [...sources.filter((row) => row.field !== field), { field, source: "owner", confirmed: true }];
      }
      patch.business = business;
    }
    if (args.confirm?.length) {
      sources = sources.map((row) => (args.confirm!.includes(row.field) ? { ...row, confirmed: true } : row));
    }
    if (sources !== setup.sources) patch.sources = sources;
    if (args.noTaxId !== undefined) patch.noTaxId = args.noTaxId;
    if (args.activities) patch.activities = [...new Set(args.activities.filter(isActivityKey))];
    if (args.places) patch.places = [...new Set(args.places.filter((place) => (PERMISSION_PLACES as readonly string[]).includes(place)))];
    if (args.otherPlace !== undefined) patch.otherPlace = args.otherPlace.trim().slice(0, 300) || undefined;
    if (args.hosting) patch.hosting = args.hosting;
    if (args.ownSite) patch.ownSite = { privacyUrl: checkUrl(args.ownSite.privacyUrl, "The privacy policy address"), termsUrl: checkUrl(args.ownSite.termsUrl, "The texting terms address") };
    let drafts = setup.drafts;
    if (args.drafts) {
      drafts = { ...drafts };
      for (const [key, text] of Object.entries(args.drafts)) {
        if (!(DRAFT_KEYS as readonly string[]).includes(key)) continue;
        const trimmed = text.trim();
        if (trimmed.length > DRAFT_MAX[key as DraftKey]) throw userError("That text is too long.");
        // Clearing a draft gives Selestial's version back.
        drafts[key] = trimmed ? { text: trimmed, edited: true, at: now } : { text: "", edited: false, at: now };
      }
    }
    if (args.samples) {
      const samples = { ...setup.samples };
      for (const [key, text] of Object.entries(args.samples)) {
        if (!isActivityKey(key)) continue;
        const trimmed = text.trim();
        if (trimmed.length > 255) throw userError("A sample message can be up to 255 characters.");
        if (trimmed) samples[key] = trimmed;
        else delete samples[key];
      }
      patch.samples = samples;
    }
    const next = { ...setup, ...patch };
    patch.drafts = regenerated(drafts, await draftInput(ctx, next, ctx.company, await handleOf(ctx, ctx.companyId)), now);
    await ctx.db.patch(setup._id, patch);
    return { revision: setup.revision + 1 };
  },
});

/** Seals and keeps the EIN. The number itself is never returned or recorded anywhere readable. */
export const setTaxId = ownerMutation({
  args: { revision: v.number(), taxId: v.string() },
  handler: async (ctx, args) => {
    const setup = await writable(ctx, ctx.companyId, args.revision);
    if (!editable(await requestOf(ctx, setup))) throw userError("Your details are with Selestial and the carriers now, so they can't be changed here.");
    if (!(await allow(ctx, `texting-taxid:${ctx.companyId}`, 20, HOUR))) throw userError("Too many attempts. Try again in a little while.");
    const digits = args.taxId.replace(/[\s-]/g, "");
    if (!/^\d{9}$/.test(digits)) throw userError("An EIN is 9 digits, for example 12-3456789.");
    const sealed = await seal(digits, `taxid:${ctx.companyId}`);
    if (!sealed) throw userError("Selestial can't store your EIN securely right now, so it wasn't saved. Try again later or write to support.");
    const now = Date.now();
    await ctx.db.patch(setup._id, { taxId: { sealed, last4: digits.slice(-4), at: now, by: ctx.member._id }, noTaxId: false, revision: setup.revision + 1, updatedAt: now, updatedBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "texting.tax_id_saved", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return { revision: setup.revision + 1, last4: digits.slice(-4) };
  },
});

export const clearTaxId = ownerMutation({
  args: { revision: v.number() },
  handler: async (ctx, args) => {
    const setup = await writable(ctx, ctx.companyId, args.revision);
    if (!editable(await requestOf(ctx, setup))) throw userError("Your details are with Selestial and the carriers now, so they can't be changed here.");
    await ctx.db.patch(setup._id, { taxId: undefined, revision: setup.revision + 1, updatedAt: Date.now(), updatedBy: ctx.member._id });
    return { revision: setup.revision + 1 };
  },
});

// ── Pages ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Publishes the company's texting pages from the current drafts: its privacy policy and texting terms
 * (unless it uses its own), and its sign-up page, which records every permission against the exact wording
 * shown. Gives the company a public address first if it has none. Then checks every link answers.
 */
export const publish = ownerMutation({
  args: { revision: v.number() },
  handler: async (ctx, args) => {
    const setup = await writable(ctx, ctx.companyId, args.revision);
    if (!editable(await requestOf(ctx, setup))) throw userError("Your pages are part of a registration under review, so they can't be republished here.");
    const input = await draftInput(ctx, setup, ctx.company, await handleOf(ctx, ctx.companyId));
    const states = draftProblems(setup.drafts, input);
    const required: DraftKey[] = setup.hosting === "own_site" ? ["sms_consent", "marketing_consent"] : ["sms_consent", "marketing_consent", "terms", "privacy"];
    const missing = states.filter((row) => required.includes(row.key) && row.gaps.length > 0);
    if (missing.length) throw userError(`Before publishing, ${missing.map((row) => `your ${PAGE_WORDS[row.key]} needs to ${row.gaps[0]}`).join("; ")}.`);
    const hadHandle = await handleOf(ctx, ctx.companyId);
    const handle = await ensureHandle(ctx, ctx.company);
    // The drafts quote the page links, so they are rewritten now that the address exists.
    const now = Date.now();
    const drafts = regenerated(setup.drafts, await draftInput(ctx, setup, ctx.company, handle), now);
    const published: string[] = [];
    if (setup.hosting !== "own_site") {
      if ((await publishPage(ctx, { companyId: ctx.companyId, kind: "privacy", body: drafts.privacy.text, by: ctx.member._id })).changed) published.push("privacy policy");
      if ((await publishPage(ctx, { companyId: ctx.companyId, kind: "terms", body: drafts.terms.text, by: ctx.member._id })).changed) published.push("texting terms");
    }
    const marketing = drafts.marketing_consent?.text || undefined;
    if ((await publishPage(ctx, { companyId: ctx.companyId, kind: "signup", body: drafts.sms_consent.text, marketing, by: ctx.member._id })).changed) published.push("sign-up page");
    const notes = [...setup.notes];
    if (!hadHandle) notes.push({ key: `handle-${now}`, step: "permission", words: `I gave your company the public address "${handle}" for its pages. It's also your booking page address.`, at: now });
    if (published.length) notes.push({ key: `publish-${now}`, step: "permission", words: `I published your ${listWords(published)}. I'm checking each link opens.`, at: now });
    await ctx.db.patch(setup._id, { drafts, notes: notes.slice(-40), revision: setup.revision + 1, updatedAt: now, updatedBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "texting.pages_published", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { pages: published.join(", ") } });
    await ctx.scheduler.runAfter(0, internal.textingSetup.checkPages, { setupId: setup._id });
    return { revision: setup.revision + 1 };
  },
});

const PAGE_WORDS: Record<DraftKey, string> = { sms_consent: "text permission wording", marketing_consent: "marketing permission wording", terms: "texting terms", privacy: "privacy policy", help_reply: "HELP reply", stop_reply: "STOP reply", start_reply: "START reply", opt_in_flow: "opt-in description" };
const listWords = (words: string[]) => (words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

/** Checks again that every link opens. Limited, because it fetches pages. */
export const checkNow = ownerMutation({
  args: {},
  support: { capability: "agents.recover", summary: "checked your texting pages again" },
  handler: async (ctx) => {
    const setup = await setupOf(ctx, ctx.companyId);
    if (!setup) notFound();
    if (!(await allow(ctx, `texting-check:${ctx.companyId}`, 30, HOUR))) throw userError("That's a lot of checks in an hour. Try again a little later.");
    await ctx.scheduler.runAfter(0, internal.textingSetup.checkPages, { setupId: setup._id });
    return null;
  },
});

export const pagesToCheck = internalQuery({
  args: { setupId: v.id("textingSetups") },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) return null;
    const company = await ctx.db.get(setup.companyId);
    const links = linksFor(setup, await handleOf(ctx, setup.companyId));
    if (!links || !company) return null;
    return { name: setup.business.displayName || company.name, own: setup.hosting === "own_site", links };
  },
});

/** Fetches each page and records whether it opened. An owner's own page must also name the business. */
export const checkPages = internalAction({
  args: { setupId: v.id("textingSetups") },
  handler: async (ctx, args) => {
    const target = await ctx.runQuery(internal.textingSetup.pagesToCheck, { setupId: args.setupId });
    if (!target) return null;
    const results: { kind: "privacy" | "terms" | "signup"; url: string; ok: boolean; problem?: string }[] = [];
    for (const kind of ["privacy", "terms", "signup"] as const) {
      const url = target.links[kind];
      if (!url) continue;
      results.push({ kind, url, ...(await openPage(url, target.own && kind !== "signup" ? target.name : null)) });
    }
    await ctx.runMutation(internal.textingSetup.recordChecks, { setupId: args.setupId, results });
    return null;
  },
});

async function openPage(url: string, mustName: string | null): Promise<{ ok: boolean; problem?: string }> {
  try {
    const response = await fetch(url, { redirect: "follow", headers: { "user-agent": "Selestial page check" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { ok: false, problem: `The page answered with an error (${response.status}).` };
    if (mustName) {
      const body = (await response.text()).toLowerCase();
      if (!body.includes(mustName.toLowerCase())) return { ok: false, problem: `The page opens but doesn't mention ${mustName}. Carriers need it to be your business's own.` };
    }
    return { ok: true };
  } catch {
    return { ok: false, problem: "The page didn't open. Check the address, or that the page is public." };
  }
}

export const recordChecks = internalMutation({
  args: { setupId: v.id("textingSetups"), results: v.array(v.object({ kind: v.union(v.literal("privacy"), v.literal("terms"), v.literal("signup")), url: v.string(), ok: v.boolean(), problem: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const setup = await ctx.db.get(args.setupId);
    if (!setup) return null;
    const now = Date.now();
    const checks = args.results.map((row) => ({ ...row, at: now }));
    const good = checks.filter((row) => row.ok).length;
    const notes = [...setup.notes, { key: `check-${now}`, step: "permission" as const, words: good === checks.length ? `I opened all ${checks.length} of your page links. Each one works.` : `I opened your page links: ${good} of ${checks.length} work. The ones that don't are marked.`, at: now }];
    await ctx.db.patch(setup._id, { checks, notes: notes.slice(-40) });
    return null;
  },
});

// ── Number ──────────────────────────────────────────────────────────────────────────────────────────

/** Chooses a number from one of this company's own searches. Nothing is held: it is checked again before it is bought. */
export const chooseNumber = ownerMutation({
  args: { revision: v.number(), searchId: v.id("numberSearches"), phoneNumber: v.string() },
  handler: async (ctx, args) => {
    const setup = await writable(ctx, ctx.companyId, args.revision);
    const request = await requestOf(ctx, setup);
    if (!editable(request) && request?.needs?.kind !== "number") throw userError("Your request is with Selestial now, so the number can't be changed here.");
    const search = await ctx.db.get(args.searchId);
    const row = search && search.companyId === ctx.companyId ? search.results?.find((result) => result.phoneNumber === args.phoneNumber) : undefined;
    if (!row) throw userError("Choose a number from your search.");
    const features = row.features ?? ["sms"];
    const now = Date.now();
    const first = !setup.notes.some((note) => note.key === "number-hold");
    await ctx.db.patch(setup._id, {
      number: { searchId: args.searchId, phoneNumber: row.phoneNumber, locality: row.locality, region: row.region, sms: features.includes("sms"), mms: features.includes("mms"), voice: features.includes("voice"), chosenAt: now },
      notes: first ? [...setup.notes, { key: "number-hold", step: "number" as const, words: "Choosing a number doesn't hold it. Right before buying it, I check it's still available. If it isn't, I'll ask you to choose again rather than pick one for you.", at: now }].slice(-40) : setup.notes,
      revision: setup.revision + 1,
      updatedAt: now,
      updatedBy: ctx.member._id,
    });
    return { revision: setup.revision + 1 };
  },
});

// ── Where things stand ──────────────────────────────────────────────────────────────────────────────

/** Where permission is collected, and whether Selestial actually records it there today. */
function placeStates(places: readonly string[], signupLive: boolean, otherPlace: string | undefined): PlaceState[] {
  return places.map((place) => {
    switch (place) {
      case "booking_form":
      case "quote_form":
        return signupLive
          ? { place, state: "records", words: "Your Selestial booking page shows the optional text box and records each yes with the wording shown." }
          : { place, state: "not_yet", words: "Publish your sign-up wording, and your Selestial booking page starts showing the optional text box." };
      case "website":
        return signupLive
          ? { place, state: "records", words: "Your sign-up page is live and records each yes. Link to it or embed it on your website." }
          : { place, state: "not_yet", words: "Publish your sign-up page first." };
      case "cleaner_application":
        return { place, state: "records", words: "Your Selestial job application asks applicants, with an optional box, and records the answer." };
      case "team_onboarding":
        return { place, state: "records", words: "Cleaners agree to work texts in their Selestial team portal, and each yes is recorded." };
      default:
        return { place, state: "described", words: otherPlace ? "Selestial can't see this place, so it's described as you wrote it. Keep a record of each person's agreement there." : "Describe where, so carriers know." };
    }
  });
}

export const view = ownerQuery({
  args: {},
  handler: async (ctx) => {
    const setup = await setupOf(ctx, ctx.companyId);
    if (!setup) return null;
    const now = Date.now();
    const handle = await handleOf(ctx, ctx.companyId);
    const input = await draftInput(ctx, setup, ctx.company, handle);
    const request = await requestOf(ctx, setup);
    const entityType = setup.business.entityType as EntityType | undefined;
    const pages = await Promise.all((["privacy", "terms", "signup"] as const).map(async (kind) => ({ kind, page: await currentPage(ctx, ctx.companyId, kind) })));
    const links = linksFor(setup, handle);
    const draftStates = draftProblems(setup.drafts, input);
    const signup = pages.find((row) => row.kind === "signup")?.page ?? null;
    const pageStates = pages.map(({ kind, page }) => {
      const own = setup.hosting === "own_site" && kind !== "signup";
      const draftKey = kind === "signup" ? "sms_consent" : kind;
      const check = setup.checks.find((row) => row.kind === kind && row.url === links?.[kind]);
      const drafted = kind === "signup" ? setup.drafts.sms_consent?.text : setup.drafts[kind]?.text;
      const current = !own && page ? page.body === drafted && (kind !== "signup" || (page.marketing ?? "") === (setup.drafts.marketing_consent?.text ?? "")) : true;
      const gaps = draftStates.find((row) => row.key === draftKey)?.gaps ?? [];
      const state: "drafted" | "published" | "needs_attention" = (own ? !links?.[kind] : !page) ? "drafted" : gaps.length || (check && !check.ok) || !current ? "needs_attention" : "published";
      return { kind, own, url: links?.[kind] ?? null, version: page?.version ?? null, publishedAt: page?.publishedAt ?? null, current, state, check: check ? { ok: check.ok, problem: check.problem ?? null, at: check.at } : null };
    });
    const plan = planFor(setup.activities, entityType);
    const charges = chargesAt(now);
    const places = placeStates(setup.places, !!signup, setup.otherPlace);
    const businessIssues = businessProblems(setup.business, !!setup.taxId);
    const activityIssues = activityProblems(setup.activities, entityType);
    const permissionIssues = [
      ...draftStates.filter((row) => row.gaps.length).map((row) => `Your ${PAGE_WORDS[row.key]} needs to ${row.gaps[0]}.`),
      ...(setup.places.length === 0 ? ["Choose where people agree to texts."] : []),
      ...(setup.places.length && !places.some((row) => row.state === "records") ? ["At least one place must record each person's agreement before texts go out."] : []),
      ...pageStates.filter((row) => row.state !== "published").map((row) => (row.state === "drafted" ? `Publish your ${row.kind === "signup" ? "sign-up page" : row.kind === "terms" ? "texting terms" : "privacy policy"}.` : `Your ${row.kind === "signup" ? "sign-up page" : row.kind === "terms" ? "texting terms" : "privacy policy"} needs attention.`)),
    ];
    const numberIssues = setup.number ? (setup.number.sms ? [] : ["This number can't text. Choose another."]) : ["Choose a number."];
    const samples = plan ? sampleKeys(setup.activities).map((key) => ({ key, text: sampleFor(key, input.name, setup.samples), edited: key in setup.samples })) : [];
    const { taxId, ...rest } = setup;
    return {
      setup: { ...rest, taxIdLast4: taxId?.last4 ?? null },
      company: { name: ctx.company.name, handle },
      editable: editable(request),
      secureStorage: await secretsConfigured(),
      catalog: { activities: ACTIVITIES.map(({ sample, ...row }) => ({ ...row, sample: sample(input.name) })), groups: GROUP_WORDS, verticals: VERTICALS, entities: ENTITY_WORDS },
      sources: setup.sources.map((row) => ({ ...row, words: sourceWords(row.source) })),
      needsTaxId: needsTaxId(entityType),
      plan,
      description: plan ? describe(input.name, setup.activities) : null,
      samples,
      issues: { business: businessIssues, activities: activityIssues, permission: permissionIssues, number: numberIssues },
      drafts: draftStates,
      places,
      pages: pageStates,
      charges: { rows: charges.rows, wording: registrationWording(now), version: registrationPricesAt(now).version, required: meteringOn() },
      request: request ? { requestId: request._id, status: request.status, phoneNumber: request.phoneNumber, requestedAt: request.requestedAt, needs: request.needs ?? null, milestones: milestones(request), resubmissions: request.resubmissions ?? 0 } : null,
    };
  },
});

// ── Submitting ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Sends the setup to Selestial review. Everything must be complete, and the owner authorizes the charges in
 * the exact words shown. A correction after the carriers asked for changes becomes a new submission
 * version on the same request; everything already filled in is kept.
 */
export const submit = ownerMutation({
  args: { revision: v.number(), authorization: v.string() },
  handler: async (ctx, args) => {
    const setup = await writable(ctx, ctx.companyId, args.revision);
    const request = await requestOf(ctx, setup);
    if (!editable(request)) throw userError("This setup is already with Selestial.");
    const now = Date.now();
    const wording = registrationWording(now);
    if (args.authorization !== wording) throw userError("Read and accept the charges to submit. They may have changed since the page loaded; the latest are shown now.");
    const handle = await handleOf(ctx, ctx.companyId);
    const links = linksFor(setup, handle);
    const input = await draftInput(ctx, setup, ctx.company, handle);
    const entityType = setup.business.entityType as EntityType | undefined;
    const problems = [
      ...businessProblems(setup.business, !!setup.taxId).map((row) => row.words),
      ...activityProblems(setup.activities, entityType),
      ...draftProblems(setup.drafts, input)
        .filter((row) => row.gaps.length)
        .map((row) => `Your ${PAGE_WORDS[row.key]} needs to ${row.gaps[0]}.`),
    ];
    const signup = await currentPage(ctx, ctx.companyId, "signup");
    if (!links || !signup) problems.push("Publish your sign-up page.");
    if (setup.hosting !== "own_site" && (!(await currentPage(ctx, ctx.companyId, "privacy")) || !(await currentPage(ctx, ctx.companyId, "terms")))) problems.push("Publish your privacy policy and texting terms.");
    if (setup.hosting === "own_site" && (!links?.privacy || !links?.terms)) problems.push("Add the addresses of your own privacy policy and texting terms.");
    // What carriers will read must be what the owner sees now: a changed draft is published before it's filed.
    const published = { privacy: await currentPage(ctx, ctx.companyId, "privacy"), terms: await currentPage(ctx, ctx.companyId, "terms"), signup };
    if (published.signup && (published.signup.body !== setup.drafts.sms_consent?.text || (published.signup.marketing ?? "") !== (setup.drafts.marketing_consent?.text ?? ""))) problems.push("Your sign-up wording changed since it was published. Publish your changes.");
    if (setup.hosting !== "own_site" && ((published.privacy && published.privacy.body !== setup.drafts.privacy?.text) || (published.terms && published.terms.body !== setup.drafts.terms?.text))) problems.push("Your privacy policy or texting terms changed since they were published. Publish your changes.");
    for (const kind of ["privacy", "terms", "signup"] as const) {
      const check = setup.checks.find((row) => row.kind === kind && row.url === links?.[kind]);
      if (links && (!check || !check.ok)) problems.push(`Your ${kind === "signup" ? "sign-up page" : kind === "terms" ? "texting terms" : "privacy policy"} link must open before submitting. Check the links again.`);
    }
    const places = placeStates(setup.places, !!signup, setup.otherPlace);
    if (!places.some((row) => row.state === "records")) problems.push("At least one place must record each person's agreement.");
    if (!setup.number?.sms) problems.push("Choose a number that can text.");
    const plan = planFor(setup.activities, entityType);
    if (problems.length || !plan || !links || !setup.number) throw userError(problems[0] ?? "Something is still missing.");

    const b = setup.business;
    const sole = entityType === "SOLE_PROPRIETOR";
    const brand = {
      displayName: b.displayName!,
      companyName: sole ? `${b.contactFirstName} ${b.contactLastName}` : b.legalName!,
      phone: b.supportPhone!,
      street: b.street!,
      city: b.city!,
      state: b.state!,
      postalCode: b.postalCode!,
      email: b.supportEmail!,
      website: b.website ?? links.signup,
      vertical: b.vertical!,
      ...(sole ? { firstName: b.contactFirstName, lastName: b.contactLastName, mobilePhone: b.mobilePhone } : {}),
      ...(entityType === "PUBLIC_PROFIT" ? { stockSymbol: b.stockSymbol, stockExchange: b.stockExchange } : {}),
    };
    const samples = sampleKeys(setup.activities).map((key) => sampleFor(key, input.name, setup.samples));
    const drafts = Object.fromEntries(DRAFT_KEYS.filter((key) => setup.drafts[key]?.text).map((key) => [key, setup.drafts[key].text]));
    const prices = registrationPricesAt(now);
    const filing = {
      phoneNumber: setup.number.phoneNumber,
      brand,
      consentWording: setup.drafts.sms_consent.text,
      entityType: entityType!,
      usecase: plan.usecase,
      subUsecases: plan.subUsecases,
      activities: setup.activities,
      privacyLink: links.privacy,
      termsLink: links.terms,
      signupLink: links.signup,
      samples,
      drafts,
      ...(setup.taxId && !sole ? { taxIdSealed: setup.taxId.sealed, taxIdLast4: setup.taxId.last4 } : {}),
      pricesVersion: prices.version,
      fees: { authorizedAt: now, authorizedBy: ctx.member._id, wording },
      setupId: setup._id,
      updatedAt: now,
    };

    let requestId: Id<"textingRequests">;
    let version = 1;
    const correcting = request?.status === "needs_you";
    if (request && correcting) {
      version = (request.submissionVersion ?? 1) + 1;
      requestId = request._id;
      // Back to Selestial review with the corrected details. What was already bought or filed is kept.
      await ctx.db.patch(request._id, { ...filing, status: "requested", submissionVersion: version, needs: undefined, decidedAt: undefined, decidedBy: undefined, step: "Your corrected details are waiting for Selestial review." });
    } else {
      const open = await latestRequest(ctx, ctx.companyId);
      if (open && !["rejected", "cancelled", "failed"].includes(open.status)) throw userError("There's already a texting request for this company.");
      requestId = await ctx.db.insert("textingRequests", { companyId: ctx.companyId, status: "requested", requestedBy: ctx.member._id, requestedAt: now, submissionVersion: 1, step: "Waiting for Selestial review.", ...filing });
    }
    await ctx.db.insert("textingSubmissions", {
      companyId: ctx.companyId,
      requestId,
      version,
      business: b,
      ...(setup.taxId && !sole ? { taxIdLast4: setup.taxId.last4 } : {}),
      activities: setup.activities,
      usecase: plan.usecase,
      subUsecases: plan.subUsecases,
      drafts,
      samples,
      links: { privacy: links.privacy, terms: links.terms, signup: links.signup },
      phoneNumber: setup.number.phoneNumber,
      authorization: { wording, pricesVersion: prices.version, at: now, by: ctx.member._id },
      submittedAt: now,
      submittedBy: ctx.member._id,
    });
    await ctx.db.patch(setup._id, { requestId, step: "progress", revision: setup.revision + 1, updatedAt: now, updatedBy: ctx.member._id, notes: [...setup.notes, { key: `submitted-${now}`, step: "progress" as SetupStep, words: correcting ? "I sent your corrected details to Selestial review. Everything else you'd filled in is unchanged." : "I sent your setup to Selestial review. Nothing is filed with the carriers or charged until Selestial approves it.", at: now }].slice(-40) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: correcting ? "texting.resubmitted" : "texting.requested", actor: byMember(ctx), subject: { table: "textingRequests", id: requestId }, data: { phoneNumber: setup.number.phoneNumber, version } });
    return { revision: setup.revision + 1, requestId };
  },
});

/** Withdraws a request Selestial has not acted on yet, so the setup can be changed. */
export const withdraw = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const setup = await setupOf(ctx, ctx.companyId);
    const request = setup ? await requestOf(ctx, setup) : null;
    if (!setup || !request) notFound();
    if (request.status !== "requested" || (request.submissionVersion ?? 1) > 1 || request.brandId) throw userError("Selestial has already started on this request, so it can't be withdrawn here. Write to support.");
    const now = Date.now();
    await ctx.db.patch(request._id, { status: "cancelled", step: "Withdrawn by the company.", updatedAt: now });
    await ctx.db.patch(setup._id, { step: "review", revision: setup.revision + 1, updatedAt: now, updatedBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "texting.cancelled", actor: byMember(ctx), subject: { table: "textingRequests", id: request._id } });
    return null;
  },
});
