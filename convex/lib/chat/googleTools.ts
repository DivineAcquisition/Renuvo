/**
 * Chat's tools for Google. Each is thin: it calls the same functions Settings › Google uses, as the
 * member chatting, with their role and the agent's permission as they are right now. Reads return the
 * records Selestial holds (as last read from Google, with when). Writes return the job that will carry
 * them out: a queued export, draft or reply is reported as queued or drafted, never as done.
 */
import type { Id } from "../../_generated/dataModel";
import { approveAndQueue } from "../../googleBusiness";
import { createDraft } from "../../googleAds";
import { queueAgreementExport } from "../../googleDrive";
import { authorityFor } from "../authority";
import { activeConnection, requireFeature } from "../google/connection";
import { enabledFeatures, FEATURE_INFO, FEATURES } from "../google/features";
import { enqueue } from "../google/jobs";
import { allow } from "../rateLimit";
import { localParts } from "../availability";
import { type Field, stableHash } from "./fields";
import type { ChatTool, Outcome, ToolCtx } from "./tools";

const ID = (description: string): Field => ({ type: "string", description, max: 64 });
const refused = (why: string, data?: Record<string, unknown>): Outcome => ({ status: "refused", why, data });
const say = (error: unknown, fallback: string) => (error as { data?: { message?: string } }).data?.message ?? fallback;
const SETTINGS = { href: "/app/settings/google", label: "Open Settings › Google" };
const when = (at: number, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(at));

async function paced(ctx: ToolCtx, what: string): Promise<boolean> {
  return allow(ctx, `chat.google:${ctx.company._id}:${what}`, 20, 60 * 60 * 1000);
}

async function agentMay(ctx: ToolCtx, action: string, agentName: string): Promise<Outcome | null> {
  const authority = await authorityFor(ctx, ctx.company._id, action);
  if (authority.kind === "paused") return refused(`${agentName} is paused, so it cannot do this now.`);
  if (authority.kind !== "level" || authority.level === "off") return refused(`${agentName} is not allowed to do this (the permission is off in Agent permissions).`);
  return null;
}

export const GOOGLE_TOOLS: ChatTool[] = [
  {
    name: "google_status",
    label: "Checking the Google connection",
    description: "Which Google features the company granted, which files, calendars, locations and ad accounts the Owner authorized (and whether Selestial confirmed access), and Google work that failed or is uncertain.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      const connection = await activeConnection(ctx, ctx.company._id);
      if (!connection) return { status: "done", summary: "Google is not connected", data: { connected: false, note: "The Owner connects Google under Settings › Google." }, link: SETTINGS };
      const granted = enabledFeatures(connection.grantedScopes);
      const resources = await ctx.db.query("googleResources").withIndex("by_connection", (q) => q.eq("connectionId", connection._id)).take(100);
      const problems = [...(await ctx.db.query("googleJobs").withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "failed")).order("desc").take(5)), ...(await ctx.db.query("googleJobs").withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "uncertain")).order("desc").take(5))];
      return {
        status: "done",
        summary: `Google ${connection.status} as ${connection.email}`,
        data: {
          status: connection.status,
          account: connection.email,
          features: FEATURES.map((f) => ({ feature: FEATURE_INFO[f].label, granted: granted.includes(f) })),
          authorized: resources.map((r) => ({ kind: r.kind, label: r.label, purpose: r.purpose ?? null, access: r.access, note: r.accessNote ?? null })),
          problems: problems.map((j) => ({ kind: j.kind, status: j.status, error: j.lastError ?? null, at: when(j.updatedAt, ctx.company.timezone) })),
        },
        link: SETTINGS,
      };
    },
  },
  {
    name: "read_drive_knowledge",
    label: "Reading the company's Google Drive documents",
    description: "The text of the Drive files the Owner chose as knowledge sources, as Selestial last read them. Use to answer from the company's own price sheets, policies and scripts. Only files the Owner authorized are here.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { contains: { type: "string", optional: true, max: 80, description: "Only files whose name contains this." } } },
    run: async (ctx, args) => {
      const texts = await ctx.db.query("googleDriveTexts").withIndex("by_company_resource", (q) => q.eq("companyId", ctx.company._id)).take(60);
      const filter = typeof args.contains === "string" ? args.contains.toLowerCase() : "";
      const rows = texts.filter((t) => !filter || t.name.toLowerCase().includes(filter)).slice(0, 8);
      if (rows.length === 0) return { status: "done", summary: "No Drive documents have been read", data: { files: [], note: "The Owner chooses knowledge sources under Settings › Google." }, link: SETTINGS };
      return { status: "done", summary: `${rows.length} Drive document${rows.length === 1 ? "" : "s"}`, data: { files: rows.map((t) => ({ name: t.name, readAt: when(t.fetchedAt, ctx.company.timezone), text: t.text.slice(0, 6000) })) } };
    },
  },
  {
    name: "export_agreement_to_google_doc",
    label: "Exporting an agreement to Google Docs",
    description: "Queue a Google Doc copy of an agreement version in the agreements folder the Owner chose. It is a copy for reading: it never sends, approves or signs, and the agreement's status does not change. Returns the queued job; the link appears once Google confirms.",
    kind: "write",
    minimumRole: "office",
    input: { type: "object", properties: { agreementId: ID("The agreement."), version: { type: "number", optional: true, description: "A version number; the signed or current version when left out." } } },
    run: async (ctx, args) => {
      if (!(await paced(ctx, "export"))) return refused("Too many Google exports from Chat in the last hour. Try again later.");
      try {
        const queued = await queueAgreementExport(ctx, String(args.agreementId), typeof args.version === "number" ? args.version : undefined);
        return { status: "done", summary: queued.repeated ? `That version's Google Doc export already exists or is queued (${queued.status})` : `Queued a Google Doc copy of version ${queued.version}. It is not created until Google confirms; the agreement's status is unchanged (${queued.workflow}).`, data: { jobId: queued.jobId, jobStatus: queued.status, version: queued.version, agreementStatusUnchanged: queued.workflow }, link: { href: `/app/agreements/${queued.agreementId}`, label: "Open in Agreements" } };
      } catch (error) {
        return refused(say(error, "The export could not be queued."));
      }
    },
  },
  {
    name: "export_schedule_to_google_sheet",
    label: "Exporting the schedule to Google Sheets",
    description: "Queue a Google Sheet of the next two weeks of visits in the reports folder. Owners and Managers. Returns the queued job.",
    kind: "write",
    minimumRole: "manager",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      if (!(await paced(ctx, "export"))) return refused("Too many Google exports from Chat in the last hour. Try again later.");
      try {
        const connection = await requireFeature(ctx, ctx.company._id, "drive");
        const folder = (await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.company._id).eq("kind", "drive_output")).take(50)).find((r) => r.purpose === "reports" && r.access !== "lost");
        if (!folder) return refused("No Drive folder is chosen for reports. The Owner chooses one under Settings › Google.");
        const now = Date.now();
        const jobs = await ctx.db.query("jobs").withIndex("by_company_start", (q) => q.eq("companyId", ctx.company._id).gte("startsAt", now).lt("startsAt", now + 14 * 86_400_000)).take(500);
        const tz = ctx.company.timezone;
        const fmt = (at: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(at));
        const rows: (string | number)[][] = [["Date", "Start", "End", "Service", "Status", "Customer"]];
        for (const job of jobs) rows.push([localParts(job.startsAt, tz).day, fmt(job.startsAt), fmt(job.endsAt), job.serviceType, job.status, (await ctx.db.get(job.customerId))?.name ?? ""]);
        const day = localParts(now, tz).day;
        const queued = await enqueue(ctx, { companyId: ctx.company._id, connectionId: connection._id, kind: "sheet_export", key: `sheet_export:schedule:${day}:${stableHash(rows).slice(0, 16)}`, payload: { resourceId: folder._id, title: `Schedule from ${day}`, rows }, requestedBy: ctx.member._id });
        return { status: "done", summary: queued.repeated ? `This schedule export is already ${queued.status}` : `Queued a Google Sheet with ${jobs.length} visits; it appears in the reports folder once Google confirms`, data: { jobId: queued.jobId, jobStatus: queued.status, visits: jobs.length } };
      } catch (error) {
        return refused(say(error, "The export could not be queued."));
      }
    },
  },
  {
    name: "list_google_reviews",
    label: "Reading Google reviews",
    description: "Recent Google Business Profile reviews for the authorized locations, with any reply on Google, any draft, and its state.",
    kind: "read",
    minimumRole: "office",
    specialist: "retention",
    input: { type: "object", properties: { unanswered: { type: "boolean", optional: true } } },
    run: async (ctx, args) => {
      const rows = (await ctx.db.query("googleReviews").withIndex("by_company_created", (q) => q.eq("companyId", ctx.company._id)).order("desc").take(60)).filter((r) => !args.unanswered || !r.existingReply);
      return { status: "done", summary: `${rows.length} review${rows.length === 1 ? "" : "s"}`, data: { reviews: rows.slice(0, 25).map((r) => ({ reviewId: r._id, stars: r.stars, reviewer: r.reviewer, comment: r.comment ?? null, at: when(r.createdAt, ctx.company.timezone), replyOnGoogle: r.existingReply ?? null, draft: r.draft ?? null, state: r.state })) } };
    },
  },
  {
    name: "draft_google_review_reply",
    label: "Drafting a review reply",
    description: "Save a draft reply to a Google review. A draft is only words in Selestial: nothing is posted until an Owner or Manager approves the exact text. Uses Retention's permission to draft review replies.",
    kind: "draft",
    minimumRole: "office",
    specialist: "retention",
    input: { type: "object", properties: { reviewId: ID("The review."), text: { type: "string", max: 4000, description: "The reply." } } },
    run: async (ctx, args) => {
      const blocked = await agentMay(ctx, "retention.draft_review_reply", "Retention");
      if (blocked) return blocked;
      const review = await ctx.db.get(String(args.reviewId) as Id<"googleReviews">).catch(() => null);
      if (!review || review.companyId !== ctx.company._id) return refused("That review was not found.");
      if (review.state === "publishing") return refused("A reply to this review is being published.");
      await ctx.db.patch(review._id, { draft: String(args.text).slice(0, 4000), draftBy: "assistant", state: "drafted" });
      return { status: "proposed", summary: "Draft saved in Selestial. It has not been posted; an Owner or Manager approves the exact text first.", data: { reviewId: review._id, state: "drafted", posted: false }, link: SETTINGS };
    },
  },
  {
    name: "publish_google_review_reply",
    label: "Publishing a review reply",
    description: "Publish a reply on Google, publicly, after the person approves the exact text shown. Owners and Managers. Returns the queued publish; the reply is live only when Google confirms.",
    kind: "write",
    minimumRole: "manager",
    confirm: true,
    specialist: "retention",
    input: { type: "object", properties: { reviewId: ID("The review."), text: { type: "string", max: 4000, description: "The exact reply to post." } } },
    preview: async (ctx, args) => {
      const review = await ctx.db.get(String(args.reviewId) as Id<"googleReviews">).catch(() => null);
      if (!review || review.companyId !== ctx.company._id) return refused("That review was not found.");
      return { status: "needs_approval", preview: { summary: `Post this reply publicly on Google to ${review.reviewer}'s ${review.stars}-star review`, lines: [String(args.text)], bindsTo: stableHash({ review: review._id, text: String(args.text), state: review.state }) } };
    },
    run: async (ctx, args) => {
      try {
        const queued = await approveAndQueue(ctx, ctx.company._id, ctx.member._id, String(args.reviewId) as Id<"googleReviews">, String(args.text));
        return { status: "done", summary: queued.repeated ? `This exact reply is already ${queued.status}` : "Approved and queued for Google. It is public once Google confirms; check the review's state.", data: { jobId: queued.jobId, jobStatus: queued.status, reviewState: "publishing" }, link: SETTINGS };
      } catch (error) {
        return refused(say(error, "The reply could not be queued."));
      }
    },
  },
  {
    name: "review_request_eligibility",
    label: "Checking whether to ask for a review",
    description: "Whether a customer may be asked for a Google review now. The rule is neutral: a finished visit in the last 14 days, a way to reach them, and not asked in 120 days. It never depends on how happy they seem.",
    kind: "read",
    minimumRole: "office",
    specialist: "retention",
    input: { type: "object", properties: { customerId: ID("The customer.") } },
    run: async (ctx, args) => {
      const customer = await ctx.db.get(String(args.customerId) as Id<"customers">).catch(() => null);
      if (!customer || customer.companyId !== ctx.company._id) return refused("That customer was not found.");
      const reasons: string[] = [];
      const locations = await ctx.db.query("googleResources").withIndex("by_company_kind", (q) => q.eq("companyId", ctx.company._id).eq("kind", "business_location")).take(5);
      if (!locations.some((l) => l.access === "verified")) reasons.push("No Business Profile location is connected and verified.");
      const jobs = await ctx.db.query("jobs").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.company._id).eq("customerId", customer._id)).order("desc").take(50);
      if (!jobs.some((j) => j.status === "completed" && j.endsAt > Date.now() - 14 * 86_400_000)) reasons.push("No visit finished in the last 14 days.");
      if (!customer.email && !customer.phone) reasons.push("There is no email or phone number.");
      const asked = await ctx.db.query("events").withIndex("by_company_subject_at", (q) => q.eq("companyId", ctx.company._id).eq("subjectId", customer._id).gt("at", Date.now() - 120 * 86_400_000)).take(200);
      if (asked.some((e) => e.type === "google.review_requested")) reasons.push("Asked within the last 120 days.");
      return { status: "done", summary: reasons.length ? `Not now: ${reasons.join(" ")}` : `${customer.name} may be asked for a review`, data: { eligible: reasons.length === 0, reasons, rule: "Same rule for every customer; satisfaction is never considered." } };
    },
  },
  {
    name: "list_google_leads",
    label: "Reading Google leads",
    description: "Recent leads from Google Ads lead forms and Local Services Ads, each with the customer and Sales task it became.",
    kind: "read",
    minimumRole: "office",
    specialist: "sales",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      const rows = await ctx.db.query("googleLeads").withIndex("by_company_received", (q) => q.eq("companyId", ctx.company._id)).order("desc").take(30);
      return { status: "done", summary: `${rows.length} lead${rows.length === 1 ? "" : "s"}`, data: { leads: rows.map((l) => ({ source: l.source, name: l.name ?? null, email: l.email ?? null, phone: l.phone ?? null, postalCode: l.postalCode ?? null, customerId: l.customerId ?? null, taskId: l.taskId ?? null, test: l.test ?? false, at: when(l.receivedAt, ctx.company.timezone) })) } };
    },
  },
  {
    name: "google_ads_results",
    label: "Reading Google Ads results",
    description: "Results by campaign for the authorized ad accounts over the last 30 days, as last read, with when.",
    kind: "read",
    minimumRole: "manager",
    specialist: "marketing",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      const rows = await ctx.db.query("googleAdsSnapshots").withIndex("by_company_account", (q) => q.eq("companyId", ctx.company._id)).take(10);
      if (rows.length === 0) return { status: "done", summary: "No Google Ads results have been read yet", data: { accounts: [] }, link: SETTINGS };
      return { status: "done", summary: `Results for ${rows.length} ad account${rows.length === 1 ? "" : "s"}`, data: { accounts: rows.map((r) => ({ accountId: r.accountId, readAt: when(r.fetchedAt, ctx.company.timezone), campaigns: r.rows.map((c) => ({ ...c, cost: (c.costMicros / 1e6).toFixed(2) })) })) } };
    },
  },
  {
    name: "draft_google_ads_campaign",
    label: "Drafting a Google Ads campaign",
    description: "Save a Google Ads search campaign draft for an authorized ad account. It costs nothing and is not created in Google Ads: the Owner approves the draft and budget, it is created paused, and turning it on is a separate Owner decision. Uses Sales's permission to draft campaigns.",
    kind: "draft",
    minimumRole: "manager",
    specialist: "marketing",
    input: {
      type: "object",
      properties: {
        accountId: ID("The ad account id, like 123-456-7890."),
        name: { type: "string", max: 80 },
        dailyBudgetDollars: { type: "number", description: "Daily budget in dollars, 1 to 500." },
        keywords: { type: "array", items: { type: "string", max: 80 }, maxItems: 50 },
        postalCodes: { type: "array", items: { type: "string", max: 5 }, maxItems: 100 },
        headline: { type: "string", max: 30 },
        description: { type: "string", max: 90 },
        finalUrl: { type: "string", max: 500 },
      },
    },
    run: async (ctx, args) => {
      const blocked = await agentMay(ctx, "sales.draft_ad_campaign", "Sales");
      if (blocked) return blocked;
      if (!(await paced(ctx, "ads_draft"))) return refused("Too many campaign drafts from Chat in the last hour.");
      try {
        await requireFeature(ctx, ctx.company._id, "ads");
        const draftId = await createDraft(ctx, ctx.company._id, ctx.member._id, { accountId: String(args.accountId), name: String(args.name), dailyBudgetCents: Math.round(Number(args.dailyBudgetDollars) * 100), keywords: (args.keywords as string[]) ?? [], postalCodes: (args.postalCodes as string[]) ?? [], headline: String(args.headline), description: String(args.description), finalUrl: String(args.finalUrl) });
        return { status: "proposed", summary: "Campaign draft saved in Selestial. Nothing was created in Google Ads and nothing will spend until the Owner approves it and later turns it on.", data: { draftId, state: "draft", spends: false }, link: SETTINGS };
      } catch (error) {
        return refused(say(error, "The draft could not be saved."));
      }
    },
  },
  {
    name: "calendar_busy_times",
    label: "Checking Google Calendar busy times",
    description: "Busy times from the Google calendars the Owner chose for availability, between two dates, as last read (refreshed every few minutes).",
    kind: "read",
    minimumRole: "office",
    specialist: "dispatch",
    input: { type: "object", properties: { days: { type: "number", optional: true, description: "How many days ahead, up to 14." } } },
    run: async (ctx, args) => {
      const from = Date.now();
      const to = from + Math.min(14, Math.max(1, Number(args.days ?? 7))) * 86_400_000;
      const rows = await ctx.db.query("googleBusy").withIndex("by_company_calendar", (q) => q.eq("companyId", ctx.company._id)).take(20);
      return { status: "done", summary: rows.length ? `Busy times from ${rows.length} calendar${rows.length === 1 ? "" : "s"}` : "No calendar is chosen for busy times", data: { calendars: rows.map((r) => ({ calendar: r.calendarId, readAt: when(r.fetchedAt, ctx.company.timezone), problem: r.problem ?? null, busy: r.busy.filter((b) => b.end > from && b.start < to).slice(0, 50).map((b) => ({ from: when(b.start, ctx.company.timezone), to: when(b.end, ctx.company.timezone) })) })) } };
    },
  },
];
