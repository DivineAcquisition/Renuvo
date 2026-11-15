import { ArrowRight, Building2, CalendarIcon, Check, CheckCircle2, CircleHelp, Home, Lock, TriangleAlert, Users, type LucideIcon } from "@/components/icons";
import { AgentMark, AgentName } from "@/components/marketing/agent-mark";
import { SpotlightCard } from "@/components/marketing/saas-frame";
import { Badge } from "@/components/ui/badge";
import { agentOf } from "@/lib/marketing/agents";
import { AGENTS, AGENTS_SECTION, CONTROL, HERO, LOOP, PROBLEM, SCORECARD, WHO } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const label = "text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase";

export function PainList() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {PROBLEM.pains.map((pain) => (
        <li key={pain.title} className="rounded-xl border border-border bg-card p-5">
          <p className="font-heading text-base tracking-tight text-strong">{pain.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{pain.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** The four agents: the job, how it works, the promise and the number it is measured on. */
export function AgentsGrid() {
  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-2">
        {AGENTS.map((agent) => (
          <SpotlightCard key={agent.id} className="p-6">
            <div className="flex items-center gap-3">
              <AgentMark id={agent.id} size="lg" />
              <div>
                <h3 className="font-heading text-xl tracking-tight text-strong">{agent.name}</h3>
                <p className={label}>{agent.role}</p>
              </div>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed text-strong">{agent.job}</p>
            <ol className="mt-4 space-y-2">
              {agent.steps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm leading-relaxed text-muted-foreground">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-strong tabular-nums" aria-hidden>
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <dl className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
              <div>
                <dt className={cn(label, "flex items-center gap-1.5")}>
                  <Lock className="size-3" aria-hidden />
                  {AGENTS_SECTION.neverLabel}
                </dt>
                <dd className="mt-1 text-sm leading-relaxed text-strong">{agent.never}</dd>
              </div>
              <div>
                <dt className={label}>{AGENTS_SECTION.numberLabel}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-strong">{agent.number}</dd>
              </div>
            </dl>
          </SpotlightCard>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-border p-5">
        <p className={label}>{AGENTS_SECTION.planned.title}</p>
        <ul className="mt-3 grid gap-3 sm:grid-cols-3">
          {AGENTS_SECTION.planned.items.map((item) => (
            <li key={item.name}>
              <p className="text-sm font-medium text-strong">{item.name}</p>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">{AGENTS_SECTION.planned.note}</p>
      </div>
    </div>
  );
}

/** How work passes between the agents, and the single thread every customer sees. */
export function LoopMap() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_0.7fr]">
      <ol className="grid gap-2 sm:grid-cols-2">
        {LOOP.handoffs.map((handoff) => (
          <li key={`${handoff.from}-${handoff.to}`} className="rounded-xl border border-border bg-card p-4">
            <p className="flex items-center gap-2 text-sm">
              <AgentMark id={handoff.from} size="sm" />
              <span className="font-medium text-strong">{agentOf(handoff.from).name}</span>
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="sr-only">to</span>
              <AgentMark id={handoff.to} size="sm" />
              <span className="font-medium text-strong">{agentOf(handoff.to).name}</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{handoff.body}</p>
          </li>
        ))}
      </ol>
      <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.06] p-5">
        <h3 className="font-heading text-lg tracking-tight text-strong">{LOOP.thread.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{LOOP.thread.body}</p>
      </div>
    </div>
  );
}

export function AlwaysAPerson() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h3 className={label}>{CONTROL.always.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{CONTROL.always.note}</p>
      <ul className="mt-3 grid gap-2">
        {CONTROL.always.items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm text-strong">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-brand-300" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ControlRules() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {CONTROL.rules.map((rule) => (
        <li key={rule.title} className="rounded-xl border border-border bg-card p-5">
          <Check className="size-4 text-brand-300" aria-hidden />
          <p className="mt-3 font-heading text-base tracking-tight text-strong">{rule.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{rule.body}</p>
        </li>
      ))}
    </ul>
  );
}

const SCORE_STATE: Record<(typeof SCORECARD.rows)[number]["state"], { icon: LucideIcon; tone: string }> = {
  match: { icon: CheckCircle2, tone: "text-flag-good" },
  gap: { icon: TriangleAlert, tone: "text-flag-warning" },
  unverified: { icon: CircleHelp, tone: "text-muted-foreground" },
};

/** What each agent reported beside what the record confirms. */
export function Scorecard() {
  const { columns } = SCORECARD;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <h3 className="font-heading text-xl tracking-tight text-strong sm:text-2xl">{SCORECARD.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">{SCORECARD.body}</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium text-strong">This week</p>
          <Badge variant="outline" size="sm">
            {HERO.exampleLabel}
          </Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">{columns.agent}</th>
                <th scope="col" className="px-4 py-2 font-medium">{columns.claim}</th>
                <th scope="col" className="px-4 py-2 font-medium">{columns.check}</th>
                <th scope="col" className="px-4 py-2 font-medium">{columns.result}</th>
              </tr>
            </thead>
            <tbody>
              {SCORECARD.rows.map((row) => {
                const state = SCORE_STATE[row.state];
                const Icon = state.icon;
                return (
                  <tr key={row.agent} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-3 font-normal">
                      <AgentName id={row.agent} />
                    </th>
                    <td className="px-4 py-3 text-strong tabular-nums">{row.claim}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.check}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 font-medium tabular-nums", state.tone)}>
                        <Icon className="size-4" aria-hidden />
                        {row.result}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{SCORECARD.note}</p>
      </div>
    </div>
  );
}

const KIND_ICON: Record<(typeof WHO.kinds)[number]["id"], LucideIcon> = { home: Home, rental: CalendarIcon, pm: Building2, office: Users };

export function WhoGrid() {
  return (
    <div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {WHO.kinds.map((kind) => {
          const Icon = KIND_ICON[kind.id];
          return (
            <li key={kind.id} className="rounded-xl border border-border bg-card p-5">
              <span className="flex size-9 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300" aria-hidden>
                <Icon className="size-4" />
              </span>
              <p className="mt-4 font-heading text-base tracking-tight text-strong">{kind.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{kind.body}</p>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {[WHO.workers, WHO.rules].map((item) => (
          <div key={item.title} className="rounded-xl border border-border bg-muted p-5">
            <p className="font-heading text-base tracking-tight text-strong">{item.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
