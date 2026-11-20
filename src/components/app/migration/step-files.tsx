"use client";

/**
 * Step 2: upload exports. Each file is read on the server; the card says what Selestial thinks it is and
 * the columns that told it, and the owner can change that. Missing pieces are named: bookings without
 * their customers, schedules without services.
 */
import { useConvex, useMutation } from "convex/react";
import Link from "next/link";
import { useRef, useState } from "react";

import { SelectInput, TextInput } from "@/components/app/form";
import { Download, ExternalLink, FileSpreadsheet, Loader2, Trash2, TriangleAlert, Upload } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { FILE_KINDS, IMPORTABLE, KIND_LABELS, type FileKind } from "../../../../convex/lib/migration/rules";
import { templateCsv, TEMPLATES } from "../../../../convex/lib/migration/sources";
import { download, plural, useMigration, type FileView } from "./context";
import { Note, Section, StepHeading } from "./parts";

const LOOKS_LIKE = { jobber: "Jobber", housecall_pro: "Housecall Pro", bookingkoala: "BookingKoala" } as const;

export function FilesStep() {
  const { view, companyId, act, locked } = useMigration();
  const uploadUrl = useMutation(api.migration.uploadUrl);
  const addFile = useMutation(api.migration.addFile);
  const input = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function send(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      setSending((list) => [...list, file.name]);
      await act(async () => {
        const url = await uploadUrl({ companyId });
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "text/csv" }, body: file });
        if (!response.ok) throw new Error("upload failed");
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        await addFile({ companyId, storageId, name: file.name });
      });
      setSending((list) => list.filter((name) => name !== file.name));
    }
    if (input.current) input.current.value = "";
  }

  const ready = view.files.filter((f) => f.status === "ready");
  const kinds = new Set(ready.map((f) => f.kind));
  const gaps: string[] = [];
  if ((kinds.has("bookings") || kinds.has("recurring") || kinds.has("properties")) && !kinds.has("customers")) gaps.push("Your bookings, schedules or properties need their customers. Add your customer export too, unless these customers are already in Selestial.");
  if ((kinds.has("bookings") || kinds.has("recurring")) && !view.services.length) gaps.push("Bookings and recurring services are matched to your Selestial services, and you have none live yet. Publish your services in Services & Pricing first.");
  if (kinds.has("customers") && !kinds.has("bookings") && !kinds.has("recurring") && view.migration.wants.some((w) => w === "bookings" || w === "recurring")) gaps.push("You said you want to bring upcoming work. Add a bookings or recurring services export when you have one.");

  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <StepHeading eyebrow="Step 2 of 6" title="Add your files" lead="Upload CSV exports from your current system. Add as many as you have; Selestial works out what each one contains and how they connect." />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!locked) void send(e.dataTransfer.files);
        }}
        className={cn("grid justify-items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-9 text-center transition-colors motion-reduce:transition-none", dragging ? "border-brand-500 bg-brand-500/[0.06]" : "border-border bg-muted/20")}
      >
        <span className="grid size-11 place-items-center rounded-full bg-brand-500/10 text-brand-300">
          <Upload className="size-5" aria-hidden />
        </span>
        <div className="grid gap-1">
          <p className="text-sm font-semibold text-strong">Drop CSV files here</p>
          <p className="text-xs text-muted-foreground">Up to {view.limits.files} files, 5 MB and {view.limits.rowsPerFile.toLocaleString()} rows each. Excel files: save as CSV first.</p>
        </div>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" multiple className="sr-only" id="migration-files" aria-label="Choose CSV files to upload" onChange={(e) => e.target.files && void send(e.target.files)} disabled={locked} />
        <Button variant="primary" onClick={() => input.current?.click()} disabled={locked}>
          <FileSpreadsheet aria-hidden />
          Choose files
        </Button>
        {sending.length ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
            Uploading {sending.join(", ")}
          </p>
        ) : null}
      </div>

      <Note>Used the quick import in setup already? Clients it brought in are recognized here, and appointments or schedules waiting there are flagged so nothing is booked twice.</Note>

      {gaps.map((gap) => (
        <Note key={gap} tone="warning">
          {gap}{" "}
          {gap.includes("Services & Pricing") ? (
            <Link href="/app/services" className="font-medium underline underline-offset-2">
              Open Services & Pricing
            </Link>
          ) : null}
        </Note>
      ))}

      {view.files.length ? (
        <Section title="Your files" lead="Check what each file contains. If Selestial guessed wrong, change it.">
          <ul className="grid gap-3">
            {view.files.map((file) => (
              <FileCard key={file.id} file={file} />
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Starting from your own spreadsheet?" lead="Download a template with the columns Selestial reads. Keep the header row; leave any column blank you don't have.">
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map((kind) => (
            <button key={kind} type="button" onClick={() => download(TEMPLATES[kind].file, templateCsv(kind))} className="flex items-center gap-3 rounded-xl border border-border p-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand-500">
              <Download className="size-4 shrink-0 text-brand-300" aria-hidden />
              <span className="grid">
                <span className="text-sm font-medium text-strong">{KIND_LABELS[kind].label} template</span>
                <span className="text-xs text-muted-foreground">{TEMPLATES[kind].header.slice(0, 4).join(", ")}…</span>
              </span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function FileCard({ file }: { file: FileView }) {
  const { companyId, act, locked } = useMigration();
  const convex = useConvex();
  const setKind = useMutation(api.migration.setFileKind);
  const remove = useMutation(api.migration.removeFile);
  const [description, setDescription] = useState(file.description ?? "");
  const importable = (IMPORTABLE as readonly string[]).includes(file.kind);

  return (
    <li className="grid gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", file.status === "failed" ? "bg-destructive/10 text-destructive-foreground" : "bg-brand-500/10 text-brand-300")}>
            {file.status === "reading" ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : file.status === "failed" ? <TriangleAlert className="size-4" aria-hidden /> : <FileSpreadsheet className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-strong">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {file.status === "reading" ? "Reading the file…" : file.status === "failed" ? file.problem : `${plural(file.rowCount, "row")} · ${file.header.length} columns · ${(file.size / 1024).toFixed(0)} KB`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {file.looksLike ? <Badge variant="info">Looks like a {LOOKS_LIKE[file.looksLike]} export</Badge> : null}
          {file.status === "ready" ? (
            <Button variant="ghost" size="icon-sm" aria-label={`Open the original ${file.name}`} onClick={() => void act(async () => {
              const url = await convex.query(api.migration.fileUrl, { companyId, fileId: file.id });
              if (url) window.open(url, "_blank", "noopener");
            })}>
              <ExternalLink aria-hidden />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} disabled={locked || file.status === "reading"} onClick={() => void act(() => remove({ companyId, fileId: file.id }))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      {file.status === "ready" ? (
        <div className="grid gap-2 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-start">
          <label className="grid gap-1 text-xs font-medium text-strong">
            This file contains
            <SelectInput value={file.kind} disabled={locked} onChange={(e) => void act(() => setKind({ companyId, fileId: file.id, kind: e.target.value as FileKind }))}>
              {FILE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind].label}
                  {(IMPORTABLE as readonly string[]).includes(kind) ? "" : " (kept, not imported yet)"}
                </option>
              ))}
            </SelectInput>
          </label>
          <div className="grid gap-1 text-xs text-muted-foreground">
            <p>{KIND_LABELS[file.kind].contains}</p>
            {file.suggested.kind === file.kind && file.suggested.because.length ? <p>Selestial thought so from the columns {file.suggested.because.slice(0, 4).map((c) => `"${c}"`).join(", ")}.</p> : null}
            {file.suggested.kind !== file.kind ? <p>You changed this from {KIND_LABELS[file.suggested.kind].label.toLowerCase()}.</p> : null}
            {!importable ? <p className="text-warning-foreground">Selestial keeps this file with your migration but doesn&apos;t import it yet. It&apos;s listed in your completion report as not transferred.</p> : null}
          </div>
          {file.kind === "other" ? (
            <label className="grid gap-1 text-xs font-medium text-strong sm:col-span-2">
              What is it? (optional)
              <TextInput value={description} maxLength={300} placeholder="For example: gate codes for our Airbnb properties" onChange={(e) => setDescription(e.target.value)} onBlur={() => description !== (file.description ?? "") && void act(() => setKind({ companyId, fileId: file.id, kind: file.kind, description }))} />
            </label>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
