import { CheckCircle2, Hand, Hourglass, LightningIcon, PauseCircleIcon, type LucideIcon } from "@/components/icons";
import { AGENT_ICON } from "@/lib/marketing/agents";
import { cn } from "@/lib/utils";

import type { AgentState } from "../../../convex/overview";

export type AgentId = "sales" | "recruiter" | "dispatch" | "retention";

export const AGENT_NAME: Record<AgentId, string> = { sales: "Sales", recruiter: "Recruiter", dispatch: "Dispatch", retention: "Retention" };

/** How an agent's state is said and shown. "Active" is never one of them: the state says what is actually happening. */
export const STATE: Record<AgentState, { label: string; dot: string; pulse: boolean; icon: LucideIcon | null }> = {
  working: { label: "Working", dot: "bg-success", pulse: true, icon: LightningIcon },
  waiting: { label: "Waiting on a response", dot: "bg-info", pulse: false, icon: Hourglass },
  needs_you: { label: "Needs your decision", dot: "bg-warning", pulse: true, icon: Hand },
  paused: { label: "Paused", dot: "bg-muted-foreground", pulse: false, icon: PauseCircleIcon },
  clear: { label: "Nothing open", dot: "bg-success/50", pulse: false, icon: CheckCircle2 },
  not_built: { label: "Not built yet", dot: "bg-border", pulse: false, icon: null },
};

/** An agent's tile with a dot for its state. The dot breathes only while the agent is acting or waiting on you. */
export function AgentAvatar({ agent, state, size = "md" }: { agent: AgentId; state?: AgentState; size?: "xs" | "sm" | "md" | "lg" }) {
  const Icon = AGENT_ICON[agent];
  const look = state ? STATE[state] : null;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-lg border bg-brand-500/10 text-brand-700",
        state === "not_built" ? "border-dashed border-border bg-muted text-muted-foreground" : "border-brand-500/30",
        size === "xs" && "size-5 rounded-md",
        size === "sm" && "size-7",
        size === "md" && "size-9",
        size === "lg" && "size-11 rounded-xl",
      )}
      aria-hidden
    >
      <Icon className={cn(size === "xs" ? "size-3" : size === "sm" ? "size-3.5" : size === "md" ? "size-4" : "size-5")} />
      {look && state !== "not_built" ? (
        <span className={cn("absolute -right-0.5 -top-0.5 rounded-full border-2 border-background", size === "xs" ? "size-2" : "size-2.5", look.dot, look.pulse && "live-pulse")} />
      ) : null}
    </span>
  );
}

/** A person's or the system's mark in the activity feed. */
export function ActorAvatar({ label }: { label: string }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden>
      {label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export const eyebrow = "text-[11px] font-semibold tracking-[0.14em] text-brand-700 uppercase";
