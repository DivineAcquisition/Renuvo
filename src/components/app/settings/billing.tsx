"use client";

import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { Panel } from "@/components/app/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";

/** Only the Owner reaches the query: for anyone else it is skipped, never sent. */
export function PlanBilling() {
  const { companyId, role } = useCompany();
  const billing = useQuery(api.settings.billing, role === "owner" ? { companyId } : "skip");
  if (role !== "owner") return <OwnerOnly what="Plan & billing" />;
  if (!billing) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="grid gap-5">
      <Panel title="Your plan">
        <p className="text-sm font-medium text-strong">No plan has been started.</p>
        <p className="mt-1 text-sm text-muted-foreground">There is no active subscription, charge or invoice for this company, and nothing below grants access by itself.</p>
      </Panel>
      <div className="grid gap-4 md:grid-cols-2">
        {billing.plans.map((plan) => (
          <section key={plan.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
            <h2 className="font-heading text-lg tracking-tight text-strong">{plan.name}</h2>
            <p className="mt-1 text-2xl font-semibold text-strong">
              {money(plan.monthlyCents)}
              <span className="text-sm font-normal text-muted-foreground"> a month</span>
            </p>
            <ul className="mt-3 grid gap-1 text-sm text-muted-foreground">
              {plan.includes.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden>·</span>
                  {line}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <Panel title="What this does not do yet">
        <ul className="grid gap-1.5 text-sm text-muted-foreground">
          {billing.notes.map((note) => (
            <li key={note} className="flex gap-2">
              <span aria-hidden>·</span>
              {note}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function OwnerOnly({ what }: { what: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-strong">{what} is for the Owner</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">Ask the company&apos;s Owner if you need something from this page.</p>
    </div>
  );
}
