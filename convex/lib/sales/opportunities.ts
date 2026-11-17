/**
 * An opportunity's stage, its next step and its task, for people and for Sales alike.
 *
 * A stage has an entry condition, checked in code whoever asks: a card dragged to "Quote sent" with no
 * quote sent is refused in the same words Sales would be. "Won" is never set from here: it is written
 * only in the step that makes the job (booking.ts), so nothing can reach it around the booking checks.
 *
 * Every open opportunity has exactly one next step, with who owes it and by when, and one task that
 * says the same thing to the rest of the product (Home, the team console, Approvals).
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { notFound, userError } from "../errors";
import { recordEvent, type Actor } from "../events";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { OPEN_STAGES, type LostReason, type NextAction, type Stage } from "./schema";

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

/** What must be true to enter each stage, in a sentence the board shows. */
export const ENTRY_WORDS: Record<Stage, string> = {
  new: "An inquiry arrived and nothing has been asked or answered yet.",
  qualifying: "Sales or a person is gathering what the price and schedule need.",
  quote_ready: "Everything the price needs is known and a priced quote exists.",
  quote_sent: "A quote was sent to the customer.",
  booking_pending: "The customer accepted the quote that was sent. The booking is not confirmed yet.",
  won: "A job was created after every booking requirement was met.",
  deferred: "Parked until a date, with a reason.",
  closed_lost: "Closed without a booking, with the reason.",
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

type Ctx = QueryCtx | MutationCtx;

export async function currentQuote(ctx: Ctx, opportunity: Doc<"salesOpportunities">): Promise<Doc<"salesQuotes"> | null> {
  const quote = opportunity.quoteId ? await ctx.db.get(opportunity.quoteId) : null;
  return quote && quote.companyId === opportunity.companyId ? quote : null;
}

/** Why the opportunity cannot enter this stage right now, or null when it can. */
export async function entryProblem(ctx: Ctx, opportunity: Doc<"salesOpportunities">, to: Stage): Promise<string | null> {
  if (to === opportunity.stage) return null;
  if (!STAGE_CHANGES[opportunity.stage].includes(to)) return `An opportunity that is ${STAGE_WORDS[opportunity.stage].toLowerCase()} cannot move straight to ${STAGE_WORDS[to].toLowerCase()}.`;
  const quote = await currentQuote(ctx, opportunity);
  if (to === "quote_ready") {
    if (!quote || quote.status === "revoked" || quote.status === "expired" || quote.status === "declined") return "Quote ready needs a priced quote. Prepare one first.";
  }
  if (to === "quote_sent" && (!quote || quote.status !== "sent")) return "Quote sent means the customer has the quote. Send it from the quote, and the stage follows.";
  if (to === "booking_pending" && (!quote || quote.status !== "accepted" || quote.acceptance?.version !== quote.sentVersion)) return "Booking pending means the customer accepted the quote that was sent. They accept on the quote's page.";
  if (to === "won") return "Won means a job exists. Confirm the booking from the opportunity: it checks every requirement and capacity first.";
  return null;
}

export type StageExtra = { reason?: LostReason; note?: string; deferredUntil?: number };

/**
 * Moves an opportunity to a stage whose entry condition holds, and writes the measured moment the first
 * time it happens. Entering "won" is only for booking.ts, which passes `booked`.
 */
export async function setStage(ctx: MutationCtx, opportunity: Doc<"salesOpportunities">, to: Stage, actor: Actor, extra: StageExtra & { booked?: boolean } = {}): Promise<Doc<"salesOpportunities">> {
  if (to === opportunity.stage) return opportunity;
  const problem = to === "won" && extra.booked ? null : await entryProblem(ctx, opportunity, to);
  if (problem) throw userError(problem);
  const now = Date.now();
  if (to === "closed_lost" && !extra.reason) throw userError("Say why it was lost.");
  if (to === "deferred" && (!extra.deferredUntil || extra.deferredUntil <= now)) throw userError("Choose the date to pick this back up.");
  const patch: Partial<Doc<"salesOpportunities">> = { stage: to, stageAt: now, updatedAt: now, revision: opportunity.revision + 1 };
  if (to === "quote_ready" && opportunity.qualifiedAt === undefined) patch.qualifiedAt = now;
  if (to === "quote_sent" && opportunity.quotedAt === undefined) patch.quotedAt = now;
  if (to === "booking_pending" && opportunity.acceptedAt === undefined) patch.acceptedAt = now;
  if (to === "won") {
    patch.wonAt = now;
    patch.closedAt = now;
    patch.outcome = { kind: "won", at: now, by: actor };
  }
  if (to === "closed_lost") {
    patch.closedAt = now;
    patch.outcome = { kind: "lost", reason: extra.reason, note: extra.note?.slice(0, 500), at: now, by: actor };
    patch.nextAction = undefined;
  }
  if (to === "deferred") {
    patch.deferredUntil = extra.deferredUntil;
    patch.outcome = { kind: "deferred", note: extra.note?.slice(0, 500), at: now, by: actor };
  }
  // Reopening clears the outcome it had. What happened stays in the history.
  if (isOpen(to) && (opportunity.stage === "deferred" || opportunity.stage === "closed_lost")) {
    patch.outcome = undefined;
    patch.deferredUntil = undefined;
    patch.closedAt = undefined;
  }
  await ctx.db.patch(opportunity._id, patch);
  await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.stage_changed", actor, subject: { table: "salesOpportunities", id: opportunity._id }, data: { from: opportunity.stage, to, ...(extra.reason ? { reason: extra.reason } : {}) } });
  const next = (await ctx.db.get(opportunity._id))!;
  await syncTask(ctx, next, actor);
  return next;
}

/** Sets the one next step: what, who owes it, and by when. */
export async function setNext(ctx: MutationCtx, opportunity: Doc<"salesOpportunities">, next: NextAction | null, actor: Actor = SALES): Promise<Doc<"salesOpportunities">> {
  const same = (opportunity.nextAction ?? null) === next || (opportunity.nextAction && next && opportunity.nextAction.what === next.what && opportunity.nextAction.by === next.by && opportunity.nextAction.dueAt === next.dueAt);
  if (!same) await ctx.db.patch(opportunity._id, { nextAction: next ? { what: next.what.slice(0, 300), by: next.by, dueAt: next.dueAt } : undefined, updatedAt: Date.now() });
  const fresh = (await ctx.db.get(opportunity._id))!;
  await syncTask(ctx, fresh, actor);
  return fresh;
}

/**
 * Keeps the opportunity's one task saying what the opportunity says. Sales acting: open. Waiting on the
 * customer: waiting, with the follow-up time. With the owner: needs a decision. Won or lost: closed
 * with the outcome. Running it twice changes nothing the second time.
 */
export async function syncTask(ctx: MutationCtx, opportunity: Doc<"salesOpportunities">, actor: Actor = SALES): Promise<void> {
  const key = taskKey(opportunity._id);
  let task = await liveTaskByKey(ctx, opportunity.companyId, key);
  const customer = await ctx.db.get(opportunity.customerId);
  const name = customer?.name ?? "A prospect";
  const now = Date.now();
  if (opportunity.stage === "won" || opportunity.stage === "closed_lost") {
    if (task) await setTaskState(ctx, task, "done", { outcome: opportunity.stage === "won" ? "Booked: a job was created and handed to Dispatch." : `Closed without a booking${opportunity.outcome?.reason ? `: ${opportunity.outcome.reason.replace(/_/g, " ")}` : ""}.`, closedAt: now, withPersonSince: null }, actor);
    return;
  }
  const next: NextAction = opportunity.nextAction ?? (opportunity.stage === "deferred" ? { what: "Pick this back up on the date the customer asked for", by: "sales", dueAt: opportunity.deferredUntil ?? now + 24 * HOUR } : { what: "Review this inquiry and decide the next step", by: "sales", dueAt: now + HOUR });
  if (!task) {
    const taskId = await openTask(ctx, { companyId: opportunity.companyId, agent: "sales", title: `${name}: ${STAGE_WORDS[opportunity.stage].toLowerCase()}`, nextAction: next.what, dueAt: next.dueAt, completionCondition: "A confirmed booking, a clear decline, or a documented next step with an owner and a time.", about: { table: "salesOpportunities", id: opportunity._id }, key, actor });
    await ctx.db.patch(opportunity._id, { taskId });
    task = (await ctx.db.get(taskId))!;
  }
  const held = opportunity.takeover !== undefined;
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

export function attentionOf(opportunity: Doc<"salesOpportunities">, facts: { pendingForOwner: boolean; running: boolean; blocked: boolean; followUpAt: number | null }): Attention {
  if (!isOpen(opportunity.stage)) return "none";
  if (opportunity.takeover) return "taken_over";
  if (facts.running) return "working";
  if (facts.pendingForOwner || opportunity.nextAction?.by === "owner" || opportunity.match.state === "needs_review") return "needs_review";
  if (facts.blocked) return "blocked";
  if (opportunity.nextAction?.by === "customer") return facts.followUpAt !== null ? "scheduled" : "waiting_reply";
  return "none";
}

/** Bumps the revision: something material about the opportunity changed, so work prepared earlier is checked again before it goes. */
export async function bump(ctx: MutationCtx, opportunity: Doc<"salesOpportunities">, patch: Partial<Doc<"salesOpportunities">> = {}): Promise<Doc<"salesOpportunities">> {
  await ctx.db.patch(opportunity._id, { ...patch, revision: opportunity.revision + 1, updatedAt: Date.now() });
  return (await ctx.db.get(opportunity._id))!;
}

export async function ownedOpportunity(ctx: Ctx, companyId: Id<"companies">, opportunityId: Id<"salesOpportunities">): Promise<Doc<"salesOpportunities">> {
  const opportunity = await ctx.db.get(opportunityId);
  if (!opportunity || opportunity.companyId !== companyId) notFound();
  return opportunity;
}
