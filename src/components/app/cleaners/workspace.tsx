"use client";

import { useQuery } from "convex/react";
import { Component, Suspense, useEffect, useMemo, useState } from "react";

import { AddCleaner } from "@/components/app/cleaners/add";
import { AttentionList } from "@/components/app/cleaners/attention";
import { CrewsDialog, NewCrewDialog } from "@/components/app/cleaners/crews";
import { DirectoryCards, DirectoryTable } from "@/components/app/cleaners/directory";
import { WorkerDrawer } from "@/components/app/cleaners/drawer";
import { ImportCleaners } from "@/components/app/cleaners/import";
import { READINESS_WORDS, plural, TYPE_WORDS, useDirectoryState, type Row, type Workspace } from "@/components/app/cleaners/shared";
import { SubcontractorsDialog } from "@/components/app/cleaners/subcontractors";
import { canManage, useCompany } from "@/components/app/company";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Building2, CalendarIcon, CheckCircle2, CircleDashed, FunnelIcon, LayoutGrid, Plus, Search, TableIcon, TeamIcon, TriangleAlert, Upload, Users, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { activeFilterCount, EMPTY_STATE, filterRows, LAST_LIST_KEY, type DirectoryState, type ReadinessFilter } from "@/lib/app/cleaners";
import { localDate, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

type Counts = Workspace["counts"];
type TileId = "ready" | "onboarding" | "attention" | "workingToday";

function Tile({ label, value, detail, icon: Icon, tone, selected, onClick }: { label: string; value: number; detail: string; icon: typeof CheckCircle2; tone: "good" | "info" | "attention" | "neutral"; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group grid content-start gap-1 rounded-2xl border bg-card p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
        selected ? "border-brand-500 ring-1 ring-brand-500/30" : tone === "attention" && value > 0 ? "border-warning/50 hover:border-warning" : "border-border hover:border-brand-500/50",
      )}
    >
      <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className={cn("grid size-6 place-items-center rounded-lg", tone === "good" ? "bg-success/10 text-success-foreground" : tone === "info" ? "bg-info/10 text-info-foreground" : tone === "attention" ? "bg-warning/10 text-warning-foreground" : "bg-brand-500/10 text-brand-600 dark:text-brand-300")}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        {label}
      </span>
      <span className={cn("font-heading text-3xl leading-tight tracking-tight tabular-nums", tone === "attention" && value > 0 ? "text-warning-foreground" : "text-strong")}>{value}</span>
      <span className="hidden text-[11px] leading-snug text-muted-foreground sm:block">{detail}</span>
    </button>
  );
}

const SHORT: Record<TileId, string> = {
  ready: "Can be offered work that fits their skills, areas and hours. Not a promise they are free for any one job.",
  onboarding: "Not yet made active by a person. Offered no work until then.",
  attention: "A conflict with upcoming work, an overdue onboarding, or an active worker who cannot be offered work.",
  workingToday: "Accepted at least one visit today. Not working today does not mean free.",
};

function Overview({ counts, state, onPick }: { counts: Counts; state: DirectoryState; onPick: (id: TileId) => void }) {
  const selected = (id: TileId) =>
    id === "ready" ? state.readiness.length === 1 && state.readiness[0] === "ready" : id === "onboarding" ? state.status.length === 1 && state.status[0] === "onboarding" : id === "attention" ? state.quick === "attention" : state.quick === "working_today";
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" role="group" aria-label="Your workforce at a glance">
      <Tile label="Ready for assignments" value={counts.ready} detail={SHORT.ready} icon={CheckCircle2} tone="good" selected={selected("ready")} onClick={() => onPick("ready")} />
      <Tile label="Onboarding in progress" value={counts.onboarding} detail={SHORT.onboarding} icon={CircleDashed} tone="info" selected={selected("onboarding")} onClick={() => onPick("onboarding")} />
      <Tile label="Needs attention" value={counts.attention} detail={SHORT.attention} icon={TriangleAlert} tone="attention" selected={selected("attention")} onClick={() => onPick("attention")} />
      <Tile label="Working today" value={counts.workingToday} detail={SHORT.workingToday} icon={CalendarIcon} tone="neutral" selected={selected("workingToday")} onClick={() => onPick("workingToday")} />
      <details className="col-span-2 rounded-xl border border-border bg-card px-3 py-2 text-xs sm:hidden">
        <summary className="cursor-pointer font-medium text-strong">What these counts mean</summary>
        <dl className="mt-2 grid gap-1.5 text-muted-foreground">
          {(["ready", "onboarding", "attention", "workingToday"] as const).map((id) => (
            <div key={id}>
              <dt className="font-medium text-strong">{{ ready: "Ready for assignments", onboarding: "Onboarding in progress", attention: "Needs attention", workingToday: "Working today" }[id]}</dt>
              <dd>{SHORT[id]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
        on ? "border-brand-500/60 bg-brand-500/10 text-strong" : "border-border bg-card text-muted-foreground hover:border-brand-500/40 hover:text-strong",
      )}
    >
      {on ? <CheckCircle2 className="size-3.5 text-brand-600 dark:text-brand-300" aria-hidden /> : null}
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

function FilterPanel({ data, state, set }: { data: Workspace; state: DirectoryState; set: (next: Partial<DirectoryState>) => void }) {
  const areas = useMemo(() => [...new Set(data.rows.flatMap((row) => row.serviceAreas))].sort().slice(0, 40), [data.rows]);
  const skills = useMemo(() => [...new Set(data.rows.flatMap((row) => row.skills))].sort().slice(0, 40), [data.rows]);
  return (
    <div className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2 xl:grid-cols-3">
      <Group title="Worker type">
        {(["employee", "contractor", "subcontracted"] as const).map((type) => (
          <Toggle key={type} on={state.type.includes(type)} onClick={() => set({ type: toggleIn(state.type, type) })}>
            {TYPE_WORDS[type]}
          </Toggle>
        ))}
      </Group>
      <Group title="Engagement status">
        {(
          [
            ["ready", "Active"],
            ["onboarding", "Onboarding"],
            ["paused", "Paused"],
            ["ended", "Ended"],
          ] as const
        ).map(([status, label]) => (
          <Toggle key={status} on={state.status.includes(status)} onClick={() => set({ status: toggleIn(state.status, status) })}>
            {label}
          </Toggle>
        ))}
      </Group>
      <Group title="Readiness">
        {(["ready", "blocked", "onboarding", "paused"] as ReadinessFilter[]).map((value) => (
          <Toggle key={value} on={state.readiness.includes(value)} onClick={() => set({ readiness: toggleIn(state.readiness, value) as ReadinessFilter[] })}>
            {READINESS_WORDS[value]}
          </Toggle>
        ))}
      </Group>
      {data.crews.length > 0 ? (
        <Group title="Crew">
          {data.crews.map((crew) => (
            <Toggle key={crew.id} on={state.crew.includes(crew.id)} onClick={() => set({ crew: toggleIn(state.crew, crew.id) })}>
              {crew.name}
            </Toggle>
          ))}
        </Group>
      ) : null}
      {data.subcontractors.length > 0 ? (
        <Group title="Subcontractor company">
          {data.subcontractors.map((sub) => (
            <Toggle key={sub.id} on={state.subcontractor.includes(sub.id)} onClick={() => set({ subcontractor: toggleIn(state.subcontractor, sub.id) })}>
              {sub.name}
            </Toggle>
          ))}
        </Group>
      ) : null}
      {areas.length > 0 ? (
        <Group title="Service area">
          {areas.map((area) => (
            <Toggle key={area} on={state.area.includes(area)} onClick={() => set({ area: toggleIn(state.area, area) })}>
              {area}
            </Toggle>
          ))}
        </Group>
      ) : null}
      {skills.length > 0 ? (
        <Group title="Skills (all of)">
          {skills.map((skill) => (
            <Toggle key={skill} on={state.skill.includes(skill)} onClick={() => set({ skill: toggleIn(state.skill, skill) })}>
              {skill}
            </Toggle>
          ))}
        </Group>
      ) : null}
    </div>
  );
}

/** Who can work in one stated window. Without a window there is no availability filter: "free" always means free when. */
function WindowPicker({ state, set, timezone, now, words, loading }: { state: DirectoryState; set: (next: Partial<DirectoryState>) => void; timezone: string; now: number; words: string | null; loading: boolean }) {
  const [draft, setDraft] = useState(() => state.window ?? { date: localDate(now || Date.now(), timezone), from: "09:00", to: "13:00" });
  const valid = draft.from < draft.to && /^\d{4}-\d{2}-\d{2}$/.test(draft.date);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border bg-card p-3">
      <span className="flex w-full items-center gap-2 text-xs font-medium text-strong sm:w-auto">
        <CalendarIcon className="size-4 text-brand-600 dark:text-brand-300" aria-hidden />
        Available
      </span>
      <label className="grid gap-1 text-[11px] text-muted-foreground">
        Date
        <input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500" />
      </label>
      <label className="grid gap-1 text-[11px] text-muted-foreground">
        From
        <input type="time" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500" />
      </label>
      <label className="grid gap-1 text-[11px] text-muted-foreground">
        Until
        <input type="time" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-strong focus-visible:outline-2 focus-visible:outline-brand-500" />
      </label>
      <Button size="sm" variant="outline" disabled={!valid} onClick={() => set({ window: draft })}>
        Show who is free
      </Button>
      {state.window ? (
        <Button size="sm" variant="ghost" onClick={() => set({ window: null })}>
          Clear
        </Button>
      ) : null}
      <p className="w-full text-[11px] leading-snug text-muted-foreground">
        {state.window ? (loading ? "Checking hours, time off and work already held…" : `Showing people who said they can work ${words ?? "then"}, with no time off or other work at that time. Skills and areas are still checked for each job.`) : `On your company's clock (${timezone}). Free means they said they can work then and hold nothing else. It does not mean a given job fits.`}
        {!valid ? " The start must be before the end." : ""}
      </p>
    </div>
  );
}

function ActiveFilters({ data, state, set }: { data: Workspace; state: DirectoryState; set: (next: Partial<DirectoryState>) => void }) {
  const chips: { key: string; label: string; clear: () => void }[] = [];
  for (const type of state.type) chips.push({ key: `t${type}`, label: TYPE_WORDS[type as Row["engagement"]] ?? type, clear: () => set({ type: state.type.filter((v) => v !== type) }) });
  for (const status of state.status) chips.push({ key: `s${status}`, label: { ready: "Active", onboarding: "Onboarding", paused: "Paused", ended: "Ended" }[status] ?? status, clear: () => set({ status: state.status.filter((v) => v !== status) }) });
  for (const value of state.readiness) chips.push({ key: `r${value}`, label: READINESS_WORDS[value], clear: () => set({ readiness: state.readiness.filter((v) => v !== value) }) });
  for (const id of state.crew) chips.push({ key: `c${id}`, label: `Crew: ${data.crews.find((crew) => crew.id === id)?.name ?? "removed crew"}`, clear: () => set({ crew: state.crew.filter((v) => v !== id) }) });
  for (const id of state.subcontractor) chips.push({ key: `b${id}`, label: data.subcontractors.find((sub) => sub.id === id)?.name ?? "Subcontractor", clear: () => set({ subcontractor: state.subcontractor.filter((v) => v !== id) }) });
  for (const area of state.area) chips.push({ key: `a${area}`, label: `Area ${area}`, clear: () => set({ area: state.area.filter((v) => v !== area) }) });
  for (const skill of state.skill) chips.push({ key: `k${skill}`, label: skill, clear: () => set({ skill: state.skill.filter((v) => v !== skill) }) });
  if (state.quick) chips.push({ key: "quick", label: state.quick === "attention" ? "Needs attention" : "Working today", clear: () => set({ quick: null }) });
  if (state.window) chips.push({ key: "window", label: "Free in the chosen window", clear: () => set({ window: null }) });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters in use">
      {chips.map((chip) => (
        <button key={chip.key} type="button" onClick={chip.clear} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/8 pr-1.5 pl-2.5 text-xs font-medium text-strong hover:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500" aria-label={`Remove filter: ${chip.label}`}>
          {chip.label}
          <X className="size-3.5 text-muted-foreground" aria-hidden />
        </button>
      ))}
      <button type="button" onClick={() => set({ ...EMPTY_STATE, q: state.q, view: state.view, open: state.open })} className="min-h-7 px-2 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
        Clear all
      </button>
    </div>
  );
}

function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
        <Users className="size-6" aria-hidden />
      </span>
      <p className="text-base font-semibold text-strong">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading cleaners">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-28 rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-48 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

class Boundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
        <p className="font-semibold text-strong">The cleaners could not be loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">Nothing was changed. Check your connection and reload the page.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

type Dialog = "add" | "import" | "crew" | "crews" | "subcontractors" | null;

function Inner() {
  const company = useCompany();
  const now = useNow();
  const [state, set] = useDirectoryState();
  const includeEnded = state.status.includes("ended") || state.readiness.includes("ended");
  const data = useQuery(api.workforce.workspace, now ? { companyId: company.companyId, asOf: now, includeEnded } : "skip");
  const span = state.window ? { startsAt: zonedInstant(state.window.date, state.window.from, company.timezone), endsAt: zonedInstant(state.window.date, state.window.to, company.timezone) } : null;
  const availability = useQuery(api.workforce.availableFor, span?.startsAt && span.endsAt ? { companyId: company.companyId, startsAt: span.startsAt, endsAt: span.endsAt } : "skip");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showWindow, setShowWindow] = useState(Boolean(state.window));
  const manager = canManage(company.role);

  // Remember the list exactly as it is, so a worker's own page can lead back to it.
  useEffect(() => {
    try {
      window.sessionStorage.setItem(LAST_LIST_KEY, window.location.search);
    } catch {
      // Private windows may refuse storage; the back link then opens the plain list.
    }
  });

  const rows = useMemo(() => (data ? filterRows(data.rows, state, state.window ? (availability?.answers ?? null) : null) : []), [data, state, availability]);
  const filterCount = activeFilterCount(state);

  const pick = (id: TileId) => {
    const base = { ...state, type: [], status: [], readiness: [], crew: [], area: [], skill: [], subcontractor: [], quick: null } as DirectoryState;
    if (id === "ready") set(state.readiness.length === 1 && state.readiness[0] === "ready" ? { readiness: [] } : { ...base, readiness: ["ready"] });
    if (id === "onboarding") set(state.status.length === 1 && state.status[0] === "onboarding" ? { status: [] } : { ...base, status: ["onboarding"] });
    if (id === "attention") set(state.quick === "attention" ? { quick: null } : { ...base, quick: "attention" });
    if (id === "workingToday") set(state.quick === "working_today" ? { quick: null } : { ...base, quick: "working_today" });
  };
  const openWorker = (cleanerId: string) => set({ open: cleanerId }, state.open ? "replace" : "push");

  const actions = manager ? (
    <>
      <Button variant="outline" size="sm" onClick={() => setDialog("subcontractors")}>
        <Building2 aria-hidden />
        Subcontractors
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDialog("crews")}>
        <TeamIcon aria-hidden />
        Crews
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDialog("import")}>
        <Upload aria-hidden />
        Import
      </Button>
      <Button variant="primary" size="sm" onClick={() => setDialog("add")} className="max-sm:order-first">
        <Plus aria-hidden />
        Add cleaner
      </Button>
    </>
  ) : null;

  return (
    <>
      <PageHeader title="Cleaners" lead="Who is ready to work, who needs help getting there, and what stands in the way. Dispatch, Recruiter and Chat read these same records." actions={actions} />
      {data === undefined ? (
        <Loading />
      ) : (
        <div className="grid gap-5">
          <Overview counts={data.counts} state={state} onPick={pick} />
          <AttentionList items={data.attention} total={data.attentionTotal} timezone={company.timezone} onOpen={(cleanerId, section) => (section ? set({ open: cleanerId }, "push") : openWorker(cleanerId))} />

          <section aria-label="Directory" className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-auto font-heading text-lg tracking-tight text-strong">
                Directory <span className="text-sm font-normal text-muted-foreground">· {plural(data.counts.total, "person", "people")}</span>
              </h2>
              <div className="flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="View">
                <button type="button" aria-pressed={state.view === "cards"} onClick={() => set({ view: "cards" })} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", state.view === "cards" ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
                  <LayoutGrid className="size-4" aria-hidden />
                  Cards
                </button>
                <button type="button" aria-pressed={state.view === "table"} onClick={() => set({ view: "table" })} className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", state.view === "table" ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
                  <TableIcon className="size-4" aria-hidden />
                  Table
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-0 flex-1 basis-64">
                <span className="sr-only">Search cleaners</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  type="search"
                  value={state.q}
                  onChange={(event) => set({ q: event.target.value })}
                  placeholder="Search by name, phone, email, area, skill or company"
                  className="h-10 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30"
                />
              </label>
              <Button variant={filtersOpen || filterCount > 0 ? "secondary" : "outline"} onClick={() => setFiltersOpen((open) => !open)} aria-expanded={filtersOpen}>
                <FunnelIcon aria-hidden />
                Filters{filterCount > 0 ? ` · ${filterCount}` : ""}
              </Button>
              <Button variant={showWindow || state.window ? "secondary" : "outline"} onClick={() => setShowWindow((open) => !open)} aria-expanded={showWindow}>
                <CalendarIcon aria-hidden />
                Availability
              </Button>
            </div>
            {filtersOpen ? <FilterPanel data={data} state={state} set={set} /> : null}
            {showWindow || state.window ? <WindowPicker state={state} set={set} timezone={company.timezone} now={now} words={availability?.words ?? null} loading={Boolean(state.window) && availability === undefined} /> : null}
            <ActiveFilters data={data} state={state} set={set} />

            {data.rows.length === 0 && filterCount === 0 && !state.q ? (
              <Empty
                title="No cleaners yet"
                body="Add the people who do the work, or import a list. Each starts in onboarding; Dispatch offers work only once a person makes them active and their hours, areas and pay are set."
                action={
                  manager ? (
                    <div className="mt-2 flex flex-wrap justify-center gap-2">
                      <Button variant="primary" size="sm" onClick={() => setDialog("add")}>
                        <Plus aria-hidden /> Add cleaner
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDialog("import")}>
                        <Upload aria-hidden /> Import a list
                      </Button>
                    </div>
                  ) : null
                }
              />
            ) : rows.length === 0 ? (
              <Empty title="Nobody matches" body={state.window ? "Nobody fits every filter and is free in that window. Try a different time, or fewer filters." : "Nobody fits the search and filters. Try fewer filters or a different search."} action={<Button size="sm" variant="outline" onClick={() => set({ ...EMPTY_STATE, view: state.view })}>Clear search and filters</Button>} />
            ) : state.view === "cards" ? (
              <DirectoryCards rows={rows} onOpen={openWorker} availability={state.window ? (availability?.answers ?? null) : null} />
            ) : (
              <DirectoryTable rows={rows} onOpen={openWorker} availability={state.window ? (availability?.answers ?? null) : null} />
            )}
            {data.truncated ? <p className="text-xs text-muted-foreground">Showing the first 1,000 people. Narrow the list with search or filters.</p> : null}
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {rows.length === data.rows.length ? `Showing everyone (${rows.length}).` : `Showing ${rows.length} of ${data.rows.length}.`}
              {!includeEnded ? " People whose engagement ended are hidden; choose Ended under Filters to see them." : ""}
            </p>
          </section>
        </div>
      )}

      <WorkerDrawer cleanerId={state.open} onClose={() => set({ open: null })} />
      <AddCleaner open={dialog === "add"} onClose={() => setDialog(null)} subcontractors={data?.subcontractors ?? []} onAdded={(cleanerId) => set({ open: cleanerId }, "push")} />
      <ImportCleaners open={dialog === "import"} onClose={() => setDialog(null)} />
      <NewCrewDialog open={dialog === "crew"} onClose={() => setDialog("crews")} rows={data?.rows ?? []} />
      <CrewsDialog open={dialog === "crews"} onClose={() => setDialog(null)} onNew={() => setDialog("crew")} onFilter={(crewId) => { setDialog(null); set({ crew: [crewId] }); }} />
      <SubcontractorsDialog open={dialog === "subcontractors"} onClose={() => setDialog(null)} onFilter={(id) => { setDialog(null); set({ subcontractor: [id] }); }} />
    </>
  );
}

/** The Cleaners workspace. The address holds the list's state, so it is read on the client only. */
export function CleanersWorkspace() {
  return (
    <Boundary>
      <Suspense fallback={<Loading />}>
        <Inner />
      </Suspense>
    </Boundary>
  );
}
