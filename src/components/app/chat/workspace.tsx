"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/components/app/chat/markdown";
import { useCompany } from "@/components/app/company";
import { messageOf, SelectInput } from "@/components/app/form";
import { CheckCircle2, Copy, Download, FileText, Hand, PenLine, Split, TriangleAlert, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { diffCounts, diffLines } from "@/lib/app/chat/diff";
import { plainText } from "@/lib/app/chat/markdown";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

type Mode = "read" | "edit" | "compare";

const NEXT_STATE = { draft: "terms_approved", terms_approved: "sent", sent: "signed" } as const;
const NEXT_WORDS = { draft: "Mark terms approved", terms_approved: "Record as sent", sent: "Record as signed" } as const;
const NEXT_HELP = {
  draft: "You reviewed this version's terms and approve them. A later edit makes it a draft again.",
  terms_approved: "You sent this version yourself, outside Selestial. Nothing is sent by this.",
  sent: "It was signed outside Selestial. No signing service is connected; this is your record of it.",
} as const;

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (title: string) => title.replace(/[^\w\s-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60) || "draft";

/** A draft beside the conversation: read it, edit it into a new version, compare versions, and record what happened to it. */
export function DocumentWorkspace({ artifactId, onClose }: { artifactId: string; onClose: () => void }) {
  const { companyId } = useCompany();
  const [version, setVersion] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("read");
  const [edit, setEdit] = useState("");
  const [note, setNote] = useState("");
  const [stateNote, setStateNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const doc = useQuery(api.chatArtifacts.get, { companyId, artifactId, version: version ?? undefined });
  const older = useQuery(api.chatArtifacts.get, compareTo ? { companyId, artifactId, version: compareTo } : "skip");
  const save = useMutation(api.chatArtifacts.save);
  const setState = useMutation(api.chatArtifacts.setState);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [artifactId]);

  const content = doc?.version?.content ?? "";
  const lines = useMemo(() => (older?.version && doc?.version ? diffLines(older.version.content, doc.version.content) : []), [older, doc]);
  if (doc === undefined) return <div className="p-6 text-sm text-muted-foreground">Opening the draft…</div>;
  const latest = doc.version?.version === doc.currentVersion;
  const unresolved = doc.version?.unresolved ?? [];
  const next = doc.state === "signed" ? null : NEXT_STATE[doc.state];

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await work();
      setSaved(done);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={`Draft: ${doc.title}`} className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300" aria-hidden>
          <FileText className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 ref={heading} tabIndex={-1} className="truncate font-heading text-base tracking-tight text-strong outline-none">
            {doc.title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {doc.stateWords}
            {doc.approvedVersion ? ` (version ${doc.approvedVersion})` : ""} · version {doc.version?.version ?? "?"} of {doc.currentVersion}
            {doc.source ? (doc.source.deleted ? " · from a deleted chat" : null) : null}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close the draft" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
          <X className="size-4" aria-hidden />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
        <div role="tablist" aria-label="View" className="flex rounded-lg border border-border bg-muted p-0.5">
          {(["read", "edit", "compare"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              disabled={value === "edit" && !latest}
              onClick={() => {
                setMode(value);
                setSaved(null);
                setError(null);
                if (value === "edit") setEdit(content);
                if (value === "compare" && !compareTo && doc.versions.length > 1) setCompareTo(doc.versions.find((row) => row.version < (doc.version?.version ?? 0))?.version ?? null);
              }}
              className={cn("inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-semibold disabled:opacity-40", mode === value ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
            >
              {value === "read" ? <FileText className="size-3.5" aria-hidden /> : value === "edit" ? <PenLine className="size-3.5" aria-hidden /> : <Split className="size-3.5" aria-hidden />}
              {value === "read" ? "Preview" : value === "edit" ? "Edit" : "Compare"}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Version
          <SelectInput value={doc.version?.version ?? doc.currentVersion} onChange={(event) => setVersion(Number(event.target.value) === doc.currentVersion ? null : Number(event.target.value))} className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-strong">
            {doc.versions.map((row) => (
              <option key={row.version} value={row.version}>
                {row.version}
                {row.version === doc.currentVersion ? " (latest)" : ""} · {row.author === "assistant" ? "Selestial" : "you"}
                {row.note ? ` · ${row.note}` : ""}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {!latest ? (
          <p className="mb-3 flex items-center gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2 text-xs text-info-foreground">
            You are looking at version {doc.version?.version}. Edits are made to the latest version.
            <button type="button" className="font-semibold underline" onClick={() => setVersion(null)}>
              Go to latest
            </button>
          </p>
        ) : null}
        {unresolved.length > 0 && mode === "read" ? (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {unresolved.length} term{unresolved.length === 1 ? " is" : "s are"} still to confirm: {unresolved.slice(0, 4).join("; ")}
            {unresolved.length > 4 ? "…" : ""}
          </p>
        ) : null}
        {mode === "read" ? <Markdown source={content} /> : null}
        {mode === "edit" ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await save({ companyId, artifactId, baseVersion: doc.currentVersion, content: edit, note: note || undefined });
                setNote("");
                setMode("read");
              }, "Saved as a new version.");
            }}
          >
            <label className="grid gap-1 text-xs font-medium text-strong">
              Markdown
              <textarea value={edit} onChange={(event) => setEdit(event.target.value)} rows={18} className="min-h-[18rem] rounded-xl border border-border bg-background p-3 font-mono text-[13px] leading-relaxed text-strong outline-none focus:border-brand-500/60" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-strong">
              What changed (optional)
              <input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm font-normal text-strong outline-none focus:border-brand-500/60" />
            </label>
            <div className="flex gap-2">
              <Button type="submit" variant="gradient" size="sm" loading={busy} disabled={edit === content}>
                Save version {doc.currentVersion + 1}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode("read")}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
        {mode === "compare" ? (
          doc.versions.length < 2 ? (
            <p className="text-sm text-muted-foreground">There is only one version so far.</p>
          ) : (
            <div className="grid gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Compare version {doc.version?.version} with
                <SelectInput value={compareTo ?? ""} onChange={(event) => setCompareTo(Number(event.target.value) || null)} className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-strong">
                  {doc.versions
                    .filter((row) => row.version !== doc.version?.version)
                    .map((row) => (
                      <option key={row.version} value={row.version}>
                        version {row.version}
                      </option>
                    ))}
                </SelectInput>
              </label>
              {lines.length ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {diffCounts(lines).added} line(s) added, {diffCounts(lines).removed} removed.
                  </p>
                  <pre className="overflow-x-auto rounded-xl border border-border font-mono text-[12px] leading-relaxed">
                    {lines.map((line, index) => (
                      <div key={index} className={cn("px-3 whitespace-pre-wrap", line.kind === "added" ? "bg-[var(--an-diff-added-bg)] text-[var(--an-diff-added-text)]" : line.kind === "removed" ? "bg-[var(--an-diff-removed-bg)] text-[var(--an-diff-removed-text)] line-through decoration-1" : "text-muted-foreground")}>
                        <span className="sr-only">{line.kind === "added" ? "Added: " : line.kind === "removed" ? "Removed: " : ""}</span>
                        {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                        {line.text || " "}
                      </div>
                    ))}
                  </pre>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
            </div>
          )
        ) : null}
      </div>

      <footer className="grid gap-2 border-t border-border px-4 py-3">
        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="flex items-center gap-1.5 text-xs text-success-foreground">
            <CheckCircle2 className="size-3.5" aria-hidden /> {saved}
          </p>
        ) : null}
        {doc.canRecord && next && latest ? (
          <div className="grid gap-1.5 rounded-xl border border-border bg-muted/40 p-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-strong">
              <Hand className="size-3.5 text-brand-300" aria-hidden /> {NEXT_HELP[doc.state as keyof typeof NEXT_HELP]}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={stateNote} onChange={(event) => setStateNote(event.target.value)} maxLength={500} placeholder="Note (optional), for example who signed" aria-label="Note" className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 text-xs text-strong outline-none focus:border-brand-500/60" />
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    await setState({ companyId, artifactId, version: doc.currentVersion, state: next, note: stateNote || undefined });
                    setStateNote("");
                  }, "Recorded.")
                }
              >
                {NEXT_WORDS[doc.state as keyof typeof NEXT_WORDS]}
              </Button>
            </div>
            {doc.state === "draft" && unresolved.length ? <p className="text-[11px] text-warning-foreground">Fields marked to confirm are still open.</p> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(`${fileName(doc.title)}-v${doc.version?.version}.md`, content, "text/markdown")}>
            <Download className="size-3.5" aria-hidden /> Markdown
          </Button>
          <Button size="sm" variant="outline" onClick={() => download(`${fileName(doc.title)}-v${doc.version?.version}.txt`, plainText(content), "text/plain")}>
            <Download className="size-3.5" aria-hidden /> Text
          </Button>
          {doc.source && !doc.source.deleted ? (
            <Link href={`/app/chat/${doc.source.conversationId}`} className="ml-auto text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
              From “{doc.source.title}”
            </Link>
          ) : null}
        </div>
      </footer>
    </section>
  );
}
