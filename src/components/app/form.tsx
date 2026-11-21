"use client";

import { Children, cloneElement, Fragment, isValidElement, useId, useState } from "react";

import { SearchableSelect } from "@/components/ui/selection/combobox";
import { FieldControlContext, isComposite, joinIds, markComposite, useFieldControl } from "@/components/ui/selection/field-context";
import { Select } from "@/components/ui/selection/select";
import type { Option } from "@/components/ui/selection/types";
import { cn } from "@/lib/utils";

/** The words a refused request carries. Messages meant for a person travel as ConvexError data. */
export function messageOf(error: unknown): string {
  const data = (error as { data?: { message?: unknown } } | null)?.data;
  if (data && typeof data.message === "string") return data.message;
  return "That did not go through. Please try again.";
}

/** Runs one request at a time and keeps what went wrong in words. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (caught) {
      setError(messageOf(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

const control =
  "block w-full min-h-10 rounded-lg border border-border bg-card px-3 py-2 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30 aria-invalid:border-destructive/60 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:text-muted-foreground";

/**
 * A labelled control. A hint and an error are tied to the control with aria-describedby, and an error
 * marks it invalid, so a screen reader announces the problem with the field it belongs to.
 *
 * A native input, select or textarea is wrapped in the label and given the description directly. A
 * composite control from the selection system (Select, SearchableSelect, MultiSelect, RadioGroup) is
 * not: its focusable element is inside it, so it reads the ids from context and names itself. `aside`
 * sits under the control, outside the label, for a source chip or a suggestion with its own buttons.
 */
export function Field({ label, hint, error, children, className, aside, required }: { label: string; hint?: string; error?: string | null; children: React.ReactNode; className?: string; aside?: React.ReactNode; required?: boolean }) {
  const id = useId();
  const described = joinIds(error ? `${id}-error` : null, hint ? `${id}-hint` : null);
  const context = { controlId: `${id}-control`, labelId: `${id}-label`, describedBy: described, invalid: Boolean(error), required };
  const composite = isValidElement(children) && isComposite(children.type);
  const words = (
    <>
      {error ? (
        <span id={`${id}-error`} className="text-xs font-medium text-destructive-foreground">
          {error}
        </span>
      ) : null}
      {hint ? (
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </>
  );
  const title = (
    <>
      {label}
      {required ? (
        <span className="ml-0.5 text-muted-foreground" aria-hidden>
          *
        </span>
      ) : null}
    </>
  );
  if (composite) {
    return (
      <FieldControlContext.Provider value={context}>
        <div className={cn("grid content-start gap-1.5 text-sm", className)}>
          <label id={context.labelId} htmlFor={context.controlId} className="font-medium text-strong">
            {title}
          </label>
          {children}
          {words}
          {aside}
        </div>
      </FieldControlContext.Provider>
    );
  }
  const linked = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { "aria-describedby": joinIds(children.props["aria-describedby"] as string | undefined, described), ...(error ? { "aria-invalid": true } : {}), ...(required ? { required: true } : {}) })
    : children;
  // Without an aside the markup is exactly what it always was: one label around the control.
  if (!aside) {
    return (
      <FieldControlContext.Provider value={context}>
        <label className={cn("grid content-start gap-1.5 text-sm", className)}>
          <span className="font-medium text-strong">{title}</span>
          {linked}
          {words}
        </label>
      </FieldControlContext.Provider>
    );
  }
  return (
    <FieldControlContext.Provider value={context}>
      <div className={cn("grid content-start gap-1.5 text-sm", className)}>
        <label className="grid content-start gap-1.5">
          <span className="font-medium text-strong">{title}</span>
          {linked}
          {words}
        </label>
        {aside}
      </div>
    </FieldControlContext.Provider>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cn(control, "min-h-20", props.className)} />;
}

/**
 * The app's dropdown. It keeps the native select's contract (`<option>` and `<optgroup>` children,
 * `value` or `defaultValue`, and `onChange` reading `event.target.value`), so every screen that used the
 * native element moved without rewriting its handler, and draws the shared selection system's Select:
 * the same trigger, popup, checkmark, focus and disabled states everywhere. Long lists (more than 15
 * options) become searchable. An `<option value="">` becomes the way back to "nothing chosen"; a disabled
 * one is only the placeholder. `name` and `required` still reach the form through a hidden input.
 */
export function SelectInput({ value, defaultValue, onChange, children, className, disabled, required, name, id, placeholder, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { placeholder?: string }) {
  const field = useFieldControl();
  const [own, setOwn] = useState(() => (defaultValue === undefined || defaultValue === null ? "" : String(defaultValue)));
  const controlled = value !== undefined;
  const current = controlled ? (value === null ? "" : String(value)) : own;
  const { options, empty } = optionsOf(children);
  const aria = rest as Record<string, unknown>;
  const change = (next: string | null) => {
    const picked = next ?? "";
    if (!controlled) setOwn(picked);
    const target = { value: picked, name: name ?? "" };
    onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
  };
  const shared = {
    value: current,
    onValueChange: change,
    options,
    disabled,
    required,
    name,
    id: id ?? field?.controlId,
    className: cn(className),
    "aria-label": aria["aria-label"] as string | undefined,
    "aria-labelledby": aria["aria-labelledby"] as string | undefined,
    "aria-describedby": joinIds(aria["aria-describedby"] as string | undefined, field?.describedBy),
    "aria-invalid": Boolean(aria["aria-invalid"]) || field?.invalid || undefined,
    "data-testid": aria["data-testid"] as string | undefined,
  };
  if (options.length > 15) return <SearchableSelect {...shared} placeholder={placeholder ?? empty?.label ?? "Search…"} clearable={Boolean(empty && !empty.disabled)} />;
  return <Select {...shared} placeholder={placeholder ?? empty?.label ?? "Choose…"} emptyLabel={empty && !empty.disabled ? empty.label : undefined} />;
}
markComposite(SelectInput);

/** Reads `<option>` / `<optgroup>` children (through fragments, arrays and maps) into the shared Option shape. */
function optionsOf(children: React.ReactNode): { options: Option[]; empty: { label: string; disabled: boolean } | null } {
  const options: Option[] = [];
  const found: { empty: { label: string; disabled: boolean } | null } = { empty: null };
  const walk = (nodes: React.ReactNode, group?: string) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ children?: React.ReactNode; value?: unknown; label?: string; disabled?: boolean }>(node)) return;
      if (node.type === Fragment) return walk(node.props.children, group);
      if (node.type === "optgroup") return walk(node.props.children, node.props.label);
      if (node.type !== "option") return;
      const label = textOf(node.props.children);
      const value = node.props.value === undefined ? label : String(node.props.value);
      if (value === "") {
        found.empty = { label, disabled: Boolean(node.props.disabled) };
        return;
      }
      options.push({ value, label, group, disabled: node.props.disabled });
    });
  };
  walk(children);
  return { options, empty: found.empty };
}

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
      {message}
    </p>
  );
}
