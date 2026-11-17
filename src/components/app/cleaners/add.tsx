"use client";

import { useMutation } from "convex/react";
import { useState } from "react";

import { list, Submit } from "@/components/app/cleaners/forms";
import { Avatar } from "@/components/app/cleaners/shared";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { TriangleAlert } from "@/components/icons";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const minutesOf = (time: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

type Match = { cleanerId: Id<"cleaners">; name: string; initials: string; status: string; engagement: string; reasons: string[] };

function Form({ subcontractors, onDone, onAdded }: { subcontractors: { id: Id<"subcontractors">; name: string; status: string }[]; onDone: () => void; onAdded: (cleanerId: Id<"cleaners">) => void }) {
  const { companyId, timezone } = useCompany();
  const add = useMutation(api.workforce.add);
  const { busy, error, run, setError } = useRun();
  // One key for this add, so a double click or a retry makes one record.
  const [addKey] = useState(newKey);
  const [form, setForm] = useState({ name: "", preferredName: "", engagement: "contractor" as "contractor" | "employee" | "subcontracted", subcontractorId: "", phone: "", email: "", skills: "", areas: "", from: "", to: "" });
  const [days, setDays] = useState<number[]>([]);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [different, setDifferent] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
    // Changing who this is means the duplicate check has to run again.
    if (["name", "phone", "email"].includes(key)) {
      setMatches(null);
      setDifferent(false);
    }
  };
  const active = subcontractors.filter((row) => row.status === "active");

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const [startMinute, endMinute] = [minutesOf(form.from), minutesOf(form.to)];
        if (days.length > 0 && (startMinute === null || endMinute === null || startMinute >= endMinute)) return setError("Give the hours for the chosen days, with the start before the end.");
        void run(async () => {
          const result = await add({
            companyId,
            addKey,
            name: form.name,
            preferredName: form.preferredName || undefined,
            engagement: form.engagement,
            subcontractorId: form.engagement === "subcontracted" && form.subcontractorId ? (form.subcontractorId as Id<"subcontractors">) : undefined,
            phone: form.phone || undefined,
            email: form.email || undefined,
            skills: list(form.skills),
            serviceAreas: list(form.areas),
            windows: days.length > 0 && startMinute !== null && endMinute !== null ? days.map((weekday) => ({ weekday, startMinute, endMinute })) : undefined,
            acknowledged: different && matches ? matches.map((match) => match.cleanerId) : undefined,
          });
          if (result.status === "possible_duplicates") {
            setMatches(result.matches);
            return;
          }
          onAdded(result.cleanerId);
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
        <Field label="Worker type" hint="What you agreed with them. Selestial records it and never decides it.">
          <SelectInput value={form.engagement} onChange={set("engagement")}>
            <option value="contractor">Independent contractor</option>
            <option value="employee">Employee</option>
            <option value="subcontracted">Supplied by a subcontractor company</option>
          </SelectInput>
        </Field>
        {form.engagement === "subcontracted" ? (
          <Field label="Subcontractor company" hint={active.length === 0 ? "Add the company first, under Subcontractors." : undefined}>
            <SelectInput value={form.subcontractorId} onChange={set("subcontractorId")} required>
              <option value="">Choose a company</option>
              {active.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : (
          <span className="hidden sm:block" />
        )}
        <Field label="Mobile number (optional)" hint="Offers and reminders are texted here.">
          <TextInput type="tel" value={form.phone} onChange={set("phone")} autoComplete="off" />
        </Field>
        <Field label="Email (optional)">
          <TextInput type="email" value={form.email} onChange={set("email")} autoComplete="off" />
        </Field>
      </div>
      <Field label="Postal codes they work in (optional)" hint="Separate with commas. Visits elsewhere are not offered to them.">
        <TextInput value={form.areas} onChange={set("areas")} />
      </Field>
      <Field label="Skills (optional)" hint="Separate with commas.">
        <TextInput value={form.skills} onChange={set("skills")} />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-strong">Days they said they can work (optional)</legend>
        <p className="text-xs text-muted-foreground">Only what they told you, on your company&apos;s clock ({timezone}). More detail can be added on their profile.</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DAYS.map((day, index) => {
            const on = days.includes(index);
            return (
              <button key={day} type="button" aria-pressed={on} onClick={() => setDays((current) => (on ? current.filter((value) => value !== index) : [...current, index].sort()))} className={cn("min-h-9 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500", on ? "border-brand-500/60 bg-brand-500/10 text-strong" : "border-border bg-background text-muted-foreground")}>
                {day}
              </button>
            );
          })}
        </div>
      </fieldset>
      {days.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <TextInput type="time" value={form.from} onChange={set("from")} required />
          </Field>
          <Field label="Until">
            <TextInput type="time" value={form.to} onChange={set("to")} required />
          </Field>
        </div>
      ) : null}

      {matches && matches.length > 0 ? (
        <div role="alert" className="grid gap-2 rounded-xl border border-warning/50 bg-warning/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-strong">
            <TriangleAlert className="size-4 text-warning-foreground" aria-hidden />
            {matches.length === 1 ? "This may be someone already on record" : `This may be one of ${matches.length} people already on record`}
          </p>
          <ul className="grid gap-1.5">
            {matches.map((match) => (
              <li key={match.cleanerId} className="flex items-center gap-2.5 rounded-lg bg-card px-2.5 py-2">
                <Avatar initials={match.initials} seed={match.cleanerId} size="sm" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block font-medium text-strong">{match.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {match.engagement} · {match.status} · {match.reasons.join(", ")}
                  </span>
                </span>
                <a href={`/app/cleaners/${match.cleanerId}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                  Open
                </a>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm text-strong">
            <input type="checkbox" checked={different} onChange={(event) => setDifferent(event.target.checked)} className="mt-1 size-4 accent-[var(--color-brand-500)]" />
            <span>
              This is a different person
              <span className="block text-xs text-muted-foreground">Nothing is merged. Both records are kept separately.</span>
            </span>
          </label>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">They start in onboarding. Nobody is offered work until a person makes them active and their hours, areas and pay are set.</p>
      <FormError message={error} />
      <Submit busy={busy} label={matches && matches.length > 0 ? "Add as a new person" : "Add cleaner"} onCancel={onDone} disabled={Boolean(matches && matches.length > 0 && !different)} />
    </form>
  );
}

export function AddCleaner({ open, onClose, subcontractors, onAdded }: { open: boolean; onClose: () => void; subcontractors: { id: Id<"subcontractors">; name: string; status: string }[]; onAdded: (cleanerId: Id<"cleaners">) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Add a cleaner" description="Checked against everyone on record before anything is added.">
      <Form subcontractors={subcontractors} onDone={onClose} onAdded={onAdded} />
    </Modal>
  );
}
