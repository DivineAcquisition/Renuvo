/**
 * Planning a message. A message is a row first: what is to be sent, to whom, about what. Sending it is
 * a separate step (convex/messaging.ts), and whether it arrived is a third. The same message is never
 * planned twice: `dedupeKey` names it. Every message is checked by the sending policy
 * (convex/lib/messaging/policy.ts) when it is planned and again when it is sent.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { Category, Origin, Recipient, ReplyKind } from "../compliance/schema";
import { recordEvent, type Actor } from "../events";
import type { Agent } from "../statuses";
import { checkSend, type PolicyCode } from "./policy";
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
  /** A portal link or code the text carries instead (lib/workforce/portal.ts). `null`: one was needed and none could be issued. */
  portalLinkId?: Id<"portalLinks"> | null;
  portalCodeId?: Id<"portalCodes">;
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

/**
 * Where a Dispatch text started, for the sending policy. An agent acting is that agent; a person acting
 * is a manual send; a text that follows from someone else's action (a cleaner accepting through a link,
 * the system recording a check-in) names no agent, so pausing an agent does not hold it.
 */
export function originOf(actor: Actor): { origin: Origin; agent?: Agent } {
  if (actor.kind === "agent") return { origin: "dispatch", agent: actor.agent };
  if (actor.kind === "member") return { origin: "manual" };
  return { origin: "dispatch" };
}

export type SendIntent = { category: Category; origin: Origin; agent?: Agent; recipient?: Recipient; reply?: ReplyKind };

type Plan = {
  companyId: Id<"companies">;
  purpose: MessagePurpose;
  cleanerId?: Id<"cleaners">;
  jobId?: Id<"jobs">;
  assignmentId?: Id<"assignments">;
  link?: Doc<"actionLinks"> | null;
  linkPath?: string;
  portalLinkId?: Id<"portalLinks">;
  portalCodeId?: Id<"portalCodes">;
  to: string | null;
  body: string;
  dedupeKey: string;
  actor: Actor;
  /** A problem found before the policy is asked: no number, no link. */
  problem: string | null;
  intent: SendIntent;
};

/**
 * Writes the message row and, when it may go, hands it to the sender. Refused by the policy: it is kept
 * as not sent with the policy's words, and nothing is scheduled. Not yet (quiet hours): it is held and
 * planned for the end of the window, when the policy is asked again.
 */
async function plan(ctx: MutationCtx, input: Plan): Promise<Doc<"messages">> {
  const provider = messagingProvider();
  const now = Date.now();
  let problem = input.problem ?? (provider ? null : "Text messaging is not connected.");
  let code: PolicyCode | null = null;
  let retryAt: number | undefined;
  if (!problem && input.to) {
    const answer = await checkSend(ctx, { companyId: input.companyId, channel: "sms", to: input.to, now, ...input.intent });
    if (!answer.ok) {
      problem = answer.words;
      code = answer.code;
      retryAt = answer.retryAt;
    }
  }
  const status = !problem ? "queued" : retryAt !== undefined ? "held" : "not_sent";
  const messageId = await ctx.db.insert("messages", {
    companyId: input.companyId,
    purpose: input.purpose,
    cleanerId: input.cleanerId,
    jobId: input.jobId,
    assignmentId: input.assignmentId,
    linkId: input.link?._id,
    linkPath: input.linkPath,
    portalLinkId: input.portalLinkId,
    portalCodeId: input.portalCodeId,
    to: input.to ?? undefined,
    body: input.body,
    dedupeKey: input.dedupeKey,
    status,
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    refusal: status === "not_sent" && code ? code : undefined,
    queuedAt: now,
  });
  // What the message is for, kept so the policy can be asked again at sending time and the weekly limit counted.
  if (input.to && status !== "not_sent") await ctx.db.insert("sendIntents", { companyId: input.companyId, messageId, channel: "sms", address: input.to, at: now, ...input.intent });
  await recordEvent(ctx, {
    companyId: input.companyId,
    type: `message.${status}`,
    actor: input.actor,
    subject: { table: "messages", id: messageId },
    data: {
      purpose: input.purpose,
      cleanerId: input.cleanerId ?? null,
      jobId: input.jobId ?? null,
      assignmentId: input.assignmentId ?? null,
      ...(code ? { policy: code } : {}),
      ...(retryAt !== undefined ? { retryAt } : {}),
    },
  });
  // An offer whose text the policy refused was never made to the cleaner. Dispatch deals with it in its own step.
  if (status === "not_sent" && code && input.assignmentId && (input.purpose === "offer" || input.purpose === "backup_offer")) {
    await ctx.scheduler.runAfter(0, internal.dispatchOps.offerTextRefused, { messageId, byAgent: input.actor.kind === "agent" });
  }
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/** Plans one text to a cleaner and hands it to the sender. Asked twice for the same message, it answers with the first. */
export async function queueMessage(ctx: MutationCtx, planned: PlannedMessage): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, planned.companyId, planned.dedupeKey);
  if (existing) return existing;

  const to = sendablePhone(planned.cleaner.phone);
  let problem: string | null = null;
  if (!planned.cleaner.phone) problem = "No phone number on file.";
  else if (!to) problem = "The phone number on file is not valid.";
  else if (planned.link === null || planned.portalLinkId === null) problem = "Action links are not set up, so there was no link to send.";

  return plan(ctx, {
    companyId: planned.companyId,
    purpose: planned.purpose,
    cleanerId: planned.cleaner._id,
    jobId: planned.jobId,
    assignmentId: planned.assignmentId,
    link: planned.link,
    linkPath: planned.linkPath,
    portalLinkId: planned.portalLinkId ?? undefined,
    portalCodeId: planned.portalCodeId,
    to,
    body: planned.body,
    dedupeKey: planned.dedupeKey,
    actor: planned.actor,
    problem,
    // Every Dispatch text is about work arranged with, or offered to, a cleaner on the team.
    intent: { category: "operational", recipient: { kind: "cleaner", id: planned.cleaner._id }, ...originOf(planned.actor) },
  });
}

/**
 * The answer to a keyword the person texted to the company's number. It goes through the same policy,
 * marked as a reply, so a suspension or a sender that is not ready still stops it.
 */
export async function queueReply(ctx: MutationCtx, input: { companyId: Id<"companies">; to: string; body: string; reply: ReplyKind; dedupeKey: string }): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, input.companyId, input.dedupeKey);
  if (existing) return existing;
  const to = sendablePhone(input.to);
  return plan(ctx, {
    companyId: input.companyId,
    purpose: "compliance_reply",
    to,
    body: input.body,
    dedupeKey: input.dedupeKey,
    actor: { kind: "system" },
    problem: to ? null : "The number is not valid.",
    intent: { category: "operational", origin: "integration", reply: input.reply },
  });
}

/** The messages about one assignment, oldest first. */
export async function assignmentMessages(ctx: { db: MutationCtx["db"] } | { db: import("../../_generated/server").QueryCtx["db"] }, assignment: Pick<Doc<"assignments">, "_id" | "companyId">): Promise<Doc<"messages">[]> {
  return ctx.db
    .query("messages")
    .withIndex("by_company_assignment", (q) => q.eq("companyId", assignment.companyId).eq("assignmentId", assignment._id))
    .take(100);
}
