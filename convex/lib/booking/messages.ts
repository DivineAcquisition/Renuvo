/**
 * Messages to a customer about their own booking: the confirmation, the "request received" note, and a
 * recovery note a person chose to send. Planned as `messages` rows and sent through the same door as
 * every other message (convex/messaging.ts), so the one sending policy decides: suspension, sender
 * setup, a usable address, the do-not-contact list, recorded permission and quiet hours. A refusal is
 * recorded with its reason and is visible on the booking; it never blocks the booking itself.
 *
 * The private link is "{link}" until the moment of sending. Then a fresh token is issued for the email
 * (convex/lib/booking/tokens.ts) and only its hash is kept, so a stored message never holds a working link.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { normalAddress } from "../compliance/recipients";
import { siteOrigin } from "../dispatch/links";
import { recordEvent, type Actor } from "../events";
import { emailProvider } from "../messaging/email";
import { messageByKey, type SendIntent } from "../messaging/outbox";
import { checkSend, type PolicyCode } from "../messaging/policy";
import { readProfile } from "../compliance/profile";
import { bookingSettingsOf } from "./settings";
import { customerName } from "./session";
import { newToken, tokenHash } from "./tokens";

type Purpose = "booking_confirmation" | "booking_request_received" | "booking_recovery";

/**
 * A confirmation or a "request received" note is about the customer's own booking: operational. A
 * reminder to finish an abandoned booking is marketing, so it needs the customer's recorded permission
 * for marketing email and counts toward the company's weekly marketing limit.
 */
export function bookingIntent(customerId: Id<"customers">, purpose: Purpose): SendIntent {
  return { category: purpose === "booking_recovery" ? "marketing" : "operational", origin: "manual", recipient: { kind: "customer", id: customerId } };
}

async function ownMailbox(ctx: MutationCtx, companyId: Id<"companies">) {
  return (
    await ctx.db
      .query("mailboxConnections")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .take(20)
  ).find((row) => row.provider === "gmail" && row.canSend && row.status === "connected");
}

function compose(purpose: Purpose, session: Doc<"bookingSessions">, company: string, tz: string): { subject: string; body: string } {
  const first = session.contact?.firstName || "there";
  const when = session.schedule
    ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(session.schedule.startsAt))
    : null;
  if (purpose === "booking_confirmation") {
    return {
      subject: `Your booking with ${company} is confirmed`,
      body: [`Hi ${first},`, "", `Your booking with ${company} is confirmed${when ? ` for ${when}` : ""}.`, session.quote?.grandTotalCents ? `Total: $${(session.quote.grandTotalCents / 100).toFixed(2)}.` : "", "", "See your booking and update access details here:", "{link}", "", "This link is private to you. Please don't forward it."].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n"),
    };
  }
  if (purpose === "booking_request_received") {
    return { subject: `${company} received your request`, body: [`Hi ${first},`, "", `${company} received your request and will reply soon with next steps.`, "", "You can see what you sent here:", "{link}"].join("\n") };
  }
  return { subject: `Finish your booking with ${company}`, body: [`Hi ${first},`, "", `You started a booking with ${company}. Your answers are saved, and you can pick up where you left off here:`, "{link}", "", "If you no longer need it, you can ignore this message.", `To stop emails like this, reply "unsubscribe" and ${company} will take you off the list.`].join("\n") };
}

/** Plans one booking message and hands it to the sender. Asked twice with the same key, it answers with the first. */
export async function queueBookingMessage(ctx: MutationCtx, input: { sessionId: Id<"bookingSessions">; purpose: Purpose; dedupeKey: string; actor?: Actor }): Promise<Doc<"messages"> | null> {
  const session = (await ctx.db.get(input.sessionId))!;
  if (session.test || !session.customerId) return null;
  const existing = await messageByKey(ctx, session.companyId, input.dedupeKey);
  if (existing) return existing;
  const company = (await ctx.db.get(session.companyId))!;
  const customer = (await ctx.db.get(session.customerId))!;
  const settings = await bookingSettingsOf(ctx, company);
  const name = settings.profile.displayName || company.name;
  const { subject, body } = compose(input.purpose, session, name, company.timezone);
  const to = normalAddress("email", customer.email);
  const provider = (await ownMailbox(ctx, company._id)) ? { name: "gmail" } : emailProvider();
  const intent = bookingIntent(customer._id, input.purpose);
  const now = Date.now();
  let problem: string | null = null;
  let code: PolicyCode | null = null;
  let retryAt: number | undefined;
  if (!to) problem = "There is no valid email address for this customer.";
  else if (!provider) problem = "Email isn't connected for Selestial yet.";
  else {
    const answer = await checkSend(ctx, { companyId: company._id, channel: "email", to, now, ...intent });
    if (!answer.ok) {
      problem = answer.words;
      code = answer.code;
      retryAt = answer.retryAt;
    }
  }
  const status = !problem ? "queued" : retryAt !== undefined ? "held" : "not_sent";
  const replyTo = settings.profile.email ?? undefined;
  const messageId = await ctx.db.insert("messages", {
    companyId: company._id,
    purpose: input.purpose,
    channel: "email",
    subject,
    ...(replyTo ? { replyTo } : {}),
    customerId: customer._id,
    bookingSessionId: session._id,
    to: status === "not_sent" ? undefined : (to ?? undefined),
    body,
    dedupeKey: input.dedupeKey,
    status,
    attempts: 0,
    provider: provider?.name,
    problem: problem ?? undefined,
    refusal: status === "not_sent" && code ? code : undefined,
    queuedAt: now,
  });
  if (status !== "not_sent" && to) await ctx.db.insert("sendIntents", { companyId: company._id, messageId, channel: "email", address: to, at: now, ...intent });
  await recordEvent(ctx, { companyId: company._id, type: `message.${status}`, actor: input.actor ?? { kind: "system" }, subject: { table: "messages", id: messageId }, data: { purpose: input.purpose, channel: "email", ...(code ? { policy: code } : {}) } });
  if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
  if (status === "held") await ctx.scheduler.runAt(retryAt!, internal.messaging.deliver, { messageId });
  return (await ctx.db.get(messageId))!;
}

/**
 * At the moment of sending: the booking must still be one this message is true about. A fresh emailed
 * link is issued now; the stored message keeps "{link}".
 */
export async function bookingClaim(ctx: MutationCtx, message: Doc<"messages">): Promise<{ problem: string } | { body: string; fromName: string }> {
  const session = message.bookingSessionId ? await ctx.db.get(message.bookingSessionId) : null;
  const company = await ctx.db.get(message.companyId);
  if (!session || !company || session.companyId !== company._id) return { problem: "The booking no longer exists." };
  if (session.revokedAt) return { problem: "The booking's link was revoked before the message went out." };
  if (message.purpose === "booking_confirmation" && session.status !== "confirmed") return { problem: "The booking was no longer confirmed when the message was due." };
  if (message.purpose === "booking_recovery" && session.status !== "active") return { problem: "The booking was already finished when the reminder was due, so it wasn't sent." };
  const token = newToken();
  await ctx.db.patch(session._id, { linkTokenHash: tokenHash(token), ...(message.purpose === "booking_recovery" ? { expiresAt: Math.max(session.expiresAt, Date.now() + 3 * 24 * 60 * 60_000) } : {}) });
  const profile = await readProfile(ctx, message.companyId);
  const settings = await bookingSettingsOf(ctx, company);
  return { body: message.body.replaceAll("{link}", `${siteOrigin()}/b/resume#${token}`), fromName: profile.messaging.senderName?.trim() || settings.profile.displayName || company.name };
}

export { customerName };
