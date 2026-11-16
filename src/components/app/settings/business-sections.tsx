"use client";

import { useBusinessDraft } from "@/components/app/settings/business-draft";
import { Field, FormError, SelectInput, TextArea, TextInput } from "@/components/app/form";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { blankService, hoursSummary, minuteToTime, type HoursWindow, timeToMinute, WEEKDAYS } from "@/lib/app/settings-draft";

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
  const { draft, saved, canEdit, edit, configured } = useBusinessDraft();
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

/** The service catalog. Services are archived, never deleted, so earlier visits keep their record. */
export function ServicesSection() {
  const { draft, saved, canEdit, edit } = useBusinessDraft();
  if (!draft || !saved) return <Skeleton className="h-72 rounded-2xl" />;
  const set = (id: string, patch: Partial<(typeof draft.services)[number]>) => edit((current) => ({ ...current, services: current.services.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const savedIds = new Set(saved.services.map((s) => s.id));
  return (
    <div className="grid gap-5">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Templates for visits an office member creates. A price here is an editable starting point, not a quote, discount, tax or refund. A visit keeps a copy of the service as it was when the visit was made, so editing or archiving a service never changes earlier visits.
      </p>
      {draft.services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
          <p className="text-base font-semibold text-strong">No services yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Visits can still be made by typing a service and scope. Add a service to start from a template instead.</p>
        </div>
      ) : null}
      <ul className="grid gap-4">
        {draft.services.map((service) => {
          const archived = service.status === "archived";
          return (
            <li key={service.id} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-strong">{service.name.trim() || "New service"}</h3>
                  {archived ? (
                    <Badge variant="outline" size="sm">
                      Archived
                    </Badge>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={() => set(service.id, { status: archived ? "active" : "archived" })}>
                      {archived ? "Restore" : "Archive"}
                    </Button>
                    {!savedIds.has(service.id) ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => edit((current) => ({ ...current, services: current.services.filter((s) => s.id !== service.id) }))}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <TextInput value={service.name} disabled={!canEdit} onChange={(event) => set(service.id, { name: event.target.value })} />
                </Field>
                <Field label="Starting price (USD)" hint="Optional. Fills a new visit's price, which can be changed.">
                  <TextInput inputMode="decimal" value={service.price} disabled={!canEdit} placeholder="150.00" onChange={(event) => set(service.id, { price: event.target.value })} />
                </Field>
                <Field label="Scope" className="sm:col-span-2" hint="What the crew does. Cleaners are shown this when they accept.">
                  <TextArea value={service.scope} disabled={!canEdit} onChange={(event) => set(service.id, { scope: event.target.value })} />
                </Field>
                <Field label="Duration (minutes)">
                  <TextInput inputMode="numeric" value={service.duration} disabled={!canEdit} onChange={(event) => set(service.id, { duration: event.target.value })} />
                </Field>
                <Field label="Default crew">
                  <TextInput inputMode="numeric" value={service.crew} disabled={!canEdit} onChange={(event) => set(service.id, { crew: event.target.value })} />
                </Field>
                <Field label="Skills" className="sm:col-span-2" hint="Separate with commas. Only cleaners with every skill are offered the visit.">
                  <TextInput value={service.skills} disabled={!canEdit} onChange={(event) => set(service.id, { skills: event.target.value })} />
                </Field>
              </div>
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => edit((current) => ({ ...current, services: [...current.services, blankService()] }))}>
            Add a service
          </Button>
        </div>
      ) : null}
      <SaveBar />
    </div>
  );
}
