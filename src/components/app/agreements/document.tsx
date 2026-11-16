"use client";

import { useMutation } from "convex/react";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, TextArea, useRun } from "@/components/app/form";
import { Notice } from "@/components/app/agreements/shared";
import { QuestionField, shown, type Q } from "@/components/app/agreements/question";
import type { Detail } from "@/components/app/agreements/types";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { splitConfirm } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** A document with every missing fact marked where it is. Headings and paragraphs only: the text is never run as markup. */
export function DocumentView({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => markdown.replace(/\r\n/g, "\n").split(/\n{2,}/), [markdown]);
  return (
    <article className="grid gap-3 text-sm leading-relaxed text-strong">
      {blocks.map((block, index) => {
        const heading = /^(#{1,2})\s+([\s\S]*)$/.exec(block);
        if (heading) {
          const Tag = heading[1].length === 1 ? "h2" : "h3";
          return (
            <Tag key={index} className={cn("font-heading tracking-tight text-strong", Tag === "h2" ? "text-xl" : "mt-2 text-base")}>
              {heading[2]}
            </Tag>
          );
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            {splitConfirm(block).map((part, at) =>
              part.missing ? (
                <mark key={at} className="rounded bg-warning/25 px-1 py-0.5 font-medium text-warning-foreground" title="Still to confirm">
                  {part.text}
                </mark>
              ) : (
                <span key={at}>{part.text}</span>
              ),
            )}
          </p>
        );
      })}
    </article>
  );
}

/** The guided side of the studio: the next few questions, what is prefilled and from where, and what needs a decision. */
export function GuidePanel({ detail, editable }: { detail: Detail; editable: boolean }) {
  const { companyId } = useCompany();
  const answer = useMutation(api.companyAgreements.answer);
  const skip = useMutation(api.companyAgreements.skipTerm);
  const { busy, error, run } = useRun();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<{ message: string; affected: { title: string }[] } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const questions = detail.nextQuestions as Q[];
  const [seenVersion, setSeenVersion] = useState(detail.currentVersion);
  if (seenVersion !== detail.currentVersion) {
    setSeenVersion(detail.currentVersion);
    setDrafts({});
  }

  const submit = (regenerate = false) =>
    run(async () => {
      const answers = Object.fromEntries(Object.entries(drafts).filter(([, value]) => value.trim() !== ""));
      if (Object.keys(answers).length === 0) return;
      const result = await answer({ companyId, agreementId: detail.id as Id<"agreements">, baseVersion: detail.currentVersion, answers, regenerate });
      if (!result.ok) {
        if (result.reason === "edited") setHeld({ message: result.message, affected: result.affected });
        else throw Object.assign(new Error(result.message), { data: { message: result.message } });
        return;
      }
      setHeld(null);
      setSaved(result.reopened ? "Saved. The earlier approval was cleared because the text changed." : result.affected.length ? `Saved. Changed: ${result.affected.map((c) => c.title).join(", ")}.` : "Saved.");
    });

  return (
    <aside className="grid content-start gap-4" aria-label="Selestial's questions">
      <section className="rounded-2xl border border-brand-500/25 bg-gradient-to-b from-brand-500/[0.07] to-card p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-500/15 text-brand-600" aria-hidden>
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-strong">{questions.length ? "Selestial needs a few answers" : detail.progress.missing.length ? "A few answers are left for review" : "Everything required is answered"}</h3>
            <p className="text-xs text-muted-foreground">
              {detail.progress.answered} of {detail.progress.total} terms answered
            </p>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={detail.progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Terms answered">
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300 transition-[width] duration-500" style={{ width: `${detail.progress.percent}%` }} />
        </div>
        {questions.length > 0 && editable ? (
          <form
            className="mt-4 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="text-xs font-medium text-muted-foreground">{(questions[0] as Q & { groupLabel?: string }).groupLabel ?? ""}</p>
            {questions.map((q) => (
              <div key={q.key}>
                <QuestionField q={q} draft={drafts[q.key] ?? ""} onChange={(value) => setDrafts((current) => ({ ...current, [q.key]: value }))} />
                <button type="button" className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => void run(() => skip({ companyId, agreementId: detail.id as Id<"agreements">, key: q.key, skipped: true }))}>
                  Not decided yet: leave for review
                </button>
              </div>
            ))}
            <FormError message={error} />
            {held ? (
              <Notice tone="warning">
                {held.message}{" "}
                <button type="button" className="font-medium underline" onClick={() => void submit(true)}>
                  Regenerate {held.affected.map((a) => a.title).join(", ")}
                </button>
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" size="sm" loading={busy} disabled={Object.values(drafts).every((value) => !value.trim())}>
                Save answers
              </Button>
              {saved ? (
                <span role="status" className="text-xs text-muted-foreground">
                  {saved}
                </span>
              ) : null}
            </div>
          </form>
        ) : questions.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{detail.skipped.length ? `${detail.skipped.length} term${detail.skipped.length === 1 ? " is" : "s are"} marked to settle in review.` : "Nothing more to ask. Read the document, then send it for review."}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">You can read this document but not change it.</p>
        )}
        {detail.conversation?.id ? (
          <a href={`/app/chat/${detail.conversation.id}`} className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline">
            Continue this with Selestial in Chat
          </a>
        ) : null}
      </section>

      {detail.engagementMismatch ? <Notice tone="warning">{detail.engagementMismatch}</Notice> : null}
      {detail.readiness.errors.length ? (
        <Notice tone="error">
          <strong>Fix these first:</strong> {detail.readiness.errors.join(" ")}
        </Notice>
      ) : null}
      {detail.readiness.warnings.length ? <Notice tone="warning">{detail.readiness.warnings.join(" ")}</Notice> : null}

      <PrefilledFacts detail={detail} editable={editable} />
      <ReviewTopics detail={detail} />
    </aside>
  );
}

function PrefilledFacts({ detail, editable }: { detail: Detail; editable: boolean }) {
  const { companyId } = useCompany();
  const answer = useMutation(api.companyAgreements.answer);
  const { busy, error, run } = useRun();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const keys = Object.keys(detail.sources);
  const defs = new Map((detail.sections as { questions: Q[] }[]).flatMap((s) => s.questions).map((q) => [q.key, q]));
  if (keys.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-strong">Taken from your records</h3>
      <p className="text-xs text-muted-foreground">Not asked again. Correct anything that is wrong; your correction is used from now on in this agreement.</p>
      <ul className="mt-2 divide-y divide-border">
        {keys.map((key) => {
          const q = defs.get(key);
          if (!q) return null;
          return (
            <li key={key} className="py-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-xs text-muted-foreground">{q.label}</span>
                  <span className="block break-words text-strong">{shown(q) || "—"}</span>
                  <span className="block text-[0.6875rem] text-muted-foreground">{detail.sources[key]}</span>
                </span>
                {editable ? (
                  <button type="button" className="shrink-0 text-xs font-medium text-brand-600 hover:underline" onClick={() => (setEditing(key), setValue(shown(q)))}>
                    Correct
                  </button>
                ) : null}
              </div>
              {editing === key ? (
                <div className="mt-2 grid gap-2">
                  <QuestionField q={{ ...q, source: null }} draft={value} onChange={setValue} />
                  <FormError message={error} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" loading={busy} onClick={() => void run(async () => { const r = await answer({ companyId, agreementId: detail.id as Id<"agreements">, baseVersion: detail.currentVersion, answers: { [key]: value }, regenerate: true }); if (r.ok) setEditing(null); else throw Object.assign(new Error(), { data: { message: r.message } }); })}>
                      Save correction
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ReviewTopics({ detail }: { detail: Detail }) {
  if (detail.reviewNotes.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-strong">Worth a second look{detail.governingState ? ` in ${detail.governingState}` : ""}</h3>
      <ul className="mt-2 grid gap-2">
        {detail.reviewNotes.map((note) => (
          <li key={note.topic}>
            <details className="group rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium text-strong">
                {note.title}
                <span className={cn("rounded-full px-2 py-0.5 text-[0.6875rem]", note.severity === "specialist" ? "bg-warning/20 text-warning-foreground" : "bg-muted text-muted-foreground")}>{note.severity === "specialist" ? "Have a specialist review" : "Review"}</span>
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{note.why}</p>
              <p className="mt-1 text-xs font-medium text-strong">{note.ask}</p>
            </details>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[0.6875rem] text-muted-foreground">{detail.legalNotice}</p>
    </section>
  );
}

/** The document: read it, or edit the words. Editing saves a new version; it never changes an old one. */
export function DocumentPane({ detail, editable }: { detail: Detail; editable: boolean }) {
  const { companyId } = useCompany();
  const save = useMutation(api.companyAgreements.saveText);
  const regenerate = useMutation(api.companyAgreements.regenerate);
  const { busy, error, run } = useRun();
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [full, setFull] = useState(false);
  const [text, setText] = useState(detail.version.markdown);
  const [seenText, setSeenText] = useState(detail.version.hash);
  if (seenText !== detail.version.hash) {
    setSeenText(detail.version.hash);
    setText(detail.version.markdown);
  }
  const dirty = text !== detail.version.markdown;
  const canEdit = editable && detail.isCurrent;

  const body = (
    <div className={cn("flex flex-col", full ? "fixed inset-0 z-50 bg-background p-3 sm:p-5" : "")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5" role="tablist" aria-label="Document view">
          {(["read", "edit"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={mode === value} disabled={value === "edit" && !canEdit} onClick={() => setMode(value)} className={cn("rounded-md px-3 py-1 text-sm disabled:opacity-50", mode === value ? "bg-card font-medium text-strong shadow-sm" : "text-muted-foreground")}>
              {value === "read" ? "Preview" : "Edit text"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Version {detail.version.version}
            {!detail.isCurrent ? " (an earlier version, read only)" : ""}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setFull((value) => !value)} aria-pressed={full}>
            {full ? "Close full screen" : "Full screen"}
          </Button>
        </div>
      </div>
      {detail.version.unresolved.length ? (
        <Notice tone="warning" className="mb-3">
          {detail.version.unresolved.length} item{detail.version.unresolved.length === 1 ? "" : "s"} still marked TO CONFIRM. The document cannot be sent until they are settled.
        </Notice>
      ) : null}
      <div className={cn("min-h-0 flex-1 overflow-auto rounded-2xl border border-border bg-card p-4 sm:p-6", full ? "" : "max-h-[75vh]")}>
        {mode === "read" || !canEdit ? (
          <DocumentView markdown={detail.version.markdown} />
        ) : (
          <TextArea aria-label="Document text" value={text} onChange={(event) => setText(event.target.value)} rows={24} className="min-h-[50vh] font-mono text-[0.8125rem] leading-relaxed" />
        )}
      </div>
      {mode === "edit" && canEdit ? (
        <div className="mt-3 grid gap-2">
          <FormError message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" loading={busy} disabled={!dirty} onClick={() => void run(async () => { await save({ companyId, agreementId: detail.id as Id<"agreements">, baseVersion: detail.currentVersion, markdown: text }); setMode("read"); })}>
              Save as a new version
            </Button>
            <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setText(detail.version.markdown)}>
              Discard
            </Button>
            {detail.readiness.edited ? (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => regenerate({ companyId, agreementId: detail.id as Id<"agreements">, baseVersion: detail.currentVersion }))} title="Rebuilds the text from the clauses and answers, as a new version you can compare">
                Rebuild from clauses
              </Button>
            ) : null}
          </div>
          {detail.workflow === "approved" || detail.workflow === "needs_review" ? <p className="text-xs text-muted-foreground">Saving changes the text, so the approval will be cleared and the new version must be approved again.</p> : null}
        </div>
      ) : null}
    </div>
  );
  return body;
}
