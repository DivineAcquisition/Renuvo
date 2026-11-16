"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useId, useRef, useState } from "react";

import { agentPortrait } from "@/components/app/agent";
import { LogoMark } from "@/components/brand/logo";
import {
  BroomIcon,
  ChatIcon,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  DashboardIcon,
  GearIcon,
  Hand,
  HouseIcon,
  InsightsIcon,
  LightningIcon,
  Search,
  SirenIcon,
  Wallet,
  type LucideIcon,
} from "@/components/icons";
import { agentBadge, approvalsBadge, tabBadge, type SidebarFacts } from "@/lib/app/badges";
import { DEPARTMENTS, FOOTER_ITEMS, PERSISTENT_ITEMS, SHARED_ITEMS, type AgentId, type AgentNav, type Badge, type DepartmentId, type NavItem, type NavItemId, type Role } from "@/lib/app/navigation";
import {
  activeFor,
  agentsIn,
  hrefFor,
  mayShow,
  parseSidebarState,
  selectDepartment,
  serializeSidebarState,
  sidebarStorageKey,
  syncToPath,
  toggleAgent,
  type SidebarState,
} from "@/lib/app/navigation-helpers";
import { cn } from "@/lib/utils";

// Everything below is drawn from src/lib/app/navigation.ts. This file adds only icons and markup.

const ITEM_ICON: Record<NavItemId, LucideIcon> = {
  home: DashboardIcon,
  approvals: Hand,
  inbox: ChatIcon,
  search: Search,
  customers: HouseIcon,
  cleaners: BroomIcon,
  finance: Wallet,
  reports: InsightsIcon,
  settings: GearIcon,
};

// ── Remembered state ────────────────────────────────────────────────────────────────────────────────

type Held = { key: string; path: string; state: SidebarState };
type SidebarStore = { state: SidebarState; update: (change: (state: SidebarState) => SidebarState) => void };
const SidebarContext = createContext<SidebarStore | null>(null);

function stored(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Holds the selected department and the open agents for one person in one company, and keeps them
 * across visits. One store serves both the desktop sidebar and the phone drawer, so they never disagree.
 */
export function SidebarStateProvider({ userId, companyId, children }: { userId: string; companyId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const key = sidebarStorageKey(userId, companyId);
  const fresh = (): Held => ({ key, path: pathname, state: syncToPath(parseSidebarState(stored(key)), pathname) });
  const [held, setHeld] = useState<Held>(fresh);

  // Arriving somewhere new, by a click or a deep link, opens the agent that page belongs to. Staying on a
  // page changes nothing, so a person can switch department or close an agent while they are on its page.
  let current = held;
  if (held.key !== key) {
    current = fresh();
    setHeld(current);
  } else if (held.path !== pathname) {
    current = { ...held, path: pathname, state: syncToPath(held.state, pathname) };
    setHeld(current);
  }

  useEffect(() => {
    try {
      window.localStorage.setItem(current.key, serializeSidebarState(current.state));
    } catch {
      // Private browsing or a full disk: the sidebar still works, it just is not remembered.
    }
  }, [current.key, current.state]);

  const update: SidebarStore["update"] = (change) => setHeld((before) => ({ ...before, state: change(before.state) }));
  return <SidebarContext.Provider value={{ state: current.state, update }}>{children}</SidebarContext.Provider>;
}

function useSidebarStore(): SidebarStore {
  const store = useContext(SidebarContext);
  if (!store) throw new Error("The sidebar needs a SidebarStateProvider");
  return store;
}

// ── Badges ──────────────────────────────────────────────────────────────────────────────────────────

const BADGE: Record<Badge["kind"], { icon: LucideIcon; tone: string; word: string }> = {
  urgent: { icon: SirenIcon, tone: "border-destructive/40 bg-destructive/10 text-destructive-foreground", word: "Urgent" },
  decision: { icon: Hand, tone: "border-warning/50 bg-warning/15 text-warning-foreground", word: "Needs your decision" },
  attention: { icon: CircleDashed, tone: "border-info/40 bg-info/10 text-info-foreground", word: "To look at" },
  working: { icon: LightningIcon, tone: "border-border bg-muted text-muted-foreground", word: "In progress" },
};

/** A badge is words with an icon. The color only reinforces what the words already say. */
function NavBadge({ badge }: { badge: Badge }) {
  const look = BADGE[badge.kind];
  const Icon = look.icon;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none whitespace-nowrap", look.tone)}>
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">{look.word}: </span>
      {badge.label}
    </span>
  );
}

function NotBuilt({ quiet }: { quiet?: boolean }) {
  return quiet ? <span className="sr-only"> (not built yet)</span> : <span className="shrink-0 rounded-full border border-dashed border-border px-1.5 py-0.5 text-[10px] leading-none font-medium whitespace-nowrap text-muted-foreground">Not built yet</span>;
}

// ── Rows ────────────────────────────────────────────────────────────────────────────────────────────

const row = "flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium";
const linked = "text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500";
const current = "bg-brand-950 text-brand-300";

/** A company-wide destination. One that is not built is listed and says so; it is not a link. */
function ItemRow({ item, active, badge, onNavigate }: { item: NavItem; active: boolean; badge?: Badge | null; onNavigate?: () => void }) {
  const Icon = ITEM_ICON[item.id];
  const href = hrefFor(item);
  const inner = (
    <>
      <Icon className={cn("size-[18px] shrink-0", active && "text-brand-300")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {href === null ? <NotBuilt /> : badge ? <NavBadge badge={badge} /> : null}
    </>
  );
  if (href === null) {
    return (
      <span className={cn(row, "text-muted-foreground/70")} aria-disabled="true">
        {inner}
      </span>
    );
  }
  return (
    <Link href={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(row, active ? current : linked)}>
      {inner}
    </Link>
  );
}

/**
 * One agent: a name that opens its overview, a separate arrow that only opens and closes its work
 * tabs, the tabs themselves, and one badge. The two controls never do each other's job.
 */
function AgentRow({ agent, open, active, facts, onToggle, onNavigate }: { agent: AgentNav; open: boolean; active: { agent: AgentId | null; tab: string | null }; facts?: SidebarFacts; onToggle: () => void; onNavigate?: () => void }) {
  const panel = useId();
  const overview = hrefFor(agent.overview);
  const built = agent.workflow === "built";
  const here = active.agent === agent.id;
  const badge = agentBadge(agent.id, facts);
  const name = (
    <>
      <Image src={agentPortrait(agent.id)} alt="" width={48} height={48} aria-hidden className={cn("size-6 shrink-0 rounded-full object-cover ring-1", built ? "ring-brand-500/30" : "opacity-50 grayscale ring-border")} />
      <span className="min-w-0 flex-1 truncate">{agent.label}</span>
    </>
  );
  return (
    <li>
      <div className={cn("flex items-center gap-1 rounded-lg", here && active.tab === null && current)}>
        {overview ? (
          <Link href={overview} onClick={onNavigate} aria-current={here && active.tab === null ? "page" : undefined} className={cn(row, "min-w-0 flex-1", here ? "text-strong" : linked)}>
            {name}
          </Link>
        ) : (
          // No overview page exists for this agent yet, so its name is not a link. It does not toggle the tabs either.
          <span className={cn(row, "min-w-0 flex-1", built ? "text-strong" : "text-muted-foreground/80")}>{name}</span>
        )}
        {built ? badge ? <NavBadge badge={badge} /> : null : <NotBuilt />}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panel}
          aria-label={`${open ? "Hide" : "Show"} ${agent.label}’s work tabs`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        </button>
      </div>
      {open ? (
        <ul id={panel} className="mt-0.5 mb-1.5 ml-[1.35rem] grid gap-0.5 border-l border-border pl-2">
          {agent.tabs.map((tab) => {
            const href = hrefFor(tab);
            const on = here && active.tab === tab.id;
            const tabMark = tabBadge(agent.id, tab.id, facts);
            if (href === null) {
              return (
                <li key={tab.id}>
                  <span className="flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-[13px] text-muted-foreground/70" aria-disabled="true">
                    <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                    {/* Under a built agent the unbuilt tabs are marked one by one; under an unbuilt agent the agent's own mark covers them. */}
                    <NotBuilt quiet={!built} />
                  </span>
                </li>
              );
            }
            return (
              <li key={tab.id}>
                <Link href={href} onClick={onNavigate} aria-current={on ? "page" : undefined} className={cn("flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-[13px] font-medium", on ? current : linked)}>
                  <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                  {tabMark ? <NavBadge badge={tabMark} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

// ── Business selector ───────────────────────────────────────────────────────────────────────────────

export type BusinessOption = { companyId: string; name: string };

/** The active cleaning company. Choosing another changes the whole workspace and its data. */
function BusinessSelector({ company, businesses, activeId, onSwitch }: { company: string; businesses: BusinessOption[]; activeId: string; onSwitch: (companyId: string) => void }) {
  const [open, setOpen] = useState(false);
  const menu = useId();
  const shell = useRef<HTMLDivElement>(null);
  const label = (
    <>
      <LogoMark className="size-7 shrink-0" />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold text-strong">{company}</span>
        <span className="block text-[11px] text-muted-foreground">Selestial</span>
      </span>
    </>
  );
  // With one company there is nothing to choose, so it is shown and not offered as a control.
  if (businesses.length < 2) return <div className="flex items-center gap-2.5 px-4 py-3.5">{label}</div>;
  return (
    <div
      ref={shell}
      className="relative px-2 py-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
      onBlur={(event) => {
        if (!shell.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((before) => !before)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menu}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500"
      >
        {label}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <ul id={menu} role="menu" aria-label="Switch company" className="absolute inset-x-2 top-full z-20 mt-1 grid gap-0.5 rounded-xl border border-border bg-card p-1 shadow-lg">
          {businesses.map((business) => {
            const active = business.companyId === activeId;
            return (
              <li key={business.companyId} role="none">
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setOpen(false);
                    if (!active) onSwitch(business.companyId);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  <span className="min-w-0 flex-1 truncate">{business.name}</span>
                  {active ? <Check className="size-4 shrink-0 text-brand-300" aria-label="Current company" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// ── Department tabs ─────────────────────────────────────────────────────────────────────────────────

/** Choosing a department changes which agents are listed. It goes nowhere and filters nothing else. */
function DepartmentTabs({ selected, onSelect, panelId }: { selected: DepartmentId; onSelect: (department: DepartmentId) => void; panelId: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (step: number) => {
    const index = DEPARTMENTS.findIndex((department) => department.id === selected);
    const next = DEPARTMENTS[(index + step + DEPARTMENTS.length) % DEPARTMENTS.length];
    onSelect(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Department"
      className="grid grid-cols-3 gap-0.5 rounded-xl border border-border bg-muted p-0.5"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") move(1);
        if (event.key === "ArrowLeft") move(-1);
      }}
    >
      {DEPARTMENTS.map((department) => {
        const on = department.id === selected;
        return (
          <button
            key={department.id}
            ref={(node) => {
              refs.current[department.id] = node;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(department.id)}
            className={cn("min-h-8 rounded-[10px] px-1.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-brand-500", on ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
          >
            {department.label}
          </button>
        );
      })}
    </div>
  );
}

// ── The sidebar ─────────────────────────────────────────────────────────────────────────────────────

const heading = "px-2.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase";

/**
 * The sidebar, in its fixed order: business, department tabs, the four items that are always there,
 * the selected department's agents, the shared records, and Settings.
 *
 * `onNavigate` is called when a destination is chosen, so a phone's drawer can close. Choosing a
 * department or pressing an agent's arrow does not call it.
 */
export function Sidebar({
  company,
  companyId,
  businesses,
  onSwitchBusiness,
  role,
  facts,
  onNavigate,
}: {
  company: string;
  companyId: string;
  businesses: BusinessOption[];
  onSwitchBusiness: (companyId: string) => void;
  role: Role;
  /** The record's facts behind the badges. Undefined while loading: no badge is shown, never a guessed one. */
  facts?: SidebarFacts;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { state, update } = useSidebarStore();
  const active = activeFor(pathname);
  const panelId = useId();
  const department = DEPARTMENTS.find((entry) => entry.id === state.department)!;
  // Showing a link is a courtesy. Whether a person may read or change anything is decided in Convex.
  const shown = (items: readonly NavItem[]) => items.filter((item) => mayShow(item, role));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <BusinessSelector company={company} businesses={businesses} activeId={companyId} onSwitch={onSwitchBusiness} />

      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pt-1 pb-3">
        <DepartmentTabs selected={state.department} onSelect={(next) => update((before) => selectDepartment(before, next))} panelId={panelId} />

        <ul className="grid gap-0.5">
          {shown(PERSISTENT_ITEMS).map((item) => (
            <li key={item.id}>
              <ItemRow item={item} active={active.item === item.id} badge={item.id === "approvals" ? approvalsBadge(facts) : null} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>

        <section id={panelId} role="tabpanel" aria-label={`${department.label} agents`}>
          <h2 className={heading}>{department.label}</h2>
          <ul className="mt-1.5 grid gap-0.5">
            {agentsIn(state.department).map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                open={state.expanded.includes(agent.id)}
                active={active}
                facts={facts}
                onToggle={() => update((before) => toggleAgent(before, agent.id))}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </section>

        <section aria-label="Company records">
          <h2 className={heading}>Company</h2>
          <ul className="mt-1.5 grid gap-0.5">
            {shown(SHARED_ITEMS).map((item) => (
              <li key={item.id}>
                <ItemRow item={item} active={active.item === item.id} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </section>

        <ul className="mt-auto grid gap-0.5 border-t border-border pt-3">
          {shown(FOOTER_ITEMS).map((item) => (
            <li key={item.id}>
              <ItemRow item={item} active={active.item === item.id} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
