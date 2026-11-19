/**
 * Reading the company's records for the activation plan (lib/activation/plan.ts). Counted from indexes,
 * capped, and read again before every step, so a plan never acts on what was true an hour ago.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { authorityFor } from "../authority";
import { accountFor, agentVerdict, billingState, verifiedPlan } from "../billing/access";
import { readiness as complianceReadiness } from "../compliance/readiness";
import { purposesOf } from "../inbox/mailboxes";
import { retentionSettings } from "../retention/settings";
import { wantsWork } from "../sales/agent";
import { view as opportunityView } from "../sales/agentOpportunity";
import { salesSettings } from "../sales/settings";
import { OPEN_STAGES } from "../sales/agentSchema";
import { activeRun } from "../sales/runs";
import { factsOf } from "../setup/facts";
import { AGENTS, type Agent } from "../statuses";
import type { Snapshot } from "./plan";

type Ctx = QueryCtx | MutationCtx;
const DAY = 86_400_000;
export const WINDOW_DAYS = 14;

async function levelOf(ctx: Ctx, companyId: Id<"companies">, action: string): Promise<string> {
  const found = await authorityFor(ctx, companyId, action);
  return found.kind === "level" ? found.level : found.kind;
}

/** Whether the plan is known yet. Before billing's first sync it isn't, and the agents' own billing decides. */
async function planVerdicts(ctx: Ctx, company: Doc<"companies">): Promise<Snapshot["plan"]> {
  const state = billingState();
  const account = state.connected ? await accountFor(ctx, company._id, state.env) : null;
  const knows = account !== null || verifiedPlan(company) !== null;
  const out = {} as Snapshot["plan"];
  for (const agent of AGENTS) {
    const verdict = agentVerdict(company, agent);
    out[agent] = verdict.ok || !knows ? { ok: true, words: "" } : { ok: false, words: verdict.message };
  }
  return out;
}

export async function snapshotOf(ctx: Ctx, company: Doc<"companies">, now: number): Promise<Snapshot> {
  const companyId = company._id;
  const confirmed = new Map((await factsOf(ctx, companyId)).filter((row) => row.state === "confirmed").map((row) => [row.key, row.value]));
  const one = (key: string) => (typeof confirmed.get(key) === "string" && (confirmed.get(key) as string).trim() ? (confirmed.get(key) as string) : null);
  const many = (key: string) => (Array.isArray(confirmed.get(key)) ? (confirmed.get(key) as string[]) : []);
  const setup = await ctx.db
    .query("companySetups")
    .withIndex("by_company", (q) => q.eq("companyId", companyId))
    .first();

  // ── Sales ──
  const active = await ctx.db
    .query("services")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(50);
  const drafts = await ctx.db
    .query("services")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "draft"))
    .take(5);
  const preparedService = setup?.prepared?.serviceId ? await ctx.db.get(setup.prepared.serviceId) : null;
  const pages = await ctx.db
    .query("bookingExperiences")
    .withIndex("by_company_updated", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(20);
  const preparedPage = setup?.prepared?.experienceId ? await ctx.db.get(setup.prepared.experienceId) : null;
  const preparedAgreement = setup?.prepared?.agreementId ? await ctx.db.get(setup.prepared.agreementId) : null;
  // Open inquiries Sales works (not taken over by a person), and of those, the ones missing their next step:
  // due for Sales, with no run of Sales' own already going.
  let openInquiries = 0;
  const inquiries: Id<"salesOpportunities">[] = [];
  for (const stage of ["new", "qualifying", "quoting"] as const) {
    const rows = await ctx.db
      .query("salesOpportunities")
      .withIndex("by_company_stage", (q) => q.eq("companyId", companyId).eq("stage", stage))
      .order("desc")
      .take(100);
    for (const row of rows) {
      const opp = row.intake ? opportunityView(row) : null;
      if (!opp || opp.agent.takeover || !OPEN_STAGES.includes(opp.agent.stage)) continue;
      openInquiries += 1;
      if (opp.agent.match !== "needs_review" && wantsWork(opp, now) && !(await activeRun(ctx, opp))) inquiries.push(row._id);
    }
  }
  const sales = salesSettings(company);

  // ── Recruiter ──
  const openNeeds = await ctx.db
    .query("hiringNeeds")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "open"))
    .take(20);
  const draftNeeds = await ctx.db
    .query("hiringNeeds")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "draft"))
    .take(5);
  const mailboxes = (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20)
  ).filter((row) => purposesOf(row).includes("hiring"));
  const inbox = mailboxes.some((row) => row.status === "connected") ? "connected" : mailboxes.some((row) => row.status === "expired" || row.status === "error") ? "broken" : "none";
  const applications = await ctx.db
    .query("applications")
    .withIndex("by_company_stage", (q) => q.eq("companyId", companyId))
    .take(500);

  // ── Dispatch ──
  const upcoming = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "scheduled").gt("startsAt", now).lt("startsAt", now + WINDOW_DAYS * DAY))
    .take(200);
  const uncovered: Id<"jobs">[] = [];
  for (const job of upcoming) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", companyId).eq("jobId", job._id))
      .take(20);
    const accepted = assignments.filter((row) => row.status === "accepted").length;
    if (accepted < (job.requiredCrew ?? 1)) uncovered.push(job._id);
  }
  const ready = await ctx.db
    .query("cleaners")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "ready"))
    .take(200);
  let withoutAvailability = 0;
  for (const cleaner of ready) {
    const window = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", companyId).eq("cleanerId", cleaner._id))
      .first();
    if (!window) withoutAvailability += 1;
  }
  const sending = await complianceReadiness(ctx, company);
  const canText = sending.operations.find((row) => row.key === "sms")?.state === "ready";
  const canEmail = sending.operations.find((row) => row.key === "email")?.state === "ready";

  // ── Retention ──
  const completed = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", companyId).eq("status", "completed").gt("startsAt", now - 90 * DAY))
    .take(500);
  const plans = await ctx.db
    .query("recurringPlans")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(500);
  const customers = await ctx.db
    .query("customers")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "active"))
    .take(500);
  let openCases = 0;
  for (const status of ["needs_context", "needs_attention", "action_underway", "waiting_on_customer", "monitoring"] as const) {
    openCases += (
      await ctx.db
        .query("retentionCases")
        .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", status))
        .take(200)
    ).length;
  }
  const retention = retentionSettings(company);

  return {
    now,
    companyName: company.name,
    plan: await planVerdicts(ctx, company),
    paused: company.pausedAgents as Agent[],
    facts: { areas: one("company.areas"), categories: many("services.categories"), phone: one("contact.phone"), email: one("contact.email"), location: one("company.location"), workforce: many("workforce.arrangement") },
    sales: {
      activeServices: active.length,
      draftServiceId: preparedService?.status === "draft" ? preparedService._id : (drafts[0]?._id ?? null),
      bookingPageId: preparedPage ? preparedPage._id : (pages.find((row) => row.status !== "archived")?._id ?? null),
      agreementId: preparedAgreement ? preparedAgreement._id : null,
      openInquiries,
      inquiryIds: inquiries,
      approvedAnswers: sales.answers.length,
      proposedAnswers: sales.proposedAnswers.length,
      firstBatchDecided: sales.firstBatchDecidedAt !== null,
      replyLevel: await levelOf(ctx, companyId, "sales.reply_and_quote"),
    },
    recruiter: {
      openNeeds: openNeeds.length,
      openNeedId: openNeeds[0]?._id ?? null,
      // The brief setup prepared, if any, is the draft: activation never makes a second role.
      draftNeedId: (setup?.prepared?.hiringNeedId && (await ctx.db.get(setup.prepared.hiringNeedId))?.status !== "closed" ? setup.prepared.hiringNeedId : null) ?? draftNeeds[0]?._id ?? null,
      inbox,
      applications: applications.length,
      inviteLevel: await levelOf(ctx, companyId, "recruiter.send_invitation"),
    },
    dispatch: {
      upcomingJobs: upcoming.length,
      uncoveredJobs: uncovered.length,
      uncoveredJobIds: uncovered,
      readyCleaners: ready.length,
      cleanersWithoutAvailability: withoutAvailability,
      canText,
      offerLevel: await levelOf(ctx, companyId, "dispatch.request_acceptance"),
    },
    retention: {
      completedJobs: completed.length,
      activePlans: plans.length,
      customers: customers.length,
      openCases,
      guaranteeWritten: retention.guarantee !== null,
      reviewLink: retention.reviewUrl !== null,
      feedbackAfterFirst: retention.feedbackAfterFirstService,
      feedbackLevel: await levelOf(ctx, companyId, "retention.request_feedback"),
    },
    canEmail,
  };
}

/** A short, stable fingerprint. Not a security measure: it only tells one context from another. */
export function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, "0");
}

/**
 * The context the plan is made from, and its version. The same answers, facts and records give the same
 * version, so pressing Start twice, or on two devices, finds one batch instead of starting two.
 */
export async function contextOf(ctx: Ctx, company: Doc<"companies">, focus: string, secondary: string[], snapshot: Snapshot) {
  const facts = await factsOf(ctx, company._id);
  const context = facts.map((row) => ({ key: row.key, value: Array.isArray(row.value) ? row.value.join(", ") : row.value, state: row.state, source: row.source }));
  const counts = [
    `services:${snapshot.sales.activeServices}`,
    `inquiries:${snapshot.sales.openInquiries}`,
    `needs:${snapshot.recruiter.openNeeds}`,
    `inbox:${snapshot.recruiter.inbox}`,
    `jobs:${snapshot.dispatch.upcomingJobs}`,
    `cleaners:${snapshot.dispatch.readyCleaners}`,
    `customers:${snapshot.retention.customers}`,
  ];
  const records = counts.map((entry) => ({ key: `records.${entry.split(":")[0]}`, value: entry.split(":")[1], state: "record" as const, source: "workspace" }));
  const day = new Date(snapshot.now).toISOString().slice(0, 10);
  const version = fingerprint(JSON.stringify([focus, [...secondary].sort(), context.map((row) => [row.key, row.value, row.state]).sort(), counts, company.name, day]));
  return { version, context: [...context.filter((row) => row.state === "confirmed" || row.state === "found"), ...records] as { key: string; value: string; state: "confirmed" | "found" | "record"; source: string }[] };
}
