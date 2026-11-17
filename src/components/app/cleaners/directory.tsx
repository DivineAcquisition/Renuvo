"use client";

/**
 * Cleaners: a compact operational overview, what needs attention, and a searchable directory of the
 * workforce as cards or a table. Opening a person keeps the search, filters and view: everything is in the
 * address. Every number says what it counts, and every attention item opens the record behind it.
 */
import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useStableQuery } from "@/lib/app/stable-query";
import { useDetail } from "@/components/app/detail-panel";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Building2, CalendarIcon, Check, ChevronDown, ClipboardList, Clock, FunnelIcon, LayoutGrid, MessageSquareText, Plus, Search, Sparkles, TableIcon, TriangleAlert, Upload, Users, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, dayName, localDate, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AddCleanerDialog } from "./add";
import { Avatar, Chips, ENGAGEMENT_SHORT, Progress, ReadinessLine, StatusBadge, STATUS_WORDS, type EngagementStatus } from "./bits";
import { CleanerDrawer } from "./drawer";
import { InviteManyDialog } from "./onboarding-review";
import { CLEANERS_PATH, useDirectoryState, type DirectoryState } from "./state";

export type Directory = FunctionReturnType<typeof api.workforce.directory>;
export type Row = Directory["rows"][number];
export type Attention = Directory["attention"][number];

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

// ── Overview ───────────────────────────────────────────────────────────────────────────────────────

const TILES = [
  { key: "ready", label: "Ready for assignments", focus: "ready", tone: "text-success-foreground bg-success/10", Icon: Check },
  { key: "onboarding", label: "Onboarding in progress", focus: "onboarding", tone: "text-info-foreground bg-info/10", Icon: Clock },
  { key: "attention", label: "Needs attention", focus: "attention", tone: "text-warning-foreground bg-warning/12", Icon: TriangleAlert },
  { key: "working", label: "Working today", focus: "working", tone: "text-brand-300 bg-brand-500/10", Icon: CalendarIcon },
] as const;

function Overview({ overview, active, onFocus }: { overview: Directory["overview"]; active?: string; onFocus: (focus: string | undefined) => void }) {
  return (
    <section aria-label="Workforce overview" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {TILES.map(({ key, label, focus, tone, Icon }) => {
        const tile = overview[key];
        const on = active === focus;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onFocus(on ? undefined : focus)}
            className={cn(
              "group relative flex min-h-32 flex-col rounded-2xl border bg-card p-4 text-left transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 sm:p-5",
              on ? "border-brand-500 shadow-[0_0_0_3px_rgba(104,56,239,0.12)]" : "border-border hover:border-brand-500/40",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-strong">{label}</span>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tone)}>
                <Icon className="size-4" aria-hidden />
              </span>
            </span>
            <span className="mt-2 font-heading text-3xl leading-none tabular-nums text-strong">{tile.count}</span>
            <span className="mt-2 text-xs leading-relaxed text-muted-foreground">{tile.definition}</span>
            {on ? <span className="absolute top-3 right-12 rounded-full bg-brand-500 px-1.5 py-px text-[10px] font-semibold text-white">Filtering</span> : null}
          </button>
        );
      })}
    </section>
  );
}

// ── Attention ──────────────────────────────────────────────────────────────────────────────────────

const SEVERITY = {
  urgent: { label: "Urgent", dot: "bg-destructive", text: "text-destructive-foreground" },
  decide: { label: "Needs a decision", dot: "bg-warning", text: "text-warning-foreground" },
  look: { label: "To look at", dot: "bg-info", text: "text-info-foreground" },
} as const;

function AttentionPanel({ items, rows, onOpen }: { items: Attention[]; rows: Row[]; onOpen: (cleanerId: string, section: string) => void }) {
  const [all, setAll] = useState(false);
  const openJob = useDetail();
  const byId = useMemo(() => new Map(rows.map((row) => [row.cleanerId as string, row])), [rows]);
  if (items.length === 0) {
    return (
      <section className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-success/10 text-success-foreground">
          <Check className="size-4" aria-hidden />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-strong">Nothing needs your attention</h2>
          <p className="text-xs text-muted-foreground">No submissions to review, missing requirements, expiring documents, conflicts or availability to confirm.</p>
        </div>
      </section>
    );
  }
  const shown = all ? items : items.slice(0, 5);
  return (
    <section aria-labelledby="attention-title" className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 id="attention-title" className="font-heading text-base tracking-tight text-strong">
          Needs attention
          <span className="ml-2 text-sm font-normal text-muted-foreground">{plural(items.length, "item")}</span>
        </h2>
        <p className="text-xs text-muted-foreground">Each item is a fact from the record. Open it to see the evidence and act.</p>
      </header>
      <ul className="divide-y divide-border">
        {shown.map((item) => {
          const person = byId.get(item.cleanerId);
          const severity = SEVERITY[item.severity];
          return (
            <li key={item.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Avatar name={item.cleanerName} initials={person?.initials ?? "?"} photoUrl={person?.photoUrl} size="sm" />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-semibold text-strong">{item.title}</span>
                    <span className="text-muted-foreground">· {item.cleanerName}</span>
                    <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium", severity.text)}>
                      <span aria-hidden className={cn("size-1.5 rounded-full", severity.dot)} />
                      {severity.label}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
                  {item.selestial ? (
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-strong">
                      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-300" aria-hidden />
                      {item.selestial}
                    </p>
                  ) : null}
                  {item.evidence.some((row) => row.jobId) ? (
                    <p className="mt-1.5 flex flex-wrap gap-1.5">
                      {item.evidence
                        .filter((row) => row.jobId)
                        .map((row) => (
                          <button key={row.jobId} type="button" onClick={() => openJob({ kind: "job", id: row.jobId as Id<"jobs"> })} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                            {row.label}
                          </button>
                        ))}
                    </p>
                  ) : null}
                </div>
              </div>
              <Button variant="outline" size="sm" className="self-start sm:self-center" onClick={() => onOpen(item.cleanerId, item.section)}>
                Open
              </Button>
            </li>
          );
        })}
      </ul>
      {items.length > 5 ? (
        <button type="button" onClick={() => setAll(!all)} className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-sm font-medium text-brand-300 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand-500">
          {all ? "Show fewer" : `Show all ${items.length}`}
          <ChevronDown className={cn("size-4 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

// ── Filtering ──────────────────────────────────────────────────────────────────────────────────────

function matches(row: Row, state: DirectoryState, attentionIds: Set<string>, available: Map<string, { available: boolean; reason: string | null }> | null): boolean {
  if (state.q) {
    const q = state.q.trim().toLowerCase();
    const hay = [row.name, row.engagementWords, row.subcontractor?.name ?? "", ...row.skills, ...row.serviceAreas, ...row.crews.map((crew) => crew.name)].join(" ").toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (state.type && row.engagement !== state.type) return false;
  if (state.status && row.status !== state.status) return false;
  if (state.ready && row.readiness.state !== state.ready) return false;
  if (state.crew && !row.crews.some((crew) => crew.crewId === state.crew)) return false;
  if (state.area && !row.serviceAreas.includes(state.area)) return false;
  if (state.skill && !row.skills.includes(state.skill)) return false;
  if (state.sub && row.subcontractor?.id !== state.sub) return false;
  if (state.stage && (state.stage === "complete" ? row.stage !== null : row.stage?.key !== state.stage)) return false;
  if (state.focus === "ready" && row.readiness.state !== "ready") return false;
  if (state.focus === "onboarding" && row.status !== "onboarding") return false;
  if (state.focus === "attention" && !attentionIds.has(row.cleanerId)) return false;
  if (state.focus === "working" && !row.workingToday) return false;
  if (available && !available.get(row.cleanerId)?.available) return false;
  return true;
}

function parseAvail(value: string | undefined): { date: string; from: string; to: string } | null {
  const parts = value?.split(",") ?? [];
  if (parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(parts[0]) || !/^\d{2}:\d{2}$/.test(parts[1]) || !/^\d{2}:\d{2}$/.test(parts[2])) return null;
  return { date: parts[0], from: parts[1], to: parts[2] };
}

function Select({ label, value, onChange, options }: { label: string; value: string | undefined; onChange: (value: string | undefined) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || undefined)}
        className="h-9 w-full cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm text-strong focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function AvailabilityPicker({ value, timezone, now, onApply }: { value: string | undefined; timezone: string; now: number; onApply: (value: string | undefined) => void }) {
  const current = parseAvail(value);
  const [date, setDate] = useState(current?.date ?? (now ? localDate(now, timezone) : ""));
  const [from, setFrom] = useState(current?.from ?? "13:00");
  const [to, setTo] = useState(current?.to ?? "17:00");
  const valid = zonedInstant(date, from, timezone) !== null && zonedInstant(date, to, timezone) !== null && from < to;
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        Date
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500/30" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        From
        <input type="time" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500/30" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">
        To
        <input type="time" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500/30" />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={!valid} onClick={() => onApply(`${date},${from},${to}`)}>
          Show who is free
        </Button>
        {value ? (
          <Button variant="ghost" size="sm" onClick={() => onApply(undefined)}>
            Clear
          </Button>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground sm:col-span-4">Times are on the company&apos;s clock. Free means active, with hours given for the whole window, no time away, no date exception and no other work then. Skills and areas are checked per job in Dispatch.</p>
    </div>
  );
}

// ── Cards and table ────────────────────────────────────────────────────────────────────────────────

function NextLine({ row, timezone }: { row: Row; timezone: string }) {
  if (row.next) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">
          Next: <span className="font-medium text-strong">{dayName(row.next.startsAt, timezone)} {clock(row.next.startsAt, timezone)}</span>
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{row.week}</span>
    </span>
  );
}

function readinessDetail(row: Row): string | null {
  if (row.readiness.state === "blocked") return `Missing: ${row.readiness.blockers.slice(0, 2).join(", ").toLowerCase()}${row.readiness.blockers.length > 2 ? ` +${row.readiness.blockers.length - 2}` : ""}`;
  if (row.readiness.state === "onboarding") return row.readiness.nextStep ? `Next: ${row.readiness.nextStep.toLowerCase()}` : null;
  if (row.readiness.state === "not_active") return `${STATUS_WORDS[row.status as EngagementStatus]}`;
  return null;
}

function CleanerCard({ row, timezone, onOpen, freeReason }: { row: Row; timezone: string; onOpen: () => void; freeReason?: string | null }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex h-full w-full flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-[border-color,box-shadow,transform] hover:-translate-y-px hover:border-brand-500/40 hover:shadow-[0_8px_24px_-16px_rgba(33,26,53,0.35)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <span className="flex items-start gap-3">
          <Avatar name={row.name} initials={row.initials} photoUrl={row.photoUrl} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-strong">{row.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {ENGAGEMENT_SHORT[row.engagement]}
              {row.subcontractor ? ` · ${row.subcontractor.name}` : ""}
            </span>
          </span>
          <StatusBadge status={row.status as EngagementStatus} />
        </span>
        <ReadinessLine state={row.readiness.state} detail={readinessDetail(row)} />
        {row.status === "onboarding" && row.readiness.progress.total > 0 ? <Progress met={row.readiness.progress.met} total={row.readiness.progress.total} /> : null}
        <span className="grid gap-1.5">
          {row.serviceAreas.length > 0 ? <Chips items={row.serviceAreas} label="Service areas" /> : <span className="text-xs text-muted-foreground">No service areas set</span>}
          <Chips items={row.skills} label="Skills" tone="brand" />
        </span>
        <span className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
          <NextLine row={row} timezone={timezone} />
          <span className="flex shrink-0 items-center gap-1.5">
            {row.crews.slice(0, 1).map((crew) => (
              <span key={crew.crewId} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Users className="size-3" aria-hidden />
                {crew.name}
              </span>
            ))}
            {row.attention > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-warning/12 px-1.5 py-0.5 text-[11px] font-semibold text-warning-foreground" aria-label={`${plural(row.attention, "item")} need attention`}>
                <TriangleAlert className="size-3" aria-hidden />
                {row.attention}
              </span>
            ) : null}
          </span>
        </span>
        {freeReason ? <span className="text-xs text-muted-foreground">{freeReason}</span> : null}
      </button>
    </li>
  );
}

function CleanerTable({ rows, timezone, onOpen }: { rows: Row[]; timezone: string; onOpen: (row: Row) => void }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">Cleaners</caption>
        <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Engagement</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Readiness</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Areas</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Skills</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Crew</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Next</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              <span className="sr-only">Attention</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.cleanerId} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => onOpen(row)}>
              <td className="px-4 py-2.5">
                <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(row); }} className="flex items-center gap-2.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                  <Avatar name={row.name} initials={row.initials} photoUrl={row.photoUrl} size="xs" />
                  <span>
                    <span className="block font-medium text-strong">{row.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ENGAGEMENT_SHORT[row.engagement]}
                      {row.subcontractor ? ` · ${row.subcontractor.name}` : ""}
                    </span>
                  </span>
                </button>
              </td>
              <td className="px-3 py-2.5">
                <StatusBadge status={row.status as EngagementStatus} />
              </td>
              <td className="max-w-56 px-3 py-2.5">
                <ReadinessLine state={row.readiness.state} detail={readinessDetail(row)} className="text-xs" />
              </td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.serviceAreas.slice(0, 3).join(", ") || "—"}{row.serviceAreas.length > 3 ? ` +${row.serviceAreas.length - 3}` : ""}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.skills.slice(0, 2).join(", ") || "—"}{row.skills.length > 2 ? ` +${row.skills.length - 2}` : ""}</td>
              <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.crews.map((crew) => crew.name).join(", ") || "—"}</td>
              <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">{row.next ? `${dayName(row.next.startsAt, timezone)} ${clock(row.next.startsAt, timezone)}` : row.week}</td>
              <td className="px-3 py-2.5 text-right">
                {row.attention > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-warning/12 px-1.5 py-0.5 text-[11px] font-semibold text-warning-foreground" aria-label={`${plural(row.attention, "item")} need attention`}>
                    <TriangleAlert className="size-3" aria-hidden />
                    {row.attention}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── The screen ─────────────────────────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  { value: "employee", label: "Employee" },
  { value: "contractor", label: "Independent contractor" },
  { value: "subcontractor", label: "Subcontractor worker" },
];
const STATUS_OPTIONS = (["onboarding", "ready", "paused", "suspended", "ended"] as const).map((value) => ({ value, label: STATUS_WORDS[value] }));
const READY_OPTIONS = [
  { value: "ready", label: "Ready for assignments" },
  { value: "blocked", label: "Active, not ready" },
  { value: "onboarding", label: "Onboarding" },
  { value: "not_active", label: "Not taking work" },
];
const FOCUS_WORDS: Record<string, string> = { ready: "Ready for assignments", onboarding: "Onboarding in progress", attention: "Needs attention", working: "Working today" };

export function CleanersScreen() {
  const { companyId, timezone, role } = useCompany();
  const now = useNow();
  const [state, update] = useDirectoryState();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [availOpen, setAvailOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [inviting, setInviting] = useState(false);
  const data = useStableQuery(api.workforce.directory, now ? { companyId, asOf: now, includeEnded: state.ended === "1" } : "skip");
  const avail = parseAvail(state.avail);
  const slot = avail ? { from: zonedInstant(avail.date, avail.from, timezone), to: zonedInstant(avail.date, avail.to, timezone) } : null;
  const free = useQuery(api.workforce.availableIn, slot?.from && slot.to && slot.to > slot.from ? { companyId, from: slot.from, to: slot.to } : "skip");
  const manager = canManage(role);

  const availability = useMemo(() => (free ? new Map(free.map((row) => [row.cleanerId as string, row])) : null), [free]);
  const attentionIds = useMemo(() => new Set((data?.attention ?? []).map((item) => item.cleanerId as string)), [data]);
  const filtering = state.avail ? availability : null;
  const rows = useMemo(() => (data ? data.rows.filter((row) => matches(row, state, attentionIds, filtering)) : []), [data, state, attentionIds, filtering]);
  const view = state.view === "table" ? "table" : "cards";
  const open = (cleanerId: string, section?: string) => update({ cleaner: cleanerId, section: section && section !== "overview" ? section : undefined }, "push");

  const chips: { key: keyof DirectoryState; label: string }[] = [];
  if (state.focus) chips.push({ key: "focus", label: FOCUS_WORDS[state.focus] ?? state.focus });
  if (state.type) chips.push({ key: "type", label: TYPE_OPTIONS.find((row) => row.value === state.type)?.label ?? state.type });
  if (state.status) chips.push({ key: "status", label: STATUS_WORDS[state.status as EngagementStatus] ?? state.status });
  if (state.ready) chips.push({ key: "ready", label: READY_OPTIONS.find((row) => row.value === state.ready)?.label ?? state.ready });
  if (state.crew) chips.push({ key: "crew", label: `Crew: ${data?.filters.crews.find((row) => row.id === state.crew)?.name ?? "crew"}` });
  if (state.area) chips.push({ key: "area", label: `Area ${state.area}` });
  if (state.skill) chips.push({ key: "skill", label: `Skill: ${state.skill}` });
  if (state.sub) chips.push({ key: "sub", label: data?.filters.subcontractors.find((row) => row.id === state.sub)?.name ?? "Subcontractor" });
  if (state.stage) chips.push({ key: "stage", label: state.stage === "complete" ? "Onboarding complete" : `At: ${data?.filters.stages.find((row) => row.key === state.stage)?.label ?? state.stage}` });
  if (avail && slot?.from) chips.push({ key: "avail", label: `Free ${dayName(slot.from, timezone)}, ${clock(slot.from, timezone)}–${slot.to ? clock(slot.to, timezone) : ""}` });
  const filterCount = ["type", "status", "ready", "crew", "area", "skill", "sub", "stage"].filter((key) => state[key as keyof DirectoryState]).length;

  return (
    <>
      <PageHeader
        title="Cleaners"
        lead="Who is ready to work, who is free for a job, who needs attention and why. Dispatch, Recruiter and Chat read these same records."
        actions={
          <>
            <Button variant="ghost" size="sm" render={<Link href={`${CLEANERS_PATH}/crews`} />}>
              <Users aria-hidden />
              Crews
            </Button>
            <Button variant="ghost" size="sm" render={<Link href={`${CLEANERS_PATH}/subcontractors`} />}>
              <Building2 aria-hidden />
              Subcontractors
            </Button>
            <Button variant="ghost" size="sm" render={<Link href={`${CLEANERS_PATH}/onboarding`} />}>
              <ClipboardList aria-hidden />
              Onboarding checklist
            </Button>
            {manager ? (
              <>
                <Button variant="outline" size="sm" render={<Link href={`${CLEANERS_PATH}/import`} />}>
                  <Upload aria-hidden />
                  Import cleaners
                </Button>
                <Button variant="outline" size="sm" disabled={!data} onClick={() => setInviting(true)}>
                  <MessageSquareText aria-hidden />
                  Invite to portal
                </Button>
                <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
                  <Plus aria-hidden />
                  Add cleaner
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {!data ? (
        <div className="grid gap-5" aria-busy="true" aria-label="Loading the workforce">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-32 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-40 rounded-2xl" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-52 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : data.overview.total === 0 && !state.ended ? (
        <EmptyWorkforce manager={manager} onAdd={() => setAdding(true)} />
      ) : (
        <div className="grid gap-5">
          <Overview overview={data.overview} active={state.focus} onFocus={(focus) => update({ focus })} />
          <AttentionPanel items={data.attention} rows={data.rows} onOpen={open} />

          <section aria-labelledby="directory-title" className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="directory-title" className="font-heading text-base tracking-tight text-strong">
                Directory
                <span className="ml-2 text-sm font-normal text-muted-foreground" aria-live="polite">
                  {rows.length === data.rows.length ? plural(rows.length, "person", "people") : `${rows.length} of ${data.rows.length}`}
                </span>
              </h2>
              <div role="group" aria-label="View" className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {(["cards", "table"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={view === option}
                    onClick={() => update({ view: option === "cards" ? undefined : "table" })}
                    className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500", view === option ? "bg-brand-500/10 text-brand-300" : "text-muted-foreground hover:text-strong")}
                  >
                    {option === "cards" ? <LayoutGrid className="size-4" aria-hidden /> : <TableIcon className="size-4" aria-hidden />}
                    {option === "cards" ? "Cards" : "Table"}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 basis-64">
                <span className="sr-only">Search cleaners</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={state.q ?? ""}
                  onChange={(event) => update({ q: event.target.value || undefined })}
                  placeholder="Search by name, skill, area, crew or subcontractor"
                  className="h-10 w-full rounded-lg border border-border bg-card pr-3 pl-9 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30 sm:h-9"
                />
              </label>
              <Button variant="outline" size="sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
                <FunnelIcon aria-hidden />
                Filters{filterCount ? ` · ${filterCount}` : ""}
              </Button>
              <Button variant="outline" size="sm" aria-expanded={availOpen} onClick={() => setAvailOpen(!availOpen)}>
                <CalendarIcon aria-hidden />
                Free at a time
              </Button>
            </div>

            {filtersOpen ? (
              <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:grid-cols-4 xl:grid-cols-8">
                <Select label="Worker type" value={state.type} onChange={(type) => update({ type })} options={TYPE_OPTIONS} />
                <Select label="Engagement" value={state.status} onChange={(status) => update({ status })} options={STATUS_OPTIONS} />
                <Select label="Readiness" value={state.ready} onChange={(ready) => update({ ready })} options={READY_OPTIONS} />
                <Select label="Onboarding stage" value={state.stage} onChange={(stage) => update({ stage })} options={[...data.filters.stages.map((row) => ({ value: row.key, label: `At: ${row.label}` })), { value: "complete", label: "Every requirement met" }]} />
                <Select label="Crew" value={state.crew} onChange={(crew) => update({ crew })} options={data.filters.crews.map((row) => ({ value: row.id, label: row.name }))} />
                <Select label="Service area" value={state.area} onChange={(area) => update({ area })} options={data.filters.areas.map((value) => ({ value, label: value }))} />
                <Select label="Skill" value={state.skill} onChange={(skill) => update({ skill })} options={data.filters.skills.map((value) => ({ value, label: value }))} />
                <Select label="Subcontractor" value={state.sub} onChange={(sub) => update({ sub })} options={data.filters.subcontractors.map((row) => ({ value: row.id, label: row.name }))} />
              </div>
            ) : null}
            {availOpen ? <AvailabilityPicker value={state.avail} timezone={timezone} now={now} onApply={(value) => update({ avail: value })} /> : null}

            {chips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {chips.map((chip) => (
                  <button key={chip.key} type="button" onClick={() => update({ [chip.key]: undefined })} className="inline-flex items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/8 py-1 pr-1.5 pl-2.5 text-xs font-medium text-brand-300 hover:bg-brand-500/15 focus-visible:outline-2 focus-visible:outline-brand-500" aria-label={`Remove filter: ${chip.label}`}>
                    {chip.label}
                    <X className="size-3.5" aria-hidden />
                  </button>
                ))}
                <button type="button" onClick={() => update(Object.fromEntries(chips.map((chip) => [chip.key, undefined])))} className="px-1.5 text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
                  Clear all
                </button>
              </div>
            ) : null}

            {avail && free === undefined ? <Skeleton className="h-10 rounded-xl" /> : null}
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
                <p className="font-semibold text-strong">{avail ? "Nobody is free then" : "Nobody matches"}</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{avail ? "No active cleaner has given hours for that whole window without time away or other work. Try a shorter window or another day." : "Try fewer filters, or search for part of a name."}</p>
              </div>
            ) : view === "cards" ? (
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {rows.map((row) => (
                  <CleanerCard key={row.cleanerId} row={row} timezone={timezone} onOpen={() => open(row.cleanerId)} />
                ))}
              </ul>
            ) : (
              <CleanerTable rows={rows} timezone={timezone} onOpen={(row) => open(row.cleanerId)} />
            )}
            {avail && free ? <NotFree free={free} rows={data.rows} /> : null}
            {data.capped ? <p className="text-xs text-muted-foreground">Showing the first 1,000 people. Search narrows the list.</p> : null}
            <p className="text-xs text-muted-foreground">
              {state.ended ? (
                <button type="button" className="font-medium text-brand-300 underline-offset-4 hover:underline" onClick={() => update({ ended: undefined })}>
                  Hide ended engagements
                </button>
              ) : (
                <>
                  Ended engagements are kept with their history.{" "}
                  <button type="button" className="font-medium text-brand-300 underline-offset-4 hover:underline" onClick={() => update({ ended: "1" })}>
                    Show them
                  </button>
                </>
              )}
            </p>
          </section>
        </div>
      )}

      {inviting && data ? <InviteManyDialog people={data.rows.map((row) => ({ cleanerId: row.cleanerId, name: row.name, status: row.status, hasPhone: row.hasPhone }))} onClose={() => setInviting(false)} /> : null}
      {adding ? <AddCleanerDialog onClose={() => setAdding(false)} onAdded={(cleanerId) => { setAdding(false); open(cleanerId); }} /> : null}
      <CleanerDrawer cleanerId={state.cleaner ?? null} section={state.section} onClose={() => update({ cleaner: undefined, section: undefined }, "replace")} onSection={(section) => update({ section })} />
    </>
  );
}

function NotFree({ free, rows }: { free: NonNullable<FunctionReturnType<typeof api.workforce.availableIn>>; rows: Row[] }) {
  const [open, setOpen] = useState(false);
  const names = new Map(rows.map((row) => [row.cleanerId as string, row.name]));
  const not = free.filter((row) => !row.available && names.has(row.cleanerId));
  if (not.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
        Why {plural(not.length, "other is", "others are")} not free
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <ul className="grid gap-1 border-t border-border px-4 py-3 text-sm">
          {not.map((row) => (
            <li key={row.cleanerId}>
              <span className="font-medium text-strong">{names.get(row.cleanerId)}</span> <span className="text-muted-foreground">{row.reason}.</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EmptyWorkforce({ manager, onAdd }: { manager: boolean; onAdd: () => void }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-300">
        <Users className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 font-heading text-lg text-strong">Add your first cleaner</h2>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">Add people one at a time, or import a list. Each person gets your onboarding checklist, and nobody is offered work until a person makes them active and every requirement for work is met.</p>
      {manager ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={onAdd}>
            <Plus aria-hidden />
            Add cleaner
          </Button>
          <Button variant="outline" render={<Link href={`${CLEANERS_PATH}/import`} />}>
            <Upload aria-hidden />
            Import cleaners
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">An Owner or Manager adds cleaners.</p>
      )}
    </div>
  );
}
