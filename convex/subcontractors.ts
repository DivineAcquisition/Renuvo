/**
 * Subcontractor companies: organizations that supply their own cleaners. The company, the person
 * authorized to speak for it, and its individual workers are separate records. Work is only ever assigned
 * to a named worker; which company supplied them is kept as dated history (workerAffiliations).
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { maySeePersonnelNotes } from "./lib/workforce/access";
import { nameKey } from "./lib/workforce/duplicates";
import { phone, setAffiliation } from "./lib/workforce/records";
import { subcontractorStatusValidator } from "./lib/workforce/schema";
import { optionalEmail, optionalText, text } from "./lib/text";

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("subcontractors")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(500);
    const out = [];
    for (const row of rows) {
      const affiliations = await ctx.db
        .query("workerAffiliations")
        .withIndex("by_company_subcontractor", (q) => q.eq("companyId", ctx.companyId).eq("subcontractorId", row._id))
        .take(1000);
      out.push({
        id: row._id,
        name: row.name,
        status: row.status,
        contactName: row.contactName ?? null,
        contactEmail: row.contactEmail ?? null,
        contactPhone: row.contactPhone ?? null,
        statusNote: maySeePersonnelNotes(ctx.role) ? (row.statusNote ?? null) : null,
        currentWorkers: affiliations.filter((item) => item.endedAt === undefined).length,
        pastWorkers: new Set(affiliations.filter((item) => item.endedAt !== undefined).map((item) => item.cleanerId)).size,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

const contactArgs = {
  contactName: v.optional(v.string()),
  contactEmail: v.optional(v.string()),
  contactPhone: v.optional(v.string()),
};

export const create = managerMutation({
  args: { name: v.string(), ...contactArgs },
  handler: async (ctx, args) => {
    const name = text(args.name, "Company name", 160);
    const existing = await ctx.db
      .query("subcontractors")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(500);
    const same = existing.find((row) => nameKey(row.name) === nameKey(name));
    if (same) throw userError(`${same.name} is already on record${same.status === "active" ? "" : ` (${same.status})`}.`);
    const id = await ctx.db.insert("subcontractors", {
      companyId: ctx.companyId,
      name,
      contactName: optionalText(args.contactName, "Contact name", 160),
      contactEmail: optionalEmail(args.contactEmail),
      contactPhone: phone(args.contactPhone),
      status: "active",
      createdBy: ctx.member._id,
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "subcontractor.created", actor: byMember(ctx), subject: { table: "subcontractors", id } });
    return id;
  },
});

export const update = managerMutation({
  args: { subcontractorId: v.id("subcontractors"), name: v.optional(v.string()), ...contactArgs },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.subcontractorId);
    await ctx.db.patch(row._id, {
      ...(args.name !== undefined ? { name: text(args.name, "Company name", 160) } : {}),
      ...(args.contactName !== undefined ? { contactName: optionalText(args.contactName, "Contact name", 160) } : {}),
      ...(args.contactEmail !== undefined ? { contactEmail: optionalEmail(args.contactEmail) } : {}),
      ...(args.contactPhone !== undefined ? { contactPhone: phone(args.contactPhone) } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "subcontractor.updated", actor: byMember(ctx), subject: { table: "subcontractors", id: row._id } });
    return null;
  },
});

/**
 * Pausing or ending a subcontractor needs a reason. Its workers keep their own status: the workspace
 * lists each one still active, and a person decides.
 */
export const setStatus = managerMutation({
  args: { subcontractorId: v.id("subcontractors"), status: subcontractorStatusValidator, reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.subcontractorId);
    if (row.status === args.status) return null;
    const reason = optionalText(args.reason, "The reason", 500);
    if (args.status !== "active" && (!reason || reason.length < 3)) throw userError("Say why.");
    await ctx.db.patch(row._id, { status: args.status, statusNote: reason, endedAt: args.status === "ended" ? Date.now() : undefined });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "subcontractor.status_changed", actor: byMember(ctx), subject: { table: "subcontractors", id: row._id }, data: { from: row.status, to: args.status } });
    return null;
  },
});

/** Moves a subcontractor worker to another supplying company. The earlier affiliation is kept, closed. */
export const moveWorker = managerMutation({
  args: { cleanerId: v.id("cleaners"), subcontractorId: v.id("subcontractors") },
  handler: async (ctx, args) => {
    const worker = await owned(ctx, args.cleanerId);
    await owned(ctx, args.subcontractorId);
    if (worker.engagement !== "subcontracted") throw userError("Only a subcontractor worker is supplied by a subcontractor company. The Owner changes the worker type.");
    await setAffiliation(ctx, worker, args.subcontractorId, ctx.member);
    return null;
  },
});
