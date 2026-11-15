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
import { handOff } from "./handoffs";
import { coverJob } from "./workflow";

const SYSTEM: Actor = { kind: "system" };
const DAY = 24 * 60 * 60 * 1000;

/** The provider never took the message, or nobody knows whether it did. */
export function neverReached(message: Doc<"messages"> | null): boolean {
  return message !== null && (message.status === "failed" || message.status === "unconfirmed" || message.status === "queued" || message.status === "sending");
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
