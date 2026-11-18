/**
 * Conversations with people who asked about service, by text and email. Voice calls are not part of
 * Sales and nothing here pretends otherwise.
 *
 * A person writing to a customer takes the conversation in the same step: the agent stops its reminders
 * and sets aside its drafts, and sends nothing more until the conversation is handed back. That is what
 * keeps two voices from answering the same customer.
 */
import { v } from "convex/values";

import { companyMutation, companyQuery } from "./lib/builders";
import { channelValidator } from "./lib/compliance/schema";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { load, ownedOpportunity, setNext, STAGE_WORDS, takeOverConversation, view } from "./lib/sales/agentOpportunity";
import { cardOf } from "./lib/sales/agentViews";
import { canReach, deliveryWords, queueSalesMessage } from "./lib/sales/outbox";

const HOUR = 60 * 60_000;

/** Every conversation, newest activity first, with the last thing said and whether it reached the customer. */
export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = (
      await ctx.db
        .query("salesOpportunities")
        .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
        .order("desc")
        .take(300)
    )
      .map((row) => view(row))
      .filter((row): row is NonNullable<typeof row> => row !== null);
    const out = [];
    for (const row of rows) {
      const last = await ctx.db
        .query("salesMessages")
        .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", row._id))
        .order("desc")
        .first();
      if (!last) continue;
      const card = await cardOf(ctx, row);
      const sent = last.messageId ? await ctx.db.get(last.messageId) : null;
      out.push({
        opportunityId: row._id,
        customer: card.customer,
        service: card.service,
        stage: row.agent.stage,
        stageWords: STAGE_WORDS[row.agent.stage],
        attention: card.attention,
        attentionWords: card.attentionWords,
        channel: row.agent.channel,
        takenOver: card.takenOver,
        working: card.working,
        last: { direction: last.direction, author: last.author.kind, body: last.body.replaceAll("{link}", "[quote link]").slice(0, 160), at: last.at, delivery: sent ? deliveryWords(sent).state : null },
        // Unanswered: the customer spoke last.
        unanswered: (row.lastInboundAt ?? 0) > (row.lastOutboundAt ?? 0) && row.agent.stage !== "won" && row.agent.stage !== "closed_lost",
        at: Math.max(last.at, row.lastInboundAt ?? 0, row.lastOutboundAt ?? 0),
      });
    }
    return out.sort((a, b) => b.at - a.at);
  },
});

/** A person writes to the customer. It goes through the one sending policy like every message, and it takes the conversation. */
export const send = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), channel: channelValidator, subject: v.optional(v.string()), body: v.string(), clientKey: v.string() },
  handler: async (ctx, args) => {
    const opportunity = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const customer = await ctx.db.get(opportunity.customerId);
    if (!customer) throw userError("The customer record no longer exists.");
    const body = args.body.trim();
    if (body.length < 2) throw userError("Write the message first.");
    if (body.length > (args.channel === "sms" ? 1200 : 6000)) throw userError(args.channel === "sms" ? "Keep a text under 1,200 characters." : "Keep an email under 6,000 characters.");
    if (/\{link\}/.test(body)) throw userError("A quote link is added by sending the quote from the quote itself.");
    const reach = await canReach(ctx, ctx.companyId, customer, args.channel, byMember(ctx));
    if (!reach.ok && reach.code !== "quiet_hours") return { ok: false as const, detail: reach.words };
    const now = Date.now();
    // A person writing takes the conversation: the agent's reminders and drafts stop in the same step.
    if (!opportunity.agent.takeover) await takeOverConversation(ctx, opportunity, ctx.member);
    const held = await load(ctx, opportunity._id);
    await ctx.db.patch(opportunity._id, { humanTouches: held.agent.humanTouches + 1, channel: args.channel });
    const fresh = await load(ctx, opportunity._id);
    const message = await queueSalesMessage(ctx, { company: ctx.company, opportunity: fresh, customer, purpose: "sales_reply", channel: args.channel, subject: args.channel === "email" ? args.subject?.trim().slice(0, 200) || `Your request to ${ctx.company.name}` : undefined, body, links: [], dedupeKey: `sales-manual:${ctx.member._id}:${args.clientKey.slice(0, 80)}`, actor: byMember(ctx) });
    await setNext(ctx, await load(ctx, opportunity._id), { what: `You replied to ${customer.name}. Hand the conversation back to the agent when you are done.`, by: "owner", dueAt: now + 24 * HOUR }, byMember(ctx));
    return message.status === "not_sent" ? { ok: false as const, detail: message.problem ?? "The message could not be sent." } : { ok: true as const, detail: message.status === "held" ? (message.problem ?? "It goes when quiet hours end.") : "Sent." };
  },
});

/** A note for the team. It is never sent to the customer. */
export const note = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), body: v.string() },
  handler: async (ctx, args) => {
    const opportunity = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const body = args.body.trim();
    if (body.length < 2 || body.length > 2000) throw userError("Write a note of up to 2,000 characters.");
    await ctx.db.insert("salesMessages", { companyId: ctx.companyId, opportunityId: opportunity._id, customerId: opportunity.customerId, direction: "note", channel: "internal", author: { kind: "member", memberId: ctx.member._id }, body, at: Date.now() });
    return null;
  },
});
