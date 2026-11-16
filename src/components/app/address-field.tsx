"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Field, TextInput } from "@/components/app/form";
import { MapPin } from "@/components/icons";
import { details, mapsKey, newSession, suggest, type PickedAddress, type Suggestion } from "@/lib/app/address";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: string;
  /** What is typed in the street field. Typing always works, with or without a suggestion. */
  onChange: (value: string) => void;
  /** A suggestion was picked: fill every address field from it. */
  onPick: (address: PickedAddress) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  hint?: string;
};

/**
 * The street field of an address, with Google's US address suggestions as you type. Picking one fills
 * the rest of the address (and its map location) through `onPick`. Without the Maps key it is a plain
 * field, so every form still works.
 */
export function AddressField({ label, value, onChange, onPick, required, disabled, className, hint }: Props) {
  const enabled = mapsKey() !== null;
  const list = useId();
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState<string | null>(null);
  const session = useRef<string>("");
  const typed = useRef(false);
  // Suggestions for an earlier, longer search are not shown once the field is nearly empty again.
  const shown = value.trim().length >= 3 ? options : [];

  // Ask Google a moment after typing stops, and drop an answer that arrives after newer typing.
  useEffect(() => {
    if (!enabled || !typed.current) return;
    const query = value.trim();
    if (query.length < 3) return;
    if (!session.current) session.current = newSession();
    const controller = new AbortController();
    const timer = setTimeout(() => {
      suggest(query, session.current, controller.signal)
        .then((found) => {
          setOptions(found);
          setActive(-1);
          setOpen(found.length > 0);
          setProblem(null);
        })
        .catch((error: unknown) => {
          if ((error as { name?: string })?.name === "AbortError") return;
          setOptions([]);
          setProblem("Address suggestions are unavailable right now. You can type the address.");
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, enabled]);

  async function pick(option: Suggestion) {
    setOpen(false);
    setOptions([]);
    typed.current = false;
    try {
      onPick(await details(option.placeId, session.current || newSession()));
      setProblem(null);
    } catch {
      onChange(option.main);
      setProblem("That address could not be filled in. Please check the city, state and ZIP.");
    } finally {
      session.current = "";
    }
  }

  const input = (
    <TextInput
      value={value}
      onChange={(event) => {
        typed.current = true;
        onChange(event.target.value);
      }}
      required={required}
      disabled={disabled}
      autoComplete={enabled ? "off" : "address-line1"}
      role={enabled ? "combobox" : undefined}
      aria-expanded={enabled ? open : undefined}
      aria-controls={enabled ? list : undefined}
      aria-autocomplete={enabled ? "list" : undefined}
      aria-activedescendant={enabled && open && active >= 0 ? `${list}-${active}` : undefined}
      onBlur={() => setTimeout(() => setOpen(false), 120)}
      onFocus={() => setOpen(shown.length > 0)}
      onKeyDown={(event) => {
        if (!enabled || !open || shown.length === 0) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const step = event.key === "ArrowDown" ? 1 : -1;
          setActive((current) => (current + step + shown.length) % shown.length);
        } else if (event.key === "Enter" && active >= 0) {
          event.preventDefault();
          void pick(shown[active]);
        } else if (event.key === "Escape") {
          setOpen(false);
        }
      }}
    />
  );

  return (
    <Field label={label} hint={problem ?? hint ?? (enabled ? "Start typing and pick your address, or type it in full." : undefined)} className={className}>
      <span className="relative block">
        {input}
        {enabled && open && shown.length > 0 ? (
          <ul id={list} role="listbox" aria-label={`Suggested addresses for ${label}`} className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg">
            {shown.map((option, index) => (
              <li
                key={option.placeId}
                id={`${list}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void pick(option)}
                onMouseEnter={() => setActive(index)}
                className={cn("flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-sm", index === active ? "bg-muted" : "")}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-strong">{option.main}</span>
                  {option.secondary ? <span className="block truncate text-xs text-muted-foreground">{option.secondary}</span> : null}
                </span>
              </li>
            ))}
            <li role="presentation" className="px-2.5 pt-1 pb-0.5 text-right text-[10px] text-muted-foreground">
              Suggestions from Google
            </li>
          </ul>
        ) : null}
      </span>
    </Field>
  );
}
