import { CheckCircle2, ChevronRight, Hourglass, SirenIcon, type LucideIcon } from "@/components/icons";
import { AgentAvatar, type AgentId, eyebrow, STATE } from "@/components/app/agent";
import { BorderBeam } from "@/components/ui/border-beam";
import { ShineBorder } from "@/components/ui/shine-border";
import { ago, greeting } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { AgentState, Link, Statement } from "../../../../convex/overview";

const CERTAINTY: Record<Statement["certainty"], { icon: LucideIcon; tone: string; label: string }> = {
  confirmed: { icon: CheckCircle2, tone: "text-success", label: "Confirmed" },
  pending: { icon: Hourglass, tone: "text-info", label: "Waiting on a response" },
  attention: { icon: SirenIcon, tone: "text-warning", label: "Needs attention" },
};

export type Presence = { agent: AgentId; name: string; state: AgentState; line: string };

/**
 * The short operational briefing. Each statement is built from the record and opens it, and the mark in
 * front says whether it is confirmed, waiting on someone's answer, or needs a person.
 */
export function Briefing({
  firstName,
  now,
  timezone,
  lastChangeAt,
  statements,
  presence,
  onOpen,
}: {
  firstName: string | null;
  now: number;
  timezone: string;
  lastChangeAt: number | null;
  statements: Statement[];
  presence: Presence[];
  onOpen: (link: Link) => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-brand-500/30 bg-[radial-gradient(120%_140%_at_0%_0%,color-mix(in_srgb,var(--color-brand-500)_9%,transparent),transparent_55%),var(--card)] p-5 sm:p-6">
      <ShineBorder borderWidth={1} duration={18} shineColor={["#6838ef", "#b39eff", "#6838ef"]} />
      <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h1 className="font-heading text-2xl tracking-tight text-strong sm:text-[1.75rem]">
          {greeting(now, timezone)}
          {firstName ? `, ${firstName}` : ""}. Here’s where things stand.
        </h1>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="live-pulse size-2 rounded-full bg-success" aria-hidden />
          Live{lastChangeAt ? ` · last change ${ago(lastChangeAt, now, timezone)}` : " · no activity recorded yet"}
        </p>
      </div>

      <ul className="relative mt-4 grid gap-1.5">
        {statements.map((statement, index) => {
          const look = CERTAINTY[statement.certainty];
          const Icon = look.icon;
          const body = (
            <>
              <Icon className={cn("mt-0.5 size-4 shrink-0", look.tone)} aria-label={look.label} />
              <span className="min-w-0 flex-1 text-[15px] leading-relaxed text-strong">
                {statement.text}
                {statement.handling ? (
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AgentAvatar agent={statement.handling.agent} size="xs" />
                    {statement.handling.text}
                  </span>
                ) : null}
              </span>
              {statement.link ? <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden /> : null}
            </>
          );
          const link = statement.link;
          return (
            <li key={index}>
              {link ? (
                <button type="button" onClick={() => onOpen(link)} className="group -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2.5 py-1">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="relative mt-5 border-t border-border pt-4">
        <p className={eyebrow}>Your team right now</p>
        <ul className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {presence.map((row) => (
            <li key={row.agent} className={cn("relative flex min-w-0 items-center gap-2.5 overflow-hidden rounded-xl border border-border bg-background px-3 py-2.5", row.state === "not_built" && "border-dashed bg-transparent", row.state === "needs_you" && "border-warning/50")}>
              {row.state === "working" || row.state === "needs_you" ? <BorderBeam size={60} duration={row.state === "working" ? 4 : 7} colorFrom={row.state === "needs_you" ? "#f0b45c" : "#6838ef"} colorTo="#b39eff" /> : null}
              <AgentAvatar agent={row.agent} state={row.state} size="md" />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-strong">
                  {row.name}
                  <span className="text-xs font-normal text-muted-foreground">· {STATE[row.state].label}</span>
                </span>
                <span className={cn("block truncate text-xs text-muted-foreground", row.state === "working" && "live-shimmer-text")}>{row.line}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
