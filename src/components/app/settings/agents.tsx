"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { AgentPermissions } from "@/components/app/screens/agent-permissions";
import { Guard } from "@/components/app/settings/guard";
import { ChevronDown } from "@/components/icons";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AGENTS } from "@/lib/app/navigation";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/**
 * The AI features an Owner can switch. Each one depends on a capability Selestial runs; a feature whose
 * capability isn't available is listed as not available yet, with no switch, unless it is already on
 * (so it can still be turned off).
 */
const SWITCHES = [
  { key: "photoReview", capability: "image_understanding", label: "Photo review", detail: "Chat can look at a job's photos and describe what they show." },
  { key: "documentSearch", capability: "embed", label: "Search your documents", detail: "Chat can search the company knowledge you've confirmed and each person's own drafts." },
  { key: "imageGeneration", capability: "image_generate", label: "Create images", detail: "Creative Studio and Chat can create images, like flyers or social posts. Uses credits." },
  { key: "videoGeneration", capability: "video_generate", label: "Create videos", detail: "Creative Studio and Chat can create short promotional videos. Uses credits." },
  { key: "otherChatModels", capability: "chat", label: "More chat assistants", detail: "Your team can choose assistants from other AI companies in Chat. Only services that don't keep or train on your data are offered." },
] as const;

function AiFeatures() {
  const { companyId } = useCompany();
  const data = useQuery(api.ai.overview, { companyId });
  const save = useMutation(api.ai.setFeatures);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  if (!data) return <Skeleton className="h-48 rounded-2xl" />;
  const ready = new Set(data.capabilities.filter((row) => row.state === "ready").map((row) => row.capability as string));
  const toggle = (key: (typeof SWITCHES)[number]["key"]) => {
    setError(null);
    setPending(key);
    save({ companyId, ...data.features, [key]: !data.features[key] })
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setPending(null));
  };
  const limits = [
    { label: "Images created", ...data.allowances.images },
    { label: "Videos created", ...data.allowances.videos },
  ].filter((row) => row.limit !== null);
  return (
    <section id="ai-features" className="scroll-mt-24">
      <Panel title="AI features">
        <p className="mb-3 text-sm text-muted-foreground">Each switch saves as soon as you change it. AI work uses Selestial Credits from your plan.</p>
        <ul className="grid gap-2">
          {SWITCHES.map((item) => {
            const on = data.features[item.key];
            const available = ready.has(item.capability);
            return (
              <li key={item.key} className="flex items-start justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-strong">{item.label}</span>
                  <span className="block text-xs text-muted-foreground">{item.detail}</span>
                </span>
                {!available && !on ? (
                  <Badge variant="outline" size="sm" className="mt-0.5 shrink-0">
                    Not available yet
                  </Badge>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={item.label}
                    disabled={!data.canChange || pending !== null}
                    onClick={() => toggle(item.key)}
                    className={cn(
                      "relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50",
                      on ? "border-brand-600 bg-brand-500" : "border-border bg-muted",
                    )}
                  >
                    <span className={cn("absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5.5" : "translate-x-0.5")} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {limits.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            This month: {limits.map((row) => `${row.label.toLowerCase()} ${row.used.toLocaleString("en-US")} of ${row.limit!.toLocaleString("en-US")}`).join(" · ")}. These limits reset on the 1st.
          </p>
        ) : null}
        <FormError message={error} />
      </Panel>
    </section>
  );
}

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
      <Guard>
        <AiFeatures />
      </Guard>
    </div>
  );
}
