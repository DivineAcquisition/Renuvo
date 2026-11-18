/**
 * Turning something that happened into notices for the right people (convex/lib/notify/catalog.ts).
 *
 * A notice is a row in the shared outbox (`messages`, purpose "member_notice"), so it is planned once,
 * sent once, retried and tracked like every other message. What it says is written only at the moment it
 * goes (convex/lib/notify/compose.ts), from the records as they are then.
 *
 *  - Who: the active members whose role the event reaches, plus anyone named (the person who connected
 *    an inbox). Never a member of another company.
 *  - Whether: their notification settings, except for locked categories.
 *  - Once: one notice per event, record and person (`dedupeKey`), however often the event is reported.
 *  - When: critical notices at once; others wait out the night on the company's clock.
 *
 * Planning a notice costs no AI credits and writes no message text into the event log.
 */
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { emailProvider } from "../email/provider";
import { recordEvent } from "../events";
import { quietUntil } from "../messaging/policy";
import { roleOf } from "../roles";
import { CATEGORY_INFO, EVENT_INFO, NIGHT, rolesFor, type NoticeEvent, type NoticeFacts } from "./catalog";
import { emailOn, noticeSuppression, preferencesOf, SUPPRESSION_WORDS } from "./preferences";

export type NoticeInput = {
  companyId: Id<"companies">;
  event: NoticeEvent;
  /** The record it's about (an approval, a mailbox, an assignment), as an id string. */
  ref?: string;
  /** What makes this notice different from another about the same record, e.g. the kind of escalation. */
  key?: string;
  facts?: NoticeFacts;
  /** Members who get it whatever their role, such as the person who connected the inbox it's about. */
  also?: Id<"members">[];
  /** Only these members (e.g. the person whose own access changed). Still checked against the company. */
  only?: Id<"members">[];
  now?: number;
};

export type Planned = { memberId: Id<"members">; messageId: Id<"messages">; status: Doc<"messages">["status"] };
export type Skipped = { memberId: Id<"members">; why: "settings" | "duplicate" | "no_address" };

export function noticeKey(input: Pick<NoticeInput, "event" | "ref" | "key">, memberId: Id<"members">): string {
  return `notice:${input.event}:${input.ref ?? "-"}:${input.key ?? "-"}:${memberId}`;
}

/** The members a notice reaches: active, in this company, by role or by name. */
export async function recipientsFor(ctx: MutationCtx, input: NoticeInput): Promise<Doc<"members">[]> {
  const members = await ctx.db
    .query("members")
    .withIndex("by_company", (q) => q.eq("companyId", input.companyId))
    .take(500);
  const active = members.filter((m) => m.status === "active");
  if (input.only) return active.filter((m) => input.only!.includes(m._id));
  const roles = rolesFor(EVENT_INFO[input.event].audience);
  return active.filter((m) => roles.includes(roleOf(m.role)) || (input.also ?? []).includes(m._id));
}

/** Plans the notice for everyone it reaches. Returns what was planned and who was left out, and why. */
export async function notifyMembers(ctx: MutationCtx, input: NoticeInput): Promise<{ planned: Planned[]; skipped: Skipped[] }> {
  const company = await ctx.db.get(input.companyId);
  if (!company) return { planned: [], skipped: [] };
  const info = EVENT_INFO[input.event];
  const now = input.now ?? Date.now();
  const provider = emailProvider();
  const planned: Planned[] = [];
  const skipped: Skipped[] = [];

  for (const member of await recipientsFor(ctx, input)) {
    const role = roleOf(member.role);
    if (!emailOn(await preferencesOf(ctx, input.companyId, member._id), info.category, role)) {
      skipped.push({ memberId: member._id, why: "settings" });
      continue;
    }
    const dedupeKey = noticeKey(input, member._id);
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_company_dedupe", (q) => q.eq("companyId", input.companyId).eq("dedupeKey", dedupeKey))
      .first();
    if (existing) {
      skipped.push({ memberId: member._id, why: "duplicate" });
      continue;
    }
    const to = member.email.trim().toLowerCase();
    if (!to.includes("@")) {
      skipped.push({ memberId: member._id, why: "no_address" });
      continue;
    }
    // Reasons it can't go, in order. Each is kept on the row in words, so the record says why.
    const suppressed = await noticeSuppression(ctx, to);
    const problem = !provider ? "Email is not connected." : suppressed ? SUPPRESSION_WORDS[suppressed.reason] : null;
    const waitUntil = !problem && info.priority !== "critical" ? quietUntil(now, company.timezone, NIGHT) : null;
    const status: Doc<"messages">["status"] = problem ? "not_sent" : waitUntil !== null ? "held" : "queued";
    const messageId = await ctx.db.insert("messages", {
      companyId: input.companyId,
      purpose: "member_notice",
      channel: "email",
      memberId: member._id,
      notice: { event: input.event, ...(input.ref ? { ref: input.ref } : {}), ...(input.facts ? { facts: input.facts } : {}) },
      to,
      // The words are written when it goes, from the records as they are then.
      body: "",
      subject: "",
      dedupeKey,
      status,
      attempts: 0,
      provider: provider?.name,
      problem: problem ?? (waitUntil !== null ? `Waiting for the morning: only critical notices go overnight. It goes at the end of ${NIGHT.start}–${NIGHT.end} company time.` : undefined),
      refusal: suppressed ? "suppressed" : undefined,
      queuedAt: now,
    });
    await recordEvent(ctx, {
      companyId: input.companyId,
      type: `message.${status}`,
      actor: { kind: "system" },
      subject: { table: "messages", id: messageId },
      data: { purpose: "member_notice", event: input.event, category: info.category, memberId: member._id, ...(waitUntil !== null ? { retryAt: waitUntil } : {}) },
    });
    if (status === "queued") await ctx.scheduler.runAfter(0, internal.messaging.deliver, { messageId });
    if (status === "held") await ctx.scheduler.runAt(waitUntil!, internal.messaging.deliver, { messageId });
    planned.push({ memberId: member._id, messageId, status });
  }
  return { planned, skipped };
}

/** Whether a notice in this category may carry an unsubscribe link for this person. */
export function unsubscribable(event: NoticeEvent): boolean {
  return CATEGORY_INFO[EVENT_INFO[event].category].unsubscribable;
}
