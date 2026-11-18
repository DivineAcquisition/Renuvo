import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyMutation, companyQuery } from "./lib/builders";
import { byMember, recordEvent } from "./lib/events";
import { refreshClient } from "./lib/clients/directory";
import { propertyKindValidator } from "./lib/clients/schema";
import { userError } from "./lib/errors";
import { isManager } from "./lib/roles";
import { recordStatusValidator } from "./lib/statuses";
import { optionalText, text } from "./lib/text";
import { addressValidator } from "./schema";

type Address = typeof addressValidator.type;

/** An address as it is stored: trimmed, the postal code uppercased, and a map location only as a real pair. */
export function cleanAddress(value: Address): Address {
  // A map location is kept only as a pair, and only when it is a real place on Earth.
  const located = typeof value.lat === "number" && typeof value.lng === "number" && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
  const placeId = optionalText(value.placeId, "Place id", 300);
  return {
    line1: text(value.line1, "Street address", 200),
    line2: optionalText(value.line2, "Address line 2", 200),
    city: text(value.city, "City", 120),
    region: text(value.region, "State or region", 80),
    postalCode: text(value.postalCode, "Postal code", 20).toUpperCase(),
    ...(placeId ? { placeId } : {}),
    ...(located ? { lat: value.lat, lng: value.lng } : {}),
  };
}

export const get = companyQuery({
  args: { propertyId: v.id("properties") },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    // Access instructions and office notes are the Owner's and Managers' only.
    return isManager(ctx.role) ? property : { ...property, accessInstructions: undefined, officeNotes: undefined };
  },
});

export const create = companyMutation({
  args: {
    customerId: v.id("customers"),
    address: addressValidator,
    kind: propertyKindValidator,
    label: v.optional(v.string()),
    accessInstructions: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const customer = await owned(ctx, args.customerId);
    if (args.accessInstructions?.trim() && !isManager(ctx.role)) throw userError("Only an Owner or Manager can record access instructions.", "not_allowed");
    const propertyId = await ctx.db.insert("properties", {
      companyId: ctx.companyId,
      customerId: customer._id,
      address: cleanAddress(args.address),
      kind: args.kind,
      label: optionalText(args.label, "Label", 120),
      accessInstructions: optionalText(args.accessInstructions, "Access instructions"),
      status: "active",
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.created", actor: byMember(ctx), subject: { table: "properties", id: propertyId } });
    await refreshClient(ctx, customer._id);
    return propertyId;
  },
});

export const update = companyMutation({
  args: {
    propertyId: v.id("properties"),
    address: v.optional(addressValidator),
    kind: v.optional(propertyKindValidator),
    label: v.optional(v.string()),
    accessInstructions: v.optional(v.string()),
    status: v.optional(recordStatusValidator),
  },
  handler: async (ctx, args) => {
    const property = await owned(ctx, args.propertyId);
    if (args.accessInstructions !== undefined && !isManager(ctx.role)) throw userError("Only an Owner or Manager can change access instructions.", "not_allowed");
    if (args.address !== undefined) throw userError("Change an address from the property's page in Clients & Properties, which shows the visits it affects first.");
    await ctx.db.patch(property._id, {
      revision: (property.revision ?? 0) + 1,
      updatedAt: Date.now(),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.label !== undefined ? { label: optionalText(args.label, "Label", 120) } : {}),
      ...(args.accessInstructions !== undefined ? { accessInstructions: optionalText(args.accessInstructions, "Access instructions") } : {}),
      ...(args.status !== undefined ? { status: args.status } : {}),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "property.updated", actor: byMember(ctx), subject: { table: "properties", id: property._id } });
    await refreshClient(ctx, property.customerId);
    return null;
  },
});
