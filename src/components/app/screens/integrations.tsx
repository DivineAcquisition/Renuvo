"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { AgentAvatar, eyebrow } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { IntegrationMark } from "@/components/app/integration-mark";
import { GoogleToolPanel, useConnectGoogle, type Feature } from "@/components/app/integrations/google-tool";
import { InboxesPanel } from "@/components/app/integrations/inboxes";
import { PageHeader, Panel } from "@/components/app/shell";
import { Sheet, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { messageOf } from "@/components/app/form";
import { ArrowRight, CheckCircle2, Lock, Plug, Search, Sparkles, X } from "@/components/icons";
import { mapsKey } from "@/lib/app/address";
import { CATEGORIES, INTEGRATIONS, integrationsFor, type Integration } from "@/lib/app/integrations";
import { AGENTS, type AgentId } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

const AGENT_LABEL = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.label])) as Record<AgentId, string>;

type Overview = FunctionReturnType<typeof api.integrations.overview>;
type Live = { state: "connected" | "in_progress" | "ready" | "not_set_up"; detail: string | null };

function liveOf(integration: Integration, overview: Overview | undefined): Live | null {
  if (integration.status.kind !== "available" || !overview) return null;
  return (overview.live as Record<string, Live | undefined>)[integration.id] ?? null;
}

/** Where an integration stands, as a dot and words, the same way an agent's state is shown. */
function Status({ integration, live, requested }: { integration: Integration; live: Live | null; requested: boolean }) {
  const { status } = integration;
  const look =
    status.kind === "available"
      ? live?.state === "connected"
        ? { dot: "bg-success", word: live.detail ? `Connected · ${live.detail}` : "Connected", pulse: false, title: undefined }
        : live?.state === "in_progress"
          ? live.detail === "Reconnect needed"
            ? { dot: "bg-destructive", word: "Needs attention", pulse: true, title: "Access ended. Reconnect to keep it working." }
            : live.detail === "Choose what Selestial may use"
              ? { dot: "bg-warning", word: "Setup needed", pulse: false, title: "Choose what Selestial may use." }
              : { dot: "bg-warning", word: "Being set up", pulse: true, title: undefined }
          : live?.state === "not_set_up"
            ? { dot: "bg-warning", word: "Setup needed", pulse: false, title: "Selestial's team needs to finish setting this up for your account." }
            : { dot: "bg-muted-foreground/50", word: "Not connected", pulse: false, title: undefined }
      : status.kind === "built_in"
        ? mapsKey()
          ? { dot: "bg-success", word: "Built in", pulse: false, title: undefined }
          : { dot: "bg-warning", word: "Setup needed", pulse: false, title: "Selestial's team needs to finish setting this up for your account." }
        : requested
          ? { dot: "bg-brand-500/70", word: "Requested", pulse: false, title: "Your company asked for this. Selestial builds the most-requested first." }
          : { dot: "bg-muted-foreground/50", word: "Coming soon", pulse: false, title: undefined };
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground" title={look.title}>
      <span className={cn("size-2 shrink-0 rounded-full", look.dot, look.pulse && "live-pulse")} aria-hidden />
      <span className="truncate">{look.word}</span>
    </span>
  );
}

const action = "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50";
const primary = cn(action, "bg-brand-500 text-white shadow-sm hover:bg-brand-600");
const secondary = cn(action, "border border-border bg-card text-strong hover:bg-muted");

/**
 * What a person can do from the card. Built: go to where it is set up. Planned: the Owner asks for it.
 * Built in: nothing to do. The server checks the Owner again, so the button only saves a trip.
 */
/** Google cards connect their own tool: Drive, Calendar, Business Profile, or Ads (Local Services leads come through Ads). */
const GOOGLE_FEATURE: Record<string, Feature | undefined> = { "google-drive": "drive", "google-calendar": "calendar", "google-business-profile": "business_profile", "google-ads": "ads", "google-local-services-ads": "ads" };
const CARD_OF_FEATURE: Record<string, string> = { drive: "google-drive", calendar: "google-calendar", business_profile: "google-business-profile", ads: "google-ads", conversions: "google-ads" };

/** A Google card's button: Connect goes straight to Google for that tool; once connected, Manage opens it. */
function GoogleCardAction({ feature, live, owner, onOpen, name }: { feature: Feature; live: Live | null; owner: boolean; onOpen: () => void; name: string }) {
  const { busy, error, connect } = useConnectGoogle(feature);
  const fresh = live?.state === "ready";
  if (fresh && !owner) return <p className="text-xs text-muted-foreground">Not connected yet. Your Owner can connect it.</p>;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {fresh ? (
          <button type="button" disabled={busy} onClick={() => connect()} className={primary}>
            <Plug className="size-3.5" aria-hidden />
            {busy ? "Opening Google…" : `Connect ${name}`}
          </button>
        ) : (
          <button type="button" onClick={onOpen} className={live?.state === "in_progress" && owner ? primary : secondary}>
            {live?.state === "in_progress" && owner ? "Finish setup" : owner ? "Manage" : "View"}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CardAction({ integration, live, requested, onOpen }: { integration: Integration; live: Live | null; requested: { requestedAt: number } | null; onOpen: () => void }) {
  const { companyId, role } = useCompany();
  const ask = useMutation(api.integrations.request);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = role === "owner";
  const { status } = integration;

  if (status.kind === "built_in") return <p className="text-xs text-muted-foreground">Nothing to connect. It works on every address field.</p>;

  if (status.kind === "available") {
    if (live?.state === "not_set_up") return <p className="text-xs text-muted-foreground">Selestial still has to switch this on for your account.</p>;
    const feature = GOOGLE_FEATURE[integration.id];
    if (feature) return <GoogleCardAction feature={feature} live={live} owner={owner} onOpen={onOpen} name={integration.name} />;
    // Gmail: connected inboxes are managed right here, with their purposes (convex/inboxes.ts).
    if (integration.id === "gmail") {
      const label = live?.state === "connected" || live?.state === "in_progress" ? (owner ? "Manage inboxes" : "View inboxes") : owner ? "Connect Gmail" : "View";
      return (
        <button type="button" onClick={onOpen} className={live?.state === "in_progress" && owner ? primary : live?.state === "ready" && owner ? primary : secondary}>
          {live?.state === "ready" && owner ? <Plug className="size-3.5" aria-hidden /> : null}
          {label}
          <ArrowRight className="size-3.5" aria-hidden />
        </button>
      );
    }
    const label = live?.state === "connected" ? "Manage" : live?.state === "in_progress" ? "See progress" : owner ? `Connect ${integration.name.replace(/^Business /, "")}` : "See setup";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={status.href} className={live?.state === "ready" && owner ? primary : secondary}>
          {live?.state === "ready" && owner ? <Plug className="size-3.5" aria-hidden /> : null}
          {label}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <span className="text-[11px] text-muted-foreground">In {status.setUpWhere}</span>
      </div>
    );
  }

  if (requested) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        Requested {new Date(requested.requestedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}. Selestial builds the most-requested first.
      </p>
    );
  }
  if (!owner) return <p className="text-xs text-muted-foreground">Coming soon. Your Owner can ask Selestial for it.</p>;
  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          ask({ companyId, integrationId: integration.id })
            .catch((caught: unknown) => setError(messageOf(caught)))
            .finally(() => setBusy(false));
        }}
        className={cn(secondary, "w-fit")}
      >
        <Sparkles className="size-3.5 text-brand-300" aria-hidden />
        {busy ? "Requesting…" : "Request early access"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </div>
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

function IntegrationCard({ integration, highlight, overview, onOpen }: { integration: Integration; highlight: AgentId | null; overview: Overview | undefined; onOpen: () => void }) {
  const live = liveOf(integration, overview);
  const requested = overview?.requested.find((row) => row.integrationId === integration.id) ?? null;
  return (
    <li className={cn("group flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-brand-500/40", live?.state === "connected" ? "border-success/40" : "border-border")}>
      <div className="flex items-center gap-3">
        <IntegrationMark id={integration.id} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate font-medium text-strong">{integration.name}</h3>
          <Status integration={integration} live={live} requested={Boolean(requested)} />
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{integration.does}</p>
      <Abilities can={integration.can} />
      {integration.note ? <p className="text-xs leading-relaxed text-muted-foreground">{integration.note}</p> : null}
      <div className="mt-auto grid min-w-0 grid-cols-1 gap-3 border-t border-border pt-3">
        <CardAction integration={integration} live={live} requested={requested} onOpen={onOpen} />
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

export function IntegrationsScreen({ embedded = false }: { embedded?: boolean }) {
  const { companyId, role } = useCompany();
  const overview = useQuery(api.integrations.overview, { companyId });
  const params = useSearchParams();
  // Coming back from Google (?tool=<feature>&result=…) opens that tool with the outcome.
  const returned = params.get("tool");
  const [openCard, setOpenCard] = useState<string | null>(() => (returned ? (returned === "gmail" ? "gmail" : (CARD_OF_FEATURE[returned] ?? null)) : null));
  const [result, setResult] = useState<string | null>(() => params.get("result"));
  const openFeature = openCard ? GOOGLE_FEATURE[openCard] : undefined;
  const openName = INTEGRATIONS.find((row) => row.id === openCard)?.name ?? "";
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
      {embedded ? null : <PageHeader title="Integrations" lead="The accounts and services Selestial works with on your behalf, what each one lets your agents do, and which agents use it." />}

      <section className="relative mb-5 overflow-hidden rounded-2xl border border-brand-500/30 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--color-brand-500)_9%,transparent),transparent_55%),var(--card)] p-5 sm:p-6">
        <p className={eyebrow}>Your team&rsquo;s tools</p>
        <h2 className="mt-1 font-heading text-xl tracking-tight text-strong sm:text-2xl">Give your team the tools to do the work.</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every connection is a tool an agent can use for you. Pick an agent to see what it works with. What each agent may do with a tool is set action by action in{" "}
          <Link href="/app/settings/agents" className="font-medium text-brand-300 underline-offset-4 hover:underline">
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
          {role === "owner" ? "Only you, as the Owner, can connect, disconnect or request an integration. Everyone in your company can see what is connected." : "Only the Owner can connect, disconnect or request an integration. You can see what is connected."}
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
        <div className="grid grid-cols-1 gap-5">
          {CATEGORIES.map((category) => {
            const inGroup = visible.filter((integration) => integration.category === category.id);
            if (inGroup.length === 0) return null;
            return (
              <Panel key={category.id} title={category.label} action={<span className="text-xs text-muted-foreground">{inGroup.length === 1 ? "1 tool" : `${inGroup.length} tools`}</span>}>
                <p className="mb-4 text-sm text-muted-foreground">{category.lead}</p>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {inGroup.map((integration) => (
                    <IntegrationCard key={integration.id} integration={integration} highlight={agent} overview={overview} onOpen={() => { setResult(null); setOpenCard(integration.id); }} />
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}
      <Sheet open={openFeature !== undefined || openCard === "gmail"} onOpenChange={(next) => (next ? undefined : setOpenCard(null))}>
        <SheetPopup side="right" className="max-w-xl bg-card">
          <SheetHeader>
            <SheetTitle>{openCard === "gmail" ? "Connected inboxes" : openName}</SheetTitle>
          </SheetHeader>
          <SheetPanel>{openCard === "gmail" ? <InboxesPanel result={result} /> : openFeature ? <GoogleToolPanel feature={openFeature} result={result} /> : null}</SheetPanel>
        </SheetPopup>
      </Sheet>
    </>
  );
}
