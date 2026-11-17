"use client";

import Link from "next/link";
import { useState } from "react";

import { Avatar, plural, type Attention } from "@/components/app/cleaners/shared";
import { useDetail } from "@/components/app/detail-panel";
import { ArrowRight, Building2, CalendarIcon, CheckCircle2, ChevronDown, CircleDashed, TriangleAlert, UserX } from "@/components/icons";
import { cleanerPath } from "@/lib/app/cleaners";
import { cn } from "@/lib/utils";

import type { Id } from "../../../../convex/_generated/dataModel";

const KIND_LOOK: Record<Attention["kind"], { icon: typeof TriangleAlert; label: string; tone: string }> = {
  conflict: { icon: CalendarIcon, label: "Conflict with accepted work", tone: "bg-destructive/10 text-destructive-foreground" },
  held_while_inactive: { icon: UserX, label: "Holds work while not active", tone: "bg-destructive/10 text-destructive-foreground" },
  onboarding_overdue: { icon: CircleDashed, label: "Onboarding overdue", tone: "bg-warning/10 text-warning-foreground" },
  blocked_active: { icon: TriangleAlert, label: "Active but cannot be offered work", tone: "bg-warning/10 text-warning-foreground" },
  subcontractor_inactive: { icon: Building2, label: "Supplying company not active", tone: "bg-warning/10 text-warning-foreground" },
};

/**
 * What a person should look at, verified from the record. Each item says what is wrong, what it rests
 * on (each piece of evidence opens), and where to fix it. Nothing here was changed for them.
 */
export function AttentionList({ items, total, onOpen }: { items: Attention[]; total: number; timezone: string; onOpen: (cleanerId: Id<"cleaners">, section?: string) => void }) {
  const [all, setAll] = useState(false);
  const openJob = useDetail();
  if (total === 0) {
    return (
      <section aria-label="Needs attention" className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-success/10 text-success-foreground">
          <CheckCircle2 className="size-4" aria-hidden />
        </span>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-strong">Nothing needs attention.</span> No conflicts with accepted work, no overdue onboarding, and every active person can be offered work.
        </p>
      </section>
    );
  }
  const shown = all ? items : items.slice(0, 4);
  // A phone shows two before "Show all"; a wider screen shows four.
  const hiddenOnPhone = (index: number) => !all && index >= 2;
  return (
    <section aria-labelledby="attention-title" className="rounded-2xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 id="attention-title" className="flex items-center gap-2 font-heading text-base tracking-tight text-strong">
          Needs attention
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning-foreground tabular-nums">{total}</span>
        </h2>
        <p className="text-xs text-muted-foreground">Checked against the record. Nothing here was changed for you.</p>
      </header>
      <ul className="divide-y divide-border">
        {shown.map((item, index) => {
          const look = KIND_LOOK[item.kind];
          const Icon = look.icon;
          return (
            <li key={item.key} className={cn("grid gap-2 px-4 py-3 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-3 sm:px-5", hiddenOnPhone(index) && "max-sm:hidden")}>
              <span className={cn("hidden size-9 place-items-center rounded-xl sm:grid", look.tone)}>
                <Icon className="size-4.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{look.label}</span>
                </p>
                <p className="mt-0.5 text-sm font-medium text-strong">{item.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{item.detail}</p>
                <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Evidence">
                  {item.evidence.map((evidence, index) => (
                    <li key={index}>
                      {evidence.jobId ? (
                        <button type="button" onClick={() => openJob({ kind: "job", id: evidence.jobId! })} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                          <CalendarIcon className="size-3.5 text-muted-foreground" aria-hidden />
                          {evidence.label}
                        </button>
                      ) : (
                        <Link href={cleanerPath(item.cleanerId, (evidence.section ?? "overview") as never)} className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-border bg-background px-2 text-xs text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                          {evidence.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                <button type="button" onClick={() => onOpen(item.cleanerId)} className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-xs text-muted-foreground hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500">
                  <Avatar initials={item.cleanerName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()} seed={item.cleanerId} size="sm" />
                  {item.cleanerName}
                </button>
                <Link href={cleanerPath(item.cleanerId, item.action.section as never)} className="inline-flex min-h-8 items-center gap-1 rounded-lg border border-brand-500/30 bg-brand-500/8 px-2.5 text-xs font-medium text-strong hover:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500">
                  {item.action.label}
                  <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
      {items.length > 2 ? (
        <button type="button" onClick={() => setAll((open) => !open)} aria-expanded={all} className={cn("flex w-full items-center justify-center gap-1 border-t border-border py-2.5 text-xs font-medium text-brand-700 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-brand-500 dark:text-brand-300", items.length <= 4 && "sm:hidden")}>
          {all ? "Show fewer" : `Show all ${plural(total, "item")}`}
          <ChevronDown className={cn("size-3.5 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
