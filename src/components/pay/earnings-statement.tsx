"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { calendarDate, usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";

type View = NonNullable<FunctionReturnType<typeof api.statement.view>>;

/**
 * A cleaner's earnings statement, opened from the private link their company sent. Read-only, made for a
 * phone: their own jobs for the last 90 days, how each job's pay was worked out, and what was paid.
 */
export function EarningsStatement({ token }: { token: string }) {
  const view = useQuery(api.statement.view, { token });
  if (view === undefined) {
    return (
      <Shell company={null}>
        <div aria-busy="true" className="grid gap-3">
          <div className="h-36 animate-pulse rounded-3xl bg-muted" />
          <div className="h-64 animate-pulse rounded-3xl bg-muted" />
        </div>
      </Shell>
    );
  }
  if (view === null) {
    return (
      <Shell company={null}>
        <Panel>
          <h1 className="text-lg font-semibold text-strong">This link doesn&apos;t open a statement</h1>
          <p className="mt-1 text-sm text-muted-foreground">It may have expired or been replaced with a newer one. Ask the company that sent it for a new link.</p>
        </Panel>
      </Shell>
    );
  }
  return (
    <Shell company={view.company}>
      <Summary view={view} />
      {view.employee ? (
        <p className="rounded-2xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          These are your hours and gross pay before taxes. Your paycheck comes through {view.company}&apos;s payroll, which handles taxes and deductions.
        </p>
      ) : null}
      <Panel>
        <h2 className="text-sm font-semibold text-strong">Jobs</h2>
        {view.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No completed jobs in this period yet.</p>
        ) : (
          <ol className="mt-2 divide-y divide-border">
            {view.jobs.map((job) => (
              <li key={job.id} className="grid gap-1.5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-strong">{job.service}</p>
                    <p className="text-xs text-muted-foreground">
                      {calendarDate(job.date, false)}
                      {job.town ? ` · ${job.town}` : ""}
                      {job.hours ? ` · ${job.hours}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-strong">{job.totalCents === null ? "—" : usd(job.totalCents)}</p>
                    <p className={cn("text-xs", job.paid ? "text-success-foreground" : "text-muted-foreground")}>{job.state}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 rounded-xl bg-muted/50 px-3 py-2 text-xs">
                  <dt className="text-muted-foreground">{job.basis}</dt>
                  <dd className="text-right tabular-nums text-strong">{job.baseCents === null ? "—" : usd(job.baseCents)}</dd>
                  {job.adjustments.map((a, i) => (
                    <div key={i} className="contents">
                      <dt className="text-muted-foreground">{a.reason}</dt>
                      <dd className="text-right tabular-nums text-strong">{a.cents > 0 ? "+" : ""}{usd(a.cents)}</dd>
                    </div>
                  ))}
                  {job.tipCents ? (
                    <>
                      <dt className="text-muted-foreground">Tips</dt>
                      <dd className="text-right tabular-nums text-strong">+{usd(job.tipCents)}</dd>
                    </>
                  ) : null}
                </dl>
                {job.hoursNote ? <p className="text-xs text-muted-foreground">{job.hoursNote}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel>
        <h2 className="text-sm font-semibold text-strong">Payments</h2>
        {view.payments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No payments recorded in this period yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {view.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span className="min-w-0">
                  <span className="block text-strong">
                    {p.method} · {p.jobs} job{p.jobs === 1 ? "" : "s"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {p.status} · {calendarDate(p.on, false)}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-strong">{usd(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <p className="px-2 text-center text-xs text-muted-foreground">
        This page is private to you and works until {calendarDate(view.validUntil)}. Questions about your pay? Ask {view.company.replace(/\.$/, "")}.
      </p>
    </Shell>
  );
}

function Summary({ view }: { view: View }) {
  const cells = [
    { label: "Paid", cents: view.totals.paidCents },
    { label: "On its way", cents: view.totals.onTheWayCents },
    { label: "Approved, not paid yet", cents: view.totals.approvedUnpaidCents },
  ];
  return (
    <Panel>
      <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">Your earnings</p>
      <h1 className="mt-1 text-xl font-semibold text-strong">{view.cleaner}</h1>
      <p className="text-sm text-muted-foreground">
        {calendarDate(view.from, false)} to {calendarDate(view.to)}
      </p>
      <p className="mt-4 text-4xl font-semibold tracking-tight tabular-nums text-strong">{usd(view.totals.earnedCents)}</p>
      <p className="text-xs text-muted-foreground">
        From {view.jobs.length} job{view.jobs.length === 1 ? "" : "s"}, tips included.
        {view.jobs.some((j) => j.state === "Being reviewed") ? " Jobs still being reviewed can change before they're approved." : ""}
      </p>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-border px-2.5 py-2">
            <dt className="text-[11px] leading-tight text-muted-foreground">{c.label}</dt>
            <dd className="mt-1 text-sm font-semibold tabular-nums text-strong">{usd(c.cents)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Shell({ company, children }: { company: string | null; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-muted/50">
      <div className="h-36 bg-[radial-gradient(140%_120%_at_10%_0%,color-mix(in_oklab,var(--color-brand-500)_28%,transparent),transparent_70%)]" aria-hidden />
      <div className="mx-auto -mt-28 grid w-full max-w-lg gap-4 px-4 pb-16">
        <header className="px-1">
          <p className="truncate text-sm font-semibold text-strong">{company ?? "Earnings statement"}</p>
        </header>
        {children}
      </div>
    </main>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-3xl border border-border bg-card p-5 shadow-[0_24px_60px_-32px_rgba(27,14,69,0.35)] sm:p-6">{children}</section>;
}
