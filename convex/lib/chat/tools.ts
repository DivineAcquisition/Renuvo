/**
 * What Company Chat can do: the server-side capability registry (docs/chat/00-architecture.md, section
 * "Capabilities"). A model chooses a tool and its inputs; it never writes to the database. Each tool:
 *  - is listed with what it touches (read, draft, write, or unavailable) and the least role that may use it;
 *  - checks its input against its own schema, whatever the model was told;
 *  - reads the record again and checks the company, the member's current role and, for a specialist's
 *    action, that agent's authority at that moment;
 *  - says plainly when it cannot run, and why, instead of pretending.
 *
 * A tool marked `confirm` does nothing until the person approves its exact preview in the chat. The
 * approval is bound to that preview: if what it would change has changed, it no longer applies.
 *
 * The tools are the same business functions the rest of Selestial uses (tasks, Dispatch and Recruiter
 * tools, hiring needs), so a chat cannot do anything the product's own rules would not allow.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { checkedNeed, openNeed } from "../../hiringNeeds";
import { authorityFor } from "../authority";
import { agentVerdict } from "../billing/access";
import { AGENT_PROFILES } from "../departments";
import { runTool as dispatchTool, type ToolInput as DispatchInput, type ToolName as DispatchToolName } from "../dispatch/tools";
import { coverKey, currentCoverAction } from "../dispatch/workflow";
import { jobAssignments } from "../dispatch/facts";
import { money } from "../dispatch/pay";
import { userError } from "../errors";
import type { Actor } from "../events";
import { runTool as recruiterTool, type ToolInput as RecruiterInput, type ToolName as RecruiterToolName } from "../recruiter/tools";
import { isManager, isOwner, type Role } from "../roles";
import { AGENTS, type Agent } from "../statuses";
import { liveTaskByKey, openTask } from "../taskState";
import { addLocalDays, clock, dayName, startOfLocalDay } from "../time";
import { createArtifact, readableArtifact, reviseArtifact, setArtifactState, STATE_WORDS, unresolvedFields, versionOf } from "./artifacts";
import { CalcError, evaluate } from "./calc";
import { check, jsonSchema, stableHash, type Field } from "./fields";
import { compareScenarios, PricingError, type PricingInput } from "./pricing";
import { AGREEMENT_TOOLS } from "./agreementTools";
import { ARTIFACT_KINDS, ARTIFACT_STATES, type ArtifactKind, type ArtifactState, type Link, type RecordRef } from "./schema";
import type { Work } from "./work";
import { featureOn, ownedAsset, queueGeneration, settingFor, capabilityFor, checkedParams } from "../ai/media";
import { resolve as resolveCapability } from "../ai/registry";
import { allowanceRow, mediaAllowance, monthKey } from "../ai/usage";
import { businessSettingsOf } from "../settings/business";

// ── Types ────────────────────────────────────────────────────────────────────────────────────────

export type ToolCtx = MutationCtx & {
  company: Doc<"companies">;
  member: Doc<"members">;
  role: Role;
  conversationId: Id<"conversations">;
  runId: Id<"chatRuns">;
  /** Names this one action. A specialist tool is recorded under it, so a retry is carried out once. */
  idempotencyKey: string;
};

export type Preview = { summary: string; lines: string[]; bindsTo: string };

export type Outcome =
  | { status: "done" | "proposed"; summary: string; data: Record<string, unknown>; link?: Link; record?: RecordRef; artifact?: { artifactId: Id<"chatArtifacts">; version: number }; agreement?: { agreementId: Id<"agreements">; version: number } }
  | { status: "refused" | "unavailable"; why: string; data?: Record<string, unknown> }
  | { status: "needs_approval"; preview: Preview }
  /** Needs a model or the search index: prepared here, performed by the run engine (work.ts). */
  | { status: "deferred"; work: Work; record?: RecordRef };

export type ToolKind = "read" | "draft" | "write" | "unavailable";

/** The specialist whose work a tool is. Shown to the person only when the tool really ran that specialist's function. */
export type Specialist = "marketing" | "sales" | "retention" | "dispatch" | "quality" | "customer-care" | "recruiter" | "team-coordinator";

export type ChatTool = {
  name: string;
  /** What the person sees while it runs, for example "Checking the schedule". */
  label: string;
  description: string;
  input: Extract<Field, { type: "object" }>;
  kind: ToolKind;
  minimumRole: Role;
  specialist?: Specialist;
  /** The person approves the exact preview before anything happens. */
  confirm?: boolean;
  /** For a `confirm` tool: what approving will do, bound to the state it was shown for. */
  preview?: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<Outcome>;
  run: (ctx: ToolCtx, args: Record<string, unknown>) => Promise<Outcome>;
};

const ROLE_RANK: Record<Role, number> = { office: 0, manager: 1, owner: 2 };
export const roleAllows = (role: Role, minimum: Role) => ROLE_RANK[role] >= ROLE_RANK[minimum];

const refused = (why: string, data?: Record<string, unknown>): Outcome => ({ status: "refused", why, data });
const unavailable = (why: string): Outcome => ({ status: "unavailable", why });
const DAY = 24 * 60 * 60 * 1000;

// ── Small helpers ────────────────────────────────────────────────────────────────────────────────

/** "2027-03-02" on the company's clock, as the instant that day begins. */
export function localDay(date: string, timezone: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw userError(`"${date}" is not a date written as YYYY-MM-DD.`);
  const noon = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  if (Number.isNaN(noon)) throw userError(`"${date}" is not a date.`);
  return startOfLocalDay(noon, timezone);
}

/** "2027-03-02" or "2027-03-02T15:30" on the company's clock. */
function localInstant(value: string, timezone: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value.trim());
  if (!match) throw userError(`"${value}" is not a date (YYYY-MM-DD, optionally THH:MM).`);
  const day = localDay(match[1], timezone);
  if (!match[2]) return day + 17 * 60 * 60 * 1000;
  return day + (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;
}

function idOf<T extends "customers" | "cleaners" | "jobs" | "tasks" | "applications" | "hiringNeeds" | "properties">(ctx: ToolCtx, table: T, value: unknown): Id<T> | null {
  return typeof value === "string" ? ctx.db.normalizeId(table, value) : null;
}

async function ownedRow<T extends "customers" | "cleaners" | "jobs" | "tasks" | "applications" | "hiringNeeds" | "properties">(ctx: ToolCtx, table: T, value: unknown): Promise<Doc<T> | null> {
  const id = idOf(ctx, table, value);
  const row = id ? ((await ctx.db.get(id)) as (Doc<T> & { companyId: Id<"companies"> }) | null) : null;
  return row && row.companyId === ctx.company._id ? row : null;
}

async function nameOf(ctx: (QueryCtx | MutationCtx) & { company: Doc<"companies"> }, id: Id<"customers"> | Id<"cleaners"> | undefined): Promise<string> {
  if (!id) return "—";
  const row = await ctx.db.get(id);
  return row && row.companyId === ctx.company._id ? row.name : "Unknown";
}

const when = (at: number, timezone: string) => `${dayName(at, timezone)} ${clock(at, timezone)}`;

const CHAT_ACTOR = (ctx: ToolCtx): Actor => ({ kind: "member", memberId: ctx.member._id });

/**
 * Runs one of a specialist's own tools, recorded in `toolRuns` under the chat's idempotency key, so a
 * retried chat never sends a second offer. The specialist's authority is checked inside its tool.
 */
async function specialist(ctx: ToolCtx, agent: "dispatch" | "recruiter", tool: string, input: DispatchInput | RecruiterInput) {
  const key = `chat:${ctx.idempotencyKey}`;
  const earlier = await ctx.db
    .query("toolRuns")
    .withIndex("by_company_key", (q) => q.eq("companyId", ctx.company._id).eq("idempotencyKey", key))
    .first();
  if (earlier) return { outcome: earlier.outcome, authorization: earlier.authorization, result: JSON.parse(earlier.result) as Record<string, unknown>, repeated: true };
  const answer = agent === "dispatch" ? await dispatchTool(ctx, ctx.company, tool as DispatchToolName, input as DispatchInput) : await recruiterTool(ctx, ctx.company, tool as RecruiterToolName, input as RecruiterInput);
  await ctx.db.insert("toolRuns", {
    companyId: ctx.company._id,
    tool,
    idempotencyKey: key,
    actor: { kind: "agent", agent },
    authorization: `${answer.authorization}; asked for in Company Chat by member ${ctx.member._id}`,
    input: JSON.stringify(input).slice(0, 4000),
    outcome: answer.outcome,
    result: JSON.stringify(answer.result).slice(0, 8000),
    jobId: "jobId" in answer ? answer.jobId : undefined,
    assignmentId: "assignmentId" in answer ? answer.assignmentId : undefined,
    applicationId: "applicationId" in answer ? answer.applicationId : undefined,
    at: Date.now(),
  });
  return { outcome: answer.outcome, authorization: answer.authorization, result: answer.result, repeated: false };
}

async function accepted(ctx: ToolCtx, job: Doc<"jobs">) {
  const assignments = await jobAssignments(ctx, job);
  return { assignments, accepted: assignments.filter((row) => row.status === "accepted").length, required: job.requiredCrew ?? 1, offered: assignments.filter((row) => row.status === "offered").length };
}

// ── Field shapes reused by several tools ─────────────────────────────────────────────────────────

const ID = (description: string): Field => ({ type: "string", description, max: 64 });

const scenarioField: Field = {
  type: "object",
  properties: {
    name: { type: "string", optional: true, max: 80, description: "A short name for this scenario." },
    crewSize: { type: "number", optional: true, integer: true, min: 1, max: 50, description: "People on the visit." },
    elapsedHours: { type: "number", optional: true, min: 0, max: 200, description: "Hours on the clock for one visit (not labor-hours)." },
    laborHours: { type: "number", optional: true, min: 0, max: 2000, description: "Total person-hours for one visit, if known directly." },
    laborCostPerHourCents: { type: "number", integer: true, min: 0, max: 100_000_00, description: "What one labor-hour costs the company, in cents, wages and payroll costs included." },
    suppliesCents: { type: "number", optional: true, integer: true, min: 0, max: 100_000_00 },
    travelCents: { type: "number", optional: true, integer: true, min: 0, max: 100_000_00 },
    otherDirectCents: { type: "number", optional: true, integer: true, min: 0, max: 100_000_00 },
    overheadPercent: { type: "number", optional: true, min: 0, max: 500, description: "Overhead as a percent of direct cost." },
    overheadPerVisitCents: { type: "number", optional: true, integer: true, min: 0, max: 100_000_00 },
    targetMarginPercent: { type: "number", optional: true, min: 0, max: 99.9, description: "Profit as a percent of the price." },
    markupPercent: { type: "number", optional: true, min: 0, max: 1000, description: "Profit as a percent of the cost." },
    visitsPerMonth: { type: "number", optional: true, min: 0, max: 100 },
    roundToCents: { type: "number", optional: true, integer: true, min: 0, max: 100_000, description: "Round prices up to a multiple of this many cents." },
  },
};

const refField: Field = {
  type: "object",
  properties: {
    table: { type: "string", enum: ["customers", "properties", "cleaners", "jobs", "tasks", "applications", "hiringNeeds"] },
    id: ID("The record's id."),
    label: { type: "string", max: 120 },
  },
};

// ── The registry ─────────────────────────────────────────────────────────────────────────────────

const TOOLS: ChatTool[] = [
  // ── Answer and analyze ──
  {
    name: "calculate",
    label: "Calculating",
    description: "Evaluate plain arithmetic (+ - * / % ^ and parentheses). Use for every number you report that is not read straight from a record.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { expression: { type: "string", max: 500 } } },
    run: async (_ctx, args) => {
      try {
        const value = evaluate(args.expression as string);
        return { status: "done", summary: `${args.expression} = ${value}`, data: { expression: args.expression, value } };
      } catch (error) {
        return refused(error instanceof CalcError ? error.message : "That could not be calculated.");
      }
    },
  },
  {
    name: "price_service",
    label: "Working out the price",
    description:
      "Price a cleaning service from costs: labor (crew size × elapsed hours, or labor-hours), supplies, travel, overhead, and a target margin and/or markup. Compares up to six scenarios. Returns every formula and the assumptions it made. Use it for every price; never compute prices yourself. This changes no live price.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { scenarios: { type: "array", items: scenarioField, maxItems: 6, minItems: 1 } } },
    run: async (_ctx, args) => {
      try {
        const out = compareScenarios(args.scenarios as PricingInput[]);
        const first = out.scenarios[0];
        const summary = first ? `${out.scenarios.length} scenario${out.scenarios.length === 1 ? "" : "s"} priced${first.priceAtMarginCents !== null ? `; ${first.name} at margin: ${money(first.priceAtMarginCents)}` : first.priceAtMarkupCents !== null ? `; ${first.name} at markup: ${money(first.priceAtMarkupCents)}` : ""}` : "No scenario could be priced";
        if (!out.scenarios.length) return refused(out.errors.map((row) => `${row.name}: ${row.error}`).join(" "));
        return { status: "done", summary, data: { ...out, liveCatalogChanged: false } };
      } catch (error) {
        return refused(error instanceof PricingError ? error.message : "That could not be priced.");
      }
    },
  },
  {
    name: "company_profile",
    label: "Reading the company profile",
    description: "The company's name, time zone, which specialists are built or paused, its people and roles, and counts of active customers, ready cleaners and open hiring needs.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: {} },
    run: async (ctx) => {
      const members = await ctx.db
        .query("members")
        .withIndex("by_company", (q) => q.eq("companyId", ctx.company._id))
        .take(100);
      const customers = await ctx.db
        .query("customers")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "active"))
        .take(1000);
      const cleaners = await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "ready"))
        .take(1000);
      const needs = await ctx.db
        .query("hiringNeeds")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "open"))
        .take(200);
      return {
        status: "done",
        summary: `Read ${ctx.company.name}'s profile`,
        data: {
          name: ctx.company.name,
          timezone: ctx.company.timezone,
          specialists: AGENTS.map((agent) => ({ agent, built: AGENT_PROFILES[agent].built, paused: ctx.company.pausedAgents.includes(agent) })),
          notBuilt: ["marketing", "quality", "customer-care", "team-coordinator"],
          people: members.filter((row) => row.status === "active").map((row) => ({ name: row.name, role: row.role })),
          activeCustomers: customers.length,
          readyCleaners: cleaners.length,
          openHiringNeeds: needs.map((row) => ({ needId: row._id, title: row.title, openings: row.openings, payApproved: Boolean(row.compensation) })),
          services: businessSettingsOf(ctx.company)
            .services?.filter((service) => service.status === "active")
            .map((service) => ({ name: service.name, scope: service.scope, durationMinutes: service.durationMinutes, defaultCrew: service.defaultCrew, startingPrice: service.startingPriceCents === undefined ? "not set" : money(service.startingPriceCents) })) ?? [],
          priceNote: "Starting prices are the Owner's, set in Settings › Services & pricing. They are defaults for new visits, not quotes.",
        },
      };
    },
  },
  {
    name: "attention_summary",
    label: "Checking what needs attention",
    description: "What needs a person now: approvals waiting, tasks handed to a person, overdue tasks, and visits in the next days without enough accepted cleaners.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { days: { type: "number", optional: true, integer: true, min: 1, max: 14, description: "How many days ahead to look for uncovered visits. Default 7." } } },
    run: async (ctx, args) => {
      const now = Date.now();
      const days = (args.days as number | undefined) ?? 7;
      const approvals = await ctx.db
        .query("approvals")
        .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", ctx.company._id).eq("status", "pending"))
        .take(100);
      const decisions = await ctx.db
        .query("tasks")
        .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.company._id).eq("status", "needs_decision"))
        .take(100);
      const overdue = await ctx.db
        .query("tasks")
        .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.company._id).eq("status", "open").lt("dueAt", now))
        .take(100);
      const jobs = await ctx.db
        .query("jobs")
        .withIndex("by_company_status_start", (q) => q.eq("companyId", ctx.company._id).eq("status", "scheduled").gte("startsAt", now).lt("startsAt", now + days * DAY))
        .take(300);
      const uncovered = [];
      for (const job of jobs) {
        const crew = await accepted(ctx, job);
        if (crew.accepted < crew.required) uncovered.push({ jobId: job._id, when: when(job.startsAt, ctx.company.timezone), customer: await nameOf(ctx, job.customerId), service: job.serviceType, accepted: crew.accepted, required: crew.required, offersOut: crew.offered });
      }
      const canDecide = isManager(ctx.role);
      return {
        status: "done",
        summary: `${approvals.length} approval${approvals.length === 1 ? "" : "s"} waiting, ${decisions.length} task${decisions.length === 1 ? "" : "s"} with a person, ${overdue.length} overdue, ${uncovered.length} uncovered visit${uncovered.length === 1 ? "" : "s"} in ${days} days`,
        link: { href: "/app/approvals", label: "Open Approvals" },
        data: {
          approvals: canDecide ? approvals.slice(0, 15).map((row) => ({ approvalId: row._id, agent: row.agent, summary: row.summary, decideBy: when(row.decideBy, ctx.company.timezone) })) : { count: approvals.length, note: "Owners and Managers decide approvals." },
          withPerson: decisions.slice(0, 15).map((row) => ({ taskId: row._id, title: row.title, question: row.openQuestion ?? null })),
          overdue: overdue.slice(0, 15).map((row) => ({ taskId: row._id, title: row.title, nextAction: row.nextAction ?? null, due: when(row.dueAt, ctx.company.timezone) })),
          uncoveredVisits: uncovered.slice(0, 30),
          truncated: jobs.length === 300,
        },
      };
    },
  },
  {
    name: "list_jobs",
    label: "Reading the schedule",
    description: "Visits between two dates on the company's clock (up to 14 days), with customer, service, price if set, and accepted versus required cleaners.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { from: { type: "string", max: 10, description: "First day, YYYY-MM-DD." }, to: { type: "string", max: 10, description: "Last day included, YYYY-MM-DD." } } },
    run: async (ctx, args) => {
      const tz = ctx.company.timezone;
      const from = localDay(args.from as string, tz);
      const last = localDay(args.to as string, tz);
      if (last < from) return refused("The last day is before the first.");
      const to = addLocalDays(last, 1, tz);
      if (to - from > 15 * DAY) return refused("Ask for 14 days or fewer at a time.");
      const jobs = await ctx.db
        .query("jobs")
        .withIndex("by_company_start", (q) => q.eq("companyId", ctx.company._id).gte("startsAt", from).lt("startsAt", to))
        .take(300);
      const rows = [];
      for (const job of jobs) {
        const crew = await accepted(ctx, job);
        rows.push({ jobId: job._id, when: when(job.startsAt, tz), ends: clock(job.endsAt, tz), customer: await nameOf(ctx, job.customerId), service: job.serviceType, status: job.status, price: job.priceCents === undefined ? "not set" : money(job.priceCents), accepted: crew.accepted, required: crew.required, offersOut: crew.offered, uncovered: job.status === "scheduled" && crew.accepted < crew.required });
      }
      return { status: "done", summary: `${rows.length} visit${rows.length === 1 ? "" : "s"} from ${args.from} to ${args.to}; ${rows.filter((row) => row.uncovered).length} without enough accepted cleaners`, link: { href: "/app/schedule", label: "Open the schedule" }, data: { visits: rows, truncated: jobs.length === 300 } };
    },
  },
  {
    name: "find_records",
    label: "Looking up records",
    description: "Find customers, cleaners, hiring needs or applicants by name. Returns ids to use with get_record.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { kind: { type: "string", enum: ["customers", "cleaners", "hiringNeeds", "applicants"] }, query: { type: "string", max: 100 } } },
    run: async (ctx, args) => {
      const query = (args.query as string).toLowerCase();
      const match = (value: string | undefined) => (value ?? "").toLowerCase().includes(query);
      let found: Record<string, unknown>[] = [];
      if (args.kind === "customers") {
        const rows = await ctx.db
          .query("customers")
          .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", "active"))
          .take(1000);
        found = rows.filter((row) => match(row.name)).map((row) => ({ id: row._id, table: "customers", name: row.name, kind: row.kind }));
      } else if (args.kind === "cleaners") {
        const rows = [];
        for (const status of ["ready", "onboarding", "paused"] as const) rows.push(...(await ctx.db.query("cleaners").withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id).eq("status", status)).take(500)));
        found = rows.filter((row) => match(row.name)).map((row) => ({ id: row._id, table: "cleaners", name: row.name, status: row.status }));
      } else if (args.kind === "hiringNeeds") {
        const rows = await ctx.db
          .query("hiringNeeds")
          .withIndex("by_company_status", (q) => q.eq("companyId", ctx.company._id))
          .take(300);
        found = rows.filter((row) => match(row.title)).map((row) => ({ id: row._id, table: "hiringNeeds", title: row.title, status: row.status }));
      } else {
        const applicants = await ctx.db
          .query("applicants")
          .withIndex("by_company_email", (q) => q.eq("companyId", ctx.company._id))
          .take(1000);
        for (const applicant of applicants.filter((row) => match(row.name))) {
          const applications = await ctx.db
            .query("applications")
            .withIndex("by_company_applicant", (q) => q.eq("companyId", ctx.company._id).eq("applicantId", applicant._id))
            .take(5);
          for (const application of applications) found.push({ id: application._id, table: "applications", name: applicant.name ?? "Unnamed applicant", stage: application.stage });
        }
      }
      return { status: "done", summary: `${found.length} match${found.length === 1 ? "" : "es"} for "${args.query}"`, data: { matches: found.slice(0, 25), more: found.length > 25 } };
    },
  },
  {
    name: "get_record",
    label: "Reading a record",
    description: "Read one customer, property, cleaner, visit (jobs), task, application or hiring need by id.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { table: { type: "string", enum: ["customers", "properties", "cleaners", "jobs", "tasks", "applications", "hiringNeeds"] }, id: ID("The record's id.") } },
    run: async (ctx, args) => {
      const summary = await describeRecord(ctx, args.table as RecordTable, args.id as string);
      return summary ? { status: "done", summary: `Read ${summary.label}`, data: summary.data, record: summary.record, link: summary.link } : refused("No such record in this company.");
    },
  },
  {
    name: "list_tasks",
    label: "Reading tasks",
    description: "Tasks in the shared task system by status.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { status: { type: "string", enum: ["open", "waiting", "needs_decision", "done", "cancelled"] } } },
    run: async (ctx, args) => {
      const rows = await ctx.db
        .query("tasks")
        .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.company._id).eq("status", args.status as Doc<"tasks">["status"]))
        .take(50);
      return { status: "done", summary: `${rows.length} ${args.status} task${rows.length === 1 ? "" : "s"}`, data: { tasks: rows.map((row) => ({ taskId: row._id, agent: row.agent, title: row.title, nextAction: row.nextAction ?? null, due: when(row.dueAt, ctx.company.timezone), question: row.openQuestion ?? null })) } };
    },
  },

  // ── Dispatch ──
  {
    name: "inspect_visit_staffing",
    label: "Dispatch is checking the visit",
    description: "Dispatch's view of one visit: who has accepted, offers out, coverage requests, its task, and the cleaners who are eligible (ranked) or excluded by a hard rule, with reasons.",
    kind: "read",
    minimumRole: "office",
    specialist: "dispatch",
    input: { type: "object", properties: { jobId: ID("The visit's id (jobs).") } },
    run: async (ctx, args) => {
      const job = await ownedRow(ctx, "jobs", args.jobId);
      if (!job) return refused("No such visit in this company.");
      const inspected = await dispatchTool(ctx, ctx.company, "inspect_job", { jobId: job._id });
      const eligible = await dispatchTool(ctx, ctx.company, "find_eligible_cleaners", { jobId: job._id });
      return { status: "done", summary: `Dispatch read the visit on ${when(job.startsAt, ctx.company.timezone)}`, data: { visit: inspected.result, cleaners: eligible.result }, record: { kind: "job", id: job._id } };
    },
  },
  {
    name: "request_dispatch_offer",
    label: "Dispatch is preparing an offer",
    description:
      "Ask Dispatch to offer a visit to a named eligible cleaner, under Dispatch's current permission: on Propose it puts an approval in the queue; on Execute it texts the offer. The person approves the exact effect in chat first. Managers and Owners only.",
    kind: "write",
    minimumRole: "manager",
    specialist: "dispatch",
    confirm: true,
    input: { type: "object", properties: { jobId: ID("The visit's id (jobs)."), cleanerId: ID("The eligible cleaner's id.") } },
    preview: async (ctx, args) => {
      const job = await ownedRow(ctx, "jobs", args.jobId);
      const cleaner = await ownedRow(ctx, "cleaners", args.cleanerId);
      if (!job || !cleaner) return refused("No such visit or cleaner in this company.");
      const crew = await accepted(ctx, job);
      const action = await currentCoverAction(ctx, job, crew.assignments);
      const authority = await authorityFor(ctx, ctx.company._id, action);
      if (authority.kind !== "level" || authority.level === "off") return refused(`Dispatch is not allowed to do this right now (${authority.kind === "paused" ? "Dispatch is paused" : "the permission is off"}).`);
      const effect = authority.level === "propose" ? "Dispatch puts an approval in the Approvals queue. Nothing is sent to the cleaner until an Owner or Manager approves it there." : `Dispatch texts the offer to ${cleaner.name} now, because its permission for this is ${authority.level.replace(/_/g, " ")}.`;
      return {
        status: "needs_approval",
        preview: {
          summary: `Offer the visit on ${when(job.startsAt, ctx.company.timezone)} to ${cleaner.name}`,
          lines: [effect, `Visit: ${job.serviceType} for ${await nameOf(ctx, job.customerId)}, ${crew.accepted} of ${crew.required} accepted.`, "Dispatch checks the hard rules again when you approve; an ineligible cleaner is refused."],
          bindsTo: stableHash({ job: job._id, startsAt: job.startsAt, status: job.status, cleaner: cleaner._id, action, level: authority.level, assignments: crew.assignments.map((row) => [row._id, row.status]) }),
        },
      };
    },
    run: async (ctx, args) => {
      const job = await ownedRow(ctx, "jobs", args.jobId);
      const cleaner = await ownedRow(ctx, "cleaners", args.cleanerId);
      if (!job || !cleaner) return refused("No such visit or cleaner in this company.");
      const answer = await specialist(ctx, "dispatch", "request_dispatch_approval", { jobId: job._id, cleanerId: cleaner._id });
      if (answer.outcome === "refused") return refused(String(answer.result.why ?? "Dispatch refused."), { authorization: answer.authorization });
      const approvalId = answer.result.approvalId as Id<"approvals"> | undefined;
      return {
        status: answer.outcome === "proposed" ? "proposed" : "done",
        summary: answer.outcome === "proposed" ? `Dispatch asked for approval to offer the visit to ${cleaner.name}` : `Dispatch offered the visit to ${cleaner.name}`,
        data: { ...answer.result, authorization: answer.authorization, repeated: answer.repeated },
        record: approvalId ? { kind: "approval", id: approvalId } : { kind: "job", id: job._id },
        link: answer.outcome === "proposed" ? { href: "/app/approvals", label: "Open Approvals" } : { href: "/app/schedule", label: "Open the schedule" },
      };
    },
  },

  // ── Recruiter ──
  {
    name: "inspect_application",
    label: "Recruiter is reading the application",
    description: "Recruiter's view of one application: stage, next action, form progress, messages, and its screening summary and recommendation. A person decides; this decides nothing.",
    kind: "read",
    minimumRole: "office",
    specialist: "recruiter",
    input: { type: "object", properties: { applicationId: ID("The application's id.") } },
    run: async (ctx, args) => {
      const application = await ownedRow(ctx, "applications", args.applicationId);
      if (!application) return refused("No such application in this company.");
      const progress = await recruiterTool(ctx, ctx.company, "inspect_application_progress", { applicationId: application._id });
      const summary = await recruiterTool(ctx, ctx.company, "prepare_candidate_summary", { applicationId: application._id });
      return { status: "done", summary: "Recruiter read the application", data: { progress: progress.result, screening: summary.outcome === "refused" ? { unavailable: summary.result.why } : summary.result } };
    },
  },
  {
    name: "request_application_invitation",
    label: "Recruiter is routing the invitation",
    description: "Ask Recruiter to invite an applicant to fill in the application, under its current permission and the company's invitation mode. The person approves the exact effect in chat first. Managers and Owners only.",
    kind: "write",
    minimumRole: "manager",
    specialist: "recruiter",
    confirm: true,
    input: { type: "object", properties: { applicationId: ID("The application's id.") } },
    preview: async (ctx, args) => {
      const application = await ownedRow(ctx, "applications", args.applicationId);
      if (!application) return refused("No such application in this company.");
      const prepared = await recruiterTool(ctx, ctx.company, "prepare_invitation", { applicationId: application._id });
      if (prepared.outcome === "refused") return refused(String(prepared.result.why));
      const authority = await authorityFor(ctx, ctx.company._id, "recruiter.send_invitation");
      if (authority.kind !== "level" || authority.level === "off") return refused("Recruiter is not allowed to invite applicants right now.");
      const blocked = prepared.result.blockedBy as string | null;
      return {
        status: "needs_approval",
        preview: {
          summary: `Invite the applicant to apply${prepared.result.to ? ` at ${prepared.result.to}` : ""}`,
          lines: [
            authority.level === "propose" ? "Recruiter puts the invitation in the Approvals queue; nothing is emailed until it is approved there." : "Recruiter may email the invitation now if the company's rules allow sending without review; otherwise it waits in Approvals.",
            `Subject: ${String(prepared.result.subject ?? "")}`,
            ...(blocked ? [`Sending is currently blocked: ${blocked}`] : []),
          ],
          bindsTo: stableHash({ application: application._id, stage: application.stage, level: authority.level, to: prepared.result.to }),
        },
      };
    },
    run: async (ctx, args) => {
      const application = await ownedRow(ctx, "applications", args.applicationId);
      if (!application) return refused("No such application in this company.");
      const answer = await specialist(ctx, "recruiter", "request_approval", { applicationId: application._id });
      if (answer.outcome === "refused") return refused(String(answer.result.why ?? "Recruiter refused."));
      return { status: answer.outcome === "proposed" ? "proposed" : "done", summary: answer.outcome === "proposed" ? "The invitation is waiting for approval" : `Recruiter moved the application to ${String(answer.result.stage)}`, data: { ...answer.result, authorization: answer.authorization }, link: { href: "/app/approvals", label: "Open Approvals" } };
    },
  },
  {
    name: "prepare_hiring_offer",
    label: "Recruiter is drafting the offer",
    description: "Ask Recruiter to draft a hiring offer on the role's Owner-approved pay. It is a draft for approval in the Approvals queue; nothing is sent. Managers and Owners only.",
    kind: "write",
    minimumRole: "manager",
    specialist: "recruiter",
    input: { type: "object", properties: { applicationId: ID("The application's id."), startConditions: { type: "string", max: 2000 }, expectations: { type: "string", max: 2000 } } },
    run: async (ctx, args) => {
      const application = await ownedRow(ctx, "applications", args.applicationId);
      if (!application) return refused("No such application in this company.");
      const answer = await specialist(ctx, "recruiter", "prepare_offer", { applicationId: application._id, startConditions: args.startConditions as string, expectations: args.expectations as string });
      if (answer.outcome === "refused") return refused(String(answer.result.why ?? "Recruiter refused."));
      return { status: "proposed", summary: `Recruiter drafted an offer (${String(answer.result.pay ?? "pay as approved")}); it is not sent`, data: { ...answer.result, authorization: answer.authorization }, link: { href: "/app/approvals", label: "Open Approvals" } };
    },
  },
  {
    name: "create_hiring_need",
    label: "Preparing a hiring need",
    description:
      "Open a role the company is hiring for. The Owner approves the exact role in chat first. It opens with no pay: the Owner approves pay separately in Hiring Needs, and an offer can only carry approved pay. Owner only.",
    kind: "write",
    minimumRole: "owner",
    specialist: "recruiter",
    confirm: true,
    input: {
      type: "object",
      properties: {
        title: { type: "string", max: 120 },
        responsibilities: { type: "string", max: 4000 },
        location: { type: "string", max: 200 },
        requiredAvailability: { type: "string", max: 1000 },
        engagement: { type: "string", enum: ["contractor", "employee"] },
        openings: { type: "number", integer: true, min: 1, max: 500 },
        coverageAreas: { type: "array", optional: true, items: { type: "string", max: 20 }, maxItems: 50, description: "Postal codes." },
        experience: { type: "string", optional: true, max: 1000 },
        equipment: { type: "string", optional: true, max: 1000 },
      },
    },
    preview: async (ctx, args) => {
      try {
        const role = checkedNeed(args as Parameters<typeof checkedNeed>[0]);
        return {
          status: "needs_approval",
          preview: {
            summary: `Open the role "${role.title}" (${role.openings} opening${role.openings === 1 ? "" : "s"}, ${role.engagement})`,
            lines: [`Location: ${role.location}`, `Availability: ${role.requiredAvailability}`, `Responsibilities: ${role.responsibilities.slice(0, 400)}`, "Pay is not set by this. Approve pay in Hiring Needs before any offer."],
            bindsTo: stableHash(role),
          },
        };
      } catch (error) {
        return refused((error as { data?: { message?: string } }).data?.message ?? "The role is not complete.");
      }
    },
    run: async (ctx, args) => {
      const needId = await openNeed(ctx, ctx.company._id, ctx.member, args as Parameters<typeof openNeed>[3]);
      return { status: "done", summary: `Opened the role "${String(args.title)}" with no pay set yet`, data: { needId, payApproved: false }, link: { href: "/app/agents/recruiter/hiring-needs", label: "Hiring Needs" } };
    },
  },

  // ── Quality ──
  {
    name: "review_visit_photos",
    label: "Quality is reviewing the photos",
    description:
      "Look at the photos a cleaner uploaded for one visit, against its checklist: what is visible, which checklist items the photos show done or not done, and what the photos cannot show. It describes; it does not judge the worker, infer sanitation, safety or hidden damage, or decide anything. Propose a review task with create_task when something needs a person.",
    kind: "read",
    minimumRole: "office",
    specialist: "quality",
    input: { type: "object", properties: { jobId: ID("The visit's id (jobs).") } },
    run: async (ctx, args) => {
      if (!featureOn(ctx.company, "photoReview")) return refused("The Owner has switched photo review off for this company.");
      const job = await ownedRow(ctx, "jobs", args.jobId);
      if (!job) return refused("No such visit in this company.");
      const evidence = await ctx.db.query("evidence").withIndex("by_company_job", (q) => q.eq("companyId", ctx.company._id).eq("jobId", job._id)).take(40);
      if (evidence.length === 0) return refused("No photos were uploaded for this visit, so there is nothing to review.");
      const items = await ctx.db.query("checklistItems").withIndex("by_company_job", (q) => q.eq("companyId", ctx.company._id).eq("jobId", job._id)).take(60);
      const photos = [];
      for (const photo of evidence.slice(0, 8)) {
        const meta = await ctx.db.system.get(photo.storageId);
        if (meta) photos.push({ storageId: photo.storageId, label: `${photo.kind}${photo.checklistItemId ? ` (${items.find((item) => item._id === photo.checklistItemId)?.label ?? "checklist item"})` : ""} ${photos.length + 1}`, contentType: meta.contentType ?? "image/jpeg" });
      }
      return { status: "deferred", work: { kind: "photo_review", jobId: job._id, scope: job.scope, checklist: items.map((item) => item.label), photos }, record: { kind: "job", id: job._id } };
    },
  },
  {
    name: "review_video",
    label: "Reviewing the video",
    description: "Describe what is visible in a video from Creative Studio, with MM:SS timestamps, answering a question about it. Describes only; no judgments about workers.",
    kind: "read",
    minimumRole: "office",
    specialist: "quality",
    input: { type: "object", properties: { assetId: ID("The Creative Studio video's id."), question: { type: "string", max: 500 } } },
    run: async (ctx, args) => {
      const asset = await ownedAsset(ctx, ctx.company._id, args.assetId as string).catch(() => null);
      if (!asset || asset.kind !== "video") return refused("No such video in Creative Studio.");
      return { status: "deferred", work: { kind: "video_review", assetId: asset._id, storageId: asset.storageId, contentType: asset.contentType, question: args.question as string } };
    },
  },
  {
    name: "search_company_documents",
    label: "Searching company knowledge and your drafts",
    description: "Search confirmed company knowledge and your own saved drafts by meaning. Returns passages with where each came from. For live records (visits, customers, tasks) use the other tools: they are the truth.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { query: { type: "string", max: 500 } } },
    run: async (ctx, args) => {
      if (!featureOn(ctx.company, "documentSearch")) return refused("The Owner has switched document search off for this company.");
      return { status: "deferred", work: { kind: "document_search", query: args.query as string } };
    },
  },

  // ── Marketing: Creative Studio ──
  {
    name: "request_creative",
    label: "Marketing is preparing a creative",
    description:
      "Generate an illustrative image or a short promotional video in Creative Studio from a prompt. Generated media is labelled as generated and must never be presented as real before/after work. Real job photos are composed in Creative Studio, not generated. Uses the company's monthly generation allowance; the person approves first. Owners and Managers only.",
    kind: "write",
    minimumRole: "manager",
    specialist: "marketing",
    confirm: true,
    input: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["image", "video"] },
        prompt: { type: "string", max: 4000 },
        size: { type: "string", optional: true, enum: ["1024x1024", "1536x1024", "1024x1536"] },
        aspectRatio: { type: "string", optional: true, enum: ["16:9", "9:16"] },
        durationSeconds: { type: "number", optional: true, integer: true, min: 4, max: 10 },
        count: { type: "number", optional: true, integer: true, min: 1, max: 4 },
      },
    },
    preview: async (ctx, args) => {
      const kind = args.kind === "video" ? "video_generate" : "image_generate";
      if (!featureOn(ctx.company, kind)) return refused(`The Owner has switched ${args.kind} generation off for this company.`);
      let params;
      try {
        params = checkedParams(kind, { size: args.size as never, aspectRatio: args.aspectRatio as never, durationSeconds: args.durationSeconds as number | undefined, n: args.count as number | undefined });
      } catch (error) {
        return refused((error as { data?: { message?: string } }).data?.message ?? "Those settings are not available.");
      }
      const capability = capabilityFor(kind, params);
      const resolved = resolveCapability(capability, await settingFor(ctx, capability));
      if (!resolved.ready) return refused(resolved.words);
      const limit = mediaAllowance();
      const row = await allowanceRow(ctx, ctx.company._id, monthKey(Date.now()));
      const used = kind === "video_generate" ? (row?.videosUsed ?? 0) + (row?.videosReserved ?? 0) : (row?.imagesUsed ?? 0) + (row?.imagesReserved ?? 0);
      const want = kind === "video_generate" ? 1 : (params.n ?? 1);
      const cap = kind === "video_generate" ? limit.videos : limit.images;
      if (used + want > cap) return refused(`This company has ${Math.max(0, cap - used)} ${args.kind} generation${cap - used === 1 ? "" : "s"} left this month.`);
      return {
        status: "needs_approval",
        preview: {
          summary: kind === "video_generate" ? `Generate a ${params.durationSeconds}-second ${params.aspectRatio} video` : `Generate ${want} image${want === 1 ? "" : "s"} at ${params.size}`,
          lines: [`Prompt: ${String(args.prompt).slice(0, 400)}`, `Model: ${resolved.model.model} (${resolved.model.provider}). Uses ${want} of this month's ${cap} (${used} used or in progress).`, "It is labelled as generated wherever it appears. It is not evidence of real work."],
          bindsTo: stableHash({ kind, prompt: args.prompt, params, model: resolved.model.model, cap }),
        },
      };
    },
    run: async (ctx, args) => {
      const kind = args.kind === "video" ? "video_generate" : "image_generate";
      try {
        const jobId = await queueGeneration(ctx, { company: ctx.company, member: ctx.member, kind, prompt: args.prompt as string, sources: [], params: { size: args.size as never, aspectRatio: args.aspectRatio as never, durationSeconds: args.durationSeconds as number | undefined, n: args.count as number | undefined } });
        return { status: "done", summary: `Started a ${args.kind} generation in Creative Studio`, data: { jobId, state: "queued", note: "It runs in the background; the result appears in Creative Studio when the provider finishes." }, link: { href: "/app/agents/marketing/content-creative", label: "Open Creative Studio" } };
      } catch (error) {
        return refused((error as { data?: { message?: string } }).data?.message ?? "The generation could not be started.");
      }
    },
  },

  // ── Tasks ──
  {
    name: "create_task",
    label: "Creating a task",
    description:
      "Create a task in the shared task system. Every task belongs to one specialist (sales, recruiter, dispatch or retention) that is responsible for it, with a next action, a deadline and a completion condition. Tasks cannot be assigned to a named person yet.",
    kind: "write",
    minimumRole: "office",
    input: {
      type: "object",
      properties: {
        agent: { type: "string", enum: [...AGENTS] },
        title: { type: "string", max: 200 },
        nextAction: { type: "string", max: 500 },
        due: { type: "string", max: 16, description: "When the next action is due, YYYY-MM-DD or YYYY-MM-DDTHH:MM on the company's clock." },
        completionCondition: { type: "string", max: 500 },
        about: { ...refField, optional: true },
      },
    },
    run: async (ctx, args) => {
      const dueAt = localInstant(args.due as string, ctx.company.timezone);
      if (dueAt < Date.now() - DAY) return refused("That deadline has already passed.");
      const key = `chat.task:${ctx.idempotencyKey}`;
      const existing = await liveTaskByKey(ctx, ctx.company._id, key);
      const about = args.about as { table: string; id: string } | undefined;
      let aboutRef: Doc<"tasks">["about"];
      if (about) {
        if (!["customers", "properties", "cleaners", "jobs"].includes(about.table)) return refused("A task can be about a customer, property, cleaner or visit.");
        const row = await ownedRow(ctx, about.table as "customers", about.id);
        if (!row) return refused("The record the task is about is not in this company.");
        aboutRef = { table: about.table, id: row._id } as Doc<"tasks">["about"];
      }
      const taskId =
        existing?._id ??
        (await openTask(ctx, { companyId: ctx.company._id, agent: args.agent as Agent, title: args.title as string, nextAction: args.nextAction as string, dueAt, completionCondition: args.completionCondition as string, about: aboutRef, key, actor: CHAT_ACTOR(ctx) }));
      if (!existing) await ctx.db.patch(taskId, { trigger: "Asked for in Company Chat." });
      return { status: "done", summary: `Created the task "${String(args.title)}" for ${AGENT_PROFILES[args.agent as Agent].name}, due ${when(dueAt, ctx.company.timezone)}`, data: { taskId, agent: args.agent, due: when(dueAt, ctx.company.timezone) }, record: { kind: "task", id: taskId } };
    },
  },

  // ── Create and revise ──
  {
    name: "save_draft",
    label: "Saving the draft",
    description:
      "Save a long output (agreement, proposal, pricing worksheet, SOP, checklist, onboarding guide, role description, message, campaign, plan, report) as an editable, versioned draft in Markdown. Mark every unknown term as [[TO CONFIRM: what is needed]]. Use this instead of pasting a long document into the reply.",
    kind: "draft",
    minimumRole: "office",
    input: {
      type: "object",
      properties: {
        title: { type: "string", max: 160 },
        kind: { type: "string", enum: [...ARTIFACT_KINDS] },
        content: { type: "string", max: 200_000, description: "The whole document in Markdown." },
        linked: { type: "array", optional: true, items: refField, maxItems: 10 },
      },
    },
    run: async (ctx, args) => {
      const artifactId = await createArtifact(ctx, { companyId: ctx.company._id, memberId: ctx.member._id, conversationId: ctx.conversationId, title: args.title as string, kind: args.kind as ArtifactKind, content: args.content as string, linked: args.linked as never, author: { kind: "assistant", runId: ctx.runId }, actor: CHAT_ACTOR(ctx) });
      const open = unresolvedFields(args.content as string);
      return { status: "done", summary: `Saved "${String(args.title)}" as a draft (version 1)`, data: { artifactId, version: 1, unresolved: open }, artifact: { artifactId, version: 1 } };
    },
  },
  {
    name: "read_draft",
    label: "Reading the draft",
    description: "Read a saved draft's content and status, at its latest or a named version.",
    kind: "read",
    minimumRole: "office",
    input: { type: "object", properties: { artifactId: ID("The draft's id."), version: { type: "number", optional: true, integer: true, min: 1 } } },
    run: async (ctx, args) => {
      const artifact = await readableArtifact(ctx, ctx.company._id, ctx.member._id, args.artifactId as string).catch(() => null);
      if (!artifact) return refused("No such draft.");
      const version = await versionOf(ctx, artifact, (args.version as number | undefined) ?? artifact.currentVersion);
      if (!version) return refused("No such version.");
      return { status: "done", summary: `Read "${artifact.title}" version ${version.version}`, data: { artifactId: artifact._id, title: artifact.title, kind: artifact.kind, version: version.version, latestVersion: artifact.currentVersion, state: STATE_WORDS[artifact.state], content: version.content.slice(0, 60_000) } };
    },
  },
  {
    name: "revise_draft",
    label: "Revising the draft",
    description: "Save a new version of an existing draft. Give the whole revised document and the version you revised from; it is refused if the draft changed since.",
    kind: "draft",
    minimumRole: "office",
    input: {
      type: "object",
      properties: { artifactId: ID("The draft's id."), baseVersion: { type: "number", integer: true, min: 1 }, content: { type: "string", max: 200_000 }, note: { type: "string", optional: true, max: 300, description: "What changed, in a few words." } },
    },
    run: async (ctx, args) => {
      const artifact = await readableArtifact(ctx, ctx.company._id, ctx.member._id, args.artifactId as string).catch(() => null);
      if (!artifact) return refused("No such draft.");
      try {
        const version = await reviseArtifact(ctx, artifact, { baseVersion: args.baseVersion as number, content: args.content as string, note: args.note as string | undefined, author: { kind: "assistant", runId: ctx.runId }, actor: CHAT_ACTOR(ctx) });
        return { status: "done", summary: version === artifact.currentVersion ? `"${artifact.title}" was already this text (version ${version})` : `Saved "${artifact.title}" version ${version}`, data: { artifactId: artifact._id, version, unresolved: unresolvedFields(args.content as string) }, artifact: { artifactId: artifact._id, version } };
      } catch (error) {
        return refused((error as { data?: { message?: string } }).data?.message ?? "The draft could not be revised.");
      }
    },
  },
  {
    name: "record_draft_status",
    label: "Recording the document's status",
    description:
      "Record, for the exact version shown, that a document's terms were approved, that it was sent, or that it was signed. These are a person's records of things done outside Selestial; no signing service is connected. The person approves in chat first. Managers and Owners only.",
    kind: "write",
    minimumRole: "manager",
    confirm: true,
    input: { type: "object", properties: { artifactId: ID("The draft's id."), version: { type: "number", integer: true, min: 1 }, state: { type: "string", enum: ARTIFACT_STATES.filter((state) => state !== "draft") }, note: { type: "string", optional: true, max: 500 } } },
    preview: async (ctx, args) => {
      const artifact = await readableArtifact(ctx, ctx.company._id, ctx.member._id, args.artifactId as string).catch(() => null);
      if (!artifact) return refused("No such draft.");
      if (args.version !== artifact.currentVersion) return refused(`The draft is at version ${artifact.currentVersion}, not ${String(args.version)}.`);
      const version = await versionOf(ctx, artifact);
      const open = unresolvedFields(version?.content ?? "");
      return {
        status: "needs_approval",
        preview: {
          summary: `Mark "${artifact.title}" version ${artifact.currentVersion} as ${STATE_WORDS[args.state as ArtifactState].toLowerCase()}`,
          lines: [...(open.length ? [`${open.length} field${open.length === 1 ? " is" : "s are"} still marked TO CONFIRM: ${open.slice(0, 5).join("; ")}`] : []), "This records what a person did. Selestial does not send or collect signatures."],
          bindsTo: stableHash({ artifact: artifact._id, version: artifact.currentVersion, state: args.state, from: artifact.state }),
        },
      };
    },
    run: async (ctx, args) => {
      const artifact = await readableArtifact(ctx, ctx.company._id, ctx.member._id, args.artifactId as string).catch(() => null);
      if (!artifact) return refused("No such draft.");
      try {
        await setArtifactState(ctx, artifact, { version: args.version as number, state: args.state as ArtifactState, note: args.note as string | undefined, memberId: ctx.member._id });
      } catch (error) {
        return refused((error as { data?: { message?: string } }).data?.message ?? "That could not be recorded.");
      }
      return { status: "done", summary: `Recorded "${artifact.title}" version ${String(args.version)} as ${STATE_WORDS[args.state as ArtifactState].toLowerCase()}`, data: { artifactId: artifact._id }, artifact: { artifactId: artifact._id, version: args.version as number } };
    },
  },

  // ── Memory ──
  {
    name: "propose_company_knowledge",
    label: "Proposing company knowledge",
    description:
      "When the person asks you to remember something for the company, propose it as company knowledge. It is not used until the Owner confirms it. It never changes an operating rule, price, pay or permission.",
    kind: "draft",
    minimumRole: "office",
    input: { type: "object", properties: { text: { type: "string", max: 500 } } },
    run: async (ctx, args) => {
      const id = await ctx.db.insert("companyKnowledge", { companyId: ctx.company._id, text: args.text as string, status: "proposed", proposedBy: ctx.member._id, fromConversationId: ctx.conversationId, createdAt: Date.now() });
      return { status: "proposed", summary: isOwner(ctx.role) ? "Proposed for company knowledge; confirm it below to use it" : "Proposed for company knowledge; the Owner confirms it", data: { knowledgeId: id, confirmed: false } };
    },
  },

  // ── Not available yet: said plainly, never pretended ──
  {
    name: "send_customer_message",
    label: "Sending a customer message",
    description: "Send a message to a customer. NOT AVAILABLE: call it only to learn the blocker when the person asks to send.",
    kind: "unavailable",
    minimumRole: "office",
    specialist: "customer-care",
    input: { type: "object", properties: { customerId: { ...ID("The customer's id."), optional: true }, body: { type: "string", optional: true, max: 4000 } } },
    run: async () => unavailable("Customer Care is not built, and the shared messaging policy has no customer-message purpose yet, so Selestial cannot send to customers. Save the reply as a draft and send it from your own email or phone."),
  },
  {
    name: "update_price_book",
    label: "Changing a live price",
    description: "Change a service's live price. NOT AVAILABLE: call it only to learn the blocker when the person asks to apply a price.",
    kind: "unavailable",
    minimumRole: "owner",
    specialist: "sales",
    input: { type: "object", properties: { service: { type: "string", optional: true, max: 200 }, priceCents: { type: "number", optional: true, integer: true, min: 0 } } },
    run: async () => unavailable("Chat does not change prices: changing prices is always a person's decision. The Owner sets each service's starting price in Settings › Services & pricing. Save the pricing as a draft package to take there."),
  },
  {
    name: "launch_campaign",
    label: "Launching a campaign",
    description: "Send or schedule a marketing campaign. NOT AVAILABLE: call it only to learn the blocker.",
    kind: "unavailable",
    minimumRole: "owner",
    specialist: "marketing",
    input: { type: "object", properties: { name: { type: "string", optional: true, max: 200 } } },
    run: async () =>
      unavailable(
        "No ad platform is connected. Running ads needs this company's own Meta ad account and Facebook Page authorized in Selestial, and Selestial's Meta app approved for ads management; neither is in place. Nothing was created in Meta and nothing was spent. The campaign can be drafted and saved, with creatives chosen in Creative Studio.",
      ),
  },
  {
    name: "send_for_signature",
    label: "Sending for signature",
    description: "Send a document for electronic signature. NOT AVAILABLE: call it only to learn the blocker.",
    kind: "unavailable",
    minimumRole: "manager",
    input: { type: "object", properties: { artifactId: { ...ID("The draft's id."), optional: true } } },
    run: async () => unavailable("No signing service is connected. Download or copy the document, have it signed outside Selestial, then record it as sent and signed on the draft."),
  },
  {
    name: "issue_refund_or_credit",
    label: "Issuing a refund or credit",
    description: "Refund or credit a customer. NOT AVAILABLE: call it only to learn the blocker.",
    kind: "unavailable",
    minimumRole: "owner",
    specialist: "retention",
    input: { type: "object", properties: { customerId: { ...ID("The customer's id."), optional: true } } },
    run: async () => unavailable("Selestial does not hold payments, and refunds or compensation are a person's decision. Record what you decide as a task if you want it tracked."),
  },
];

export type RecordTable = "customers" | "properties" | "cleaners" | "jobs" | "tasks" | "applications" | "hiringNeeds";

/** A short, role-appropriate description of one record. Null when it is not this company's. Used for tools and attached context. */
export async function describeRecord(ctx: (QueryCtx | MutationCtx) & { company: Doc<"companies">; role: Role }, table: RecordTable, id: string): Promise<{ label: string; data: Record<string, unknown>; record?: RecordRef; link?: Link } | null> {
  const tz = ctx.company.timezone;
  const normalized = ctx.db.normalizeId(table, id);
  const row = normalized ? ((await ctx.db.get(normalized)) as (Doc<RecordTable> & { companyId: Id<"companies"> }) | null) : null;
  if (!row || row.companyId !== ctx.company._id) return null;
  switch (table) {
    case "customers": {
      const customer = row as Doc<"customers">;
      const properties = await ctx.db.query("properties").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.company._id).eq("customerId", customer._id)).take(20);
      const jobs = await ctx.db.query("jobs").withIndex("by_company_customer", (q) => q.eq("companyId", ctx.company._id).eq("customerId", customer._id)).order("desc").take(10);
      return {
        label: `customer ${customer.name}`,
        data: { customerId: customer._id, name: customer.name, kind: customer.kind, email: customer.email ?? null, phone: customer.phone ?? null, preferences: customer.preferences ?? null, status: customer.status, properties: properties.map((p) => ({ propertyId: p._id, label: p.label ?? null, city: p.address.city, postalCode: p.address.postalCode })), recentVisits: jobs.map((job) => ({ jobId: job._id, when: when(job.startsAt, tz), service: job.serviceType, status: job.status, price: job.priceCents === undefined ? "not set" : money(job.priceCents) })) },
        link: { href: "/app/customers", label: "Customers & Properties" },
      };
    }
    case "properties": {
      const property = row as Doc<"properties">;
      return { label: `property ${property.label ?? property.address.line1}`, data: { propertyId: property._id, customer: await nameOf(ctx, property.customerId), address: property.address, kind: property.kind, accessInstructions: property.accessInstructions ?? null } };
    }
    case "cleaners": {
      const cleaner = row as Doc<"cleaners">;
      const windows = await ctx.db.query("availabilityWindows").withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.company._id).eq("cleanerId", cleaner._id)).take(30);
      return {
        label: `cleaner ${cleaner.name}`,
        data: {
          cleanerId: cleaner._id,
          name: cleaner.name,
          status: cleaner.status,
          engagement: cleaner.engagement,
          skills: cleaner.skills,
          serviceAreas: cleaner.serviceAreas,
          availability: windows.map((w) => ({ weekday: w.weekday, from: w.startMinute, to: w.endMinute })),
          // Pay is the Owner's to see.
          pay: isOwner(ctx.role) ? (cleaner.pay ?? null) : "Shown to the Owner only.",
        },
        link: { href: "/app/cleaners", label: "Cleaners" },
      };
    }
    case "jobs": {
      const job = row as Doc<"jobs">;
      const assignments = await jobAssignments(ctx, job);
      const crew = await Promise.all(assignments.map(async (a) => ({ cleaner: await nameOf(ctx, a.cleanerId), status: a.status })));
      const task = await liveTaskByKey(ctx, ctx.company._id, coverKey(job._id));
      return {
        label: `the visit on ${when(job.startsAt, tz)}`,
        data: { jobId: job._id, when: when(job.startsAt, tz), ends: clock(job.endsAt, tz), customer: await nameOf(ctx, job.customerId), service: job.serviceType, scope: job.scope, status: job.status, price: job.priceCents === undefined ? "not set" : money(job.priceCents), requiredCrew: job.requiredCrew ?? 1, crew, coverageTask: task ? { status: task.status, nextAction: task.nextAction ?? null } : null },
        record: { kind: "job", id: job._id },
      };
    }
    case "tasks": {
      const task = row as Doc<"tasks">;
      return { label: `task "${task.title}"`, data: { taskId: task._id, agent: task.agent, title: task.title, status: task.status, nextAction: task.nextAction ?? null, due: when(task.dueAt, tz), question: task.openQuestion ?? null, completionCondition: task.completionCondition, outcome: task.outcome ?? null }, record: { kind: "task", id: task._id } };
    }
    case "applications": {
      const application = row as Doc<"applications">;
      const applicant = await ctx.db.get(application.applicantId);
      const need = application.needId ? await ctx.db.get(application.needId) : null;
      return { label: `the application from ${applicant?.name ?? "an applicant"}`, data: { applicationId: application._id, applicant: applicant?.name ?? null, role: need?.title ?? application.roleSeen ?? null, stage: application.stage, nextAction: application.nextAction ?? null }, link: { href: "/app/agents/recruiter/applicants", label: "Applicants" } };
    }
    case "hiringNeeds": {
      const need = row as Doc<"hiringNeeds">;
      return { label: `the role "${need.title}"`, data: { needId: need._id, title: need.title, status: need.status, openings: need.openings, engagement: need.engagement, location: need.location, payApproved: Boolean(need.compensation), pay: isOwner(ctx.role) ? (need.compensation?.pay ?? null) : need.compensation ? "Approved; shown to the Owner." : null }, link: { href: "/app/agents/recruiter/hiring-needs", label: "Hiring Needs" } };
    }
  }
}

/** The one tool that is not a business function: offering the person a few choices to answer with. */
export const ASK_FOLLOWUP = {
  name: "ask_followup",
  description: "Ask the person one focused question with two to five short answers to choose from, when you cannot continue accurately without it. Use rarely; never for simple requests.",
  input: { type: "object" as const, properties: { question: { type: "string" as const, max: 300 }, options: { type: "array" as const, items: { type: "string" as const, max: 80 }, maxItems: 5, minItems: 2 } } },
};

const ALL: ChatTool[] = [...TOOLS, ...AGREEMENT_TOOLS];
export const TOOL_BY_NAME = new Map(ALL.map((tool) => [tool.name, tool]));
export const ALL_TOOLS: readonly ChatTool[] = ALL;

/**
 * Why a specialist's tool may not run for this company, or null. Chat answers general questions on any
 * plan, but it never runs an agent's work that the agent's own screens could not: an unreleased agent, or
 * one outside the company's verified plan, is closed to Chat as well.
 */
export function specialistBlock(company: Pick<Doc<"companies">, "plan">, tool: Pick<ChatTool, "specialist" | "kind">): string | null {
  if (!tool.specialist || tool.kind === "unavailable") return null;
  const verdict = agentVerdict(company, tool.specialist);
  return verdict.ok ? null : verdict.message;
}

/** The tools a member with this role is offered. A tool they may not use is not offered, and refused if called anyway. */
export function toolsFor(role: Role, company: Pick<Doc<"companies">, "plan">): ChatTool[] {
  return ALL.filter((tool) => (tool.kind === "unavailable" || roleAllows(role, tool.minimumRole)) && specialistBlock(company, tool) === null);
}

/** The tool definitions a model is given. */
export function toolSpecs(role: Role, company: Pick<Doc<"companies">, "plan">) {
  return [
    ...toolsFor(role, company).map((tool) => ({ name: tool.name, description: tool.description, input_schema: jsonSchema(tool.input) })),
    { name: ASK_FOLLOWUP.name, description: ASK_FOLLOWUP.description, input_schema: jsonSchema(ASK_FOLLOWUP.input) },
  ];
}

export function checkInput(tool: { input: Field }, input: unknown): Record<string, unknown> {
  return check(tool.input, input) as Record<string, unknown>;
}
