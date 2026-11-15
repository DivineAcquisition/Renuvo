import Link from "next/link";

import { AgentAvatar, STATE } from "@/components/app/agent";
import { ArrowRight } from "@/components/icons";
import { whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { AgentState, RecordRef, WorkLine } from "../../../../convex/overview";

export type TeamAgent = {
  agent: "sales" | "recruiter" | "dispatch" | "retention";
  name: string;
  responsibility: string;
  state: AgentState;
  counts: { open: number; waiting: number; needsDecision: number };
  lines: WorkLine[];
};
export type TeamDepartment = { id: string; name: string; purpose: string; summary: string; agents: TeamAgent[] };

export const departmentPath = (id: string) => `/app/departments/${id.replace(/_/g, "-")}`;

const WAITING_ON: Record<string, string> = { customer: "customer", cleaner: "cleaner", applicant: "applicant", owner: "owner", other: "outside" };

/** What a task is actually doing, in one line: never "sent", always the next thing and when. */
export function workLine(line: WorkLine, now: number, timezone: string): string {
  if (line.status === "needs_decision") return `Needs your decision by ${whenLabel(line.dueAt, now, timezone)}`;
  if (line.status === "waiting") return `Awaiting ${WAITING_ON[line.waitingOn ?? "other"]} response; follow-up ${line.followUpAt ? whenLabel(line.followUpAt, now, timezone) : "not set"}`;
  return `Next: ${line.nextAction ?? "not set"} · due ${whenLabel(line.dueAt, now, timezone)}`;
}

/** The one line that sums up an agent for the briefing strip. */
export function presenceLine(agent: TeamAgent, now: number, timezone: string): string {
  if (agent.state === "not_built") return "Arrives in a later release";
  if (agent.state === "paused") return "Paused by the owner";
  const first = agent.lines[0];
  if (!first) return "No open work";
  return `${first.title} — ${workLine(first, now, timezone)}`;
}

export function AgentWork({ agent, now, timezone, onOpen, limit = 3 }: { agent: TeamAgent; now: number; timezone: string; onOpen: (ref: RecordRef) => void; limit?: number }) {
  const look = STATE[agent.state];
  return (
    <div className="flex gap-3">
      <AgentAvatar agent={agent.agent} state={agent.state} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium text-strong">{agent.name}</span>
          <span className={cn("text-xs", agent.state === "needs_you" ? "font-medium text-warning-foreground" : "text-muted-foreground")}>{look.label}</span>
        </p>
        {agent.state === "not_built" ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{agent.responsibility} Not built yet.</p>
        ) : agent.lines.length === 0 ? (
          <p className="mt-0.5 text-xs text-muted-foreground">No open work. {agent.responsibility}</p>
        ) : (
          <ul className="mt-1 grid gap-1">
            {agent.lines.slice(0, limit).map((line) => (
              <li key={line.taskId}>
                <button type="button" onClick={() => onOpen({ kind: "task", id: line.taskId })} className="-mx-1.5 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
                  <span className="block truncate text-sm text-strong">{line.title}</span>
                  <span className={cn("block truncate text-xs", line.status === "needs_decision" ? "text-warning-foreground" : "text-muted-foreground")}>{workLine(line, now, timezone)}</span>
                </button>
              </li>
            ))}
            {agent.lines.length > limit ? <li className="text-xs text-muted-foreground">and {agent.lines.length - limit} more</li> : null}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Departments, the agents inside each, and the real state of their work. */
export function TeamAtWork({ departments, now, timezone, onOpen }: { departments: TeamDepartment[]; now: number; timezone: string; onOpen: (ref: RecordRef) => void }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {departments.map((department) => (
        <section key={department.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 sm:p-5">
          <header>
            <h3 className="font-heading text-base tracking-tight text-strong">{department.name}</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">{department.summary}</p>
          </header>
          <div className="mt-4 grid flex-1 content-start gap-4">
            {department.agents.map((agent) => (
              <AgentWork key={agent.agent} agent={agent} now={now} timezone={timezone} onOpen={onOpen} />
            ))}
          </div>
          <Link href={departmentPath(department.id)} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-700 underline-offset-4 hover:underline">
            Open {department.name}
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </section>
      ))}
    </div>
  );
}
