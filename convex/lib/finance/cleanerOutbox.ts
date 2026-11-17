/**
 * The one Finance message to a cleaner: the link to their own earnings statement. Planned as a
 * `messages` row and sent through the shared door, so the sending policy decides (sender setup, a
 * usable address, the do-not-contact list, recorded permission, quiet hours). The link is "{link}"
 * until the moment of sending, when it is made from the cleaner's open statement link.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { readProfile } from "../compliance/profile";
import { normalAddress } from "../compliance/recipients";
import { recordEvent, type Actor } from "../events";
import { emailProvider } from "../messaging/email";
import { messageByKey, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyCode } from "../messaging/policy";
import { messagingProvider } from "../messaging/provider";
import { isEmail } from "../text";
import { liveStatementLink, statementToken, statementUrl } from "./statementLinks";

type Ctx = QueryCtx | MutationCtx;
type Channel = "email" | "sms";

const intentFor = (cleaner: Pick<Doc<"cleaners">, "_id">): SendIntent => ({ category: "operational", origin: "manual", recipient: { kind: "cleaner", id: cleaner._id } });
const addressOf = (cleaner: Pick<Doc<"cleaners">, "email" | "phone">, channel: Channel) => normalAddress(channel, channel === "email" ? cleaner.email : cleaner.phone);

/** Whether the statement link could go to this cleaner on this channel now, in the policy's words. */
export async function canSendTo(ctx: Ctx, companyId: Id<"companies">, cleaner: Doc<"cleaners">, channel: Channel): Promise<{ ok: boolean; words: string | null; address: string | null }> {
  const address = addressOf(cleaner, channel);
  if (!(channel === "email" ? emailProvider() : messagingProvider())) return { ok: false, words: channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.", address };
  const answer = await checkSend(ctx, { companyId, channel, to: address ?? "", now: Date.now(), ...intentFor(cleaner) });
  return answer.ok ? { ok: true, words: null, address } : { ok: false, words: answer.words, address };
}

export async function queueCleanerStatement(
  ctx: MutationCtx,
  input: { company: Doc<"companies">; cleaner: Doc<"cleaners">; channel: Channel; subject?: string; body: string; replyTo: string; dedupeKey: string; actor: Actor },
): Promise<Doc<"messages">> {
  const existing = await messageByKey(ctx, input.company._id, input.dedupeKey);
  if (existing) return existing;
  const { company, cleaner, channel } = input;
  const to = addressOf(cleaner, channel);
  const provider = channel === "email" ? emailProvider() : messagingProvider();
  let problem: string | null = !to ? (channel === "email" ? "There is no valid email address for this cleaner." : "There is no valid phone number for this cleaner.") : !provider ? (channel === "email" ? "Email isn't connected for Selestial yet." : "Texting isn't connected for Selestial yet.") : null;
  const now = Date.now();
  const intent = intentFor(cleaner);
  let code: PolicyCode | null = null;
  let retryAt: number | undefined;
  if (!problem && to) {
    const answer = await checkSend(ctx, { companyId: company._id, channel, to, now, ...intent });
    if (!answer.ok) {
      problem = answer.words;
      code = answer.code;
      retryAt = answer.retryAt;
    }
  }
  const status = !problem ? "queued" : retryAt !== undefined ? "held" : "not_sent";
  const messageId = await ctx.db.insert("messages", {
    companyId: company._id,
    purpose: "earnings_statement",
    channel,
    subject: channel === "email" ? input.subject : undefined,
    replyTo: channel === "email" && isEmail(input.replyTo) ? input.replyTo : undefined,
    cleanerId: cleaner._id,
    to: status === "not_sent" ? undefined : (to ?? undefined),
    body: input.body,
    dedupeKey: input.dedupeKey,
    status,
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    refusal: status === "not_sent" && code ? code : undefined,
    queuedAt: now,
  });
  if (status !== "not_sent" && to) await ctx.db.insert("sendIntents", { companyId: company._id, messageId, channel, address: to, at: now, ...intent });
  await recordEvent(ctx, { companyId: company._id, type: `message.${status}`, actor: input.actor, subject: { table: "messages", id: messageId }, data: { purpose: "earnings_statement", channel, cleanerId: cleaner._id, ...(code ? { policy: code } : {}) } });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/** At the moment of sending: the cleaner's statement link, made now, and the company as the sender. */
export async function statementClaim(ctx: MutationCtx, message: Doc<"messages">): Promise<{ problem: string } | { body: string; fromName: string }> {
  const company = await ctx.db.get(message.companyId);
  if (!company || !message.cleanerId) return { problem: "The cleaner no longer exists." };
  const link = await liveStatementLink(ctx, message.companyId, message.cleanerId);
  const token = link ? await statementToken(link) : null;
  if (!token) return { problem: "The statement link was closed before the message went out." };
  const profile = await readProfile(ctx, message.companyId);
  return { body: message.body.replaceAll("{link}", statementUrl(token)), fromName: profile.messaging.senderName?.trim() || company.name };
}
