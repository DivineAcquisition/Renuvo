"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { LogoMark } from "@/components/brand/logo";
import { CalendarIcon, CheckCircle2, CircleDollarSign, ListChecks, MessagesSquare, TriangleAlert, Users, type LucideIcon } from "@/components/icons";
import { useCycle } from "@/components/marketing/motion";
import { Badge } from "@/components/ui/badge";
import { EVENTS } from "@/lib/marketing/content";
import { marketingPageGutter, marketingShell } from "@/lib/marketing/ui";
import { cn } from "@/lib/utils";

type BeamPath = { d: string; delay: number };

const FLOW_BEAMS = [
  { from: '[data-beam="source"]', to: '[data-beam="agent"]' },
  { from: '[data-beam="agent"]', to: '[data-beam="output"]' },
] as const;

/** Measures curved lines between the marked elements, so they follow the layout as it resizes. */
function useBeamPaths(containerRef: RefObject<HTMLElement | null>) {
  const [paths, setPaths] = useState<BeamPath[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const next: BeamPath[] = [];
    for (const pair of FLOW_BEAMS) {
      const target = container.querySelector(pair.to)?.getBoundingClientRect();
      if (!target || target.width === 0) continue;
      container.querySelectorAll(pair.from).forEach((element) => {
        const from = element.getBoundingClientRect();
        if (from.width === 0) return;
        const x1 = from.right - box.left;
        const y1 = from.top + from.height / 2 - box.top;
        const x2 = target.left - box.left;
        const y2 = target.top + target.height / 2 - box.top;
        const bend = Math.max(24, (x2 - x1) * 0.5);
        next.push({ d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, delay: next.length * 0.45 });
      });
    }
    setPaths(next);
  }, [containerRef]);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, measure]);

  return paths;
}

const EVENT_ICON: Record<(typeof EVENTS.items)[number]["key"], LucideIcon> = {
  lead: MessagesSquare,
  booked: CalendarIcon,
  dropped: TriangleAlert,
  failed: CircleDollarSign,
  done: ListChecks,
  applied: Users,
};

/** The strip under the hero: events flow into the agents, and finished work comes out. */
export function AgentFlow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const paths = useBeamPaths(containerRef);
  const status = useCycle(EVENTS.statuses.length, 2400);

  return (
    <section aria-label={EVENTS.label} className={cn("border-y border-border bg-card", marketingPageGutter)}>
      <div className={cn(marketingShell, "py-10 sm:py-12")}>
        <div ref={containerRef} className="relative grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-20">
          <svg aria-hidden className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block">
            <defs>
              <linearGradient id="agent-flow-glow" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity="0" />
                <stop offset="50%" stopColor="var(--brand)" />
                <stop offset="100%" stopColor="var(--brand-deep)" stopOpacity="0.2" />
              </linearGradient>
            </defs>
            {paths.map((path, index) => (
              <g key={index}>
                <path d={path.d} fill="none" stroke="var(--border)" strokeWidth="1.5" />
                <path d={path.d} pathLength={100} fill="none" stroke="url(#agent-flow-glow)" strokeWidth="2" strokeLinecap="round" className="beam-dash" style={{ animationDelay: `${path.delay}s` }} />
              </g>
            ))}
          </svg>

          <div className="relative">
            <p className="mb-3 text-sm font-medium text-muted-foreground lg:text-right">{EVENTS.label}</p>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1 lg:justify-items-end">
              {EVENTS.items.map((item) => {
                const Icon = EVENT_ICON[item.key];
                return (
                  <li key={item.key} data-beam="source" className="inline-flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-strong lg:w-auto">
                    <Icon className="size-4 shrink-0 text-brand-300" aria-hidden />
                    {item.label}
                  </li>
                );
              })}
            </ul>
          </div>

          <div data-beam="agent" className="relative mx-auto flex w-full max-w-xs flex-col items-center gap-3 rounded-xl border border-brand-400/40 bg-background p-5 text-center shadow-[0_0_60px_-24px_rgba(var(--brand-rgb),0.9)] lg:w-64">
            <span className="relative flex">
              <LogoMark className="size-12" />
              <span aria-hidden className="live-pulse absolute -right-1 -top-1 size-3 rounded-full border-2 border-background bg-success" />
            </span>
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{EVENTS.hub.role}</p>
              <p className="font-heading text-lg tracking-tight text-strong">{EVENTS.hub.name}</p>
            </div>
            <p className="min-h-10 text-xs leading-relaxed text-muted-foreground" aria-live="off">
              <span className="live-shimmer-text">{EVENTS.statuses[status]}</span>
            </p>
          </div>

          <div data-beam="output" className="relative mx-auto w-full max-w-xs rounded-xl border border-border bg-background p-4 lg:mx-0">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
                <CheckCircle2 className="size-4 text-brand-300" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-strong">{EVENTS.output.title}</p>
                <p className="text-xs text-muted-foreground">{EVENTS.output.meta}</p>
              </div>
            </div>
            <Badge variant="success" size="sm" className="mt-3">
              {EVENTS.output.state}
            </Badge>
          </div>
        </div>
        <p className="mt-6 text-xs text-muted-foreground lg:text-center">{EVENTS.caption}</p>
      </div>
    </section>
  );
}
