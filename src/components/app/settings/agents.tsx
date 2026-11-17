"use client";

import Link from "next/link";
import { useState } from "react";

import { AgentPermissions } from "@/components/app/screens/agent-permissions";
import { ChevronDown } from "@/components/icons";
import { AGENTS } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

/** Agents not released yet. Listed so owners know what's coming, with nothing to set. */
function ComingSoon() {
  const later = AGENTS.filter((agent) => agent.backendAgent === null);
  const [open, setOpen] = useState(false);
  if (later.length === 0) return null;
  return (
    <section className="rounded-2xl border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="coming-soon-agents"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500 sm:px-5"
      >
        <span>
          <span className="font-medium text-strong">Coming soon</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {later.length} more agent{later.length === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <ul id="coming-soon-agents" className="grid gap-2 border-t border-border px-4 py-3 sm:grid-cols-2 sm:px-5">
          {later.map((agent) => (
            <li key={agent.id} className="rounded-lg border border-dashed border-border px-3 py-2 text-sm">
              <span className="font-medium text-strong">{agent.label}</span>
              <span className="block text-xs text-muted-foreground">{agent.responsibility}</span>
            </li>
          ))}
          <li className="text-xs text-muted-foreground sm:col-span-2">Their controls will appear here when they&apos;re released.</li>
        </ul>
      ) : null}
    </section>
  );
}

export function AgentSettings() {
  return (
    <div className="grid gap-6">
      <AgentPermissions />
      <ComingSoon />
      <p className="text-sm text-muted-foreground">
        AI features like photo review and image creation are switched on in{" "}
        <Link href="/app/settings/billing?tab=usage#ai-features" className="font-medium text-brand-600 underline-offset-2 hover:underline">
          Plan &amp; Usage
        </Link>
        .
      </p>
    </div>
  );
}
