"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useCompany } from "@/components/app/company";
import { AgentAvatar, STATE } from "@/components/app/agent";
import { SectionMark } from "@/components/app/settings/marks";
import { AGENTS } from "@/lib/app/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { legacyTarget, SETTINGS_GROUPS, SETTINGS_ROOT, sectionsFor, type SettingsSection } from "@/lib/app/settings";

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
                  <Link href={row.path} className="group flex h-full gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 transition-all hover:-translate-y-px hover:border-brand-500/40 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-brand-500/40">
                    <SectionMark id={row.id} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-strong">{row.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{row.purpose}</span>
                      <span className="mt-2 block text-xs text-muted-foreground/80">{row.access}</span>
                    </span>
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

/** The eight agents and where each stands. The four not built yet are shown as they are: faded, with nothing to configure. */
function AgentCrew() {
  const { companyId } = useCompany();
  const team = useQuery(api.overview.agents, { companyId });
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Your agents">
      {AGENTS.map((agent) => {
        const live = agent.backendAgent ? team?.agents.find((row) => row.agent === agent.backendAgent) : undefined;
        const state = agent.backendAgent === null ? "not_built" : live?.state;
        const words = state ? STATE[state].label : null;
        return (
          <li key={agent.id}>
            <Link href={`${SETTINGS_ROOT}/agents`} className="flex items-center gap-2.5 rounded-xl border border-border bg-card/80 px-2.5 py-2 transition-colors hover:border-brand-500/40 focus-visible:outline-2 focus-visible:outline-brand-500/40">
              <AgentAvatar agent={agent.id} state={state} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-strong">{agent.label}</span>
                <span className="block truncate text-[0.6875rem] text-muted-foreground">{words ?? (agent.backendAgent && !team ? "Loading…" : "")}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SettingsOverview() {
  const { role, name } = useCompany();
  useLegacyHash();
  return (
    <div className="grid gap-6">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand-500/10 blur-3xl" />
        <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-600 uppercase">Settings</p>
        <h1 className="mt-1 font-heading text-2xl tracking-tight text-strong">How {name} runs, and what its agents may do</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Your rules live here, and the agents follow them. Everyone can read; the Owner makes changes. Agents only act inside the permissions you set, and anything not built yet says so.
        </p>
        <div className="mt-4">
          <AgentCrew />
        </div>
      </section>
      <OverviewGrid sections={sectionsFor(role)} />
    </div>
  );
}
