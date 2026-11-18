/**
 * Google Ads for a company: leads from lead forms and Local Services Ads reaching Sales, results by
 * campaign, campaign drafts, and booked jobs reported back as conversions.
 *
 * Money is the Owner's. A draft costs nothing. Creating it in Google Ads makes a PAUSED campaign, after
 * the Owner approves the draft and its daily budget. Turning it on is a second, separate Owner decision.
 * Nothing here changes a budget or enables a campaign on its own.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { customerId as adsCustomerId } from "./lib/google/ads";
import { activeConnection, requireFeature } from "./lib/google/connection";
import type { ConversionEvent } from "./lib/google/datamanager";
import { enqueue } from "./lib/google/jobs";
import { endpoints } from "./lib/google/platform";
import { hashToken, randomToken } from "./lib/recruiter/secrets";
import { allow } from "./lib/rateLimit";
import { refreshClient } from "./lib/clients/directory";
import { AGENT_PROFILES } from "./lib/departments";
import { fileInquiry } from "./lib/sales/intake";
import { enqueueRun } from "./lib/sales/runs";
import { text } from "./lib/text";

const DAY = 86_400_000;
/** The most a draft may ask for per day, in cents. A larger budget is set in Google Ads by the Owner. */
export const MAX_DAILY_BUDGET_CENTS = 50_000;

// ── Leads ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Makes the key Google sends with every lead-form lead. It is shown once; Selestial keeps only its hash.
 * Making a new key retires the old one.
 */
export const rotateLeadKey = ownerMutation({
  args: {},
  handler: async (ctx) => {
    const url = endpoints().leadFormWebhook;
    if (!url) throw userError("Google lead forms aren’t available yet. Please try again a little later.");
    for (const old of await ctx.db.query("googleLeadKeys").withIndex("by_company", (q) => q.eq("companyId", ctx.companyId)).take(10)) await ctx.db.delete(old._id);
    const key = await randomToken();
    await ctx.db.insert("googleLeadKeys", { companyId: ctx.companyId, keyHash: await hashToken(key), createdBy: ctx.member._id, createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.lead_key_rotated", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    return { webhookUrl: url, key, shownOnce: true };
  },
});

export const leads = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleLeads").withIndex("by_company_received", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(100);
    const key = await ctx.db.query("googleLeadKeys").withIndex("by_company", (q) => q.eq("companyId", ctx.companyId)).first();
    return { hasKey: Boolean(key), keyCreatedAt: key?.createdAt ?? null, webhookUrl: endpoints().leadFormWebhook, leads: rows.map((r) => ({ _id: r._id, source: r.source, name: r.name ?? null, email: r.email ?? null, phone: r.phone ?? null, campaign: r.campaign ?? null, customerId: r.customerId ?? null, taskId: r.taskId ?? null, test: r.test ?? false, receivedAt: r.receivedAt })) };
  },
});

const digits = (value?: string) => (value ?? "").replace(/\D/g, "").slice(-10);

async function matchCustomer(ctx: MutationCtx, companyId: Id<"companies">, lead: { email?: string; phone?: string }): Promise<Doc<"customers"> | null> {
  const email = lead.email?.trim().toLowerCase();
  const phone = digits(lead.phone);
  if (!email && phone.length < 10) return null;
  const rows = await ctx.db.query("customers").withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active")).take(5000);
  return rows.find((c) => (email && c.email?.toLowerCase() === email) || (phone.length === 10 && digits(c.phone) === phone)) ?? null;
}

/**
 * One lead, once. The source's own id dedupes it; a person already on file is matched by email or phone
 * instead of being added twice. Each lead becomes one opportunity in the Sales pipeline.
 */
export async function takeLead(ctx: MutationCtx, input: { companyId: Id<"companies">; source: "lead_form" | "local_services"; externalId: string; name?: string; email?: string; phone?: string; postalCode?: string; gclid?: string; campaign?: string; test?: boolean }) {
  const seen = await ctx.db.query("googleLeads").withIndex("by_company_external", (q) => q.eq("companyId", input.companyId).eq("source", input.source).eq("externalId", input.externalId)).unique();
  if (seen) return { created: false, leadId: seen._id };
  const clean = (value: string | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : undefined);
  const fields = { name: clean(input.name, 160), email: clean(input.email, 254)?.toLowerCase(), phone: clean(input.phone, 40), postalCode: clean(input.postalCode, 12), gclid: clean(input.gclid, 200), campaign: clean(input.campaign, 120) };
  const leadId = await ctx.db.insert("googleLeads", { companyId: input.companyId, source: input.source, externalId: input.externalId.slice(0, 200), ...fields, test: input.test || undefined, receivedAt: Date.now() });
  if (input.test) return { created: true, leadId, test: true };
  let customer = await matchCustomer(ctx, input.companyId, fields);
  const matched = Boolean(customer);
  if (!customer) {
    // A lead is a prospect until it books: the same record becomes the client, so nothing is duplicated.
    const id = await ctx.db.insert("customers", { companyId: input.companyId, name: fields.name ?? fields.email ?? fields.phone ?? "Google lead", kind: "home", email: fields.email, phone: fields.phone, status: "active", relationship: "prospect", relationshipAt: Date.now(), source: "google_lead", revision: 1, createdAt: Date.now(), updatedAt: Date.now() });
    customer = (await ctx.db.get(id))!;
  }
  const from = input.source === "local_services" ? "Local Services Ads" : "a Google Ads lead form";
  // The lead becomes an opportunity in the Sales pipeline, with its own task. Nothing about it says the person
  // agreed to be texted or emailed, so no permission is recorded and contact still goes through the usual rules.
  const company = (await ctx.db.get(input.companyId))!;
  const { opportunity } = await fileInquiry(ctx, company, {
    contact: { name: customer.name, email: fields.email, phone: fields.phone },
    customerId: customer._id,
    kind: "residential",
    source: { kind: "google_lead", externalId: input.externalId.slice(0, 200), campaign: fields.campaign },
    inquiry: `New lead from ${from}${fields.postalCode ? ` (ZIP ${fields.postalCode})` : ""}.`,
    receivedAt: Date.now(),
    channel: fields.phone ? "sms" : "email",
    facts: fields.postalCode ? [{ key: "postalCode", value: fields.postalCode.toUpperCase(), source: { kind: "record", ref: "google_lead" }, status: "stated", at: Date.now() }] : [],
    dedupeKey: `google-lead:${leadId}`,
    actor: { kind: "system" },
  });
  if (AGENT_PROFILES.sales.built) await enqueueRun(ctx, opportunity, { trigger: "inquiry", key: `inquiry:${opportunity._id}` });
  const taskId = (await ctx.db.get(opportunity._id))?.taskId;
  await ctx.db.patch(leadId, { customerId: customer._id, ...(taskId ? { taskId } : {}) });
  await refreshClient(ctx, customer._id);
  await recordEvent(ctx, { companyId: input.companyId, type: "google.lead_received", actor: { kind: "system" }, subject: { table: "customers", id: customer._id }, data: { source: input.source, matched } });
  return { created: true, leadId, customerId: customer._id, taskId, opportunityId: opportunity._id };
}

export const ingestLead = internalMutation({
  args: { companyId: v.id("companies"), source: v.union(v.literal("lead_form"), v.literal("local_services")), externalId: v.string(), name: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()), postalCode: v.optional(v.string()), gclid: v.optional(v.string()), campaign: v.optional(v.string()), test: v.optional(v.boolean()) },
  handler: async (ctx, args) => takeLead(ctx, args),
});

type LeadFormBody = { lead_id?: string; google_key?: string; gcl_id?: string; campaign_id?: string | number; is_test?: boolean; user_column_data?: { column_id?: string; column_name?: string; string_value?: string }[] };

/** Parses Google's lead form webhook body. Pure, for tests. */
export function parseLeadForm(raw: string): { key: string; lead: { externalId: string; name?: string; email?: string; phone?: string; postalCode?: string; gclid?: string; campaign?: string; test: boolean } } | null {
  let body: LeadFormBody;
  try {
    body = JSON.parse(raw) as LeadFormBody;
  } catch {
    return null;
  }
  if (!body || typeof body.lead_id !== "string" || typeof body.google_key !== "string") return null;
  const column = (...ids: string[]) => body.user_column_data?.find((c) => c.column_id && ids.includes(c.column_id))?.string_value;
  const first = column("FIRST_NAME");
  const last = column("LAST_NAME");
  return {
    key: body.google_key,
    lead: { externalId: body.lead_id, name: column("FULL_NAME") ?? ([first, last].filter(Boolean).join(" ") || undefined), email: column("EMAIL", "WORK_EMAIL"), phone: column("PHONE_NUMBER", "WORK_PHONE"), postalCode: column("POSTAL_CODE"), gclid: body.gcl_id, campaign: body.campaign_id !== undefined ? String(body.campaign_id) : undefined, test: body.is_test === true },
  };
}

/** The lead-form webhook. The key must match a company's current key; anything else is refused. */
export const leadFormWebhook = internalMutation({
  args: { body: v.string() },
  handler: async (ctx, args) => {
    const parsed = parseLeadForm(args.body);
    if (!parsed) return { ok: false as const, status: 400 };
    const keyHash = await hashToken(parsed.key);
    const owner = await ctx.db.query("googleLeadKeys").withIndex("by_keyHash", (q) => q.eq("keyHash", keyHash)).unique();
    if (!owner) return { ok: false as const, status: 403 };
    if (!(await allow(ctx, `google.leads:${owner.companyId}`, 120, 60_000))) return { ok: false as const, status: 429 };
    const result = await takeLead(ctx, { companyId: owner.companyId, source: "lead_form", ...parsed.lead });
    return { ok: true as const, status: 200, created: result.created };
  },
});

// ── Results and campaign drafts ─────────────────────────────────────────────────────────────────

export const snapshots = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleAdsSnapshots").withIndex("by_company_account", (q) => q.eq("companyId", ctx.companyId)).take(20);
    return rows.map((r) => ({ accountId: r.accountId, fetchedAt: r.fetchedAt, rows: r.rows }));
  },
});

async function adsAccount(ctx: MutationCtx, companyId: Id<"companies">, accountId: string) {
  const id = adsCustomerId(accountId);
  const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", companyId).eq("kind", "ads_account")).take(20);
  const row = rows.find((r) => adsCustomerId(r.externalId) === id && r.access !== "lost");
  if (!row) throw userError("That ad account is not authorized. The Owner chooses ad accounts under Integrations › Google.");
  return row;
}

export const refreshResults = managerMutation({
  args: { accountId: v.string() },
  handler: async (ctx, args) => {
    const connection = await requireFeature(ctx, ctx.companyId, "ads");
    const account = await adsAccount(ctx, ctx.companyId, args.accountId);
    return enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "ads_snapshot", key: `ads_snapshot:${account.externalId}:${Math.floor(Date.now() / 300_000)}`, payload: { accountId: account.externalId, loginCustomerId: account.detail }, requestedBy: ctx.member._id });
  },
});

export const drafts = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleAdDrafts").withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(50);
    return rows.map((r) => ({ _id: r._id, accountId: r.accountId, name: r.name, dailyBudgetCents: r.dailyBudgetCents, keywords: r.keywords, postalCodes: r.postalCodes, headline: r.headline, description: r.description, finalUrl: r.finalUrl, state: r.state, googleCampaign: r.googleCampaign ?? null, problem: r.problem ?? null, updatedAt: r.updatedAt }));
  },
});

export async function createDraft(ctx: MutationCtx, companyId: Id<"companies">, memberId: Id<"members"> | undefined, input: { accountId: string; name: string; dailyBudgetCents: number; keywords: string[]; postalCodes: string[]; headline: string; description: string; finalUrl: string }) {
  const account = await adsAccount(ctx, companyId, input.accountId);
  if (!Number.isInteger(input.dailyBudgetCents) || input.dailyBudgetCents < 100 || input.dailyBudgetCents > MAX_DAILY_BUDGET_CENTS) throw userError(`The daily budget must be between $1 and $${MAX_DAILY_BUDGET_CENTS / 100}.`);
  if (!/^https:\/\//.test(input.finalUrl)) throw userError("The landing page must be an https address.");
  const now = Date.now();
  const id = await ctx.db.insert("googleAdDrafts", {
    companyId,
    accountId: adsCustomerId(account.externalId),
    // The name carries a unique suffix, so a retry finds this campaign instead of making a second one.
    name: `${text(input.name, "The campaign name", 80)} · Selestial ${now.toString(36)}`,
    dailyBudgetCents: input.dailyBudgetCents,
    keywords: input.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 50),
    postalCodes: input.postalCodes.map((p) => p.trim()).filter((p) => /^\d{5}$/.test(p)).slice(0, 100),
    headline: text(input.headline, "The headline", 30),
    description: text(input.description, "The description", 90),
    finalUrl: input.finalUrl.slice(0, 500),
    state: "draft",
    createdBy: memberId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export const draftCampaign = managerMutation({
  args: { accountId: v.string(), name: v.string(), dailyBudgetCents: v.number(), keywords: v.array(v.string()), postalCodes: v.array(v.string()), headline: v.string(), description: v.string(), finalUrl: v.string() },
  handler: async (ctx, args) => {
    await requireFeature(ctx, ctx.companyId, "ads");
    const draftId = await createDraft(ctx, ctx.companyId, ctx.member._id, args);
    return { draftId, state: "draft" as const, spends: false };
  },
});

/** The Owner approves the draft and its budget. Selestial then creates it in Google Ads, paused. */
export const approveCampaign = ownerMutation({
  args: { draftId: v.id("googleAdDrafts"), confirmDailyBudgetCents: v.number() },
  handler: async (ctx, args) => {
    const connection = await requireFeature(ctx, ctx.companyId, "ads");
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.companyId !== ctx.companyId) notFound();
    if (draft.state !== "draft" && draft.state !== "failed") throw userError("This draft was already approved.");
    if (args.confirmDailyBudgetCents !== draft.dailyBudgetCents) throw userError("The budget you confirmed does not match the draft. Check the draft again.");
    await ctx.db.patch(draft._id, { state: "approved", approvedBy: ctx.member._id, approvedBudgetCents: draft.dailyBudgetCents, problem: undefined, updatedAt: Date.now() });
    const queued = await enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "ads_campaign", key: `ads_campaign:${draft._id}`, payload: { draftId: draft._id }, requestedBy: ctx.member._id, again: draft.state === "failed" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.ads_campaign_approved", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { dailyBudgetCents: draft.dailyBudgetCents } });
    return { ...queued, creates: "a paused campaign" };
  },
});

/** Turning a campaign on starts spending. Its own Owner decision, after it exists paused. */
export const activateCampaign = ownerMutation({
  args: { draftId: v.id("googleAdDrafts"), confirmDailyBudgetCents: v.number() },
  handler: async (ctx, args) => {
    const connection = await requireFeature(ctx, ctx.companyId, "ads");
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.companyId !== ctx.companyId) notFound();
    if (draft.state !== "created_paused" || !draft.googleCampaign) throw userError("Only a campaign that exists in Google Ads, paused, can be turned on.");
    if (args.confirmDailyBudgetCents !== draft.approvedBudgetCents) throw userError("The budget you confirmed does not match the approved budget.");
    await ctx.db.patch(draft._id, { activatedBy: ctx.member._id, updatedAt: Date.now() });
    const queued = await enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "ads_activate", key: `ads_activate:${draft._id}`, payload: { draftId: draft._id }, requestedBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.ads_campaign_activation_requested", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { dailyBudgetCents: draft.dailyBudgetCents } });
    return queued;
  },
});

export const draftFor = internalQuery({
  args: { draftId: v.id("googleAdDrafts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;
    const accounts = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", draft.companyId).eq("kind", "ads_account")).take(20);
    const account = accounts.find((r) => r.externalId.replace(/-/g, "") === draft.accountId && r.access !== "lost");
    return account ? { ...draft, loginCustomerId: account.detail ?? null } : null;
  },
});

export const campaignCreated = internalMutation({
  args: { draftId: v.id("googleAdDrafts"), resourceName: v.string() },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (draft) await ctx.db.patch(draft._id, { state: "created_paused", googleCampaign: args.resourceName, updatedAt: Date.now() });
    return null;
  },
});

export const campaignActivated = internalMutation({
  args: { draftId: v.id("googleAdDrafts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return null;
    await ctx.db.patch(draft._id, { state: "active", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: draft.companyId, type: "google.ads_campaign_activated", actor: { kind: "system" }, subject: { table: "companies", id: draft.companyId }, data: { dailyBudgetCents: draft.dailyBudgetCents } });
    return null;
  },
});

export const storeSnapshot = internalMutation({
  args: { companyId: v.id("companies"), accountId: v.string(), rows: v.array(v.object({ campaign: v.string(), status: v.string(), impressions: v.number(), clicks: v.number(), costMicros: v.number(), conversions: v.number() })) },
  handler: async (ctx, args) => {
    for (const old of await ctx.db.query("googleAdsSnapshots").withIndex("by_company_account", (q) => q.eq("companyId", args.companyId).eq("accountId", args.accountId)).take(5)) await ctx.db.delete(old._id);
    await ctx.db.insert("googleAdsSnapshots", { ...args, fetchedAt: Date.now() });
    return null;
  },
});

// ── Conversions ─────────────────────────────────────────────────────────────────────────────────

export const conversionSettings = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await ctx.db.query("googleSettings").withIndex("by_company", (q) => q.eq("companyId", ctx.companyId)).unique();
    const recent = await ctx.db.query("googleConversions").withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(50);
    return { consent: settings?.conversionConsent ? { adUserData: settings.conversionConsent.adUserData, adPersonalization: settings.conversionConsent.adPersonalization, basis: settings.conversionConsent.basis, recordedAt: settings.conversionConsent.recordedAt } : null, recent: recent.map((c) => ({ _id: c._id, jobId: c.jobId, valueCents: c.valueCents, status: c.status, reason: c.reason ?? null, diagnostics: c.diagnostics ?? null, createdAt: c.createdAt })) };
  },
});

/** The Owner states the consent basis for reporting conversions. Without it, nothing is reported. */
export const setConversionConsent = ownerMutation({
  args: { adUserData: v.boolean(), adPersonalization: v.boolean(), basis: v.string(), off: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("googleSettings").withIndex("by_company", (q) => q.eq("companyId", ctx.companyId)).unique();
    const conversionConsent = args.off ? undefined : { adUserData: args.adUserData, adPersonalization: args.adPersonalization, basis: text(args.basis, "The consent basis", 1000), recordedBy: ctx.member._id, recordedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, { conversionConsent, updatedAt: Date.now() });
    else await ctx.db.insert("googleSettings", { companyId: ctx.companyId, conversionConsent, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "google.conversion_consent_set", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { on: !args.off } });
    return null;
  },
});

/** Pure: whether a booked job should be reported, and why not. */
export function conversionEligibility(input: { job: Pick<Doc<"jobs">, "status" | "priceCents">; lead: Pick<Doc<"googleLeads">, "gclid" | "test"> | null; hasConsent: boolean; hasDestination: boolean }): string | null {
  if (!input.lead) return "The customer did not come from a Google ad.";
  if (input.lead.test) return "The lead was Google's test data.";
  if (!input.lead.gclid) return "The lead has no Google click id, so it cannot be tied to an ad.";
  if (!input.hasConsent) return "The Owner has not recorded a consent basis for reporting conversions.";
  if (!input.hasDestination) return "No conversion action is chosen.";
  if (input.job.status === "cancelled") return "The visit was cancelled.";
  if (!input.job.priceCents || input.job.priceCents <= 0) return "The visit has no price.";
  return null;
}

export const conversionPlan = internalQuery({
  args: { conversionId: v.id("googleConversions") },
  handler: async (ctx, args): Promise<{ ok: false; why: string } | { ok: true; conversionId: Id<"googleConversions">; destination: { accountId: string; conversionActionId: string; loginAccountId?: string }; event: ConversionEvent }> => {
    const row = await ctx.db.get(args.conversionId);
    if (!row) return { ok: false, why: "The conversion was removed." };
    const job = await ctx.db.get(row.jobId);
    const lead = await ctx.db.get(row.leadId);
    const settings = await ctx.db.query("googleSettings").withIndex("by_company", (q) => q.eq("companyId", row.companyId)).unique();
    const destination = (await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", row.companyId).eq("kind", "conversion_destination")).take(5)).find((r) => r.access !== "lost");
    const why = job ? conversionEligibility({ job, lead, hasConsent: Boolean(settings?.conversionConsent), hasDestination: Boolean(destination?.detail) }) : "The visit was removed.";
    if (why || !job || !lead?.gclid || !settings?.conversionConsent || !destination?.detail) return { ok: false, why: why ?? "Not reportable." };
    const [accountId, loginAccountId] = destination.detail.split(":");
    return { ok: true, conversionId: row._id, destination: { accountId, conversionActionId: destination.externalId, loginAccountId: loginAccountId || undefined }, event: { transactionId: row.transactionId, at: job.createdAt, valueCents: row.valueCents, currency: "USD", gclid: lead.gclid, consent: { adUserData: settings.conversionConsent.adUserData, adPersonalization: settings.conversionConsent.adPersonalization } } };
  },
});

export const conversionResult = internalMutation({
  args: { conversionId: v.id("googleConversions"), status: v.union(v.literal("sent"), v.literal("rejected"), v.literal("skipped")), reason: v.optional(v.string()), diagnostics: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.conversionId);
    if (row) await ctx.db.patch(row._id, { status: args.status, reason: args.reason, diagnostics: args.diagnostics, sentAt: args.status === "sent" ? Date.now() : undefined });
    return null;
  },
});

/**
 * Finds booked visits for customers who came from a Google ad and queues each once. The transaction id is
 * the visit's id, so Google counts it once however often it is sent.
 */
export const sweepConversions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const settingsRows = await ctx.db.query("googleSettings").take(1000);
    let queued = 0;
    for (const settings of settingsRows) {
      if (!settings.conversionConsent) continue;
      const companyId = settings.companyId;
      const connection = await activeConnection(ctx, companyId, "conversions");
      if (!connection || connection.status !== "connected") continue;
      const leads = await ctx.db.query("googleLeads").withIndex("by_company_received", (q) => q.eq("companyId", companyId).gt("receivedAt", Date.now() - 90 * DAY)).take(500);
      for (const lead of leads) {
        if (!lead.customerId || !lead.gclid || lead.test) continue;
        const jobs = await ctx.db.query("jobs").withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", lead.customerId!)).take(20);
        const first = jobs.filter((j) => j.createdAt >= lead.receivedAt && j.status !== "cancelled" && (j.priceCents ?? 0) > 0).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!first) continue;
        const done = await ctx.db.query("googleConversions").withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", first._id)).first();
        if (done) continue;
        const conversionId = await ctx.db.insert("googleConversions", { companyId, jobId: first._id, leadId: lead._id, transactionId: `selestial-${first._id}`, valueCents: first.priceCents ?? 0, status: "queued", createdAt: Date.now() });
        await enqueue(ctx, { companyId, connectionId: connection._id, kind: "conversion", key: `conversion:${first._id}`, payload: { conversionId } });
        queued += 1;
      }
    }
    return queued;
  },
});

/** Every 15 minutes: Local Services leads for each authorized ad account. */
export const sweepLocalServices = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind").take(2000);
    const bucket = Math.floor(Date.now() / (15 * 60_000));
    let queued = 0;
    for (const row of rows) {
      if (row.kind !== "ads_account" || row.access === "lost") continue;
      const connection = await activeConnection(ctx, row.companyId, "ads");
      if (!connection || connection.status !== "connected" || !connection.grantedScopes.includes("https://www.googleapis.com/auth/adwords")) continue;
      await enqueue(ctx, { companyId: row.companyId, connectionId: connection._id, kind: "lsa_poll", key: `lsa_poll:${row.externalId}:${bucket}`, payload: { accountId: row.externalId, loginCustomerId: row.detail } });
      queued += 1;
    }
    return queued;
  },
});

export const adsAccountsFor = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "ads_account")).take(20);
    return rows.filter((r) => r.access !== "lost").map((r) => ({ id: r.externalId.replace(/-/g, ""), login: r.detail ?? null }));
  },
});
