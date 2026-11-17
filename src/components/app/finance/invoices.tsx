"use client";

import { useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FileText, Plus, Search } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { moment, usd, type InvoiceStateId } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { FinanceNav } from "./finance-screen";
import { Amount, Empty, StateBadge } from "./kit";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "outstanding", label: "Outstanding" },
  { id: "overdue", label: "Overdue" },
  { id: "drafts", label: "Drafts" },
  { id: "paid", label: "Paid" },
  { id: "void", label: "Void" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

const EMPTY_WORDS: Record<Filter, string> = {
  all: "Invoices you create will be listed here.",
  outstanding: "No customer owes you anything on an issued invoice.",
  overdue: "Nothing is past due.",
  drafts: "No drafts waiting.",
  paid: "No invoices have been paid in full yet.",
  void: "No invoices have been voided.",
};

export function InvoicesTab({ nav }: { nav: FinanceNav & { set: (c: Record<string, string | null>, push?: boolean) => void } }) {
  const { companyId, timezone } = useCompany();
  const filter = (FILTERS.find((f) => f.id === nav.filter)?.id ?? "all") as Filter;
  const data = useQuery(api.finance.invoices, { companyId, filter });
  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.rows ?? []).filter((row) => !needle || row.customer.toLowerCase().includes(needle) || (row.number ?? "draft").toLowerCase().includes(needle));
  }, [data, search]);
  const owed = rows.filter((r) => r.balanceCents > 0 && r.state !== "draft").reduce((s, r) => s + r.balanceCents, 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Show invoices" className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:px-0">
          {FILTERS.map((f) => {
            const count = data?.counts[f.id];
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                onClick={() => nav.set({ filter: f.id === "all" ? null : f.id })}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
                  filter === f.id ? "border-brand-500/50 bg-brand-500/10 text-strong" : "border-border bg-card text-muted-foreground hover:text-strong",
                  f.id === "overdue" && count ? "data-[on=false]:text-destructive-foreground" : "",
                )}
                data-on={filter === f.id}
              >
                {f.label}
                {count !== undefined ? <span className="tabular-nums text-xs text-muted-foreground">{count}</span> : null}
              </button>
            );
          })}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search invoices</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer or invoice number" className="h-9 w-full rounded-lg border border-border bg-card pr-3 pl-9 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:outline-2 focus-visible:outline-brand-500/40" />
        </label>
      </div>

      {data && data.stripe.state !== "active" && data.stripe.state !== "not_available" ? (
        <p className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
          Customers can&apos;t pay by card until Stripe is set up. You can still issue invoices, share them, and record payments you receive.
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Invoices">
        {!data ? (
          <div className="grid gap-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty
            icon={FileText}
            title={search ? "No invoices match" : "No invoices here"}
            body={search ? "Try another name or number." : EMPTY_WORDS[filter]}
            action={filter === "all" && !search ? (
              <Button onClick={nav.newInvoice}>
                <Plus aria-hidden />
                New invoice
              </Button>
            ) : undefined}
          />
        ) : (
          <>
            {/* Desk: a table. Phone: one card per invoice, the same facts in the same order. */}
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-2.5 font-medium">Invoice</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Customer</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Due</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => nav.openInvoice(row.id)}>
                    <td className="px-5 py-3">
                      <button type="button" onClick={(e) => (e.stopPropagation(), nav.openInvoice(row.id))} className="font-medium text-strong tabular-nums underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                        {row.number ?? "Draft"}
                      </button>
                      {row.hasDeposit ? <span className="ml-2 text-xs text-muted-foreground">with deposit</span> : null}
                    </td>
                    <td className="max-w-56 truncate px-3 py-3 text-strong">{row.customer}</td>
                    <td className="px-3 py-3">
                      <StateBadge state={row.state as InvoiceStateId} words={row.stateWords} />
                    </td>
                    <td className={cn("px-3 py-3 tabular-nums", row.state === "overdue" ? "font-medium text-destructive-foreground" : "text-muted-foreground")}>{row.dueAt ? moment(row.dueAt, timezone) : "—"}</td>
                    <td className="px-3 py-3 text-right">
                      <Amount cents={row.totalCents} muted />
                    </td>
                    <td className="px-5 py-3 text-right">
                      {row.state === "draft" || row.state === "void" ? <span className="text-muted-foreground">—</span> : <Amount cents={row.balanceCents} className="font-medium" />}
                      {row.processingCents ? <span className="block text-xs text-muted-foreground">{usd(row.processingCents)} processing</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden">
              {rows.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => nav.openInvoice(row.id)} className="grid w-full gap-1.5 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-strong">{row.customer}</span>
                      {row.state === "draft" || row.state === "void" ? <Amount cents={row.totalCents} muted className="text-sm" /> : <Amount cents={row.balanceCents} className="text-sm font-semibold" />}
                    </span>
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {row.number ?? "Draft"}
                        {row.dueAt ? ` · due ${moment(row.dueAt, timezone)}` : ""}
                      </span>
                      <StateBadge state={row.state as InvoiceStateId} words={row.stateWords} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {owed > 0 ? (
              <p className="flex justify-between border-t border-border bg-muted/30 px-4 py-2.5 text-sm sm:px-5">
                <span className="text-muted-foreground">Still owed on these {rows.length === 1 ? "invoice" : "invoices"}</span>
                <Amount cents={owed} className="font-semibold" />
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
