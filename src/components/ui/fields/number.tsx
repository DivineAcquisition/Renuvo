"use client";

import { useId } from "react";

import { Minus, Plus } from "@/components/icons";
import { centsFrom } from "@/lib/app/format";
import { joinIds, markComposite, useFieldControl } from "@/components/ui/selection/field-context";
import { focusRing, type Density } from "@/components/ui/selection/tokens";
import { cn } from "@/lib/utils";

type Base = {
  /**
   * What is typed, as text. "" means blank, which is not the same as "0": a form decides what blank
   * means (often "not set") and the field never turns one into the other.
   */
  value: string;
  onChange: (text: string) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Digits allowed after the point. 0 for whole numbers. */
  precision?: number;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  /** Show − and + beside the field. Typing still works. */
  stepper?: boolean;
  /** A short line under the field, worked out from the value as typed: "= 2 hours". */
  preview?: (value: number) => React.ReactNode;
  density?: Density;
  id?: string;
  name?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

/** Parses what is typed. Returns null for blank, NaN for something that isn't a number at the precision. */
export function parseNumber(text: string, precision = 0): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  const pattern = precision > 0 ? new RegExp(`^-?\\d+(\\.\\d{1,${precision}})?$|^-?\\.\\d{1,${precision}}$`) : /^-?\d+$/;
  return pattern.test(cleaned) ? Number(cleaned) : Number.NaN;
}

/** Why a typed number won't do, or null. Blank is fine unless required. */
export function numberProblem(text: string, { min, max, precision = 0, required }: { min?: number; max?: number; precision?: number; required?: boolean }): string | null {
  const parsed = parseNumber(text, precision);
  if (parsed === null) return required ? "Enter a number." : null;
  if (Number.isNaN(parsed)) return precision > 0 ? `Enter a number with up to ${precision} digit${precision === 1 ? "" : "s"} after the point.` : "Enter a whole number.";
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (min !== undefined && max !== undefined && (parsed < min || parsed > max)) return `Enter a number from ${fmt(min)} to ${fmt(max)}.`;
  if (min !== undefined && parsed < min) return `Enter ${fmt(min)} or more.`;
  if (max !== undefined && parsed > max) return `Enter ${fmt(max)} or less.`;
  return null;
}

/**
 * A number with its unit inside the field ("$", "%", "minutes", "cleaners"). Typing is never reformatted
 * while it happens, so the cursor stays put; the stepper moves by `step` and stays inside min and max.
 * The form's own validation and the server's stay authoritative; this only says what it can see.
 */
export function NumberField({ value, onChange, min, max, step = 1, precision = 0, disabled, readOnly, required, placeholder, stepper = false, preview, density = "default", id, name, className, prefix, suffix, onBlur, ...aria }: Base & { prefix?: React.ReactNode; suffix?: React.ReactNode; onBlur?: () => void }) {
  const field = useFieldControl();
  const own = useId();
  const inputId = id ?? field?.controlId ?? own;
  const parsed = parseNumber(value, precision);
  const valid = parsed !== null && !Number.isNaN(parsed);
  // The form's own error, when it has one, is the one shown; the field only speaks for itself otherwise.
  const local = field?.invalid ? null : numberProblem(value, { min, max, precision });
  const invalid = Boolean(local) || field?.invalid;
  const bump = (direction: 1 | -1) => {
    const start = valid ? parsed! : (min ?? 0) - (direction === 1 ? step : -step);
    let next = Math.round((start + direction * step) * 10 ** precision) / 10 ** precision;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(precision > 0 ? next.toFixed(precision).replace(/\.?0+$/, "") : String(next));
  };
  const problemId = `${inputId}-problem`;
  const previewId = `${inputId}-preview`;
  const shown = valid && !local && preview ? preview(parsed!) : null;
  const small = density === "compact";
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="flex items-stretch gap-1.5">
        <div
          className={cn(
            "flex flex-1 items-center rounded-lg border bg-card text-sm transition-[border-color] duration-150 has-[:focus-visible]:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_60%,var(--border))] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)] motion-reduce:transition-none",
            small ? "min-h-control-sm" : "min-h-control-md",
            invalid ? "border-destructive/60" : "border-border",
            (disabled || readOnly) && "bg-muted/50 text-muted-foreground",
          )}
        >
          {prefix ? (
            <span className="pl-3 text-muted-foreground" aria-hidden>
              {prefix}
            </span>
          ) : null}
          <input
            id={inputId}
            name={name}
            inputMode={precision > 0 ? "decimal" : "numeric"}
            autoComplete="off"
            value={value}
            disabled={disabled}
            readOnly={readOnly}
            required={required ?? field?.required}
            placeholder={placeholder}
            aria-label={aria["aria-label"]}
            aria-invalid={invalid || undefined}
            aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy, local ? problemId : undefined, shown ? previewId : undefined)}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (readOnly || disabled) return;
              if (event.key === "ArrowUp") {
                event.preventDefault();
                bump(1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                bump(-1);
              }
            }}
            className={cn("w-full min-w-0 bg-transparent py-1.5 text-strong tabular-nums outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed", prefix ? "pl-1.5" : "pl-3", suffix ? "pr-1.5" : "pr-3")}
          />
          {suffix ? <span className="shrink-0 pr-3 text-xs whitespace-nowrap text-muted-foreground">{suffix}</span> : null}
        </div>
        {stepper && !readOnly ? (
          <span className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border bg-card">
            <button type="button" tabIndex={-1} aria-label="Decrease" disabled={disabled || (valid && min !== undefined && parsed! <= min)} onClick={() => bump(-1)} className={cn("grid place-items-center text-strong hover:bg-muted disabled:opacity-40", small ? "w-8" : "w-9", focusRing)}>
              <Minus className="size-3.5" aria-hidden />
            </button>
            <button type="button" tabIndex={-1} aria-label="Increase" disabled={disabled || (valid && max !== undefined && parsed! >= max)} onClick={() => bump(1)} className={cn("grid place-items-center border-l border-border text-strong hover:bg-muted disabled:opacity-40", small ? "w-8" : "w-9", focusRing)}>
              <Plus className="size-3.5" aria-hidden />
            </button>
          </span>
        ) : null}
      </div>
      {local ? (
        <p id={problemId} className="text-xs font-medium text-destructive-foreground">
          {local}
        </p>
      ) : shown ? (
        <p id={previewId} className="text-xs text-muted-foreground" aria-live="polite">
          {shown}
        </p>
      ) : null}
    </div>
  );
}
markComposite(NumberField);

/**
 * Dollars and cents, read with the app's money parser. Nothing is rounded while typing; leaving the field
 * writes a valid amount with two decimals ("12.5" becomes "12.50"), and leaves anything else as typed
 * so the person can fix it.
 */
export function MoneyField(props: Omit<Base, "precision" | "step"> & { step?: number }) {
  return (
    <NumberField
      {...props}
      precision={2}
      step={props.step ?? 1}
      min={props.min ?? 0}
      prefix="$"
      onBlur={() => {
        const cents = centsFrom(props.value);
        if (cents !== null) props.onChange((cents / 100).toFixed(2));
      }}
    />
  );
}
markComposite(MoneyField);

export function PercentField(props: Omit<Base, "max"> & { max?: number }) {
  return <NumberField {...props} max={props.max ?? 100} min={props.min ?? 0} suffix="%" />;
}
markComposite(PercentField);

/** "150" minutes reads back as "2 hours 30 minutes". */
export function durationWords(minutes: number): string {
  const total = Math.round(minutes);
  const [hours, rest] = [Math.floor(total / 60), total % 60];
  const h = hours ? `${hours} hour${hours === 1 ? "" : "s"}` : "";
  const m = rest ? `${rest} minute${rest === 1 ? "" : "s"}` : "";
  return [h, m].filter(Boolean).join(" ") || "0 minutes";
}

/** A length of time, typed in minutes or hours, with what it adds up to underneath once it's long enough to matter. */
export function DurationField({ unit = "minutes", ...props }: Base & { unit?: "minutes" | "hours" }) {
  return (
    <NumberField
      {...props}
      suffix={unit}
      precision={props.precision ?? (unit === "hours" ? 2 : 0)}
      preview={
        props.preview ??
        ((n) => {
          const minutes = unit === "hours" ? n * 60 : n;
          return minutes >= 60 || unit === "hours" ? `${n.toLocaleString("en-US")} ${unit} = ${durationWords(minutes)}` : null;
        })
      }
    />
  );
}
markComposite(DurationField);

/** A whole count of something ("cleaners", "photos"), with − and +. */
export function CountField({ noun, ...props }: Omit<Base, "precision"> & { noun: [singular: string, plural: string] }) {
  const parsed = parseNumber(props.value);
  return <NumberField {...props} precision={0} stepper={props.stepper ?? true} suffix={parsed === 1 ? noun[0] : noun[1]} />;
}
markComposite(CountField);
