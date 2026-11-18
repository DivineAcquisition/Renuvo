/**
 * Notifications to the people who run a company (convex/lib/notify). Each person chooses their own, in
 * Settings › Notifications; security notices, and account notices for the Owner, can't be turned off.
 *
 * Public:
 *   mine            this person's settings, their recent notices and whether their address is blocked
 *   setEmail        turn one category on or off for yourself
 *   clearBlock      a person confirms their own address works again after a bounce
 *   unsubscribeInfo what the unsubscribe link in a notice would turn off (no sign-in; the token is the key)
 *   unsubscribe     turn it off, from the page's button, through Selestial's web server
 * Internal:
 *   notify          plan a notice for everyone it reaches (called by the code where things happen)
 *   oneClick        the mail program's own Unsubscribe button (List-Unsubscribe-Post)
 */
import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { companyMutation, companyQuery, publicQuery, serverMutation } from "./lib/builders";
import { userError } from "./lib/errors";
import { recordEvent } from "./lib/events";
import { CATEGORY_INFO, EVENT_INFO, noticeCategoryValidator, noticeEventValidator, noticeFactsValidator } from "./lib/notify/catalog";
import { noticeSuppression, preferenceView, preferencesOf, setEmail as storeEmail, SUPPRESSION_WORDS, type Via } from "./lib/notify/preferences";
import { notifyMembers } from "./lib/notify/route";
import { noticeForToken } from "./lib/notify/unsubscribe";
import { roleOf } from "./lib/roles";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const mine = companyQuery({
  args: {},
  handler: async (ctx) => {
    const row = await preferencesOf(ctx, ctx.companyId, ctx.member._id);
    const recent = await ctx.db
      .query("messages")
      .withIndex("by_company_member", (q) => q.eq("companyId", ctx.companyId).eq("memberId", ctx.member._id))
      .order("desc")
      .take(15);
    const block = await noticeSuppression(ctx, ctx.member.email);
    return {
      email: ctx.member.email,
      blocked: block ? { reason: block.reason, words: SUPPRESSION_WORDS[block.reason], at: block.at } : null,
      categories: preferenceView(row, ctx.role),
      recent: recent.map((m) => ({
        id: m._id,
        event: m.notice?.event ?? null,
        category: m.notice ? EVENT_INFO[m.notice.event].category : null,
        subject: m.subject || null,
        status: m.status,
        problem: m.problem ?? null,
        complained: m.complainedAt !== undefined,
        at: m.sentAt ?? m.queuedAt,
      })),
    };
  },
});

export const setEmail = companyMutation({
  args: { category: noticeCategoryValidator, on: v.boolean() },
  handler: async (ctx, args) => {
    const result = await storeEmail(ctx, { companyId: ctx.companyId, member: ctx.member, role: ctx.role, category: args.category, on: args.on, via: "settings", now: Date.now() });
    if (result.refused) throw userError(result.refused, "not_allowed");
    if (result.changed) await recordEvent(ctx, { companyId: ctx.companyId, type: "notifications.changed", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "members", id: ctx.member._id }, data: { category: args.category, on: args.on, via: "settings" } });
    return { changed: result.changed };
  },
});

/** The signed-in person says their own address works again. Only their own, and only Selestial's notice block. */
export const clearBlock = companyMutation({
  args: {},
  handler: async (ctx) => {
    const block = await noticeSuppression(ctx, ctx.member.email);
    if (!block) return { cleared: false };
    await ctx.db.patch(block._id, { clearedAt: Date.now() });
    await recordEvent(ctx, { companyId: ctx.companyId, type: "notifications.block_cleared", actor: { kind: "member", memberId: ctx.member._id }, subject: { table: "members", id: ctx.member._id }, data: { reason: block.reason } });
    return { cleared: true };
  },
});

async function unsubscribeTarget(ctx: QueryCtx | MutationCtx, token: string) {
  const message = await noticeForToken(ctx, token);
  if (!message?.memberId || !message.notice) return null;
  const member = await ctx.db.get(message.memberId);
  const company = await ctx.db.get(message.companyId);
  if (!member || !company || member.companyId !== company._id) return null;
  const category = EVENT_INFO[message.notice.event].category;
  const role = roleOf(member.role);
  return { message, member, company, category, role };
}

/** What the link would turn off. Opening the page changes nothing; a mail scanner can't unsubscribe anyone. */
export const unsubscribeInfo = publicQuery({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const target = await unsubscribeTarget(ctx, args.token);
    if (!target) return null;
    const { category, role, member, company } = target;
    const row = await preferencesOf(ctx, company._id, member._id);
    const view = preferenceView(row, role).find((r) => r.category === category)!;
    return { company: company.name, label: CATEGORY_INFO[category].label, about: CATEGORY_INFO[category].about, off: !view.on, locked: view.locked || !CATEGORY_INFO[category].unsubscribable };
  },
});

async function turnOff(ctx: MutationCtx, token: string, via: Via): Promise<{ ok: true } | { ok: false; why: string }> {
  const target = await unsubscribeTarget(ctx, token);
  if (!target) return { ok: false, why: "This unsubscribe link isn't valid. You can change notifications in Selestial's settings." };
  if (!CATEGORY_INFO[target.category].unsubscribable) return { ok: false, why: "Security and account notices can't be turned off." };
  const result = await storeEmail(ctx, { companyId: target.company._id, member: target.member, role: target.role, category: target.category, on: false, via, now: Date.now() });
  if (result.refused) return { ok: false, why: result.refused };
  if (result.changed) await recordEvent(ctx, { companyId: target.company._id, type: "notifications.changed", actor: { kind: "member", memberId: target.member._id }, subject: { table: "members", id: target.member._id }, data: { category: target.category, on: false, via } });
  return { ok: true };
}

/** The page's button, through Selestial's web server. */
export const unsubscribe = serverMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => turnOff(ctx, args.token, "unsubscribe_link"),
});

/** The mail program's own Unsubscribe button (RFC 8058): a POST with the token, and nothing else. */
export const oneClick = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => turnOff(ctx, args.token, "one_click"),
});

/** Plans a notice for everyone it reaches (convex/lib/notify/route.ts). For code where something happened. */
export const notify = internalMutation({
  args: {
    companyId: v.id("companies"),
    event: noticeEventValidator,
    ref: v.optional(v.string()),
    key: v.optional(v.string()),
    facts: v.optional(noticeFactsValidator),
    also: v.optional(v.array(v.id("members"))),
    only: v.optional(v.array(v.id("members"))),
  },
  handler: async (ctx, args) => {
    const { planned, skipped } = await notifyMembers(ctx, args);
    return { planned: planned.length, skipped: skipped.length };
  },
});
