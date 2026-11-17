"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

import { useCompany } from "@/components/app/company";
import { PageHeader } from "@/components/app/shell";
import { Plus, Settings } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FINANCE_PATH, FINANCE_TABS, PERIODS, type FinanceTab, type PeriodId } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import type { Id } from "../../../../convex/_generated/dataModel";
import { ExpenseSheet, ExpensesTab } from "./expenses";
import { InvoiceSheet } from "./invoice-sheet";
import { InvoicesTab } from "./invoices";
import { ReviewSheet } from "./messages";
import { NewInvoiceDialog } from "./new-invoice";
import { OverviewTab } from "./overview";
import { StatementSheet } from "./statement";
import { CleanerSheet, EarningSheet, TeamPayTab } from "./team-pay";

/**
 * Company → Finance. The cleaning company's own money: invoices, payments, balances, team pay and
 * expenses now; profitability as it is built. Not Selestial's subscription (Settings › Plan & Usage).
 *
 * Which tab, filter and drawer are open lives in the address, so a link reopens the same view and the
 * browser's back button closes a drawer.
 */
export function FinanceScreen() {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem] rounded-2xl" />}>
      <Finance />
    </Suspense>
  );
}

export type FinanceNav = {
  tab: FinanceTab;
  period: PeriodId;
  filter: string | null;
  openInvoice: (id: Id<"invoices">) => void;
  openStatement: (id: Id<"customers">) => void;
  showInvoices: (filter?: string) => void;
  showTeamPay: (filter?: string) => void;
  showExpenses: (filter?: string) => void;
  newInvoice: () => void;
};

export function useFinanceNav(): FinanceNav & { params: URLSearchParams; set: (changes: Record<string, string | null>, push?: boolean) => void } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = useCallback(
    (changes: Record<string, string | null>, push = false) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const url = `${pathname}${next.size ? `?${next}` : ""}`;
      if (push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, pathname, router],
  );
  const tabParam = params.get("tab");
  const tab = (FINANCE_TABS.find((t) => t.id === tabParam && t.built)?.id ?? "overview") as FinanceTab;
  const periodParam = params.get("period");
  const period = (PERIODS.find((p) => p.id === periodParam)?.id ?? "this_month") as PeriodId;
  return {
    params,
    set,
    tab,
    period,
    filter: params.get("filter"),
    openInvoice: (id) => set({ invoice: id, customer: null }, true),
    openStatement: (id) => set({ customer: id, invoice: null }, true),
    showInvoices: (filter) => set({ tab: "invoices", filter: filter ?? null, invoice: null }, true),
    showTeamPay: (filter) => set({ tab: "team-pay", filter: filter ?? null, invoice: null }, true),
    showExpenses: (filter) => set({ tab: "expenses", filter: filter ?? null, invoice: null }, true),
    newInvoice: () => set({ new: "1" }, true),
  };
}

function Finance() {
  const { role } = useCompany();
  const nav = useFinanceNav();
  if (role !== "owner") {
    return (
      <>
        <PageHeader title="Finance" />
        <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
          <p className="text-base font-semibold text-strong">Finance is for the Owner</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">Invoices, payments and balances are kept to the company&apos;s Owner. Ask them if you need something from here.</p>
        </div>
      </>
    );
  }
  const invoiceId = nav.params.get("invoice") as Id<"invoices"> | null;
  const customerId = nav.params.get("customer") as Id<"customers"> | null;
  const earningId = nav.params.get("earning") as Id<"earnings"> | null;
  const cleanerId = nav.params.get("cleaner") as Id<"cleaners"> | null;
  const expenseId = nav.params.get("expense") as Id<"expenses"> | null;
  return (
    <>
      <PageHeader
        title="Finance"
        lead="What you earned, what you're owed, and what's waiting on you. Your company's money, kept apart from your Selestial plan."
        actions={
          <>
            <Link href={`${FINANCE_PATH}/setup`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
              <Settings className="size-4" aria-hidden />
              Payments setup
            </Link>
            <Button variant="default" onClick={nav.newInvoice}>
              <Plus aria-hidden />
              New invoice
            </Button>
          </>
        }
      />
      <Tabs active={nav.tab} onPick={(tab) => nav.set({ tab: tab === "overview" ? null : tab, filter: null }, true)} />
      <div className="mt-5">{nav.tab === "invoices" ? <InvoicesTab nav={nav} /> : nav.tab === "team-pay" ? <TeamPayTab nav={nav} /> : nav.tab === "expenses" ? <ExpensesTab nav={nav} /> : <OverviewTab nav={nav} />}</div>
      <InvoiceSheet invoiceId={invoiceId} onClose={() => nav.set({ invoice: null })} onOpenStatement={nav.openStatement} />
      <StatementSheet customerId={invoiceId ? null : customerId} onClose={() => nav.set({ customer: null })} onOpenInvoice={nav.openInvoice} />
      <ReviewSheet open={nav.params.get("queue") === "1" && !invoiceId} onClose={() => nav.set({ queue: null })} onOpenInvoice={(id) => nav.set({ queue: null, invoice: id }, true)} />
      <EarningSheet earningId={earningId} onClose={() => nav.set({ earning: null })} onOpenCleaner={(id) => nav.set({ earning: null, cleaner: id }, true)} />
      <CleanerSheet cleanerId={earningId ? null : cleanerId} onClose={() => nav.set({ cleaner: null })} onOpenEarning={(id) => nav.set({ cleaner: null, earning: id }, true)} />
      <ExpenseSheet expenseId={expenseId} onClose={() => nav.set({ expense: null })} />
      <NewInvoiceDialog open={nav.params.get("new") === "1"} onClose={() => nav.set({ new: null })} onCreated={(id) => nav.set({ new: null, invoice: id, tab: "invoices" })} />
    </>
  );
}

/** Built tabs are buttons; tabs still being built say so and do nothing. */
function Tabs({ active, onPick }: { active: FinanceTab; onPick: (tab: FinanceTab) => void }) {
  return (
    <nav aria-label="Finance sections" className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0">
      <div role="tablist" className="inline-flex min-w-full gap-1 rounded-xl border border-border bg-muted/60 p-1 sm:min-w-0">
        {FINANCE_TABS.map((tab) =>
          tab.built ? (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              onClick={() => onPick(tab.id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-brand-500",
                active === tab.id ? "bg-card text-strong shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-strong",
              )}
            >
              {tab.label}
            </button>
          ) : (
            <span key={tab.id} role="tab" aria-disabled="true" aria-selected={false} title="Not built yet" className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-lg px-3 text-sm whitespace-nowrap text-muted-foreground/60">
              {tab.label}
              <span className="rounded border border-border px-1 text-[10px] font-medium tracking-wide uppercase">Soon</span>
            </span>
          ),
        )}
      </div>
    </nav>
  );
}
