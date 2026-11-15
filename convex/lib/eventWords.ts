/**
 * Turns events into sentences a person can check. The words come from the event's type and the records
 * it points at; nothing here is written by a model. An event type without words is shown by its name.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { AGENT_PROFILES } from "./departments";
import { actionDef } from "./permissionCatalog";
import type { Agent } from "./statuses";
import { when } from "./time";

export type EventRef = { kind: "job"; id: Id<"jobs"> } | { kind: "approval"; id: Id<"approvals"> } | { kind: "task"; id: Id<"tasks"> };

export type Described = {
  id: Id<"events">;
  at: number;
  type: string;
  actor: { kind: "member" | "agent" | "system"; label: string; agent: Agent | null };
  /** What happened, without the actor: "offered the visit to Rosa". */
  text: string;
  ref: EventRef | null;
};

const LEVEL_WORDS: Record<string, string> = { off: "Off", propose: "Propose", execute_and_report: "Execute and report", execute: "Execute" };

export async function describeEvents(ctx: QueryCtx, company: Doc<"companies">, events: Doc<"events">[], asOf: number): Promise<Described[]> {
  const tz = company.timezone;
  const cache = new Map<string, unknown>();
  const get = async <T>(id: string, read: () => Promise<T>): Promise<T> => {
    if (!cache.has(id)) cache.set(id, await read());
    return cache.get(id) as T;
  };
  const doc = async <T extends "jobs" | "cleaners" | "customers" | "assignments" | "tasks" | "approvals" | "members" | "properties">(id: Id<T>) => {
    const found = (await get(id, () => ctx.db.get(id))) as unknown as (Doc<T> & { companyId: Id<"companies"> }) | null;
    // An id that points outside the company is treated as missing.
    return found && found.companyId === company._id ? (found as Doc<T>) : null;
  };
  const visit = async (jobId: Id<"jobs">) => {
    const job = await doc(jobId);
    if (!job) return "a visit";
    const customer = await doc(job.customerId);
    return `the visit ${when(job.startsAt, asOf, tz)} for ${customer?.name ?? "a customer"}`;
  };
  const cleanerName = async (id: Id<"cleaners">) => (await doc(id))?.name ?? "a cleaner";

  const out: Described[] = [];
  for (const event of events) {
    const data = event.data ?? {};
    let actor: Described["actor"];
    if (event.actor.kind === "member") actor = { kind: "member", label: (await doc(event.actor.memberId))?.name ?? "A team member", agent: null };
    else if (event.actor.kind === "agent") actor = { kind: "agent", label: AGENT_PROFILES[event.actor.agent].name, agent: event.actor.agent };
    else actor = { kind: "system", label: "Selestial", agent: null };

    let text: string | null = null;
    let ref: EventRef | null = null;
    const subject = event.subject;
    const [thing, what] = event.type.split(".");

    if (subject.table === "jobs") {
      ref = { kind: "job", id: subject.id };
      const label = await visit(subject.id);
      text =
        { created: `scheduled ${label}`, rescheduled: `moved ${label}`, in_progress: `started ${label}`, completed: `marked ${label} complete`, cancelled: `cancelled ${label}` }[what] ?? null;
    } else if (subject.table === "assignments") {
      const assignment = await doc(subject.id);
      if (assignment) {
        ref = { kind: "job", id: assignment.jobId };
        const [label, name] = [await visit(assignment.jobId), await cleanerName(assignment.cleanerId)];
        const cause = data.cause;
        text =
          {
            offered: `offered ${label} to ${name}`,
            accepted: `recorded that ${name} accepted ${label}`,
            declined: `recorded that ${name} declined ${label}`,
            expired: `closed the offer to ${name} for ${label}: no answer in time`,
            cancelled:
              cause === "job_cancelled" ? `ended ${name}'s assignment because the job was cancelled` : cause === "job_covered" ? `withdrew the offer to ${name}: another cleaner accepted` : `released ${name} from ${label}`,
          }[what] ?? null;
      }
    } else if (subject.table === "tasks") {
      const task = await doc(subject.id);
      ref = { kind: "task", id: subject.id };
      const title = task ? `"${task.title}"` : "a task";
      text =
        {
          opened: `opened ${title}`,
          open: `picked ${title} back up`,
          next_action_set: `set the next step on ${title}`,
          waiting: `is waiting on a response for ${title}`,
          needs_decision: `handed ${title} to a person`,
          done: `closed ${title}`,
          cancelled: `cancelled ${title}`,
        }[what] ?? null;
    } else if (subject.table === "approvals") {
      const approval = await doc(subject.id);
      ref = { kind: "approval", id: subject.id };
      const summary = approval ? `"${approval.summary}"` : "a proposal";
      text = { requested: `proposed ${summary}`, approved: `approved ${summary}`, changed: `changed ${summary}`, skipped: `skipped ${summary}`, expired: `closed ${summary}: nobody decided in time` }[what] ?? null;
    } else if (subject.table === "cleaners") {
      const name = await cleanerName(subject.id);
      text =
        {
          created: `added ${name} as a cleaner`,
          updated: `updated ${name}'s details`,
          status_changed: `marked ${name} as ${String(data.to ?? "changed")}`,
          pay_changed: `changed ${name}'s pay`,
          availability_set: `updated the hours ${name} can work`,
          time_off_added: `added time off for ${name}`,
          time_off_removed: `removed time off for ${name}`,
        }[what] ?? null;
    } else if (subject.table === "customers") {
      const name = (await doc(subject.id))?.name ?? "a customer";
      text = { created: `added ${name} as a customer`, updated: `updated ${name}` }[what] ?? null;
    } else if (subject.table === "properties") {
      text = { created: "added a property", updated: "updated a property" }[what] ?? null;
    } else if (subject.table === "members") {
      const name = (await doc(subject.id))?.name ?? "a person";
      text = { invited: `invited ${name}`, joined: "joined the company", role_changed: `changed ${name}'s role to ${String(data.role ?? "")}`, removed: `removed ${name}` }[what] ?? null;
    } else if (subject.table === "permissions") {
      const def = typeof data.action === "string" ? actionDef(data.action) : undefined;
      text = def ? `set "${def.label}" to ${LEVEL_WORDS[String(data.to)] ?? String(data.to)}` : "changed a permission";
    } else if (subject.table === "companies") {
      text = { created: "created the company", updated: "updated the company's details", agents_paused_changed: data.paused ? `paused ${String(data.paused)}` : "resumed every agent" }[what] ?? null;
    }

    out.push({ id: event._id, at: event.at, type: event.type, actor, text: text ?? `${thing} ${what?.replace(/_/g, " ") ?? ""}`.trim(), ref });
  }
  return out;
}
