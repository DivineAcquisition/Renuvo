"use client";

import { useMutation, useQuery } from "convex/react";
import { motion } from "motion/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { Eye, FileImage, FileSearch, MessageSquareText, Sparkles, type LucideIcon } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

/**
 * The AI features an Owner switches, as cards. Each depends on a capability Selestial runs: a feature
 * whose capability isn't available is marked "Not available yet" with no switch, unless it is already
 * on (so it can still be turned off). Each switch saves as soon as it is changed, and says so.
 */
const FEATURES: readonly { key: "photoReview" | "documentSearch" | "imageGeneration" | "videoGeneration" | "otherChatModels"; capability: string; label: string; detail: string; icon: LucideIcon; limit?: "images" | "videos" }[] = [
  { key: "photoReview", capability: "image_understanding", label: "Photo review", detail: "Chat looks at a job's photos and describes what they show.", icon: Eye },
  { key: "documentSearch", capability: "embed", label: "Search your documents", detail: "Chat searches the company knowledge you've confirmed and each person's drafts.", icon: FileSearch },
  { key: "imageGeneration", capability: "image_generate", label: "Create images", detail: "Flyers and social posts in Creative Studio and Chat.", icon: FileImage, limit: "images" },
  { key: "videoGeneration", capability: "video_generate", label: "Create videos", detail: "Short promotional clips in Creative Studio and Chat.", icon: Sparkles, limit: "videos" },
  { key: "otherChatModels", capability: "chat", label: "More chat assistants", detail: "Choose assistants from other AI companies in Chat. Only services that don't keep or train on your data.", icon: MessageSquareText },
];

export function AiFeatures() {
  const { companyId } = useCompany();
  const data = useQuery(api.ai.overview, { companyId });
  const save = useMutation(api.ai.setFeatures);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  if (!data) return <Skeleton className="h-56 rounded-2xl" />;
  const ready = new Set(data.capabilities.filter((row) => row.state === "ready").map((row) => row.capability as string));
  const toggle = (key: (typeof FEATURES)[number]["key"]) => {
    setError(null);
    setSaved(null);
    setPending(key);
    save({ companyId, ...data.features, [key]: !data.features[key] })
      .then(() => setSaved(key))
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setPending(null));
  };
  return (
    <section id="ai-features" aria-labelledby="ai-features-title" className="scroll-mt-24">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ai-features-title" className="font-heading text-lg tracking-tight text-strong">
            AI features
          </h2>
          <p className="text-sm text-muted-foreground">What your team can use AI for. Each switch saves as soon as you change it, and the work uses credits.</p>
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {FEATURES.map((item) => {
          const on = data.features[item.key];
          const available = ready.has(item.capability);
          const limit = item.limit ? data.allowances[item.limit] : null;
          const Icon = item.icon;
          return (
            <li
              key={item.key}
              className={cn(
                "relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-4 transition-colors",
                on && available ? "border-brand-500/40 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-brand-500)_15%,transparent),0_8px_24px_-12px_color-mix(in_oklab,var(--color-brand-500)_45%,transparent)]" : "border-border",
              )}
            >
              {on && available ? <div aria-hidden className="pointer-events-none absolute -top-12 -right-10 size-32 rounded-full bg-brand-500/12 blur-2xl" /> : null}
              <div className="relative flex items-start justify-between gap-3">
                <span aria-hidden className={cn("grid size-10 place-content-center rounded-xl ring-1", on && available ? "bg-brand-500/12 text-brand-600 ring-brand-500/25" : "bg-muted text-muted-foreground ring-border")}>
                  <Icon className="size-5" />
                </span>
                {!available && !on ? (
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">Not available yet</span>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={item.label}
                    disabled={!data.canChange || pending !== null}
                    onClick={() => toggle(item.key)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60",
                      on ? "border-brand-600 bg-brand-500" : "border-border bg-muted",
                    )}
                  >
                    <motion.span layout transition={{ type: "spring", bounce: 0.25, duration: 0.35 }} className={cn("absolute top-0.5 size-4.5 rounded-full bg-white shadow", on ? "right-0.5" : "left-0.5")} />
                  </button>
                )}
              </div>
              <div className="relative">
                <p className="text-sm font-semibold text-strong">{item.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </div>
              {limit && limit.limit !== null && (available || on) ? (
                <div className="relative mt-auto">
                  <div className="flex justify-between text-[0.6875rem] text-muted-foreground tabular-nums">
                    <span>This month</span>
                    <span>
                      {limit.used.toLocaleString("en-US")} of {limit.limit.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div className={cn("h-full rounded-full", limit.used >= limit.limit ? "bg-destructive" : "bg-brand-500")} initial={{ width: 0 }} animate={{ width: `${limit.limit > 0 ? Math.min(100, (limit.used / limit.limit) * 100) : 100}%` }} transition={{ duration: 0.8 }} />
                  </div>
                </div>
              ) : null}
              <p role="status" className="relative min-h-4 text-[0.6875rem] text-muted-foreground">
                {pending === item.key ? "Saving…" : saved === item.key ? (on ? "On. Saved." : "Off. Saved.") : !data.canChange ? "Only the Owner can switch this." : ""}
              </p>
            </li>
          );
        })}
      </ul>
      {data.allowances.images.limit !== null || data.allowances.videos.limit !== null ? <p className="mt-2 text-xs text-muted-foreground">Image and video limits reset on the 1st of each month.</p> : null}
      <FormError message={error} />
    </section>
  );
}
