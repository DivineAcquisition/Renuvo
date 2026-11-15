"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { CheckCircle2, Circle, TriangleAlert } from "@/components/icons";
import { AgentMark } from "@/components/marketing/agent-mark";
import { useInViewSequence } from "@/components/marketing/motion";
import { Badge } from "@/components/ui/badge";
import { COORDINATION, EXAMPLE_LABEL } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

type BeamPath = { d: string; delay: number };

/** Measures a curved line from the event to each agent, so the lines follow the layout as it resizes. */
function useBeamPaths(containerRef: RefObject<HTMLElement | null>) {
  const [paths, setPaths] = useState<BeamPath[]>([]);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const from = container.querySelector('[data-beam="event"]')?.getBoundingClientRect();
    if (!from || from.width === 0) return;
    const next: BeamPath[] = [];
    container.querySelectorAll('[data-beam="agent"]').forEach((element) => {
      const to = element.getBoundingClientRect();
      if (to.width === 0) return;
      const x1 = from.right - box.left;
      const y1 = from.top + from.height / 2 - box.top;
      const x2 = to.left - box.left;
      const y2 = to.top + to.height / 2 - box.top;
      if (x2 <= x1) return;
      const bend = Math.max(24, (x2 - x1) * 0.5);
      next.push({ d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, delay: next.length * 0.45 });
    });
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

/**
 * One change, and the four agents it reaches. The agents light up in turn once the picture scrolls
 * into view. With reduced motion all four are shown reached at once.
 */
export function CoordinationMap() {
  const ref = useRef<HTMLDivElement>(null);
  const paths = useBeamPaths(ref);
  const reached = useInViewSequence(ref, COORDINATION.responses.length, 1000);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium text-strong">{COORDINATION.intro}</p>
        <Badge variant="outline" size="sm">
          {EXAMPLE_LABEL}
        </Badge>
      </div>

      <div ref={ref} className="relative grid items-center gap-4 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24">
        <svg aria-hidden className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block">
          <defs>
            <linearGradient id="coordination-glow" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0" />
              <stop offset="50%" stopColor="var(--brand)" />
              <stop offset="100%" stopColor="var(--brand-deep)" stopOpacity="0.2" />
            </linearGradient>
          </defs>
          {paths.map((path, index) => (
            <g key={index}>
              <path d={path.d} fill="none" stroke="var(--border)" strokeWidth="1.5" />
              <path d={path.d} pathLength={100} fill="none" stroke="url(#coordination-glow)" strokeWidth="2" strokeLinecap="round" className="beam-dash" style={{ animationDelay: `${path.delay}s` }} />
            </g>
          ))}
        </svg>

        <div data-beam="event" className="relative rounded-xl border border-flag-warning/40 bg-flag-warning/10 p-5">
          <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-flag-warning uppercase">
            <TriangleAlert className="size-3.5" aria-hidden />
            {COORDINATION.event.label}
          </p>
          <p className="mt-2 font-heading text-lg tracking-tight text-strong">{COORDINATION.event.title}</p>
        </div>

        <ol className="relative grid gap-3">
          {COORDINATION.responses.map((response, index) => {
            const on = index < reached;
            return (
              <li
                key={response.agent}
                data-beam="agent"
                className={cn(
                  "flex gap-3.5 rounded-xl border p-4 transition-colors duration-500 motion-reduce:transition-none",
                  on ? "border-brand-500/40 bg-brand-500/[0.07]" : "border-border bg-card",
                )}
              >
                <AgentMark id={response.agent} size="md" live={on} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="font-heading text-base tracking-tight text-strong">{response.title}</p>
                    <span className={cn("inline-flex items-center gap-1 text-[10px] font-semibold tracking-[0.1em] uppercase", on ? "text-flag-good" : "text-muted-foreground")}>
                      {on ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3" aria-hidden />}
                      {on ? COORDINATION.reached : COORDINATION.waiting}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{response.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <p className="mt-8 max-w-2xl border-t border-border pt-6 text-[15px] leading-relaxed font-medium text-strong sm:text-base">{COORDINATION.closing}</p>
    </div>
  );
}
