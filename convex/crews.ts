/**
 * Crews: permanent crews with a lead, and temporary teams put together for one job.
 *
 * Being in a crew never says anyone is free. A crew is suggested for a job only by checking each member
 * with Dispatch's own rules for that job (requirements, skills, hours, date exceptions, time away, other
 * work, time between jobs), and staffing that is still incomplete stays visible. A temporary team keeps the
 * members it was assembled with, whatever later happens to a permanent crew. Offers go out through
 * Dispatch's one offer path, so nothing here can offer around the checks that protect a cleaner's time.
 */
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { owned } from "./lib/access";
import { companyQuery, managerMutation } from "./lib/builders";
import { STATUS_WORDS } from "./lib/cleaners/enroll";
import { companyFacts, initialsOf, readinessOf } from "./lib/cleaners/records";
import { jobLabel } from "./lib/cleaners/schedule";
import { staffing } from "./lib/dispatch/crew";
import { assess, DISPATCH_RULES, type Exclusion } from "./lib/dispatch/eligibility";
import { cleanerFacts, jobAssignments, jobFacts, jobHistory } from "./lib/dispatch/facts";
import { offerProblem, personRules, placeOffer } from "./lib/dispatch/offers";
import { payFor } from "./lib/dispatch/pay";
import { dispatchSettings } from "./lib/dispatch/settings";
import { coverJob } from "./lib/dispatch/workflow";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";
import { isOwner } from "./lib/roles";
import { optionalText, tags, text } from "./lib/text";

type Ctx = (QueryCtx | MutationCtx) & { companyId: Id<"companies">; company: Doc<"companies"> };

async function currentMembers(ctx: Ctx, crewId: Id<"crews">) {
  const rows = await ctx.db
    .query("crewMemberships")
    .withIndex("by_company_crew", (q) => q.eq("companyId", ctx.companyId).eq("crewId", crewId))
    .take(200);
  return rows;
}

export const list = companyQuery({
  args: { asOf: v.number() },
  handler: async (ctx, args) => {
    const facts = await companyFacts(ctx, ctx.company);
    const crews = await ctx.db
      .query("crews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(300);
    const out = [];
    for (const crew of crews) {
      if (crew.kind === "temporary") {
        const job = crew.jobId ? await ctx.db.get(crew.jobId) : null;
        // A team for a job that is long done is history, not a crew to work with.
        if (!job || job.endsAt < args.asOf - 7 * 86_400_000) continue;
      }
      const memberships = await currentMembers(ctx, crew._id);
      const members = [];
      for (const row of memberships.filter((item) => item.to === undefined)) {
        const cleaner = await ctx.db.get(row.cleanerId);
        if (!cleaner) continue;
        members.push({ cleanerId: cleaner._id, name: cleaner.name, initials: initialsOf(cleaner.name), role: row.role, status: cleaner.status, statusWords: STATUS_WORDS[cleaner.status], readiness: readinessOf(cleaner, facts, ctx.company, args.asOf).state });
      }
      members.sort((a, b) => Number(b.role === "lead") - Number(a.role === "lead") || a.name.localeCompare(b.name));
      const job = crew.jobId ? await ctx.db.get(crew.jobId) : null;
      const sub = crew.subcontractorId ? await ctx.db.get(crew.subcontractorId) : null;
      out.push({
        crewId: crew._id,
        name: crew.name,
        kind: crew.kind,
        equipment: crew.equipment,
        notes: crew.notes ?? null,
        subcontractor: sub ? { id: sub._id, name: sub.name } : null,
        job: job ? { jobId: job._id, label: jobLabel(job, (await ctx.db.get(job.customerId))?.name ?? null, ctx.company.timezone), startsAt: job.startsAt } : null,
        members,
        ready: members.filter((member) => member.readiness === "ready").length,
      });
    }
    return out.sort((a, b) => Number(a.kind === "temporary") - Number(b.kind === "temporary") || a.name.localeCompare(b.name));
  },
});

/** One crew with its history: who joined and left, and when. */
export const get = companyQuery({
  args: { crewId: v.id("crews") },
  handler: async (ctx, args) => {
    const crew = await owned(ctx, args.crewId);
    const memberships = await currentMembers(ctx, crew._id);
    const rows = [];
    for (const row of memberships) {
      const cleaner = await ctx.db.get(row.cleanerId);
      rows.push({ cleanerId: row.cleanerId, name: cleaner?.name ?? "Former worker", role: row.role, from: row.from, to: row.to ?? null });
    }
    return { crewId: crew._id, name: crew.name, kind: crew.kind, status: crew.status, jobId: crew.jobId ?? null, equipment: crew.equipment, members: rows.sort((a, b) => a.from - b.from) };
  },
});

async function checkMember(ctx: MutationCtx & { companyId: Id<"companies"> }, cleanerId: Id<"cleaners">, subcontractorId: Id<"subcontractors"> | undefined): Promise<Doc<"cleaners">> {
  const cleaner = await owned(ctx, cleanerId);
  if (cleaner.status === "ended") throw userError(`${cleaner.name}'s engagement has ended.`);
  if (subcontractorId && cleaner.subcontractorId !== subcontractorId) throw userError(`${cleaner.name} does not work through this subcontractor company.`);
  return cleaner;
}

async function join(ctx: MutationCtx & { companyId: Id<"companies">; member: Doc<"members"> }, crew: Doc<"crews">, cleaner: Doc<"cleaners">, role: "lead" | "member") {
  await ctx.db.insert("crewMemberships", { companyId: ctx.companyId, crewId: crew._id, cleanerId: cleaner._id, role, from: Date.now() });
  await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.crew_joined", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { crew: crew.name, crewId: crew._id, role } });
}

export const create = managerMutation({
  args: { name: v.string(), memberIds: v.array(v.id("cleaners")), leadId: v.optional(v.id("cleaners")), subcontractorId: v.optional(v.id("subcontractors")), equipment: v.optional(v.array(v.string())), notes: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const name = text(args.name, "The crew's name", 80);
    if (args.memberIds.length === 0) throw userError("Add at least one person.");
    if (args.memberIds.length > 30) throw userError("A crew can have up to 30 people.");
    if (args.leadId && !args.memberIds.includes(args.leadId)) throw userError("The lead must be one of the crew.");
    if (args.subcontractorId) await owned(ctx, args.subcontractorId);
    const existing = await ctx.db
      .query("crews")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
      .take(300);
    if (existing.some((crew) => crew.kind === "permanent" && crew.name.toLowerCase() === name.toLowerCase())) throw userError(`There is already a crew called ${name}.`);
    const crewId = await ctx.db.insert("crews", { companyId: ctx.companyId, name, kind: "permanent", status: "active", subcontractorId: args.subcontractorId, equipment: tags(args.equipment ?? [], "Equipment", 30), notes: optionalText(args.notes, "Notes", 1000), createdBy: ctx.member._id, createdAt: Date.now() });
    const crew = (await ctx.db.get(crewId))!;
    for (const id of [...new Set(args.memberIds)]) await join(ctx, crew, await checkMember(ctx, id, args.subcontractorId), id === args.leadId ? "lead" : "member");
    await recordEvent(ctx, { companyId: ctx.companyId, type: "crew.created", actor: byMember(ctx), subject: { table: "crews", id: crewId }, data: { members: args.memberIds.length } });
    return crewId;
  },
});

/** Adds or removes people, or changes the lead. Leaving is dated; nothing about past jobs changes. */
export const changeMembers = managerMutation({
  args: { crewId: v.id("crews"), add: v.optional(v.array(v.id("cleaners"))), remove: v.optional(v.array(v.id("cleaners"))), leadId: v.optional(v.union(v.id("cleaners"), v.null())) },
  handler: async (ctx, args) => {
    const crew = await owned(ctx, args.crewId);
    if (crew.kind !== "permanent" || crew.status !== "active") throw userError("Only an active permanent crew changes members. A team for a job keeps the people it was assembled with.");
    const rows = (await currentMembers(ctx, crew._id)).filter((row) => row.to === undefined);
    const now = Date.now();
    for (const id of args.remove ?? []) {
      const row = rows.find((item) => item.cleanerId === id);
      if (!row) continue;
      await ctx.db.patch(row._id, { to: now });
      await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.crew_left", actor: byMember(ctx), subject: { table: "cleaners", id }, data: { crew: crew.name, crewId: crew._id } });
    }
    for (const id of args.add ?? []) {
      if (rows.some((row) => row.cleanerId === id)) continue;
      // Someone joining as the new lead joins as lead, so their history has no empty first membership.
      await join(ctx, crew, await checkMember(ctx, id, crew.subcontractorId), args.leadId === id ? "lead" : "member");
    }
    if (args.leadId !== undefined) {
      const live = (await currentMembers(ctx, crew._id)).filter((row) => row.to === undefined);
      if (args.leadId !== null && !live.some((row) => row.cleanerId === args.leadId)) throw userError("The lead must be one of the crew.");
      for (const row of live) {
        const role = row.cleanerId === args.leadId ? ("lead" as const) : ("member" as const);
        if (row.role === role) continue;
        // A change of role is a new membership, so the history shows who led when.
        await ctx.db.patch(row._id, { to: now });
        await ctx.db.insert("crewMemberships", { companyId: ctx.companyId, crewId: crew._id, cleanerId: row.cleanerId, role, from: now });
      }
    }
    return null;
  },
});

export const archive = managerMutation({
  args: { crewId: v.id("crews") },
  handler: async (ctx, args) => {
    const crew = await owned(ctx, args.crewId);
    if (crew.status === "archived") return null;
    for (const row of (await currentMembers(ctx, crew._id)).filter((item) => item.to === undefined)) await ctx.db.patch(row._id, { to: Date.now() });
    await ctx.db.patch(crew._id, { status: "archived" });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "crew.archived", actor: byMember(ctx), subject: { table: "crews", id: crew._id } });
    return null;
  },
});

// ── Assembling a crew for one job ────────────────────────────────────────────────────────────────

/** Soft reasons a person may set aside when offering by hand. Every other reason stands for everyone. */
const SOFT: Exclusion["code"][] = ["outside_area", "no_pay"];

/**
 * Who can take this job, checked one by one with Dispatch's rules, and how each permanent crew fares when its
 * members are checked the same way. A crew is never assumed free because it is a crew.
 */
export const forJob = companyQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    const company = ctx.company;
    const assignments = await jobAssignments(ctx, job);
    const history = await jobHistory(ctx, job, assignments);
    const view = await jobFacts(ctx, company, job);
    const known = { company, facts: await companyFacts(ctx, company) };
    const cleaners = await ctx.db
      .query("cleaners")
      .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "ready"))
      .take(300);
    const memberships = (
      await ctx.db
        .query("crewMemberships")
        .withIndex("by_company_cleaner", (q) => q.eq("companyId", ctx.companyId))
        .take(5000)
    ).filter((row) => row.to === undefined);
    const crews = (
      await ctx.db
        .query("crews")
        .withIndex("by_company_status", (q) => q.eq("companyId", ctx.companyId).eq("status", "active"))
        .take(300)
    ).filter((crew) => crew.kind === "permanent");
    const people = [];
    for (const cleaner of cleaners) {
      const facts = await cleanerFacts(ctx, job, cleaner, history, known);
      // What holds for everyone is checked first, so a date they cannot work is never shown as only "outside
      // their areas". Then Dispatch's own preferences, which a person may set aside when offering by hand.
      const hard = assess(facts, view, { ...personRules(false), ended: true });
      const exclusion = hard ?? assess(facts, view, DISPATCH_RULES);
      const current = assignments.find((row) => row.cleanerId === cleaner._id && (row.status === "offered" || row.status === "accepted"));
      people.push({
        cleanerId: cleaner._id,
        name: cleaner.name,
        initials: initialsOf(cleaner.name),
        onJob: current ? current.status : null,
        eligible: exclusion === null,
        /** Can be offered by a person who chooses to: outside their areas only. A missing pay arrangement cannot be offered. */
        soft: hard === null && exclusion !== null && SOFT.includes(exclusion.code) && facts.pay.ok,
        reason: exclusion?.reason ?? null,
        code: exclusion?.code ?? null,
        // Pay is the Owner's: other roles see only whether an offer could state it.
        pay: isOwner(ctx.role) && facts.pay.ok ? facts.pay.payCents : null,
        payMissing: !facts.pay.ok,
        priorVisits: facts.priorVisitsForCustomer,
        crews: memberships.filter((row) => row.cleanerId === cleaner._id).map((row) => crews.find((crew) => crew._id === row.crewId)?.name).filter((name): name is string => Boolean(name)),
      });
    }
    const staff = staffing(job, assignments);
    const byId = new Map(people.map((person) => [person.cleanerId as string, person]));
    const crewRows = [];
    for (const crew of crews) {
      const rows = memberships.filter((row) => row.crewId === crew._id);
      const members = [];
      for (const row of rows) {
        const person = byId.get(row.cleanerId);
        if (person) members.push({ cleanerId: person.cleanerId, name: person.name, role: row.role, eligible: person.eligible, soft: person.soft, reason: person.reason, onJob: person.onJob });
        else {
          const cleaner = await ctx.db.get(row.cleanerId);
          members.push({ cleanerId: row.cleanerId, name: cleaner?.name ?? "Former worker", role: row.role, eligible: false, soft: false, reason: cleaner ? `is ${STATUS_WORDS[cleaner.status].toLowerCase()}` : "is no longer in the record", onJob: null });
        }
      }
      const eligible = members.filter((member) => member.eligible).length;
      crewRows.push({ crewId: crew._id, name: crew.name, members, eligible, coversOpen: eligible >= staff.open, equipment: crew.equipment });
    }
    crewRows.sort((a, b) => Number(b.coversOpen) - Number(a.coversOpen) || b.eligible - a.eligible || a.name.localeCompare(b.name));
    const best = crewRows.find((row) => row.coversOpen && staff.open > 0) ?? null;
    const customer = await ctx.db.get(job.customerId);
    const leadRow = assignments.find((row) => (row.status === "offered" || row.status === "accepted") && row.role === "lead");
    const lead = leadRow ? { name: (await ctx.db.get(leadRow.cleanerId))?.name ?? "A cleaner", status: leadRow.status } : null;
    return {
      job: { jobId: job._id, label: jobLabel(job, customer?.name ?? null, company.timezone), customer: customer?.name ?? null, service: job.serviceType, startsAt: job.startsAt, endsAt: job.endsAt, requiredSkills: job.requiredSkills, status: job.status, lead },
      staffing: staff,
      people: people.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.priorVisits - a.priorVisits || a.name.localeCompare(b.name)),
      crews: crewRows,
      suggestion: best
        ? { kind: "crew" as const, crewId: best.crewId, words: `${best.name} has ${best.eligible} of ${best.members.length} members free and eligible for this job${best.eligible > staff.open ? `; ${staff.open} ${staff.open === 1 ? "is" : "are"} needed` : ""}.` }
        : staff.open === 0
          ? { kind: "full" as const, words: "Every place on this job has an accepted cleaner." }
          : { kind: "people" as const, words: `No permanent crew has ${staff.open} eligible members for this time. ${people.filter((person) => person.eligible).length} people are eligible on their own.` },
    };
  },
});

/**
 * Offers a job to the people a person chose, through Dispatch's one offer path, and keeps them as a team for
 * this job. Each is checked again as the offer is made; anyone who cannot be offered is reported with the
 * reason, and the places still open stay visible on the job.
 */
export const assembleForJob = managerMutation({
  args: { jobId: v.id("jobs"), cleanerIds: v.array(v.id("cleaners")), leadId: v.optional(v.id("cleaners")), fromCrewId: v.optional(v.id("crews")) },
  handler: async (ctx, args) => {
    const job = await owned(ctx, args.jobId);
    if (job.status !== "scheduled") throw userError("Only a scheduled job can be offered.");
    const chosen = [...new Set(args.cleanerIds)];
    if (chosen.length === 0) throw userError("Choose at least one person.");
    const before = staffing(job, await jobAssignments(ctx, job));
    // Places with an offer already out are not offered twice: a crew is asked for the places nobody holds.
    const room = Math.max(0, before.open - before.offersOut);
    if (chosen.length > room) {
      throw userError(
        before.offersOut === 0
          ? `This job needs ${before.open} more ${before.open === 1 ? "cleaner" : "cleaners"}; you chose ${chosen.length}.`
          : `This job has ${before.open} ${before.open === 1 ? "place" : "places"} without an accepted cleaner and ${before.offersOut} ${before.offersOut === 1 ? "offer" : "offers"} out, so ${room} more can be offered; you chose ${chosen.length}.`,
      );
    }
    if (args.leadId && !chosen.includes(args.leadId)) throw userError("The lead must be one of the people chosen.");
    const company = ctx.company;
    const respondBy = Math.min(job.startsAt - 60 * 60 * 1000, Date.now() + dispatchSettings(company).offerWindowMinutes * 60 * 1000);
    if (respondBy <= Date.now()) throw userError("This job starts too soon to wait for answers. Offer it from Dispatch.");
    // The lead is asked first, so Dispatch's crew roles put them in the lead's place.
    const order = args.leadId ? [args.leadId, ...chosen.filter((id) => id !== args.leadId)] : chosen;
    const results: { cleanerId: Id<"cleaners">; name: string; offered: boolean; words: string }[] = [];
    const offered: Id<"cleaners">[] = [];
    for (const id of order) {
      const cleaner = await owned(ctx, id);
      const fresh = (await ctx.db.get(job._id))!;
      const assignments = await jobAssignments(ctx, fresh);
      const history = await jobHistory(ctx, fresh, assignments);
      const pay = payFor(cleaner, fresh, history.crewPay);
      if (!pay.ok) {
        results.push({ cleanerId: id, name: cleaner.name, offered: false, words: `Not offered: ${cleaner.name} ${pay.reason}.` });
        continue;
      }
      const request = { company, job: fresh, cleaner, respondBy, payCents: pay.payCents, rules: personRules(false) };
      const problem = await offerProblem(ctx, request, { assignments, history });
      if (problem) {
        results.push({ cleanerId: id, name: cleaner.name, offered: false, words: `Not offered: ${problem}` });
        continue;
      }
      await placeOffer(ctx, request, byMember(ctx), { team: true });
      offered.push(id);
      results.push({ cleanerId: id, name: cleaner.name, offered: true, words: `Offered to ${cleaner.name}. They answer from their text.` });
    }
    let crewId: Id<"crews"> | null = null;
    if (offered.length > 0) {
      // The team for this job keeps exactly these people, whatever later happens to a permanent crew. A second
      // round for the same job adds to the team already there rather than starting another.
      const existing = (
        await ctx.db
          .query("crews")
          .withIndex("by_company_job", (q) => q.eq("companyId", ctx.companyId).eq("jobId", job._id))
          .take(10)
      ).find((crew) => crew.kind === "temporary" && crew.status === "active");
      const source = args.fromCrewId ? await owned(ctx, args.fromCrewId) : null;
      crewId =
        existing?._id ??
        (await ctx.db.insert("crews", {
          companyId: ctx.companyId,
          name: source ? `${source.name} for ${new Intl.DateTimeFormat("en-US", { timeZone: company.timezone, month: "short", day: "numeric" }).format(new Date(job.startsAt))}` : `Team for ${job.serviceType}`,
          kind: "temporary",
          status: "active",
          jobId: job._id,
          subcontractorId: source?.subcontractorId,
          equipment: source?.equipment ?? [],
          createdBy: ctx.member._id,
          createdAt: Date.now(),
        }));
      const crew = (await ctx.db.get(crewId))!;
      const already = (await currentMembers(ctx, crew._id)).filter((row) => row.to === undefined);
      const hasLead = already.some((row) => row.role === "lead");
      for (const id of offered) {
        if (already.some((row) => row.cleanerId === id)) continue;
        const lead = !hasLead && id === (args.leadId ?? offered[0]);
        await join(ctx, crew, (await ctx.db.get(id))!, lead ? "lead" : "member");
      }
      await coverJob(ctx, job._id);
    }
    const after = staffing((await ctx.db.get(job._id))!, await jobAssignments(ctx, (await ctx.db.get(job._id))!));
    return { results, crewId, staffing: after, words: after.open === 0 ? "Every place is filled." : `${after.open} ${after.open === 1 ? "place is" : "places are"} still without an accepted cleaner; ${after.offersOut} ${after.offersOut === 1 ? "offer is" : "offers are"} out.` };
  },
});
