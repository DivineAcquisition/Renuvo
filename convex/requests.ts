/**
 * Requests from the public site: privacy requests, vulnerability reports and security review requests.
 * Then the staff queue that works them.
 *
 * Only the Selestial web server calls `submit` (it holds PUBLIC_FORM_SECRET). The request is saved
 * first; the email to Selestial's own inbox is a separate, scheduled step that is tried again on
 * failure, so a provider that is down never loses a request or fails the form.
 *
 * A request is words, nothing more. Submitting one never exports, erases or shows anyone's data: that
 * is done by a company's Owner (convex/dataRights.ts) or by staff after they have recorded how they
 * verified the person.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { serverMutation, staffMutation, staffQuery, type StaffAccess } from "./lib/builders";
import { emailProvider } from "./lib/email/provider";
import { trustRequestEmail } from "./lib/email/trustRequest";
import { notFound, userError } from "./lib/errors";
import { allow } from "./lib/rateLimit";
import { isEmail, text } from "./lib/text";
import { dateOnly } from "./lib/trust/checks";
import { inboxFor, randomReference, saveRequest } from "./lib/trust/requests";
import {
  PRIVACY_SUBTYPES,
  RELATIONSHIPS,
  requestKindValidator,
  requestStatusValidator,
  routingValidator,
  type PrivacySubtype,
  type Relationship,
  type RequestKind,
} from "./lib/trust/schema";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** One visitor (the web server passes a hash of their address, never the address). */
export const PER_VISITOR_PER_HOUR = 5;
/** One email address, across every kind. Counted under a hash of the address. */
export const PER_EMAIL_PER_DAY = 5;
/** Everyone together, so a flood from many addresses still stops. */
export const TOTAL_PER_HOUR = 300;
/** How many times the email to Selestial's inbox is tried before it is marked failed. */
export const MAX_NOTIFY_ATTEMPTS = 5;

export const LIMITS = { details: 4000, affected: 500, questions: 4000, name: 120, businessName: 160, company: 160, role: 120, severityGuess: 40 } as const;

export type SubmitResult = { status: "saved"; reference: string } | { status: "invalid"; field: string; message: string } | { status: "limited" };

/** The address is counted under a hash, so the rate limit table never holds it. */
async function emailKey(address: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`selestial.requests.v1:${address}`)));
  return Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ── The public form ───────────────────────────────────────────────────────────────────────────────

type Invalid = { status: "invalid"; field: string; message: string };
const invalid = (field: string, message: string): Invalid => ({ status: "invalid", field, message });

/** Trimmed text, or an answer saying which field is wrong. Empty and absent are the same. */
function field(value: string | undefined, name: string, label: string, max: number, required: boolean): string | undefined | Invalid {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return required ? invalid(name, `${label} is required.`) : undefined;
  if (trimmed.length > max) return invalid(name, `${label} must be ${max} characters or fewer.`);
  return trimmed;
}
const isInvalid = (value: unknown): value is Invalid => typeof value === "object" && value !== null && (value as Invalid).status === "invalid";

export const submit = serverMutation({
  args: {
    kind: requestKindValidator,
    /** Privacy requests: what the person is asking for. */
    subtype: v.optional(v.string()),
    name: v.optional(v.string()),
    email: v.string(),
    relationship: v.optional(v.string()),
    /** The cleaning company the person deals with. Not asked of vulnerability reports. */
    businessName: v.optional(v.string()),
    details: v.optional(v.string()),
    affected: v.optional(v.string()),
    severityGuess: v.optional(v.string()),
    company: v.optional(v.string()),
    role: v.optional(v.string()),
    questions: v.optional(v.string()),
    /** A field people never see. Anything in it means a bot filled the form. */
    website: v.optional(v.string()),
    visitorKey: v.string(),
  },
  handler: async (ctx, args): Promise<SubmitResult> => {
    // A bot is told it worked, so it does not try again differently. Nothing is saved or sent.
    if (args.website?.trim()) return { status: "saved", reference: randomReference() };

    const address = args.email.trim().toLowerCase();
    if (!isEmail(address)) return invalid("email", "Enter a valid email address.");
    const name = field(args.name, "name", "Your name", LIMITS.name, false);
    if (isInvalid(name)) return name;

    let relationship: Relationship = "other";
    if (args.relationship?.trim()) {
      const given = args.relationship.trim();
      if (!(RELATIONSHIPS as readonly string[]).includes(given)) return invalid("relationship", "Choose how you are connected to Selestial.");
      relationship = given as Relationship;
    } else if (args.kind === "privacy") return invalid("relationship", "Choose how you are connected to Selestial.");

    const fields: Omit<Doc<"trustRequests">, "_id" | "_creationTime" | "reference" | "receivedAt" | "status" | "notes" | "actions" | "notify" | "verification" | "routing"> = {
      kind: args.kind,
      requester: { ...(name ? { name } : {}), email: address, relationship },
      details: "",
    };

    if (args.kind === "privacy") {
      const subtype = args.subtype?.trim() ?? "";
      if (!(PRIVACY_SUBTYPES as readonly string[]).includes(subtype)) return invalid("subtype", "Choose what you are asking for.");
      fields.subtype = subtype as PrivacySubtype;
      // The company the person deals with is how the request reaches the right records.
      const business = field(args.businessName, "businessName", "The cleaning company's name", LIMITS.businessName, relationship !== "other");
      if (isInvalid(business)) return business;
      if (business) fields.businessName = business;
      const details = field(args.details, "details", "Details", LIMITS.details, true);
      if (isInvalid(details)) return details;
      fields.details = details!;
    } else if (args.kind === "vulnerability") {
      // No business name and no consent box: a report is welcome from anyone.
      const affected = field(args.affected, "affected", "What is affected", LIMITS.affected, true);
      if (isInvalid(affected)) return affected;
      const details = field(args.details, "details", "Details", LIMITS.details, true);
      if (isInvalid(details)) return details;
      const severity = field(args.severityGuess, "severityGuess", "The severity", LIMITS.severityGuess, false);
      if (isInvalid(severity)) return severity;
      fields.affected = affected;
      fields.details = details!;
      if (severity) fields.severityGuess = severity;
      const business = field(args.businessName, "businessName", "The cleaning company's name", LIMITS.businessName, false);
      if (isInvalid(business)) return business;
      if (business) fields.businessName = business;
    } else {
      const company = field(args.company, "company", "Your company", LIMITS.company, true);
      if (isInvalid(company)) return company;
      const role = field(args.role, "role", "Your role", LIMITS.role, true);
      if (isInvalid(role)) return role;
      const questions = field(args.questions, "questions", "Your questions", LIMITS.questions, true);
      if (isInvalid(questions)) return questions;
      const details = field(args.details, "details", "Details", LIMITS.details, false);
      if (isInvalid(details)) return details;
      fields.company = company;
      fields.role = role;
      fields.questions = questions;
      fields.details = details ?? "";
    }

    // Answered, not thrown, so the counts are kept.
    const visitorKey = args.visitorKey.trim().slice(0, 128) || "unknown";
    if (!(await allow(ctx, `requests:visitor:${visitorKey}`, PER_VISITOR_PER_HOUR, HOUR))) return { status: "limited" };
    if (!(await allow(ctx, `requests:email:${await emailKey(address)}`, PER_EMAIL_PER_DAY, DAY))) return { status: "limited" };
    if (!(await allow(ctx, "requests:all", TOTAL_PER_HOUR, HOUR))) return { status: "limited" };

    const { reference } = await saveRequest(ctx, fields, { by: "requester", action: "received", detail: "Sent through the Selestial website." });
    return { status: "saved", reference };
  },
});

// ── Telling Selestial's inbox ─────────────────────────────────────────────────────────────────────

type ToNotify = { ready: false } | { ready: true; to: string; kind: RequestKind; subtype?: string; reference: string; receivedAt: number };

export const forNotify = internalQuery({
  args: { requestId: v.id("trustRequests") },
  handler: async (ctx, args): Promise<ToNotify> => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.notify.state !== "pending") return { ready: false };
    const to = await inboxFor(ctx, request.kind);
    if (!to) return { ready: false };
    return { ready: true, to, kind: request.kind, subtype: request.subtype, reference: request.reference, receivedAt: request.receivedAt };
  },
});

const notifyOutcomeValidator = v.union(
  v.object({ kind: v.literal("sent") }),
  v.object({ kind: v.literal("failed"), retryable: v.boolean(), problem: v.string() }),
  v.object({ kind: v.literal("not_configured"), problem: v.string() }),
);
type NotifyOutcome = typeof notifyOutcomeValidator.type;

/** Waits 1, 2, 4 and 8 minutes between tries. */
export function notifyBackoff(attempt: number): number {
  return MINUTE * 2 ** (attempt - 1);
}

/** Writes down what became of one try. Only a request still waiting on its email is changed. */
export const settleNotify = internalMutation({
  args: { requestId: v.id("trustRequests"), attempt: v.number(), outcome: notifyOutcomeValidator },
  handler: async (ctx, args): Promise<null> => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.notify.state !== "pending") return null;
    const now = Date.now();
    const outcome = args.outcome;
    if (outcome.kind === "sent") {
      await ctx.db.patch(request._id, { notify: { state: "sent", attempts: args.attempt, lastAt: now } });
      return null;
    }
    if (outcome.kind === "not_configured") {
      await ctx.db.patch(request._id, { notify: { state: "not_configured", attempts: args.attempt, lastAt: now, problem: outcome.problem } });
      return null;
    }
    if (outcome.retryable && args.attempt < MAX_NOTIFY_ATTEMPTS) {
      await ctx.db.patch(request._id, { notify: { state: "pending", attempts: args.attempt, lastAt: now, problem: outcome.problem } });
      await ctx.scheduler.runAfter(notifyBackoff(args.attempt), internal.requests.notify, { requestId: request._id, attempt: args.attempt + 1 });
      return null;
    }
    await ctx.db.patch(request._id, { notify: { state: "failed", attempts: args.attempt, lastAt: now, problem: outcome.problem } });
    return null;
  },
});

export const notify = internalAction({
  args: { requestId: v.id("trustRequests"), attempt: v.optional(v.number()) },
  handler: async (ctx, args): Promise<null> => {
    const attempt = args.attempt ?? 1;
    const record = async (outcome: NotifyOutcome) => {
      await ctx.runMutation(internal.requests.settleNotify, { requestId: args.requestId, attempt, outcome });
      return null;
    };
    const found: ToNotify = await ctx.runQuery(internal.requests.forNotify, { requestId: args.requestId });
    if (!found.ready) return record({ kind: "not_configured", problem: "No verified inbox is set for this kind of request." });
    const provider = emailProvider();
    if (!provider) return record({ kind: "not_configured", problem: "Email sending isn't set up yet, so the email wasn't sent." });
    const message = trustRequestEmail({ kind: found.kind, subtype: found.subtype, reference: found.reference, receivedAt: found.receivedAt });
    try {
      // One key for every try, so the provider drops a repeat instead of sending the email twice.
      const result = await provider.send({ to: found.to, ...message, idempotencyKey: `trust-request-${args.requestId}` });
      return record(result.ok ? { kind: "sent" } : { kind: "failed", retryable: result.retryable, problem: result.problem });
    } catch {
      // Nothing about the error is kept. The same key goes with the next try, so trying again is safe.
      return record({ kind: "failed", retryable: true, problem: "The email service did not answer." });
    }
  },
});

// ── The staff queue ───────────────────────────────────────────────────────────────────────────────

const by = (ctx: StaffAccess) => ctx.staff._id as string;

async function requestOrNotFound(ctx: { db: MutationCtx["db"] }, requestId: Id<"trustRequests">): Promise<Doc<"trustRequests">> {
  const request = await ctx.db.get(requestId);
  if (!request) notFound();
  return request;
}

async function act(ctx: MutationCtx & StaffAccess, request: Doc<"trustRequests">, action: string, detail: string, patch: Partial<Doc<"trustRequests">> = {}) {
  await ctx.db.patch(request._id, { ...patch, actions: [...request.actions, { at: Date.now(), by: by(ctx), action, detail }] });
}

const CLOSED: readonly Doc<"trustRequests">["status"][] = ["completed", "closed_with_limitation", "spam"];

/** Requests, newest first, filtered by kind and status. Staff only. */
export const queue = staffQuery({
  args: { kind: v.optional(requestKindValidator), status: v.optional(requestStatusValidator) },
  handler: async (ctx, args) => {
    const { kind, status } = args;
    let rows: Doc<"trustRequests">[];
    if (kind && status)
      rows = await ctx.db
        .query("trustRequests")
        .withIndex("by_kind_status_received", (q) => q.eq("kind", kind).eq("status", status))
        .order("desc")
        .take(200);
    else if (kind)
      rows = await ctx.db
        .query("trustRequests")
        .withIndex("by_kind_received", (q) => q.eq("kind", kind))
        .order("desc")
        .take(200);
    else if (status)
      rows = await ctx.db
        .query("trustRequests")
        .withIndex("by_status_received", (q) => q.eq("status", status))
        .order("desc")
        .take(200);
    else rows = await ctx.db.query("trustRequests").withIndex("by_received").order("desc").take(200);
    const names = new Map<string, string>();
    const staffName = async (id: Id<"staff"> | undefined) => {
      if (!id) return null;
      if (!names.has(id)) names.set(id, (await ctx.db.get(id))?.name ?? "Former staff");
      return names.get(id)!;
    };
    const out = [];
    for (const row of rows) {
      out.push({
        id: row._id,
        reference: row.reference,
        kind: row.kind,
        subtype: row.subtype ?? null,
        status: row.status,
        receivedAt: row.receivedAt,
        requester: row.requester,
        businessName: row.businessName ?? null,
        routing: row.routing,
        assignedTo: row.assignedTo ?? null,
        assignedName: await staffName(row.assignedTo),
        dueOn: row.dueOn ?? null,
        verified: row.verification.verifiedAt !== undefined,
        notify: row.notify,
      });
    }
    return out;
  },
});

/** One request in full, with staff names and the company it is routed to. */
export const get = staffQuery({
  args: { requestId: v.id("trustRequests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) notFound();
    const ids = new Set<string>([...request.notes.map((row) => row.by), ...request.actions.map((row) => row.by), request.assignedTo ?? "", request.verification.by ?? "", request.completion?.by ?? ""]);
    const names: Record<string, string> = { requester: "The requester", system: "Selestial", owner: "The company's owner" };
    for (const id of ids) {
      if (!id || names[id]) continue;
      const normalized = ctx.db.normalizeId("staff", id);
      names[id] = normalized ? ((await ctx.db.get(normalized))?.name ?? "Former staff") : id;
    }
    const company = request.companyId ? await ctx.db.get(request.companyId) : null;
    return { ...request, names, companyName: company?.name ?? null };
  },
});

/** Companies by name, for routing a request to the right one. Names and ids only: no records. */
export const findCompanies = staffQuery({
  args: { search: v.string() },
  handler: async (ctx, args) => {
    const words = args.search.trim().toLowerCase();
    if (words.length < 2) return [];
    const rows = await ctx.db.query("companies").take(2000);
    return rows
      .filter((row) => row.name.toLowerCase().includes(words))
      .slice(0, 10)
      .map((row) => ({ id: row._id, name: row.name, plan: row.plan ?? ("growth" as const) }));
  },
});

export const assign = staffMutation({
  args: { requestId: v.id("trustRequests"), staffId: v.union(v.id("staff"), v.null()) },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    if (args.staffId === null) {
      await act(ctx, request, "unassigned", "No one is assigned.", { assignedTo: undefined });
      return null;
    }
    const person = await ctx.db.get(args.staffId);
    if (!person || person.status !== "active") throw userError("That person is not active staff.");
    await act(ctx, request, "assigned", `Assigned to ${person.name}.`, { assignedTo: person._id });
    return null;
  },
});

export const setStatus = staffMutation({
  args: { requestId: v.id("trustRequests"), status: requestStatusValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    if (args.status === "completed" || args.status === "closed_with_limitation") throw userError("Use Complete to close a request, with its outcome.");
    if (args.status === "routed_to_business") throw userError("Use Route to send a request to a business.");
    const note = args.note?.trim().slice(0, 1000);
    await act(ctx, request, "status", `${request.status} to ${args.status}${note ? `: ${note}` : ""}`, { status: args.status, ...(CLOSED.includes(request.status) ? { completion: undefined } : {}) });
    return null;
  },
});

/** A date staff chose to finish by. It is not worked out from any law: that is a person's call. */
export const setDue = staffMutation({
  args: { requestId: v.id("trustRequests"), dueOn: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    const dueOn = args.dueOn === null ? undefined : dateOnly(args.dueOn, "The due date");
    await act(ctx, request, "due", dueOn ? `Due on ${dueOn}.` : "Due date cleared.", { dueOn });
    return null;
  },
});

export const note = staffMutation({
  args: { requestId: v.id("trustRequests"), text: v.string() },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    const words = text(args.text, "The note", 4000);
    await ctx.db.patch(request._id, {
      notes: [...request.notes, { at: Date.now(), by: by(ctx), text: words }],
      actions: [...request.actions, { at: Date.now(), by: by(ctx), action: "note", detail: "Added a note." }],
    });
    return null;
  },
});

/** How staff confirmed the person is who they say, for example "replied from the address on file". */
export const recordVerification = staffMutation({
  args: { requestId: v.id("trustRequests"), method: v.string() },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    const method = text(args.method, "How they were verified", 500);
    const status = request.status === "received" || request.status === "verifying" ? ("in_progress" as const) : request.status;
    await act(ctx, request, "verified", method, { verification: { method, verifiedAt: Date.now(), by: by(ctx) }, status });
    return null;
  },
});

export const route = staffMutation({
  args: { requestId: v.id("trustRequests"), routing: routingValidator, companyId: v.optional(v.id("companies")) },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    const company = args.companyId ? await ctx.db.get(args.companyId) : null;
    if (args.companyId && !company) throw userError("That company was not found.");
    if (args.routing === "business") {
      if (!company) throw userError("Choose the business this request belongs to.");
      // The business holds the records and decides; Selestial passes the request on.
      await act(ctx, request, "routed", `Routed to ${company.name}.`, { routing: "business", companyId: company._id, status: "routed_to_business" });
      return null;
    }
    const status = request.status === "routed_to_business" ? ("in_progress" as const) : request.status;
    await act(ctx, request, "routed", company ? `Kept with Selestial, about ${company.name}.` : "Kept with Selestial.", { routing: "selestial", companyId: company?._id, status });
    return null;
  },
});

/** Requests that disclose or remove data. Closing one as done needs a recorded verification first. */
const NEEDS_VERIFICATION: readonly PrivacySubtype[] = ["access", "correction", "deletion"];

export const complete = staffMutation({
  args: { requestId: v.id("trustRequests"), outcome: v.string(), limitation: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const request = await requestOrNotFound(ctx, args.requestId);
    const outcome = text(args.outcome, "The outcome", 2000);
    const limitation = args.limitation?.trim() ? text(args.limitation, "The limitation", 2000) : undefined;
    const sensitive = request.kind === "privacy" && request.subtype && NEEDS_VERIFICATION.includes(request.subtype) && request.routing === "selestial";
    if (sensitive && !limitation && request.verification.verifiedAt === undefined) {
      throw userError("Record how the person was verified before completing this request, or close it with a limitation.");
    }
    const status = limitation ? ("closed_with_limitation" as const) : ("completed" as const);
    await act(ctx, request, "completed", limitation ? `${outcome} Limitation: ${limitation}` : outcome, {
      status,
      completion: { at: Date.now(), by: by(ctx), outcome, ...(limitation ? { limitation } : {}) },
    });
    return null;
  },
});
