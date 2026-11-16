"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { SectionMark } from "@/components/app/settings/marks";
import { SETTINGS_GROUPS, SETTINGS_ROOT, searchSections, sectionForPath, sectionsFor, type SettingsSection } from "@/lib/app/settings";
import { cn } from "@/lib/utils";

/** The list itself, free of hooks, so it renders the same on the server and is easy to check. */
export function SettingsNavList({ sections, activePath, onNavigate }: { sections: readonly SettingsSection[]; activePath: string; onNavigate?: () => void }) {
  if (sections.length === 0) return <p className="px-2 py-3 text-sm text-muted-foreground">Nothing in Settings matches that.</p>;
  return (
    <div className="grid gap-4">
      {SETTINGS_GROUPS.map((group) => {
        const rows = sections.filter((row) => row.group === group.id);
        if (rows.length === 0) return null;
        return (
          <div key={group.id}>
            <p className="px-2 text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</p>
            <ul className="mt-1 grid gap-0.5">
              {rows.map((row) => {
                const active = activePath === row.path || activePath.startsWith(`${row.path}/`);
                return (
                  <li key={row.id}>
                    <Link
                      href={row.path}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-brand-500/40", active ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted hover:text-strong")}
                    >
                      <SectionMark id={row.id} size="sm" />
                      {row.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Secondary navigation for Settings. Always beside the page on a wide screen; behind a button on a
 * phone. Only the sections the signed-in role may open are listed, and a search narrows them.
 */
export function SettingsNav() {
  const { role } = useCompany();
  const pathname = usePathname() ?? SETTINGS_ROOT;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const panel = useId();
  const sections = useMemo(() => searchSections(query, sectionsFor(role)), [query, role]);
  const current = sectionForPath(pathname);
  return (
    <nav aria-label="Settings" className="rounded-2xl border border-border bg-card p-3 lg:sticky lg:top-20 lg:self-start">
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <Link href={SETTINGS_ROOT} className="text-sm font-medium text-strong">
          {current ? current.label : "Settings"}
        </Link>
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen((value) => !value)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-strong">
          {open ? "Close" : "All settings"}
        </button>
      </div>
      <div id={panel} className={cn("mt-3 lg:mt-0 lg:block", open ? "block" : "hidden")}>
        <Link
          href={SETTINGS_ROOT}
          aria-current={pathname === SETTINGS_ROOT ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={cn("mb-3 hidden rounded-lg px-2.5 py-1.5 text-sm lg:block", pathname === SETTINGS_ROOT ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground hover:bg-muted hover:text-strong")}
        >
          Overview
        </Link>
        <label className="sr-only" htmlFor={`${panel}-search`}>
          Search settings
        </label>
        <input
          id={`${panel}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings"
          className="mb-3 block min-h-9 w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30"
        />
        <SettingsNavList sections={sections} activePath={pathname} onNavigate={() => setOpen(false)} />
      </div>
    </nav>
  );
}
