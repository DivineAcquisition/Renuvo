import Image from "next/image";
import Link from "next/link";

import { ArrowRight, Hand, ListChecks, ScrollTextIcon, ShieldCheck, type LucideIcon } from "@/components/icons";
import { AgentMark } from "@/components/marketing/agent-mark";
import { AgentVisual } from "@/components/marketing/agent-visuals";
import { SpotlightCard } from "@/components/marketing/saas-frame";
import { AGENT_PAGE_IDS, AGENT_PAGES, agentPagePath } from "@/lib/marketing/agent-pages";
import { AGENT_STATUS, AGENTS, CONTROL, INTEGRATIONS, PRICING, PROBLEM } from "@/lib/marketing/content";

/** The four loose ends from the problem section, each beside the agent that will carry it. */
export function LooseEnds() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {PROBLEM.looseEnds.map((item) => (
        <li key={item.agent} className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
          <AgentMark id={item.agent} size="sm" />
          <p className="text-[15px] leading-relaxed text-strong">{item.text}</p>
        </li>
      ))}
    </ul>
  );
}

/** The four agents: what each keeps moving, how it helps, and where its work ends. */
export function AgentsGrid() {
  return (
    <>
    <div className="grid gap-4 lg:grid-cols-2">
      {AGENTS.map((agent) => (
        <SpotlightCard key={agent.id} className="p-6 sm:p-7">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3">
              <AgentMark id={agent.id} size="lg" live={AGENT_STATUS[agent.id].live} />
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{agent.name}</p>
              <span
                className={
                  AGENT_STATUS[agent.id].live
                    ? "ml-auto inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success-foreground"
                    : "ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                }
              >
                {AGENT_STATUS[agent.id].live ? <span className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" aria-hidden /> : null}
                {AGENT_STATUS[agent.id].label}
              </span>
            </div>
            <h3 className="mt-5 font-heading text-xl tracking-tight text-strong sm:text-2xl">{agent.headline}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{agent.body}</p>
            <div className="mt-5">
              <AgentVisual id={agent.id} />
            </div>
            <div className="mt-auto pt-6">
              <p className="flex items-start gap-2 border-t border-border pt-4 text-sm font-medium text-strong">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-brand-300" aria-hidden />
                {agent.outcome}
              </p>
              <Link href={agentPagePath(agent.id)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 underline-offset-4 hover:underline">
                See how {agent.name} works
                <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        </SpotlightCard>
      ))}
    </div>
    <ComingNext />
    </>
  );
}

/** The four agents that come with Expand once released, each linking to its page. */
function ComingNext() {
  const soon = AGENT_PAGE_IDS.filter((id) => AGENT_PAGES[id].status === "coming_soon");
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-strong">Coming next, in Expand</p>
        <Link href="/agents" className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline">
          Meet the whole team
        </Link>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {soon.map((id) => (
          <li key={id}>
            <Link href={agentPagePath(id)} className="group flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 hover:border-brand-500/40">
              <Image src={`/agents/${id}.webp`} alt="" width={72} height={72} className="size-9 shrink-0 rounded-full object-cover ring-1 ring-border" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-strong">{AGENT_PAGES[id].name}</span>
                <span className="block truncate text-xs text-muted-foreground">{AGENT_PAGES[id].headline}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CONTROL_ICON: Record<(typeof CONTROL.cards)[number]["id"], LucideIcon> = {
  boundaries: ShieldCheck,
  delegate: ListChecks,
  follow: ScrollTextIcon,
  "step-in": Hand,
};

export function ControlCards() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CONTROL.cards.map((card) => {
        const Icon = CONTROL_ICON[card.id];
        return (
          <li key={card.id} className="rounded-xl border border-border bg-card p-5">
            <span className="flex size-9 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300" aria-hidden>
              <Icon className="size-4" />
            </span>
            <p className="mt-4 font-heading text-base tracking-tight text-strong">{card.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** The planned connections, grouped by what they are for, each with its own mark. */
export function IntegrationsGrid() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        {INTEGRATIONS.groups.map((group) => (
          <div key={group.title} className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{group.title}</h3>
            <ul className="mt-4 grid gap-3">
              {group.items.map((item) => (
                <li key={item.name} className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background" aria-hidden>
                    {item.icon ? (
                      // Plain img: tiny static SVGs, which next/image does not optimize.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/brand/integrations/${item.icon}.svg`} alt="" width={20} height={20} className="size-5 object-contain" />
                    ) : (
                      <span className="text-sm font-semibold text-muted-foreground">{item.name.charAt(0)}</span>
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-strong">{item.name}</span>
                      {item.live ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-px text-[10px] font-medium text-success-foreground">
                          <span className="size-1.5 rounded-full bg-success" aria-hidden />
                          {INTEGRATIONS.liveLabel}
                        </span>
                      ) : (
                        <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground">{INTEGRATIONS.plannedLabel}</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{item.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{INTEGRATIONS.note}</p>
    </div>
  );
}

/** Operate and Expand: what each does today, what comes when released, and the questions people ask. */
export function PricingPlans() {
  return (
    <div className="grid gap-8">
      <div className="grid gap-4 lg:grid-cols-2">
        {PRICING.plans.map((plan) => (
          <SpotlightCard key={plan.id} className="p-6 sm:p-7">
            <h3 className="font-heading text-2xl tracking-tight text-strong">{plan.name}</h3>
            <p className="mt-2 text-3xl font-semibold text-strong">
              {plan.price}
              <span className="text-base font-normal text-muted-foreground">{plan.period}</span>
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{plan.summary}</p>
            <p className="mt-5 text-xs font-semibold tracking-[0.14em] text-brand-300 uppercase">Today</p>
            <ul className="mt-2 grid gap-1.5 text-[15px] text-strong">
              {plan.today.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden>·</span>
                  {line}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Not released yet</p>
            <ul className="mt-2 grid gap-1.5 text-sm text-muted-foreground">
              {plan.later.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden>·</span>
                  {line}
                </li>
              ))}
            </ul>
          </SpotlightCard>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {PRICING.allowanceNote} {PRICING.services}
      </p>
      <div className="grid gap-3">
        {PRICING.faqs.map((faq) => (
          <details key={faq.q} className="rounded-xl border border-border bg-card p-5">
            <summary className="cursor-pointer text-[15px] font-medium text-strong">{faq.q}</summary>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{faq.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
