"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useCompany } from "@/components/app/company";
import { PageHeader } from "@/components/app/shell";
import { legacyTarget, SETTINGS_GROUPS, sectionsFor, type SettingsSection } from "@/lib/app/settings";

/** The overview's cards, without hooks. */
export function OverviewGrid({ sections }: { sections: readonly SettingsSection[] }) {
  return (
    <div className="grid gap-6">
      {SETTINGS_GROUPS.map((group) => {
        const rows = sections.filter((row) => row.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`} className="mb-2 text-sm font-semibold text-strong">
              {group.label}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={row.path} className="group block h-full rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/40">
                    <span className="text-sm font-semibold text-strong">{row.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{row.purpose}</span>
                    <span className="mt-2 block text-xs text-muted-foreground/80">{row.access}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Settings used to be one long page with parts linked by a hash. A hash never reaches the server, so
 * the old links are carried to the page that holds that part now, here in the browser.
 */
function useLegacyHash() {
  const router = useRouter();
  useEffect(() => {
    const target = legacyTarget(window.location.hash);
    if (target) router.replace(target);
  }, [router]);
}

export function SettingsOverview() {
  const { role } = useCompany();
  useLegacyHash();
  return (
    <>
      <PageHeader title="Settings" lead="How the company works, who can do what, what the agents may do, and what is connected. Everyone can read; the Owner makes changes." />
      <OverviewGrid sections={sectionsFor(role)} />
    </>
  );
}
