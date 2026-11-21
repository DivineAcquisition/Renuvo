"use client";

import { useId, useMemo, useState } from "react";

import { Plus, X } from "@/components/icons";
import { joinIds, markComposite, useFieldControl } from "@/components/ui/selection/field-context";
import { focusRing } from "@/components/ui/selection/tokens";
import { cn } from "@/lib/utils";

export type ListSuggestion = { value: string; label?: string; detail?: string };

/**
 * A list a person builds one item at a time: skills, ZIP codes, tags, answer options. Each item is a
 * removable chip. Typing shows matching suggestions; Enter or a comma adds what is typed; pasting a
 * list adds each item. A duplicate (compared case-insensitively, never merged silently) is refused with a
 * reason, as is anything `validate` rejects. Values are kept exactly as strings, so "02134" stays "02134".
 */
export function ListInput({
  value,
  onChange,
  suggestions = [],
  allowCustom = true,
  validate,
  normalize = (text) => text.trim(),
  placeholder = "Type and press Enter",
  noun = "item",
  max,
  disabled,
  id,
  className,
  ...aria
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Choices Selestial already has (the service catalog, existing tags). Shown as you type. */
  suggestions?: readonly ListSuggestion[];
  /** False when only the suggestions are allowed by what the record stores. */
  allowCustom?: boolean;
  /** Returns why an entry can't be added, or null. */
  validate?: (entry: string) => string | null;
  normalize?: (entry: string) => string;
  placeholder?: string;
  noun?: string;
  max?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const field = useFieldControl();
  const own = useId();
  const inputId = id ?? field?.controlId ?? own;
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const keyOf = (entry: string) => entry.toLocaleLowerCase();
  const taken = useMemo(() => new Set(value.map(keyOf)), [value]);
  const matches = useMemo(() => {
    const q = keyOf(text.trim());
    return suggestions.filter((row) => !taken.has(keyOf(row.value)) && (!q || keyOf(row.label ?? row.value).includes(q) || keyOf(row.value).includes(q))).slice(0, 8);
  }, [suggestions, taken, text]);
  const full = max !== undefined && value.length >= max;

  /** Adds entries; returns the reason the first refused one was refused. */
  const add = (entries: string[]) => {
    const next = [...value];
    const seen = new Set(next.map(keyOf));
    let refused: string | null = null;
    for (const raw of entries) {
      const entry = normalize(raw);
      if (!entry) continue;
      const known = suggestions.find((row) => keyOf(row.value) === keyOf(entry) || keyOf(row.label ?? "") === keyOf(entry));
      const stored = known ? known.value : entry;
      if (!known && !allowCustom) {
        refused ??= `“${entry}” isn't one of the choices here.`;
        continue;
      }
      if (seen.has(keyOf(stored))) {
        refused ??= `“${entry}” is already in the list.`;
        continue;
      }
      const why = validate?.(stored) ?? null;
      if (why) {
        refused ??= why;
        continue;
      }
      if (max !== undefined && next.length >= max) {
        refused ??= `You can add up to ${max}.`;
        break;
      }
      next.push(stored);
      seen.add(keyOf(stored));
    }
    if (next.length !== value.length) onChange(next);
    setProblem(refused);
    return refused;
  };

  const commit = () => {
    if (active >= 0 && matches[active]) {
      add([matches[active].value]);
    } else if (text.trim()) {
      if (add([text]) !== null) return;
    }
    setText("");
    setActive(-1);
  };

  const listId = `${inputId}-suggestions`;
  const problemId = `${inputId}-problem`;
  const labelOf = (entry: string) => suggestions.find((row) => row.value === entry)?.label ?? entry;

  return (
    <div className={cn("grid gap-1.5", className)}>
      {value.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={`${value.length} ${noun}${value.length === 1 ? "" : "s"} added`}>
          {value.map((entry) => (
            <li key={entry} className="inline-flex max-w-full items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_30%,var(--border))] bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_7%,var(--card))] py-0.5 pr-1 pl-2.5 text-xs text-strong">
              <span className="truncate">{labelOf(entry)}</span>
              {!disabled ? (
                <button type="button" aria-label={`Remove ${labelOf(entry)}`} onClick={() => onChange(value.filter((item) => item !== entry))} className={cn("grid size-5 place-items-center rounded-full text-muted-foreground hover:text-strong", focusRing)}>
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {!disabled ? (
        <div className="relative">
          <div className="flex min-h-control-md items-center gap-1 rounded-lg border border-border bg-card pr-1 pl-3 text-sm has-[:focus-visible]:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_60%,var(--border))] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)]">
            <input
              id={inputId}
              role="combobox"
              aria-expanded={matches.length > 0 && text.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              aria-label={aria["aria-label"]}
              aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy, problem ? problemId : undefined)}
              aria-invalid={problem ? true : field?.invalid || undefined}
              value={text}
              disabled={full}
              placeholder={full ? `The list is full (${max})` : placeholder}
              onChange={(event) => {
                setText(event.target.value);
                setProblem(null);
                setActive(-1);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || (event.key === "," && allowCustom)) {
                  event.preventDefault();
                  commit();
                } else if (event.key === "ArrowDown" && matches.length) {
                  event.preventDefault();
                  setActive((at) => (at + 1) % matches.length);
                } else if (event.key === "ArrowUp" && matches.length) {
                  event.preventDefault();
                  setActive((at) => (at <= 0 ? matches.length - 1 : at - 1));
                } else if (event.key === "Escape") {
                  setText("");
                  setActive(-1);
                } else if (event.key === "Backspace" && !text && value.length) {
                  onChange(value.slice(0, -1));
                }
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text");
                if (!/[,;\n\t]/.test(pasted)) return;
                event.preventDefault();
                add(pasted.split(/[,;\n\t]+/));
                setText("");
              }}
              className="h-full min-w-0 flex-1 bg-transparent py-2 text-strong outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
            />
            <button type="button" onClick={commit} disabled={!text.trim() || full} aria-label={`Add ${noun}`} className={cn("grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-strong disabled:opacity-40", focusRing)}>
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
          {matches.length > 0 && text.length > 0 ? (
            <ul id={listId} role="listbox" className="absolute z-[80] mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg shadow-black/10">
              {matches.map((row, at) => (
                <li
                  key={row.value}
                  id={`${listId}-${at}`}
                  role="option"
                  aria-selected={at === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    add([row.value]);
                    setText("");
                    setActive(-1);
                  }}
                  className={cn("cursor-default rounded-lg px-2 py-1.5 text-sm text-strong", at === active && "bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_9%,transparent)]")}
                >
                  {row.label ?? row.value}
                  {row.detail ? <span className="block text-xs text-muted-foreground">{row.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : value.length === 0 ? (
        <p className="text-sm text-muted-foreground">None added.</p>
      ) : null}
      {problem ? (
        <p id={problemId} role="alert" className="text-xs font-medium text-destructive-foreground">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
markComposite(ListInput);

/** A US ZIP code: five digits, kept as text so a leading zero survives. */
export function zipProblem(entry: string): string | null {
  return /^\d{5}$/.test(entry) ? null : `“${entry}” isn't a 5-digit ZIP code.`;
}
