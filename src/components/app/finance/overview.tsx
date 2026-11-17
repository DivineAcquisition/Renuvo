"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { useRun } from "@/components/app/form";
import { AlertTriangle, ArrowRight, CircleDollarSign, Clock, FileText, HistoryIcon, Info, Plus, Sparkles, Users, Wallet } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FINANCE_PATH, PERIODS, moment, usd, type PeriodId } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import type { FinanceNav } from "./finance-screen";
import { Amount, Empty, Section, TrendChart, eyebrow } from "./kit";
import { ReadyForYou } from "./messages";

type Overview = FunctionReturnType<typeof api.finance.overview>;
type Finding = Overview["findings"][number];

export function OverviewTab({ nav }: { nav: FinanceNav & { set: (c: Record<string, string | null>, push?: boolean) => void } }) {
  const { companyId } = useCompany();
  const data = useQuery(api.finance.overview, { companyId, period: nav.period });
  if (!data) return <OverviewSkeleton />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Period</span>
          <select
            value={nav.period}
            onChange={(event) => nav.set({ period: event.target.value === "this_month" ? null : (event.target.value as PeriodId) })}
            className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-muted-foreground">{data.period.label}</span>
        {data.stripe.testMode ? <span className="ml-auto rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning-foreground">Stripe test mode · no real money moves</span> : null}
      </div>

      <MoneyStrip data={data} onOverdue={() => nav.showInvoices("overdue")} onOutstanding={() => nav.showInvoices("outstanding")} />
      <TeamPayRow data={data} onOpen={(filter) => nav.showTeamPay(filter)} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <div className="order-2 grid min-w-0 gap-5 lg:order-1">
          <Section title="Invoiced and collected" description="Last eight weeks. Collected counts payments that arrived; processing payments are not included.">
            <TrendChart weeks={data.trend} />
          </Section>
          <div className="grid items-start gap-5 xl:grid-cols-2">
            <Upcoming rows={data.upcoming} onOpen={nav.openInvoice} />
            <Activity rows={data.activity} onOpen={nav.openInvoice} />
          </div>
        </div>
        <div className="order-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5 lg:sticky lg:top-20 lg:order-2">
          <ReadyForYou onReview={() => nav.set({ queue: "1" }, true)} onOpenInvoice={nav.openInvoice} />
          <Attention findings={data.findings} checkedAt={data.checkedAt} nav={nav} hasInvoices={data.hasInvoices} />
        </div>
      </div>
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-5" aria-busy="true" aria-label="Loading Finance">
      <Skeleton className="h-9 w-48 rounded-lg" />
      <Skeleton className="h-36 rounded-2xl" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22.5rem]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}

/** The four figures, each with what it counts. Overdue and outstanding open the matching invoice list. */
function MoneyStrip({ data, onOverdue, onOutstanding }: { data: Overview; onOverdue: () => void; onOutstanding: () => void }) {
  const m = data.metrics;
  const cells = [
    {
      key: "collected",
      label: "Collected",
      value: m.collected.cents,
      sub: m.collected.count ? `${m.collected.count} payment${m.collected.count === 1 ? "" : "s"}${m.refunded.cents ? ` · ${usd(m.refunded.cents)} refunded` : ""}` : "No payments in this period",
      define: `Payments that arrived in the period (${data.period.label}): card and bank payments Stripe confirmed, plus payments you recorded. Refunds are listed separately, not subtracted.${m.collected.feesCents ? ` Stripe fees on these: ${usd(m.collected.feesCents)}.` : ""}${m.collected.feesMissing ? ` Fees not reported yet on ${m.collected.feesMissing}.` : ""}`,
      tone: "brand" as const,
    },
    {
      key: "outstanding",
      label: "Owed to you",
      value: m.outstanding.cents,
      sub: m.outstanding.count ? `${m.outstanding.count} open invoice${m.outstanding.count === 1 ? "" : "s"}${m.outstanding.processingCents ? ` · ${usd(m.outstanding.processingCents)} processing` : ""}` : "Nothing outstanding",
      define: "What customers still owe on issued invoices, right now. Payments still processing are shown but not subtracted until they clear.",
      onClick: m.outstanding.count ? onOutstanding : undefined,
    },
    {
      key: "overdue",
      label: "Overdue",
      value: m.overdue.cents,
      sub: m.overdue.count ? `${m.overdue.count} invoice${m.overdue.count === 1 ? "" : "s"} past due` : "Nothing past due",
      define: "The part of what's owed that is past its due date, right now.",
      onClick: m.overdue.count ? onOverdue : undefined,
      tone: m.overdue.count ? ("danger" as const) : undefined,
    },
    {
      key: "invoiced",
      label: "Invoiced",
      value: m.invoiced.cents,
      sub: m.invoiced.count ? `${m.invoiced.count} invoice${m.invoiced.count === 1 ? "" : "s"} issued` : "No invoices issued in this period",
      define: "The total of invoices issued in this period, including tax. Drafts and void invoices are not counted. Invoiced is not collected.",
    },
  ];
  return (
    <section aria-label="Money summary" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {cells.map((cell, i) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5">
                <span className={eyebrow}>{cell.label}</span>
                <span className="group/def relative z-10">
                  <button type="button" aria-label={`How ${cell.label.toLowerCase()} is counted`} className="grid size-5 place-items-center rounded-full text-muted-foreground/70 hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500" onClick={(event) => event.stopPropagation()}>
                    <Info className="size-3.5" aria-hidden />
                  </button>
                  <span role="tooltip" className={cn("pointer-events-none absolute top-6 z-20 hidden w-60 max-w-[70vw] rounded-lg border border-border bg-popover p-2.5 text-left text-xs leading-relaxed font-normal tracking-normal text-muted-foreground normal-case shadow-lg group-focus-within/def:block group-hover/def:block", i % 2 === 1 ? "right-0" : "left-0")}>
                    {cell.define}
                  </span>
                </span>
              </span>
              <span className={cn("mt-2 block font-heading text-[1.65rem] leading-none tracking-tight tabular-nums sm:text-3xl", cell.tone === "danger" ? "text-destructive-foreground" : "text-strong")}>{usd(cell.value)}</span>
              <span className="mt-2 block text-xs text-muted-foreground">{cell.sub}</span>
              <span className="sr-only">{cell.define}</span>
            </>
          );
          const frame = cn("relative block px-4 py-4 text-left sm:px-5 sm:py-5", i % 2 === 1 && "border-l border-border", i >= 2 && "border-t border-border lg:border-t-0", i === 2 && "lg:border-l", cell.tone === "brand" && "bg-[radial-gradient(120%_120%_at_0%_0%,color-mix(in_oklab,var(--color-brand-500)_9%,transparent),transparent_60%)]");
          return (
            <div key={cell.key} className={cn(frame, cell.onClick && "group transition-colors hover:bg-muted/40")}>
              {cell.onClick ? <button type="button" onClick={cell.onClick} aria-label={`Show ${cell.label.toLowerCase()} invoices`} className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500" /> : null}
              <div className="pointer-events-none relative [&_button]:pointer-events-auto">{body}</div>
              {cell.onClick ? <ArrowRight className="pointer-events-none absolute top-4 right-4 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /> : null}
            </div>
          );
        })}
      </div>
      <p className="border-t border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground sm:px-5">
        Expenses and job profit aren&apos;t tracked in Finance yet, so nothing here is net profit.
      </p>
    </section>
  );
}

/** Team pay at a glance: what's waiting on the Owner, and what was paid in the period. Each part opens Team Pay. */
function TeamPayRow({ data, onOpen }: { data: Overview; onOpen: (filter?: string) => void }) {
  const t = data.teamPay;
  if (!t.any) return null;
  const parts = [
    { key: "review", label: "To review", cents: t.reviewCents, sub: `${t.reviewCount} job${t.reviewCount === 1 ? "" : "s"}${t.reviewMissing ? ` · ${t.reviewMissing} not worked out` : ""}`, filter: undefined },
    { key: "approved", label: "Approved, not paid", cents: t.approvedUnpaidCents, sub: `${t.approvedCount} job${t.approvedCount === 1 ? "" : "s"}${t.startedCents ? ` · ${usd(t.startedCents)} on its way` : ""}`, filter: "approved" },
    { key: "paid", label: `Paid · ${data.period.label}`, cents: t.paidInPeriodCents, sub: `${t.paidInPeriodCount} payment${t.paidInPeriodCount === 1 ? "" : "s"} you confirmed`, filter: "paid" },
  ];
  return (
    <section aria-label="Team pay" className="grid grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-card sm:grid-cols-[auto_repeat(3,minmax(0,1fr))]">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3 sm:border-r sm:border-b-0 sm:px-5">
        <span className="grid size-8 place-items-center rounded-lg bg-brand-500/10 text-info-foreground">
          <Users className="size-4" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-semibold text-strong">Team pay</span>
          <span className="block text-xs text-muted-foreground">What your cleaners earned</span>
        </span>
      </div>
      {parts.map((part, i) => (
        <button
          key={part.key}
          type="button"
          onClick={() => onOpen(part.filter)}
          className={cn("flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:block sm:px-5", i > 0 && "border-t border-border sm:border-t-0 sm:border-l")}
        >
          <span>
            <span className={eyebrow}>{part.label}</span>
            <span className="block text-xs text-muted-foreground sm:mt-1 sm:hidden">{part.sub}</span>
          </span>
          <span className="block font-heading text-lg leading-none tracking-tight tabular-nums text-strong sm:mt-1.5 sm:text-xl">{usd(part.cents)}</span>
          <span className="mt-1 hidden text-xs text-muted-foreground sm:block">{part.sub}</span>
        </button>
      ))}
    </section>
  );
}

const TONE_RING: Record<Finding["tone"], string> = {
  danger: "bg-destructive/10 text-destructive-foreground",
  warning: "bg-warning/12 text-warning-foreground",
  info: "bg-brand-500/10 text-info-foreground",
};

/** What Selestial found in the records. Each card names the records, recommends one step, and offers it. */
type Nav = FinanceNav & { set: (c: Record<string, string | null>, push?: boolean) => void };

function Attention({ findings, checkedAt, nav, hasInvoices }: { findings: Finding[]; checkedAt: number; nav: Nav; hasInvoices: boolean }) {
  const { timezone } = useCompany();
  return (
    <section aria-labelledby="attention-title" className="rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 sm:px-5">
        <span className="grid size-8 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="attention-title" className="font-heading text-base tracking-tight text-strong">
            Needs your attention
          </h2>
          <p className="text-xs text-muted-foreground">
            Selestial checked your records at {moment(checkedAt, timezone, true).split(", ").pop()}
          </p>
        </div>
      </header>
      {findings.length === 0 ? (
        hasInvoices ? (
          <Empty icon={CircleDollarSign} title="Nothing needs you right now" body="No overdue invoices, failed payments, visits waiting for an invoice or team pay to review." />
        ) : (
          <Empty icon={FileText} title="Start with an invoice" body="Create one from a completed visit or for any customer. It stays a draft until you issue it." action={<Button onClick={nav.newInvoice}>New invoice</Button>} />
        )
      ) : (
        <ul className="divide-y divide-border">
          {findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} nav={nav} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FindingCard({ finding, nav }: { finding: Finding; nav: Nav }) {
  const { companyId } = useCompany();
  const create = useMutation(api.finance.createInvoice);
  const { busy, error, run } = useRun();
  const Icon = finding.id.startsWith("team_") ? Users : finding.tone === "info" ? (finding.id === "stripe" ? Wallet : FileText) : finding.tone === "danger" ? AlertTriangle : Clock;
  const firstInvoice = finding.records.find((r) => r.kind === "invoice" || r.kind === "payment");
  const act = () => {
    if (finding.action.kind === "team_pay") return nav.showTeamPay(finding.action.filter === "review" ? undefined : finding.action.filter);
    if (finding.action.kind === "filter_invoices") return nav.showInvoices(finding.action.filter);
    if (finding.action.kind === "invoice_jobs") return nav.newInvoice();
    if (finding.action.kind === "open_invoice" && firstInvoice) return nav.openInvoice(firstInvoice.kind === "payment" ? firstInvoice.invoiceId : (firstInvoice.id as Id<"invoices">));
  };
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONE_RING[finding.tone])}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-strong">{finding.title}</h3>
            <span className="rounded border border-border px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{finding.state === "needs_your_approval" ? "Needs your approval" : "Needs attention"}</span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{finding.noticed}</p>
          {finding.records.length ? (
            <ul className="mt-2.5 grid gap-1" aria-label="Records behind this">
              {finding.records.slice(0, 3).map((record) => (
                <li key={record.id}>
                  {record.kind === "job" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(async () => nav.openInvoice((await create({ companyId, jobId: record.id as Id<"jobs"> })).invoiceId))}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-left text-xs hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-strong">{record.label}</span> <span className="text-muted-foreground">· {record.detail}</span>
                      </span>
                      {record.amountCents !== null ? <Amount cents={record.amountCents} className="shrink-0 text-xs" /> : <span className="shrink-0 text-muted-foreground">No price</span>}
                      <Plus className="size-3.5 shrink-0 text-info-foreground" aria-label="Create a draft" />
                    </button>
                  ) : record.kind === "earning" || record.kind === "cleaner" ? (
                    <button
                      type="button"
                      onClick={() => nav.set(record.kind === "earning" ? { earning: record.id } : { cleaner: record.id }, true)}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-left text-xs hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-strong">{record.label}</span> <span className="text-muted-foreground">· {record.detail}</span>
                      </span>
                      {record.amountCents !== null ? <Amount cents={record.amountCents} className="shrink-0 text-xs" /> : null}
                      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => nav.openInvoice(record.kind === "payment" ? record.invoiceId : (record.id as Id<"invoices">))}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-left text-xs hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-strong">{record.label}</span> <span className="text-muted-foreground">· {record.detail}</span>
                      </span>
                      <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
              {finding.records.length > 3 ? <li className="px-1 text-xs text-muted-foreground">and {finding.records.length - 3} more</li> : null}
            </ul>
          ) : null}
          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-strong">Recommended:</span> {finding.recommend}
          </p>
          {error ? <p className="mt-2 text-xs text-destructive-foreground">{error}</p> : null}
          <div className="mt-3">
            {finding.action.kind === "open_setup" ? (
              <Link href={`${FINANCE_PATH}/setup`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                {finding.action.label}
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            ) : finding.action.kind === "open_invoice" && !firstInvoice ? null : (
              <Button size="sm" variant="outline" onClick={act}>
                {finding.action.label}
                <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Upcoming({ rows, onOpen }: { rows: Overview["upcoming"]; onOpen: (id: Id<"invoices">) => void }) {
  const { timezone } = useCompany();
  return (
    <Section title="Coming up" description="Requests due in the next 14 days" flush>
      {rows.length === 0 ? (
        <p className="px-4 pb-5 text-sm text-muted-foreground sm:px-5">Nothing is due in the next two weeks.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {rows.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => onOpen(row.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5">
                <span className="w-12 shrink-0 text-center">
                  <span className="block text-[11px] font-semibold text-muted-foreground uppercase">{new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short" }).format(new Date(row.dueAt!))}</span>
                  <span className="block font-heading text-lg leading-tight text-strong tabular-nums">{new Intl.DateTimeFormat("en-US", { timeZone: timezone, day: "numeric" }).format(new Date(row.dueAt!))}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-strong">{row.customer}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {row.number} · {row.stateWords}
                  </span>
                </span>
                <Amount cents={row.requestedCents} className="text-sm font-medium" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Activity({ rows, onOpen }: { rows: Overview["activity"]; onOpen: (id: Id<"invoices">) => void }) {
  const { timezone } = useCompany();
  return (
    <Section title="Recent activity" description="Everything that changed money, newest first" flush>
      {rows.length === 0 ? (
        <Empty icon={HistoryIcon} title="No activity yet" body="Invoices, payments and refunds will be listed here as they happen." />
      ) : (
        <ol className="border-t border-border">
          {rows.map((row) => (
            <li key={row.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                disabled={!row.invoiceId}
                onClick={() => row.invoiceId && onOpen(row.invoiceId)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-brand-500/70" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-strong">{row.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[row.customer, row.invoiceNumber].filter(Boolean).join(" · ") || row.by}</span>
                </span>
                <span className="shrink-0 text-right">
                  {row.amountCents !== null ? <Amount cents={row.amountCents} className="block text-sm" muted /> : null}
                  <span className="block text-[11px] text-muted-foreground">
                    {row.by} · {moment(row.at, timezone)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

