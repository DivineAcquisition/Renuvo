"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { useId } from "react";

import { Check, Minus } from "@/components/icons";
import { cn } from "@/lib/utils";

import { focusRing, focusWithin, markBase, markOff, markOn, restingSurface, selectedSurface, type Density } from "./tokens";

export type CheckboxProps = {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Some, not all, of a group is chosen. Shown as a dash and announced as "mixed". */
  indeterminate?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "data-testid"?: string;
};

/**
 * A checkbox: the Base UI primitive with Selestial's mark. Checked, unchecked and partly checked each
 * have their own shape (tick, empty, dash), so the state never depends on colour.
 */
export function Checkbox({ checked, onCheckedChange, indeterminate = false, className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(next: boolean) => onCheckedChange?.(next)}
      className={cn(
        markBase,
        "rounded-[5px]",
        checked || indeterminate ? markOn : markOff,
        focusRing,
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[readonly]:cursor-default",
        props["aria-invalid"] ? "border-destructive/70" : null,
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">{indeterminate ? <Minus className="size-3" aria-hidden /> : <Check className="size-3" aria-hidden />}</CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/**
 * A checkbox with a title and a short explanation, for a preference or an acknowledgment. The whole row
 * is the target. `aside` (a help link, a "Why this?" toggle) sits outside the label so pressing it never
 * ticks the box.
 */
export function CheckboxRow({
  checked,
  onCheckedChange,
  title,
  description,
  aside,
  disabled,
  readOnly,
  required,
  name,
  value,
  indeterminate,
  density = "default",
  bordered = false,
  className,
  invalid,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  indeterminate?: boolean;
  density?: Density;
  /** Draws the row as a quiet card. Leave it off for ordinary preferences so they stay compact. */
  bordered?: boolean;
  className?: string;
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn("grid gap-1", bordered && cn("rounded-xl border px-3.5 py-3 transition-colors motion-reduce:transition-none", checked ? selectedSurface : restingSurface, focusWithin), className)}>
      <label className={cn("flex items-start gap-2.5 text-sm", disabled ? "cursor-not-allowed opacity-70" : readOnly ? "cursor-default" : "cursor-pointer", density === "compact" && "gap-2 text-[13px]")}>
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          name={name}
          value={value}
          aria-labelledby={`${id}-title`}
          aria-describedby={description ? `${id}-description` : undefined}
          aria-invalid={invalid || undefined}
          className="mt-[0.1875rem]"
        />
        <span className="min-w-0">
          <span id={`${id}-title`} className="block font-medium text-strong">
            {title}
            {required ? (
              <span className="ml-0.5 text-muted-foreground" aria-hidden>
                *
              </span>
            ) : null}
          </span>
          {description ? (
            <span id={`${id}-description`} className="block text-xs text-muted-foreground">
              {description}
            </span>
          ) : null}
        </span>
      </label>
      {aside ? <div className="pl-7 text-xs">{aside}</div> : null}
    </div>
  );
}

/**
 * The header checkbox of a table, and the line that tells "this page" apart from "everything that
 * matches". Selecting the page never quietly selects records the person cannot see. Returns the two
 * pieces so a table can put the checkbox in its header cell and the line above its rows.
 */
export function tableSelection({
  pageSize,
  selectedOnPage,
  matching,
  allMatching,
  onSelectPage,
  onSelectAllMatching,
  onClear,
  noun = "records",
}: {
  /** Rows shown on this page. */
  pageSize: number;
  /** How many of those rows are selected. */
  selectedOnPage: number;
  /** How many records match the current filters, across every page. Leave out if unknown. */
  matching?: number;
  /** True when the selection is "every matching record", not a list of ids. */
  allMatching: boolean;
  onSelectPage: (checked: boolean) => void;
  onSelectAllMatching?: () => void;
  onClear: () => void;
  noun?: string;
}) {
  const all = allMatching || (pageSize > 0 && selectedOnPage === pageSize);
  const some = !all && selectedOnPage > 0;
  return {
    header: <Checkbox checked={all} indeterminate={some} onCheckedChange={(checked) => (checked ? onSelectPage(true) : onClear())} aria-label={all ? `Clear selection` : `Select all ${pageSize} on this page`} disabled={pageSize === 0} />,
    banner:
      allMatching ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-strong">
          All {matching?.toLocaleString("en-US") ?? ""} matching {noun} are selected.
          <button type="button" onClick={onClear} className={cn("font-medium text-[var(--sel-accent,var(--brand))] underline-offset-2 hover:underline", focusRing)}>
            Clear selection
          </button>
        </p>
      ) : all && matching !== undefined && matching > pageSize && onSelectAllMatching ? (
        <p role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-strong">
          All {pageSize} on this page are selected.
          <button type="button" onClick={onSelectAllMatching} className={cn("font-medium text-[var(--sel-accent,var(--brand))] underline-offset-2 hover:underline", focusRing)}>
            Select all {matching.toLocaleString("en-US")} matching {noun}
          </button>
        </p>
      ) : null,
  };
}
