"use client";

/**
 * A quote version as a person reads it. The owner's preview and the customer's page both render this one
 * component, so what is approved is exactly what the customer is shown.
 */
import type { FunctionReturnType } from "convex/server";

import { Check, MinusCircle } from "@/components/icons";
import { usd } from "@/lib/app/finance";
import { durationLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { api } from "../../../convex/_generated/api";

export type Version = NonNullable<FunctionReturnType<typeof api.salesQuotePages.view>>["quote"];
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function QuotePreview({ version, company, number, validUntil, timezone, className }: { version: Version; company: string; number: number; validUntil: number | null; timezone: string; className?: string }) {
  const estimate = version.outcome === "estimate";
  return (
    <div className={cn("grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {estimate ? "Estimate" : "Quote"} Q-{number} · {company}
          </p>
          <p className="mt-1 text-base font-semibold text-strong">{version.serviceName}</p>
          {version.frequency || version.timing ? <p className="text-sm text-muted-foreground">{[version.frequency, version.timing].filter(Boolean).join(" · ")}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-heading text-3xl leading-none tracking-tight text-strong tabular-nums">{usd(version.totalCents)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{version.per}</p>
        </div>
      </header>
      {estimate ? <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">This is an estimate. The final price is confirmed once the details are checked.</p> : null}
      <table className="w-full text-sm">
        <caption className="sr-only">What the price is made of</caption>
        <tbody className="divide-y divide-border">
          {version.lines.map((line) => (
            <tr key={line.key}>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-strong">
                {line.label}
                {line.detail ? <span className="block text-xs text-muted-foreground">{line.detail}</span> : null}
              </th>
              <td className="py-1.5 text-right align-top text-strong tabular-nums">{line.amountCents === 0 && line.kind === "info" ? "" : usd(line.amountCents)}</td>
            </tr>
          ))}
          {version.discount ? (
            <tr>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-strong">
                {version.discount.label}
                <span className="block text-xs text-muted-foreground">{version.discount.reason}</span>
              </th>
              <td className="py-1.5 text-right align-top text-success-foreground tabular-nums">{usd(-version.discount.cents)}</td>
            </tr>
          ) : null}
          {version.taxCents > 0 ? (
            <tr>
              <th scope="row" className="py-1.5 pr-3 text-left font-normal text-strong">
                {version.taxLabel ?? "Tax"}
              </th>
              <td className="py-1.5 text-right text-strong tabular-nums">{usd(version.taxCents)}</td>
            </tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr className="border-t border-border">
            <th scope="row" className="pt-2 text-left font-semibold text-strong">
              Total
            </th>
            <td className="pt-2 text-right font-semibold text-strong tabular-nums">{usd(version.totalCents)}</td>
          </tr>
          {version.depositCents ? (
            <tr>
              <th scope="row" className="pt-1 text-left text-xs font-normal text-muted-foreground">
                Deposit to book · balance {usd(version.balanceCents ?? 0)} after service
              </th>
              <td className="pt-1 text-right text-xs text-muted-foreground tabular-nums">{usd(version.depositCents)}</td>
            </tr>
          ) : null}
        </tfoot>
      </table>
      <div className="grid gap-3 sm:grid-cols-2">
        {version.included.length > 0 ? <Bullets title="Included" items={version.included} tone="in" /> : null}
        {version.excluded.length > 0 ? <Bullets title="Not included" items={version.excluded} tone="out" /> : null}
      </div>
      {version.extras.length > 0 ? <Bullets title="Extras" items={version.extras.map((extra) => `${extra.label}${extra.quantity > 1 ? ` × ${extra.quantity}` : ""}${extra.included ? " (included)" : ` · ${usd(extra.amountCents)}`}`)} tone="in" /> : null}
      <dl className="grid gap-2 border-t border-border pt-3 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-strong">Visit</dt>
          <dd>
            About {durationLabel(version.durationMinutes * 60_000)} with {plural(version.crewSize, "cleaner")}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-strong">Valid</dt>
          <dd>{validUntil ? `Until ${new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric" }).format(new Date(validUntil))}` : `${version.validDays} days from when it is sent`}</dd>
        </div>
        <div>
          <dt className="font-semibold text-strong">Payment</dt>
          <dd>{version.terms.payment}</dd>
        </div>
        <div>
          <dt className="font-semibold text-strong">Changes and cancellation</dt>
          <dd>{version.terms.cancellation}</dd>
        </div>
        {version.agreementRequired ? (
          <div className="sm:col-span-2">
            <dt className="font-semibold text-strong">Agreement</dt>
            <dd>A signed service agreement is needed before the first visit is confirmed.</dd>
          </div>
        ) : null}
      </dl>
      {version.note ? <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-strong">{version.note}</p> : null}
    </div>
  );
}

function Bullets({ title, items, tone }: { title: string; items: string[]; tone: "in" | "out" }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-strong">{title}</p>
      <ul className="grid gap-1 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            {tone === "in" ? <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden /> : <MinusCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
