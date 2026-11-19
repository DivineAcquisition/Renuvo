/**
 * A retention case: one piece of follow-through with an owner, a next step, a deadline, its evidence and
 * a clear completion condition. Everything a case does is written to its history, and every case keeps
 * one task in the shared task system, so it appears wherever the company's open work is shown.
 *
 * A case is closed only with an outcome. Sending a message, booking a visit or handing work to another
 * agent moves a case; none of them closes it.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { authorityFor } from "../authority";
import { recordEvent, type Actor } from "../events";
import { actionDef, type Level } from "../permissionCatalog";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { revokeCaseLinks } from "./links";
import type { Basis, CaseKind, CaseStatus, Outcome, PlanRef, Segment, Source } from "./schema";

type Ctx = QueryCtx | MutationCtx;

export const RETENTION: Actor = { kind: "agent", agent: "retention" };
export const SYSTEM: Actor = { kind: "system" };
export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

export const STATUS_WORDS: Record<CaseStatus, string> = {
  needs_context: "Needs context",
  needs_attention: "Needs attention",
  action_underway: "Action underway",
  waiting_on_customer: "Waiting on customer",
  monitoring: "Monitoring recovery",
  closed: "Closed",
};

/** What the record shows when no case is open. It is not a statement about how the customer feels. */
export const NO_KNOWN_ISSUES = "No known open issues";

export const KIND_WORDS: Record<CaseKind, string> = {
  follow_through: "New-customer follow-through",
  recovery: "Service recovery",
  continuity: "Recurring-service continuity",
  renewal: "Renewal",
  reactivation: "Re-engagement",
};

export const SEGMENT_WORDS: Record<Segment, string> = {
  residential_recurring: "Residential recurring",
  residential_one_time: "Residential one-time",
  commercial: "Commercial",
  office: "Office",
  str: "Short-term rental",
  multi_property: "Property management",
  project: "Project",
};

export const OUTCOME_WORDS: Record<Outcome, string> = {
  customer_confirmed: "Customer confirmed the correction.",
  correction_done_unconfirmed: "Correction completed. The customer has not confirmed it.",
  customer_not_satisfied: "Customer said the correction did not address the problem.",
  subsequent_service_completed: "Next service completed without a repeat report. The customer did not confirm.",
  feedback_no_issue: "Customer gave feedback and reported no issue.",
  no_response: "No response. Outcome unknown.",
  plan_adjusted: "Plan adjusted as the customer asked.",
  plan_resumed: "Service resumed.",
  customer_cancelled: "Customer chose to cancel.",
  contract_renewed: "Contract renewed.",
  contract_ended: "Contract ended.",
  reactivated: "Customer returned: a new service was completed.",
  declined_contact: "Customer asked not to be contacted.",
  handled_by_person: "Handled by a person.",
  no_action_needed: "Reviewed: nothing needed.",
  unknown: "Outcome unknown.",
};

/** Outcomes that say the relationship continued in practice. Everything else is reported under its own name. */
export const VERIFIED_OUTCOMES: readonly Outcome[] = ["customer_confirmed", "subsequent_service_completed", "feedback_no_issue", "plan_adjusted", "plan_resumed", "contract_renewed", "reactivated"];

/**
 * Safety, damage, theft and staff conduct always go to an authorized person (the permission catalog's
 * person-only list). The agent organises the evidence and tracks the follow-through; it proposes no
 * remedy and writes nothing to the customer.
 */
const SERIOUS = /\b(damag\w*|broke|broken|shatter\w*|stole|stolen|theft|missing (?:jewel\w*|cash|money|item\w*)|injur\w*|hurt|unsafe|hazard\w*|bleach(?:ed)? (?:stain|my)|harass\w*|inappropriat\w*|threat\w*|assault\w*|police|lawsuit|lawyer|attorney|insurance claim|chargeback)\b/i;

export function seriousReason(words: string | undefined): string | null {
  if (!words) return null;
  const match = SERIOUS.exec(words);
  return match ? `The customer's words include "${match[0].toLowerCase()}". Safety, damage, theft and staff-conduct concerns are handled by a person.` : null;
}

/** Lowercased task or area names from free text, so the same area at the same property can be recognised across visits. */
const AREA_WORDS = [
  "shower", "bathtub", "tub", "toilet", "bathroom", "sink", "mirror", "kitchen", "counter", "stove", "oven", "microwave", "fridge", "refrigerator", "dishwasher",
  "floor", "floors", "carpet", "vacuum", "mop", "dust", "dusting", "baseboard", "baseboards", "blinds", "window", "windows", "trash", "bedroom", "bed", "linen", "linens", "sheets",
  "towel", "towels", "laundry", "supplies", "restock", "restocking", "restroom", "restrooms", "breakroom", "lobby", "desk", "desks", "entry", "stairs", "patio", "balcony", "access", "lockbox", "key",
];
const AREA_ALIAS: Record<string, string> = { tub: "bathtub", floors: "floor", baseboards: "baseboard", windows: "window", linens: "linen", sheets: "linen", towels: "towel", restrooms: "restroom", refrigerator: "fridge", dusting: "dust", desks: "desk", restocking: "restock" };

export function areasIn(words: string | undefined): string[] {
  if (!words) return [];
  const lower = ` ${words.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const found = new Set<string>();
  for (const word of AREA_WORDS) if (lower.includes(` ${word} `)) found.add(AREA_ALIAS[word] ?? word);
  return [...found].sort();
}

export function cleanAreas(areas: string[]): string[] {
  return [...new Set(areas.map((a) => a.trim().toLowerCase().slice(0, 40)).filter(Boolean).map((a) => AREA_ALIAS[a] ?? a))].sort().slice(0, 12);
}

export const sharedAreas = (a: string[], b: string[]) => a.filter((area) => b.includes(area));

// ── Relationships at the right level ─────────────────────────────────────────────────────────────

export async function recurringPlansAt(ctx: Ctx, companyId: Id<"companies">, customerId: Id<"customers">, propertyId?: Id<"properties">) {
  const service = (
    await ctx.db
      .query("servicePlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
      .take(100)
  ).filter((plan) => !propertyId || plan.propertyId === propertyId);
  const sales = (
    await ctx.db
      .query("recurringPlans")
      .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
      .take(100)
  ).filter((plan) => !propertyId || plan.propertyId === propertyId);
  return { service, sales };
}

/**
 * How a relationship is served, read from the property and its plans. A home with a running or paused
 * recurring plan is recurring; a home without one is one-time, which is not a failed recurring customer.
 */
export async function segmentFor(ctx: Ctx, companyId: Id<"companies">, customer: Doc<"customers">, property: Doc<"properties"> | null): Promise<Segment> {
  const kind = property?.kind ?? customer.kind;
  if (kind === "short_term_rental") return "str";
  if (kind === "office") return "office";
  if (kind === "commercial") return "commercial";
  if (kind === "property_manager") return "multi_property";
  const plans = await recurringPlansAt(ctx, companyId, customer._id, property?._id);
  const recurring = plans.service.some((p) => p.kind === "recurring" && (p.state === "active" || p.state === "paused")) || plans.sales.some((p) => p.status === "active" || p.status === "paused");
  return recurring ? "residential_recurring" : "residential_one_time";
}

export function propertyName(property: Pick<Doc<"properties">, "label" | "address"> | null | undefined): string {
  if (!property) return "the property";
  return property.label?.trim() || property.address.line1;
}

// ── History ──────────────────────────────────────────────────────────────────────────────────────

export type EntryInput = {
  kind: Doc<"retentionEntries">["kind"];
  text: string;
  basis?: Basis;
  source?: Source;
  actor?: Actor;
  quote?: string;
  at?: number;
};

export async function addEntry(ctx: MutationCtx, row: Pick<Doc<"retentionCases">, "_id" | "companyId">, entry: EntryInput): Promise<void> {
  await ctx.db.insert("retentionEntries", {
    companyId: row.companyId,
    caseId: row._id,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    basis: entry.basis,
    text: entry.text.slice(0, 1200),
    source: entry.source,
    actor: entry.actor ?? RETENTION,
    quote: entry.quote?.slice(0, 2000),
  });
}

export async function entriesOf(ctx: Ctx, row: Pick<Doc<"retentionCases">, "_id" | "companyId">): Promise<Doc<"retentionEntries">[]> {
  return ctx.db
    .query("retentionEntries")
    .withIndex("by_company_case", (q) => q.eq("companyId", row.companyId).eq("caseId", row._id))
    .take(400);
}

// ── Opening and moving a case ────────────────────────────────────────────────────────────────────

const taskKey = (caseId: Id<"retentionCases">) => `retention.case:${caseId}`;

const COMPLETION: Record<CaseKind, string> = {
  follow_through: "The customer's feedback is recorded, or the request passed its last day with no answer, and any issue has its own recovery case.",
  recovery: "The remedy was carried out and the customer confirmed it, or the outcome is recorded as it actually is.",
  continuity: "The plan, its visits and its billing agree, and the customer's request is carried out or answered.",
  renewal: "A person decided the renewal, and the agreement shows it.",
  reactivation: "The customer answered, returned, or the question passed its last day with no answer.",
};

/** Keeps the case's one task in step with it: who acts next and by when. */
async function syncTask(ctx: MutationCtx, row: Doc<"retentionCases">, actor: Actor): Promise<void> {
  const existing = row.taskId ? await ctx.db.get(row.taskId) : await liveTaskByKey(ctx, row.companyId, taskKey(row._id));
  if (row.status === "closed") {
    if (existing && existing.status !== "done" && existing.status !== "cancelled") {
      await setTaskState(ctx, existing, "done", { outcome: row.outcome ? OUTCOME_WORDS[row.outcome.code] : "Closed.", closedAt: Date.now(), withPersonSince: null }, actor);
    }
    return;
  }
  let task = existing && existing.status !== "done" && existing.status !== "cancelled" ? existing : null;
  if (!task) {
    const taskId = await openTask(ctx, {
      companyId: row.companyId,
      agent: "retention",
      title: row.title,
      nextAction: row.doing.slice(0, 500),
      dueAt: Math.max(row.dueAt, Date.now() + 60_000),
      completionCondition: COMPLETION[row.kind],
      about: { table: "customers", id: row.customerId },
      key: taskKey(row._id),
      actor,
    });
    await ctx.db.patch(taskId, { trigger: row.happened.slice(0, 500), escalation: "If the deadline passes, the case is raised as an overdue commitment in Retention and stays open." });
    await ctx.db.patch(row._id, { taskId });
    task = (await ctx.db.get(taskId))!;
  }
  const dueAt = Math.max(row.dueAt, Date.now() + 60_000);
  const held = row.heldBy !== undefined || row.serious !== undefined;
  if (row.status === "needs_attention" || row.status === "needs_context") {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: (row.needs ?? row.doing).slice(0, 1000), dueAt, withPersonSince: task.withPersonSince ?? Date.now() }, actor, { sameStatus: true });
  } else if (row.status === "waiting_on_customer" || row.status === "monitoring") {
    await setTaskState(ctx, task, "waiting", { waitingOn: row.status === "waiting_on_customer" ? "customer" : "other", followUpAt: dueAt, dueAt, withPersonSince: held ? (task.withPersonSince ?? Date.now()) : null }, actor, { sameStatus: true });
  } else {
    await setTaskState(ctx, task, "open", { nextAction: row.doing.slice(0, 500), dueAt, withPersonSince: held ? (task.withPersonSince ?? Date.now()) : null }, actor, { sameStatus: true });
  }
}

export type NewCase = {
  companyId: Id<"companies">;
  kind: CaseKind;
  key: string;
  status: CaseStatus;
  customer: Doc<"customers">;
  property?: Doc<"properties"> | null;
  jobId?: Id<"jobs">;
  plan?: PlanRef;
  agreementId?: Id<"agreements">;
  title: string;
  happened: string;
  doing: string;
  needs?: string;
  origin: Doc<"retentionCases">["origin"];
  customerWords?: string;
  areas?: string[];
  dueAt: number;
  fromCaseId?: Id<"retentionCases">;
  actor: Actor;
};

export async function caseByKey(ctx: Ctx, companyId: Id<"companies">, key: string): Promise<Doc<"retentionCases"> | null> {
  return ctx.db
    .query("retentionCases")
    .withIndex("by_company_key", (q) => q.eq("companyId", companyId).eq("key", key))
    .first();
}

/** Opens a case once. Asked again with the same key, it answers with the first, open or closed. */
export async function openCase(ctx: MutationCtx, input: NewCase): Promise<{ row: Doc<"retentionCases">; created: boolean }> {
  const existing = await caseByKey(ctx, input.companyId, input.key);
  if (existing) return { row: existing, created: false };
  const now = Date.now();
  const serious = seriousReason(input.customerWords);
  const caseId = await ctx.db.insert("retentionCases", {
    companyId: input.companyId,
    kind: input.kind,
    key: input.key,
    status: serious ? "needs_attention" : input.status,
    customerId: input.customer._id,
    propertyId: input.property?._id,
    jobId: input.jobId,
    plan: input.plan,
    agreementId: input.agreementId,
    segment: await segmentFor(ctx, input.companyId, input.customer, input.property ?? null),
    title: input.title.slice(0, 200),
    happened: input.happened.slice(0, 600),
    doing: serious ? "Organising the evidence for the person handling this. Selestial proposes no remedy and writes nothing to the customer." : input.doing.slice(0, 600),
    needs: serious ? "A person authorized to handle safety, damage, theft or staff-conduct concerns must take this." : input.needs?.slice(0, 600),
    origin: input.origin,
    customerWords: input.customerWords?.slice(0, 2000),
    areas: cleanAreas(input.areas ?? areasIn(input.customerWords)),
    serious: serious ? { reason: serious, at: now } : undefined,
    dueAt: input.dueAt,
    fromCaseId: input.fromCaseId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  });
  const row = (await ctx.db.get(caseId))!;
  await recordEvent(ctx, { companyId: input.companyId, type: "retention_case.opened", actor: input.actor, subject: { table: "retentionCases", id: caseId }, data: { kind: input.kind, origin: input.origin, serious: serious !== null } });
  if (serious) await addEntry(ctx, row, { kind: "note", text: serious, actor: SYSTEM });
  await syncTask(ctx, row, input.actor);
  return { row: (await ctx.db.get(caseId))!, created: true };
}

export type CaseMove = Partial<Pick<Doc<"retentionCases">, "status" | "happened" | "doing" | "needs" | "dueAt" | "verification" | "diagnosis" | "areas" | "ownerId" | "heldBy" | "plan" | "title">> & { clearNeeds?: boolean; clearHeld?: boolean };

/** Changes a case and counts the change, so an action prepared against the older case is recognised as stale. */
export async function moveCase(ctx: MutationCtx, row: Doc<"retentionCases">, move: CaseMove, actor: Actor = RETENTION): Promise<Doc<"retentionCases">> {
  if (row.status === "closed") return row;
  const { clearNeeds, clearHeld, ...fields } = move;
  // A serious case stays with a person whatever a workflow proposes.
  if (row.serious && fields.status && fields.status !== "needs_attention") delete fields.status;
  const patch: Partial<Doc<"retentionCases">> = { ...fields, revision: row.revision + 1, updatedAt: Date.now() };
  if (clearNeeds) patch.needs = undefined;
  if (clearHeld) patch.heldBy = undefined;
  await ctx.db.patch(row._id, patch);
  const fresh = (await ctx.db.get(row._id))!;
  if (fields.status && fields.status !== row.status) {
    await recordEvent(ctx, { companyId: row.companyId, type: `retention_case.${fields.status}`, actor, subject: { table: "retentionCases", id: row._id }, data: { from: row.status } });
  }
  await syncTask(ctx, fresh, actor);
  return (await ctx.db.get(row._id))!;
}

/** Closes a case with what actually happened. Open customer links for it stop working. */
export async function closeCase(ctx: MutationCtx, row: Doc<"retentionCases">, code: Outcome, actor: Actor, note?: string): Promise<Doc<"retentionCases">> {
  if (row.status === "closed") return row;
  const now = Date.now();
  await ctx.db.patch(row._id, { status: "closed", outcome: { code, note: note?.slice(0, 600), by: actor, at: now }, closedAt: now, updatedAt: now, revision: row.revision + 1, needs: undefined, doing: "Closed." });
  const fresh = (await ctx.db.get(row._id))!;
  await addEntry(ctx, fresh, { kind: "outcome", text: `${OUTCOME_WORDS[code]}${note ? ` ${note}` : ""}`, actor });
  await recordEvent(ctx, { companyId: row.companyId, type: "retention_case.closed", actor, subject: { table: "retentionCases", id: row._id }, data: { outcome: code } });
  await revokeCaseLinks(ctx, row.companyId, row._id, "The case was closed.", actor);
  // A step that was prepared and never sent anywhere ends with the case, so it cannot be carried out later.
  const prepared = await ctx.db
    .query("retentionActions")
    .withIndex("by_company_case", (q) => q.eq("companyId", row.companyId).eq("caseId", row._id))
    .take(100);
  for (const action of prepared) if (action.status === "proposed") await ctx.db.patch(action._id, { status: "cancelled", result: "The case was closed first.", updatedAt: now, doneAt: now });
  // Signals the case carried are settled with it.
  const signals = await ctx.db
    .query("retentionSignals")
    .withIndex("by_company_customer", (q) => q.eq("companyId", row.companyId).eq("customerId", row.customerId))
    .take(200);
  for (const signal of signals) if (signal.caseId === row._id && signal.status === "in_case") await ctx.db.patch(signal._id, { status: "cleared", lastSeenAt: now });
  await syncTask(ctx, fresh, actor);
  return fresh;
}

export async function openCasesFor(ctx: Ctx, companyId: Id<"companies">, customerId: Id<"customers">): Promise<Doc<"retentionCases">[]> {
  const rows = await ctx.db
    .query("retentionCases")
    .withIndex("by_company_customer", (q) => q.eq("companyId", companyId).eq("customerId", customerId))
    .order("desc")
    .take(100);
  return rows.filter((row) => row.status !== "closed");
}

// ── Authority and spending ───────────────────────────────────────────────────────────────────────

export type Permit =
  | { mode: "act"; level: Level; label: string }
  | { mode: "ask"; label: string; why: string }
  | { mode: "refuse"; label: string; why: string };

/** The cost of what Retention has carried out under one money permission since the start of the company's day. */
async function spentToday(ctx: Ctx, companyId: Id<"companies">, permission: string, since: number): Promise<number> {
  const rows = await ctx.db
    .query("retentionActions")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "underway").gte("updatedAt", since))
    .take(200);
  const done = await ctx.db
    .query("retentionActions")
    .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "done").gte("updatedAt", since))
    .take(200);
  return [...rows, ...done].filter((row) => row.permission === permission && row.authorization?.includes("without asking")).reduce((sum, row) => sum + (row.estimatedCostCents ?? row.money?.amountCents ?? 0), 0);
}

/**
 * What Retention may do with one action right now. An action at "Ask me first" goes to the approvals
 * queue. A money action acts without asking only inside both of the Owner's limits, and only when its
 * cost is known: an unknown cost is never treated as zero.
 */
export async function permitFor(ctx: Ctx, companyId: Id<"companies">, permission: string, cost?: { cents: number | null }): Promise<Permit> {
  const def = actionDef(permission);
  const authority = await authorityFor(ctx, companyId, permission);
  if (authority.kind === "paused") return { mode: "refuse", label: `${permission}: Retention is paused`, why: "Retention is paused, so it does nothing. A person can still act." };
  if (authority.kind !== "level") return { mode: "refuse", label: `${permission}: not allowed`, why: "This is something only a person does." };
  if (authority.level === "off") return { mode: "refuse", label: `${permission}: off`, why: `"${def?.label ?? permission}" is switched off for Retention.` };
  if (authority.level === "propose") return { mode: "ask", label: `${permission} at propose`, why: "This is set to Ask me first." };
  if (def?.money) {
    if (!cost || cost.cents === null) return { mode: "ask", label: `${permission}: cost unknown`, why: "There is no reliable cost for this, so a person decides." };
    if (authority.perActionCents === undefined || authority.perDayCents === undefined) return { mode: "ask", label: `${permission}: no limit set`, why: "No spending limit is set for this, so a person decides." };
    if (cost.cents > authority.perActionCents) return { mode: "ask", label: `${permission}: over the per-action limit`, why: "This is over the limit set for one action." };
    const now = Date.now();
    const spent = await spentToday(ctx, companyId, permission, now - DAY);
    if (spent + cost.cents > authority.perDayCents) return { mode: "ask", label: `${permission}: over the daily limit`, why: "This would go over the limit set for one day." };
  }
  return { mode: "act", level: authority.level, label: `${permission} at ${authority.level}, without asking` };
}
