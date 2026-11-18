/**
 * Email replies to the Sales agent. The email service tells Selestial a message arrived at the receiving domain
 * (convex/http.ts); the message itself is fetched here, since the notice carries no body, and is filed
 * on the opportunity its reply address names.
 *
 * Three checks stand between an arriving email and "the customer said":
 *  - the reply address must carry a valid signature, so a made-up address names nothing;
 *  - the sender must be the customer's own email address and the mail must not have failed
 *    authentication. Mail from anyone else is kept and shown to a person, and the agent does not act on it;
 *  - only what the person wrote is read. The quoted earlier message, which holds the agent's own words and
 *    prices, is cut off first. An automatic reply is not filed as speech at all.
 *
 * The same message delivered twice is one message.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import { normalAddress } from "./lib/compliance/recipients";
import { recordEvent } from "./lib/events";
import { allow } from "./lib/rateLimit";
import { quiet } from "./lib/sales/actions";
import { load, setNext, SYSTEM, view } from "./lib/sales/agentOpportunity";
import { recordInbound } from "./lib/sales/intake";
import { bareAddress, isAutomatic, opportunityForReply, replyText, textFromHtml } from "./lib/sales/replyAddress";
import { enqueueRun } from "./lib/sales/runs";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

type Received = { from?: unknown; to?: unknown; received_for?: unknown; subject?: unknown; text?: unknown; html?: unknown; headers?: unknown; authentication?: unknown; created_at?: unknown };
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((row): row is string => typeof row === "string").slice(0, 20) : []);

/** Fetches one received email from the email service and hands it to `receive`. A failure is thrown, so the service's notice is retried. */
export const fetch = internalAction({
  args: { emailId: v.string() },
  handler: async (ctx, args): Promise<{ taken: boolean; why: string }> => {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey || !/^[A-Za-z0-9-]{8,64}$/.test(args.emailId)) return { taken: false, why: "not_configured" };
    const response = await globalThis.fetch(`https://api.resend.com/emails/receiving/${args.emailId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (response.status === 404) return { taken: false, why: "gone" };
    if (!response.ok) throw new Error(`The email service answered ${response.status} for a received email.`);
    const email = (await response.json()) as Received;
    const headers: Record<string, string> = {};
    if (email.headers && typeof email.headers === "object") for (const [key, value] of Object.entries(email.headers as Record<string, unknown>).slice(0, 80)) if (typeof value === "string") headers[key.toLowerCase()] = value.slice(0, 500);
    const authentication = (email.authentication && typeof email.authentication === "object" ? email.authentication : {}) as Record<string, unknown>;
    const text = typeof email.text === "string" && email.text.trim() ? email.text : typeof email.html === "string" ? textFromHtml(email.html) : "";
    const receivedAt = typeof email.created_at === "string" ? Date.parse(email.created_at) : NaN;
    return ctx.runMutation(internal.salesInbound.receive, {
      providerId: `resend-in:${args.emailId}`,
      from: typeof email.from === "string" ? email.from.slice(0, 320) : "",
      recipients: [...strings(email.to), ...strings(email.received_for)],
      subject: typeof email.subject === "string" ? email.subject.slice(0, 300) : "",
      text: text.slice(0, 20_000),
      automatic: isAutomatic(headers, typeof email.from === "string" ? email.from : ""),
      // "fail" from the receiving server means the sender's domain says this mail is not theirs.
      failedAuthentication: authentication.dmarc === "fail" || (authentication.spf === "fail" && authentication.dkim === "fail"),
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    });
  },
});

export const receive = internalMutation({
  args: { providerId: v.string(), from: v.string(), recipients: v.array(v.string()), subject: v.string(), text: v.string(), automatic: v.boolean(), failedAuthentication: v.boolean(), receivedAt: v.number() },
  handler: async (ctx, args): Promise<{ taken: boolean; why: string }> => {
    const row = await opportunityForReply(ctx, args.recipients);
    const opportunity = row ? view(row) : null;
    if (!opportunity) return { taken: false, why: "no_conversation" };
    const customer = await ctx.db.get(opportunity.customerId);
    const sender = bareAddress(args.from);
    if (!customer || !sender) return { taken: false, why: "no_sender" };
    // An out-of-office note or a bounce is not the customer speaking, and is never answered.
    if (args.automatic) return { taken: false, why: "automatic" };
    if (!(await allow(ctx, `sales-reply-email:${opportunity._id}`, 30, HOUR))) return { taken: false, why: "limited" };
    const body = replyText(args.text).slice(0, 4000);
    if (!body) return { taken: false, why: "empty" };
    const at = Math.min(args.receivedAt, Date.now());
    const theirs = normalAddress("email", customer.email) === normalAddress("email", sender) && !args.failedAuthentication;

    if (!theirs) {
      // Kept for a person to read, marked as not from the customer's address. Sales neither reads it as the customer nor replies.
      const seen = await ctx.db
        .query("salesMessages")
        .withIndex("by_company_provider", (q) => q.eq("companyId", opportunity.companyId).eq("providerId", args.providerId))
        .first();
      if (seen) return { taken: true, why: "duplicate" };
      const why = args.failedAuthentication ? `An email that claims to be from ${sender} arrived on this conversation and did not pass the sender checks.` : `An email from ${sender} arrived on this conversation. That is not the address on record for ${customer.name}.`;
      await ctx.db.insert("salesMessages", { companyId: opportunity.companyId, opportunityId: opportunity._id, customerId: opportunity.customerId, direction: "note", channel: "internal", author: { kind: "system" }, subject: args.subject.slice(0, 200) || undefined, body: `${why}\n\n${body}`.slice(0, 4000), providerId: args.providerId, at });
      if (opportunity.agent.stage !== "won" && opportunity.agent.stage !== "closed_lost") {
        await quiet(ctx, opportunity, "An email arrived from an address that is not the customer's.", SYSTEM);
        await setNext(ctx, await load(ctx, opportunity._id), { what: `${why} Read it and decide whether it is them.`, by: "owner", dueAt: Date.now() + DAY }, SYSTEM);
      }
      await recordEvent(ctx, { companyId: opportunity.companyId, type: "opportunity.unverified_email", actor: SYSTEM, subject: { table: "salesOpportunities", id: opportunity._id }, data: { failedAuthentication: args.failedAuthentication } });
      return { taken: true, why: "unverified_sender" };
    }

    const { message, created } = await recordInbound(ctx, opportunity, { channel: "email", body, subject: args.subject, providerId: args.providerId, at });
    if (!created) return { taken: true, why: "duplicate" };
    const fresh = await load(ctx, opportunity._id);
    if (!fresh.agent.takeover && fresh.agent.stage !== "won" && fresh.agent.stage !== "closed_lost") await enqueueRun(ctx, fresh, { trigger: "reply", key: `reply:${message._id}`, messageId: message._id });
    return { taken: true, why: "reply" };
  },
});
