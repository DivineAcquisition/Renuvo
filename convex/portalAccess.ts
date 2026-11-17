/**
 * The office's side of the cleaner portal: inviting a cleaner, seeing what became of the invitation, copying
 * the link to send it another way, and ending access. One live portal link per cleaner: a new invitation ends
 * the old link, so a forwarded or lost message never keeps working alongside the new one.
 */
import { v } from "convex/values";

import { owned } from "./lib/access";
import { managerMutation, managerQuery } from "./lib/builders";
import { channelsFor, cleanerMessages, queueCleanerMessage } from "./lib/cleaners/outbox";
import { cleanerLinks, issuePortalLink, portalLinksConfigured, portalLinkState, portalTokenFor, portalUrl, revokePortalLink } from "./lib/cleaners/portal";
import { cleanersSettings, DAY } from "./lib/cleaners/settings";
import { MESSAGE_STATE_WORDS, PURPOSE_WORDS } from "./lib/cleaners/words";
import { userError } from "./lib/errors";
import { byMember, recordEvent } from "./lib/events";

const PURPOSE_LABEL = { portal: "Portal", task: "Onboarding link", availability: "Availability link", check_in: "Check-in link" } as const;
/** Inviting again within this long answers with the invitation already on its way, instead of a second one. */
const REPEAT_WINDOW = 10 * 60 * 1000;

export const access = managerQuery({
  args: { cleanerId: v.id("cleaners") },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    const now = Date.now();
    const links = await cleanerLinks(ctx, ctx.companyId, cleaner._id);
    const messages = await cleanerMessages(ctx, ctx.companyId, cleaner._id, 40);
    return {
      configured: portalLinksConfigured(),
      channels: channelsFor(cleaner, cleanersSettings(ctx.company).followUpChannels),
      links: links.slice(0, 15).map((link) => ({
        linkId: link._id,
        purpose: link.purpose,
        label: PURPOSE_LABEL[link.purpose],
        state: portalLinkState(link, now),
        issuedAt: link.issuedAt,
        expiresAt: link.expiresAt,
        revokeReason: link.revokeReason ?? null,
        /** The last thing they did through it. Opening a link is not recorded, so "not used" can mean "not opened" or "opened only". */
        lastActionAt: link.lastActionAt ?? null,
        by: link.issuedBy.kind === "agent" ? (link.issuedBy.agent === "recruiter" ? "Recruiter" : "Dispatch") : link.issuedBy.kind === "member" ? "A team member" : "Selestial",
      })),
      messages: messages
        .filter((message) => message.purpose !== "verification_code")
        .slice(0, 20)
        .map((message) => ({
          messageId: message._id,
          what: PURPOSE_WORDS[message.purpose] ?? "Message",
          channel: message.channel === "email" ? "email" : "text",
          status: message.status,
          words: MESSAGE_STATE_WORDS[message.status],
          problem: message.status === "not_sent" || message.status === "failed" || message.status === "held" ? (message.problem ?? null) : null,
          at: message.deliveredAt ?? message.sentAt ?? message.failedAt ?? message.queuedAt,
        })),
    };
  },
});

/**
 * Invites a cleaner to their portal: a new link (ending any older portal link) and one message on the channel
 * asked for, or the company's first that can reach them. A second press within a few minutes finds the first.
 */
export const invite = managerMutation({
  args: { cleanerId: v.id("cleaners"), channel: v.optional(v.union(v.literal("sms"), v.literal("email"))) },
  handler: async (ctx, args) => {
    const cleaner = await owned(ctx, args.cleanerId);
    if (cleaner.status === "ended") throw userError("This engagement has ended.");
    if (!portalLinksConfigured()) throw userError("Portal links are not set up on this deployment, so there is nothing to send. Selestial needs ACTION_LINK_SECRET set.");
    const now = Date.now();
    const links = await cleanerLinks(ctx, ctx.companyId, cleaner._id);
    const live = links.filter((link) => link.purpose === "portal" && portalLinkState(link, now) === "active");
    const fresh = live.find((link) => now - link.issuedAt < REPEAT_WINDOW);
    if (fresh) {
      const messages = await cleanerMessages(ctx, ctx.companyId, cleaner._id, 10);
      const sent = messages.find((message) => message.portalLinkId === fresh._id && message.purpose === "portal_invitation");
      if (sent && sent.status !== "not_sent" && sent.status !== "failed") return { status: "already" as const, words: `An invitation went ${MESSAGE_STATE_WORDS[sent.status] === "delivered" ? "out and was delivered" : "out"} a few minutes ago. It was not sent again.` };
    }
    for (const link of live) await revokePortalLink(ctx, link, "A new invitation replaced it.", byMember(ctx));
    const settings = cleanersSettings(ctx.company);
    const channel = args.channel ?? channelsFor(cleaner, settings.followUpChannels)[0];
    if (!channel) throw userError("There is no mobile number or email on file. Add one, or copy the link after inviting.");
    const link = await issuePortalLink(ctx, { companyId: ctx.companyId, holder: { cleanerId: cleaner._id }, purpose: "portal", expiresAt: now + settings.portalLinkDays * DAY, issuedBy: { kind: "member", memberId: ctx.member._id }, actor: byMember(ctx) });
    const first = cleaner.name.trim().split(/\s+/)[0];
    const message = await queueCleanerMessage(ctx, {
      company: ctx.company,
      cleaner,
      channel,
      purpose: "portal_invitation",
      subject: `Your ${ctx.company.name} portal`,
      body:
        channel === "sms"
          ? `${ctx.company.name}: Hi ${first}, here is your link to see your jobs, set your availability and finish onboarding: {link}`
          : `Hi ${first},\n\nHere is your link to ${ctx.company.name}'s portal. You can see your jobs, set the days and hours you can work, and finish your onboarding steps from your phone:\n\n{link}\n\nThe link is only for you and works for ${settings.portalLinkDays} days.\n\n${ctx.company.name}`,
      dedupeKey: `portal.invite:${link!._id}`,
      link,
      actor: byMember(ctx),
    });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "cleaner.portal_invited", actor: byMember(ctx), subject: { table: "cleaners", id: cleaner._id }, data: { channel, messageStatus: message.status } });
    return message.status === "not_sent"
      ? { status: "not_sent" as const, words: `The link is ready but the ${channel === "sms" ? "text" : "email"} was not sent: ${message.problem ?? "sending is not set up"} You can copy the link and send it yourself.`, linkId: link!._id }
      : { status: "sent" as const, words: message.status === "held" ? `Prepared. It goes when quiet hours end.` : `Sent by ${channel === "sms" ? "text" : "email"}. You will see here when it is delivered and when they use it.`, linkId: link!._id };
  },
});

/** The link's address, to send another way. Copying it is recorded; the token itself is never stored. */
export const reveal = managerMutation({
  args: { linkId: v.id("portalLinks") },
  handler: async (ctx, args) => {
    const link = await owned(ctx, args.linkId);
    if (portalLinkState(link, Date.now()) !== "active") throw userError("This link is no longer active. Invite them again for a new one.");
    const token = await portalTokenFor(link);
    if (!token) throw userError("Portal links are not set up on this deployment.");
    const subject = link.cleanerId ? { table: "cleaners" as const, id: link.cleanerId } : { table: "subcontractors" as const, id: link.subcontractorId! };
    await recordEvent(ctx, { companyId: ctx.companyId, type: link.cleanerId ? "cleaner.portal_link_copied" : "subcontractor.portal_link_copied", actor: byMember(ctx), subject, data: { linkId: link._id } });
    return { url: portalUrl(token) };
  },
});

export const revoke = managerMutation({
  args: { linkId: v.id("portalLinks"), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const link = await owned(ctx, args.linkId);
    await revokePortalLink(ctx, link, args.reason?.trim().slice(0, 200) || "Ended by the office.", byMember(ctx));
    return null;
  },
});
