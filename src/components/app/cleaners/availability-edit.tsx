"use client";

/**
 * Changing a cleaner's availability from the office: weekly hours, time away, a date exception, or a
 * confirmation that their hours are still right. Before anything is saved, the booked and offered work the
 * change would touch is shown. Saving never removes anyone from a job: a clash is for a person to decide in
 * Dispatch, and the job stays as it is until then.
 */
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Check, Plus, TriangleAlert, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { zonedInstant } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/selection";

type Window = { weekday: number; startMinute: number; endMinute: number };
type Change = Omit<FunctionArgs<typeof api.availability.preview>, "companyId" | "cleanerId">;
type Clash = FunctionReturnType<typeof api.availability.preview>[number];

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const toClock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const fromClock = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute <= 1440 ? minute : null;
};

/** The booked and offered work a change would touch, asked again as the change is edited. */
export function ImpactPreview({ cleanerId, change, firstName }: { cleanerId: string; change: Change | null; firstName: string }) {
  const { companyId } = useCompany();
  const clashes = useQuery(api.availability.preview, change ? { companyId, cleanerId: cleanerId as Id<"cleaners">, ...change } : "skip");
  if (!change) return null;
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm" aria-live="polite">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Booked work this touches</p>
      {clashes === undefined ? (
        <p className="mt-1 text-muted-foreground">Checking the next 60 days…</p>
      ) : clashes.length === 0 ? (
        <p className="mt-1 flex items-center gap-1.5 text-strong">
          <Check className="size-4 text-success-foreground" aria-hidden />
          Nothing {firstName} has accepted or been offered in the next 60 days.
        </p>
      ) : (
        <>
          <ul className="mt-1.5 grid gap-1.5">
            {clashes.map((row) => (
              <ClashRow key={`${row.jobId}-${row.startsAt}`} row={row} />
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">Saving keeps these jobs as they are. Keep or cover each one in Dispatch.</p>
        </>
      )}
    </div>
  );
}

function ClashRow({ row }: { row: Clash }) {
  return (
    <li className={cn("rounded-lg border px-2.5 py-1.5", row.alreadyClashing ? "border-border bg-card" : "border-warning/40 bg-warning/5")}>
      <span className="flex flex-wrap items-center gap-1.5">
        <TriangleAlert className="size-3.5 shrink-0 text-warning-foreground" aria-hidden />
        <span className="font-medium text-strong">{row.label}</span>
        <Badge variant={row.status === "accepted" ? "success" : "info"} size="sm">
          {row.status === "accepted" ? "Accepted" : "Offered"}
        </Badge>
        {row.alreadyClashing ? <span className="text-xs text-muted-foreground">already clashing before this change</span> : null}
      </span>
      <span className="block text-xs text-muted-foreground">This job {row.reason}.</span>
    </li>
  );
}

function SavedClashes({ clashes, onClose }: { clashes: Clash[]; onClose: () => void }) {
  const fresh = clashes.filter((row) => !row.alreadyClashing);
  return (
    <div className="grid gap-3" role="status">
      <p className="flex items-center gap-1.5 text-sm font-medium text-strong">
        <Check className="size-4 text-success-foreground" aria-hidden />
        Saved.
      </p>
      {fresh.length > 0 ? (
        <>
          <p className="text-sm text-muted-foreground">
            {fresh.length === 1 ? "One job now clashes" : `${fresh.length} jobs now clash`}. Nobody was taken off a job: each shows on the profile and in the directory until a person keeps or covers it in Dispatch.
          </p>
          <ul className="grid gap-1.5 text-sm">
            {fresh.map((row) => (
              <ClashRow key={`${row.jobId}-${row.startsAt}`} row={row} />
            ))}
          </ul>
        </>
      ) : null}
      <div className="flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

// ── Weekly hours ────────────────────────────────────────────────────────────────────────────────────

export function WeekDialog({ cleanerId, firstName, windows, onClose }: { cleanerId: string; firstName: string; windows: Window[]; onClose: () => void }) {
  const { companyId } = useCompany();
  const save = useMutation(api.availability.setWeek);
  const { busy, error, run } = useRun();
  const [rows, setRows] = useState(() => windows.map((row) => ({ weekday: row.weekday, from: toClock(row.startMinute), to: toClock(row.endMinute) })));
  const [saved, setSaved] = useState<Clash[] | null>(null);
  const parsed = rows.map((row) => ({ weekday: row.weekday, startMinute: fromClock(row.from), endMinute: fromClock(row.to) }));
  const valid = parsed.every((row) => row.startMinute !== null && row.endMinute !== null && row.startMinute < row.endMinute);
  const next: Window[] = valid ? parsed.map((row) => ({ weekday: row.weekday, startMinute: row.startMinute!, endMinute: row.endMinute! })) : [];
  return (
    <Modal open onClose={onClose} title="Weekly hours" description={`The days and hours ${firstName} said they can work, on the company's clock. Saving replaces the whole week and counts as confirming it.`}>
      {saved ? (
        <SavedClashes clashes={saved} onClose={onClose} />
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void run(async () => setSaved((await save({ companyId, cleanerId: cleanerId as Id<"cleaners">, windows: next })).clashes));
          }}
        >
          <ul className="grid gap-1.5">
            {ORDER.map((day) => {
              const mine = rows.map((row, index) => ({ ...row, index })).filter((row) => row.weekday === day);
              return (
                <li key={day} className="grid grid-cols-[5.5rem_1fr] items-start gap-2 rounded-lg border border-border px-2.5 py-2">
                  <span className="pt-1.5 text-sm font-medium text-strong">{DAYS[day].slice(0, 3)}</span>
                  <span className="grid gap-1.5">
                    {mine.length === 0 ? <span className="pt-1.5 text-sm text-muted-foreground">Not working</span> : null}
                    {mine.map((row) => (
                      <span key={row.index} className="flex flex-wrap items-center gap-1.5">
                        <TextInput type="time" aria-label={`${DAYS[day]} from`} value={row.from} onChange={(event) => setRows(rows.map((item, index) => (index === row.index ? { ...item, from: event.target.value } : item)))} className="w-32" />
                        <span className="text-xs text-muted-foreground">to</span>
                        <TextInput type="time" aria-label={`${DAYS[day]} to`} value={row.to} onChange={(event) => setRows(rows.map((item, index) => (index === row.index ? { ...item, to: event.target.value } : item)))} className="w-32" />
                        <Button variant="ghost" size="xs" aria-label={`Remove these ${DAYS[day]} hours`} onClick={() => setRows(rows.filter((_, index) => index !== row.index))}>
                          <X aria-hidden />
                        </Button>
                      </span>
                    ))}
                    <span>
                      <Button variant="ghost" size="xs" onClick={() => setRows([...rows, { weekday: day, from: "08:00", to: "17:00" }])}>
                        <Plus aria-hidden />
                        {mine.length ? "More hours" : "Add hours"}
                      </Button>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          {!valid ? <p className="text-sm text-destructive-foreground">Each window needs a start before its end.</p> : null}
          <ImpactPreview cleanerId={cleanerId} firstName={firstName} change={valid ? { windows: next } : null} />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
              Save hours
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Time away ───────────────────────────────────────────────────────────────────────────────────────

export function TimeAwayDialog({ cleanerId, firstName, onClose }: { cleanerId: string; firstName: string; onClose: () => void }) {
  const { companyId, timezone } = useCompany();
  const add = useMutation(api.availability.addTimeOff);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ fromDate: "", fromTime: "00:00", toDate: "", toTime: "23:59", note: "" });
  const [saved, setSaved] = useState<Clash[] | null>(null);
  const startsAt = form.fromDate ? zonedInstant(form.fromDate, form.fromTime || "00:00", timezone) : null;
  const endsAt = form.toDate ? zonedInstant(form.toDate, form.toTime || "23:59", timezone) : null;
  const valid = startsAt !== null && endsAt !== null && startsAt < endsAt;
  const change = valid ? { timeAway: { startsAt: startsAt!, endsAt: endsAt! } } : null;
  const clashes = useQuery(api.availability.preview, change ? { companyId, cleanerId: cleanerId as Id<"cleaners">, ...change } : "skip");
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open onClose={onClose} title="Record time away" description={`When ${firstName} told the office they will be away. Dispatch stops offering them work for this time.`}>
      {saved ? (
        <SavedClashes clashes={saved} onClose={onClose} />
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            void run(async () => {
              await add({ companyId, cleanerId: cleanerId as Id<"cleaners">, startsAt: startsAt!, endsAt: endsAt!, note: form.note || undefined });
              setSaved(clashes ?? []);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From">
              <span className="flex gap-1.5">
                <TextInput type="date" value={form.fromDate} onChange={set("fromDate")} aria-label="From date" required />
                <TextInput type="time" value={form.fromTime} onChange={set("fromTime")} aria-label="From time" className="w-28" />
              </span>
            </Field>
            <Field label="Until">
              <span className="flex gap-1.5">
                <TextInput type="date" value={form.toDate} min={form.fromDate || undefined} onChange={set("toDate")} aria-label="Until date" required />
                <TextInput type="time" value={form.toTime} onChange={set("toTime")} aria-label="Until time" className="w-28" />
              </span>
            </Field>
          </div>
          <Field label="Note (optional)" hint="Only the office sees this.">
            <TextInput value={form.note} onChange={set("note")} maxLength={300} />
          </Field>
          {form.fromDate && form.toDate && !valid ? <p className="text-sm text-destructive-foreground">Time away must start before it ends.</p> : null}
          <ImpactPreview cleanerId={cleanerId} firstName={firstName} change={change} />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
              Record time away
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── One date ────────────────────────────────────────────────────────────────────────────────────────

export function ExceptionDialog({ cleanerId, firstName, onClose }: { cleanerId: string; firstName: string; onClose: () => void }) {
  const { companyId } = useCompany();
  const add = useMutation(api.availability.addException);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ date: "", kind: "unavailable" as "unavailable" | "available", whole: true, from: "09:00", to: "13:00", note: "" });
  const [saved, setSaved] = useState<Clash[] | null>(null);
  const startMinute = form.whole ? undefined : (fromClock(form.from) ?? undefined);
  const endMinute = form.whole ? undefined : (fromClock(form.to) ?? undefined);
  const valid = Boolean(form.date) && (form.whole || (startMinute !== undefined && endMinute !== undefined && startMinute < endMinute));
  const exception = valid ? { date: form.date, kind: form.kind, startMinute, endMinute } : null;
  return (
    <Modal open onClose={onClose} title="One date" description={`A single date outside ${firstName}'s weekly pattern: a day they cannot work, or a day they can.`}>
      {saved ? (
        <SavedClashes clashes={saved} onClose={onClose} />
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!exception) return;
            void run(async () => setSaved((await add({ companyId, cleanerId: cleanerId as Id<"cleaners">, exception, note: form.note || undefined })).clashes));
          }}
        >
          <div role="radiogroup" aria-label="What changes on that date" className="grid gap-1.5 sm:grid-cols-2">
            {(["unavailable", "available"] as const).map((kind) => (
              <label key={kind} className={cn("flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-sm", form.kind === kind ? "border-brand-500 bg-brand-500/5" : "border-border")}>
                <input type="radio" name="kind" className="mt-0.5 accent-[#6838ef]" checked={form.kind === kind} onChange={() => setForm({ ...form, kind })} />
                <span>
                  <span className="block font-medium text-strong">{kind === "unavailable" ? "Cannot work" : "Can work"}</span>
                  <span className="block text-xs text-muted-foreground">{kind === "unavailable" ? "Not offered work then, even inside their weekly hours." : "Can be offered work then, even outside their weekly hours."}</span>
                </span>
              </label>
            ))}
          </div>
          <Field label="Date">
            <TextInput type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} required />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.whole} onCheckedChange={(checked) => setForm({ ...form, whole: checked })} />
            The whole day
          </label>
          {!form.whole ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <TextInput type="time" aria-label="From" value={form.from} onChange={(event) => setForm({ ...form, from: event.target.value })} className="w-32" />
              <span className="text-xs text-muted-foreground">to</span>
              <TextInput type="time" aria-label="To" value={form.to} onChange={(event) => setForm({ ...form, to: event.target.value })} className="w-32" />
            </span>
          ) : null}
          <Field label="Note (optional)">
            <TextInput value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} maxLength={300} />
          </Field>
          <ImpactPreview cleanerId={cleanerId} firstName={firstName} change={exception ? { exception } : null} />
          <FormError message={error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!valid}>
              Save date
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ── Confirming on their behalf ──────────────────────────────────────────────────────────────────────

export function ConfirmHoursDialog({ cleanerId, firstName, onClose }: { cleanerId: string; firstName: string; onClose: () => void }) {
  const { companyId } = useCompany();
  const confirm = useMutation(api.availability.confirm);
  const { busy, error, run } = useRun();
  const [how, setHow] = useState("");
  return (
    <Modal open onClose={onClose} title="Hours still right" description={`Record that ${firstName} told you their weekly hours have not changed. Say how, so the history can be read later.`}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await confirm({ companyId, cleanerId: cleanerId as Id<"cleaners">, how });
            onClose();
          });
        }}
      >
        <Field label="How they confirmed">
          <TextInput value={how} onChange={(event) => setHow(event.target.value)} placeholder="Called them on Monday" required maxLength={200} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Record
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Removes time away or a date. Removing can only take a clash away, so it needs no preview. */
export function RemoveButton({ what, label }: { what: { timeOffId: string } | { exceptionId: string }; label: string }) {
  const { companyId } = useCompany();
  const removeTimeOff = useMutation(api.availability.removeTimeOff);
  const removeException = useMutation(api.availability.removeException);
  const { busy, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        variant="ghost"
        size="xs"
        loading={busy}
        aria-label={label}
        onClick={() =>
          void run(async () => {
            if ("timeOffId" in what) await removeTimeOff({ companyId, timeOffId: what.timeOffId as Id<"timeOff"> });
            else await removeException({ companyId, exceptionId: what.exceptionId as Id<"availabilityExceptions"> });
          })
        }
      >
        <X aria-hidden />
        Remove
      </Button>
      {error ? <span className="text-xs text-destructive-foreground">{error}</span> : null}
    </span>
  );
}
