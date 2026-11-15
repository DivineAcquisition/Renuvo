/**
 * Planning a message. A message is a row first: what is to be sent, to whom, about what. Sending it is
 * a separate step (convex/messaging.ts), and whether it arrived is a third. The same message is never
 * planned twice: `dedupeKey` names it.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { recordEvent, type Actor } from "../events";
import { messagingProvider, sendablePhone } from "./provider";

export type MessagePurpose = Doc<"messages">["purpose"];

export type PlannedMessage = {
  companyId: Id<"companies">;
  purpose: MessagePurpose;
  cleaner: Doc<"cleaners">;
  jobId?: Id<"jobs">;
  assignmentId?: Id<"assignments">;
  /** The link the text carries. `undefined` means the text has none. `null` means it needs one and none could be issued. */
  link?: Doc<"actionLinks"> | null;
  linkPath?: string;
  /** With "{link}" where the link goes. */
  body: string;
  dedupeKey: string;
  actor: Actor;
};

export async function messageByKey(ctx: MutationCtx, companyId: Id<"companies">, dedupeKey: string): Promise<Doc<"messages"> | null> {
  return ctx.db
    .query("messages")
    .withIndex("by_company_dedupe", (q) => q.eq("companyId", companyId).eq("dedupeKey", dedupeKey))
    .first();
}

/** Plans one message and hands it to the sender. Asked twice for the same message, it answers with the first. */
export async function queueMessage(ctx: MutationCtx, planned: PlannedMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.companyId, planned.dedupeKey);
  if (existing) return existing;

  const to = sendablePhone(planned.cleaner.phone);
  const provider = messagingProvider();
  let problem: string | null = null;
  if (!planned.cleaner.phone) problem = "No phone number on file.";
  else if (!to) problem = "The phone number on file is not valid.";
  else if (planned.link === null) problem = "Action links are not set up, so there was no link to send.";
  else if (!provider) problem = "Text messaging is not connected.";

  const now = Date.now();
  const messageId = await ctx.db.insert("messages", {
    companyId: planned.companyId,
    purpose: planned.purpose,
    cleanerId: planned.cleaner._id,
    jobId: planned.jobId,
    assignmentId: planned.assignmentId,
    linkId: planned.link?._id,
    linkPath: planned.linkPath,
    to: to ?? undefined,
    body: planned.body,
    dedupeKey: planned.dedupeKey,
    status: problem ? "not_sent" : "queued",
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    queuedAt: now,
  });
  await recordEvent(ctx, {
    companyId: planned.companyId,
    type: problem ? "message.not_sent" : "message.queued",
    actor: planned.actor,
    subject: { table: "messages", id: messageId },
    data: { purpose: planned.purpose, cleanerId: planned.cleaner._id, jobId: planned.jobId ?? null, assignmentId: planned.assignmentId ?? null },
  });
  if (!problem) await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/** The messages about one assignment, oldest first. */
export async function assignmentMessages(ctx: { db: MutationCtx["db"] } | { db: import("../../_generated/server").QueryCtx["db"] }, assignment: Pick<Doc<"assignments">, "_id" | "companyId">): Promise<Doc<"messages">[]> {
  return ctx.db
    .query("messages")
    .withIndex("by_company_assignment", (q) => q.eq("companyId", assignment.companyId).eq("assignmentId", assignment._id))
    .take(100);
}
