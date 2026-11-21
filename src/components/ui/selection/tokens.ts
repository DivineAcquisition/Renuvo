/**
 * The one set of looks every selection control shares: heights, radii, focus, the selected surface,
 * popups and options. A control picks its accent from `--sel-accent`, which falls back to Selestial
 * Violet. A public page sets `--sel-accent` to the customer's own brand colour on its wrapper, so the
 * same controls carry the customer's branding instead of the workspace's.
 */

export type Density = "default" | "compact";

/** Control heights come from the --spacing-control-* tokens. Compact stays 32px, still a usable touch target. */
export const controlHeight: Record<Density, string> = {
  default: "min-h-control-md",
  compact: "min-h-control-sm text-[13px]",
};

export const controlPadding: Record<Density, string> = {
  default: "px-3",
  compact: "px-2.5",
};

/** The accent, as a CSS colour. Every selected indicator, focus ring and selected surface derives from it. */
export const ACCENT = "var(--sel-accent,var(--brand))";

export const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)]";

/** Inside a composite (a card, a row) the ring is drawn by the wrapper when its control has focus. */
export const focusWithin = "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[color-mix(in_srgb,var(--sel-accent,var(--brand))_55%,transparent)]";

/** A closed field: the trigger of a select, the input of a searchable one. */
export const fieldSurface =
  "w-full rounded-lg border border-border bg-card text-sm text-strong transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none hover:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_35%,var(--border))] data-[popup-open]:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_60%,var(--border))] aria-invalid:border-destructive/60 data-[invalid]:border-destructive/60 data-[disabled]:cursor-not-allowed data-[disabled]:bg-muted/50 data-[disabled]:text-muted-foreground data-[readonly]:bg-muted/30";

/** The selected surface: soft lavender on light, a quiet violet tint on dark. Never colour alone: a mark always goes with it. */
export const selectedSurface = "border-[var(--sel-accent,var(--brand))] bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_7%,var(--card))]";
export const restingSurface = "border-border bg-card hover:border-[color-mix(in_srgb,var(--sel-accent,var(--brand))_40%,var(--border))]";

/** A popup list for select, searchable select and multi-select. */
export const popupSurface =
  "z-[80] max-h-[min(22rem,var(--available-height))] min-w-[var(--anchor-width)] max-w-[min(32rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg shadow-black/10 outline-none origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 motion-reduce:transition-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0";

/** One option in a popup list. The check sits on the left so long labels never push it out of view. */
export const optionRow =
  "relative grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2 rounded-lg px-2 py-2 text-sm text-strong outline-none select-none data-[highlighted]:bg-[color-mix(in_srgb,var(--sel-accent,var(--brand))_9%,transparent)] data-[disabled]:cursor-not-allowed data-[disabled]:text-muted-foreground";

/** The square or round mark for checkboxes, radios and selection cards. */
export const markBase = "grid size-[1.125rem] shrink-0 place-items-center border transition-colors duration-100 motion-reduce:transition-none";
export const markOff = "border-[color-mix(in_srgb,var(--strong)_28%,var(--border))] bg-card";
export const markOn = "border-[var(--sel-accent,var(--brand))] bg-[var(--sel-accent,var(--brand))] text-white";

/** Space between fields in a form, and between a label and its control. */
export const fieldGap = "gap-1.5";
export const formGap = "gap-4";
