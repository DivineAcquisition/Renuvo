import { AgentAvatar } from "@/components/app/agent";
import { BotIcon, Building2, Sparkles, HistoryIcon, KeyIcon, PackageOpen, Plug, ScrollTextIcon, ShieldCheck, Users, Wallet, type LucideIcon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Sections that belong to one agent wear that agent's face. The rest wear an icon. */
const AGENT_OF: Record<string, "dispatch" | "recruiter"> = { dispatch: "dispatch", recruiting: "recruiter" };

const ICON: Record<string, LucideIcon> = {
  business: Building2,
  services: PackageOpen,
  people: Users,
  agents: BotIcon,
  integrations: Plug,
  billing: Wallet,
  ai: Sparkles,
  security: KeyIcon,
  compliance: ShieldCheck,
  agreements: ScrollTextIcon,
  activity: HistoryIcon,
};

export function SectionMark({ id, size = "md" }: { id: string; size?: "sm" | "md" | "lg" }) {
  const agent = AGENT_OF[id];
  if (agent) return <AgentAvatar agent={agent} size={size === "lg" ? "lg" : size} />;
  const Icon = ICON[id] ?? Building2;
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600 ring-1 ring-brand-500/20", size === "sm" ? "size-7" : size === "md" ? "size-9" : "size-11")}>
      <Icon className={size === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}
