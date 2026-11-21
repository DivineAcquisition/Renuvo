"use client";

import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";

import { joinIds, markComposite, useFieldControl } from "./field-context";
import { focusRing, focusWithin, markBase, markOff, markOn, restingSurface, selectedSurface, type Density } from "./tokens";
import type { Option } from "./types";

type RadioGroupProps<V extends string> = {
  /** The chosen value. `null` means nothing is chosen yet; it is never turned into the first option. */
  value: V | null;
  onValueChange: (value: V) => void;
  options: readonly Option<V>[];
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  density?: Density;
  /** Lay options out side by side from this breakpoint. */
  columns?: 1 | 2 | 3;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

const COLUMNS = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" } as const;

/**
 * Mutually exclusive options as a list of rows. Arrow keys move and choose, Tab leaves the group. Inside
 * a Field it is named by the Field's label and described by its hint and error.
 */
export function RadioGroup<V extends string>({ value, onValueChange, options, disabled, readOnly, required, name, density = "default", columns = 1, className, ...aria }: RadioGroupProps<V>) {
  const field = useFieldControl();
  const id = useId();
  return (
    <RadioGroupPrimitive
      value={value}
      onValueChange={(next: unknown) => onValueChange(next as V)}
      disabled={disabled}
      readOnly={readOnly}
      required={required ?? field?.required}
      name={name}
      aria-label={aria["aria-label"]}
      aria-labelledby={aria["aria-labelledby"] ?? (aria["aria-label"] ? undefined : field?.labelId)}
      aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy)}
      aria-invalid={field?.invalid || undefined}
      className={cn("grid gap-2", COLUMNS[columns], density === "compact" && "gap-1", className)}
    >
      {options.map((option) => {
        const on = value === option.value;
        const optionId = `${id}-${option.value}`;
        return (
          <label key={option.value} className={cn("flex items-start gap-2.5 text-sm", option.disabled || disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer", density === "compact" && "text-[13px]")}>
            <Radio.Root
              value={option.value}
              disabled={option.disabled}
              aria-labelledby={`${optionId}-title`}
              aria-describedby={option.description || option.disabledReason ? `${optionId}-description` : undefined}
              className={cn(markBase, "mt-[0.1875rem] rounded-full", on ? markOn : markOff, focusRing)}
            >
              <Radio.Indicator className="block size-1.5 rounded-full bg-white" />
            </Radio.Root>
            <span className="min-w-0">
              <span id={`${optionId}-title`} className="block font-medium text-strong">
                {option.label}
              </span>
              {option.description || option.disabledReason ? (
                <span id={`${optionId}-description`} className="block text-xs text-muted-foreground">
                  {option.disabled && option.disabledReason ? option.disabledReason : option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </RadioGroupPrimitive>
  );
}
markComposite(RadioGroup);

/**
 * A few short alternatives kept in view, side by side. Native radios underneath, so arrow keys, form
 * submission and reset behave the way a browser does. An empty `value` means nothing is chosen yet.
 */
export function SegmentedControl<V extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  tip,
  className,
  density = "default",
  hideLabel = false,
}: {
  label: string;
  value: V | "" | null;
  options: readonly { id: V; label: React.ReactNode; hint?: string }[];
  onChange: (value: V) => void;
  disabled?: boolean;
  tip?: React.ReactNode;
  className?: string;
  density?: Density;
  hideLabel?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className={cn("grid grid-cols-1 gap-1.5 text-sm", className)} disabled={disabled}>
      <legend className={cn("mb-1.5 flex items-center gap-0.5 font-medium text-strong", hideLabel && "sr-only")}>
        {label}
        {tip}
      </legend>
      <div className={cn("flex flex-wrap gap-1.5", density === "compact" && "gap-1")}>
        {options.map((option) => {
          const on = value === option.id;
          return (
            <label
              key={option.id}
              className={cn(
                "inline-flex cursor-pointer items-center rounded-lg border px-3 text-sm transition-colors motion-reduce:transition-none",
                density === "compact" ? "min-h-control-sm px-2.5 text-[13px]" : "min-h-9 py-1.5",
                on ? cn(selectedSurface, "font-medium text-strong") : cn(restingSurface, "text-muted-foreground"),
                focusWithin,
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input type="radio" className="sr-only" name={name} value={option.id} checked={on} onChange={() => onChange(option.id)} />
              {option.label}
              {option.hint ? <span className="ml-1 text-xs text-muted-foreground">{option.hint}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Keyboard behaviour for a group of custom `role="radio"` buttons whose look is their own (an illustrated
 * booking card, a tip grid, a 1–5 rating). Arrow keys move and choose, Home and End jump to the ends, and
 * only the chosen button (or the first) is in the Tab order, the way a native radio group behaves. Each
 * button keeps its own onClick, aria-checked and styling.
 */
export function RadioButtonGroup({ children, className, id, ...aria }: { children: React.ReactNode; className?: string; id?: string; "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const radios = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])];
  useEffect(() => {
    const all = radios();
    const enabled = all.filter((radio) => !radio.disabled);
    const current = enabled.find((radio) => radio.getAttribute("aria-checked") === "true") ?? enabled[0];
    for (const radio of all) radio.tabIndex = radio === current ? 0 : -1;
  });
  return (
    <div
      ref={ref}
      id={id}
      role="radiogroup"
      {...aria}
      className={className}
      onKeyDown={(event) => {
        const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
        if (!keys.includes(event.key)) return;
        const enabled = radios().filter((radio) => !radio.disabled);
        const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
        if (at === -1 || enabled.length === 0) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next].focus();
        enabled[next].click();
      }}
    >
      {children}
    </div>
  );
}
