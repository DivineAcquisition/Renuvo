"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { TYPE_WORDS, type Profile } from "@/components/app/cleaners/shared";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { useNow } from "@/components/app/use-now";
import { Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { centsFrom, localDate, zonedInstant } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export function Submit({ busy, label, onCancel, disabled }: { busy: boolean; label: string; onCancel: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <Button type="submit" variant="primary" loading={busy} disabled={disabled}>
        {label}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

export const list = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** The details a manager keeps. Worker type and pay are the Owner's and have their own forms. */
export function EditDetailsForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { companyId } = useCompany();
  const update = useMutation(api.workforce.update);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ name: profile.name, preferredName: profile.preferredName ?? "", email: profile.email ?? "", phone: profile.phone ?? "", skills: profile.skills.join(", "), areas: profile.serviceAreas.join(", ") });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await update({ companyId, cleanerId: profile.cleanerId, name: form.name, preferredName: form.preferredName, email: form.email, phone: form.phone, skills: list(form.skills), serviceAreas: list(form.areas) });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} autoComplete="off" />
        </Field>
        <Field label="Preferred name (optional)">
          <TextInput value={form.preferredName} onChange={set("preferredName")} maxLength={80} autoComplete="off" />
        </Field>
        <Field label="Mobile number (optional)" hint="Offers and reminders are texted here.">
          <TextInput type="tel" value={form.phone} onChange={set("phone")} autoComplete="off" />
        </Field>
        <Field label="Email (optional)">
          <TextInput type="email" value={form.email} onChange={set("email")} autoComplete="off" />
        </Field>
      </div>
      <Field label="Skills" hint="Separate with commas. A visit that needs a skill is offered only to people who have it.">
        <TextInput value={form.skills} onChange={set("skills")} />
      </Field>
      <Field label="Postal codes they work in" hint="Separate with commas. Visits elsewhere are not offered to them.">
        <TextInput value={form.areas} onChange={set("areas")} />
      </Field>
      <FormError message={error} />
      <Submit busy={busy} label="Save details" onCancel={onDone} />
    </form>
  );
}

const STATUS_CHOICES: { value: Profile["status"]; label: string; hint: string }[] = [
  { value: "ready", label: "Active", hint: "Dispatch may offer them work that fits, once their hours, areas and pay are set." },
  { value: "paused", label: "Paused", hint: "No new offers. Visits they already accepted stay theirs until you decide each one." },
  { value: "ended", label: "Engagement ended", hint: "No new offers. Their history is kept. Visits they already accepted stay theirs until you decide each one." },
];

/**
 * A person changes the engagement status. What it touches is shown first: the visits they hold are
 * listed, and nothing is taken off them. Pausing or ending needs a reason.
 */
export function StatusForm({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const { companyId } = useCompany();
  const now = useNow();
  const setStatus = useMutation(api.workforce.setStatus);
  const impact = useQuery(api.workforce.statusImpact, now ? { companyId, cleanerId: profile.cleanerId, asOf: now } : "skip");
  const { busy, error, run } = useRun();
  const choices = STATUS_CHOICES.filter((choice) => choice.value !== profile.status);
  const [to, setTo] = useState<Profile["status"]>(choices[0].value);
  const [reason, setReason] = useState("");
  const needsReason = to === "paused" || to === "ended";
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setStatus({ companyId, cleanerId: profile.cleanerId, status: to, reason: reason || undefined });
          onDone();
        });
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium text-strong">Change {profile.name}&apos;s status to</legend>
        {choices.map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 has-checked:border-brand-500/60 has-checked:bg-brand-500/5">
            <input type="radio" name="status" value={choice.value} checked={to === choice.value} onChange={() => setTo(choice.value)} className="mt-0.5 size-4 accent-[var(--color-brand-500)]" />
            <span>
              <span className="block text-sm font-medium text-strong">{choice.label}</span>
              <span className="block text-xs leading-relaxed text-muted-foreground">{choice.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {needsReason ? (
        <Field label="Why" hint="Kept on their record for managers and the Owner. Not shown to the cleaner or to office staff.">
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} maxLength={500} />
        </Field>
      ) : null}
      {to !== "ready" ? (
        <div className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium text-strong">What this touches</p>
          {impact === undefined ? (
            <p className="text-muted-foreground">Checking their upcoming visits…</p>
          ) : impact.held.length === 0 ? (
            <p className="text-muted-foreground">They hold no upcoming visits or open offers.</p>
          ) : (
            <>
              <p className="text-muted-foreground">They hold {impact.held.length === 1 ? "one upcoming visit or offer" : `${impact.held.length} upcoming visits or offers`}. Nothing is taken off them: each stays until you decide it, and the Cleaners workspace lists them.</p>
              <ul className="mt-2 grid gap-1">
                {impact.held.map((row) => (
                  <li key={row.jobId} className="text-xs text-strong">
                    {row.service}, {row.when} <span className="text-muted-foreground">· {row.status === "offered" ? "offer out" : "accepted"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
      <FormError message={error} />
      <Submit busy={busy} label="Change status" onCancel={onDone} disabled={needsReason && reason.trim().length < 3} />
    </form>
  );
}

/** Classification is the Owner's decision. Selestial records it and never decides it. */
export function WorkerTypeForm({ profile, subcontractors, onDone }: { profile: Profile; subcontractors: { id: Id<"subcontractors">; name: string; status: string }[]; onDone: () => void }) {
  const { companyId } = useCompany();
  const setEngagement = useMutation(api.workforce.setEngagement);
  const { busy, error, run } = useRun();
  const [engagement, setType] = useState(profile.engagement);
  const [sub, setSub] = useState<string>(profile.subcontractor?.id ?? "");
  const active = subcontractors.filter((row) => row.status === "active");
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setEngagement({ companyId, cleanerId: profile.cleanerId, engagement, subcontractorId: engagement === "subcontracted" && sub ? (sub as Id<"subcontractors">) : undefined });
          onDone();
        });
      }}
    >
      <Field label="Worker type" hint="Record what you and they agreed. Selestial does not decide whether someone is an employee or a contractor.">
        <SelectInput value={engagement} onChange={(event) => setType(event.target.value as typeof engagement)}>
          {(["employee", "contractor", "subcontracted"] as const).map((value) => (
            <option key={value} value={value}>
              {TYPE_WORDS[value]}
            </option>
          ))}
        </SelectInput>
      </Field>
      {engagement === "subcontracted" ? (
        <Field label="Supplied by" hint={active.length === 0 ? "Add the subcontractor company first, under Subcontractors." : "Their earlier company, if any, is kept in their history."}>
          <SelectInput value={sub} onChange={(event) => setSub(event.target.value)} required>
            <option value="">Choose a company</option>
            {active.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      <FormError message={error} />
      <Submit busy={busy} label="Save worker type" onCancel={onDone} />
    </form>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minuteOf = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** The hours they said they can work, exactly as they gave them. The whole week is saved at once. */
export function HoursForm({ cleanerId, windows, timezone, onDone }: { cleanerId: Id<"cleaners">; windows: { weekday: number; startMinute: number; endMinute: number }[]; timezone: string; onDone: () => void }) {
  const { companyId } = useCompany();
  const setWeek = useMutation(api.availability.setWeek);
  const { busy, error, run, setError } = useRun();
  const [rows, setRows] = useState(() => windows.map((window, index) => ({ key: index, weekday: window.weekday, from: hhmm(window.startMinute), to: window.endMinute === 1440 ? "23:59" : hhmm(window.endMinute) })));
  const update = (key: number, change: Partial<(typeof rows)[number]>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = rows.map((row) => ({ weekday: row.weekday, startMinute: minuteOf(row.from), endMinute: row.to === "23:59" ? 1440 : minuteOf(row.to) }));
        if (parsed.some((row) => row.startMinute === null || row.endMinute === null || row.startMinute >= row.endMinute)) return setError("Each row needs a start before its end.");
        void run(async () => {
          await setWeek({ companyId, cleanerId, windows: parsed as { weekday: number; startMinute: number; endMinute: number }[] });
          onDone();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">Enter only what the cleaner told you, on your company&apos;s clock ({timezone}). Nobody is offered a time outside these hours.</p>
      {rows.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">No hours yet. Add the days and times they can work.</p> : null}
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border p-2 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
            <label className="col-span-2 grid gap-1 text-xs text-muted-foreground sm:col-span-1">
              Day
              <SelectInput value={row.weekday} onChange={(event) => update(row.key, { weekday: Number(event.target.value) })}>
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>
                    {day}
                  </option>
                ))}
              </SelectInput>
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              From
              <TextInput type="time" value={row.from} onChange={(event) => update(row.key, { from: event.target.value })} required />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Until
              <TextInput type="time" value={row.to} onChange={(event) => update(row.key, { to: event.target.value })} required />
            </label>
            <Button variant="ghost" size="icon" aria-label={`Remove ${DAYS[row.weekday]} ${row.from} to ${row.to}`} onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))} className="col-span-2 justify-self-end sm:col-span-1">
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="outline" size="sm" onClick={() => setRows((current) => [...current, { key: Date.now(), weekday: current.length > 0 ? (current[current.length - 1].weekday + 1) % 7 : 1, from: "09:00", to: "17:00" }])}>
          <Plus aria-hidden /> Add hours
        </Button>
      </div>
      <FormError message={error} />
      <Submit busy={busy} label="Save hours" onCancel={onDone} />
    </form>
  );
}

export function TimeOffForm({ cleanerId, timezone, onDone }: { cleanerId: Id<"cleaners">; timezone: string; onDone: () => void }) {
  const { companyId } = useCompany();
  const add = useMutation(api.availability.addTimeOff);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState(() => {
    const today = localDate(Date.now(), timezone);
    return { fromDate: today, fromTime: "00:00", toDate: today, toTime: "23:59", note: "" };
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const startsAt = zonedInstant(form.fromDate, form.fromTime, timezone);
        const endsAt = zonedInstant(form.toDate, form.toTime, timezone);
        if (!startsAt || !endsAt || startsAt >= endsAt) return setError("Time off must start before it ends.");
        void run(async () => {
          await add({ companyId, cleanerId, startsAt, endsAt, note: form.note || undefined });
          onDone();
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <TextInput type="date" value={form.fromDate} onChange={set("fromDate")} required />
        </Field>
        <Field label="Time">
          <TextInput type="time" value={form.fromTime} onChange={set("fromTime")} required />
        </Field>
        <Field label="Until">
          <TextInput type="date" value={form.toDate} onChange={set("toDate")} required />
        </Field>
        <Field label="Time">
          <TextInput type="time" value={form.toTime} onChange={set("toTime")} required />
        </Field>
      </div>
      <Field label="Note (optional)" hint="Visible to everyone who schedules.">
        <TextArea value={form.note} onChange={set("note")} maxLength={300} rows={2} />
      </Field>
      <p className="text-xs text-muted-foreground">Visits they already accepted in this time are not changed. If any overlap, they appear under Needs attention for you to decide.</p>
      <FormError message={error} />
      <Submit busy={busy} label="Add time off" onCancel={onDone} />
    </form>
  );
}

/** The Owner sets how a person is paid. Offers state pay from this; a job already offered keeps the pay it stated. */
export function PayForm({ cleanerId, engagement, current, onDone }: { cleanerId: Id<"cleaners">; engagement: Profile["engagement"]; current: { kind: "share" | "hourly"; shareBps: number | null; hourlyCents: number | null } | null; onDone: () => void }) {
  const { companyId } = useCompany();
  const setPay = useMutation(api.cleaners.setPay);
  const { busy, error, run, setError } = useRun();
  const allowed: ("share" | "hourly")[] = engagement === "employee" ? ["hourly"] : engagement === "contractor" ? ["share"] : ["share", "hourly"];
  const [kind, setKind] = useState<"share" | "hourly">(current?.kind && allowed.includes(current.kind) ? current.kind : allowed[0]);
  const [value, setValue] = useState(current ? (current.kind === "share" ? String((current.shareBps ?? 0) / 100) : ((current.hourlyCents ?? 0) / 100).toFixed(2)) : "");
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (kind === "share") {
          const percent = Number(value);
          if (!Number.isFinite(percent) || percent < 0 || percent > 100) return setError("The share is a percentage from 0 to 100.");
          void run(async () => {
            await setPay({ companyId, cleanerId, pay: { kind: "share", shareBps: Math.round(percent * 100) } });
            onDone();
          });
        } else {
          const cents = centsFrom(value);
          if (cents === null) return setError("The hourly rate is an amount of money, like 22.50.");
          void run(async () => {
            await setPay({ companyId, cleanerId, pay: { kind: "hourly", hourlyCents: cents } });
            onDone();
          });
        }
      }}
    >
      {allowed.length > 1 ? (
        <Field label="Paid as">
          <SelectInput value={kind} onChange={(event) => setKind(event.target.value as "share" | "hourly")}>
            <option value="share">A share of each job&apos;s price</option>
            <option value="hourly">An hourly rate</option>
          </SelectInput>
        </Field>
      ) : null}
      <Field label={kind === "share" ? "Share of the job price (%)" : "Hourly rate ($)"} hint={kind === "share" ? "Contractors are paid a share of each job's price." : "Employees are paid for their own hours on each job."}>
        <TextInput inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} required />
      </Field>
      <p className="text-xs text-muted-foreground">A change applies to offers made from now on. Every job already offered keeps the pay it stated.</p>
      <FormError message={error} />
      <Submit busy={busy} label="Save pay" onCancel={onDone} />
    </form>
  );
}
