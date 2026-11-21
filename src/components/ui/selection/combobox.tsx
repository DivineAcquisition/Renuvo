"use client";

import { Combobox } from "@base-ui/react/combobox";
import { useEffect, useMemo, useRef, useState } from "react";

import { Check, ChevronDown, Loader2, Search, X } from "@/components/icons";
import { cn } from "@/lib/utils";

import { joinIds, markComposite, useFieldControl } from "./field-context";
import { controlHeight, fieldSurface, focusRing, optionRow, popupSurface, type Density } from "./tokens";
import { matches, type ListState, type Option } from "./types";

type Shared<V extends string> = ListState & {
  options: readonly Option<V>[];
  /**
   * Options for values that are chosen but not in `options` right now (another page of results, a
   * filtered-out record). They keep their label. A chosen value with no option anywhere is shown as no
   * longer available, never silently dropped.
   */
  known?: readonly Option<V>[];
  /**
   * For a list searched on the server. Called with the typed words, debounced; filtering is left to the
   * caller. It should hit an ordinary index query: opening or searching a field never calls a paid model.
   */
  onSearchChange?: (query: string) => void;
  placeholder?: string;
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
};

const unavailable = <V extends string>(value: V): Option<V> => ({ value, label: "No longer available", description: "This was chosen before but can't be found now. Keep it, or clear it and choose again.", disabled: true, unavailable: true });

function useDebounced(callback: ((query: string) => void) | undefined, wait = 200) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  }, [callback]);
  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  return (query: string) => {
    if (!latest.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current?.(query), wait);
  };
}

function useLookup<V extends string>(options: readonly Option<V>[], known: readonly Option<V>[] | undefined) {
  return useMemo(() => {
    const map = new Map<string, Option<V>>();
    for (const option of known ?? []) map.set(option.value, option);
    for (const option of options) map.set(option.value, option);
    return (value: V) => map.get(value) ?? unavailable(value);
  }, [options, known]);
}

function ListBody({ loading, error, onRetry, emptyText }: ListState) {
  if (loading)
    return (
      <p className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Searching…
      </p>
    );
  if (error)
    return (
      <div className="grid gap-1 px-2 py-2 text-sm" role="alert">
        <p className="text-strong">{error}</p>
        {onRetry ? (
          <button type="button" onClick={onRetry} className={cn("justify-self-start text-xs font-medium text-[var(--sel-accent,var(--brand))] underline-offset-2 hover:underline", focusRing)}>
            Try again
          </button>
        ) : null}
      </div>
    );
  return (
    <Combobox.Empty className="px-2 py-2 text-sm text-muted-foreground empty:hidden">{emptyText ?? "Nothing matches. Try other words."}</Combobox.Empty>
  );
}

function Row<V extends string>({ option }: { option: Option<V> }) {
  return (
    <Combobox.Item value={option} disabled={option.disabled} className={optionRow}>
      <Combobox.ItemIndicator className="mt-0.5 text-[var(--sel-accent,var(--brand))]">
        <Check className="size-4" aria-hidden />
      </Combobox.ItemIndicator>
      <span className="col-start-2 grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          {option.icon ? <span className="shrink-0 text-muted-foreground">{option.icon}</span> : null}
          <span className="break-words">{option.label}</span>
        </span>
        {option.meta ? <span className="text-xs break-words text-muted-foreground">{option.meta}</span> : null}
        {option.disabled && option.disabledReason ? <span className="text-xs text-muted-foreground">{option.disabledReason}</span> : option.description ? <span className="text-xs text-muted-foreground">{option.description}</span> : null}
      </span>
    </Combobox.Item>
  );
}

function Popup<V extends string>({ state }: { state: ListState }) {
  return (
    <Combobox.Portal>
      <Combobox.Positioner className="z-[80] outline-none" sideOffset={6} collisionPadding={12}>
        <Combobox.Popup className={popupSurface}>
          <ListBody {...state} />
          {state.loading || state.error ? null : <Combobox.List>{(option: Option<V>) => <Row key={option.value} option={option} />}</Combobox.List>}
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}

/**
 * A single choice from a long list: customers, properties, cleaners, templates. Type to narrow it; each
 * option can show the secondary details that tell records apart. Built on the Base UI combobox, so arrow
 * keys, Enter, Escape and focus return work as a listbox should.
 */
export function SearchableSelect<V extends string>({ value, onValueChange, options, known, onSearchChange, placeholder = "Search…", disabled, readOnly, required, name, density = "default", id, className, loading, error, onRetry, emptyText, clearable = true, ...aria }: Shared<V> & { value: V | null | ""; onValueChange: (value: V | null) => void; clearable?: boolean }) {
  const field = useFieldControl();
  const lookup = useLookup(options, known);
  const search = useDebounced(onSearchChange);
  const current = value === "" || value === null ? null : lookup(value);
  const invalid = aria["aria-invalid"] ?? field?.invalid;
  return (
    <Combobox.Root
      items={options as Option<V>[]}
      value={current}
      onValueChange={(next: unknown) => onValueChange(next ? (next as Option<V>).value : null)}
      itemToStringLabel={(option: Option<V> | null) => (option ? option.label : "")}
      isItemEqualToValue={(a: Option<V> | null, b: Option<V> | null) => a?.value === b?.value}
      filter={onSearchChange ? null : (option: Option<V>, query: string) => matches(option, query)}
      onInputValueChange={(query: string) => search(query)}
      disabled={disabled}
      readOnly={readOnly}
      required={required ?? field?.required}
      name={name}
    >
      <div className={cn(fieldSurface, controlHeight[density], "relative flex items-center gap-1 pr-1 pl-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)]", invalid && "border-destructive/60", className)}>
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Combobox.Input
          id={id ?? field?.controlId}
          placeholder={placeholder}
          aria-label={aria["aria-label"]}
          aria-labelledby={aria["aria-labelledby"]}
          aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy, current?.unavailable ? `${field?.controlId ?? id}-unavailable` : undefined)}
          aria-invalid={invalid || undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-strong outline-none placeholder:text-muted-foreground/70"
        />
        {clearable && current && !disabled && !readOnly ? (
          <Combobox.Clear aria-label="Clear" className={cn("grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-strong", focusRing)}>
            <X className="size-3.5" aria-hidden />
          </Combobox.Clear>
        ) : null}
        <Combobox.Trigger aria-label="Show options" className={cn("grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-strong", focusRing)}>
          <ChevronDown className="size-4" aria-hidden />
        </Combobox.Trigger>
      </div>
      {current?.unavailable ? (
        <p id={`${field?.controlId ?? id}-unavailable`} className="text-xs text-warning-foreground">
          The saved choice can&apos;t be found any more. It stays saved until you choose another.
        </p>
      ) : current?.meta ? (
        <p className="truncate text-xs text-muted-foreground">{current.meta}</p>
      ) : null}
      <Popup<V> state={{ loading, error, onRetry, emptyText }} />
    </Combobox.Root>
  );
}
markComposite(SearchableSelect);

/**
 * Several choices with search. What is chosen shows as removable chips above the search, a few at a time
 * so a long selection never takes over a small form; the rest are one press away. Choices that fall out of
 * the current results stay chosen.
 */
export function MultiSelect<V extends string>({
  value,
  onValueChange,
  options,
  known,
  onSearchChange,
  placeholder = "Search to add…",
  disabled,
  readOnly,
  required,
  name,
  density = "default",
  id,
  className,
  loading,
  error,
  onRetry,
  emptyText,
  max,
  visibleChips = 4,
  noun = "chosen",
  ...aria
}: Shared<V> & { value: readonly V[]; onValueChange: (value: V[]) => void; max?: number; visibleChips?: number; noun?: string }) {
  const field = useFieldControl();
  const lookup = useLookup(options, known);
  const search = useDebounced(onSearchChange);
  const [showAll, setShowAll] = useState(false);
  const chosen = value.map(lookup);
  const full = max !== undefined && value.length >= max;
  const listed = useMemo(() => (full ? options.map((option) => (value.includes(option.value) ? option : { ...option, disabled: true, disabledReason: `You can choose up to ${max}.` })) : options), [options, full, max, value]);
  const shown = showAll ? chosen : chosen.slice(0, visibleChips);
  const hidden = chosen.length - shown.length;
  const invalid = aria["aria-invalid"] ?? field?.invalid;
  const statusId = `${field?.controlId ?? id ?? "multi"}-status`;
  const locked = disabled || readOnly;

  return (
    <div className={cn("grid gap-1.5", className)}>
      {chosen.length ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Chosen" role="list">
          {shown.map((option) => (
            <span role="listitem" key={option.value} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs", option.unavailable ? "border-warning/40 bg-warning/10 text-warning-foreground" : "border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_35%,var(--border))] bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_8%,var(--card))] text-strong")}>
              <span className="truncate">{option.label}</span>
              {!locked ? (
                <button type="button" aria-label={`Remove ${option.label}`} onClick={() => onValueChange(value.filter((item) => item !== option.value))} className={cn("grid size-5 place-items-center rounded-full text-muted-foreground hover:text-strong", focusRing)}>
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ))}
          {hidden > 0 || showAll ? (
            <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className={cn("rounded-full px-2 py-0.5 text-xs font-medium text-[var(--sel-accent,var(--brand))] hover:underline", focusRing)}>
              {showAll ? "Show fewer" : `+${hidden} more`}
            </button>
          ) : null}
          {!locked && chosen.length > 1 ? (
            <button type="button" onClick={() => onValueChange([])} className={cn("ml-auto rounded px-1 text-xs text-muted-foreground hover:text-strong hover:underline", focusRing)}>
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
      <Combobox.Root
        multiple
        items={listed as Option<V>[]}
        value={chosen}
        onValueChange={(next: unknown) => onValueChange(((next as Option<V>[] | null) ?? []).map((option) => option.value))}
        itemToStringLabel={(option: Option<V> | null) => (option ? option.label : "")}
        isItemEqualToValue={(a: Option<V> | null, b: Option<V> | null) => a?.value === b?.value}
        filter={onSearchChange ? null : (option: Option<V>, query: string) => matches(option, query)}
        onInputValueChange={(query: string) => search(query)}
        disabled={disabled}
        readOnly={readOnly}
        required={required ?? field?.required}
        name={name}
      >
        <div className={cn(fieldSurface, controlHeight[density], "relative flex items-center gap-1 pr-1 pl-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)]", invalid && "border-destructive/60")}>
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Combobox.Input
            id={id ?? field?.controlId}
            placeholder={placeholder}
            aria-label={aria["aria-label"]}
            aria-labelledby={aria["aria-labelledby"]}
            aria-describedby={joinIds(aria["aria-describedby"], field?.describedBy, statusId)}
            aria-invalid={invalid || undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-strong outline-none placeholder:text-muted-foreground/70"
          />
          <Combobox.Trigger aria-label="Show options" className={cn("grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-strong", focusRing)}>
            <ChevronDown className="size-4" aria-hidden />
          </Combobox.Trigger>
        </div>
        <Popup<V> state={{ loading, error, onRetry, emptyText }} />
      </Combobox.Root>
      <p id={statusId} className="text-[11px] text-muted-foreground" aria-live="polite">
        {value.length === 0 ? "None chosen yet." : `${value.length} ${noun}`}
        {max !== undefined ? ` · up to ${max}` : ""}
        {chosen.some((option) => option.unavailable) ? " · some earlier choices can't be found and stay until you remove them" : ""}
      </p>
    </div>
  );
}
markComposite(MultiSelect);
