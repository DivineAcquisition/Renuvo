/**
 * Each recipient's own choices: what they agreed to, what they withdrew, and the addresses that must not
 * be contacted. Managers record what a person told the company; only the person can undo a STOP.
 */
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { companyQuery, managerMutation, ownerMutation } from "./lib/builders";
import { addSuppression, liftSuppression, recipientPermissions, setPermission } from "./lib/compliance/permissions";
import { normalAddress, recipientRecord } from "./lib/compliance/recipients";
import {
  categoryValidator,
  channelValidator,
  originValidator,
  permissionSourceValidator,
  permissionStatusValidator,
  recipientValidator,
  suppressionScopeValidator,
  type Recipient,
} from "./lib/compliance/schema";
import { notFound, userError } from "./lib/errors";
import { byMember } from "./lib/events";
import { checkSend, explainRecipient } from "./lib/messaging/policy";
import { agentValidator } from "./lib/statuses";
import { optionalText, text } from "./lib/text";

const HISTORY_LIMIT = 100;

async function requireRecipient(ctx: QueryCtx & { companyId: Id<"companies"> }, recipient: Recipient) {
  const record = await recipientRecord(ctx, ctx.companyId, recipient);
  if (!record) notFound();
  return record;
}

/** Everything about one person's choices: current answers, stops on their addresses, the history, and what would happen now. */
export const forRecipient = companyQuery({
  args: { recipient: recipientValidator },
  handler: async (ctx, args) => {
    const record = await requireRecipient(ctx, args.recipient);
    const recipient = { kind: record.kind, id: record.id };
    const suppressions = [
      ...(record.phone ? await activeOrAll(ctx, "sms", record.phone) : []),
      ...(record.email ? await activeOrAll(ctx, "email", record.email) : []),
    ];
    const history = await ctx.db
      .query("permissionHistory")
      .withIndex("by_company_recipient_at", (q) => q.eq("companyId", ctx.companyId).eq("recipient.kind", recipient.kind).eq("recipient.id", recipient.id))
      .order("desc")
      .take(HISTORY_LIMIT);
    return {
      recipient: record,
      permissions: await recipientPermissions(ctx, ctx.companyId, recipient),
      suppressions,
      history,
      explain: await explainRecipient(ctx, ctx.companyId, recipient),
    };
  },
});

async function activeOrAll(ctx: QueryCtx & { companyId: Id<"companies"> }, channel: "sms" | "email", address: string) {
  // Lifted ones are shown too, newest first, so a person can see a stop was undone and by whom.
  const rows = await ctx.db
    .query("suppressions")
    .withIndex("by_company_channel_address", (q) => q.eq("companyId", ctx.companyId).eq("channel", channel).eq("address", address))
    .take(50);
  return rows.sort((a, b) => b.at - a.at);
}

/** A manager records what a person told the company. The person must be in this company's record. */
export const record = managerMutation({
  args: {
    recipient: recipientValidator,
    channel: channelValidator,
    category: categoryValidator,
    status: permissionStatusValidator,
    source: permissionSourceValidator,
    disclosureId: v.optional(v.id("consentDisclosures")),
    evidence: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const record = await requireRecipient(ctx, args.recipient);
    const evidence = optionalText(args.evidence, "Where the proof is kept", 500);
    if (args.status === "granted") {
      if (args.source === "import") throw userError("An imported contact is not permission. Record how the person agreed.");
      // A withdrawal is honoured however it arrived; a grant said out loud or on paper has to say where the proof is.
      if ((args.source === "verbal" || args.source === "paper_form") && !evidence) throw userError("Say where the proof of this agreement is kept.");
      if (args.channel === "sms" && args.category === "marketing" && !args.disclosureId) throw userError("Marketing texts need the exact wording the person agreed to. Choose it before recording.");
    }
    if (args.disclosureId) {
      const disclosure = await ctx.db.get(args.disclosureId);
      if (!disclosure || disclosure.companyId !== ctx.companyId) notFound();
      if (disclosure.channel !== args.channel || disclosure.category !== args.category) throw userError("That wording is for a different kind of message.");
    }
    const row = await setPermission(ctx, {
      companyId: ctx.companyId,
      recipient: { kind: record.kind, id: record.id },
      channel: args.channel,
      category: args.category,
      status: args.status,
      source: args.source,
      ...(args.disclosureId ? { disclosureId: args.disclosureId, disclosureText: undefined } : {}),
      evidence,
      recordedBy: { kind: "member", memberId: ctx.member._id },
      at: Date.now(),
      actor: byMember(ctx),
    });
    return { permissionId: row._id, status: row.status };
  },
});

export const suppressions = companyQuery({
  args: { channel: v.optional(channelValidator) },
  handler: async (ctx, args) => {
    const channel = args.channel;
    const rows = channel
      ? await ctx.db
          .query("suppressions")
          .withIndex("by_company_channel_at", (q) => q.eq("companyId", ctx.companyId).eq("channel", channel))
          .order("desc")
          .take(200)
      : await ctx.db
          .query("suppressions")
          .withIndex("by_company_at", (q) => q.eq("companyId", ctx.companyId))
          .order("desc")
          .take(200);
    return rows;
  },
});

/** A manager adds an address to the do-not-contact list, for example after a call asking to stop. */
export const suppress = managerMutation({
  args: { channel: channelValidator, address: v.string(), scope: suppressionScopeValidator, note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const address = normalAddress(args.channel, args.address);
    if (!address) throw userError(args.channel === "sms" ? "That is not a phone number that can be texted." : "That is not a valid email address.");
    const { suppression } = await addSuppression(ctx, { companyId: ctx.companyId, channel: args.channel, address, scope: args.scope, reason: "manual", note: optionalText(args.note, "The note", 500), at: Date.now(), actor: byMember(ctx) });
    return { suppressionId: suppression._id };
  },
});

/** The Owner lifts a stop, with a reason. A STOP the person texted is theirs to undo. */
export const lift = ownerMutation({
  args: { suppressionId: v.id("suppressions"), note: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.suppressionId);
    if (!row || row.companyId !== ctx.companyId) notFound();
    if (row.reason === "stop_keyword") throw userError("Only the person can undo STOP, by replying START.");
    if (row.liftedAt !== undefined) throw userError("This stop was already lifted.");
    await liftSuppression(ctx, row, { liftedBy: { kind: "member", memberId: ctx.member._id }, note: text(args.note, "The reason", 500), actor: byMember(ctx) });
    return null;
  },
});

/** What the sending policy would answer right now, so a screen can say so before anyone presses send. */
export const check = companyQuery({
  args: { channel: channelValidator, to: v.string(), recipient: v.optional(recipientValidator), category: categoryValidator, origin: originValidator, agent: v.optional(agentValidator) },
  handler: async (ctx, args) => {
    if (args.recipient) await requireRecipient(ctx, args.recipient);
    return checkSend(ctx, { companyId: ctx.companyId, channel: args.channel, to: args.to, recipient: args.recipient, category: args.category, origin: args.origin, agent: args.agent, now: Date.now() });
  },
});
