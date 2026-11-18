/**
 * People inside a company. The Owner invites a person by email (convex/invitations.ts); that person
 * joins through the invitation link, or from here by signing in with the same, verified email. Nothing
 * here trusts an email or a user id passed as an argument.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { companyQuery, ownerMutation, signedInMutation, signedInQuery } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { invitationOfMember, invitationState, joinByInvitation, revokeInvitation } from "./lib/invitations";
import { grantableRoleValidator, roleOf } from "./lib/roles";

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

/** Invitations waiting for the signed-in person: pending and not expired. Only for a verified email. */
export const invitations = signedInQuery({
  args: {},
  handler: async (ctx) => {
    if (!ctx.emailVerified || !ctx.email) return [];
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_email_status", (q) => q.eq("email", ctx.email).eq("status", "pending").gt("expiresAt", Date.now()))
      .take(20);
    const out: { companyId: string; companyName: string; role: string }[] = [];
    for (const row of rows) {
      const company = await ctx.db.get(row.companyId);
      if (company) out.push({ companyId: company._id, companyName: company.name, role: roleOf(row.role) });
    }
    return out;
  },
});

/** Joining without the link: the signed-in person's verified email is the proof, as it is for the link. */
export const join = signedInMutation({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    // No invitation, an expired one, a different email and an unverified email all look the same from outside.
    if (!ctx.emailVerified || !ctx.email) notFound();
    const rows = await ctx.db
      .query("members")
      .withIndex("by_company_email", (q) => q.eq("companyId", args.companyId).eq("email", ctx.email))
      .take(50);
    const now = Date.now();
    for (const row of rows.filter((candidate) => candidate.status === "invited")) {
      const invitation = await invitationOfMember(ctx, row);
      if (!invitation || invitationState(invitation, now) !== "pending") continue;
      const joined = await joinByInvitation(ctx, invitation, ctx.userId, ctx.issuer);
      if (joined) return joined.memberId;
    }
    notFound();
  },
});

export const setRole = ownerMutation({
  args: { memberId: v.id("members"), role: grantableRoleValidator },
  handler: async (ctx, args) => {
    const target = await owned(ctx, args.memberId);
    if (target.status === "removed") notFound();
    if (roleOf(target.role) === "owner") throw userError("The Owner's role cannot be changed here.");
    await ctx.db.patch(target._id, { role: args.role });
    if (target.status === "invited") {
      // The role a person joins with is the invitation's, so a change made before they join is made there too.
      const invitation = await invitationOfMember(ctx, target);
      if (invitation && invitation.status === "pending") await ctx.db.patch(invitation._id, { role: args.role });
    }
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
    if (target.status === "invited") {
      // Removing someone who has not joined yet also ends their invitation, so its link opens nothing.
      const invitation = await invitationOfMember(ctx, target);
      if (invitation) await revokeInvitation(ctx, invitation, byMember(ctx));
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "member.removed", actor: byMember(ctx), subject: { table: "members", id: target._id } });
    return null;
  },
});
