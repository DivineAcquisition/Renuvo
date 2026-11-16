"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { STATE, eyebrow } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { ScheduleTable } from "@/components/app/overview/schedule-table";
import { AgentWork } from "@/components/app/overview/team-at-work";
import { WeekMeasures } from "@/components/app/overview/week-measures";
import { DecisionsScreen } from "@/components/app/screens/decisions";
import { CleanersPanel } from "@/components/app/screens/records";
import { ScheduleBoard } from "@/components/app/screens/schedule";
import { NotBuilt, PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

type Tool = { id: string; label: string };
const TOOLS: Record<string, Tool[]> = {
  operations: [
    { id: "coverage", label: "Coverage" },
    { id: "schedule", label: "Schedule" },
    { id: "cleaners", label: "Cleaners" },
  ],
  growth: [
    { id: "pipeline", label: "Pipeline" },
    { id: "customers", label: "Customers needing attention" },
  ],
  team: [{ id: "recruiting", label: "Recruiting" }],
};

/** The next seven days, only the visits nobody has accepted. */
function Coverage() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const week = useQuery(api.overview.schedule, now ? { companyId, asOf: now, view: "week" } : "skip");
  if (!week) return <Skeleton className="h-32 rounded-2xl" />;
  const gaps = week.visits.filter((visit) => visit.state === "needs_coverage" || visit.state === "awaiting_acceptance" || visit.state === "partly_staffed");
  return (
    <Panel title="Visits short of an accepted cleaner, next seven days" flush>
      {gaps.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Every visit in the next seven days has every cleaner it needs, accepted.</p>
      ) : (
        <ScheduleTable visits={gaps} dayStarts={week.dayStarts} now={now} timezone={timezone} onOpen={open} />
      )}
    </Panel>
  );
}

function Tools({ department, tool }: { department: string; tool: string }) {
  if (department === "operations") {
    if (tool === "coverage") return <Coverage />;
    if (tool === "schedule") return <ScheduleBoard initial="tomorrow" />;
    return <CleanersPanel />;
  }
  if (department === "team") {
    return <NotBuilt title="Recruiting is not built yet" body="The Recruiter turns Dispatch's staffing gaps into a recruiting priority, moves applicants through your requirements and onboarding, and brings candidates to you to decide." points={["Applicants awaiting review", "Interviews scheduled", "Onboarding incomplete"]} />;
  }
  if (tool === "pipeline") {
    return <NotBuilt title="The sales pipeline is not built yet" body="The Sales agent will take an inquiry through the details the price needs, a quote from your pricing rules, a capacity check with Operations, and a booking." points={["Quotes awaiting replies", "Follow-ups due", "Bookings confirmed against capacity"]} />;
  }
  return <NotBuilt title="The customer workspace is not built yet" body="Retention will follow every visit with feedback, open a service issue for anyone unhappy, and propose recurring service only when nothing is unresolved." points={["Open service concerns", "Recurring offers awaiting replies", "Customers who have gone quiet"]} />;
}

/**
 * A department is a workspace with the same layout everywhere: summary, the agents assigned to it, the
 * work queue, the decisions it needs, its own tools, and its results.
 */
export function DepartmentScreen({ id }: { id: string }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const team = useQuery(api.overview.team, { companyId });
  const week = useQuery(api.overview.week, now ? { companyId, asOf: now } : "skip");
  const tools = TOOLS[id] ?? [];
  const [tool, setTool] = useState(tools[0]?.id ?? "");
  const department = team?.departments.find((row) => row.id === id);
  if (team && !department) return <NotBuilt title="There is no department here" body="Selestial has three departments: Growth, Operations and Team." />;
  if (!department) return <Skeleton className="h-64 rounded-2xl" />;
  const results = week?.measures.filter((measure) => (id === "operations" ? ["completed_visits", "coverage_gaps"].includes(measure.key) : id === "growth" ? ["conversion", "recurring", "issues"].includes(measure.key) : false));
  return (
    <>
      <PageHeader title={department.name} lead={department.purpose} />
      <div className="grid gap-5">
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Panel title="Summary">
            <p className="text-sm leading-relaxed text-strong">{department.summary}</p>
            <p className={cn(eyebrow, "mt-5")}>Assigned agents</p>
            <ul className="mt-2 grid gap-2">
              {department.agents.map((agent) => (
                <li key={agent.agent} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm">
                  <span className="font-medium text-strong">{agent.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {STATE[agent.state].label}
                    {agent.state !== "not_built" ? ` · ${agent.counts.open} in progress · ${agent.counts.waiting} waiting · ${agent.counts.needsDecision} for you` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Work queue">
            <div className="grid gap-5">
              {department.agents.map((agent) => (
                <AgentWork key={agent.agent} agent={agent} now={now} timezone={timezone} onOpen={open} limit={8} />
              ))}
            </div>
          </Panel>
        </div>

        <section aria-labelledby="department-decisions">
          <h2 id="department-decisions" className="mb-3 font-heading text-lg tracking-tight text-strong">
            Decisions
          </h2>
          <DecisionsScreen department={department.name} />
        </section>

        <section aria-labelledby="department-tools">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="department-tools" className="font-heading text-lg tracking-tight text-strong">
              Workspace
            </h2>
            {tools.length > 1 ? (
              <div role="tablist" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
                {tools.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="tab"
                    aria-selected={tool === option.id}
                    onClick={() => setTool(option.id)}
                    className={cn("rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", tool === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <Tools department={id} tool={tool} />
        </section>

        <section aria-labelledby="department-results">
          <h2 id="department-results" className="mb-3 font-heading text-lg tracking-tight text-strong">
            Results
          </h2>
          {results ? <WeekMeasures measures={results} /> : <Skeleton className="h-24 rounded-2xl" />}
        </section>
      </div>
    </>
  );
}
