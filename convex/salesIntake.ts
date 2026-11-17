/**
 * Inquiries and replies that arrive by email. Whatever reads the company's mailbox calls `email` once
 * per message; the provider's own message id makes a message that is delivered twice one message.
 *
 * No customer mailbox reader is connected in this build (the Gmail reader is the hiring inbox's, and
 * reads hiring mail only), so this is the door a reader will use, exercised today by tests and by
 * sending the quote and replies out. See docs/sales/00-architecture.md.
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { normalAddress, recipientsAt } from "./lib/compliance/recipients";
import { AGENT_PROFILES } from "./lib/departments";
import { allow } from "./lib/rateLimit";
import type { Id } from "./_generated/dataModel";
import { fileInquiry, hasServiceHistory, openOpportunityFor, recordInbound } from "./lib/sales/intake";
import { SYSTEM } from "./lib/sales/opportunities";
import { enqueueRun } from "./lib/sales/runs";

const HOUR = 60 * 60_000;

export const email = internalMutation({
  args: { companyId: v.id("companies"), from: v.string(), fromName: v.optional(v.string()), subject: v.string(), text: v.string(), providerId: v.string(), receivedAt: v.number() },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    const from = normalAddress("email", args.from);
    if (!company || !from || !AGENT_PROFILES.sales.built) return { taken: false as const, why: "not_for_sales" };
    const known = await recipientsAt(ctx, company._id, "email", from);
    if (known.some((person) => person.kind !== "customer") || known.length > 1) return { taken: false as const, why: "not_a_prospect" };
    const body = args.text.trim().slice(0, 4000);
    const customerId = known[0] ? (known[0].id as Id<"customers">) : undefined;
    const open = customerId ? await openOpportunityFor(ctx, company._id, customerId) : null;
    if (open) {
      const { message, created } = await recordInbound(ctx, open, { channel: "email", body, subject: args.subject, providerId: args.providerId, at: args.receivedAt });
      if (!created) return { taken: true as const, why: "duplicate" };
      const fresh = (await ctx.db.get(open._id))!;
      if (!fresh.takeover) await enqueueRun(ctx, fresh, { trigger: "reply", key: `reply:${message._id}`, messageId: message._id });
      return { taken: true as const, why: "reply", opportunityId: open._id };
    }
    // Someone the company has already served, writing with no open request: that is Retention's conversation.
    if (customerId && (await hasServiceHistory(ctx, company._id, customerId))) return { taken: false as const, why: "existing_customer" };
    if (!(await allow(ctx, `sales-inquiry-email:${company._id}:${from}`, 5, HOUR))) return { taken: true as const, why: "limited" };
    const { opportunity, created } = await fileInquiry(ctx, company, {
      contact: { name: args.fromName?.trim() || known[0]?.name || "", email: from },
      customerId,
      kind: "residential",
      source: { kind: "email", externalId: args.providerId },
      inquiry: `${args.subject.trim() ? `${args.subject.trim()}\n` : ""}${body}`,
      receivedAt: args.receivedAt,
      channel: "email",
      consent: [{ channel: "email", source: "email_reply", evidence: "Emailed the company first to ask about service." }],
      dedupeKey: `email:${args.providerId.slice(0, 200)}`,
      providerId: args.providerId,
      actor: SYSTEM,
    });
    if (created && opportunity.match.state !== "needs_review") {
      const first = await ctx.db
        .query("salesMessages")
        .withIndex("by_company_opportunity", (q) => q.eq("companyId", company._id).eq("opportunityId", opportunity._id))
        .first();
      await enqueueRun(ctx, opportunity, { trigger: "inquiry", key: `inquiry:${opportunity._id}`, messageId: first?._id });
    }
    return { taken: true as const, why: created ? "inquiry" : "duplicate", opportunityId: opportunity._id };
  },
});
