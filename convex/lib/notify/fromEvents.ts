/**
 * Which recorded events become notices (docs/email/00-architecture.md §5). Called by recordEvent, the one
 * place every event is written, so every product path that already records what happened sends its notice
 * without each one having to remember to.
 *
 * Only the events listed here do anything. Each plans a notice through notifyMembers, which decides who,
 * whether (their settings), once (dedupe) and when (night hours); what it says is written when it goes.
 * Nothing here can stop the event from being recorded: a notice that can't be planned is skipped.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import type { Actor } from "../events";
import { roleOf } from "../roles";
import type { NoticeFacts } from "./catalog";
import { notifyMembers } from "./route";

const ROLE_WORDS = { owner: "Owner", manager: "Manager", office: "Office" } as const;
const DAY = 86_400_000;
/** The Privacy notice promises deletion within this many days of a company leaving (convex/dataRights.ts). */
const DELETION_DAYS = 90;

export const NOTICE_EVENT_TYPES = new Set([
  "company.created",
  "member.role_changed",
  "member.removed",
  "company.deletion_requested",
  "export.ready",
  "approval.requested",
  "assignment.no_check_in_alerted",
  "assignment.no_show_suspected",
  "billing.past_due",
  "billing.zero_balance",
  "payment.failed",
  // An agent acted on its own at "Execute and report" (Act and notify me).
  "dispatch.reported",
  "sales.reported",
]);

type Recorded = { id: Id<"events">; companyId: Id<"companies">; type: string; actor: Actor; subject: { table: string; id: string }; data?: Record<string, unknown> };

async function actorName(ctx: MutationCtx, actor: Actor): Promise<string> {
  if (actor.kind === "member") return (await ctx.db.get(actor.memberId))?.name ?? "Someone in your company";
  if (actor.kind === "agent") return `The ${actor.agent} agent`;
  return "Selestial";
}

export async function noticesForEvent(ctx: MutationCtx, event: Recorded): Promise<void> {
  const base = { companyId: event.companyId, now: Date.now() };
  const at = Date.now();
  switch (event.type) {
    case "company.created": {
      // Only to the person who created it: the new Owner.
      if (event.actor.kind !== "member") return;
      await notifyMembers(ctx, { ...base, event: "welcome", ref: event.companyId, only: [event.actor.memberId] });
      return;
    }
    case "member.role_changed": {
      const target = await ctx.db.get(event.subject.id as Id<"members">);
      if (!target) return;
      const facts: NoticeFacts = { kind: "role_changed", memberName: target.name, to: ROLE_WORDS[roleOf(String(event.data?.role ?? target.role))], byName: await actorName(ctx, event.actor), at };
      // The Owner, and the person whose access changed.
      await notifyMembers(ctx, { ...base, event: "security_change", key: `role:${event.id}`, facts, also: [target._id] });
      return;
    }
    case "member.removed": {
      const target = await ctx.db.get(event.subject.id as Id<"members">);
      if (!target) return;
      await notifyMembers(ctx, { ...base, event: "security_change", key: `removed:${event.id}`, facts: { kind: "member_removed", memberName: target.name, byName: await actorName(ctx, event.actor), at } });
      return;
    }
    case "company.deletion_requested": {
      await notifyMembers(ctx, { ...base, event: "security_change", key: `deletion:${event.id}`, facts: { kind: "deletion_requested", deleteAfter: at + DELETION_DAYS * DAY, byName: await actorName(ctx, event.actor), at } });
      return;
    }
    case "export.ready": {
      const row = await ctx.db.get(event.subject.id as Id<"dataExports">);
      if (!row) return;
      const requester = await ctx.db.get(row.requestedBy);
      await notifyMembers(ctx, { ...base, event: "security_change", key: `export:${row._id}`, facts: { kind: "export_ready", expiresAt: row.expiresAt, byName: requester?.name ?? "Someone in your company", at }, ...(requester ? { also: [requester._id] } : {}) });
      return;
    }
    case "approval.requested": {
      await notifyMembers(ctx, { ...base, event: "approval_needed", ref: event.subject.id });
      return;
    }
    case "assignment.no_check_in_alerted":
    case "assignment.no_show_suspected": {
      await notifyMembers(ctx, { ...base, event: "dispatch_escalation", ref: event.subject.id, key: event.type === "assignment.no_check_in_alerted" ? "no_check_in" : "no_show" });
      return;
    }
    case "billing.past_due": {
      const account = await ctx.db.get(event.subject.id as Id<"billingAccounts">);
      const period = new Date(at).toISOString().slice(0, 7);
      await notifyMembers(ctx, { ...base, event: "plan_payment_failed", key: period, facts: { planName: planWords(account), failedAt: at } });
      return;
    }
    case "billing.zero_balance": {
      await notifyMembers(ctx, { ...base, event: "credits_exhausted", key: new Date(at).toISOString().slice(0, 10) });
      return;
    }
    case "dispatch.reported":
    case "sales.reported": {
      if (event.actor.kind !== "agent") return;
      const data = event.data ?? {};
      const facts: NoticeFacts = { agent: event.actor.agent, action: typeof data.action === "string" ? data.action : null, kind: typeof data.kind === "string" ? data.kind : null, at };
      for (const key of ["jobId", "cleanerId", "opportunityId"] as const) if (typeof data[key] === "string") facts[key] = data[key] as string;
      await notifyMembers(ctx, { ...base, event: "agent_acted", ref: event.id, facts });
      return;
    }
    case "payment.failed": {
      await notifyMembers(ctx, { ...base, event: "customer_payment_failed", ref: event.subject.id });
      return;
    }
  }
}

function planWords(account: Doc<"billingAccounts"> | null): string {
  const plan = account?.plan;
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : "Selestial";
}
