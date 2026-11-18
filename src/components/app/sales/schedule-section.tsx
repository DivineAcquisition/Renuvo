"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";

import { CalendarIcon, TriangleAlert } from "@/components/icons";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { addDays, cadenceDates, cadenceLabel, cadenceProblem, cadenceRate, previewVisits, visitsPerMonth, weekdayOf, type Cadence } from "../../../../convex/lib/sales/cadence";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import { Chip, fieldClass, FormSection, minutesToTime, WEEKDAYS } from "./kit";
import type { DraftData, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;

const CADENCES: { kind: Cadence["kind"]; label: string }[] = [
  { kind: "weekly", label: "Weekly" },
  { kind: "every_2_weeks", label: "Every 2 weeks" },
  { kind: "every_4_weeks", label: "Every 4 weeks" },
  { kind: "monthly", label: "Monthly" },
  { kind: "twice_monthly", label: "Twice a month" },
];

function defaultCadence(kind: Cadence["kind"], date: string | undefined): Cadence {
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

function timeOptions(hours: DraftData["hours"]): number[] {
  const start = hours.length ? Math.min(...hours.map((h) => h.startMinute)) : 7 * 60;
  const end = hours.length ? Math.max(...hours.map((h) => h.endMinute)) : 18 * 60;
  const out: number[] = [];
  for (let m = Math.ceil(start / 30) * 30; m < end; m += 30) out.push(m);
  return out;
}

function today(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const DAY_OF_MONTH = [...Array.from({ length: 28 }, (_, i) => i + 1), 29, 30, 31, 0];
const dayWord = (d: number) => (d === 0 ? "Last day" : String(d));

function CalendarPreview({ cadence, firstDate, endDate, hours }: { cadence: Cadence; firstDate: string; endDate?: string; hours: DraftData["hours"] }) {
  const closed = hours.length ? [0, 1, 2, 3, 4, 5, 6].filter((d) => !hours.some((h) => h.weekday === d)) : [];
  const visits = previewVisits({ cadence, firstDate, endDate, count: 10, closedWeekdays: closed });
  const months = visitsPerMonth(cadenceDates(cadence, firstDate, firstDate, endDate ?? addDays(firstDate, 92), 200)).slice(0, 3);
  return (
    <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-strong">
          <CalendarIcon aria-hidden className="size-4 text-brand-600" /> Upcoming visits
        </p>
        <span className="text-xs text-muted-foreground">{cadenceRate(cadence)}</span>
      </div>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
        {visits.map((visit) => (
          <li key={visit.date} className={cn("rounded-lg border px-2 py-1.5 text-xs", visit.conflict ? "border-destructive/40 bg-destructive/6" : visit.first ? "border-brand-500/50 bg-brand-500/8" : "border-border bg-card")}>
            <span className="block font-medium text-strong tabular-nums">{new Date(`${visit.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</span>
            <span className="block text-muted-foreground">{visit.conflict ? "Closed: needs a decision" : visit.first ? "First visit" : "Visit"}</span>
          </li>
        ))}
      </ol>
      {months.length ? (
        <p className="text-xs text-muted-foreground">
          Visits per month, counted from the real dates: {months.map((m) => `${new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${m.visits}`).join(" · ")}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Days shorter than the chosen day of the month use the month’s last day. A visit that falls on a closed day or a date the company blocks is never moved on its own: it goes to Dispatch as an exception to reschedule with the customer.
      </p>
    </div>
  );
}

export function ScheduleSection({ n, data, working, setBody, summary, done, companyId }: { n: number; data: DraftData; working: Working; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; done: boolean; companyId: Id<"companies"> }) {
  const body = working.body;
  const schedule = body.schedule ?? {};
  const recurring = working.bookingKind === "recurring";
  const cadence = body.recurring?.cadence;
  const cleaners = useQuery(api.cleaners.list, { companyId });
  const times = useMemo(() => timeOptions(data.hours), [data.hours]);
  const booking = summary?.mode === "booking" ? summary : null;
  const capacity = booking?.capacity ?? null;
  const setSchedule = (patch: Partial<NonNullable<DraftBody["schedule"]>>) => setBody((b) => ({ ...b, schedule: { ...b.schedule, ...patch } }));
  const setCadence = (next: Cadence) => setBody((b) => ({ ...b, recurring: { ...b.recurring, cadence: next } }));

  return (
    <FormSection n={n} id="schedule" title={recurring ? "Schedule & cadence" : "Schedule"} lead={`Times are on the company's clock (${data.timezone.replace(/_/g, " ")}).`} done={done}>
      {recurring ? (
        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium text-strong">How often</legend>
          <div role="radiogroup" aria-label="How often" className="flex flex-wrap gap-1.5">
            {CADENCES.map((option) => (
              <label key={option.kind} className={cn("cursor-pointer rounded-lg border px-3 py-1.5 text-sm focus-within:outline-2 focus-within:outline-brand-500", cadence?.kind === option.kind ? "border-brand-500 bg-brand-500/8 font-medium text-strong" : "border-border text-muted-foreground hover:text-strong")}>
                <input type="radio" className="sr-only" name="cadence" checked={cadence?.kind === option.kind} onChange={() => setCadence(defaultCadence(option.kind, schedule.date))} />
                {option.label}
              </label>
            ))}
          </div>
          {cadence?.kind === "weekly" ? (
            <div role="group" aria-label="Days of the week" className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((label, day) => {
                const on = cadence.weekdays.includes(day);
                return (
                  <button key={label} type="button" aria-pressed={on} onClick={() => setCadence({ kind: "weekly", weekdays: on ? cadence.weekdays.filter((d) => d !== day) : [...cadence.weekdays, day].sort() })} className={cn("min-w-12 rounded-lg border px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-brand-500", on ? "border-brand-500 bg-brand-500 text-white" : "border-border text-strong")}>
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
              <select className={fieldClass()} value={cadence.weekday} onChange={(e) => setCadence({ ...cadence, weekday: Number(e.target.value) })}>
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
              <select className={fieldClass()} value={cadence.dayOfMonth} onChange={(e) => setCadence({ kind: "monthly", dayOfMonth: Number(e.target.value) })}>
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
                  <select className={fieldClass()} value={cadence.days[i] ?? 1} onChange={(e) => setCadence({ kind: "twice_monthly", days: cadence.days.map((d, j) => (j === i ? Number(e.target.value) : d)) })}>
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
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">{recurring ? "First-service date" : "Date"}</span>
          <input type="date" min={today(data.timezone)} className={fieldClass()} value={schedule.date ?? ""} onChange={(e) => setSchedule({ date: e.target.value || undefined })} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">Arrival time</span>
          <select className={fieldClass()} value={schedule.arrivalMinute ?? ""} onChange={(e) => setSchedule({ arrivalMinute: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">Choose a time</option>
            {times.map((m) => (
              <option key={m} value={m}>
                {minutesToTime(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">Arrival window</span>
          <select className={fieldClass()} value={schedule.windowMinutes ?? 60} onChange={(e) => setSchedule({ windowMinutes: Number(e.target.value) })}>
            {[0, 30, 60, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Exact time" : `${m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? "" : "s"}`}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {recurring ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">End date (optional)</span>
            <input type="date" min={schedule.date} className={fieldClass()} value={body.recurring?.endDate ?? ""} onChange={(e) => setBody((b) => ({ ...b, recurring: { ...b.recurring, endDate: e.target.value || undefined } }))} />
          </label>
        </div>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 accent-brand-500" checked={schedule.proposed === true} onChange={(e) => setSchedule({ proposed: e.target.checked })} />
        <span>
          <span className="font-medium text-strong">Proposed date only</span>
          <span className="block text-xs text-muted-foreground">The customer hasn’t confirmed this time. The booking request carries it as a proposal; it is not confirmed until a time is held.</span>
        </span>
      </label>

      {capacity ? (
        <div role="status" className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm", capacity.state === "fits" ? "border-success/30 bg-success/6" : capacity.state === "tight" ? "border-warning/30 bg-warning/8" : capacity.state === "unknown" ? "border-border bg-muted/30" : "border-destructive/30 bg-destructive/6")}>
          {capacity.state === "full" || capacity.state === "closed" ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive-foreground" /> : null}
          <span>
            <span className="font-medium text-strong">{capacity.state === "fits" ? "Crew available" : capacity.state === "tight" ? "Last crew available" : capacity.state === "full" ? "No crew free" : capacity.state === "closed" ? "Not bookable" : "Capacity not checked"}</span>
            <span className="block text-xs text-muted-foreground">{capacity.why}</span>
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">Preferred cleaner</span>
          <select className={fieldClass()} value={schedule.preferredCleanerId ?? ""} onChange={(e) => setSchedule({ preferredCleanerId: e.target.value || undefined })}>
            <option value="">No preference</option>
            {(cleaners ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">A preference, not an assignment. Dispatch asks this cleaner first, and the visit is covered only when someone accepts.</span>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">Access or timing constraints</span>
          <textarea className={fieldClass("min-h-20 py-2")} placeholder="For example: must finish by 2 PM, gate code given day before" value={schedule.constraints ?? ""} onChange={(e) => setSchedule({ constraints: e.target.value })} />
        </label>
      </div>

      {recurring && cadence && !cadenceProblem(cadence) && schedule.date ? <CalendarPreview cadence={cadence} firstDate={schedule.date} endDate={body.recurring?.endDate} hours={data.hours} /> : null}
      {recurring && booking?.recurringNote ? <Chip tone="warning">{booking.recurringNote}</Chip> : null}
    </FormSection>
  );
}
