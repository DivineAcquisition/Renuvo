/**
 * People inside a company. The Owner adds a person by email; that person joins by signing in with the
 * same, verified email. Nothing here trusts an email or a user id passed as an argument.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, ownerMutation, signedInMutation, signedInQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { grantableRoleValidator, roleOf } from "./lib/roles";
import { email, text } from "./lib/text";

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", ctx.companyId))
      .take(200);
    return rows
      .filter((row) => row.status !== "removed")
      .map((row) => ({ id: row._id, name: row.name, email: row.email, role: roleOf(row.role), status: row.status }));
  },
});

export const invite = ownerMutation({
  args: { email: v.string(), name: v.string(), role: grantableRoleValidator },
  handler: async (ctx, args) => {
    const address = email(args.email);
    const existing = await ctx.db
      .query("members")
      .withIndex("by_company_email", (q) => q.eq("companyId", ctx.companyId).eq("email", address))
      .take(5);
    if (existing.some((row) => row.status !== "removed")) throw userError("That person is already in this company or has been invited.");
    const memberId = await ctx.db.insert("members", { companyId: ctx.companyId, email: address, name: text(args.name, "Name", 120), role: args.role, status: "invited", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "member.invited", actor: byMember(ctx), subject: { table: "members", id: memberId }, data: { role: args.role } });
    return memberId;
  },
});

/** Invitations waiting for the signed-in person. Only for a verified email. */
export const invitations = signedInQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.emailVerified || !ctx.email) return [];
    const rows = await ctx.db
      .query("members")
      .withIndex("by_email_status", (q) => q.eq("email", ctx.email).eq("status", "invited"))
      .take(20);
    const out: { companyId: string; companyName: string; role: string }[] = [];
    for (const row of rows) {
      const company = await ctx.db.get(row.companyId);
      if (company) out.push({ companyId: company._id, companyName: company.name, role: roleOf(row.role) });
    }
    return out;
  },
});

export const join = signedInMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    // No invitation, a different email and an unverified email all look the same from outside.
    if (!ctx.emailVerified || !ctx.email) notFound();
    const rows = await ctx.db
      .query("members")
      .withIndex("by_company_email", (q) => q.eq("companyId", args.companyId).eq("email", ctx.email))
      .take(5);
    const invitation = rows.find((row) => row.status === "invited");
    if (!invitation) notFound();
    await ctx.db.patch(invitation._id, { userId: ctx.userId, status: "active" });
    await recordEvent(ctx, { companyId: args.companyId, type: "member.joined", actor: { kind: "member", memberId: invitation._id }, subject: { table: "members", id: invitation._id } });
    return invitation._id;
  },
});

export const setRole = ownerMutation({
  args: { memberId: v.id("members"), role: grantableRoleValidator },
  handler: async (ctx, args) => {
    const target = await owned(ctx, args.memberId);
    if (target.status === "removed") notFound();
    if (roleOf(target.role) === "owner") throw userError("The Owner's role cannot be changed here.");
    await ctx.db.patch(target._id, { role: args.role });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "member.role_changed", actor: byMember(ctx), subject: { table: "members", id: target._id }, data: { role: args.role } });
    return null;
  },
});

export const remove = ownerMutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const target = await owned(ctx, args.memberId);
    if (target.status === "removed") notFound();
    if (roleOf(target.role) === "owner") throw userError("The Owner cannot be removed.");
    await ctx.db.patch(target._id, { status: "removed" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "member.removed", actor: byMember(ctx), subject: { table: "members", id: target._id } });
    return null;
  },
});
