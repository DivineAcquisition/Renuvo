"use client";

/**
 * Clients & Properties: one directory of the company's clients, with focused views over the same records.
 * Search, filters, sort and paging happen on the server; the view, filters and an open quick view live in
 * the address, and coming back from a profile returns to the same place on the page.
 */
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, SelectInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { NewVisitForm } from "@/components/app/screens/forms";
import { FunnelIcon, Plus, Search, X } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CADENCE_LABELS, clientPath, propertyPath, RESIDENTIAL_VIEWS, VIEWS, type DirectoryView } from "@/lib/app/clients";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AddClientForm } from "./add-client";
import { CategoryChips, ClientMark, day, EmptyState, RelationshipBadge, StaffingLine } from "./bits";
import { ClientQuickView } from "./quick-view";
import { ActionMenu } from "./menu";
import { rememberScroll, takeScroll, useDirectoryState, viewOf, type DirectoryState } from "./state";

type Overview = FunctionReturnType<typeof api.clients.overview>;
type Row = FunctionReturnType<typeof api.clients.directory>["page"][number];
type Attention = "followup" | "setup" | "schedule" | "issues";

const SORTS = [
  { id: "name", label: "Name, A to Z" },
  { id: "name_desc", label: "Name, Z to A" },
  { id: "newest", label: "Newest first" },
  { id: "updated", label: "Recently updated" },
] as const;

const RELATIONSHIPS = [
  { id: "current", label: "Current clients (active or paused)" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "former", label: "Former" },
] as const;

function relationshipArg(state: DirectoryState, view: DirectoryView): "current" | "active" | "paused" | "former" | undefined {
  if (view === "prospects" || view === "archived") return undefined;
  const value = state.rel;
  return value === "active" || value === "paused" || value === "former" || value === "current" ? value : "current";
}

export function ClientsScreen() {
  const { companyId } = useCompany();
  const [state, update] = useDirectoryState();
  const view = viewOf(state);
  const overview = useQuery(api.clients.overview, { companyId });
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState<{ customerId?: string; propertyId?: string } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const router = useRouter();
  const residential = view.startsWith("residential");
  const top = residential ? "residential" : view;
  const filtersOn = [state.rel && state.rel !== "current", state.owner, view === "prospects" || view === "archived"].filter(Boolean).length;
  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl tracking-tight text-strong">Clients &amp; Properties</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Every client, their properties and the services they have. Sales, Dispatch, Retention, Agreements and Finance all read these same records.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ActionMenu
            label="Create a booking or proposal"
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium text-strong hover:bg-muted"
            trigger={<span className="flex items-center gap-1.5">Create booking or proposal</span>}
            actions={[
              { label: "Book a visit now", onSelect: () => setBooking({}) },
              { label: "Booking in Sales (quote, payment, agreement)", href: "/app/agents/sales/new?mode=booking" },
              { label: "Proposal in Sales", href: "/app/agents/sales/new?mode=proposal" },
              { label: "Agreement only", href: "/app/agreements/new?mode=selestial" },
            ]}
          />
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add client
          </Button>
        </div>
      </header>

      {overview?.needsPrepare ? <PrepareDirectory /> : null}
      <AttentionStrip overview={overview} active={state.attention as Attention | undefined} onPick={(attention) => update({ attention: state.attention === attention ? undefined : attention, view: attention ? "all" : state.view })} />

      <section aria-label="Client directory" className="rounded-2xl border border-border bg-card">
        <div className="grid gap-3 border-b border-border p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={state.q ?? ""} onChange={(q) => update({ q: q || undefined })} />
            <Button variant="outline" size="sm" onClick={() => setFiltersOpen(true)} aria-haspopup="dialog">
              <FunnelIcon aria-hidden /> Filters{filtersOn ? ` (${filtersOn})` : ""}
            </Button>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span className="sr-only sm:not-sr-only">Sort</span>
              <SelectInput aria-label="Sort" className="min-h-9 w-auto py-1.5" value={state.sort ?? "name"} onChange={(event) => update({ sort: event.target.value === "name" ? undefined : event.target.value })} disabled={Boolean(state.q)}>
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </SelectInput>
            </label>
          </div>
          <nav aria-label="Views" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
            {VIEWS.map((v) => {
              const count = overview?.counts[v.id as keyof Overview["counts"]];
              const on = top === v.id && view !== "prospects" && view !== "archived";
              return (
                <button key={v.id} type="button" aria-pressed={on} title={v.detail} onClick={() => update({ view: v.id === "all" ? undefined : v.id, attention: undefined })} className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/50", on ? "bg-brand-500/10 text-brand-300" : "text-muted-foreground hover:bg-muted hover:text-strong")}>
                  {v.label}
                  {count !== undefined ? <span className="tabular-nums text-xs opacity-80">{count > (overview?.cap ?? 999) ? `${overview?.cap}+` : count}</span> : null}
                </button>
              );
            })}
          </nav>
          {residential ? (
            <div role="group" aria-label="Residential clients" className="flex flex-wrap items-center gap-1.5">
              {RESIDENTIAL_VIEWS.map((v) => {
                const count = overview?.counts[v.id as keyof Overview["counts"]];
                return (
                  <button key={v.id} type="button" aria-pressed={view === v.id} title={"detail" in v ? v.detail : undefined} onClick={() => update({ view: v.id })} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", view === v.id ? "border-brand-500 bg-brand-500/[0.08] text-strong" : "border-border text-muted-foreground hover:border-brand-500/40")}>
                    {v.label}
                    {count !== undefined ? <span className="ml-1 tabular-nums opacity-70">{count}</span> : null}
                  </button>
                );
              })}
              <span className="text-xs text-muted-foreground">A client can be both recurring and one-time.</span>
            </div>
          ) : null}
          <ActiveFilters state={state} view={view} overview={overview} onClear={(next) => update(next)} />
        </div>
        <DirectoryTable key={`${view}|${state.q ?? ""}|${state.rel ?? ""}|${state.owner ?? ""}|${state.attention ?? ""}|${state.sort ?? ""}`} state={state} view={view} canManage={overview?.canManage ?? false} owners={overview?.owners ?? []} onQuickView={(customerId) => update({ client: customerId }, "push")} onBook={(customerId, propertyId) => setBooking({ customerId, propertyId })} onAdd={() => setAdding(true)} />
      </section>

      <ClientQuickView customerId={state.client ?? null} tab={state.tab} onClose={() => update({ client: undefined, tab: undefined })} onTab={(tab) => update({ tab: tab === "overview" ? undefined : tab })} />
      <FiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} state={state} view={view} overview={overview} onApply={(next) => update(next)} />
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a client" description="Who they are, how to reach them and, if you know it, the first property.">
        <AddClientForm onDone={() => setAdding(false)} onCreated={(id) => router.push(clientPath(id))} />
      </Modal>
      <Modal open={booking !== null} onClose={() => setBooking(null)} title="Book a visit" description="Priced from Services & Pricing. Dispatch starts staffing it once it is booked.">
        <NewVisitForm initial={booking ?? undefined} onDone={() => setBooking(null)} />
      </Modal>
    </div>
  );
}

/** Builds the directory once for clients added before it existed. Runs a batch at a time until done. */
function PrepareDirectory() {
  const { companyId } = useCompany();
  const prepare = useMutation(api.clients.prepareDirectory);
  const started = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        for (let i = 0; i < 100; i++) if ((await prepare({ companyId })).done) return;
      } catch {
        setProblem("The directory could not be prepared. Reload to try again.");
      }
    })();
  }, [companyId, prepare]);
  return (
    <p role="status" className="rounded-xl border border-brand-500/25 bg-brand-500/[0.05] px-3.5 py-2.5 text-sm text-strong">
      {problem ?? "Adding your existing clients to the directory…"}
    </p>
  );
}

function AttentionStrip({ overview, active, onPick }: { overview: Overview | undefined; active: Attention | undefined; onPick: (kind: Attention | undefined) => void }) {
  if (!overview) return <Skeleton className="h-11 rounded-xl" />;
  const items = overview.attention.filter((item) => item.count > 0);
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing in the directory needs attention right now.</p>;
  return (
    <div role="group" aria-label="Needs attention" className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Needs attention</span>
      {items.map((item) => (
        <button key={item.kind} type="button" aria-pressed={active === item.kind} title={item.detail} onClick={() => onPick(item.kind as Attention)} className={cn("flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/50", active === item.kind ? "border-warning bg-warning/15 text-strong" : "border-warning/40 bg-warning/[0.07] text-strong hover:bg-warning/15")}>
          <span className="font-semibold tabular-nums">{item.count}</span>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }
  useEffect(() => {
    if (text === value) return;
    const timer = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, value, onChange]);
  return (
    <div className="relative min-w-[14rem] flex-1">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input type="search" aria-label="Search clients" placeholder="Search name, contact, phone, email, address" value={text} onChange={(event) => setText(event.target.value)} className="block min-h-10 w-full rounded-lg border border-border bg-background py-2 pr-3 pl-9 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30" />
    </div>
  );
}

function ActiveFilters({ state, view, overview, onClear }: { state: DirectoryState; view: DirectoryView; overview: Overview | undefined; onClear: (next: Partial<DirectoryState>) => void }) {
  const chips: { label: string; clear: Partial<DirectoryState> }[] = [];
  if (view === "prospects") chips.push({ label: "Prospects", clear: { view: undefined } });
  if (view === "archived") chips.push({ label: "Archived", clear: { view: undefined } });
  if (state.rel && state.rel !== "current" && view !== "prospects" && view !== "archived") chips.push({ label: RELATIONSHIPS.find((r) => r.id === state.rel)?.label ?? state.rel, clear: { rel: undefined } });
  if (state.owner) chips.push({ label: state.owner === "none" ? "No account owner" : `Owner: ${overview?.owners.find((o) => o.id === state.owner)?.name ?? "a team member"}`, clear: { owner: undefined } });
  if (state.attention) chips.push({ label: overview?.attention.find((a) => a.kind === state.attention)?.label ?? "Needs attention", clear: { attention: undefined } });
  if (state.q) chips.push({ label: `"${state.q}"`, clear: { q: undefined } });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters in use">
      {chips.map((chip) => (
        <button key={chip.label} type="button" onClick={() => onClear(chip.clear)} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-strong hover:bg-muted/70">
          {chip.label}
          <X aria-hidden className="size-3" />
          <span className="sr-only">Remove this filter</span>
        </button>
      ))}
      {chips.length > 1 ? (
        <button type="button" onClick={() => onClear({ view: undefined, rel: undefined, owner: undefined, attention: undefined, q: undefined })} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">
          Clear all
        </button>
      ) : null}
    </div>
  );
}

function FiltersDrawer({ open, onClose, state, view, overview, onApply }: { open: boolean; onClose: () => void; state: DirectoryState; view: DirectoryView; overview: Overview | undefined; onApply: (next: Partial<DirectoryState>) => void }) {
  const show = view === "prospects" ? "prospects" : view === "archived" ? "archived" : "clients";
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="w-full max-w-sm bg-background">
        <div className="grid gap-5 overflow-y-auto p-5">
          <SheetTitle className="font-heading text-lg text-strong">Filters</SheetTitle>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-strong">Show</legend>
            {(
              [
                { id: "clients", label: "Clients", detail: "The views above." },
                { id: "prospects", label: "Prospects", detail: "Not clients yet. They become clients when a visit is booked or someone marks them." },
                { id: "archived", label: "Archived", detail: "Kept with their history; can be restored." },
              ] as const
            ).map((option) => (
              <label key={option.id} className={cn("cursor-pointer rounded-xl border px-3 py-2 text-sm", show === option.id ? "border-brand-500 bg-brand-500/[0.06]" : "border-border")}>
                <input type="radio" name="show" className="sr-only" checked={show === option.id} onChange={() => onApply({ view: option.id === "clients" ? undefined : option.id, rel: undefined, attention: undefined })} />
                <span className="block font-medium text-strong">
                  {option.label}
                  {option.id !== "clients" ? <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{overview?.counts[option.id] ?? ""}</span> : null}
                </span>
                <span className="block text-xs text-muted-foreground">{option.detail}</span>
              </label>
            ))}
          </fieldset>
          {show === "clients" ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-strong">Relationship</span>
              <SelectInput value={relationshipArg(state, view) ?? "current"} onChange={(event) => onApply({ rel: event.target.value === "current" ? undefined : event.target.value })}>
                {RELATIONSHIPS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </SelectInput>
            </label>
          ) : null}
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Account owner</span>
            <SelectInput value={state.owner ?? ""} onChange={(event) => onApply({ owner: event.target.value || undefined })}>
              <option value="">Anyone</option>
              <option value="none">No account owner</option>
              {overview?.owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </SelectInput>
          </label>
          <p className="text-xs text-muted-foreground">Filters are in the page address, so a filtered list can be bookmarked or shared with your team.</p>
          <Button variant="primary" onClick={onClose}>
            Show results
          </Button>
        </div>
      </SheetPopup>
    </Sheet>
  );
}

function DirectoryTable({ state, view, canManage, owners, onQuickView, onBook, onAdd }: { state: DirectoryState; view: DirectoryView; canManage: boolean; owners: Overview["owners"]; onQuickView: (customerId: string) => void; onBook: (customerId: string, propertyId?: string) => void; onAdd: () => void }) {
  const { companyId, timezone } = useCompany();
  const args = {
    companyId,
    view,
    ...(state.q ? { q: state.q } : {}),
    ...(relationshipArg(state, view) ? { relationship: relationshipArg(state, view)! } : {}),
    ...(state.owner ? { ownerId: state.owner as Id<"members"> | "none" } : {}),
    ...(state.attention ? { attention: state.attention as Attention } : {}),
    ...(state.sort && !state.q ? { sort: state.sort as "name" } : {}),
  };
  const paged = usePaginatedQuery(api.clients.directory, args, { initialNumItems: 25 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || paged.status === "LoadingFirstPage") return;
    restored.current = true;
    const y = takeScroll();
    if (y !== null) window.scrollTo({ top: y });
  }, [paged.status]);
  if (paged.status === "LoadingFirstPage") {
    return (
      <div className="grid gap-2 p-4" aria-busy="true" aria-label="Loading clients">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
  }
  const rows = paged.results;
  if (!rows.length) {
    const filtered = Boolean(state.q || state.owner || state.attention || (state.rel && state.rel !== "current"));
    return (
      <div className="p-4">
        {filtered ? (
          <EmptyState title="No clients match">Try fewer words or clear a filter. Search covers names, contacts, emails, phones and addresses.</EmptyState>
        ) : view === "prospects" ? (
          <EmptyState title="No prospects">A lead from Google, or a client you add as a prospect, waits here until a visit is booked.</EmptyState>
        ) : view === "archived" ? (
          <EmptyState title="Nothing archived">Archived clients keep their history and can be restored.</EmptyState>
        ) : view === "all" ? (
          <EmptyState
            title="No clients yet"
            action={
              <Button variant="primary" onClick={onAdd}>
                <Plus aria-hidden /> Add your first client
              </Button>
            }
          >
            Add a client with their first property, then book a visit or set up a recurring plan.
          </EmptyState>
        ) : (
          <EmptyState title="No clients in this view">{VIEWS.find((v) => v.id === view)?.detail ?? RESIDENTIAL_VIEWS.find((v) => v.id === view && "detail" in v)?.label}</EmptyState>
        )}
      </div>
    );
  }
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const open = () => rememberScroll();
  return (
    <div>
      {canManage && selected.size ? <BulkBar rows={rows.filter((r) => selected.has(r.customerId))} owners={owners} onDone={() => setSelected(new Set())} /> : null}
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">Clients in this view</caption>
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            {canManage ? (
              <th scope="col" className="w-10 py-2 pl-4">
                <input type="checkbox" aria-label="Select every client shown" checked={rows.length > 0 && rows.every((r) => selected.has(r.customerId))} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((r) => r.customerId)) : new Set())} className="size-4 accent-brand-500" />
              </th>
            ) : null}
            <th scope="col" className={cn("py-2 font-medium", canManage ? "pl-2" : "pl-4")}>
              Client
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {view === "str" ? "Rentals" : view === "office" ? "Locations" : view === "commercial" ? "Sites" : "Properties"}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {view === "residential_one_time" ? "Latest service" : view === "residential_recurring" ? "Plan" : "Services"}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              {view === "str" ? "Next turnover" : "Next service"}
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Attention
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Relationship
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Owner
            </th>
            <th scope="col" className="w-10 py-2 pr-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.customerId} className="group align-top transition-colors hover:bg-muted/30">
              {canManage ? (
                <td className="py-3 pl-4">
                  <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.customerId)} onChange={() => toggle(row.customerId)} className="mt-1 size-4 accent-brand-500" />
                </td>
              ) : null}
              <td className={cn("py-3", canManage ? "pl-2" : "pl-4")}>
                <div className="flex items-start gap-3">
                  <ClientMark name={row.name} type={row.type} size="sm" />
                  <div className="min-w-0">
                    <Link href={clientPath(row.customerId)} onClick={open} className="font-medium text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500/50">
                      {row.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{row.primaryContact ? [row.type === "business" && row.primaryContact.name !== row.name ? row.primaryContact.name : null, row.primaryContact.phone ?? row.primaryContact.email].filter(Boolean).join(" · ") : "No contact details"}</p>
                    {view === "all" ? (
                      <div className="mt-1">
                        <CategoryChips labels={row.categories} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </td>
              <td className="px-2 py-3">
                <PropertiesCell row={row} view={view} />
              </td>
              <td className="px-2 py-3">
                <ServicesCell row={row} view={view} timezone={timezone} />
              </td>
              <td className="px-2 py-3">
                {row.nextVisit ? (
                  <div className="grid gap-0.5">
                    <span className="text-strong">{day(row.nextVisit.startsAt, timezone)}</span>
                    <span className="text-xs text-muted-foreground">{row.nextVisit.service}</span>
                    <StaffingCompact staffing={row.nextVisit.staffing} />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Nothing booked</span>
                )}
              </td>
              <td className="max-w-[14rem] px-2 py-3">{row.attention ? <span className="text-sm text-warning-foreground">{row.attention.text}</span> : <span className="text-xs text-muted-foreground">—</span>}</td>
              <td className="px-2 py-3">
                <RelationshipBadge relationship={row.relationship} />
              </td>
              <td className="px-2 py-3 text-sm whitespace-nowrap">{row.owner ? row.owner.name : <span className="text-xs text-muted-foreground">Unassigned</span>}</td>
              <td className="py-3 pr-3 text-right">
                <ActionMenu
                  label={`More for ${row.name}`}
                  actions={[
                    { label: "Quick view", onSelect: () => onQuickView(row.customerId) },
                    { label: "Open the full profile", href: clientPath(row.customerId) },
                    { label: "Book a visit", onSelect: () => onBook(row.customerId, row.properties.main?.id) },
                    ...(row.properties.main ? [{ label: `Open ${row.properties.main.name}`, href: propertyPath(row.customerId, row.properties.main.id) }] : []),
                  ]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden" aria-label="Clients in this view">
        {rows.map((row) => (
          <li key={row.customerId} className="flex items-start gap-3 px-4 py-3">
            {canManage ? <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.customerId)} onChange={() => toggle(row.customerId)} className="mt-2.5 size-4 accent-brand-500" /> : null}
            <button type="button" onClick={() => onQuickView(row.customerId)} className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500/50">
              <ClientMark name={row.name} type={row.type} size="sm" />
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-strong">{row.name}</span>
                  <RelationshipBadge relationship={row.relationship} />
                </span>
                <span className="truncate text-xs text-muted-foreground">{row.properties.main ? `${row.properties.main.name}${row.properties.count > 1 ? ` + ${row.properties.count - 1} more` : ""}` : "No property yet"}</span>
                <span className="text-xs text-strong">{row.nextVisit ? `Next: ${day(row.nextVisit.startsAt, timezone)} · ${row.nextVisit.service}` : "Nothing booked"}</span>
                {row.attention ? <span className="text-xs text-warning-foreground">{row.attention.text}</span> : null}
              </span>
            </button>
            <ActionMenu label={`More for ${row.name}`} actions={[{ label: "Open the full profile", href: clientPath(row.customerId) }, { label: "Book a visit", onSelect: () => onBook(row.customerId, row.properties.main?.id) }]} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
        <span aria-live="polite">
          Showing {rows.length} client{rows.length === 1 ? "" : "s"}
          {paged.status === "Exhausted" ? "" : " so far"}
        </span>
        {paged.status === "CanLoadMore" || paged.status === "LoadingMore" ? (
          <Button variant="outline" size="sm" loading={paged.status === "LoadingMore"} onClick={() => paged.loadMore(25)}>
            Show more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function StaffingCompact({ staffing }: { staffing: Row["nextVisit"] extends infer V ? (V extends { staffing: infer S } ? S : null) : null }) {
  if (!staffing?.words) return null;
  return <StaffingLine staffing={staffing} compact />;
}

function PropertiesCell({ row, view }: { row: Row; view: DirectoryView }) {
  const p = row.properties;
  if (!p.main) return <span className="text-xs text-warning-foreground">No property yet</span>;
  const noun = view === "str" ? "rental" : view === "office" ? "location" : view === "commercial" ? "site" : "property";
  const count = view === "all" || view.startsWith("residential") ? p.count : p.relevant;
  const d = p.main.details;
  const facts = view === "str" && d ? [d.beds ? `${d.beds} beds` : null, d.laundry === "on_site" ? "laundry on site" : d.laundry === "off_site" ? "laundry off site" : null].filter(Boolean).join(" · ") : view.startsWith("residential") && d ? [d.bedrooms ? `${d.bedrooms} bd` : null, d.bathrooms ? `${d.bathrooms} ba` : null].filter(Boolean).join(" · ") : "";
  return (
    <div className="grid gap-0.5">
      <span className="text-strong">{p.main.name}</span>
      <span className="text-xs text-muted-foreground">
        {p.main.city}
        {count > 1 ? ` · ${count} ${noun === "property" ? "properties" : `${noun}s`}` : ""}
        {facts ? ` · ${facts}` : ""}
      </span>
    </div>
  );
}

function ServicesCell({ row, view, timezone }: { row: Row; view: DirectoryView; timezone: string }) {
  if (view === "residential_one_time") return row.lastVisit ? <span className="grid gap-0.5"><span className="text-strong">{row.lastVisit.service}</span><span className="text-xs text-muted-foreground">{day(row.lastVisit.startsAt, timezone)}</span></span> : <span className="text-xs text-muted-foreground">No visit yet</span>;
  const recurring = row.plans.filter((p) => p.kind === "recurring");
  const standing = row.plans.filter((p) => p.kind === "standing");
  return (
    <div className="grid gap-0.5">
      {row.services.length ? <span className="text-strong">{row.services.slice(0, 2).join(", ")}{row.services.length > 2 ? ` +${row.services.length - 2}` : ""}</span> : <span className="text-xs text-muted-foreground">None yet</span>}
      {recurring.length ? <span className="text-xs text-muted-foreground">{recurring.map((p) => `${p.cadence ? CADENCE_LABELS[p.cadence] : "Recurring"}${p.state === "paused" ? " · paused" : p.state === "setup" ? " · being set up" : ""}`).join("; ")}</span> : null}
      {standing.length ? <span className="text-xs text-muted-foreground">Standing arrangement{standing.length > 1 ? `s (${standing.length})` : ""}</span> : null}
    </div>
  );
}

/** Assigns an account owner to the selected clients, after showing exactly which clients change. */
function BulkBar({ rows, owners, onDone }: { rows: Row[]; owners: Overview["owners"]; onDone: () => void }) {
  const { companyId } = useCompany();
  const assign = useMutation(api.clients.assignOwner);
  const { busy, error, run } = useRun();
  const [owner, setOwner] = useState("");
  const [confirming, setConfirming] = useState(false);
  const target = owner === "none" ? "no account owner" : (owners.find((o) => o.id === owner)?.name ?? "");
  return (
    <div role="region" aria-label="Selected clients" className="grid gap-2 border-b border-border bg-brand-500/[0.04] px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-strong">{rows.length} selected</span>
        <SelectInput aria-label="Account owner to assign" className="min-h-9 w-auto py-1.5" value={owner} onChange={(event) => (setOwner(event.target.value), setConfirming(false))}>
          <option value="">Assign an account owner…</option>
          <option value="none">No account owner</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </SelectInput>
        <Button size="sm" variant="secondary" disabled={!owner} onClick={() => setConfirming(true)}>
          Review
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Clear
        </Button>
      </div>
      {confirming && owner ? (
        <div className="grid gap-2 rounded-xl border border-border bg-card p-3">
          <p className="text-strong">
            These {rows.length} client{rows.length === 1 ? "" : "s"} will have {target === "no account owner" ? "no account owner" : `${target} as account owner`}. Nothing is sent to anyone.
          </p>
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {rows.map((r) => (
              <li key={r.customerId}>
                {r.name}: {r.owner?.name ?? "unassigned"} → {target === "no account owner" ? "unassigned" : target}
              </li>
            ))}
          </ul>
          <FormError message={error} />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void run(async () => (await assign({ companyId, customerIds: rows.map((r) => r.customerId), accountOwnerId: owner === "none" ? null : (owner as Id<"members">) }), onDone()))}>
              Assign to {rows.length}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
