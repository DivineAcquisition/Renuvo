/**
 * Onboarding reminders, sent by Recruiter (brief, section 14: track onboarding, chase what is stale). The
 * permission `recruiter.onboarding_reminder` decides whether a reminder is proposed, sent and reported,
 * or sent; every company starts on Propose.
 *
 * Before anything is proposed or sent, and again when an approved proposal is carried out:
 *  - the worker is onboarding or active, and not ended or paused;
 *  - they still have items only they can do (not started, sent back, or expired), not set aside;
 *  - they have a working portal link to finish them in;
 *  - they have no open request for help: a person answers that first;
 *  - fewer reminders than the company allows have gone, and the next one is due by the company's days
 *    since their last progress or reminder;
 *  - it is inside Recruiter's sending hours.
 * Each reminder is named `onboarding.reminder:<worker>:<attempt>`, so whoever asks for it (the sweep, an
 * approval, a person pressing "Remind now"), it is sent once. Silence is never read as a refusal: when
 * reminders run out, the attention list shows the person, and nothing else happens.
 */
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { requestApproval } from "../approvalQueue";
import { authorityFor } from "../authority";
import type { CarriedOut } from "../dispatch/workflow";
import { recordEvent, type Actor } from "../events";
import { messageByKey, queueMessage } from "../messaging/outbox";
import { nextSendTime } from "../recruiter/outbox";
import { recruiterSettings } from "../recruiter/settings";
import { linksOf, portalLinkState } from "./portal";
import { workerFacts, type RequirementFact } from "./requirements";

const DAY = 24 * 60 * 60 * 1000;
export const REMINDER_ACTION = "recruiter.onboarding_reminder";

export function reminderDays(company: Doc<"companies">): number[] {
  const own = company.recruiter?.onboardingReminderDays;
  return (own && own.length > 0 ? own : [2, 5]).filter((days) => Number.isFinite(days) && days > 0).sort((a, b) => a - b).slice(0, 5);
}

export const reminderKey = (cleanerId: Id<"cleaners">, attempt: number) => `onboarding.reminder:${cleanerId}:${attempt}`;

/** Items only the cleaner can move: these are what a reminder is about. */
export function cleanerItems(facts: RequirementFact[]): RequirementFact[] {
  return facts.filter((fact) => !fact.met && fact.requirement.kind !== "agreement" && (fact.state === "not_started" || fact.state === "needs_changes" || fact.state === "expired"));
}

export type ReminderPlan =
  | { due: true; attempt: number; items: RequirementFact[]; link: Doc<"portalLinks"> }
  | { due: false; why: string };

/** Whether a reminder is due for this worker now, and if so which one and about what. */
export async function reminderPlan(ctx: MutationCtx, company: Doc<"companies">, worker: Doc<"cleaners">, now: number, opts: { ignoreTiming?: boolean } = {}): Promise<ReminderPlan> {
  if (worker.status !== "onboarding" && worker.status !== "ready") return { due: false, why: "They are not onboarding or active." };
  const items = cleanerItems(await workerFacts(ctx, worker, now));
  if (items.length === 0) return { due: false, why: "Nothing is left that only they can do." };
  const link = (await linksOf(ctx, worker)).find((row) => row.purpose === "portal" && portalLinkState(row, now) === "active");
  if (!link) return { due: false, why: "They have no working portal link. Invite them first." };
  const help = await ctx.db
    .query("helpRequests")
    .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "open"))
    .take(500);
  if (help.some((row) => row.cleanerId === worker._id)) return { due: false, why: "They asked the office for help. A person answers that first." };
  const days = reminderDays(company);
  let sent = 0;
  let lastReminder = 0;
  for (let attempt = 1; attempt <= days.length; attempt += 1) {
    const message = await messageByKey(ctx, company._id, reminderKey(worker._id, attempt));
    if (!message) break;
    sent = attempt;
    lastReminder = message.queuedAt;
  }
  if (sent >= days.length) return { due: false, why: `${sent} ${sent === 1 ? "reminder has" : "reminders have"} gone, the most the company allows.` };
  const rows = await ctx.db
    .query("workerRequirements")
    .withIndex("by_company_cleaner", (q) => q.eq("companyId", company._id).eq("cleanerId", worker._id))
    .take(200);
  // The clock restarts with their own progress: a reminder follows silence, not effort.
  const lastProgress = Math.max(link.issuedAt, lastReminder, ...rows.map((row) => row.submittedAt ?? 0));
  if (!opts.ignoreTiming && now < lastProgress + days[sent] * DAY) return { due: false, why: "Not due yet." };
  return { due: true, attempt: sent + 1, items, link };
}

/** Plans the reminder text. Checked again in full first, so an approval decided late sends nothing stale. */
export async function sendOnboardingReminder(ctx: MutationCtx, cleanerId: Id<"cleaners">, attempt: number, actor: Actor, opts: { ignoreTiming?: boolean } = {}): Promise<CarriedOut> {
  const worker = await ctx.db.get(cleanerId);
  const company = worker ? await ctx.db.get(worker.companyId) : null;
  if (!worker || !company) return { ok: false, detail: "The worker is no longer on record." };
  const plan = await reminderPlan(ctx, company, worker, Date.now(), opts);
  if (!plan.due) return { ok: false, detail: `No reminder was sent: ${plan.why}` };
  if (plan.attempt !== attempt) return { ok: false, detail: "No reminder was sent: this reminder was already sent or replaced." };
  const names = plan.items.map((fact) => fact.requirement.label);
  const message = await queueMessage(ctx, {
    companyId: company._id,
    purpose: "onboarding_reminder",
    cleaner: worker,
    portalLinkId: plan.link._id,
    body: `${company.name}: a reminder to finish your onboarding: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}. Open {link} to do it, or reply if you need help.`,
    dedupeKey: reminderKey(worker._id, attempt),
    actor,
  });
  await recordEvent(ctx, { companyId: company._id, type: "cleaner.onboarding_reminder", actor, subject: { table: "cleaners", id: worker._id }, data: { attempt, status: message.status } });
  if (message.status === "not_sent" || message.status === "failed") return { ok: false, detail: `The reminder was not sent: ${message.problem ?? "the text could not go"}` };
  return { ok: true, detail: `Reminder ${attempt} ${message.status === "held" ? "is held until sending hours" : "was sent"} about ${names.join(", ")}.` };
}

/**
 * The hourly sweep. For each worker with a reminder due: Off sends nothing; Propose puts one proposal in
 * the approval queue (once per reminder); Execute sends it.
 */
export async function reminderSweep(ctx: MutationCtx, now: number): Promise<number> {
  let acted = 0;
  const companies = await ctx.db.query("companies").take(500);
  for (const company of companies) {
    if (company.suspendedAt !== undefined) continue;
    const authority = await authorityFor(ctx, company._id, REMINDER_ACTION);
    if (authority.kind !== "level" || authority.level === "off") continue;
    // Inside Recruiter's sending hours only; outside them the next sweep tries again.
    if (nextSendTime(now, company.timezone, recruiterSettings(company)) > now) continue;
    const requirements = await ctx.db
      .query("onboardingRequirements")
      .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", "active"))
      .take(1);
    if (requirements.length === 0) continue;
    for (const status of ["onboarding", "ready"] as const) {
      const workers = await ctx.db
        .query("cleaners")
        .withIndex("by_company_status", (q) => q.eq("companyId", company._id).eq("status", status))
        .take(500);
      for (const worker of workers) {
        const plan = await reminderPlan(ctx, company, worker, now);
        if (!plan.due) continue;
        if (authority.level === "propose") {
          const pending = await ctx.db
            .query("approvals")
            .withIndex("by_company_status_decideBy", (q) => q.eq("companyId", company._id).eq("status", "pending"))
            .take(500);
          if (pending.some((row) => row.proposal?.kind === "send_onboarding_reminder" && row.proposal.cleanerId === worker._id && row.proposal.attempt === plan.attempt)) continue;
          await requestApproval(ctx, {
            companyId: company._id,
            action: REMINDER_ACTION,
            summary: `Text ${worker.name} a reminder about onboarding (${plan.attempt} of ${reminderDays(company).length})`,
            reason: `Still to do: ${plan.items.map((fact) => fact.requirement.label).join(", ")}. No progress since the last invitation or reminder.`,
            authorizes: `One text to ${worker.name} through the company's number, with their portal link. It is checked again when you approve.`,
            ifWaiting: "Nothing is sent. The reminder is offered again at the next sweep if it is still due.",
            decideBy: now + 2 * DAY,
            proposal: { kind: "send_onboarding_reminder", cleanerId: worker._id, attempt: plan.attempt },
            about: { table: "cleaners", id: worker._id },
          });
        } else {
          await sendOnboardingReminder(ctx, worker._id, plan.attempt, { kind: "agent", agent: "recruiter" });
        }
        acted += 1;
      }
    }
  }
  return acted;
}
