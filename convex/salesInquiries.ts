/**
 * The Sales agent, for the company's workspace: its overview, one opportunity it works, and what a person
 * does to such an opportunity by hand. Every number here is counted from the records at the moment of
 * asking and says what it counts and over what period. Nothing here sends a message: sending is
 * convex/lib/sales/actions.ts and the one outbox.
 *
 * Office works these alongside Owners and Managers. Changing the Playbook is the Owner's. The pipeline
 * board itself is convex/pipeline.ts; quotes and bookings are the workspace's (convex/sales.ts,
 * convex/bookings.ts), which the agent uses too.
 */
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { addressValidator } from "./schema";
import { activeRateCard } from "./lib/billing/rateCards";
import { companyMutation, companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { channelValidator } from "./lib/compliance/schema";
import { AGENT_PROFILES } from "./lib/departments";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { emailProvider } from "./lib/messaging/email";
import { senderGaps } from "./lib/messaging/policy";
import { messagingProvider } from "./lib/messaging/provider";
import { isManager, isOwner } from "./lib/roles";
import { ACTION_WORDS, openActions, quiet } from "./lib/sales/actions";
import { bookingReadiness } from "./lib/sales/agentBooking";
import { openFollowUps, planFollowUp, PURPOSE_WORDS } from "./lib/sales/agentFollowUps";
import { bump, currentQuote, entryProblem, handBackConversation, isOpen, load, ownedOpportunity, setNext, setStage, STAGE_WORDS, takeOverConversation, view, type Opp } from "./lib/sales/agentOpportunity";
import { openTimes, quoteTotal, quoteView } from "./lib/sales/agentQuotes";
import { agentStageValidator, lostReasonValidator, OPEN_STAGES, salesSettingsValidator, serviceKindValidator } from "./lib/sales/agentSchema";
import { accessFor, actionView, cardOf, checklistOf, KIND_WORDS, otherFacts, requirementsOf, SOURCE_WORDS, threadOf } from "./lib/sales/agentViews";
import { FACT_LABELS, withFact } from "./lib/sales/facts";
import { fileInquiry } from "./lib/sales/intake";
import { salesLinksConfigured } from "./lib/sales/links";
import { salesReaderName } from "./lib/sales/model";
import { canReach, ownMailbox } from "./lib/sales/outbox";
import { emailRepliesConfigured } from "./lib/sales/replyAddress";
import { activeRun, enqueueRun } from "./lib/sales/runs";
import { normalizeSales, salesSettings } from "./lib/sales/settings";
import { publishedCatalog } from "./lib/services/store";
import { optionalText, text } from "./lib/text";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const PERIOD_DAYS = 30;

/** The opportunities the agent works, newest first, in the pipeline's stages that hold these agent stages. */
async function agentOpportunities(ctx: QueryCtx, companyId: Id<"companies">, open: boolean, limit = 200): Promise<Opp[]> {
  const stages = open ? (["new", "qualifying", "quoting"] as const) : (["new", "qualifying", "quoting", "won", "lost"] as const);
  const out: Opp[] = [];
  for (const stage of stages) {
    const rows = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_stage", (q) => q.eq("companyId", companyId).eq("stage", stage))
      .order("desc")
      .take(limit);
    for (const row of rows) {
      const opp = row.intake ? view(row) : null;
      if (opp) out.push(opp);
    }
  }
  return out;
}

/** What the agent needs connected before it can do each part of its work, and whether each is in place. Never a made-up "ready". */
export const readiness = companyQuery({
  args: {},
  handler: async (ctx) => {
    const profile = await readProfile(ctx, ctx.companyId);
    const smsGaps = senderGaps(profile.messaging, "sms");
    const textingConnected = Boolean(messagingProvider());
    const emailConnected = Boolean((await ownMailbox(ctx, ctx.companyId)) || emailProvider());
    const emailGaps = senderGaps(profile.messaging, "email");
    const catalog = (await publishedCatalog(ctx, ctx.companyId)).filter((row) => row.service.status === "active");
    const experiences = await ctx.db
      .query("bookingExperiences")
      .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId))
      .take(20);
    const cleaners = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "ready"))
      .take(5);
    const reader = salesReaderName();
    const rate = activeRateCard()?.rates.sales_message_reading ?? null;
    return [
      { key: "services", label: "Published services", ok: catalog.length > 0, detail: catalog.length > 0 ? `${catalog.length} published. The agent quotes only from these.` : "No service is published, so the agent has nothing to quote from.", href: "/app/services", action: "Open Services & Pricing" },
      { key: "texting", label: "Text messages", ok: textingConnected && smsGaps.length === 0, detail: !textingConnected ? "Texting isn't connected for Selestial yet." : smsGaps.length > 0 ? smsGaps.map((gap) => gap.words).join(" ") : `Sends from ${profile.messaging.smsNumber}.`, href: "/app/settings/compliance", action: "Open texting setup" },
      { key: "email", label: "Email", ok: emailConnected && emailGaps.length === 0, detail: !emailConnected ? "Email isn't connected for Selestial yet." : emailGaps.length > 0 ? emailGaps.map((gap) => gap.words).join(" ") : `Sends as ${profile.messaging.senderName ?? ctx.company.name}.`, href: "/app/settings/compliance", action: "Open email setup" },
      { key: "replies", label: "Email replies", ok: emailRepliesConfigured(), detail: emailRepliesConfigured() ? "A customer's reply to the agent's email comes back to its conversation." : "Replies to the agent's emails are not routed back to Selestial on this deployment, so they go to your own address and the agent does not see them.", href: null, action: null },
      { key: "links", label: "Secure quote pages", ok: salesLinksConfigured(), detail: salesLinksConfigured() ? "Customers open their quote from a private link." : "Customer links aren't set up on this deployment, so a quote cannot be sent as a page yet.", href: null, action: null },
      { key: "forms", label: "Booking pages", ok: experiences.length > 0, detail: experiences.length > 0 ? `${experiences.length} booking ${experiences.length === 1 ? "experience" : "experiences"}. Inquiries can also arrive by text or be added by hand.` : "No booking page yet. Inquiries can still be added by hand or arrive by text.", href: "/app/agents/sales/booking-forms", action: "Open Booking Forms" },
      { key: "capacity", label: "Bookable capacity", ok: cleaners.length > 0, detail: cleaners.length > 0 ? "Ready cleaners are on record, so the agent can check whether a time is open." : "No cleaner is marked ready for work, so no time can be verified and nothing booked.", href: "/app/cleaners", action: "Open Cleaners" },
      { key: "reader", label: "Message reading", ok: true, detail: reader === "rules" ? "Messages are read by your company's rules. This uses no credits." : rate === null ? "An AI reader is connected, but it has no approved credit rate yet, so your company's rules read messages and nothing is charged." : `An AI reader reads each customer message (${rate} ${rate === 1 ? "credit" : "credits"} each); the rules read when credits cannot be held.`, href: "/app/settings/billing", action: null },
    ];
  },
});

export const overview = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const settings = salesSettings(ctx.company);
    const paused = ctx.company.pausedAgents.includes("sales");
    const open = (await agentOpportunities(ctx, ctx.companyId, true)).filter((row) => isOpen(row.agent.stage) || row.agent.stage === "deferred");
    const cards = await Promise.all(open.map((row) => cardOf(ctx, row)));
    const attention = cards.filter((card) => card.attention === "needs_review" || card.attention === "blocked" || card.attention === "taken_over").sort((a, b) => (a.nextAction?.dueAt ?? Infinity) - (b.nextAction?.dueAt ?? Infinity));
    const running = await ctx.db
      .query("salesRuns")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "running"))
      .take(20);
    const batch = await ctx.db
      .query("salesBatches")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "open"))
      .first();
    const batchWaiting = batch ? (await ctx.db.query("salesActions").withIndex("by_company_batch", (q) => q.eq("companyId", ctx.companyId).eq("batchId", batch._id)).take(100)).filter((row) => row.status === "prepared").length : 0;
    const followUps = await ctx.db
      .query("salesFollowUps")
      .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId).eq("status", "scheduled").lt("dueAt", args.asOf + DAY))
      .take(100);

    const won = (
      await ctx.db
        .query("salesOpportunities")
        .withIndex("by_company_stage", (q) => q.eq("companyId", ctx.companyId).eq("stage", "won"))
        .order("desc")
        .take(30)
    ).filter((row) => row.intake !== undefined);
    const recentBookings = [];
    for (const row of won.slice(0, 8)) {
      const booking = row.bookingId ? await ctx.db.get(row.bookingId) : null;
      const customer = row.customerId ? await ctx.db.get(row.customerId) : null;
      const job = booking?.jobId ? await ctx.db.get(booking.jobId) : null;
      const assignments = job ? await ctx.db.query("assignments").withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id)).take(20) : [];
      // The booking and the crew are two different facts. A visit with nobody accepted yet says so.
      recentBookings.push({ opportunityId: row._id, customer: customer?.name ?? "A customer", startsAt: booking?.slot.startsAt ?? null, priceCents: booking ? (booking.first?.priceCents ?? booking.priceCents) : null, bookingId: row.bookingId ?? null, recurring: booking?.kind === "recurring", wonAt: row.wonAt ?? row.updatedAt, crew: assignments.some((a) => a.status === "accepted") ? ("accepted" as const) : assignments.some((a) => a.status === "offered") ? ("offered" as const) : ("not_yet" as const) });
    }

    const actions = await ctx.db
      .query("salesActions")
      .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
      .order("desc")
      .take(14);
    const recentActions = [];
    for (const action of actions) recentActions.push(actionView(action, (await ctx.db.get(action.customerId))?.name ?? "A prospect"));

    // Measures: the inquiries received in the last 30 days, and how far each has come. The denominator is always those inquiries.
    const from = args.asOf - PERIOD_DAYS * DAY;
    const cohort = (
      await ctx.db
        .query("salesOpportunities")
        .withIndex("by_company_updated", (q) => q.eq("companyId", ctx.companyId).gt("updatedAt", from))
        .take(1000)
    ).filter((row) => row.intake !== undefined && row.createdAt > from);
    const responseMinutes = cohort.filter((row) => row.firstResponseAt !== undefined).map((row) => (row.firstResponseAt! - (row.receivedAt ?? row.createdAt)) / 60_000).sort((a, b) => a - b);
    let quotedValueCents = 0;
    let bookedValueCents = 0;
    for (const row of cohort) {
      const quote = row.quoteId ? await ctx.db.get(row.quoteId) : null;
      if (!quote) continue;
      if (quote.sentAt !== undefined) quotedValueCents += quoteTotal(quote);
      if (row.stage === "won" && quote.acceptance) bookedValueCents += quoteTotal(quote);
    }
    const lost = new Map<string, number>();
    for (const row of cohort) if (row.stage === "lost") lost.set(row.lostReason ?? "other", (lost.get(row.lostReason ?? "other") ?? 0) + 1);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_company_queued", (q) => q.eq("companyId", ctx.companyId).gt("queuedAt", from))
      .take(2000);
    const salesMessages = messages.filter((row) => row.opportunityId !== undefined);

    const needsYou = attention.length + (batchWaiting > 0 ? 1 : 0);
    const state = paused ? "paused" : running.length > 0 ? "working" : needsYou > 0 ? "needs_you" : cards.some((card) => card.nextAction?.by === "customer") ? "waiting" : "clear";
    return {
      built: AGENT_PROFILES.sales.built,
      paused,
      state,
      working: running.length,
      reader: salesReaderName(),
      firstBatch: settings.firstBatchDecidedAt === null ? { decided: false as const, waiting: batchWaiting } : { decided: true as const, at: settings.firstBatchDecidedAt },
      counts: {
        newInquiries: cards.filter((card) => card.stage === "new").length,
        awaitingDetails: cards.filter((card) => card.stage === "qualifying" && card.nextAction?.by === "customer").length,
        quotesForReview: cards.filter((card) => card.quote?.status === "awaiting_approval").length,
        quotesWithCustomer: cards.filter((card) => card.stage === "quote_sent").length,
        bookingPending: cards.filter((card) => card.stage === "booking_pending").length,
        followUpsDue: followUps.length,
        needsYou,
        open: cards.length,
      },
      attention: attention.slice(0, 12),
      recentBookings,
      recentActions,
      measures: {
        days: PERIOD_DAYS,
        inquiries: cohort.length,
        responded: responseMinutes.length,
        medianResponseMinutes: responseMinutes.length ? Math.round(responseMinutes[Math.floor((responseMinutes.length - 1) / 2)]) : null,
        qualified: cohort.filter((row) => row.qualifiedAt !== undefined).length,
        quotesSent: cohort.filter((row) => row.quotedAt !== undefined).length,
        quotesAccepted: cohort.filter((row) => row.acceptedAt !== undefined).length,
        bookings: cohort.filter((row) => row.stage === "won").length,
        quotedValueCents,
        bookedValueCents,
        lost: [...lost.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
        withPersonInvolved: cohort.filter((row) => (row.humanTouches ?? 0) > 0).length,
        messagesSent: salesMessages.filter((row) => row.status === "sent" || row.status === "delivered").length,
        deliveryFailures: salesMessages.filter((row) => row.status === "failed" || row.status === "unconfirmed").length,
      },
    };
  },
});

/** One opportunity the agent works, in full: the conversation, what it knows, what it prepared, its quote and booking, and its runs. */
export const opportunity = companyQuery({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const customer = await ctx.db.get(row.customerId);
    const property = row.propertyId ? await ctx.db.get(row.propertyId) : null;
    const card = await cardOf(ctx, row);
    const { requirements, serviceName } = await requirementsOf(ctx, row);
    const quote = await currentQuote(ctx, row);
    const actions = await ctx.db
      .query("salesActions")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", row._id))
      .order("desc")
      .take(30);
    const followUps = await ctx.db
      .query("salesFollowUps")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", row._id))
      .order("desc")
      .take(20);
    const runs = await ctx.db
      .query("salesRuns")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", row._id))
      .order("desc")
      .take(6);
    const booking = row.agent.stage === "booking_pending" || row.agent.stage === "won" || quote?.status === "accepted" ? await bookingReadiness(ctx, ctx.company, row) : null;
    const candidates = [];
    for (const id of row.match?.candidates ?? []) {
      const candidate = await ctx.db.get(id);
      if (candidate && candidate.companyId === ctx.companyId) candidates.push({ customerId: candidate._id, name: candidate.name, email: candidate.email ?? null, phone: candidate.phone ?? null });
    }
    const reach = customer ? await canReach(ctx, ctx.companyId, customer, row.agent.channel) : null;
    const others = customer ? (await ctx.db.query("salesOpportunities").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).take(20)).filter((other) => other._id !== row._id).map((other) => view(other)).filter((other): other is Opp => other !== null) : [];
    const services = (await publishedCatalog(ctx, ctx.companyId)).filter((item) => item.service.status === "active").map((item) => ({ key: item.service.key, name: item.version.spec.name }));
    const activeRunRow = await activeRun(ctx, row);
    const holder = row.agent.takeover?.by ? await ctx.db.get(row.agent.takeover.by) : null;
    return {
      card,
      customer: customer ? { customerId: customer._id, name: customer.name, email: customer.email ?? null, phone: customer.phone ?? null } : null,
      property: property ? { propertyId: property._id, address: property.address, access: accessFor(ctx.role, property.accessInstructions) } : null,
      source: row.intake ? { kind: row.intake.kind, words: SOURCE_WORDS[row.intake.kind], campaign: row.intake.campaign ?? null, medium: row.intake.medium ?? null, referrer: row.intake.referrer ?? null } : null,
      inquiry: row.inquiry ?? null,
      receivedAt: row.receivedAt ?? row.createdAt,
      kind: row.agent.kind,
      kindWords: KIND_WORDS[row.agent.kind],
      serviceKey: row.serviceKey ?? null,
      serviceName,
      services,
      timing: { text: row.timing?.text ?? null, slot: row.timing?.slot ?? null },
      checklist: checklistOf(row, requirements),
      otherFacts: otherFacts(row, requirements),
      match: { state: row.agent.match, candidates },
      reach: reach ? { ok: reach.ok, words: reach.ok ? null : reach.words, code: reach.ok ? null : reach.code, channel: row.agent.channel } : null,
      takeover: row.agent.takeover ? { by: holder?.name ?? "A team member", at: row.agent.takeover.at } : null,
      quote: quote ? quoteView(quote) : null,
      draftId: row.draftId ?? null,
      thread: await threadOf(ctx, row, 80),
      actions: actions.map((action) => actionView(action, customer?.name ?? "A prospect")),
      followUps: followUps.map((followUp) => ({ followUpId: followUp._id, purpose: followUp.purpose, purposeWords: PURPOSE_WORDS[followUp.purpose], attempt: followUp.attempt, maxAttempts: followUp.maxAttempts, dueAt: followUp.dueAt, status: followUp.status, reason: followUp.reason, preview: followUp.preview.replaceAll("{link}", "[quote link]"), stopReason: followUp.stopReason ?? null })),
      booking: booking ? { items: booking.items, ready: booking.ready, bookingId: booking.booking?._id ?? null, status: booking.booking?.status ?? null, agreementToPrepare: Boolean(booking.booking && booking.booking.requirements.agreement.state === "to_send" && !booking.booking.requirements.agreement.agreementId) } : null,
      runs: runs.map((run) => ({ runId: run._id, trigger: run.trigger, status: run.status, reader: run.reader ?? null, steps: run.steps, result: run.result ?? null, at: run.finishedAt ?? run.startedAt ?? run.createdAt })),
      working: activeRunRow?.status === "running",
      queued: activeRunRow?.status === "queued",
      outcome: row.agent.stage === "closed_lost" ? { kind: "lost" as const, reason: row.lostReason ?? null, note: row.closedReason ?? null, at: row.closedAt ?? row.updatedAt } : row.agent.stage === "won" ? { kind: "won" as const, reason: null, note: null, at: row.wonAt ?? row.updatedAt } : row.agent.stage === "deferred" ? { kind: "deferred" as const, reason: null, note: null, at: row.deferredUntil ?? row.updatedAt } : null,
      others: others.map((other) => ({ opportunityId: other._id, stage: other.agent.stage, stageWords: STAGE_WORDS[other.agent.stage], receivedAt: other.receivedAt ?? other.createdAt, title: other.title })),
      canManage: isManager(ctx.role),
      measures: { firstResponseMinutes: row.firstResponseAt !== undefined ? Math.round((row.firstResponseAt - (row.receivedAt ?? row.createdAt)) / 60_000) : null, humanTouches: row.agent.humanTouches },
    };
  },
});

/** A person adds an inquiry by hand for the agent to work. How the person agreed to be contacted is recorded only if the member says how. */
export const create = companyMutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    kind: serviceKindValidator,
    serviceKey: v.optional(v.string()),
    inquiry: v.string(),
    channel: channelValidator,
    /** How the person said they may be contacted on that channel, when a member knows. Absent: no permission is recorded, and the agent cannot message them. */
    consent: v.optional(v.object({ source: v.union(v.literal("verbal"), v.literal("paper_form"), v.literal("staff")), note: v.string() })),
    /** Chosen by the browser, so a double click adds one inquiry. */
    clientKey: v.string(),
  },
  handler: async (ctx, args) => {
    const name = text(args.name, "Name", 160);
    if (!args.email?.trim() && !args.phone?.trim() && !args.customerId) throw userError("Add an email address or a phone number so there is a way to reply.");
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.companyId !== ctx.companyId) throw userError("That customer isn't on record.");
    }
    const { opportunity, created } = await fileInquiry(ctx, ctx.company, {
      contact: { name, email: args.email, phone: args.phone },
      customerId: args.customerId,
      kind: args.kind,
      source: { kind: "manual" },
      inquiry: text(args.inquiry, "What they asked for", 4000),
      receivedAt: Date.now(),
      channel: args.channel,
      serviceKey: args.serviceKey,
      consent: args.consent ? [{ channel: args.channel, source: args.consent.source, evidence: text(args.consent.note, "How they agreed", 300) }] : [],
      dedupeKey: `manual:${ctx.member._id}:${args.clientKey.slice(0, 80)}`,
      actor: byMember(ctx),
    });
    if (created && opportunity.agent.match !== "needs_review") await enqueueRun(ctx, opportunity, { trigger: "inquiry", key: `inquiry:${opportunity._id}` });
    return { opportunityId: opportunity._id, created };
  },
});

/** Reviewed prospects brought in from a list. Each is filed without permission to contact: an imported contact is not consent. */
export const importProspects = managerMutation({
  args: { rows: v.array(v.object({ name: v.string(), email: v.optional(v.string()), phone: v.optional(v.string()), kind: serviceKindValidator, note: v.string() })) },
  handler: async (ctx, args) => {
    if (args.rows.length > 100) throw userError("Import up to 100 prospects at a time.");
    let added = 0;
    let existing = 0;
    for (const row of args.rows) {
      const name = row.name.trim().slice(0, 160);
      if (!name || (!row.email?.trim() && !row.phone?.trim())) continue;
      const key = `import:${name.toLowerCase()}:${(row.email ?? "").trim().toLowerCase()}:${(row.phone ?? "").replace(/[^\d]/g, "")}`;
      const { opportunity, created } = await fileInquiry(ctx, ctx.company, { contact: { name, email: row.email, phone: row.phone }, kind: row.kind, source: { kind: "import" }, inquiry: row.note.trim().slice(0, 2000) || "Imported open prospect.", receivedAt: Date.now(), channel: row.phone?.trim() ? "sms" : "email", dedupeKey: key.slice(0, 300), actor: byMember(ctx) });
      if (!created) {
        existing += 1;
        continue;
      }
      added += 1;
      await setNext(ctx, opportunity, { what: `${name} was imported. Record how they agreed to be contacted before the agent replies: an imported contact is not permission.`, by: "owner", dueAt: Date.now() + 3 * DAY }, byMember(ctx));
    }
    return { added, existing };
  },
});

/** Moves an opportunity the agent works. The stage's entry condition is checked whoever asks; "Won" follows a confirmed booking. */
export const move = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), to: agentStageValidator, reason: v.optional(lostReasonValidator), note: v.optional(v.string()), deferredUntil: v.optional(v.number()) },
  handler: async (ctx, args) => {
    let row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    if (args.to === row.agent.stage) return { ok: true as const, blockers: [] as string[] };
    if (args.to === "won") return { ok: false as const, blockers: ["Won follows a confirmed booking. The customer accepts the quote and the booking confirms when its steps are done."] };
    const problem = await entryProblem(ctx, row, args.to);
    if (problem) return { ok: false as const, blockers: [problem] };
    await ctx.db.patch(row._id, { humanTouches: row.agent.humanTouches + 1 });
    row = await load(ctx, row._id);
    if (args.to === "closed_lost" || args.to === "deferred") await quiet(ctx, row, args.to === "deferred" ? "The opportunity was deferred." : "The opportunity was closed.", byMember(ctx));
    row = await setStage(ctx, await load(ctx, row._id), args.to, byMember(ctx), { reason: args.reason, note: optionalText(args.note, "The note", 500), deferredUntil: args.deferredUntil });
    if (args.to === "deferred" && args.deferredUntil) {
      const customer = await ctx.db.get(row.customerId);
      const planned = await planFollowUp(ctx, ctx.company, row, { purpose: "deferred", attempt: 1, reason: `Deferred by a person until this date${args.note?.trim() ? `: ${args.note.trim().slice(0, 160)}` : "."}`, preview: `The agent will check back with ${customer?.name ?? "the customer"} once, then leave it with you.`, at: args.deferredUntil, actor: byMember(ctx) });
      await setNext(ctx, row, { what: "Check back once on the date chosen", by: "sales", dueAt: planned?.dueAt ?? args.deferredUntil }, byMember(ctx));
    } else if (isOpen(args.to)) {
      // A person moved it, so the agent looks at it again from where it now stands.
      row = await setNext(ctx, row, { what: "Pick up from the stage a person set", by: "sales", dueAt: Date.now() }, byMember(ctx));
      if (!row.agent.takeover) await enqueueRun(ctx, row, { trigger: "manual", key: `moved:${row._id}:${row.agent.revision}` });
    }
    return { ok: true as const, blockers: [] as string[] };
  },
});

/** A person takes the conversation. Everything the agent had planned or drafted stops in the same step. */
export const takeOver = companyMutation({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    await takeOverConversation(ctx, await ownedOpportunity(ctx, ctx.companyId, args.opportunityId), ctx.member);
    return null;
  },
});

/** Hands the conversation back. The agent reads where things stand now and takes the next step under its permissions. */
export const handBack = companyMutation({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    await handBackConversation(ctx, await ownedOpportunity(ctx, ctx.companyId, args.opportunityId), ctx.member);
    return null;
  },
});

/** Asks the agent to look at this opportunity now. It still does only what its permissions allow. */
export const work = companyMutation({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    if (!row.intake) throw userError("The agent works inquiries. This deal is run by hand.");
    if (row.agent.takeover) throw userError("You are handling this conversation. Hand it back first.");
    if (!isOpen(row.agent.stage)) throw userError("This opportunity is closed. Reopen it first.");
    if (ctx.company.pausedAgents.includes("sales")) throw userError("Sales is paused. Resume it in Settings, or handle this yourself.");
    const fresh = await bump(ctx, row);
    await enqueueRun(ctx, fresh, { trigger: "manual", key: `manual:${fresh._id}:${fresh.agent.revision}` });
    return null;
  },
});

/** A person says who the customer is: the same as someone on record, or a different person. */
export const resolveMatch = managerMutation({
  args: { opportunityId: v.id("salesOpportunities"), sameAs: v.union(v.id("customers"), v.null()) },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    if (row.agent.match !== "needs_review") return null;
    if (args.sameAs) {
      if (!(row.match?.candidates ?? []).includes(args.sameAs)) throw userError("Choose one of the customers listed.");
      const created = row.customerId;
      await ctx.db.patch(row._id, { customerId: args.sameAs, match: { state: "matched" }, humanTouches: row.agent.humanTouches + 1, revision: row.agent.revision + 1, updatedAt: Date.now() });
      for (const message of await ctx.db.query("salesMessages").withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", row._id)).take(200)) await ctx.db.patch(message._id, { customerId: args.sameAs });
      // The record made for the inquiry is set aside, not deleted, so nothing that points at it breaks.
      const leftover = await ctx.db.get(created);
      if (leftover && leftover._id !== args.sameAs) await ctx.db.patch(leftover._id, { status: "archived" });
    } else {
      await ctx.db.patch(row._id, { match: { state: "created" }, humanTouches: row.agent.humanTouches + 1, revision: row.agent.revision + 1, updatedAt: Date.now() });
    }
    await recordEvent(ctx, { companyId: ctx.companyId, type: "opportunity.match_resolved", actor: byMember(ctx), subject: { table: "salesOpportunities", id: row._id }, data: { same: args.sameAs !== null } });
    const fresh = await setNext(ctx, await load(ctx, row._id), { what: "Read the inquiry and reply", by: "sales", dueAt: Date.now() }, byMember(ctx));
    await enqueueRun(ctx, fresh, { trigger: "inquiry", key: `inquiry:${fresh._id}` });
    return null;
  },
});

/** A person corrects or adds what is known. A person's value is confirmed and is never overwritten by a reading of a message. */
export const setDetails = companyMutation({
  args: {
    opportunityId: v.id("salesOpportunities"),
    serviceKey: v.optional(v.string()),
    kind: v.optional(serviceKindValidator),
    channel: v.optional(channelValidator),
    timingText: v.optional(v.string()),
    facts: v.optional(v.array(v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean(), v.null()) }))),
  },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const now = Date.now();
    let facts = row.agent.facts;
    for (const input of args.facts ?? []) {
      const key = input.key.trim().slice(0, 80);
      if (!key) continue;
      if (input.value === null || input.value === "") facts = facts.filter((fact) => fact.key !== key);
      else facts = withFact(facts, { key, value: typeof input.value === "string" ? input.value.trim().slice(0, 300) : input.value, source: { kind: "member", ref: ctx.member._id }, status: "confirmed", at: now }).facts;
    }
    if (args.serviceKey !== undefined && args.serviceKey !== "" && !(await publishedCatalog(ctx, ctx.companyId)).some((item) => item.service.key === args.serviceKey)) throw userError("Choose a published service.");
    const fresh = await bump(ctx, row, {
      facts,
      ...(args.serviceKey !== undefined ? { serviceKey: args.serviceKey || undefined } : {}),
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.channel ? { channel: args.channel } : {}),
      ...(args.timingText !== undefined ? { timing: { ...row.timing, text: args.timingText.trim().slice(0, 300) || undefined } } : {}),
      humanTouches: row.agent.humanTouches + 1,
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "opportunity.details_changed", actor: byMember(ctx), subject: { table: "salesOpportunities", id: row._id }, data: { fields: (args.facts ?? []).map((fact) => FACT_LABELS[fact.key] ?? fact.key).join(", ").slice(0, 200) } });
    if (fresh.intake && !fresh.agent.takeover && isOpen(fresh.agent.stage) && fresh.agent.match !== "needs_review") await enqueueRun(ctx, fresh, { trigger: "manual", key: `details:${fresh._id}:${fresh.agent.revision}` });
    return null;
  },
});

/** Records where the service is, and how the team gets in. The address becomes a property on the customer's record. */
export const setProperty = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), propertyId: v.optional(v.id("properties")), address: v.optional(addressValidator), accessInstructions: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    let propertyId: Id<"properties"> | undefined = args.propertyId ?? row.propertyId;
    if (args.propertyId) {
      const property = await ctx.db.get(args.propertyId);
      if (!property || property.companyId !== ctx.companyId || property.customerId !== row.customerId) throw userError("That property belongs to a different customer.");
    } else if (args.address) {
      const address = { line1: text(args.address.line1, "Street address", 200), line2: optionalText(args.address.line2, "Address line 2", 200), city: text(args.address.city, "City", 100), region: text(args.address.region, "State or region", 60), postalCode: text(args.address.postalCode, "Postal code", 12).toUpperCase(), placeId: args.address.placeId, lat: args.address.lat, lng: args.address.lng };
      propertyId = await ctx.db.insert("properties", { companyId: ctx.companyId, customerId: row.customerId, address, kind: row.agent.kind === "commercial" ? "commercial" : row.agent.kind === "short_term_rental" ? "short_term_rental" : "home", accessInstructions: optionalText(args.accessInstructions, "Access instructions", 1000), status: "active", createdAt: Date.now() });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "property.created", actor: byMember(ctx), subject: { table: "properties", id: propertyId } });
    }
    if (!propertyId) throw userError("Enter the service address.");
    const property = (await ctx.db.get(propertyId))!;
    if (args.accessInstructions !== undefined && args.propertyId) await ctx.db.patch(propertyId, { accessInstructions: optionalText(args.accessInstructions, "Access instructions", 1000) });
    const facts = withFact(row.agent.facts, { key: "postalCode", value: property.address.postalCode.trim().toUpperCase(), source: { kind: "member", ref: ctx.member._id }, status: "confirmed", at: Date.now() }).facts;
    const fresh = await bump(ctx, row, { propertyId, facts, humanTouches: row.agent.humanTouches + 1 });
    if (fresh.draftId) {
      const draft = await ctx.db.get(fresh.draftId);
      if (draft && draft.status !== "confirmed" && draft.status !== "archived") await ctx.db.patch(draft._id, { propertyId, revision: draft.revision + 1, updatedAt: Date.now() });
    }
    if (fresh.intake && !fresh.agent.takeover && isOpen(fresh.agent.stage)) await enqueueRun(ctx, fresh, { trigger: "booking_change", key: `property:${fresh._id}:${fresh.agent.revision}` });
    return { propertyId };
  },
});

/** Times open now for the opportunity's quoted visit, for a person choosing one on the customer's behalf. */
export const times = companyQuery({
  args: { opportunityId: v.id("salesOpportunities") },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const quote = await currentQuote(ctx, row);
    if (!quote) return { slots: [] as { startsAt: number; endsAt: number }[], why: "A time is chosen once there is a quote, because the quote says how long the visit takes." };
    const slots = await openTimes(ctx, ctx.company, quote, 9);
    return { slots, why: slots.length ? null : "No time in the next two weeks is open for this visit. Try another day below, or check Dispatch's schedule." };
  },
});

/** A person chooses the time for a quote the customer accepted. The booking holds it when it is requested. */
export const setSlot = companyMutation({
  args: { opportunityId: v.id("salesOpportunities"), startsAt: v.number() },
  handler: async (ctx, args) => {
    const row = await ownedOpportunity(ctx, ctx.companyId, args.opportunityId);
    const quote = await currentQuote(ctx, row);
    if (!quote) throw userError("A time is chosen once there is a quote, because the quote says how long the visit takes.");
    if (row.bookingId) throw userError("The booking is already requested. Move its time from the booking.");
    if (args.startsAt < Date.now()) throw userError("That time has already passed.");
    const minutes = (quote.snapshot as { durationMinutes?: number | null } | null)?.durationMinutes ?? 120;
    const span = { startsAt: args.startsAt, endsAt: args.startsAt + minutes * 60_000 };
    const fresh = await bump(ctx, row, { timing: { ...row.timing, slot: span }, humanTouches: row.agent.humanTouches + 1 });
    if (fresh.intake && !fresh.agent.takeover && fresh.agent.stage === "booking_pending") await enqueueRun(ctx, fresh, { trigger: "booking_change", key: `slot:${fresh._id}:${fresh.agent.revision}` });
    return null;
  },
});

export const playbook = companyQuery({
  args: {},
  handler: async (ctx) => {
    const settings = salesSettings(ctx.company);
    const services = (await publishedCatalog(ctx, ctx.companyId)).map((item) => ({ key: item.service.key, name: item.version.spec.name, category: item.version.spec.category }));
    return { settings, services, canEdit: isOwner(ctx.role), actionWords: ACTION_WORDS };
  },
});

export const savePlaybook = ownerMutation({
  args: { expectedRevision: v.number(), settings: salesSettingsValidator },
  handler: async (ctx, args) => {
    const current = salesSettings(ctx.company);
    if (current.revision !== args.expectedRevision) throw userError("The Playbook was changed somewhere else. Reload to see the latest.");
    const next = normalizeSales(args.settings, current);
    await ctx.db.patch(ctx.companyId, { sales: next });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "sales.playbook_changed", actor: byMember(ctx), subject: { table: "companies", id: ctx.companyId }, data: { revision: next.revision ?? 0 } });
    return { revision: next.revision ?? 0 };
  },
});

/** What is waiting on a person across the agent's work, for the sidebar's badge. */
export const waiting = companyQuery({
  args: {},
  handler: async (ctx) => {
    const open = (await agentOpportunities(ctx, ctx.companyId, true, 100)).filter((row) => OPEN_STAGES.includes(row.agent.stage));
    let needsYou = 0;
    for (const row of open) if (row.agent.takeover || row.agent.next?.by === "owner" || row.agent.match === "needs_review" || (await openActions(ctx, row)).length > 0) needsYou += 1;
    const followUps = await Promise.all(open.slice(0, 50).map((row) => openFollowUps(ctx, row)));
    return { needsYou, open: open.length, followUps: followUps.flat().length };
  },
});

