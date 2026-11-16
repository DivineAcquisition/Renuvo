/**
 * What a message's fate means for the work it was part of. An offer whose text never reached the
 * cleaner was never really made, so it is ended as undelivered, not as the cleaner's silence: nothing
 * about it counts against them, their contact details go to a person to check, and Dispatch moves on.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { Actor } from "../events";
import { messageByKey } from "../messaging/outbox";
import { endAssignment } from "./assignmentState";
import { liveTaskByKey, openTask, setTaskState } from "../taskState";
import { handOff } from "./handoffs";
import { coverJob } from "./workflow";

const SYSTEM: Actor = { kind: "system" };
const DAY = 24 * 60 * 60 * 1000;

/**
 * The provider never took the message, or nobody knows whether it did. A text held for quiet hours has
 * not gone either, and neither has one the sending policy refused. (A text that was not sent because
 * there is no number on file is different: the office reaches that cleaner by hand.)
 */
export function neverReached(message: Doc<"messages"> | null): boolean {
  if (message === null) return false;
  if (message.status === "not_sent") return message.refusal !== undefined;
  return message.status === "failed" || message.status === "unconfirmed" || message.status === "queued" || message.status === "held" || message.status === "sending";
}

/** Refusals that are about this one cleaner. The others stop every text the company sends. */
const ABOUT_THE_CLEANER = new Set(["no_address", "suppressed", "no_permission", "frequency"]);

export const sendingBlockedKey = (companyId: string) => `dispatch.sending_blocked:${companyId}`;

/**
 * The sending policy refused an offer's text, so the cleaner was never asked. When the reason is about
 * that cleaner and Dispatch made the offer, the offer ends as undelivered, a person is told why, and
 * Dispatch asks the next cleaner. When the reason stops every text (sending not set up, suspended,
 * Dispatch paused), moving on would only burn through every cleaner, so the offer stays for a person to
 * make by hand and one task says texts are not going out. An offer a person made also stays theirs.
 * In every case the offer later ends as undelivered, never as the cleaner's silence.
 */
export async function afterOfferTextRefused(ctx: MutationCtx, message: Doc<"messages">, byAgent: boolean) {
  const assignment = message.assignmentId ? await ctx.db.get(message.assignmentId) : null;
  if (!assignment || assignment.status !== "offered" || message.status !== "not_sent" || !message.refusal) return;
  if (!byAgent) return;
  if (ABOUT_THE_CLEANER.has(message.refusal)) {
    await endAssignment(ctx, assignment, "cancelled", SYSTEM, { endReason: `The offer text was not sent: ${message.problem ?? "the sending policy refused it."}`.slice(0, 500), endCause: "undelivered", data: { cause: "undelivered", policy: message.refusal } });
    await contactHandoff(ctx, message, "An offer was not sent.");
    await coverJob(ctx, assignment.jobId);
    return;
  }
  const key = sendingBlockedKey(assignment.companyId);
  if (await liveTaskByKey(ctx, assignment.companyId, key)) return;
  const question = `Dispatch's texts are not going out: ${message.problem ?? "the sending policy is refusing them."} Offers are still recorded. Reach the cleaners yourself and record their answers, or fix sending so Dispatch can ask them.`;
  const taskId = await openTask(ctx, {
    companyId: assignment.companyId,
    agent: "dispatch",
    title: "Dispatch's texts to cleaners are not going out",
    nextAction: "Fix sending, or reach the cleaners yourself",
    dueAt: Date.now() + DAY,
    completionCondition: "Texts go out again, or a person is handling the offers by hand",
    about: { table: "assignments", id: assignment._id },
    key,
    actor: SYSTEM,
  });
  await ctx.db.patch(taskId, { trigger: "The sending policy refused an offer text for a reason that applies to every text.", escalation: "An offer nobody could be texted about ends as undelivered at its deadline and waits for a person." });
  await setTaskState(ctx, (await ctx.db.get(taskId))!, "needs_decision", { openQuestion: question.slice(0, 1000), dueAt: Date.now() + DAY, withPersonSince: Date.now() }, SYSTEM);
}

async function contactHandoff(ctx: MutationCtx, message: Doc<"messages">, what: string) {
  if (!message.cleanerId) return;
  const cleaner = await ctx.db.get(message.cleanerId);
  await handOff(ctx, {
    companyId: message.companyId,
    to: "team_coordinator",
    key: `team_coordinator.contact:${message.cleanerId}`,
    title: `Check how to reach ${cleaner?.name ?? "a cleaner"}: a text did not go through`,
    question: `${what} ${message.problem ?? "The text could not be delivered."} Confirm the number on file for ${cleaner?.name ?? "this cleaner"}, or reach them another way.`,
    trigger: "A text message to this cleaner failed to deliver.",
    completionCondition: "The cleaner's contact details are confirmed or corrected",
    escalation: "Until this is settled, Dispatch does not count this cleaner's silence as an answer.",
    dueAt: Date.now() + DAY,
    about: { table: "cleaners", id: message.cleanerId },
    actor: SYSTEM,
  });
}

/** Ends an offer whose text did not reach the cleaner, and looks for the next cleaner. */
export async function endUndelivered(ctx: MutationCtx, assignment: Doc<"assignments">, message: Doc<"messages">) {
  if (assignment.status !== "offered") return;
  await endAssignment(ctx, assignment, "cancelled", SYSTEM, { endReason: "The offer text was not delivered, so the cleaner never saw it.", endCause: "undelivered", data: { cause: "undelivered" } });
  await contactHandoff(ctx, message, "An offer could not be delivered.");
  await coverJob(ctx, assignment.jobId);
}

/** A message failed for good, or its fate is unknown. */
export async function afterMessageFailed(ctx: MutationCtx, message: Doc<"messages">) {
  if ((message.purpose === "offer" || message.purpose === "backup_offer") && message.assignmentId) {
    const assignment = await ctx.db.get(message.assignmentId);
    if (assignment) return endUndelivered(ctx, assignment, message);
    return;
  }
  const what =
    message.purpose === "reminder" ? "A reminder could not be delivered." : message.purpose === "assignment_confirmed" ? "The confirmation with the job link could not be delivered." : "A text could not be delivered.";
  await contactHandoff(ctx, message, what);
}

/** An offer's deadline passed. If its text never reached the cleaner, that is not their silence. */
export async function expireOffer(ctx: MutationCtx, assignment: Doc<"assignments">) {
  const message = await messageByKey(ctx, assignment.companyId, `offer:${assignment._id}`);
  if (message && neverReached(message)) return endUndelivered(ctx, assignment, message);
  await endAssignment(ctx, assignment, "expired", SYSTEM, {
    endReason: "The response deadline passed.",
    // What is known about the text when the silence was recorded. "sent" means the carrier took it and never confirmed delivery.
    data: { delivery: message?.status ?? "none" },
  });
  await coverJob(ctx, assignment.jobId);
}
