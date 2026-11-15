import { MapPin, MessagesSquare, RefreshCw, Users, type LucideIcon } from "@/components/icons";
import { AGENTS, type AgentId } from "@/lib/marketing/content";

export const AGENT_ICON: Record<AgentId, LucideIcon> = {
  sales: MessagesSquare,
  recruiter: Users,
  dispatch: MapPin,
  retention: RefreshCw,
};

const BY_ID = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent])) as Record<AgentId, (typeof AGENTS)[number]>;

export function agentOf(id: AgentId) {
  return BY_ID[id];
}
