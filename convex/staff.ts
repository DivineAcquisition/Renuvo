/**
 * Selestial staff membership. Only staff admins add or remove staff. Nothing here touches a cleaning
 * company's records.
 */
import { v } from "convex/values";

import { signedInQuery, staffFor, staffMutation, staffQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { email, text } from "./lib/text";
import { staffRoleValidator } from "./lib/trust/staffSchema";

/** Whether the signed-in person is staff, and which kind. Everyone may ask about themselves. */
export const me = signedInQuery({
  args: {},
  handler: async (ctx) => {
    const found = await staffFor(ctx, ctx);
    if (!found) return null;
    return found === "bootstrap" ? { role: "admin" as const, name: ctx.name, email: ctx.email } : { role: found.role, name: found.name, email: found.email };
  },
});

export const list = staffQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("staff").take(200);
    return rows.filter((row) => row.status === "active").map((row) => ({ id: row._id, name: row.name, email: row.email, role: row.role, joined: Boolean(row.userId), addedAt: row.addedAt }));
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
    return null;
  },
});
