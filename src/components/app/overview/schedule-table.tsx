import { CheckCircle2, CircleDashed, SirenIcon, UserCheckIcon } from "@/components/icons";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { clock, longDay, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { RecordRef, Visit, VisitState } from "../../../../convex/overview";

export const VISIT_STATE: Record<VisitState, { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  completed: { label: "Completed", variant: "success" },
  in_progress: { label: "In progress", variant: "info" },
  accepted: { label: "Accepted", variant: "success" },
  awaiting_acceptance: { label: "Awaiting acceptance", variant: "warning" },
  needs_coverage: { label: "Coverage at risk", variant: "error" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

/**
 * Who is on the visit. Accepted and offered look different on purpose: a name on a job does not mean
 * the person agreed to do it.
 */
function Crew({ visit, now, timezone }: { visit: Visit; now: number; timezone: string }) {
  if (visit.state === "cancelled") return <span className="text-muted-foreground">—</span>;
  if (visit.state === "needs_coverage") {
    return (
      <span className="flex items-center gap-1.5 font-medium text-destructive-foreground">
        <SirenIcon className="size-4 shrink-0" aria-hidden />
        No cleaner yet
      </span>
    );
  }
  if (visit.state === "awaiting_acceptance") {
    return (
      <span className="flex items-start gap-1.5">
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="text-muted-foreground">Offered to</span> <span className="font-medium text-strong">{visit.cleaner}</span>
          <span className="block text-xs text-muted-foreground">Not accepted{visit.respondBy ? ` · answer due ${whenLabel(visit.respondBy, now, timezone)}` : ""}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      {visit.state === "completed" ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <UserCheckIcon className="size-4 shrink-0 text-success" aria-hidden />}
      <span className="font-medium text-strong">{visit.cleaner ?? "Unknown"}</span>
      {visit.state === "accepted" ? <span className="text-xs text-muted-foreground">accepted</span> : null}
    </span>
  );
}

function Rows({ visits, now, timezone, onOpen }: { visits: Visit[]; now: number; timezone: string; onOpen: (ref: RecordRef) => void }) {
  return (
    <ul className="divide-y divide-border">
      {visits.map((visit) => {
        const state = VISIT_STATE[visit.state];
        return (
          <li key={visit.jobId}>
            <button
              type="button"
              onClick={() => onOpen({ kind: "job", id: visit.jobId })}
              className={cn(
                "grid w-full grid-cols-[4.5rem_1fr] items-start gap-x-3 gap-y-1.5 px-4 py-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:grid-cols-[5rem_minmax(0,1.3fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5",
                visit.state === "cancelled" && "opacity-60",
              )}
            >
              <span className="font-medium tabular-nums text-strong">{clock(visit.startsAt, timezone)}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-strong">{visit.customer}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {visit.serviceType} · {visit.place}
                </span>
              </span>
              <span className="col-start-2 min-w-0 sm:col-start-auto">
                <Crew visit={visit} now={now} timezone={timezone} />
              </span>
              <span className="col-start-2 sm:col-start-auto sm:justify-self-end">
                <Badge variant={state.variant} size="sm">
                  {state.label}
                </Badge>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The service schedule for one day or a week. Opening a row shows the visit in the detail panel. */
export function ScheduleTable({ visits, dayStarts, now, timezone, onOpen, emptyHint }: { visits: Visit[]; dayStarts: number[]; now: number; timezone: string; onOpen: (ref: RecordRef) => void; emptyHint?: React.ReactNode }) {
  if (visits.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm font-medium text-strong">No visits scheduled{dayStarts.length > 1 ? " this week" : ""}.</p>
        {emptyHint ? <div className="mt-2 text-xs text-muted-foreground">{emptyHint}</div> : null}
      </div>
    );
  }
  if (dayStarts.length <= 1) return <Rows visits={visits} now={now} timezone={timezone} onOpen={onOpen} />;
  return (
    <div>
      {dayStarts.map((start, index) => {
        const end = dayStarts[index + 1] ?? Number.POSITIVE_INFINITY;
        const day = visits.filter((visit) => visit.startsAt >= start && visit.startsAt < end);
        if (day.length === 0) return null;
        const open = day.filter((visit) => visit.state === "needs_coverage" || visit.state === "awaiting_acceptance").length;
        return (
          <section key={start}>
            <h3 className="flex items-center justify-between border-y border-border bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground first:border-t-0 sm:px-5">
              {longDay(start, timezone)}
              <span className={cn("font-medium", open > 0 ? "text-warning-foreground" : "text-success-foreground")}>{open > 0 ? `${open} without an accepted cleaner` : "Covered"}</span>
            </h3>
            <Rows visits={day} now={now} timezone={timezone} onOpen={onOpen} />
          </section>
        );
      })}
    </div>
  );
}

export type ScheduleView = "today" | "tomorrow" | "week";

export function ViewSwitch({ view, onChange }: { view: ScheduleView; onChange: (view: ScheduleView) => void }) {
  const options: { id: ScheduleView; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "tomorrow", label: "Tomorrow" },
    { id: "week", label: "Week" },
  ];
  return (
    <div role="tablist" aria-label="Which days to show" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={view === option.id}
          onClick={() => onChange(option.id)}
          className={cn("rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", view === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
