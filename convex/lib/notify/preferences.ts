/**
 * A member's notification choices (convex/lib/notify/schema.ts). Locked categories are always on, whatever
 * is stored; everything else is what the person last chose, or the category's default.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Role } from "../roles";
import { canTurnOff, CATEGORY_INFO, NOTICE_CATEGORIES, type NoticeCategory } from "./catalog";

type Ctx = QueryCtx | MutationCtx;
export type Via = Doc<"notificationPreferences">["email"][number]["via"];

export async function preferencesOf(ctx: Ctx, companyId: Id<"companies">, memberId: Id<"members">): Promise<Doc<"notificationPreferences"> | null> {
  return ctx.db
    .query("notificationPreferences")
    .withIndex("by_company_member", (q) => q.eq("companyId", companyId).eq("memberId", memberId))
    .first();
}

/** Whether email in this category goes to this person. */
export function emailOn(row: Doc<"notificationPreferences"> | null, category: NoticeCategory, role: Role): boolean {
  if (!canTurnOff(category, role)) return true;
  const stored = row?.email.find((entry) => entry.category === category);
  return stored ? stored.on : CATEGORY_INFO[category].defaultOn;
}

export type PreferenceRow = { category: NoticeCategory; label: string; about: string; on: boolean; locked: boolean; changedAt: number | null };

/** Every category, as this person's settings page shows it. */
export function preferenceView(row: Doc<"notificationPreferences"> | null, role: Role): PreferenceRow[] {
  return NOTICE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_INFO[category].label,
    about: CATEGORY_INFO[category].about,
    on: emailOn(row, category, role),
    locked: !canTurnOff(category, role),
    changedAt: row?.email.find((entry) => entry.category === category)?.at ?? null,
  }));
}

/**
 * Turns one category on or off for one person. A locked category can't be turned off; asking is refused
 * with the reason. Returns whether anything changed.
 */
export async function setEmail(ctx: MutationCtx, input: { companyId: Id<"companies">; member: Doc<"members">; role: Role; category: NoticeCategory; on: boolean; via: Via; now: number }): Promise<{ changed: boolean; refused?: string }> {
  if (!input.on && !canTurnOff(input.category, input.role)) {
    return { changed: false, refused: CATEGORY_INFO[input.category].locked === "owner" ? "The Owner always gets account notices, because nobody else can fix them." : "Security notices are always sent." };
  }
  const row = await preferencesOf(ctx, input.companyId, input.member._id);
  if (emailOn(row, input.category, input.role) === input.on && row?.email.some((entry) => entry.category === input.category)) return { changed: false };
  const entry = { category: input.category, on: input.on, at: input.now, via: input.via };
  if (row) await ctx.db.patch(row._id, { email: [...row.email.filter((e) => e.category !== input.category), entry], updatedAt: input.now });
  else await ctx.db.insert("notificationPreferences", { companyId: input.companyId, memberId: input.member._id, email: [entry], updatedAt: input.now });
  return { changed: true };
}

/** An address Selestial's notices must not go to, with the reason, or null. */
export async function noticeSuppression(ctx: Ctx, address: string): Promise<Doc<"noticeSuppressions"> | null> {
  const rows = await ctx.db
    .query("noticeSuppressions")
    .withIndex("by_address", (q) => q.eq("address", address.trim().toLowerCase()))
    .take(20);
  return rows.find((row) => row.clearedAt === undefined) ?? null;
}

export const SUPPRESSION_WORDS: Record<Doc<"noticeSuppressions">["reason"], string> = {
  bounce: "Email to this address bounced, so Selestial stopped sending notices to it.",
  complaint: "A notice to this address was marked as spam, so Selestial stopped sending notices to it.",
  provider: "The email service won't deliver to this address, so Selestial stopped sending notices to it.",
};
