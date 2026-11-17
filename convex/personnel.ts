/**
 * Sensitive personnel requests: pay changes, disciplinary records, suspension, reinstatement, ending an
 * engagement, rehire restrictions and removing personal details. A person asks; an authorized person decides
 * (the Owner, or the Owner or a Manager by the company's rule, never the person who asked unless they are the
 * Owner confirming their own request). No agent and no score can open one: every function here is a person's.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { owned } from "./lib/access";
import { companyMutation, managerMutation, managerQuery } from "./lib/builders";
import { STATUS_WORDS } from "./lib/cleaners/enroll";
import { applyPay, carryOut, KIND_WORDS, upcomingWork } from "./lib/cleaners/personnel";
import { payArrangementValidator, personnelKindValidator } from "./lib/cleaners/schema";
import { cleanersSettings } from "./lib/cleaners/settings";
import { notAllowed, userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { payWords } from "./lib/recruiter/offers";
import { isManager, isOwner } from "./lib/roles";
import { optionalText, text } from "./lib/text";

function mayDecide(role: "owner" | "manager" | "office", decider: "owner" | "owner_or_manager"): boolean {
  return decider === "owner" ? isOwner(role) : isManager(role);
}

export const list = managerQuery({
  args: { cleanerId: v.optional(v.id("cleaners")), status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("declined"), v.literal("withdrawn"))) },
  handler: async (ctx, args) => {
    const rows = args.cleanerId
      ? await ctx.db
          .query("personnelRequests")
          .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", args.cleanerId))
          .order("desc")
          .take(100)
      : await ctx.db
          .query("personnelRequests")
          .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", args.status ?? "pending"))
          .order("desc")
          .take(100);
    const settings = cleanersSettings(ctx.company);
    const out = [];
    for (const row of rows) {
      if (args.cleanerId && args.status && row.status !== args.status) continue;
      // Pay requests are the Owner's to see, terms and all.
      if (row.kind === "pay_change" && !isOwner(ctx.role)) continue;
      const requester = await ctx.db.get(row.requestedBy);
      const decider = row.decidedBy ? await ctx.db.get(row.decidedBy) : null;
      const cleaner = row.cleanerId ? await ctx.db.get(row.cleanerId) : null;
      const sub = row.subcontractorId ? await ctx.db.get(row.subcontractorId) : null;
      out.push({
        requestId: row._id,
        kind: row.kind,
        kindWords: KIND_WORDS[row.kind],
        cleaner: cleaner ? { id: cleaner._id, name: cleaner.name, status: STATUS_WORDS[cleaner.status] } : null,
        subcontractor: sub ? { id: sub._id, name: sub.name } : null,
        reason: row.reason,
        summary: row.details.summary ?? null,
        pay: row.details.pay ? payWords(row.details.pay) : null,
        effectiveAt: row.details.effectiveAt ?? null,
        until: row.details.until ?? null,
        status: row.status,
        requestedBy: requester?.name ?? "A team member",
        requestedAt: row.requestedAt,
        decidedBy: decider?.name ?? null,
        decidedAt: row.decidedAt ?? null,
        decisionNote: row.decisionNote ?? null,
        carriedOut: row.carriedOut ?? null,
        youMayDecide: row.status === "pending" && mayDecide(ctx.role, settings.personnelDecider) && (row.requestedBy !== ctx.member._id || isOwner(ctx.role)),
      });
    }
    return out;
  },
});

/** What approving would touch, so the person deciding sees it first. */
export const impact = managerQuery({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => upcomingWork(ctx, ctx.company, (await owned(ctx, args.cleanerId))._id),
});

export const request = managerMutation({
  args: {
    kind: personnelKindValidator,
    cleanerId: v.optional(v.id("cleaners")),
    subcontractorId: v.optional(v.id("subcontractors")),
    reason: v.string(),
    summary: v.optional(v.string()),
    pay: v.optional(payArrangementValidator),
    effectiveAt: v.optional(v.number()),
    until: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const reason = text(args.reason, "The reason", 2000);
    if (args.kind === "pay_change") {
      // Pay is the Owner's: only the Owner sees it, so only the Owner proposes a change to it.
      if (!isOwner(ctx.role)) notAllowed();
      if (!args.pay) throw userError("Give the new pay.");
      if (args.pay.kind === "share" && (!Number.isInteger(args.pay.shareBps) || args.pay.shareBps < 0 || args.pay.shareBps > 10000)) throw userError("The share must be between 0% and 100%.");
      if (args.pay.kind === "hourly" && (!Number.isSafeInteger(args.pay.hourlyCents) || args.pay.hourlyCents < 0)) throw userError("The hourly rate must be a whole number of cents, zero or more.");
      if (args.effectiveAt !== undefined && (!Number.isSafeInteger(args.effectiveAt) || args.effectiveAt < Date.now() - 60 * 60 * 1000)) throw userError("A pay change starts now or later, never earlier: jobs already done keep the pay they had.");
    }
    if (args.kind !== "pay_change" && args.subcontractorId) throw userError("Only a pay change applies to a subcontractor company here.");
    if (!args.cleanerId && !args.subcontractorId) throw userError("Choose who this is about.");
    if (args.cleanerId && args.subcontractorId) throw userError("Choose one: a worker or a subcontractor company.");
    const cleaner = args.cleanerId ? await owned(ctx, args.cleanerId) : null;
    if (args.subcontractorId) await owned(ctx, args.subcontractorId);
    if (cleaner) {
      if (cleaner.engagement === "subcontractor" && args.kind === "pay_change") throw userError("Subcontractor workers are paid through their company. Change the company's pay instead.");
      if (args.kind === "suspend" && (cleaner.status === "suspended" || cleaner.status === "ended")) throw userError(`They are already ${STATUS_WORDS[cleaner.status].toLowerCase()}.`);
      if (args.kind === "reinstate" && cleaner.status !== "suspended") throw userError("Only a suspended worker is reinstated.");
      if (args.kind === "end_engagement" && cleaner.status === "ended") throw userError("The engagement has already ended.");
      if (args.kind === "remove_record" && cleaner.status !== "ended") throw userError("End the engagement before removing personal details.");
      if (args.kind === "disciplinary" && !args.summary?.trim()) throw userError("Describe what happened, as documented.");
      const open = await ctx.db
        .query("personnelRequests")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId).eq("cleanerId", cleaner._id))
        .take(100);
      if (open.some((row) => row.status === "pending" && row.kind === args.kind)) throw userError("A request like this is already waiting for a decision.");
    }
    const requestId = await ctx.db.insert("personnelRequests", {
      companyId: ctx.companyId,
      cleanerId: args.cleanerId,
      subcontractorId: args.subcontractorId,
      kind: args.kind,
      details: { pay: args.pay, effectiveAt: args.effectiveAt, summary: optionalText(args.summary, "The summary", 4000), until: args.until },
      reason,
      status: "pending",
      requestedBy: ctx.member._id,
      requestedAt: Date.now(),
    });
    if (cleaner) await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.personnel_requested", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { kind: args.kind, requestId } });
    else await recordEvent(ctx, { companyId: ctx.companyId, type: "personnel.requested", actor: byMember(ctx), subject: { table: "personnelRequests", id: requestId }, data: { kind: args.kind } });
    return requestId;
  },
});

export const withdraw = managerMutation({
  args: { requestId: v.id("personnelRequests") },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.requestId);
    if (row.status !== "pending") throw userError("This request was already decided.");
    if (row.requestedBy !== ctx.member._id && !isOwner(ctx.role)) notAllowed();
    await ctx.db.patch(row._id, { status: "withdrawn", decidedAt: Date.now(), decidedBy: ctx.member._id });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "personnel.withdrawn", actor: byMember(ctx), subject: { table: "personnelRequests", id: row._id }, data: { kind: row.kind } });
    return null;
  },
});

/** The authorized person approves or declines. Approving carries it out at once, after every check runs again. */
export const decide = companyMutation({
  args: { requestId: v.id("personnelRequests"), decision: v.union(v.literal("approved"), v.literal("declined")), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const row = await owned(ctx, args.requestId);
    const settings = cleanersSettings(ctx.company);
    if (!mayDecide(ctx.role, settings.personnelDecider)) notAllowed();
    if (row.kind === "pay_change" && !isOwner(ctx.role)) notAllowed();
    if (row.requestedBy === ctx.member._id && !isOwner(ctx.role)) throw userError("Someone else decides a request you made.");
    if (row.status !== "pending") throw userError(`This request was already ${row.status}.`);
    const note = optionalText(args.note, "The note", 2000);
    if (args.decision === "declined" && !note) throw userError("Say why it is declined.");
    const decided = { status: args.decision, decidedBy: ctx.member._id, decidedAt: Date.now(), decisionNote: note };
    await ctx.db.patch(row._id, decided);
    let result: { ok: boolean; detail: string } | null = null;
    if (args.decision === "approved") {
      const fresh = { ...row, ...decided };
      // A pay change dated later is applied when its date comes.
      if (row.kind === "pay_change" && row.details.effectiveAt !== undefined && row.details.effectiveAt > Date.now()) {
        result = await applyPay(ctx, fresh, byMember(ctx));
        await ctx.scheduler.runAt(row.details.effectiveAt, internal.personnel.applyScheduledPay, { requestId: row._id });
      } else {
        result = await carryOut(ctx, ctx.company, fresh, byMember(ctx));
      }
      await ctx.db.patch(row._id, { carriedOut: { ...result, at: Date.now() } });
    }
    if (row.cleanerId) await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.personnel_decided", actor: byMember(ctx), subject: { table: "cleaners", id: row.cleanerId }, data: { kind: row.kind, decision: args.decision, requestId: row._id, carriedOut: result?.ok ?? null } });
    else await recordEvent(ctx, { companyId: ctx.companyId, type: `personnel.${args.decision}`, actor: byMember(ctx), subject: { table: "personnelRequests", id: row._id }, data: { kind: row.kind } });
    return { carriedOut: result };
  },
});

/** On the date an approved pay change takes effect, it is copied to the record Dispatch reads. */
export const applyScheduledPay = internalMutation({
  args: { requestId: v.id("personnelRequests") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.requestId);
    if (!row || row.status !== "approved" || row.kind !== "pay_change" || !row.details.pay) return null;
    if (row.cleanerId) {
      const cleaner = await ctx.db.get(row.cleanerId);
      const current = await ctx.db
        .query("payArrangements")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", row.companyId).eq("cleanerId", row.cleanerId))
        .order("desc")
        .take(20);
      // Only if this is still the arrangement that applies now; a later approved change wins.
      const live = current.find((item) => item.effectiveFrom <= Date.now() && (item.effectiveTo === undefined || item.effectiveTo > Date.now()));
      if (cleaner && live?.requestId === row._id) {
        await ctx.db.patch(cleaner._id, { pay: row.details.pay, updatedAt: Date.now() });
        await recordEvent(ctx, { companyId: row.companyId, type: "cleaner.pay_changed", actor: { kind: "system" }, subject: { table: "cleaners", id: cleaner._id }, data: { kind: row.details.pay.kind } });
      }
    } else if (row.subcontractorId) {
      const sub = await ctx.db.get(row.subcontractorId);
      if (sub) await ctx.db.patch(sub._id, { pay: row.details.pay });
    }
    return null;
  },
});
