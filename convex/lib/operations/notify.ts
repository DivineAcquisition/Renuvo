/**
 * Who hears about an incident, and when (docs/operations/04-owner-recovery.md). Called each time an
 * incident opens, changes or resolves; it decides from the incident itself and remembers on it who was
 * told, so a check that runs every five minutes never tells anyone twice.
 *
 * The company's Owner and Managers, in the app:
 *  - when they must act (waiting for the owner);
 *  - when a serious interruption begins (high or critical, being handled by Selestial or a provider);
 *  - when Selestial's own retries ran out and its team took over;
 *  - when a problem they were told about is fixed.
 * The Owner by email: once per problem, when they must act or when an interruption is critical; never for
 * a retry. Kinds that already send their own email (inbox reconnect, texting) are not emailed twice.
 *
 * Selestial staff: a queued alert, grouped into one message per person by the sender (alerts.ts), when an
 * incident is critical, needs staff at high severity, exhausts its automatic recovery, or a company asks.
 *
 * Notices to a company's people are free: they never use its messaging balance.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { noticeInApp } from "../activation/notices";
import { notifyMembers } from "../notify/route";
import { severityRank } from "./catalog";
import { NO_EMAIL_KINDS, OWN_EMAIL_KINDS, ownerCard } from "./owner";

type Notified = NonNullable<Doc<"incidents">["notified"]>;
type StaffReason = Doc<"staffAlerts">["reason"];

export async function queueStaffAlert(ctx: MutationCtx, incidentId: Id<"incidents">, reason: StaffReason, now: number) {
  await ctx.db.insert("staffAlerts", { incidentId, reason, at: now, sentAt: 0 });
}

/** After an incident was written. `before` is how it was, or null for a new one. */
export async function afterIncidentChange(ctx: MutationCtx, before: Doc<"incidents"> | null, incidentId: Id<"incidents">, now: number) {
  const incident = await ctx.db.get(incidentId);
  if (!incident) return;
  const notified: Notified = { ...(incident.notified ?? {}) };
  const opened = incident.openedAt ?? incident._creationTime;
  const key = (phase: string) => `incident:${incident._id}:${phase}:${opened}`;
  const serious = severityRank(incident.severity) <= severityRank("high");
  const wasAutomatic = before !== null && (before.state === "recovering" || before.state === "investigating");

  // ── Selestial staff ───────────────────────────────────────────────────────────────────────────
  if (incident.resolvedAt === 0 && !notified.staff) {
    const reason: StaffReason | null =
      incident.severity === "critical" ? "critical" : wasAutomatic && incident.state === "needs_staff" ? "recovery_exhausted" : incident.state === "needs_staff" && serious ? "needs_staff" : null;
    if (reason) {
      await queueStaffAlert(ctx, incident._id, reason, now);
      notified.staff = now;
    }
  }

  // ── The company ───────────────────────────────────────────────────────────────────────────────
  const card = ownerCard(incident);
  if (incident.companyId && card) {
    const companyId = incident.companyId;
    const facts = { title: card.title, affected: card.affected, done: card.done, actionLabel: card.action.kind === "link" ? card.action.label : null, actionPath: card.action.kind === "link" ? card.action.href : "/app" };
    const email = async () => {
      if (notified.emailed || OWN_EMAIL_KINDS.has(incident.kind) || NO_EMAIL_KINDS.has(incident.kind)) return;
      await notifyMembers(ctx, { companyId, event: "service_attention", ref: incident._id, key: String(opened), facts, now });
      notified.emailed = now;
    };

    if (incident.resolvedAt !== 0) {
      // Fixed: told only to those who heard about it.
      if (notified.action || notified.interruption || notified.escalated) {
        await noticeInApp(ctx, { companyId, kind: "service_recovered", headline: `Fixed: ${card.title.charAt(0).toLowerCase()}${card.title.slice(1)}`, summary: "Selestial checked that it's working again. Nothing needs doing.", key: key("resolved") });
      }
    } else {
      if (incident.state === "waiting_owner" && !notified.action) {
        await noticeInApp(ctx, { companyId, kind: "service_issue", headline: card.title, summary: card.affected, key: key("action") });
        notified.action = now;
        await email();
      } else if (serious && incident.state !== "waiting_owner" && !notified.interruption) {
        await noticeInApp(ctx, { companyId, kind: "service_issue", headline: card.title, summary: `${card.affected} ${card.done}`, key: key("interruption") });
        notified.interruption = now;
        if (incident.severity === "critical") await email();
      }
      if (wasAutomatic && incident.state === "needs_staff" && !notified.escalated && (notified.interruption || notified.action)) {
        await noticeInApp(ctx, { companyId, kind: "service_issue", headline: card.title, summary: "Selestial's automatic retries didn't fix it, so its team has taken over.", key: key("escalated") });
        notified.escalated = now;
      }
    }
  }

  if (JSON.stringify(notified) !== JSON.stringify(incident.notified ?? {})) await ctx.db.patch(incident._id, { notified });
}
