/**
 * Each agent's first work during setup: a review of the company's own records that ends in one concrete
 * next decision. It reads; it writes nothing and contacts no one. What each review counts is what the
 * records hold right now, so every number on the screen is backed by a record.
 *
 * Sales     open inquiries, follow-ups that are due, replies waiting for review, and whether Sales can quote.
 * Recruiter the hiring brief (prepared separately, paused until the Owner opens it) and applications waiting.
 * Dispatch  upcoming visits short of people, who could cover them (a proposal: no offer is sent), and who
 *           has no weekly hours.
 * Retention clients whose last visit was a while ago with nothing booked, and open concerns. Retention is not
 *           built, so this is a review for the owner to act on; nothing is drafted to be sent.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { companyAttention } from "../clients/signals";
import { staffing } from "../dispatch/crew";
import { candidatesFor, withoutCrew } from "../dispatch/workflow";
import type { AgentReadiness } from "./readiness";
import type { WorkResult } from "./schema";

export type WorkAgent = "sales" | "recruiter" | "dispatch" | "retention";

/** What the screen says while each run is scheduled. Each matches what the code below reads. */
export const ACTIVITY: Record<WorkAgent, string> = {
  sales: "Reviewing your open inquiries and follow-ups",
  recruiter: "Checking your hiring brief and waiting applications",
  dispatch: "Checking the next two weeks of visits for missing coverage",
  retention: "Reviewing your clients' service history",
};

const DAY = 86_400_000;
export const COVERAGE_DAYS = 14;
/** A client whose last completed visit is older than this, with nothing booked, may be ready to come back. */
export const LAPSED_DAYS = 45;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type WorkOutcome = { status: "ready_for_review" | "waiting"; result: WorkResult };

function gapsOf(readiness: AgentReadiness | undefined) {
  return (readiness?.gaps ?? []).map((gap) => `${gap.words}`);
}

// ── Sales ───────────────────────────────────────────────────────────────────────────────────────

export async function salesWork(ctx: QueryCtx, company: Doc<"companies">, readiness: AgentReadiness | undefined, now: number): Promise<WorkOutcome> {
  const open: Doc<"salesOpportunities">[] = [];
  for (const stage of ["new", "qualifying", "quoting"] as const) {
    open.push(
      ...(await ctx.db
        .query("salesOpportunities")
        .withIndex("by_company_stage", (q) => q.eq("companyId", company._id).eq("stage", stage))
        .order("desc")
        .take(200)),
    );
  }
  const due = open.filter((row) => row.nextActionAt !== undefined && row.nextActionAt <= now);
  const noNext = open.filter((row) => !row.nextAction && row.nextActionAt === undefined);
  const waiting: Doc<"salesActions">[] = [];
  for (const status of ["prepared", "awaiting_approval"] as const) {
    waiting.push(
      ...(await ctx.db
        .query("salesActions")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
        .take(200)),
    );
  }
  const services = await ctx.db
    .query("services")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "active"))
    .take(50);
  const setup = await ctx.db
    .query("companySetups")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .first();
  const bookingDraft = setup?.prepared?.experienceId ? await ctx.db.get(setup.prepared.experienceId) : null;

  const attention = [...due, ...noNext.filter((row) => !due.includes(row))];
  const items = attention.slice(0, 5).map((row) => ({
    label: row.title,
    detail: due.includes(row) ? `A follow-up was due ${daysAgo(row.nextActionAt!, now)}.` : "No next step is set.",
    href: `/app/agents/sales/pipeline?opportunity=${row._id}`,
  }));
  const used = [services.length ? `${plural(services.length, "published service")}` : "No published service yet", `${plural(open.length, "open inquiry", "open inquiries")}`];
  if (bookingDraft) used.push(`The booking page draft "${bookingDraft.name}"`);
  const uncertain = gapsOf(readiness);
  // Readiness already says so when it counts the missing service; say it once.
  if (!services.length && !uncertain.some((line) => /service/i.test(line))) uncertain.push("Without a published service and price, Sales takes quote requests instead of quoting firmly.");

  const next =
    waiting.length > 0
      ? { words: `Review ${plural(waiting.length, "reply", "replies")} Sales prepared`, href: "/app/agents/sales" }
      : attention.length > 0
        ? { words: `Decide the next step for ${plural(attention.length, "inquiry", "inquiries")}`, href: "/app/agents/sales/pipeline" }
        : !services.length
          ? { words: "Publish one service so Sales can quote", href: "/app/services" }
          : { words: "Share your booking page to start taking inquiries", href: "/app/agents/sales/booking-forms" };

  return {
    status: open.length || waiting.length ? "ready_for_review" : "waiting",
    result: {
      title: open.length ? "Your open inquiries, reviewed" : "Your inquiry path, checked",
      summary: open.length
        ? `${plural(open.length, "open inquiry", "open inquiries")}: ${plural(due.length, "follow-up")} due, ${noNext.length} with no next step${waiting.length ? `, and ${plural(waiting.length, "reply", "replies")} waiting for your review` : ""}.`
        : `No open inquiries yet. ${services.length ? "Sales can quote from your published services." : "Sales will take quote requests until a service is published."}`,
      used,
      uncertain,
      items,
      next,
      counts: { open: open.length, due: due.length, noNext: noNext.length, waiting: waiting.length, services: services.length },
    },
  };
}

// ── Recruiter ───────────────────────────────────────────────────────────────────────────────────

export async function recruiterWork(ctx: QueryCtx, company: Doc<"companies">, readiness: AgentReadiness | undefined): Promise<WorkOutcome> {
  const needs: Doc<"hiringNeeds">[] = [];
  for (const status of ["open", "paused"] as const) {
    needs.push(
      ...(await ctx.db
        .query("hiringNeeds")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
        .take(50)),
    );
  }
  const openNeeds = needs.filter((need) => need.status === "open");
  let screening = 0;
  for (const need of openNeeds) {
    const rows = await ctx.db
      .query("applications")
      .withIndex("by_company_need", (q) => q.eq("companyId", company._id).eq("needId", need._id))
      .take(500);
    screening += rows.filter((row) => row.stage !== "closed" && row.stage !== "withdrawn" && row.stage !== "onboarding_handoff").length;
  }
  const inbox = await ctx.db
    .query("mailboxConnections")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .take(20);
  const hasInbox = inbox.some((row) => row.status === "connected");

  const items = needs.slice(0, 5).map((need) => ({
    label: need.title,
    detail: need.status === "open" ? "Open: taking applications." : "Paused: a brief that isn't taking applications yet.",
    href: "/app/agents/recruiter/hiring-needs",
  }));
  const uncertain = gapsOf(readiness);
  if (!hasInbox) uncertain.push("No hiring inbox is connected, so people who already applied by email can't be found.");
  if (needs.some((need) => !need.compensation)) uncertain.push("Pay for the role isn't approved yet. Offers can't be made until you approve it.");

  const next =
    needs.length === 0
      ? { words: "Prepare a hiring brief", href: "/app/agents/recruiter/hiring-needs" }
      : openNeeds.length === 0
        ? { words: "Review the brief and open it when you're ready to hire", href: "/app/agents/recruiter/hiring-needs" }
        : screening > 0
          ? { words: `Review ${plural(screening, "application")} waiting`, href: "/app/agents/recruiter/screening" }
          : !hasInbox
            ? { words: "Connect the hiring inbox to find people who already applied", href: "/app/settings/recruiting" }
            : { words: "Share where people can apply", href: "/app/agents/recruiter/hiring-needs" };

  return {
    status: needs.length ? "ready_for_review" : "waiting",
    result: {
      title: needs.length ? "Your hiring brief, checked" : "Hiring, checked",
      summary: needs.length
        ? `${plural(needs.length, "role")} (${openNeeds.length} open). ${plural(screening, "application")} waiting for screening.`
        : "No hiring brief yet. Recruiter needs one before it can screen anyone.",
      used: [needs.length ? `${plural(needs.length, "hiring brief")}` : "No hiring brief yet", hasInbox ? "Your connected hiring inbox" : "No hiring inbox connected"],
      uncertain,
      items,
      next,
      counts: { needs: needs.length, open: openNeeds.length, screening },
    },
  };
}

// ── Dispatch ────────────────────────────────────────────────────────────────────────────────────

export async function dispatchWork(ctx: QueryCtx, company: Doc<"companies">, readiness: AgentReadiness | undefined, now: number): Promise<WorkOutcome> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", company._id).eq("status", "scheduled").gt("startsAt", now).lt("startsAt", now + COVERAGE_DAYS * DAY))
    .take(300);
  const short: { job: Doc<"jobs">; open: number }[] = [];
  for (const job of jobs) {
    const assignments = await ctx.db
      .query("assignments")
      .withIndex("by_company_job", (q) => q.eq("companyId", company._id).eq("jobId", job._id))
      .take(50);
    const state = staffing(job, assignments);
    if (state.open > 0) short.push({ job, open: state.open });
  }
  // Who could cover the first few: the same ranked list Dispatch uses. Shown as a proposal; no offer is sent.
  const items = [];
  for (const { job, open } of short.slice(0, 5)) {
    const found = withoutCrew(await candidatesFor(ctx, company, job));
    const names = found.candidates.slice(0, 3).map((c) => c.name);
    const customer = await ctx.db.get(job.customerId);
    items.push({
      label: `${customer?.name ?? "A client"} · ${new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(job.startsAt))}`,
      detail: `${plural(open, "person", "people")} still needed. ${names.length ? `Could cover: ${names.join(", ")}.` : "No one eligible is free."}`,
      href: `/app/cleaners/crews?job=${job._id}`,
    });
  }

  const working: Doc<"cleaners">[] = [];
  for (const status of ["ready", "onboarding"] as const) {
    working.push(
      ...(await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
        .take(300)),
    );
  }
  let noHours = 0;
  for (const cleaner of working) {
    const window = await ctx.db
      .query("availabilityWindows")
      .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", cleaner._id))
      .first();
    if (!window) noHours += 1;
  }

  const uncertain = gapsOf(readiness);
  if (noHours) uncertain.push(`${plural(noHours, "cleaner has", "cleaners have")} no weekly hours, so Dispatch can't tell when they're free.`);
  const next =
    short.length > 0
      ? { words: `Cover ${plural(short.length, "visit")} short of people`, href: "/app/agents/dispatch/offers-coverage" }
      : noHours > 0
        ? { words: `Ask ${plural(noHours, "cleaner")} for weekly hours`, href: "/app/cleaners" }
        : jobs.length === 0
          ? { words: "Add or import upcoming visits", href: "/app/agents/dispatch/schedule" }
          : working.length === 0
            ? { words: "Add the people who clean for you", href: "/app/cleaners" }
            : { words: "Open the dispatch board", href: "/app/agents/dispatch/dispatch-board" };

  return {
    status: short.length || noHours ? "ready_for_review" : "waiting",
    result: {
      title: jobs.length ? "Upcoming coverage, checked" : "Coverage, checked",
      summary: jobs.length
        ? `${plural(jobs.length, "visit")} in the next ${COVERAGE_DAYS} days; ${short.length} ${short.length === 1 ? "is" : "are"} short of people.${noHours ? ` ${plural(noHours, "cleaner")} without weekly hours.` : ""}`
        : `No visits are scheduled in the next ${COVERAGE_DAYS} days.${noHours ? ` ${plural(noHours, "cleaner")} without weekly hours.` : ""}`,
      used: [`${plural(jobs.length, "scheduled visit")} in the next ${COVERAGE_DAYS} days`, `${plural(working.length, "cleaner")} ready or onboarding`],
      uncertain,
      items,
      next,
      counts: { upcoming: jobs.length, short: short.length, noHours, cleaners: working.length },
    },
  };
}

// ── Retention ───────────────────────────────────────────────────────────────────────────────────

export async function retentionWork(ctx: QueryCtx, company: Doc<"companies">, now: number): Promise<WorkOutcome> {
  const completed = await ctx.db
    .query("jobs")
    .withIndex("by_company_status_start", (q) => q.eq("companyId", company._id).eq("status", "completed").lt("startsAt", now))
    .order("desc")
    .take(2000);
  const last = new Map<Id<"customers">, number>();
  for (const job of completed) if (!last.has(job.customerId)) last.set(job.customerId, job.startsAt);
  const lapsed: { customerId: Id<"customers">; at: number }[] = [];
  for (const [customerId, at] of last) {
    if (at > now - LAPSED_DAYS * DAY) continue;
    const upcoming = await ctx.db
      .query("jobs")
      .withIndex("by_company_customer_start", (q) => q.eq("companyId", company._id).eq("customerId", customerId).gt("startsAt", now))
      .take(5);
    if (upcoming.some((job) => job.status === "scheduled")) continue;
    lapsed.push({ customerId, at });
  }
  lapsed.sort((a, b) => b.at - a.at);
  const issues = (await companyAttention(ctx, company._id)).issues;

  const items = [];
  for (const { customerId, at } of lapsed.slice(0, 5)) {
    const customer = await ctx.db.get(customerId);
    items.push({ label: customer?.name ?? "A client", detail: `Last visit ${daysAgo(at, now)}; nothing booked.`, href: `/app/clients/${customerId}` });
  }
  return {
    status: lapsed.length || issues.size ? "ready_for_review" : "waiting",
    result: {
      title: last.size ? "Your clients' service history, reviewed" : "Service history, checked",
      summary: last.size
        ? `${plural(last.size, "client")} with completed visits. ${lapsed.length} ${lapsed.length === 1 ? "hasn't" : "haven't"} had a visit in ${LAPSED_DAYS} days and ${lapsed.length === 1 ? "has" : "have"} nothing booked. ${plural(issues.size, "client")} with an open concern.`
        : "No completed visits yet, so there is no service history to review.",
      used: [`${plural(completed.length, "completed visit")}`, issues.size ? `${plural(issues.size, "open concern")}` : "No open concerns"],
      uncertain: ["Retention isn't available yet: nothing is drafted or sent. This is a list for you to act on.", "Past contact details are not permission to message anyone."],
      items,
      next: lapsed.length ? { words: `Look at ${plural(lapsed.length, "client")} who may be ready to book again`, href: "/app/clients" } : issues.size ? { words: `Look at ${plural(issues.size, "open concern")}`, href: "/app/clients" } : { words: "Nothing to do here yet", href: "/app/clients" },
      counts: { withHistory: last.size, lapsed: lapsed.length, concerns: issues.size },
    },
  };
}

function daysAgo(at: number, now: number): string {
  const days = Math.max(0, Math.floor((now - at) / DAY));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}
