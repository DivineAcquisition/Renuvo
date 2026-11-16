/**
 * The one place agreements are created and changed. Public functions (companyAgreements.ts) and Company
 * Chat's tools both call these, so the same checks, the same version rules and the same audit trail apply
 * whoever asks. Callers check the member's capability first; everything here checks the record's company
 * and the state rules.
 *
 * Rules kept here:
 *  - a version is never edited: a change is a new version, and a version has a hash;
 *  - approval names a version and its hash; a new version after approval clears it;
 *  - a document out for signature, or signed, is never edited: withdraw it, or amend it;
 *  - a change to an answer on text a person edited by hand is shown, not applied silently;
 *  - lifecycle (in force, renewing, ended) is separate from workflow (draft, sent, signed).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { notFound, userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { readProfile } from "../compliance/profile";
import type { Role } from "../roles";
import { can, mayDraft, mayRead } from "./access";
import { docType, DOC_TYPE_BY_KEY, type DocType } from "./catalog";
import { affectedClauses, contentHash, defOf, isIsoDate, kitFor, missingRequired, render, unresolvedOf, validate, type Kit } from "./compose";
import { coerce } from "./intake";
import { addMonths } from "./compose";
import { isAnswered, type Terms, type TermValue } from "./variables";
import type { Lifecycle, Party } from "./schema";

export type Ctx = MutationCtx & { company: Doc<"companies">; member: Doc<"members">; role: Role };
export type ReadCtx = QueryCtx & { company: Doc<"companies">; member: Doc<"members">; role: Role };

export type Author = { kind: "member"; memberId: Id<"members"> } | { kind: "assistant"; runId: Id<"chatRuns"> } | { kind: "system" };

const actorOf = (ctx: Ctx): Actor => ({ kind: "member", memberId: ctx.member._id });
const authorOf = (ctx: Ctx, author?: Author): Author => author ?? { kind: "member", memberId: ctx.member._id };

export function typeOf(agreement: Pick<Doc<"agreements">, "docType">): DocType {
  const found = DOC_TYPE_BY_KEY.get(agreement.docType);
  if (!found) throw userError("This document's type is no longer in the catalog.");
  return found;
}

export const kitOf = (agreement: Doc<"agreements">): Kit => ({ clauses: agreement.kit.clauses.map((c) => ({ ...c, flags: c.flags as never })), extra: agreement.kit.extra });

/** The agreement, if the member may read it. Anything else is "Not found.". */
export async function load(ctx: ReadCtx | Ctx, agreementId: string): Promise<Doc<"agreements">> {
  const id = ctx.db.normalizeId("agreements", agreementId);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.companyId !== ctx.company._id || !mayRead(ctx.role, row.access)) notFound();
  return row;
}

export async function versionRow(ctx: ReadCtx | Ctx, agreement: Doc<"agreements">, version = agreement.currentVersion): Promise<Doc<"agreementVersions">> {
  const row = await ctx.db
    .query("agreementVersions")
    .withIndex("by_company_agreement_version", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id).eq("version", version))
    .unique();
  if (!row) notFound();
  return row;
}

function searchTextOf(agreement: { title: string; docType: string; parties: Party[] }, linkLabels: string[]): string {
  const type = DOC_TYPE_BY_KEY.get(agreement.docType);
  return [agreement.title, type?.label ?? "", type?.family ?? "", ...agreement.parties.map((p) => p.name), ...linkLabels].join(" ").slice(0, 1500);
}

async function linkLabels(ctx: ReadCtx | Ctx, agreement: { _id: Id<"agreements">; companyId: Id<"companies"> }): Promise<string[]> {
  const rows = await ctx.db.query("agreementLinks").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).take(30);
  return rows.map((row) => row.label);
}

async function reindex(ctx: Ctx, agreement: Doc<"agreements">) {
  await ctx.db.patch(agreement._id, { searchText: searchTextOf(agreement, await linkLabels(ctx, agreement)) });
}

// ── Prefill from company records ────────────────────────────────────────────────────────────────

export type LinkInput = { table: "customers" | "properties" | "cleaners" | "jobs" | "applications"; id: string };

/** Facts the company already has, with where each came from. Only records this company owns are read. */
export async function prefill(ctx: Ctx | ReadCtx, links: LinkInput[]): Promise<{ terms: Terms; sources: Record<string, string>; parties: Party[]; labels: { table: LinkInput["table"]; id: string; label: string }[]; state?: string }> {
  const terms: Terms = {};
  const sources: Record<string, string> = {};
  const parties: Party[] = [];
  const labels: { table: LinkInput["table"]; id: string; label: string }[] = [];
  const profile = await readProfile(ctx, ctx.company._id);
  const legal = profile.identity.legalName?.trim() || ctx.company.name;
  terms.companyName = legal;
  sources.companyName = profile.identity.legalName ? "Trust & compliance: legal name" : "Company name";
  let state: string | undefined = profile.identity.address?.region?.trim().toUpperCase();
  if (state && /^[A-Z]{2}$/.test(state)) {
    terms.governingState = state;
    sources.governingState = "Trust & compliance: business address";
  } else state = undefined;
  const rep = profile.identity.representative;
  if (rep?.name) {
    terms.companySigner = `${rep.name}, ${rep.title}`;
    sources.companySigner = "Trust & compliance: authorized representative";
    parties.push({ role: "company", name: legal, email: rep.email, signer: true, order: 1 });
  } else parties.push({ role: "company", name: legal, signer: true, order: 1 });

  for (const link of links) {
    if (link.table === "customers") {
      const id = ctx.db.normalizeId("customers", link.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.companyId !== ctx.company._id) throw userError("That customer is not in this company.");
      terms.counterpartyName = row.name;
      terms.counterpartySigner = row.name;
      sources.counterpartyName = `Customer record: ${row.name}`;
      sources.counterpartySigner = `Customer record: ${row.name}`;
      parties.push({ role: "customer", name: row.name, email: row.email, signer: true, order: 2, record: { table: "customers", id: row._id } });
      labels.push({ table: "customers", id: row._id, label: row.name });
    } else if (link.table === "properties") {
      const id = ctx.db.normalizeId("properties", link.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.companyId !== ctx.company._id) throw userError("That property is not in this company.");
      const a = row.address;
      terms.serviceAddress = `${a.line1}${a.line2 ? `, ${a.line2}` : ""}, ${a.city}, ${a.region} ${a.postalCode}`;
      sources.serviceAddress = `Property record: ${row.label ?? a.line1}`;
      if (row.accessInstructions) {
        terms.accessMethod = row.accessInstructions;
        sources.accessMethod = "Property record: access instructions";
      }
      const kind = row.kind === "home" ? "home" : undefined;
      if (kind) terms.propertyType = kind;
      if (!terms.governingState && /^[A-Za-z]{2}$/.test(a.region)) {
        terms.governingState = a.region.toUpperCase();
        sources.governingState = "Property record: state";
        state = a.region.toUpperCase();
      }
      labels.push({ table: "properties", id: row._id, label: row.label ?? a.line1 });
    } else if (link.table === "cleaners") {
      const id = ctx.db.normalizeId("cleaners", link.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.companyId !== ctx.company._id) throw userError("That worker is not in this company.");
      terms.workerName = row.name;
      sources.workerName = `Cleaner record: ${row.name}`;
      parties.push({ role: "worker", name: row.name, email: row.email, signer: true, order: 2, record: { table: "cleaners", id: row._id } });
      labels.push({ table: "cleaners", id: row._id, label: row.name });
      // Pay is never copied: it is the Owner's to state, in the document, on purpose.
    } else if (link.table === "jobs") {
      const id = ctx.db.normalizeId("jobs", link.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.companyId !== ctx.company._id) throw userError("That visit is not in this company.");
      labels.push({ table: "jobs", id: row._id, label: `${row.serviceType} visit` });
    } else {
      const id = ctx.db.normalizeId("applications", link.id);
      const row = id ? await ctx.db.get(id) : null;
      if (!row || row.companyId !== ctx.company._id) throw userError("That application is not in this company.");
      const applicant = await ctx.db.get(row.applicantId);
      const applicantName = applicant?.name?.trim();
      if (applicant && applicantName) {
        terms.workerName = applicantName;
        sources.workerName = `Applicant record: ${applicantName}`;
        parties.push({ role: "worker", name: applicantName, email: applicant.email, signer: true, order: 2, record: { table: "applications", id: row._id } });
        labels.push({ table: "applications", id: row._id, label: applicantName });
      }
    }
  }
  return { terms, sources, parties, labels, state };
}

// ── Creating ────────────────────────────────────────────────────────────────────────────────────

export type NewAgreement = {
  docType: string;
  title?: string;
  origin: Doc<"agreements">["origin"];
  links?: LinkInput[];
  conversationId?: Id<"conversations">;
  kit?: Kit;
  sourceTemplate?: Doc<"agreements">["sourceTemplate"];
  terms?: Terms;
  author?: Author;
  supersedes?: Id<"agreements">;
  note?: string;
};

export async function createAgreement(ctx: Ctx, input: NewAgreement): Promise<Id<"agreements">> {
  const type = docType(input.docType);
  if (!mayDraft(ctx.role, type.access)) throw userError(type.access === "restricted" ? "Only the Owner can draft this kind of document." : "Your role cannot draft this kind of document.", "not_allowed");
  const links = input.links ?? [];
  const known = await prefill(ctx, links);
  const terms: Terms = { ...known.terms, ...(input.terms ?? {}) };
  const kit = input.kit ?? kitFor(type);
  const rendered = render(type, terms, { kit, titleOverride: input.title });
  const now = Date.now();
  const title = (input.title?.trim() || type.label).slice(0, 160);
  const agreementId = await ctx.db.insert("agreements", {
    companyId: ctx.company._id,
    title,
    docType: type.key,
    category: type.category,
    access: type.access,
    workflow: "draft",
    lifecycle: {},
    currentVersion: 1,
    terms,
    skipped: [],
    assumptions: [],
    sources: known.sources,
    parties: known.parties,
    governingState: typeof terms.governingState === "string" ? terms.governingState : known.state,
    kit: { clauses: kit.clauses.map((c) => ({ key: c.key, version: c.version, title: c.title, body: c.body, flags: c.flags ? [...c.flags] : undefined, when: c.when, unless: c.unless })), extra: kit.extra?.map((e) => ({ key: e.key, label: e.label, type: e.type, group: e.group, ask: e.ask, choices: e.choices ? [...e.choices] : undefined })) },
    sourceTemplate: input.sourceTemplate ?? { kind: "catalog", key: type.key },
    conversationId: input.conversationId,
    origin: input.origin,
    provenance: "unsigned",
    supersedes: input.supersedes,
    searchText: "",
    createdBy: ctx.member._id,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert("agreementVersions", { companyId: ctx.company._id, agreementId, version: 1, title, markdown: rendered.markdown, hash: contentHash(rendered.markdown), clauses: rendered.clauses, terms, unresolved: rendered.unresolved, author: authorOf(ctx, input.author), note: input.note ?? "First draft", createdAt: now });
  for (const label of known.labels) await ctx.db.insert("agreementLinks", { companyId: ctx.company._id, agreementId, table: label.table, recordId: label.id, label: label.label, access: type.access });
  const created = (await ctx.db.get(agreementId))!;
  await reindex(ctx, created);
  await recordEvent(ctx, { companyId: ctx.company._id, type: "agreement.created", actor: actorOf(ctx), subject: { table: "agreements", id: agreementId }, data: { docType: type.key, origin: input.origin } });
  return agreementId;
}

// ── Changing ────────────────────────────────────────────────────────────────────────────────────

/** Why a document cannot be edited, or null. */
export function lockedWhy(agreement: Doc<"agreements">): string | null {
  if (agreement.archivedAt) return "This agreement is archived. Restore it first.";
  if (agreement.workflow === "sent" || agreement.workflow === "partially_signed") return "This version is out for signature. Withdraw the request first, or wait for the signers.";
  if (agreement.workflow === "signed") return "A signed agreement is never edited. Create an amendment or a replacement instead.";
  return null;
}

type SaveInput = { baseVersion: number; markdown: string; terms: Terms; clauses?: { key: string; version: number }[]; title?: string; note?: string; author?: Author; parties?: Party[] };

/** Saves the next immutable version. An approval of an earlier version no longer stands. */
export async function saveVersion(ctx: Ctx, agreement: Doc<"agreements">, input: SaveInput): Promise<{ version: number; changed: boolean; reopened: boolean }> {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot edit this document.", "not_allowed");
  const locked = lockedWhy(agreement);
  if (locked) throw userError(locked);
  if (input.baseVersion !== agreement.currentVersion) throw userError(`This agreement changed since version ${input.baseVersion}; it is now at version ${agreement.currentVersion}. Open the latest version and revise that.`);
  const markdown = input.markdown.replace(/\r\n/g, "\n");
  if (!markdown.trim()) throw userError("The document is empty.");
  if (markdown.length > 200_000) throw userError("The document is too long to save.");
  const current = await versionRow(ctx, agreement);
  const title = input.title?.trim() ? input.title.trim().slice(0, 160) : agreement.title;
  if (current.markdown === markdown && title === agreement.title && JSON.stringify(current.terms) === JSON.stringify(input.terms)) return { version: current.version, changed: false, reopened: false };
  const next = agreement.currentVersion + 1;
  const now = Date.now();
  await ctx.db.insert("agreementVersions", { companyId: agreement.companyId, agreementId: agreement._id, version: next, title, markdown, hash: contentHash(markdown), clauses: input.clauses ?? current.clauses, terms: input.terms, unresolved: unresolvedOf(markdown), author: authorOf(ctx, input.author), note: input.note?.trim().slice(0, 300) || undefined, createdAt: now });
  const reopened = agreement.workflow === "approved" || agreement.workflow === "needs_review" || agreement.approvedVersion !== undefined;
  await ctx.db.patch(agreement._id, {
    currentVersion: next,
    title,
    terms: input.terms,
    ...(input.parties ? { parties: input.parties } : {}),
    updatedAt: now,
    ...(reopened || agreement.workflow === "delivery_failed" || agreement.workflow === "declined" || agreement.workflow === "withdrawn" || agreement.workflow === "expired" ? { workflow: "draft" as const, approvedVersion: undefined, approvedHash: undefined, approvedBy: undefined, approvedAt: undefined, secondApprovedBy: undefined, reviewRequestedBy: undefined } : {}),
  });
  await reindex(ctx, (await ctx.db.get(agreement._id))!);
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.revised", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id }, data: { version: next, reopened } });
  return { version: next, changed: true, reopened };
}

/** True when the saved text is not what the clauses and answers would produce: a person edited it. */
export async function hasManualEdits(ctx: Ctx | ReadCtx, agreement: Doc<"agreements">): Promise<boolean> {
  const current = await versionRow(ctx, agreement);
  const fresh = render(typeOf(agreement), current.terms, { kit: kitOf(agreement), titleOverride: current.title });
  return fresh.markdown !== current.markdown;
}

export type AnswerResult =
  | { ok: true; version: number; changed: boolean; reopened: boolean; errors: string[]; warnings: string[]; accepted: string[]; affected: { key: string; title: string; changed: string[] }[] }
  | { ok: false; reason: "edited"; affected: { key: string; title: string; changed: string[] }[]; message: string }
  | { ok: false; reason: "invalid"; errors: string[]; message: string };

/**
 * Records answers (typed values or the words a person gave), re-renders the document and saves a new
 * version. A change that would rewrite text a person edited by hand is held until the caller says to
 * regenerate, and lists the clauses it would touch.
 */
export async function recordAnswers(ctx: Ctx, agreement: Doc<"agreements">, input: { baseVersion: number; answers: Record<string, unknown>; regenerate?: boolean; author?: Author; note?: string; clear?: string[] }): Promise<AnswerResult> {
  const type = typeOf(agreement);
  const kit = kitOf(agreement);
  const next: Terms = { ...agreement.terms };
  const accepted: string[] = [];
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(input.answers)) {
    const def = defOf(kit, key);
    if (!def) {
      errors.push(`"${key}" is not a question for this document.`);
      continue;
    }
    const done = coerce(def, raw);
    if (!done.ok) errors.push(done.why);
    else {
      next[key] = done.value;
      accepted.push(key);
    }
  }
  for (const key of input.clear ?? []) delete next[key];
  const check = validate(type, next, kit);
  // An error found in the whole set is reported against the answers just given.
  const blocking = [...errors, ...check.errors.filter((issue) => !issue.field || accepted.includes(issue.field) || input.clear?.includes(issue.field)).map((issue) => issue.message)];
  if (blocking.length) return { ok: false, reason: "invalid", errors: blocking, message: blocking.join(" ") };
  const affected = affectedClauses(type, agreement.terms, next, kit);
  if (!input.regenerate && (await hasManualEdits(ctx, agreement)) && affected.length) {
    return { ok: false, reason: "edited", affected, message: `Someone edited this text by hand. ${affected.map((c) => c.title).join(", ")} would be rewritten. Review and confirm to regenerate those clauses.` };
  }
  const rendered = render(type, next, { kit, titleOverride: agreement.title });
  const parties = syncParties(agreement.parties, next);
  const skipped = agreement.skipped.filter((key) => !accepted.includes(key));
  const saved = await saveVersion(ctx, agreement, { baseVersion: input.baseVersion, markdown: rendered.markdown, terms: next, clauses: rendered.clauses, note: input.note ?? (affected.length ? `Changed: ${affected.map((c) => c.title).join(", ")}` : "Answers recorded"), author: input.author, parties });
  const patch: Partial<Doc<"agreements">> = { skipped };
  if (typeof next.governingState === "string") patch.governingState = next.governingState;
  if (accepted.includes("startDate") && typeof next.startDate === "string") patch.lifecycle = { ...agreement.lifecycle, ...dates(next) };
  else if (accepted.some((key) => key === "termMonths" || key === "autoRenew")) patch.lifecycle = { ...agreement.lifecycle, ...dates(next) };
  await ctx.db.patch(agreement._id, patch);
  return { ok: true, ...saved, errors: [], warnings: check.warnings.map((w) => w.message), accepted, affected };
}

function syncParties(parties: Party[], terms: Terms): Party[] {
  return parties.map((party) => {
    if (party.role === "company" && typeof terms.companyName === "string") return { ...party, name: terms.companyName };
    if (party.role === "customer" && typeof terms.counterpartyName === "string") return { ...party, name: terms.counterpartyName };
    if (party.role === "worker" && typeof terms.workerName === "string") return { ...party, name: terms.workerName };
    return party;
  });
}

/** Lifecycle dates implied by the answers. The renewal date is a date to be reminded on, never a renewal. */
export function dates(terms: Terms): Partial<Lifecycle> {
  const out: Partial<Lifecycle> = {};
  const start = terms.startDate ?? terms.engagementStart;
  if (typeof start === "string" && isIsoDate(start)) {
    out.effectiveOn = start;
    if (typeof terms.termMonths === "number" && terms.termMonths > 0) {
      out.termMonths = terms.termMonths;
      const end = addMonths(start, terms.termMonths);
      out.expiresOn = end;
      // The date to be reminded to decide on renewal. It is a reminder date; nothing renews on it.
      out.renewalOn = end;
    }
  }
  return out;
}

/** Marks a term as genuinely unresolved, for review, without blocking the draft. */
export async function setSkipped(ctx: Ctx, agreement: Doc<"agreements">, key: string, skipped: boolean) {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot edit this document.", "not_allowed");
  if (!defOf(kitOf(agreement), key)) throw userError("That is not a question for this document.");
  const set = new Set(agreement.skipped);
  if (skipped) set.add(key);
  else set.delete(key);
  await ctx.db.patch(agreement._id, { skipped: [...set], updatedAt: Date.now() });
}

/** The owner confirms a material assumption, so it is on the record with who and when. */
export async function confirmAssumption(ctx: Ctx, agreement: Doc<"agreements">, text: string) {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot edit this document.", "not_allowed");
  const clean = text.trim().slice(0, 500);
  if (!clean) throw userError("The assumption is empty.");
  if (agreement.assumptions.some((a) => a.text === clean)) return;
  await ctx.db.patch(agreement._id, { assumptions: [...agreement.assumptions, { text: clean, confirmedBy: ctx.member._id, at: Date.now() }].slice(-30), updatedAt: Date.now() });
}

// ── Review and approval ─────────────────────────────────────────────────────────────────────────

export type Readiness = { errors: string[]; warnings: string[]; missing: string[]; unresolved: string[]; skipped: string[] };

export async function readiness(ctx: Ctx | ReadCtx, agreement: Doc<"agreements">): Promise<Readiness> {
  const type = typeOf(agreement);
  const kit = kitOf(agreement);
  const current = await versionRow(ctx, agreement);
  const check = validate(type, current.terms, kit);
  const missing = agreement.origin === "upload" ? [] : missingRequired(type, current.terms, kit).filter((key) => !agreement.skipped.includes(key));
  return { errors: check.errors.map((i) => i.message), warnings: check.warnings.map((i) => i.message), missing, unresolved: unresolvedOf(current.markdown), skipped: agreement.skipped };
}

export async function requestReview(ctx: Ctx, agreement: Doc<"agreements">) {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot do this.", "not_allowed");
  if (agreement.workflow !== "draft") throw userError(`Only a draft can be sent for review. This one is ${agreement.workflow.replace(/_/g, " ")}.`);
  await ctx.db.patch(agreement._id, { workflow: "needs_review", reviewRequestedBy: ctx.member._id, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.review_requested", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id }, data: { version: agreement.currentVersion } });
}

/**
 * A person approves exactly the version they were looking at. Open questions that are required, and
 * errors in the answers, stop approval; text marked TO CONFIRM stops sending, not approval, so a draft
 * can be agreed in principle while the last details are settled.
 */
export async function approve(ctx: Ctx, agreement: Doc<"agreements">, input: { version: number; hash: string; acknowledgeSkipped?: boolean }) {
  if (!can(ctx.role, "approve") || (agreement.access === "restricted" && ctx.role !== "owner") || !mayRead(ctx.role, agreement.access)) throw userError("Your role cannot approve this document.", "not_allowed");
  if (agreement.workflow !== "draft" && agreement.workflow !== "needs_review") throw userError(`This agreement is ${agreement.workflow.replace(/_/g, " ")}; only a draft or a document in review can be approved.`);
  if (input.version !== agreement.currentVersion) throw userError(`That is version ${input.version}, but the agreement is at version ${agreement.currentVersion}. Review the latest version.`);
  const current = await versionRow(ctx, agreement);
  if (input.hash !== current.hash) throw userError("The text is not what you reviewed. Open it again.");
  const ready = await readiness(ctx, agreement);
  if (ready.errors.length) throw userError(`Fix before approving: ${ready.errors.join(" ")}`);
  if (ready.missing.length) throw userError(`Still needed before approval: ${ready.missing.map((key) => defOf(kitOf(agreement), key)?.label ?? key).join(", ")}.`);
  if (agreement.skipped.length && !input.acknowledgeSkipped) throw userError(`${agreement.skipped.length} term${agreement.skipped.length === 1 ? " was" : "s were"} left unresolved on purpose. Confirm you are approving with those open.`);
  const second = agreement.requiresSecondApproval === true;
  const first = agreement.approvedBy === undefined || agreement.approvedVersion !== current.version;
  if (second && !first && agreement.approvedBy === ctx.member._id) throw userError("This document needs a second, different person to approve it.");
  const complete = !second || !first;
  await ctx.db.patch(agreement._id, {
    workflow: complete ? "approved" : "needs_review",
    approvedVersion: current.version,
    approvedHash: current.hash,
    approvedBy: first ? ctx.member._id : agreement.approvedBy,
    approvedAt: Date.now(),
    secondApprovedBy: !first && second ? ctx.member._id : undefined,
    updatedAt: Date.now(),
  });
  await recordEvent(ctx, { companyId: agreement.companyId, type: complete ? "agreement.approved" : "agreement.first_approval", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id }, data: { version: current.version } });
  return { complete };
}

export async function withdrawApproval(ctx: Ctx, agreement: Doc<"agreements">) {
  if (!can(ctx.role, "approve")) throw userError("Your role cannot do this.", "not_allowed");
  if (agreement.workflow !== "approved" && agreement.workflow !== "needs_review") throw userError("There is no approval to withdraw.");
  await ctx.db.patch(agreement._id, { workflow: "draft", approvedVersion: undefined, approvedHash: undefined, approvedBy: undefined, approvedAt: undefined, secondApprovedBy: undefined, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.approval_withdrawn", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id } });
}

// ── Lifecycle, archive, amend ───────────────────────────────────────────────────────────────────

export type LifecycleStatus = "not_started" | "in_force" | "renewal_due" | "expired" | "terminated" | "superseded" | "none";

/** Whether the agreement is in force, on the company's calendar. Independent of workflow. */
export function lifecycleStatus(agreement: Pick<Doc<"agreements">, "lifecycle" | "workflow" | "provenance">, today: string, windowDays = 60): LifecycleStatus {
  const l = agreement.lifecycle;
  if (l.supersededBy) return "superseded";
  if (l.terminatedOn && l.terminatedOn <= today) return "terminated";
  if (agreement.workflow !== "signed" && agreement.provenance === "unsigned") return "none";
  if (!l.effectiveOn) return "in_force";
  if (l.effectiveOn > today) return "not_started";
  if (l.expiresOn && l.expiresOn < today) return "expired";
  if (l.renewalOn || l.expiresOn) {
    const target = l.renewalOn ?? l.expiresOn!;
    const soon = addDays(today, windowDays);
    if (target <= soon) return "renewal_due";
  }
  return "in_force";
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function setLifecycle(ctx: Ctx, agreement: Doc<"agreements">, change: Partial<Pick<Lifecycle, "effectiveOn" | "renewalOn" | "expiresOn" | "terminatedOn" | "terminationNote">>) {
  if (!can(ctx.role, "manageRenewals") || !mayRead(ctx.role, agreement.access)) throw userError("Your role cannot manage dates on this agreement.", "not_allowed");
  for (const [key, value] of Object.entries(change)) if (value !== undefined && key !== "terminationNote" && !isIsoDate(value)) throw userError(`${key} must be a real date (YYYY-MM-DD).`);
  const next = { ...agreement.lifecycle, ...change };
  if (next.effectiveOn && next.expiresOn && next.expiresOn < next.effectiveOn) throw userError("The agreement cannot expire before it takes effect.");
  if (next.terminatedOn && next.effectiveOn && next.terminatedOn < next.effectiveOn) throw userError("The agreement cannot end before it takes effect.");
  await ctx.db.patch(agreement._id, { lifecycle: next, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.lifecycle_changed", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id }, data: { fields: Object.keys(change).join(",") } });
}

export async function archive(ctx: Ctx, agreement: Doc<"agreements">, reason: string) {
  if (!can(ctx.role, "archiveExport") || !mayRead(ctx.role, agreement.access)) throw userError("Your role cannot archive this document.", "not_allowed");
  if (agreement.workflow === "sent" || agreement.workflow === "partially_signed") throw userError("Withdraw the signature request before archiving.");
  await ctx.db.patch(agreement._id, { archivedAt: Date.now(), archiveReason: reason.trim().slice(0, 300) || "Archived", updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.archived", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id } });
}

export async function unarchive(ctx: Ctx, agreement: Doc<"agreements">) {
  if (!can(ctx.role, "archiveExport") || !mayRead(ctx.role, agreement.access)) throw userError("Your role cannot restore this document.", "not_allowed");
  await ctx.db.patch(agreement._id, { archivedAt: undefined, archiveReason: undefined, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.restored", actor: actorOf(ctx), subject: { table: "agreements", id: agreement._id } });
}

/** A signed or sent agreement is changed by a new draft that points back at it, never by editing it. */
export async function createAmendment(ctx: Ctx, agreement: Doc<"agreements">, input: { kind: "amendment" | "replacement"; note?: string }): Promise<Id<"agreements">> {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot draft this kind of document.", "not_allowed");
  const current = await versionRow(ctx, agreement, agreement.signedVersion ?? agreement.currentVersion);
  const type = typeOf(agreement);
  const links = await ctx.db.query("agreementLinks").withIndex("by_company_agreement", (q) => q.eq("companyId", agreement.companyId).eq("agreementId", agreement._id)).take(30);
  const id = await ctx.db.insert("agreements", {
    companyId: agreement.companyId,
    title: `${input.kind === "amendment" ? "Amendment to" : "Replacement of"} ${agreement.title}`.slice(0, 160),
    docType: agreement.docType,
    category: agreement.category,
    access: agreement.access,
    workflow: "draft",
    lifecycle: input.kind === "replacement" ? {} : {},
    currentVersion: 1,
    terms: current.terms,
    skipped: [],
    assumptions: [],
    sources: agreement.sources,
    parties: agreement.parties,
    governingState: agreement.governingState,
    kit: agreement.kit,
    sourceTemplate: agreement.sourceTemplate,
    conversationId: agreement.conversationId,
    origin: "amendment",
    provenance: "unsigned",
    supersedes: agreement._id,
    searchText: "",
    createdBy: ctx.member._id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const title = (await ctx.db.get(id))!.title;
  await ctx.db.insert("agreementVersions", { companyId: agreement.companyId, agreementId: id, version: 1, title, markdown: current.markdown, hash: contentHash(current.markdown), clauses: current.clauses, terms: current.terms, unresolved: current.unresolved, author: { kind: "member", memberId: ctx.member._id }, note: input.note ?? `Started from version ${current.version} of "${agreement.title}"`, createdAt: Date.now() });
  for (const link of links) await ctx.db.insert("agreementLinks", { companyId: agreement.companyId, agreementId: id, table: link.table, recordId: link.recordId, label: link.label, access: link.access });
  await reindex(ctx, (await ctx.db.get(id))!);
  await recordEvent(ctx, { companyId: agreement.companyId, type: "agreement.amendment_started", actor: actorOf(ctx), subject: { table: "agreements", id }, data: { from: agreement._id, kind: input.kind } });
  void type;
  return id;
}

export async function addLink(ctx: Ctx, agreement: Doc<"agreements">, link: LinkInput) {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot do this.", "not_allowed");
  const known = await prefill(ctx, [link]);
  for (const label of known.labels) {
    const exists = await ctx.db.query("agreementLinks").withIndex("by_company_record", (q) => q.eq("companyId", agreement.companyId).eq("table", label.table).eq("recordId", label.id)).take(100);
    if (exists.some((row) => row.agreementId === agreement._id)) continue;
    await ctx.db.insert("agreementLinks", { companyId: agreement.companyId, agreementId: agreement._id, table: label.table, recordId: label.id, label: label.label, access: agreement.access });
  }
  await reindex(ctx, (await ctx.db.get(agreement._id))!);
}

export async function removeLink(ctx: Ctx, agreement: Doc<"agreements">, linkId: Id<"agreementLinks">) {
  if (!mayDraft(ctx.role, agreement.access)) throw userError("Your role cannot do this.", "not_allowed");
  const row = await ctx.db.get(linkId);
  if (!row || row.companyId !== agreement.companyId || row.agreementId !== agreement._id) notFound();
  await ctx.db.delete(linkId);
  await reindex(ctx, (await ctx.db.get(agreement._id))!);
}

export type { TermValue };
export { isAnswered };
