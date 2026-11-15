"use client";

import { AgentMark, AgentName } from "@/components/marketing/agent-mark";
import { useCycle } from "@/components/marketing/motion";
import { Badge } from "@/components/ui/badge";
import { agentOf } from "@/lib/marketing/agents";
import { HERO, QUEUE } from "@/lib/marketing/content";

/** The hero picture: the morning decisions queue, with each agent's live status above it. */
export function HeroQueue() {
  const tick = useCycle(3, 2800);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-strong">{QUEUE.window}</p>
        <Badge variant="outline" size="sm">
          {HERO.exampleLabel}
        </Badge>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-muted px-3.5 py-3">
        <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{QUEUE.briefingTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-strong">{QUEUE.briefing}</p>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2" aria-label={QUEUE.crewTitle}>
        {QUEUE.crew.map((row) => (
          <li key={row.agent} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
            <AgentMark id={row.agent} size="sm" live />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-strong">{agentOf(row.agent).name}</span>
              <span className="block truncate text-[11px] text-muted-foreground" aria-live="off">
                {row.statuses[tick % row.statuses.length]}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <ol className="mt-3 space-y-2">
        {QUEUE.items.map((item) => (
          <li key={item.title} className="rounded-lg border border-border bg-background p-3.5">
            <div className="flex items-start justify-between gap-3">
              <AgentName id={item.agent} className="text-xs" />
              <Badge variant="warning" size="sm">
                {item.state}
              </Badge>
            </div>
            <p className="mt-1.5 text-sm font-medium text-strong">{item.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.reason}</p>
            {/* Drawn, not wired: this is a picture of the queue, so the three choices are not real buttons. */}
            <p className="mt-2.5 flex flex-wrap gap-1.5 text-xs font-medium" aria-hidden>
              <span className="rounded-md bg-brand-500 px-2.5 py-1" style={{ color: "#07070b" }}>
                {QUEUE.actions.approve}
              </span>
              <span className="rounded-md border border-border px-2.5 py-1 text-strong">{QUEUE.actions.edit}</span>
              <span className="rounded-md px-2.5 py-1 text-muted-foreground">{QUEUE.actions.skip}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
