"use client";

import Link from "next/link";
import { useState } from "react";

import { Hand, Menu, ScheduleIcon } from "@/components/icons";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { linkTo } from "@/lib/app/navigation-helpers";
import { cn } from "@/lib/utils";

/**
 * The frame every signed-in page sits in. The sidebar is drawn from the navigation definition
 * (src/components/app/sidebar.tsx): fixed on a desk, a drawer on a phone that closes once a
 * destination is chosen. Approvals and the schedule are one click away from anywhere.
 */
export function AppShell({
  company,
  decisionCount,
  sidebar,
  userSlot,
  banner,
  dock,
  children,
}: {
  company: string;
  decisionCount?: number;
  /** The sidebar. It is given a function to call when a destination is chosen, which closes the drawer. */
  sidebar: (onNavigate?: () => void) => React.ReactNode;
  userSlot?: React.ReactNode;
  banner?: React.ReactNode;
  /** The team console, floating over every page. */
  dock?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const approvals = linkTo("approvals");
  const schedule = linkTo("dispatch.schedule");
  return (
    <div className="flex min-h-dvh bg-muted/50">
      <aside className="sticky top-0 hidden h-dvh w-[17rem] shrink-0 border-r border-border bg-background lg:block">{sidebar()}</aside>

      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetPopup side="left" className="max-w-[19rem] bg-background" showCloseButton={false}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {menu ? sidebar(() => setMenu(false)) : null}
        </SheetPopup>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="-ml-1 inline-flex size-10 items-center justify-center rounded-lg text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500 lg:hidden">
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="truncate text-sm font-semibold text-strong lg:hidden">{company}</span>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {schedule ? (
              <Link href={schedule} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                <ScheduleIcon className="size-4" aria-hidden />
                <span className="hidden sm:inline">Schedule</span>
              </Link>
            ) : null}
            {approvals ? (
              <Link
                href={approvals}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500",
                  decisionCount ? "border-warning/60 bg-warning/10 text-warning-foreground" : "border-border bg-background text-strong hover:border-brand-500/50",
                )}
              >
                <Hand className="size-4" aria-hidden />
                <span className="hidden sm:inline">Approvals</span>
                <span className="tabular-nums" aria-label={`${decisionCount ?? 0} waiting`}>
                  {decisionCount ?? 0}
                </span>
              </Link>
            ) : null}
            {userSlot}
          </div>
        </header>
        {banner}
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-3 pt-5 pb-24 sm:px-6 sm:pt-6">{children}</main>
      </div>
      {dock}
    </div>
  );
}

export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-heading text-2xl tracking-tight text-strong">{title}</h1>
        {lead ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{lead}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, action, children, className, flush }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card", className)}>
      {title || action ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
          {title ? <h2 className="font-heading text-base tracking-tight text-strong">{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      <div className={flush ? "" : "p-4 sm:p-5"}>{children}</div>
    </section>
  );
}

/** For a part of the product that does not exist yet. It says so, and says what will be there. */
export function NotBuilt({ title, body, points }: { title: string; body: string; points?: string[] }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center sm:px-10">
      <p className="text-base font-semibold text-strong">{title}</p>
      <p className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{body}</p>
      {points ? (
        <ul className="mx-auto mt-4 grid max-w-md gap-1 text-left text-sm text-muted-foreground">
          {points.map((point) => (
            <li key={point} className="flex gap-2">
              <span aria-hidden>·</span>
              {point}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
