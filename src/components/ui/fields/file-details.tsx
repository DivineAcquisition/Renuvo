"use client";

import { CheckCircle2, FileText, Loader2, RotateCcw, TriangleAlert, Upload, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** The kind of file in words, from its name or type. */
export function fileKind(name: string, type?: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const known: Record<string, string> = { csv: "CSV spreadsheet", xlsx: "Excel spreadsheet", xls: "Excel spreadsheet", tsv: "Tab-separated sheet", pdf: "PDF", docx: "Word document", txt: "Text file", json: "JSON file", png: "PNG image", jpg: "JPEG image", jpeg: "JPEG image" };
  return known[ext] ?? (type ? type.split("/").pop()!.toUpperCase() : "File");
}

export type FileState = "selected" | "uploading" | "checking" | "ready" | "processed" | "failed";

const STATE_WORDS: Record<FileState, string> = {
  selected: "Chosen, not uploaded yet",
  uploading: "Uploading…",
  checking: "Checking the file…",
  ready: "Checked and ready",
  processed: "Imported",
  failed: "Couldn't be used",
};

/**
 * One file, described the same way everywhere: name, kind, size, what is actually happening to it, the
 * counts that matter (rows found, rows skipped), and what can be done (replace, remove, try again). The
 * state shown is the real one passed in; nothing here simulates progress.
 */
export function FileDetails({ name, type, size, state, counts = [], error, onReplace, onRemove, onRetry, className }: { name: string; type?: string; size?: number; state: FileState; counts?: readonly { label: string; value: React.ReactNode }[]; error?: string | null; onReplace?: () => void; onRemove?: () => void; onRetry?: () => void; className?: string }) {
  const busy = state === "uploading" || state === "checking";
  return (
    <div className={cn("grid gap-2 rounded-xl border bg-card px-3.5 py-3", state === "failed" ? "border-destructive/40" : "border-border", className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-strong" title={name}>
            {name}
          </p>
          <p className="text-xs text-muted-foreground">
            {fileKind(name, type)}
            {size !== undefined ? ` · ${fileSize(size)}` : ""}
          </p>
          <p className={cn("mt-0.5 flex items-center gap-1 text-xs", state === "failed" ? "text-destructive-foreground" : state === "ready" || state === "processed" ? "text-success-foreground" : "text-muted-foreground")} role="status" aria-live="polite">
            {busy ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : state === "failed" ? <TriangleAlert className="size-3.5" aria-hidden /> : state === "ready" || state === "processed" ? <CheckCircle2 className="size-3.5" aria-hidden /> : null}
            {STATE_WORDS[state]}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {onRetry && state === "failed" ? (
            <Button type="button" variant="ghost" size="xs" onClick={onRetry}>
              <RotateCcw aria-hidden /> Try again
            </Button>
          ) : null}
          {onReplace && !busy ? (
            <Button type="button" variant="ghost" size="xs" onClick={onReplace}>
              <Upload aria-hidden /> Replace
            </Button>
          ) : null}
          {onRemove && !busy ? (
            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${name}`} onClick={onRemove}>
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      {counts.length ? (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
          {counts.map((row) => (
            <div key={row.label} className="flex gap-1">
              <dt className="text-muted-foreground">{row.label}</dt>
              <dd className="font-medium text-strong tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
