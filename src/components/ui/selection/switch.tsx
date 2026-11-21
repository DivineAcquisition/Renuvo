"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

import { focusRing, type Density } from "./tokens";

/**
 * The switch itself: a native button with role="switch" and its state in words for screen readers.
 * Kept as a plain button rather than a library primitive because it already has everything a switch
 * needs (Space and Enter toggle, a real focus, a disabled state) and its markup is relied on by tests.
 */
export function Switch({ id, checked, onChange, disabled, readOnly, labelledBy, describedBy, label, className, density = "default" }: { id?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; readOnly?: boolean; labelledBy?: string; describedBy?: string; /** The name, when no visible label points at it. */ label?: string; className?: string; density?: Density }) {
  const small = density === "compact";
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={label}
      aria-describedby={describedBy}
      aria-readonly={readOnly || undefined}
      disabled={disabled}
      onClick={() => (readOnly ? undefined : onChange(!checked))}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full border transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50",
        small ? "h-5 w-9" : "h-6 w-11",
        checked ? "border-[var(--sel-accent,var(--brand))] bg-[var(--sel-accent,var(--brand))]" : "border-border bg-muted",
        focusRing,
        readOnly && "cursor-default",
        className,
      )}
    >
      <span className="sr-only">{checked ? "On" : "Off"}</span>
      <span aria-hidden className={cn("inline-block rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none", small ? "size-4" : "size-5", checked ? (small ? "translate-x-4" : "translate-x-5") : "translate-x-0.5")} />
    </button>
  );
}

/** When a switch's change takes effect. A switch never implies "now" when the form saves later. */
export type SwitchEffect = "immediate" | "on-save";

const EFFECT_WORDS: Record<SwitchEffect, string> = {
  immediate: "Changes as soon as you switch it.",
  "on-save": "Takes effect after you save.",
};

/**
 * A continuing behaviour, on or off, with what it does. `effect` says when a change applies. `consequence`
 * is what the current value means in practice, written from the real setting, and `requirement` is what
 * it needs before it can work. Both are shown, not hidden behind a tip.
 */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  readOnly,
  effect,
  dirty,
  consequence,
  requirement,
  aside,
  density = "default",
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
  effect?: SwitchEffect;
  /** For `on-save`: whether this switch differs from what is saved, so the timing note is shown only when it matters. */
  dirty?: boolean;
  consequence?: React.ReactNode;
  requirement?: React.ReactNode;
  aside?: React.ReactNode;
  density?: Density;
  className?: string;
}) {
  const id = useId();
  const showEffect = effect === "immediate" || (effect === "on-save" && dirty);
  const described = [description ? `${id}-description` : null, consequence ? `${id}-consequence` : null, requirement ? `${id}-requirement` : null, showEffect ? `${id}-effect` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} id={`${id}-title`} className={cn("block font-medium text-strong", density === "compact" ? "text-[13px]" : "text-sm", !disabled && !readOnly && "cursor-pointer")}>
            {title}
          </label>
          {description ? (
            <p id={`${id}-description`} className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} readOnly={readOnly} labelledBy={`${id}-title`} describedBy={described} density={density} className="mt-0.5" />
      </div>
      {consequence ? <Consequence id={`${id}-consequence`}>{consequence}</Consequence> : null}
      {/* Pass a <Requirement> (it carries whether the need is met); the row only gives it an id to be described by. */}
      {requirement ? <div id={`${id}-requirement`}>{requirement}</div> : null}
      {showEffect ? (
        <p id={`${id}-effect`} className="text-[11px] text-muted-foreground" aria-live="polite">
          {EFFECT_WORDS[effect!]}
        </p>
      ) : null}
      {aside}
    </div>
  );
}

/** What a choice does, read from its actual value. Quiet and short; it describes, it doesn't sell. */
export function Consequence({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("rounded-lg border-l-2 border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_45%,var(--border))] bg-muted/40 px-3 py-2 text-xs leading-relaxed text-strong", className)}>
      {children}
    </p>
  );
}

/** What a choice needs before it can work: an approved number, recorded permission, a connection. */
export function Requirement({ id, children, met, className }: { id?: string; children: React.ReactNode; met?: boolean; className?: string }) {
  return (
    <p id={id} className={cn("flex gap-1.5 text-xs", met ? "text-success-foreground" : "text-muted-foreground", className)}>
      <span aria-hidden className="mt-px font-semibold">
        {met ? "✓" : "!"}
      </span>
      <span>
        {met ? <span className="sr-only">Met: </span> : <span className="sr-only">Requires: </span>}
        {children}
      </span>
    </p>
  );
}
