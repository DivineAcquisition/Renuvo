/**
 * Selestial staff membership. Only staff admins add or remove staff, change roles, or grant capabilities
 * (convex/lib/support/catalog.ts); each change is recorded in staffAudit. Nothing here touches a cleaning
 * company's records.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { signedInQuery, staffFor, staffMutation, staffQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { capabilitiesOf, capabilityValidator } from "./lib/support/catalog";
import { email, text } from "./lib/text";
import { staffRoleValidator } from "./lib/trust/staffSchema";
import { endSessionsOf } from "./support";

/** Whether the signed-in person is staff, and which kind. Everyone may ask about themselves. */
export const me = signedInQuery({
  args: {},
  handler: async (ctx) => {
    const found = await staffFor(ctx, ctx);
    if (!found) return null;
    if (found === "bootstrap") return { role: "admin" as const, name: ctx.name, email: ctx.email, capabilities: [...capabilitiesOf({ role: "admin" })] };
    return { role: found.role, name: found.name, email: found.email, capabilities: [...capabilitiesOf(found)] };
  },
});

export const list = staffQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("staff").take(200);
    return rows.filter((row) => row.status === "active").map((row) => ({ id: row._id, name: row.name, email: row.email, role: row.role, joined: Boolean(row.userId), addedAt: row.addedAt, granted: row.capabilities ?? [], capabilities: [...capabilitiesOf(row)] }));
  },
});

export const add = staffMutation({
  adminOnly: true,
  args: { email: v.string(), name: v.string(), role: staffRoleValidator },
  handler: async (ctx, args) => {
    const address = email(args.email);
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", address))
      .take(5);
    if (rows.some((row) => row.status === "active")) throw userError("That person is already staff.");
    return ctx.db.insert("staff", { email: address, name: text(args.name, "Name", 120), role: args.role, status: "active", addedAt: Date.now(), addedBy: ctx.staff._id });
  },
});

export const remove = staffMutation({
  adminOnly: true,
  args: { staffId: v.id("staff") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.staffId);
    if (!row || row.status !== "active") notFound();
    if (row._id === ctx.staff._id) throw userError("You cannot remove yourself. Ask another admin.");
    await ctx.db.patch(row._id, { status: "removed" });
    // Their support sessions stop now; every request in one checks the staff row again anyway.
    await endSessionsOf(ctx, row._id);
    await ctx.db.insert("staffAudit", { by: ctx.staff._id, staffId: row._id, kind: "removed", at: Date.now() });
    return null;
  },
});

/**
 * For whoever runs the deployment, from the command line only (`npx convex run staff:grant`). Adds a
 * staff member without anyone signed in, for example the first admins. Running it twice adds nothing.
 */
export const grant = internalMutation({
  args: { email: v.string(), name: v.string(), role: staffRoleValidator },
  handler: async (ctx, args) => {
    const address = email(args.email);
    const rows = await ctx.db
      .query("staff")
      .withIndex("by_email", (q) => q.eq("email", address))
      .take(5);
    const active = rows.find((row) => row.status === "active");
    if (active) return { staffId: active._id, added: false };
    const staffId = await ctx.db.insert("staff", { email: address, name: text(args.name, "Name", 120), role: args.role, status: "active", addedAt: Date.now(), addedBy: "console" });
    return { staffId, added: true };
  },
});

/** Grants one capability beyond the person's role (convex/lib/support/catalog.ts). Admins only, with a reason, recorded. */
export const grantCapability = staffMutation({
  adminOnly: true,
  args: { staffId: v.id("staff"), capability: capabilityValidator, reason: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.staffId);
    if (!row || row.status !== "active") notFound();
    const reason = text(args.reason, "The reason", 300);
    if (reason.length < 5) throw userError("Say why this person needs it.");
    const held = row.capabilities ?? [];
    if (held.includes(args.capability)) return null;
    await ctx.db.patch(row._id, { capabilities: [...held, args.capability] });
    await ctx.db.insert("staffAudit", { by: ctx.staff._id, staffId: row._id, kind: "granted", capability: args.capability, reason, at: Date.now() });
    return null;
  },
});

/** Takes a granted capability back. It stops working on the person's next request. */
export const revokeCapability = staffMutation({
  adminOnly: true,
  args: { staffId: v.id("staff"), capability: capabilityValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.staffId);
    if (!row) notFound();
    const held = row.capabilities ?? [];
    if (!held.includes(args.capability)) return null;
    await ctx.db.patch(row._id, { capabilities: held.filter((item) => item !== args.capability) });
    await ctx.db.insert("staffAudit", { by: ctx.staff._id, staffId: row._id, kind: "revoked", capability: args.capability, at: Date.now() });
    return null;
  },
});

/** Changes a staff member's role. Admins only, recorded. */
export const setRole = staffMutation({
  adminOnly: true,
  args: { staffId: v.id("staff"), role: staffRoleValidator },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.staffId);
    if (!row || row.status !== "active") notFound();
    if (row._id === ctx.staff._id && args.role !== "admin") throw userError("You cannot change your own role. Ask another admin.");
    await ctx.db.patch(row._id, { role: args.role });
    await ctx.db.insert("staffAudit", { by: ctx.staff._id, staffId: row._id, kind: "role", reason: args.role, at: Date.now() });
    return null;
  },
});
