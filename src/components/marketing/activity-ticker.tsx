import { AgentMark, AgentName } from "@/components/marketing/agent-mark";
import { ACTIVITY } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

function Row({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center gap-3 pr-3 [--gap:0.75rem] motion-safe:animate-marquee motion-reduce:flex-wrap" aria-hidden={hidden || undefined}>
      {ACTIVITY.items.map((item, index) => (
        <li key={`${item.agent}-${index}`} className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card py-1 pr-3.5 pl-1 text-sm text-strong shadow-[0_8px_24px_-18px_rgba(11,10,17,0.4)]">
          <AgentMark id={item.agent} size="sm" />
          <AgentName id={item.agent} className="text-xs" />
          <span className="text-muted-foreground">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A slow strip of the kind of things the agents record, under the hero. It stops for anyone who asks for
 * reduced motion, and pauses while hovered so a line can be read.
 */
export function ActivityTicker({ className }: { className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <p className="sr-only">{ACTIVITY.label}</p>
      <div
        className="group flex overflow-hidden [--duration:60s] [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)] hover:[&>ul]:[animation-play-state:paused]"
        role="presentation"
      >
        <Row />
        <Row hidden />
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">{ACTIVITY.label}</p>
    </div>
  );
}
