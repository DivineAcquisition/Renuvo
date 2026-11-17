/**
 * Booking forms, for the builder. A form has a working draft and, once published, a published copy
 * that the public page shows. Editing the draft never changes what is live: publishing does, and it is
 * refused while the form would mislead (no question, no word that it is a request and not a booking, or
 * texting permission that does not say how to stop).
 */
import { v } from "convex/values";

import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { FORM_TEMPLATES, normalizeForm, publishProblems } from "./lib/sales/forms";
import { formUrl, newPublicId } from "./lib/sales/links";
import { formDefinitionValidator, serviceKindValidator } from "./lib/sales/schema";
import { publishedCatalog } from "./lib/services/store";
import { text } from "./lib/text";

export const templates = companyQuery({
  args: {},
  handler: async () => Object.entries(FORM_TEMPLATES).map(([kind, row]) => ({ kind, name: row.name, blurb: row.blurb, questions: row.definition.fields.length })),
});

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const status of ["published", "draft", "archived"] as const) {
      const rows = await ctx.db
        .query("salesForms")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .order("desc")
        .take(50);
      for (const form of rows) {
        const submissions = await ctx.db
          .query("salesFormSubmissions")
          .withIndex("by_company_form", (q) => q.eq("companyId", ctx.companyId).eq("formId", form._id))
          .order("desc")
          .take(200);
        out.push({ formId: form._id, name: form.name, status: form.status, kind: form.draft.kind, intent: form.draft.intent, questions: form.draft.fields.length, url: form.status === "published" && form.publicId ? formUrl(form.publicId) : null, publishedAt: form.publishedAt ?? null, unpublishedChanges: form.status === "published" && JSON.stringify(form.draft) !== JSON.stringify(form.published), submissions: submissions.length, lastSubmissionAt: submissions[0]?.receivedAt ?? null, updatedAt: form.updatedAt });
      }
    }
    return out;
  },
});

export const get = companyQuery({
  args: { formId: v.id("salesForms") },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || form.companyId !== ctx.companyId) return null;
    const services = (await publishedCatalog(ctx, ctx.companyId)).map((item) => ({ key: item.service.key, name: item.version.spec.name }));
    const submissions = await ctx.db
      .query("salesFormSubmissions")
      .withIndex("by_company_form", (q) => q.eq("companyId", ctx.companyId).eq("formId", form._id))
      .order("desc")
      .take(25);
    return {
      formId: form._id,
      name: form.name,
      status: form.status,
      draft: form.draft,
      published: form.published ?? null,
      publishedVersion: form.publishedVersion,
      publishedAt: form.publishedAt ?? null,
      revision: form.revision,
      url: form.status === "published" && form.publicId ? formUrl(form.publicId) : null,
      embed: form.status === "published" && form.publicId ? `<iframe src="${formUrl(form.publicId)}?embed=1" title="${form.draft.title.replace(/"/g, "&quot;")}" style="width:100%;min-height:900px;border:0" loading="lazy"></iframe>` : null,
      problems: publishProblems(form.draft),
      unpublishedChanges: form.status === "published" && JSON.stringify(form.draft) !== JSON.stringify(form.published),
      services,
      companyName: ctx.company.name,
      submissions: submissions.map((row) => ({ submissionId: row._id, name: row.contact.name, receivedAt: row.receivedAt, opportunityId: row.opportunityId ?? null, source: row.source.campaign ?? row.source.referrer ?? null, smsConsent: row.consent.sms })),
      canEdit: ctx.role !== "office",
    };
  },
});

export const create = managerMutation({
  args: { kind: serviceKindValidator, name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const template = FORM_TEMPLATES[args.kind];
    const now = Date.now();
    const formId = await ctx.db.insert("salesForms", { companyId: ctx.companyId, name: args.name?.trim() ? text(args.name, "The form's name", 80) : template.name, status: "draft", draft: template.definition, publishedVersion: 0, revision: 0, createdBy: ctx.member._id, createdAt: now, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "sales_form.created", actor: byMember(ctx), subject: { table: "salesForms", id: formId }, data: { kind: args.kind } });
    return formId;
  },
});

/** Saves the working draft. A stale browser tab cannot overwrite a newer save. */
export const saveDraft = managerMutation({
  args: { formId: v.id("salesForms"), expectedRevision: v.number(), name: v.string(), draft: formDefinitionValidator },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || form.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (form.revision !== args.expectedRevision) throw userError("This form was changed somewhere else. Reload to see the latest.");
    const catalog = new Set((await publishedCatalog(ctx, ctx.companyId)).map((item) => item.service.key));
    const draft = normalizeForm(args.draft);
    if (draft.serviceKeys.some((key) => !catalog.has(key))) throw userError("A form can only list published services.");
    await ctx.db.patch(form._id, { name: text(args.name, "The form's name", 80), draft, revision: form.revision + 1, updatedAt: Date.now() });
    return { revision: form.revision + 1, problems: publishProblems(draft) };
  },
});

/** Makes the draft live. The public address is given once and kept, so a link already shared keeps working. */
export const publish = managerMutation({
  args: { formId: v.id("salesForms"), expectedRevision: v.number() },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || form.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (form.revision !== args.expectedRevision) throw userError("This form was changed somewhere else. Reload to see the latest.");
    const problems = publishProblems(form.draft);
    if (problems.length > 0) throw userError(problems[0]);
    const now = Date.now();
    const publicId = form.publicId ?? newPublicId();
    await ctx.db.patch(form._id, { status: "published", published: form.draft, publishedVersion: form.publishedVersion + 1, publishedAt: now, publicId, revision: form.revision + 1, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "sales_form.published", actor: byMember(ctx), subject: { table: "salesForms", id: form._id }, data: { version: form.publishedVersion + 1 } });
    return { url: formUrl(publicId), revision: form.revision + 1 };
  },
});

/** Takes a form offline, or sets it aside. Its address then says the form is closed; what was submitted is kept. */
export const setStatus = managerMutation({
  args: { formId: v.id("salesForms"), status: v.union(v.literal("draft"), v.literal("archived")) },
  handler: async (ctx, args) => {
    const form = await ctx.db.get(args.formId);
    if (!form || form.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    await ctx.db.patch(form._id, { status: args.status, revision: form.revision + 1, updatedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: args.status === "archived" ? "sales_form.archived" : "sales_form.unpublished", actor: byMember(ctx), subject: { table: "salesForms", id: form._id } });
    return { revision: form.revision + 1 };
  },
});
