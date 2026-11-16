"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { AgentAvatar } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { FormError, useRun } from "@/components/app/form";
import { ActivityFeed } from "@/components/app/overview/activity-feed";
import { DecisionsScreen } from "@/components/app/screens/decisions";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { PauseCircleIcon, Play } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { addLocalDays, clock, dayName, localDayStart, until, whenLabel } from "@/lib/app/format";
import { linkTo } from "@/lib/app/navigation-helpers";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { GroupBadge, Incomplete, Staffing, type JobRow } from "./shared";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

type Count = { id: string; label: string; jobIds: Id<"jobs">[]; tone: "urgent" | "attention" | "neutral"; where: string | null };

type Task = { taskId: Id<"tasks">; title: string; nextAction: string | null; openQuestion: string | null; dueAt: number; handoffTo: string | null };

function TaskList({ list, empty, now, timezone, onOpen }: { list: Task[]; empty: string; now: number; timezone: string; onOpen: (taskId: Id<"tasks">) => void }) {
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-2">
      {list.map((task) => {
        const due = until(task.dueAt, now);
        return (
          <li key={task.taskId}>
            <button type="button" onClick={() => onOpen(task.taskId)} className="grid w-full gap-0.5 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
              <span className="font-medium text-strong">{task.title}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{task.openQuestion ?? task.nextAction ?? "No next step recorded."}</span>
              <span className={cn("text-xs", due.late ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>
                Due {whenLabel(task.dueAt, now, timezone)} · {due.text}
                {task.handoffTo ? ` · for ${task.handoffTo.replace(/_/g, " ")}, held by a person until that agent exists` : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Dispatch's landing page: where today and tomorrow stand, what needs a person, what Dispatch is doing,
 * and what it did. Every number opens the visits behind it. Nothing here says "all clear" unless the
 * record supports it: what is not set up or not known is said as that.
 */
export function DispatchOverviewScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const open = useDetail();
  const today = localDayStart(now, timezone);
  const tomorrow = addLocalDays(today, 1, timezone);
  const range = now ? { companyId, from: today, to: addLocalDays(today, 2, timezone) } : "skip";
  const overview = useQuery(api.dispatchViews.overview, range);
  const board = useQuery(api.dispatchViews.board, range);
  const readiness = useQuery(api.compliance.readiness, { companyId });
  const activity = useQuery(api.details.activity, now ? { companyId, asOf: now, limit: 60 } : "skip");
  const setPaused = useMutation(api.companies.setPausedAgents);
  const permissions = useQuery(api.permissions.list, { companyId });
  const { busy, error, run } = useRun();
  const [shown, setShown] = useState<string | null>(null);

  if (overview === undefined || board === undefined) {
    return (
      <>
        <PageHeader title="Dispatch" lead="Staffs jobs, manages scheduling and coverage, and monitors service progress." />
        <Skeleton className="h-64 rounded-2xl" />
      </>
    );
  }

  const rows = new Map(board.jobs.map((row) => [row.jobId, row]));
  const live = board.jobs.filter((row) => row.status !== "cancelled");
  const sms = readiness?.operations.find((operation) => operation.key === "sms");
  const unique = (ids: Id<"jobs">[]) => [...new Set(ids)];
  const counts: Count[] = [
    { id: "needs", label: "Need staffing", jobIds: overview.needingCoverage, tone: "urgent", where: linkTo("dispatch.dispatch-board") },
    { id: "partial", label: "Partly staffed", jobIds: overview.partiallyStaffed, tone: "attention", where: linkTo("dispatch.dispatch-board") },
    { id: "approval", label: "Waiting on your approval", jobIds: overview.awaitingApproval, tone: "attention", where: linkTo("approvals") },
    { id: "offers", label: "Offers not answered", jobIds: unique(overview.pendingOffers.map((row) => row.jobId)), tone: "neutral", where: linkTo("dispatch.offers-coverage") },
    { id: "delays", label: "Running late", jobIds: unique(overview.activeDelays.map((row) => row.jobId)), tone: "attention", where: null },
    { id: "checkin", label: "No check-in yet", jobIds: unique(overview.notCheckedIn.map((row) => row.jobId)), tone: "urgent", where: null },
    { id: "cover", label: "Places being covered", jobIds: unique(overview.coverageSearches.map((row) => row.jobId)), tone: "attention", where: linkTo("dispatch.offers-coverage") },
    { id: "review", label: "Completion to review", jobIds: overview.awaitingHandoff, tone: "attention", where: null },
  ];
  const selected = counts.find((count) => count.id === shown) ?? null;

  // The briefing is counted from the same rows the tiles open. It states; it does not reassure.
  const day = (from: number, to: number) => live.filter((row) => row.startsAt >= from && row.startsAt < to);
  const line = (name: string, list: JobRow[]) => {
    if (list.length === 0) return `No visits are scheduled ${name}.`;
    const scheduled = list.filter((row) => row.status === "scheduled");
    const short = scheduled.filter((row) => row.openPlaces > 0);
    const underway = list.filter((row) => row.status === "in_progress").length;
    const closed = list.filter((row) => row.status === "completed").length;
    return `${name[0].toUpperCase()}${name.slice(1)}: ${plural(list.length, "visit")}. ${scheduled.length - short.length} of the ${scheduled.length} still to start ${scheduled.length - short.length === 1 ? "has" : "have"} every cleaner accepted${short.length > 0 ? `, ${short.length} ${short.length === 1 ? "is" : "are"} short` : ""}${underway > 0 ? `; ${underway} underway` : ""}${closed > 0 ? `; ${closed} completed` : ""}.`;
  };
  const briefing = [line("today", day(today, tomorrow)), line("tomorrow", day(tomorrow, addLocalDays(today, 2, timezone)))];
  if (overview.truncated) briefing.push("More than 200 visits fall in these two days, so these counts are not complete.");

  // The one thing to do first, by how soon it bites.
  const firstOf = (ids: Id<"jobs">[]) => ids.map((id) => rows.get(id)).filter((row): row is JobRow => Boolean(row)).sort((a, b) => a.startsAt - b.startsAt)[0];
  const urgent = firstOf(counts[5].jobIds) ?? firstOf(counts[4].jobIds) ?? firstOf(overview.needingCoverage) ?? firstOf(overview.partiallyStaffed);
  const next = overview.paused
    ? { text: "Dispatch is paused. It offers nothing and reminds nobody until it is resumed; visits that need a cleaner are yours to staff.", jobId: null }
    : urgent
      ? { text: `${urgent.customer ?? "A visit"}, ${dayName(urgent.startsAt, timezone)} at ${clock(urgent.startsAt, timezone)}: ${counts[5].jobIds.includes(urgent.jobId) ? "a cleaner has not checked in." : counts[4].jobIds.includes(urgent.jobId) ? "a cleaner is running late." : `${urgent.acceptedCrew} of ${urgent.requiredCrew} cleaners accepted.`}`, jobId: urgent.jobId }
      : overview.awaitingApproval.length > 0
        ? { text: `${plural(overview.awaitingApproval.length, "proposal")} from Dispatch ${overview.awaitingApproval.length === 1 ? "is" : "are"} waiting for your decision.`, jobId: overview.awaitingApproval[0] }
        : overview.awaitingHandoff.length > 0
          ? { text: `${plural(overview.awaitingHandoff.length, "visit")} reported done ${overview.awaitingHandoff.length === 1 ? "is" : "are"} waiting for a person’s review.`, jobId: overview.awaitingHandoff[0] }
          : { text: live.length === 0 ? "Nothing is scheduled for today or tomorrow, so there is nothing for Dispatch to staff." : "Nothing in today’s and tomorrow’s visits is waiting on a person right now.", jobId: null };

  const tasks = [...overview.tasks].sort((a, b) => a.dueAt - b.dueAt);
  const withPerson = tasks.filter((task) => task.withPerson || task.handoffTo !== null || task.status === "needs_decision");
  const withDispatch = tasks.filter((task) => !withPerson.includes(task));
  const did = activity?.filter((event) => event.actor.agent === "dispatch").slice(0, 12);
  const pausedAgents = permissions?.pausedAgents ?? [];

  return (
    <>
      <PageHeader
        title="Dispatch"
        lead="Staffs jobs, manages scheduling and coverage, and monitors service progress."
        actions={
          role === "owner" && permissions ? (
            <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: overview.paused ? pausedAgents.filter((agent) => agent !== "dispatch") : [...pausedAgents, "dispatch"] }))}>
              {overview.paused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
              {overview.paused ? "Resume Dispatch" : "Pause Dispatch"}
            </Button>
          ) : null
        }
      />
      <FormError message={error} />

      <div className="grid gap-5">
        <Panel>
          <div className="flex items-start gap-3">
            <AgentAvatar agent="dispatch" size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={overview.paused ? "warning" : "success"} size="sm">
                  {overview.paused ? "Paused" : "On"}
                </Badge>
                <Badge variant={sms === undefined ? "outline" : sms.state === "ready" ? "success" : sms.state === "blocked" ? "error" : "warning"} size="sm">
                  {sms === undefined ? "Texting: checking" : sms.label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Today is {dayName(today, timezone)} on the company’s clock ({timezone})
                </span>
              </div>
              <div className="mt-3 grid gap-1 text-sm leading-relaxed text-strong">
                {briefing.map((text) => (
                  <p key={text}>{text}</p>
                ))}
                {sms && sms.state !== "ready" ? (
                  <p className="text-warning-foreground">
                    Texting is not ready, so offers and reminders do not reach cleaners by text: {sms.blockers.map((blocker) => blocker.words).join(" ")} Offers still exist and can be answered by a person recording what the cleaner said.
                  </p>
                ) : null}
              </div>
              <div className="mt-4 rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2.5">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">Next</p>
                <p className="mt-1 text-sm font-medium text-strong">{next.text}</p>
                {next.jobId ? (
                  <Button className="mt-2" variant="outline" size="xs" onClick={() => open({ kind: "job", id: next.jobId! })}>
                    Open the visit
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        {overview.truncated ? <Incomplete what="visits" /> : null}

        <section aria-label="Today and tomorrow, counted">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {counts.map((count) => {
              const on = shown === count.id;
              const some = count.jobIds.length > 0;
              return (
                <button
                  key={count.id}
                  type="button"
                  aria-expanded={on}
                  disabled={!some}
                  onClick={() => setShown(on ? null : count.id)}
                  className={cn(
                    "rounded-2xl border bg-card px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500",
                    on ? "border-brand-500/60" : "border-border",
                    some ? "hover:border-brand-500/50" : "cursor-default",
                  )}
                >
                  <span className={cn("block font-heading text-2xl tabular-nums", !some ? "text-muted-foreground" : count.tone === "urgent" ? "text-destructive-foreground" : count.tone === "attention" ? "text-warning-foreground" : "text-strong")}>{count.jobIds.length}</span>
                  <span className="block text-xs font-medium text-muted-foreground">{count.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Counted from today’s and tomorrow’s visits. A zero means none were found in those two days, not that nothing can go wrong.</p>
          {selected ? (
            <Panel className="mt-3" title={`${selected.label} · ${selected.jobIds.length}`} flush action={selected.where ? <Link href={selected.where} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">Open the full screen</Link> : undefined}>
              <ul className="divide-y divide-border">
                {selected.jobIds.map((jobId) => {
                  const row = rows.get(jobId);
                  if (!row) return null;
                  return (
                    <li key={jobId}>
                      <button type="button" onClick={() => open({ kind: "job", id: jobId })} className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-strong">{row.customer ?? "Unknown customer"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.serviceType} · {dayName(row.startsAt, timezone)}, {clock(row.startsAt, timezone)}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Staffing row={row} />
                          <GroupBadge group={row.group} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}
        </section>

        <section aria-labelledby="dispatch-approvals">
          <h2 id="dispatch-approvals" className="mb-3 font-heading text-lg tracking-tight text-strong">
            Waiting on a decision
          </h2>
          <DecisionsScreen department="Operations" />
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-2">
          <Panel title="With a person">
            <TaskList list={withPerson} empty="No Dispatch task is with a person." now={now} timezone={timezone} onOpen={(taskId) => open({ kind: "task", id: taskId })} />
          </Panel>
          <Panel title="With Dispatch">
            <TaskList list={withDispatch} empty={overview.paused ? "Dispatch is paused and is working on nothing." : "Dispatch has no open task of its own."} now={now} timezone={timezone} onOpen={(taskId) => open({ kind: "task", id: taskId })} />
          </Panel>
        </div>

        <Panel title="What Dispatch did">
          {did === undefined ? <Skeleton className="h-24" /> : <ActivityFeed events={did} now={now} timezone={timezone} onOpen={open} empty="Dispatch has done nothing in the company’s latest activity." />}
          <p className="mt-3 text-xs text-muted-foreground">Taken from the company’s 60 most recent events. A visit’s full history is on the visit.</p>
        </Panel>
      </div>
    </>
  );
}
