"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { AgentAvatar, eyebrow } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { IntegrationMark } from "@/components/app/integration-mark";
import { PageHeader, Panel } from "@/components/app/shell";
import { Lock, Search, X } from "@/components/icons";
import { mapsKey } from "@/lib/app/address";
import { CATEGORIES, INTEGRATIONS, integrationsFor, type Integration } from "@/lib/app/integrations";
import { AGENTS, type AgentId } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

const AGENT_LABEL = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.label])) as Record<AgentId, string>;

/** Where an integration stands, as a dot and words, the same way an agent's state is shown. */
function Status({ integration }: { integration: Integration }) {
  const { status } = integration;
  const look =
    status.kind === "available"
      ? { dot: "bg-success", word: "Ready to connect", pulse: false, title: undefined }
      : status.kind === "built_in"
        ? mapsKey()
          ? { dot: "bg-success", word: "Built in", pulse: false, title: undefined }
          : { dot: "bg-warning", word: "Not switched on yet", pulse: true, title: "Built, and waiting for Selestial to switch it on." }
        : { dot: "bg-muted-foreground/50", word: "Coming soon", pulse: false, title: `Planned for phase ${status.phase}` };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground" title={look.title}>
      <span className={cn("size-2 rounded-full", look.dot, look.pulse && "live-pulse")} aria-hidden />
      {look.word}
    </span>
  );
}

/** What the tool lets an agent do, written like the commands an agent is given. */
function Abilities({ can }: { can: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="What agents can do with it">
      {can.map((ability) => (
        <li key={ability} className="rounded-md border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] leading-snug text-muted-foreground">
          <span className="text-brand-500" aria-hidden>
            ›{" "}
          </span>
          {ability}
        </li>
      ))}
    </ul>
  );
}

function UsedBy({ agents, highlight }: { agents: AgentId[]; highlight: AgentId | null }) {
  if (agents.length === 0) return <p className="text-xs text-muted-foreground">Works in the background. No agent needed.</p>;
  const names = agents.map((agent) => AGENT_LABEL[agent]).join(", ");
  return (
    <div className="flex items-center gap-2">
      <span className="flex shrink-0 -space-x-1.5" aria-hidden>
        {agents.map((agent) => (
          <span key={agent} className={cn("rounded-full ring-2 ring-card", highlight === agent && "z-10 ring-brand-500")}>
            <AgentAvatar agent={agent} size="xs" />
          </span>
        ))}
      </span>
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        <span className="sr-only">Used by </span>
        {names}
      </span>
    </div>
  );
}

function IntegrationCard({ integration, highlight }: { integration: Integration; highlight: AgentId | null }) {
  return (
    <li className="group flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-brand-500/40">
      <div className="flex items-center gap-3">
        <IntegrationMark id={integration.id} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate font-medium text-strong">{integration.name}</h3>
          <Status integration={integration} />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{integration.does}</p>
      <Abilities can={integration.can} />
      {integration.note ? <p className="text-xs leading-relaxed text-muted-foreground">{integration.note}</p> : null}
      <div className="mt-auto border-t border-border pt-3">
        <UsedBy agents={integration.agents} highlight={highlight} />
      </div>
    </li>
  );
}

/** One agent as a button: its face, how many tools it works with, and their logos. Picking it filters the page. */
function AgentTools({ agent, selected, onSelect }: { agent: AgentId; selected: boolean; onSelect: () => void }) {
  const tools = integrationsFor(agent);
  const shown = tools.slice(0, 5);
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "flex h-full w-full flex-col gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          selected ? "border-brand-500/60 bg-brand-500/10" : "border-border bg-card/80 hover:border-brand-500/40 hover:bg-card",
        )}
      >
        <span className="flex items-center gap-2.5">
          <AgentAvatar agent={agent} size="md" />
          <span className="min-w-0">
            <span className="block text-sm leading-tight font-medium text-strong">{AGENT_LABEL[agent]}</span>
            <span className="block text-xs text-muted-foreground">{tools.length === 1 ? "1 tool" : `${tools.length} tools`}</span>
          </span>
        </span>
        <span className="flex items-center -space-x-1.5" aria-hidden>
          {shown.map((tool) => (
            <IntegrationMark key={tool.id} id={tool.id} size="sm" className="ring-2 ring-card" />
          ))}
          {tools.length > shown.length ? <span className="z-10 flex size-6 items-center justify-center rounded-md border border-border bg-muted text-[10px] font-semibold text-muted-foreground ring-2 ring-card">+{tools.length - shown.length}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function IntegrationsScreen() {
  const { role } = useCompany();
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    return INTEGRATIONS.filter((integration) => (!agent || integration.agents.includes(agent)) && (!words || `${integration.name} ${integration.does} ${integration.can.join(" ")}`.toLowerCase().includes(words)));
  }, [agent, query]);
  const filtered = agent !== null || query.trim() !== "";
  const summary = agent
    ? `${AGENT_LABEL[agent]} works with ${visible.length === 1 ? "1 tool" : `${visible.length} tools`}${query.trim() ? " that match" : ""}.`
    : query.trim()
      ? `${visible.length === 1 ? "1 tool matches" : `${visible.length} tools match`}.`
      : `${INTEGRATIONS.length} tools your team can use.`;

  return (
    <>
      <PageHeader title="Integrations" lead="The accounts and services Selestial works with on your behalf, what each one lets your agents do, and which agents use it." />

      <section className="relative mb-5 overflow-hidden rounded-2xl border border-brand-500/30 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--color-brand-500)_9%,transparent),transparent_55%),var(--card)] p-5 sm:p-6">
        <p className={eyebrow}>Your team&rsquo;s tools</p>
        <h2 className="mt-1 font-heading text-xl tracking-tight text-strong sm:text-2xl">Give your team the tools to do the work.</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every connection is a tool an agent can use for you. Pick an agent to see what it works with. What each agent may do with a tool is set action by action in{" "}
          <Link href="/app/settings" className="font-medium text-brand-300 underline-offset-4 hover:underline">
            Agent permissions
          </Link>
          , and anything that moves money starts on review.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2.5 xl:grid-cols-4" aria-label="Filter by agent">
          {AGENTS.map((item) => (
            <AgentTools key={item.id} agent={item.id} selected={agent === item.id} onSelect={() => setAgent((current) => (current === item.id ? null : item.id))} />
          ))}
        </ul>
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {role === "owner" ? "Only you, as the Owner, can connect or disconnect an integration. Everyone in your company can see what is connected." : "Only the Owner can connect or disconnect an integration. You can see what is connected."}
        </p>
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Find an integration</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a tool, like Drive or reviews"
            className="block min-h-10 w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30"
          />
        </label>
        <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
          {summary}
          {filtered ? (
            <button
              type="button"
              onClick={() => {
                setAgent(null);
                setQuery("");
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500"
            >
              <X className="size-3" aria-hidden />
              Show all
            </button>
          ) : null}
        </p>
      </div>

      {visible.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted-foreground">No tool matches that. Try another word, or show all.</p>
        </Panel>
      ) : (
        <div className="grid gap-5">
          {CATEGORIES.map((category) => {
            const inGroup = visible.filter((integration) => integration.category === category.id);
            if (inGroup.length === 0) return null;
            return (
              <Panel key={category.id} title={category.label} action={<span className="text-xs text-muted-foreground">{inGroup.length === 1 ? "1 tool" : `${inGroup.length} tools`}</span>}>
                <p className="mb-4 text-sm text-muted-foreground">{category.lead}</p>
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {inGroup.map((integration) => (
                    <IntegrationCard key={integration.id} integration={integration} highlight={agent} />
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
