"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Modal } from "@/components/app/modal";
import { NewVisitForm } from "@/components/app/screens/forms";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { ChevronLeft, ChevronRight, Plus, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { addLocalDays, clock, dayName, localTime } from "@/lib/app/format";
import { linkTo } from "@/lib/app/navigation-helpers";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Incomplete, RangePicker, useRange, type JobRow } from "./shared";

type Data = FunctionReturnType<typeof api.dispatchViews.schedule>;
type Cleaner = Data["cleaners"][number];
type Commitment = Cleaner["commitments"][number];

const MINUTE = 60_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Minutes from midnight on the company's clock, read from the clock so a clock-change day is still right. */
function minuteOf(at: number, timezone: string): number {
  const [hours, minutes] = localTime(at, timezone).split(":").map(Number);
  return hours * 60 + minutes;
}

function weekdayOf(at: number, timezone: string): number {
  return WEEKDAYS.indexOf(new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(new Date(at)));
}

const hourLabel = (minute: number) => {
  const hour = Math.floor(minute / 60) % 24;
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "a" : "p"}`;
};

/**
 * What is wrong with a cleaner's day, from the record: two commitments at once, two closer together than
 * the time the company keeps between visits, or one outside the hours or inside the time off they gave.
 * The time between visits is the company's setting. It is not a measured drive.
 */
function conflictsFor(cleaner: Cleaner, day: { from: number; to: number }, buffer: number, timezone: string): Map<Id<"assignments">, string[]> {
  const out = new Map<Id<"assignments">, string[]>();
  const add = (id: Id<"assignments">, words: string) => out.set(id, [...(out.get(id) ?? []), words]);
  const mine = cleaner.commitments.filter((row) => row.startsAt < day.to && row.endsAt > day.from).sort((a, b) => a.startsAt - b.startsAt);
  const windows = cleaner.windows.filter((row) => row.weekday === weekdayOf(day.from, timezone));
  for (const [index, row] of mine.entries()) {
    const next = mine[index + 1];
    if (next) {
      if (next.startsAt < row.endsAt) {
        add(row.assignmentId, "Overlaps another visit");
        add(next.assignmentId, "Overlaps another visit");
      } else if (next.startsAt - row.endsAt < buffer * MINUTE) {
        add(next.assignmentId, `Starts ${Math.round((next.startsAt - row.endsAt) / MINUTE)} min after the one before; ${buffer} min is kept between visits`);
      }
    }
    const [start, end] = [minuteOf(row.startsAt, timezone), minuteOf(row.endsAt, timezone)];
    if (!windows.some((window) => window.startMinute <= start && end <= window.endMinute)) add(row.assignmentId, windows.length === 0 ? "No working hours on record for this day" : "Outside the hours they said they can work");
    if (cleaner.timeOff.some((off) => off.startsAt < row.endsAt && off.endsAt > row.startsAt)) add(row.assignmentId, "During their time off");
  }
  return out;
}

function Block({ left, width, className, title, onClick, children }: { left: number; width: number; className: string; title: string; onClick?: () => void; children?: React.ReactNode }) {
  const style = { left: `${left}%`, width: `${Math.max(width, 1.5)}%` };
  if (!onClick) return <span aria-hidden title={title} style={style} className={cn("absolute inset-y-1 rounded-md", className)} />;
  return (
    <button type="button" onClick={onClick} title={title} style={style} className={cn("absolute inset-y-1.5 overflow-hidden rounded-md border px-1.5 text-left text-[11px] leading-tight focus-visible:outline-2 focus-visible:outline-brand-500", className)}>
      {children}
    </button>
  );
}

function Lane({ name, note, lines, children }: { name: string; note?: React.ReactNode; lines: number[]; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] border-t border-border first:border-t-0 sm:grid-cols-[11rem_1fr]">
      <div className="min-w-0 border-r border-border px-3 py-2">
        <p className="truncate text-sm font-medium text-strong">{name}</p>
        {note ? <div className="text-[11px] leading-snug text-muted-foreground">{note}</div> : null}
      </div>
      <div className="relative min-h-14">
        {lines.map((left) => (
          <span key={left} aria-hidden className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${left}%` }} />
        ))}
        {children}
      </div>
    </div>
  );
}

function DayLanes({ data, from, to, timezone, onOpen }: { data: Data; from: number; to: number; timezone: string; onOpen: (jobId: Id<"jobs">) => void }) {
  const jobs = data.jobs.filter((row) => row.status !== "cancelled");
  const minutes = jobs.flatMap((row) => [minuteOf(row.startsAt, timezone), Math.max(minuteOf(row.endsAt, timezone), minuteOf(row.startsAt, timezone) + 30)]);
  const first = Math.floor(Math.min(7 * 60, ...minutes) / 60) * 60;
  const last = Math.ceil(Math.max(19 * 60, ...minutes) / 60) * 60;
  const span = last - first;
  const pos = (minute: number) => ((Math.min(Math.max(minute, first), last) - first) / span) * 100;
  const place = (startsAt: number, endsAt: number) => {
    const start = startsAt < from ? first : minuteOf(startsAt, timezone);
    const end = endsAt >= to ? last : minuteOf(endsAt, timezone);
    return { left: pos(start), width: pos(end) - pos(start) };
  };
  const hours = Array.from({ length: span / 60 + 1 }, (_, index) => first + index * 60);
  const jobById = new Map(jobs.map((row) => [row.jobId, row]));
  const short = jobs.filter((row) => row.status === "scheduled" && row.openPlaces > 0);
  const weekday = weekdayOf(from, timezone);
  const label = (row: JobRow) => `${row.customer ?? "Unknown customer"} · ${row.serviceType} · ${clock(row.startsAt, timezone)} to ${clock(row.endsAt, timezone)}`;

  const lines = hours.slice(1, -1).map(pos);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[46rem]">
        <div className="grid grid-cols-[9rem_1fr] border-b border-border bg-muted sm:grid-cols-[11rem_1fr]">
          <div className="border-r border-border px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">{timezone}</div>
          <div className="relative h-7">
            {hours.slice(0, -1).map((hour) => (
              <span key={hour} className="absolute top-1.5 pl-1 text-[11px] tabular-nums text-muted-foreground" style={{ left: `${pos(hour)}%` }}>
                {hourLabel(hour)}
              </span>
            ))}
          </div>
        </div>

        <Lane lines={lines} name="Not fully staffed" note={short.length === 0 ? "Nothing short today" : `${short.length} ${short.length === 1 ? "visit" : "visits"} short a cleaner`}>
          {short.map((row) => (
            <Block key={row.jobId} {...place(row.startsAt, row.endsAt)} onClick={() => onOpen(row.jobId)} title={`${label(row)} · ${row.acceptedCrew} of ${row.requiredCrew} accepted`} className="border-dashed border-destructive/50 bg-destructive/8 text-destructive-foreground hover:bg-destructive/12">
              <span className="block truncate font-semibold">{row.customer ?? "Unknown"}</span>
              <span className="block truncate">
                {row.acceptedCrew} of {row.requiredCrew} · {row.offersOut > 0 ? `${row.offersOut} asked` : "nobody asked"}
              </span>
            </Block>
          ))}
        </Lane>

        {data.cleaners.map((cleaner) => {
          const conflicts = conflictsFor(cleaner, { from, to }, data.travelBufferMinutes, timezone);
          const windows = cleaner.windows.filter((row) => row.weekday === weekday);
          const mine = cleaner.commitments.filter((row) => row.startsAt < to && row.endsAt > from);
          const off = cleaner.timeOff.filter((row) => row.startsAt < to && row.endsAt > from);
          return (
            <Lane
              key={cleaner.cleanerId}
              lines={lines}
              name={cleaner.name}
              note={
                <>
                  {windows.length === 0 ? "No hours on record this day" : windows.map((row) => `${hourLabel(row.startMinute)}–${hourLabel(row.endMinute)}`).join(", ")}
                  {off.length > 0 ? " · time off" : ""}
                  {conflicts.size > 0 ? <span className="block font-medium text-destructive-foreground">{conflicts.size} to look at</span> : null}
                </>
              }
            >
              {windows.map((row) => (
                <Block key={`${row.startMinute}-${row.endMinute}`} left={pos(row.startMinute)} width={pos(row.endMinute) - pos(row.startMinute)} title="Hours they said they can work" className="bg-success/8" />
              ))}
              {off.map((row) => (
                <Block key={row.startsAt} {...place(row.startsAt, row.endsAt)} title="Time off" className="bg-[repeating-linear-gradient(135deg,transparent_0_5px,color-mix(in_oklab,var(--color-muted-foreground)_25%,transparent)_5px_6px)]" />
              ))}
              {mine.map((row: Commitment) => {
                const job = jobById.get(row.jobId);
                const problems = conflicts.get(row.assignmentId) ?? [];
                const held = row.kind === "offered";
                return (
                  <Block
                    key={row.assignmentId}
                    {...place(row.startsAt, row.endsAt)}
                    onClick={() => onOpen(row.jobId)}
                    title={`${job ? label(job) : "Visit"} · ${held ? "offered, not accepted: this time is held for them until they answer" : "accepted"}${problems.length ? ` · ${problems.join("; ")}` : ""}`}
                    className={cn(held ? "border-dashed border-warning/70 bg-warning/10 text-warning-foreground" : "border-brand-500/40 bg-brand-500/15 text-strong", problems.length > 0 && "ring-2 ring-destructive/60", "hover:brightness-110")}
                  >
                    <span className="flex items-center gap-1 truncate font-semibold">
                      {problems.length > 0 ? <TriangleAlert className="size-3 shrink-0 text-destructive-foreground" aria-label="Conflict" /> : null}
                      <span className="truncate">{job?.customer ?? "Visit"}</span>
                    </span>
                    <span className="block truncate">
                      {held ? "Held · offer out" : "Accepted"}
                      {row.role && job && job.requiredCrew > 1 ? ` · ${row.role}` : ""}
                    </span>
                  </Block>
                );
              })}
            </Lane>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ data, days, timezone, onOpen }: { data: Data; days: number[]; timezone: string; onOpen: (jobId: Id<"jobs">) => void }) {
  const jobs = data.jobs.filter((row) => row.status !== "cancelled");
  const jobById = new Map(jobs.map((row) => [row.jobId, row]));
  const within = (startsAt: number, index: number) => startsAt >= days[index] && startsAt < (days[index + 1] ?? Number.POSITIVE_INFINITY);
  const chip = "block w-full truncate rounded-md border px-1.5 py-1 text-left text-[11px] leading-tight focus-visible:outline-2 focus-visible:outline-brand-500 hover:brightness-110";
  const columns = days.slice(0, 7);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] table-fixed border-collapse text-sm">
        <thead>
          <tr className="bg-muted text-left text-[11px] font-semibold text-muted-foreground">
            <th className="w-40 border-b border-r border-border px-3 py-1.5">{timezone}</th>
            {columns.map((day) => (
              <th key={day} className="border-b border-border px-2 py-1.5">
                {dayName(day, timezone)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="align-top">
            <th scope="row" className="border-r border-border px-3 py-2 text-left text-sm font-medium text-strong">
              Not fully staffed
            </th>
            {columns.map((day, index) => (
              <td key={day} className="border-l border-border/60 p-1.5">
                <div className="grid gap-1">
                  {jobs
                    .filter((row) => row.status === "scheduled" && row.openPlaces > 0 && within(row.startsAt, index))
                    .map((row) => (
                      <button key={row.jobId} type="button" onClick={() => onOpen(row.jobId)} className={cn(chip, "border-dashed border-destructive/50 bg-destructive/8 text-destructive-foreground")}>
                        {clock(row.startsAt, timezone)} {row.customer ?? "Unknown"} · {row.acceptedCrew} of {row.requiredCrew}
                      </button>
                    ))}
                </div>
              </td>
            ))}
          </tr>
          {data.cleaners.map((cleaner) => (
            <tr key={cleaner.cleanerId} className="border-t border-border align-top">
              <th scope="row" className="border-r border-border px-3 py-2 text-left text-sm font-medium text-strong">
                {cleaner.name}
              </th>
              {columns.map((day, index) => {
                const dayEnd = days[index + 1] ?? addLocalDays(day, 1, timezone);
                const conflicts = conflictsFor(cleaner, { from: day, to: dayEnd }, data.travelBufferMinutes, timezone);
                const mine = cleaner.commitments.filter((row) => within(row.startsAt, index)).sort((a, b) => a.startsAt - b.startsAt);
                const works = cleaner.windows.some((row) => row.weekday === weekdayOf(day, timezone));
                const off = cleaner.timeOff.some((row) => row.startsAt < dayEnd && row.endsAt > day);
                return (
                  <td key={day} className={cn("border-l border-border/60 p-1.5", !works && "bg-muted/50")}>
                    <div className="grid gap-1">
                      {mine.map((row) => {
                        const problems = conflicts.get(row.assignmentId) ?? [];
                        return (
                          <button
                            key={row.assignmentId}
                            type="button"
                            onClick={() => onOpen(row.jobId)}
                            title={problems.join("; ") || undefined}
                            className={cn(chip, row.kind === "offered" ? "border-dashed border-warning/70 bg-warning/10 text-warning-foreground" : "border-brand-500/40 bg-brand-500/15 text-strong", problems.length > 0 && "ring-2 ring-destructive/60")}
                          >
                            {clock(row.startsAt, timezone)} {jobById.get(row.jobId)?.customer ?? "Visit"}
                            {row.kind === "offered" ? " · held" : ""}
                          </button>
                        );
                      })}
                      {mine.length === 0 ? <span className="px-1 text-[11px] text-muted-foreground">{off ? "Time off" : works ? "" : "No hours"}</span> : off ? <span className="px-1 text-[11px] text-muted-foreground">Time off this day</span> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Schedule: the day or the week as lanes, one per ready cleaner, with what each has accepted, what is
 * held for them by an open offer, the hours and time off they gave, and the visits still short a cleaner.
 * Opening a visit is where it is moved, changed or cancelled, with the effects shown first.
 */
export function DispatchScheduleScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const range = useRange(now, timezone, "today");
  const data = useQuery(api.dispatchViews.schedule, now ? { companyId, from: range.from, to: range.to } : "skip");
  const [adding, setAdding] = useState(false);
  const cleaners = linkTo("cleaners");
  const week = range.mode === "week";
  const days = week ? Array.from({ length: 8 }, (_, index) => addLocalDays(range.from, index, timezone)) : [];
  const onOpen = (jobId: Id<"jobs">) => open({ kind: "job", id: jobId });
  const live = data?.jobs.filter((row) => row.status !== "cancelled") ?? [];

  return (
    <>
      <PageHeader
        title="Schedule"
        lead="Each ready cleaner’s day: what they accepted, what is held for them by an open offer, and the hours and time off they gave. Visits still short a cleaner sit in the first lane."
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add a visit
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangePicker range={range} />
        {!week ? (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="The day before" onClick={() => range.step(-1)}>
              <ChevronLeft aria-hidden />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="The day after" onClick={() => range.step(1)}>
              <ChevronRight aria-hidden />
            </Button>
          </div>
        ) : null}
        <span className="text-sm font-medium text-strong">{range.label}</span>
      </div>
      {data?.truncated || data?.cleanersTruncated ? (
        <div className="mb-4">
          <Incomplete what={data.truncated ? "visits" : "cleaners"} />
        </div>
      ) : null}

      <Panel flush>
        {data === undefined ? (
          <div className="grid gap-2 p-5">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : data.cleaners.length === 0 && live.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-strong">Nothing to show yet.</p>
            <p className="mt-1 text-xs text-muted-foreground">No cleaner is marked ready for work and no visit is scheduled {range.label.toLowerCase()}.</p>
          </div>
        ) : week ? (
          <WeekGrid data={data} days={days} timezone={timezone} onOpen={onOpen} />
        ) : (
          <DayLanes data={data} from={range.from} to={range.to} timezone={timezone} onOpen={onOpen} />
        )}
      </Panel>

      <div className="mt-4 grid gap-1.5 text-xs leading-relaxed text-muted-foreground">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-brand-500/40 bg-brand-500/15" aria-hidden /> Accepted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-dashed border-warning/70 bg-warning/10" aria-hidden /> Held by an open offer, not accepted
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm border border-dashed border-destructive/50 bg-destructive/8" aria-hidden /> Short a cleaner
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-success/8 ring-1 ring-success/30" aria-hidden /> Hours they gave
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm ring-2 ring-destructive/60" aria-hidden /> Something to look at
          </span>
        </p>
        {data ? (
          <p>
            {data.travelBufferMinutes} minutes are kept free between a cleaner’s visits. That is the company’s setting, not a measured drive: travel time between properties is not looked up. A visit’s length is its own start and end.
            {cleaners ? (
              <>
                {" "}
                Hours and time off are changed on each cleaner’s record, under{" "}
                <Link href={cleaners} className="font-medium text-brand-300 underline-offset-4 hover:underline">
                  Cleaners
                </Link>
                .
              </>
            ) : null}
          </p>
        ) : null}
        <p>Only cleaners marked ready are listed. Recurring visits are not built, so every visit here was scheduled on its own.</p>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a visit" description="A visit is a promise to the customer. It is staffed only when every cleaner it needs has accepted.">
        <NewVisitForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}
