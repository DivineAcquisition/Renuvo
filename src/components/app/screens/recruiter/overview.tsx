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
import { until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { AgentStatusLine, PipelineFlow, STAGE_WORDS, STEPS, stepOf, WhoActs, type ApplicationRow } from "./shared";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * Recruiter's landing page: where hiring stands, who acts next, what needs a person, and what Recruiter
 * did. The pipeline is counted from the applications themselves; nothing here says "all clear" unless
 * the records support it.
 */
export function RecruiterOverviewScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const open = useDetail();
  const overview = useQuery(api.recruiter.overview, { companyId });
  const applications = useQuery(api.applications.list, { companyId });
  const requests = useQuery(api.recruiter.staffingRequests, { companyId });
  const activity = useQuery(api.details.activity, now ? { companyId, asOf: now, limit: 60 } : "skip");
  const permissions = useQuery(api.permissions.list, { companyId });
  const setPaused = useMutation(api.companies.setPausedAgents);
  const { busy, error, run } = useRun();
  const [step, setStep] = useState<number | null>(null);

  if (!overview || !applications) {
    return (
      <>
        <PageHeader title="Recruiter" lead="Manages candidate acquisition, screening, interviews, and hiring offers." />
        <Skeleton className="h-72 rounded-2xl" />
      </>
    );
  }

  const live = applications.filter((row) => !row.closure && row.stage !== "closed" && row.stage !== "withdrawn");
  const counts = STEPS.map((_, index) => live.filter((row) => stepOf(row.stage) === index).length);
  const needsYou = (row: ApplicationRow) => row.withPerson || row.nextAction?.by === "owner";
  const attention = STEPS.map((_, index) => live.filter((row) => stepOf(row.stage) === index && needsYou(row)).length);
  const mine = live.filter(needsYou).sort((a, b) => (a.nextAction?.dueAt ?? Infinity) - (b.nextAction?.dueAt ?? Infinity));
  const theirs = live.filter((row) => !needsYou(row) && (row.waitingOnReply || row.nextAction?.by === "applicant"));
  const recruiters = live.filter((row) => !needsYou(row) && !theirs.includes(row));
  const shown = step === null ? null : live.filter((row) => stepOf(row.stage) === step);
  const inbox = overview.inbox.find((row) => row.status === "connected") ?? overview.inbox[0] ?? null;
  const pausedAgents = permissions?.pausedAgents ?? [];
  const did = activity?.filter((event) => event.actor.agent === "recruiter").slice(0, 12);

  const briefing = [
    `${plural(overview.openHiringNeeds, "open role")}; ${plural(live.length, "person", "people")} in the pipeline.`,
    overview.newApplications + overview.contactNeeded > 0 ? `${plural(overview.newApplications, "new application")}${overview.contactNeeded ? `, ${overview.contactNeeded} still without a way to reach them` : ""}.` : "No new applications are waiting to be filed.",
    overview.incompleteApplications > 0 ? `${plural(overview.incompleteApplications, "applicant")} invited or part-way through the form${overview.incompleteNeedingFollowUp ? `; ${overview.incompleteNeedingFollowUp} need a person` : ""}.` : null,
    overview.failures.messages > 0 ? `${plural(overview.failures.messages, "message")} to applicants did not go through in the last two weeks.` : null,
  ].filter((line): line is string => Boolean(line));

  const first = mine[0] ?? null;
  const next = overview.paused
    ? "Recruiter is paused. It reads no mail and sends nothing until it is resumed; applications are yours to handle."
    : !overview.inboxConnected
      ? "No hiring inbox is connected, so Recruiter cannot see new applications. Connect one in the Playbook."
      : overview.invitationsAwaitingApproval > 0
        ? `${plural(overview.invitationsAwaitingApproval, "invitation")} ${overview.invitationsAwaitingApproval === 1 ? "is" : "are"} waiting for your approval.`
        : overview.decisionsAwaitingOwner > 0
          ? `${plural(overview.decisionsAwaitingOwner, "applicant")} ${overview.decisionsAwaitingOwner === 1 ? "is" : "are"} waiting for your decision.`
          : first
            ? `${first.name ?? "An applicant"}: ${first.nextAction?.what ?? STAGE_WORDS[first.stage]}.`
            : live.length === 0
              ? "Nobody is in the pipeline. Recruiter files new applications from the hiring inbox as they arrive."
              : "Nothing in the pipeline is waiting on you right now.";

  return (
    <>
      <PageHeader
        title="Recruiter"
        lead="Manages candidate acquisition, screening, interviews, and hiring offers."
        actions={
          role === "owner" && permissions ? (
            <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => setPaused({ companyId, agents: overview.paused ? pausedAgents.filter((agent) => agent !== "recruiter") : [...pausedAgents, "recruiter"] }))}>
              {overview.paused ? <Play aria-hidden /> : <PauseCircleIcon aria-hidden />}
              {overview.paused ? "Resume Recruiter" : "Pause Recruiter"}
            </Button>
          ) : null
        }
      />
      <FormError message={error} />

      <div className="grid gap-5">
        <Panel>
          <div className="flex items-start gap-3">
            <AgentAvatar agent="recruiter" size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={overview.paused ? "warning" : "success"} size="sm">
                  {overview.paused ? "Paused" : "On"}
                </Badge>
                <Connection label="Inbox" value={inbox ? inbox.address : null} ok={overview.inboxConnected} />
                <Connection label="Email" value={overview.connections.email} />
                <Connection label="Texting" value={overview.connections.texting} />
                <Connection label="Calendar" value={overview.connections.calendar} />
                <Connection label="Signing" value={overview.connections.signing} />
                <Connection label="Reader" value={overview.connections.reader === "rules" ? "Rules" : overview.connections.reader} ok />
              </div>
              <div className="mt-3">
                <AgentStatusLine busy={!overview.paused && overview.inboxConnected}>
                  {overview.paused ? "Paused" : !overview.inboxConnected ? "Waiting for a hiring inbox" : inbox?.lastSyncAt ? `Watching ${inbox.address}; last read ${whenLabel(inbox.lastSyncAt, now, timezone)}` : `Watching ${inbox?.address ?? "the hiring inbox"}`}
                </AgentStatusLine>
              </div>
              <div className="mt-3 grid gap-1 text-sm leading-relaxed text-strong">
                {briefing.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2.5">
                <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">Next</p>
                <p className="mt-1 text-sm font-medium text-strong">{next}</p>
                {first ? (
                  <Button className="mt-2" variant="outline" size="xs" render={<Link href={`/app/agents/recruiter/applicants?open=${first.applicationId}`} />}>
                    Open {first.name ?? "the applicant"}
                  </Button>
                ) : !overview.inboxConnected ? (
                  <Button className="mt-2" variant="outline" size="xs" render={<Link href="/app/agents/recruiter/playbook" />}>
                    Connect the hiring inbox
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Hiring pipeline" action={<span className="text-xs text-muted-foreground">Open a step to see who is in it</span>}>
          <PipelineFlow counts={counts} attention={attention} selected={step} onSelect={(index) => setStep(step === index ? null : index)} />
          {shown ? (
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium text-strong">
                {STEPS[step!].label} · {shown.length}
              </p>
              {shown.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is at this step.</p> : <PeopleList rows={shown} now={now} timezone={timezone} />}
            </div>
          ) : null}
        </Panel>

        <div className="grid items-start gap-5 xl:grid-cols-3">
          <Panel title={`Needs you · ${mine.length}`}>{mine.length === 0 ? <p className="text-sm text-muted-foreground">Nothing in the pipeline is waiting on you.</p> : <PeopleList rows={mine.slice(0, 8)} now={now} timezone={timezone} />}</Panel>
          <Panel title={`Recruiter is on it · ${recruiters.length}`}>{recruiters.length === 0 ? <p className="text-sm text-muted-foreground">Recruiter has nothing of its own in progress.</p> : <PeopleList rows={recruiters.slice(0, 8)} now={now} timezone={timezone} />}</Panel>
          <Panel title={`Waiting on applicants · ${theirs.length}`}>{theirs.length === 0 ? <p className="text-sm text-muted-foreground">No applicant owes a reply.</p> : <PeopleList rows={theirs.slice(0, 8)} now={now} timezone={timezone} />}</Panel>
        </div>

        {requests && requests.length > 0 ? (
          <Panel title="Staffing requests from Dispatch">
            <ul className="grid gap-2">
              {requests.map((row) => {
                const due = until(row.dueAt, now);
                return (
                  <li key={row.taskId}>
                    <button type="button" onClick={() => open({ kind: "task", id: row.taskId })} className="grid w-full gap-0.5 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm hover:border-brand-500/50">
                      <span className="font-medium text-strong">
                        {row.title} {row.kind === "urgent_hire" ? <Badge variant="error" size="sm">Urgent</Badge> : null}
                      </span>
                      {row.what ? <span className="text-xs text-muted-foreground">{row.what}</span> : null}
                      <span className={cn("text-xs", due.late ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>Due {whenLabel(row.dueAt, now, timezone)} · {due.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        <section aria-labelledby="recruiter-approvals">
          <h2 id="recruiter-approvals" className="mb-3 font-heading text-lg tracking-tight text-strong">
            Waiting on a decision
          </h2>
          <DecisionsScreen department="Team" />
        </section>

        <Panel title="What Recruiter did">
          {did === undefined ? <Skeleton className="h-24" /> : <ActivityFeed events={did} now={now} timezone={timezone} onOpen={open} empty="Recruiter has done nothing in the company’s latest activity." />}
          <p className="mt-3 text-xs text-muted-foreground">Taken from the company’s 60 most recent events. An applicant’s full history is on the applicant.</p>
        </Panel>
      </div>
    </>
  );
}

function Connection({ label, value, ok }: { label: string; value: string | null; ok?: boolean }) {
  const on = value !== null && ok !== false;
  return (
    <Badge variant={on ? "outline" : "warning"} size="sm" title={on ? `${label}: ${value}` : `${label}: not set up yet`}>
      <span aria-hidden className={cn("size-1.5 rounded-full", on ? "bg-success" : "bg-warning")} />
      {label}
      {on && value && label !== "Inbox" ? `: ${value}` : on ? "" : ": not set up"}
    </Badge>
  );
}

export function PeopleList({ rows, now }: { rows: ApplicationRow[]; now: number; timezone?: string }) {
  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li key={row.applicationId}>
          <Link href={`/app/agents/recruiter/applicants?open=${row.applicationId}`} className="grid gap-0.5 rounded-xl border border-border bg-background px-3 py-2.5 text-sm hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-strong">{row.detailsRemoved ? "Details removed" : (row.name ?? "Name not known")}</span>
              <WhoActs row={row} />
            </span>
            <span className="text-xs text-muted-foreground">
              {row.role ?? row.roleSeen ?? "No role yet"} · {STAGE_WORDS[row.stage]}
            </span>
            {row.nextAction ? (
              <span className="text-xs text-muted-foreground">
                Next: {row.nextAction.what}
                {row.nextAction.dueAt ? ` · ${until(row.nextAction.dueAt, now).text}` : ""}
              </span>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
