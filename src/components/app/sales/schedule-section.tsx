"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";

import { CalendarIcon, TriangleAlert } from "@/components/icons";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { addDays, cadenceDates, cadenceProblem, cadenceRate, previewVisits, visitsPerMonth, type Cadence } from "../../../../convex/lib/sales/cadence";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import { CadencePicker } from "./cadence-picker";
import { Chip, fieldClass, FormSection, minutesToTime } from "./kit";
import type { DraftData, Working } from "./use-draft";
import { Field, SelectInput } from "@/components/app/form";
import { Checkbox, cleanerOption, SearchableSelect } from "@/components/ui/selection";

type Summary = FunctionReturnType<typeof api.sales.price>;

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
      {recurring ? <CadencePicker cadence={cadence} onChange={setCadence} anchorDate={schedule.date} /> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">{recurring ? "First-service date" : "Date"}</span>
          <input type="date" min={today(data.timezone)} className={fieldClass()} value={schedule.date ?? ""} onChange={(e) => setSchedule({ date: e.target.value || undefined })} />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">Arrival time</span>
          <SelectInput className={fieldClass()} value={schedule.arrivalMinute ?? ""} onChange={(e) => setSchedule({ arrivalMinute: e.target.value === "" ? undefined : Number(e.target.value) })}>
            <option value="">Choose a time</option>
            {times.map((m) => (
              <option key={m} value={m}>
                {minutesToTime(m)}
              </option>
            ))}
          </SelectInput>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-strong">Arrival window</span>
          <SelectInput className={fieldClass()} value={schedule.windowMinutes ?? 60} onChange={(e) => setSchedule({ windowMinutes: Number(e.target.value) })}>
            {[0, 30, 60, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Exact time" : `${m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? "" : "s"}`}`}
              </option>
            ))}
          </SelectInput>
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
        <Checkbox className="mt-0.5" checked={schedule.proposed === true} onCheckedChange={(checked) => setSchedule({ proposed: checked })} />
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
        <Field label="Preferred cleaner" hint="A preference, not an assignment. Dispatch asks this cleaner first, and the visit is covered only when someone accepts.">
          <SearchableSelect value={schedule.preferredCleanerId ?? ""} onValueChange={(next) => setSchedule({ preferredCleanerId: next ?? undefined })} options={(cleaners ?? []).map(cleanerOption)} loading={cleaners === undefined} placeholder="No preference" />
        </Field>
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
