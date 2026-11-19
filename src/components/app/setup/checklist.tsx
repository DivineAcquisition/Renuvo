"use client";

/**
 * The compact setup checklist on Home: only for the Owner, only for steps that are still open (read from
 * records, so a finished step never shows), and gone for good once they close it. Setup itself stays
 * available from Integrations and from "Your first work".
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { ArrowUpRight, X } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";

export function SetupChecklist() {
  const { companyId } = useCompany();
  const list = useQuery(api.setupProgress.checklist, { companyId });
  const dismiss = useMutation(api.setupProgress.dismissChecklist);
  if (!list) return null;
  return (
    <section className="grid gap-2 rounded-2xl border border-border bg-card p-4" aria-labelledby="setup-checklist">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 id="setup-checklist" className="text-sm font-semibold text-strong">
            Left from setup
          </h2>
          <p className="text-xs text-muted-foreground">None of this is required to keep working.</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close the setup checklist for good" onClick={() => void dismiss({ companyId })}>
          <X aria-hidden />
        </Button>
      </div>
      <ul className="grid gap-1 sm:grid-cols-2">
        {list.items.map((item) => (
          <li key={item.words}>
            <Link href={item.href} className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-strong hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-brand-500">
              <span className="size-4 shrink-0 rounded-full border-2 border-border" aria-hidden />
              <span className="min-w-0 flex-1">{item.words}</span>
              <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {list.more ? (
        <Link href="/app/first-work" className="justify-self-start text-xs font-medium text-brand-300 underline-offset-2 hover:underline">
          {list.more} more in Your first work
        </Link>
      ) : null}
    </section>
  );
}
