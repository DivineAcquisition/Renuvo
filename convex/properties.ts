import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyMutation, companyQuery } from "./lib/builders";
import { byMember, recordEvent } from "./lib/events";
import { recordStatusValidator, workKindValidator } from "./lib/statuses";
import { optionalText, text } from "./lib/text";
import { addressValidator } from "./schema";

type Address = typeof addressValidator.type;

function address(value: Address): Address {
  return {
    line1: text(value.line1, "Street address", 200),
    line2: optionalText(value.line2, "Address line 2", 200),
    city: text(value.city, "City", 120),
    region: text(value.region, "State or region", 80),
    postalCode: text(value.postalCode, "Postal code", 20).toUpperCase(),
  };
}

export const get = companyQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => owned(ctx, args.propertyId),
});

export const create = companyMutation({
  args: {
    customerId: v.id("customers"),
    address: addressValidator,
    kind: workKindValidator,
    label: v.optional(v.string()),
    accessInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    const propertyId = await ctx.db.insert("properties", {
      companyId: ctx.companyId,
      customerId: customer._id,
      address: address(args.address),
      kind: args.kind,
      label: optionalText(args.label, "Label", 120),
      accessInstructions: optionalText(args.accessInstructions, "Access instructions"),
      status: "active",
      createdAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.created", actor: byMember(ctx), subject: { table: "properties", id: propertyId } });
    return propertyId;
  },
});

export const update = companyMutation({
  args: {
    propertyId: v.id("properties"),
    address: v.optional(addressValidator),
    kind: v.optional(workKindValidator),
    label: v.optional(v.string()),
    accessInstructions: v.optional(v.string()),
    status: v.optional(recordStatusValidator),
  },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    await ctx.db.patch(property._id, {
      ...(args.address !== undefined ? { address: address(args.address) } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.label !== undefined ? { label: optionalText(args.label, "Label", 120) } : {}),
      ...(args.accessInstructions !== undefined ? { accessInstructions: optionalText(args.accessInstructions, "Access instructions") } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.updated", actor: byMember(ctx), subject: { table: "properties", id: property._id } });
    return null;
  },
});
