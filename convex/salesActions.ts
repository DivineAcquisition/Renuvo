/**
 * What the Sales agent has prepared and is waiting on a person for: one draft at a time, or the first review
 * batch. Deciding here is the same decision as in the approvals queue, checked the same way at the
 * moment it is made. Nothing decided here changes a permission.
 */
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { normalAddress } from "./lib/compliance/recipients";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { batchPreview, batchRefusal, type BatchItem } from "./lib/messagingBilling/batch";
import { batchActions, decideAction, staleReason, syncBatchTask } from "./lib/sales/actions";
import { view } from "./lib/sales/agentOpportunity";
import { quotePer, quoteService, quoteTotal } from "./lib/sales/agentQuotes";
import { actionView } from "./lib/sales/agentViews";
import { salesSettings } from "./lib/sales/settings";

type Ctx = Parameters<Parameters<typeof companyQuery>[0]["handler"]>[0];

/** One waiting action as a person reviews it: who it goes to, what it says, which quote it carries, and what sending it does. */
async function reviewItem(ctx: Ctx, action: Doc<"salesActions">) {
  const customer = await ctx.db.get(action.customerId);
  const row = await ctx.db.get(action.opportunityId);
  const opportunity = row ? view(row) : null;
  const quote = action.quoteId ? await ctx.db.get(action.quoteId) : null;
  const to = action.channel ? normalAddress(action.channel, action.channel === "email" ? customer?.email : customer?.phone) : null;
  const stale = opportunity ? await staleReason(ctx, opportunity, action, "sales") : "The opportunity no longer exists.";
  const consequence =
    action.kind === "send_quote"
      ? "The customer gets a private link to this quote. Accepting it starts the booking steps; it does not confirm a booking."
      : action.kind === "booking_request"
        ? "The agent checks the time against capacity again and holds it. Payment and an agreement, when your Playbook asks for them, come next; then the booking is confirmed and handed to Dispatch."
        : action.kind === "follow_up"
          ? "One reminder goes out. If it is the last in its sequence and gets no answer, the opportunity comes back to you."
          : action.kind === "question"
            ? "The customer is asked for these details. A reminder is planned if they do not answer."
            : "The customer gets this reply.";
  return {
    ...actionView(action, customer?.name ?? "A prospect"),
    // The body as it will be edited: the link stays a placeholder until the message is sent.
    editable: action.body ?? "",
    recipient: { name: customer?.name ?? "A prospect", to, channel: action.channel ?? null },
    quote: quote ? { totalCents: quoteTotal(quote), per: quotePer(quote), service: quoteService(quote), depositCents: quote.depositCents ?? null } : null,
    consequence,
    stale,
  };
}

/** A link in a message is about this long once it is filled in; the estimate counts it. */
const LINK_STAND_IN = "https://app.selestial.com/q/xxxxxxxxxxxxxxxxxxxxxxxx";

/** The batch preview's view of a Sales draft: to whom, on which channel, the words as they will go, and why it can't go if it can't. */
async function batchItem(ctx: Ctx, action: Doc<"salesActions">, body: string | undefined, stale: string | null): Promise<BatchItem> {
  const customer = await ctx.db.get(action.customerId);
  const channel = action.channel ?? "sms";
  return {
    key: action._id,
    name: customer?.name ?? "A prospect",
    channel,
    to: action.channel ? normalAddress(channel, channel === "email" ? customer?.email : customer?.phone) : null,
    body: (body ?? action.body ?? "").replace("{link}", LINK_STAND_IN),
    intent: { category: "operational", origin: "agent", agent: "sales", recipient: { kind: "customer", id: action.customerId } },
    excluded: !action.channel || !(body ?? action.body) ? "Nothing to send: this step has no message." : stale,
    agent: true,
  };
}

/** Everything Sales has waiting on a person: the first batch if it has not been decided, and each draft on its own after that. */
export const waiting = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = salesSettings(ctx.company);
    const batch = await ctx.db
      .query("salesBatches")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open"))
      .first();
    const batchItems = batch ? (await batchActions(ctx, batch)).filter((row) => row.status === "prepared") : [];
    const pending = [];
    for (const status of ["awaiting_approval", "prepared"] as const) {
      const rows = await ctx.db
        .query("salesActions")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .order("desc")
        .take(60);
      pending.push(...rows.filter((row) => row.batchId === undefined || row.batchId !== batch?._id));
    }
    const reviewed = await Promise.all(batchItems.map((row) => reviewItem(ctx, row)));
    const preview = settings.firstBatchDecidedAt === null && batchItems.length ? await batchPreview(ctx, ctx.companyId, await Promise.all(batchItems.map((row, i) => batchItem(ctx, row, undefined, reviewed[i].stale)))) : null;
    return {
      firstBatch: settings.firstBatchDecidedAt === null ? { decided: false as const, batchId: batch?._id ?? null, items: reviewed, messaging: preview && ctx.role === "owner" ? publicPreview(preview) : null } : { decided: true as const, at: settings.firstBatchDecidedAt },
      pending: await Promise.all(pending.sort((a, b) => b.createdAt - a.createdAt).map((row) => reviewItem(ctx, row))),
      canDecide: ctx.role !== "office",
      ownerOnlyBatch: ctx.role !== "owner",
    };
  },
});

/** A person decides one draft: send it as written, send their edit of it, or set it aside. */
export const decide = managerMutation({
  args: { actionId: v.id("salesActions"), decision: v.union(v.literal("send"), v.literal("skip")), body: v.optional(v.string()), subject: v.optional(v.string()), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const action = await ctx.db.get(args.actionId);
    if (!action || action.companyId !== ctx.companyId) return { ok: false, detail: "Not found." };
    // The first batch is the Owner's to decide, as one review.
    if (action.batchId && salesSettings(ctx.company).firstBatchDecidedAt === null) throw userError("This is part of the agent's first review batch. The Owner decides it from the Sales overview.", "not_allowed");
    if (args.decision === "send" && args.body !== undefined && action.body?.includes("{link}") && !args.body.includes("{link}")) return { ok: false, detail: "Keep {link} in the message: it becomes the customer's quote link." };
    return decideAction(ctx, ctx.company, action, ctx.member, args.decision === "send" ? { kind: "send", body: args.body, subject: args.subject } : { kind: "skip", note: args.note });
  },
});

/**
 * The Owner decides the first review batch, item by item. Each item is checked again as it goes, so one
 * that can no longer be sent does not stop the others. Deciding the batch is what lets Sales act under
 * its permissions afterwards, and those permissions stay exactly as they are in Settings.
 */
export const decideBatch = ownerMutation({
  args: { batchId: v.id("salesBatches"), items: v.array(v.object({ actionId: v.id("salesActions"), decision: v.union(v.literal("send"), v.literal("skip")), body: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.companyId !== ctx.companyId) throw userError("Not found.", "not_found");
    if (batch.status === "decided") return { results: [], sent: 0, skipped: 0 };
    if (args.items.length > 100) throw userError("Decide up to 100 at a time.");
    const waiting = (await batchActions(ctx, batch)).filter((row) => row.status === "prepared");
    const chosen = new Map(args.items.map((item) => [item.actionId as string, item]));
    // Over the Owner's batch limit, nothing is sent: the Owner chooses fewer or raises the limit.
    const toSend = waiting.filter((action) => chosen.get(action._id)?.decision === "send");
    const preview = await batchPreview(ctx, ctx.companyId, await Promise.all(toSend.map((action) => batchItem(ctx, action, chosen.get(action._id)?.body, null))));
    const refusal = batchRefusal(preview);
    if (refusal) throw userError(refusal);
    // What the preview said can't be sent is set aside with its reason, so the count matches what the Owner saw.
    const cannot = new Map(preview.excluded.map((row) => [row.key, row.why]));
    const results: { actionId: string; ok: boolean; detail: string }[] = [];
    let sent = 0;
    let skipped = 0;
    for (const action of waiting) {
      const item = chosen.get(action._id);
      // Anything not named is set aside: nothing goes out that the Owner did not look at.
      const why = cannot.get(action._id);
      const outcome = await decideAction(ctx, ctx.company, action, ctx.member, item?.decision === "send" && !why ? { kind: "send", body: item.body } : { kind: "skip", note: why ?? (item ? undefined : "Not chosen in the first review.") });
      results.push({ actionId: action._id, ok: outcome.ok, detail: outcome.detail });
      if (why) results[results.length - 1] = { actionId: action._id, ok: false, detail: `Not sent: ${why}` };
      if (item?.decision === "send" && !why && outcome.ok) sent += 1;
      else skipped += 1;
    }
    const now = Date.now();
    await ctx.db.patch(batch._id, { status: "decided", decidedBy: ctx.member._id, decidedAt: now, sent, skipped });
    await ctx.db.patch(ctx.companyId, { sales: { ...ctx.company.sales, firstBatchDecidedAt: now } });
    await syncBatchTask(ctx, (await ctx.db.get(ctx.companyId))!, (await ctx.db.get(batch._id))!);
    await recordEvent(ctx, { companyId: ctx.companyId, type: "sales.first_batch_decided", actor: byMember(ctx), subject: { table: "salesBatches", id: batch._id }, data: { sent, skipped } });
    return { results, sent, skipped };
  },
});

/** What the page shows about a batch's messaging: no addresses, only names, counts, money and reasons. */
function publicPreview(preview: Awaited<ReturnType<typeof batchPreview>>) {
  return {
    words: preview.words,
    problem: preview.problem,
    eligible: preview.eligible.length,
    total: preview.total,
    excluded: preview.excluded.map((row) => ({ name: row.name, why: row.why })),
    segments: preview.segments,
    emails: preview.emails,
    cost: preview.cost,
    balance: preview.balance,
    covered: preview.covered,
    overLimit: preview.overLimit,
    metering: preview.metering,
    aiCredits: preview.aiCredits,
  };
}
