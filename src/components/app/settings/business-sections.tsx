"use client";

import { useId, useMemo, useState } from "react";

import { Unavailable } from "@/components/app/settings/guard";
import { useBusinessDraft } from "@/components/app/settings/business-draft";
import { SaveBar as SaveArea } from "@/components/app/settings/save-bar";
import { Field, TextArea, TextInput } from "@/components/app/form";
import { Plus, Search, Trash2, X } from "@/components/icons";
import { Panel } from "@/components/app/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { addPostalCodes, blankService, clockLabel, dollars, hoursSummary, minuteToTime, parseDollars, serviceErrors, type HoursWindow, timeToMinute, WEEKDAYS } from "@/lib/app/settings-draft";
import { filterTimeZones, timeZoneLabel, timeZoneOptions } from "@/lib/app/timezones";
import { cn } from "@/lib/utils";

/** Save and discard for the business draft. Shared by Business details and Services & pricing. */
export function SaveBar() {
  const { canEdit, dirty, stale, problems, saving, error, notice, save, discard } = useBusinessDraft();
  return (
    <SaveArea
      canEdit={canEdit}
      dirty={dirty}
      stale={stale}
      problems={problems}
      saving={saving}
      error={error}
      notice={notice}
      onSave={() => void save()}
      onDiscard={discard}
      staleMessage="Someone else saved business settings after you started editing. Your edits are kept below, but they can't be saved over the newer version. Note anything you need, then discard to load the latest."
    />
  );
}

// ── Time zone ───────────────────────────────────────────────────────────────────────────────────────

/** A searchable list of time zones, named by their places. The stored value is the zone's identifier. */
function TimeZonePicker({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (id: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const options = useMemo(() => timeZoneOptions(value), [value]);
  const shown = useMemo(() => filterTimeZones(options, query, value), [options, query, value]);
  const regions = [...new Set(shown.map((row) => row.region))];
  if (disabled) {
    return (
      <Field label="Time zone">
        <TextInput value={timeZoneLabel(value)} disabled readOnly />
      </Field>
    );
  }
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={`${id}-select`} className="font-medium text-strong">
        Time zone
      </label>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          aria-label="Find a time zone by city or region"
          aria-controls={`${id}-select`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type a city, like Dallas or Toronto"
          className="block min-h-10 w-full rounded-t-lg border border-b-0 border-border bg-card py-2 pr-3 pl-8 text-sm text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30"
        />
      </div>
      <select
        id={`${id}-select`}
        size={6}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-hint`}
        className="block w-full -mt-1.5 rounded-b-lg border border-border bg-card px-1 py-1 text-sm text-strong focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30"
      >
        {regions.map((region) => (
          <optgroup key={region} label={region}>
            {shown
              .filter((row) => row.region === region)
              .map((row) => (
                <option key={row.id} value={row.id} className="rounded px-2 py-1">
                  {row.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <span id={`${id}-hint`} className="text-xs text-muted-foreground">
        Selected: <span className="font-medium text-strong">{timeZoneLabel(value)}</span>. Bookings, deadlines and your booking hours use this clock.
      </span>
    </div>
  );
}

// ── Service area ────────────────────────────────────────────────────────────────────────────────────

function ServiceArea() {
  const { draft, edit, canEdit } = useBusinessDraft();
  const id = useId();
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (!draft) return null;
  const add = () => {
    const result = addPostalCodes(draft.areas, typed);
    if (result.added > 0) edit((current) => ({ ...current, areas: addPostalCodes(current.areas, typed).areas }));
    setProblem(result.problems[0] ?? (result.added === 0 && typed.trim() ? "That ZIP code is already in your list." : null));
    if (result.problems.length === 0) setTyped("");
  };
  return (
    <Panel title="Service area">
      <p className="text-sm text-muted-foreground">
        {draft.areas.length === 0 ? (
          <>
            <span className="font-medium text-strong">You serve every ZIP code.</span> Add ZIP codes to only accept new bookings inside them.
          </>
        ) : (
          <>New bookings are only accepted in these ZIP codes. Bookings already made are not changed.</>
        )}
      </p>
      {draft.areas.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="ZIP codes you serve">
          {draft.areas.map((code) => (
            <li key={code} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted py-0.5 pr-1 pl-2.5 text-sm text-strong tabular-nums">
              {code}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => edit((current) => ({ ...current, areas: current.areas.filter((row) => row !== code) }))}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-card hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500"
                >
                  <X aria-hidden className="size-3.5" />
                  <span className="sr-only">Remove {code}</span>
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <div className="mt-3 grid gap-1.5 text-sm">
          <label htmlFor={`${id}-zip`} className="font-medium text-strong">
            Add ZIP codes
          </label>
          <div className="flex gap-2">
            <TextInput
              id={`${id}-zip`}
              value={typed}
              inputMode="text"
              autoComplete="off"
              placeholder="78701, 78702"
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-zip-hint${problem ? ` ${id}-zip-error` : ""}`}
              onChange={(event) => {
                setTyped(event.target.value);
                setProblem(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              className="max-w-xs"
            />
            <Button type="button" variant="secondary" size="sm" className="min-h-10" disabled={!typed.trim()} onClick={add}>
              <Plus aria-hidden className="size-4" />
              Add
            </Button>
          </div>
          {problem ? (
            <span id={`${id}-zip-error`} className="text-xs font-medium text-destructive-foreground">
              {problem}
            </span>
          ) : null}
          <span id={`${id}-zip-hint`} className="text-xs text-muted-foreground">
            Add one, or paste several separated by commas. Canadian postal codes work too.
          </span>
        </div>
      ) : null}
    </Panel>
  );
}

// ── Booking hours ───────────────────────────────────────────────────────────────────────────────────

const DEFAULT_DAY: Omit<HoursWindow, "weekday"> = { startMinute: 8 * 60, endMinute: 17 * 60 };
/** Monday first, the way a work week is read. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function TimeField({ label, minute, disabled, onChange }: { label: string; minute: number; disabled: boolean; onChange: (minute: number) => void }) {
  return (
    <TextInput
      type="time"
      aria-label={label}
      step={900}
      disabled={disabled}
      value={minute >= 1440 ? "23:59" : minuteToTime(minute)}
      onChange={(event) => {
        const next = timeToMinute(event.target.value);
        if (next !== null) onChange(next);
      }}
      className="w-[7.5rem] px-2 py-1.5 sm:w-[8.5rem] sm:px-3"
    />
  );
}

function BookingHours() {
  const { draft, edit, canEdit, saved } = useBusinessDraft();
  const name = useId();
  if (!draft || !saved) return null;
  const windows = draft.hours.map((window, index) => ({ ...window, index }));
  const setWindow = (index: number, patch: Partial<HoursWindow>) => edit((current) => ({ ...current, hours: current.hours.map((w, i) => (i === index ? { ...w, ...patch } : w)) }));
  const setMode = (mode: "any" | "set") =>
    edit((current) => ({
      ...current,
      hoursMode: mode,
      // First time setting hours: start from a normal work week instead of an empty grid.
      hours: mode === "set" && current.hours.length === 0 ? [1, 2, 3, 4, 5].map((weekday) => ({ weekday, ...DEFAULT_DAY })) : current.hours,
    }));

  if (!canEdit) {
    const lines = hoursSummary(saved.hours);
    return (
      <Panel title="Booking hours">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">Customers can book at any time. There is no company-wide limit.</p>
        ) : (
          <>
            <ul className="grid gap-1 text-sm text-strong">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Days not listed are closed for booking.</p>
          </>
        )}
      </Panel>
    );
  }

  return (
    <Panel title="Booking hours">
      <p className="mb-3 text-sm text-muted-foreground">When customers can book a cleaning. Each cleaner&apos;s own availability still applies.</p>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Booking hours</legend>
        {(
          [
            { mode: "any", title: "Customers can book at any time", detail: "No company-wide limit on days or times." },
            { mode: "set", title: "Only during the hours below", detail: "Days you leave closed can't be booked." },
          ] as const
        ).map((option) => (
          <label
            key={option.mode}
            className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500", draft.hoursMode === option.mode ? "border-brand-500/60 bg-brand-500/5" : "border-border")}
          >
            <input type="radio" name={name} className="mt-1" checked={draft.hoursMode === option.mode} onChange={() => setMode(option.mode)} />
            <span>
              <span className="block font-medium text-strong">{option.title}</span>
              <span className="block text-xs text-muted-foreground">{option.detail}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {draft.hoursMode === "set" ? (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {WEEK_ORDER.map((weekday) => {
            const day = windows.filter((w) => w.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
            const open = day.length > 0;
            return (
              <li key={weekday} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[9rem_1fr] sm:items-start">
                <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-strong">
                  <input
                    type="checkbox"
                    checked={open}
                    onChange={(event) =>
                      edit((current) => ({
                        ...current,
                        hours: event.target.checked ? [...current.hours, { weekday, ...DEFAULT_DAY }] : current.hours.filter((w) => w.weekday !== weekday),
                      }))
                    }
                  />
                  {WEEKDAYS[weekday]}
                </label>
                {open ? (
                  <div className="grid gap-2">
                    {day.map((window, position) => (
                      <div key={window.index} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="flex items-center gap-1.5">
                          <TimeField label={`${WEEKDAYS[weekday]} opens`} minute={window.startMinute} disabled={false} onChange={(minute) => setWindow(window.index, { startMinute: minute })} />
                          <span className="text-muted-foreground">to</span>
                          <TimeField label={`${WEEKDAYS[weekday]} closes`} minute={window.endMinute} disabled={false} onChange={(minute) => setWindow(window.index, { endMinute: minute })} />
                        </span>
                        {window.startMinute >= window.endMinute ? <span className="text-xs font-medium text-destructive-foreground">Closing time must be after opening time.</span> : null}
                        {day.length > 1 ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => edit((current) => ({ ...current, hours: current.hours.filter((_, i) => i !== window.index) }))}>
                            <Trash2 aria-hidden className="size-4" />
                            <span className="sr-only">
                              Remove {WEEKDAYS[weekday]} {clockLabel(window.startMinute)} to {clockLabel(window.endMinute)}
                            </span>
                          </Button>
                        ) : null}
                        {position === day.length - 1 && day.length < 4 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const last = day[day.length - 1];
                              const start = Math.min(last.endMinute + 60, 1380);
                              edit((current) => ({ ...current, hours: [...current.hours, { weekday, startMinute: start, endMinute: Math.min(start + 120, 1440) }] }));
                            }}
                          >
                            <Plus aria-hidden className="size-4" />
                            Add hours
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="flex min-h-9 items-center text-sm text-muted-foreground">Closed for booking</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {draft.hoursMode === "set" ? <p className="mt-2 text-xs text-muted-foreground">Use &ldquo;Add hours&rdquo; for a split day, like 8 AM to 12 PM and 1 PM to 5 PM. A booking must fit inside one time range; overnight bookings aren&apos;t supported.</p> : null}
    </Panel>
  );
}

/** Company name and time zone, the ZIP codes it serves, and the hours customers can book. */
export function BusinessSection() {
  const { draft, saved, canEdit, edit, unavailable } = useBusinessDraft();
  if (unavailable) return <Unavailable what="Business details" />;
  if (!draft || !saved) return <Skeleton className="h-72 rounded-2xl" />;
  const timezoneChanged = draft.timezone !== saved.timezone;
  return (
    <div className="grid gap-5">
      <Panel title="Company">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" error={canEdit && !draft.name.trim() ? "Enter your company name." : null}>
            <TextInput value={draft.name} disabled={!canEdit} onChange={(event) => edit((current) => ({ ...current, name: event.target.value }))} required />
          </Field>
          <TimeZonePicker value={draft.timezone} disabled={!canEdit} onChange={(timezone) => edit((current) => ({ ...current, timezone }))} />
        </div>
        {timezoneChanged ? (
          <p role="note" className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-strong">
            Changing the time zone keeps every booking at the same moment, so the times people see can shift. Check upcoming bookings after saving.
          </p>
        ) : null}
      </Panel>

      <ServiceArea />
      <BookingHours />
      <SaveBar />
    </div>
  );
}

// ── Services ────────────────────────────────────────────────────────────────────────────────────────

const minutesLabel = (value: string) => {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} hr ${m} min` : h ? `${h} hr` : `${m} min`;
};

const priceLabel = (value: string) => {
  if (!value.trim()) return "No starting price";
  const cents = parseDollars(value);
  return cents === null ? "—" : `From $${dollars(cents)}`;
};

/** The service catalog: a short list, with the full details opened one service at a time. */
export function ServicesSection() {
  const { draft, saved, canEdit, edit, unavailable } = useBusinessDraft();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (unavailable) return <Unavailable what="Services & pricing" />;
  if (!draft || !saved) return <Skeleton className="h-72 rounded-2xl" />;
  type Service = (typeof draft.services)[number];
  const set = (id: string, patch: Partial<Service>) => edit((current) => ({ ...current, services: current.services.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const savedIds = new Set(saved.services.map((s) => s.id));
  const active = draft.services.filter((s) => s.status === "active");
  const archived = draft.services.filter((s) => s.status === "archived");
  const visible = showArchived ? draft.services : active;

  return (
    <div className="grid gap-5">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Changes apply to new bookings. Bookings already made keep the details saved with the booking. A starting price fills in a new booking&apos;s price, and it can be changed on each booking.
      </p>

      {draft.services.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
          <p className="text-base font-semibold text-strong">No services yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Add the cleanings you offer, like a standard clean or a deep clean, so new bookings start with the right price and time.</p>
        </div>
      ) : (
        <Panel flush>
          <ul className="divide-y divide-border">
            {visible.map((service) => {
              const isOpen = openId === service.id;
              const errors = canEdit ? serviceErrors(service) : {};
              const hasErrors = Object.keys(errors).length > 0;
              const isArchived = service.status === "archived";
              return (
                <li key={service.id}>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-strong">
                        {service.name.trim() || "New service"}
                        {isArchived ? (
                          <Badge variant="outline" size="sm">
                            Archived
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm">
                            Active
                          </Badge>
                        )}
                        {hasErrors && !isOpen ? (
                          <Badge variant="error" size="sm">
                            Needs details
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                        {priceLabel(service.price)} · {minutesLabel(service.duration)} · {Number(service.crew) === 1 ? "1 cleaner" : `${service.crew || "—"} cleaners`}
                      </p>
                    </div>
                    <Button type="button" size="sm" variant={isOpen ? "secondary" : "outline"} aria-expanded={isOpen} aria-controls={`service-${service.id}`} onClick={() => setOpenId(isOpen ? null : service.id)}>
                      {isOpen ? "Done" : canEdit ? "Edit" : "View"}
                    </Button>
                  </div>
                  {isOpen ? (
                    <div id={`service-${service.id}`} className="grid gap-4 border-t border-border bg-muted/30 px-4 py-4 sm:grid-cols-2 sm:px-5">
                      <Field label="Service name" error={errors.name}>
                        <TextInput value={service.name} disabled={!canEdit} placeholder="Standard clean" onChange={(event) => set(service.id, { name: event.target.value })} />
                      </Field>
                      <Field label="Starting price ($)" hint="Optional. Leave empty if you price each job yourself." error={errors.price}>
                        <TextInput inputMode="decimal" value={service.price} disabled={!canEdit} placeholder="150.00" onChange={(event) => set(service.id, { price: event.target.value })} />
                      </Field>
                      <Field label="How long it takes (minutes)" hint={`About ${minutesLabel(service.duration)}.`} error={errors.duration}>
                        <TextInput inputMode="numeric" value={service.duration} disabled={!canEdit} onChange={(event) => set(service.id, { duration: event.target.value })} />
                      </Field>
                      <Field label="Cleaners needed" error={errors.crew}>
                        <TextInput inputMode="numeric" value={service.crew} disabled={!canEdit} onChange={(event) => set(service.id, { crew: event.target.value })} />
                      </Field>
                      <Field label="What the crew does" className="sm:col-span-2" hint="Cleaners see this when they accept the job." error={errors.scope}>
                        <TextArea value={service.scope} disabled={!canEdit} placeholder="Kitchen, bathrooms, dusting, vacuum and mop all floors." onChange={(event) => set(service.id, { scope: event.target.value })} />
                      </Field>
                      <Field label="Skills a cleaner needs" className="sm:col-span-2" hint="Optional. Separate with commas. Only cleaners with every skill listed are offered the job.">
                        <TextInput value={service.skills} disabled={!canEdit} placeholder="deep clean, pets" onChange={(event) => set(service.id, { skills: event.target.value })} />
                      </Field>
                      {canEdit ? (
                        <div className="flex flex-wrap gap-2 sm:col-span-2">
                          {savedIds.has(service.id) ? (
                            <Button type="button" size="sm" variant="outline" onClick={() => set(service.id, { status: isArchived ? "active" : "archived" })}>
                              {isArchived ? "Make active again" : "Archive this service"}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                edit((current) => ({ ...current, services: current.services.filter((s) => s.id !== service.id) }));
                                setOpenId(null);
                              }}
                            >
                              <Trash2 aria-hidden className="size-4" />
                              Remove this new service
                            </Button>
                          )}
                          {savedIds.has(service.id) ? <p className="self-center text-xs text-muted-foreground">{isArchived ? "Archived services can't be chosen for new bookings." : "Archiving hides it from new bookings. Past bookings keep it."}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {archived.length > 0 ? (
            <div className="border-t border-border px-4 py-2.5 sm:px-5">
              <button type="button" onClick={() => setShowArchived((value) => !value)} className="text-sm font-medium text-brand-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500" aria-expanded={showArchived}>
                {showArchived ? "Hide archived services" : `Show ${archived.length} archived service${archived.length === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
        </Panel>
      )}

      {canEdit ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              const service = blankService();
              edit((current) => ({ ...current, services: [...current.services, service] }));
              setOpenId(service.id);
            }}
          >
            <Plus aria-hidden className="size-4" />
            Add a service
          </Button>
        </div>
      ) : null}
      <SaveBar />
    </div>
  );
}
