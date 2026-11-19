/**
 * The customer's own pages: give feedback, describe an issue, review a proposed remedy, say whether a
 * correction worked, and manage a recurring service, without signing in.
 *
 * The link's token is the only authorization (convex/lib/builders.ts salesLinkQuery / salesLinkMutation,
 * kind "care"). No id in the arguments is trusted: everything read or changed hangs off the link's own
 * row, which names one company, one customer, and the one service, case or plan it is for.
 *
 * Opening a page changes nothing and is not recorded. Every change is a separate, explicit step that
 * names what the customer saw; a link that has expired, was closed, or does not list the action does
 * nothing. Ending or pausing service also asks for the ZIP code of the property. Each link may make a
 * limited number of changes in ten minutes. Everything a customer types is kept as their words and is
 * never treated as an instruction.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { localParts } from "./lib/availability";
import { salesLinkMutation, salesLinkQuery } from "./lib/builders";
import { readProfile } from "./lib/compliance/profile";
import { allow } from "./lib/rateLimit";
import { ACTION_WORDS, actionsOf, submitAction, whenWords } from "./lib/retention/actions";
import { addEntry, areasIn, cleanAreas, moveCase, openCase, propertyName, RETENTION, SYSTEM } from "./lib/retention/cases";
import { manageable, requestPlanChange } from "./lib/retention/continuity";
import { careLinkByPublicId, careLinkState, customerActor, noteCareAction } from "./lib/retention/links";
import { CHANGE_WORDS, loadPlan, previewPlanChange, upcomingVisits } from "./lib/retention/planChanges";
import { assess, customerAnswered, openRecovery, planRecovery, recordFeedback } from "./lib/retention/recovery";
import { PLAN_CHANGES } from "./lib/retention/schema";
import { retentionSettings } from "./lib/retention/settings";
import { literals } from "./lib/statuses";

type Link = { link: Doc<"retentionLinks">; company: Doc<"companies"> };
type Result = { ok: true; words: string } | { ok: false; why: string };

async function resolve(ctx: QueryCtx | MutationCtx, publicId: string): Promise<Link | null> {
  const link = await careLinkByPublicId(ctx, publicId);
  if (!link) return null;
  const company = await ctx.db.get(link.companyId);
  return company ? { link, company } : null;
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;
const no = (why: string): Result => ({ ok: false, why });

/** Refuses with words instead of throwing, so the count of attempts is kept. */
async function gate(ctx: MutationCtx, access: Link, action: string): Promise<string | null> {
  const { link, company } = access;
  const state = careLinkState(link, Date.now());
  if (state === "expired") return "This link has expired. Ask the company for a new one.";
  if (state === "revoked") return "This link is no longer active.";
  if (company.suspendedAt) return "This page is not available right now.";
  if (!link.allowed.includes(action)) return "This link cannot be used for that.";
  if (!(await allow(ctx, `care-link:${link._id}`, 20, 10 * 60_000))) return "Too many changes in a short time. Wait a few minutes and try again.";
  return null;
}

async function contact(ctx: QueryCtx | MutationCtx, company: Doc<"companies">) {
  const profile = await readProfile(ctx, company._id);
  return { name: profile.messaging.senderName ?? company.name, phone: profile.identity.supportPhone ?? null, email: profile.identity.supportEmail ?? null, timezone: company.timezone };
}

export const view = salesLinkQuery({
  kind: "care",
  resolve,
  args: {},
  handler: async (ctx) => {
    if (!ctx.link) return null;
    const { link, company } = ctx.link;
    const now = Date.now();
    const state = careLinkState(link, now);
    const who = await contact(ctx, company);
    // A closed link shows who to ask, and nothing about the customer, the property or the service.
    if (state !== "active" || company.suspendedAt) return { state: state === "active" ? ("revoked" as const) : state, purpose: link.purpose, company: who };
    const customer = await ctx.db.get(link.customerId);
    if (!customer) return null;
    const tz = company.timezone;
    const settings = retentionSettings(company);
    const property = link.propertyId ? await ctx.db.get(link.propertyId) : null;
    const job = link.jobId ? await ctx.db.get(link.jobId) : null;
    const row = link.caseId ? await ctx.db.get(link.caseId) : null;
    const base = {
      state: "active" as const,
      purpose: link.purpose,
      company: who,
      customerName: first(customer.name),
      // The property and the service this page is about, shown so the customer can see they have the right one.
      property: property ? { name: propertyName(property), city: property.address.city } : null,
      service: job ? { name: job.serviceSnapshot?.name ?? job.serviceType, when: whenWords(job.startsAt, tz), day: localParts(job.startsAt, tz).day } : null,
      expiresAt: link.expiresAt,
      allowed: link.allowed,
      // Everyone is shown the same public review page, whatever they answered.
      reviewUrl: settings.reviewUrl,
    };
    if (link.purpose === "feedback" || link.purpose === "issue") {
      const given = await ctx.db
        .query("retentionFeedback")
        .withIndex("by_company_link", (q) => q.eq("companyId", company._id).eq("linkId", link._id))
        .first();
      const reported = link.purpose === "issue" && link.lastAction === "describe_issue";
      return { ...base, feedback: { submitted: given !== null || reported, describedIssue: given?.issue !== undefined || reported, crewKnown: job !== null } };
    }
    if (link.purpose === "remedy") {
      const action = link.actionId ? await ctx.db.get(link.actionId) : null;
      if (!action || !row) return { ...base, remedy: null };
      const answered = link.lastAction === "accept_remedy" ? "accepted" : link.lastAction === "decline_remedy" ? "declined" : link.lastAction === "ask_about_remedy" ? "asked" : null;
      return {
        ...base,
        remedy: {
          what: ACTION_WORDS[action.kind],
          about: row.areas.join(", ") || "your recent service",
          when: action.visit?.startsAt ? whenWords(action.visit.startsAt, tz) : null,
          minutes: action.visit?.minutes ?? null,
          // A correction visit is never charged to the customer.
          charge: action.kind === "correction_visit" ? "No charge" : null,
          open: action.status === "proposed" && row.status !== "closed",
          answered,
          booked: action.status === "underway" || action.status === "done",
        },
      };
    }
    if (link.purpose === "confirm") {
      const answer = row?.verification?.customerAnswer?.answer ?? null;
      return { ...base, confirm: { about: row?.areas.join(", ") || "your recent service", answered: answer, closed: row?.status === "closed" } };
    }
    // manage
    const plan = link.plan ? await loadPlan(ctx, company._id, link.plan) : null;
    if (!plan || plan.customerId !== customer._id) return { ...base, manage: null };
    const today = localParts(now, tz).day;
    const visits = (await upcomingVisits(ctx, plan, today)).slice(0, 8);
    const offered = manageable(company, plan).filter((change) => link.allowed.includes(change));
    const paused = plan.state === "paused" || (plan.pausedFrom !== null && plan.pausedFrom <= today && (!plan.pausedUntil || today < plan.pausedUntil));
    const requests = (
      await ctx.db
        .query("retentionCases")
        .withIndex("by_company_customer", (q) => q.eq("companyId", company._id).eq("customerId", customer._id))
        .order("desc")
        .take(20)
    ).filter((c) => c.kind === "continuity" && c.plan?.id === link.plan!.id && c.origin === "customer_link");
    return {
      ...base,
      manage: {
        cadence: plan.cadence,
        service: plan.state === "ended" ? "Ended" : paused ? `Paused${plan.pausedUntil ? ` until ${plan.pausedUntil}` : ""}` : "Running",
        ended: plan.state === "ended",
        visits: visits.map((job) => ({ jobId: job._id, when: whenWords(job.startsAt, tz), day: localParts(job.startsAt, tz).day })),
        // Cancelling is listed with everything else, never behind it.
        changes: offered.map((change) => ({ id: change, words: CHANGE_WORDS[change], needsZip: change === "end_service" || change === "pause_service" })),
        canAskForCleaner: link.allowed.includes("request_different_cleaner"),
        requests: requests.slice(0, 5).map((c) => ({ title: c.title.split(": ").slice(1).join(": ") || c.title, status: c.status === "closed" ? (c.outcome?.code === "customer_cancelled" || c.outcome?.code === "plan_adjusted" || c.outcome?.code === "plan_resumed" ? "Done" : "Closed") : "Received. The office confirms it first.", at: c.createdAt })),
      },
    };
  },
});

/** What a plan change would do, shown before the customer confirms anything. Reading it changes nothing. */
export const planPreview = salesLinkQuery({
  kind: "care",
  resolve,
  args: { change: literals(PLAN_CHANGES), from: v.optional(v.string()), until: v.optional(v.string()), jobId: v.optional(v.id("jobs")), cadence: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!ctx.link) return null;
    const { link, company } = ctx.link;
    if (link.purpose !== "manage" || !link.plan || careLinkState(link, Date.now()) !== "active" || !link.allowed.includes(args.change)) return null;
    const plan = await loadPlan(ctx, company._id, link.plan);
    if (!plan || plan.customerId !== link.customerId) return null;
    return previewPlanChange(ctx, company, plan, args, true);
  },
});

const issueArg = v.object({ description: v.string(), areas: v.array(v.string()), wantsDifferentCleaner: v.boolean() });
const KEY = /^[\w-]{8,80}$/;

export const submitFeedback = salesLinkMutation({
  kind: "care",
  resolve,
  args: { rating: v.optional(v.number()), comment: v.optional(v.string()), issue: v.optional(issueArg), clientKey: v.string() },
  handler: async (ctx, args): Promise<Result> => {
    const { link, company } = ctx.link;
    // Feedback already given through this link is the answer, however the page is reloaded or the button tapped again.
    const given = await ctx.db
      .query("retentionFeedback")
      .withIndex("by_company_link", (q) => q.eq("companyId", company._id).eq("linkId", link._id))
      .first();
    if (given) return { ok: true, words: "We already have your feedback. Thank you." };
    const refusal = await gate(ctx, ctx.link, "submit_feedback");
    if (refusal) return no(refusal);
    if (!KEY.test(args.clientKey)) return no("Reload the page and try again.");
    const job = link.jobId ? await ctx.db.get(link.jobId) : null;
    if (!job || job.companyId !== company._id) return no("This link is not about a service.");
    if ((args.comment?.length ?? 0) > 2000 || (args.issue?.description.length ?? 0) > 2000) return no("That is too long. Please shorten it.");
    if (args.issue && !args.issue.description.trim()) return no("Tell us what was not right.");
    if (args.rating === undefined && !args.comment?.trim() && !args.issue) return no("Add a rating or a few words first.");
    const result = await recordFeedback(ctx, company, { job, link, source: "customer_link", rating: args.rating, comment: args.comment, issue: args.issue ? { ...args.issue, areas: cleanAreas(args.issue.areas) } : undefined, clientKey: `link:${link._id}:${args.clientKey}`, actor: customerActor(link) });
    if (result.repeated) return { ok: true, words: "We already have your feedback. Thank you." };
    await noteCareAction(ctx, link, args.issue ? "describe_issue" : "submit_feedback");
    return { ok: true, words: args.issue ? "Thank you. We have your description and someone will follow up about it." : "Thank you for telling us." };
  },
});

export const describeIssue = salesLinkMutation({
  kind: "care",
  resolve,
  args: { issue: issueArg, clientKey: v.string() },
  handler: async (ctx, args): Promise<Result> => {
    const refusal = await gate(ctx, ctx.link, "describe_issue");
    if (refusal) return no(refusal);
    const { link, company } = ctx.link;
    if (!KEY.test(args.clientKey)) return no("Reload the page and try again.");
    const description = args.issue.description.trim();
    if (!description) return no("Tell us what was not right.");
    if (description.length > 2000) return no("That is too long. Please shorten it.");
    const customer = (await ctx.db.get(link.customerId))!;
    const job = link.jobId ? await ctx.db.get(link.jobId) : null;
    const property = link.propertyId ? await ctx.db.get(link.propertyId) : job ? await ctx.db.get(job.propertyId) : null;
    // One description per link: a second tap or a reload adds nothing.
    if (link.lastAction === "describe_issue") return { ok: true, words: "We already have your description. Thank you." };
    const opened = await openRecovery(ctx, company, { customer, property, job, words: description, areas: cleanAreas([...args.issue.areas, ...areasIn(description)]), origin: "customer_link", wantsDifferentCleaner: args.issue.wantsDifferentCleaner, actor: customerActor(link) });
    // The question this answered is settled: the case goes back to a person or to its next step.
    if (!opened.created && opened.row.status === "waiting_on_customer") {
      const assessed = await assess(ctx, company, (await ctx.db.get(opened.row._id))!);
      for (const action of await actionsOf(ctx, assessed)) if (action.status === "proposed") await ctx.db.patch(action._id, { status: "cancelled", result: "The customer answered.", updatedAt: Date.now(), doneAt: Date.now() });
      await planRecovery(ctx, company, (await ctx.db.get(assessed._id))!, { wantsDifferentCleaner: args.issue.wantsDifferentCleaner });
    }
    await noteCareAction(ctx, link, "describe_issue");
    return { ok: true, words: "Thank you. We have your description and someone will follow up about it." };
  },
});

export const answerRemedy = salesLinkMutation({
  kind: "care",
  resolve,
  args: { answer: v.union(v.literal("accept"), v.literal("decline"), v.literal("ask")), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result> => {
    const which = args.answer === "accept" ? "accept_remedy" : args.answer === "decline" ? "decline_remedy" : "ask_about_remedy";
    const refusal = await gate(ctx, ctx.link, which);
    if (refusal) return no(refusal);
    const { link, company } = ctx.link;
    const note = args.note?.trim().slice(0, 1000) || undefined;
    const action = link.actionId ? await ctx.db.get(link.actionId) : null;
    const row = link.caseId ? await ctx.db.get(link.caseId) : null;
    if (!action || !row || action.companyId !== company._id || row.status === "closed") return no("This is no longer open. Contact the company if you still need help.");
    if (link.lastAction === "accept_remedy" || link.lastAction === "decline_remedy") return { ok: true, words: "We already have your answer. Thank you." };
    if (action.status !== "proposed") return no("This is no longer open. Contact the company if you still need help.");
    if (args.answer === "ask") {
      if (!note) return no("Write your question first.");
      await addEntry(ctx, row, { kind: "evidence", basis: "customer_stated", text: "The customer asked a question about the proposed remedy:", quote: note, actor: customerActor(link) });
      await moveCase(ctx, row, { status: "needs_attention", needs: "The customer asked a question about the proposed remedy. Answer it before anything is booked." }, SYSTEM);
      await noteCareAction(ctx, link, which);
      return { ok: true, words: "Thank you. Someone will answer your question." };
    }
    if (args.answer === "decline") {
      await ctx.db.patch(action._id, { status: "declined", result: `The customer declined${note ? `: ${note}` : "."}`.slice(0, 500), updatedAt: Date.now(), doneAt: Date.now() });
      await addEntry(ctx, row, { kind: "evidence", basis: "customer_stated", text: "The customer declined the proposed remedy.", quote: note, actor: customerActor(link) });
      await moveCase(ctx, row, { status: "needs_attention", doing: "Waiting for a person to decide the next step.", needs: "The customer declined the proposed remedy. Their concern is still open: decide what to offer instead." }, SYSTEM);
      await noteCareAction(ctx, link, which);
      return { ok: true, words: "Thank you for telling us. Someone will be in touch about another way to put it right." };
    }
    await addEntry(ctx, row, { kind: "evidence", basis: "customer_stated", text: "The customer accepted the proposed remedy.", quote: note, actor: customerActor(link) });
    await noteCareAction(ctx, link, which);
    // The customer's yes is not the company's approval: the remedy is still routed by the Owner's settings, and checked again.
    const routed = await submitAction(ctx, company, action._id, RETENTION);
    if (routed.status === "underway" || routed.status === "done") return { ok: true, words: action.visit?.startsAt ? `Thank you. Your visit is booked for ${whenWords(action.visit.startsAt, company.timezone)}.` : "Thank you. It is arranged." };
    const fresh = (await ctx.db.get(row._id))!;
    if (routed.status === "awaiting_approval") {
      await moveCase(ctx, fresh, { status: "needs_attention", needs: "The customer accepted the proposed remedy. Approve it to book it.", doing: "The customer said yes. The remedy is waiting for approval." }, SYSTEM);
      return { ok: true, words: "Thank you. The office is confirming it and will be in touch with the details." };
    }
    return { ok: true, words: "Thank you. That time is no longer open, so the office will be in touch with another." };
  },
});

export const confirmCorrection = salesLinkMutation({
  kind: "care",
  resolve,
  args: { answer: v.union(v.literal("resolved"), v.literal("not_resolved")), note: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Result> => {
    const refusal = await gate(ctx, ctx.link, "confirm_correction");
    if (refusal) return no(refusal);
    const { link } = ctx.link;
    const row = link.caseId ? await ctx.db.get(link.caseId) : null;
    if (!row) return no("This is no longer open.");
    if (row.verification?.customerAnswer) return { ok: true, words: "We already have your answer. Thank you." };
    if (row.status === "closed") return no("This was closed before your answer arrived. Contact the company if something is still not right.");
    if ((args.note?.length ?? 0) > 1000) return no("That is too long. Please shorten it.");
    await customerAnswered(ctx, row, args.answer, args.note?.trim() || undefined, customerActor(link));
    await noteCareAction(ctx, link, "confirm_correction");
    return { ok: true, words: args.answer === "resolved" ? "Thank you. We are glad it is put right." : "Thank you for telling us. Someone will follow up with you." };
  },
});

/**
 * A change to a recurring service, confirmed by the customer against the preview they were shown. The
 * confirmation is its own step: nothing happens on opening the page or on reading a preview.
 */
export const requestChange = salesLinkMutation({
  kind: "care",
  resolve,
  args: {
    change: literals(PLAN_CHANGES),
    from: v.optional(v.string()),
    until: v.optional(v.string()),
    jobId: v.optional(v.id("jobs")),
    cadence: v.optional(v.string()),
    preferred: v.optional(v.string()),
    /** The visits the preview listed. If the plan's visits have changed, nothing is done. */
    shown: v.array(v.id("jobs")),
    reason: v.optional(v.string()),
    /** The property's ZIP code, asked for before service is paused or ended. */
    zip: v.optional(v.string()),
    confirmed: v.literal(true),
  },
  handler: async (ctx, args): Promise<Result & { status?: string }> => {
    const refusal = await gate(ctx, ctx.link, args.change);
    if (refusal) return no(refusal);
    const { link, company } = ctx.link;
    if (link.purpose !== "manage" || !link.plan) return no("This link cannot be used for that.");
    if (args.change === "pause_billing") return no("Billing is changed by the company. Contact them about what is due.");
    const plan = await loadPlan(ctx, company._id, link.plan);
    if (!plan || plan.customerId !== link.customerId) return no("That service was not found.");
    if (!manageable(company, plan).includes(args.change)) return no("That change is not available for this service right now.");
    const DATE = /^\d{4}-\d{2}-\d{2}$/;
    if ((args.from && !DATE.test(args.from)) || (args.until && !DATE.test(args.until))) return no("Choose the dates again.");
    if ((args.reason?.length ?? 0) > 500 || (args.cadence?.length ?? 0) > 80 || (args.preferred?.length ?? 0) > 200) return no("That is too long. Please shorten it.");
    if (args.change === "end_service" || args.change === "pause_service") {
      const property = await ctx.db.get(plan.propertyId);
      const zip = (args.zip ?? "").replace(/\s/g, "").toUpperCase();
      if (!property || !zip || zip !== property.address.postalCode.replace(/\s/g, "").toUpperCase()) return no("That ZIP code does not match the service address. Check it and try again.");
    }
    const result = await requestPlanChange(ctx, company, { plan: link.plan, change: args.change, from: args.from, until: args.until, jobId: args.jobId, cadence: args.cadence?.trim() || undefined, preferred: args.preferred?.trim() || undefined, shown: args.shown as Id<"jobs">[], reason: args.reason?.trim() || undefined, requestedBy: "customer", actor: customerActor(link) });
    if (result.status === "refused" || result.status === "stale") return no(result.words);
    await noteCareAction(ctx, link, args.change);
    return { ok: true, status: result.status, words: result.status === "done" ? `Done. ${result.words}` : result.words };
  },
});

/** A request for a different cleaner. It is a request about a person, so a person reviews it. */
export const requestCleaner = salesLinkMutation({
  kind: "care",
  resolve,
  args: { note: v.string() },
  handler: async (ctx, args): Promise<Result> => {
    const refusal = await gate(ctx, ctx.link, "request_different_cleaner");
    if (refusal) return no(refusal);
    const { link, company } = ctx.link;
    const note = args.note.trim();
    if (note.length < 3) return no("Tell us a little about why, so the office can arrange it.");
    if (note.length > 1000) return no("That is too long. Please shorten it.");
    const customer = (await ctx.db.get(link.customerId))!;
    const property = link.propertyId ? await ctx.db.get(link.propertyId) : null;
    const opened = await openCase(ctx, { companyId: company._id, kind: "continuity", key: `cleaner-request:${link._id}`, status: "needs_attention", customer, property, plan: link.plan, title: `${customer.name}: asked for a different cleaner${property ? ` at ${propertyName(property)}` : ""}`, happened: `${customer.name} asked for a different cleaner.`, doing: "Waiting for a person to review the request.", needs: "Review the request and tell Dispatch who should not be sent. This is about scheduling only: it changes nothing about anyone's pay or standing.", origin: "customer_link", customerWords: note, dueAt: Date.now() + 2 * 24 * 60 * 60_000, actor: customerActor(link) });
    if (!opened.created) return { ok: true, words: "We already have your request. Thank you." };
    await addEntry(ctx, opened.row, { kind: "evidence", basis: "customer_stated", text: "The customer's request:", quote: note, actor: customerActor(link) });
    await noteCareAction(ctx, link, "request_different_cleaner");
    return { ok: true, words: "Thank you. The office will review your request and arrange it." };
  },
});
