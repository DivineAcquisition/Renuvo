"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { DispatchView } from "@/components/app/dispatch-view";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { HoldButton } from "@/components/app/hold-button";
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

function JobActions({ detail, now }: { detail: Detail; now: number }) {
  const { companyId } = useCompany();
  const job = detail.job!;
  const jobId = detail.ref.id as Id<"jobs">;
  const answer = useMutation(api.assignments.recordAnswer);
  const release = useMutation(api.assignments.release);
  const start = useMutation(api.jobs.start);
  const complete = useMutation(api.jobs.complete);
  const cancel = useMutation(api.jobs.cancel);
  const { busy, error, run } = useRun();
  const [offering, setOffering] = useState(false);
  const offered = job.assignments.filter((row) => row.status === "offered");
  const accepted = job.assignments.find((row) => row.status === "accepted");
  if (job.status === "completed" || job.status === "cancelled") return <p className="text-sm text-muted-foreground">This visit is closed. Nothing can be changed here.</p>;
  return (
    <div className="grid gap-3">
      <FormError message={error} />
      {offered.map((row) => (
        <div key={row.id} className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Record <span className="font-medium text-strong">{row.cleaner}</span>’s own answer. Cleaners do not have their own sign-in yet, so the office records it and the history says so.
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
      {accepted && job.status === "scheduled" ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => start({ companyId, jobId }))}>
            Start the visit
          </Button>
          <WithWords label={`Release ${accepted.cleaner}`} placeholder="Why is the cleaner coming off this visit?" confirm="Release" onSubmit={(reason) => release({ companyId, assignmentId: accepted.id, reason })} />
        </div>
      ) : null}
      {job.status === "in_progress" ? (
        <div>
          <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => complete({ companyId, jobId }))}>
            Mark the visit complete
          </Button>
        </div>
      ) : null}
      {job.status === "scheduled" && !accepted ? <DispatchView jobId={jobId} now={now} canOffer /> : null}
      {job.status === "scheduled" && !accepted ? (
        offering ? (
          <OfferForm jobId={jobId} now={now} />
        ) : (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setOffering(true)}>
              Offer to someone else, with pay I enter
            </Button>
          </div>
        )
      ) : null}
      <div>
        <WithWords label="Cancel the visit" placeholder="Why is the visit cancelled?" confirm="Cancel the visit" variant="destructive-outline" onSubmit={(reason) => cancel({ companyId, jobId, reason })} />
      </div>
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
