/**
 * Subcontractor companies: businesses that supply their own cleaners. The company, its authorized contact
 * and its individual workers are separate things. Jobs go to real people; a worker's past affiliation is
 * kept with dates, so a move between subcontractors never rewrites where earlier jobs came from.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { STATUS_WORDS } from "./lib/cleaners/enroll";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { portalLinkState, revokePortalLink, subcontractorLinks } from "./lib/cleaners/portal";
import { isManager, isOwner } from "./lib/roles";
import { optionalEmail, optionalText, tags, text } from "./lib/text";

const contactValidator = v.object({ name: v.string(), title: v.optional(v.string()), email: v.optional(v.string()), phone: v.optional(v.string()) });

function cleanContact(contact: typeof contactValidator.type) {
  return { name: text(contact.name, "The contact's name", 120), title: optionalText(contact.title, "Title", 80), email: optionalEmail(contact.email), phone: optionalText(contact.phone, "Phone", 40) };
}

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("subcontractors")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    const out = [];
    for (const row of rows) {
      const workers = await ctx.db
        .query("cleaners")
        .withIndex("by_company_subcontractor", (q) => q.eq("companyId", ctx.companyId).eq("subcontractorId", row._id))
        .take(500);
      out.push({
        subcontractorId: row._id,
        name: row.name,
        status: row.status,
        contact: isManager(ctx.role) ? row.contact : { name: row.contact.name },
        serviceAreas: row.serviceAreas,
        workers: workers.filter((worker) => worker.status !== "ended").length,
        activeWorkers: workers.filter((worker) => worker.status === "ready").length,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const get = companyQuery({
  args: { subcontractorId: v.id("subcontractors") },
  handler: async (ctx, args) => {
    const sub = await owned(ctx, args.subcontractorId);
    const current = await ctx.db
      .query("cleaners")
      .withIndex("by_company_subcontractor", (q) => q.eq("companyId", ctx.companyId).eq("subcontractorId", sub._id))
      .take(500);
    const past = await ctx.db
      .query("workerAffiliations")
      .withIndex("by_company_subcontractor", (q) => q.eq("companyId", ctx.companyId).eq("subcontractorId", sub._id))
      .take(1000);
    const former = [];
    for (const row of past) {
      if (row.to === undefined) continue;
      const cleaner = await ctx.db.get(row.cleanerId);
      if (cleaner) former.push({ cleanerId: cleaner._id, name: cleaner.name, from: row.from, to: row.to });
    }
    return {
      subcontractorId: sub._id,
      name: sub.name,
      status: sub.status,
      contact: isManager(ctx.role) ? sub.contact : { name: sub.contact.name },
      serviceAreas: sub.serviceAreas,
      notes: isManager(ctx.role) ? (sub.notes ?? null) : null,
      /** The Owner's arrangement with the subcontractor company. */
      pay: isOwner(ctx.role) ? (sub.pay ?? null) : null,
      workers: current.map((worker) => ({ cleanerId: worker._id, name: worker.name, status: worker.status, statusWords: STATUS_WORDS[worker.status] })).sort((a, b) => a.name.localeCompare(b.name)),
      former,
    };
  },
});

export const create = managerMutation({
  args: { name: v.string(), contact: contactValidator, serviceAreas: v.optional(v.array(v.string())), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const name = text(args.name, "The company name", 160);
    const existing = await ctx.db
      .query("subcontractors")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    if (existing.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())) throw userError(`${name} is already a subcontractor company here.`);
    const id = await ctx.db.insert("subcontractors", {
      companyId: ctx.companyId,
      name,
      status: "active",
      contact: cleanContact(args.contact),
      serviceAreas: tags(args.serviceAreas ?? [], "Service areas", 200).map((code) => code.toUpperCase()),
      notes: optionalText(args.notes, "Notes", 2000),
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "subcontractor.created", actor: byMember(ctx), subject: { table: "subcontractors", id } });
    return id;
  },
});

export const update = managerMutation({
  args: { subcontractorId: v.id("subcontractors"), name: v.optional(v.string()), contact: v.optional(contactValidator), serviceAreas: v.optional(v.array(v.string())), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const sub = await owned(ctx, args.subcontractorId);
    await ctx.db.patch(sub._id, {
      ...(args.name !== undefined ? { name: text(args.name, "The company name", 160) } : {}),
      ...(args.contact !== undefined ? { contact: cleanContact(args.contact) } : {}),
      ...(args.serviceAreas !== undefined ? { serviceAreas: tags(args.serviceAreas, "Service areas", 200).map((code) => code.toUpperCase()) } : {}),
      ...(args.notes !== undefined ? { notes: optionalText(args.notes, "Notes", 2000) } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "subcontractor.updated", actor: byMember(ctx), subject: { table: "subcontractors", id: sub._id } });
    return null;
  },
});

/**
 * Pausing or ending a relationship with a subcontractor company is the Owner's, with a reason. Its workers
 * keep their records and their history; ending it never removes anyone from a job they accepted.
 */
export const setStatus = ownerMutation({
  args: { subcontractorId: v.id("subcontractors"), status: v.union(v.literal("active"), v.literal("paused"), v.literal("ended")), reason: v.string() },
  handler: async (ctx, args) => {
    const sub = await owned(ctx, args.subcontractorId);
    const reason = text(args.reason, "The reason", 500);
    if (sub.status === args.status) return null;
    if (sub.status === "ended") throw userError("This relationship has ended. Add the company again to work with it.");
    await ctx.db.patch(sub._id, { status: args.status, ...(args.status === "ended" ? { endedAt: Date.now() } : {}) });
    // Ending the relationship ends the contact's portal access. Their workers keep their own records and links.
    if (args.status === "ended") for (const link of await subcontractorLinks(ctx, ctx.companyId, sub._id)) if (portalLinkState(link, Date.now()) === "active") await revokePortalLink(ctx, link, "The working relationship ended.", byMember(ctx));
    await recordEvent(ctx, { companyId: ctx.companyId, type: "subcontractor.status_changed", actor: byMember(ctx), subject: { table: "subcontractors", id: sub._id }, data: { from: sub.status, to: args.status, reason } });
    return null;
  },
});
