"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { AddressField } from "@/components/app/address-field";
import { Guard } from "@/components/app/settings/guard";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { centsFrom, zonedInstant } from "@/lib/app/format";

import { defaultInput, JobInputs, QuoteLines } from "@/components/app/services/preview";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { quote as runQuote, type PropertyExtra, type QuoteInput } from "../../../../convex/lib/services/engine";
import type { Spec } from "../../../../convex/lib/services/spec";
import { visitScope } from "../../../../convex/lib/services/operations";
import { lowerFirst } from "../../../../convex/lib/services/words";
import { Checkbox, ChoiceChips, customerOption, propertyOption, SearchableSelect, serviceOption } from "@/components/ui/selection";
import { markComposite } from "@/components/ui/selection/field-context";
import { AssistedTextArea, CountField, DurationField, EmailInput, PhoneInput, organizeIntoSteps, type WritingAction } from "@/components/ui/fields";

const STEPS: WritingAction[] = [{ id: "steps", label: "Organize into steps", kind: "template", run: organizeIntoSteps }];

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
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    // A changed city, state or ZIP no longer matches the picked map location, so it is dropped.
    if (key === "city" || key === "region" || key === "postalCode") setPlace(null);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };
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
          <EmailInput value={form.email} onChange={(text) => set("email")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
        </Field>
        <Field label="Phone (optional)">
          <PhoneInput value={form.phone} onChange={(text) => set("phone")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
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
          setForm((current) => ({ ...current, line1: picked.line1, line2: picked.line2 || current.line2, city: picked.city, region: picked.region, postalCode: picked.postalCode }));
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
          <PhoneInput value={form.phone} onChange={(text) => set("phone")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
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
        <ChoiceChips className="mt-1.5" aria-label="Days they said they can work" density="compact" options={DAYS.map((day, index) => ({ value: String(index), label: day }))} value={days.map(String)} onValueChange={(next) => setDays(next.map(Number).sort((a, b) => a - b))} />
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
        <Checkbox checked={ready} onCheckedChange={(checked) => setReady(checked)} className="mt-1" />
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
    <SearchableSelect value={value} onValueChange={(next) => onChange(next ?? "")} options={(found?.properties ?? []).map((property) => propertyOption(property))} loading={found === undefined} placeholder="Search this customer's properties" emptyText="This customer has no properties yet. Add one on their profile." required />
  );
}
// Its SearchableSelect names itself from the Field, so the Field must not wrap it in a label.
markComposite(PropertySelect);

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
      <SearchableSelect value={serviceId} onValueChange={(next) => onChoose(templates.find((service) => service.id === next) ?? null)} options={templates.map(serviceOption)} placeholder="No template" />
    </Field>
  );
}

type Live = { key: string; name: string; version: number; spec: Spec };

/**
 * The company's live services, from Services & Pricing. Choosing one fills the visit from its published
 * version and prices it with the pricing engine from the job's facts. Until the Owner's services move out
 * of Settings, the old templates still serve.
 */
function ServiceField({ value, onChoose, onLegacy }: { value: string; onChoose: (service: Live | null) => void; onLegacy: (template: Template | null) => void }) {
  const { companyId } = useCompany();
  const data = useQuery(api.services.studio, { companyId });
  const catalog = useQuery(api.services.catalog, { companyId });
  const live = (data?.services ?? []).filter((s) => s.live).map((s) => ({ key: s.key, name: s.name, version: s.live!.version, spec: s.live!.spec }));
  if (live.length === 0) return catalog && catalog.legacyWaiting > 0 ? <TemplateField serviceId={value} onChoose={onLegacy} /> : null;
  const picked = live.find((s) => s.key === value);
  return (
    <Field label="Service" hint={picked ? `Live version ${picked.version} from Services & Pricing. Its scope, crew and price are filled in; the visit keeps this version.` : "From Services & Pricing. Or leave it and type the service below."}>
      <SelectInput value={value} onChange={(event) => onChoose(live.find((s) => s.key === event.target.value) ?? null)}>
        <option value="">Type it instead</option>
        {live.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}

/** A visit for a customer at one of their properties, on the company's clock. */
export function NewVisitForm({ onDone, initial }: { onDone: () => void; initial?: { customerId?: string; propertyId?: string } }) {
  const { companyId, timezone } = useCompany();
  const customers = useQuery(api.customers.list, { companyId });
  const create = useMutation(api.jobs.create);
  const { busy, error, run, setError } = useRun();
  const [form, setForm] = useState({ customerId: initial?.customerId ?? "", propertyId: initial?.propertyId ?? "", serviceId: "", duration: 0, serviceType: "", scope: "", skills: "", date: "", from: "", to: "", price: "", crew: "1", arrival: "0", deadlineDate: "", deadlineTime: "", instructions: "" });
  /** A service from Services & Pricing, the job's facts for its price, and whether the person typed their own price. */
  const [service, setService] = useState<Live | null>(null);
  const [facts, setFacts] = useState<QuoteInput>({});
  const [typedPrice, setTypedPrice] = useState(false);
  // The property's own price, when the Owner approved one for this service. The server looks it up again when the visit is made.
  const own = useQuery(api.propertyPrices.forVisit, service && form.propertyId ? { companyId, serviceKey: service.key, propertyId: form.propertyId as Id<"properties">, ...(form.date ? { day: form.date } : {}) } : "skip");
  const ownPrice = own?.price ?? null;
  const [ownId, ownBase, ownMinutes, ownExtras] = [ownPrice?.id, ownPrice?.baseCents, ownPrice?.laborMinutes, JSON.stringify(ownPrice?.extras ?? [])];
  const propertyPrice = useMemo(() => (ownId !== undefined && ownBase !== undefined ? { id: ownId, baseCents: ownBase, laborMinutes: ownMinutes ?? null, extras: JSON.parse(ownExtras) as PropertyExtra[] } : undefined), [ownId, ownBase, ownMinutes, ownExtras]);
  const priced = useMemo(() => (service ? runQuote(service.spec, { ...facts, ...(form.date ? { date: form.date } : {}), ...(propertyPrice ? { propertyPrice } : {}) }) : null), [service, facts, form.date, propertyPrice]);
  // How long the visit runs: the engine's time for this job (a property's own cleaner time included), else what was chosen.
  const visitMinutes = service && priced && priced.time.elapsedMinutes > 0 ? priced.time.elapsedMinutes : form.duration;
  const engineTotal = priced && (priced.outcome === "firm" || priced.outcome === "estimate") ? priced.totalCents : null;
  const pick = (next: Live | null) => {
    setService(next);
    setTypedPrice(false);
    if (!next) return setForm((current) => ({ ...current, serviceId: "", duration: 0 }));
    const input = defaultInput(next.spec);
    const start = { ...(input.answers ? { answers: input.answers } : {}), ...(next.spec.str?.enabled ? { beds: input.beds } : {}) };
    setFacts(start);
    const first = runQuote(next.spec, start);
    setForm((current) => ({ ...current, serviceId: next.key, duration: first.time.elapsedMinutes || 0, serviceType: next.spec.name, scope: visitScope(next.spec), skills: next.spec.team.skills.join(", "), crew: String(next.spec.team.crewSize), arrival: String(next.spec.team.arrivalWindowMinutes), price: "" }));
  };
  const setJobFacts = (input: QuoteInput) => {
    setFacts(input);
    if (!service) return;
    const next = runQuote(service.spec, { ...input, ...(propertyPrice ? { propertyPrice } : {}) });
    setForm((current) => ({ ...current, duration: next.time.elapsedMinutes || current.duration, crew: String(next.time.crewSize) }));
  };
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
      if (!visitMinutes || Number.isNaN(hours) || Number.isNaN(minutes)) return { ...current, from };
      const end = hours * 60 + minutes + visitMinutes;
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
        // A service from Services & Pricing is priced by the engine unless the person typed their own price.
        const fromEngine = service !== null && !typedPrice;
        if (fromEngine && priced && priced.outcome === "incomplete") return setError(`The price needs: ${priced.missing.join(", ")}. Answer them, or type a price.`);
        if (fromEngine && priced && priced.outcome === "walkthrough") return setError("This job needs a walkthrough before a firm price. Type the price agreed after the walkthrough.");
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
            ...(fromEngine ? { quoteInput: facts, ...(engineTotal !== null ? { expectedTotalCents: engineTotal } : {}) } : { priceCents }),
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
          <SearchableSelect value={form.customerId} onValueChange={(next) => setForm((current) => ({ ...current, customerId: next ?? "", propertyId: "" }))} options={(customers ?? []).map(customerOption)} loading={customers === undefined} placeholder="Search customers by name, email or phone" required />
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
          <ServiceField value={form.serviceId} onChoose={pick} onLegacy={choose} />
        </Guard>
        <Field label="Service name">
          <TextInput value={form.serviceType} onChange={set("serviceType")} required maxLength={80} />
        </Field>
        <Field label={service ? "Your own price (optional)" : "Price (optional)"} hint={service ? (typedPrice ? "This typed price is used instead of the service's price, and recorded as yours." : "Leave empty to use the service's price below.") : "The price of the service. It is not a payment."}>
          <TextInput
            inputMode="decimal"
            value={form.price}
            onChange={(event) => {
              setTypedPrice(event.target.value.trim() !== "");
              set("price")(event);
            }}
            placeholder={service && engineTotal !== null ? (engineTotal / 100).toFixed(2) : "0.00"}
          />
        </Field>
      </div>
      {service && priced ? (
        <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-sm font-medium text-strong">The job, for its price</p>
          {ownPrice ? (
            <p className="rounded-lg border border-brand-500/25 bg-brand-500/[0.06] px-3 py-2 text-sm text-strong">
              This property has its own base price: <span className="font-medium tabular-nums">${(ownPrice.baseCents / 100).toFixed(2)}</span>
              {ownPrice.untilWords ? ` (${lowerFirst(ownPrice.untilWords)})` : ""}. {ownPrice.extras?.length ? "Some extras are priced their own way here; discounts" : "Extras, discounts"} and the minimum still follow the service.
              {ownPrice.addedTasks.length ? <span className="mt-1 block text-muted-foreground">Also done here, added to the scope and checklist when the visit is made: {ownPrice.addedTasks.join("; ")}.</span> : null}
            </p>
          ) : own?.endsBefore ? (
            <p className="text-sm text-muted-foreground">This property&apos;s own price ends after {own.endsBefore}, so this visit uses the service&apos;s price.</p>
          ) : null}
          <JobInputs spec={service.spec} input={facts} onInput={setJobFacts} compact />
          {!typedPrice ? <QuoteLines result={priced} /> : null}
        </div>
      ) : null}
      <Field label="Scope" hint="What the cleaner will be told to do.">
        <AssistedTextArea value={form.scope} onChange={(text) => setForm((current) => ({ ...current, scope: text }))} required rows={3} actions={STEPS} />
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
          <CountField value={form.crew} onChange={(text) => setForm((current) => ({ ...current, crew: text }))} required noun={["cleaner", "cleaners"]} min={1} max={20} />
        </Field>
        <Field label="Arrival window, minutes" hint="0 means arrive at the start time. 30 means any time in the half hour after it.">
          <DurationField value={form.arrival} onChange={(text) => setForm((current) => ({ ...current, arrival: text }))} min={0} max={240} step={15} stepper />
        </Field>
        <Field label="Must be finished by, day (optional)" hint="For example a guest check-in.">
          <TextInput type="date" value={form.deadlineDate} onChange={set("deadlineDate")} />
        </Field>
        <Field label="Must be finished by, time">
          <TextInput type="time" value={form.deadlineTime} onChange={set("deadlineTime")} />
        </Field>
      </div>
      <Field label="Instructions for the crew (optional)" hint="What the crew needs to know that is not the scope.">
        <AssistedTextArea value={form.instructions} onChange={(text) => setForm((current) => ({ ...current, instructions: text }))} rows={3} maxLength={4000} audience={{ label: "Visible to the assigned cleaner after they accept." }} actions={STEPS} />
      </Field>
      <p className="text-xs text-muted-foreground">Times are on the company’s clock ({timezone}). A new visit has no cleaner until one accepts it.</p>
      <FormError message={error} />
      <Submit busy={busy} label="Schedule the visit" onCancel={onDone} />
    </form>
  );
}
