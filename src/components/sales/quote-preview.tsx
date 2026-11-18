"use client";

/**
 * A quote as a person reads it. The owner's preview and the customer's page both render this one
 * component, so what is approved is exactly what the customer is shown.
 */
import { Check } from "@/components/icons";
import { usd } from "@/lib/app/finance";
import { durationLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { QuoteView } from "../../../convex/lib/sales/agentQuotes";

export type { QuoteView };

export function QuotePreview({ quote, company, timezone, className }: { quote: QuoteView; company: string; timezone: string; className?: string }) {
  const estimate = quote.outcome === "estimate";
  const recurring = quote.kind === "recurring" && quote.cadence;
  return (
    <div className={cn("grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {estimate ? "Estimate" : "Quote"} · {company}
          </p>
          <p className="mt-1 text-base font-semibold text-strong">{quote.first ? `${quote.first.service}, then ${quote.service}` : quote.service}</p>
          {recurring ? <p className="text-sm text-muted-foreground">{quote.cadence}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-heading text-3xl leading-none tracking-tight text-strong tabular-nums">{usd(quote.totalCents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{recurring ? "first visit" : `per ${quote.per}`}</p>
        </div>
      </header>
      {estimate ? <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">This is an estimate. The final price is confirmed once the details are checked.</p> : null}
      <table className="w-full text-sm">
        <caption className="sr-only">What the price is made of</caption>
        <tbody className="divide-y divide-border">
          {(quote.first ? quote.first.lines : quote.lines).map((line, index) => (
            <tr key={`${line.label}-${index}`}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-strong">
                {line.label}
              </th>
              <td className="py-1.5 text-right align-top text-strong tabular-nums">{usd(line.amountCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <th scope="row" className="pt-2 text-left font-semibold text-strong">
              {recurring ? "First visit" : "Total"}
            </th>
            <td className="pt-2 text-right font-semibold text-strong tabular-nums">{usd(quote.totalCents)}</td>
          </tr>
          {recurring ? (
            <tr>
              <th scope="row" className="pt-1 text-left text-sm font-normal text-strong">
                Each visit after
              </th>
              <td className="pt-1 text-right text-sm text-strong tabular-nums">{usd(quote.visitCents)}</td>
            </tr>
          ) : null}
          {quote.depositCents ? (
            <tr>
              <th scope="row" className="pt-1 text-left text-xs font-normal text-muted-foreground">
                Deposit to book · the rest after the visit
              </th>
              <td className="pt-1 text-right text-xs text-muted-foreground tabular-nums">{usd(quote.depositCents)}</td>
            </tr>
          ) : null}
        </tfoot>
      </table>
      {quote.firstNote ? <p className="text-xs text-muted-foreground">{quote.firstNote}</p> : null}
      {quote.scope.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold text-strong">Included</p>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {quote.scope.slice(0, 24).map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <dl className="grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
        {quote.durationMinutes ? (
          <div>
            <dt className="font-semibold text-strong">Visit</dt>
            <dd>About {durationLabel(quote.durationMinutes * 60_000)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold text-strong">Valid</dt>
          <dd>Until {new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric" }).format(new Date(quote.expiresAt))}</dd>
        </div>
        {quote.terms ? (
          <>
            <div>
              <dt className="font-semibold text-strong">Payment</dt>
              <dd>{quote.terms.payment}</dd>
            </div>
            <div>
              <dt className="font-semibold text-strong">Changes and cancellation</dt>
              <dd>{quote.terms.cancellation}</dd>
            </div>
          </>
        ) : null}
        {quote.agreementRequired ? (
          <div className="sm:col-span-2">
            <dt className="font-semibold text-strong">Agreement</dt>
            <dd>A signed service agreement is needed before the first visit is confirmed.</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
