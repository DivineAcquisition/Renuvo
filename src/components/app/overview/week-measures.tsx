import { ArrowDownRight, ArrowUpRight, Minus } from "@/components/icons";
import { money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { Measure } from "../../../../convex/overview";

const show = (measure: Measure, value: number) => (measure.kind === "cents" ? money(value) : String(value));

/** One measure: its number, what it is compared with, and what it leaves out. Missing data says so. */
function MeasureCard({ measure }: { measure: Measure }) {
  const { value, previous } = measure;
  const change = value !== null && previous !== null ? value - previous : null;
  const Arrow = change === null || change === 0 ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn("rounded-2xl border bg-card p-4", measure.state === "not_set_up" ? "border-dashed border-border" : "border-border")}>
      <p className="text-xs font-medium text-muted-foreground">{measure.label}</p>
      {measure.state === "not_set_up" || value === null ? (
        <p className="mt-2 text-sm font-medium text-muted-foreground">Not set up yet</p>
      ) : (
        <p className="mt-1.5 flex items-baseline gap-2">
          <span className="font-heading text-2xl tracking-tight tabular-nums text-strong">{show(measure, value)}</span>
          {previous !== null ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <Arrow className="size-3" aria-hidden />
              {show(measure, previous)} the week before
            </span>
          ) : null}
        </p>
      )}
      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{measure.limitation ?? measure.why}</p>
    </div>
  );
}

export function WeekMeasures({ measures, compact }: { measures: Measure[]; compact?: boolean }) {
  const shown = compact ? measures.filter((measure) => measure.state === "measured") : measures;
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", compact ? "lg:grid-cols-3" : "lg:grid-cols-3 xl:grid-cols-4")}>
      {shown.map((measure) => (
        <MeasureCard key={measure.key} measure={measure} />
      ))}
    </div>
  );
}
