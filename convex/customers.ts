import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyMutation, companyQuery } from "./lib/builders";
import { refreshClient } from "./lib/clients/directory";
import { isManager } from "./lib/roles";
import { byMember, recordEvent } from "./lib/events";
import { recordStatusValidator, workKindValidator } from "./lib/statuses";
import { userError } from "./lib/errors";
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
    // Access instructions and office notes are the Owner's and Managers' only.
    const manager = isManager(ctx.role);
    return { customer: manager ? customer : { ...customer, privateNotes: undefined }, properties: properties.map((p) => (manager ? p : { ...p, accessInstructions: undefined, officeNotes: undefined })) };
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
      relationship: "active",
      source: "manual",
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.created", actor: byMember(ctx), subject: { table: "customers", id: customerId } });
    await refreshClient(ctx, customerId);
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
    if (args.status !== undefined && args.status !== customer.status) throw userError("Archive or restore a client from its page in Clients & Properties, which checks what depends on it.");
    await ctx.db.patch(customer._id, {
      revision: (customer.revision ?? 0) + 1,
      updatedAt: Date.now(),
      ...(args.name !== undefined ? { name: text(args.name, "Name", 160) } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.email !== undefined ? { email: optionalEmail(args.email) } : {}),
      ...(args.phone !== undefined ? { phone: optionalText(args.phone, "Phone", 40) } : {}),
      ...(args.preferences !== undefined ? { preferences: optionalText(args.preferences, "Preferences") } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "customer.updated", actor: byMember(ctx), subject: { table: "customers", id: customer._id } });
    await refreshClient(ctx, customer._id);
    return null;
  },
});
