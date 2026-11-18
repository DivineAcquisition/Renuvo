/**
 * A pipeline opportunity as the Sales agent works it, and the agent's way of moving it.
 *
 * The pipeline has one record per deal (salesOpportunities) with a stage (new, qualifying, quoting,
 * won, lost) and a milestone inside it. The agent reasons in finer steps (quote ready, quote sent,
 * booking pending, deferred). Those are read from the stage and milestone here (`agentStage`) and
 * written back the same way (`setStage`), so a person moving a card and the agent moving a deal always
 * agree, and nothing is stored twice.
 *
 * A stage has an entry condition, checked in code whoever asks. "Won" is never set from here by hand: it
 * follows a confirmed booking (convex/bookings.ts calls `bookingConfirmed`).
 *
 * Every open opportunity the agent works has exactly one next step, with who owes it and by when, and one
 * task that says the same thing to the rest of the product (Home, the team console, Approvals).
 *
 * A person "taking over" is the pipeline's own: follow-ups paused, the deal theirs. The agent then sends
 * and schedules nothing until it is handed back.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { notFound, userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { quiet } from "./actions";
import { enqueueRun } from "./runs";
import { OPEN_STAGES, type Fact, type LostReason, type NextAction, type NextBy, type ServiceKind, type Stage } from "./agentSchema";
import type { Milestone, Segment } from "./schema";

export const SALES: Actor = { kind: "agent", agent: "sales" };
export const SYSTEM: Actor = { kind: "system" };
export const taskKey = (opportunityId: Id<"salesOpportunities">) => `sales.opportunity:${opportunityId}`;

const HOUR = 60 * 60_000;

export const STAGE_WORDS: Record<Stage, string> = {
  new: "New",
  qualifying: "Qualifying",
  quote_ready: "Quote ready",
  quote_sent: "Quote sent",
  booking_pending: "Booking pending",
  won: "Won",
  deferred: "Deferred",
  closed_lost: "Closed lost",
};

export const STAGE_CHANGES: Record<Stage, readonly Stage[]> = {
  new: ["qualifying", "quote_ready", "deferred", "closed_lost"],
  qualifying: ["quote_ready", "deferred", "closed_lost"],
  quote_ready: ["quote_sent", "qualifying", "deferred", "closed_lost"],
  quote_sent: ["booking_pending", "quote_ready", "qualifying", "deferred", "closed_lost"],
  booking_pending: ["won", "quote_ready", "deferred", "closed_lost"],
  won: [],
  deferred: ["new", "qualifying", "quote_ready", "quote_sent", "closed_lost"],
  closed_lost: ["new", "qualifying"],
};

export const isOpen = (stage: Stage) => OPEN_STAGES.includes(stage);

/** Milestones that mean the customer said yes and the booking is being finished. */
const BOOKING_MILESTONES: readonly Milestone[] = ["booking_requested", "proposal_accepted", "agreement_pending", "billing_pending", "ready_to_schedule", "service_activated"];

/** The agent's stage, read from the pipeline's stage and milestone. */
export function agentStage(row: Pick<Doc<"salesOpportunities">, "stage" | "milestone">): Stage {
  if (row.stage === "won") return "won";
  if (row.stage === "lost") return "closed_lost";
  if (row.milestone === "deferred") return "deferred";
  if (row.stage === "new") return "new";
  if (row.stage === "qualifying") return "qualifying";
  if (row.milestone === "quote_sent") return "quote_sent";
  if (row.milestone && BOOKING_MILESTONES.includes(row.milestone)) return "booking_pending";
  return "quote_ready";
}

export const KIND_OF_SEGMENT: Record<Segment, ServiceKind> = { residential: "residential", commercial: "commercial", office: "commercial", str: "short_term_rental" };
export const SEGMENT_OF_KIND: Record<ServiceKind, Segment> = { residential: "residential", commercial: "commercial", short_term_rental: "str" };

/**
 * One opportunity as the agent reads it: its stage in the agent's terms, its facts and questions, who is
 * holding it. Built from the stored row every time; never written back as is.
 */
export type Opp = Omit<Doc<"salesOpportunities">, "customerId"> & {
  customerId: Id<"customers">;
  agent: {
    stage: Stage;
    facts: Fact[];
    asked: { key: string; at: number; times: number }[];
    kind: ServiceKind;
    channel: "sms" | "email";
    revision: number;
    humanTouches: number;
    /** Set while a person holds the conversation. */
    takeover: { by: Id<"members"> | null; at: number } | null;
    next: NextAction | null;
    match: "created" | "matched" | "needs_review";
  };
};

export function view(row: Doc<"salesOpportunities">): Opp | null {
  if (!row.customerId) return null;
  return {
    ...row,
    customerId: row.customerId,
    agent: {
      stage: agentStage(row),
      facts: row.facts ?? [],
      asked: row.asked ?? [],
      kind: row.kind ?? KIND_OF_SEGMENT[row.segment],
      channel: row.channel ?? "sms",
      revision: row.revision ?? 0,
      humanTouches: row.humanTouches ?? 0,
      takeover: row.followUps === "paused" ? { by: row.ownerMemberId ?? null, at: row.updatedAt } : null,
      next: row.nextAction ? { what: row.nextAction, by: (row.nextBy ?? "owner") as NextBy, dueAt: row.nextActionAt ?? row.updatedAt } : null,
      match: row.match?.state ?? "matched",
    },
  };
}

/** The opportunity as the agent reads it now. Throws when it has gone or has no customer. */
export async function load(ctx: QueryCtx | MutationCtx, opportunityId: Id<"salesOpportunities">): Promise<Opp> {
  const row = await ctx.db.get(opportunityId);
  const out = row ? view(row) : null;
  if (!out) throw new Error("The opportunity has no customer.");
  return out;
}

export async function ownedOpportunity(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">, opportunityId: Id<"salesOpportunities">): Promise<Opp> {
  const row = await ctx.db.get(opportunityId);
  const out = row && row.companyId === companyId ? view(row) : null;
  if (!out) notFound();
  return out;
}

export async function currentQuote(ctx: QueryCtx | MutationCtx, opportunity: Pick<Opp, "companyId" | "quoteId">): Promise<Doc<"salesQuotes"> | null> {
  const quote = opportunity.quoteId ? await ctx.db.get(opportunity.quoteId) : null;
  return quote && quote.companyId === opportunity.companyId ? quote : null;
}

/** Why the opportunity cannot enter this stage right now, or null when it can. */
export async function entryProblem(ctx: QueryCtx | MutationCtx, opportunity: Opp, to: Stage): Promise<string | null> {
  const from = opportunity.agent.stage;
  if (to === from) return null;
  if (!STAGE_CHANGES[from].includes(to)) return `An opportunity that is ${STAGE_WORDS[from].toLowerCase()} cannot move straight to ${STAGE_WORDS[to].toLowerCase()}.`;
  const quote = await currentQuote(ctx, opportunity);
  if (to === "quote_ready" && (!quote || quote.status === "withdrawn" || quote.status === "expired" || quote.status === "declined" || quote.status === "superseded")) return "Quote ready needs a priced quote. Prepare one first.";
  if (to === "quote_sent" && (!quote || quote.status !== "sent")) return "Quote sent means the customer has the quote. Send it, and the stage follows.";
  if (to === "booking_pending" && (!quote || quote.status !== "accepted")) return "Booking pending means the customer accepted the quote that was sent. They accept on the quote's page.";
  if (to === "won") return "Won means the booking is confirmed. It follows the booking.";
  return null;
}

export type StageExtra = { reason?: LostReason; note?: string; deferredUntil?: number };

/** Where a stage of the agent's lands in the pipeline. */
function pipelinePlace(opportunity: Opp, to: Stage): { stage: Doc<"salesOpportunities">["stage"]; milestone: Milestone | undefined } {
  switch (to) {
    case "new":
      return { stage: "new", milestone: undefined };
    case "qualifying":
      return { stage: "qualifying", milestone: undefined };
    case "quote_ready":
      return { stage: "quoting", milestone: "quote_saved" };
    case "quote_sent":
      return { stage: "quoting", milestone: "quote_sent" };
    case "booking_pending":
      return { stage: "quoting", milestone: "booking_requested" };
    case "won":
      return { stage: "won", milestone: opportunity.milestone };
    case "deferred":
      // Parked where it was. The milestone says it is waiting for a date.
      return { stage: opportunity.stage === "won" || opportunity.stage === "lost" ? "qualifying" : opportunity.stage, milestone: "deferred" };
    case "closed_lost":
      return { stage: "lost", milestone: opportunity.milestone === "deferred" ? undefined : opportunity.milestone };
  }
}

const LOST_WORDS: Record<LostReason, string> = {
  price: "Price",
  timing: "Timing",
  no_response: "No response",
  out_of_area: "Outside the service area",
  unsupported_service: "A service the company does not offer",
  chose_another: "Chose another company",
  duplicate: "Duplicate",
  spam: "Spam",
  opted_out: "Asked not to be contacted",
  other: "Other",
};

/**
 * Moves an opportunity to a stage whose entry condition holds, and writes the measured moment the first
 * time it happens. Entering "won" is only for a confirmed booking, which passes `booked`.
 */
export async function setStage(ctx: MutationCtx, opportunity: Opp, to: Stage, actor: Actor, extra: StageExtra & { booked?: boolean } = {}): Promise<Opp> {
  if (to === opportunity.agent.stage) return opportunity;
  const problem = to === "won" && extra.booked ? null : await entryProblem(ctx, opportunity, to);
  if (problem) throw userError(problem);
  const now = Date.now();
  if (to === "closed_lost" && !extra.reason) throw userError("Say why it was lost.");
  if (to === "deferred" && (!extra.deferredUntil || extra.deferredUntil <= now)) throw userError("Choose the date to pick this back up.");
  const place = pipelinePlace(opportunity, to);
  const patch: Partial<Doc<"salesOpportunities">> = { stage: place.stage, milestone: place.milestone, updatedAt: now, revision: opportunity.agent.revision + 1 };
  if (to === "quote_ready" && opportunity.qualifiedAt === undefined) patch.qualifiedAt = now;
  if (to === "quote_sent" && opportunity.quotedAt === undefined) patch.quotedAt = now;
  if (to === "booking_pending" && opportunity.acceptedAt === undefined) patch.acceptedAt = now;
  if (to === "won") {
    patch.wonAt = now;
    patch.closedAt = now;
    patch.followUps = "stopped";
    patch.nextAction = undefined;
    patch.nextActionAt = undefined;
    patch.nextBy = undefined;
  }
  if (to === "closed_lost") {
    patch.closedAt = now;
    patch.lostReason = extra.reason;
    patch.closedReason = `${LOST_WORDS[extra.reason!]}${extra.note ? `: ${extra.note}` : ""}`.slice(0, 300);
    patch.followUps = "stopped";
    patch.nextAction = undefined;
    patch.nextActionAt = undefined;
    patch.nextBy = undefined;
  }
  if (to === "deferred") patch.deferredUntil = extra.deferredUntil;
  // Reopening clears the outcome it had. What happened stays in the history.
  if (isOpen(to) && (opportunity.agent.stage === "deferred" || opportunity.agent.stage === "closed_lost")) {
    patch.deferredUntil = undefined;
    patch.closedAt = undefined;
    patch.lostReason = undefined;
    patch.closedReason = undefined;
    if (opportunity.followUps === "stopped") patch.followUps = "on";
  }
  await ctx.db.patch(opportunity._id, patch);
  await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.stage_changed", actor, subject: { table: "salesOpportunities", id: opportunity._id }, data: { from: opportunity.agent.stage, to, ...(extra.reason ? { reason: extra.reason } : {}) } });
  const next = await load(ctx, opportunity._id);
  await syncTask(ctx, next, actor);
  return next;
}

/** Sets the one next step: what, who owes it, and by when. */
export async function setNext(ctx: MutationCtx, opportunity: Opp, next: NextAction | null, actor: Actor = SALES): Promise<Opp> {
  const current = opportunity.agent.next;
  const same = (current === null && next === null) || (current && next && current.what === next.what && current.by === next.by && current.dueAt === next.dueAt);
  if (!same) await ctx.db.patch(opportunity._id, next ? { nextAction: next.what.slice(0, 300), nextBy: next.by, nextActionAt: next.dueAt, updatedAt: Date.now() } : { nextAction: undefined, nextBy: undefined, nextActionAt: undefined, updatedAt: Date.now() });
  const fresh = await load(ctx, opportunity._id);
  await syncTask(ctx, fresh, actor);
  return fresh;
}

/**
 * Keeps the opportunity's one task saying what the opportunity says. The agent acting: open. Waiting on
 * the customer: waiting, with the follow-up time. With a person: needs a decision. Won or lost: closed
 * with the outcome. Running it twice changes nothing the second time.
 */
export async function syncTask(ctx: MutationCtx, opportunity: Opp, actor: Actor = SALES): Promise<void> {
  const key = taskKey(opportunity._id);
  let task = await liveTaskByKey(ctx, opportunity.companyId, key);
  const customer = await ctx.db.get(opportunity.customerId);
  const name = customer?.name ?? "A prospect";
  const now = Date.now();
  const stage = opportunity.agent.stage;
  if (stage === "won" || stage === "closed_lost") {
    if (task) await setTaskState(ctx, task, "done", { outcome: stage === "won" ? "Booked: the booking was confirmed and handed to Dispatch." : `Closed without a booking${opportunity.lostReason ? `: ${LOST_WORDS[opportunity.lostReason].toLowerCase()}` : ""}.`, closedAt: now, withPersonSince: null }, actor);
    return;
  }
  const next: NextAction = opportunity.agent.next ?? (stage === "deferred" ? { what: "Pick this back up on the date the customer asked for", by: "sales", dueAt: opportunity.deferredUntil ?? now + 24 * HOUR } : { what: "Review this inquiry and decide the next step", by: "sales", dueAt: now + HOUR });
  if (!task) {
    const taskId = await openTask(ctx, { companyId: opportunity.companyId, agent: "sales", title: `${name}: ${STAGE_WORDS[stage].toLowerCase()}`, nextAction: next.what, dueAt: next.dueAt, completionCondition: "A confirmed booking, a clear decline, or a documented next step with an owner and a time.", about: { table: "salesOpportunities", id: opportunity._id }, key, actor });
    await ctx.db.patch(opportunity._id, { taskId });
    task = (await ctx.db.get(taskId))!;
  }
  const held = opportunity.agent.takeover !== null;
  if (next.by === "owner" || held) {
    await setTaskState(ctx, task, "needs_decision", { openQuestion: held ? `You are handling this conversation. Sales sends nothing until you hand it back. ${next.what}`.slice(0, 1000) : next.what, dueAt: next.dueAt, withPersonSince: task.withPersonSince ?? now }, actor, { sameStatus: true });
  } else if (next.by === "customer") {
    await setTaskState(ctx, task, "waiting", { waitingOn: "customer", followUpAt: next.dueAt, dueAt: next.dueAt, withPersonSince: null }, actor, { sameStatus: true });
  } else {
    await setTaskState(ctx, task, "open", { nextAction: next.what, dueAt: next.dueAt, withPersonSince: null }, actor, { sameStatus: true });
  }
}

/** What needs a person's eye, apart from the stage. Worked out from the record every time; never stored. */
export type Attention = "needs_review" | "taken_over" | "blocked" | "waiting_reply" | "scheduled" | "working" | "none";

export const ATTENTION_WORDS: Record<Attention, string> = {
  needs_review: "Needs your review",
  taken_over: "You are handling it",
  blocked: "Blocked",
  waiting_reply: "Waiting for a reply",
  scheduled: "Follow-up scheduled",
  working: "Sales is working",
  none: "",
};

export function attentionOf(opportunity: Opp, facts: { pendingForOwner: boolean; running: boolean; blocked: boolean; followUpAt: number | null }): Attention {
  if (!isOpen(opportunity.agent.stage)) return "none";
  if (opportunity.agent.takeover) return "taken_over";
  if (facts.running) return "working";
  if (facts.pendingForOwner || opportunity.agent.next?.by === "owner" || opportunity.agent.match === "needs_review") return "needs_review";
  if (facts.blocked) return "blocked";
  if (opportunity.agent.next?.by === "customer") return facts.followUpAt !== null ? "scheduled" : "waiting_reply";
  return "none";
}

/** Bumps the revision: something material changed, so work prepared earlier is checked again before it goes. */
export async function bump(ctx: MutationCtx, opportunity: Opp, patch: Partial<Doc<"salesOpportunities">> = {}): Promise<Opp> {
  await ctx.db.patch(opportunity._id, { ...patch, revision: opportunity.agent.revision + 1, updatedAt: Date.now() });
  return load(ctx, opportunity._id);
}

/** Whether the agent works this deal: it came in as an inquiry, or a person handed it to the agent. */
export function agentWorks(row: Pick<Doc<"salesOpportunities">, "intake">): boolean {
  return row.intake !== undefined;
}

/**
 * A person takes the conversation: the pipeline's follow-ups pause, the deal is theirs, and everything the
 * agent had planned or drafted stops in the same step.
 */
export async function takeOverConversation(ctx: MutationCtx, opportunity: Opp, member: Doc<"members">): Promise<Opp> {
  if (opportunity.agent.takeover) return opportunity;
  const now = Date.now();
  const actor: Actor = { kind: "member", memberId: member._id };
  await quiet(ctx, opportunity, "A person took over the conversation.", actor);
  await ctx.db.patch(opportunity._id, { followUps: "paused", ownerMemberId: member._id, humanTouches: opportunity.agent.humanTouches + 1, revision: opportunity.agent.revision + 1, updatedAt: now });
  await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.taken_over", actor, subject: { table: "salesOpportunities", id: opportunity._id } });
  return setNext(ctx, await load(ctx, opportunity._id), { what: "Reply to the customer, then hand the conversation back to the agent when you are done.", by: "owner", dueAt: now + 4 * HOUR }, actor);
}

/** The customer's last word, if nobody has answered it since. A run that picks work back up reads it first. */
export async function unansweredMessage(ctx: MutationCtx, opportunity: Pick<Opp, "_id" | "companyId">): Promise<Doc<"salesMessages"> | null> {
  const last = await ctx.db
    .query("salesMessages")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .order("desc")
    .first();
  return last && last.direction === "in" && last.author.kind === "customer" ? last : null;
}

/** Hands the conversation back. The agent reads where things stand now and takes the next step under its permissions. */
export async function handBackConversation(ctx: MutationCtx, opportunity: Opp, member: Doc<"members">): Promise<Opp> {
  if (!opportunity.agent.takeover) return opportunity;
  const actor: Actor = { kind: "member", memberId: member._id };
  await ctx.db.patch(opportunity._id, { followUps: "on", revision: opportunity.agent.revision + 1, updatedAt: Date.now() });
  await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.handed_back", actor, subject: { table: "salesOpportunities", id: opportunity._id } });
  const fresh = await setNext(ctx, await load(ctx, opportunity._id), { what: "Pick the conversation back up", by: "sales", dueAt: Date.now() }, actor);
  if (isOpen(fresh.agent.stage) || fresh.agent.stage === "deferred") {
    const unanswered = await unansweredMessage(ctx, fresh);
    await enqueueRun(ctx, fresh, unanswered ? { trigger: "reply", key: `resume:${fresh._id}:${fresh.agent.revision}`, messageId: unanswered._id } : { trigger: "resume", key: `resume:${fresh._id}:${fresh.agent.revision}` });
  }
  return fresh;
}
