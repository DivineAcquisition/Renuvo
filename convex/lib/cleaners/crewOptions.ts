/**
 * Who can take this job, checked one by one with Dispatch's rules, and how each permanent crew fares when its
 * members are checked the same way. A crew is never assumed free because it is a crew. The crews page and
 * Chat both read this.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { staffing } from "../dispatch/crew";
import { assess, DISPATCH_RULES, type Exclusion } from "../dispatch/eligibility";
import { cleanerFacts, jobAssignments, jobFacts, jobHistory } from "../dispatch/facts";
import { personRules } from "../dispatch/offers";
import { isOwner, type Role } from "../roles";
import { STATUS_WORDS } from "./enroll";
import { companyFacts, initialsOf } from "./records";
import { jobLabel } from "./schedule";

/** Soft reasons a person may set aside when offering by hand. Every other reason stands for everyone. */
const SOFT: Exclusion["code"][] = ["outside_area", "no_pay"];

type Ctx = (QueryCtx | MutationCtx) & { companyId: Id<"companies">; company: Doc<"companies">; role: Role };

export async function crewOptionsForJob(ctx: Ctx, job: Doc<"jobs">) {
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
}
