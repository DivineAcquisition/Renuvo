"use client";

import { AgentAvatar } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { PageHeader, Panel } from "@/components/app/shell";
import { Lock } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { mapsKey } from "@/lib/app/address";
import { CATEGORIES, integrationsIn, type Integration } from "@/lib/app/integrations";
import { AGENTS, type AgentId } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

const AGENT_LABEL = Object.fromEntries(AGENTS.map((agent) => [agent.id, agent.label])) as Record<AgentId, string>;

/** The status, in words. A planned integration says when, never offers a button that does nothing. */
function Status({ integration }: { integration: Integration }) {
  const { status } = integration;
  if (status.kind === "available") return <Badge variant="success">Ready to connect</Badge>;
  if (status.kind === "built_in") return mapsKey() ? <Badge variant="success">Built in</Badge> : <Badge variant="warning">Waiting on setup</Badge>;
  return <Badge variant="outline">Coming in phase {status.phase}</Badge>;
}

/** The agents that use it, as faces with their names for screen readers and on hover. */
function UsedBy({ agents }: { agents: AgentId[] }) {
  if (agents.length === 0) return null;
  const names = agents.map((agent) => AGENT_LABEL[agent]).join(", ");
  return (
    <div className="flex items-center gap-2">
      <span className="flex -space-x-1.5" title={names}>
        {agents.map((agent) => (
          <span key={agent} className="rounded-full ring-2 ring-card">
            <AgentAvatar agent={agent} size="xs" />
          </span>
        ))}
      </span>
      <span className="text-xs text-muted-foreground">
        <span className="sr-only">Used by </span>
        {names}
      </span>
    </div>
  );
}

function IntegrationCard({ integration }: { integration: Integration }) {
  const planned = integration.status.kind === "planned";
  return (
    <li className={cn("flex flex-col gap-3 rounded-xl border border-border bg-card p-4", planned && "bg-muted/30")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background font-heading text-sm font-semibold text-strong" aria-hidden>
            {integration.name.charAt(0)}
          </span>
          <h3 className="min-w-0 font-medium text-strong">{integration.name}</h3>
        </div>
        <Status integration={integration} />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{integration.does}</p>
      {integration.note ? <p className="text-xs leading-relaxed text-muted-foreground">{integration.note}</p> : null}
      <div className="mt-auto">
        <UsedBy agents={integration.agents} />
      </div>
    </li>
  );
}

export function IntegrationsScreen() {
  const { role } = useCompany();
  return (
    <>
      <PageHeader title="Integrations" lead="The accounts and services Selestial works with on your behalf, what each one does, and which agents use it." />
      <p className="mb-5 flex items-start gap-2 rounded-xl border border-border bg-muted px-3.5 py-3 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
        {role === "owner" ? "Only you, as the Owner, can connect or disconnect an integration. Everyone in your company can see what is connected." : "Only the Owner can connect or disconnect an integration. You can see what is connected."}
      </p>
      <div className="grid gap-5">
        {CATEGORIES.map((category) => (
          <Panel key={category.id} title={category.label}>
            <p className="mb-4 text-sm text-muted-foreground">{category.lead}</p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {integrationsIn(category.id).map((integration) => (
                <IntegrationCard key={integration.id} integration={integration} />
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </>
  );
}
