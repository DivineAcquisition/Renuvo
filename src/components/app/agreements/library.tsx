"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { AgreementRow, Empty, Notice } from "@/components/app/agreements/shared";
import { SelectInput, TextInput } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY, SORTS, VIEW_HINT, WORKFLOW } from "@/lib/app/agreements";

import { api } from "../../../../convex/_generated/api";

export type Preset = "all" | "signatures" | "renewals" | "archive";

const VIEWS = ["drafts", "review", "signatures", "failed", "upcoming", "renewals", "missing"] as const;
type View = (typeof VIEWS)[number];

const PRESET: Record<Preset, { views?: readonly View[]; workflow?: string; archived?: boolean; empty: string; sort?: string }> = {
  all: { empty: "No agreements match. Clear a filter, or start one." },
  signatures: { views: ["signatures", "failed"], empty: "Nothing is out for signature.", sort: "updated" },
  renewals: { views: ["renewals", "upcoming"], empty: "No agreement is approaching renewal, expiry or a start date.", sort: "renewal" },
  archive: { archived: true, empty: "The archive is empty. Archived agreements are kept here, not deleted." },
};

const LIFECYCLES = ["not_started", "in_force", "renewal_due", "expired", "terminated", "superseded"] as const;

/**
 * The agreement library. All, Awaiting Signatures, Renewals & Changes and the Archive are this one list
 * with a different starting filter, so a filter, a sort or a search means the same thing everywhere.
 */
export function Library({ preset }: { preset: Preset }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const params = useSearchParams();
  const config = PRESET[preset];
  const view = (params.get("view") as View | null) ?? undefined;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(search);
  const [filters, setFilters] = useState({ category: "", docType: "", workflow: "", lifecycle: "", from: "", to: "" });
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>((config.sort as never) ?? "updated");
  const [offset, setOffset] = useState(0);
  const catalog = useQuery(api.companyAgreements.catalog, { companyId });
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const filterKey = JSON.stringify([debounced, filters, sort, view, preset]);
  const [seenKey, setSeenKey] = useState(filterKey);
  if (seenKey !== filterKey) {
    setSeenKey(filterKey);
    setOffset(0);
  }

  const args = useMemo(
    () => ({
      companyId,
      search: debounced || undefined,
      view: view && VIEWS.includes(view) ? view : undefined,
      category: (filters.category || undefined) as never,
      docType: filters.docType || undefined,
      workflow: (filters.workflow || undefined) as never,
      lifecycle: filters.lifecycle || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      archived: config.archived ?? false,
      sort,
      offset,
      limit: 20,
    }),
    [companyId, debounced, view, filters, config.archived, sort, offset],
  );
  const result = useQuery(api.companyAgreements.list, args);
  // A preset with several views (signatures and failures) shows the first; the others are one click away.
  const set = (key: keyof typeof filters) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  const active = Boolean(debounced || Object.values(filters).some(Boolean));

  return (
    <div className="grid gap-4">
      {config.views ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {config.views.map((name) => (
            <Button key={name} size="sm" variant={view === name || (!view && name === config.views![0]) ? "primary" : "secondary"} onClick={() => router.replace(`?view=${name}`)}>
              {name === "signatures" ? "Out for signature" : name === "failed" ? "Delivery failed" : name === "renewals" ? "Renewals & expiries" : "Starting soon"}
            </Button>
          ))}
        </div>
      ) : view ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-strong">{VIEW_HINT[view] ?? view}</span>
          <Button size="sm" variant="ghost" onClick={() => router.replace("?")}>
            Clear
          </Button>
        </div>
      ) : null}
      <div className="grid gap-2 rounded-2xl border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="sr-only" htmlFor="agreement-search">
            Search agreements
          </label>
          <TextInput id="agreement-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by title, type, person or property" />
        </div>
        <SelectInput aria-label="Category" value={filters.category} onChange={set("category")}>
          <option value="">Any category</option>
          {Object.entries(CATEGORY).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label="Document type" value={filters.docType} onChange={set("docType")}>
          <option value="">Any document type</option>
          {catalog?.types.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label="Workflow state" value={filters.workflow} onChange={set("workflow")}>
          <option value="">Any workflow state</option>
          {Object.entries(WORKFLOW).map(([key, look]) => (
            <option key={key} value={key}>
              {look.label}
            </option>
          ))}
        </SelectInput>
        <SelectInput aria-label="Effective status" value={filters.lifecycle} onChange={set("lifecycle")}>
          <option value="">Any effective status</option>
          {LIFECYCLES.map((key) => (
            <option key={key} value={key}>
              {key.replace(/_/g, " ")}
            </option>
          ))}
        </SelectInput>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Effective from
          <TextInput type="date" value={filters.from} onChange={set("from")} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Effective to
          <TextInput type="date" value={filters.to} onChange={set("to")} />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
          Sort by
          <SelectInput aria-label="Sort by" value={sort} onChange={(event) => setSort(event.target.value as never)}>
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </SelectInput>
        </label>
      </div>
      {!result ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : result.rows.length === 0 ? (
        <Empty title={active ? "Nothing matches" : "Nothing here"}>{active ? "No agreement matches those filters." : config.empty}</Empty>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <ul className="divide-y divide-border">
            {result.rows.map((row) => (
              <AgreementRow key={row.id} row={row} show={preset === "renewals" ? "renewal" : "dates"} />
            ))}
          </ul>
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
            <span>
              {offset + 1} to {offset + result.rows.length} of {result.total}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - result.limit))}>
                Previous
              </Button>
              <Button size="sm" variant="secondary" disabled={result.nextOffset === null} onClick={() => setOffset(result.nextOffset ?? offset)}>
                Next
              </Button>
            </span>
          </footer>
        </section>
      )}
      {result?.capped ? <Notice tone="warning">Showing from the 500 most recently changed agreements. Narrow the search to reach older ones.</Notice> : null}
    </div>
  );
}
