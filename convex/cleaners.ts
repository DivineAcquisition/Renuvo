/**
 * Cleaners. Every change here is made by a person. An agent never changes a cleaner's pay or standing
 * (brief, section 5), and there is no function through which one could.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { owned } from "./lib/access";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { cleanerStatusValidator } from "./lib/statuses";
import { optionalEmail, optionalText, tags, text } from "./lib/text";
import { payValidator } from "./schema";

/** Pay is the Owner's. Everyone else sees the cleaner without it. */
function withoutPay(cleaner: Doc<"cleaners">): Doc<"cleaners"> {
  const rest = { ...cleaner };
  delete rest.pay;
  return rest;
}

export const list = companyQuery({
  args: { status: v.optional(cleanerStatusValidator) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", args.status ?? "ready"))
      .take(200);
    return ctx.role === "owner" ? rows : rows.map(withoutPay);
  },
});

export const get = companyQuery({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    return ctx.role === "owner" ? cleaner : withoutPay(cleaner);
  },
});

export const create = managerMutation({
  args: {
    name: v.string(),
    engagement: v.union(v.literal("contractor"), v.literal("employee")),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    serviceAreas: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const cleanerId = await ctx.db.insert("cleaners", {
      companyId: ctx.companyId,
      name: text(args.name, "Name", 160),
      engagement: args.engagement,
      email: optionalEmail(args.email),
      phone: optionalText(args.phone, "Phone", 40),
      // A new cleaner is not offered work until a person marks them ready.
      status: "onboarding",
      skills: tags(args.skills ?? [], "Skills"),
      serviceAreas: tags(args.serviceAreas ?? [], "Service areas", 200).map((code) => code.toUpperCase()),
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.created", actor: byMember(ctx), subject: { table: "cleaners", id: cleanerId } });
    return cleanerId;
  },
});

export const update = managerMutation({
  args: {
    cleanerId: v.id("cleaners"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    serviceAreas: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    await ctx.db.patch(cleaner._id, {
      ...(args.name !== undefined ? { name: text(args.name, "Name", 160) } : {}),
      ...(args.email !== undefined ? { email: optionalEmail(args.email) } : {}),
      ...(args.phone !== undefined ? { phone: optionalText(args.phone, "Phone", 40) } : {}),
      ...(args.skills !== undefined ? { skills: tags(args.skills, "Skills") } : {}),
      ...(args.serviceAreas !== undefined ? { serviceAreas: tags(args.serviceAreas, "Service areas", 200).map((code) => code.toUpperCase()) } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.updated", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id } });
    return null;
  },
});

/** A person decides routine changes to a cleaner's engagement: active ("ready") or paused. */
export const setStatus = managerMutation({
  args: { cleanerId: v.id("cleaners"), status: cleanerStatusValidator },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (cleaner.status === args.status) return null;
    // Suspending, ending, and leaving a suspension or an ending are personnel decisions (convex/personnel.ts).
    if (args.status === "suspended" || args.status === "ended" || cleaner.status === "suspended" || cleaner.status === "ended") {
      throw userError("Suspending or ending an engagement, and undoing either, is a personnel request an authorized person decides.");
    }
    await ctx.db.patch(cleaner._id, { status: args.status, statusChangedAt: Date.now() });
    await recordEvent(ctx, {
      companyId: ctx.companyId,
      type: "cleaner.status_changed",
      actor: byMember(ctx),
      subject: { table: "cleaners", id: cleaner._id },
      data: { from: cleaner.status, to: args.status },
    });
    return null;
  },
});

export const setPay = ownerMutation({
  args: { cleanerId: v.id("cleaners"), pay: payValidator },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const pay = args.pay;
    if (pay.kind === "share") {
      if (cleaner.engagement !== "contractor") throw userError("A share of the job is for contractors. Employees are paid hourly.");
      if (!Number.isInteger(pay.shareBps) || pay.shareBps < 0 || pay.shareBps > 10000) throw userError("The share must be between 0% and 100%.");
    } else {
      if (cleaner.engagement !== "employee") throw userError("An hourly rate is for employees. Contractors are paid a share of the job.");
      if (!Number.isSafeInteger(pay.hourlyCents) || pay.hourlyCents < 0) throw userError("The hourly rate must be a whole number of cents, zero or more.");
    }
    await ctx.db.patch(cleaner._id, { pay });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.pay_changed", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { kind: pay.kind } });
    return null;
  },
});
