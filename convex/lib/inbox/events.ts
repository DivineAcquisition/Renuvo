/**
 * What happens when a connected inbox stops working or comes back (convex/lib/inbox/mailboxes.ts).
 *
 *  - It stops: the Owner, and whoever connected it, get one "reconnect" notice. Messages meant to go from
 *    it wait; nothing is sent from another address in its place.
 *  - It's reconnected (or a person disconnects it on purpose): the waiting messages are handed to the
 *    sender again, which routes each one as it stands now.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { notifyMembers } from "../notify/route";
import { agentsOf, PURPOSE_INFO, purposesOf, WAITING_FOR_INBOX } from "./mailboxes";

/** Messages waiting for one of this company's inboxes, newest first. */
export async function waitingMessages(ctx: QueryCtx | MutationCtx, companyId: Id<"companies">): Promise<Doc<"messages">[]> {
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_company_queued", (q) => q.eq("companyId", companyId))
    .order("desc")
    .take(500);
  return recent.filter((m) => m.status === "held" && m.refusal === WAITING_FOR_INBOX);
}

/** Hands every waiting message back to the sender. Each is routed again as things stand now. */
export async function resumeWaiting(ctx: MutationCtx, companyId: Id<"companies">): Promise<number> {
  const waiting = await waitingMessages(ctx, companyId);
  for (const [i, message] of waiting.entries()) {
    await ctx.db.patch(message._id, { status: "queued", refusal: undefined, problem: undefined });
    // A little apart, so a long queue doesn't arrive at Gmail all at once.
    await ctx.scheduler.runAfter(i * 2000, internal.messaging.deliver, { messageId: message._id });
  }
  return waiting.length;
}

/** The inbox just stopped working: tell the Owner and the person who connected it, once per day it stays broken. */
export async function inboxBroke(ctx: MutationCtx, connection: Doc<"mailboxConnections">): Promise<void> {
  const purposes = purposesOf(connection);
  const day = new Date(Date.now()).toISOString().slice(0, 10);
  await notifyMembers(ctx, {
    companyId: connection.companyId,
    event: "inbox_reconnect",
    ref: connection._id,
    key: `${connection.status}:${day}`,
    also: [connection.createdBy],
    facts: {
      purposes: purposes.map((p) => PURPOSE_INFO[p].label).join(", "),
      agents: agentsOf(purposes).join(", "),
      since: Date.now(),
    },
  });
}
