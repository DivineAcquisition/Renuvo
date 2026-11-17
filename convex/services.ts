/**
 * Services & Pricing: the company's one service catalog, its drafts, versions, reviews and history.
 *
 * Who may do what (checked here, whatever a screen shows):
 *  - everyone in the company reads the catalog and its history;
 *  - Owners and Managers draft, submit for review, withdraw, and start a rollback;
 *  - only the Owner approves, publishes, schedules, returns a change, and reads costs and profitability.
 * Publishing is always a person's act: no agent and no Chat tool publishes (the owner's decision of
 * November 16, 2026, and PERSON_ONLY in lib/permissionCatalog.ts).
 *
 * Nothing here spends credits. Quotes and previews are deterministic code.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { companyQuery, managerMutation, ownerMutation, type MemberAccess } from "./lib/builders";
import { serviceKey } from "./lib/dispatch/templates";
import { userError } from "./lib/errors";
import { byMember, recordEvent, type Actor } from "./lib/events";
import { isManager, isOwner } from "./lib/roles";
import { priceSummary, quote as runQuote, type QuoteInput } from "./lib/services/engine";
import { emptyCosts, profitability } from "./lib/services/profit";
import { contextValidator, evidenceValidator, quoteInputValidator } from "./lib/services/schema";
import { blankSpec, categoryValidator, specValidator, type Spec } from "./lib/services/spec";
import {
  canonical,
  describeChanges,
  draftOf,
  normalizeSpec,
  openChanges,
  ownedService,
  priceComparison,
  publishedSpec,
  specHash,
  submissionProblems,
  versionOf,
} from "./lib/services/store";
import { costsValidator } from "./lib/services/profit";
import { businessSettingsOf } from "./lib/settings/business";
import { actorLabel, changeHash, closeChange, createDraft, STALE_DRAFT, submitDraft, writeDraft } from "./lib/services/workflow";
import { assumptionsFor, emptyContext } from "./lib/services/setup";
import { startSetupResearch } from "./lib/services/researchStart";

type Ctx = QueryCtx & MemberAccess;
type WriteCtx = MutationCtx & MemberAccess;


// ── Reads ───────────────────────────────────────────────────────────────────────────────────────────

/** The catalog: every service with its live version, its draft and any change waiting on a person. */
export const catalog = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = [
      ...(await ctx.db.query("services").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active")).take(200)),
      ...(await ctx.db.query("services").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "draft")).take(200)),
      ...(await ctx.db.query("services").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "archived")).take(200)),
    ];
    const services = [];
    for (const service of rows) {
      const live = await publishedSpec(ctx, service);
      const draft = await draftOf(ctx, ctx.companyId, service._id);
      const open = (await openChanges(ctx, ctx.companyId, service._id))[0] ?? null;
      services.push({
        id: service._id,
        key: service.key,
        name: service.name,
        category: service.category,
        status: service.status,
        origin: service.origin,
        live: live ? { version: live.version, summary: priceSummary(live.spec), method: live.spec.pricing.method, publishedAt: service.publishedAt ?? live.createdAt, description: live.spec.summary, included: live.spec.included.length, addOns: live.spec.addOns.length, crew: live.spec.team.crewSize, skills: live.spec.team.skills } : null,
        draft: draft ? { revision: draft.revision, updatedAt: draft.updatedAt, by: await actorLabel(ctx, draft.updatedBy, draft.via), step: draft.step, name: draft.spec.name, summary: priceSummary(draft.spec), illustrative: draft.spec.illustrative, blockers: submissionProblems(draft.spec).length } : null,
        openChange: open ? { id: open._id, state: open.state, effectiveAt: open.effectiveAt ?? null } : null,
      });
    }
    services.sort((a, b) => a.name.localeCompare(b.name));
    const legacy = businessSettingsOf(ctx.company).services;
    const profile = await ctx.db
      .query("pricingProfiles")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .first();
    return {
      role: ctx.role,
      canDraft: isManager(ctx.role),
      canPublish: isOwner(ctx.role),
      /** Services still only in Settings, waiting to be copied into this catalog. */
      legacyWaiting: ctx.company.servicesMigratedAt === undefined ? legacy.length : 0,
      setupDone: profile?.setupCompletedAt !== undefined,
      services,
      counts: {
        active: services.filter((s) => s.status === "active").length,
        drafts: services.filter((s) => s.draft).length,
        waiting: services.filter((s) => s.openChange).length,
        archived: services.filter((s) => s.status === "archived").length,
      },
    };
  },
});

/** One service: its live version, the draft, every version and every change. */
export const service = companyQuery({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const live = await publishedSpec(ctx, service);
    const draft = await draftOf(ctx, ctx.companyId, service._id);
    const versions = await ctx.db
      .query("serviceVersions")
      .withIndex("by_company_service_version", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", service._id))
      .order("desc")
      .take(100);
    const changes = await ctx.db
      .query("serviceChanges")
      .withIndex("by_company_service", (q) => q.eq("companyId", ctx.companyId).eq("serviceId", service._id))
      .order("desc")
      .take(50);
    return {
      service: { id: service._id, key: service.key, name: service.name, category: service.category, status: service.status, origin: service.origin, templateId: service.templateId ?? null, publishedVersion: service.publishedVersion ?? null, publishedAt: service.publishedAt ?? null },
      live: live ? { version: live.version, spec: live.spec, hash: live.hash } : null,
      draft: draft ? { spec: draft.spec, revision: draft.revision, baseVersion: draft.baseVersion ?? null, step: draft.step, updatedAt: draft.updatedAt, by: await actorLabel(ctx, draft.updatedBy, draft.via), rollbackOf: draft.rollbackOf ?? null } : null,
      versions: await Promise.all(versions.map(async (row) => ({ version: row.version, createdAt: row.createdAt, by: await actorLabel(ctx, row.author), source: row.source, basedOn: row.basedOn ?? null, note: row.note ?? null, live: row.version === service.publishedVersion, summary: priceSummary(row.spec) }))),
      changes: changes.map((row) => ({ id: row._id, kind: row.kind, state: row.state, version: row.version ?? null, title: row.title, submittedAt: row.submittedAt, effectiveAt: row.effectiveAt ?? null, publishedAt: row.publishedAt ?? null })),
      canDraft: isManager(ctx.role),
      canPublish: isOwner(ctx.role),
    };
  },
});

/** One past version, exactly as it was written. */
export const version = companyQuery({
  args: { serviceId: v.id("services"), version: v.number() },
  handler: async (ctx, args) => {
    await ownedService(ctx, ctx.companyId, args.serviceId);
    const row = await versionOf(ctx, ctx.companyId, args.serviceId, args.version);
    if (!row) throw userError("Not found.", "not_found");
    return { version: row.version, spec: row.spec, hash: row.hash, createdAt: row.createdAt, by: await actorLabel(ctx, row.author), source: row.source, basedOn: row.basedOn ?? null };
  },
});

/** Changes, newest first. Open ones first when `open` is set. */
export const changes = companyQuery({
  args: { open: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("serviceChanges")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(200);
    const list = args.open ? rows.filter((row) => row.state === "in_review" || row.state === "approved" || row.state === "scheduled") : rows;
    const out = [];
    for (const row of list) {
      const service = await ctx.db.get(row.serviceId);
      out.push({ id: row._id, serviceId: row.serviceId, serviceName: service?.name ?? "A service", kind: row.kind, state: row.state, version: row.version ?? null, title: row.title, submittedAt: row.submittedAt, by: await actorLabel(ctx, row.submittedBy), effectiveAt: row.effectiveAt ?? null, publishedAt: row.publishedAt ?? null, concerns: row.agentNotes.filter((n) => n.status === "concern").length });
    }
    return { changes: out, canPublish: isOwner(ctx.role) };
  },
});

/** One change, with what it changes, the prices before and after, the evidence and the specialists' notes. */
export const change = companyQuery({
  args: { changeId: v.id("serviceChanges") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.changeId);
    if (!row || row.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    const service = await ownedService(ctx, ctx.companyId, row.serviceId);
    const after = row.versionId ? await ctx.db.get(row.versionId) : null;
    const before = row.fromVersion !== undefined ? await versionOf(ctx, ctx.companyId, row.serviceId, row.fromVersion) : null;
    const draft = await draftOf(ctx, ctx.companyId, row.serviceId);
    const open = row.state === "in_review" || row.state === "approved" || row.state === "scheduled";
    return {
      id: row._id,
      service: { id: service._id, name: service.name, status: service.status, liveVersion: service.publishedVersion ?? null },
      kind: row.kind,
      state: row.state,
      hash: row.hash,
      title: row.title,
      reason: row.reason,
      evidence: row.evidence,
      agentNotes: row.agentNotes,
      impact: row.impact,
      customerNotice: row.customerNotice,
      contractReview: row.contractReview,
      effectiveAt: row.effectiveAt ?? null,
      submittedAt: row.submittedAt,
      submittedBy: await actorLabel(ctx, row.submittedBy),
      approval: row.approval ? { by: (await ctx.db.get(row.approval.by))?.name ?? "The Owner", at: row.approval.at, note: row.approval.note ?? null } : null,
      publishedAt: row.publishedAt ?? null,
      publishedBy: row.publishedBy ? await actorLabel(ctx, row.publishedBy) : null,
      closedReason: row.closedReason ?? null,
      version: row.version ?? null,
      fromVersion: row.fromVersion ?? null,
      after: after?.spec ?? null,
      before: before?.spec ?? null,
      changesInWords: after ? describeChanges(before?.spec ?? null, after.spec) : [],
      prices: after ? priceComparison(before?.spec ?? null, after.spec) : [],
      /** The live version moved since this was submitted, so publishing it would overwrite someone else's change. */
      liveMoved: open && service.publishedVersion !== row.fromVersion,
      /** The draft was edited after this was submitted. */
      draftMoved: open && row.kind === "publish" && row.draftRevision !== undefined && draft !== null && draft.revision !== row.draftRevision,
      canPublish: isOwner(ctx.role),
      canWithdraw: isManager(ctx.role),
    };
  },
});

/** The price for one job from a service's live version, a past version or its draft. Free: no AI. The Owner also gets profitability. */
export const quote = companyQuery({
  args: { serviceId: v.id("services"), input: quoteInputValidator, from: v.union(v.literal("live"), v.literal("draft"), v.literal("version")), version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    let spec: Spec | null = null;
    let version: number | null = null;
    if (args.from === "live") {
      const live = await publishedSpec(ctx, service);
      spec = live?.spec ?? null;
      version = live?.version ?? null;
    } else if (args.from === "draft") {
      if (!isManager(ctx.role)) throw userError("Not allowed.", "not_allowed");
      spec = (await draftOf(ctx, ctx.companyId, service._id))?.spec ?? null;
    } else {
      const row = args.version === undefined ? null : await versionOf(ctx, ctx.companyId, service._id, args.version);
      spec = row?.spec ?? null;
      version = row?.version ?? null;
    }
    if (!spec) throw userError(args.from === "live" ? `${service.name} has no live version yet.` : "That version does not exist.");
    const result = runQuote(spec, args.input as QuoteInput);
    let profit = null;
    if (isOwner(ctx.role)) {
      const profile = await ctx.db
        .query("pricingProfiles")
        .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
        .first();
      profit = profitability(result, profile?.costs ?? emptyCosts());
    }
    return { service: service.name, version, quote: result, profit };
  },
});

/** The company's pricing setup. Costs are the Owner's alone, like pay. */
export const profile = companyQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("pricingProfiles")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .first();
    const context = row?.context ?? emptyContext();
    return {
      exists: row !== null,
      revision: row?.revision ?? 0,
      context,
      strategy: row?.strategy ?? null,
      positioning: row?.positioning ?? null,
      researchDuringSetup: row?.researchDuringSetup ?? true,
      setupCompletedAt: row?.setupCompletedAt ?? null,
      costs: isOwner(ctx.role) ? (row?.costs ?? emptyCosts()) : null,
      assumptions: assumptionsFor(context),
      canEdit: isOwner(ctx.role),
    };
  },
});

// ── Drafting ────────────────────────────────────────────────────────────────────────────────────────

const originValidator = v.union(v.literal("manual"), v.literal("template"), v.literal("import"), v.literal("research"));

/** Starts a new service as a draft: blank, from a template, from an imported row, or from research. Nothing is live. */
export const startDraft = managerMutation({
  args: { category: categoryValidator, spec: v.optional(specValidator), origin: originValidator, templateId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    return createDraft(ctx, { category: args.category, spec: args.spec, origin: args.origin, templateId: args.templateId, via: "workspace", actor: byMember(ctx) });
  },
});

/** Opens a draft of a live service. The live version keeps selling until a change is published. */
export const editLive = managerMutation({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const existing = await draftOf(ctx, ctx.companyId, service._id);
    if (existing) return { revision: existing.revision };
    const live = await publishedSpec(ctx, service);
    if (!live) throw userError("This service has no live version to edit.");
    const now = Date.now();
    await ctx.db.insert("serviceDrafts", { companyId: ctx.companyId, serviceId: service._id, spec: live.spec, revision: 1, baseVersion: live.version, step: "basics", updatedBy: byMember(ctx), updatedAt: now, createdAt: now, via: "workspace" });
    return { revision: 1 };
  },
});

/**
 * Autosave. The draft names the revision it was loaded at; a different one means someone (a person or
 * Selestial in Chat) saved since, and the save is refused with who and when, never overwritten. A save
 * that changes the draft returns any change already submitted from it: that review was for older content.
 */
export const saveDraft = managerMutation({
  args: { serviceId: v.id("services"), expectedRevision: v.number(), spec: specValidator, step: v.string() },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const draft = await draftOf(ctx, ctx.companyId, service._id);
    if (!draft) throw userError("This draft was discarded or published. Open the service again to start a new one.");
    if (draft.revision !== args.expectedRevision) return { ok: false as const, conflict: { revision: draft.revision, by: await actorLabel(ctx, draft.updatedBy, draft.via), at: draft.updatedAt }, message: STALE_DRAFT };
    const spec = normalizeSpec(args.spec);
    const step = args.step.slice(0, 20);
    if (canonical(spec) === canonical(draft.spec)) {
      if (step !== draft.step) await ctx.db.patch(draft._id, { step });
      return { ok: true as const, revision: draft.revision, changed: false };
    }
    return { ok: true as const, ...(await writeDraft(ctx, service, draft, spec, step, byMember(ctx), "workspace")), changed: true };
  },
});

/** Throws the draft away. A service that was never live and has nothing waiting is removed with it. */
export const discardDraft = managerMutation({
  args: { serviceId: v.id("services") },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const draft = await draftOf(ctx, ctx.companyId, service._id);
    if (!draft) return { removed: false };
    const open = await openChanges(ctx, ctx.companyId, service._id);
    if (open.some((change) => change.kind === "publish")) throw userError("A change from this draft is waiting for review. Withdraw it first.");
    await ctx.db.delete(draft._id);
    if (service.status === "draft" && service.latestVersion === 0) {
      await ctx.db.delete(service._id);
      return { removed: true };
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.draft_discarded", actor: byMember(ctx), subject: { table: "services", id: service._id } });
    return { removed: false };
  },
});

/** Starts a draft that copies an earlier version. Submitting it makes a new version based on that one; history is never rewritten. */
export const startRollback = managerMutation({
  args: { serviceId: v.id("services"), version: v.number(), replaceDraft: v.boolean() },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const old = await versionOf(ctx, ctx.companyId, service._id, args.version);
    if (!old) throw userError("That version does not exist.");
    if (old.version === service.publishedVersion) throw userError("That version is already live.");
    const draft = await draftOf(ctx, ctx.companyId, service._id);
    const now = Date.now();
    if (draft) {
      if (!args.replaceDraft) throw userError("There is already a draft. Replace it to start the rollback.");
      await writeDraft(ctx, service, draft, old.spec, "review", byMember(ctx), "workspace");
      await ctx.db.patch(draft._id, { rollbackOf: old.version, baseVersion: service.publishedVersion });
    } else {
      await ctx.db.insert("serviceDrafts", { companyId: ctx.companyId, serviceId: service._id, spec: old.spec, revision: 1, baseVersion: service.publishedVersion, step: "review", updatedBy: byMember(ctx), updatedAt: now, createdAt: now, rollbackOf: old.version, via: "workspace" });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.rollback_started", actor: byMember(ctx), subject: { table: "services", id: service._id }, data: { version: old.version } });
    return { ok: true };
  },
});

/** Applies a specialist's suggested edit to the draft. Only the fields specialists may suggest. */
export const applySuggestion = managerMutation({
  args: { serviceId: v.id("services"), field: v.union(v.literal("team.crewSize"), v.literal("team.maxVisitMinutes")), value: v.number() },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    let draft = await draftOf(ctx, ctx.companyId, service._id);
    if (!draft) {
      const live = await publishedSpec(ctx, service);
      if (!live) throw userError("There is nothing to edit.");
      const now = Date.now();
      const id = await ctx.db.insert("serviceDrafts", { companyId: ctx.companyId, serviceId: service._id, spec: live.spec, revision: 1, baseVersion: live.version, step: "team", updatedBy: byMember(ctx), updatedAt: now, createdAt: now, via: "workspace" });
      draft = (await ctx.db.get(id))!;
    }
    const team = args.field === "team.crewSize" ? { ...draft.spec.team, crewSize: args.value, maxCrew: Math.max(draft.spec.team.maxCrew, args.value) } : { ...draft.spec.team, maxVisitMinutes: args.value };
    const spec = normalizeSpec({ ...draft.spec, team });
    return writeDraft(ctx, service, draft, spec, "team", byMember(ctx), "workspace");
  },
});

// ── Review ──────────────────────────────────────────────────────────────────────────────────────────

const noticeValidator = v.object({ required: v.boolean(), note: v.string() });

/**
 * Freezes the draft as a new immutable version and puts it in review. The draft stays, so a later edit is
 * noticed and returns this change. Blockers (an unnamed service, overlapping bands, unconfirmed
 * illustrative amounts or requirements) stop it here.
 */
export const submit = managerMutation({
  args: { serviceId: v.id("services"), expectedRevision: v.number(), reason: v.string(), customerNotice: noticeValidator, contractReview: noticeValidator, effectiveAt: v.optional(v.number()), evidence: v.optional(v.array(evidenceValidator)) },
  handler: async (ctx, args) => submitDraft(ctx, { ...args, actor: byMember(ctx) }),
});

/** Asks to stop offering a live service. Visits already booked keep it; new ones cannot choose it. */
export const requestArchive = managerMutation({
  args: { serviceId: v.id("services"), reason: v.string(), restore: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const service = await ownedService(ctx, ctx.companyId, args.serviceId);
    const restore = args.restore === true;
    if (restore ? service.status !== "archived" : service.status !== "active") throw userError(restore ? "Only an archived service can be restored." : "Only a live service can be archived.");
    if (restore && !service.publishedVersionId) throw userError("This service was never live.");
    const reason = args.reason.trim().slice(0, 1000);
    if (!reason) throw userError("Say why.");
    for (const change of await openChanges(ctx, ctx.companyId, service._id)) if (change.kind !== "publish") await closeChange(ctx, change, "superseded", "A newer request replaced it.");
    const now = Date.now();
    const kind = restore ? "restore" : "archive";
    const changeId = await ctx.db.insert("serviceChanges", {
      companyId: ctx.companyId,
      serviceId: service._id,
      kind,
      state: "in_review",
      ...(service.publishedVersionId ? { versionId: service.publishedVersionId, version: service.publishedVersion } : {}),
      ...(service.publishedVersion !== undefined ? { fromVersion: service.publishedVersion } : {}),
      hash: changeHash({ kind, versionHash: null, fromVersion: service.publishedVersion ?? null, effectiveAt: null, serviceId: service._id }),
      title: `${restore ? "Restore" : "Archive"} ${service.name}`,
      reason,
      evidence: [],
      agentNotes: [],
      impact: restore ? ["New quotes and visits can choose this service again, at its last live version."] : ["New quotes and visits can no longer choose this service.", "Visits already booked keep it, with the scope and price they were booked with.", "Nothing is deleted. It can be restored."],
      customerNotice: { required: false, note: "" },
      contractReview: { required: false, note: "" },
      submittedBy: byMember(ctx),
      submittedAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: `service.${kind}_requested`, actor: byMember(ctx), subject: { table: "serviceChanges", id: changeId } });
    return { changeId };
  },
});

/**
 * The Owner approves the exact change on screen (its hash). With `publish`, it goes live now, or is
 * scheduled for its start date. Approval is refused if the draft or the live version moved since.
 */
export const approve = ownerMutation({
  args: { changeId: v.id("serviceChanges"), hash: v.string(), note: v.optional(v.string()), publish: v.boolean() },
  handler: async (ctx, args) => {
    const change = await ownedChange(ctx, args.changeId);
    if (change.state !== "in_review") throw userError(change.state === "approved" ? "This change is already approved." : "This change is not waiting for review.");
    if (change.hash !== args.hash) throw userError("This change is different from the one you reviewed. Reload it and review again.");
    await refuseIfMoved(ctx, change);
    const now = Date.now();
    await ctx.db.patch(change._id, { state: "approved", approval: { by: ctx.member._id, at: now, hash: change.hash, ...(args.note?.trim() ? { note: args.note.trim().slice(0, 500) } : {}) }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.approved", actor: byMember(ctx), subject: { table: "serviceChanges", id: change._id }, data: { version: change.version ?? null } });
    if (!args.publish) return { state: "approved" as const };
    return publishOrSchedule(ctx, (await ctx.db.get(change._id))!);
  },
});

/** Publishes an approved change (or schedules it for its start date). */
export const publish = ownerMutation({
  args: { changeId: v.id("serviceChanges"), hash: v.string() },
  handler: async (ctx, args) => {
    const change = await ownedChange(ctx, args.changeId);
    if (change.state !== "approved") throw userError(change.state === "in_review" ? "Approve it first." : "This change cannot be published now.");
    if (change.hash !== args.hash || change.approval?.hash !== change.hash) throw userError("The approval is for a different version of this change. Review it again.");
    return publishOrSchedule(ctx, change);
  },
});

async function publishOrSchedule(ctx: WriteCtx, change: Doc<"serviceChanges">): Promise<{ state: "published" | "scheduled" }> {
  if (change.effectiveAt !== undefined && change.effectiveAt > Date.now() + 60_000) {
    const scheduledFunctionId = await ctx.scheduler.runAt(change.effectiveAt, internal.services.publishScheduled, { changeId: change._id, hash: change.hash });
    await ctx.db.patch(change._id, { state: "scheduled", scheduledFunctionId, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.scheduled", actor: byMember(ctx), subject: { table: "serviceChanges", id: change._id }, data: { effectiveAt: change.effectiveAt } });
    return { state: "scheduled" };
  }
  await applyChange(ctx, change, byMember(ctx), ctx.member._id);
  return { state: "published" };
}

async function refuseIfMoved(ctx: WriteCtx, change: Doc<"serviceChanges">) {
  const service = await ownedService(ctx, ctx.companyId, change.serviceId);
  if (service.publishedVersion !== change.fromVersion) {
    await closeChange(ctx, change, "returned", "The live version changed after this was submitted. Review the newer live version first.");
    throw userError("The live version changed after this was submitted, so this change was returned. Submit it again from the draft.");
  }
  if (change.kind === "publish" && change.draftRevision !== undefined) {
    const draft = await draftOf(ctx, ctx.companyId, change.serviceId);
    if (draft && draft.revision !== change.draftRevision) {
      await closeChange(ctx, change, "returned", "The draft was edited after it was submitted.");
      throw userError("The draft was edited after this was submitted, so this change was returned. Submit it again.");
    }
  }
}

/** Makes an approved change live. Called by the Owner, or by the scheduler at the start date. */
async function applyChange(ctx: MutationCtx, change: Doc<"serviceChanges">, actor: Actor, memberForChecklist: Id<"members">) {
  const service = (await ctx.db.get(change.serviceId))!;
  const now = Date.now();
  if (change.kind === "publish") {
    const version = (await ctx.db.get(change.versionId!))!;
    await ctx.db.patch(service._id, { publishedVersion: version.version, publishedVersionId: version._id, publishedAt: now, status: "active", name: version.spec.name, category: version.spec.category, updatedAt: now });
    const draft = await draftOf(ctx, change.companyId, service._id);
    if (draft && draft.revision === change.draftRevision) await ctx.db.delete(draft._id);
    await syncChecklist(ctx, change.companyId, version.spec, memberForChecklist);
  } else {
    await ctx.db.patch(service._id, { status: change.kind === "archive" ? "archived" : "active", updatedAt: now });
  }
  await ctx.db.patch(change._id, { state: "published", publishedAt: now, publishedBy: actor, updatedAt: now, scheduledFunctionId: undefined });
  for (const other of await openChanges(ctx, change.companyId, service._id)) {
    if (other._id !== change._id && other.kind === change.kind) await closeChange(ctx, other, "superseded", "Another change to this service went live first.");
  }
  await recordEvent(ctx, { companyId: change.companyId, type: change.kind === "publish" ? "service.published" : `service.${change.kind}d`, actor, subject: { table: "serviceChanges", id: change._id }, data: { version: change.version ?? null, service: service.name } });
}

/** The team's checklist for the service follows its published scope. Visits already made keep theirs. */
async function syncChecklist(ctx: MutationCtx, companyId: Id<"companies">, spec: Spec, memberId: Id<"members">) {
  if (spec.included.length === 0) return;
  const items = spec.included.map((item) => ({ label: item.label, ...(item.section ? { section: item.section } : {}), requiresPhoto: item.requiresPhoto }));
  const key = serviceKey(spec.name);
  const latest = await ctx.db
    .query("checklistTemplates")
    .withIndex("by_company_service_version", (q) => q.eq("companyId", companyId).eq("serviceKey", key))
    .order("desc")
    .first();
  if (latest && latest.retiredAt === undefined && canonical(latest.items) === canonical(items)) return;
  await ctx.db.insert("checklistTemplates", { companyId, serviceKey: key, serviceType: spec.name, version: (latest?.version ?? 0) + 1, items, createdBy: memberId, createdAt: Date.now() });
}

/** The scheduler's half of a scheduled change. It checks everything again; if anything moved, nothing goes live and the Owner is told. */
export const publishScheduled = internalMutation({
  args: { changeId: v.id("serviceChanges"), hash: v.string() },
  handler: async (ctx, args) => {
    const change = await ctx.db.get(args.changeId);
    if (!change || change.state !== "scheduled" || change.hash !== args.hash || change.approval?.hash !== change.hash) return { published: false };
    const service = await ctx.db.get(change.serviceId);
    const draft = service ? await draftOf(ctx, change.companyId, service._id) : null;
    const problem = !service ? "The service no longer exists." : service.publishedVersion !== change.fromVersion ? "The live version changed after this was approved." : change.kind === "publish" && draft && change.draftRevision !== undefined && draft.revision !== change.draftRevision ? "The draft was edited after this was approved." : null;
    if (problem) {
      await ctx.db.patch(change._id, { state: "returned", closedReason: `Not published at the start date: ${problem}`, updatedAt: Date.now(), scheduledFunctionId: undefined });
      await recordEvent(ctx, { companyId: change.companyId, type: "service.schedule_failed", actor: { kind: "system" }, subject: { table: "serviceChanges", id: change._id }, data: { reason: problem } });
      return { published: false };
    }
    await applyChange(ctx, change, { kind: "system" }, change.approval!.by);
    return { published: true };
  },
});

/** The Owner sends a change back. A scheduled one is cancelled. */
export const returnChange = ownerMutation({
  args: { changeId: v.id("serviceChanges"), reason: v.string() },
  handler: async (ctx, args) => {
    const change = await ownedChange(ctx, args.changeId);
    if (change.state !== "in_review" && change.state !== "approved" && change.state !== "scheduled") throw userError("This change is not open.");
    const reason = args.reason.trim().slice(0, 1000);
    if (!reason) throw userError("Say what needs to change, so whoever drafted it knows.");
    await closeChange(ctx, change, "returned", reason);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.change_returned", actor: byMember(ctx), subject: { table: "serviceChanges", id: change._id }, data: { reason: "owner" } });
    return null;
  },
});

/** Withdraws an open change. Managers may withdraw what they submitted; the Owner may withdraw any. */
export const withdraw = managerMutation({
  args: { changeId: v.id("serviceChanges") },
  handler: async (ctx, args) => {
    const change = await ownedChange(ctx, args.changeId);
    if (change.state !== "in_review" && change.state !== "approved" && change.state !== "scheduled") throw userError("This change is not open.");
    const mine = change.submittedBy.kind === "member" && change.submittedBy.memberId === ctx.member._id;
    if (!mine && !isOwner(ctx.role)) throw userError("Only the person who submitted it, or the Owner, can withdraw it.", "not_allowed");
    await closeChange(ctx, change, "withdrawn", "Withdrawn.");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "service.change_withdrawn", actor: byMember(ctx), subject: { table: "serviceChanges", id: change._id } });
    return null;
  },
});

async function ownedChange(ctx: Ctx, changeId: Id<"serviceChanges">): Promise<Doc<"serviceChanges">> {
  const change = await ctx.db.get(changeId);
  if (!change || change.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
  return change;
}

// ── The company's pricing setup ─────────────────────────────────────────────────────────────────────

/** Saves setup answers, costs and strategy. Internal assumptions, not prices: no review step. The Owner only, like pay. */
export const saveProfile = ownerMutation({
  args: {
    expectedRevision: v.number(),
    context: contextValidator,
    costs: costsValidator,
    strategy: v.union(v.literal("cost_plus"), v.literal("positioning"), v.literal("market"), v.null()),
    positioning: v.union(v.literal("value"), v.literal("standard"), v.literal("premium"), v.null()),
    researchDuringSetup: v.boolean(),
    completeSetup: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pricingProfiles")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .first();
    if ((row?.revision ?? 0) !== args.expectedRevision) throw userError("These settings were saved somewhere else since you opened them. Reload to see the latest.");
    const context = checkContext(args.context);
    const costs = checkCosts(args.costs);
    const now = Date.now();
    const firstCompletion = args.completeSetup === true && row?.setupCompletedAt === undefined;
    const fields = { context, costs, strategy: args.strategy, positioning: args.positioning, researchDuringSetup: args.researchDuringSetup, updatedBy: byMember(ctx), updatedAt: now, ...(firstCompletion ? { setupCompletedAt: now } : {}) };
    if (row) await ctx.db.patch(row._id, { ...fields, revision: row.revision + 1 });
    else await ctx.db.insert("pricingProfiles", { companyId: ctx.companyId, revision: 1, ...fields });
    await recordEvent(ctx, { companyId: ctx.companyId, type: firstCompletion ? "service.setup_completed" : "service.profile_saved", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId } });
    // Setup research runs on its own (the owner's decision), once, and only with somewhere to look.
    let research: { briefId: Id<"researchBriefs"> } | null = null;
    if (firstCompletion && args.researchDuringSetup && context.serviceAreas.trim()) research = await startSetupResearch(ctx, ctx.company, ctx.member, context);
    return { revision: (row?.revision ?? 0) + 1, research };
  },
});

function checkContext(c: Doc<"pricingProfiles">["context"]): Doc<"pricingProfiles">["context"] {
  const n = (value: number | null, label: string, max: number) => {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0 || value > max) throw userError(`${label} must be a number from 0 to ${max}.`);
    return value;
  };
  const words = (value: string, max: number) => value.trim().slice(0, max);
  return {
    serviceAreas: words(c.serviceAreas, 500),
    customerKinds: [...new Set(c.customerKinds)],
    categories: [...new Set(c.categories)],
    currentServices: words(c.currentServices, 2000),
    typicalSizes: words(c.typicalSizes, 500),
    teamStructure: c.teamStructure,
    cleaners: n(c.cleaners, "Cleaners", 500),
    compensation: c.compensation,
    typicalVisitMinutes: n(c.typicalVisitMinutes, "Typical cleaning time", 24 * 60),
    bookingsPerWeek: n(c.bookingsPerWeek, "Bookings per week", 10_000),
    capacityPerWeek: n(c.capacityPerWeek, "Capacity per week", 10_000),
    notes: words(c.notes, 2000),
    unsure: [...new Set(c.unsure.map((key) => key.slice(0, 40)))].slice(0, 20),
  };
}

function checkCosts(c: Doc<"pricingProfiles">["costs"]): Doc<"pricingProfiles">["costs"] {
  const money = (value: number | null, label: string) => {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_00) throw userError(`${label} must be whole cents, zero or more.`);
    return value;
  };
  const pct = (value: number | null, label: string, max = 100) => {
    if (value === null) return null;
    if (!Number.isFinite(value) || value < 0 || value > max) throw userError(`${label} must be from 0% to ${max}%.`);
    return Math.round(value * 100) / 100;
  };
  let pay = c.pay;
  if (pay?.model === "hourly") pay = { model: "hourly", hourlyCents: money(pay.hourlyCents, "The hourly wage")!, burdenPercent: pct(pay.burdenPercent, "Payroll costs", 200)! };
  else if (pay?.model === "per_visit") pay = { model: "per_visit", amountCents: money(pay.amountCents, "Pay per visit")! };
  else if (pay?.model === "revenue_share") pay = { model: "revenue_share", sharePercent: pct(pay.sharePercent, "The cleaner's share")! };
  const floor = pct(c.floorMarginPercent, "The floor margin", 95);
  const target = pct(c.targetMarginPercent, "The target margin", 95);
  if (floor !== null && target !== null && floor > target) throw userError("The floor margin cannot be above the target margin.");
  return {
    pay,
    suppliesPerVisitCents: money(c.suppliesPerVisitCents, "Supplies"),
    travelPerVisitCents: money(c.travelPerVisitCents, "Travel"),
    equipmentPerVisitCents: money(c.equipmentPerVisitCents, "Equipment"),
    laundryPerLoadCents: money(c.laundryPerLoadCents, "Laundry"),
    paymentFeePercent: pct(c.paymentFeePercent, "The card fee", 20),
    paymentFeeFixedCents: money(c.paymentFeeFixedCents, "The fixed card fee"),
    overheadPerVisitCents: money(c.overheadPerVisitCents, "Overhead per visit"),
    targetMarginPercent: target,
    floorMarginPercent: floor,
    minimumJobCents: money(c.minimumJobCents, "The minimum job"),
  };
}

// ── Moving services out of Settings ─────────────────────────────────────────────────────────────────

/**
 * Copies the services kept under Settings into this catalog, once. Each becomes version 1, live, with the
 * same key, so visits that name it still find it. Settings' copy is left as it was, as a record.
 */
export const migrateFromSettings = ownerMutation({
  args: {},
  handler: async (ctx) => migrate(ctx, ctx.company, byMember(ctx)),
});

export const migrateCompany = internalMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return { migrated: 0 };
    return migrate(ctx, company, { kind: "system" });
  },
});

export async function migrate(ctx: MutationCtx, company: Doc<"companies">, actor: Actor): Promise<{ migrated: number }> {
  if (company.servicesMigratedAt !== undefined) return { migrated: 0 };
  const legacy = businessSettingsOf(company).services;
  const now = Date.now();
  let migrated = 0;
  for (const old of legacy) {
    const existing = await ctx.db
      .query("services")
      .withIndex("by_company_key", (q) => q.eq("companyId", company._id).eq("key", old.id))
      .first();
    if (existing) continue;
    const base = blankSpec("residential");
    const spec = normalizeSpec({
      ...base,
      name: old.name,
      summary: old.scope,
      pricing: old.startingPriceCents === undefined ? { method: "custom_quote", fromCents: null, laborMinutes: old.durationMinutes * old.defaultCrew } : { method: "fixed", amountCents: old.startingPriceCents, laborMinutes: old.durationMinutes * old.defaultCrew },
      team: { ...base.team, crewSize: old.defaultCrew, maxCrew: Math.max(old.defaultCrew, base.team.maxCrew), skills: old.skills, maxVisitMinutes: Math.max(old.durationMinutes, base.team.maxVisitMinutes) },
    });
    const status = old.status === "archived" ? "archived" : "active";
    const serviceId = await ctx.db.insert("services", { companyId: company._id, key: old.id, name: spec.name, category: spec.category, status, latestVersion: 1, origin: "settings", createdBy: actor, createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("serviceVersions", { companyId: company._id, serviceId, version: 1, spec, hash: specHash(spec), source: "settings", note: "Copied from Settings › Services & pricing", author: actor, createdAt: now });
    await ctx.db.patch(serviceId, { publishedVersion: 1, publishedVersionId: versionId, publishedAt: now });
    migrated += 1;
  }
  await ctx.db.patch(company._id, { servicesMigratedAt: now });
  await recordEvent(ctx, { companyId: company._id, type: "service.migrated", actor, subject: { table: "companies", id: company._id }, data: { services: migrated } });
  return { migrated };
}
