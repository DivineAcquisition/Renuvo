/**
 * Quotes, for the owner's workspace: the list, one quote with every version, and what a person does to
 * a quote by hand: prepare a version, add a discount, approve it, send it, withdraw it. The price is
 * always the pricing engine's; a person may take money off inside the rules in convex/lib/sales/quotes.ts
 * and may add a note. Nothing here edits a saved version.
 */
import { v } from "convex/values";

import { companyMutation, companyQuery, managerMutation } from "./lib/builders";
import { channelValidator } from "./lib/compliance/schema";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { prepareAction, quiet, REPLY_AND_QUOTE, sendAction, voiceOf } from "./lib/sales/actions";
import { currentQuote, isOpen, ownedOpportunity, setNext, setStage, STAGE_WORDS } from "./lib/sales/opportunities";
import { deliveryWords } from "./lib/sales/outbox";
import { approveVersion, discountProblem, pageState, priceOpportunity, reviewReason, saveQuoteVersion, sendProblem, versionOf, versionsOf, versionView } from "./lib/sales/quotes";
import { enqueueRun } from "./lib/sales/runs";
import { quoteMessage } from "./lib/sales/words";
import { formatCents } from "./lib/services/words";

const DAY = 24 * 60 * 60_000;

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const out = [];
    for (const status of ["awaiting_approval", "draft", "approved", "sent", "accepted", "declined", "expired", "revoked"] as const) {
      const rows = await ctx.db
        .query("salesQuotes")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", status))
        .order("desc")
        .take(60);
      for (const quote of rows) {
        const version = await versionOf(ctx, quote, quote.sentVersion ?? quote.currentVersion);
        const opportunity = await ctx.db.get(quote.opportunityId);
        const customer = await ctx.db.get(quote.customerId);
        if (!version || !opportunity) continue;
        out.push({
          quoteId: quote._id,
          opportunityId: quote.opportunityId,
          number: quote.number,
          customer: customer?.name ?? "A prospect",
          service: version.serviceName,
          status: quote.status,
          // "Sent" past its last day reads as expired even before the sweep marks it.
          state: quote.status === "sent" ? pageState(quote, Date.now()) : quote.status,
          version: version.version,
          versions: quote.currentVersion,
          totalCents: version.totalCents,
          per: version.per,
          validUntil: quote.validUntil ?? null,
          sentAt: quote.sentAt ?? null,
          acceptedAt: quote.acceptance?.at ?? null,
          hasQuestion: quote.question !== undefined,
          stage: opportunity.stage,
          stageWords: STAGE_WORDS[opportunity.stage],
          booked: opportunity.jobId !== undefined,
          updatedAt: quote.updatedAt,
        });
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const get = companyQuery({
  args: { quoteId: v.id("salesQuotes") },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.quoteId);
    if (!quote || quote.companyId !== ctx.companyId) return null;
    const versions = await versionsOf(ctx, quote);
    const customer = await ctx.db.get(quote.customerId);
    const opportunity = await ctx.db.get(quote.opportunityId);
    const messages = (await ctx.db.query("messages").withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", quote.opportunityId)).take(200)).filter((row) => row.salesQuoteId === quote._id);
    const current = versions.find((row) => row.version === quote.currentVersion) ?? null;
    return {
      quoteId: quote._id,
      opportunityId: quote.opportunityId,
      number: quote.number,
      status: quote.status,
      state: quote.status === "sent" ? pageState(quote, Date.now()) : quote.status,
      customer: customer ? { name: customer.name, email: customer.email ?? null, phone: customer.phone ?? null } : null,
      currentVersion: quote.currentVersion,
      sentVersion: quote.sentVersion ?? null,
      approvedVersion: quote.approvedVersion ?? null,
      approvedBy: quote.approvedBy === "rules" ? "The published pricing rules" : quote.approvedBy ? ((await ctx.db.get(quote.approvedBy))?.name ?? "A person") : null,
      validUntil: quote.validUntil ?? null,
      sentAt: quote.sentAt ?? null,
      acceptance: quote.acceptance ?? null,
      declined: quote.declined ?? null,
      revoked: quote.revoked ? { reason: quote.revoked.reason, at: quote.revoked.at } : null,
      question: quote.question ?? null,
      needsReview: current && opportunity && quote.approvedVersion !== current.version ? reviewReason(ctx.company, opportunity, current) : null,
      versions: versions.map((row) => ({ ...versionView(row), input: row.input, by: row.createdBy.kind === "agent" ? "Sales" : row.createdBy.kind === "member" ? "A person" : "Selestial" })),
      deliveries: messages.sort((a, b) => b.queuedAt - a.queuedAt).map((row) => ({ messageId: row._id, channel: row.channel ?? "sms", purpose: row.purpose, at: row.queuedAt, ...deliveryWords(row) })),
      stage: opportunity?.stage ?? null,
      booked: opportunity?.jobId !== undefined,
      channel: opportunity?.channel ?? "sms",
    };
  },
});

/** Prepares the next version from what is known now. A discount needs a reason, and a role that may give it. */
export const prepare = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), discount: v.optional(v.object({ cents: v.number(), reason: v.string() })), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const opportunity = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    if (!isOpen(opportunity.stage)) throw userError("This opportunity is closed. Reopen it to quote.");
    const existing = await currentQuote(ctx, opportunity);
    if (existing?.status === "accepted") throw userError("The customer already accepted a quote. A change now is a new conversation with them, not a silent edit.");
    const priced = await priceOpportunity(ctx, ctx.company, opportunity);
    if (priced.kind === "no_service") throw userError("Choose a published service for this opportunity first.");
    if (priced.kind === "incomplete") throw userError(`The price still needs: ${priced.missing.join(", ")}.`);
    if (priced.kind === "walkthrough") throw userError(`${priced.reasons.join(" ")} This service is quoted after a walkthrough, so it cannot be priced from answers.`);
    if (args.discount) {
      const problem = discountProblem(ctx.company, ctx.role, args.discount, { cleaningCents: priced.result.cleaningCents, totalCents: priced.result.totalCents, minimumCents: priced.version.spec.modifiers.minimumCents });
      if (problem) throw userError(problem);
    }
    await ctx.db.patch(opportunity._id, { humanTouches: opportunity.humanTouches + 1 });
    const saved = await saveQuoteVersion(ctx, ctx.company, (await ctx.db.get(opportunity._id))!, priced, byMember(ctx), { discount: args.discount ? { ...args.discount, approvedBy: ctx.member._id } : undefined, note: args.note });
    let fresh = (await ctx.db.get(opportunity._id))!;
    if (fresh.stage === "new" || fresh.stage === "qualifying") fresh = await setStage(ctx, fresh, "quote_ready", byMember(ctx));
    await setNext(ctx, fresh, { what: `Review and send quote Q-${saved.quote.number} (${formatCents(saved.version.totalCents)})`, by: "owner", dueAt: Date.now() + DAY }, byMember(ctx));
    return { quoteId: saved.quote._id, version: saved.version.version, created: saved.created };
  },
});

/** Approves one exact version to go out. A different version, or a changed total, needs its own approval. */
export const approve = managerMutation({
  args: { quoteId: v.id("salesQuotes"), version: v.number(), hash: v.string() },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.quoteId);
    if (!quote || quote.companyId !== ctx.companyId) return null;
    const version = await versionOf(ctx, quote, args.version);
    if (!version || version.hash !== args.hash || quote.currentVersion !== args.version) throw userError("This quote changed since you opened it. Review the current version.");
    if (quote.status === "accepted" || quote.status === "revoked" || quote.status === "declined") throw userError(`This quote was already ${quote.status}.`);
    if (quote.approvalId) {
      const approval = await ctx.db.get(quote.approvalId);
      if (approval?.status === "pending") {
        await ctx.db.patch(approval._id, { status: "approved", decidedBy: ctx.member._id, decidedAt: Date.now(), carriedOut: { ok: true, detail: "Approved on the quote.", at: Date.now() } });
        await recordEvent(ctx, { companyId: ctx.companyId, type: "approval.approved", actor: byMember(ctx), subject: { table: "approvals", id: approval._id }, data: { action: approval.action } });
      }
      await ctx.db.patch(quote._id, { approvalId: undefined });
    }
    await approveVersion(ctx, (await ctx.db.get(quote._id))!, args.version, ctx.member._id, byMember(ctx));
    return null;
  },
});

/** A person sends the approved version, in their own words or the template's. It goes out as theirs. */
export const send = managerMutation({
  args: { quoteId: v.id("salesQuotes"), version: v.number(), channel: v.optional(channelValidator), body: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.quoteId);
    if (!quote || quote.companyId !== ctx.companyId) return { ok: false, detail: "Not found." };
    const version = await versionOf(ctx, quote, args.version);
    const problem = sendProblem(quote, version);
    if (problem || !version) return { ok: false, detail: problem ?? "The quote has no saved version." };
    let opportunity = (await ctx.db.get(quote.opportunityId))!;
    const customer = await ctx.db.get(quote.customerId);
    if (args.channel && args.channel !== opportunity.channel) await ctx.db.patch(opportunity._id, { channel: args.channel });
    await ctx.db.patch(opportunity._id, { humanTouches: opportunity.humanTouches + 1 });
    opportunity = (await ctx.db.get(opportunity._id))!;
    const validUntil = new Intl.DateTimeFormat("en-US", { timeZone: ctx.company.timezone, month: "short", day: "numeric" }).format(new Date(Date.now() + version.validDays * DAY));
    const body = args.body?.trim() || quoteMessage(customer?.name ?? "", await voiceOf(ctx, ctx.company, opportunity), { service: version.serviceName, totalCents: version.totalCents, per: version.per, estimate: version.outcome === "estimate", validUntil, depositCents: version.depositCents });
    if (!body.includes("{link}")) return { ok: false, detail: "Keep {link} in the message: it becomes the customer's quote link." };
    const action = await prepareAction(ctx, ctx.company, opportunity, { kind: "send_quote", channel: opportunity.channel, subject: `Your quote from ${ctx.company.name}`, body, quote: { quoteId: quote._id, version: version.version }, summary: `Send ${customer?.name ?? "the customer"} the quote: ${formatCents(version.totalCents)} for ${version.serviceName}.`, reason: "Sent by a person from the quote.", evidence: [{ label: "Quote", detail: `Q-${quote.number} version ${version.version}` }], permission: REPLY_AND_QUOTE, writtenBy: "rules" });
    await ctx.db.patch(action._id, { decidedBy: ctx.member._id, ...(args.body?.trim() ? { editedBy: ctx.member._id } : {}) });
    // A person is sending, so a person holding the conversation does not block it.
    return sendAction(ctx, ctx.company, opportunity, (await ctx.db.get(action._id))!, byMember(ctx));
  },
});

/** Withdraws a quote that has not been accepted. Its link then says it was withdrawn, and nothing more is sent about it. */
export const revoke = managerMutation({
  args: { quoteId: v.id("salesQuotes"), reason: v.string() },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.quoteId);
    if (!quote || quote.companyId !== ctx.companyId) return null;
    if (quote.status === "accepted") throw userError("The customer accepted this quote, so it cannot be withdrawn. Talk to the customer and close or change the booking instead.");
    if (quote.status === "revoked") return null;
    const reason = args.reason.trim();
    if (reason.length < 3) throw userError("Say why the quote is being withdrawn.");
    const now = Date.now();
    await ctx.db.patch(quote._id, { status: "revoked", revoked: { reason: reason.slice(0, 300), by: ctx.member._id, at: now }, updatedAt: now });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "quote.revoked", actor: byMember(ctx), subject: { table: "salesQuotes", id: quote._id } });
    const opportunity = await ctx.db.get(quote.opportunityId);
    if (opportunity && isOpen(opportunity.stage)) {
      await quiet(ctx, opportunity, "The quote was withdrawn.", byMember(ctx));
      let fresh = (await ctx.db.get(opportunity._id))!;
      await ctx.db.patch(fresh._id, { humanTouches: fresh.humanTouches + 1 });
      if (fresh.stage === "quote_ready" || fresh.stage === "quote_sent") fresh = await setStage(ctx, (await ctx.db.get(fresh._id))!, "qualifying", byMember(ctx));
      await setNext(ctx, fresh, { what: "The quote was withdrawn. Prepare a new one, or close the opportunity.", by: "owner", dueAt: now + DAY }, byMember(ctx));
    }
    return null;
  },
});

/** A person answers the question a customer left on the quote page: it is cleared once Sales or they have replied. */
export const clearQuestion = companyMutation({
  args: { quoteId: v.id("salesQuotes") },
  handler: async (ctx, args) => {
    const quote = await ctx.db.get(args.quoteId);
    if (!quote || quote.companyId !== ctx.companyId) return null;
    await ctx.db.patch(quote._id, { question: undefined, updatedAt: Date.now() });
    const opportunity = await ctx.db.get(quote.opportunityId);
    if (opportunity && !opportunity.takeover && isOpen(opportunity.stage)) await enqueueRun(ctx, opportunity, { trigger: "manual", key: `question-cleared:${quote._id}:${Date.now()}` });
    return null;
  },
});
