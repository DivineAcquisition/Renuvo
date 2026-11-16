/**
 * Company agreements: the library, the guided builder and the detail workspace (customer, workforce,
 * supporting and business documents). Selestial's own terms and the company's acceptance of them are
 * convex/agreements.ts, under Trust & Compliance, and are a different thing.
 *
 * Every function is a company builder: membership, role and the document's own access class are
 * checked on every call, and a document the member may not read is "Not found.", exactly as if it did
 * not exist, in lists, search, previews and direct ids alike.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { companyMutation, companyQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { can, capabilitiesOf, entitlements, mayDraft, mayRead, readableClasses, requireScale } from "./lib/agreements/access";
import { DOC_TYPES, DOC_TYPE_BY_KEY, SUPPORTING_KINDS, type AccessClass } from "./lib/agreements/catalog";
import { kitFor, missingRequired, render } from "./lib/agreements/compose";
import { diffLines } from "./lib/agreements/diff";
import { nextQuestions, progress, sections as intakeSections } from "./lib/agreements/intake";
import { LEGAL_NOTICE, reviewNotes } from "./lib/agreements/legal";
import { categoryValidator, partyValidator, termsValidator, workflowValidator } from "./lib/agreements/schema";
import { signingStatus } from "./lib/agreements/signing";
import { addLink, approve, archive, confirmAssumption, createAgreement, createAmendment, hasManualEdits, kitOf, lifecycleStatus, load, readiness, recordAnswers, removeLink, requestReview, saveVersion, setLifecycle, setSkipped, typeOf, unarchive, versionRow, withdrawApproval } from "./lib/agreements/store";
import { kitFromTemplate, loadTemplate, reviewedVersion } from "./lib/agreements/templates";
import { matchesView, VIEWS, VIEW_LABEL } from "./lib/agreements/views";
import { localParts } from "./lib/availability";

const linkInput = v.object({ table: v.union(v.literal("customers"), v.literal("properties"), v.literal("cleaners"), v.literal("jobs"), v.literal("applications")), id: v.string() });
const viewValidator = v.union(...VIEWS.map((view) => v.literal(view)));

const todayOf = (company: Doc<"companies">) => localParts(Date.now(), company.timezone).day;

/** A row for a list: no document text, no terms. */
function summary(row: Doc<"agreements">, today: string) {
  const type = DOC_TYPE_BY_KEY.get(row.docType);
  return {
    id: row._id,
    title: row.title,
    docType: row.docType,
    typeLabel: type?.label ?? row.docType,
    category: row.category,
    access: row.access,
    workflow: row.workflow,
    lifecycle: lifecycleStatus(row, today),
    effectiveOn: row.lifecycle.effectiveOn ?? null,
    renewalOn: row.lifecycle.renewalOn ?? null,
    expiresOn: row.lifecycle.expiresOn ?? null,
    provenance: row.provenance,
    version: row.currentVersion,
    parties: row.parties.map((p) => ({ role: p.role, name: p.name })),
    archived: row.archivedAt !== undefined,
    origin: row.origin,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
  };
}

async function readableRows(ctx: Parameters<Parameters<typeof companyQuery>[0]["handler"]>[0], limit = 500): Promise<Doc<"agreements">[]> {
  const classes = new Set(readableClasses(ctx.role));
  const rows = await ctx.db.query("agreements").withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(limit);
  return rows.filter((row) => classes.has(row.access));
}

function missingFor(row: Doc<"agreements">): number {
  if (row.workflow !== "draft" && row.workflow !== "needs_review") return 0;
  const type = DOC_TYPE_BY_KEY.get(row.docType);
  if (!type || row.origin === "upload") return 0;
  return missingRequired(type, row.terms, kitOf(row)).filter((key) => !row.skipped.includes(key)).length;
}

// ── The catalog and what the signed-in role may use ─────────────────────────────────────────────

export const catalog = companyQuery({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("agreementTemplates").withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(100);
    const visibleTypes = DOC_TYPES.filter((type) => mayRead(ctx.role, type.access));
    return {
      capabilities: capabilitiesOf(ctx.role),
      entitlements: entitlements(ctx.company),
      signing: signingStatus(),
      legalNotice: LEGAL_NOTICE,
      types: visibleTypes.map((type) => ({
        key: type.key,
        label: type.label,
        category: type.category,
        kind: type.kind,
        family: type.family,
        access: type.access,
        readiness: type.readiness,
        note: type.note ?? null,
        counterparty: type.counterparty,
        links: type.links ?? [],
        canDraft: mayDraft(ctx.role, type.access),
        // No catalog text has recorded legal review. A company's own template shows a review only when a person recorded one.
        legallyReviewed: false as const,
        clauseCount: type.clauses.length,
      })),
      supportingKinds: SUPPORTING_KINDS,
      templates: templates
        .filter((row) => mayRead(ctx.role, DOC_TYPE_BY_KEY.get(row.docType)?.access ?? "restricted"))
        .map((row) => ({ id: row._id, title: row.title, docType: row.docType, status: row.status, currentVersion: row.currentVersion, approvedVersion: row.approvedVersion ?? null, defaultFor: row.defaultFor, review: reviewedVersion(row), updatedAt: row.updatedAt })),
    };
  },
});

export const overview = companyQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayOf(ctx.company);
    const rows = (await readableRows(ctx)).filter((row) => !row.archivedAt);
    const totalAll = await readableRows(ctx);
    const out = VIEWS.map((view) => {
      const matched = rows.filter((row) => matchesView(view, row, today, missingFor(row)));
      return { view, label: VIEW_LABEL[view], count: matched.length, items: matched.slice(0, 5).map((row) => summary(row, today)) };
    });
    return { today, total: totalAll.filter((r) => !r.archivedAt).length, archived: totalAll.filter((r) => r.archivedAt).length, scanned: totalAll.length, capped: totalAll.length >= 500, views: out, canDraft: can(ctx.role, "draft"), signing: signingStatus() };
  },
});

const SORTS = ["updated", "created", "title", "renewal", "effective"] as const;

export const list = companyQuery({
  args: {
    search: v.optional(v.string()),
    view: v.optional(viewValidator),
    category: v.optional(categoryValidator),
    docType: v.optional(v.string()),
    workflow: v.optional(workflowValidator),
    lifecycle: v.optional(v.string()),
    link: v.optional(linkInput),
    archived: v.optional(v.boolean()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    sort: v.optional(v.union(...SORTS.map((s) => v.literal(s)))),
    offset: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const today = todayOf(ctx.company);
    const classes = new Set(readableClasses(ctx.role));
    let candidates: Doc<"agreements">[];
    const text = args.search?.trim();
    if (text) {
      const found = new Map<string, Doc<"agreements">>();
      for (const access of classes) {
        const hits = await ctx.db.query("agreements").withSearchIndex("search_text", (q) => q.search("searchText", text).eq("companyId", ctx.companyId).eq("access", access as AccessClass)).take(60);
        for (const hit of hits) found.set(hit._id, hit);
      }
      candidates = [...found.values()];
    } else if (args.link) {
      const links = await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", ctx.companyId).eq("table", args.link!.table).eq("recordId", args.link!.id)).take(100);
      const rows: Doc<"agreements">[] = [];
      for (const link of links) {
        if (!classes.has(link.access)) continue;
        const row = await ctx.db.get(link.agreementId);
        if (row && row.companyId === ctx.companyId && classes.has(row.access)) rows.push(row);
      }
      candidates = rows;
    } else candidates = await readableRows(ctx);

    const rows = candidates.filter((row) => {
      if (!classes.has(row.access)) return false;
      if ((args.archived ?? false) !== (row.archivedAt !== undefined)) return false;
      if (args.category && row.category !== args.category) return false;
      if (args.docType && row.docType !== args.docType) return false;
      if (args.workflow && row.workflow !== args.workflow) return false;
      if (args.lifecycle && lifecycleStatus(row, today) !== args.lifecycle) return false;
      if (args.view && !matchesView(args.view, row, today, missingFor(row))) return false;
      const date = (row.lifecycle.effectiveOn ?? new Date(row.updatedAt).toISOString().slice(0, 10));
      if (args.from && date < args.from) return false;
      if (args.to && date > args.to) return false;
      return true;
    });
    const sort = args.sort ?? "updated";
    rows.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "created") return b.createdAt - a.createdAt;
      if (sort === "renewal") return (a.lifecycle.renewalOn ?? a.lifecycle.expiresOn ?? "9999").localeCompare(b.lifecycle.renewalOn ?? b.lifecycle.expiresOn ?? "9999");
      if (sort === "effective") return (a.lifecycle.effectiveOn ?? "9999").localeCompare(b.lifecycle.effectiveOn ?? "9999");
      return b.updatedAt - a.updatedAt;
    });
    const limit = Math.min(Math.max(Math.trunc(args.limit ?? 25), 1), 50);
    const offset = Math.max(Math.trunc(args.offset ?? 0), 0);
    return { rows: rows.slice(offset, offset + limit).map((row) => summary(row, today)), total: rows.length, offset, limit, nextOffset: offset + limit < rows.length ? offset + limit : null, capped: !text && !args.link && candidates.length >= 500 };
  },
});

/** Agreements linked to one record the caller is looking at. Seeing the record never grants a document: each is checked on its own class. */
export const forRecord = companyQuery({
  args: { table: v.union(v.literal("customers"), v.literal("properties"), v.literal("cleaners"), v.literal("jobs"), v.literal("applications")), id: v.string() },
  handler: async (ctx, args) => {
    const today = todayOf(ctx.company);
    const classes = new Set(readableClasses(ctx.role));
    const links = await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", ctx.companyId).eq("table", args.table).eq("recordId", args.id)).take(50);
    const rows: ReturnType<typeof summary>[] = [];
    let hidden = 0;
    for (const link of links) {
      const row = await ctx.db.get(link.agreementId);
      if (!row || row.companyId !== ctx.companyId) continue;
      if (!classes.has(row.access)) {
        hidden += 1;
        continue;
      }
      rows.push(summary(row, today));
    }
    // A count of what is hidden is not given: the existence of a restricted document is itself restricted.
    void hidden;
    return rows;
  },
});

// ── One agreement ───────────────────────────────────────────────────────────────────────────────

export const get = companyQuery({
  args: { agreementId: v.string(), version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const type = typeOf(agreement);
    const kit = kitOf(agreement);
    const shown = await versionRow(ctx, agreement, args.version ?? agreement.currentVersion);
    const current = await versionRow(ctx, agreement);
    const versions = await ctx.db.query("agreementVersions").withIndex("by_company_agreement_version", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).order("desc").take(100);
    const links = await ctx.db.query("agreementLinks").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).take(30);
    const comments = await ctx.db.query("agreementComments").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).order("desc").take(100);
    const requests = await ctx.db.query("agreementSignatureRequests").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).order("desc").take(20);
    const files = await ctx.db.query("agreementFiles").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).take(10);
    const members = new Map<string, string>();
    const nameOf = async (id: Id<"members"> | undefined) => {
      if (!id) return null;
      if (!members.has(id)) {
        const m = await ctx.db.get(id);
        members.set(id, m && m.companyId === ctx.companyId ? m.name : "A team member");
      }
      return members.get(id)!;
    };
    const conversation = agreement.conversationId ? await ctx.db.get(agreement.conversationId) : null;
    const ready = await readiness(ctx, agreement);
    const flags = [...new Set(kit.clauses.flatMap((c) => c.flags ?? []))] as never[];
    const state = typeof agreement.terms.governingState === "string" ? agreement.terms.governingState : agreement.governingState;
    const today = todayOf(ctx.company);
    const edited = await hasManualEdits(ctx, agreement);
    const questions = nextQuestions(type, current.terms, agreement.skipped, 3, kit);
    const worker = agreement.parties.find((p) => p.record?.table === "cleaners");
    let engagementMismatch: string | null = null;
    if (worker?.record) {
      const id = ctx.db.normalizeId("cleaners", worker.record.id);
      const cleaner = id ? await ctx.db.get(id) : null;
      const wantsContractor = type.key.includes("contractor") || type.key.includes("subcontractor");
      const wantsEmployee = type.key.startsWith("employ");
      if (cleaner && ((wantsContractor && cleaner.engagement === "employee") || (wantsEmployee && cleaner.engagement === "contractor"))) engagementMismatch = `${cleaner.name} is recorded as a ${cleaner.engagement}, but this document is for a ${wantsContractor ? "contractor" : "employee"}. Selestial does not decide worker status; confirm it before using this document.`;
    }
    return {
      id: agreement._id,
      title: agreement.title,
      docType: agreement.docType,
      typeLabel: type.label,
      readinessLabel: type.readiness,
      note: type.note ?? null,
      category: agreement.category,
      access: agreement.access,
      workflow: agreement.workflow,
      lifecycle: { ...agreement.lifecycle, status: lifecycleStatus(agreement, today) },
      provenance: agreement.provenance,
      externalVerification: agreement.externalVerification ? { ...agreement.externalVerification, verifiedByName: await nameOf(agreement.externalVerification.verifiedBy) } : null,
      origin: agreement.origin,
      currentVersion: agreement.currentVersion,
      approvedVersion: agreement.approvedVersion ?? null,
      approvedBy: await nameOf(agreement.approvedBy),
      approvedAt: agreement.approvedAt ?? null,
      secondApprovedBy: await nameOf(agreement.secondApprovedBy),
      requiresSecondApproval: agreement.requiresSecondApproval === true,
      sentVersion: agreement.sentVersion ?? null,
      signedVersion: agreement.signedVersion ?? null,
      archived: agreement.archivedAt ?? null,
      archiveReason: agreement.archiveReason ?? null,
      supersedes: agreement.supersedes ?? null,
      version: { version: shown.version, hash: shown.hash, markdown: shown.markdown, unresolved: shown.unresolved, note: shown.note ?? null, createdAt: shown.createdAt, author: shown.author.kind },
      isCurrent: shown.version === agreement.currentVersion,
      versions: versions.map((row) => ({ version: row.version, hash: row.hash.slice(0, 12), author: row.author.kind, note: row.note ?? null, createdAt: row.createdAt, unresolved: row.unresolved.length })),
      terms: current.terms,
      sources: agreement.sources,
      skipped: agreement.skipped,
      assumptions: agreement.assumptions,
      parties: agreement.parties,
      governingState: state ?? null,
      sourceTemplate: agreement.sourceTemplate ?? null,
      clauses: current.clauses,
      kitClauses: kit.clauses.map((c) => ({ key: c.key, title: c.title, version: c.version })),
      links: links.map((l) => ({ id: l._id, table: l.table, recordId: l.recordId, label: l.label })),
      comments: await Promise.all(comments.map(async (c) => ({ id: c._id, version: c.version, by: await nameOf(c.memberId), text: c.text, resolved: c.resolvedAt !== undefined, at: c.createdAt }))),
      requests: requests.map((r) => ({ id: r._id, version: r.version, status: r.status, provider: r.provider, signers: r.signers, expiresAt: r.expiresAt, sentAt: r.sentAt ?? null, completedAt: r.completedAt ?? null, withdrawnAt: r.withdrawnAt ?? null, problem: r.problem ?? null, reminders: r.reminders, lastReminderAt: r.lastReminderAt ?? null, hasSignedFile: r.signedFileId !== undefined, evidence: r.evidenceNote ?? null, hashMatchesCurrent: r.hash === current.hash })),
      files: files.map((f) => ({ id: f._id, name: f.name, contentType: f.contentType, size: f.size, extraction: f.extraction, scan: f.scan, createdAt: f.createdAt })),
      conversation: conversation && conversation.shelf !== "deleted" && conversation.createdBy === ctx.member._id ? { id: conversation._id, title: conversation.title } : agreement.conversationId ? { id: null, title: "A private chat" } : null,
      readiness: { ...ready, edited },
      progress: progress(type, current.terms, kit),
      nextQuestions: questions,
      sections: intakeSections(type, current.terms, kit).map((s) => ({ group: s.group, label: s.label, answered: s.answered, total: s.questions.length, questions: s.questions.map((q) => ({ ...q, value: current.terms[q.key] ?? null, source: agreement.sources[q.key] ?? null, skipped: agreement.skipped.includes(q.key) })) })),
      reviewNotes: reviewNotes(flags, state ?? undefined, current.terms),
      legalNotice: LEGAL_NOTICE,
      engagementMismatch,
      capabilities: {
        manageRenewals: can(ctx.role, "manageRenewals"),
        archiveExport: can(ctx.role, "archiveExport"),
        canEdit: mayDraft(ctx.role, agreement.access),
        canApprove: can(ctx.role, "approve") && (agreement.access !== "restricted" || ctx.role === "owner"),
        canSend: can(ctx.role, "send") && (agreement.access !== "restricted" || ctx.role === "owner"),
      },
      entitlements: entitlements(ctx.company),
      signing: signingStatus(),
    };
  },
});

export const compare = companyQuery({
  args: { agreementId: v.string(), from: v.number(), to: v.number() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const [a, b] = [await versionRow(ctx, agreement, args.from), await versionRow(ctx, agreement, args.to)];
    const lines = diffLines(a.markdown, b.markdown);
    return { from: a.version, to: b.version, lines, added: lines.filter((l) => l.kind === "added").length, removed: lines.filter((l) => l.kind === "removed").length };
  },
});

/** The exact text of one version, for download. Recorded in the audit trail; the text itself is not. */
export const exportVersion = companyMutation({
  args: { agreementId: v.string(), version: v.optional(v.number()), format: v.literal("pdf") },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    if (!can(ctx.role, "archiveExport")) throw userError("Your role cannot export agreements.", "not_allowed");
    const row = await versionRow(ctx, agreement, args.version ?? agreement.signedVersion ?? agreement.currentVersion);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.exported", actor: byMember(ctx), subject: { table: "agreements", id: agreement._id }, data: { version: row.version, format: args.format } });
    const status = agreement.workflow === "signed" ? "Signed" : agreement.workflow === "approved" ? "Approved draft" : "Draft";
    return { title: agreement.title, markdown: row.markdown, version: row.version, hash: row.hash, footer: `${agreement.title} | version ${row.version} | ${status} | ${row.hash.slice(0, 12)}`, signedByProvider: agreement.provenance === "provider_signed" };
  },
});

// ── Creating and changing ───────────────────────────────────────────────────────────────────────

export const create = companyMutation({
  args: { docType: v.string(), title: v.optional(v.string()), links: v.optional(v.array(linkInput)), templateId: v.optional(v.string()), terms: v.optional(termsValidator) },
  handler: async (ctx, args) => {
    if (!DOC_TYPE_BY_KEY.has(args.docType)) throw userError("That is not a document type Selestial offers.");
    let kit: ReturnType<typeof kitFor> | undefined;
    let sourceTemplate: Doc<"agreements">["sourceTemplate"];
    if (args.templateId) {
      const template = await loadTemplate(ctx, args.templateId);
      if (template.docType !== args.docType) throw userError("That template is for a different kind of document.");
      const built = await kitFromTemplate(ctx, template);
      kit = built.kit;
      sourceTemplate = { kind: "company", key: template.docType, templateId: template._id, version: built.version };
    }
    return createAgreement(ctx, { docType: args.docType, title: args.title, origin: args.templateId ? "template" : "manual", links: args.links, kit, sourceTemplate, terms: args.terms });
  },
});

export const answer = companyMutation({
  args: { agreementId: v.string(), baseVersion: v.number(), answers: v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))), clear: v.optional(v.array(v.string())), regenerate: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    return recordAnswers(ctx, agreement, { baseVersion: args.baseVersion, answers: args.answers, clear: args.clear, regenerate: args.regenerate });
  },
});

/** A person's own edit of the words. The terms are unchanged, so a later answer that touches this text is held for confirmation. */
export const saveText = companyMutation({
  args: { agreementId: v.string(), baseVersion: v.number(), markdown: v.string(), title: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const current = await versionRow(ctx, agreement);
    return saveVersion(ctx, agreement, { baseVersion: args.baseVersion, markdown: args.markdown, terms: current.terms, title: args.title, note: args.note ?? "Edited by hand" });
  },
});

/** Rebuilds the document from its clauses and answers, discarding hand edits, as a new version that can be compared. */
export const regenerate = companyMutation({
  args: { agreementId: v.string(), baseVersion: v.number() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const current = await versionRow(ctx, agreement);
    const fresh = render(typeOf(agreement), current.terms, { kit: kitOf(agreement), titleOverride: agreement.title });
    return saveVersion(ctx, agreement, { baseVersion: args.baseVersion, markdown: fresh.markdown, terms: current.terms, clauses: fresh.clauses, note: "Regenerated from the clauses and answers" });
  },
});

export const setParties = companyMutation({
  args: { agreementId: v.string(), parties: v.array(partyValidator) },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot edit this document.", "not_allowed");
    if (!["draft", "needs_review", "approved", "withdrawn", "declined", "expired", "delivery_failed"].includes(agreement.workflow)) throw userError("Signers cannot change while the document is out for signature or signed.");
    if (args.parties.length > 10) throw userError("A document can have up to 10 parties.");
    for (const party of args.parties) if (!party.name.trim()) throw userError("Each party needs a name.");
    const changedSigners = JSON.stringify(agreement.parties.filter((p) => p.signer).map((p) => [p.name, p.email, p.order])) !== JSON.stringify(args.parties.filter((p) => p.signer).map((p) => [p.name, p.email, p.order]));
    await ctx.db.patch(agreement._id, { parties: args.parties.map((p) => ({ ...p, name: p.name.trim().slice(0, 160), email: p.email?.trim().toLowerCase() || undefined })), updatedAt: Date.now(), ...(changedSigners && agreement.workflow === "approved" ? { workflow: "draft" as const, approvedVersion: undefined, approvedHash: undefined, approvedBy: undefined, approvedAt: undefined } : {}) });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.parties_changed", actor: byMember(ctx), subject: { table: "agreements", id: agreement._id }, data: { signers: args.parties.filter((p) => p.signer).length } });
    return null;
  },
});

export const skipTerm = companyMutation({
  args: { agreementId: v.string(), key: v.string(), skipped: v.boolean() },
  handler: async (ctx, args) => {
    await setSkipped(ctx, await load(ctx, args.agreementId), args.key, args.skipped);
    return null;
  },
});

export const assume = companyMutation({
  args: { agreementId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    await confirmAssumption(ctx, await load(ctx, args.agreementId), args.text);
    return null;
  },
});

export const submitForReview = companyMutation({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    await requestReview(ctx, await load(ctx, args.agreementId));
    return null;
  },
});

export const approveVersion = companyMutation({
  args: { agreementId: v.string(), version: v.number(), hash: v.string(), acknowledgeSkipped: v.optional(v.boolean()) },
  handler: async (ctx, args) => approve(ctx, await load(ctx, args.agreementId), { version: args.version, hash: args.hash, acknowledgeSkipped: args.acknowledgeSkipped }),
});

export const unapprove = companyMutation({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    await withdrawApproval(ctx, await load(ctx, args.agreementId));
    return null;
  },
});

/** Scale: a second, different person must approve before a document counts as approved. */
export const setSecondApproval = companyMutation({
  args: { agreementId: v.string(), required: v.boolean() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    if (!can(ctx.role, "approve")) throw userError("Your role cannot change approval routing.", "not_allowed");
    requireScale(ctx.company, "advanced_approval");
    if (agreement.workflow !== "draft" && agreement.workflow !== "needs_review") throw userError("Routing can change only while the document is a draft or in review.");
    await ctx.db.patch(agreement._id, { requiresSecondApproval: args.required, approvedVersion: undefined, approvedHash: undefined, approvedBy: undefined, secondApprovedBy: undefined, workflow: "draft", updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.routing_changed", actor: byMember(ctx), subject: { table: "agreements", id: agreement._id }, data: { secondApproval: args.required } });
    return null;
  },
});

export const changeLifecycle = companyMutation({
  args: { agreementId: v.string(), effectiveOn: v.optional(v.string()), renewalOn: v.optional(v.string()), expiresOn: v.optional(v.string()), terminatedOn: v.optional(v.string()), terminationNote: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { agreementId, ...change } = args;
    await setLifecycle(ctx, await load(ctx, agreementId), change);
    return null;
  },
});

export const archiveAgreement = companyMutation({
  args: { agreementId: v.string(), reason: v.string() },
  handler: async (ctx, args) => {
    await archive(ctx, await load(ctx, args.agreementId), args.reason);
    return null;
  },
});

export const restoreAgreement = companyMutation({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    await unarchive(ctx, await load(ctx, args.agreementId));
    return null;
  },
});

export const amend = companyMutation({
  args: { agreementId: v.string(), kind: v.union(v.literal("amendment"), v.literal("replacement")), note: v.optional(v.string()) },
  handler: async (ctx, args) => createAmendment(ctx, await load(ctx, args.agreementId), { kind: args.kind, note: args.note }),
});

export const linkRecord = companyMutation({
  args: { agreementId: v.string(), link: linkInput },
  handler: async (ctx, args) => {
    await addLink(ctx, await load(ctx, args.agreementId), args.link);
    return null;
  },
});

export const unlinkRecord = companyMutation({
  args: { agreementId: v.string(), linkId: v.id("agreementLinks") },
  handler: async (ctx, args) => {
    await removeLink(ctx, await load(ctx, args.agreementId), args.linkId);
    return null;
  },
});

export const comment = companyMutation({
  args: { agreementId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const text = args.text.trim();
    if (!text || text.length > 2000) throw userError("A comment is 1 to 2,000 characters.");
    await ctx.db.insert("agreementComments", { companyId: ctx.companyId, agreementId: agreement._id, version: agreement.currentVersion, memberId: ctx.member._id, text, createdAt: Date.now() });
    // The audit trail records that a comment was made, never its words.
    await recordEvent(ctx, { companyId: ctx.companyId, type: "agreement.commented", actor: byMember(ctx), subject: { table: "agreements", id: agreement._id }, data: { version: agreement.currentVersion } });
    return null;
  },
});

export const resolveComment = companyMutation({
  args: { agreementId: v.string(), commentId: v.id("agreementComments"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const row = await ctx.db.get(args.commentId);
    if (!row || row.companyId !== ctx.companyId || row.agreementId !== agreement._id) throw userError("Not found.", "not_found");
    await ctx.db.patch(row._id, { resolvedAt: args.resolved ? Date.now() : undefined });
    return null;
  },
});

const EVENT_WORDS: Record<string, string> = {
  "agreement.created": "created the agreement",
  "agreement.revised": "saved a new version",
  "agreement.review_requested": "sent it for review",
  "agreement.approved": "approved the version",
  "agreement.first_approval": "gave the first approval",
  "agreement.approval_withdrawn": "withdrew the approval",
  "agreement.routing_changed": "changed approval routing",
  "agreement.signature_requested": "sent it for signature",
  "agreement.delivery_failed": "could not deliver it for signature",
  "agreement.partially_signed": "recorded a partial signature",
  "agreement.signed": "recorded every required signature",
  "agreement.declined": "recorded that a signer declined",
  "agreement.withdrawn": "withdrew the signature request",
  "agreement.signing_expired": "closed the signature request: it expired",
  "agreement.reminder_sent": "sent a reminder to signers",
  "agreement.signed_copy_stored": "stored the completed document from the signing service",
  "agreement.signed_copy_failed": "could not retrieve the completed document",
  "agreement.signed_copy_downloaded": "downloaded the signed document",
  "agreement.exported": "exported a version",
  "agreement.external_signature_verified": "verified a document signed elsewhere",
  "agreement.parties_changed": "changed the parties",
  "agreement.lifecycle_changed": "changed its dates",
  "agreement.archived": "archived it",
  "agreement.restored": "restored it from the archive",
  "agreement.amendment_started": "started an amendment or replacement",
  "agreement.commented": "added a review note",
  "agreement.renewal_reminder": "opened a renewal reminder task",
  "agreement_file.added": "added a file",
  "agreement_file.downloaded": "downloaded the original file",
};

/** What happened to one agreement, in words. Facts only: never the document's text or a comment's words. */
export const activity = companyQuery({
  args: { agreementId: v.string() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const ids = [agreement._id as string];
    const requests = await ctx.db.query("agreementSignatureRequests").withIndex("by_company_agreement", (q) => q.eq("companyId", ctx.companyId).eq("agreementId", agreement._id)).take(20);
    for (const r of requests) ids.push(r._id);
    if (agreement.originalFileId) ids.push(agreement.originalFileId);
    const rows: Doc<"events">[] = [];
    for (const id of ids) rows.push(...(await ctx.db.query("events").withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", id)).order("desc").take(100)));
    rows.sort((a, b) => b.at - a.at);
    const names = new Map<string, string>();
    const out = [];
    for (const row of rows.slice(0, 150)) {
      let who = "Selestial";
      if (row.actor.kind === "member") {
        const id = row.actor.memberId;
        if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "A team member");
        who = names.get(id)!;
      }
      out.push({ id: row._id, at: row.at, who, text: EVENT_WORDS[row.type] ?? row.type.replace(/[._]/g, " "), version: typeof row.data?.version === "number" ? row.data.version : null });
    }
    return out;
  },
});

/** Ties an agreement to a chat the member started about it, so "Open the chat" finds it. Only the member's own chat, only if none is tied yet. */
export const adoptConversation = companyMutation({
  args: { agreementId: v.string(), conversationId: v.string() },
  handler: async (ctx, args) => {
    const agreement = await load(ctx, args.agreementId);
    const id = ctx.db.normalizeId("conversations", args.conversationId);
    const conversation = id ? await ctx.db.get(id) : null;
    if (!conversation || conversation.companyId !== ctx.companyId || conversation.createdBy !== ctx.member._id) throw userError("Not found.", "not_found");
    if (agreement.conversationId) return null;
    await ctx.db.patch(agreement._id, { conversationId: conversation._id });
    return null;
  },
});
