"use client";

import { createContext, useContext } from "react";

/**
 * What a Field tells the control inside it: the id its label points at, the label's own id, the ids of
 * its hint and error, and whether it is invalid. A composite control (a select trigger, a combobox input,
 * a radio group) reads this and puts the names on its own focusable element, because copying aria props
 * onto a wrapper that never takes focus leaves a screen reader with an unnamed control.
 */
export type FieldControl = { controlId: string; labelId: string; describedBy: string | undefined; invalid: boolean; required?: boolean };

export const FieldControlContext = createContext<FieldControl | null>(null);

export function useFieldControl(): FieldControl | null {
  return useContext(FieldControlContext);
}

/** Marks a component as composite so Field renders a plain label for it instead of wrapping it in one. */
export type Composite = { fieldComposite?: true };

export function isComposite(type: unknown): boolean {
  return Boolean(type && (typeof type === "function" || typeof type === "object") && (type as Composite).fieldComposite);
}

/** Merges aria-describedby lists, dropping empties and repeats. */
export function joinIds(...ids: (string | undefined | null | false)[]): string | undefined {
  const out = [...new Set(ids.flatMap((id) => (id ? id.split(/\s+/) : [])).filter(Boolean))];
  return out.length ? out.join(" ") : undefined;
}

export function markComposite<T extends object>(component: T): T {
  (component as unknown as Composite).fieldComposite = true;
  return component;
}
