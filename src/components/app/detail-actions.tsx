"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { DispatchView } from "@/components/app/dispatch-view";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { HoldButton } from "@/components/app/hold-button";
import { Modal } from "@/components/app/modal";
import { EditVisitForm, MoveVisitForm } from "@/components/app/screens/visit-forms";
import { Button } from "@/components/ui/button";
import { centsFrom, zonedInstant } from "@/lib/app/format";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Detail } from "../../../convex/details";

/** A button that first asks for a few words (a reason, a note, an outcome), then acts. */
function WithWords({ label, placeholder, confirm, required = true, variant = "outline", onSubmit }: { label: string; placeholder: string; confirm: string; required?: boolean; variant?: "outline" | "ghost" | "destructive-outline"; onSubmit: (words: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState("");
  const { busy, error, run } = useRun();
  if (!open) {
    return (
      <Button variant={variant} size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      className="grid w-full gap-2 rounded-xl border border-border bg-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await onSubmit(words.trim());
          setOpen(false);
          setWords("");
        });
      }}
    >
      <TextInput autoFocus value={words} onChange={(event) => setWords(event.target.value)} placeholder={placeholder} aria-label={placeholder} required={required} maxLength={500} />
      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {confirm}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
    </form>
  );
}

function OfferForm({ jobId, now }: { jobId: Id<"jobs">; now: number }) {
  const { companyId } = useCompany();
  const cleaners = useQuery(api.cleaners.list, { companyId, status: "ready" });
  const offer = useMutation(api.assignments.offer);
  const [cleanerId, setCleanerId] = useState("");
  const [pay, setPay] = useState("");
  const settings = useQuery(api.dispatch.settings, { companyId });
  const [typed, setTyped] = useState<string | null>(null);
  // The time to answer starts at the company's own setting, not a number written into this form.
  const minutes = typed ?? (settings ? String(settings.offerWindowMinutes) : "");
  const setMinutes = setTyped;
  const { busy, error, run, setError } = useRun();
  if (cleaners === undefined) return <p className="text-sm text-muted-foreground">Loading cleaners…</p>;
  if (cleaners.length === 0) return <p className="text-sm text-muted-foreground">No cleaner is marked ready for work yet. Add one under Cleaners, then offer this visit.</p>;
  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-muted p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const payCents = centsFrom(pay);
        const window = Number(minutes);
        if (!cleanerId) return setError("Choose a cleaner.");
        if (payCents === null) return setError("Enter the cleaner's pay for this visit as an amount in dollars and cents.");
        if (!Number.isInteger(window) || window < 5) return setError("Give the cleaner at least 5 minutes to answer.");
        void run(() => offer({ companyId, jobId, cleanerId: cleanerId as Id<"cleaners">, payCents, respondBy: now + window * 60_000 }));
      }}
    >
      <Field label="Cleaner" hint="Only cleaners marked ready are listed. The offer is refused if they cannot work this time.">
        <SelectInput value={cleanerId} onChange={(event) => setCleanerId(event.target.value)} required>
          <option value="">Choose a cleaner</option>
          {cleaners.map((cleaner) => (
            <option key={cleaner._id} value={cleaner._id}>
              {cleaner.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Their pay for this visit">
          <TextInput inputMode="decimal" value={pay} onChange={(event) => setPay(event.target.value)} placeholder="0.00" required />
        </Field>
        <Field label="Minutes to answer">
          <TextInput inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} required />
        </Field>
      </div>
      <FormError message={error} />
      <div>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Send the offer
        </Button>
      </div>
    </form>
  );
}

const REPORT_KIND: Record<string, string> = { condition: "Condition reported", addon_request: "Add-on requested", incomplete: "Work left unfinished" };
const REPORT_STATUS: Record<string, string> = { awaiting_decision: "Waiting for a decision", acknowledged: "Acknowledged", approved: "Approved", declined: "Declined" };

/**
 * The crew's report and a person's decision on it. Submitted is not approved: the visit closes only when
 * a manager reviews it here, or closes it without a review and says why.
 */
function CompletionReview({ detail }: { detail: Detail }) {
  const { companyId, role } = useCompany();
  const job = detail.job!;
  const jobId = detail.ref.id as Id<"jobs">;
  const review = useMutation(api.jobs.reviewCompletion);
  const override = useMutation(api.jobs.closeWithoutReview);
  const decide = useMutation(api.dispatchOps.decideReport);
  const { busy, error, run } = useRun();
  const { completion } = job;
  const manager = canManage(role);
  const waiting = completion.crew.filter((row) => row.submittedAt === null);
  const undecided = completion.reports.filter((row) => row.status === "awaiting_decision");
  const short = (have: number, need: number) => (need > 0 && have < need ? ` of ${need} required` : "");
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-muted p-3">
      <p className="text-sm font-medium text-strong">{completion.reportedAt ? "The crew reported this visit done. Review it before it is closed." : "Completion"}</p>
      <ul className="grid gap-1 text-sm">
        {completion.crew.length === 0 ? <li className="text-muted-foreground">Nobody is accepted on this visit.</li> : null}
        {completion.crew.map((row) => (
          <li key={row.assignmentId} className="leading-relaxed">
            <span className="font-medium text-strong">{row.cleaner}</span>{" "}
            <span className="text-muted-foreground">
              {row.checkedInAt === null ? "has not checked in" : row.submittedAt === null ? "checked in, has not submitted" : row.incomplete ? "submitted with work left unfinished" : "submitted as done"}
              {row.note ? `: “${row.note}”` : ""}
            </span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Checklist</dt>
        <dd className="text-strong">{completion.checklist.total === 0 ? "No checklist set" : `${completion.checklist.done} done · ${completion.checklist.skipped.length} skipped · ${completion.checklist.pending} not answered, of ${completion.checklist.total}`}</dd>
        <dt>Before photos</dt>
        <dd className="text-strong">
          {completion.photos.before}
          {short(completion.photos.before, completion.photos.requiredBefore)}
        </dd>
        <dt>After photos</dt>
        <dd className="text-strong">
          {completion.photos.after}
          {short(completion.photos.after, completion.photos.requiredAfter)}
        </dd>
        {completion.photos.issue > 0 ? (
          <>
            <dt>Issue photos</dt>
            <dd className="text-strong">{completion.photos.issue}</dd>
          </>
        ) : null}
      </dl>
      {completion.checklist.skipped.length > 0 ? (
        <ul className="grid gap-0.5 text-xs leading-relaxed text-muted-foreground">
          {completion.checklist.skipped.map((item) => (
            <li key={item.label}>
              Skipped “{item.label}”{item.by ? ` by ${item.by}` : ""}: {item.reason ?? "no reason given"}
            </li>
          ))}
        </ul>
      ) : null}
      {completion.reports.length > 0 ? (
        <ul className="grid gap-2">
          {completion.reports.map((report) => (
            <li key={report.reportId} className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">
                {REPORT_KIND[report.kind]} by {report.by} · {REPORT_STATUS[report.status]}
              </p>
              <p className="mt-0.5 leading-relaxed text-strong">{report.text}</p>
              {report.status === "awaiting_decision" && manager ? (
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
      <p className="text-xs leading-relaxed text-muted-foreground">Photos are counted here. Viewing them in this panel is not built yet. Closing a visit approves no payment and releases no payout.</p>
      <FormError message={error} />
      {!manager ? (
        <p className="text-sm text-muted-foreground">Owners and Managers review and close visits.</p>
      ) : completion.reportedAt ? (
        <div className="flex flex-wrap items-start gap-2">
          <WithWords label="Close the visit" placeholder="What did you check? (optional)" confirm={undecided.length > 0 ? "Decide the reports first" : "Reviewed: close it"} required={false} variant="outline" onSubmit={(note) => review({ companyId, jobId, decision: "close", note: note || undefined })} />
          <WithWords label="Send back for correction" placeholder="What needs correcting?" confirm="Send it back" onSubmit={(note) => review({ companyId, jobId, decision: "return", note })} />
        </div>
      ) : (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            {waiting.length > 0 ? `Waiting on ${waiting.map((row) => row.cleaner).join(", ")} to submit from ${waiting.length === 1 ? "their link" : "their links"}. ` : ""}
            There is nothing to review until everyone on the crew has reported.
          </p>
          <div>
            <WithWords label="Close without a review" placeholder="Why is this visit closed without a review?" confirm="Close without a review" variant="destructive-outline" onSubmit={(reason) => override({ companyId, jobId, reason })} />
          </div>
          <p className="text-xs text-muted-foreground">Closing without a review needs a reason and is recorded as that, never as a review.</p>
        </div>
      )}
    </div>
  );
}

function JobActions({ detail, now }: { detail: Detail; now: number }) {
  const { companyId } = useCompany();
  const job = detail.job!;
  const jobId = detail.ref.id as Id<"jobs">;
  const answer = useMutation(api.assignments.recordAnswer);
  const release = useMutation(api.assignments.release);
  const start = useMutation(api.jobs.start);
  const cancel = useMutation(api.jobs.cancel);
  const { busy, error, run } = useRun();
  const [offering, setOffering] = useState(false);
  const [dialog, setDialog] = useState<"move" | "edit" | null>(null);
  const offered = job.assignments.filter((row) => row.status === "offered");
  // Everyone who accepted is on the crew, and each can be released on their own.
  const crew = job.assignments.filter((row) => row.status === "accepted");
  const { staffing } = job;
  if (job.status === "completed" || job.status === "cancelled") return <p className="text-sm text-muted-foreground">This visit is closed. Nothing can be changed here.</p>;
  return (
    <div className="grid gap-3">
      <FormError message={error} />
      {offered.map((row) => (
        <div key={row.id} className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Record <span className="font-medium text-strong">{row.cleaner}</span>’s own answer if they gave it to you directly. The history says the office recorded it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => answer({ companyId, assignmentId: row.id, answer: "accepted" }))}>
              {row.cleaner} accepted
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => answer({ companyId, assignmentId: row.id, answer: "declined" }))}>
              {row.cleaner} declined
            </Button>
            <WithWords label="Withdraw the offer" placeholder="Why is the offer withdrawn?" confirm="Withdraw" variant="ghost" onSubmit={(reason) => release({ companyId, assignmentId: row.id, reason })} />
          </div>
        </div>
      ))}
      {job.status === "scheduled" && crew.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {staffing.open === 0 ? (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => start({ companyId, jobId }))}>
              Start the visit
            </Button>
          ) : null}
          {crew.map((row) => (
            <WithWords key={row.id} label={`Release ${row.cleaner}`} placeholder={`Why is ${row.cleaner} coming off this visit?`} confirm="Release" onSubmit={(reason) => release({ companyId, assignmentId: row.id, reason })} />
          ))}
        </div>
      ) : null}
      {job.status === "in_progress" ? <CompletionReview detail={detail} /> : null}
      {/* Staffing stays available for as long as a place is open, however many cleaners have already accepted. */}
      {job.status === "scheduled" && staffing.open > 0 ? (
        <>
          {staffing.required > 1 ? (
            <p className="text-sm font-medium text-strong">
              {staffing.open} of {staffing.required} {staffing.open === 1 ? "place is" : "places are"} still open.
            </p>
          ) : null}
          <DispatchView jobId={jobId} now={now} canOffer />
          {offering ? (
            <OfferForm jobId={jobId} now={now} />
          ) : (
            <div>
              <Button variant="ghost" size="sm" onClick={() => setOffering(true)}>
                Offer to someone else, with pay I enter
              </Button>
            </div>
          )}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        {job.status === "scheduled" ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog("move")}>
              Move the visit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
              Change details
            </Button>
          </>
        ) : null}
        <WithWords label="Cancel the visit" placeholder="Why is the visit cancelled?" confirm="Cancel the visit" variant="destructive-outline" onSubmit={(reason) => cancel({ companyId, jobId, reason })} />
      </div>
      <Modal open={dialog === "move"} onClose={() => setDialog(null)} title="Move the visit" description="You see what the move does to each cleaner before anything changes.">
        <MoveVisitForm jobId={jobId} startsAt={job.startsAt} endsAt={job.endsAt} now={now} onDone={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "edit"} onClose={() => setDialog(null)} title="Change the visit’s details">
        <EditVisitForm jobId={jobId} onDone={() => setDialog(null)} />
      </Modal>
    </div>
  );
}

function ApprovalActions({ detail, now }: { detail: Detail; now: number }) {
  const { companyId, role } = useCompany();
  const decide = useMutation(api.approvals.decide);
  const { busy, error, run } = useRun();
  const approval = detail.approval!;
  const approvalId = detail.ref.id as Id<"approvals">;
  if (!approval.canDecide) return <p className="text-sm text-muted-foreground">This was already decided{approval.note ? `: ${approval.note}` : "."}</p>;
  if (!canManage(role)) return <p className="text-sm text-muted-foreground">Owners and Managers decide approvals.</p>;
  return (
    <div className="grid gap-3">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {approval.carriesOut ? "Approving carries the proposal out right away, after checking it is still valid." : "Approving records your decision. Carrying it out is still on a person."}
      </p>
      <FormError message={error} />
      <div className="flex flex-wrap items-start gap-2">
        <HoldButton label="Hold to approve" holdingLabel="Keep holding" busy={busy} onConfirm={() => void run(() => decide({ companyId, approvalId, decision: "approved" }))} />
        <WithWords label="Handle myself" placeholder="What will you do instead?" confirm="I will handle it" onSubmit={(note) => decide({ companyId, approvalId, decision: "changed", note })} />
        <WithWords
          label={approval.jobId ? "Skip this cleaner, try the next" : "Skip this proposal"}
          placeholder="Why skip it? (optional)"
          confirm="Skip"
          required={false}
          variant="ghost"
          onSubmit={(note) => decide({ companyId, approvalId, decision: "skipped", note: note || undefined })}
        />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">Handling it yourself keeps the visit with you until you hand it back. Skipping tells the agent not to ask this cleaner for this visit and to try the next one.</p>
      {approval.jobId ? (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-medium text-strong">Alternatives</p>
          <DispatchView jobId={approval.jobId} now={now} canOffer={false} />
        </div>
      ) : null}
    </div>
  );
}

function TaskActions({ detail, timezone }: { detail: Detail; timezone: string }) {
  const { companyId } = useCompany();
  const taskId = detail.ref.id as Id<"tasks">;
  const setNext = useMutation(api.tasks.setNextAction);
  const complete = useMutation(api.tasks.complete);
  const cancel = useMutation(api.tasks.cancel);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const { busy, error, run, setError } = useRun();
  const status = detail.task!.status;
  if (status === "done" || status === "cancelled") return <p className="text-sm text-muted-foreground">This task is closed.</p>;
  return (
    <div className="grid gap-3">
      {open ? (
        <form
          className="grid gap-3 rounded-xl border border-border bg-muted p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const dueAt = zonedInstant(date, time, timezone);
            if (dueAt === null) return setError("Choose the day and time the next step is due.");
            void run(async () => {
              await setNext({ companyId, taskId, nextAction: action, dueAt });
              setOpen(false);
            });
          }}
        >
          <Field label="Next step" hint="Every open task needs a next action and a deadline.">
            <TextInput autoFocus value={action} onChange={(event) => setAction(event.target.value)} required maxLength={500} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Due on">
              <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label="At">
              <TextInput type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
            </Field>
          </div>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Set the next step
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Never mind
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant={status === "needs_decision" ? "primary" : "outline"} size="sm" onClick={() => setOpen(true)}>
            {status === "needs_decision" ? "Decide the next step" : "Change the next step"}
          </Button>
          <WithWords label="Close as done" placeholder="What was the outcome?" confirm="Close the task" onSubmit={(outcome) => complete({ companyId, taskId, outcome })} />
          <WithWords label="Cancel the task" placeholder="Why is it cancelled?" confirm="Cancel the task" variant="ghost" onSubmit={(reason) => cancel({ companyId, taskId, reason })} />
        </div>
      )}
    </div>
  );
}

/** The ways a person can step in, for whatever the panel is showing. */
export function DetailActions({ detail, now, timezone }: { detail: Detail; now: number; timezone: string }) {
  if (detail.job) return <JobActions detail={detail} now={now} />;
  if (detail.approval) return <ApprovalActions detail={detail} now={now} />;
  if (detail.task) return <TaskActions detail={detail} timezone={timezone} />;
  return null;
}
