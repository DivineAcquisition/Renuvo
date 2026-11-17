"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { AlertTriangle, CameraIcon, CheckCircle2, Download, ExternalLink, FileText, HistoryIcon, Loader2, Plus, ReceiptIcon, Settings2, Sparkles, Trash2, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { guessSign, guessStatementColumns, parseCsv, statementRows, type SpendSign, type StatementColumns } from "@/lib/app/expenses";
import { calendarDate, clientKey, moment, moneyInput, parseMoney, PERIODS, todayKey, usd, type PeriodId } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { FinanceNav } from "./finance-screen";
import { Chip, Empty, Notice, eyebrow } from "./kit";

/**
 * Finance › Expenses. Receipts the Owner snaps or uploads (Selestial reads them into drafts), expenses
 * typed by hand, and rows from a bank or card statement. Drafts wait in "To review" until the Owner
 * records them, or until one of the Owner's own rules files them. A suggestion is always shown as one.
 */

type Overview = FunctionReturnType<typeof api.expenses.overview>;
type Row = Overview["rows"][number];
type Detail = FunctionReturnType<typeof api.expenses.expense>;
type Nav = FinanceNav & { set: (c: Record<string, string | null>, push?: boolean) => void; params: URLSearchParams };

const FILTERS = [
  { id: "review", label: "To review" },
  { id: "recorded", label: "Recorded" },
  { id: "owed_back", label: "Owed back to you" },
  { id: "all", label: "All" },
  { id: "void", label: "Voided" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const PAID_WITH = [
  { id: "business_card", label: "Business card" },
  { id: "bank", label: "Bank account" },
  { id: "cash", label: "Cash" },
  { id: "personal", label: "I paid personally" },
  { id: "other", label: "Other" },
] as const;
type PaidWith = (typeof PAID_WITH)[number]["id"];

const STATUS_TONE: Record<Row["status"], "warning" | "success" | "muted"> = { to_review: "warning", recorded: "success", void: "muted" };

// ── Uploading receipts ───────────────────────────────────────────────────────────────────────────

/** A photo is made smaller and turned into a JPEG before it leaves the phone; a PDF goes as it is. */
async function prepareReceipt(file: File): Promise<File> {
  if (file.type === "application/pdf" || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 4_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function useReceiptUpload() {
  const { companyId } = useCompany();
  const generate = useMutation(api.expenses.generateUploadUrl);
  const add = useMutation(api.expenses.addReceipts);
  const [state, setState] = useState<{ busy: boolean; done: { name: string; problem: string | null; expenseId: Id<"expenses"> | null }[] | null; error: string | null }>({ busy: false, done: null, error: null });
  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 20);
    if (!list.length) return;
    setState({ busy: true, done: null, error: null });
    try {
      const stored: { storageId: Id<"_storage">; name: string }[] = [];
      for (const original of list) {
        const file = await prepareReceipt(original);
        const url = await generate({ companyId });
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!response.ok) throw new Error("upload");
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        stored.push({ storageId, name: original.name });
      }
      const { results } = await add({ companyId, files: stored });
      setState({ busy: false, done: results, error: null });
    } catch {
      setState({ busy: false, done: null, error: "The upload didn't finish. Check your connection and try again." });
    }
  };
  return { ...state, upload, clear: () => setState({ busy: false, done: null, error: null }) };
}

// ── The tab ──────────────────────────────────────────────────────────────────────────────────────

export function ExpensesTab({ nav }: { nav: Nav }) {
  const { companyId } = useCompany();
  const filter = (FILTERS.find((f) => f.id === nav.filter)?.id ?? "review") as Filter;
  const data = useQuery(api.expenses.overview, { companyId, period: nav.period, filter });
  const recordMany = useMutation(api.expenses.recordMany);
  const uploads = useReceiptUpload();
  const snapRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<null | "add" | "import" | "rules" | "record">(null);
  const [recordResult, setRecordResult] = useState<string | null>(null);
  const { busy, error, run } = useRun();
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  const t = data.totals;
  const ready = data.readyToRecord;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span className="sr-only">Period</span>
          <select value={nav.period} onChange={(event) => nav.set({ period: event.target.value === "this_month" ? null : (event.target.value as PeriodId) })} className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <input ref={snapRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => (e.target.files && void uploads.upload(e.target.files), (e.target.value = ""))} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => (e.target.files && void uploads.upload(e.target.files), (e.target.value = ""))} />
        <div className="ml-auto hidden flex-wrap gap-2 sm:flex">
          <Button variant="default" disabled={uploads.busy} onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden />
            Upload receipts
          </Button>
          <Button variant="outline" onClick={() => setDialog("add")}>
            <Plus aria-hidden />
            Add by hand
          </Button>
          <Button variant="outline" onClick={() => setDialog("import")}>
            <FileText aria-hidden />
            Import statement
          </Button>
          <Button variant="ghost" onClick={() => setDialog("rules")}>
            <Settings2 aria-hidden />
            Rules
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="ml-auto sm:hidden" onClick={() => setDialog("rules")}>
          <Settings2 aria-hidden />
          Rules
        </Button>
      </div>
      {/* On a phone: snapping a receipt comes first. */}
      <div className="grid gap-2 sm:hidden">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
          <Button variant="default" disabled={uploads.busy} onClick={() => snapRef.current?.click()}>
            <CameraIcon aria-hidden />
            Snap receipt
          </Button>
          <Button variant="outline" disabled={uploads.busy} onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden />
            Upload
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDialog("add")}>
            <Plus aria-hidden />
            Add by hand
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDialog("import")}>
            <FileText aria-hidden />
            Import statement
          </Button>
        </div>
      </div>

      {uploads.busy ? (
        <Notice tone="info" title="Uploading receipts…">Selestial reads each one as soon as it arrives.</Notice>
      ) : uploads.error ? (
        <Notice tone="warning" title="Upload didn't finish" action={<Button size="xs" variant="ghost" onClick={uploads.clear}>Dismiss</Button>}>
          {uploads.error}
        </Notice>
      ) : uploads.done ? (
        <Notice tone={uploads.done.some((d) => d.problem) ? "warning" : "success"} title={`${uploads.done.filter((d) => !d.problem).length} of ${uploads.done.length} receipt${uploads.done.length === 1 ? "" : "s"} added`} action={<Button size="xs" variant="ghost" onClick={uploads.clear}>Dismiss</Button>}>
          {uploads.done.some((d) => d.problem) ? (
            <ul className="grid gap-0.5">
              {uploads.done
                .filter((d) => d.problem)
                .map((d) => (
                  <li key={d.name}>
                    {d.name}: {d.problem}
                  </li>
                ))}
            </ul>
          ) : (
            "Selestial is reading them. Each waits in To review for you to check and record."
          )}
        </Notice>
      ) : null}

      <section aria-label="Expenses summary" className="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-3">
        {[
          { label: `Spent · ${data.period.label}`, value: t.spentCents, sub: t.spentCount ? `Job costs ${usd(t.jobCostCents)} · Overhead ${usd(t.overheadCents)}` : "Nothing recorded in this period", filter: "recorded" as const },
          { label: "To review", value: t.reviewCents, sub: `${t.reviewCount} waiting${t.reading ? ` · ${t.reading} being read` : ""}${t.reviewMissing - t.reading > 0 ? ` · ${t.reviewMissing - t.reading} with no amount yet` : ""}${t.repeats ? ` · ${t.repeats} possible repeat${t.repeats === 1 ? "" : "s"}` : ""}`, tone: t.reviewCount ? "warning" : undefined, filter: "review" as const },
          { label: "Owed back to you", value: t.owedBackCents, sub: t.owedBackCount ? `${t.owedBackCount} you paid personally` : "Nothing you paid personally is waiting", filter: "owed_back" as const },
        ].map((cell, i) => (
          <button
            key={cell.label}
            type="button"
            onClick={() => nav.set({ filter: cell.filter === "review" ? null : cell.filter })}
            className={cn("px-4 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5", i > 0 && "border-t border-border sm:border-t-0 sm:border-l", filter === cell.filter && "bg-muted/40")}
          >
            <span className={eyebrow}>{cell.label}</span>
            <span className={cn("mt-2 block font-heading text-2xl leading-none tracking-tight tabular-nums sm:text-[1.7rem]", cell.tone === "warning" ? "text-warning-foreground" : "text-strong")}>{usd(cell.value)}</span>
            <span className="mt-2 block text-xs text-muted-foreground">{cell.sub}</span>
          </button>
        ))}
      </section>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Show" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:px-0">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => nav.set({ filter: f.id === "review" ? null : f.id })}
                  className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500", filter === f.id ? "border-brand-500/50 bg-brand-500/10 text-strong" : "border-border bg-card text-muted-foreground hover:text-strong")}
                >
                  {f.label}
                  {f.id in data.counts ? <span className="text-xs tabular-nums text-muted-foreground">{data.counts[f.id as keyof typeof data.counts]}</span> : null}
                </button>
              ))}
            </div>
            <div className="ml-auto flex gap-2">
              {filter === "review" && ready.length > 0 ? (
                <Button size="sm" variant="default" onClick={() => setDialog("record")}>
                  <CheckCircle2 aria-hidden />
                  Record {ready.length} ready
                </Button>
              ) : null}
              {filter === "recorded" && data.rows.length ? (
                <Button size="sm" variant="ghost" onClick={() => downloadCsv(data)}>
                  <Download aria-hidden />
                  CSV
                </Button>
              ) : null}
            </div>
          </div>
          {recordResult ? <Notice tone="success" title={recordResult} action={<Button size="xs" variant="ghost" onClick={() => setRecordResult(null)}>Dismiss</Button>} /> : null}
          <FormError message={error} />
          <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Expenses">
            {data.rows.length === 0 ? (
              <Empty
                icon={ReceiptIcon}
                title={filter === "review" ? "Nothing waiting" : "Nothing here"}
                body={filter === "review" ? "Snap or upload a receipt, add an expense by hand, or import a bank or card statement. Selestial prepares each one for you to check." : filter === "owed_back" ? "Expenses you paid personally show here until the business pays you back." : "No expenses in this view for the period."}
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.rows.map((row) => (
                  <ExpenseRow key={row.id} row={row} onOpen={() => nav.set({ expense: row.id }, true)} />
                ))}
              </ul>
            )}
          </section>
          {filter === "owed_back" && data.rows.length ? <RepaidBar rows={data.rows} /> : null}
        </div>

        <aside className="grid min-w-0 gap-4 lg:sticky lg:top-20">
          <CategoryBreakdown data={data} />
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            Stripe&apos;s card fees are kept on each payment and cleaner pay is in Team Pay, so neither is entered here. Spent counts recorded expenses by the day they were paid.
          </p>
        </aside>
      </div>

      <AddExpenseDialog open={dialog === "add"} onClose={() => setDialog(null)} onAdded={(id) => (setDialog(null), nav.set({ expense: id }, true))} />
      {dialog === "import" ? <ImportDialog onClose={() => setDialog(null)} /> : null}
      <RulesSheet open={dialog === "rules"} onClose={() => setDialog(null)} />
      <Modal open={dialog === "record"} onClose={() => setDialog(null)} title={`Record ${ready.length} expense${ready.length === 1 ? "" : "s"}`} description="Only expenses with everything read clearly and no possible repeat are included. Where Selestial suggested the category, recording accepts the suggestion.">
        <div className="grid gap-4">
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border">
            {ready.map((item) => {
              const row = data.rows.find((r) => r.id === item.expenseId);
              return row ? (
                <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-strong">{row.vendor}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {calendarDate(row.spentOn, false)} · {row.category?.name ?? (row.suggestion ? `${row.suggestion.name} (suggested)` : "")}
                    </span>
                  </span>
                  <span className="tabular-nums text-strong">{usd(row.amountCents ?? 0)}</span>
                </li>
              ) : null;
            })}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await recordMany({ companyId, items: ready });
                  setRecordResult(`${result.recorded} recorded${result.skipped.length ? `; ${result.skipped.length} left for you: ${result.skipped.join("; ")}` : ""}`);
                  setDialog(null);
                })
              }
            >
              Record {usd(ready.reduce((s, item) => s + (data.rows.find((r) => r.id === item.expenseId)?.amountCents ?? 0), 0))}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ExpenseRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const reading = row.reading === "pending";
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1fr)_auto_6.5rem] sm:items-center sm:gap-4 sm:px-5">
        <span className={cn("row-span-2 grid size-9 place-items-center rounded-xl sm:row-span-1", row.source === "receipt" ? "bg-brand-500/10 text-info-foreground" : "bg-muted text-muted-foreground")} aria-hidden>
          {reading ? <Loader2 className="size-4 motion-safe:animate-spin" /> : row.source === "receipt" ? <ReceiptIcon className="size-4" /> : row.source === "statement" ? <FileText className="size-4" /> : <Plus className="size-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-strong">{reading ? "Reading the receipt…" : (row.vendor ?? "No vendor yet")}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.spentOn ? calendarDate(row.spentOn, false) : "No date yet"} · {row.sourceWords}
            {row.paidWithWords ? ` · ${row.paidWithWords}` : ""}
          </span>
        </span>
        <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-1.5 sm:col-start-auto">
          {row.category ? (
            <span className="truncate text-xs text-strong">
              {row.category.name}
              {row.category.by === "rule" ? <span className="text-muted-foreground"> · by your rule</span> : null}
            </span>
          ) : row.suggestion ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-brand-500/45 px-1.5 py-0.5 text-[11px] text-info-foreground">
              <Sparkles className="size-3" aria-hidden />
              Suggested: {row.suggestion.name}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No category</span>
          )}
          {row.flags.length ? <AlertTriangle className="size-4 text-warning-foreground" aria-label={row.flags.join(" ")} /> : null}
        </span>
        <span className="col-start-3 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
          <Chip tone={row.owedBack ? "info" : STATUS_TONE[row.status]}>{row.owedBack ? "Owed back" : row.byRule && row.status === "recorded" ? "Filed by rule" : row.statusWords}</Chip>
        </span>
        <span className="col-start-3 row-start-2 text-right text-sm font-semibold tabular-nums text-strong sm:col-start-auto sm:row-start-auto">{row.amountCents === null ? <span className="font-normal text-muted-foreground">—</span> : usd(row.amountCents)}</span>
      </button>
    </li>
  );
}

/** Where the period's money went, by category: one hue, the amount written beside each bar. */
function CategoryBreakdown({ data }: { data: Overview }) {
  const max = Math.max(1, ...data.byCategory.map((c) => c.cents));
  return (
    <section className="rounded-2xl border border-border bg-card" aria-labelledby="where-title">
      <header className="border-b border-border px-4 py-3">
        <h2 id="where-title" className="font-heading text-base tracking-tight text-strong">
          Where it went
        </h2>
        <p className="text-xs text-muted-foreground">Recorded expenses, {data.period.label}, US dollars</p>
      </header>
      {data.byCategory.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">Nothing recorded in this period yet.</p>
      ) : (
        <ul className="grid gap-3 px-4 py-4">
          {data.byCategory.map((c) => (
            <li key={c.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-strong">
                  {c.name} <span className="text-xs text-muted-foreground">· {c.kind === "job" ? "job cost" : "overhead"}</span>
                </span>
                <span className="shrink-0 tabular-nums text-strong">{usd(c.cents)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className={cn("h-full rounded-full", c.id === "none" ? "bg-muted-foreground/40" : "bg-brand-500")} style={{ width: `${Math.max(2, (c.cents / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RepaidBar({ rows }: { rows: Row[] }) {
  const { companyId, timezone } = useCompany();
  const mark = useMutation(api.expenses.markRepaid);
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(todayKey(timezone));
  const owed = rows.filter((r) => r.owedBack);
  const total = owed.reduce((s, r) => s + (r.amountCents ?? 0), 0);
  if (!owed.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3">
      <p className="text-sm text-strong">
        {usd(total)} owed back to you for {owed.length} expense{owed.length === 1 ? "" : "s"}.
      </p>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Mark paid back
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Mark ${usd(total)} paid back`} description="For when the business has paid you back for what you paid personally. Selestial doesn't move this money.">
        <div className="grid gap-4">
          <Field label="Day you were paid back">
            <TextInput type="date" value={on} max={todayKey(timezone)} onChange={(e) => setOn(e.target.value)} />
          </Field>
          <FormError message={error} />
          <div className="flex justify-end">
            <Button variant="default" disabled={busy} onClick={() => run(async () => (await mark({ companyId, expenseIds: owed.map((r) => r.id), on }), setOpen(false)))}>
              Mark {owed.length} paid back
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function downloadCsv(data: Overview) {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [["Date", "Vendor", "Category", "Amount", "Paid with", "Source"].join(",")];
  for (const r of data.rows) lines.push([r.spentOn ?? "", quote(r.vendor ?? ""), quote(r.category?.name ?? ""), ((r.amountCents ?? 0) / 100).toFixed(2), quote(r.paidWithWords ?? ""), r.sourceWords].join(","));
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-${data.period.from}-to-${data.period.to}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── The form an expense is checked and recorded with ─────────────────────────────────────────────

type FormState = { vendor: string; spentOn: string; amount: string; tax: string; categoryId: string; linkKind: "" | "job" | "property" | "service" | "overhead"; linkId: string; paidWith: "" | PaidWith; paidWithNote: string; description: string };

function initialForm(e?: Detail): FormState {
  const link = e?.link;
  return {
    vendor: e?.vendor ?? "",
    spentOn: e?.spentOn ?? "",
    amount: e?.amountCents == null ? "" : moneyInput(e.amountCents),
    tax: e?.taxCents == null ? "" : moneyInput(e.taxCents),
    categoryId: e?.category?.id ?? "",
    linkKind: link?.kind ?? "",
    linkId: link?.kind === "job" ? link.jobId : link?.kind === "property" ? link.propertyId : link?.kind === "service" ? link.serviceKey : "",
    paidWith: e?.paidWith ?? "",
    paidWithNote: e?.paidWithNote ?? "",
    description: e?.description ?? "",
  };
}

function toFields(f: FormState) {
  const amountCents = f.amount.trim() ? parseMoney(f.amount) : null;
  const taxCents = f.tax.trim() ? parseMoney(f.tax) : null;
  const link =
    f.linkKind === "overhead"
      ? { kind: "overhead" as const }
      : f.linkKind === "job" && f.linkId
        ? { kind: "job" as const, jobId: f.linkId as Id<"jobs"> }
        : f.linkKind === "property" && f.linkId
          ? { kind: "property" as const, propertyId: f.linkId as Id<"properties"> }
          : f.linkKind === "service" && f.linkId
            ? { kind: "service" as const, serviceKey: f.linkId }
            : null;
  return {
    problem: (f.amount.trim() && amountCents === null) || (f.tax.trim() && taxCents === null) ? "Enter amounts like 48.37." : null,
    fields: { vendor: f.vendor || null, spentOn: f.spentOn || null, amountCents, taxCents, description: f.description || null, categoryId: f.categoryId || null, link, paidWith: f.paidWith || null, paidWithNote: f.paidWithNote || null },
  };
}

function ExpenseFields({ form, set, categories, unclear, around }: { form: FormState; set: (patch: Partial<FormState>) => void; categories: { id: string; name: string; kind: string; hidden?: boolean }[]; unclear: string[]; around: string | null }) {
  const { companyId } = useCompany();
  const options = useQuery(api.expenses.linkOptions, form.linkKind && form.linkKind !== "overhead" ? { companyId, around } : "skip");
  const category = categories.find((c) => c.id === form.categoryId);
  const mark = (field: string) => (unclear.includes(field) ? "ring-2 ring-warning/50" : undefined);
  const hint = (field: string) => (unclear.includes(field) ? "Check this: the receipt wasn't clear" : undefined);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid to" hint={hint("vendor")}>
          <TextInput value={form.vendor} maxLength={120} onChange={(e) => set({ vendor: e.target.value })} placeholder="The Home Depot" className={mark("vendor")} />
        </Field>
        <Field label="Date paid" hint={hint("date")}>
          <TextInput type="date" value={form.spentOn} onChange={(e) => set({ spentOn: e.target.value })} className={mark("date")} />
        </Field>
        <Field label="Amount paid, tax included" hint={hint("amount")}>
          <TextInput inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="48.37" className={mark("amount")} />
        </Field>
        <Field label="Sales tax" hint={hint("tax") ?? "Optional"}>
          <TextInput inputMode="decimal" value={form.tax} onChange={(e) => set({ tax: e.target.value })} placeholder="3.99" className={mark("tax")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category">
          <SelectInput value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value, ...(categories.find((c) => c.id === e.target.value)?.kind === "overhead" && form.linkKind === "job" ? { linkKind: "overhead" as const, linkId: "" } : {}) })}>
            <option value="">Choose…</option>
            {categories
              .filter((c) => !c.hidden || c.id === form.categoryId)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind === "job" ? "job cost" : "overhead"})
                </option>
              ))}
          </SelectInput>
        </Field>
        <Field label="Paid with">
          <SelectInput value={form.paidWith} onChange={(e) => set({ paidWith: e.target.value as FormState["paidWith"] })}>
            <option value="">Not set</option>
            {PAID_WITH.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {(form.paidWith && form.paidWith !== "cash") || form.paidWithNote ? (
        <Field label="Which card or account" hint={form.paidWith ? "Optional, e.g. Visa ending 4242" : "Read from the receipt. Choose what paid for it above."}>
          <TextInput value={form.paidWithNote} maxLength={60} onChange={(e) => set({ paidWithNote: e.target.value })} />
        </Field>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field label="For">
          <SelectInput value={form.linkKind} onChange={(e) => set({ linkKind: e.target.value as FormState["linkKind"], linkId: "" })}>
            <option value="">Not linked</option>
            <option value="job" disabled={category?.kind === "overhead"}>
              A visit
            </option>
            <option value="property">A property</option>
            <option value="service">A service</option>
            <option value="overhead">General overhead</option>
          </SelectInput>
        </Field>
        {form.linkKind && form.linkKind !== "overhead" ? (
          <Field label={form.linkKind === "job" ? "Visit" : form.linkKind === "property" ? "Property" : "Service"} hint={form.linkKind === "job" ? "Visits within a week of the date paid" : undefined}>
            <SelectInput value={form.linkId} onChange={(e) => set({ linkId: e.target.value })}>
              <option value="">{options ? "Choose…" : "Loading…"}</option>
              {(form.linkKind === "job" ? (options?.jobs ?? []) : form.linkKind === "property" ? (options?.properties ?? []) : (options?.services ?? []).map((s) => ({ id: s.id, label: s.name }))).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : null}
      </div>
      <Field label="Note" hint="Optional: what it was for">
        <TextArea rows={2} maxLength={300} value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>
    </div>
  );
}

function AddExpenseDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (id: Id<"expenses">) => void }) {
  const { companyId, timezone } = useCompany();
  const settings = useQuery(api.finance.settings, open ? { companyId } : "skip");
  const add = useMutation(api.expenses.addExpense);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState<FormState>(() => ({ ...initialForm(), spentOn: todayKey(timezone) }));
  const [key] = useState(clientKey);
  const { problem, fields } = toFields(form);
  return (
    <Modal open={open} onClose={onClose} title="Add an expense" description="For a cost without a receipt to upload, or one you'd rather type. You can attach nothing and still record it.">
      {!settings ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (problem) return setError(problem);
            void run(async () => {
              const result = await add({ companyId, ...fields, record: true, clientKey: key });
              onAdded(result.expenseId);
            });
          }}
        >
          <ExpenseFields form={form} set={(patch) => setForm((f) => ({ ...f, ...patch }))} categories={settings.settings.expenseCategories} unclear={[]} around={form.spentOn || null} />
          <FormError message={error ?? problem} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={busy || Boolean(problem)}>
              {fields.amountCents && fields.categoryId && fields.vendor && fields.spentOn ? `Record ${usd(fields.amountCents)}` : "Save to review"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── One expense ──────────────────────────────────────────────────────────────────────────────────

export function ExpenseSheet({ expenseId, onClose }: { expenseId: Id<"expenses"> | null; onClose: () => void }) {
  return (
    <Sheet open={expenseId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-2xl bg-card">
        <SheetTitle className="sr-only">Expense</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{expenseId ? <ExpenseBody key={expenseId} expenseId={expenseId} onClose={onClose} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

function ExpenseBody({ expenseId, onClose }: { expenseId: Id<"expenses">; onClose: () => void }) {
  const { companyId } = useCompany();
  const e = useQuery(api.expenses.expense, { companyId, expenseId });
  if (!e) return <div className="grid gap-3 p-6"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-64 w-full" /></div>;
  // The form starts from the record as it is now; a newer revision (a receipt read, a rule) restarts it.
  return <ExpenseEditor key={e.revision} e={e} onClose={onClose} />;
}

const TIMELINE_WORDS: Record<string, string> = {
  "expense.added": "Added",
  "expense.read": "Read from the receipt",
  "expense.read_failed": "Couldn't be read",
  "expense.recorded": "Recorded",
  "expense.filed_by_rule": "Filed by your rule",
  "expense.edited": "Changed",
  "expense.voided": "Voided",
  "expense.repaid": "Paid back to you",
  "expense.not_a_repeat": "Marked as not a repeat",
};

function ExpenseEditor({ e, onClose }: { e: Detail; onClose: () => void }) {
  const { companyId, timezone } = useCompany();
  const save = useMutation(api.expenses.saveExpense);
  const voidIt = useMutation(api.expenses.voidExpense);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState<FormState>(() => initialForm(e));
  const [notARepeat, setNotARepeat] = useState(false);
  const [makeRule, setMakeRule] = useState(false);
  const [autoFile, setAutoFile] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => (setForm((f) => ({ ...f, ...patch })), setSaved(null));
  const { problem, fields } = toFields(form);
  const editable = e.status !== "void";
  const waiting = e.status === "to_review";
  const category = e.categories.find((c) => c.id === form.categoryId);
  const complete = Boolean(fields.amountCents && fields.spentOn && fields.vendor && fields.categoryId);
  const submit = (record: boolean) =>
    run(async () => {
      if (problem) return setError(problem);
      const result = await save({ companyId, expenseId: e.id, revision: e.revision, ...fields, record, notARepeat: notARepeat || undefined, rule: makeRule && !e.rule ? { autoFile } : undefined });
      if (!result.ok) return setError(result.words);
      if (record) onClose();
      else setSaved("Saved");
    });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-6 pb-10 sm:px-7">
      <header className="grid gap-1.5 pr-10">
        <div className="flex flex-wrap items-center gap-2">
          <span className={eyebrow}>
            Expense · {e.sourceWords}
          </span>
          <Chip tone={e.owedBack ? "info" : STATUS_TONE[e.status]}>{e.owedBack ? "Owed back to you" : e.statusWords}</Chip>
        </div>
        <h2 className="font-heading text-2xl tracking-tight text-strong">{e.vendor ?? (e.reading === "pending" ? "Reading the receipt…" : "New expense")}</h2>
        <p className="text-sm text-muted-foreground">
          {e.amountCents === null ? "No amount yet" : usd(e.amountCents)}
          {e.spentOn ? ` · ${calendarDate(e.spentOn)}` : ""}
          {e.recordedWords ? ` · ${e.recordedWords}` : ""}
        </p>
      </header>

      {e.voided ? (
        <Notice tone="info" title={`Voided by ${e.voided.by}`}>
          {e.voided.reason}
        </Notice>
      ) : null}
      {e.reading === "pending" ? (
        <Notice tone="info" title="Selestial is reading this receipt">The details appear here as soon as it&apos;s done. You can fill them in yourself meanwhile.</Notice>
      ) : e.receipt?.note ? (
        <Notice tone="warning" title="The receipt couldn't be read">
          {e.receipt.note}
        </Notice>
      ) : null}
      {e.flags.filter((f) => !(e.repeat && f.startsWith("Possible repeat"))).length && editable ? (
        <Notice tone="warning" title="Check before recording">
          <ul className="grid gap-1">
            {e.flags.filter((f) => !(e.repeat && f.startsWith("Possible repeat"))).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {e.repeat && editable ? (
        <section aria-label="Possible repeat" className="grid gap-2 rounded-xl border border-warning/40 bg-warning/6 p-3.5 text-sm">
          <p className="font-medium text-strong">Same amount within a few days of this one:</p>
          <p className="text-strong">
            {e.repeat.vendor ?? "No vendor"} · {calendarDate(e.repeat.spentOn)} · {e.repeat.amountCents === null ? "—" : usd(e.repeat.amountCents)} <span className="text-muted-foreground">({e.repeat.statusWords}, {e.repeat.sourceWords.toLowerCase()})</span>
          </p>
          <label className="flex items-center gap-2 text-strong">
            <input type="checkbox" checked={notARepeat} onChange={(ev) => setNotARepeat(ev.target.checked)} className="size-4 accent-brand-500" />
            They&apos;re two different purchases
          </label>
          {!notARepeat ? <p className="text-xs text-muted-foreground">If it is the same purchase, void this one.</p> : null}
        </section>
      ) : null}

      <div className={cn("grid gap-5", e.receipt && "lg:grid-cols-[14rem_minmax(0,1fr)]")}>
        {e.receipt ? <ReceiptPreview receipt={e.receipt} /> : null}
        <div className="grid min-w-0 gap-4">
          {e.suggestion && !form.categoryId ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-brand-500/45 bg-brand-500/5 px-3 py-2.5 text-sm">
              <Sparkles className="size-4 text-info-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-strong">Suggested: {e.suggestion.name}.</span> <span className="text-muted-foreground">{e.suggestion.why}</span>
              </span>
              <Button size="xs" variant="outline" onClick={() => set({ categoryId: e.suggestion!.id })}>
                Use it
              </Button>
            </div>
          ) : null}
          {e.jobSuggestion && !form.linkKind ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-brand-500/45 bg-brand-500/5 px-3 py-2.5 text-sm">
              <Sparkles className="size-4 text-info-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium text-strong">For {e.jobSuggestion.label}?</span> <span className="text-muted-foreground">{e.jobSuggestion.why}</span>
              </span>
              <Button size="xs" variant="outline" disabled={category?.kind === "overhead"} onClick={() => set({ linkKind: "job", linkId: e.jobSuggestion!.jobId })}>
                Link it
              </Button>
            </div>
          ) : null}
          {editable ? (
            <ExpenseFields form={form} set={set} categories={e.categories} unclear={waiting ? e.unclear : []} around={form.spentOn || null} />
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Category</dt>
                <dd className="text-strong">{e.category?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">For</dt>
                <dd className="text-strong">{e.linkLabel ?? "Not linked"}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      {e.statementLine ? (
        <p className="rounded-xl border border-border px-3.5 py-2.5 text-xs text-muted-foreground">
          On your statement: <span className="text-strong">{e.statementLine.description}</span> · {calendarDate(e.statementLine.on)} · {usd(e.statementLine.amountCents)}
        </p>
      ) : null}
      {e.rule ? (
        <p className="text-xs text-muted-foreground">
          Your rule: vendors containing &ldquo;{e.rule.vendorContains}&rdquo; are {e.rule.categoryName}
          {e.rule.autoFile ? ", recorded without asking when the receipt is clear" : ""}.
        </p>
      ) : editable && form.vendor && form.categoryId ? (
        <div className="grid gap-1.5 rounded-xl border border-border px-3.5 py-3 text-sm">
          <label className="flex items-start gap-2 text-strong">
            <input type="checkbox" checked={makeRule} onChange={(ev) => setMakeRule(ev.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
            <span>
              Always file {form.vendor} as {category?.name ?? "this category"}
            </span>
          </label>
          {makeRule ? (
            <label className="ml-6 flex items-start gap-2 text-strong">
              <input type="checkbox" checked={autoFile} onChange={(ev) => setAutoFile(ev.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
              <span>
                And record it without asking
                <span className="block text-xs text-muted-foreground">Only when the vendor, date and amount are read clearly and it isn&apos;t a possible repeat. Otherwise it waits for you.</span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}

      <FormError message={error} />
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          {waiting ? (
            <>
              <Button variant="default" disabled={busy || !complete || Boolean(e.repeat && !notARepeat)} onClick={() => submit(true)}>
                <CheckCircle2 aria-hidden />
                Record {fields.amountCents ? usd(fields.amountCents) : "expense"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => submit(false)}>
                Save for later
              </Button>
            </>
          ) : (
            <Button variant="default" disabled={busy || !complete} onClick={() => submit(false)}>
              Save changes
            </Button>
          )}
          {saved ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-success-foreground">
              <CheckCircle2 className="size-4" aria-hidden /> {saved}
            </span>
          ) : null}
          {!e.repaid ? (
            <Button variant="ghost" className="ml-auto" onClick={() => setVoiding(true)}>
              <Trash2 aria-hidden />
              Void
            </Button>
          ) : null}
        </div>
      ) : null}
      {waiting && !complete ? <p className="text-xs text-muted-foreground">To record it, add {e.missing.filter((m) => !(m === "a category" && form.categoryId)).join(", ") || "the details above"}.</p> : null}
      {e.repaid ? <p className="text-xs text-muted-foreground">Paid back to you {calendarDate(e.repaid.on)}.</p> : null}

      {e.timeline.length ? (
        <section aria-label="History">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-strong">
            <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
            History
          </h3>
          <ol className="grid gap-1.5 text-sm">
            {e.timeline.map((row) => (
              <li key={row.id} className="flex justify-between gap-3">
                <span className="text-strong">{TIMELINE_WORDS[row.type] ?? "Updated"}</span>
                <span className="text-xs text-muted-foreground">
                  {row.amountCents !== null ? `${usd(row.amountCents)} · ` : ""}
                  {moment(row.at, timezone, true)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Modal open={voiding} onClose={() => setVoiding(false)} title="Void this expense" description="It stays in the history, marked void, with your reason. It no longer counts as spent.">
        <form className="grid gap-4" onSubmit={(ev) => (ev.preventDefault(), void run(async () => (await voidIt({ companyId, expenseId: e.id, reason }), setVoiding(false), onClose())))}>
          <Field label="Why">
            <TextInput autoFocus value={reason} maxLength={300} onChange={(ev) => setReason(ev.target.value)} placeholder="Same purchase as the statement line" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVoiding(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="destructive" disabled={busy || !reason.trim()}>
              Void it
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ReceiptPreview({ receipt }: { receipt: NonNullable<Detail["receipt"]> }) {
  const image = receipt.contentType.startsWith("image/");
  return (
    <figure className="grid content-start gap-2">
      {receipt.url && image ? (
        <a href={receipt.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-border bg-muted/40">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed storage URL; nothing to optimize */}
          <img src={receipt.url} alt={`Receipt: ${receipt.name}`} className="max-h-44 w-full object-contain sm:max-h-80" />
        </a>
      ) : (
        <a href={receipt.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-6 text-sm text-strong">
          <FileText className="size-5 text-muted-foreground" aria-hidden />
          Open the PDF
          <ExternalLink className="ml-auto size-4 text-muted-foreground" aria-hidden />
        </a>
      )}
      <figcaption className="truncate text-xs text-muted-foreground">{receipt.name}</figcaption>
      {receipt.read ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 rounded-lg bg-muted/40 px-2.5 py-2 text-xs">
          <dt className="text-muted-foreground">Read</dt>
          <dd className="text-right text-strong">
            {receipt.read.totalCents.value === null ? "—" : usd(receipt.read.totalCents.value)}
            {!receipt.read.totalCents.clear ? <span className="text-warning-foreground"> (unclear)</span> : null}
          </dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd className="text-right text-strong">
            {receipt.read.date.value ? calendarDate(receipt.read.date.value) : "—"}
            {!receipt.read.date.clear ? <span className="text-warning-foreground"> (unclear)</span> : null}
          </dd>
        </dl>
      ) : null}
    </figure>
  );
}

// ── Statement import ─────────────────────────────────────────────────────────────────────────────

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { companyId } = useCompany();
  const importStatement = useMutation(api.expenses.importStatement);
  const { busy, error, run } = useRun();
  const [file, setFile] = useState<{ name: string; table: string[][] } | null>(null);
  const [columns, setColumns] = useState<StatementColumns | null>(null);
  const [sign, setSign] = useState<SpendSign>("negative");
  const [paidWith, setPaidWith] = useState<PaidWith>("business_card");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ added: number; matched: number; skipped: number; filed: number } | null>(null);
  const [key] = useState(clientKey);
  const parsed = useMemo(() => (file && columns ? statementRows(file.table, columns, sign) : []), [file, columns, sign]);
  const rows = parsed.flatMap((p) => (p.row ? [p.row] : []));
  const preview = useQuery(api.expenses.statementPreview, rows.length && rows.length <= 500 ? { companyId, rows } : "skip");
  const header = file?.table[0] ?? [];
  return (
    <Modal open onClose={onClose} title="Import a bank or card statement" description="Export a CSV from your bank or card website. Each row is checked against what's already here before anything is added.">
      {done ? (
        <div className="grid gap-4">
          <Notice tone="success" title={`${done.added} added, ${done.matched} matched`}>
            {done.filed ? `${done.filed} filed by your rules. ` : ""}
            {done.added - done.filed > 0 ? `${done.added - done.filed} wait in To review. ` : ""}
            {done.skipped ? `${done.skipped} skipped (money in, already imported, or unreadable).` : ""}
          </Notice>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : !file ? (
        <label className="grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground hover:border-brand-500/50">
          <FileText className="size-6" aria-hidden />
          <span className="font-medium text-strong">Choose a CSV file</span>
          Up to 500 rows. Most banks call it &ldquo;Download transactions&rdquo;.
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const table = parseCsv(await f.text());
              const guessed = guessStatementColumns(table[0] ?? []);
              setFile({ name: f.name, table });
              setColumns(guessed);
              setSign(guessSign(table, guessed));
            }}
          />
        </label>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-strong">
            {file.name} · {file.table.length - 1} rows
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["date", "description"] as const).map((k) => (
              <Field key={k} label={k === "date" ? "Date column" : "Description column"}>
                <SelectInput value={columns?.[k] ?? ""} onChange={(e) => setColumns((c) => ({ ...c!, [k]: e.target.value === "" ? null : Number(e.target.value) }))}>
                  <option value="">Choose…</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ))}
            <Field label="Money out is shown as">
              <SelectInput value={sign} onChange={(e) => setSign(e.target.value as SpendSign)}>
                <option value="negative">Minus (−48.37)</option>
                <option value="positive">Plus (48.37)</option>
                <option value="debit_column">Debit column</option>
              </SelectInput>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {sign === "debit_column" ? (
              (["debit", "credit"] as const).map((k) => (
                <Field key={k} label={k === "debit" ? "Debit (money out) column" : "Credit (money in) column"}>
                  <SelectInput value={columns?.[k] ?? ""} onChange={(e) => setColumns((c) => ({ ...c!, [k]: e.target.value === "" ? null : Number(e.target.value) }))}>
                    <option value="">None</option>
                    {header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              ))
            ) : (
              <Field label="Amount column">
                <SelectInput value={columns?.amount ?? ""} onChange={(e) => setColumns((c) => ({ ...c!, amount: e.target.value === "" ? null : Number(e.target.value) }))}>
                  <option value="">Choose…</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="This statement is for">
              <SelectInput value={paidWith} onChange={(e) => setPaidWith(e.target.value as PaidWith)}>
                {PAID_WITH.filter((p) => p.id !== "cash").map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Card or account name" hint="Optional">
              <TextInput value={note} maxLength={60} onChange={(e) => setNote(e.target.value)} placeholder="Chase Ink ending 1234" />
            </Field>
          </div>
          {rows.length > 500 ? <Notice tone="warning" title="Too many rows">Import up to 500 rows at a time. Export one month at a time.</Notice> : null}
          {preview ? (
            <div className="grid gap-2">
              <p className="text-sm text-strong">
                {preview.counts.new} new ({usd(preview.newCents)}) · {preview.counts.matches} match expenses already here · {preview.counts.money_in} money in · {preview.counts.imported} already imported
                {parsed.some((p) => p.problem) ? ` · ${parsed.filter((p) => p.problem).length} unreadable` : ""}
              </p>
              <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border text-sm">
                {preview.rows.slice(0, 200).map((r) => (
                  <li key={r.key} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{calendarDate(r.on, false)}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-strong">{r.description}</span>
                      <span className={cn("block truncate text-xs", r.status === "new" ? "text-muted-foreground" : r.status === "matches" ? "text-info-foreground" : "text-muted-foreground/80")}>{r.words}</span>
                    </span>
                    <span className={cn("tabular-nums", r.status === "new" ? "text-strong" : "text-muted-foreground line-through")}>{usd(r.amountCents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : rows.length ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <p className="text-sm text-muted-foreground">Choose the columns to see what would be added.</p>
          )}
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => (setFile(null), setColumns(null))}>
              Choose another file
            </Button>
            <Button variant="default" disabled={busy || !preview || preview.counts.new + preview.counts.matches === 0} onClick={() => run(async () => setDone(await importStatement({ companyId, name: file.name, paidWith, paidWithNote: note || null, rows, clientKey: key })))}>
              Import {preview ? preview.counts.new + preview.counts.matches : ""} row{preview && preview.counts.new + preview.counts.matches === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────

function RulesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-lg bg-card">
        <SheetTitle className="sr-only">Expense rules</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{open ? <RulesBody /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

function RulesBody() {
  const { companyId } = useCompany();
  const rules = useQuery(api.expenses.rules, { companyId });
  const settings = useQuery(api.finance.settings, { companyId });
  const saveRule = useMutation(api.expenses.saveRule);
  const apply = useMutation(api.expenses.applyRules);
  const { busy, error, run } = useRun();
  const [vendor, setVendor] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [autoFile, setAutoFile] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);
  if (!rules || !settings) return <div className="p-6"><Skeleton className="h-48 rounded-xl" /></div>;
  const categories = settings.settings.expenseCategories.filter((c) => !c.hidden);
  const waiting = rules.reduce((s, r) => s + (r.active ? r.waitingMatches : 0), 0);
  return (
    <div className="grid gap-5 px-5 pt-6 pb-10 sm:px-7">
      <header className="pr-10">
        <h2 className="font-heading text-2xl tracking-tight text-strong">Filing rules</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your own rules: a vendor always goes to a category. A rule can also record a matching expense without asking, but only when the receipt is clear and it isn&apos;t a possible repeat.</p>
      </header>
      {rules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No rules yet. Make one here, or tick &ldquo;Always file&rdquo; when you record an expense.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rules.map((r) => (
            <li key={r.id} className="grid gap-1.5 px-3.5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-strong">
                  &ldquo;{r.vendorContains}&rdquo; → <span className="font-medium">{r.categoryName}</span>
                </span>
                <Chip tone={r.active ? (r.autoFile ? "progress" : "info") : "muted"}>{!r.active ? "Off" : r.autoFile ? "Files on its own" : "Sets category"}</Chip>
              </div>
              <p className="text-xs text-muted-foreground">
                Used {r.matches} time{r.matches === 1 ? "" : "s"}
                {r.waitingMatches ? ` · matches ${r.waitingMatches} waiting` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => run(() => saveRule({ companyId, ruleId: r.id, vendorContains: r.vendorContains, categoryId: r.categoryId, paidWith: r.paidWith, autoFile: !r.autoFile, active: r.active }))}>
                  {r.autoFile ? "Ask me first" : "Let it file on its own"}
                </Button>
                <Button size="xs" variant="ghost" disabled={busy} onClick={() => run(() => saveRule({ companyId, ruleId: r.id, vendorContains: r.vendorContains, categoryId: r.categoryId, paidWith: r.paidWith, autoFile: r.autoFile, active: !r.active }))}>
                  {r.active ? "Turn off" : "Turn on"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {waiting ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-sm">
          <span className="text-strong">Your rules match {waiting} expense{waiting === 1 ? "" : "s"} waiting for review.</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(async () => { const r = await apply({ companyId }); setApplied(`${r.filed} recorded by your rules, ${r.categorized} given their category to review.`); })}>
            Apply rules now
          </Button>
        </div>
      ) : null}
      {applied ? <Notice tone="success" title={applied} /> : null}
      <form className="grid gap-3 rounded-xl border border-border p-3.5" onSubmit={(e) => (e.preventDefault(), void run(async () => (await saveRule({ companyId, ruleId: null, vendorContains: vendor, categoryId, paidWith: null, autoFile, active: true }), setVendor(""), setCategoryId(""), setAutoFile(false))))}>
        <p className="text-sm font-medium text-strong">New rule</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vendor contains">
            <TextInput value={vendor} maxLength={60} onChange={(e) => setVendor(e.target.value)} placeholder="Home Depot" />
          </Field>
          <Field label="File as">
            <SelectInput value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-strong">
          <input type="checkbox" checked={autoFile} onChange={(e) => setAutoFile(e.target.checked)} className="mt-0.5 size-4 accent-brand-500" />
          <span>
            Record matching expenses without asking
            <span className="block text-xs text-muted-foreground">Only when the receipt is clear and it isn&apos;t a possible repeat.</span>
          </span>
        </label>
        <FormError message={error} />
        <div className="flex justify-end">
          <Button type="submit" variant="default" disabled={busy || vendor.trim().length < 2 || !categoryId}>
            Save rule
          </Button>
        </div>
      </form>
    </div>
  );
}
