"use client";

/**
 * Step 4: review and fix before anything is written. Counts first (ready, proposed updates, possible
 * duplicates, skipped, needing correction), then each record with its source row beside what Selestial will
 * make of it. Corrections are typed inline and kept as the owner's; choices can be made one at a time or for
 * several rows with the same problem. Nothing is merged on a shared name, email or address alone.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { SelectInput, TextInput } from "@/components/app/form";
import { Building2, ChevronDown, ChevronRight, RotateCcw, Search, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CATEGORIES, CATEGORY_LABELS, FIELDS, FILE_KINDS, IMPORTABLE, KIND_LABELS, SCHEDULE_WORDS, type Category, type FileKind, type Importable } from "../../../../convex/lib/migration/rules";
import { plural, useMigration } from "./context";
import { Empty, Note, StateBadge, StepHeading, Tile } from "./parts";

type Row = FunctionReturnType<typeof api.migration.rows>["rows"][number];
type Filter = "attention" | "questions" | "all" | "ready" | "update" | "duplicate" | "review" | "error" | "skip" | "held" | "failed";
const PAGE = 25;

export function ReviewStep() {
  const { view, companyId, act, locked } = useMigration();
  const decideGroup = useMutation(api.migration.decideGroup);
  const recheck = useMutation(api.migration.recheck);
  const present = FILE_KINDS.filter((k) => (view.migration.summary[k]?.total ?? 0) > 0);
  const [picked, setKind] = useState<FileKind>(present[0] ?? "customers");
  const kind = present.includes(picked) ? picked : (present[0] ?? "customers");
  const totals = (key: string) => present.filter((k) => (IMPORTABLE as readonly string[]).includes(k)).reduce((n, k) => n + (view.migration.summary[k]?.[key] ?? 0), 0);
  const [filter, setFilter] = useState<Filter>("attention");
  const pending = view.migration.groups.filter((g) => g.accepted === null);

  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <StepHeading eyebrow="Step 4 of 6" title="Review & fix" lead="Here's what will happen to every record before anything goes live. Fix what's flagged, or skip it; nothing is merged or overwritten without your choice." />

      {totals("questions") ? (
        <button type="button" onClick={() => setFilter("questions")} className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
          <Sparkles className="size-4 text-warning" aria-hidden />
          <span className="text-sm text-strong">
            {view.inSupport ? (
              <>
                <span className="font-semibold">{totals("questions")} open {totals("questions") === 1 ? "question" : "questions"}</span> waiting for the company. They answer by choosing what happens to each record.
              </>
            ) : (
              <>
                <span className="font-semibold">{totals("questions")} {totals("questions") === 1 ? "question" : "questions"} for you</span> from Selestial Support. Answer each by choosing what happens to the record.
              </>
            )}
          </span>
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Ready to create" value={totals("ready")} tone="good" onClick={() => setFilter("ready")} active={filter === "ready"} />
        <Tile label="Imported before" value={totals("update")} hint="Kept as they are" onClick={() => setFilter("update")} active={filter === "update"} />
        <Tile label="Possible duplicates" value={totals("duplicate")} tone={totals("duplicate") ? "warn" : "plain"} onClick={() => setFilter("duplicate")} active={filter === "duplicate"} />
        <Tile label="Needs your review" value={totals("review")} tone={totals("review") ? "warn" : "plain"} onClick={() => setFilter("review")} active={filter === "review"} />
        <Tile label="Needs correction" value={totals("error")} tone={totals("error") ? "bad" : "plain"} onClick={() => setFilter("error")} active={filter === "error"} />
        <Tile label="Being skipped" value={totals("skip")} tone="muted" onClick={() => setFilter("skip")} active={filter === "skip"} />
      </div>

      {pending.map((group) => (
        <div key={group.key} className="grid gap-3 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.07] to-transparent p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-500/15 text-brand-300">
            <Building2 className="size-4" aria-hidden />
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-strong">
              <Sparkles className="size-3.5 text-brand-300" aria-hidden />
              {group.name}: one commercial account?
            </p>
            <p className="text-xs text-muted-foreground">This file includes {group.properties} properties for {group.name}. I&apos;ve grouped them under one commercial account for your review: one customer, with each site as a property.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" disabled={locked} onClick={() => void act(() => decideGroup({ companyId, key: group.key, accepted: true }))}>
              Group them
            </Button>
            <Button variant="outline" size="sm" disabled={locked} onClick={() => void act(() => decideGroup({ companyId, key: group.key, accepted: false }))}>
              Keep separate
            </Button>
          </div>
        </div>
      ))}
      {view.migration.groups.filter((g) => g.accepted !== null).length ? (
        <p className="text-xs text-muted-foreground">
          {view.migration.groups
            .filter((g) => g.accepted !== null)
            .map((g) => `${g.name}: ${g.accepted ? "grouped as one account" : "kept separate"}`)
            .join(" · ")}
          .{" "}
          <button type="button" className="text-brand-300 underline-offset-2 hover:underline" disabled={locked} onClick={() => void act(async () => {
            for (const g of view.migration.groups.filter((x) => x.accepted !== null)) await decideGroup({ companyId, key: g.key, accepted: !g.accepted });
          })}>
            Switch
          </button>
        </p>
      ) : null}

      {view.migration.dirty && !view.migration.checking ? (
        <Note tone="warning">
          Some changes haven&apos;t been checked yet.{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={() => void act(() => recheck({ companyId }))}>
            Check again
          </button>
        </Note>
      ) : null}

      {present.length ? (
        <>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Record type">
            {present.map((k) => {
              const s = view.migration.summary[k] ?? {};
              const attention = (s.awaiting ?? 0) + (s.error ?? 0);
              return (
                <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-brand-500", kind === k ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted")}>
                  {KIND_LABELS[k].label}
                  <span className="text-xs text-muted-foreground tabular-nums">{s.total ?? 0}</span>
                  {attention ? <span className="rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning-foreground tabular-nums">{attention}</span> : null}
                </button>
              );
            })}
          </div>
          <Records key={`${kind}:${filter}`} kind={kind} filter={filter} setFilter={setFilter} />
        </>
      ) : (
        <Empty title="Nothing to review yet" body="Add a file and confirm its columns, and Selestial checks every row here." />
      )}
    </div>
  );
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "questions", label: "Questions" },
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "update", label: "Imported before" },
  { id: "duplicate", label: "Duplicates" },
  { id: "review", label: "Review" },
  { id: "error", label: "Corrections" },
  { id: "skip", label: "Skipped" },
  { id: "failed", label: "Failed" },
];

function Records({ kind, filter, setFilter }: { kind: FileKind; filter: Filter; setFilter: (f: Filter) => void }) {
  const { companyId } = useMigration();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<Id<"migrationRows">>>(new Set());
  const [open, setOpen] = useState<Id<"migrationRows"> | null>(null);
  const page = useQuery(api.migration.rows, { companyId, kind, filter, search: search.trim() || undefined, offset, limit: PAGE });
  const rows = page?.rows ?? [];
  const chosen = rows.filter((r) => selected.has(r.id));
  const toggle = (id: Id<"migrationRows">) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="grid min-w-0 gap-3 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <TextInput aria-label="Search records" placeholder="Search names, emails, addresses…" value={search} onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
              setSelected(new Set());
            }} className="pl-8" />
        </div>
        <div className="-mx-1 flex min-w-0 max-w-full gap-1 overflow-x-auto px-1">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)} className={cn("shrink-0 rounded-full border px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-brand-500", filter === f.id ? "border-brand-500 bg-brand-500/10 font-medium text-strong" : "border-border text-muted-foreground hover:bg-muted")}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {chosen.length ? <BulkBar rows={chosen} kind={kind} clear={() => setSelected(new Set())} /> : null}

      {page === undefined ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-busy="true" />
      ) : !rows.length ? (
        <Empty title={filter === "attention" ? "Nothing needs your attention here" : "No records match"} body={filter === "attention" ? "Every record of this kind is ready, matched or skipped. Look at All to see them." : "Try another filter or search."} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.id}>
              <div className={cn("flex items-start gap-3 px-3 py-2.5", open === row.id ? "bg-muted/40" : "hover:bg-muted/20")}>
                <input type="checkbox" className="mt-1 size-4 shrink-0" aria-label={`Select row ${row.index + 2}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} disabled={Boolean(row.result && row.result.outcome !== "failed")} />
                <button type="button" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id} className="grid min-w-0 flex-1 gap-1 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {open === row.id ? <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
                    <span className="truncate text-sm font-medium text-strong">{title(row)}</span>
                    <StateBadge state={row.state} />
                    {row.decision ? <Badge variant="outline">You chose: {CHOICE_WORDS[row.decision.choice]}</Badge> : null}
                    {row.result ? <Badge variant={row.result.outcome === "failed" ? "error" : "success"}>{OUTCOME_WORDS[row.result.outcome]}</Badge> : null}
                    {row.edited.length ? <Badge variant="info">Corrected</Badge> : null}
                    {row.decision?.bySupport || row.editedBySupport ? <Badge variant="outline">By Selestial Support</Badge> : null}
                    {row.question && !row.decision ? <Badge variant="warning">Question for you</Badge> : null}
                    {row.undone ? <Badge variant="secondary">Undone</Badge> : null}
                    {row.undoBlocked ? <Badge variant="warning">Kept by undo</Badge> : null}
                  </span>
                  <span className="truncate pl-5 text-xs text-muted-foreground">{subtitle(row)}</span>
                  {row.problems[0] || row.notes[0] ? <span className={cn("pl-5 text-xs", row.problems[0] ? "text-destructive-foreground" : "text-muted-foreground")}>{row.problems[0] ?? row.notes[0]}</span> : null}
                </button>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">Row {row.index + 2}</span>
              </div>
              {open === row.id ? <Detail row={row} /> : null}
            </li>
          ))}
        </ul>
      )}

      {page && page.total > PAGE ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {offset + 1}–{Math.min(offset + PAGE, page.total)} of {page.total.toLocaleString()}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

const CHOICE_WORDS: Record<string, string> = { create: "create new", keep_existing: "same as existing", update_fields: "update selected fields", separate: "create separately", skip: "skip", review: "review later" };
const OUTCOME_WORDS: Record<string, string> = { created: "Imported", updated: "Updated", linked: "Matched", skipped: "Skipped", failed: "Failed" };

function title(row: Row): string {
  const v = row.values;
  if (row.kind === "customers") return v.name || [v.firstName, v.lastName].filter(Boolean).join(" ") || v.company || `Row ${row.index + 2}`;
  if (row.kind === "properties") return v.label || v.line1 || `Row ${row.index + 2}`;
  if (row.kind === "cleaners") return v.name || [v.firstName, v.lastName].filter(Boolean).join(" ") || `Row ${row.index + 2}`;
  if (row.kind === "balances") return `${v.externalId ? `Invoice ${v.externalId}` : "Balance"} · ${v.customerName || (v.customerRef ? `customer ${v.customerRef}` : "unknown customer")}`;
  if (row.kind === "recurring" || row.kind === "bookings" || row.kind === "history") return `${v.service ?? "Service"} · ${v.customerName || (v.customerRef ? `customer ${v.customerRef}` : "unknown customer")}`;
  return Object.values(v).slice(0, 2).join(" · ") || row.cells.slice(0, 3).join(" · ");
}

function subtitle(row: Row): string {
  const v = row.values;
  const p = row.parsed;
  if (row.kind === "customers") return [row.category ? CATEGORY_LABELS[row.category.value] : null, v.email, v.phone, [v.line1, v.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  if (row.kind === "properties") return [v.line1, v.line2, v.city, v.region, v.postalCode].filter(Boolean).join(", ");
  if (row.kind === "recurring") return [p.schedule ? SCHEDULE_WORDS[p.schedule as keyof typeof SCHEDULE_WORDS] : v.frequency, p.startsOn ? `next ${p.startsOn}` : v.nextVisit, p.time ?? v.time, v.price].filter(Boolean).join(" · ");
  if (row.kind === "bookings") return [p.day ?? v.date, p.time ?? v.time, v.price, v.status].filter(Boolean).join(" · ");
  if (row.kind === "cleaners") return [p.engagement ? String(p.engagement) : v.engagement, v.email, v.phone, v.availability, v.status].filter(Boolean).join(" · ");
  if (row.kind === "history") return [p.day ?? v.date, v.price, v.cleaner, v.status].filter(Boolean).join(" · ");
  if (row.kind === "balances") return [v.amount, p.due ? `due ${p.due}` : v.due].filter(Boolean).join(" · ");
  return row.cells.filter(Boolean).slice(0, 5).join(" · ");
}

function Detail({ row }: { row: Row }) {
  const { view, companyId, act, locked } = useMigration();
  const edit = useMutation(api.migration.edit);
  const revert = useMutation(api.migration.revertEdit);
  const setCategory = useMutation(api.migration.setCategory);
  const file = view.files.find((f) => f.id === row.fileId);
  const importable = (IMPORTABLE as readonly string[]).includes(row.kind);
  const fields = importable ? FIELDS[row.kind as Importable] : [];
  const written = Boolean(row.result && row.result.outcome !== "failed");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="grid gap-4 border-t border-border bg-muted/20 px-3 py-4 sm:px-5">
      {row.problems.length || row.notes.length ? (
        <ul className="grid gap-1.5">
          {row.problems.map((p) => (
            <li key={p}>
              <Note tone="warning">{p}</Note>
            </li>
          ))}
          {row.notes.map((n) => (
            <li key={n} className="flex gap-2 text-xs text-strong">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-300" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      ) : null}

      {row.question ? (
        <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-strong">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="font-semibold">Selestial Support asks:</span> {row.question.text}
            {!row.decision ? <span className="mt-0.5 block text-muted-foreground">Answer by choosing what happens to this record below.</span> : null}
          </span>
        </div>
      ) : null}
      {row.undoBlocked ? <Note tone="warning">An undo kept this record: {row.undoBlocked}</Note> : null}
      {row.undone ? <Note>You undid this record on {new Date(row.undone.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Take back the skip to import it again.</Note> : null}
      {view.inSupport && !written ? <AskOwner row={row} /> : null}

      {row.kind === "recurring" && typeof row.parsed.preview === "string" && row.parsed.preview ? (
        <div className="grid gap-1.5">
          <p className="text-xs font-semibold text-strong">Next visits once released</p>
          <div className="flex flex-wrap gap-1.5">
            {row.parsed.preview.split(",").map((day) => (
              <span key={day} className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-strong tabular-nums">
                {new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
                {row.parsed.time ? ` · ${row.parsed.time}` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-1.5">
          <p className="text-xs font-semibold text-strong">In your file{file ? ` (${file.name}, row ${row.index + 2})` : ""}</p>
          <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-xl border border-border bg-card p-3 text-xs">
            {(file?.header ?? []).map((h, i) =>
              row.cells[i] ? (
                <div key={i} className="contents">
                  <dt className="truncate text-muted-foreground">{h}</dt>
                  <dd className="break-words text-strong">{row.cells[i]}</dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
        <div className="grid content-start gap-1.5">
          <p className="text-xs font-semibold text-strong">In Selestial</p>
          {importable ? (
            <div className="grid gap-2 rounded-xl border border-border bg-card p-3">
              {row.kind === "customers" ? (
                <label className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 text-xs">
                  <span className="text-muted-foreground">Customer type</span>
                  <span className="grid gap-0.5">
                    <SelectInput value={row.category?.value ?? ""} disabled={locked || written} onChange={(e) => void act(() => setCategory({ companyId, rowIds: [row.id], category: e.target.value as Category }))}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </SelectInput>
                    {row.category ? <span className="text-[11px] text-muted-foreground">{row.category.confirmed ? "You chose it." : `Suggested: ${row.category.because}`}</span> : null}
                  </span>
                </label>
              ) : null}
              {fields.map((f) => {
                const value = drafts[f.key] ?? row.values[f.key] ?? "";
                const edited = row.edited.includes(f.key);
                return (
                  <label key={f.key} className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] items-center gap-3 text-xs">
                    <span className="text-muted-foreground">{f.label}</span>
                    <span className="flex items-center gap-1">
                      <TextInput
                        value={value}
                        disabled={locked || written}
                        className={cn("min-h-8 py-1 text-xs", edited && "border-brand-500/50")}
                        onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                        onBlur={() => {
                          if (drafts[f.key] === undefined || drafts[f.key] === (row.values[f.key] ?? "")) return;
                          void act(() => edit({ companyId, rowIds: [row.id], field: f.key, value: drafts[f.key] })).then(() => setDrafts((d) => {
                            const next = { ...d };
                            delete next[f.key];
                            return next;
                          }));
                        }}
                      />
                      {edited ? (
                        <Button variant="ghost" size="icon-xs" aria-label={`Put back the original ${f.label}`} disabled={locked || written} onClick={() => void act(() => revert({ companyId, rowId: row.id, field: f.key }))}>
                          <RotateCcw aria-hidden />
                        </Button>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <Note>Selestial doesn&apos;t import {KIND_LABELS[row.kind].label.toLowerCase()} yet. This row is kept with your migration and listed as not transferred.</Note>
          )}
        </div>
      </div>

      {row.matches.length ? (
        <div className="grid gap-1.5">
          <p className="text-xs font-semibold text-strong">{row.state === "review" ? "Which one is it?" : "Could be the same as"}</p>
          <ul className="grid gap-1.5">
            {row.matches.map((m) => (
              <li key={`${m.table}:${m.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                <span>
                  <span className="font-medium text-strong">{m.name}</span> <span className="text-muted-foreground">· {m.why}</span>
                </span>
                {m.table === "customers" || m.table === "properties" || m.table === "cleaners" ? <MatchActions row={row} targetId={m.id} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {importable && !written ? <Choices row={row} /> : null}
      {row.result?.reason ? <p className="text-xs text-muted-foreground">Result: {row.result.reason}</p> : null}
    </div>
  );
}

function MatchActions({ row, targetId }: { row: Row; targetId: string }) {
  const { companyId, act, locked } = useMigration();
  const decide = useMutation(api.migration.decide);
  const [fields, setFields] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  if (row.result && row.result.outcome !== "failed") return null;
  const options = row.kind === "customers" ? ["email", "phone", "notes", "category", "address"] : [];
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" size="xs" disabled={locked} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "keep_existing", targetId }))}>
        Same {row.kind === "customers" ? "customer" : row.kind === "cleaners" ? "person" : "property"}: keep it as is
      </Button>
      {options.length ? (
        picking ? (
          <span className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border px-2 py-1">
            {options.map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input type="checkbox" checked={fields.includes(f)} onChange={() => setFields((x) => (x.includes(f) ? x.filter((y) => y !== f) : [...x, f]))} />
                {f}
              </label>
            ))}
            <Button variant="primary" size="xs" disabled={!fields.length || locked} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "update_fields", targetId, fields }))}>
              Update these
            </Button>
          </span>
        ) : (
          <Button variant="ghost" size="xs" onClick={() => setPicking(true)}>
            Update selected fields…
          </Button>
        )
      ) : null}
    </span>
  );
}

function Choices({ row }: { row: Row }) {
  const { companyId, act, locked } = useMigration();
  const decide = useMutation(api.migration.decide);
  const undecide = useMutation(api.migration.undecide);
  const can = (choice: "create" | "separate" | "skip" | "review") => !(row.state === "error" && (choice === "create" || choice === "separate"));
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
      {row.state === "duplicate" || row.state === "update" ? (
        <Button variant="outline" size="sm" disabled={locked || !can("separate")} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "separate" }))}>
          Create as a separate record
        </Button>
      ) : null}
      {row.state === "review" && row.kind === "customers" ? (
        <Button variant="outline" size="sm" disabled={locked} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "create" }))}>
          Create as its own customer
        </Button>
      ) : null}
      {row.state === "skip" && row.kind === "cleaners" && row.decision?.choice !== "create" ? (
        <Button variant="outline" size="sm" disabled={locked} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "create" }))}>
          Import anyway
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "skip" }))}>
        Skip
      </Button>
      <Button variant="ghost" size="sm" disabled={locked} onClick={() => void act(() => decide({ companyId, rowIds: [row.id], choice: "review" }))}>
        Review manually later
      </Button>
      {row.decision ? (
        <Button variant="ghost" size="sm" disabled={locked} onClick={() => void act(() => undecide({ companyId, rowIds: [row.id] }))}>
          Undo my choice
        </Button>
      ) : null}
    </div>
  );
}

/** Bulk actions, for rows with the same kind of problem. The server refuses mixed selections. */
function BulkBar({ rows, kind, clear }: { rows: Row[]; kind: FileKind; clear: () => void }) {
  const { companyId, act, locked } = useMigration();
  const decide = useMutation(api.migration.decide);
  const edit = useMutation(api.migration.edit);
  const setCategory = useMutation(api.migration.setCategory);
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const same = new Set(rows.map((r) => r.state)).size === 1;
  const ids = rows.map((r) => r.id);
  const fields = (IMPORTABLE as readonly string[]).includes(kind) ? FIELDS[kind as Importable] : [];
  const done = async (work: () => Promise<unknown>) => {
    const ok = await act(work);
    if (ok !== undefined) clear();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/[0.05] px-3 py-2 text-xs">
      <span className="font-medium text-strong">{plural(rows.length, "row")} selected</span>
      {!same ? <span className="text-warning-foreground">Choose rows with the same problem to decide them together.</span> : null}
      <Button variant="outline" size="xs" disabled={locked || !same} onClick={() => void done(() => decide({ companyId, rowIds: ids, choice: "skip" }))}>
        Skip
      </Button>
      {same && rows[0].state === "duplicate" ? (
        <Button variant="outline" size="xs" disabled={locked} onClick={() => void done(() => decide({ companyId, rowIds: ids, choice: "separate" }))}>
          Create separately
        </Button>
      ) : null}
      {kind === "customers" ? (
        <SelectInput aria-label="Set customer type" className="min-h-7 w-auto py-0.5 text-xs" value="" disabled={locked} onChange={(e) => e.target.value && void done(() => setCategory({ companyId, rowIds: ids, category: e.target.value as Category }))}>
          <option value="">Set customer type…</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </SelectInput>
      ) : null}
      {fields.length ? (
        <span className="flex flex-wrap items-center gap-1">
          <SelectInput aria-label="Field to set" className="min-h-7 w-auto py-0.5 text-xs" value={field} onChange={(e) => setField(e.target.value)}>
            <option value="">Set a value for…</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </SelectInput>
          {field ? (
            <>
              <TextInput aria-label="Value" className="min-h-7 w-36 py-0.5 text-xs" value={value} onChange={(e) => setValue(e.target.value)} placeholder={field === "time" ? "9:00 AM" : ""} />
              <Button variant="primary" size="xs" disabled={locked || !value.trim()} onClick={() => void done(() => edit({ companyId, rowIds: ids, field, value }))}>
                Apply to {rows.length}
              </Button>
            </>
          ) : null}
        </span>
      ) : null}
      <span className="flex-1" />
      <Button variant="ghost" size="xs" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}

/** For Selestial staff in a support session: leave the owner a question about a record they can't settle. */
function AskOwner({ row }: { row: Row }) {
  const { companyId, act, locked } = useMigration();
  const ask = useMutation(api.migration.askOwner);
  const [text, setText] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2">
      <TextInput aria-label="Question for the owner" className="min-h-8 flex-1 py-1 text-xs" placeholder="Ask the owner about this record…" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
      <Button variant="outline" size="xs" disabled={locked || !text.trim()} onClick={() => void act(async () => {
        await ask({ companyId, rowIds: [row.id], text });
        setText("");
      })}>
        Ask the owner
      </Button>
    </div>
  );
}
