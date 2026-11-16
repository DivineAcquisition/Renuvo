/**
 * A company's own agreement templates: made from Selestial's starting text or from scratch, edited as
 * versions, reviewed, approved, archived and set as defaults. An agreement copies the clauses it is made
 * from, so none of this changes an agreement that already exists.
 */
import { v } from "convex/values";

import { companyMutation, companyQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { can } from "./lib/agreements/access";
import { DOC_TYPE_BY_KEY } from "./lib/agreements/catalog";
import { kitFor } from "./lib/agreements/compose";
import { clauseValidator, customVarValidator } from "./lib/agreements/schema";
import { approveTemplate, archiveTemplate, createTemplate, loadTemplate, recordReview, reviewedVersion, saveTemplate, setDefaults, templateVersion, toInput } from "./lib/agreements/templates";

export const get = companyQuery({
  args: { templateId: v.string(), version: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const template = await loadTemplate(ctx, args.templateId);
    const row = await templateVersion(ctx, template, args.version ?? template.currentVersion);
    const versions = await ctx.db.query("agreementTemplateVersions").withIndex("by_company_template_version", (q) => q.eq("companyId", ctx.companyId).eq("templateId", template._id)).order("desc").take(50);
    const inUse = (await ctx.db.query("agreements").withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(300)).filter((a) => a.sourceTemplate?.templateId === template._id).length;
    return {
      id: template._id,
      title: template.title,
      docType: template.docType,
      typeLabel: DOC_TYPE_BY_KEY.get(template.docType)?.label ?? template.docType,
      status: template.status,
      currentVersion: template.currentVersion,
      approvedVersion: template.approvedVersion ?? null,
      defaultFor: template.defaultFor,
      review: reviewedVersion(template),
      staleReview: template.review && template.review.version !== template.currentVersion ? template.review : null,
      shown: { version: row.version, clauses: row.clauses, extra: row.extra, note: row.note ?? null, createdAt: row.createdAt },
      versions: versions.map((r) => ({ version: r.version, note: r.note ?? null, createdAt: r.createdAt })),
      agreementsMade: inUse,
      canEdit: can(ctx.role, "editTemplates"),
    };
  },
});

/** The catalog's starting clauses for one document type, to begin a company template from. */
export const startingText = companyQuery({
  args: { docType: v.string() },
  handler: async (_ctx, args) => {
    const type = DOC_TYPE_BY_KEY.get(args.docType);
    if (!type) throw userError("That is not a document type Selestial offers.");
    return { docType: type.key, label: type.label, clauses: kitFor(type).clauses.map(toInput) };
  },
});

export const create = companyMutation({
  args: { title: v.string(), docType: v.string(), fromCatalog: v.optional(v.boolean()), clauses: v.optional(v.array(clauseValidator)), extra: v.optional(v.array(customVarValidator)) },
  handler: async (ctx, args) => {
    if (!DOC_TYPE_BY_KEY.has(args.docType)) throw userError("That is not a document type Selestial offers.");
    return createTemplate(ctx, { title: args.title, docType: args.docType, clauses: args.clauses as never, extra: args.extra as never, sourceCatalogKey: args.fromCatalog === false ? undefined : args.docType });
  },
});

export const save = companyMutation({
  args: { templateId: v.string(), baseVersion: v.number(), clauses: v.array(clauseValidator), extra: v.optional(v.array(customVarValidator)), title: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => saveTemplate(ctx, await loadTemplate(ctx, args.templateId), { baseVersion: args.baseVersion, clauses: args.clauses as never, extra: args.extra as never, title: args.title, note: args.note }),
});

export const approve = companyMutation({
  args: { templateId: v.string(), version: v.number() },
  handler: async (ctx, args) => {
    await approveTemplate(ctx, await loadTemplate(ctx, args.templateId), args.version);
    return null;
  },
});

export const archive = companyMutation({
  args: { templateId: v.string(), archived: v.boolean() },
  handler: async (ctx, args) => {
    await archiveTemplate(ctx, await loadTemplate(ctx, args.templateId), args.archived);
    return null;
  },
});

export const defaults = companyMutation({
  args: { templateId: v.string(), defaultFor: v.array(v.string()) },
  handler: async (ctx, args) => {
    await setDefaults(ctx, await loadTemplate(ctx, args.templateId), args.defaultFor);
    return null;
  },
});

export const review = companyMutation({
  args: { templateId: v.string(), version: v.number(), reviewer: v.string(), reviewedOn: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await recordReview(ctx, await loadTemplate(ctx, args.templateId), { version: args.version, reviewer: args.reviewer, reviewedOn: args.reviewedOn, note: args.note });
    return null;
  },
});
