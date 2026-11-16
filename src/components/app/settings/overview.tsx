"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useCompany } from "@/components/app/company";
import { ChevronRight } from "@/components/icons";
import { SectionMark } from "@/components/app/settings/marks";
import { legacyTarget, mayOpen, menuSections, sectionById, SETTINGS_GROUPS, sectionsFor, type SettingsRole, type SettingsSection } from "@/lib/app/settings";

/** The jobs owners come to Settings for most, in their words, each pointing at the page that does it. */
const COMMON_TASKS: readonly { section: string; task: string; detail: string; ownerOnly?: boolean; hash?: string }[] = [
  { section: "business", task: "Change your booking hours", detail: "Set the days and times customers can book.", ownerOnly: true },
  { section: "services", task: "Update services and prices", detail: "Add a service or change a starting price.", ownerOnly: true },
  { section: "people", task: "Invite a team member", detail: "Give someone in your office access.", ownerOnly: true },
  { section: "agents", task: "Decide what your agents may do", detail: "Choose what needs your approval first.", ownerOnly: true },
  { section: "integrations", task: "Connect Google or Gmail", detail: "Calendar, reviews, ads leads and your hiring inbox.", ownerOnly: true },
  { section: "billing", task: "Check your plan and credits", detail: "Credits left, usage and invoices." },
];

/** What a role sees first: the common tasks it can actually do. */
export function commonTasksFor(role: SettingsRole) {
  return COMMON_TASKS.filter((row) => {
    const section = sectionById(row.section);
    if (!section || !mayOpen(section, role)) return false;
    return !row.ownerOnly || role === "owner";
  });
}

/** The overview's grouped list, without hooks. Compact rows, not a wall of cards. */
export function OverviewGrid({ sections }: { sections: readonly SettingsSection[] }) {
  return (
    <div className="grid items-start gap-5 md:grid-cols-2">
      {SETTINGS_GROUPS.map((group) => {
        const rows = sections.filter((row) => row.group === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} aria-labelledby={`group-${group.id}`} className="rounded-2xl border border-border bg-card">
            <h2 id={`group-${group.id}`} className="border-b border-border px-4 py-2.5 text-sm font-semibold text-strong">
              {group.label}
            </h2>
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link href={row.path} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500">
                    <SectionMark id={row.id} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-strong">{row.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{row.purpose}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
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
  const tasks = commonTasksFor(role);
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="font-heading text-2xl tracking-tight text-strong">Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          {role === "owner" ? "Set up how your business runs and what your agents may do. Changes take effect once you save them." : "See how your business is set up. Only the Owner can change most settings."}
        </p>
      </header>

      {tasks.length > 0 ? (
        <section aria-labelledby="common-tasks">
          <h2 id="common-tasks" className="mb-2 text-sm font-semibold text-strong">
            Common tasks
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {tasks.map((row) => {
              const section = sectionById(row.section)!;
              return (
                <li key={row.task}>
                  <Link
                    href={section.path}
                    className="group flex h-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 transition-colors hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500"
                  >
                    <SectionMark id={section.id} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-strong">{row.task}</span>
                      <span className="block text-xs text-muted-foreground">{row.detail}</span>
                    </span>
                    <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="all-settings">
        <h2 id="all-settings" className="mb-2 text-sm font-semibold text-strong">
          All settings
        </h2>
        <OverviewGrid sections={menuSections(sectionsFor(role))} />
      </section>
    </div>
  );
}
