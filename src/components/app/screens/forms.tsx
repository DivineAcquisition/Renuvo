"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { AddressField } from "@/components/app/address-field";
import { Guard } from "@/components/app/settings/guard";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { centsFrom, zonedInstant } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

const KINDS = [
  { id: "home", label: "Home" },
  { id: "short_term_rental", label: "Short-term rental" },
  { id: "property_manager", label: "Property manager" },
  { id: "commercial", label: "Office or commercial" },
] as const;
type Kind = (typeof KINDS)[number]["id"];

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

function Submit({ busy, label, onCancel }: { busy: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex gap-2 pt-1">
      <Button type="submit" variant="primary" loading={busy}>
        {label}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/** A customer and their first property, saved together so a visit can be scheduled straight away. */
export function NewCustomerForm({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const createCustomer = useMutation(api.customers.create);
  const createProperty = useMutation(api.properties.create);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ name: "", kind: "home" as Kind, email: "", phone: "", line1: "", line2: "", city: "", region: "", postalCode: "", access: "" });
  // The place picked from address search. Typing in the street field afterwards drops it, so a changed
  // address never keeps the old map location.
  const [place, setPlace] = useState<{ placeId: string; lat?: number; lng?: number } | null>(null);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const customerId = await createCustomer({ companyId, name: form.name, kind: form.kind, email: form.email || undefined, phone: form.phone || undefined });
          await createProperty({
            companyId,
            customerId,
            kind: form.kind,
            address: { line1: form.line1, line2: form.line2 || undefined, city: form.city, region: form.region, postalCode: form.postalCode, ...(place ?? {}) },
            accessInstructions: form.access || undefined,
          });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} />
        </Field>
        <Field label="Kind of work">
          <SelectInput value={form.kind} onChange={set("kind")}>
            {KINDS.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Email (optional)">
          <TextInput type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Phone (optional)">
          <TextInput type="tel" value={form.phone} onChange={set("phone")} />
        </Field>
      </div>
      <AddressField
        label="Property address"
        value={form.line1}
        required
        onChange={(line1) => {
          setPlace(null);
          setForm((current) => ({ ...current, line1 }));
        }}
        onPick={({ placeId, lat, lng, ...picked }) => {
          setPlace({ placeId, lat, lng });
          setForm((current) => ({ ...current, line1: picked.line1, line2: picked.line2 ?? "", city: picked.city, region: picked.region, postalCode: picked.postalCode }));
        }}
      />
      {form.line2 ? (
        <Field label="Unit">
          <TextInput value={form.line2} onChange={set("line2")} autoComplete="address-line2" />
        </Field>
      ) : null}
      <div className="grid grid-cols-3 gap-3">
        <Field label="City">
          <TextInput value={form.city} onChange={set("city")} required />
        </Field>
        <Field label="State">
          <TextInput value={form.region} onChange={set("region")} required />
        </Field>
        <Field label="Postal code">
          <TextInput value={form.postalCode} onChange={set("postalCode")} required />
        </Field>
      </div>
      <Field label="Access instructions (optional)" hint="Door codes, parking, pets. Cleaners see this with the visit.">
        <TextArea value={form.access} onChange={set("access")} rows={2} />
      </Field>
      <FormError message={error} />
      <Submit busy={busy} label="Add customer" onCancel={onDone} />
    </form>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const minutesOf = (time: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** A cleaner with the hours they said they can work. Nobody is offered a visit outside those hours. */
export function NewCleanerForm({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.cleaners.create);
  const setWeek = useMutation(api.availability.setWeek);
  const setStatus = useMutation(api.cleaners.setStatus);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState({ name: "", engagement: "contractor" as "contractor" | "employee", phone: "", skills: "", areas: "", from: "", to: "" });
  const [days, setDays] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const [startMinute, endMinute] = [minutesOf(form.from), minutesOf(form.to)];
        // Hours are recorded only as the cleaner gave them. With no days chosen, none are recorded.
        if (days.length > 0 && (startMinute === null || endMinute === null || startMinute >= endMinute)) return setError("Give the hours for the chosen days, with the start before the end.");
        void run(async () => {
          const cleanerId = await create({ companyId, name: form.name, engagement: form.engagement, phone: form.phone || undefined, skills: list(form.skills), serviceAreas: list(form.areas) });
          if (days.length > 0 && startMinute !== null && endMinute !== null) await setWeek({ companyId, cleanerId, windows: days.map((weekday) => ({ weekday, startMinute, endMinute })) });
          if (ready) await setStatus({ companyId, cleanerId, status: "ready" });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} />
        </Field>
        <Field label="Works as">
          <SelectInput value={form.engagement} onChange={set("engagement")}>
            <option value="contractor">Contractor, paid a share of the job</option>
            <option value="employee">Employee, paid hourly</option>
          </SelectInput>
        </Field>
        <Field label="Phone (optional)">
          <TextInput type="tel" value={form.phone} onChange={set("phone")} />
        </Field>
        <Field label="Skills (optional)" hint="Separate with commas.">
          <TextInput value={form.skills} onChange={set("skills")} />
        </Field>
      </div>
      <Field label="Postal codes they work in" hint="Separate with commas. Dispatch only offers visits in these areas.">
        <TextInput value={form.areas} onChange={set("areas")} />
      </Field>
      <fieldset>
        <legend className="text-sm font-medium text-strong">Days they said they can work</legend>
        <p className="text-xs text-muted-foreground">Choose only what the cleaner told you. With none chosen, no hours are recorded and they cannot be offered visits yet.</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DAYS.map((day, index) => {
            const on = days.includes(index);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => setDays((current) => (on ? current.filter((value) => value !== index) : [...current, index].sort()))}
                className={`min-h-9 rounded-lg border px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-500 ${on ? "border-brand-500/60 bg-brand-500/10 text-strong" : "border-border bg-background text-muted-foreground"}`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <TextInput type="time" value={form.from} onChange={set("from")} required={days.length > 0} />
        </Field>
        <Field label="Until">
          <TextInput type="time" value={form.to} onChange={set("to")} required={days.length > 0} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm text-strong">
        <input type="checkbox" checked={ready} onChange={(event) => setReady(event.target.checked)} className="mt-1 size-4 accent-[var(--color-brand-400)]" />
        <span>
          Ready for work now
          <span className="block text-xs text-muted-foreground">Only a cleaner a person marked ready is offered visits.</span>
        </span>
      </label>
      <FormError message={error} />
      <Submit busy={busy} label="Add cleaner" onCancel={onDone} />
    </form>
  );
}

function PropertySelect({ customerId, value, onChange }: { customerId: Id<"customers">; value: string; onChange: (value: string) => void }) {
  const { companyId } = useCompany();
  const found = useQuery(api.customers.get, { companyId, customerId });
  return (
    <SelectInput value={value} onChange={(event) => onChange(event.target.value)} required disabled={!found}>
      <option value="">{found ? "Choose a property" : "Loading…"}</option>
      {found?.properties.map((property) => (
        <option key={property._id} value={property._id}>
          {property.label ?? `${property.address.line1}, ${property.address.city}`}
        </option>
      ))}
    </SelectInput>
  );
}

type Template = { id: string; name: string; scope: string; skills: string[]; startingPriceCents?: number; durationMinutes: number; defaultCrew: number };

/** The service templates from Settings. Reading them is optional: if they cannot be read, visits are made by typing, as before. */
function TemplateField({ serviceId, onChoose }: { serviceId: string; onChoose: (template: Template | null) => void }) {
  const { companyId } = useCompany();
  const business = useQuery(api.settings.business, { companyId });
  const templates = (business?.services ?? []).filter((service) => service.status === "active");
  if (templates.length === 0) return null;
  const template = templates.find((service) => service.id === serviceId);
  return (
    <Field label="Service template" hint={template ? `${template.durationMinutes} minutes, ${template.defaultCrew} ${template.defaultCrew === 1 ? "cleaner" : "cleaners"}. Fields below can still be changed.` : "Optional. Fills the fields below from Settings."}>
      <SelectInput value={serviceId} onChange={(event) => onChoose(templates.find((service) => service.id === event.target.value) ?? null)}>
        <option value="">No template</option>
        {templates.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}

/** A visit for a customer at one of their properties, on the company's clock. */
export function NewVisitForm({ onDone }: { onDone: () => void }) {
  const { companyId, timezone } = useCompany();
  const customers = useQuery(api.customers.list, { companyId });
  const create = useMutation(api.jobs.create);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState({ customerId: "", propertyId: "", serviceId: "", duration: 0, serviceType: "", scope: "", skills: "", date: "", from: "", to: "", price: "", crew: "1", arrival: "0", deadlineDate: "", deadlineTime: "", instructions: "" });
  /** Fills the fields from the template. Everything stays editable; the visit keeps a copy of the template as it is now. */
  const choose = (picked: Template | null) =>
    setForm((current) =>
      picked
        ? { ...current, serviceId: picked.id, duration: picked.durationMinutes, serviceType: picked.name, scope: picked.scope, skills: picked.skills.join(", "), crew: String(picked.defaultCrew), price: picked.startingPriceCents === undefined ? "" : (picked.startingPriceCents / 100).toFixed(2) }
        : { ...current, serviceId: "", duration: 0 },
    );
  /** With a template chosen, the end follows the start by the template's duration. */
  const startAt = (from: string) =>
    setForm((current) => {
      const [hours, minutes] = from.split(":").map(Number);
      if (!current.duration || Number.isNaN(hours) || Number.isNaN(minutes)) return { ...current, from };
      const end = hours * 60 + minutes + current.duration;
      return end < 24 * 60 ? { ...current, from, to: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` } : { ...current, from };
    });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  if (customers && customers.length === 0) return <p className="text-sm text-muted-foreground">Add a customer under Customers & Properties first, then schedule their visit here.</p>;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const [startsAt, endsAt] = [zonedInstant(form.date, form.from, timezone), zonedInstant(form.date, form.to, timezone)];
        if (startsAt === null || endsAt === null) return setError("Choose the day, the start time and the end time.");
        const priceCents = form.price.trim() ? centsFrom(form.price) : undefined;
        if (priceCents === null) return setError("Enter the price as an amount in dollars and cents, or leave it empty.");
        const [requiredCrew, arrivalWindowMinutes] = [Number(form.crew), Number(form.arrival || "0")];
        if (!Number.isInteger(requiredCrew) || requiredCrew < 1 || requiredCrew > 12) return setError("Cleaners needed is a whole number from 1 to 12.");
        if (!Number.isInteger(arrivalWindowMinutes) || arrivalWindowMinutes < 0) return setError("The arrival window is a whole number of minutes. Use 0 for an exact arrival time.");
        const wantsDeadline = Boolean(form.deadlineDate || form.deadlineTime);
        const hardDeadlineAt = wantsDeadline ? zonedInstant(form.deadlineDate, form.deadlineTime, timezone) : undefined;
        if (hardDeadlineAt === null) return setError("Give both the day and the time the service must be finished by, or leave both empty.");
        void run(async () => {
          await create({
            companyId,
            customerId: form.customerId as Id<"customers">,
            propertyId: form.propertyId as Id<"properties">,
            ...(form.serviceId ? { serviceId: form.serviceId } : {}),
            serviceType: form.serviceType,
            scope: form.scope,
            requiredSkills: list(form.skills),
            priceCents,
            startsAt,
            endsAt,
            requiredCrew,
            arrivalWindowMinutes,
            hardDeadlineAt,
            instructions: form.instructions.trim() || undefined,
          });
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer">
          <SelectInput value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value, propertyId: "" }))} required>
            <option value="">{customers ? "Choose a customer" : "Loading…"}</option>
            {customers?.map((customer) => (
              <option key={customer._id} value={customer._id}>
                {customer.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Property">
          {form.customerId ? (
            <PropertySelect customerId={form.customerId as Id<"customers">} value={form.propertyId} onChange={(propertyId) => setForm((current) => ({ ...current, propertyId }))} />
          ) : (
            <SelectInput disabled>
              <option>Choose a customer first</option>
            </SelectInput>
          )}
        </Field>
        <Guard fallback={() => null}>
          <TemplateField serviceId={form.serviceId} onChoose={choose} />
        </Guard>
        <Field label="Service">
          <TextInput value={form.serviceType} onChange={set("serviceType")} required maxLength={80} />
        </Field>
        <Field label="Price (optional)" hint="The price of the service. It is not a payment.">
          <TextInput inputMode="decimal" value={form.price} onChange={set("price")} placeholder="0.00" />
        </Field>
      </div>
      <Field label="Scope" hint="What the cleaner will be told to do.">
        <TextArea value={form.scope} onChange={set("scope")} required rows={2} />
      </Field>
      <Field label="Skills needed (optional)" hint="Separate with commas. Only cleaners with these skills can be offered the visit.">
        <TextInput value={form.skills} onChange={set("skills")} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Day">
          <TextInput type="date" value={form.date} onChange={set("date")} required />
        </Field>
        <Field label="Starts">
          <TextInput type="time" value={form.from} onChange={(event) => startAt(event.target.value)} required />
        </Field>
        <Field label="Ends">
          <TextInput type="time" value={form.to} onChange={set("to")} required />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cleaners needed" hint="The visit is staffed only when this many have accepted.">
          <TextInput inputMode="numeric" value={form.crew} onChange={set("crew")} required />
        </Field>
        <Field label="Arrival window, minutes" hint="0 means arrive at the start time. 30 means any time in the half hour after it.">
          <TextInput inputMode="numeric" value={form.arrival} onChange={set("arrival")} />
        </Field>
        <Field label="Must be finished by, day (optional)" hint="For example a guest check-in.">
          <TextInput type="date" value={form.deadlineDate} onChange={set("deadlineDate")} />
        </Field>
        <Field label="Must be finished by, time">
          <TextInput type="time" value={form.deadlineTime} onChange={set("deadlineTime")} />
        </Field>
      </div>
      <Field label="Instructions for the crew (optional)" hint="What the crew needs to know that is not the scope. A cleaner sees it only after they accept.">
        <TextArea value={form.instructions} onChange={set("instructions")} rows={2} maxLength={4000} />
      </Field>
      <p className="text-xs text-muted-foreground">Times are on the company’s clock ({timezone}). A new visit has no cleaner until one accepts it.</p>
      <FormError message={error} />
      <Submit busy={busy} label="Schedule the visit" onCancel={onDone} />
    </form>
  );
}
