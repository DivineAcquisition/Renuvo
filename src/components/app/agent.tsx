import Image from "next/image";

import { CheckCircle2, Hand, Hourglass, LightningIcon, PauseCircleIcon, type LucideIcon } from "@/components/icons";
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

const PIXELS = { xs: 20, sm: 28, md: 36, lg: 44 } as const;

/**
 * Where an agent's portrait is served from: public/agents/<id>.webp, the same faces the public site uses.
 * Every agent in the navigation has one, including those not built yet.
 */
export function agentPortrait(agent: string): string {
  return `/agents/${agent}.webp`;
}

/**
 * An agent's face with a dot for its state. The dot breathes only while the agent is acting or waiting on
 * you. Decorative: the agent's name is always written beside it. An agent not built yet is shown faded.
 */
export function AgentAvatar({ agent, state, size = "md" }: { agent: AgentId; state?: AgentState; size?: keyof typeof PIXELS }) {
  const look = state ? STATE[state] : null;
  const pixels = PIXELS[size];
  return (
    <span className={cn("relative inline-flex shrink-0", size === "xs" ? "size-5" : size === "sm" ? "size-7" : size === "md" ? "size-9" : "size-11")} aria-hidden data-agent-avatar={agent}>
      <Image
        src={agentPortrait(agent)}
        alt=""
        width={pixels * 2}
        height={pixels * 2}
        className={cn("size-full rounded-full object-cover ring-1", state === "not_built" ? "opacity-50 grayscale ring-border" : "ring-brand-500/30")}
      />
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

export const eyebrow = "text-[11px] font-semibold tracking-[0.14em] text-brand-300 uppercase";
