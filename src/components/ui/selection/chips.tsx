"use client";

import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";

import { focusRing, restingSurface, selectedSurface, type Density } from "./tokens";
import type { Option } from "./types";

/**
 * Several short, independent choices as chips ("Spreadsheets", "Paper"). Each is a checkbox to assistive
 * technology and shows a tick when chosen, so the state never rests on colour. For long lists use
 * MultiSelect instead.
 */
export function ChoiceChips<V extends string>({ options, value, onValueChange, disabled, density = "default", className, ...aria }: { options: readonly Option<V>[]; value: readonly V[]; onValueChange: (value: V[]) => void; disabled?: boolean; density?: Density; className?: string; "aria-label"?: string; "aria-labelledby"?: string }) {
  return (
    <div role="group" aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"]} className={cn("flex flex-wrap gap-2", density === "compact" && "gap-1.5", className)}>
      {options.map((option) => {
        const on = value.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange(on ? value.filter((item) => item !== option.value) : [...value, option.value])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border text-sm font-medium transition-colors duration-150 motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60",
              density === "compact" ? "min-h-control-sm px-3 text-[13px]" : "min-h-10 px-3.5",
              on ? cn(selectedSurface, "text-strong") : cn(restingSurface, "text-foreground"),
              focusRing,
            )}
          >
            {on ? <Check className="size-3.5 text-[var(--sel-accent,var(--brand))]" aria-hidden /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
