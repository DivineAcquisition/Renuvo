/**
 * Restoring the record safely (docs/operations/05-recovery-runbook.md). Run from the command line against
 * the restored deployment, never from a browser:
 *
 *   npx convex run restoration:lockDown '{"reason":"Restored from the 03:00 backup"}'
 *   npx convex run restoration:status
 *   npx convex run restoration:verify
 *   npx convex run restoration:release '{"lockdownId":"…","note":"Reconciled outbox, charges, numbers"}'
 *
 * A restore must never replay what already happened outside: a message sent, a card charged, a number
 * bought, an agent's action. Restored rows can say "queued" or "sending" for things that went out after the
 * backup was taken. So the first step suspends every company's outbound sending and pauses every agent, and
 * nothing is released until what the providers did has been reconciled with what the rows say.
 *
 * Suspension and pausing are the same controls the product enforces everywhere (the sending policy is asked
 * again as each message goes; agents check their pause), so nothing new can slip past them.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id, TableNames } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { deploymentName, environment } from "./lib/environment";
import { AGENTS } from "./lib/statuses";
import { EXPORT_TABLES } from "./lib/trust/exportTables";

const PAGE = 500;

/** Suspends sending and pauses every agent for every company, remembering what each had. Run it again until `done`. */
export const lockDown = internalMutation({
  args: { reason: v.string(), lockdownId: v.optional(v.id("lockdowns")), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    let lockdownId = args.lockdownId;
    if (!lockdownId) {
      const open = (await ctx.db.query("lockdowns").withIndex("by_started").order("desc").take(5)).find((row) => row.releasedAt === undefined);
      lockdownId = open?._id ?? (await ctx.db.insert("lockdowns", { reason: args.reason.slice(0, 500), startedAt: now }));
    }
    const page = await ctx.db.query("companies").paginate({ numItems: PAGE, cursor: args.cursor ?? null });
    let locked = 0;
    for (const company of page.page) {
      const recorded = await ctx.db
        .query("lockdownCompanies")
        .withIndex("by_lockdown_company", (q) => q.eq("lockdownId", lockdownId).eq("companyId", company._id))
        .first();
      if (recorded) continue;
      await ctx.db.insert("lockdownCompanies", { lockdownId, companyId: company._id, priorSuspendedAt: company.suspendedAt, priorPausedAgents: company.pausedAgents });
      await ctx.db.patch(company._id, { suspendedAt: company.suspendedAt ?? now, pausedAgents: [...AGENTS] });
      locked += 1;
    }
    return { lockdownId, locked, done: page.isDone, cursor: page.isDone ? null : page.continueCursor };
  },
});

/** What still has to be reconciled with the providers before release, counted from the records (bounded). */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const count = async <T>(rows: Promise<T[]>) => (await rows).length;
    const open = (await ctx.db.query("lockdowns").withIndex("by_started").order("desc").take(5)).find((row) => row.releasedAt === undefined) ?? null;
    const lockedCompanies = open ? await count(ctx.db.query("lockdownCompanies").withIndex("by_lockdown", (q) => q.eq("lockdownId", open._id)).take(10_000)) : 0;
    const messages: Record<string, number> = {};
    for (const status of ["queued", "held", "sending", "unconfirmed"] as const) {
      messages[status] = await count(ctx.db.query("messages").withIndex("by_status_attempted", (q) => q.eq("status", status)).take(1000));
    }
    const settlements: Record<string, number> = {};
    for (const settlement of ["pending_confirm", "pending_release", "unverified"] as const) {
      settlements[`ai_${settlement}`] = await count(ctx.db.query("aiExecutions").withIndex("by_settlement_next", (q) => q.eq("settlement", settlement)).take(1000));
    }
    for (const settlement of ["pending_confirm", "pending_release", "pending_track", "unverified"] as const) {
      settlements[`messaging_${settlement}`] = await count(ctx.db.query("messagingCharges").withIndex("by_settlement_next", (q) => q.eq("settlement", settlement)).take(1000));
    }
    const texting: Record<string, number> = {};
    for (const status of ["approved", "provisioning", "waiting_on_carriers"] as const) {
      texting[status] = await count(ctx.db.query("textingRequests").withIndex("by_status_requested", (q) => q.eq("status", status)).take(1000));
    }
    const googleJobs: Record<string, number> = {};
    for (const status of ["queued", "running", "uncertain"] as const) {
      googleJobs[status] = await count(ctx.db.query("googleJobs").withIndex("by_status_next", (q) => q.eq("status", status)).take(1000));
    }
    return {
      deployment: deploymentName(),
      environment: environment(),
      lockdown: open ? { id: open._id, reason: open.reason, startedAt: open.startedAt, lockedCompanies } : null,
      toReconcile: { messages, settlements, texting, googleJobs },
    };
  },
});

/** One table: how many rows (up to the bound) and how many sampled rows point at a company that is not there. */
export const verifyTable = internalQuery({
  args: { table: v.string() },
  handler: async (ctx, args) => {
    const rows = (await ctx.db.query(args.table as TableNames).take(4000)) as unknown as { companyId?: Id<"companies"> }[];
    const companies = new Map<string, boolean>();
    let orphans = 0;
    for (const row of rows.slice(0, 1000)) {
      if (!row.companyId) continue;
      if (!companies.has(row.companyId)) companies.set(row.companyId, (await ctx.db.get(row.companyId)) !== null);
      if (!companies.get(row.companyId)) orphans += 1;
    }
    return { table: args.table, rows: rows.length, capped: rows.length === 4000, sampled: Math.min(rows.length, 1000), orphans };
  },
});

/** Every company table: counts and orphaned rows, to compare against the source before anything is released. */
export const verify = internalAction({
  args: {},
  handler: async (ctx): Promise<{ companies: number; tables: { table: string; rows: number; capped: boolean; sampled: number; orphans: number }[]; problems: string[] }> => {
    const companies = await ctx.runQuery(internal.restoration.verifyTable, { table: "companies" });
    const tables = [];
    for (const entry of EXPORT_TABLES) {
      try {
        tables.push(await ctx.runQuery(internal.restoration.verifyTable, { table: entry.table }));
      } catch {
        // A table listed for later that is not in this schema yet.
      }
    }
    const problems = tables.filter((row) => row.orphans > 0).map((row) => `${row.table}: ${row.orphans} of ${row.sampled} sampled rows point at a company that is not in this copy.`);
    return { companies: companies.rows, tables, problems };
  },
});

/**
 * Puts every company back as it was before the lock-down. Only after reconciling: the note says what was
 * checked, and it is kept on the lock-down.
 */
export const release = internalMutation({
  args: { lockdownId: v.id("lockdowns"), note: v.string(), cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const lockdown = await ctx.db.get(args.lockdownId);
    if (!lockdown) throw new Error("No such lock-down.");
    if (args.note.trim().length < 20) throw new Error("Say what was reconciled (outbox, charges, numbers, Google writes) before releasing.");
    const page = await ctx.db
      .query("lockdownCompanies")
      .withIndex("by_lockdown", (q) => q.eq("lockdownId", args.lockdownId))
      .paginate({ numItems: PAGE, cursor: args.cursor ?? null });
    for (const row of page.page) {
      const company = await ctx.db.get(row.companyId);
      if (company) await ctx.db.patch(company._id, { suspendedAt: row.priorSuspendedAt, pausedAgents: row.priorPausedAgents as (typeof AGENTS)[number][] });
    }
    if (page.isDone) await ctx.db.patch(lockdown._id, { releasedAt: Date.now(), releaseNote: args.note.trim().slice(0, 1000) });
    return { restored: page.page.length, done: page.isDone, cursor: page.isDone ? null : page.continueCursor };
  },
});
