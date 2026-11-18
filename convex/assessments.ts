/**
 * Assessments: a walkthrough appointment at a property and what it found. Never a cleaning job.
 *
 * What must be recorded comes from the service itself (its required questions, the answers that would
 * need a walkthrough, its measured-size input and its walkthrough notes), never from fixed thresholds.
 * An assessor completes it in the app or from a secure link on their phone at the property, with
 * photos. Completing it records findings only: a person reviews the pricing and applies them to the
 * proposal; nothing is guessed or invented for them.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery, salesLinkMutation, salesLinkQuery, type MemberAccess } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import type { DraftBody, ProposalSiteDraft } from "./lib/sales/draft";
import { linkToken, linkUrl, newLinkId } from "./lib/sales/links";
import { publishedByKey } from "./lib/services/store";
import { optionalText, text } from "./lib/text";
import { openTask } from "./lib/taskState";

type Finding = { key: string; label: string; kind: "number" | "choice" | "yes_no" | "text"; options: string[]; why: string };

/** What the assessor must record, from the service's own rules. */
export async function requiredFindingsFor(ctx: QueryCtx, companyId: Id<"companies">, serviceKey: string | undefined): Promise<Finding[]> {
  const out: Finding[] = [];
  if (!serviceKey) return [{ key: "notes", label: "What you found", kind: "text", options: [], why: "No service is chosen yet." }];
  const found = await publishedByKey(ctx, companyId, serviceKey);
  if (!found) return out;
  const spec = found.version.spec;
  if (spec.pricing.method === "per_area" || spec.pricing.method === "size_bands") out.push({ key: "area", label: `Measured area (${spec.pricing.unit === "sq_m" ? "m²" : "sq ft"})`, kind: "number", options: [], why: "The price is by area." });
  if (spec.pricing.method === "bed_bath") {
    out.push({ key: "bedrooms", label: "Bedrooms", kind: "number", options: [], why: "The price is by rooms." });
    out.push({ key: "bathrooms", label: "Full bathrooms", kind: "number", options: [], why: "The price is by rooms." });
  }
  if (spec.modifiers.condition.enabled) out.push({ key: "condition", label: "Condition", kind: "choice", options: spec.modifiers.condition.levels.map((l) => l.label), why: "Condition changes the price." });
  for (const q of spec.questions) if (q.required || q.walkthroughIf) out.push({ key: `q:${q.id}`, label: q.label, kind: q.kind, options: q.options, why: q.walkthroughIf ? "This answer decides whether a firm price is possible." : "The service requires it." });
  for (const note of spec.walkthroughNotes.slice(0, 8)) out.push({ key: `note:${out.length}`, label: note, kind: "text", options: [], why: "The service asks the assessor to check this." });
  out.push({ key: "notes", label: "Anything else the crew or pricing should know", kind: "text", options: [], why: "Free notes." });
  return out;
}

async function patchSite(ctx: MutationCtx, draftId: Id<"salesDrafts"> | undefined, siteKey: string | undefined, patch: Partial<ProposalSiteDraft>) {
  if (!draftId || !siteKey) return;
  const draft = await ctx.db.get(draftId);
  if (!draft) return;
  const body = draft.body as DraftBody;
  if (!body.proposal) return;
  const sites = body.proposal.sites.map((site) => (site.key === siteKey ? { ...site, ...patch } : site));
  await ctx.db.patch(draft._id, { body: { ...body, proposal: { ...body.proposal, sites } }, revision: draft.revision + 1, updatedAt: Date.now() });
}

/** Asks for a walkthrough of one proposal site: who goes, when, who meets them, and what to record. */
export const request = companyMutation({
  args: {
    draftId: v.id("salesDrafts"),
    siteKey: v.string(),
    assessorMemberId: v.optional(v.id("members")),
    scheduledAt: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
    siteContact: v.optional(v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()) })),
  },
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args.draftId);
    if (!draft.customerId) throw userError("Choose the client first.");
    const site = (draft.body as DraftBody).proposal?.sites.find((s) => s.key === args.siteKey);
    if (!site?.propertyId) throw userError("Add the site's address before asking for a walkthrough.");
    const property = await owned(ctx, site.propertyId as Id<"properties">);
    if (args.assessorMemberId) await owned(ctx, args.assessorMemberId);
    if (args.scheduledAt !== undefined && args.scheduledAt < Date.now()) throw userError("Choose a time in the future.");
    const existing = (await ctx.db
      .query("assessments")
      .withIndex("by_company_draft", (q) => q.eq("companyId", ctx.companyId).eq("draftId", draft._id))
      .take(50)).find((a) => a.siteKey === site.key && (a.status === "requested" || a.status === "scheduled"));
    if (existing) return existing._id;
    const findings = await requiredFindingsFor(ctx, ctx.companyId, site.serviceKey);
    const now = Date.now();
    const assessmentId = await ctx.db.insert("assessments", {
      companyId: ctx.companyId,
      ...(draft.proposalId ? { proposalId: draft.proposalId } : {}),
      draftId: draft._id,
      siteKey: site.key,
      ...(site.serviceKey ? { serviceKey: site.serviceKey } : {}),
      customerId: draft.customerId,
      propertyId: property._id,
      status: args.scheduledAt ? "scheduled" : "requested",
      ...(args.assessorMemberId ? { assessorMemberId: args.assessorMemberId } : {}),
      ...(args.scheduledAt ? { scheduledAt: args.scheduledAt } : {}),
      durationMinutes: Math.min(Math.max(Math.round(args.durationMinutes ?? 60), 15), 480),
      ...(args.siteContact ? { siteContact: { name: text(args.siteContact.name, "Site contact", 120), ...(args.siteContact.phone ? { phone: args.siteContact.phone.slice(0, 40) } : {}), ...(args.siteContact.email ? { email: args.siteContact.email.slice(0, 200) } : {}) } } : {}),
      requiredFindings: findings.map((f) => f.key),
      photos: [],
      publicId: newLinkId(),
      createdBy: ctx.member._id,
      createdAt: now,
      updatedAt: now,
    });
    await patchSite(ctx, draft._id, site.key, { assessment: "requested" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "assessment.requested", actor: byMember(ctx), subject: { table: "assessments", id: assessmentId } });
    await openTask(ctx, { companyId: ctx.companyId, agent: "sales", title: `Walkthrough: ${site.label || property.address.line1}`, nextAction: args.scheduledAt ? "Go to the walkthrough and record the findings." : "Agree a walkthrough time with the client.", dueAt: args.scheduledAt ?? now + 2 * 86_400_000, completionCondition: "The walkthrough's findings are recorded.", about: { table: "customers", id: draft.customerId }, key: `assessment:${assessmentId}`, actor: byMember(ctx) });
    return assessmentId;
  },
});

export const schedule = companyMutation({
  args: { assessmentId: v.id("assessments"), scheduledAt: v.number(), assessorMemberId: v.optional(v.id("members")) },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.assessmentId);
    if (row.status === "completed" || row.status === "cancelled") throw userError(`This walkthrough is ${row.status}.`);
    if (args.scheduledAt < Date.now()) throw userError("Choose a time in the future.");
    if (args.assessorMemberId) await owned(ctx, args.assessorMemberId);
    await ctx.db.patch(row._id, { status: "scheduled", scheduledAt: args.scheduledAt, ...(args.assessorMemberId ? { assessorMemberId: args.assessorMemberId } : {}), updatedAt: Date.now() });
    return null;
  },
});

async function describe(ctx: QueryCtx, row: Doc<"assessments">) {
  const property = await ctx.db.get(row.propertyId);
  const customer = await ctx.db.get(row.customerId);
  const assessor = row.assessorMemberId ? await ctx.db.get(row.assessorMemberId) : null;
  const all = await requiredFindingsFor(ctx, row.companyId, row.serviceKey);
  const wanted = all.filter((f) => row.requiredFindings.includes(f.key));
  const photos = [];
  for (const photo of row.photos) photos.push({ url: await ctx.storage.getUrl(photo.storageId), caption: photo.caption ?? null, at: photo.at });
  return {
    _id: row._id,
    status: row.status,
    siteKey: row.siteKey ?? null,
    client: customer?.name ?? "Client",
    address: property ? `${property.address.line1}, ${property.address.city}` : null,
    scheduledAt: row.scheduledAt ?? null,
    durationMinutes: row.durationMinutes,
    assessor: assessor?.name ?? null,
    siteContact: row.siteContact ?? null,
    required: wanted,
    findings: (row.findings ?? {}) as Record<string, string | number | boolean>,
    photos,
    completedAt: row.completedAt ?? null,
    completedBy: row.completedBy ?? null,
    pricingReviewedAt: row.pricingReviewedAt ?? null,
  };
}

export const forDraft = companyQuery({
  args: { draftId: v.id("salesDrafts") },
  handler: async (ctx, args) => {
    const draft = await owned(ctx, args.draftId);
    const rows = await ctx.db
      .query("assessments")
      .withIndex("by_company_draft", (q) => q.eq("companyId", ctx.companyId).eq("draftId", draft._id))
      .take(50);
    const out = [];
    for (const row of rows) {
      const view = await describe(ctx, row);
      const token = row.publicId && (row.status === "requested" || row.status === "scheduled") ? await linkToken("assess", row.publicId) : null;
      out.push({ ...view, link: token ? linkUrl("assess", token) : null });
    }
    return out;
  },
});

function cleanFindings(required: string[], findings: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(findings)) {
    if (!required.includes(key)) continue;
    if (typeof value === "string") {
      if (value.trim()) out[key] = value.trim().slice(0, 2000);
    } else if (typeof value === "number") {
      if (Number.isFinite(value) && value >= 0 && value < 10_000_000) out[key] = value;
    } else out[key] = value;
  }
  return out;
}

async function complete(ctx: MutationCtx, row: Doc<"assessments">, findings: Record<string, string | number | boolean>, by: string, actor: Actor, finish: boolean) {
  if (row.status === "completed" || row.status === "cancelled") throw userError(`This walkthrough is already ${row.status}.`);
  const clean = { ...((row.findings ?? {}) as Record<string, string | number | boolean>), ...cleanFindings(row.requiredFindings, findings) };
  const missing = row.requiredFindings.filter((key) => key !== "notes" && !key.startsWith("note:") && clean[key] === undefined);
  if (finish && missing.length) throw userError(`Still to record: ${missing.length} required finding${missing.length === 1 ? "" : "s"}.`);
  await ctx.db.patch(row._id, { findings: clean, ...(finish ? { status: "completed" as const, completedAt: Date.now(), completedBy: by } : {}), updatedAt: Date.now() });
  if (finish) {
    await patchSite(ctx, row.draftId, row.siteKey, { assessment: "completed" });
    await recordEvent(ctx, { companyId: row.companyId, type: "assessment.completed", actor, subject: { table: "assessments", id: row._id } });
  }
}

/** Records findings in the app. `finish` completes the walkthrough once every required finding is in. */
export const record = companyMutation({
  args: { assessmentId: v.id("assessments"), findings: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())), finish: v.boolean() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.assessmentId);
    await complete(ctx, row, args.findings, ctx.member.name, byMember(ctx), args.finish);
    return null;
  },
});

/**
 * Applies the findings to the proposal site's pricing answers. A person does this after reviewing them;
 * only findings that map to the service's own inputs are applied.
 */
export const applyToSite = companyMutation({
  args: { assessmentId: v.id("assessments"), revision: v.number() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.assessmentId);
    return applyFindings(ctx, row, args.revision, ctx.member._id);
  },
});

/** Shared by the workspace and Chat: findings that map to the service's own inputs go onto the site's answers. */
export async function applyFindings(ctx: MutationCtx, row: Doc<"assessments">, revision: number, memberId: Id<"members">) {
  if (row.status !== "completed") throw userError("Complete the walkthrough first.");
  if (!row.draftId || !row.siteKey) throw userError("This walkthrough isn't linked to a proposal site.");
  const draft = await ctx.db.get(row.draftId);
  if (!draft || draft.companyId !== row.companyId) throw userError("The proposal draft no longer exists.");
  if (draft.revision !== revision) throw userError("The draft changed. Reload, then apply the findings.");
  const findings = (row.findings ?? {}) as Record<string, string | number | boolean>;
  const body = draft.body as DraftBody;
  const site = body.proposal?.sites.find((s) => s.key === row.siteKey);
  if (!site) throw userError("The site is no longer on the proposal.");
  const input = { ...(site.input ?? {}) } as Record<string, unknown>;
  const answers = { ...((input.answers as Record<string, string | number | boolean> | undefined) ?? {}) };
  if (typeof findings.area === "number") input.area = findings.area;
  if (typeof findings.bedrooms === "number") input.bedrooms = findings.bedrooms;
  if (typeof findings.bathrooms === "number") input.bathrooms = findings.bathrooms;
  if (typeof findings.condition === "string" && row.serviceKey) {
    const found = await publishedByKey(ctx, row.companyId, row.serviceKey);
    const level = found?.version.spec.modifiers.condition.levels.find((l) => l.label === findings.condition);
    if (level) input.condition = level.id;
  }
  for (const [key, value] of Object.entries(findings)) if (key.startsWith("q:")) answers[key.slice(2)] = value;
  input.answers = answers;
  const notes = typeof findings.notes === "string" ? findings.notes : undefined;
  const sites = body.proposal!.sites.map((s) => (s.key === site.key ? { ...s, input: input as never, ...(notes && !s.accessNotes ? { accessNotes: notes.slice(0, 1000) } : {}) } : s));
  await ctx.db.patch(draft._id, { body: { ...body, proposal: { ...body.proposal!, sites } }, revision: draft.revision + 1, updatedAt: Date.now(), updatedBy: memberId });
  await ctx.db.patch(row._id, { pricingReviewedAt: Date.now() });
  return { revision: draft.revision + 1, applied: Object.keys(findings).filter((k) => k === "area" || k === "bedrooms" || k === "bathrooms" || k === "condition" || k.startsWith("q:")) };
}

// ── The assessor's link ─────────────────────────────────────────────────────────────────────────

async function resolve(ctx: QueryCtx | MutationCtx, publicId: string) {
  const row = await ctx.db
    .query("assessments")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique();
  if (!row) return null;
  const company = await ctx.db.get(row.companyId);
  return company ? { row, company } : null;
}

export const linkView = salesLinkQuery({
  kind: "assess",
  resolve,
  args: {},
  handler: async (ctx) => {
    if (!ctx.link) return null;
    return { company: ctx.link.company.name, ...(await describe(ctx, ctx.link.row)) };
  },
});

export const linkRecord = salesLinkMutation({
  kind: "assess",
  resolve,
  args: { findings: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())), finish: v.boolean(), name: v.string() },
  handler: async (ctx, args) => {
    await complete(ctx, ctx.link.row, args.findings, `${text(args.name, "Your name", 80)} (assessor link)`, { kind: "system" }, args.finish);
    return null;
  },
});

export const linkUploadUrl = salesLinkMutation({
  kind: "assess",
  resolve,
  args: {},
  handler: async (ctx) => {
    if (ctx.link.row.status === "completed" || ctx.link.row.status === "cancelled") throw userError("This walkthrough is closed.");
    if (ctx.link.row.photos.length >= 40) throw userError("A walkthrough can have up to 40 photos.");
    return ctx.storage.generateUploadUrl();
  },
});

export const linkAddPhoto = salesLinkMutation({
  kind: "assess",
  resolve,
  args: { storageId: v.id("_storage"), caption: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = ctx.link.row;
    if (row.status === "completed" || row.status === "cancelled") throw userError("This walkthrough is closed.");
    const meta = await ctx.db.system.get(args.storageId);
    if (!meta || !(meta.contentType ?? "").startsWith("image/") || meta.size > 15 * 1024 * 1024) throw userError("Add a photo (an image up to 15 MB).");
    if (row.photos.some((p) => p.storageId === args.storageId)) return null;
    await ctx.db.patch(row._id, { photos: [...row.photos, { storageId: args.storageId, caption: optionalText(args.caption, "Caption", 200), at: Date.now() }].slice(0, 40), updatedAt: Date.now() });
    return null;
  },
});

export type AssessmentView = Awaited<ReturnType<typeof describe>>;
export type { MemberAccess };
