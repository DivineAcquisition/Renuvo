/**
 * Follow-ups: one planned reminder at a time, each with a reason, a number in a sequence that ends, and
 * the conditions that stop it. The agent never restarts a sequence by itself: when the last reminder has
 * gone unanswered, the opportunity goes to a person with that fact.
 *
 * A reminder is a row first and a message later. When it comes due it is held against the conversation
 * as it is then (`dueProblem`): a reply, a decline, an opt-out, a booking, a revised or expired quote, or
 * a person stepping in each stop it, with the reason kept. Only then does the agent write the message, and
 * that message goes through the same permission and the same sending policy as any other.
 *
 * One opportunity is followed up on one channel, the one the person used, so nobody is chased by text
 * and by email for the same thing.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { recordEvent, type Actor } from "../events";
import { quietUntil } from "../messaging/policy";
import type { FollowUpPurpose } from "./agentSchema";
import { currentQuote, isOpen, type Opp } from "./agentOpportunity";
import { salesSettings } from "./settings";

type Ctx = QueryCtx | MutationCtx;
const HOUR = 60 * 60_000;

export const PURPOSE_WORDS: Record<FollowUpPurpose, string> = {
  missing_info: "Missing details",
  quote: "Quote follow-up",
  requested_date: "Customer asked to be contacted",
  agreement: "Agreement reminder",
  deposit: "Deposit reminder",
  deferred: "Deferred opportunity",
};

/** What ends each kind of reminder early, for the screens. The code that enforces them is `dueProblem`. */
export const STOP_CONDITIONS: Record<FollowUpPurpose, string[]> = {
  missing_info: ["The customer replies", "The customer declines or opts out", "A person takes over", "The details arrive another way"],
  quote: ["The customer replies, accepts or declines", "The quote is revised, withdrawn or expires", "The customer opts out", "A person takes over"],
  requested_date: ["The customer replies first", "The customer opts out", "A person takes over", "The opportunity is closed"],
  agreement: ["The agreement is signed", "The customer replies", "The booking is confirmed or the opportunity closed", "A person takes over"],
  deposit: ["The deposit is paid", "The customer replies", "The booking is confirmed or the opportunity closed", "A person takes over"],
  deferred: ["The customer replies first", "The customer opts out", "A person takes over", "The opportunity is closed"],
};

export function sequenceHours(company: Doc<"companies">, purpose: FollowUpPurpose): number[] {
  const settings = salesSettings(company).followUp;
  if (purpose === "missing_info") return settings.missingInfoHours;
  if (purpose === "quote") return settings.quoteHours;
  if (purpose === "agreement" || purpose === "deposit") return settings.bookingHours;
  return [];
}

export async function openFollowUps(ctx: Ctx, opportunity: Pick<Doc<"salesOpportunities">, "_id" | "companyId">): Promise<Doc<"salesFollowUps">[]> {
  const rows = await ctx.db
    .query("salesFollowUps")
    .withIndex("by_company_opportunity", (q) => q.eq("companyId", opportunity.companyId).eq("opportunityId", opportunity._id))
    .take(100);
  return rows.filter((row) => row.status === "scheduled");
}

/**
 * Plans the reminder numbered `attempt` in a sequence, if the sequence has one. Returns null when it
 * does not: the sequence is over. Planning the same reminder twice plans it once.
 */
export async function planFollowUp(
  ctx: MutationCtx,
  company: Doc<"companies">,
  opportunity: Opp,
  input: { purpose: FollowUpPurpose; attempt: number; reason: string; preview: string; quoteId?: Id<"salesQuotes">; at?: number; actor: Actor },
): Promise<Doc<"salesFollowUps"> | null> {
  const hours = sequenceHours(company, input.purpose);
  const now = Date.now();
  // A date the customer named is its own single reminder; the others follow the Owner's timing.
  const dated = input.purpose === "requested_date" || input.purpose === "deferred";
  if (!dated && input.attempt > hours.length) return null;
  const wanted = dated ? (input.at ?? now + 30 * 24 * HOUR) : now + hours[input.attempt - 1] * HOUR;
  // A reminder is Sales reaching out, not answering. It waits for the end of the company's quiet hours even when
  // the company lets work messages through at night. The customer's own time zone is not known, so the company's is used.
  const quiet = (await readProfile(ctx, company._id)).messaging.quietHours;
  const dueAt = quiet ? (quietUntil(wanted, company.timezone, quiet) ?? wanted) : wanted;
  const key = `${opportunity._id}:${input.purpose}:${input.attempt}:${input.quoteId ?? ""}:${dated ? dueAt : (opportunity.lastInboundAt ?? 0)}`;
  const existing = await ctx.db
    .query("salesFollowUps")
    .withIndex("by_company_key", (q) => q.eq("companyId", company._id).eq("key", key))
    .first();
  if (existing) return existing;
  // One sequence at a time: a new kind of reminder replaces what was planned for an earlier step.
  for (const row of await openFollowUps(ctx, opportunity)) await ctx.db.patch(row._id, { status: "cancelled", stopReason: "Replaced by a later step.", doneAt: now });
  const followUpId = await ctx.db.insert("salesFollowUps", {
    companyId: company._id,
    opportunityId: opportunity._id,
    customerId: opportunity.customerId,
    purpose: input.purpose,
    attempt: input.attempt,
    maxAttempts: dated ? 1 : hours.length,
    dueAt,
    status: "scheduled",
    reason: input.reason.slice(0, 300),
    preview: input.preview.slice(0, 1200),
    key,
    basis: { lastInboundAt: opportunity.lastInboundAt, ...(input.quoteId ? { quoteId: input.quoteId } : {}) },
    createdBy: input.actor,
    createdAt: now,
  });
  await ctx.scheduler.runAt(dueAt, internal.salesFollowUps.due, { followUpId });
  await recordEvent(ctx, { companyId: company._id, type: "follow_up.scheduled", actor: input.actor, subject: { table: "salesFollowUps", id: followUpId }, data: { purpose: input.purpose, attempt: input.attempt, dueAt } });
  return (await ctx.db.get(followUpId))!;
}

/** Ends every planned reminder for an opportunity, with why. Called the moment a stop condition is met, not only when one comes due. */
export async function stopFollowUps(ctx: MutationCtx, opportunity: Pick<Doc<"salesOpportunities">, "_id" | "companyId">, why: string, actor: Actor, status: "stopped" | "cancelled" = "stopped"): Promise<number> {
  const rows = await openFollowUps(ctx, opportunity);
  const now = Date.now();
  for (const row of rows) {
    await ctx.db.patch(row._id, { status, stopReason: why.slice(0, 300), doneAt: now });
    await recordEvent(ctx, { companyId: row.companyId, type: `follow_up.${status}`, actor, subject: { table: "salesFollowUps", id: row._id }, data: { purpose: row.purpose, attempt: row.attempt } });
  }
  return rows.length;
}

/**
 * Why a reminder that has come due must not go, or null when it still should. Read from the
 * conversation and the opportunity as they are at that moment, never as they were when it was planned.
 */
export async function dueProblem(ctx: Ctx, opportunity: Opp, followUp: Doc<"salesFollowUps">): Promise<string | null> {
  const stage = opportunity.agent.stage;
  if (opportunity.agent.takeover) return "A person took over the conversation.";
  if (stage === "won") return "The booking was confirmed.";
  if (stage === "closed_lost") return "The opportunity was closed.";
  if ((opportunity.lastInboundAt ?? 0) > (followUp.basis.lastInboundAt ?? 0)) return "The customer replied after this reminder was planned.";
  if (opportunity.agent.next?.by === "owner") return "The opportunity is waiting on a person's decision.";
  const purpose = followUp.purpose;
  if (purpose === "requested_date" || purpose === "deferred") return stage === "deferred" ? null : "The opportunity was picked back up before the date.";
  if (!isOpen(stage)) return "The opportunity is no longer open.";
  if (purpose === "missing_info" && stage !== "new" && stage !== "qualifying") return "The missing details arrived.";
  if (purpose === "quote") {
    const quote = await currentQuote(ctx, opportunity);
    if (stage !== "quote_sent" || !quote || quote.status !== "sent") return "The quote is no longer waiting on the customer.";
    if (followUp.basis.quoteId !== undefined && quote._id !== followUp.basis.quoteId) return "The quote was revised after this reminder was planned.";
    if (quote.expiresAt <= Date.now()) return "The quote expired.";
  }
  if ((purpose === "agreement" || purpose === "deposit") && stage !== "booking_pending") return "The booking step is no longer waiting.";
  return null;
}

export async function ownedFollowUp(ctx: Ctx, companyId: Id<"companies">, followUpId: Id<"salesFollowUps">): Promise<Doc<"salesFollowUps"> | null> {
  const row = await ctx.db.get(followUpId);
  return row && row.companyId === companyId ? row : null;
}
