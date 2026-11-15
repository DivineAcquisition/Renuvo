import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyMutation, companyQuery } from "./lib/builders";
import { byMember, recordEvent } from "./lib/events";
import { recordStatusValidator, workKindValidator } from "./lib/statuses";
import { optionalEmail, optionalText, text } from "./lib/text";

export const list = companyQuery({
  args: { status: v.optional(recordStatusValidator) },
  handler: async (ctx, args) =>
    ctx.db
      .query("customers")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", args.status ?? "active"))
      .order("desc")
      .take(200),
});

export const get = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const properties = await ctx.db
      .query("properties")
      .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
      .take(100);
    return { customer, properties };
  },
});

export const create = companyMutation({
  args: {
    name: v.string(),
    kind: workKindValidator,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    preferences: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const customerId = await ctx.db.insert("customers", {
      companyId: ctx.companyId,
      name: text(args.name, "Name", 160),
      kind: args.kind,
      email: optionalEmail(args.email),
      phone: optionalText(args.phone, "Phone", 40),
      preferences: optionalText(args.preferences, "Preferences"),
      status: "active",
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.created", actor: byMember(ctx), subject: { table: "customers", id: customerId } });
    return customerId;
  },
});

export const update = companyMutation({
  args: {
    customerId: v.id("customers"),
    name: v.optional(v.string()),
    kind: v.optional(workKindValidator),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    preferences: v.optional(v.string()),
    status: v.optional(recordStatusValidator),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    await ctx.db.patch(customer._id, {
      ...(args.name !== undefined ? { name: text(args.name, "Name", 160) } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.email !== undefined ? { email: optionalEmail(args.email) } : {}),
      ...(args.phone !== undefined ? { phone: optionalText(args.phone, "Phone", 40) } : {}),
      ...(args.preferences !== undefined ? { preferences: optionalText(args.preferences, "Preferences") } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.updated", actor: byMember(ctx), subject: { table: "customers", id: customer._id } });
    return null;
  },
});
