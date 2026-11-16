import Image from "next/image";

import { agentOf } from "@/lib/marketing/agents";
import type { AgentId } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

const BOX = { sm: "size-7", md: "size-9", lg: "size-12" } as const;
const PIXELS = { sm: 28, md: 36, lg: 48 } as const;

/**
 * An agent's face. Decorative: the agent's name is always written beside it, so the picture carries no
 * meaning of its own. The pictures are in public/agents, one per agent, named by the agent.
 */
export function AgentMark({ id, size = "md", live = false }: { id: AgentId; size?: keyof typeof BOX; live?: boolean }) {
  return (
    <span className={cn("relative inline-flex shrink-0", BOX[size])} aria-hidden data-agent-avatar={id}>
      <Image src={`/agents/${id}.webp`} alt="" width={PIXELS[size] * 2} height={PIXELS[size] * 2} className="size-full rounded-full ring-1 ring-border" />
      {live ? <span className="live-pulse absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-success" /> : null}
    </span>
  );
}

/** The agent's role name, as it is written everywhere: Sales, Recruiter, Dispatch, Retention. */
export function AgentName({ id, className }: { id: AgentId; className?: string }) {
  return <span className={cn("font-medium text-strong", className)}>{agentOf(id).name}</span>;
}
