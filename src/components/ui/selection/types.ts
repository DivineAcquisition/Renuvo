import type { ReactNode } from "react";

/**
 * One choice, in every selection control. `value` is the stored identifier and is never rewritten for
 * display. `meta` is the secondary line a business record needs to be told apart (a customer's company,
 * a property's address); pass only what the current person may see, and nothing made up.
 */
export type Option<V extends string = string> = {
  value: V;
  label: string;
  description?: ReactNode;
  meta?: ReactNode;
  icon?: ReactNode;
  group?: string;
  disabled?: boolean;
  /** Why it can't be chosen, in words. Shown with the option, not only on hover. */
  disabledReason?: string;
  /** Extra words search should match: a phone number, an email, a ZIP code. */
  keywords?: readonly string[];
  /** Set by the controls themselves for a chosen value that can no longer be found. */
  unavailable?: boolean;
};

/** Loading, empty and failed states for a list that comes from the server. */
export type ListState = { loading?: boolean; error?: string | null; onRetry?: () => void; emptyText?: string };

export function groupOptions<V extends string>(options: readonly Option<V>[]): { group: string | null; options: Option<V>[] }[] {
  const out: { group: string | null; options: Option<V>[] }[] = [];
  for (const option of options) {
    const key = option.group ?? null;
    const last = out[out.length - 1];
    if (last && last.group === key) last.options.push(option);
    else out.push({ group: key, options: [option] });
  }
  return out;
}

/** Plain-text search over label, keywords and value. Case and accents are ignored. */
export function matches(option: Option, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const hay = fold([option.label, option.value, ...(option.keywords ?? [])].join(" "));
  return q.split(/\s+/).every((word) => hay.includes(word));
}

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
