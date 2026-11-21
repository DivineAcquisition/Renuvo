"use client";

/**
 * Adding one person. As the name, phone and email are typed, people already in the record who may be the
 * same person are shown, with a way to open them instead. Adding a second record anyway needs a reason.
 */
import { useMutation, useQuery } from "convex/react";
import { useDeferredValue, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { Engagement } from "./bits";
import { profilePath } from "./state";
import { ChoiceChips, SelectionCards } from "@/components/ui/selection";
import { EmailInput, PhoneInput } from "@/components/ui/fields";

const TYPES: { value: Engagement; label: string; help: string }[] = [
  { value: "employee", label: "Employee", help: "On your payroll." },
  { value: "contractor", label: "Independent contractor", help: "Works for themselves." },
  { value: "subcontractor", label: "Subcontractor worker", help: "Supplied by another company." },
];
const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];
const list = (value: string) => value.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);
const minutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

export function AddCleanerDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (cleanerId: Id<"cleaners">) => void }) {
  const { companyId } = useCompany();
  const add = useMutation(api.workforce.add);
  const subs = useQuery(api.subcontractors.list, { companyId });
  const createSub = useMutation(api.subcontractors.create);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ name: "", engagement: "contractor" as Engagement, phone: "", email: "", areas: "", skills: "", subcontractorId: "", newSub: "", newSubContact: "" });
  const [days, setDays] = useState<number[]>([]);
  const [hours, setHours] = useState({ from: "08:00", to: "17:00" });
  const [different, setDifferent] = useState("");
  const deferred = useDeferredValue({ name: form.name, phone: form.phone, email: form.email });
  const matches = useQuery(api.workforce.possibleDuplicates, deferred.name.trim().length >= 2 || deferred.phone.trim().length >= 7 || deferred.email.includes("@") ? { companyId, name: deferred.name, phone: deferred.phone || undefined, email: deferred.email || undefined } : "skip");
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value });
  const strong = matches?.some((match) => match.strong) ?? false;
  const needsReason = (matches?.length ?? 0) > 0;
  const hoursValid = days.length === 0 || minutes(hours.from) < minutes(hours.to);

  return (
    <Modal open onClose={onClose} title="Add cleaner" description="They start in onboarding with your checklist. Nobody is offered work until a person makes them active and every requirement for work is met.">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            let subcontractorId = form.subcontractorId as Id<"subcontractors"> | "";
            if (form.engagement === "subcontractor" && form.subcontractorId === "new") {
              subcontractorId = await createSub({ companyId, name: form.newSub, contact: { name: form.newSubContact || form.newSub } });
            }
            const { cleanerId } = await add({
              companyId,
              person: {
                name: form.name,
                engagement: form.engagement,
                phone: form.phone || undefined,
                email: form.email || undefined,
                serviceAreas: list(form.areas),
                skills: list(form.skills),
                subcontractorId: form.engagement === "subcontractor" && subcontractorId ? subcontractorId : undefined,
              },
              windows: days.map((weekday) => ({ weekday, startMinute: minutes(hours.from), endMinute: minutes(hours.to) })),
              notDuplicateBecause: needsReason ? different || undefined : undefined,
            });
            onAdded(cleanerId);
          });
        }}
      >
        <Field label="Full name">
          <TextInput value={form.name} onChange={set("name")} required autoComplete="off" autoFocus />
        </Field>

        <Field label="How they work with you">
          <SelectionCards type="single" columns={3} name="engagement" value={form.engagement} onValueChange={(engagement) => setForm({ ...form, engagement })} options={TYPES.map((type) => ({ value: type.value, label: type.label, description: type.help }))} />
        </Field>

        {form.engagement === "subcontractor" ? (
          <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <Field label="Subcontractor company" hint="Jobs still go to this person by name; the company is who they work through.">
              <SelectInput value={form.subcontractorId} onChange={set("subcontractorId")} required>
                <option value="">Choose…</option>
                {subs
                  ?.filter((sub) => sub.status !== "ended")
                  .map((sub) => (
                    <option key={sub.subcontractorId} value={sub.subcontractorId}>
                      {sub.name}
                    </option>
                  ))}
                <option value="new">Add a new subcontractor company…</option>
              </SelectInput>
            </Field>
            {form.subcontractorId === "new" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company name">
                  <TextInput value={form.newSub} onChange={set("newSub")} required />
                </Field>
                <Field label="Authorized contact">
                  <TextInput value={form.newSubContact} onChange={set("newSubContact")} placeholder="Who speaks for the company" />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Mobile phone" hint="Used for offers and reminders once they agree to texts.">
            <PhoneInput value={form.phone} onChange={(text) => set("phone")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} autoComplete="off" />
          </Field>
          <Field label="Email">
            <EmailInput value={form.email} onChange={(text) => set("email")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} autoComplete="off" />
          </Field>
        </div>

        {matches && matches.length > 0 ? (
          <div className={cn("grid gap-2 rounded-xl border px-3 py-2.5", strong ? "border-warning/60 bg-warning/8" : "border-border bg-muted/40")} role="status">
            <p className="flex items-center gap-2 text-sm font-medium text-strong">
              <TriangleAlert className="size-4 text-warning-foreground" aria-hidden />
              {strong ? "This may be someone already in the record" : "Someone with a similar name is already here"}
            </p>
            <ul className="grid gap-1 text-sm">
              {matches.map((match) => (
                <li key={match.cleanerId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium text-strong">{match.name}</span> <span className="text-xs text-muted-foreground">({match.why})</span>
                  </span>
                  <a href={profilePath(match.cleanerId)} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline">
                    Open them instead
                  </a>
                </li>
              ))}
            </ul>
            <Field label="If this is a different person, say how you know">
              <TextArea value={different} onChange={(event) => setDifferent(event.target.value)} rows={2} placeholder="For example: her daughter, who shares the family phone." />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service areas" hint="Postal codes, separated by commas.">
            <TextInput value={form.areas} onChange={set("areas")} placeholder="78701, 78702" />
          </Field>
          <Field label="Confirmed skills" hint="Optional. Only what you have confirmed.">
            <TextInput value={form.skills} onChange={set("skills")} placeholder="deep clean, windows" />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">Weekly hours they said they can work</legend>
          <p className="-mt-1 text-xs text-muted-foreground">Optional now. They can give or confirm these from their portal later.</p>
          <ChoiceChips aria-label="Days" density="compact" options={DAYS.map((day) => ({ value: String(day.value), label: day.label }))} value={days.map(String)} onValueChange={(next) => setDays(DAYS.filter((day) => next.includes(String(day.value))).map((day) => day.value))} />
          {days.length > 0 ? (
            <div className="grid max-w-xs grid-cols-2 gap-2">
              <Field label="From">
                <TextInput type="time" value={hours.from} onChange={(event) => setHours({ ...hours, from: event.target.value })} />
              </Field>
              <Field label="To" error={hoursValid ? null : "Ends before it starts"}>
                <TextInput type="time" value={hours.to} onChange={(event) => setHours({ ...hours, to: event.target.value })} />
              </Field>
            </div>
          ) : null}
        </fieldset>

        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!hoursValid || (needsReason && strong && !different.trim())}>
            Add cleaner
          </Button>
        </div>
      </form>
    </Modal>
  );
}
