"use client";

import { useState } from "react";

import { CheckCircle2, ChevronDown, CircleHelp, FileText, Globe, ListChecks, Sparkles, UserCheckIcon as UserCheck } from "@/components/icons";
import { cn } from "@/lib/utils";

import { focusRing } from "./tokens";

/**
 * Where a value came from. Each kind maps to a fact Selestial actually holds; a field shows a source only
 * when its data says so. There is no generic "AI" label: an agent suggestion names the agent.
 */
export type SourceKind = "agent" | "onboarding" | "import" | "website" | "needs-confirmation" | "confirmed";

export type Source = {
  kind: SourceKind;
  /** The agent that proposed it, for `agent`: "Dispatch", "Sales", "Recruiter". */
  agent?: string;
  /** A short detail: the file name for `import`, the page for `website`. */
  detail?: string;
  /** Exact words from the record ("From your company profile"), when the data names the origin more precisely. */
  label?: string;
};

const ICONS = { agent: Sparkles, onboarding: ListChecks, import: FileText, website: Globe, "needs-confirmation": CircleHelp, confirmed: UserCheck } as const;

export function sourceWords(source: Source): string {
  if (source.label) return source.label;
  switch (source.kind) {
    case "agent":
      return `Suggested by ${source.agent ?? "your agent"}`;
    case "onboarding":
      return "From your onboarding";
    case "import":
      return source.detail ? `Imported from ${source.detail}` : "Imported from your file";
    case "website":
      return "Found on your website";
    case "needs-confirmation":
      return "Needs confirmation";
    case "confirmed":
      return "Confirmed by you";
  }
}

/**
 * The quiet line under a field saying where its value came from, with "It's right" while it waits for
 * the owner. Confirming is the form's own action (`onConfirm`); this never saves on its own.
 */
export function FieldSource({ source, onConfirm, confirmLabel = "It's right", className }: { source: Source; onConfirm?: () => void; confirmLabel?: string; className?: string }) {
  const Icon = ICONS[source.kind];
  const confirmed = source.kind === "confirmed";
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", confirmed ? "text-success-foreground" : source.kind === "needs-confirmation" ? "text-warning-foreground" : "text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        {confirmed ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
        {sourceWords(source)}
        {source.detail && source.kind === "website" ? <span className="text-muted-foreground">({source.detail})</span> : null}
      </span>
      {!confirmed && onConfirm ? (
        <button type="button" onClick={onConfirm} className={cn("font-medium text-[var(--sel-accent,var(--brand))] underline-offset-2 hover:underline", focusRing)}>
          {confirmLabel}
        </button>
      ) : null}
    </span>
  );
}

/**
 * A proposed value, kept apart from the current one. It names who proposed it and why, and offers to
 * apply it. Applying calls `onApply`, which should put the value in the form's draft exactly as typing
 * would, so the form's own save (or autosave, where the form already had one) decides when it is stored.
 * A suggestion is never permission and never sends anything.
 */
export function FieldSuggestion({
  value,
  source,
  reason,
  why,
  onApply,
  onDismiss,
  stale = false,
  applyLabel = "Apply suggestion",
  disabled,
  className,
}: {
  /** The proposed value, in words. */
  value: React.ReactNode;
  source: Source;
  reason?: React.ReactNode;
  /** A longer explanation behind "Why this?". Leave it out when there is nothing more to say. */
  why?: React.ReactNode;
  onApply: () => void;
  onDismiss?: () => void;
  /** The suggestion was made from information that has changed since. It can't be applied until refreshed. */
  stale?: boolean;
  applyLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[source.kind];
  return (
    <div className={cn("grid gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_22%,var(--border))] bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_5%,var(--card))] px-3 py-2 text-xs", stale && "opacity-80", className)} role="group" aria-label={sourceWords(source)}>
      <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-strong">
        <Icon className="size-3.5 shrink-0 translate-y-0.5 text-[var(--sel-accent,var(--brand))]" aria-hidden />
        <span className="text-muted-foreground">{sourceWords(source)}:</span>
        <span className="font-medium break-words">{value}</span>
      </p>
      {reason ? <p className="text-muted-foreground">{reason}</p> : null}
      {stale ? <p className="text-warning-foreground">Made before your latest changes, so it may no longer fit. It will refresh, or you can ignore it.</p> : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={onApply} disabled={disabled || stale} className={cn("font-medium text-[var(--sel-accent,var(--brand))] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline", focusRing)}>
          {applyLabel}
        </button>
        {why ? (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn("inline-flex items-center gap-0.5 text-muted-foreground hover:text-strong", focusRing)}>
            Why this?
            <ChevronDown className={cn("size-3 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className={cn("text-muted-foreground hover:text-strong", focusRing)}>
            Dismiss
          </button>
        ) : null}
      </div>
      {why && open ? <div className="border-t border-border/70 pt-1.5 text-muted-foreground">{why}</div> : null}
    </div>
  );
}

/**
 * Whether a suggestion should be offered, and whether it is stale. Pure, so the rules are tested once:
 *  - nothing is offered when the field already holds the proposed value, or the owner dismissed it;
 *  - an owner's edit is never replaced: the suggestion stays an offer beside the field;
 *  - a suggestion made from inputs that have since changed (`basedOn` differs from `inputs`) is stale.
 */
export function suggestionState<T>({ current, proposed, basedOn, inputs, dismissed }: { current: T; proposed: T | null | undefined; basedOn?: string; inputs?: string; dismissed: readonly string[] }): { offer: boolean; stale: boolean } {
  if (proposed === null || proposed === undefined) return { offer: false, stale: false };
  const key = JSON.stringify(proposed);
  if (key === JSON.stringify(current) || dismissed.includes(key)) return { offer: false, stale: false };
  return { offer: true, stale: basedOn !== undefined && inputs !== undefined && basedOn !== inputs };
}

/**
 * Holds dismissals for one field and works out the offer. `apply` hands the proposed value to `set`
 * (the form's draft setter) and nothing else.
 */
export function useSuggestion<T>({ current, proposed, basedOn, inputs, set }: { current: T; proposed: T | null | undefined; basedOn?: string; inputs?: string; set: (value: T) => void }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const state = suggestionState({ current, proposed, basedOn, inputs, dismissed });
  return {
    ...state,
    apply: () => {
      if (proposed !== null && proposed !== undefined && !state.stale) set(proposed);
    },
    dismiss: () => {
      if (proposed !== null && proposed !== undefined) setDismissed((list) => [...list, JSON.stringify(proposed)]);
    },
  };
}
