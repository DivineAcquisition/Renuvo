/**
 * Team Pay: what each cleaner earned on each completed job, worked out by code from the record.
 *
 *  base     the cleaner's pay method (a share, a tier's share, a fixed amount, or an hourly rate) applied
 *           to the job's price or to the minutes paid, with the company's crew rules (split, lead premium)
 *  minutes  worked: check-in to submitting the job complete; else scheduled (flagged); or the Owner's
 *           correction, with its reason
 *  + adjustments the Owner added, each with a reason (a reversed one stays in the history)
 *  + tips   received tips for the job, split evenly across the crew
 *
 * Nothing here guesses. A missing price or pay method leaves the base empty and says why. After the
 * Owner approves, a change that would alter the total sends it back to review; once a payment is
 * started, the earning is frozen and only a later tip is shown as owed on its own.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { jobAssignments } from "../dispatch/facts";
import { money, payFor } from "../dispatch/pay";
import { crewPayOf } from "../dispatch/policy";
import { recordEvent, type Actor } from "../events";

const MINUTE = 60_000;
const SYSTEM: Actor = { kind: "system" };

export function hoursWords(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Minutes from check-in to submitting the job complete. Null when either is missing or it makes no sense. */
export function workedMinutes(assignment: Pick<Doc<"assignments">, "checkIn" | "completion">): number | null {
  const start = assignment.checkIn?.at;
  const end = assignment.completion?.submittedAt;
  if (start === undefined || end === undefined || end <= start) return null;
  const minutes = Math.round((end - start) / MINUTE);
  return minutes >= 1 && minutes <= 16 * 60 ? minutes : null;
}

/** Splits a tip evenly; the cents that don't divide go to the first cleaners in the list, one each. */
export function splitEvenly(cents: number, cleanerIds: Id<"cleaners">[]): { cleanerId: Id<"cleaners">; cents: number }[] {
  if (cleanerIds.length === 0) return [];
  const each = Math.floor(cents / cleanerIds.length);
  const extra = cents - each * cleanerIds.length;
  return cleanerIds.map((cleanerId, i) => ({ cleanerId, cents: each + (i < extra ? 1 : 0) }));
}

export const liveAdjustments = (earning: Pick<Doc<"earnings">, "adjustments">) => earning.adjustments.filter((a) => !a.reversed).reduce((sum, a) => sum + a.cents, 0);

/** The tips received for a job, as cents per cleaner. */
async function tipsByCleaner(ctx: MutationCtx, job: Pick<Doc<"jobs">, "_id" | "companyId">) {
  const tips = await ctx.db
    .query("tips")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(100);
  const out = new Map<string, number>();
  for (const tip of tips) {
    if (tip.status !== "received") continue;
    for (const share of tip.allocations) out.set(share.cleanerId, (out.get(share.cleanerId) ?? 0) + share.cents);
  }
  return out;
}

/** The accepted crew of a job, lead first, in the order they took it. */
export async function jobCrew(ctx: MutationCtx, job: Doc<"jobs">): Promise<Doc<"assignments">[]> {
  return (await jobAssignments(ctx, job)).filter((a) => a.status === "accepted").sort((a, b) => (a.role === "lead" ? -1 : b.role === "lead" ? 1 : (a.respondedAt ?? a.offeredAt) - (b.respondedAt ?? b.offeredAt)));
}

const FROZEN: readonly Doc<"earnings">["status"][] = ["payment_started", "paid"];

/**
 * Works out every crew member's earnings for one job and writes them. Safe to call any number of times:
 * an unchanged job changes nothing. Returns the earnings now on the job.
 */
export async function syncJobEarnings(ctx: MutationCtx, job: Doc<"jobs">, actor: Actor = SYSTEM): Promise<Doc<"earnings">[]> {
  const company = (await ctx.db.get(job.companyId))!;
  const existing = await ctx.db
    .query("earnings")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(50);
  const now = Date.now();
  const crew = job.status === "completed" ? await jobCrew(ctx, job) : [];
  const tips = await tipsByCleaner(ctx, job);
  const rule = crewPayOf(company);
  const scheduled = Math.round((job.endsAt - job.startsAt) / MINUTE);

  // An earning whose assignment is no longer on the crew, or a job no longer completed: set aside unless already being paid.
  for (const earning of existing) {
    if (crew.some((a) => a._id === earning.assignmentId) || earning.status === "void") continue;
    if (FROZEN.includes(earning.status)) continue;
    await ctx.db.patch(earning._id, { status: "void", voidReason: job.status === "completed" ? "The cleaner is no longer on this job." : "The job is no longer completed.", updatedAt: now });
    await recordEvent(ctx, { companyId: job.companyId, type: "earning.voided", actor, subject: { table: "earnings", id: earning._id }, data: { jobId: job._id } });
  }

  for (const assignment of crew) {
    const cleaner = await ctx.db.get(assignment.cleanerId);
    if (!cleaner) continue;
    const current = existing.find((e) => e.assignmentId === assignment._id);
    const tipCents = tips.get(cleaner._id) ?? 0;
    if (current && FROZEN.includes(current.status)) {
      // Being paid or paid: frozen. A tip that came later is shown as owed on its own.
      if (current.tipCents !== tipCents) await ctx.db.patch(current._id, { tipCents, updatedAt: now });
      continue;
    }
    const worked = workedMinutes(assignment);
    const correction = current?.hoursCorrection;
    const paidMinutes = correction?.minutes ?? worked ?? scheduled;
    const source = correction ? "corrected" : worked !== null ? "worked" : "scheduled";
    // The rate this job was first worked out with stays with it; the cleaner's current method is used only the first time.
    const used = current?.payUsed ?? payUsedFor(cleaner, rule.tiers ?? []);
    const answer = payFor({ pay: used ? toSetting(used) : undefined }, { ...job, endsAt: job.startsAt + paidMinutes * MINUTE }, { rule, role: assignment.role ?? "lead" });
    // Hours read as "2 h 15 min" here, the way the Owner and the cleaner see them everywhere in Team Pay.
    const basis = answer.ok && used?.kind === "hourly" ? answer.basis.replace(/for [\d.]+ hours?/, `for ${hoursWords(paidMinutes)}`) : answer.ok ? answer.basis : "";
    const basisWords = answer.ok && used?.kind === "share" && used.tierName ? `${used.tierName} tier, ${basis}` : basis;
    const method: Doc<"earnings">["method"] = !used ? (cleaner.pay?.kind === "tier" ? "tier" : "none") : used.kind === "share" && used.tierName ? "tier" : used.kind;
    const baseCents = answer.ok ? answer.payCents : null;
    const adjustments = current?.adjustments ?? [];
    const adjustmentCents = adjustments.filter((a) => !a.reversed).reduce((s, a) => s + a.cents, 0);
    const totalCents = baseCents === null ? null : baseCents + adjustmentCents + tipCents;

    const flags: string[] = [];
    if (!answer.ok) flags.push(cleaner.pay?.kind === "tier" && !used ? `${cleaner.name} is on a pay tier that no longer exists, so their pay can't be worked out.` : `${cleaner.name} ${answer.reason}.`);
    if (method === "hourly" && source === "scheduled") flags.push("No check-in or completion time, so the scheduled hours were used.");
    if (method === "hourly" && source === "worked" && Math.abs(paidMinutes - scheduled) > Math.max(30, scheduled * 0.25)) flags.push(`Worked ${hoursWords(paidMinutes)}; ${hoursWords(scheduled)} was scheduled.`);
    // An offer of $0 means no amount was recorded with the offer, not that the cleaner agreed to nothing.
    if (answer.ok && method !== "hourly" && assignment.payCents > 0 && Math.abs(answer.payCents - assignment.payCents) >= 100) flags.push(`Offered ${money(assignment.payCents)} when they took the job; it works out to ${money(answer.payCents)} now.`);
    if (job.completionReview?.decision === "closed_without_review") flags.push("The job was closed without a review.");
    if (assignment.completion?.incomplete) flags.push("The cleaner reported the job incomplete.");

    let status: Doc<"earnings">["status"] = baseCents === null || flags.length ? "needs_review" : "calculated";
    let approved = current?.approved;
    if (current?.status === "approved" && current.approved) {
      if (totalCents === current.approved.totalCents) status = "approved";
      else {
        flags.unshift(`Changed after you approved it: ${money(current.approved.totalCents)} then, ${totalCents === null ? "can't be worked out" : money(totalCents)} now. Approve it again.`);
        status = "needs_review";
        approved = undefined;
      }
    }

    const fields = {
      status,
      method,
      basis: answer.ok ? basisWords : "Can't be worked out yet",
      payUsed: answer.ok ? used : current?.payUsed,
      facts: {
        priceCents: job.priceCents ?? null,
        crewSize: Math.max(1, job.requiredCrew ?? 1),
        lead: (assignment.role ?? "lead") === "lead",
        scheduledMinutes: scheduled,
        workedMinutes: worked,
        paidMinutes,
        minutesSource: source,
        offeredCents: assignment.payCents,
        checkInAt: assignment.checkIn?.at ?? null,
        completedAt: assignment.completion?.submittedAt ?? null,
      } as Doc<"earnings">["facts"],
      baseCents,
      tipCents,
      totalCents,
      flags,
      approved,
      jobStartsAt: job.startsAt,
    };
    if (!current) {
      const id = await ctx.db.insert("earnings", { companyId: job.companyId, cleanerId: cleaner._id, jobId: job._id, assignmentId: assignment._id, adjustments: [], createdAt: now, updatedAt: now, ...fields });
      await recordEvent(ctx, { companyId: job.companyId, type: "earning.calculated", actor, subject: { table: "earnings", id }, data: { amountCents: totalCents, jobId: job._id, cleanerId: cleaner._id } });
      continue;
    }
    const changed =
      current.status !== status || current.totalCents !== totalCents || current.basis !== fields.basis || JSON.stringify(current.flags) !== JSON.stringify(flags) || JSON.stringify(current.facts) !== JSON.stringify(fields.facts);
    if (!changed) continue;
    await ctx.db.patch(current._id, { ...fields, updatedAt: now });
    if (current.status === "approved" && status === "needs_review") {
      await recordEvent(ctx, { companyId: job.companyId, type: "earning.reopened", actor, subject: { table: "earnings", id: current._id }, data: { amountCents: totalCents } });
    }
  }
  return ctx.db
    .query("earnings")
    .withIndex("by_company_job", (q) => q.eq("companyId", job.companyId).eq("jobId", job._id))
    .take(50);
}

type PayUsed = NonNullable<Doc<"earnings">["payUsed"]>;

/** The cleaner's pay method resolved to numbers, as it is right now. Undefined when there is none to use. */
export function payUsedFor(cleaner: Pick<Doc<"cleaners">, "pay">, tiers: readonly { id: string; name: string; shareBps: number }[]): PayUsed | undefined {
  const pay = cleaner.pay;
  if (!pay) return undefined;
  if (pay.kind === "tier") {
    const tier = tiers.find((t) => t.id === pay.tierId);
    return tier ? { kind: "share", shareBps: tier.shareBps, tierName: tier.name } : undefined;
  }
  if (pay.kind === "share") return { kind: "share", shareBps: pay.shareBps };
  return pay;
}

function toSetting(used: PayUsed) {
  return used.kind === "share" ? { kind: "share" as const, shareBps: used.shareBps } : used;
}

/** What is still owed on an earning: the approved total not yet paid, plus any tip that arrived after paying started. */
export function owedOn(earning: Doc<"earnings">): { jobCents: number; lateTipCents: number } {
  if (earning.status === "approved") return { jobCents: earning.totalCents ?? 0, lateTipCents: 0 };
  if (earning.status === "payment_started" || earning.status === "paid") return { jobCents: 0, lateTipCents: Math.max(0, earning.tipCents - (earning.tipsPaidCents ?? 0)) };
  return { jobCents: 0, lateTipCents: 0 };
}
