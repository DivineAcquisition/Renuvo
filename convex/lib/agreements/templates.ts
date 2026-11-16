/**
 * Company templates: a company's own versioned starting texts. A template is made from Selestial's
 * catalog or from scratch, edited as new versions, reviewed, approved and archived. An agreement copies
 * the clauses it is made from, so changing or archiving a template never changes an agreement already
 * made from it.
 *
 * "Reviewed by counsel" is shown only when a person recorded evidence against the exact version.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import { notFound, userError } from "../errors";
import { recordEvent } from "../events";
import { can, mayDraft, requireScale } from "./access";
import { docType } from "./catalog";
import { kitFor, type Kit } from "./compose";
import { variablesOf, type Clause } from "./clauses";
import type { Ctx, ReadCtx } from "./store";
import { VARIABLE_BY_KEY } from "./variables";

type ClauseInput = { key: string; version: number; title: string; body: string; flags?: string[]; when?: string; unless?: string };
type ExtraInput = { key: string; label: string; type: "text" | "longtext" | "money" | "date" | "int" | "bool" | "choice" | "list"; group: string; ask: string; choices?: string[] };

export async function loadTemplate(ctx: Ctx | ReadCtx, templateId: string): Promise<Doc<"agreementTemplates">> {
  const id = ctx.db.normalizeId("agreementTemplates", templateId);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.companyId !== ctx.company._id) notFound();
  const type = docType(row.docType);
  // A template for a restricted document is as restricted as the document.
  if (!mayDraft(ctx.role, type.access) && !(ctx.role !== "office" && type.access !== "restricted")) notFound();
  return row;
}

export async function templateVersion(ctx: Ctx | ReadCtx, template: Doc<"agreementTemplates">, version = template.currentVersion) {
  const row = await ctx.db
    .query("agreementTemplateVersions")
    .withIndex("by_company_template_version", (q) => q.eq("companyId", template.companyId).eq("templateId", template._id).eq("version", version))
    .unique();
  if (!row) notFound();
  return row;
}

export function checkClauses(clauses: ClauseInput[], extra: ExtraInput[]): void {
  if (clauses.length === 0) throw userError("A template needs at least one clause.");
  if (clauses.length > 80) throw userError("A template can have up to 80 clauses.");
  const keys = new Set<string>();
  const defined = new Set([...VARIABLE_BY_KEY.keys(), ...extra.map((e) => e.key)]);
  for (const e of extra) {
    if (!/^x_[a-z0-9_]{2,30}$/.test(e.key)) throw userError("A custom variable's key must start with x_ and use lower-case letters, numbers or underscores.");
    if (VARIABLE_BY_KEY.has(e.key)) throw userError(`${e.key} is already a built-in field.`);
    if (!e.label.trim() || !e.ask.trim()) throw userError("A custom variable needs a label and a question.");
  }
  for (const clause of clauses) {
    if (!/^[a-z0-9_]{2,40}$/.test(clause.key)) throw userError("A clause key uses lower-case letters, numbers or underscores.");
    if (keys.has(clause.key)) throw userError(`Two clauses share the key ${clause.key}.`);
    keys.add(clause.key);
    if (!clause.title.trim() || !clause.body.trim()) throw userError("A clause needs a title and text.");
    if (clause.body.length > 6000) throw userError(`The clause "${clause.title}" is too long.`);
    for (const name of variablesOf(clause.body)) if (!defined.has(name)) throw userError(`The clause "${clause.title}" uses {{${name}}}, which is not a known field. Define it as a custom variable (x_...) first.`);
    for (const gate of [clause.when, clause.unless]) if (gate && !defined.has(gate)) throw userError(`The clause "${clause.title}" depends on an unknown field ${gate}.`);
  }
}

export async function createTemplate(ctx: Ctx, input: { title: string; docType: string; clauses?: ClauseInput[]; extra?: ExtraInput[]; sourceCatalogKey?: string }): Promise<Id<"agreementTemplates">> {
  if (!can(ctx.role, "editTemplates")) throw userError("Your role cannot edit templates.", "not_allowed");
  const type = docType(input.docType);
  if (!mayDraft(ctx.role, type.access)) throw userError("Only the Owner can make templates for this kind of document.", "not_allowed");
  const clauses = input.clauses ?? kitFor(type).clauses.map(toInput);
  const extra = input.extra ?? [];
  checkClauses(clauses, extra);
  const title = input.title.trim().slice(0, 160);
  if (!title) throw userError("The template needs a title.");
  const now = Date.now();
  const id = await ctx.db.insert("agreementTemplates", { companyId: ctx.company._id, title, docType: type.key, status: "draft", currentVersion: 1, defaultFor: [], sourceCatalogKey: input.sourceCatalogKey, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
  await ctx.db.insert("agreementTemplateVersions", { companyId: ctx.company._id, templateId: id, version: 1, clauses, extra, note: input.sourceCatalogKey ? `Started from Selestial's ${type.label} starting text` : "First version", authorId: ctx.member._id, createdAt: now });
  await recordEvent(ctx, { companyId: ctx.company._id, type: "agreement_template.created", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementTemplates", id }, data: { docType: type.key } });
  return id;
}

export function toInput(clause: Clause): ClauseInput {
  return { key: clause.key, version: clause.version, title: clause.title, body: clause.body, flags: clause.flags ? [...clause.flags] : undefined, when: clause.when, unless: clause.unless };
}

/** A new version from the version the editor was looking at. Approval and any review evidence belong to the old text. */
export async function saveTemplate(ctx: Ctx, template: Doc<"agreementTemplates">, input: { baseVersion: number; clauses: ClauseInput[]; extra?: ExtraInput[]; title?: string; note?: string }): Promise<number> {
  if (!can(ctx.role, "editTemplates")) throw userError("Your role cannot edit templates.", "not_allowed");
  if (template.status === "archived") throw userError("This template is archived. Restore it first.");
  if (input.baseVersion !== template.currentVersion) throw userError(`This template changed since version ${input.baseVersion}; it is now at version ${template.currentVersion}.`);
  const extra = input.extra ?? (await templateVersion(ctx, template)).extra;
  checkClauses(input.clauses, extra);
  const now = Date.now();
  const next = template.currentVersion + 1;
  // Each edited clause is a new clause version, so an agreement built from it records what it used.
  const previous = (await templateVersion(ctx, template)).clauses;
  const clauses = input.clauses.map((clause) => {
    const before = previous.find((c) => c.key === clause.key);
    const changed = !before || before.body !== clause.body || before.title !== clause.title;
    return { ...clause, version: before ? (changed ? before.version + 1 : before.version) : 1 };
  });
  await ctx.db.insert("agreementTemplateVersions", { companyId: template.companyId, templateId: template._id, version: next, clauses, extra, note: input.note?.trim().slice(0, 300), authorId: ctx.member._id, createdAt: now });
  await ctx.db.patch(template._id, { currentVersion: next, title: input.title?.trim() ? input.title.trim().slice(0, 160) : template.title, status: "draft", approvedVersion: undefined, approvedBy: undefined, updatedAt: now });
  await recordEvent(ctx, { companyId: template.companyId, type: "agreement_template.revised", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementTemplates", id: template._id }, data: { version: next } });
  return next;
}

export async function approveTemplate(ctx: Ctx, template: Doc<"agreementTemplates">, version: number) {
  if (!can(ctx.role, "approve") || !can(ctx.role, "editTemplates")) throw userError("Your role cannot approve templates.", "not_allowed");
  if (version !== template.currentVersion) throw userError(`That is version ${version}; the template is at version ${template.currentVersion}.`);
  if (template.status === "archived") throw userError("This template is archived.");
  await ctx.db.patch(template._id, { status: "approved", approvedVersion: version, approvedBy: ctx.member._id, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: template.companyId, type: "agreement_template.approved", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementTemplates", id: template._id }, data: { version } });
}

export async function archiveTemplate(ctx: Ctx, template: Doc<"agreementTemplates">, archived: boolean) {
  if (!can(ctx.role, "editTemplates")) throw userError("Your role cannot edit templates.", "not_allowed");
  await ctx.db.patch(template._id, archived ? { status: "archived", defaultFor: [], updatedAt: Date.now() } : { status: template.approvedVersion === template.currentVersion ? "approved" : "draft", updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: template.companyId, type: archived ? "agreement_template.archived" : "agreement_template.restored", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementTemplates", id: template._id } });
}

/** Which services or engagements this template is the default for. Only an approved template can be a default. */
export async function setDefaults(ctx: Ctx, template: Doc<"agreementTemplates">, defaultFor: string[]) {
  if (!can(ctx.role, "editTemplates")) throw userError("Your role cannot edit templates.", "not_allowed");
  if (template.status !== "approved") throw userError("Only an approved template can be a default.");
  const clean = [...new Set(defaultFor.map((x) => x.trim()).filter(Boolean))].slice(0, 20);
  for (const other of await ctx.db.query("agreementTemplates").withIndex("by_company_doctype", (q) => q.eq("companyId", template.companyId).eq("docType", template.docType)).take(50)) {
    if (other._id !== template._id && other.defaultFor.some((x) => clean.includes(x))) await ctx.db.patch(other._id, { defaultFor: other.defaultFor.filter((x) => !clean.includes(x)) });
  }
  await ctx.db.patch(template._id, { defaultFor: clean, updatedAt: Date.now() });
}

/** Evidence, written by a person, that a lawyer or specialist reviewed this exact version. Selestial never infers it. */
export async function recordReview(ctx: Ctx, template: Doc<"agreementTemplates">, input: { version: number; reviewer: string; reviewedOn: string; note?: string }) {
  if (!can(ctx.role, "approve")) throw userError("Your role cannot record a review.", "not_allowed");
  if (input.version !== template.currentVersion) throw userError("A review is recorded against the current version only.");
  if (!input.reviewer.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewedOn)) throw userError("Name who reviewed it and the date (YYYY-MM-DD).");
  await ctx.db.patch(template._id, { review: { version: input.version, reviewer: input.reviewer.trim().slice(0, 120), reviewedOn: input.reviewedOn, note: input.note?.trim().slice(0, 300), recordedBy: ctx.member._id }, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: template.companyId, type: "agreement_template.review_recorded", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "agreementTemplates", id: template._id }, data: { version: input.version } });
}

/** The kit an agreement is built from for a company template. Only an approved version may start an agreement. */
export async function kitFromTemplate(ctx: Ctx | ReadCtx, template: Doc<"agreementTemplates">): Promise<{ kit: Kit; version: number }> {
  if (template.status !== "approved" || template.approvedVersion === undefined) throw userError("Approve this template before starting an agreement from it.");
  const row = await templateVersion(ctx, template, template.approvedVersion);
  return { kit: { clauses: row.clauses.map((c) => ({ ...c, flags: c.flags as never })), extra: row.extra }, version: row.version };
}

export const reviewedVersion = (template: Pick<Doc<"agreementTemplates">, "review" | "currentVersion">) => (template.review && template.review.version === template.currentVersion ? template.review : null);
export { requireScale };
