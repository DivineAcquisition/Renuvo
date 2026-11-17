"use client";

import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { Download, FileText } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { calendarDate, usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Empty, eyebrow } from "./kit";

/**
 * A customer's statement: every charge, payment, refund and credit, with the running balance. Read from
 * the same records as the invoices; nothing here is entered separately.
 */
export function StatementSheet({ customerId, onClose, onOpenInvoice }: { customerId: Id<"customers"> | null; onClose: () => void; onOpenInvoice: (id: Id<"invoices">) => void }) {
  return (
    <Sheet open={customerId !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-2xl bg-card">
        <SheetTitle className="sr-only">Customer statement</SheetTitle>
        <ScrollArea className="min-h-0 flex-1">{customerId ? <Body customerId={customerId} onOpenInvoice={onOpenInvoice} /> : null}</ScrollArea>
      </SheetPopup>
    </Sheet>
  );
}

const KIND_WORD = { charge: "Charge", payment: "Payment", refund: "Refund", credit: "Credit", void: "Void" } as const;

function Body({ customerId, onOpenInvoice }: { customerId: Id<"customers">; onOpenInvoice: (id: Id<"invoices">) => void }) {
  const { companyId } = useCompany();
  const data = useQuery(api.finance.statement, { companyId, customerId });
  if (!data) {
    return (
      <div className="grid gap-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const download = () => {
    const rows = [["Date", "Entry", "Charges", "Payments", "Balance"], ...[...data.lines].reverse().map((l) => [l.date, l.label, (l.chargeCents / 100).toFixed(2), (l.paidCents / 100).toFixed(2), (l.balanceCents / 100).toFixed(2)])];
    const csv = rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `statement-${data.customer.name.replace(/\W+/g, "-").toLowerCase()}-${data.asOf}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 px-5 pt-6 pb-10 sm:px-7">
      <header className="grid gap-1 pr-10">
        <span className={eyebrow}>Statement · as of {calendarDate(data.asOf)}</span>
        <h2 className="font-heading text-2xl tracking-tight text-strong">{data.customer.name}</h2>
        <p className="text-sm text-muted-foreground">{data.company}</p>
      </header>
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-muted/30 p-4">
        <div>
          <p className={eyebrow}>{data.balanceCents < 0 ? "In the customer's favor" : "Balance"}</p>
          <p className="mt-1 font-heading text-3xl tracking-tight text-strong tabular-nums">{usd(Math.abs(data.balanceCents))}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.openCount} open invoice{data.openCount === 1 ? "" : "s"}
            {data.processingCents ? ` · ${usd(data.processingCents)} processing, not yet counted` : ""}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={download} disabled={!data.lines.length}>
          <Download aria-hidden />
          Download CSV
        </Button>
      </div>
      {data.lines.length === 0 ? (
        <Empty icon={FileText} title="Nothing on the statement yet" body="Issued invoices, payments, refunds and credits for this customer will appear here." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 font-medium">Entry</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.lines.map((line, i) => {
                const amount = line.chargeCents - line.paidCents;
                return (
                  <tr key={`${line.at}-${i}`} className="hover:bg-muted/30">
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground tabular-nums">{calendarDate(line.date, false)}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => onOpenInvoice(line.invoiceId)} className="text-left text-strong underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
                        {line.label}
                      </button>
                      <span className="block text-xs text-muted-foreground">
                        {KIND_WORD[line.kind]}
                        {line.pending ? " · processing, not counted yet" : ""}
                      </span>
                    </td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", amount < 0 ? "text-success-foreground" : "text-strong")}>{line.pending ? "—" : usd(amount)}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">{usd(line.balanceCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Charges add to the balance; payments and credits take it down; refunds add back what was returned.</p>
    </div>
  );
}
