"use client";

import { useId, useMemo, useState } from "react";

import { Field, TextArea, TextInput, SelectInput } from "@/components/app/form";
import { Calculator, Check, ChevronDown, Footprints, Gauge, HandCoinsIcon, HouseIcon, LayoutGrid, ListChecks, type LucideIcon, MapPin, MoonIcon, Plus, PriceTagIcon, RefreshCw, ScaleIcon, Sparkles, Square, Trash2, TrendingUp, User, Users, Zap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { millicentsFrom, newId, rateText } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { checkSpec, quote, scheduleFacts } from "../../../../convex/lib/services/engine";
import { CATEGORIES, CATEGORY_LABELS, defaultPricing, defaultStr, METHOD_LABELS, PRICING_METHODS, SCHEDULES, type Adjustment, type PricingMethod, type Spec } from "../../../../convex/lib/services/spec";
import { areaWord, minutesWords, scheduleLabel } from "../../../../convex/lib/services/words";
import { defaultInput, ScheduleCalendar } from "./preview";
import { AudienceTag, FieldLabel, formatCents, InfoTip, LabeledField, MoneyInput, NumberInput, SectionTitle, Segmented, Stepper, SwitchButton, Toggle } from "./shared";

export type StepProps = { spec: Spec; edit: (change: (spec: Spec) => Spec) => void; disabled: boolean };

const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
const minutesOf = (h: number | null) => (h === null ? 0 : Math.max(0, Math.round(h * 60)));

function Problems({ spec, prefix }: { spec: Spec; prefix: string }) {
  const problems = checkSpec(spec).filter((p) => p.field.startsWith(prefix));
  if (!problems.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-1">
      {problems.map((p, i) => (
        <li key={`${p.field}-${i}`} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", p.severity === "blocker" ? "border-destructive/30 bg-destructive/[0.06] text-strong" : "border-warning/40 bg-warning/10 text-strong")}>
          <span className="font-medium">{p.severity === "blocker" ? "Fix before review: " : "Check: "}</span>
          {p.message}
        </li>
      ))}
    </ul>
  );
}

// ── Basics ──────────────────────────────────────────────────────────────────────────────────────────

export function BasicsStep({ spec, edit, disabled }: StepProps) {
  return (
    <div className="grid grid-cols-1 gap-5">
      <SectionTitle title="Basics" tip="Keep the name and description plain: what you do, not how you price it." action={<AudienceTag who="customers" />} />
      <Field label="Service name">
        <TextInput value={spec.name} disabled={disabled} maxLength={80} onChange={(event) => edit((s) => ({ ...s, name: event.target.value }))} placeholder="Standard clean" />
      </Field>
      <Field label="Description for customers">
        <TextArea value={spec.summary} disabled={disabled} maxLength={1000} onChange={(event) => edit((s) => ({ ...s, summary: event.target.value }))} placeholder="A thorough clean of the kitchen, bathrooms and living areas." />
      </Field>
      <label className="grid grid-cols-1 gap-1.5 text-sm">
        <span className="font-medium text-strong">Kind of cleaning</span>
        <SelectInput disabled={disabled} className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={spec.category} onChange={(event) => edit((s) => ({ ...s, category: event.target.value as Spec["category"] }))}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </SelectInput>
      </label>
      <Segmented
        label="One price buys one…"
        value={spec.visitWord}
        disabled={disabled}
        options={[
          { id: "visit", label: "Visit" },
          { id: "turnover", label: "Turnover" },
          { id: "job", label: "Job" },
        ]}
        onChange={(visitWord) => edit((s) => ({ ...s, visitWord }))}
      />
      <Problems spec={spec} prefix="name" />
    </div>
  );
}

// ── Scope ───────────────────────────────────────────────────────────────────────────────────────────

export function ScopeStep({ spec, edit, disabled }: StepProps) {
  const [label, setLabel] = useState("");
  const [section, setSection] = useState("");
  const [excluded, setExcluded] = useState("");
  const sections = [...new Set(spec.included.map((i) => i.section ?? "General"))];
  const add = () => {
    if (!label.trim()) return;
    edit((s) => ({ ...s, included: [...s.included, { id: newId(`${section} ${label}`, s.included.map((i) => i.id)), label: label.trim(), ...(section.trim() ? { section: section.trim() } : {}), requiresPhoto: false }] }));
    setLabel("");
  };
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionTitle title="What's included" tip="Each task is a promise to the customer and a line on the crew's checklist. Tick Photo for tasks the crew must photograph." />
      {sections.length === 0 ? <p className="text-sm text-muted-foreground">No tasks yet.</p> : null}
      {sections.map((name) => (
        <div key={name} className="grid grid-cols-1 gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name}</p>
          <ul className="grid grid-cols-1 gap-1.5">
            {spec.included
              .filter((i) => (i.section ?? "General") === name)
              .map((item) => (
                <li key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1">
                  <input aria-label="Task" disabled={disabled} className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm text-strong outline-none" value={item.label} onChange={(event) => edit((s) => ({ ...s, included: s.included.map((i) => (i.id === item.id ? { ...i, label: event.target.value } : i)) }))} />
                  <label className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" disabled={disabled} checked={item.requiresPhoto} onChange={(event) => edit((s) => ({ ...s, included: s.included.map((i) => (i.id === item.id ? { ...i, requiresPhoto: event.target.checked } : i)) }))} /> Photo
                  </label>
                  <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${item.label}`} onClick={() => edit((s) => ({ ...s, included: s.included.filter((i) => i.id !== item.id), addOns: s.addOns.map((a) => (a.coversItemId === item.id ? { ...a, coversItemId: undefined } : a)) }))}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      {!disabled ? (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-dashed border-border p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
          <Field label="New task">
            <TextInput value={label} onChange={(event) => setLabel(event.target.value)} onKeyDown={(event) => event.key === "Enter" && (event.preventDefault(), add())} placeholder="Wipe kitchen counters" />
          </Field>
          <Field label="Room or area">
            <TextInput value={section} list="scope-sections" onChange={(event) => setSection(event.target.value)} placeholder="Kitchen" />
            <datalist id="scope-sections">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Button variant="secondary" onClick={add} disabled={!label.trim()}>
            <Plus aria-hidden /> Add
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2">
        <SectionTitle title="Not included" tip="Saying what is not included prevents most disagreements with customers." />
        <ul className="flex flex-wrap gap-1.5">
          {spec.excluded.map((e) => (
            <li key={e} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-3 pr-1 text-sm text-strong">
              {e}
              {!disabled ? (
                <button type="button" aria-label={`Remove ${e}`} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-overlay/[0.06]" onClick={() => edit((s) => ({ ...s, excluded: s.excluded.filter((x) => x !== e) }))}>
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {!disabled ? (
          <div className="flex gap-2">
            <TextInput
              aria-label="Add an exclusion"
              value={excluded}
              onChange={(event) => setExcluded(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && excluded.trim()) {
                  event.preventDefault();
                  edit((s) => ({ ...s, excluded: [...new Set([...s.excluded, excluded.trim()])] }));
                  setExcluded("");
                }
              }}
              placeholder="Inside the oven"
            />
            <Button
              variant="secondary"
              disabled={!excluded.trim()}
              onClick={() => {
                edit((s) => ({ ...s, excluded: [...new Set([...s.excluded, excluded.trim()])] }));
                setExcluded("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <LabeledField label="Notes for the team" tip="Shown to cleaners after they accept a visit, never to customers.">
        {(id) => <TextArea id={id} value={spec.teamNotes} disabled={disabled} placeholder="Products, order of work, access" onChange={(event) => edit((s) => ({ ...s, teamNotes: event.target.value }))} />}
      </LabeledField>
      <Problems spec={spec} prefix="included" />
      <Problems spec={spec} prefix="excluded" />
    </div>
  );
}

// ── Pricing ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Each way to price, shown by what it looks like rather than described: an icon and a made-up example.
 * The examples are illustrations of the shape of a price, not suggested rates.
 */
const METHOD_LOOK: Record<PricingMethod, { Icon: LucideIcon; example: string }> = {
  fixed: { Icon: PriceTagIcon, example: "$150 a visit" },
  bed_bath: { Icon: HouseIcon, example: "$120 + $20 a bedroom" },
  size_bands: { Icon: LayoutGrid, example: "1,000–1,999 sq ft: $160" },
  hourly_per_cleaner: { Icon: User, example: "$45 × each cleaner's hours" },
  hourly_per_crew: { Icon: Users, example: "$80 × hours on site, whole crew" },
  per_area: { Icon: Square, example: "$0.08 × square feet" },
  per_unit: { Icon: ListChecks, example: "$12 × windows" },
  recurring_package: { Icon: RefreshCw, example: "$480 a month on a schedule" },
  custom_quote: { Icon: Footprints, example: "Walkthrough first, then a price" },
};
const COMMON_METHODS: PricingMethod[] = ["fixed", "bed_bath", "size_bands", "hourly_per_cleaner"];

function MethodPicker({ value, onPick, disabled }: { value: PricingMethod; onPick: (method: PricingMethod) => void; disabled: boolean }) {
  const others = PRICING_METHODS.filter((m) => !COMMON_METHODS.includes(m));
  const [more, setMore] = useState(!COMMON_METHODS.includes(value));
  const shown = [...COMMON_METHODS, ...others.filter((m) => more || m === value)];
  return (
    <div className="grid grid-cols-1 gap-2">
      <fieldset disabled={disabled}>
        <legend className="sr-only">Pricing method</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {shown.map((m) => {
            const { Icon, example } = METHOD_LOOK[m];
            const selected = value === m;
            return (
              <label key={m} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500/40", selected ? "border-brand-500 bg-brand-500/[0.06]" : "border-border bg-card hover:border-brand-500/40")}>
                <input type="radio" className="sr-only" name="method" checked={selected} onChange={() => onPick(m)} />
                <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg transition-colors", selected ? "bg-brand-500 text-white" : "bg-brand-500/10 text-brand-300")}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-strong">{METHOD_LABELS[m].label}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">e.g. {example}</span>
                </span>
                {selected ? <Check aria-hidden className="size-4 shrink-0 text-brand-300" /> : null}
              </label>
            );
          })}
        </div>
      </fieldset>
      <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="inline-flex w-fit items-center gap-1 rounded-md text-sm font-medium text-brand-300 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500/40">
        {more ? "Fewer ways to price" : `More ways to price (${others.length})`}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", more && "rotate-180")} />
      </button>
    </div>
  );
}

/** The base of a usual job, worked out by the engine from what is typed: "4 cleaner-hours × $45.00 = $180.00". */
function UsualJob({ spec }: { spec: Spec }) {
  const result = useMemo(() => quote(spec, defaultInput(spec)), [spec]);
  const base = result.lines.find((l) => l.kind === "base");
  // A fixed price is its own working-out; saying "$150 per visit = $150" adds nothing.
  if (!base || !base.detail || base.amountCents <= 0 || spec.pricing.method === "fixed") return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-brand-500/[0.06] px-3 py-2 text-sm" aria-live="polite">
      <Calculator aria-hidden className="size-4 text-brand-300" />
      <span className="text-muted-foreground">A usual job</span>
      <span className="text-strong">{base.detail}</span>
      <span className="font-semibold tabular-nums text-strong">= {formatCents(base.amountCents)}</span>
    </p>
  );
}

export function PricingStep({ spec, edit, disabled }: StepProps) {
  const p = spec.pricing;
  const word = spec.visitWord;
  const setP = (patch: Partial<Spec["pricing"]>) => edit((s) => ({ ...s, pricing: { ...s.pricing, ...patch } as Spec["pricing"] }));
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionTitle title="How it's priced" tip="Pick the way you think about this work. Every amount shows its unit beside it, so “per hour” is never unclear. Switching methods starts that method's amounts fresh." />
      <MethodPicker value={p.method} disabled={disabled} onPick={(m) => edit((s) => ({ ...s, pricing: defaultPricing(m) }))} />
      <div className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-4">
        {p.method === "fixed" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput label="Price" unit={`per ${word}`} cents={p.amountCents} disabled={disabled} onCents={(c) => setP({ amountCents: c ?? 0 })} />
            <NumberInput label="Usual cleaner-time" unit="hours, all cleaners" step={0.25} disabled={disabled} value={hours(p.laborMinutes)} onValue={(h) => setP({ laborMinutes: minutesOf(h) })} tip="Add up every cleaner's time: two cleaners for two hours is four cleaner-hours. Used to plan the visit and measure earnings, not to bill." />
          </div>
        ) : null}
        {p.method === "hourly_per_cleaner" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput label="Rate" unit="per cleaner per hour" cents={p.rateCents} disabled={disabled} onCents={(c) => setP({ rateCents: c ?? 0 })} />
            <NumberInput label="Minimum billed" unit="cleaner-hours" step={0.5} disabled={disabled} value={p.minimumHours} onValue={(v) => setP({ minimumHours: v ?? 0 })} />
            <Segmented label="Billed time rounds up to" value={String(p.incrementMinutes) as "15" | "30" | "60"} disabled={disabled} options={[{ id: "15", label: "15 min" }, { id: "30", label: "30 min" }, { id: "60", label: "1 hour" }]} onChange={(v) => setP({ incrementMinutes: Number(v) })} />
            <NumberInput label="Usual cleaner-time" unit="hours, all cleaners" step={0.25} disabled={disabled} value={hours(p.estimatedLaborMinutes)} onValue={(h) => setP({ estimatedLaborMinutes: minutesOf(h) })} tip="Used for estimates and the preview. The bill follows the cleaners' real hours." />
          </div>
        ) : null}
        {p.method === "hourly_per_crew" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput label="Rate" unit={`per hour for the crew of ${p.crewSize}`} cents={p.rateCents} disabled={disabled} onCents={(c) => setP({ rateCents: c ?? 0 })} />
            <Stepper label="Crew this rate covers" value={p.crewSize} min={1} max={12} disabled={disabled} onValue={(crewSize) => setP({ crewSize })} />
            <NumberInput label="Minimum billed" unit="hours on site" step={0.5} disabled={disabled} value={p.minimumHours} onValue={(v) => setP({ minimumHours: v ?? 0 })} />
            <Segmented label="Billed time rounds up to" value={String(p.incrementMinutes) as "15" | "30" | "60"} disabled={disabled} options={[{ id: "15", label: "15 min" }, { id: "30", label: "30 min" }, { id: "60", label: "1 hour" }]} onChange={(v) => setP({ incrementMinutes: Number(v) })} />
            <NumberInput label="Usual time on site" unit="hours" step={0.25} disabled={disabled} value={hours(p.estimatedElapsedMinutes)} onValue={(h) => setP({ estimatedElapsedMinutes: minutesOf(h) })} />
          </div>
        ) : null}
        {p.method === "size_bands" ? <BandsEditor spec={spec} edit={edit} disabled={disabled} /> : null}
        {p.method === "per_area" ? <AreaRate spec={spec} edit={edit} disabled={disabled} /> : null}
        {p.method === "bed_bath" ? (
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <MoneyInput label="Base price" unit={`per ${word}`} cents={p.baseCents} disabled={disabled} onCents={(c) => setP({ baseCents: c ?? 0 })} hint={`Covers ${p.includedBedrooms} bedroom${p.includedBedrooms === 1 ? "" : "s"} and ${p.includedBathrooms} bathroom${p.includedBathrooms === 1 ? "" : "s"}.`} />
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <Stepper label="Bedrooms in base" value={p.includedBedrooms} max={20} disabled={disabled} onValue={(includedBedrooms) => setP({ includedBedrooms })} />
              <Stepper label="Bathrooms in base" value={p.includedBathrooms} max={20} disabled={disabled} onValue={(includedBathrooms) => setP({ includedBathrooms })} />
            </div>
            <MoneyInput label="Each extra bedroom" unit="per bedroom" cents={p.perBedroomCents} disabled={disabled} onCents={(c) => setP({ perBedroomCents: c ?? 0 })} />
            <MoneyInput label="Each extra bathroom" unit="per full bathroom" cents={p.perBathroomCents} disabled={disabled} onCents={(c) => setP({ perBathroomCents: c ?? 0 })} />
            <MoneyInput label="Each half bath" unit="per half bath" cents={p.perHalfBathCents} disabled={disabled} onCents={(c) => setP({ perHalfBathCents: c ?? 0 })} />
            <NumberInput label="Base cleaner-time" unit="hours" step={0.25} disabled={disabled} value={hours(p.baseLaborMinutes)} onValue={(h) => setP({ baseLaborMinutes: minutesOf(h) })} />
            <NumberInput label="Time per extra bedroom" unit="minutes" disabled={disabled} value={p.perBedroomMinutes} onValue={(v) => setP({ perBedroomMinutes: v ?? 0 })} />
            <NumberInput label="Time per extra bathroom" unit="minutes" disabled={disabled} value={p.perBathroomMinutes} onValue={(v) => setP({ perBathroomMinutes: v ?? 0 })} />
          </div>
        ) : null}
        {p.method === "per_unit" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="One unit is a…">
              <TextInput value={p.unitWord} disabled={disabled} maxLength={30} placeholder="room, load, window" onChange={(event) => setP({ unitWord: event.target.value })} />
            </Field>
            <MoneyInput label="Price" unit={`per ${p.unitWord || "unit"}`} cents={p.unitCents} disabled={disabled} onCents={(c) => setP({ unitCents: c ?? 0 })} />
            <MoneyInput label="Plus a base charge" unit={`per ${word}`} cents={p.baseCents} disabled={disabled} onCents={(c) => setP({ baseCents: c ?? 0 })} hint="Leave at 0 for none." />
            <Stepper label={`Fewest ${p.unitWord || "unit"}s charged`} value={p.minimumUnits} max={1000} disabled={disabled} onValue={(minimumUnits) => setP({ minimumUnits })} />
            <NumberInput label={`Time per ${p.unitWord || "unit"}`} unit="cleaner-minutes" disabled={disabled} value={p.laborMinutesPerUnit} onValue={(v) => setP({ laborMinutesPerUnit: v ?? 0 })} />
            <NumberInput label="Set-up time" unit="cleaner-minutes" disabled={disabled} value={p.baseLaborMinutes} onValue={(v) => setP({ baseLaborMinutes: v ?? 0 })} />
          </div>
        ) : null}
        {p.method === "recurring_package" ? (
          <div className="grid grid-cols-1 gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MoneyInput label="Price" unit="per calendar month" cents={p.monthlyCents} disabled={disabled} onCents={(c) => setP({ monthlyCents: c ?? 0 })} />
              <Segmented label="Visits are…" value={p.basis} disabled={disabled} options={[{ id: "schedule", label: "On a schedule" }, { id: "included", label: "A set number a month" }]} onChange={(basis) => setP({ basis })} />
              {p.basis === "schedule" ? (
                <label className="grid grid-cols-1 gap-1.5 text-sm">
                  <span className="font-medium text-strong">Schedule</span>
                  <SelectInput disabled={disabled} className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={p.schedule} onChange={(event) => setP({ schedule: event.target.value as Spec["modifiers"]["recurring"]["options"][number]["schedule"] })}>
                    {SCHEDULES.map((s) => (
                      <option key={s} value={s}>
                        {scheduleLabel(s)}
                      </option>
                    ))}
                  </SelectInput>
                </label>
              ) : (
                <Stepper label="Visits included each month" value={p.includedVisits} min={1} max={31} disabled={disabled} onValue={(includedVisits) => setP({ includedVisits })} />
              )}
              <MoneyInput label="An extra visit" unit="per visit beyond the plan" cents={p.extraVisitCents} disabled={disabled} onCents={(c) => setP({ extraVisitCents: c })} hint="Leave empty if not offered." />
              <NumberInput label="Cleaner-time per visit" unit="hours" step={0.25} disabled={disabled} value={hours(p.laborMinutesPerVisit)} onValue={(h) => setP({ laborMinutesPerVisit: minutesOf(h) })} />
            </div>
            {p.basis === "schedule" ? (
              <div className="rounded-lg bg-muted/40 p-3">
                <p className="text-sm text-strong">
                  {scheduleLabel(p.schedule)} is {scheduleFacts(p.schedule).visitsPerYear.toFixed(2)} visits a year: {scheduleFacts(p.schedule).visitsPerMonthRange.join(" or ")} in a month, {scheduleFacts(p.schedule).monthlyAverage.toFixed(2)} on average. The monthly price stays the same either way.
                </p>
                <div className="mt-2">
                  <ScheduleCalendar schedule={p.schedule} start={new Date().toISOString().slice(0, 10)} />
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {p.method === "custom_quote" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput label="Advertised starting price (optional)" unit={`from, per ${word}`} cents={p.fromCents} disabled={disabled} onCents={(c) => setP({ fromCents: c })} tip="Shown to customers as “from”, never as a quote. The firm price is set after the walkthrough." />
            <NumberInput label="Usual cleaner-time" unit="hours" step={0.25} disabled={disabled} value={p.laborMinutes === null ? null : hours(p.laborMinutes)} onValue={(h) => setP({ laborMinutes: h === null ? null : minutesOf(h) })} />
          </div>
        ) : null}
      </div>
      <UsualJob spec={spec} />
      <Problems spec={spec} prefix="pricing" />
    </div>
  );
}

/** Size bands as a table. A band covers its lower bound up to, not including, its upper bound. */
function BandsEditor({ spec, edit, disabled }: StepProps) {
  const p = spec.pricing as Extract<Spec["pricing"], { method: "size_bands" }>;
  const setBands = (bands: typeof p.bands) => edit((s) => ({ ...s, pricing: { ...p, bands } }));
  const unit = areaWord(p.unit);
  return (
    <div className="grid grid-cols-1 gap-3">
      <Segmented label="Measured in" value={p.unit} disabled={disabled} options={[{ id: "sq_ft", label: "Square feet" }, { id: "sq_m", label: "Square meters" }]} onChange={(u) => edit((s) => ({ ...s, pricing: { ...p, unit: u } }))} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Size bands</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-1.5 font-medium">From ({unit})</th>
              <th className="pb-1.5 font-medium">Up to, not including</th>
              <th className="pb-1.5 font-medium">Price per {spec.visitWord}</th>
              <th className="pb-1.5 font-medium">Cleaner-hours</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.bands.map((band, i) => {
              const set = (patch: Partial<typeof band>) => setBands(p.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
              return (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-2">
                    <input aria-label={`Band ${i + 1} from`} type="number" min={0} disabled={disabled} className="w-full rounded-md border border-border bg-card px-2 py-1.5 tabular-nums" value={band.from} onChange={(e) => set({ from: Number(e.target.value) })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input aria-label={`Band ${i + 1} up to`} type="number" min={0} disabled={disabled} placeholder="and up" className="w-full rounded-md border border-border bg-card px-2 py-1.5 tabular-nums" value={band.to ?? ""} onChange={(e) => set({ to: e.target.value === "" ? null : Number(e.target.value) })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center rounded-md border border-border bg-card">
                      <span className="pl-2 text-muted-foreground">$</span>
                      <input aria-label={`Band ${i + 1} price`} inputMode="decimal" disabled={disabled} className="w-full bg-transparent px-1 py-1.5 tabular-nums outline-none" defaultValue={(band.amountCents / 100).toFixed(2)} onBlur={(e) => set({ amountCents: Math.round(Number(e.target.value.replace(/[$,]/g, "")) * 100) || 0 })} />
                    </div>
                  </td>
                  <td className="py-1.5 pr-2">
                    <input aria-label={`Band ${i + 1} cleaner-hours`} type="number" min={0} step={0.25} disabled={disabled} className="w-full rounded-md border border-border bg-card px-2 py-1.5 tabular-nums" value={hours(band.laborMinutes)} onChange={(e) => set({ laborMinutes: minutesOf(Number(e.target.value)) })} />
                  </td>
                  <td className="py-1.5">
                    <Button size="icon-xs" variant="ghost" disabled={disabled || p.bands.length === 1} aria-label={`Remove band ${i + 1}`} onClick={() => setBands(p.bands.filter((_, j) => j !== i))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!disabled ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const last = p.bands[p.bands.length - 1];
              const from = last?.to ?? (last ? last.from + 1000 : 0);
              setBands([...p.bands, { from, to: from + 1000, amountCents: last?.amountCents ?? 0, laborMinutes: last?.laborMinutes ?? 120 }]);
            }}
          >
            <Plus aria-hidden /> Add a band
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">Leave the last &ldquo;up to&rdquo; empty to cover every larger size; otherwise larger homes need a walkthrough.</p>
    </div>
  );
}

function AreaRate({ spec, edit, disabled }: StepProps) {
  const p = spec.pricing as Extract<Spec["pricing"], { method: "per_area" }>;
  const [text, setText] = useState<string | null>(null);
  const rateId = useId();
  const unit = areaWord(p.unit, 1);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Segmented label="Measured in" value={p.unit} disabled={disabled} options={[{ id: "sq_ft", label: "Square feet" }, { id: "sq_m", label: "Square meters" }]} onChange={(u) => edit((s) => ({ ...s, pricing: { ...p, unit: u } }))} />
      <div className="grid grid-cols-1 gap-1.5 text-sm">
        <FieldLabel htmlFor={rateId} label="Rate" tip="Fractions of a cent are kept: 0.085 is eight and a half cents." />
        <div className="flex min-h-10 items-center rounded-lg border border-border bg-card focus-within:border-brand-500/60 focus-within:outline-2 focus-within:outline-brand-500/30">
          <span className="pl-3 text-muted-foreground">$</span>
          <input
            id={rateId}
            inputMode="decimal"
            disabled={disabled}
            className="w-full bg-transparent px-1.5 py-2 tabular-nums outline-none"
            value={text ?? rateText(p.rateMillicents)}
            onChange={(event) => {
              setText(event.target.value);
              const value = millicentsFrom(event.target.value);
              if (value !== null) edit((s) => ({ ...s, pricing: { ...p, rateMillicents: value } }));
            }}
            onBlur={() => setText(null)}
          />
          <span className="pr-3 text-xs text-muted-foreground">per {unit}</span>
        </div>
      </div>
      <NumberInput label={`Cleaner-time per 1,000 ${areaWord(p.unit)}`} unit="minutes" disabled={disabled} value={p.laborMinutesPer1000} onValue={(v) => edit((s) => ({ ...s, pricing: { ...p, laborMinutesPer1000: v ?? 0 } }))} />
      <NumberInput label="Walkthrough at or above" unit={areaWord(p.unit)} disabled={disabled} value={p.walkthroughAbove} onValue={(v) => edit((s) => ({ ...s, pricing: { ...p, walkthroughAbove: v } }))} hint="Leave empty for no limit." />
    </div>
  );
}

// ── Time & Team ─────────────────────────────────────────────────────────────────────────────────────

export function TeamStep({ spec, edit, disabled }: StepProps) {
  const [skill, setSkill] = useState("");
  const [note, setNote] = useState("");
  const [requirement, setRequirement] = useState("");
  const setTeam = (patch: Partial<Spec["team"]>) => edit((s) => ({ ...s, team: { ...s.team, ...patch } }));
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionTitle title="Time and team" tip="Dispatch uses these to staff the visit and offer it only to cleaners who can do it." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Stepper label="Usual crew" value={spec.team.crewSize} min={1} max={12} disabled={disabled} onValue={(crewSize) => setTeam({ crewSize, maxCrew: Math.max(spec.team.maxCrew, crewSize) })} unit="cleaners" />
        <Stepper label="Largest crew" value={spec.team.maxCrew} min={spec.team.crewSize} max={12} disabled={disabled} onValue={(maxCrew) => setTeam({ maxCrew })} unit="cleaners" />
        <NumberInput label="Longest a visit should run" unit="hours on site" step={0.5} disabled={disabled} value={hours(spec.team.maxVisitMinutes)} onValue={(h) => setTeam({ maxVisitMinutes: Math.max(15, minutesOf(h)) })} tip="Longer jobs get a warning to add a cleaner or split the visit." />
        <NumberInput label="Arrival window" unit="minutes" disabled={disabled} value={spec.team.arrivalWindowMinutes} onValue={(v) => setTeam({ arrivalWindowMinutes: v ?? 0 })} hint={spec.team.arrivalWindowMinutes ? `The crew may arrive up to ${minutesWords(spec.team.arrivalWindowMinutes)} after the start.` : "0: the crew arrives at the start time."} />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <p className="text-sm font-medium text-strong">Skills the crew needs</p>
        <ul className="flex flex-wrap gap-1.5">
          {spec.team.skills.map((k) => (
            <li key={k} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-3 pr-1 text-sm">
              {k}
              {!disabled ? (
                <button type="button" aria-label={`Remove ${k}`} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-overlay/[0.06]" onClick={() => setTeam({ skills: spec.team.skills.filter((x) => x !== k) })}>
                  ×
                </button>
              ) : null}
            </li>
          ))}
          {spec.team.skills.length === 0 ? <li className="text-sm text-muted-foreground">None: any ready cleaner can be offered it.</li> : null}
        </ul>
        {!disabled ? (
          <div className="flex gap-2">
            <TextInput className="min-w-0" aria-label="Add a skill" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="windows" />
            <Button
              variant="secondary"
              disabled={!skill.trim()}
              onClick={() => {
                setTeam({ skills: [...new Set([...spec.team.skills, skill.trim().toLowerCase()])] });
                setSkill("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <QuestionsEditor spec={spec} edit={edit} disabled={disabled} />

      <div className="grid grid-cols-1 gap-2">
        <SectionTitle title="When a walkthrough is needed" tip="Situations where the team should see the property before giving a firm price." />
        <ul className="grid grid-cols-1 gap-1">
          {spec.walkthroughNotes.map((n) => (
            <li key={n} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              {n}
              {!disabled ? (
                <Button size="icon-xs" variant="ghost" aria-label={`Remove ${n}`} onClick={() => edit((s) => ({ ...s, walkthroughNotes: s.walkthroughNotes.filter((x) => x !== n) }))}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!disabled ? (
          <div className="flex gap-2">
            <TextInput className="min-w-0" aria-label="Add a walkthrough situation" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Homes over 5,000 sq ft" />
            <Button
              variant="secondary"
              disabled={!note.trim()}
              onClick={() => {
                edit((s) => ({ ...s, walkthroughNotes: [...s.walkthroughNotes, note.trim()] }));
                setNote("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-2">
        <SectionTitle title="What your company must have" tip="Training, insurance, equipment or certification this work needs. Listing one does not claim you have it.">Each is confirmed before publishing.</SectionTitle>
        <ul className="grid grid-cols-1 gap-1">
          {spec.requirements.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
              <span>
                {r.label} <span className="text-xs text-muted-foreground">{r.confirmed ? "· confirmed" : "· not confirmed yet"}</span>
              </span>
              {!disabled ? (
                <Button size="icon-xs" variant="ghost" aria-label={`Remove ${r.label}`} onClick={() => edit((s) => ({ ...s, requirements: s.requirements.filter((x) => x.id !== r.id) }))}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!disabled ? (
          <div className="flex gap-2">
            <TextInput className="min-w-0" aria-label="Add a requirement" value={requirement} onChange={(e) => setRequirement(e.target.value)} placeholder="Insurance that covers work at height" />
            <Button
              variant="secondary"
              disabled={!requirement.trim()}
              onClick={() => {
                edit((s) => ({ ...s, requirements: [...s.requirements, { id: newId(requirement, s.requirements.map((r) => r.id)), label: requirement.trim(), confirmed: false }] }));
                setRequirement("");
              }}
            >
              Add
            </Button>
          </div>
        ) : null}
      </div>

      <StrEditor spec={spec} edit={edit} disabled={disabled} />
    </div>
  );
}

function QuestionsEditor({ spec, edit, disabled }: StepProps) {
  const set = (id: string, patch: Partial<Spec["questions"][number]>) => edit((s) => ({ ...s, questions: s.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));
  return (
    <div className="grid grid-cols-1 gap-2">
      <SectionTitle title="Questions a price needs" tip="What to ask before quoting. An answer can send the job to a walkthrough instead of a price." />
      <ul className="grid grid-cols-1 gap-2">
        {spec.questions.map((q) => (
          <li key={q.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
            <Field label="Question">
              <TextInput value={q.label} disabled={disabled} onChange={(e) => set(q.id, { label: e.target.value })} />
            </Field>
            <label className="grid grid-cols-1 gap-1.5 text-sm">
              <span className="font-medium text-strong">Answer</span>
              <SelectInput disabled={disabled} className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={q.kind} onChange={(e) => set(q.id, { kind: e.target.value as typeof q.kind, walkthroughIf: null })}>
                <option value="number">A number</option>
                <option value="yes_no">Yes or no</option>
                <option value="choice">A choice</option>
                <option value="text">Words</option>
              </SelectInput>
            </label>
            <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove ${q.label}`} onClick={() => edit((s) => ({ ...s, questions: s.questions.filter((x) => x.id !== q.id) }))}>
              <Trash2 aria-hidden />
            </Button>
            {q.kind === "choice" ? (
              <Field label="Choices" hint="Separate with commas." className="sm:col-span-3">
                <TextInput disabled={disabled} value={q.options.join(", ")} onChange={(e) => set(q.id, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })} />
              </Field>
            ) : null}
            <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-3">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" disabled={disabled} checked={q.required} onChange={(e) => set(q.id, { required: e.target.checked })} /> Required for a price
              </label>
              {q.kind === "number" ? (
                <label className="inline-flex items-center gap-1.5">
                  Walkthrough at
                  <input type="number" disabled={disabled} className="w-20 rounded-md border border-border bg-card px-2 py-1" value={q.walkthroughIf?.atLeast ?? ""} onChange={(e) => set(q.id, { walkthroughIf: e.target.value === "" ? null : { atLeast: Number(e.target.value) } })} />
                  or more
                </label>
              ) : q.kind === "yes_no" || q.kind === "choice" ? (
                <label className="inline-flex items-center gap-1.5">
                  Walkthrough if the answer is
                  <SelectInput disabled={disabled} className="rounded-md border border-border bg-card px-2 py-1" value={q.walkthroughIf?.equals ?? ""} onChange={(e) => set(q.id, { walkthroughIf: e.target.value ? { equals: e.target.value } : null })}>
                    <option value="">never</option>
                    {(q.kind === "yes_no" ? ["yes", "no"] : q.options).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </SelectInput>
                </label>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {!disabled ? (
        <div>
          <Button size="sm" variant="secondary" onClick={() => edit((s) => ({ ...s, questions: [...s.questions, { id: newId("question", s.questions.map((q) => q.id)), label: "", kind: "number", required: false, options: [], walkthroughIf: null }] }))}>
            <Plus aria-hidden /> Add a question
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Short-term rental turnovers: linens, laundry, restocking, the turnover window, deep cleans and condition charges. */
function StrEditor({ spec, edit, disabled }: StepProps) {
  const str = spec.str;
  const setStr = (patch: Partial<NonNullable<Spec["str"]>>) => edit((s) => ({ ...s, str: { ...(s.str ?? defaultStr()), ...patch } }));
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-border p-4">
      <Toggle label="Short-term rental turnover" tip="Beds and linens, laundry, restocking, and a window between checkout and check-in. Not an ordinary residential clean." checked={Boolean(str?.enabled)} disabled={disabled} onChange={(on) => edit((s) => ({ ...s, str: on ? { ...(s.str ?? defaultStr()), enabled: true } : s.str ? { ...s.str, enabled: false } : null }))} />
      {str?.enabled ? (
        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Checkout">
              <TextInput type="time" disabled={disabled} value={str.checkoutTime} onChange={(e) => setStr({ checkoutTime: e.target.value })} />
            </Field>
            <Field label="Check-in">
              <TextInput type="time" disabled={disabled} value={str.checkinTime} onChange={(e) => setStr({ checkinTime: e.target.value })} />
            </Field>
            <NumberInput label="Linen sets per bed" step={0.5} disabled={disabled} value={str.linenSetsPerBed} onValue={(v) => setStr({ linenSetsPerBed: v ?? 0 })} />
            <NumberInput label="Linen sets per laundry load" step={0.5} disabled={disabled} value={str.setsPerLoad} onValue={(v) => setStr({ setsPerLoad: v ?? 1 })} />
          </div>
          <Segmented label="Laundry is done" value={str.laundry.location} disabled={disabled} options={[{ id: "on_site", label: "On site" }, { id: "off_site", label: "Off site" }, { id: "none", label: "Not by us" }]} onChange={(location) => setStr({ laundry: { ...str.laundry, location } })} />
          {str.laundry.location !== "none" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <MoneyInput label="Laundry charge" unit="per load" cents={str.laundry.loadCents} disabled={disabled} onCents={(c) => setStr({ laundry: { ...str.laundry, loadCents: c ?? 0 } })} hint="0: included in the price." />
              <NumberInput label="Hands-on time" unit="min per load" disabled={disabled} value={str.laundry.loadMinutes} onValue={(v) => setStr({ laundry: { ...str.laundry, loadMinutes: v ?? 0 } })} />
              {str.laundry.location === "on_site" ? <NumberInput label="Loads the machines finish" unit="per turnover" disabled={disabled} value={str.laundry.maxLoads} onValue={(v) => setStr({ laundry: { ...str.laundry, maxLoads: v ?? 0 } })} /> : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm font-medium text-strong">Restocking</p>
            <ul className="grid grid-cols-1 gap-1.5">
              {str.restock.map((item) => (
                <li key={item.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,11rem)_auto] sm:items-center">
                  <input aria-label="Item" disabled={disabled} className="rounded-md border border-border bg-card px-2 py-1.5 text-sm" value={item.label} onChange={(e) => setStr({ restock: str.restock.map((r) => (r.id === item.id ? { ...r, label: e.target.value } : r)) })} />
                  <input aria-label="Per turnover" type="number" min={0} disabled={disabled} className="rounded-md border border-border bg-card px-2 py-1.5 text-sm tabular-nums" value={item.perTurnover} onChange={(e) => setStr({ restock: str.restock.map((r) => (r.id === item.id ? { ...r, perTurnover: Number(e.target.value) } : r)) })} />
                  <SelectInput aria-label="How it's paid for" disabled={disabled} className="rounded-md border border-border bg-card px-2 py-1.5 text-sm" value={item.rule} onChange={(e) => setStr({ restock: str.restock.map((r) => (r.id === item.id ? { ...r, rule: e.target.value as typeof r.rule } : r)) })}>
                    <option value="included">Included in the price</option>
                    <option value="at_cost">Billed at cost, after</option>
                    <option value="cost_plus">Billed at cost plus a markup</option>
                    <option value="host_supplied">The host supplies it</option>
                  </SelectInput>
                  <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${item.label}`} onClick={() => setStr({ restock: str.restock.filter((r) => r.id !== item.id) })}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {!disabled ? (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setStr({ restock: [...str.restock, { id: newId("item", str.restock.map((r) => r.id)), label: "Toilet paper", perTurnover: 2, rule: "at_cost", markupPercent: 0 }] })}>
                  <Plus aria-hidden /> Add an item
                </Button>
              </div>
            ) : null}
          </div>
          <NumberInput label="Deep clean every" unit="turnovers" disabled={disabled} value={str.deepCleanEveryTurnovers} onValue={(v) => setStr({ deepCleanEveryTurnovers: v === null || v < 1 ? null : Math.round(v) })} hint="Leave empty to arrange deep cleans separately." />
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm font-medium text-strong">Excessive-condition charges</p>
            <p className="text-xs text-muted-foreground">Applied only after a person reviews the crew&apos;s photos. Never automatic.</p>
            <ul className="grid grid-cols-1 gap-1.5">
              {str.conditionCharges.map((c) => (
                <li key={c.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end">
                  <input aria-label="Charge" disabled={disabled} className="rounded-md border border-border bg-card px-2 py-1.5 text-sm" value={c.label} onChange={(e) => setStr({ conditionCharges: str.conditionCharges.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)) })} />
                  <MoneyInput label="Amount" unit="per turnover" cents={c.amountCents} disabled={disabled} onCents={(v) => setStr({ conditionCharges: str.conditionCharges.map((x) => (x.id === c.id ? { ...x, amountCents: v ?? 0 } : x)) })} />
                  <Button size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Remove ${c.label}`} onClick={() => setStr({ conditionCharges: str.conditionCharges.filter((x) => x.id !== c.id) })}>
                    <Trash2 aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
            {!disabled ? (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setStr({ conditionCharges: [...str.conditionCharges, { id: newId("charge", str.conditionCharges.map((c) => c.id)), label: "Excess trash removal", amountCents: 0 }] })}>
                  <Plus aria-hidden /> Add a charge
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Extras and adjustments ──────────────────────────────────────────────────────────────────────────

function AdjustmentInput({ label, value, onChange, disabled, base }: { label: string; value: Adjustment; onChange: (value: Adjustment) => void; disabled: boolean; base: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
      <Segmented label={label} value={value.kind} disabled={disabled} options={[{ id: "percent", label: "Percent" }, { id: "fixed", label: "Amount" }]} onChange={(kind) => onChange({ kind, value: 0 })} />
      {value.kind === "percent" ? <NumberInput label="Percent" unit={`% of ${base}`} step={0.5} min={-100} disabled={disabled} value={value.value} onValue={(v) => onChange({ kind: "percent", value: v ?? 0 })} /> : <MoneyInput label="Amount" unit="per visit" cents={value.value} disabled={disabled} onCents={(c) => onChange({ kind: "fixed", value: c ?? 0 })} />}
    </div>
  );
}

/** An adjustment in a few words: "+20%", "−$15.00". */
function adjustmentWords(a: Adjustment, sign: "+" | "−"): string {
  return a.kind === "percent" ? `${sign}${a.value}%` : `${sign}${formatCents(a.value).replace("−", "")}`;
}

/**
 * One adjustment as a single row: an icon, its name, a switch, and when it is on, a tag that says what
 * it does ("+25%"). Its fields open beneath only when asked for. A card without a switch (minimum,
 * promotions) is a setting that is always in force; it opens the same way.
 */
function AdjustmentCard({ icon: Icon, title, short, tip, on, onToggle, summary, disabled, children }: { icon: LucideIcon; title: string; short: string; tip?: React.ReactNode; on?: boolean; onToggle?: (on: boolean) => void; summary: string; disabled: boolean; children: React.ReactNode }) {
  const id = useId();
  const switchable = onToggle !== undefined;
  const active = switchable ? Boolean(on) : true;
  const [open, setOpen] = useState(false);
  const expanded = active && open;
  return (
    <li className={cn("rounded-xl border bg-card transition-colors", switchable && active ? "border-brand-500/40" : "border-border")}>
      <div className="flex items-center gap-3 p-3">
        <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg transition-colors", switchable && !active ? "bg-muted text-muted-foreground" : "bg-brand-500/10 text-brand-300")}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-0.5">
            <span id={`${id}-title`} className="text-sm font-medium text-strong">
              {title}
            </span>
            {tip ? <InfoTip label={title}>{tip}</InfoTip> : null}
          </div>
          {active ? <span className="mt-0.5 inline-block max-w-full truncate rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-300">{summary}</span> : <span className="block truncate text-xs text-muted-foreground">{short}</span>}
        </div>
        {active ? (
          <button type="button" aria-expanded={expanded} aria-controls={expanded ? `${id}-body` : undefined} aria-label={`${expanded ? "Hide" : "Change"} ${title}`} onClick={() => setOpen((v) => !v)} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-overlay/[0.05] hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500/40">
            <ChevronDown aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          </button>
        ) : null}
        {switchable ? (
          <SwitchButton
            checked={active}
            disabled={disabled}
            labelledBy={`${id}-title`}
            onChange={(next) => {
              onToggle(next);
              setOpen(next);
            }}
          />
        ) : null}
      </div>
      {expanded ? (
        <div id={`${id}-body`} className="grid grid-cols-1 gap-4 border-t border-border p-4">
          {children}
        </div>
      ) : null}
    </li>
  );
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type AddOn = Spec["addOns"][number];

/**
 * One extra as a row: its name, price and time at a glance, and its fields beneath it when opened. A new
 * extra opens at once. An extra the service already includes shows "Included" instead of a price.
 */
function ExtraRow({ addOn: a, spec, disabled, startOpen, onChange, onRemove }: { addOn: AddOn; spec: Spec; disabled: boolean; startOpen: boolean; onChange: (patch: Partial<AddOn>) => void; onRemove: () => void }) {
  const id = useId();
  const [open, setOpen] = useState(startOpen);
  const covered = Boolean(a.coversItemId && spec.included.some((i) => i.id === a.coversItemId));
  const unit = a.per === "hour" ? "per hour" : a.per === "item" ? `per ${a.itemWord || "item"}` : "per visit";
  return (
    <li className="@container rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 p-2 pl-3">
        <button type="button" aria-expanded={open} aria-controls={open ? `${id}-body` : undefined} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left focus-visible:outline-2 focus-visible:outline-brand-500/40">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-strong">{a.label || "New extra"}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
              {covered ? <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success-foreground">Included</span> : <span className="rounded-full bg-brand-500/10 px-2 py-0.5 font-medium tabular-nums text-brand-300">{formatCents(a.priceCents)} {unit}</span>}
              <span className="text-muted-foreground">
                {a.laborMinutes} min{a.per === "visit" ? "" : " each"}
                {a.maxQuantity > 1 ? ` · up to ${a.maxQuantity}` : ""}
              </span>
            </span>
          </span>
          <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} />
        </button>
        <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove ${a.label || "this extra"}`} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      {open ? (
        <div id={`${id}-body`} className="grid grid-cols-1 gap-3 border-t border-border p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-end">
            <Field label="Extra">
              <TextInput value={a.label} disabled={disabled} placeholder="Inside the fridge" onChange={(e) => onChange({ label: e.target.value })} />
            </Field>
            <MoneyInput label="Price" unit={unit} cents={a.priceCents} disabled={disabled} onCents={(c) => onChange({ priceCents: c ?? 0 })} />
          </div>
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <label className="grid grid-cols-1 gap-1.5 text-sm">
              <span className="font-medium text-strong">Charged</span>
              <SelectInput disabled={disabled} className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={a.per} onChange={(e) => onChange({ per: e.target.value as AddOn["per"] })}>
                <option value="visit">Once per visit</option>
                <option value="item">Per item</option>
                <option value="hour">Per hour</option>
              </SelectInput>
            </label>
            {a.per === "item" ? (
              <Field label="Item">
                <TextInput disabled={disabled} value={a.itemWord ?? ""} onChange={(e) => onChange({ itemWord: e.target.value })} placeholder="window" />
              </Field>
            ) : null}
            <NumberInput label="Time" unit="minutes each" disabled={disabled} value={a.laborMinutes} onValue={(v) => onChange({ laborMinutes: v ?? 0 })} />
            <NumberInput label="Most per visit" min={1} disabled={disabled} value={a.maxQuantity} onValue={(v) => onChange({ maxQuantity: Math.max(1, v ?? 1) })} />
          </div>
          <LabeledField label="Already included as" tip="Link an extra to a task this service already includes and customers see it as included, never charged.">
            {(fieldId) => (
              <SelectInput id={fieldId} disabled={disabled} className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={a.coversItemId ?? ""} onChange={(e) => onChange({ coversItemId: e.target.value || undefined })}>
                <option value="">Not included: charge it</option>
                {spec.included.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.section ? `${i.section}: ` : ""}
                    {i.label}
                  </option>
                ))}
              </SelectInput>
            )}
          </LabeledField>
        </div>
      ) : null}
    </li>
  );
}

export function ExtrasStep({ spec, edit, disabled }: StepProps) {
  const m = spec.modifiers;
  const setM = (patch: Partial<Spec["modifiers"]>) => edit((s) => ({ ...s, modifiers: { ...s.modifiers, ...patch } }));
  const setAddOn = (id: string, patch: Partial<Spec["addOns"][number]>) => edit((s) => ({ ...s, addOns: s.addOns.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const [fresh, setFresh] = useState<string[]>([]);
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionTitle title="Extras" tip="Add-ons a customer can choose. Open one to change it." />
      <ul className="grid grid-cols-1 gap-2">
        {spec.addOns.map((a) => (
          <ExtraRow key={a.id} addOn={a} spec={spec} disabled={disabled} startOpen={fresh.includes(a.id) || !a.label} onChange={(patch) => setAddOn(a.id, patch)} onRemove={() => edit((s) => ({ ...s, addOns: s.addOns.filter((x) => x.id !== a.id) }))} />
        ))}
      </ul>
      {!disabled ? (
        <div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const id = newId("extra", spec.addOns.map((a) => a.id));
              setFresh((list) => [...list, id]);
              edit((s) => ({ ...s, addOns: [...s.addOns, { id, label: "", priceCents: 0, per: "visit", laborMinutes: 30, maxQuantity: 1 }] }));
            }}
          >
            <Plus aria-hidden /> Add an extra
          </Button>
        </div>
      ) : null}

      <SectionTitle title="Adjustments" tip="Switch on only what this service needs. Each one shows up in the price breakdown with its reason, in a fixed order." />
      <ul className="grid grid-cols-1 gap-2">
        <AdjustmentCard
          icon={RefreshCw}
          title="Recurring discounts"
          short="A discount for repeat schedules"
          tip="A discount on each visit for the schedules you offer. Schedules are real calendars: every 7 days is 4 or 5 visits in a month, not always 4."
          on={m.recurring.enabled}
          onToggle={(enabled) => setM({ recurring: { ...m.recurring, enabled } })}
          summary={m.recurring.options.length ? m.recurring.options.map((o) => `${scheduleLabel(o.schedule)} ${adjustmentWords(o.discount, "−")}`).join(" · ") : "No schedules picked yet"}
          disabled={disabled}
        >
          {SCHEDULES.map((schedule) => {
            const option = m.recurring.options.find((o) => o.schedule === schedule);
            return (
              <div key={schedule} className="grid items-end gap-2 sm:grid-cols-[12rem_1fr]">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={disabled} checked={Boolean(option)} onChange={(e) => setM({ recurring: { ...m.recurring, options: e.target.checked ? [...m.recurring.options, { schedule, discount: { kind: "percent", value: 0 } }] : m.recurring.options.filter((o) => o.schedule !== schedule) } })} />
                  {scheduleLabel(schedule)}
                </label>
                {option ? <NumberInput label="Discount" unit="% off each visit's cleaning" step={0.5} disabled={disabled} value={option.discount.value} onValue={(v) => setM({ recurring: { ...m.recurring, options: m.recurring.options.map((o) => (o.schedule === schedule ? { ...o, discount: { kind: "percent", value: v ?? 0 } } : o)) } })} /> : <span />}
              </div>
            );
          })}
        </AdjustmentCard>

        <AdjustmentCard
          icon={Gauge}
          title="Property condition"
          short="Price by how the home looks"
          tip="Price and time change separately, and both are shown. A level can send the job to a walkthrough instead of a price."
          on={m.condition.enabled}
          onToggle={(enabled) => setM({ condition: { ...m.condition, enabled } })}
          summary={`${m.condition.levels.length} level${m.condition.levels.length === 1 ? "" : "s"}`}
          disabled={disabled}
        >
          <ul className="grid grid-cols-1 gap-2">
            {m.condition.levels.map((level, i) => (
              <li key={level.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto] sm:items-end">
                <Field label={i === 0 ? "Level (first is the usual)" : "Level"}>
                  <TextInput disabled={disabled} value={level.label} onChange={(e) => setM({ condition: { ...m.condition, levels: m.condition.levels.map((l) => (l.id === level.id ? { ...l, label: e.target.value } : l)) } })} />
                </Field>
                <NumberInput label="Price" unit="%" min={-100} disabled={disabled || level.requiresWalkthrough} value={level.pricePercent} onValue={(v) => setM({ condition: { ...m.condition, levels: m.condition.levels.map((l) => (l.id === level.id ? { ...l, pricePercent: v ?? 0 } : l)) } })} />
                <NumberInput label="Time" unit="%" min={-100} disabled={disabled || level.requiresWalkthrough} value={level.timePercent} onValue={(v) => setM({ condition: { ...m.condition, levels: m.condition.levels.map((l) => (l.id === level.id ? { ...l, timePercent: v ?? 0 } : l)) } })} />
                <label className="inline-flex items-center gap-1.5 pb-2 text-sm">
                  <input type="checkbox" disabled={disabled} checked={level.requiresWalkthrough} onChange={(e) => setM({ condition: { ...m.condition, levels: m.condition.levels.map((l) => (l.id === level.id ? { ...l, requiresWalkthrough: e.target.checked } : l)) } })} /> Walkthrough
                </label>
              </li>
            ))}
          </ul>
        </AdjustmentCard>

        <AdjustmentCard
          icon={Sparkles}
          title="First-clean reset"
          short="More for the first visit"
          tip="For a home that has not been kept up to your standard yet. The first visit costs more and takes longer."
          on={m.firstClean.enabled}
          onToggle={(enabled) => setM({ firstClean: { ...m.firstClean, enabled } })}
          summary={`${adjustmentWords(m.firstClean.price, "+")} on the first visit`}
          disabled={disabled}
        >
          <AdjustmentInput label="First visit adds" value={m.firstClean.price} disabled={disabled} base="the base price" onChange={(price) => setM({ firstClean: { ...m.firstClean, price } })} />
          <NumberInput label="Extra time" unit="% longer" disabled={disabled} value={m.firstClean.timePercent} onValue={(v) => setM({ firstClean: { ...m.firstClean, timePercent: v ?? 0 } })} />
        </AdjustmentCard>

        <AdjustmentCard
          icon={MapPin}
          title="Service area or travel"
          short="Travel fees by postal code"
          tip="Groups of postal codes you already serve, each with a travel fee or a percent."
          on={m.area.enabled}
          onToggle={(enabled) => setM({ area: { ...m.area, enabled } })}
          summary={`${m.area.zones.length} area${m.area.zones.length === 1 ? "" : "s"}${m.area.outside === "refuse" ? " · others walkthrough" : ""}`}
          disabled={disabled}
        >
          {m.area.zones.map((zone) => (
            <div key={zone.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field label="Area name">
                  <TextInput disabled={disabled} value={zone.label} onChange={(e) => setM({ area: { ...m.area, zones: m.area.zones.map((z) => (z.id === zone.id ? { ...z, label: e.target.value } : z)) } })} />
                </Field>
                <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove ${zone.label}`} onClick={() => setM({ area: { ...m.area, zones: m.area.zones.filter((z) => z.id !== zone.id) } })}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <Field label="Postal codes" hint="Separate with commas.">
                <TextInput disabled={disabled} value={zone.postalCodes.join(", ")} onChange={(e) => setM({ area: { ...m.area, zones: m.area.zones.map((z) => (z.id === zone.id ? { ...z, postalCodes: e.target.value.split(/[,\s]+/).filter(Boolean) } : z)) } })} />
              </Field>
              <AdjustmentInput label="Adds" value={zone.adjustment} disabled={disabled} base="the cleaning" onChange={(adjustment) => setM({ area: { ...m.area, zones: m.area.zones.map((z) => (z.id === zone.id ? { ...z, adjustment } : z)) } })} />
            </div>
          ))}
          {!disabled ? (
            <div>
              <Button size="sm" variant="secondary" onClick={() => setM({ area: { ...m.area, zones: [...m.area.zones, { id: newId("area", m.area.zones.map((z) => z.id)), label: "Outer area", postalCodes: [], adjustment: { kind: "fixed", value: 0 } }] } })}>
                <Plus aria-hidden /> Add an area
              </Button>
            </div>
          ) : null}
          <Segmented label="A postal code in no area is" value={m.area.outside} disabled={disabled} options={[{ id: "standard", label: "Priced as standard" }, { id: "refuse", label: "Sent to a walkthrough" }]} onChange={(outside) => setM({ area: { ...m.area, outside } })} />
        </AdjustmentCard>

        <AdjustmentCard icon={Zap} title="Rush" short="Short-notice bookings" on={m.rush.enabled} onToggle={(enabled) => setM({ rush: { ...m.rush, enabled } })} summary={adjustmentWords(m.rush.adjustment, "+")} disabled={disabled}>
          <AdjustmentInput label="Rush adds" value={m.rush.adjustment} disabled={disabled} base="the cleaning" onChange={(adjustment) => setM({ rush: { ...m.rush, adjustment } })} />
        </AdjustmentCard>

        <AdjustmentCard icon={MoonIcon} title="After hours" short="Outside your usual hours" on={m.afterHours.enabled} onToggle={(enabled) => setM({ afterHours: { ...m.afterHours, enabled } })} summary={adjustmentWords(m.afterHours.adjustment, "+")} disabled={disabled}>
          <AdjustmentInput label="After hours adds" value={m.afterHours.adjustment} disabled={disabled} base="the cleaning" onChange={(adjustment) => setM({ afterHours: { ...m.afterHours, adjustment } })} />
        </AdjustmentCard>

        <AdjustmentCard
          icon={TrendingUp}
          title="Demand pricing"
          short="Off: prices never change with demand"
          tip="It reads only your own calendar and the days you mark, never anything about the customer. When a marked day and a busy day both apply, the larger is used, and never above your cap."
          on={m.demand.enabled}
          onToggle={(enabled) => setM({ demand: { ...m.demand, enabled } })}
          summary={`Up to +${m.demand.capPercent}%${m.demand.peakDays.length ? ` · ${m.demand.peakDays.length} marked` : ""}${m.demand.busyDay.enabled ? " · busy days" : ""}${m.demand.endsOn ? ` · until ${m.demand.endsOn}` : ""}`}
          disabled={disabled}
        >
          <NumberInput label="Cap" unit="% most it can add" max={100} disabled={disabled} value={m.demand.capPercent} onValue={(v) => setM({ demand: { ...m.demand, capPercent: v ?? 0 } })} />
          <div className="grid grid-cols-1 gap-2">
            <p className="text-sm font-medium text-strong">Days you mark</p>
            {m.demand.peakDays.map((d) => (
              <div key={d.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
                  <Field label="Name">
                    <TextInput disabled={disabled} value={d.label} onChange={(e) => setM({ demand: { ...m.demand, peakDays: m.demand.peakDays.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)) } })} />
                  </Field>
                  <NumberInput label="Adds" unit="%" disabled={disabled} value={d.percent} onValue={(v) => setM({ demand: { ...m.demand, peakDays: m.demand.peakDays.map((x) => (x.id === d.id ? { ...x, percent: v ?? 0 } : x)) } })} />
                  <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove ${d.label}`} onClick={() => setM({ demand: { ...m.demand, peakDays: m.demand.peakDays.filter((x) => x.id !== d.id) } })}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <fieldset className="flex flex-wrap gap-1.5 text-sm" disabled={disabled}>
                  <legend className="sr-only">Weekdays</legend>
                  {WEEKDAY_SHORT.map((w, i) => (
                    <label key={w} className={cn("cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500/40", d.weekdays.includes(i) ? "border-brand-500 bg-brand-500/10 font-medium text-strong" : "border-border text-muted-foreground")}>
                      <input type="checkbox" className="sr-only" checked={d.weekdays.includes(i)} onChange={(e) => setM({ demand: { ...m.demand, peakDays: m.demand.peakDays.map((x) => (x.id === d.id ? { ...x, weekdays: e.target.checked ? [...x.weekdays, i].sort() : x.weekdays.filter((y) => y !== i) } : x)) } })} />
                      {w}
                    </label>
                  ))}
                </fieldset>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="From (optional)">
                    <TextInput type="date" disabled={disabled} value={d.from ?? ""} onChange={(e) => setM({ demand: { ...m.demand, peakDays: m.demand.peakDays.map((x) => (x.id === d.id ? { ...x, from: e.target.value || null } : x)) } })} />
                  </Field>
                  <Field label="To (optional)">
                    <TextInput type="date" disabled={disabled} value={d.to ?? ""} onChange={(e) => setM({ demand: { ...m.demand, peakDays: m.demand.peakDays.map((x) => (x.id === d.id ? { ...x, to: e.target.value || null } : x)) } })} />
                  </Field>
                </div>
              </div>
            ))}
            {!disabled ? (
              <div>
                <Button size="sm" variant="secondary" onClick={() => setM({ demand: { ...m.demand, peakDays: [...m.demand.peakDays, { id: newId("peak", m.demand.peakDays.map((d) => d.id)), label: "Fridays", weekdays: [5], from: null, to: null, percent: 10 }] } })}>
                  <Plus aria-hidden /> Mark days
                </Button>
              </div>
            ) : null}
          </div>
          <Toggle label="When the day is already busy" tip="Reads how full that day's schedule is from your cleaners' availability." checked={m.demand.busyDay.enabled} disabled={disabled} onChange={(enabled) => setM({ demand: { ...m.demand, busyDay: { ...m.demand.busyDay, enabled } } })} />
          {m.demand.busyDay.enabled ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberInput label="Busy at" unit="% booked or more" max={100} disabled={disabled} value={m.demand.busyDay.thresholdPercent} onValue={(v) => setM({ demand: { ...m.demand, busyDay: { ...m.demand.busyDay, thresholdPercent: v ?? 85 } } })} />
              <NumberInput label="Adds" unit="%" max={100} disabled={disabled} value={m.demand.busyDay.percent} onValue={(v) => setM({ demand: { ...m.demand, busyDay: { ...m.demand.busyDay, percent: v ?? 0 } } })} />
            </div>
          ) : null}
          <LabeledField label="Stop on (optional)" tip="Demand pricing switches itself off after this date.">
            {(id) => <TextInput id={id} type="date" disabled={disabled} value={m.demand.endsOn ?? ""} onChange={(e) => setM({ demand: { ...m.demand, endsOn: e.target.value || null } })} />}
          </LabeledField>
        </AdjustmentCard>

        <AdjustmentCard
          icon={HandCoinsIcon}
          title="Promotions and how discounts combine"
          short="Offers and discount limits"
          summary={`${m.promotions.length} promotion${m.promotions.length === 1 ? "" : "s"} · ${m.discounts.stacking === "best_only" ? "larger discount only" : "discounts stack"} · at most ${m.discounts.maxTotalPercent}% off`}
          disabled={disabled}
        >
          <Segmented label="When a recurring discount and a promotion both apply" value={m.discounts.stacking} disabled={disabled} options={[{ id: "best_only", label: "Only the larger one" }, { id: "stack", label: "Both: recurring first" }]} onChange={(stacking) => setM({ discounts: { ...m.discounts, stacking } })} />
          <NumberInput label="Most a visit is ever discounted" unit="% of the cleaning" max={100} disabled={disabled} value={m.discounts.maxTotalPercent} onValue={(v) => setM({ discounts: { ...m.discounts, maxTotalPercent: v ?? 0 } })} />
          {m.promotions.map((promo) => (
            <div key={promo.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Field label="Promotion">
                  <TextInput disabled={disabled} value={promo.label} onChange={(e) => setM({ promotions: m.promotions.map((p) => (p.id === promo.id ? { ...p, label: e.target.value } : p)) })} />
                </Field>
                <Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Remove ${promo.label}`} onClick={() => setM({ promotions: m.promotions.filter((p) => p.id !== promo.id) })}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <AdjustmentInput label="Takes off" value={promo.discount} disabled={disabled} base="the cleaning" onChange={(discount) => setM({ promotions: m.promotions.map((p) => (p.id === promo.id ? { ...p, discount } : p)) })} />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Starts">
                  <TextInput type="date" disabled={disabled} value={promo.startsOn ?? ""} onChange={(e) => setM({ promotions: m.promotions.map((p) => (p.id === promo.id ? { ...p, startsOn: e.target.value || null } : p)) })} />
                </Field>
                <Field label="Ends">
                  <TextInput type="date" disabled={disabled} value={promo.endsOn ?? ""} onChange={(e) => setM({ promotions: m.promotions.map((p) => (p.id === promo.id ? { ...p, endsOn: e.target.value || null } : p)) })} />
                </Field>
              </div>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" disabled={disabled} checked={promo.approved} onChange={(e) => setM({ promotions: m.promotions.map((p) => (p.id === promo.id ? { ...p, approved: e.target.checked } : p)) })} /> Approved: it may be applied once this version is published
              </label>
            </div>
          ))}
          {!disabled ? (
            <div>
              <Button size="sm" variant="secondary" onClick={() => setM({ promotions: [...m.promotions, { id: newId("promo", m.promotions.map((p) => p.id)), label: "New customer offer", discount: { kind: "percent", value: 10 }, startsOn: null, endsOn: null, approved: false }] })}>
                <Plus aria-hidden /> Add a promotion
              </Button>
            </div>
          ) : null}
        </AdjustmentCard>

        <AdjustmentCard icon={ScaleIcon} title="Minimum charge and rounding" short="The least a visit costs" summary={`${m.minimumCents === null ? "No minimum" : `Minimum ${formatCents(m.minimumCents)}`} · ${m.rounding.stepCents ? `rounded ${m.rounding.mode === "up" ? "up " : ""}to ${formatCents(m.rounding.stepCents)}` : "no rounding"}`} disabled={disabled}>
          <MoneyInput label="Minimum charge" unit={`per ${spec.visitWord}`} cents={m.minimumCents} disabled={disabled} onCents={(minimumCents) => setM({ minimumCents })} hint="Leave empty for none." tip="Applied after discounts, before rounding." />
          <Segmented
            label="Round the final price"
            value={String(m.rounding.stepCents) as "0" | "100" | "500"}
            disabled={disabled}
            options={[
              { id: "0", label: "No rounding" },
              { id: "100", label: "To $1" },
              { id: "500", label: "To $5" },
            ]}
            onChange={(v) => setM({ rounding: { ...m.rounding, stepCents: Number(v) } })}
          />
          {m.rounding.stepCents ? <Segmented label="Direction" value={m.rounding.mode} disabled={disabled} options={[{ id: "nearest", label: "Nearest" }, { id: "up", label: "Always up" }]} onChange={(mode) => setM({ rounding: { ...m.rounding, mode } })} /> : null}
        </AdjustmentCard>
      </ul>
      <Problems spec={spec} prefix="addOns" />
      <Problems spec={spec} prefix="modifiers" />
    </div>
  );
}

export { PRICING_METHODS };
