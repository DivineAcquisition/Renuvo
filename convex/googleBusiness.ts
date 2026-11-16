/**
 * Google Business Profile reviews for the locations the Owner chose: reading them, drafting replies,
 * and publishing a reply only once an Owner or Manager approved that exact text. An assistant may draft;
 * it never publishes.
 *
 * Review requests are neutral: whether a customer may be asked depends only on a finished visit, a way to
 * reach them and how recently they were asked. It never depends on how happy they seem, because asking
 * only happy customers (review gating) is against Google's policy.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { accessTokenFor } from "./google";
import { companyQuery, managerMutation } from "./lib/builders";
import { notFound, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { setNotifications } from "./lib/google/business";
import { activeConnection, requireFeature } from "./lib/google/connection";
import { enqueue } from "./lib/google/jobs";
import { pubsubTopic } from "./lib/google/platform";
import { hashToken } from "./lib/recruiter/secrets";
import { openTask } from "./lib/taskState";
import { text } from "./lib/text";

const DAY = 86_400_000;
/** A customer is asked at most once in this long. */
export const REQUEST_COOLDOWN_DAYS = 120;
/** And only about a visit that finished this recently. */
export const REQUEST_WINDOW_DAYS = 14;

export const reviews = companyQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleReviews").withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId)).order("desc").take(100);
    return rows.map((r) => ({ _id: r._id, location: r.location, reviewer: r.reviewer, stars: r.stars, comment: r.comment ?? null, createdAt: r.createdAt, existingReply: r.existingReply ?? null, draft: r.draft ?? null, draftBy: r.draftBy ?? null, state: r.state, approvedText: r.approvedText ?? null, publishedAt: r.publishedAt ?? null, problem: r.problem ?? null }));
  },
});

export const syncReviews = managerMutation({
  args: {},
  handler: async (ctx) => {
    const connection = await requireFeature(ctx, ctx.companyId, "business_profile");
    return enqueue(ctx, { companyId: ctx.companyId, connectionId: connection._id, kind: "reviews_sync", key: `reviews_sync:${Math.floor(Date.now() / 60_000)}`, payload: {}, requestedBy: ctx.member._id });
  },
});

/** Saves a draft reply. A draft is only words in Selestial: nothing is posted. */
export const draftReply = managerMutation({
  args: { reviewId: v.id("googleReviews"), text: v.string() },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.companyId !== ctx.companyId) notFound();
    if (review.state === "publishing") throw userError("This reply is being published. Wait for it to finish.");
    await ctx.db.patch(review._id, { draft: text(args.text, "The reply", 4000), draftBy: "person", state: "drafted", problem: undefined });
    return null;
  },
});

/**
 * Approves this exact text and publishes it as the business's public reply. Approval names the text: if
 * the draft changes afterwards, it needs approving again.
 */
export async function approveAndQueue(ctx: MutationCtx, companyId: Id<"companies">, memberId: Id<"members">, reviewId: Id<"googleReviews">, words: string) {
  const connection = await requireFeature(ctx, companyId, "business_profile");
  const review = await ctx.db.get(reviewId);
  if (!review || review.companyId !== companyId) notFound();
  const location = (await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", companyId).eq("kind", "business_location")).take(50)).find((r) => r.externalId === review.location && r.access !== "lost");
  if (!location) throw userError("This location is no longer authorized for replies. The Owner chooses locations under Settings › Integrations (each Google card).");
  if (review.state === "publishing") throw userError("This reply is already being published.");
  const approved = text(words, "The reply", 4000);
  await ctx.db.patch(review._id, { draft: approved, approvedText: approved, approvedBy: memberId, state: "publishing", problem: undefined });
  const queued = await enqueue(ctx, { companyId, connectionId: connection._id, kind: "review_reply", key: `review_reply:${review._id}:${(await hashToken(approved)).slice(0, 24)}`, payload: { reviewId: review._id }, requestedBy: memberId });
  await recordEvent(ctx, { companyId, type: "google.review_reply_approved", actor: { kind: "member", memberId }, subject: { table: "companies", id: companyId }, data: { stars: review.stars } });
  return { ...queued, state: "publishing" as const };
}

/**
 * Approves this exact text and publishes it as the business's public reply. Approval names the text: if
 * the draft changes afterwards, it needs approving again.
 */
export const approveReply = managerMutation({
  args: { reviewId: v.id("googleReviews"), text: v.string() },
  handler: async (ctx, args) => approveAndQueue(ctx, ctx.companyId, ctx.member._id, args.reviewId, args.text),
});

/**
 * Whether a customer may be asked for a review now, and why. The same rule for every customer.
 */
export const requestEligibility = companyQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => {
    const customer = await ctx.db.get(args.customerId);
    if (!customer || customer.companyId !== ctx.companyId) notFound();
    const reasons: string[] = [];
    const locations = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.companyId).eq("kind", "business_location")).take(5);
    if (!locations.some((l) => l.access === "verified")) reasons.push("No Business Profile location is connected and verified.");
    const jobs = await ctx.db.query("jobs").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id)).order("desc").take(50);
    const recent = jobs.find((j) => j.status === "completed" && j.endsAt > Date.now() - REQUEST_WINDOW_DAYS * DAY);
    if (!recent) reasons.push(`No visit finished in the last ${REQUEST_WINDOW_DAYS} days.`);
    if (!customer.email && !customer.phone) reasons.push("There is no email or phone number to ask on.");
    if (customer.status !== "active") reasons.push("The customer is archived.");
    const asked = await ctx.db.query("events").withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.companyId).eq("subjectId", customer._id).gt("at", Date.now() - REQUEST_COOLDOWN_DAYS * DAY)).take(200);
    if (asked.some((e) => e.type === "google.review_requested")) reasons.push(`They were asked within the last ${REQUEST_COOLDOWN_DAYS} days.`);
    return { eligible: reasons.length === 0, reasons, visitId: recent?._id ?? null, rule: "Every customer with a finished visit is treated the same; how they rated the visit is never considered." };
  },
});

// ── For the worker ──────────────────────────────────────────────────────────────────────────────

export const forReply = internalQuery({
  args: { reviewId: v.id("googleReviews") },
  handler: async (ctx, args) => ctx.db.get(args.reviewId),
});

export const replyResult = internalMutation({
  args: { reviewId: v.id("googleReviews"), ok: v.boolean(), problem: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return null;
    if (args.ok) {
      await ctx.db.patch(review._id, { state: "published", publishedAt: Date.now(), existingReply: review.approvedText, problem: undefined });
      await recordEvent(ctx, { companyId: review.companyId, type: "google.review_reply_published", actor: { kind: "system" }, subject: { table: "companies", id: review.companyId }, data: { stars: review.stars } });
    } else await ctx.db.patch(review._id, { state: "failed", problem: args.problem });
    return null;
  },
});

/** A publish job that gave up leaves the review marked failed, never "publishing" forever. */
async function settleFailed(ctx: MutationCtx) {
  {
    const failed = await ctx.db.query("googleJobs").withIndex("by_status_next", (q) => q.eq("status", "failed")).order("desc").take(50);
    for (const job of failed) {
      if (job.kind !== "review_reply") continue;
      const reviewId = (JSON.parse(job.payload) as { reviewId?: Id<"googleReviews"> }).reviewId;
      const review = reviewId ? await ctx.db.get(reviewId) : null;
      if (review?.state === "publishing") await ctx.db.patch(review._id, { state: "failed", problem: job.lastError ?? "Google did not accept the reply." });
    }
  }
}

export const locationsFor = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "business_location")).take(20);
    return rows.filter((r) => r.access !== "lost" && r.detail).map((r) => ({ name: r.externalId, account: r.detail! }));
  },
});

export const storeReviews = internalMutation({
  args: { companyId: v.id("companies"), location: v.string(), reviews: v.array(v.object({ reviewName: v.string(), reviewer: v.string(), stars: v.number(), comment: v.optional(v.string()), createdAt: v.number(), existingReply: v.optional(v.string()) })) },
  handler: async (ctx, args) => {
    let added = 0;
    for (const review of args.reviews) {
      const existing = await ctx.db.query("googleReviews").withIndex("by_company_review", (q) => q.eq("companyId", args.companyId).eq("reviewName", review.reviewName)).unique();
      if (existing) {
        // Someone may have replied in Google directly; Selestial shows what is there and does not overwrite it.
        await ctx.db.patch(existing._id, { stars: review.stars, comment: review.comment, existingReply: review.existingReply, seenAt: Date.now() });
        continue;
      }
      await ctx.db.insert("googleReviews", { companyId: args.companyId, location: args.location, ...review, state: review.existingReply ? "published" : "new", seenAt: Date.now() });
      added += 1;
      if (!review.existingReply) {
        await openTask(ctx, {
          companyId: args.companyId,
          agent: "retention",
          title: `New ${review.stars}-star Google review from ${review.reviewer.slice(0, 60)}`,
          nextAction: "Read the review and draft a reply for approval. Nothing is posted until an Owner or Manager approves the exact text.",
          dueAt: Date.now() + (review.stars <= 3 ? 1 : 3) * DAY,
          completionCondition: "A reply is approved and published, or a person decided not to reply.",
          key: `google-review:${review.reviewName}`,
          actor: { kind: "system" },
        });
      }
    }
    return { added };
  },
});

export const notificationTargets = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const connection = await activeConnection(ctx, args.companyId, "business_profile");
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", args.companyId).eq("kind", "business_location")).take(20);
    const watches = await ctx.db.query("googleWatches").withIndex("by_company", (q) => q.eq("companyId", args.companyId)).take(20);
    const accounts = [...new Set(rows.filter((r) => r.access !== "lost" && r.detail).map((r) => r.detail!))];
    return connection?.status === "connected" ? { connectionId: connection._id, accounts: accounts.filter((a) => !watches.some((w) => w.kind === "business" && w.target === a && w.expiresAt > Date.now())) } : null;
  },
});

export const saveNotification = internalMutation({
  args: { companyId: v.id("companies"), connectionId: v.id("googleConnections"), account: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("googleWatches", { companyId: args.companyId, connectionId: args.connectionId, kind: "business", target: args.account, channelId: `business:${args.companyId}:${args.account}`, tokenHash: "pubsub-oidc", expiresAt: Date.now() + 30 * DAY, createdAt: Date.now() });
    return null;
  },
});

/** Asks Google to push review notifications to Selestial's Pub/Sub topic. Without a topic, the timer still reads reviews. */
export const ensureNotifications = internalAction({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<null> => {
    const topic = pubsubTopic();
    const targets = await ctx.runQuery(internal.googleBusiness.notificationTargets, args);
    if (!topic || !targets || targets.accounts.length === 0) return null;
    const access = await accessTokenFor(ctx, targets.connectionId);
    if (!access.ok) return null;
    for (const account of targets.accounts) {
      await setNotifications(access.token, account, topic);
      await ctx.runMutation(internal.googleBusiness.saveNotification, { companyId: args.companyId, connectionId: targets.connectionId, account });
    }
    return null;
  },
});

/** A Business Profile notification (already verified as from Google's Pub/Sub): read that location's reviews again. */
export const notified = internalMutation({
  args: { location: v.string() },
  handler: async (ctx, args) => {
    const id = args.location.replace(/^.*locations\//, "");
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind").take(2000);
    let queued = 0;
    for (const row of rows) {
      if (row.kind !== "business_location" || row.externalId.replace(/^.*locations\//, "") !== id) continue;
      const connection = await activeConnection(ctx, row.companyId, "business_profile");
      if (!connection || connection.status !== "connected") continue;
      await enqueue(ctx, { companyId: row.companyId, connectionId: connection._id, kind: "reviews_sync", key: `reviews_sync:push:${Math.floor(Date.now() / 60_000)}`, payload: {} });
      queued += 1;
    }
    return queued;
  },
});

/** Every hour: read reviews (so a missed notification is caught) and keep notifications set up. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("googleResources").withIndex("by_company_kind").take(2000);
    const companies = new Set<Id<"companies">>(rows.filter((r) => r.kind === "business_location").map((r) => r.companyId));
    const hour = Math.floor(Date.now() / 3_600_000);
    for (const companyId of companies) {
      const connection = await activeConnection(ctx, companyId, "business_profile");
      if (!connection || connection.status !== "connected") continue;
      await enqueue(ctx, { companyId, connectionId: connection._id, kind: "reviews_sync", key: `reviews_sync:auto:${hour}`, payload: {} });
      await enqueue(ctx, { companyId, connectionId: connection._id, kind: "business_watch", key: `business_watch:${Math.floor(hour / 24)}`, payload: {} });
    }
    await settleFailed(ctx);
    return companies.size;
  },
});
