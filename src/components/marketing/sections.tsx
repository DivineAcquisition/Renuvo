import { ArrowRight, Hand, ListChecks, ScrollTextIcon, ShieldCheck, type LucideIcon } from "@/components/icons";
import { AgentMark } from "@/components/marketing/agent-mark";
import { AgentVisual } from "@/components/marketing/agent-visuals";
import { SpotlightCard } from "@/components/marketing/saas-frame";
import { AGENTS, CONTROL, INTEGRATIONS, PROBLEM } from "@/lib/marketing/content";

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
    <div className="grid gap-4 lg:grid-cols-2">
      {AGENTS.map((agent) => (
        <SpotlightCard key={agent.id} className="p-6 sm:p-7">
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3">
              <AgentMark id={agent.id} size="lg" />
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{agent.name}</p>
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
            </div>
          </div>
        </SpotlightCard>
      ))}
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
                      <span className="rounded-full border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground">{INTEGRATIONS.status}</span>
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
