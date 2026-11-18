"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { PageHeader, Panel } from "@/components/app/shell";
import { BuildingsIcon, FileText, HouseIcon, Plus } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import { Chip } from "./kit";

const QUOTE_TONE: Record<string, "neutral" | "brand" | "success" | "warning" | "danger"> = { saved: "brand", sent: "brand", accepted: "success", expired: "warning", superseded: "neutral", withdrawn: "neutral" };
const SEGMENT_WORD: Record<string, string> = { residential: "Residential", commercial: "Commercial", office: "Office", str: "Short-term rental" };

function shortDay(at: number) {
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function QuotesProposalsScreen() {
  const { companyId } = useCompany();
  const quotes = useQuery(api.sales.quotes, { companyId });
  const drafts = useQuery(api.sales.drafts, { companyId });
  const proposals = useQuery(api.proposals.list, { companyId });
  const [tab, setTab] = useState<"quotes" | "proposals" | "drafts">("quotes");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Quotes & Proposals"
        lead="Take a booking over the phone, save a quote, or prepare a commercial, office or short-term rental proposal."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/agents/sales/new?mode=proposal&segment=commercial&from=quotes">
                <BuildingsIcon aria-hidden className="size-4" /> Prepare proposal
              </Link>
            </Button>
            <Button asChild>
              <Link href="/app/agents/sales/new?mode=booking&from=quotes">
                <Plus aria-hidden className="size-4" /> Book service
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Link href="/app/agents/sales/new?mode=booking&from=quotes" className="group rounded-2xl border border-border bg-card p-4 hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
          <HouseIcon aria-hidden className="size-5 text-brand-600" />
          <p className="mt-2 font-medium text-strong">One-time visit</p>
          <p className="text-xs text-muted-foreground">Price it live, hold the time, send a payment link.</p>
        </Link>
        <Link href="/app/agents/sales/new?mode=booking&kind=recurring&from=quotes" className="group rounded-2xl border border-border bg-card p-4 hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
          <FileText aria-hidden className="size-5 text-brand-600" />
          <p className="mt-2 font-medium text-strong">Recurring service</p>
          <p className="text-xs text-muted-foreground">Cadence, first visit, calendar preview and billing.</p>
        </Link>
        <Link href="/app/agents/sales/new?mode=proposal&segment=office&from=quotes" className="group rounded-2xl border border-border bg-card p-4 hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500">
          <BuildingsIcon aria-hidden className="size-5 text-brand-600" />
          <p className="mt-2 font-medium text-strong">Commercial, office or STR proposal</p>
          <p className="text-xs text-muted-foreground">Sites, walkthroughs, rates and terms the client accepts online.</p>
        </Link>
      </div>
      <div role="tablist" aria-label="Show" className="mb-3 inline-flex rounded-xl border border-border bg-muted/60 p-1">
        {(["quotes", "proposals", "drafts"] as const).map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm ${tab === id ? "bg-card font-medium text-strong shadow-sm ring-1 ring-border" : "text-muted-foreground"}`}>
            {id === "quotes" ? "Quotes" : id === "proposals" ? "Proposals" : "Drafts in progress"}
          </button>
        ))}
      </div>
      {tab === "quotes" ? (
        <Panel flush>
          {quotes === undefined ? (
            <Skeleton className="m-4 h-32" />
          ) : quotes.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No quotes yet. Book service and choose Save quote.</p>
          ) : (
            <ul className="divide-y divide-border">
              {quotes.map((q) => (
                <li key={q._id}>
                  <Link href={`/app/agents/sales/book/${q.draftId}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-strong">{q.customer}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {q.service}
                        {q.cadence ? ` · ${q.cadence}` : ""} · by {q.by ?? "a team member"} {shortDay(q.createdAt)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-strong tabular-nums">{money(q.firstCents ?? q.totalCents)}</span>
                    <Chip tone={QUOTE_TONE[q.status] ?? "neutral"}>{q.status === "saved" ? `Held until ${shortDay(q.expiresAt)}` : q.status}</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      {tab === "proposals" ? (
        <Panel flush>
          {proposals === undefined ? (
            <Skeleton className="m-4 h-32" />
          ) : proposals.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No proposals yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {proposals.map((p) => (
                <li key={p._id}>
                  <Link href={p.draftId ? `/app/agents/sales/book/${p.draftId}` : `/app/agents/sales/proposals/${p._id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-strong">{p.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.customer} · {SEGMENT_WORD[p.template] ?? p.template} · {p.sites} site{p.sites === 1 ? "" : "s"}
                        {p.version ? ` · v${p.version}` : ""}
                      </p>
                    </div>
                    <Chip tone={p.status === "accepted" ? "success" : p.status === "changes_requested" || p.status === "expired" ? "warning" : p.status === "declined" ? "danger" : "brand"}>{p.statusWords}</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      {tab === "drafts" ? (
        <Panel flush>
          {drafts === undefined ? (
            <Skeleton className="m-4 h-32" />
          ) : drafts.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No drafts in progress.</p>
          ) : (
            <ul className="divide-y divide-border">
              {drafts.map((d) => (
                <li key={d._id}>
                  <Link href={`/app/agents/sales/book/${d._id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-strong">{d.customer ?? "Customer not chosen"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {d.mode === "booking" ? (d.bookingKind === "recurring" ? "Recurring booking" : "One-time booking") : `${SEGMENT_WORD[d.segment]} proposal`} · edited by {d.by ?? "a team member"} {shortDay(d.updatedAt)}
                      </p>
                    </div>
                    <Chip tone={d.status === "confirmed" ? "success" : d.status === "open" ? "neutral" : "brand"}>{d.status === "open" ? "Draft" : d.status.replace(/_/g, " ")}</Chip>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
