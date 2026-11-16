/**
 * Selestial's own agreements with a company (convex/lib/compliance/agreements.ts). Any member can see
 * where the company stands; only the Owner accepts, and only the version in force.
 */
import { v } from "convex/values";

import { companyQuery, ownerMutation } from "./lib/builders";
import { acceptTerms, latestAcceptance } from "./lib/compliance/agreements";
import { currentVersion } from "./lib/trust/documents";

export const status = companyQuery({
  args: {},
  handler: async (ctx) => {
    const terms = currentVersion("terms");
    const latest = await latestAcceptance(ctx, ctx.companyId, "terms");
    const member = latest ? await ctx.db.get(latest.acceptedBy.memberId) : null;
    return {
      terms: {
        documentId: terms.id,
        title: terms.title,
        effectiveOn: terms.effectiveOn,
        latestAcceptance: latest ? { documentId: latest.documentId, acceptedByName: member?.name ?? "A former member", at: latest.at } : null,
        current: latest?.documentId === terms.id,
      },
    };
  },
});

export const accept = ownerMutation({
  args: { documentId: v.string() },
  handler: async (ctx, args) => {
    const result = await acceptTerms(ctx, { companyId: ctx.companyId, documentId: args.documentId, memberId: ctx.member._id, userId: ctx.identity.subject });
    return { acceptanceId: result.acceptanceId, alreadyAccepted: !result.created };
  },
});
