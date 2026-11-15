"use client";

import { Check, CheckCircle2, Circle } from "@/components/icons";
import { useCycle } from "@/components/marketing/motion";
import { Badge } from "@/components/ui/badge";
import { AGENT_VISUALS, EXAMPLE_LABEL, TASK_TRAIL, type AgentId } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const frame = "rounded-lg border border-border bg-muted p-3.5";
const head = "flex items-center justify-between gap-3 text-xs font-medium text-strong";

/** A small moving picture of one agent's work. Steps appear in turn; with reduced motion all are shown. */
export function AgentVisual({ id }: { id: AgentId }) {
  const visual = AGENT_VISUALS[id];
  const total = visual.rows.length;
  const shown = useCycle(total + 2, 1300);
  const reached = Math.min(shown + 1, total);

  return (
    <div className={frame}>
      <p className={head}>
        {visual.title}
        <Badge variant="outline" size="sm">
          {EXAMPLE_LABEL}
        </Badge>
      </p>

      {visual.kind === "chat" ? (
        <ul className="mt-3 grid gap-1.5">
          {visual.rows.map((row, index) => (
            <li
              key={row.text}
              className={cn(
                "max-w-[92%] rounded-lg px-3 py-2 text-xs leading-relaxed transition-opacity duration-500 motion-reduce:transition-none",
                index < reached ? "opacity-100" : "opacity-0",
                row.who === "them" && "border border-border bg-background text-strong",
                row.who === "agent" && "justify-self-end border border-brand-500/30 bg-brand-500/10 text-strong",
                row.who === "state" && "max-w-full justify-self-stretch border border-dashed border-border text-muted-foreground",
              )}
            >
              {row.text}
            </li>
          ))}
        </ul>
      ) : null}

      {visual.kind === "stages" ? (
        <ol className="mt-3 grid gap-1.5">
          {visual.rows.map((row, index) => {
            const on = index < reached;
            return (
              <li key={row.text} className={cn("flex items-center gap-2.5 text-xs transition-colors duration-500 motion-reduce:transition-none", on ? "text-strong" : "text-muted-foreground")}>
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-500 motion-reduce:transition-none", on ? "border-brand-500 bg-brand-500" : "border-border bg-background")} aria-hidden>
                  {on ? <Check className="size-2.5" style={{ color: "#07070b" }} /> : null}
                </span>
                {row.text}
              </li>
            );
          })}
        </ol>
      ) : null}

      {visual.kind === "rank" ? (
        <ol className="mt-3 grid gap-1.5">
          {visual.rows.map((row, index) => {
            const first = index === 0;
            const accepted = first && reached >= total;
            const out = index === total - 1;
            return (
              <li key={row.text} className={cn("flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-xs transition-colors duration-500 motion-reduce:transition-none", accepted ? "border-brand-500/40 bg-brand-500/10" : "border-border bg-background", out && "opacity-60")}>
                <span className="min-w-0">
                  <span className="font-medium text-strong">
                    {index + 1}. {row.text}
                  </span>
                  <span className="block truncate text-muted-foreground">{row.detail}</span>
                </span>
                <span className={cn("shrink-0 text-[10px] font-semibold tracking-[0.1em] uppercase", accepted ? "text-flag-good" : "text-muted-foreground")}>
                  {first ? (accepted ? row.state : "Offer sent") : row.state}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

/** One task followed from "sent" to a clear state. The marker moves along the trail and stops at closed. */
export function TaskTrail() {
  const steps = TASK_TRAIL.steps;
  const at = useCycle(steps.length + 1, 1800);
  const index = Math.min(at, steps.length - 1);
  const closed = index === steps.length - 1;
  const fields = TASK_TRAIL.fields;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase">{TASK_TRAIL.title}</h3>
        <Badge variant="outline" size="sm">
          {EXAMPLE_LABEL}
        </Badge>
      </div>
      <p className="mt-3 text-sm font-medium text-strong">{TASK_TRAIL.task}</p>

      <ol className="mt-4 grid gap-2 sm:grid-cols-5">
        {steps.map((step, position) => {
          const done = position < index || (closed && position === index);
          const current = position === index && !closed;
          return (
            <li key={step.label} className={cn("rounded-lg border px-3 py-2.5 transition-colors duration-500 motion-reduce:transition-none", current ? "border-brand-500/50 bg-brand-500/10" : done ? "border-border bg-muted" : "border-dashed border-border")}>
              <p className={cn("flex items-center gap-1.5 text-xs font-medium", done || current ? "text-strong" : "text-muted-foreground")}>
                {done ? <CheckCircle2 className="size-3.5 text-flag-good" aria-hidden /> : <Circle className={cn("size-3", current && "live-pulse text-brand-300")} aria-hidden />}
                {step.label}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{step.note}</p>
            </li>
          );
        })}
      </ol>

      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs" aria-live="off">
        <div>
          <dt className="text-muted-foreground">{fields.owner}</dt>
          <dd className="mt-0.5 font-medium text-strong">{fields.ownerValue}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{fields.next}</dt>
          <dd className="mt-0.5 font-medium text-strong">{closed ? fields.closed : steps[index + 1].label}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{fields.deadline}</dt>
          <dd className="mt-0.5 font-medium text-strong">{closed ? fields.closed : "Thursday 5:00"}</dd>
        </div>
      </dl>
    </div>
  );
}
