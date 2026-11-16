"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { CalendarIcon, Clock } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, dayName, zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

type Board = NonNullable<ReturnType<typeof useQuery<typeof api.interviews.board>>>;
type Interview = Board["interviews"][number];

const COLUMNS: { id: string; label: string; statuses: Interview["status"][] }[] = [
  { id: "waiting", label: "Waiting for times", statuses: ["awaiting_slots"] },
  { id: "picking", label: "Choosing a time", statuses: ["proposed", "reserving"] },
  { id: "booked", label: "Booked", statuses: ["confirmed"] },
  { id: "done", label: "Done", statuses: ["completed", "no_show", "cancelled"] },
];

/** Interviews: who is at which step, the days ahead, the times applicants can pick, and feedback. */
export function InterviewsScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const board = useQuery(api.interviews.board, { companyId });
  if (!board) {
    return (
      <>
        <PageHeader title="Interviews" lead="Times you offer, the times applicants pick, and what you thought." />
        <Skeleton className="h-96 rounded-2xl" />
      </>
    );
  }
  const upcoming = board.interviews.filter((row) => row.status === "confirmed" && row.startsAt && row.startsAt >= now - 3_600_000).sort((a, b) => a.startsAt! - b.startsAt!);
  const openSlots = board.slots.filter((slot) => slot.status === "open" && slot.startsAt > now).sort((a, b) => a.startsAt - b.startsAt);
  const days = new Map<string, { at: number; items: { at: number; kind: "interview" | "slot"; label: string; sub: string }[] }>();
  for (const row of upcoming) {
    const key = dayName(row.startsAt!, timezone);
    const entry = days.get(key) ?? { at: row.startsAt!, items: [] };
    entry.items.push({ at: row.startsAt!, kind: "interview", label: row.applicant ?? "Applicant", sub: `${row.interviewer ?? "Interviewer"}${row.how ? ` · ${row.how}` : ""}` });
    days.set(key, entry);
  }
  for (const slot of openSlots.slice(0, 40)) {
    const key = dayName(slot.startsAt, timezone);
    const entry = days.get(key) ?? { at: slot.startsAt, items: [] };
    entry.items.push({ at: slot.startsAt, kind: "slot", label: "Open time", sub: "Applicants can pick it" });
    days.set(key, entry);
  }
  const agenda = [...days.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 7);

  return (
    <>
      <PageHeader title="Interviews" lead="Times you offer, the times applicants pick, and what you thought." />
      <div className="grid gap-5">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant={board.calendar ? "success" : "outline"} size="sm">
            <CalendarIcon aria-hidden /> {board.calendar ? `Calendar: ${board.calendar}` : "No calendar connected: times you add here are the ones offered"}
          </Badge>
          <Badge variant="outline" size="sm">
            <Clock aria-hidden /> {board.offerable} open {board.offerable === 1 ? "time" : "times"} to offer · {board.timezone}
          </Badge>
        </div>

        <section className="grid gap-3 lg:grid-cols-4" aria-label="Interviews by step">
          {COLUMNS.map((column) => {
            const rows = board.interviews.filter((row) => column.statuses.includes(row.status));
            return (
              <div key={column.id} className="rounded-2xl border border-border bg-card p-3">
                <p className="mb-2 flex items-center justify-between text-sm font-medium text-strong">
                  {column.label} <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
                </p>
                {rows.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">None</p>
                ) : (
                  <ul className="grid gap-2">
                    {rows.slice(0, 12).map((row) => (
                      <InterviewCard key={row.interviewId} row={row} now={now} timezone={timezone} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel title="The days ahead">
            {agenda.length === 0 ? (
              <p className="text-sm text-muted-foreground">No interviews booked and no open times. Add times so applicants can pick one.</p>
            ) : (
              <ol className="grid gap-4">
                {agenda.map(([day, entry]) => (
                  <li key={day}>
                    <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{day}</p>
                    <ul className="relative grid gap-1.5 border-l border-border pl-4">
                      {entry.items
                        .sort((a, b) => a.at - b.at)
                        .map((item, index) => (
                          <li key={index} className="relative">
                            <span aria-hidden className={cn("absolute top-2 -left-[21px] size-2.5 rounded-full border-2", item.kind === "interview" ? "border-brand-500 bg-brand-500" : "border-border bg-card")} />
                            <div className={cn("rounded-xl px-3 py-2 text-sm", item.kind === "interview" ? "bg-brand-500/10" : "border border-dashed border-border")}>
                              <span className="font-medium tabular-nums text-strong">{clock(item.at, timezone)}</span> <span className="text-strong">{item.label}</span>
                              <span className="block text-xs text-muted-foreground">{item.sub}</span>
                            </div>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
          <AddTimes />
        </div>
      </div>
    </>
  );
}

function InterviewCard({ row, now, timezone }: { row: Interview; now: number; timezone: string }) {
  const { companyId, role } = useCompany();
  const feedback = useMutation(api.interviews.feedback);
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] = useState<"advance" | "hold" | "do_not_advance">("advance");
  const needsFeedback = row.status === "confirmed" && row.startsAt !== null && row.startsAt < now && !row.feedback;
  return (
    <li className="rounded-xl border border-border bg-background p-2.5 text-sm">
      <Link href={`/app/agents/recruiter/applicants?open=${row.applicationId}`} className="font-medium text-strong hover:underline">
        {row.applicant ?? "Applicant"}
      </Link>
      <p className="text-xs text-muted-foreground">
        {row.startsAt ? `${dayName(row.startsAt, timezone)}, ${clock(row.startsAt, timezone)}` : "No time yet"}
        {row.interviewer ? ` · ${row.interviewer}` : ""}
        {row.reschedules ? ` · moved ${row.reschedules}×` : ""}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {row.inCalendar ? <Badge variant="success" size="sm">In calendar</Badge> : null}
        {row.reminderQueuedAt ? <Badge variant="outline" size="sm">Reminder sent</Badge> : null}
        {row.status === "no_show" ? <Badge variant="error" size="sm">No-show</Badge> : null}
        {row.status === "cancelled" ? <Badge variant="outline" size="sm">Cancelled</Badge> : null}
        {row.feedback ? <Badge variant={row.feedback.recommendation === "advance" ? "success" : row.feedback.recommendation === "hold" ? "warning" : "error"} size="sm">{row.feedback.recommendation === "advance" ? "Advance" : row.feedback.recommendation === "hold" ? "Hold" : "Do not advance"}</Badge> : null}
        {needsFeedback ? <Badge variant="warning" size="sm">Needs feedback</Badge> : null}
      </div>
      {needsFeedback && role !== "office" ? (
        open ? (
          <form
            className="mt-2 grid gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await feedback({ companyId, interviewId: row.interviewId as Id<"interviews">, attended: true, notes, recommendation });
                setOpen(false);
              });
            }}
          >
            <SelectInput aria-label="Recommendation" value={recommendation} onChange={(event) => setRecommendation(event.target.value as typeof recommendation)}>
              <option value="advance">Advance</option>
              <option value="hold">Hold</option>
              <option value="do_not_advance">Do not advance</option>
            </SelectInput>
            <TextInput aria-label="Notes" placeholder="What you noticed" value={notes} onChange={(event) => setNotes(event.target.value)} />
            <div className="flex gap-1.5">
              <Button type="submit" size="xs" variant="primary" loading={busy} disabled={!notes.trim()}>
                Save
              </Button>
              <Button type="button" size="xs" variant="ghost" loading={busy} onClick={() => void run(() => feedback({ companyId, interviewId: row.interviewId as Id<"interviews">, attended: false, notes: "Did not attend.", recommendation: "hold" }))}>
                They did not come
              </Button>
            </div>
          </form>
        ) : (
          <Button className="mt-2" size="xs" variant="outline" onClick={() => setOpen(true)}>
            Record feedback
          </Button>
        )
      ) : null}
      <FormError message={error} />
    </li>
  );
}

function AddTimes() {
  const { companyId, timezone, role } = useCompany();
  const members = useQuery(api.members.list, { companyId });
  const add = useMutation(api.interviews.addSlots);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ interviewerId: "", date: "", from: "09:00", to: "12:00" });
  const [added, setAdded] = useState<string | null>(null);
  if (role === "office") return null;
  return (
    <Panel title="Offer interview times">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setAdded(null);
          const startsAt = zonedInstant(form.date, form.from, timezone);
          const endsAt = zonedInstant(form.date, form.to, timezone);
          void run(async () => {
            if (startsAt === null || endsAt === null) throw new Error("Choose a day and times.");
            await add({ companyId, interviewerId: form.interviewerId as Id<"members">, startsAt, endsAt });
            setAdded("Added. Applicants waiting for a time can pick from them now.");
          });
        }}
      >
        <Field label="Interviewer" className="sm:col-span-2">
          <SelectInput value={form.interviewerId} onChange={(event) => setForm({ ...form, interviewerId: event.target.value })} required>
            <option value="">Choose…</option>
            {members
              ?.filter((member) => member.status === "active")
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
          </SelectInput>
        </Field>
        <Field label="Day" className="sm:col-span-2">
          <TextInput type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
        </Field>
        <Field label="From">
          <TextInput type="time" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} />
        </Field>
        <Field label="Until">
          <TextInput type="time" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">Split into interview-length times on the company&apos;s clock ({timezone}). Applicants pick one from their link.</p>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button type="submit" size="sm" variant="primary" loading={busy}>
            Add times
          </Button>
          {added ? <span className="text-xs text-muted-foreground">{added}</span> : null}
        </div>
        <FormError message={error} />
      </form>
    </Panel>
  );
}
