import Link from "next/link";

import { eyebrow } from "@/components/app/agent";
import { ActivityFeed } from "@/components/app/overview/activity-feed";
import { Briefing, type Presence } from "@/components/app/overview/briefing";
import { DecisionCard, NoDecisions } from "@/components/app/overview/decision-card";
import { IndicatorRow, type Indicators } from "@/components/app/overview/indicators";
import { ScheduleTable, type ScheduleView, ViewSwitch } from "@/components/app/overview/schedule-table";
import { presenceLine, TeamAtWork, type TeamDepartment } from "@/components/app/overview/team-at-work";
import { WeekMeasures } from "@/components/app/overview/week-measures";
import { Panel } from "@/components/app/shell";
import { ArrowRight } from "@/components/icons";
import { linkTo } from "@/lib/app/navigation-helpers";
import { Skeleton } from "@/components/ui/skeleton";

import type { Described, EventRef } from "../../../../convex/lib/eventWords";
import type { Decision, Link as RecordLink, Measure, Statement, Visit } from "../../../../convex/overview";

export type OverviewData = {
  firstName: string | null;
  now: number;
  timezone: string;
  today?: { lastChangeAt: number | null; briefing: Statement[]; indicators: Indicators };
  decisions?: Decision[];
  schedule?: { visits: Visit[]; dayStarts: number[] };
  team?: TeamDepartment[];
  activity?: Described[];
  week?: Measure[];
};

const MAX_DECISIONS = 4;

/**
 * The Overview: is today covered, what needs my decision, is the business improving. On a phone the
 * decisions come before the schedule; on a desk they sit beside it.
 */
export function OverviewView({
  data,
  agentsWorking,
  view,
  onView,
  onOpen,
  onLink,
  onApprove,
  approving,
  approveError,
}: {
  data: OverviewData;
  /** "Your agents are working": the Owner's first agent work, when there is any (activation). */
  agentsWorking?: React.ReactNode;
  view: ScheduleView;
  onView: (view: ScheduleView) => void;
  onOpen: (ref: EventRef) => void;
  onLink: (link: RecordLink) => void;
  onApprove: (decision: Decision) => void;
  approving?: string | null;
  approveError?: { id: string; message: string } | null;
}) {
  const { now, timezone, today, decisions, schedule, team, activity, week } = data;
  const presence: Presence[] = (team ?? []).flatMap((department) => department.agents.map((agent) => ({ agent: agent.agent, name: agent.name, state: agent.state, line: presenceLine(agent, now, timezone) })));
  return (
    <div className="grid gap-5">
      {today ? (
        <Briefing firstName={data.firstName} now={now} timezone={timezone} lastChangeAt={today.lastChangeAt} statements={today.briefing} presence={presence} onOpen={onLink} />
      ) : (
        <Skeleton className="h-56 rounded-2xl" />
      )}

      {agentsWorking}

      {today ? (
        <IndicatorRow indicators={today.indicators} now={now} onSchedule={() => onLink({ kind: "view", view: "schedule_today" })} onDecisions={() => onLink({ kind: "view", view: "decisions" })} />
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section id="decisions" className="order-1 scroll-mt-20 xl:order-2" aria-labelledby="decisions-title">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className={eyebrow}>Where you decide</p>
              <h2 id="decisions-title" className="mt-1 font-heading text-xl tracking-tight text-strong">
                Needs your decision{decisions && decisions.length > 0 ? <span className="ml-2 rounded-full bg-warning px-2 py-0.5 align-middle text-xs font-semibold text-white tabular-nums">{decisions.length}</span> : null}
              </h2>
            </div>
            {decisions && decisions.length > MAX_DECISIONS ? (
              <Link href={linkTo("approvals") ?? "/app"} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
                See all {decisions.length}
                <ArrowRight className="size-3" aria-hidden />
              </Link>
            ) : null}
          </div>
          <div className="grid gap-3">
            {decisions === undefined ? (
              <Skeleton className="h-48 rounded-2xl" />
            ) : decisions.length === 0 ? (
              <NoDecisions />
            ) : (
              decisions
                .slice(0, MAX_DECISIONS)
                .map((decision) => (
                  <DecisionCard
                    key={decision.ref.id}
                    decision={decision}
                    now={now}
                    timezone={timezone}
                    busy={approving === decision.ref.id}
                    error={approveError?.id === decision.ref.id ? approveError.message : null}
                    onApprove={onApprove}
                    onOpen={onOpen}
                  />
                ))
            )}
          </div>
        </section>

        <div id="schedule" className="order-2 grid scroll-mt-20 gap-5 xl:order-1">
          <Panel title="Service schedule" action={<ViewSwitch view={view} onChange={onView} />} flush>
            {schedule ? (
              <ScheduleTable
                visits={schedule.visits}
                dayStarts={schedule.dayStarts}
                now={now}
                timezone={timezone}
                onOpen={onOpen}
                emptyHint={
                  <Link href={linkTo("dispatch.schedule") ?? "/app"} className="font-medium text-brand-300 underline-offset-4 hover:underline">
                    Add a visit on the Schedule page
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-2 p-5">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            )}
          </Panel>
          <Panel title="Live activity" action={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="live-pulse size-2 rounded-full bg-success" aria-hidden />Every action, as it happens</span>}>
            {activity ? <ActivityFeed events={activity} now={now} timezone={timezone} onOpen={onOpen} /> : <Skeleton className="h-40" />}
          </Panel>
        </div>
      </div>

      <section aria-labelledby="team-title">
        <div className="mb-3">
          <p className={eyebrow}>What we’re handling</p>
          <h2 id="team-title" className="mt-1 font-heading text-xl tracking-tight text-strong">
            Your team at work
          </h2>
        </div>
        {team ? <TeamAtWork departments={team} now={now} timezone={timezone} onOpen={onOpen} /> : <Skeleton className="h-44 rounded-2xl" />}
      </section>

      <section aria-labelledby="week-title">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className={eyebrow}>Is the business improving</p>
            <h2 id="week-title" className="mt-1 font-heading text-xl tracking-tight text-strong">
              This week
            </h2>
          </div>
          <Link href={linkTo("reports") ?? "/app"} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
            Open Reports
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>
        {week ? <WeekMeasures measures={week} /> : <Skeleton className="h-28 rounded-2xl" />}
        <p className="mt-2 text-xs text-muted-foreground">The last seven days against the seven before. Booked revenue, completed revenue and cash collected are kept apart; only completed revenue can be measured so far.</p>
      </section>
    </div>
  );
}
