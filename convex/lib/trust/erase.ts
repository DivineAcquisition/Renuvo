/**
 * Erasing one customer's or one cleaner's personal details from a company's records, at the Owner's
 * request. Personal fields are cleared or overwritten; rows other records point at stay, so a visit,
 * a pay line or an event still makes sense, now naming "Erased customer" or "Erased cleaner".
 *
 * Every step is written to a deletion record with what it did, and what was kept and why.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { assignmentLinks, revokeLink } from "../dispatch/links";
import type { Actor } from "../events";
import { setStage, SYSTEM, view } from "../sales/agentOpportunity";

export const ERASED_CUSTOMER = "Erased customer";
export const ERASED_CLEANER = "Erased cleaner";

export type EraseStep = { step: string; state: "done" | "kept" | "failed"; detail: string };

type Ctx = MutationCtx & { companyId: Id<"companies"> };

const MAX_ROWS = 5000;

/** Reasons shared by both kinds of erasure. */
export const SHARED_KEPT: EraseStep[] = [
  {
    step: "Event log",
    state: "kept",
    detail: "The event log keeps ids and the kind of each thing that happened, with no personal text. It now shows the erased name.",
  },
  {
    step: "Opt-out records",
    state: "kept",
    detail: "Any record that the person asked not to be messaged (a STOP) is kept, so they are never messaged again by mistake.",
  },
  {
    step: "Backups",
    state: "kept",
    detail: "Backups are managed by Convex and are not rewritten. The erased details leave them as the backups expire on the provider's schedule.",
  },
];

function replaceName(value: string | undefined, name: string, replacement: string): string | undefined {
  if (value === undefined || !value.includes(name)) return value;
  return value.split(name).join(replacement);
}

/**
 * Replaces a full name wherever the company's tasks, approvals and coverage notes wrote it. Short
 * names are left alone: replacing two letters would damage other words.
 */
export async function scrubName(ctx: Ctx, name: string, replacement: string): Promise<number> {
  const full = name.trim();
  if (full.length < 3 || full === replacement) return 0;
  let changed = 0;
  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_company_status_due", (q) => q.eq("companyId", ctx.companyId))
    .take(MAX_ROWS);
  for (const row of tasks) {
    const patch = {
      title: replaceName(row.title, full, replacement)!,
      nextAction: replaceName(row.nextAction, full, replacement),
      openQuestion: replaceName(row.openQuestion, full, replacement),
      outcome: replaceName(row.outcome, full, replacement),
      trigger: replaceName(row.trigger, full, replacement),
      escalation: replaceName(row.escalation, full, replacement),
    };
    if (Object.entries(patch).some(([field, value]) => value !== row[field as keyof typeof patch])) {
      await ctx.db.patch(row._id, patch);
      changed += 1;
    }
  }
  const approvals = await ctx.db
    .query("approvals")
    .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", ctx.companyId))
    .take(MAX_ROWS);
  for (const row of approvals) {
    const patch = {
      summary: replaceName(row.summary, full, replacement)!,
      reason: replaceName(row.reason, full, replacement)!,
      authorizes: replaceName(row.authorizes, full, replacement),
      ifWaiting: replaceName(row.ifWaiting, full, replacement),
      note: replaceName(row.note, full, replacement),
    };
    const detail = row.carriedOut ? replaceName(row.carriedOut.detail, full, replacement)! : undefined;
    const carriedChanged = row.carriedOut !== undefined && detail !== row.carriedOut.detail;
    if (carriedChanged || Object.entries(patch).some(([field, value]) => value !== row[field as keyof typeof patch])) {
      await ctx.db.patch(row._id, { ...patch, ...(carriedChanged && row.carriedOut ? { carriedOut: { ...row.carriedOut, detail: detail! } } : {}) });
      changed += 1;
    }
  }
  const coverage = await ctx.db
    .query("coverageRequests")
    .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId))
    .take(MAX_ROWS);
  for (const row of coverage) {
    const patch = { detail: replaceName(row.detail, full, replacement), summary: replaceName(row.summary, full, replacement) };
    if (patch.detail !== row.detail || patch.summary !== row.summary) {
      await ctx.db.patch(row._id, patch);
      changed += 1;
    }
  }
  return changed;
}

/**
 * Ready exports still hold the details that were just erased. Their files are deleted and the exports
 * marked expired; the Owner can ask for a new one.
 */
export async function withdrawExports(ctx: Ctx): Promise<number> {
  const rows = await ctx.db
    .query("dataExports")
    .withIndex("by_company_created", (q) => q.eq("companyId", ctx.companyId))
    .take(200);
  let count = 0;
  for (const row of rows) {
    if (row.status !== "ready" && row.status !== "preparing") continue;
    if (row.storageId) await ctx.storage.delete(row.storageId);
    await ctx.db.patch(row._id, { status: "expired", storageId: undefined, problem: "Withdrawn because details in it were erased." });
    count += 1;
  }
  return count;
}

// ── Customers ─────────────────────────────────────────────────────────────────────────────────────

/** Visits that are still to happen or happening. A customer with any of these is not erased. */
export async function openVisitsOf(ctx: Ctx, customer: Doc<"customers">): Promise<Doc<"jobs">[]> {
  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  return jobs.filter((job) => job.status === "scheduled" || job.status === "in_progress");
}

export async function eraseCustomerRecords(ctx: Ctx, customer: Doc<"customers">): Promise<EraseStep[]> {
  const steps: EraseStep[] = [];
  const name = customer.name;

  await ctx.db.patch(customer._id, { name: ERASED_CUSTOMER, email: undefined, phone: undefined, preferences: undefined, privateNotes: undefined, communication: undefined, relationshipNote: undefined, archivedReason: undefined, status: "archived" });
  steps.push({ step: "Customer details", state: "done", detail: "Name replaced with \"Erased customer\"; email, phone, preferences and notes removed; the customer is archived." });

  const contacts = await ctx.db
    .query("clientContacts")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const contact of contacts) await ctx.db.patch(contact._id, { name: ERASED_CUSTOMER, title: undefined, email: undefined, phone: undefined, status: "archived" });
  const notes = await ctx.db
    .query("clientNotes")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const note of notes) await ctx.db.delete(note._id);
  const inbound = await ctx.db
    .query("inboundMessages")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const message of inbound) await ctx.db.patch(message._id, { from: "erased", body: "(erased)" });
  steps.push({ step: "Contacts, notes and texts", state: "done", detail: `${contacts.length} contact${contacts.length === 1 ? "" : "s"} scrubbed, ${notes.length} internal note${notes.length === 1 ? "" : "s"} deleted, ${inbound.length} received text${inbound.length === 1 ? "" : "s"} blanked.` });

  // Retention: what the customer wrote is blanked, their links are closed, and the cases keep only that they existed.
  const cases = await ctx.db
    .query("retentionCases")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const row of cases) {
    await ctx.db.patch(row._id, { title: "Erased case", happened: "(erased)", customerWords: undefined, ...(row.status === "closed" ? {} : { status: "closed" as const, closedAt: Date.now(), needs: undefined, doing: "Closed.", outcome: { code: "unknown" as const, note: "The customer's data was erased.", by: { kind: "system" as const }, at: Date.now() } }) });
    const entries = await ctx.db.query("retentionEntries").withIndex("by_company_case", (q) => q.eq("companyId", ctx.companyId).eq("caseId", row._id)).take(MAX_ROWS);
    for (const entry of entries) await ctx.db.patch(entry._id, { text: "(erased)", quote: undefined });
    const actions = await ctx.db.query("retentionActions").withIndex("by_company_case", (q) => q.eq("companyId", ctx.companyId).eq("caseId", row._id)).take(MAX_ROWS);
    for (const action of actions) await ctx.db.patch(action._id, { summary: "(erased)", reason: "(erased)", message: undefined, ...(action.status === "proposed" || action.status === "awaiting_approval" || action.status === "underway" ? { status: "cancelled" as const } : {}) });
  }
  const feedback = await ctx.db
    .query("retentionFeedback")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const row of feedback) await ctx.db.patch(row._id, { comment: undefined, ...(row.issue ? { issue: { ...row.issue, description: "(erased)" } } : {}) });
  const careLinks = await ctx.db
    .query("retentionLinks")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const link of careLinks) if (link.revokedAt === undefined) await ctx.db.patch(link._id, { revokedAt: Date.now(), revokeReason: "The customer's data was erased." });
  const signals = await ctx.db
    .query("retentionSignals")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const signal of signals) await ctx.db.patch(signal._id, { what: "(erased)", status: signal.status === "open" || signal.status === "in_case" ? "cleared" : signal.status });
  steps.push({ step: "Retention cases and feedback", state: "done", detail: `${cases.length} case${cases.length === 1 ? "" : "s"} and ${feedback.length} feedback record${feedback.length === 1 ? "" : "s"} blanked; ${careLinks.length} customer link${careLinks.length === 1 ? "" : "s"} closed.` });

  const properties = await ctx.db
    .query("properties")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  for (const property of properties) {
    await ctx.db.patch(property._id, { label: undefined, address: { line1: "Erased address", city: "", region: "", postalCode: "" }, accessInstructions: undefined, parking: undefined, crewNotes: undefined, clientNotes: undefined, officeNotes: undefined, details: undefined, status: "archived" });
  }
  steps.push({ step: "Properties", state: "done", detail: `${properties.length} address${properties.length === 1 ? "" : "es"} and access instructions removed.` });

  const jobs = await ctx.db
    .query("jobs")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  let cleared = 0;
  for (const job of jobs) {
    const cancelReason = replaceName(job.cancelReason, name, ERASED_CUSTOMER);
    if (job.instructions !== undefined || cancelReason !== job.cancelReason) {
      await ctx.db.patch(job._id, { instructions: undefined, cancelReason });
      cleared += 1;
    }
  }
  steps.push({ step: "Visit instructions", state: "done", detail: `Instructions removed from ${cleared} visit${cleared === 1 ? "" : "s"}.` });

  const scrubbed = await scrubName(ctx, name, ERASED_CUSTOMER);
  steps.push({ step: "Name in tasks and approvals", state: "done", detail: `The name was replaced in ${scrubbed} task${scrubbed === 1 ? "" : "s"}, approval${scrubbed === 1 ? "" : "s"} or coverage note${scrubbed === 1 ? "" : "s"}.` });

  // What Sales holds: the conversation's words, what the customer told it, and anything still waiting to go.
  const opportunities = await ctx.db
    .query("salesOpportunities")
    .withIndex("by_company_customer", (q) => q.eq("companyId", ctx.companyId).eq("customerId", customer._id))
    .take(MAX_ROWS);
  let words = 0;
  let stopped = 0;
  for (const opportunity of opportunities) {
    const thread = await ctx.db
      .query("salesMessages")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", opportunity._id))
      .take(MAX_ROWS);
    for (const row of thread) {
      await ctx.db.patch(row._id, { body: "Erased.", subject: undefined });
      words += 1;
    }
    const actions = await ctx.db
      .query("salesActions")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", opportunity._id))
      .take(MAX_ROWS);
    for (const action of actions) await ctx.db.patch(action._id, { body: undefined, subject: undefined, evidence: [], summary: "Erased.", reason: "Erased.", ...(action.status === "prepared" || action.status === "awaiting_approval" ? { status: "discarded" as const, result: "The customer's details were erased." } : {}) });
    const reminders = await ctx.db
      .query("salesFollowUps")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", opportunity._id))
      .take(MAX_ROWS);
    for (const reminder of reminders) {
      if (reminder.status === "scheduled") stopped += 1;
      await ctx.db.patch(reminder._id, { preview: "Erased.", ...(reminder.status === "scheduled" ? { status: "cancelled" as const, stopReason: "The customer's details were erased." } : {}) });
    }
    const outbox = await ctx.db
      .query("messages")
      .withIndex("by_company_opportunity", (q) => q.eq("companyId", ctx.companyId).eq("opportunityId", opportunity._id))
      .take(MAX_ROWS);
    for (const message of outbox) await ctx.db.patch(message._id, { body: "Erased.", to: undefined, subject: undefined, ...(message.status === "queued" || message.status === "held" ? { status: "not_sent" as const, problem: "The customer's details were erased before it went." } : {}) });
    // What the customer told Sales goes; the reply address stops naming this conversation.
    await ctx.db.patch(opportunity._id, { inquiry: opportunity.inquiry === undefined ? undefined : "Erased.", facts: opportunity.facts === undefined ? undefined : [], asked: opportunity.asked === undefined ? undefined : [], timing: undefined, replyKey: undefined });
    const open = view((await ctx.db.get(opportunity._id))!);
    if (open && open.agent.stage !== "won" && open.agent.stage !== "closed_lost") {
      await ctx.db.patch(opportunity._id, { followUps: "stopped", nextAction: undefined, nextActionAt: undefined, nextBy: undefined });
      await setStage(ctx, view((await ctx.db.get(opportunity._id))!)!, "closed_lost", SYSTEM, { reason: "other", note: "The customer's details were erased." });
    }
  }
  steps.push({ step: "Sales conversations", state: "done", detail: `${opportunities.length} inquir${opportunities.length === 1 ? "y" : "ies"} closed or cleared; the words of ${words} message${words === 1 ? "" : "s"} and what the customer told Sales removed; ${stopped} planned reminder${stopped === 1 ? "" : "s"} cancelled. Quotes keep their amounts, for the company's records.` });

  steps.push({ step: "Queued messages", state: "done", detail: "Any message still waiting to go to this customer was stopped." });
  steps.push({ step: "Action links", state: "done", detail: "Customers have no action links." });

  const withdrawn = await withdrawExports(ctx);
  steps.push({ step: "Earlier exports", state: "done", detail: `${withdrawn} earlier export${withdrawn === 1 ? "" : "s"} of the company's records deleted.` });

  steps.push({ step: "Visits", state: "kept", detail: "Past and cancelled visits stay, with their times and prices, for the company's records and cleaners' pay. They now point at the erased customer." });
  steps.push(...SHARED_KEPT);
  return steps;
}

// ── Cleaners ──────────────────────────────────────────────────────────────────────────────────────

async function cleanerAssignments(ctx: Ctx, cleaner: Doc<"cleaners">): Promise<Doc<"assignments">[]> {
  return ctx.db
    .query("assignments")
    .withIndex("by_company_cleaner_status", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
    .take(MAX_ROWS);
}

/** An open offer, or an accepted place on a visit that is still to happen or happening. */
export async function openWorkOf(ctx: Ctx, cleaner: Doc<"cleaners">): Promise<Doc<"assignments">[]> {
  const out: Doc<"assignments">[] = [];
  for (const assignment of await cleanerAssignments(ctx, cleaner)) {
    if (assignment.status !== "offered" && assignment.status !== "accepted") continue;
    const job = await ctx.db.get(assignment.jobId);
    if (job && (job.status === "scheduled" || job.status === "in_progress")) out.push(assignment);
  }
  return out;
}

export async function eraseCleanerRecords(ctx: Ctx, cleaner: Doc<"cleaners">, actor: Actor): Promise<EraseStep[]> {
  const steps: EraseStep[] = [];
  const name = cleaner.name;

  await ctx.db.patch(cleaner._id, { name: ERASED_CLEANER, email: undefined, phone: undefined, skills: [], serviceAreas: [], pay: undefined, status: "ended" });
  steps.push({ step: "Cleaner details", state: "done", detail: "Name replaced with \"Erased cleaner\"; email, phone, skills, service areas and pay rate removed; the cleaner is ended." });

  const windows = await ctx.db
    .query("availabilityWindows")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
    .take(MAX_ROWS);
  for (const row of windows) await ctx.db.delete(row._id);
  const timeOff = await ctx.db
    .query("timeOff")
    .withIndex("by_company_cleaner_end", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
    .take(MAX_ROWS);
  for (const row of timeOff) await ctx.db.delete(row._id);
  steps.push({ step: "Availability and time off", state: "done", detail: `${windows.length} availability window${windows.length === 1 ? "" : "s"} and ${timeOff.length} time-off entr${timeOff.length === 1 ? "y" : "ies"} deleted.` });

  const assignments = await cleanerAssignments(ctx, cleaner);
  const jobIds = [...new Set(assignments.map((row) => row.jobId))];
  let photos = 0;
  let photoFailures = 0;
  for (const jobId of jobIds) {
    const evidence = await ctx.db
      .query("evidence")
      .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", jobId))
      .take(MAX_ROWS);
    for (const row of evidence) {
      if (row.cleanerId !== cleaner._id) continue;
      try {
        await ctx.storage.delete(row.storageId);
      } catch {
        // The file is already gone. The row still goes, so nothing points at it.
        photoFailures += 1;
      }
      await ctx.db.delete(row._id);
      photos += 1;
    }
  }
  steps.push({ step: "Photos", state: "done", detail: `${photos} photo${photos === 1 ? "" : "s"} the cleaner uploaded deleted from file storage${photoFailures ? ` (${photoFailures} were already gone)` : ""}.` });

  const messages = await ctx.db
    .query("messages")
    .withIndex("by_company_queued", (q) => q.eq("companyId", ctx.companyId))
    .take(MAX_ROWS * 4);
  let cancelled = 0;
  let numbers = 0;
  for (const message of messages) {
    if (message.cleanerId !== cleaner._id) continue;
    if (message.status === "queued") {
      await ctx.db.patch(message._id, { status: "not_sent", problem: "Withdrawn: the cleaner's details were erased.", to: undefined });
      cancelled += 1;
    } else if (message.to !== undefined) {
      await ctx.db.patch(message._id, { to: undefined });
    }
    numbers += 1;
  }
  steps.push({ step: "Queued messages", state: "done", detail: `${cancelled} waiting message${cancelled === 1 ? "" : "s"} withdrawn.` });
  steps.push({ step: "Phone number on past messages", state: "done", detail: `Removed from ${numbers} message${numbers === 1 ? "" : "s"}. What each message said is kept; it holds no link and no phone number.` });

  let revoked = 0;
  for (const assignment of assignments) {
    for (const link of await assignmentLinks(ctx, assignment)) {
      if (link.revokedAt !== undefined) continue;
      await revokeLink(ctx, link, "The cleaner's details were erased.", actor);
      revoked += 1;
    }
  }
  steps.push({ step: "Action links", state: "done", detail: `${revoked} link${revoked === 1 ? "" : "s"} still open were closed.` });

  let located = 0;
  for (const assignment of assignments) {
    const checkIn = assignment.checkIn ? { at: assignment.checkIn.at } : undefined;
    const late = assignment.late ? { reportedAt: assignment.late.reportedAt, etaAt: assignment.late.etaAt } : undefined;
    const completion = assignment.completion ? { submittedAt: assignment.completion.submittedAt, incomplete: assignment.completion.incomplete } : undefined;
    const endReason = replaceName(assignment.endReason, name, ERASED_CLEANER);
    const touched =
      (assignment.checkIn && (assignment.checkIn.lat !== undefined || assignment.checkIn.lng !== undefined || assignment.checkIn.accuracyM !== undefined)) ||
      assignment.late?.reason !== undefined ||
      assignment.completion?.note !== undefined ||
      endReason !== assignment.endReason;
    if (!touched) continue;
    await ctx.db.patch(assignment._id, { checkIn, late, completion, endReason });
    located += 1;
  }
  steps.push({ step: "Check-in locations and notes", state: "done", detail: `Location, delay reasons and completion notes cleared on ${located} assignment${located === 1 ? "" : "s"}; the times are kept.` });

  const scrubbed = await scrubName(ctx, name, ERASED_CLEANER);
  steps.push({ step: "Name in tasks and approvals", state: "done", detail: `The name was replaced in ${scrubbed} task${scrubbed === 1 ? "" : "s"}, approval${scrubbed === 1 ? "" : "s"} or coverage note${scrubbed === 1 ? "" : "s"}.` });

  const withdrawn = await withdrawExports(ctx);
  steps.push({ step: "Earlier exports", state: "done", detail: `${withdrawn} earlier export${withdrawn === 1 ? "" : "s"} of the company's records deleted.` });

  steps.push({ step: "Assignments and pay", state: "kept", detail: "Assignments stay, with the pay each one carried, for the company's pay records. They now point at the erased cleaner." });
  steps.push({ step: "Job reports", state: "kept", detail: "Reports from jobs describe the property and the work, and stay with the visit." });
  steps.push(...SHARED_KEPT);
  return steps;
}
