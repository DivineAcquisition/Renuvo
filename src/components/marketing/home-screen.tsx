"use client";

import { CheckCircle2, Clock, Hand, TriangleAlert, type LucideIcon } from "@/components/icons";
import { AgentMark, AgentName } from "@/components/marketing/agent-mark";
import { useCycle } from "@/components/marketing/motion";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { EXAMPLE_LABEL, HOME_SCREEN } from "@/lib/marketing/content";

type ItemState = (typeof HOME_SCREEN.items)[number]["state"];

const STATE: Record<ItemState, { icon: LucideIcon; variant: NonNullable<BadgeProps["variant"]> }> = {
  resolved: { icon: CheckCircle2, variant: "success" },
  progress: { icon: Clock, variant: "info" },
  decision: { icon: Hand, variant: "warning" },
  concern: { icon: TriangleAlert, variant: "warning" },
};

const eyebrow = "text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase";

/**
 * The hero picture: what an owner opens to. Today's service, what the agents are working on, and
 * the four kinds of line the business arrives with: resolved, in progress, a decision, a concern.
 */
export function HomeScreen() {
  const tick = useCycle(3, 2800);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-strong">{HOME_SCREEN.window}</p>
        <Badge variant="outline" size="sm">
          {EXAMPLE_LABEL}
        </Badge>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted px-3.5 py-3">
        <p className={eyebrow}>{HOME_SCREEN.serviceTitle}</p>
        <dl className="mt-2 grid grid-cols-4 gap-2">
          {HOME_SCREEN.service.map((item) => (
            <div key={item.label}>
              <dd className="font-heading text-xl tracking-tight text-strong tabular-nums">{item.value}</dd>
              <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
            </div>
          ))}
        </dl>
      </div>

      <p className={`${eyebrow} mt-4`}>{HOME_SCREEN.agentsTitle}</p>
      <ul className="mt-2 grid grid-cols-2 gap-2">
        {HOME_SCREEN.agents.map((row) => (
          <li key={row.agent} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
            <AgentMark id={row.agent} size="sm" live />
            <span className="min-w-0">
              <AgentName id={row.agent} className="block text-xs" />
              <span className="block truncate text-[11px] text-muted-foreground" aria-live="off">
                {row.statuses[tick % row.statuses.length]}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <ol className="mt-3 space-y-2">
        {HOME_SCREEN.items.map((item) => {
          const state = STATE[item.state];
          const Icon = state.icon;
          return (
            <li key={item.label} className="rounded-lg border border-border bg-background p-3.5">
              <div className="flex items-center justify-between gap-3">
                <Badge variant={state.variant} size="sm">
                  <Icon aria-hidden />
                  {item.label}
                </Badge>
                <AgentName id={item.agent} className="text-xs font-normal text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-strong">{item.body}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
