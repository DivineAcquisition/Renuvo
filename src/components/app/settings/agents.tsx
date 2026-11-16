"use client";

import { AgentPermissions } from "@/components/app/screens/agent-permissions";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { AGENTS } from "@/lib/app/navigation";

/**
 * Permissions for the agents the backend runs, from the permission engine, then the four that come
 * later. Those have no permissions to set: inventing switches for a workflow that does not exist would
 * promise control over something that cannot act.
 */
export function AgentSettings() {
  const later = AGENTS.filter((agent) => agent.backendAgent === null);
  return (
    <div className="grid gap-5">
      <AgentPermissions />
      <Panel title="Not available yet">
        <p className="mb-3 text-sm text-muted-foreground">These agents have no workflow, so there is nothing for them to be permitted to do and nothing to pause. Their permissions will appear here when they are released.</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {later.map((agent) => (
            <li key={agent.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
              <span>
                <span className="font-medium text-strong">{agent.label}</span>
                <span className="block text-xs text-muted-foreground">{agent.responsibility}</span>
              </span>
              <Badge variant="outline" size="sm">
                Unavailable
              </Badge>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
