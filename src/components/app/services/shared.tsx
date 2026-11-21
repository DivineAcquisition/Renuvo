"use client";

import { Popover } from "@base-ui/react/popover";
import { useId, useState } from "react";

import { Guard } from "@/components/app/settings/guard";
import { Info } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl, Switch } from "@/components/ui/selection";
import { CHANGE_STATE_WORDS, centsFrom, dollarsText } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { formatCents } from "../../../../convex/lib/services/words";

export { formatCents };

/**
 * The "why" behind a setting, one tap away instead of a paragraph under every field. It opens on
 * click or tap (and on hover with a pointer), closes with Escape, and is named for what it explains.
 * Anything a person needs to fill a field correctly stays visible; only explanations live here.
 */
export function InfoTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={250}
        closeDelay={120}
        aria-label={`About ${label}`}
        className={cn("inline-grid size-6 shrink-0 place-items-center rounded-full align-middle text-muted-foreground transition-colors hover:text-brand-300 focus-visible:outline-2 focus-visible:outline-brand-500/50 data-[popup-open]:text-brand-300", className)}
      >
        <Info aria-hidden className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={6} collisionPadding={12} className="z-[70]">
          <Popover.Popup className="max-w-[min(20rem,calc(100vw-1.5rem))] origin-[var(--transform-origin)] rounded-xl border border-border bg-popover px-3 py-2.5 text-xs leading-relaxed text-popover-foreground shadow-lg shadow-black/10 outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Popover.Title className="mb-0.5 text-[13px] font-semibold text-strong">{label}</Popover.Title>
            <Popover.Description render={<div />} className="grid gap-1 text-muted-foreground">
              {children}
            </Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A field label with its optional "why" beside it. The tip sits outside the label so it never steals the input's name. */
export function FieldLabel({ htmlFor, id, label, tip, className }: { htmlFor?: string; id?: string; label: string; tip?: React.ReactNode; className?: string }) {
  return (
    <span className={cn("flex min-h-6 items-center gap-0.5", className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} id={id} className="font-medium text-strong">
          {label}
        </label>
      ) : (
        <span id={id} className="font-medium text-strong">
          {label}
        </span>
      )}
      {tip ? <InfoTip label={label}>{tip}</InfoTip> : null}
    </span>
  );
}

/** A labeled control for anything that is not money or a number: the label, its tip, a short hint, and the control given the id. */
export function LabeledField({ label, tip, hint, className, children }: { label: string; tip?: React.ReactNode; hint?: string; className?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className={cn("grid grid-cols-1 gap-1.5 text-sm", className)}>
      <FieldLabel htmlFor={id} label={label} tip={tip} />
      {children(id)}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** One failing query never blanks the workspace: it says what is likely wrong. */
export function ServicesGuard({ children }: { children: React.ReactNode }) {
  return (
    <Guard
      fallback={(error) => (
        <Empty title="This part of Services & Pricing could not load">
          The service may not exist, or your role may not include it. If the whole workspace is missing, the server has not been updated with it yet: deploy the latest Convex functions, then reload.
          {error instanceof Error ? <span className="mt-2 block text-xs text-muted-foreground/80">{error.message.split("\n")[0].slice(0, 160)}</span> : null}
        </Empty>
      )}
    >
      {children}
    </Guard>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-strong">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-xl text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "critical" | "success"; title?: string; children: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-brand-500/25 bg-brand-500/[0.05]",
    warning: "border-warning/40 bg-warning/10",
    critical: "border-destructive/35 bg-destructive/[0.06]",
    success: "border-success/35 bg-success/[0.07]",
  } as const;
  return (
    <div role={tone === "critical" ? "alert" : "note"} className={cn("rounded-xl border px-3.5 py-2.5 text-sm text-strong", tones[tone], className)}>
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={cn(title ? "mt-0.5 text-muted-foreground" : "")}>{children}</div>
    </div>
  );
}

export function ChangeBadge({ state }: { state: string }) {
  const words = CHANGE_STATE_WORDS[state] ?? { label: state, tone: "outline" as const };
  return (
    <Badge variant={words.tone} size="sm">
      {words.label}
    </Badge>
  );
}

/**
 * Money a person types, with the unit always beside it ("per visit", "per cleaner per hour"). The value
 * is kept as typed until it is a valid amount, so a half-typed "12." is never rounded away.
 */
export function MoneyInput({ label, cents, onCents, unit, disabled, hint, tip, className }: { label: string; cents: number | null; onCents: (cents: number | null) => void; unit: string; disabled?: boolean; hint?: string; tip?: React.ReactNode; className?: string }) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (cents === null ? "" : dollarsText(cents));
  const invalid = text !== null && text.trim() !== "" && centsFrom(text) === null;
  return (
    <div className={cn("grid grid-cols-1 gap-1.5 text-sm", className)}>
      <FieldLabel htmlFor={id} label={label} tip={tip} />
      <div className={cn("flex min-h-10 items-center rounded-lg border bg-card focus-within:border-brand-500/60 focus-within:outline-2 focus-within:outline-brand-500/30", invalid ? "border-destructive/60" : "border-border", disabled && "opacity-70")}>
        <span className="pl-3 text-muted-foreground" aria-hidden>
          $
        </span>
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          value={shown}
          aria-invalid={invalid || undefined}
          aria-describedby={`${id}-unit`}
          onChange={(event) => {
            setText(event.target.value);
            const value = event.target.value.trim();
            if (value === "") onCents(null);
            else {
              const parsed = centsFrom(value);
              if (parsed !== null) onCents(parsed);
            }
          }}
          onBlur={() => setText(null)}
          className="w-full min-w-[4.5rem] bg-transparent px-1.5 py-2 text-strong tabular-nums outline-none"
        />
        <span id={`${id}-unit`} className="max-w-[55%] shrink-0 py-1 pr-3 text-right text-xs leading-tight text-muted-foreground">
          {unit}
        </span>
      </div>
      {invalid ? <span className="text-xs text-destructive-foreground">Write an amount like 120 or 120.50.</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** A whole or decimal number with its unit beside it. */
export function NumberInput({ label, value, onValue, unit, min = 0, max, step = 1, disabled, hint, tip, className }: { label: string; value: number | null; onValue: (value: number | null) => void; unit?: string; min?: number; max?: number; step?: number; disabled?: boolean; hint?: string; tip?: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("grid grid-cols-1 gap-1.5 text-sm", className)}>
      <FieldLabel htmlFor={id} label={label} tip={tip} />
      <div className="flex min-h-10 items-center rounded-lg border border-border bg-card focus-within:border-brand-500/60 focus-within:outline-2 focus-within:outline-brand-500/30">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={value ?? ""}
          onChange={(event) => onValue(event.target.value === "" ? null : Number(event.target.value))}
          className="w-full min-w-0 bg-transparent px-3 py-2 text-strong tabular-nums outline-none"
        />
        {unit ? <span className="shrink-0 pr-3 text-xs text-muted-foreground">{unit}</span> : null}
      </div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/** A plus/minus control for small counts: crew, bedrooms, quantities. */
export function Stepper({ label, value, onValue, min = 0, max = 99, unit, disabled }: { label: string; value: number; onValue: (value: number) => void; min?: number; max?: number; unit?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-1.5 text-sm">
      <span id={id} className="font-medium text-strong">
        {label}
      </span>
      <div role="group" aria-labelledby={id} className="inline-flex w-fit items-center rounded-lg border border-border bg-card">
        <button type="button" disabled={disabled || value <= min} onClick={() => onValue(Math.max(min, value - 1))} className="grid size-9 place-items-center rounded-l-lg text-lg text-strong hover:bg-overlay/[0.05] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-500/40" aria-label={`Fewer: ${label}`}>
          −
        </button>
        <output aria-live="polite" className="min-w-14 px-2 text-center tabular-nums text-strong">
          {value}
          {unit ? <span className="ml-1 text-xs text-muted-foreground">{unit}</span> : null}
        </output>
        <button type="button" disabled={disabled || value >= max} onClick={() => onValue(Math.min(max, value + 1))} className="grid size-9 place-items-center rounded-r-lg text-lg text-strong hover:bg-overlay/[0.05] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-brand-500/40" aria-label={`More: ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

/** The switch itself, from the shared selection system. Kept under its old name for Services screens. */
export function SwitchButton(props: { id?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; labelledBy?: string; className?: string }) {
  return <Switch {...props} />;
}

/** An on/off switch with words beside it. Status never depends on color alone. */
export function Toggle({ label, description, tip, checked, onChange, disabled }: { label: string; description?: string; tip?: React.ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <FieldLabel htmlFor={id} label={label} tip={tip} className="text-sm" />
        {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

/** A small set of choices shown side by side, as radio buttons a keyboard can move through. */
export function Segmented<T extends string>({ label, value, options, onChange, disabled, tip, className }: { label: string; value: T; options: readonly { id: T; label: string; hint?: string }[]; onChange: (value: T) => void; disabled?: boolean; tip?: React.ReactNode; className?: string }) {
  return <SegmentedControl label={label} value={value} options={options} onChange={onChange} disabled={disabled} className={className} tip={tip ? <InfoTip label={label}>{tip}</InfoTip> : null} />;
}

/** A section heading. A short line of context can sit under it, or its explanation can wait behind a tip. */
export function SectionTitle({ title, children, tip, action }: { title: string; children?: React.ReactNode; tip?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-0.5 font-heading text-base tracking-tight text-strong">
          {title}
          {tip ? <InfoTip label={title}>{tip}</InfoTip> : null}
        </h3>
        {children ? <p className="mt-0.5 text-sm text-muted-foreground">{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Who sees a field, as a small tag instead of a sentence. */
export function AudienceTag({ who }: { who: "customers" | "team" | "you" }) {
  const words = { customers: "Customers see this", team: "Team only", you: "Only you" } as const;
  return <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{words[who]}</span>;
}

export const when = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
