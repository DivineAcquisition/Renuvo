/**
 * A company's connected inboxes, shared by every agent (docs/email/00-architecture.md §2, §6).
 *
 * One question is answered here and nowhere else: may this message go from the company's own inbox, and
 * if the inbox that should send it isn't working, what then? The rule:
 *
 *  - An inbox connected for the message's purpose, working, and allowed to send: the message goes from
 *    it, in the conversation's thread.
 *  - An inbox connected for that purpose and allowed to send, but not working (Google's permission
 *    expired, or Gmail stopped answering): the message waits, with the reason, until it's reconnected.
 *    It never goes from Selestial's shared address instead, because the person expects the company's own.
 *  - No inbox for that purpose: it goes through Selestial's shared sender, as "{Company} via Selestial".
 *
 * A message only ever goes one way. The way it went is recorded on the message.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { InboxPurpose } from "../recruiter/schema";
import type { Agent } from "../statuses";

type Ctx = QueryCtx | MutationCtx;

export const PURPOSE_INFO: Record<InboxPurpose, { label: string; agent: Agent | null; agentName: string; does: string }> = {
  sales: { label: "Sales", agent: "sales", agentName: "Sales", does: "Quotes, proposals and replies to people asking about service go from this address, in the same thread." },
  hiring: { label: "Hiring", agent: "recruiter", agentName: "Recruiter", does: "Recruiter reads job-board and applicant mail here, and applicant email goes from this address." },
  care: { label: "Care & Retention", agent: "retention", agentName: "Retention", does: "Booking confirmations, invoices and payment reminders go from this address." },
  operations: { label: "Operations", agent: "dispatch", agentName: "Dispatch", does: "Kept for operations mail. Dispatch texts cleaners, so nothing is sent from it yet." },
};

/** An inbox connected before purposes existed did hiring, and was also used to send sales and customer mail. */
const LEGACY: readonly InboxPurpose[] = ["hiring", "sales", "care"];

export function purposesOf(row: Pick<Doc<"mailboxConnections">, "purposes">): readonly InboxPurpose[] {
  return row.purposes ?? LEGACY;
}

export function agentsOf(purposes: readonly InboxPurpose[]): Agent[] {
  return [...new Set(purposes.map((p) => PURPOSE_INFO[p].agent).filter((a): a is Agent => a !== null))];
}

/** Which purpose a message would go out under, or null for mail that always uses Selestial's shared sender. */
export function inboxPurposeOf(message: Pick<Doc<"messages">, "purpose" | "applicationId" | "salesLinks" | "opportunityId" | "invoiceId" | "bookingSessionId" | "channel">): InboxPurpose | null {
  if ((message.channel ?? "sms") !== "email") return null;
  if (message.applicationId) return "hiring";
  if (message.salesLinks || message.opportunityId) return "sales";
  if (message.invoiceId || message.bookingSessionId) return "care";
  return null;
}

export type Route =
  | { kind: "gmail"; connectionId: Id<"mailboxConnections">; address: string }
  | { kind: "wait"; connectionId: Id<"mailboxConnections">; address: string; words: string }
  | { kind: "shared" };

/** The way a message for this purpose goes now (see the rule at the top of the file). */
export async function routeFor(ctx: Ctx, companyId: Id<"companies">, purpose: InboxPurpose | null): Promise<Route> {
  if (!purpose) return { kind: "shared" };
  const rows = (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20)
  ).filter((row) => row.provider === "gmail" && row.canSend && row.status !== "disconnected" && purposesOf(row).includes(purpose));
  const working = rows.find((row) => row.status === "connected");
  if (working) return { kind: "gmail", connectionId: working._id, address: working.address };
  const broken = rows[0];
  if (broken) return { kind: "wait", connectionId: broken._id, address: broken.address, words: `This goes from ${broken.address}, which needs reconnecting. It's waiting and will go once the inbox is reconnected; it won't be sent from another address.` };
  return { kind: "shared" };
}

/** The code on a message that's waiting for its inbox, so reconnecting it sends them. */
export const WAITING_FOR_INBOX = "inbox_disconnected";

/**
 * The Gmail thread a reply should join: the applicant's own last email to this inbox. A job board's
 * notification is not the applicant's thread, so it's never joined.
 */
export async function threadFor(ctx: Ctx, message: Doc<"messages">, connectionId: Id<"mailboxConnections">): Promise<string | null> {
  if (!message.applicationId || !message.to) return null;
  const to = message.to.trim().toLowerCase();
  const rows = await ctx.db
    .query("sourceMessages")
    .withIndex("by_company_application", (q) => q.eq("companyId", message.companyId).eq("applicationId", message.applicationId))
    .take(50);
  const own = rows.filter((row) => row.connectionId === connectionId && row.threadId && row.fromAddress?.toLowerCase() === to).sort((a, b) => b.receivedAt - a.receivedAt);
  return own[0]?.threadId ?? null;
}
