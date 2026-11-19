"use client";

import { useState } from "react";

import { Check, CheckCircle2, CircleDashed, Info, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useSetup, type View } from "./context";

export function StepHeading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: React.ReactNode }) {
  return (
    <header className="grid gap-1.5">
      <p className="text-xs font-semibold tracking-wide text-brand-300 uppercase">{eyebrow}</p>
      <h2 className="font-display text-2xl font-semibold text-balance text-strong">{title}</h2>
      {lead ? <p className="text-sm text-muted-foreground">{lead}</p> : null}
    </header>
  );
}

export function Section({ title, lead, children }: { title: string; lead?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-semibold text-strong">{title}</h3>
        {lead ? <p className="text-xs text-muted-foreground">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Note({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" }) {
  return (
    <p className={cn("flex gap-2 rounded-xl px-3 py-2.5 text-xs", tone === "warning" ? "bg-warning/10 text-warning-foreground" : "bg-muted/60 text-muted-foreground")}>
      {tone === "warning" ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
      <span>{children}</span>
    </p>
  );
}

/** Where a prefilled detail came from, with a way to confirm it. Shown until the owner confirms or changes it. */
export function SourceChip({ field }: { field: string }) {
  const { view, commit, locked } = useSetup();
  const source = view.sources.find((row) => row.field === field);
  if (!source || source.source === "owner") return null;
  if (source.confirmed) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success-foreground">
        <Check className="size-3" aria-hidden />
        Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>From {source.words}</span>
      {!locked ? (
        <button type="button" onClick={() => void commit({ confirm: [field] })} className="font-medium text-brand-300 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
          It&apos;s right
        </button>
      ) : null}
    </span>
  );
}

/** What a step still needs, or that it is ready. */
export function Needs({ items, ready = "Everything on this step is ready." }: { items: readonly string[]; ready?: string }) {
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-success-foreground">
        <CheckCircle2 className="size-4" aria-hidden />
        {ready}
      </p>
    );
  }
  return (
    <ul className="grid gap-1.5 text-sm" aria-label="Still needed">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-strong">
          <CircleDashed className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A text message as it arrives on a phone. */
export function Bubble({ from, children }: { from: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-[11px] font-medium text-muted-foreground">{from}</p>
      <p className="max-w-[20rem] rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-[13px] leading-5 whitespace-pre-wrap text-strong">{children}</p>
    </div>
  );
}

export function ChoiceCard({ selected, onPress, title, hint, multi, disabled, children }: { selected: boolean; onPress: () => void; title: string; hint?: React.ReactNode; multi?: boolean; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-xl border transition-colors motion-reduce:transition-none", selected ? "border-brand-500 bg-brand-500/5" : "border-border bg-card")}>
      <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={selected} onClick={onPress} disabled={disabled} className="flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed">
        <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center border", multi ? "rounded-md" : "rounded-full", selected ? "border-brand-500 bg-brand-500 text-white" : "border-border bg-background")} aria-hidden>
          {selected ? <Check className="size-3.5" /> : null}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-strong">{title}</span>
          {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
        </span>
      </button>
      {children ? <div className="px-3.5 pb-3 pl-11.5">{children}</div> : null}
    </div>
  );
}

const PAGE_STATE: Record<"drafted" | "published" | "needs_attention", { label: string; variant: "outline" | "success" | "warning" }> = {
  drafted: { label: "Drafted", variant: "outline" },
  published: { label: "Published", variant: "success" },
  needs_attention: { label: "Needs attention", variant: "warning" },
};

export function PageState({ state }: { state: keyof typeof PAGE_STATE }) {
  return <Badge variant={PAGE_STATE[state].variant}>{PAGE_STATE[state].label}</Badge>;
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)} className="group rounded-xl border border-border bg-card">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium text-strong focus-visible:outline-2 focus-visible:outline-brand-500 [&::-webkit-details-marker]:hidden">{summary}</summary>
      <div className="border-t border-border p-3.5">{children}</div>
    </details>
  );
}

export type Milestone = NonNullable<View["request"]>["milestones"][number];
