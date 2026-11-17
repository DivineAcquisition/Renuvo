"use client";

/**
 * The pipeline: every open opportunity by stage, as a board or a list. A stage says how far the
 * opportunity has come; the badge on a card says what is going on with it right now. Moving a card asks
 * the server, which checks the stage's entry condition: dragging to Won asks for the booking and is
 * refused, with the reasons, unless every requirement holds.
 *
 * The amount on a column is the total of the quotes in it. It is quoted value, not revenue.
 */
import { useMutation, useQuery } from "convex/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { messageOf, TextInput } from "@/components/app/form";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Kanban, LayoutList, Search, X } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { OpportunityDrawer } from "./drawer";
import { NewInquiryButton } from "./new-inquiry";
import { AttentionBadge, BOARD, Empty, NextStep, OpportunityCard, STAGE_LOOK, StageBadge, useOpportunityParam, type Card, type Stage } from "./shared";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "mine", label: "Needs you" },
  { id: "sales", label: "With Sales" },
  { id: "customer", label: "Waiting on customers" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const matches = (card: Card, filter: FilterId) =>
  filter === "all"
    ? true
    : filter === "mine"
      ? card.attention === "needs_review" || card.attention === "blocked" || card.attention === "taken_over" || card.nextAction?.by === "owner"
      : filter === "sales"
        ? card.nextAction?.by === "sales" && card.attention !== "needs_review" && card.attention !== "taken_over"
        : card.nextAction?.by === "customer";

/** Reads and writes the page's own address: the view, the stage, the filter and the search survive a reload and a shared link. */
function useAddress() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  return { params, set };
}

export function SalesPipelineScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const { params, set } = useAddress();
  const { openId, open, close } = useOpportunityParam();
  const view = params.get("view") === "list" ? "list" : "board";
  const stage = (params.get("stage") as Stage | null) ?? null;
  const filter = (FILTERS.find((row) => row.id === params.get("show"))?.id ?? "all") as FilterId;
  const closed = params.get("closed") === "1";
  const [search, setSearch] = useState(params.get("q") ?? "");
  const data = useQuery(api.sales.pipeline, { companyId, includeClosed: closed });
  const move = useMutation(api.sales.move);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [refusal, setRefusal] = useState<{ customer: string; to: string; blockers: string[] } | null>(null);

  const cards = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.cards ?? []).filter((card) => matches(card, filter) && (term === "" || card.customer.toLowerCase().includes(term) || (card.service ?? "").toLowerCase().includes(term)));
  }, [data, filter, search]);

  const columns: Stage[] = [...BOARD, "deferred", ...(closed ? (["closed_lost"] as Stage[]) : [])];
  const stageInfo = (id: Stage) => data?.stages.find((row) => row.stage === id);

  const drop = async (to: Stage) => {
    const card = data?.cards.find((row) => row.opportunityId === dragging);
    setDragging(null);
    setOver(null);
    if (!card || card.stage === to) return;
    // Closing and deferring need a reason or a date, which the opportunity itself asks for.
    if (to === "closed_lost" || to === "deferred") {
      setRefusal({ customer: card.customer, to: stageInfo(to)?.label ?? to, blockers: [to === "deferred" ? "Deferring needs a date to check back. Open the opportunity and use “Move to another stage”." : "Closing needs a reason. Open the opportunity and use “Move to another stage”."] });
      return;
    }
    try {
      const result = await move({ companyId, opportunityId: card.opportunityId as Id<"salesOpportunities">, to });
      setRefusal(result.ok ? null : { customer: card.customer, to: stageInfo(to)?.label ?? to, blockers: result.blockers });
    } catch (error) {
      setRefusal({ customer: card.customer, to: stageInfo(to)?.label ?? to, blockers: [messageOf(error)] });
    }
  };

  return (
    <>
      <PageHeader title="Pipeline" lead="Every request for service, by how far it has come. Each card shows who acts next and when." actions={<NewInquiryButton onCreated={open} />} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <TextInput
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              set({ q: event.target.value.trim() || null });
            }}
            placeholder="Search by name or service"
            aria-label="Search the pipeline"
            className="pl-9"
          />
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="Show">
          {FILTERS.map((row) => (
            <button key={row.id} type="button" aria-pressed={filter === row.id} onClick={() => set({ show: row.id === "all" ? null : row.id })} className={cn("min-h-8 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", filter === row.id ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
              {row.label}
            </button>
          ))}
        </div>
        <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={closed} onChange={(event) => set({ closed: event.target.checked ? "1" : null })} className="size-4 accent-[var(--color-brand-500)]" />
          Show closed
        </label>
        <div className="ml-auto inline-flex rounded-lg border border-border bg-card p-0.5" role="group" aria-label="View">
          {(["board", "list"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={view === value} onClick={() => set({ view: value === "board" ? null : value })} className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", view === value ? "bg-brand-500/10 text-strong" : "text-muted-foreground hover:text-strong")}>
              {value === "board" ? <Kanban className="size-3.5" aria-hidden /> : <LayoutList className="size-3.5" aria-hidden />}
              {value === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
      </div>

      {stage ? (
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          Showing {stageInfo(stage)?.label ?? stage} only.
          <button type="button" onClick={() => set({ stage: null })} className="inline-flex items-center gap-1 font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
            <X className="size-3.5" aria-hidden />
            Show every stage
          </button>
        </p>
      ) : null}

      {refusal ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm" role="alert">
          <div>
            <p className="font-semibold text-strong">
              {refusal.customer} was not moved to {refusal.to}
            </p>
            <ul className="mt-1 grid gap-0.5 text-warning-foreground">
              {refusal.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => setRefusal(null)} aria-label="Dismiss" className="rounded-md p-1 text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}

      {data === undefined ? (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6" aria-busy="true" aria-label="Loading the pipeline">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-64 rounded-2xl" />
          ))}
        </div>
      ) : data.cards.length === 0 ? (
        <Empty title="No inquiry yet" body="An inquiry arrives from a published booking form, a text to your business number, or one you add by hand. It appears here the moment it is filed, and Sales takes its first step." action={<NewInquiryButton onCreated={open} />} />
      ) : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0">
          <p className="sr-only">Drag a card to another stage to move it, or open it and use “Move to another stage”.</p>
          <ol className="flex snap-x gap-3">
            {columns
              .filter((id) => !stage || id === stage)
              .map((id) => {
                const info = stageInfo(id);
                const inColumn = cards.filter((card) => card.stage === id);
                const value = inColumn.reduce((sum, card) => sum + (card.quote?.totalCents ?? 0), 0);
                return (
                  <li
                    key={id}
                    onDragOver={(event) => {
                      if (!dragging) return;
                      event.preventDefault();
                      setOver(id);
                    }}
                    onDragLeave={() => setOver((current) => (current === id ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      void drop(id);
                    }}
                    className={cn("flex w-[17.5rem] shrink-0 snap-start flex-col rounded-2xl border bg-card transition-colors", stage ? "w-full max-w-xl" : "", over === id ? "border-brand-500 bg-brand-500/5" : "border-border")}
                  >
                    <header className="border-b border-border px-3.5 py-3" title={info?.entry}>
                      <p className="flex items-center justify-between gap-2 text-sm font-semibold text-strong">
                        <span className="flex items-center gap-2">
                          <span aria-hidden className={cn("size-2 rounded-full", STAGE_LOOK[id].dot)} />
                          {info?.label ?? id}
                        </span>
                        <span className="text-xs font-medium text-muted-foreground tabular-nums">{inColumn.length}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{value > 0 ? `${money(value)} quoted` : id === "new" || id === "qualifying" ? "Not quoted yet" : " "}</p>
                    </header>
                    <ul className="grid min-h-24 content-start gap-2 p-2.5">
                      {inColumn.length === 0 ? <li className="px-1 py-3 text-xs text-muted-foreground">{id === "won" ? "A card lands here when a job is created." : "Nothing here."}</li> : null}
                      {inColumn.map((card) => (
                        <li
                          key={card.opportunityId}
                          draggable={id !== "won" && id !== "closed_lost"}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "move";
                            setDragging(card.opportunityId);
                          }}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                          className={cn(dragging === card.opportunityId ? "opacity-50" : "")}
                        >
                          <OpportunityCard card={card} now={now} timezone={timezone} onOpen={open} dense />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
          </ol>
        </div>
      ) : (
        <ListView cards={cards.filter((card) => !stage || card.stage === stage)} now={now} timezone={timezone} onOpen={open} />
      )}
      <OpportunityDrawer opportunityId={openId} now={now} onClose={close} />
    </>
  );
}

function ListView({ cards, now, timezone, onOpen }: { cards: Card[]; now: number; timezone: string; onOpen: (id: string) => void }) {
  if (cards.length === 0) return <p className="rounded-2xl border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>;
  const sorted = [...cards].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-2.5 font-medium">Customer</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Stage</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Next step</th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">Quoted</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Last activity</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((card) => (
            <tr key={card.opportunityId} className="hover:bg-muted/40">
              <th scope="row" className="px-4 py-2.5 text-left font-normal">
                <button type="button" onClick={() => onOpen(card.opportunityId)} className="text-left font-semibold text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                  {card.customer}
                </button>
                <span className="block text-xs text-muted-foreground">
                  {card.service ?? card.kindWords} · {card.sourceWords}
                </span>
              </th>
              <td className="px-3 py-2.5 align-top">
                <span className="flex flex-wrap items-center gap-1.5">
                  <StageBadge stage={card.stage} words={card.stageWords} />
                  <AttentionBadge attention={card.attention} words={card.attentionWords} />
                </span>
              </td>
              <td className="max-w-xs px-3 py-2.5 align-top">{card.nextAction ? <NextStep next={card.nextAction} now={now} compact /> : <span className="text-xs text-muted-foreground">—</span>}</td>
              <td className="px-3 py-2.5 text-right align-top text-strong tabular-nums">{card.quote ? money(card.quote.totalCents) : "—"}</td>
              <td className="px-4 py-2.5 text-right align-top text-xs whitespace-nowrap text-muted-foreground">{ago(card.updatedAt, now, timezone)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
