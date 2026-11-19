import Image from "next/image";
import Link from "next/link";

import { AgentScene, Mock } from "@/components/agents/scene";
import { ArrowRight, CheckCircle2, Hand, Sparkles } from "@/components/icons";
import { EarlyAccessLink } from "@/components/marketing/chrome";
import { AGENT_PAGE_IDS, AGENT_PAGES, agentPagePath, type AgentPage, type AgentPageId } from "@/lib/marketing/agent-pages";
import { marketingDisplayTitle, marketingLead, marketingPageGutter, marketingSectionTitle } from "@/lib/marketing/ui";
import { sectionLabel } from "@/lib/ui";
import { cn } from "@/lib/utils";

const shell = "mx-auto w-full max-w-6xl";

export function StatusPill({ status }: { status: AgentPage["status"] }) {
  return status === "live" ? (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success-foreground">
      <span className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" aria-hidden />
      Working today
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 px-2.5 py-0.5 text-xs font-medium text-brand-600">
      <Sparkles className="size-3" aria-hidden />
      Coming soon
    </span>
  );
}

export function Portrait({ id, size }: { id: AgentPageId; size: number }) {
  return <Image src={`/agents/${id}.webp`} alt="" width={size * 2} height={size * 2} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover ring-1 ring-border" />;
}

/** One agent's public page: what it does, watching it work, what it handles, what stays with you, and who it works with. */
export function AgentPageView({ agent }: { agent: AgentPage }) {
  const live = agent.status === "live";
  return (
    <>
      <section className={cn(marketingPageGutter, "relative overflow-hidden pt-10 pb-14 sm:pt-16 sm:pb-20")}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(60%_60%_at_70%_0%,color-mix(in_oklab,var(--color-brand-500)_16%,transparent),transparent)]" />
        <div className={cn(shell, "grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]")}>
          <div className="min-w-0">
            <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
              <Link href="/agents" className="hover:text-strong">
                Agents
              </Link>
              <span aria-hidden> / </span>
              <span className="text-strong">{agent.name}</span>
            </nav>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <StatusPill status={agent.status} />
              <span className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">{agent.department}</span>
            </div>
            <h1 className={cn(marketingDisplayTitle, "mt-4")}>{agent.name}</h1>
            <p className="mt-3 font-heading text-xl tracking-tight text-strong sm:text-2xl">{agent.headline}</p>
            <p className={cn(marketingLead, "mt-4")}>{agent.pitch}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <EarlyAccessLink position={`agent-${agent.id}`}>{live ? "Get early access" : `Ask for ${agent.name} early`}</EarlyAccessLink>
              <a href="#watch" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-[15px] font-medium text-strong hover:bg-muted">
                Watch it work
                <ArrowRight className="size-4" aria-hidden />
              </a>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">{agent.plan}</p>
          </div>
          <div className="relative mx-auto grid place-items-center">
            <div aria-hidden className="absolute size-72 rounded-full bg-brand-500/15 blur-3xl sm:size-80" />
            <div aria-hidden className="absolute size-64 rounded-full border border-brand-500/20 motion-safe:animate-[spin_40s_linear_infinite] sm:size-72">
              <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full bg-brand-400 shadow-[0_0_12px_var(--color-brand-400)]" />
            </div>
            <div className="relative rounded-full bg-card p-2 shadow-[0_30px_60px_-30px_rgba(104,56,239,0.6)] ring-1 ring-border">
              <Portrait id={agent.id} size={200} />
            </div>
          </div>
        </div>
      </section>

      <section id="watch" className={cn(marketingPageGutter, "scroll-mt-24 pb-16 sm:pb-24")}>
        <div className={shell}>
          <p className={cn(sectionLabel, "mb-3")}>Watch it work</p>
          <h2 className={marketingSectionTitle}>{live ? `${agent.name}, start to finish` : `How ${agent.name} will work`}</h2>
          <div className="mt-8">
            <AgentScene agent={agent} footer={live ? "It works within the limits you set, and brings back anything that needs your judgment." : "It will work within the limits you set, like every Selestial agent."} />
          </div>
        </div>
      </section>

      <section className={cn(marketingPageGutter, "border-t border-border py-16 sm:py-24")}>
        <div className={shell}>
          <p className={cn(sectionLabel, "mb-3")}>{live ? "What it handles" : "What it will handle"}</p>
          <h2 className={marketingSectionTitle}>{live ? `${agent.name}, day to day` : `What ${agent.name} will do`}</h2>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {agent.capabilities.map((capability) => (
              <li key={capability.title} className="grid content-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
                <div aria-hidden className="h-32 overflow-hidden rounded-xl border border-border bg-background p-3">
                  <Mock kind={capability.mock} />
                </div>
                <div className="grid gap-1 px-1 pb-1">
                  <p className="font-heading text-base tracking-tight text-strong">{capability.title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{capability.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={cn(marketingPageGutter, "border-t border-border py-16 sm:py-24")}>
        <div className={cn(shell, "grid gap-6 lg:grid-cols-2")}>
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <p className="flex items-center gap-2 text-sm font-semibold text-strong">
              <Hand className="size-4 text-brand-600" aria-hidden />
              {live ? "Always brought back to you" : "Will always bring back to you"}
            </p>
            <ul className="mt-4 grid gap-3">
              {agent.bringsToYou.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[15px] text-strong">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-sm text-muted-foreground">You decide how much it does on its own. Every action is recorded, and you can step in at any point.</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <p className="text-sm font-semibold text-strong">Works with</p>
            <ul className="mt-4 grid gap-3">
              {agent.handoffs.map((handoff) => {
                const other = AGENT_PAGES[handoff.agent];
                return (
                  <li key={handoff.agent}>
                    <Link href={agentPagePath(other.id)} className="group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 hover:border-brand-500/40">
                      <Portrait id={other.id} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-strong">{other.name}</span>
                        <span className="block text-sm text-muted-foreground">{handoff.what}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-brand-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </section>

      <section className={cn(marketingPageGutter, "border-t border-border py-16 sm:py-24")}>
        <div className={shell}>
          <p className={cn(sectionLabel, "mb-3")}>The rest of the team</p>
          <AgentStrip except={agent.id} />
          <div className="mt-14 grid justify-items-center gap-4 rounded-3xl border border-border bg-card px-6 py-12 text-center shadow-sm">
            <h2 className={cn(marketingSectionTitle, "max-w-2xl")}>Find out what your cleaning business can delegate.</h2>
            <p className={cn(marketingLead, "mx-auto")}>Tell us how your company operates, and we&apos;ll show you where {agent.name} and the rest of the team could help.</p>
            <EarlyAccessLink position={`agent-${agent.id}-footer`}>Start the assessment</EarlyAccessLink>
          </div>
        </div>
      </section>
    </>
  );
}

/** Every agent as a small card, linking to its page. */
export function AgentStrip({ except }: { except?: AgentPageId }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {AGENT_PAGE_IDS.filter((id) => id !== except).map((id) => {
        const agent = AGENT_PAGES[id];
        return (
          <li key={id}>
            <Link href={agentPagePath(id)} className="group flex h-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 hover:border-brand-500/40">
              <Portrait id={id} size={40} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-strong">{agent.name}</span>
                <span className="block text-xs text-muted-foreground">{agent.status === "live" ? "Working today" : "Coming soon"}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-brand-600 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** /agents: the whole team, the ones working today first. */
export function AgentsIndex() {
  const groups = [
    { title: "Working today", lead: "Included in Operate and Expand.", ids: AGENT_PAGE_IDS.filter((id) => AGENT_PAGES[id].status === "live") },
    { title: "Coming soon", lead: "Included in Expand when each is released.", ids: AGENT_PAGE_IDS.filter((id) => AGENT_PAGES[id].status === "coming_soon") },
  ];
  return (
    <section className={cn(marketingPageGutter, "pt-10 pb-20 sm:pt-16 sm:pb-28")}>
      <div className={shell}>
        <p className={cn(sectionLabel, "mb-3")}>The agents</p>
        <h1 className={marketingDisplayTitle}>Your AI team for a cleaning company.</h1>
        <p className={cn(marketingLead, "mt-4")}>Each agent owns one part of the business, works within the limits you set, and hands work to the others. Open any of them to watch it work.</p>
        {groups.map((group) => (
          <div key={group.title} className="mt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
              <h2 className="font-heading text-2xl tracking-tight text-strong">{group.title}</h2>
              <p className="text-sm text-muted-foreground">{group.lead}</p>
            </div>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {group.ids.map((id) => {
                const agent = AGENT_PAGES[id];
                return (
                  <li key={id}>
                    <Link href={agentPagePath(id)} className="group flex h-full flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-brand-500/40">
                      <div className="flex items-center justify-between gap-2">
                        <Portrait id={id} size={56} />
                        <StatusPill status={agent.status} />
                      </div>
                      <p className="mt-4 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{agent.department}</p>
                      <p className="mt-1 font-heading text-xl tracking-tight text-strong">{agent.name}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{agent.headline}</p>
                      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-medium text-brand-600">
                        {agent.status === "live" ? "Watch it work" : "See what\u2019s coming"}
                        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
