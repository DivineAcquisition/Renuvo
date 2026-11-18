/**
 * The Sales pipeline: opportunities, each in one stage (new, qualifying, quoting, won, lost), with a
 * milestone inside the stage (assessment needed, proposal sent, agreement pending…), a responsible
 * person, the next action and when it is due. Prerequisites are milestones, never stages of their own.
 *
 * Follow-ups here are reminders to people, never messages to customers. They stop when the customer
 * declines, accepts or asks for changes (convex/proposals.ts), and pause when a person takes the deal
 * over. A customer who asked not to be contacted is never followed up.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, companyQuery } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { literals } from "./lib/statuses";
import { openTask } from "./lib/taskState";
import { quiet } from "./lib/sales/actions";
import { handBackConversation, takeOverConversation, view } from "./lib/sales/agentOpportunity";
import { MILESTONES, segmentValidator, STAGES } from "./lib/sales/schema";
import { cents, optionalText, text } from "./lib/text";

export const MILESTONE_WORDS: Record<(typeof MILESTONES)[number], string> = {
  assessment_needed: "Walkthrough needed",
  pricing_pending: "Pricing pending",
  quote_saved: "Quote saved",
  quote_sent: "Quote sent",
  proposal_ready: "Proposal ready",
  proposal_sent: "Proposal sent",
  changes_requested: "Changes requested",
  proposal_accepted: "Proposal accepted",
  agreement_pending: "Agreement pending",
  billing_pending: "Billing setup pending",
  ready_to_schedule: "Ready to schedule",
  booking_requested: "Booking requested",
  service_activated: "Service started",
  declined: "Declined",
  expired: "Expired",
  deferred: "Deferred",
};

async function describe(ctx: { db: import("./_generated/server").QueryCtx["db"] }, row: Doc<"salesOpportunities">) {
  const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
  const owner = row.ownerMemberId ? await ctx.db.get(row.ownerMemberId) : null;
  const draft = (
    await ctx.db
      .query("salesDrafts")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", row.companyId).eq("opportunityId", row._id))
      .order("desc")
      .take(1)
  )[0];
  return {
    _id: row._id,
    title: row.title,
    segment: row.segment,
    stage: row.stage,
    milestone: row.milestone ?? null,
    milestoneWords: row.milestone ? MILESTONE_WORDS[row.milestone] : null,
    customer: customer?.name ?? null,
    owner: owner?.name ?? null,
    nextAction: row.nextAction ?? null,
    nextActionAt: row.nextActionAt ?? null,
    estimateCents: row.estimateCents ?? null,
    followUps: row.followUps,
    source: row.source ?? null,
    draftId: draft?._id ?? null,
    /** The Sales agent works this deal: it came in as an inquiry. */
    agent: row.intake !== undefined,
    /** Who owes the next step on a deal the agent works. */
    nextBy: row.nextBy ?? null,
    updatedAt: row.updatedAt,
  };
}

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(300);
    const out = [];
    for (const row of rows) out.push(await describe(ctx, row));
    const since = Date.now() - 30 * 86_400_000;
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId).gte("updatedAt", since))
      .take(300);
    const quotes = await ctx.db
      .query("salesQuotes")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId).gte("createdAt", since))
      .take(300);
    const bookings = await ctx.db
      .query("bookings")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId).gte("createdAt", since))
      .take(300);
    return {
      opportunities: out,
      last30: {
        quotes: quotes.length,
        proposalsSent: proposals.filter((p) => p.sentVersion > 0).length,
        proposalsAccepted: proposals.filter((p) => p.status === "accepted").length,
        bookingsConfirmed: bookings.filter((b) => b.status === "confirmed").length,
        bookingsWaiting: bookings.filter((b) => b.status === "requested" || b.status === "awaiting").length,
      },
    };
  },
});

export const create = companyMutation({
  args: {
    title: v.string(),
    segment: segmentValidator,
    customerId: v.optional(v.id("customers")),
    source: v.optional(v.string()),
    estimateCents: v.optional(v.number()),
    nextAction: v.optional(v.string()),
    nextActionAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.customerId) await owned(ctx, args.customerId);
    const now = Date.now();
    const id = await ctx.db.insert("salesOpportunities", {
      companyId: ctx.companyId,
      title: text(args.title, "Title", 160),
      segment: args.segment,
      ...(args.customerId ? { customerId: args.customerId } : {}),
      stage: "new",
      ownerMemberId: ctx.member._id,
      nextAction: optionalText(args.nextAction, "Next action", 300) ?? "Call to qualify",
      nextActionAt: args.nextActionAt ?? now + 86_400_000,
      ...(args.source ? { source: text(args.source, "Source", 80) } : {}),
      ...(args.estimateCents !== undefined ? { estimateCents: cents(args.estimateCents, "Estimate") } : {}),
      followUps: "on",
      createdBy: ctx.member._id,
      createdAt: now,
      updatedAt: now,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "opportunity.created", actor: byMember(ctx), subject: { table: "salesOpportunities", id } });
    return id;
  },
});

export const update = companyMutation({
  args: {
    opportunityId: v.id("salesOpportunities"),
    stage: v.optional(literals(STAGES)),
    ownerMemberId: v.optional(v.id("members")),
    nextAction: v.optional(v.string()),
    nextActionAt: v.optional(v.union(v.number(), v.null())),
    closedReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.opportunityId);
    if (args.ownerMemberId) await owned(ctx, args.ownerMemberId);
    if ((args.stage === "lost" || args.stage === "won") && args.stage !== row.stage && args.stage === "lost" && !args.closedReason?.trim()) throw userError("Say why the deal was lost.");
    const closing = args.stage === "lost" || args.stage === "won";
    // A deal the agent works: closing it by hand also ends the agent's reminders and drafts.
    const agentDeal = row.intake ? view(row) : null;
    if (agentDeal && closing) await quiet(ctx, agentDeal, "A person closed the deal.", byMember(ctx));
    await ctx.db.patch(row._id, {
      ...(args.stage ? { stage: args.stage } : {}),
      ...(args.ownerMemberId ? { ownerMemberId: args.ownerMemberId } : {}),
      ...(args.nextAction !== undefined ? { nextAction: optionalText(args.nextAction, "Next action", 300) } : {}),
      ...(args.nextActionAt !== undefined ? { nextActionAt: args.nextActionAt ?? undefined } : {}),
      ...(args.closedReason ? { closedReason: text(args.closedReason, "Reason", 300) } : {}),
      ...(closing ? { followUps: "stopped" as const } : {}),
      updatedAt: Date.now(),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "opportunity.updated", actor: byMember(ctx), subject: { table: "salesOpportunities", id: row._id }, data: { stage: args.stage ?? row.stage } });
    return null;
  },
});

/** A person takes the deal over: they own it and automatic reminders pause until they hand it back. */
export const takeOver = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), resume: v.boolean() },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.opportunityId);
    if (row.followUps === "stopped") throw userError("This deal is closed.");
    // A deal the Sales agent works: taking it over also stops the agent's reminders and drafts, and handing it back wakes the agent.
    const agent = row.intake ? view(row) : null;
    if (agent) {
      if (args.resume) await handBackConversation(ctx, agent, ctx.member);
      else await takeOverConversation(ctx, agent, ctx.member);
      return null;
    }
    await ctx.db.patch(row._id, { ownerMemberId: ctx.member._id, followUps: args.resume ? "on" : "paused", updatedAt: Date.now() });
    return null;
  },
});

/** Opens a reminder task for each deal whose next action is due. Never messages the customer. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_followup_due", (q) => q.eq("followUps", "on").lte("nextActionAt", now))
      .take(100);
    for (const row of due) {
      // A deal the Sales agent works keeps its own task and its own customer reminders (convex/lib/sales/agent.ts).
      if (row.intake && row.nextBy !== "owner") continue;
      if (row.stage === "won" || row.stage === "lost") {
        await ctx.db.patch(row._id, { followUps: "stopped" });
        continue;
      }
      // A customer who asked not to be contacted is not followed up.
      const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
      const suppressed = customer?.email
        ? await ctx.db
            .query("suppressions")
            .withIndex("by_company_channel_address", (q) => q.eq("companyId", row.companyId).eq("channel", "email").eq("address", customer.email!.toLowerCase()))
            .first()
        : null;
      if (suppressed) {
        await ctx.db.patch(row._id, { followUps: "stopped", nextAction: "The customer asked not to be contacted." });
        continue;
      }
      await openTask(ctx, {
        companyId: row.companyId,
        agent: "sales",
        title: `Follow up: ${row.title}`,
        nextAction: row.nextAction ?? "Contact the customer about their quote or proposal.",
        dueAt: row.nextActionAt ?? now,
        completionCondition: "The next action is done and a new one is set, or the deal is closed.",
        ...(row.customerId ? { about: { table: "customers" as const, id: row.customerId } } : {}),
        key: `followup:${row._id}:${row.nextActionAt ?? 0}`,
        actor: { kind: "system" },
      });
      // One reminder per due time: the next comes when a person sets the next action.
      await ctx.db.patch(row._id, { nextActionAt: undefined });
    }
    return null;
  },
});
