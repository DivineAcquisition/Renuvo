/**
 * Messaging notices emailed to the company's Owner: low balance, empty balance, overdraft, work waiting for
 * funds or a limit, and a failed top-up. They are included with the plan: sent through Selestial's own email
 * service, never through the company's outbox, so they never touch the messaging balance and still arrive when
 * the balance is at zero. One email per notice; the provider drops a repeat of the same key.
 */
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { recordEvent } from "./lib/events";
import { emailLayout, emailText } from "./lib/email/layout";
import { emailProvider } from "./lib/email/provider";
import { appOrigin } from "./lib/invitations";

const SUBJECTS: Record<string, string> = {
  messaging_low: "Your messaging balance is low",
  messaging_empty: "Your messaging balance is used up",
  messaging_overdraft: "Your messaging balance is below zero",
  messaging_held: "Messages are waiting to be sent",
  messaging_topup_failed: "A messaging top-up didn't go through",
};

export const ownersOf = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId);
    if (!company) return null;
    const members = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .take(200);
    return { companyName: company.name, to: members.filter((m) => m.role === "owner" && m.status === "active").map((m) => m.email) };
  },
});

export const emailed = internalMutation({
  args: { companyId: v.id("companies"), kind: v.string(), sent: v.number(), failed: v.number() },
  handler: async (ctx, args) => {
    await recordEvent(ctx, { companyId: args.companyId, type: "billing.messaging_notice_emailed", actor: { kind: "system" }, subject: { table: "companies", id: args.companyId }, data: { kind: args.kind, sent: args.sent, failed: args.failed } });
  },
});

export const emailOwner = internalAction({
  args: { companyId: v.id("companies"), kind: v.string(), text: v.string(), at: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const subject = SUBJECTS[args.kind];
    if (!subject) return;
    const found = await ctx.runQuery(internal.messagingNotices.ownersOf, { companyId: args.companyId });
    if (!found || found.to.length === 0) return;
    const provider = emailProvider();
    if (!provider) return;
    const origin = appOrigin();
    const action = origin ? { label: "Open messaging", url: `${origin}/app/settings/billing?tab=messaging` } : undefined;
    const heading = subject;
    const footnote = `You get this because you are the Owner of ${found.companyName} on Selestial. Notices like this are included with your plan and never use the messaging balance.`;
    let sent = 0;
    let failed = 0;
    for (const to of found.to) {
      try {
        const result = await provider.send({
          to,
          subject: `${subject} · ${found.companyName}`,
          html: emailLayout({ preheader: args.text.slice(0, 120), heading, bodyHtml: `<p style="margin:0;">${escape(args.text)}</p>`, action, footnote }),
          text: emailText({ heading, lines: [args.text], action, footnote }),
          // One email per notice and Owner: a retried action never sends it twice.
          idempotencyKey: `messaging-notice-${args.companyId}-${args.kind}-${args.at}-${to}`,
        });
        if (result.ok) sent += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    await ctx.runMutation(internal.messagingNotices.emailed, { companyId: args.companyId, kind: args.kind, sent, failed });
  },
});

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
