"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { AgentAvatar, STATE } from "@/components/app/agent";
import { departmentPath, type TeamDepartment } from "@/components/app/overview/team-at-work";
import { LogoMark } from "@/components/brand/logo";
import { BotIcon, ChatIcon, DashboardIcon, GearIcon, Hand, HandCoinsIcon, HandHeartIcon, InsightsIcon, Menu, ScheduleIcon, TableIcon, BroomIcon, type LucideIcon } from "@/components/icons";
import { Sheet, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const DEPARTMENT_ICON: Record<string, LucideIcon> = { sales: HandCoinsIcon, operations: BroomIcon, customer_success: HandHeartIcon };

/** Departments shown before the live record has loaded, so the navigation never jumps. */
const DEPARTMENT_NAMES = [
  { id: "sales", name: "Sales" },
  { id: "operations", name: "Operations" },
  { id: "customer_success", name: "Customer Success" },
];

function NavLink({ href, icon: Icon, label, badge, exact, onNavigate }: { href: string; icon: LucideIcon; label: string; badge?: number; exact?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500",
        active ? "bg-brand-500/12 text-brand-100" : "text-muted-foreground hover:bg-muted hover:text-strong",
      )}
    >
      <Icon className={cn("size-[18px] shrink-0", active && "text-brand-300")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-warning px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">{badge}</span> : null}
    </Link>
  );
}

function Navigation({ decisionCount, departments, onNavigate }: { decisionCount?: number; departments?: TeamDepartment[]; onNavigate?: () => void }) {
  const list = departments ?? DEPARTMENT_NAMES.map((row) => ({ ...row, agents: [] as TeamDepartment["agents"] }));
  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      <div className="grid gap-0.5">
        <NavLink href="/app" icon={DashboardIcon} label="Overview" exact onNavigate={onNavigate} />
        <NavLink href="/app/decisions" icon={Hand} label="Needs your decision" badge={decisionCount} onNavigate={onNavigate} />
        <NavLink href="/app/schedule" icon={ScheduleIcon} label="Schedule" onNavigate={onNavigate} />
      </div>

      <div>
        <p className="px-2.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Departments</p>
        <div className="mt-1.5 grid gap-0.5">
          {list.map((department) => (
            <div key={department.id}>
              <NavLink href={departmentPath(department.id)} icon={DEPARTMENT_ICON[department.id] ?? DashboardIcon} label={department.name} onNavigate={onNavigate} />
              {department.agents.length > 0 ? (
                <ul className="mb-1 ml-[1.35rem] grid gap-0.5 border-l border-border pl-3">
                  {department.agents.map((agent) => (
                    <li key={agent.agent} className="flex items-center gap-2 py-1 text-xs text-muted-foreground" title={STATE[agent.state].label}>
                      <AgentAvatar agent={agent.agent} state={agent.state} size="xs" />
                      <span className="truncate">
                        <span className="font-medium text-strong">{agent.name}</span> · {STATE[agent.state].label}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-0.5">
        <NavLink href="/app/team" icon={BotIcon} label="AI Team" onNavigate={onNavigate} />
        <NavLink href="/app/inbox" icon={ChatIcon} label="Inbox" onNavigate={onNavigate} />
        <NavLink href="/app/records" icon={TableIcon} label="Records" onNavigate={onNavigate} />
        <NavLink href="/app/insights" icon={InsightsIcon} label="Insights" onNavigate={onNavigate} />
      </div>

      <div className="mt-auto grid gap-0.5 border-t border-border pt-3">
        <NavLink href="/app/settings" icon={GearIcon} label="Settings" onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

/**
 * The frame every signed-in page sits in: the departments and the agents inside them on the left, and a
 * decisions badge and the schedule one click away from anywhere.
 */
export function AppShell({
  company,
  decisionCount,
  departments,
  userSlot,
  banner,
  dock,
  children,
}: {
  company: string;
  decisionCount?: number;
  departments?: TeamDepartment[];
  userSlot?: React.ReactNode;
  banner?: React.ReactNode;
  /** The team console, floating over every page. */
  dock?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const brand = (
    <Link href="/app" className="flex items-center gap-2.5 px-5 py-4" onClick={() => setMenu(false)}>
      <LogoMark className="size-7" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-strong">{company}</span>
        <span className="block text-[11px] text-muted-foreground">Selestial</span>
      </span>
    </Link>
  );
  return (
    <div className="flex min-h-dvh bg-muted/50">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-background lg:flex">
        {brand}
        <Navigation decisionCount={decisionCount} departments={departments} />
      </aside>

      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetPopup side="left" className="max-w-72 bg-background">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          {brand}
          <Navigation decisionCount={decisionCount} departments={departments} onNavigate={() => setMenu(false)} />
        </SheetPopup>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" className="-ml-1 inline-flex size-10 items-center justify-center rounded-lg text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500 lg:hidden">
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="truncate text-sm font-semibold text-strong lg:hidden">{company}</span>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <Link href="/app/schedule" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
              <ScheduleIcon className="size-4" aria-hidden />
              <span className="hidden sm:inline">Schedule</span>
            </Link>
            <Link
              href="/app/decisions"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500",
                decisionCount ? "border-warning/60 bg-warning/10 text-warning-foreground" : "border-border bg-background text-strong hover:border-brand-500/50",
              )}
            >
              <Hand className="size-4" aria-hidden />
              <span className="hidden sm:inline">Decisions</span>
              <span className="tabular-nums" aria-label={`${decisionCount ?? 0} waiting`}>
                {decisionCount ?? 0}
              </span>
            </Link>
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
