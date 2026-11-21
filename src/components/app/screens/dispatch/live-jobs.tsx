"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { FormError, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, dayName, until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { arrivalLabel, deliveryOf, GroupBadge, Incomplete, RangePicker, Staffing, useRange } from "./shared";
import { NumberField } from "@/components/ui/fields";

type Live = FunctionReturnType<typeof api.dispatchViews.liveJobs>;
type LiveJob = Live["jobs"][number];
type Member = LiveJob["crew"][number];
type Arrival = Member["arrival"];
type Variant = NonNullable<BadgeProps["variant"]>;

/**
 * Each state is a fact from the record. "Missing check-in" is not a no-show, and a phone that gave no
 * position at check-in says nothing about where the cleaner is.
 */
const ARRIVAL: Record<Arrival, { label: string; variant: Variant; rank: number }> = {
  no_show_suspected: { label: "Possible no-show · a person confirms", variant: "error", rank: 0 },
  operator_alerted: { label: "No check-in · operator alerted", variant: "error", rank: 1 },
  cleaner_asked: { label: "No check-in · cleaner asked", variant: "warning", rank: 2 },
  not_checked_in: { label: "No check-in yet", variant: "warning", rank: 3 },
  late_with_eta: { label: "Running late · ETA given", variant: "warning", rank: 4 },
  due: { label: "Due now", variant: "info", rank: 5 },
  not_due: { label: "Not due yet", variant: "outline", rank: 6 },
  checked_in: { label: "Checked in", variant: "success", rank: 7 },
};

const REPORT_KIND: Record<string, string> = { condition: "Condition reported", addon_request: "Add-on requested", incomplete: "Work left unfinished" };

/** Whether a visit needs a person now: an arrival problem, a report nobody decided, a review, or a place short once it is due. */
function needsLook(job: LiveJob, now: number): boolean {
  if (job.crew.some((member) => ARRIVAL[member.arrival].rank <= 4)) return true;
  if (job.openReports.some((report) => report.status === "awaiting_decision")) return true;
  if (job.group === "awaiting_completion_review") return true;
  return job.openPlaces > 0 && now >= job.startsAt - 2 * 60 * 60 * 1000;
}

/** Most urgent first: needs a look, then its worst crew member, then the start time. */
function urgency(job: LiveJob, now: number): number {
  const worst = Math.min(7, ...job.crew.map((member) => ARRIVAL[member.arrival].rank));
  return (needsLook(job, now) ? 0 : 100) + worst;
}

function CrewMember({ job, member, now, timezone }: { job: LiveJob; member: Member; now: number; timezone: string }) {
  const { companyId, role } = useCompany();
  const ask = useMutation(api.dispatchOps.askCleaner);
  const coming = useMutation(api.dispatchOps.cleanerIsComing);
  const noShow = useMutation(api.dispatchOps.confirmNoShow);
  const cannot = useMutation(api.dispatchOps.recordCannotAttend);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState<"eta" | "no_show" | "cannot" | null>(null);
  const [words, setWords] = useState("");
  const [eta, setEta] = useState("15");
  const [note, setNote] = useState<string | null>(null);
  const state = ARRIVAL[member.arrival];
  const manager = canManage(role);
  const waiting = member.checkedInAt === null && member.arrival !== "not_due" && member.arrival !== "due";
  const lastText = member.messages.length > 0 ? deliveryOf(member.messages) : null;
  const close = () => {
    setForm(null);
    setWords("");
  };
  return (
    <li className="grid gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p>
          <span className="font-medium text-strong">{member.name}</span>
          <span className="text-muted-foreground">{member.role && job.requiredCrew > 1 ? ` · ${member.role}` : ""}</span>
        </p>
        <Badge variant={state.variant} size="sm">
          {state.label}
        </Badge>
      </div>
      <div className="grid gap-0.5 text-xs text-muted-foreground">
        {member.checkedInAt !== null ? (
          <span>
            Checked in {clock(member.checkedInAt, timezone)} · {member.checkInHasPosition ? "the phone gave a position" : "no position given (that is not evidence of being elsewhere)"}
          </span>
        ) : null}
        {member.late && member.checkedInAt === null ? (
          <span className={cn(now > member.late.etaAt && "font-medium text-destructive-foreground")}>
            ETA {clock(member.late.etaAt, timezone)}
            {member.late.reason ? ` · “${member.late.reason}”` : ""}
            {now > member.late.etaAt ? ` · passed ${until(member.late.etaAt, now).text.replace(" overdue", "")} ago` : ""}
          </span>
        ) : null}
        {member.completion ? <span>{member.completion.incomplete ? "Submitted with work left unfinished" : "Submitted as done"} · {clock(member.completion.submittedAt, timezone)}</span> : member.checkedInAt !== null ? <span>Has not submitted yet</span> : null}
        {lastText ? (
          <span className={cn(lastText.failed && "text-destructive-foreground")} title={lastText.problem ?? undefined}>
            Last text: {lastText.label}
          </span>
        ) : null}
        {member.affectedLaterJobs.length > 0 ? (
          <span className="font-medium text-warning-foreground">
            Their later {member.affectedLaterJobs.length === 1 ? "visit is" : "visits are"} at risk: {member.affectedLaterJobs.map((row) => `${clock(row.startsAt, timezone)} (short ${row.shortByMinutes} min)`).join(", ")}
          </span>
        ) : null}
        {member.phone ? (
          <span>
            Phone:{" "}
            <a href={`tel:${member.phone}`} className="font-medium text-brand-300 underline-offset-4 hover:underline">
              {member.phone}
            </a>
          </span>
        ) : manager && !member.hasPhone ? (
          <span className="text-destructive-foreground">No phone number on record.</span>
        ) : null}
      </div>

      <FormError message={error} />
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}

      {manager && member.checkedInAt === null && (job.status === "scheduled" || job.status === "in_progress") ? (
        form === null ? (
          <div className="flex flex-wrap gap-2">
            {member.hasPhone && member.arrival !== "not_due" ? (
              <Button
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const sent = await ask({ companyId, assignmentId: member.assignmentId });
                    setNote(sent.repeated ? "A text already went in the last 15 minutes, so no second one was sent." : sent.problem ? `The text did not go: ${sent.problem}` : "Text queued, asking them to check in, send an ETA, or say they cannot come.");
                  })
                }
              >
                Text them
              </Button>
            ) : null}
            {member.arrival !== "not_due" ? (
              <Button variant="outline" size="xs" onClick={() => setForm("eta")}>
                Record an ETA they gave
              </Button>
            ) : null}
            <Button variant="outline" size="xs" onClick={() => setForm("cannot")}>
              They said they can’t come
            </Button>
            {waiting && now >= job.startsAt ? (
              <Button variant="destructive-outline" size="xs" onClick={() => setForm("no_show")}>
                Confirm no-show
              </Button>
            ) : null}
          </div>
        ) : (
          <form
            className="grid gap-2 rounded-lg border border-border bg-muted p-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (form === "eta") await coming({ companyId, assignmentId: member.assignmentId, note: words.trim(), etaMinutes: Number(eta) });
                if (form === "cannot") await cannot({ companyId, assignmentId: member.assignmentId, reason: words.trim() });
                if (form === "no_show") {
                  const done = await noShow({ companyId, assignmentId: member.assignmentId, note: words.trim() || undefined });
                  setNote(done.stepsComplete ? "Confirmed as a no-show by you. Their place is open and cover has started." : `Confirmed as a no-show by you before every step had run (${done.notMet.join("; ")}). That is recorded. Cover has started.`);
                }
                close();
              });
            }}
          >
            {form === "eta" ? (
              <div className="grid grid-cols-[6rem_1fr] gap-2">
                <NumberField value={eta} onChange={(text) => setEta(text)} aria-label="Minutes until they arrive" required />
                <TextInput autoFocus value={words} onChange={(event) => setWords(event.target.value)} placeholder="What they told you, and how" aria-label="What they told you" required maxLength={500} />
              </div>
            ) : (
              <TextInput autoFocus value={words} onChange={(event) => setWords(event.target.value)} placeholder={form === "cannot" ? "What they told you" : "What you checked before confirming (optional)"} aria-label="Note" required={form === "cannot"} maxLength={500} />
            )}
            {form === "no_show" ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {member.noShowNotYet && member.noShowNotYet.length > 0 ? `Not every step has run yet: ${member.noShowNotYet.join("; ")}. ` : "Every configured step has run. "}
                Confirming takes {member.name} off the visit, closes their link, and opens cover for the place. It is recorded as your confirmation, separate from one Dispatch declares.
              </p>
            ) : form === "cannot" ? (
              <p className="text-xs text-muted-foreground">Their place opens and cover starts at once. This is recorded as a drop-out, not a no-show.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Minutes from now. The no-check-in steps wait until this ETA has passed.</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant={form === "no_show" ? "destructive-outline" : "primary"} size="xs" loading={busy}>
                {form === "eta" ? "Record the ETA" : form === "cannot" ? "Open their place" : "Confirm no-show"}
              </Button>
              <Button variant="ghost" size="xs" onClick={close}>
                Never mind
              </Button>
            </div>
          </form>
        )
      ) : null}
    </li>
  );
}

function JobCard({ job, now, timezone }: { job: LiveJob; now: number; timezone: string }) {
  const { companyId, role } = useCompany();
  const open = useDetail();
  const decide = useMutation(api.dispatchOps.decideReport);
  const { busy, error, run } = useRun();
  const undecided = job.openReports.filter((report) => report.status === "awaiting_decision");
  const short = (have: number, need: number) => (need > 0 ? `${have} of ${need}` : String(have));
  return (
    <li className="grid gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <button type="button" onClick={() => open({ kind: "job", id: job.jobId })} className="text-left font-medium text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
            {job.customer ?? "Unknown customer"} · {job.serviceType}
          </button>
          <p className="text-xs text-muted-foreground">
            {dayName(job.startsAt, timezone)} · {arrivalLabel(job, timezone)} · ends {clock(job.endsAt, timezone)}
            {job.hardDeadlineAt ? ` · must be finished by ${whenLabel(job.hardDeadlineAt, now, timezone)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Staffing row={job} />
          <GroupBadge group={job.group} />
        </div>
      </div>

      {job.crew.length === 0 ? (
        <p className="text-sm text-destructive-foreground">Nobody is accepted on this visit yet{job.offersOut > 0 ? `; ${job.offersOut} ${job.offersOut === 1 ? "offer is" : "offers are"} out` : ""}.</p>
      ) : (
        <ul className="grid gap-2">
          {job.crew.map((member) => (
            <CrewMember key={member.assignmentId} job={job} member={member} now={now} timezone={timezone} />
          ))}
        </ul>
      )}

      {job.noShows.length + job.drops.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Came off this visit: {[...job.noShows.map((row) => `${row.name} (no-show)`), ...job.drops.map((row) => `${row.name} (could not attend)`)].join(", ")}.
          {job.coverage.length > 0 ? " Cover is open for the place." : ""}
        </p>
      ) : null}

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-muted px-2.5 py-1.5">
          <dt className="text-muted-foreground">Checklist</dt>
          <dd className="font-medium text-strong tabular-nums">{job.checklist.total === 0 ? "None set" : `${job.checklist.done + job.checklist.skipped} of ${job.checklist.total}${job.checklist.skipped ? ` · ${job.checklist.skipped} skipped` : ""}`}</dd>
        </div>
        <div className="rounded-lg bg-muted px-2.5 py-1.5">
          <dt className="text-muted-foreground">Before photos</dt>
          <dd className={cn("font-medium tabular-nums", job.photos.before < job.photos.requiredBefore ? "text-warning-foreground" : "text-strong")}>{short(job.photos.before, job.photos.requiredBefore)}</dd>
        </div>
        <div className="rounded-lg bg-muted px-2.5 py-1.5">
          <dt className="text-muted-foreground">After photos</dt>
          <dd className={cn("font-medium tabular-nums", job.photos.after < job.photos.requiredAfter ? "text-warning-foreground" : "text-strong")}>{short(job.photos.after, job.photos.requiredAfter)}</dd>
        </div>
      </dl>

      {undecided.length > 0 ? (
        <ul className="grid gap-2">
          {undecided.map((report) => (
            <li key={report.reportId} className="rounded-lg border border-warning/50 bg-warning/5 px-3 py-2 text-sm">
              <p className="text-xs font-medium text-warning-foreground">{REPORT_KIND[report.kind]} · waiting for a decision</p>
              <p className="mt-0.5 leading-relaxed text-strong">{report.text}</p>
              {canManage(role) ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {report.kind === "addon_request" ? (
                    <>
                      <Button variant="outline" size="xs" disabled={busy} onClick={() => void run(() => decide({ companyId, reportId: report.reportId, decision: "approved" }))}>
                        Approve the request
                      </Button>
                      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void run(() => decide({ companyId, reportId: report.reportId, decision: "declined" }))}>
                        Decline
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="xs" disabled={busy} onClick={() => void run(() => decide({ companyId, reportId: report.reportId, decision: "acknowledged" }))}>
                      Acknowledge
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <FormError message={error} />

      <div className="flex flex-wrap gap-2">
        <Button variant={job.group === "awaiting_completion_review" ? "primary" : "outline"} size="xs" onClick={() => open({ kind: "job", id: job.jobId })}>
          {job.group === "awaiting_completion_review" ? "Review the completion" : job.openPlaces > 0 ? "Find a replacement" : "Open the visit"}
        </Button>
      </div>
    </li>
  );
}

/**
 * Live Jobs: today's visits as they happen, each cleaner's arrival from the record, what the crew has
 * done, what they reported, and what is at risk later. Most urgent first.
 */
export function LiveJobsScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const range = useRange(now, timezone, "today");
  const live = useQuery(api.dispatchViews.liveJobs, now ? { companyId, from: range.from, to: range.to } : "skip");
  const [show, setShow] = useState<"active" | "all">("active");
  const jobs = (live?.jobs ?? []).filter((job) => show === "all" || job.status !== "completed").sort((a, b) => urgency(a, now) - urgency(b, now) || a.startsAt - b.startsAt);
  const attention = jobs.filter((job) => needsLook(job, now)).length;
  const readiness = useQuery(api.compliance.readiness, { companyId });
  const sms = readiness?.operations.find((operation) => operation.key === "sms");

  return (
    <>
      <PageHeader title="Live Jobs" lead="Each accepted cleaner’s arrival and progress, from what they and the office recorded. A missing check-in is not a no-show, and a check-in without a position says nothing about where someone is." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <RangePicker range={range} week={false} />
        <div role="tablist" aria-label="Which visits" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
          {(
            [
              { id: "active", label: "Not closed" },
              { id: "all", label: "Including completed" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={show === option.id}
              onClick={() => setShow(option.id)}
              className={cn("rounded-md px-3 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", show === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {sms && sms.state !== "ready" ? (
        <p role="status" className="mb-4 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          Texting is not ready, so reminders and check-in texts do not reach cleaners: {sms.blockers.map((blocker) => blocker.words).join(" ")} Call them, and record what they tell you here.
        </p>
      ) : null}
      {live?.truncated ? (
        <div className="mb-4">
          <Incomplete what="visits" shown={live.jobs.length} total={live.total} />
        </div>
      ) : null}
      {live === undefined ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : jobs.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted-foreground">No visits that are not closed are scheduled {range.label.toLowerCase()}. Cancelled visits are not shown here.</p>
        </Panel>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {jobs.length} {jobs.length === 1 ? "visit" : "visits"} · {attention} {attention === 1 ? "needs" : "need"} a look now. As of {clock(live.asOf, timezone)}.
          </p>
          <ul className="grid items-start gap-3 xl:grid-cols-2">
            {jobs.map((job) => (
              <JobCard key={job.jobId} job={job} now={now} timezone={timezone} />
            ))}
          </ul>
        </>
      )}
      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Arrival is checked in from the cleaner’s link. Location is taken only once, at check-in, and only if the phone allows it: this is not continuous tracking. Customer updates about a delay go to a person as a task; Selestial does not message customers yet.
      </p>
    </>
  );
}
