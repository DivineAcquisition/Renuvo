"use client";

import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { Guard } from "@/components/app/settings/guard";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";

const STATE = {
  configured: { label: "Configured", variant: "success" },
  test_mode: { label: "Test mode", variant: "warning" },
  not_configured: { label: "Not configured", variant: "outline" },
  unavailable: { label: "Unavailable", variant: "outline" },
} as const;

const MEANING: [keyof typeof STATE, string][] = [
  ["configured", "An adapter is built and this deployment has what it needs. It does not mean the outside service was checked."],
  ["test_mode", "A stand-in is selected. Nothing real is sent or read."],
  ["not_configured", "An adapter exists, but this deployment has not been set up to use it."],
  ["unavailable", "No adapter is built yet, so it cannot be set up."],
];

function ConnectionsInner() {
  const { companyId } = useCompany();
  const result = useQuery(api.settings.connections, { companyId });
  if (!result) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="grid gap-5">
      <p className="max-w-2xl text-sm text-muted-foreground">{result.note} Credentials are never shown here.</p>
      <Panel flush>
        <ul className="divide-y divide-border">
          {result.connections.map((row) => {
            const state = STATE[row.state];
            return (
              <li key={row.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-strong">{row.label}</span>
                  <span className="block text-xs text-muted-foreground">{row.detail}</span>
                  <span className="block text-xs text-muted-foreground">Used by {row.usedBy.join(", ")}</span>
                </span>
                <Badge variant={state.variant} size="sm">
                  {state.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title="What the labels mean">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {MEANING.map(([key, words]) => (
            <div key={key}>
              <dt className="font-medium text-strong">{STATE[key].label}</dt>
              <dd className="text-xs leading-relaxed text-muted-foreground">{words}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

export function Connections() {
  return (
    <Guard>
      <ConnectionsInner />
    </Guard>
  );
}
