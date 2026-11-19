"use client";

/**
 * Retention's overview: who needs the owner, what the agent is working, which commitments are late,
 * which renewal decisions are coming, and what recent cases actually came to. Every number is a count of
 * records with its denominator and period; where Selestial does not hold the data, the page says so.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { CheckCircle2, PauseCircleIcon, Play, RefreshCw } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money, whenLabel } from "@/lib/app/format";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { CaseDrawer } from "./drawer";
import { CaseCardView, Empty, NotConnected, OpenLink, plural, RETENTION_PATH, RetentionStatusHeader, Stat, StatusPill, useCaseParam, type Measure, type Overview } from "./shared";

const LEAD = "Notices when a customer relationship needs attention, coordinates the response, and follows through until the outcome is clear.";

function MeasureTile({ measure }: { measure: Measure }) {
  const figure =
    measure.empty !== null && measure.numerator === null && measure.value === null
      ? "No figure yet"
      : measure.unit === "ratio"
        ? `${measure.numerator} of ${measure.denominator}`
        : measure.unit === "days"
          ? `${measure.value} ${measure.value === 1 ? "day" : "days"}`
          : measure.unit === "cents"
            ? money(measure.value ?? 0)
            : String(measure.value);
  const none = figure === "No figure yet";
  return (
    <li className="grid content-start gap-2 rounded-xl border border-border bg-background p-4">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{measure.label}</p>
      <p className={cn("font-heading tracking-tight tabular-nums", none ? "text-base text-muted-foreground" : "text-2xl leading-none text-strong")}>{figure}</p>
      {measure.unit === "days" && measure.denominator ? <p className="text-xs text-muted-foreground">Across {plural(measure.denominator, "case")}</p> : null}
      {measure.breakdown.length ? (
        <ul className="grid gap-0.5 text-xs text-muted-foreground">
          {measure.breakdown.map((row) => (
            <li key={row.label} className="flex justify-between gap-3">
              <span>{row.label}</span>
              <span className="font-medium text-strong tabular-nums">{measure.unit === "cents" ? money(row.count) : row.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">{none ? measure.empty : measure.meaning}</p>
      <p className="text-[11px] text-muted-foreground/80">{measure.period}</p>
    </li>
  );
}

function briefingOf(overview: Overview): { briefing: string[]; next: string } {
  const c = overview.counts;
  const briefing = [
    c.open === 0 ? "No case is open. That is what the record shows; it does not mean every customer is satisfied." : `${plural(c.open, "open case")}: ${c.needsOwner} waiting on you, ${c.working} being worked or waiting on a customer.`,
    c.overdue > 0 ? `${plural(c.overdue, "commitment")} past ${c.overdue === 1 ? "its" : "their"} deadline.` : null,
    c.signals > 0 ? `${plural(c.signals, "signal")} from the records that nobody has picked up yet.` : null,
  ].filter((line): line is string => Boolean(line));
  const first = overview.needsOwner[0];
  const next = overview.paused
    ? "Retention is paused. It reads nothing and sends nothing; completed visits and customer texts wait until you resume it."
    : first
      ? `${first.customer}: ${first.needs ?? first.doing}`
      : overview.overdue[0]
        ? `${overview.overdue[0].customer}: a commitment is past its deadline.`
        : c.signals > 0
          ? "Look at what the records show under Needs Attention."
          : c.open > 0
            ? "Nothing is waiting on you. Retention is waiting on customers, Dispatch or a deadline."
            : "Nothing is open. Retention starts when a first service is completed, a customer reports a problem, or the records disagree.";
  return { briefing, next };
}

export function RetentionOverviewScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const { openId, open, close } = useCaseParam();
  const overview = useStableQuery(api.retentionAgent.overview, now ? { companyId, asOf: now } : "skip");
  const report = useStableQuery(api.retentionAgent.outcomes, now ? { companyId, asOf: now } : "skip");
  const permissions = useQuery(api.permissions.list, { companyId });
  const setPaused = useMutation(api.companies.setPausedAgents);
  const reconcile = useMutation(api.retentionAgent.reconcileNow);
  const { busy, error, run } = useRun();
  const reading = useRun();

  if (!overview) {
    return (
      <>
        <PageHeader title="Retention" lead={LEAD} />
        <div className="grid gap-5" aria-busy="true" aria-label="Loading Retention">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </>
    );
  }

  const counts = overview.counts;
  const pausedAgents = permissions?.pausedAgents ?? [];
  const { briefing, next } = briefingOf(overview);
  const first = overview.needsOwner[0];

  return (
    <>
      <PageHeader
        title="Retention"
        lead={LEAD}
        actions={
          <>
            {role !== "office" ? (
              <Button variant="outline" size="sm" loading={reading.busy} disabled={overview.paused} onClick={() => void reading.run(() => reconcile({ companyId }))} title="Read the records again now instead of waiting for the next scheduled check">
                <RefreshCw aria-hidden />
                Check the records now
              </Button>
            ) : null}
            {role === "owner" && permissions ? (
              <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: overview.paused ? pausedAgents.filter((agent) => agent !== "retention") : [...pausedAgents, "retention"] }))}>
                {overview.paused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
                {overview.paused ? "Resume Retention" : "Pause Retention"}
              </Button>
            ) : null}
          </>
        }
      />
      <FormError message={error ?? reading.error} />
      <div className="grid gap-5">
        <RetentionStatusHeader
          overview={overview}
          briefing={briefing}
          next={next}
          action={
            first ? (
              <Button size="sm" variant="primary" onClick={() => open(first.caseId)}>
                Open the case
              </Button>
            ) : null
          }
        />

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Needs you" value={String(counts.needsOwner)} hint="Cases waiting on a person" href={`${RETENTION_PATH}/needs-attention`} tone={counts.needsOwner ? "warn" : undefined} />
          <Stat label="Being worked" value={String(counts.working)} hint="Under way or waiting on a customer" href={`${RETENTION_PATH}/recovery`} />
          <Stat label="Overdue" value={String(counts.overdue)} hint="Commitments past their deadline" href={`${RETENTION_PATH}/needs-attention`} tone={counts.overdue ? "warn" : undefined} />
          <Stat label="Signals" value={String(counts.signals)} hint="From the records, not yet picked up" href={`${RETENTION_PATH}/needs-attention`} />
          <Stat label="Renewals" value={String(counts.renewals)} hint="Decisions coming up" href={`${RETENTION_PATH}/continuity-renewals`} />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title={`Needs you · ${counts.needsOwner}`} action={counts.needsOwner > overview.needsOwner.length ? <OpenLink href={`${RETENTION_PATH}/needs-attention`}>See all</OpenLink> : undefined}>
            {overview.needsOwner.length ? (
              <div className="grid gap-3">
                {overview.needsOwner.map((card) => (
                  <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} />
                ))}
              </div>
            ) : (
              <Empty title="Nothing is waiting on you" body="A case appears here when a remedy needs your approval, the record does not settle what happened, or a concern is one a person has to handle." />
            )}
          </Panel>
          <Panel title={`Retention is working · ${counts.working}`}>
            {overview.working.length ? (
              <div className="grid gap-3">
                {overview.working.map((card) => (
                  <CaseCardView key={card.caseId} card={card} now={now} timezone={timezone} onOpen={open} />
                ))}
              </div>
            ) : (
              <Empty title="No case is under way" body="Work appears here when a correction is with Dispatch, a question is with a customer, or a correction is done and Retention is waiting to hear whether it worked." />
            )}
          </Panel>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title={`Overdue commitments · ${counts.overdue}`}>
            {overview.overdue.length ? (
              <ul className="grid gap-2">
                {overview.overdue.map((card) => (
                  <li key={card.caseId}>
                    <button type="button" onClick={() => open(card.caseId)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/30 bg-background px-3.5 py-3 text-left hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-strong">{card.title}</span>
                        <span className="block text-xs text-destructive-foreground">Was due {whenLabel(card.dueAt, now, timezone)}</span>
                      </span>
                      <StatusPill status={card.status} words={card.statusWords} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No commitment is past its deadline" body="Every open case has a next step and a due time. One that passes its time is listed here until someone moves it." />
            )}
          </Panel>
          <Panel title="Upcoming renewal decisions" action={<OpenLink href={`${RETENTION_PATH}/continuity-renewals`}>Continuity &amp; Renewals</OpenLink>}>
            {overview.renewals.length ? (
              <ul className="grid gap-2">
                {overview.renewals.map((row) => (
                  <li key={row.caseId}>
                    <button type="button" onClick={() => open(row.caseId)} className="grid w-full gap-1 rounded-xl border border-border bg-background px-3.5 py-3 text-left hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-strong">{row.customer}</span>
                        <StatusPill status={row.caseStatus} words={row.statusWords} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.title} · {row.words}
                      </span>
                      <span className={cn("text-xs", row.noticePassed ? "font-medium text-destructive-foreground" : "text-strong")}>{row.noticeBy ? `Notice due by ${row.noticeBy}${row.noticePassed ? " (passed)" : ""}` : "No notice period is recorded on the agreement"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No renewal decision is coming up" body="A signed customer agreement with an end of term or renewal date appears here ahead of its notice deadline, with a service review assembled from the term's records." />
            )}
          </Panel>
        </div>

        <Panel title="Recent outcomes" action={<span className="text-xs text-muted-foreground">Cases closed in the last 30 days</span>}>
          {overview.outcomes.length ? (
            <ul className="grid gap-2">
              {overview.outcomes.map((card) => (
                <li key={card.caseId}>
                  <button type="button" onClick={() => open(card.caseId)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-background px-3.5 py-3 text-left hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                    {card.outcome?.verified ? <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden /> : <span aria-hidden className="size-2 shrink-0 rounded-full border border-muted-foreground" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-strong">{card.title}</span>
                      <span className="block text-xs text-muted-foreground">{card.outcome?.words}</span>
                    </span>
                    <Badge variant={card.outcome?.verified ? "success" : "outline"} size="sm">
                      {card.outcome?.verified ? "Verified" : "Not verified"}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No case has closed yet" body="A case closes with what actually happened: the customer confirmed, the customer did not answer, the customer chose to cancel, or the outcome is unknown. Each is listed under its own name." />
          )}
        </Panel>

        <Panel title="What the records show" action={<span className="text-xs text-muted-foreground">Counts of records, with what each is out of</span>}>
          {report ? (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {report.measures.map((measure) => (
                <MeasureTile key={measure.key} measure={measure} />
              ))}
            </ul>
          ) : (
            <Skeleton className="h-40 rounded-xl" />
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Recurring retention, repeat purchases and returning customers are measured separately and never added together. Nothing here is a forecast, and no figure claims a customer stayed because of an intervention.</p>
        </Panel>

        <Panel title="What Retention cannot see">
          <NotConnected items={overview.missing} />
          <p className="mt-3 text-xs text-muted-foreground">
            What Retention may do without asking is set per action in{" "}
            <Link href={`${RETENTION_PATH}/playbook`} className="font-medium text-brand-300 underline-offset-4 hover:underline">
              its Playbook
            </Link>
            .
          </p>
        </Panel>
      </div>
      <CaseDrawer id={openId} onClose={close} />
    </>
  );
}
