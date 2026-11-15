import { AGENT_ICON, agentOf } from "@/lib/marketing/agents";
import type { AgentId } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

/** An agent's tile: its icon on a soft brand wash. */
export function AgentMark({ id, size = "md", live = false }: { id: AgentId; size?: "sm" | "md" | "lg"; live?: boolean }) {
  const Icon = AGENT_ICON[id];
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-300",
        size === "sm" && "size-7",
        size === "md" && "size-9",
        size === "lg" && "size-11 rounded-xl",
      )}
      aria-hidden
    >
      <Icon className={cn(size === "sm" ? "size-3.5" : size === "md" ? "size-4" : "size-5")} />
      {live ? <span className="live-pulse absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-success" /> : null}
    </span>
  );
}

/** The agent's role name, as it is written everywhere: Sales, Recruiter, Dispatch, Retention. */
export function AgentName({ id, className }: { id: AgentId; className?: string }) {
  return <span className={cn("font-medium text-strong", className)}>{agentOf(id).name}</span>;
}
