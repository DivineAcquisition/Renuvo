"use client";

import Link from "next/link";
import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { AgreementRow, Empty, Notice } from "@/components/app/agreements/shared";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button-variants";
import { AGREEMENTS_ROOT, VIEW_HINT } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/** Where each count goes: the library, filtered by the same named view that made the count. */
const target = (view: string) => (view === "signatures" || view === "failed" ? `${AGREEMENTS_ROOT}/awaiting-signatures?view=${view}` : view === "renewals" || view === "upcoming" ? `${AGREEMENTS_ROOT}/renewals?view=${view}` : `${AGREEMENTS_ROOT}/all?view=${view}`);

export function AgreementsOverview() {
  const { companyId } = useCompany();
  const overview = useQuery(api.companyAgreements.overview, { companyId });
  if (!overview) return <Skeleton className="h-72 rounded-2xl" />;
  const attention = overview.views.filter((view) => view.count > 0 && view.view !== "upcoming");
  return (
    <div className="grid gap-5">
      {!overview.signing.configured ? <Notice tone="warning">{overview.signing.why}</Notice> : overview.signing.testMode ? <Notice tone="warning">{overview.signing.why}</Notice> : null}
      {overview.total === 0 && overview.archived === 0 ? (
        <Empty
          title="No agreements yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`${AGREEMENTS_ROOT}/new?mode=selestial`} className={buttonVariants({ variant: "primary", size: "sm" })}>
                Build with Selestial
              </Link>
              <Link href={`${AGREEMENTS_ROOT}/new?mode=upload`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                Upload one you already have
              </Link>
            </div>
          }
        >
          Tell Selestial what you need, start from a template, or upload an agreement you already use. Each one is a draft you review before anything is sent.
        </Empty>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="What needs attention">
            {overview.views.map((view) => (
              <li key={view.view}>
                <Link href={target(view.view)} className={cn("group block h-full rounded-2xl border bg-card px-4 py-3.5 transition-all hover:-translate-y-px hover:shadow-sm focus-visible:outline-2 focus-visible:outline-brand-500/40", view.count > 0 && view.view !== "upcoming" ? "border-brand-500/30" : "border-border")}>
                  <span className="block text-2xl font-semibold tabular-nums text-strong">{view.count}</span>
                  <span className="mt-0.5 block text-sm font-medium text-strong">{view.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{VIEW_HINT[view.view]}</span>
                </Link>
              </li>
            ))}
          </ul>
          {attention.length === 0 ? <Notice>Nothing needs your attention right now.</Notice> : null}
          {overview.capped ? <Notice tone="warning">Counts cover the 500 most recently changed agreements. Use All Agreements and its filters for the rest.</Notice> : null}
          {attention.map((view) => (
            <section key={view.view} className="rounded-2xl border border-border bg-card">
              <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                <h2 className="font-heading text-base tracking-tight text-strong">
                  {view.label} <span className="text-muted-foreground">({view.count})</span>
                </h2>
                <Link href={target(view.view)} className="text-sm font-medium text-brand-600 hover:underline">
                  See all
                </Link>
              </header>
              <ul className="divide-y divide-border">
                {view.items.map((row) => (
                  <AgreementRow key={row.id} row={row} show={view.view === "renewals" ? "renewal" : "dates"} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
