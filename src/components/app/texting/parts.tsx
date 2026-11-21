"use client";

import { CheckCircle2, CircleDashed, Info, TriangleAlert } from "@/components/icons";
import { Disclosure as SharedDisclosure } from "@/components/ui/fields";
import { FieldSource, SelectionCard } from "@/components/ui/selection";
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

/**
 * Where a prefilled detail came from, with a way to confirm it. Shown until the owner confirms or changes
 * it. The words come from the record's own source, so nothing is labelled without data behind it.
 */
export function SourceChip({ field }: { field: string }) {
  const { view, commit, locked } = useSetup();
  const source = view.sources.find((row) => row.field === field);
  if (!source || source.source === "owner") return null;
  if (source.confirmed) return <FieldSource source={{ kind: "confirmed" }} />;
  const kind = source.source === "website" ? "website" : source.source === "onboarding" ? "onboarding" : "needs-confirmation";
  return <FieldSource source={{ kind, label: kind === "needs-confirmation" ? `From ${source.words}` : undefined }} onConfirm={locked ? undefined : () => void commit({ confirm: [field] })} />;
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

/** A texting choice. The shared selection card, kept under its old name for the texting steps. */
export function ChoiceCard({ selected, onPress, title, hint, multi, disabled, children }: { selected: boolean; onPress: () => void; title: string; hint?: React.ReactNode; multi?: boolean; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <SelectionCard selected={selected} onPress={onPress} title={title} description={hint} multi={multi} disabled={disabled}>
      {children}
    </SelectionCard>
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

/** The texting steps' disclosure: the shared one, kept under its old name. */
export function Disclosure({ summary, children, defaultOpen = false }: { summary: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <SharedDisclosure title={summary} defaultOpen={defaultOpen}>
      {children}
    </SharedDisclosure>
  );
}

export type Milestone = NonNullable<View["request"]>["milestones"][number];
