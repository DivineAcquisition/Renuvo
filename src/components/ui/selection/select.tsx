"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";

import { Check, ChevronDown, Loader2 } from "@/components/icons";
import { cn } from "@/lib/utils";

import { joinIds, markComposite, useFieldControl } from "./field-context";
import { controlHeight, controlPadding, fieldSurface, focusRing, optionRow, popupSurface, type Density } from "./tokens";
import { groupOptions, type ListState, type Option } from "./types";

export type SelectProps<V extends string> = ListState & {
  /** The chosen value. `null` or "" means nothing is chosen; it is shown as the placeholder, never as the first option. */
  value: V | null | "";
  /** Called with the new value. `null` only when `emptyLabel` is offered and chosen. */
  onValueChange: (value: V | null) => void;
  options: readonly Option<V>[];
  placeholder?: string;
  /** Offers a way back to "nothing chosen" (for an optional field), under this label. */
  emptyLabel?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  density?: Density;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "data-testid"?: string;
};

const EMPTY = "__selestial_empty__";

/**
 * A short, predefined single choice. Options can carry a description, an icon, a group, and a reason
 * they are disabled. The popup positions itself against the trigger and stays inside dialogs, sheets and
 * scrolling containers. Inside a Field, the trigger is the labelled, described control.
 */
export function Select<V extends string>({ value, onValueChange, options, placeholder = "Choose…", emptyLabel, disabled, readOnly, required, name, density = "default", id, className, loading, error, onRetry, emptyText = "Nothing to choose from yet.", ...aria }: SelectProps<V>) {
  const field = useFieldControl();
  const current = value === "" || value === null ? null : value;
  const chosen = current === null ? undefined : options.find((option) => option.value === current);
  const invalid = aria["aria-invalid"] ?? field?.invalid;
  return (
    <SelectPrimitive.Root
      value={current ?? (emptyLabel ? EMPTY : null)}
      onValueChange={(next: unknown) => onValueChange(next === EMPTY || next === null ? null : (next as V))}
      disabled={disabled}
      readOnly={readOnly}
      required={required ?? field?.required}
      name={name}
    >
      <SelectPrimitive.Trigger
        id={id ?? field?.controlId}
        aria-label={aria["aria-label"]}
        aria-labelledby={aria["aria-labelledby"] ?? (aria["aria-label"] ? undefined : field?.labelId)}
        aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy)}
        aria-invalid={invalid || undefined}
        data-testid={aria["data-testid"]}
        className={cn(fieldSurface, controlHeight[density], controlPadding[density], "flex cursor-pointer items-center gap-2 text-left data-[disabled]:cursor-not-allowed", focusRing, invalid && "border-destructive/60", className)}
      >
        <SelectPrimitive.Value className="min-w-0 flex-1 truncate">
          {() =>
            chosen ? (
              <span className="flex min-w-0 items-center gap-2">
                {chosen.icon ? <span className="shrink-0 text-muted-foreground">{chosen.icon}</span> : null}
                <span className="truncate">{chosen.label}</span>
              </span>
            ) : current !== null ? (
              // A saved value that is no longer offered stays chosen and says so, rather than vanishing.
              <span className="truncate text-muted-foreground">No longer available ({current})</span>
            ) : (
              <span className="truncate text-muted-foreground/80">{placeholder}</span>
            )
          }
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown className="size-4" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner className="z-[80] outline-none" sideOffset={6} collisionPadding={12} alignItemWithTrigger={false}>
          <SelectPrimitive.Popup className={popupSurface}>
            {loading ? (
              <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground" role="status">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Loading…
              </p>
            ) : error ? (
              <div className="grid gap-1 px-2 py-2 text-sm" role="alert">
                <p className="text-strong">{error}</p>
                {onRetry ? (
                  <button type="button" onClick={onRetry} className={cn("justify-self-start text-xs font-medium text-[var(--sel-accent,var(--brand))] underline-offset-2 hover:underline", focusRing)}>
                    Try again
                  </button>
                ) : null}
              </div>
            ) : options.length === 0 && !emptyLabel ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              <SelectPrimitive.List>
                {emptyLabel ? <OptionItem option={{ value: EMPTY, label: emptyLabel }} muted /> : null}
                {groupOptions(options).map((group, at) =>
                  group.group ? (
                    <SelectPrimitive.Group key={`${group.group}-${at}`} className="mt-1 first:mt-0">
                      <SelectPrimitive.GroupLabel className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{group.group}</SelectPrimitive.GroupLabel>
                      {group.options.map((option) => (
                        <OptionItem key={option.value} option={option} />
                      ))}
                    </SelectPrimitive.Group>
                  ) : (
                    group.options.map((option) => <OptionItem key={option.value} option={option} />)
                  ),
                )}
              </SelectPrimitive.List>
            )}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
markComposite(Select);

function OptionItem({ option, muted }: { option: Option<string>; muted?: boolean }) {
  return (
    <SelectPrimitive.Item value={option.value} disabled={option.disabled} label={option.label} className={optionRow}>
      <SelectPrimitive.ItemIndicator className="mt-0.5 text-[var(--sel-accent,var(--brand))]">
        <Check className="size-4" aria-hidden />
      </SelectPrimitive.ItemIndicator>
      <span className="col-start-2 grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {option.icon ? <span className="shrink-0 text-muted-foreground">{option.icon}</span> : null}
          <SelectPrimitive.ItemText className={cn("break-words", muted && "text-muted-foreground")}>{option.label}</SelectPrimitive.ItemText>
        </span>
        {option.meta ? <span className="text-xs break-words text-muted-foreground">{option.meta}</span> : null}
        {option.disabled && option.disabledReason ? <span className="text-xs text-muted-foreground">{option.disabledReason}</span> : option.description ? <span className="text-xs text-muted-foreground">{option.description}</span> : null}
      </span>
    </SelectPrimitive.Item>
  );
}
