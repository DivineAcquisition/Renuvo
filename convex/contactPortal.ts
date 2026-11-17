/**
 * The subcontractor contact's portal (/c/portal/<token> with a contact's link): the subcontractor company's
 * own workers and their upcoming work, and nothing about anyone else. The contact can tell the office a
 * worker will be away and ask for help. Their workers' documents, review notes, pay and anyone's internal
 * notes are never here. Everything is reached through the link: a worker id in an argument is checked
 * against the link's company before anything is read or written.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { portalMutation, portalQuery, type PortalAccess } from "./lib/builders";
import { weekSummary } from "./lib/cleaners/attention";
import { STATUS_WORDS } from "./lib/cleaners/enroll";
import { cleanerReadiness, initialsOf } from "./lib/cleaners/records";
import { commitmentsBetween, currentClashes } from "./lib/cleaners/schedule";
import { DAY, HOUR } from "./lib/cleaners/settings";
import { userError } from "./lib/errors";
import { recordEvent, type Actor } from "./lib/events";
import { openTask } from "./lib/taskState";
import { optionalText, text } from "./lib/text";
import { addLocalDays, startOfLocalDay } from "./lib/time";

type Ctx = (QueryCtx | MutationCtx) & PortalAccess;

function subcontractorOf(ctx: Ctx): Doc<"subcontractors"> {
  if (!ctx.subcontractor) throw userError("This link is for a cleaner, not a subcontractor company.", "not_allowed");
  return ctx.subcontractor;
}

function actorOf(ctx: Ctx): Actor {
  return { kind: "subcontractor_contact", subcontractorId: ctx.subcontractor!._id, linkId: ctx.link._id };
}

async function workersOf(ctx: Ctx, sub: Doc<"subcontractors">): Promise<Doc<"cleaners">[]> {
  const rows = await ctx.db
    .query("cleaners")
    .withIndex("by_company_subcontractor", (q) => q.eq("companyId", ctx.companyId).eq("subcontractorId", sub._id))
    .take(300);
  return rows.filter((row) => row.status !== "ended").sort((a, b) => a.name.localeCompare(b.name));
}

/** A worker of this subcontractor company, or "Not found." exactly like a worker who does not exist. */
async function workerOf(ctx: Ctx, cleanerId: Id<"cleaners">): Promise<Doc<"cleaners">> {
  const sub = subcontractorOf(ctx);
  const cleaner = await ctx.db.get(cleanerId);
  if (!cleaner || cleaner.companyId !== ctx.companyId || cleaner.subcontractorId !== sub._id || cleaner.status === "ended") throw userError("Not found.", "not_found");
  return cleaner;
}

export const view = portalQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const companyName = ctx.company.name;
    if (ctx.linkState !== "active") return { state: ctx.linkState, company: companyName } as const;
    if (ctx.link.holder !== "subcontractor") return { state: "not_contact" as const, company: companyName };
    const sub = ctx.subcontractor!;
    if (sub.status === "ended") return { state: "ended" as const, company: companyName };
    const tz = ctx.company.timezone;
    const now = args.asOf;
    const workers = await workersOf(ctx, sub);
    const today = startOfLocalDay(now, tz);
    const commitments = await commitmentsBetween(ctx, ctx.company, today, addLocalDays(today, 21, tz));

    const people = [];
    const jobs = [];
    for (const worker of workers) {
      const { readiness, windows } = await cleanerReadiness(ctx, ctx.company, worker, now);
      people.push({
        cleanerId: worker._id,
        name: worker.name,
        initials: initialsOf(worker.name),
        engagement: STATUS_WORDS[worker.status],
        ready: readiness.eligible,
        // What is still needed, by name only: never the files, review notes or waiver reasons.
        needs: readiness.blockers.map((row) => row.label),
        week: weekSummary(windows),
        hoursConfirmedAt: worker.availabilityConfirmedAt ?? null,
      });
      for (const row of commitments.get(worker._id) ?? []) {
        if (row.endsAt <= now) continue;
        const job = await ctx.db.get(row.jobId as Id<"jobs">);
        if (!job) continue;
        const property = await ctx.db.get(job.propertyId);
        jobs.push({
          id: row.assignmentId,
          worker: worker.name,
          startsAt: job.startsAt,
          endsAt: job.endsAt,
          service: job.serviceType,
          status: row.status,
          // The area for an offer; the street once the worker has accepted.
          where: property ? (row.status === "accepted" ? `${property.address.line1}, ${property.address.city}` : `${property.address.city} ${property.address.postalCode}`) : null,
        });
      }
    }

    const crews = [];
    const crewRows = await ctx.db
      .query("crews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(300);
    for (const crew of crewRows.filter((row) => row.kind === "permanent" && row.subcontractorId === sub._id)) {
      const memberships = await ctx.db
        .query("crewMemberships")
        .withIndex("by_company_crew", (q) => q.eq("companyId", ctx.companyId).eq("crewId", crew._id))
        .take(100);
      const members = [];
      for (const row of memberships.filter((item) => item.to === undefined)) {
        const worker = workers.find((item) => item._id === row.cleanerId);
        if (worker) members.push({ name: worker.name, lead: row.role === "lead" });
      }
      crews.push({ name: crew.name, members: members.sort((a, b) => Number(b.lead) - Number(a.lead) || a.name.localeCompare(b.name)) });
    }

    return {
      state: "active" as const,
      company: companyName,
      timezone: tz,
      subcontractor: sub.name,
      contactName: sub.contact.name,
      paused: sub.status === "paused",
      allowed: ctx.link.allowed,
      expiresAt: ctx.link.expiresAt,
      workers: people,
      jobs: jobs.sort((a, b) => a.startsAt - b.startsAt).slice(0, 40),
      crews,
    };
  },
});

/** "One of our people will be away." Booked work it touches stays booked: the office is told and decides. */
export const addTimeAway = portalMutation({
  action: "add_time_away",
  args: { cleanerId: v.id("cleaners"), startsAt: v.number(), endsAt: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const sub = subcontractorOf(ctx);
    const worker = await workerOf(ctx, args.cleanerId);
    if (!Number.isSafeInteger(args.startsAt) || !Number.isSafeInteger(args.endsAt) || args.startsAt >= args.endsAt) throw userError("Time away must start before it ends.");
    if (args.endsAt <= Date.now()) throw userError("Time away has to be in the future.");
    if (args.endsAt - args.startsAt > 120 * DAY) throw userError("For more than four months away, talk to the office.");
    await ctx.db.insert("timeOff", { companyId: ctx.companyId, cleanerId: worker._id, startsAt: args.startsAt, endsAt: args.endsAt, note: optionalText(args.note, "Note", 300), source: "subcontractor", createdAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.time_off_added", actor: actorOf(ctx), subject: { table: "cleaners", id: worker._id }, data: { startsAt: args.startsAt, endsAt: args.endsAt, from: "subcontractor" } });
    const impact = await currentClashes(ctx, ctx.company, worker._id);
    if (impact.length > 0) {
      await openTask(ctx, {
        companyId: ctx.companyId,
        agent: "dispatch",
        title: `${worker.name} will be away during booked work`,
        nextAction: `${sub.name} said ${worker.name} will be away, which clashes with: ${impact.join("; ")}. Talk with them, then keep or cover each job in Dispatch.`,
        dueAt: Date.now() + 12 * HOUR,
        completionCondition: "Each clashing job is kept or covered by a person",
        about: { table: "cleaners", id: worker._id },
        key: `cleaners.time_away:${worker._id}:${args.startsAt}`,
        actor: actorOf(ctx),
      });
    }
    return { impact };
  },
});

export const askForHelp = portalMutation({
  action: "ask_for_help",
  args: { text: v.string() },
  handler: async (ctx, args) => {
    const sub = subcontractorOf(ctx);
    const words = text(args.text, "Your question", 600);
    await openTask(ctx, {
      companyId: ctx.companyId,
      agent: "dispatch",
      title: `${sub.name} asked for help`,
      nextAction: `${sub.contact.name} wrote from their portal: "${words.slice(0, 400)}" Reply to them directly.`,
      dueAt: Date.now() + DAY,
      completionCondition: "A person replied to them",
      // Tasks point at people, jobs and customers; the subcontractor company is named in the title instead.
      actor: actorOf(ctx),
    });
    return null;
  },
});
