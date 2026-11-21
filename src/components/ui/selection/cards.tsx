"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { useId } from "react";

import { Check } from "@/components/icons";
import { cn } from "@/lib/utils";

import { joinIds, markComposite, useFieldControl } from "./field-context";
import { focusRing, markBase, markOff, markOn, restingSurface, selectedSurface } from "./tokens";
import type { Option } from "./types";

type CardOption<V extends string> = Option<V>;

const COLUMNS = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" } as const;

function Mark({ on, round }: { on: boolean; round: boolean }) {
  return (
    <span className={cn(markBase, "mt-0.5 size-5", round ? "rounded-full" : "rounded-md", on ? markOn : markOff)} aria-hidden>
      {on ? round ? <span className="block size-2 rounded-full bg-white" /> : <Check className="size-3.5" /> : null}
    </span>
  );
}

function CardBody<V extends string>({ option, on, round, titleId, descriptionId }: { option: CardOption<V>; on: boolean; round: boolean; titleId: string; descriptionId: string }) {
  return (
    <>
      <Mark on={on} round={round} />
      {option.icon ? (
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg transition-colors motion-reduce:transition-none", on ? "bg-[var(--sel-accent,var(--brand))] text-white" : "bg-muted text-muted-foreground")} aria-hidden>
          {option.icon}
        </span>
      ) : null}
      <span className="min-w-0">
        <span id={titleId} className="block text-sm font-medium text-strong">
          {option.label}
        </span>
        {option.description || (option.disabled && option.disabledReason) ? (
          <span id={descriptionId} className="mt-0.5 block text-xs text-muted-foreground">
            {option.disabled && option.disabledReason ? option.disabledReason : option.description}
          </span>
        ) : null}
      </span>
    </>
  );
}

const cardButton = cn("flex w-full items-start gap-3 rounded-xl px-3.5 py-3 text-left", focusRing, "data-[disabled]:cursor-not-allowed");

type Shared<V extends string> = {
  options: readonly CardOption<V>[];
  columns?: 1 | 2 | 3;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
  /** Content under a card, outside its button: a field that belongs to the choice, a help link. Never toggles it. */
  extra?: (option: CardOption<V>, selected: boolean) => React.ReactNode;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

function Frame({ on, disabled, children }: { on: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <div className={cn("flex flex-col rounded-xl border transition-colors duration-150 motion-reduce:transition-none", on ? selectedSurface : restingSurface, disabled && "opacity-70")}>{children}</div>;
}

/**
 * Important choices drawn as cards: a business's categories, a pricing method, the first priority.
 * `type="single"` is a radio group (arrow keys move between cards); `type="multiple"` is a set of
 * checkboxes. Each card has a visible mark, a title and an optional explanation and icon, so the selected
 * state is never colour alone.
 */
export function SelectionCards<V extends string>(props: (Shared<V> & { type: "single"; value: V | null; onValueChange: (value: V) => void; required?: boolean; name?: string }) | (Shared<V> & { type: "multiple"; value: readonly V[]; onValueChange: (value: V[]) => void; max?: number })) {
  const id = useId();
  const field = useFieldControl();
  const { options, columns = 2, disabled, readOnly, className, extra } = props;
  const labelledBy = props["aria-labelledby"] ?? (props["aria-label"] ? undefined : field?.labelId);
  const describedBy = joinIds(props["aria-describedby"], field?.describedBy);

  if (props.type === "single") {
    return (
      <RadioGroupPrimitive
        value={props.value}
        onValueChange={(next: unknown) => props.onValueChange(next as V)}
        disabled={disabled}
        readOnly={readOnly}
        required={props.required}
        name={props.name}
        aria-label={props["aria-label"]}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={cn("grid gap-2", COLUMNS[columns], className)}
      >
        {options.map((option) => {
          const on = props.value === option.value;
          const optionId = `${id}-${option.value}`;
          return (
            <Frame key={option.value} on={on} disabled={option.disabled}>
              <Radio.Root value={option.value} disabled={option.disabled} aria-labelledby={`${optionId}-title`} aria-describedby={option.description || option.disabledReason ? `${optionId}-description` : undefined} className={cardButton}>
                <CardBody option={option} on={on} round titleId={`${optionId}-title`} descriptionId={`${optionId}-description`} />
              </Radio.Root>
              {extra ? extra(option, on) : null}
            </Frame>
          );
        })}
      </RadioGroupPrimitive>
    );
  }

  const chosen = props.value;
  const full = props.max !== undefined && chosen.length >= props.max;
  return (
    <div role="group" aria-label={props["aria-label"]} aria-labelledby={labelledBy} aria-describedby={describedBy} className={cn("grid gap-2", COLUMNS[columns], className)}>
      {options.map((option) => {
        const on = chosen.includes(option.value);
        const blockedByLimit = full && !on;
        const optionId = `${id}-${option.value}`;
        const reason = blockedByLimit ? `You can choose up to ${props.max}. Clear one to choose this instead.` : option.disabledReason;
        const shown = { ...option, disabled: option.disabled || blockedByLimit, disabledReason: reason };
        return (
          <Frame key={option.value} on={on} disabled={shown.disabled}>
            <CheckboxPrimitive.Root
              checked={on}
              disabled={disabled || shown.disabled}
              readOnly={readOnly}
              onCheckedChange={(next: boolean) => props.onValueChange(next ? [...chosen, option.value] : chosen.filter((value) => value !== option.value))}
              aria-labelledby={`${optionId}-title`}
              aria-describedby={shown.description || (shown.disabled && reason) ? `${optionId}-description` : undefined}
              className={cardButton}
            >
              <CardBody option={shown} on={on} round={false} titleId={`${optionId}-title`} descriptionId={`${optionId}-description`} />
            </CheckboxPrimitive.Root>
            {extra ? extra(option, on) : null}
          </Frame>
        );
      })}
    </div>
  );
}

markComposite(SelectionCards);

/**
 * One selection card on its own, for a card whose surroundings are custom (a priority card with an
 * "also important" box under it). Prefer SelectionCards for a plain set.
 */
export function SelectionCard({
  selected,
  onPress,
  title,
  description,
  icon,
  multi = false,
  disabled,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  multi?: boolean;
  disabled?: boolean;
  /** Shown under the card's button. Its controls never toggle the card. */
  children?: React.ReactNode;
}) {
  const id = useId();
  const option: CardOption<string> = { value: id, label: title, description, icon };
  return (
    <Frame on={selected} disabled={disabled}>
      <button type="button" role={multi ? "checkbox" : "radio"} aria-checked={selected} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} onClick={onPress} disabled={disabled} className={cn(cardButton, "disabled:cursor-not-allowed")}>
        <CardBody option={option} on={selected} round={!multi} titleId={`${id}-title`} descriptionId={`${id}-description`} />
      </button>
      {children ? <div className="px-3.5 pb-3 pl-11.5">{children}</div> : null}
    </Frame>
  );
}
