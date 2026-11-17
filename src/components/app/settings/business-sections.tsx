"use client";

import { Unavailable } from "@/components/app/settings/guard";
import { useBusinessDraft } from "@/components/app/settings/business-draft";
import { Field, FormError, SelectInput, TextArea, TextInput } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hoursSummary, minuteToTime, type HoursWindow, timeToMinute, WEEKDAYS } from "@/lib/app/settings-draft";

/** Save, discard and the words that explain why saving is not possible. Shared by both business pages. */
export function SaveBar() {
  const { canEdit, dirty, stale, problems, saving, error, notice, save, discard } = useBusinessDraft();
  if (!canEdit) return <p className="text-xs text-muted-foreground">Only the Owner changes these. You can read them.</p>;
  return (
    <div className="grid gap-2">
      {stale ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-strong">
          These settings were saved by someone else after you started editing. Your edits are kept below, but they cannot be saved over the newer version. Copy anything you need, then load the latest.
        </p>
      ) : null}
      {problems.length > 0 ? (
        <ul role="alert" className="grid gap-0.5 text-sm text-destructive-foreground">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      <FormError message={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="primary" size="sm" loading={saving} disabled={!dirty || stale || problems.length > 0} onClick={() => void save()}>
          Save changes
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={!dirty || saving} onClick={discard}>
          {stale ? "Discard my edits and load the latest" : "Discard changes"}
        </Button>
        {dirty && !stale ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        {notice ? (
          <span role="status" className="text-xs text-muted-foreground">
            {notice}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function HoursEditor() {
  const { draft, edit, canEdit } = useBusinessDraft();
  if (!draft) return null;
  const set = (index: number, patch: Partial<HoursWindow>) => edit((current) => ({ ...current, hours: current.hours.map((w, i) => (i === index ? { ...w, ...patch } : w)) }));
  return (
    <div className="grid gap-2">
      {draft.hours.length === 0 ? <p className="text-sm text-muted-foreground">No hours set. Visits can be booked at any time.</p> : null}
      <ul className="grid gap-2">
        {draft.hours.map((window, index) => (
          <li key={index} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
            <Field label="Day" className="[&>span:first-child]:sr-only">
              <SelectInput aria-label="Day" disabled={!canEdit} value={window.weekday} onChange={(event) => set(index, { weekday: Number(event.target.value) })}>
                {WEEKDAYS.map((day, weekday) => (
                  <option key={day} value={weekday}>
                    {day}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="From" className="[&>span:first-child]:sr-only">
              <TextInput aria-label="From" type="time" disabled={!canEdit} value={minuteToTime(window.startMinute)} onChange={(event) => set(index, { startMinute: timeToMinute(event.target.value) ?? window.startMinute })} />
            </Field>
            <Field label="Until" className="[&>span:first-child]:sr-only">
              <TextInput aria-label="Until" type="time" disabled={!canEdit} value={window.endMinute >= 1440 ? "23:59" : minuteToTime(window.endMinute)} onChange={(event) => set(index, { endMinute: timeToMinute(event.target.value) ?? window.endMinute })} />
            </Field>
            {canEdit ? (
              <Button type="button" size="sm" variant="ghost" onClick={() => edit((current) => ({ ...current, hours: current.hours.filter((_, i) => i !== index) }))}>
                Remove
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => edit((current) => ({ ...current, hours: [...current.hours, { weekday: 1, startMinute: 8 * 60, endMinute: 17 * 60 }] }))}>
            Add a window
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => edit((current) => ({ ...current, hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 17 * 60 })) }))}
          >
            Weekdays, 8:00 AM to 5:00 PM
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Company name and time zone, the postal codes it works in, and the hours appointments may be booked. */
export function BusinessSection() {
  const { draft, saved, canEdit, edit, configured, unavailable } = useBusinessDraft();
  if (unavailable) return <Unavailable error={unavailable} />;
  if (!draft || !saved) return <Skeleton className="h-72 rounded-2xl" />;
  return (
    <div className="grid gap-5">
      <Panel title="Company">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <TextInput value={draft.name} disabled={!canEdit} onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))} required />
          </Field>
          <Field label="Time zone" hint="Appointments, deadlines and these hours use this clock.">
            <TextInput value={draft.timezone} disabled={!canEdit} onChange={(event) => edit((current) => ({ ...current, timezone: event.target.value }))} required />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Changing the time zone keeps every stored appointment at the same moment, so the times people read can shift. Review scheduled work before changing the company clock.
        </p>
      </Panel>

      <Panel title="Where you work">
        <Field label="Postal codes" hint="Separate with commas or new lines. Leave empty to work anywhere. New and moved visits outside these are refused; visits already booked are left alone.">
          <TextArea rows={3} value={draft.areas} disabled={!canEdit} onChange={(event) => edit((current) => ({ ...current, areas: event.target.value }))} placeholder="78701, 78702" />
        </Field>
      </Panel>

      <Panel title="Appointment hours" action={configured ? undefined : <Badge variant="outline" size="sm">No limits set</Badge>}>
        <p className="mb-3 text-sm text-muted-foreground">
          When visits may be booked. These are not a cleaner&apos;s availability or the hours messages may be sent; each cleaner&apos;s own hours and area still apply. A visit must fit inside one window, and overnight visits are not supported. No windows means no company-wide limit, not closed.
        </p>
        <HoursEditor />
        {!canEdit && saved.hours.length > 0 ? (
          <ul className="mt-3 text-sm text-muted-foreground">
            {hoursSummary(saved.hours).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <SaveBar />
    </div>
  );
}
