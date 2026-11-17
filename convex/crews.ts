/**
 * Permanent crews: named teams that usually work together, with one lead. Membership is history, never
 * overwritten. Being in a crew proves nothing about being free: a crew is always read through its
 * members' own availability and readiness.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { initialsOf } from "./lib/workforce/facts";
import { optionalText, text } from "./lib/text";

async function members(ctx: { db: QueryCtx["db"] }, companyId: Id<"companies">, crewId: Id<"crews">) {
  return (
    await ctx.db
      .query("crewMembers")
      .withIndex("by_company_crew", (q) => q.eq("companyId", companyId).eq("crewId", crewId))
      .take(200)
  ).filter((row) => row.leftAt === undefined);
}

export const list = companyQuery({
  args: {},
  handler: async (ctx) => {
    const crews = await ctx.db
      .query("crews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(500);
    const out = [];
    for (const crew of crews) {
      const rows = await members(ctx, ctx.companyId, crew._id);
      const people = [];
      for (const row of rows) {
        const worker = await ctx.db.get(row.cleanerId);
        if (worker && worker.companyId === ctx.companyId) people.push({ cleanerId: worker._id, name: worker.name, initials: initialsOf(worker.name), role: row.role, status: worker.status });
      }
      out.push({ id: crew._id, name: crew.name, notes: crew.notes ?? null, members: people.sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead") || a.name.localeCompare(b.name)) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

async function join(ctx: MutationCtx & { companyId: Id<"companies">; member: Doc<"members"> }, crew: Doc<"crews">, worker: Doc<"cleaners">, role: "lead" | "member") {
  if (worker.status === "ended") throw userError(`${worker.name}'s engagement has ended, so they cannot join a crew.`);
  const current = await members(ctx, ctx.companyId, crew._id);
  const already = current.find((row) => row.cleanerId === worker._id);
  if (already && already.role === role) return;
  if (role === "lead") {
    for (const row of current.filter((item) => item.role === "lead" && item.cleanerId !== worker._id)) await ctx.db.patch(row._id, { role: "member" });
  }
  if (already) await ctx.db.patch(already._id, { role });
  else await ctx.db.insert("crewMembers", { companyId: ctx.companyId, crewId: crew._id, cleanerId: worker._id, role, joinedAt: Date.now(), by: ctx.member._id });
  await recordEvent(ctx, { companyId: ctx.companyId, type: already ? "cleaner.crew_role_changed" : "cleaner.crew_joined", actor: byMember(ctx), subject: { table: "cleaners", id: worker._id }, data: { crewId: crew._id, role } });
}

/** A crew with its members. The lead must be one of the members. */
export const create = managerMutation({
  args: { name: v.string(), notes: v.optional(v.string()), memberIds: v.array(v.id("cleaners")), leadId: v.optional(v.id("cleaners")) },
  handler: async (ctx, args) => {
    const name = text(args.name, "Crew name", 80);
    if (args.memberIds.length > 20) throw userError("A crew has at most 20 people.");
    const ids = [...new Set(args.memberIds)];
    if (args.leadId && !ids.includes(args.leadId)) throw userError("The lead must be one of the crew's members.");
    const existing = await ctx.db
      .query("crews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(500);
    if (existing.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())) throw userError(`There is already a crew called ${name}.`);
    const workers = [];
    for (const id of ids) workers.push(await owned(ctx, id));
    const crewId = await ctx.db.insert("crews", { companyId: ctx.companyId, name, notes: optionalText(args.notes, "Notes", 500), status: "active", createdBy: ctx.member._id, createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "crew.created", actor: byMember(ctx), subject: { table: "crews", id: crewId }, data: { members: ids.length } });
    const crew = (await ctx.db.get(crewId))!;
    for (const worker of workers) await join(ctx, crew, worker, worker._id === args.leadId ? "lead" : "member");
    return crewId;
  },
});

export const addMember = managerMutation({
  args: { crewId: v.id("crews"), cleanerId: v.id("cleaners"), lead: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const crew = await owned(ctx, args.crewId);
    if (crew.status !== "active") throw userError("This crew is archived.");
    await join(ctx, crew, await owned(ctx, args.cleanerId), args.lead ? "lead" : "member");
    return null;
  },
});

/** Leaving keeps the membership row, closed, so past work still shows who was on the crew. */
export const removeMember = managerMutation({
  args: { crewId: v.id("crews"), cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const crew = await owned(ctx, args.crewId);
    const worker = await owned(ctx, args.cleanerId);
    const row = (await members(ctx, ctx.companyId, crew._id)).find((item) => item.cleanerId === worker._id);
    if (!row) return null;
    await ctx.db.patch(row._id, { leftAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.crew_left", actor: byMember(ctx), subject: { table: "cleaners", id: worker._id }, data: { crewId: crew._id } });
    return null;
  },
});

export const archive = managerMutation({
  args: { crewId: v.id("crews") },
  handler: async (ctx, args) => {
    const crew = await owned(ctx, args.crewId);
    if (crew.status === "archived") return null;
    await ctx.db.patch(crew._id, { status: "archived" });
    for (const row of await members(ctx, ctx.companyId, crew._id)) await ctx.db.patch(row._id, { leftAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "crew.archived", actor: byMember(ctx), subject: { table: "crews", id: crew._id } });
    return null;
  },
});
