"use client";

import { cn } from "@/lib/utils";

import { cadenceLabel, cadenceProblem, weekdayOf, type Cadence } from "../../../../convex/lib/sales/cadence";
import { fieldClass, WEEKDAYS } from "./kit";

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
export function CadencePicker({ name, cadence, onChange, anchorDate }: { name: string; cadence: Cadence | undefined; onChange: (cadence: Cadence) => void; anchorDate?: string }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium text-strong">How often</legend>
      <div role="radiogroup" aria-label="How often" className="flex flex-wrap gap-1.5">
        {CADENCES.map((option) => (
          <label key={option.kind} className={cn("cursor-pointer rounded-lg border px-3 py-1.5 text-sm focus-within:outline-2 focus-within:outline-brand-500", cadence?.kind === option.kind ? "border-brand-500 bg-brand-500/8 font-medium text-strong" : "border-border text-muted-foreground hover:text-strong")}>
            <input type="radio" className="sr-only" name={name} checked={cadence?.kind === option.kind} onChange={() => onChange(defaultCadence(option.kind, anchorDate))} />
            {option.label}
          </label>
        ))}
      </div>
      {cadence?.kind === "weekly" ? (
        <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((label, day) => {
            const on = cadence.weekdays.includes(day);
            return (
              <button key={label} type="button" aria-pressed={on} onClick={() => onChange({ kind: "weekly", weekdays: on ? cadence.weekdays.filter((d) => d !== day) : [...cadence.weekdays, day].sort() })} className={cn("min-w-12 rounded-lg border px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500", on ? "border-brand-500 bg-brand-500 text-white" : "border-border text-strong")}>
                {label}
              </button>
            );
          })}
          <span className="self-center text-xs text-muted-foreground">Several days make several visits a week.</span>
        </div>
      ) : null}
      {cadence?.kind === "every_2_weeks" || cadence?.kind === "every_4_weeks" ? (
        <label className="grid max-w-56 gap-1.5 text-sm">
          <span className="font-medium text-strong">Day of the week</span>
          <select className={fieldClass()} value={cadence.weekday} onChange={(e) => onChange({ ...cadence, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((label, day) => (
              <option key={label} value={day}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {cadence?.kind === "monthly" ? (
        <label className="grid max-w-56 gap-1.5 text-sm">
          <span className="font-medium text-strong">Day of the month</span>
          <select className={fieldClass()} value={cadence.dayOfMonth} onChange={(e) => onChange({ kind: "monthly", dayOfMonth: Number(e.target.value) })}>
            {DAY_OF_MONTH.map((d) => (
              <option key={d} value={d}>
                {dayWord(d)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {cadence?.kind === "twice_monthly" ? (
        <div className="flex flex-wrap gap-3">
          {[0, 1].map((i) => (
            <label key={i} className="grid w-40 gap-1.5 text-sm">
              <span className="font-medium text-strong">{i === 0 ? "First day" : "Second day"}</span>
              <select className={fieldClass()} value={cadence.days[i] ?? 1} onChange={(e) => onChange({ kind: "twice_monthly", days: cadence.days.map((d, j) => (j === i ? Number(e.target.value) : d)) })}>
                {DAY_OF_MONTH.map((d) => (
                  <option key={d} value={d}>
                    {dayWord(d)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}
      {cadence && cadenceProblem(cadence) ? <p className="text-sm text-destructive-foreground">{cadenceProblem(cadence)}</p> : cadence ? <p className="text-xs text-muted-foreground">{cadenceLabel(cadence)}</p> : null}
    </fieldset>
  );
}
