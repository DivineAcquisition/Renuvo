/**
 * Proposals for commercial, office and short-term rental work. Each sent version is frozen; the customer's
 * answer is bound to the exact version they saw. See convex/lib/sales/schema.ts.
 */
import { companyQuery } from "./lib/builders";
import type { ProposalStatus } from "./lib/sales/schema";

export const STATUS_WORDS: Record<ProposalStatus, string> = {
  draft: "Draft",
  ready: "Ready to send",
  sent: "Sent",
  changes_requested: "Changes requested",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
  superseded: "Replaced by a newer version",
};

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("proposals")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(100);
    const now = Date.now();
    const out = [];
    for (const row of rows) {
      const customer = await ctx.db.get(row.customerId);
      const version = row.latestVersion
        ? await ctx.db
            .query("proposalVersions")
            .withIndex("by_proposal_version", (q) => q.eq("proposalId", row._id).eq("version", row.latestVersion))
            .unique()
        : null;
      const status: ProposalStatus = row.status === "sent" && row.expiresAt !== undefined && row.expiresAt < now ? "expired" : row.status;
      out.push({
        _id: row._id,
        draftId: row.draftId ?? null,
        title: row.title,
        customer: customer?.name ?? "Client",
        template: row.template,
        status,
        statusWords: STATUS_WORDS[status],
        version: row.latestVersion,
        sites: Array.isArray((version?.content as { sites?: unknown[] } | undefined)?.sites) ? (version!.content as { sites: unknown[] }).sites.length : 0,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  },
});
