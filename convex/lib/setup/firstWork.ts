/**
 * "Your first work": where the owner lands after setup. Every number here is counted from records at the
 * moment it is read: work prepared, work waiting for a decision, messages agents actually sent since setup
 * began, and what still blocks the chosen priority. Nothing is estimated.
 *
 * Also the two setup milestones that are only knowable from what happened elsewhere: the first decision
 * on an agent's work, and the first message an agent actually sent.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { QueryCtx } from "../../_generated/server";
import { salesSettings } from "../sales/settings";
import { agentReadiness } from "./readiness";

/** Decisions on agent work: the Sales first batch, and any approval decided either way. */
export const REVIEW_EVENTS = ["sales.first_batch_decided", "approval.approved", "approval.changed", "approval.skipped"] as const;
/** A message that left Selestial, or is leaving now. Held and refused messages are not actions taken. */
const WENT_OUT = new Set(["sending", "sent", "delivered", "unconfirmed"]);

export async function firstDecisionAt(ctx: QueryCtx, companyId: Id<"companies">, since: number): Promise<number | null> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_company_at", (q) => q.eq("companyId", companyId).gte("at", since))
    .take(2000);
  const found = events.find((event) => (REVIEW_EVENTS as readonly string[]).includes(event.type));
  return found ? found.at : null;
}

export async function agentMessagesSince(ctx: QueryCtx, companyId: Id<"companies">, since: number): Promise<Doc<"messages">[]> {
  const rows = await ctx.db
    .query("messages")
    .withIndex("by_company_queued", (q) => q.eq("companyId", companyId).gte("queuedAt", since))
    .take(2000);
  return rows.filter((row) => row.draftedBy === "agent" && WENT_OUT.has(row.status));
}

export type FirstWork = Awaited<ReturnType<typeof firstWork>>;

export async function firstWork(ctx: QueryCtx, company: Doc<"companies">, setup: Doc<"companySetups">) {
  const companyId = company._id;
  const since = setup.milestones.startedAt;

  // Prepared: setup's own drafts, and each agent's first-work review that found something.
  const prepared: { label: string; detail: string; href: string }[] = [];
  const p = setup.prepared ?? {};
  const service = p.serviceId ? await ctx.db.get(p.serviceId) : null;
  if (service) prepared.push({ label: `Service draft: ${service.name}`, detail: service.status === "active" ? "Published." : "A draft to review before it is published.", href: `/app/services/${service._id}` });
  const agreement = p.agreementId ? await ctx.db.get(p.agreementId) : null;
  if (agreement) prepared.push({ label: `Agreement draft: ${agreement.title}`, detail: "A draft nobody has reviewed or approved.", href: `/app/agreements/${agreement._id}` });
  const booking = p.experienceId ? await ctx.db.get(p.experienceId) : null;
  if (booking) prepared.push({ label: `Booking page: ${booking.name}`, detail: booking.status === "published" ? "Published." : "A draft; it takes no bookings until published.", href: `/app/agents/sales/booking-forms/${booking._id}` });
  const need = p.hiringNeedId ? await ctx.db.get(p.hiringNeedId) : null;
  if (need) prepared.push({ label: `Hiring brief: ${need.title}`, detail: need.status === "open" ? "Open: taking applications." : "Paused until you open it.", href: "/app/agents/recruiter/hiring-needs" });
  const reviews: { agent: Doc<"setupWork">["agent"]; title: string; summary: string; next: { words: string; href: string } }[] = [];
  for (const agent of ["sales", "recruiter", "dispatch", "retention"] as const) {
    const row = await ctx.db
      .query("setupWork")
      .withIndex("by_company_agent", (q) => q.eq("companyId", companyId).eq("agent", agent))
      .order("desc")
      .first();
    if (row?.status === "ready_for_review" && row.result) reviews.push({ agent, title: row.result.title, summary: row.result.summary, next: row.result.next });
  }

  // Waiting for a decision: Sales's first batch before it is decided, and every pending approval.
  const firstBatchOpen = salesSettings(company).firstBatchDecidedAt === null;
  const batch = firstBatchOpen
    ? (
        await ctx.db
          .query("salesActions")
          .withIndex("by_company_status", (q) => q.eq("companyId", companyId).eq("status", "prepared"))
          .take(200)
      ).length
    : 0;
  const approvals = (
    await ctx.db
      .query("approvals")
      .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", companyId).eq("status", "pending"))
      .take(500)
  ).length;

  // Actually started: messages agents sent since setup began.
  const sent = await agentMessagesSince(ctx, companyId, since);

  // What still blocks the chosen priority's agent (or, with no agent priority, each agent's first gap).
  const readiness = await agentReadiness(ctx, company);
  const agentFor: Record<string, Doc<"setupWork">["agent"] | null> = { sales: "sales", dispatch: "dispatch", recruiter: "recruiter", retention: "retention", pricing: null, booking: null };
  const focus = setup.priority ? agentFor[setup.priority] : null;
  const blockers = (focus ? readiness.filter((r) => r.agent === focus).flatMap((r) => r.gaps) : readiness.flatMap((r) => r.gaps.slice(0, 1)))
    .slice(0, 3)
    // A service drafted in setup is the way past "no published service": point at it, not at starting another.
    .map((gap) => (service && service.status !== "active" && /service is published/i.test(gap.words) ? { words: gap.words, next: `Review and publish ${service.name}`, href: `/app/services/${service._id}` } : { words: gap.words, next: gap.next, href: gap.href }));

  // One next step, in order: decisions waiting, then the priority's own next step, then its first blocker.
  const focusReview = reviews.find((r) => r.agent === focus);
  const next =
    batch > 0
      ? { words: `Review the ${batch === 1 ? "message" : `${batch} messages`} Sales prepared`, href: "/app/agents/sales" }
      : approvals > 0
        ? { words: `Decide ${approvals === 1 ? "1 item" : `${approvals} items`} waiting for your approval`, href: "/app/approvals" }
        : focusReview
          ? focusReview.next
          : blockers[0]
            ? { words: blockers[0].next, href: blockers[0].href }
            : prepared[0]
              ? { words: `Open ${prepared[0].label.toLowerCase()}`, href: prepared[0].href }
              : { words: "Open your workspace", href: "/app" };

  return {
    priority: setup.priority ?? null,
    prepared,
    reviews,
    waiting: { firstBatch: batch, approvals },
    started: { messages: sent.length },
    blockers,
    next,
  };
}
