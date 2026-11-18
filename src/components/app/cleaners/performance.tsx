"use client";

/**
 * Performance and coaching on a cleaner's profile, for Owners and Managers. Every number shows what it counts,
 * over which period, from how many records, and the records themselves. The score is versioned and explained
 * part by part, or withheld as "Not enough history". It is never used to rank people or decide who is offered
 * work. Suggestions rest on records; drafts do nothing until a person publishes them.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { useNow } from "@/components/app/use-now";
import { Check, ChevronDown, Flag, Info, MessageSquareText, PenLine, Plus, Sparkles, TriangleAlert, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, longDay } from "@/lib/app/format";
import { useStableQuery } from "@/lib/app/stable-query";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type View = FunctionReturnType<typeof api.cleanerPerformance.forCleaner>;
type Measure = View["measures"][number];
type RecordRow = Measure["records"][number];
type Note = FunctionReturnType<typeof api.coaching.list>[number];

const TONE = { good: "text-success-foreground", neutral: "text-muted-foreground", concern: "text-warning-foreground" } as const;
const DOT = { good: "bg-success", neutral: "bg-muted-foreground/40", concern: "bg-warning" } as const;
const KIND_WORDS = { note: "Internal note", coaching: "Coaching", training: "Training", feedback: "Feedback" } as const;
const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

export function PerformanceSection({ cleanerId, name }: { cleanerId: string; name: string }) {
  const { companyId, role } = useCompany();
  const now = useNow();
  const manager = canManage(role);
  const data = useStableQuery(api.cleanerPerformance.forCleaner, manager && now ? { companyId, cleanerId: cleanerId as Id<"cleaners">, asOf: now } : "skip");
  const [disputing, setDisputing] = useState<{ row: RecordRow; measure: Measure } | null>(null);
  if (!manager) {
    return (
      <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center">
        <p className="font-medium text-strong">Performance and coaching are for Owners and Managers</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Ask one of them if something about this person&apos;s work needs a look.</p>
      </div>
    );
  }
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const first = name.trim().split(/\s+/)[0];
  return (
    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      {disputing ? <DisputeDialog row={disputing.row} measure={disputing.measure} onClose={() => setDisputing(null)} /> : null}
      <ScoreCard data={data} />
      <Suggestions data={data} cleanerId={cleanerId} firstName={first} />
      <section aria-label="Measures" className="grid grid-cols-1 gap-3 @3xl:col-span-2 @3xl:grid-cols-2">
        {data.measures.map((measure) => (
          <MeasureCard key={measure.key} measure={measure} onDispute={(row) => setDisputing({ row, measure })} />
        ))}
      </section>
      {data.disputes.length ? <Disputes data={data} /> : null}
      <Coaching cleanerId={cleanerId} firstName={first} className={data.disputes.length ? "" : "@3xl:col-span-2"} />
    </div>
  );
}

function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="font-heading text-base tracking-tight text-strong">{title}</h2>
        {action}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

// ── The score ───────────────────────────────────────────────────────────────────────────────────────

function ScoreCard({ data }: { data: View }) {
  const { timezone } = useCompany();
  const score = data.score;
  return (
    <Panel title="Score" action={<span className="text-xs text-muted-foreground">Last {data.periodDays} days</span>}>
      {score.state === "not_enough" ? (
        <div>
          <p className="font-display text-2xl font-semibold text-strong">Not enough history</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {score.have} accepted {score.have === 1 ? "job" : "jobs"} in the last {data.periodDays} days; a score needs {score.needed}. The records below are shown as they are.
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={score.needed} aria-valuenow={Math.min(score.have, score.needed)} aria-label={`${score.have} of ${score.needed} accepted jobs`}>
            <div className="h-full rounded-full bg-brand-500/60" style={{ width: `${Math.min(100, (score.have / score.needed) * 100)}%` }} />
          </div>
        </div>
      ) : (
        <div>
          <p className="flex items-baseline gap-1.5">
            <span className="font-display text-4xl font-semibold text-strong tabular-nums">{score.value}</span>
            <span className="text-sm text-muted-foreground">out of 100</span>
          </p>
          <ul className="mt-3 grid gap-2">
            {score.lines.map((line) => (
              <li key={line.key} className="text-sm">
                <p className={cn(line.points === null ? "text-muted-foreground" : "text-strong")}>{line.words}</p>
                {line.points !== null ? (
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(line.points / (data.method.weights[line.key as keyof typeof data.method.weights] ?? 1)) * 100}%` }} />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {score.newestRecordAt ? `Newest record counted: ${longDay(score.newestRecordAt, timezone)}. ` : "No record counted yet. "}
        Worked out live from the records as they are now; nothing about it is stored.
      </p>
      <p className="mt-3 flex gap-1.5 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {data.method.words} <span className="whitespace-nowrap">Version {data.version}.</span>
        </span>
      </p>
    </Panel>
  );
}

// ── Suggestions ─────────────────────────────────────────────────────────────────────────────────────

const DRAFT_KEY: Record<string, "late" | "no_show" | "recognize" | "unanswered"> = { no_show: "no_show", late: "late", recognize: "recognize", unanswered: "unanswered" };

function Suggestions({ data, cleanerId, firstName }: { data: View; cleanerId: string; firstName: string }) {
  const { companyId } = useCompany();
  const draft = useMutation(api.coaching.draftFromRecords);
  const openJob = useDetail();
  const { busy, error, run } = useRun();
  const [done, setDone] = useState<string | null>(null);
  return (
    <Panel title="What the records suggest">
      {data.recommendations.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing in {firstName}&apos;s records over the last {data.periodDays} days calls for action.</p>
      ) : (
        <ul className="grid gap-3">
          {data.recommendations.map((rec) => (
            <li key={rec.key} className="rounded-xl border border-border px-3 py-2.5">
              <p className="flex items-start gap-2">
                {rec.kind === "recognize" ? <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden /> : rec.kind === "decide" ? <Flag className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-strong">{rec.title}</span>
                  <span className="block text-sm text-muted-foreground">{rec.detail}</span>
                </span>
              </p>
              {rec.evidence.length ? (
                <p className="mt-2 flex flex-wrap gap-1.5">
                  {rec.evidence.map((row) => (
                    <button key={row.assignmentId} type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className="rounded-md bg-muted px-2 py-0.5 text-xs text-strong hover:bg-muted/70">
                      {row.label}
                    </button>
                  ))}
                </p>
              ) : null}
              {DRAFT_KEY[rec.key] ? (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const answer = await draft({ companyId, cleanerId: cleanerId as Id<"cleaners">, key: DRAFT_KEY[rec.key] });
                        setDone(answer.already ? "That draft is already waiting below." : "Drafted below. Nobody sees it until you publish it.");
                      })
                    }
                  >
                    <PenLine aria-hidden />
                    {rec.kind === "recognize" ? "Draft a thank-you" : rec.kind === "check" ? "Draft a note to check" : "Draft a note"}
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {done ? (
        <p className="mt-3 text-sm text-strong" role="status">
          {done}
        </p>
      ) : null}
      <FormError message={error} />
    </Panel>
  );
}

// ── Measures and their records ──────────────────────────────────────────────────────────────────────

function MeasureCard({ measure, onDispute }: { measure: Measure; onDispute: (row: RecordRow) => void }) {
  const { timezone } = useCompany();
  const openJob = useDetail();
  const [open, setOpen] = useState(false);
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium text-strong">{measure.label}</h3>
          <p className="text-xs text-muted-foreground">
            {measure.denominator ? `${measure.numerator} of ${measure.denominator}` : "No records"} · last {measure.periodDays} days
            {measure.key === "completion" ? " · shown, not scored" : ""}
          </p>
        </div>
        <span className={cn("font-display text-2xl font-semibold tabular-nums", measure.enough ? "text-strong" : "text-muted-foreground")}>{pct(measure.rate)}</span>
      </header>
      {!measure.enough && measure.denominator > 0 ? <p className="mt-1 text-xs text-muted-foreground">Fewer than {measure.minimum} records, so it does not count yet.</p> : null}
      {measure.breakdown.length ? (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {measure.breakdown.map((row) => (
            <li key={row.label} className={cn("flex items-center gap-1.5", TONE[row.tone])}>
              <span className={cn("size-1.5 rounded-full", DOT[row.tone])} aria-hidden />
              {row.label}: <span className="font-semibold">{row.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {measure.disputed ? <p className="mt-2 text-xs font-medium text-warning-foreground">{measure.disputed} disputed {measure.disputed === 1 ? "record is" : "records are"} left out until decided.</p> : null}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{measure.definition}</p>
      {measure.records.length ? (
        <div className="mt-3 border-t border-border pt-2">
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300">
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
            {open ? "Hide" : "See"} the {measure.records.length} {measure.records.length === 1 ? "record" : "records"}
          </button>
          {open ? (
            <ul className="mt-2 grid gap-1">
              {measure.records.map((row) => (
                <li key={row.assignmentId} className={cn("flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm", !row.counts && "bg-muted/40")}>
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", DOT[row.tone])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <button type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className="text-left text-strong underline-offset-4 hover:underline">
                      {row.label}
                    </button>
                    <span className={cn("block text-xs", TONE[row.tone])}>
                      {row.outcome}
                      {row.dispute ? ` · dispute ${row.dispute.status}` : ""}
                    </span>
                  </span>
                  {row.counts && row.tone === "concern" && !row.dispute ? (
                    <Button variant="ghost" size="xs" onClick={() => onDispute(row)}>
                      <Flag aria-hidden />
                      Dispute
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {open ? <p className="mt-1 text-[11px] text-muted-foreground">Dates are on the company&apos;s clock ({timezone}).</p> : null}
        </div>
      ) : null}
    </article>
  );
}

function DisputeDialog({ row, measure, onClose }: { row: RecordRow; measure: Measure; onClose: () => void }) {
  const { companyId } = useCompany();
  const raise = useMutation(api.cleanerPerformance.raiseDispute);
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <Modal open onClose={onClose} title="Dispute this record" description={`${row.label}: ${row.outcome}. It is left out of "${measure.label}" until someone else upholds or corrects it. The job's own record is not changed.`}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await raise({ companyId, assignmentId: row.assignmentId as Id<"assignments">, measure: measure.key, reason });
            onClose();
          });
        }}
      >
        <Field label="What is wrong with it">
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} required maxLength={1000} placeholder="The customer let her in 30 minutes late." />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Dispute
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Disputes({ data }: { data: View }) {
  const { timezone } = useCompany();
  const now = useNow();
  const [deciding, setDeciding] = useState<{ disputeId: string; decision: "upheld" | "corrected"; label: string } | null>(null);
  return (
    <Panel title="Disputed records">
      {deciding ? <DecideDialog {...deciding} onClose={() => setDeciding(null)} /> : null}
      <ul className="grid gap-2">
        {data.disputes.map((row) => (
          <li key={row.disputeId} className="rounded-xl border border-border px-3 py-2.5 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-strong">{row.label}</span>
              <Badge variant={row.status === "open" ? "warning" : row.status === "corrected" ? "info" : "outline"} size="sm">
                {row.status === "open" ? "Open" : row.status === "corrected" ? "Corrected" : "Upheld"}
              </Badge>
            </p>
            <p className="text-xs text-muted-foreground">
              {row.measureLabel} · raised by {row.raisedBy} {ago(row.createdAt, now, timezone)}
            </p>
            <p className="mt-1 text-strong">&ldquo;{row.reason}&rdquo;</p>
            {row.resolution ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {row.decidedBy}: {row.resolution}
              </p>
            ) : null}
            {row.status === "open" ? (
              <span className="mt-2 flex gap-1.5">
                <Button variant="outline" size="xs" onClick={() => setDeciding({ disputeId: row.disputeId, decision: "corrected", label: row.label })}>
                  The record is wrong
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setDeciding({ disputeId: row.disputeId, decision: "upheld", label: row.label })}>
                  The record stands
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function DecideDialog({ disputeId, decision, label, onClose }: { disputeId: string; decision: "upheld" | "corrected"; label: string; onClose: () => void }) {
  const { companyId } = useCompany();
  const decide = useMutation(api.cleanerPerformance.decideDispute);
  const { busy, error, run } = useRun();
  const [resolution, setResolution] = useState("");
  return (
    <Modal open onClose={onClose} title={decision === "corrected" ? "The record is wrong" : "The record stands"} description={decision === "corrected" ? `${label} is left out of their measures for good.` : `${label} counts again.`}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await decide({ companyId, disputeId: disputeId as Id<"recordDisputes">, decision, resolution });
            onClose();
          });
        }}
      >
        <Field label="What you found" hint="Kept with the record.">
          <TextArea value={resolution} onChange={(event) => setResolution(event.target.value)} rows={3} required maxLength={1000} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Decide
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Coaching ────────────────────────────────────────────────────────────────────────────────────────

function Coaching({ cleanerId, firstName, className }: { cleanerId: string; firstName: string; className?: string }) {
  const { companyId } = useCompany();
  const notes = useQuery(api.coaching.list, { companyId, cleanerId: cleanerId as Id<"cleaners"> });
  const [writing, setWriting] = useState<Note | "new" | null>(null);
  const live = notes?.filter((note) => note.status !== "withdrawn") ?? [];
  const old = notes?.filter((note) => note.status === "withdrawn") ?? [];
  return (
    <Panel
      title="Coaching and feedback"
      className={className}
      action={
        <Button variant="ghost" size="xs" onClick={() => setWriting("new")}>
          <Plus aria-hidden />
          New note
        </Button>
      }
    >
      {writing ? <NoteDialog cleanerId={cleanerId} firstName={firstName} note={writing === "new" ? null : writing} onClose={() => setWriting(null)} /> : null}
      {!notes ? (
        <Skeleton className="h-24 rounded-xl" />
      ) : live.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notes yet. Internal notes stay with the office; shared feedback appears in {firstName}&apos;s portal, where they can reply. Neither is a disciplinary step.</p>
      ) : (
        <ul className="grid gap-3">
          {live.map((note) => (
            <NoteRow key={note.noteId} note={note} firstName={firstName} onEdit={() => setWriting(note)} />
          ))}
        </ul>
      )}
      {old.length ? <p className="mt-3 text-xs text-muted-foreground">{old.length} withdrawn.</p> : null}
    </Panel>
  );
}

function NoteRow({ note, firstName, onEdit }: { note: Note; firstName: string; onEdit: () => void }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const publish = useMutation(api.coaching.publish);
  const resolve = useMutation(api.coaching.resolve);
  const withdraw = useMutation(api.coaching.withdraw);
  const openJob = useDetail();
  const { busy, error, run } = useRun();
  const draft = note.status === "draft" || note.status === "awaiting_review";
  const where = draft ? (note.visibility === "shared" ? `Draft: ${firstName} sees it once published` : "Draft: internal") : note.visibility === "shared" ? `Shared with ${firstName}` : "Internal";
  return (
    <li className={cn("rounded-xl border px-3 py-3", draft ? "border-dashed border-brand-500/50 bg-brand-950/40" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-strong">{note.title}</span>
            <Badge variant={draft ? "info" : note.status === "resolved" ? "outline" : "secondary"} size="sm">
              {draft ? "Draft" : note.status === "resolved" ? "Closed" : KIND_WORDS[note.kind]}
            </Badge>
          </p>
          <p className="text-xs text-muted-foreground">
            {where} · {note.author}
            {note.reviewedBy ? `, published by ${note.reviewedBy}` : ""} · {ago(note.createdAt, now, timezone)}
          </p>
        </div>
        {note.status !== "resolved" ? (
          <Button variant="ghost" size="xs" onClick={onEdit}>
            <PenLine aria-hidden />
            Edit
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-sm whitespace-pre-line text-strong">{note.body}</p>
      {note.evidence.length ? (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {note.evidence.map((row) => (
            <button key={`${row.kind}-${row.id ?? row.label}`} type="button" disabled={row.kind !== "job" || !row.id} onClick={() => row.id && openJob({ kind: "job", id: row.id as Id<"jobs"> })} className="rounded-md bg-muted px-2 py-0.5 text-xs text-strong hover:bg-muted/70 disabled:cursor-default">
              {row.label}
            </button>
          ))}
        </p>
      ) : null}
      {note.actions.length ? (
        <ul className="mt-2 grid gap-0.5 text-sm">
          {note.actions.map((action) => (
            <li key={action.text} className="flex items-center gap-1.5 text-muted-foreground">
              <Check className="size-3.5" aria-hidden />
              {action.text}
            </li>
          ))}
        </ul>
      ) : null}
      {note.followUpAt && note.status === "active" ? <p className={cn("mt-2 text-xs", note.followUpAt <= now ? "font-medium text-warning-foreground" : "text-muted-foreground")}>Follow up {note.followUpAt <= now ? "was due" : "on"} {longDay(note.followUpAt, timezone)}</p> : null}
      {note.response ? (
        <blockquote className="mt-2 border-l-2 border-brand-500/50 pl-3 text-sm text-strong">
          <MessageSquareText className="mr-1 inline size-3.5 text-muted-foreground" aria-hidden />
          {firstName}: &ldquo;{note.response.text}&rdquo; <span className="text-xs text-muted-foreground">{ago(note.response.at, now, timezone)}</span>
        </blockquote>
      ) : null}
      {note.outcome ? <p className="mt-2 text-xs text-muted-foreground">Outcome: {note.outcome}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {draft ? (
          <>
            <Button variant="primary" size="xs" loading={busy} onClick={() => void run(() => publish({ companyId, noteId: note.noteId }))}>
              {note.visibility === "shared" ? `Publish to ${firstName}` : "Keep as internal note"}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void run(() => withdraw({ companyId, noteId: note.noteId }))}>
              <X aria-hidden />
              Discard
            </Button>
          </>
        ) : note.status === "active" ? (
          <>
            <Button variant="outline" size="xs" loading={busy} onClick={() => void run(() => resolve({ companyId, noteId: note.noteId }))}>
              <Check aria-hidden />
              Close
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void run(() => withdraw({ companyId, noteId: note.noteId }))}>
              Withdraw
            </Button>
          </>
        ) : null}
      </div>
      <FormError message={error} />
    </li>
  );
}

function NoteDialog({ cleanerId, firstName, note, onClose }: { cleanerId: string; firstName: string; note: Note | null; onClose: () => void }) {
  const { companyId, timezone } = useCompany();
  const create = useMutation(api.coaching.create);
  const edit = useMutation(api.coaching.edit);
  const { busy, error, run } = useRun();
  const toDate = (at: number | null) => (at ? new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(at)) : "");
  const [form, setForm] = useState({ kind: note?.kind ?? ("coaching" as Note["kind"]), visibility: note?.visibility ?? ("internal" as "internal" | "shared"), title: note?.title ?? "", body: note?.body ?? "", followUp: toDate(note?.followUpAt ?? null) });
  const followUpAt = form.followUp ? Date.parse(`${form.followUp}T17:00:00Z`) : null;
  const shared = Boolean(note?.sharedAt);
  return (
    <Modal open onClose={onClose} title={note ? "Edit note" : "New note"} description={`Internal notes stay with the office. Shared feedback appears in ${firstName}'s portal, where they can reply.`}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (note) await edit({ companyId, noteId: note.noteId, title: form.title, body: form.body, visibility: shared ? undefined : form.visibility, followUpAt });
            else await create({ companyId, cleanerId: cleanerId as Id<"cleaners">, kind: form.kind, visibility: form.visibility, title: form.title, body: form.body, followUpAt: followUpAt ?? undefined });
            onClose();
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {!note ? (
            <Field label="Kind">
              <SelectInput value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as Note["kind"] })}>
                <option value="coaching">Coaching</option>
                <option value="feedback">Feedback</option>
                <option value="training">Training</option>
                <option value="note">Internal note</option>
              </SelectInput>
            </Field>
          ) : null}
          <Field label="Who sees it">
            <SelectInput value={form.visibility} disabled={shared} onChange={(event) => setForm({ ...form, visibility: event.target.value as "internal" | "shared" })}>
              <option value="internal">The office only</option>
              <option value="shared">{firstName} too, in their portal</option>
            </SelectInput>
          </Field>
        </div>
        <Field label="Title">
          <TextInput value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required maxLength={160} />
        </Field>
        <Field label="Note">
          <TextArea value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} rows={6} required maxLength={4000} />
        </Field>
        <Field label="Follow up on (optional)" hint="It shows in Needs attention on that day.">
          <TextInput type="date" value={form.followUp} onChange={(event) => setForm({ ...form, followUp: event.target.value })} />
        </Field>
        {form.visibility === "shared" && !note?.sharedAt && !(note && (note.status === "draft" || note.status === "awaiting_review")) ? <p className="text-sm text-muted-foreground">Saving shares it with {firstName} now.</p> : null}
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
