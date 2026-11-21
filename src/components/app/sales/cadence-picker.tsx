"use client";


import { cadenceLabel, cadenceProblem, weekdayOf, type Cadence } from "../../../../convex/lib/sales/cadence";
import { fieldClass, WEEKDAYS } from "./kit";
import { SelectInput } from "@/components/app/form";
import { ChoiceChips, SegmentedControl } from "@/components/ui/selection";

const CADENCES: { kind: Cadence["kind"]; label: string }[] = [
  { kind: "weekly", label: "Weekly" },
  { kind: "every_2_weeks", label: "Every 2 weeks" },
  { kind: "every_4_weeks", label: "Every 4 weeks" },
  { kind: "monthly", label: "Monthly" },
  { kind: "twice_monthly", label: "Twice a month" },
];

export function defaultCadence(kind: Cadence["kind"], date: string | undefined): Cadence {
  const weekday = date ? weekdayOf(date) : 2;
  const day = date ? Number(date.slice(8, 10)) : 1;
  switch (kind) {
    case "weekly":
      return { kind, weekdays: [weekday] };
    case "every_2_weeks":
    case "every_4_weeks":
      return { kind, weekday };
    case "monthly":
      return { kind, dayOfMonth: day };
    case "twice_monthly":
      return { kind, days: day <= 14 ? [day, day + 14] : [day - 14, day] };
  }
}

const DAY_OF_MONTH = [...Array.from({ length: 28 }, (_, i) => i + 1), 29, 30, 31, 0];
const dayWord = (d: number) => (d === 0 ? "Last day" : String(d));

/** How often: each cadence is its own choice, so every 4 weeks is never monthly and every 2 weeks never twice a month. */
export function CadencePicker({ cadence, onChange, anchorDate }: { cadence: Cadence | undefined; onChange: (cadence: Cadence) => void; anchorDate?: string }) {
  return (
    <div className="grid gap-3">
      <SegmentedControl label="How often" value={cadence?.kind ?? null} onChange={(kind) => onChange(defaultCadence(kind, anchorDate))} options={CADENCES.map((option) => ({ id: option.kind, label: option.label }))} />
      {cadence?.kind === "weekly" ? (
        <div className="flex flex-wrap gap-1.5">
          <ChoiceChips aria-label="Days of the week" density="compact" options={WEEKDAYS.map((label, day) => ({ value: String(day), label }))} value={cadence.weekdays.map(String)} onValueChange={(next) => onChange({ kind: "weekly", weekdays: next.map(Number).sort((a, b) => a - b) })} />
          <span className="self-center text-xs text-muted-foreground">Several days make several visits a week.</span>
        </div>
      ) : null}
      {cadence?.kind === "every_2_weeks" || cadence?.kind === "every_4_weeks" ? (
        <label className="grid max-w-56 gap-1.5 text-sm">
          <span className="font-medium text-strong">Day of the week</span>
          <SelectInput className={fieldClass()} value={cadence.weekday} onChange={(e) => onChange({ ...cadence, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((label, day) => (
              <option key={label} value={day}>
                {label}
              </option>
            ))}
          </SelectInput>
        </label>
      ) : null}
      {cadence?.kind === "monthly" ? (
        <label className="grid max-w-56 gap-1.5 text-sm">
          <span className="font-medium text-strong">Day of the month</span>
          <SelectInput className={fieldClass()} value={cadence.dayOfMonth} onChange={(e) => onChange({ kind: "monthly", dayOfMonth: Number(e.target.value) })}>
            {DAY_OF_MONTH.map((d) => (
              <option key={d} value={d}>
                {dayWord(d)}
              </option>
            ))}
          </SelectInput>
        </label>
      ) : null}
      {cadence?.kind === "twice_monthly" ? (
        <div className="flex flex-wrap gap-3">
          {[0, 1].map((i) => (
            <label key={i} className="grid w-40 gap-1.5 text-sm">
              <span className="font-medium text-strong">{i === 0 ? "First day" : "Second day"}</span>
              <SelectInput className={fieldClass()} value={cadence.days[i] ?? 1} onChange={(e) => onChange({ kind: "twice_monthly", days: cadence.days.map((d, j) => (j === i ? Number(e.target.value) : d)) })}>
                {DAY_OF_MONTH.map((d) => (
                  <option key={d} value={d}>
                    {dayWord(d)}
                  </option>
                ))}
              </SelectInput>
            </label>
          ))}
        </div>
      ) : null}
      {cadence && cadenceProblem(cadence) ? <p className="text-sm text-destructive-foreground">{cadenceProblem(cadence)}</p> : cadence ? <p className="text-xs text-muted-foreground">{cadenceLabel(cadence)}</p> : null}
    </div>
  );
}
