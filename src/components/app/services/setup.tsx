"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { briefPath, SERVICES_ROOT } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Costs, Pay } from "../../../../convex/lib/services/profit";
import type { Context } from "../../../../convex/lib/services/schema";
import { CATEGORIES, CATEGORY_LABELS } from "../../../../convex/lib/services/spec";
import { MoneyInput, Notice, NumberInput, SectionTitle, Segmented, Toggle } from "./shared";
import { Checkbox, ChoiceChips } from "@/components/ui/selection";

const KINDS = [
  { id: "home", label: "Homes" },
  { id: "short_term_rental", label: "Short-term rentals" },
  { id: "property_manager", label: "Property managers" },
  { id: "commercial", label: "Offices and commercial" },
] as const;

/** "I'm not sure" beside an answer: it clears the answer and records it, so it becomes a stated assumption, never a guess. */
function Unsure({ field, context, setContext }: { field: string; context: Context; setContext: (c: Context) => void }) {
  const on = context.unsure.includes(field);
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Checkbox checked={on} onCheckedChange={(checked) => setContext({ ...context, unsure: checked ? [...context.unsure, field] : context.unsure.filter((u) => u !== field) })} />
      I&apos;m not sure
    </label>
  );
}

/**
 * What setup learns: where the company works, who it serves, its team, its costs and its strategy. These
 * are the Owner's internal assumptions, not prices, so they save directly. Research runs once on its own
 * when setup is finished, unless switched off here.
 */
export function PricingSetup() {
  const { companyId } = useCompany();
  const profile = useQuery(api.services.profile, { companyId });
  if (!profile) return <Skeleton className="h-96 rounded-2xl" />;
  if (!profile.canEdit) return <Notice>The Owner sets the company&apos;s costs and pricing strategy, like pay. You can read services and their prices.</Notice>;
  return <SetupForm key={profile.revision} profile={profile as typeof profile & { costs: Costs }} />;
}

function SetupForm({ profile }: { profile: NonNullable<ReturnType<typeof useQuery<typeof api.services.profile>>> & { costs: Costs } }) {
  const { companyId } = useCompany();
  const router = useRouter();
  const save = useMutation(api.services.saveProfile);
  const { busy, error, run } = useRun();
  const [context, setContext] = useState<Context>(profile.context);
  const [costs, setCosts] = useState<Costs>(profile.costs);
  const [strategy, setStrategy] = useState(profile.strategy);
  const [positioning, setPositioning] = useState(profile.positioning);
  const [research, setResearch] = useState(profile.researchDuringSetup);
  const [saved, setSaved] = useState(false);
  const firstTime = profile.setupCompletedAt === null;
  const unsure = (f: string) => context.unsure.includes(f);
  const pay = costs.pay;
  const setPay = (next: Pay | null) => setCosts({ ...costs, pay: next });
  const submit = (complete: boolean) =>
    run(async () => {
      const result = await save({ companyId, expectedRevision: profile.revision, context, costs, strategy, positioning, researchDuringSetup: research, completeSetup: complete });
      setSaved(true);
      if (result.research) router.push(briefPath(result.research.briefId));
      else if (complete) router.push(SERVICES_ROOT);
    });
  return (
    <div className="grid grid-cols-1 gap-6">
      <SectionTitle title="Pricing setup" tip="Every price is checked against what a visit costs you. An answer of “I'm not sure” becomes a stated assumption, never a made-up number.">Answer what you know. &ldquo;I&apos;m not sure&rdquo; is fine.</SectionTitle>

      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h3 className="font-heading text-base tracking-tight text-strong">Your business</h3>
        <div className="grid grid-cols-1 gap-1">
          <Field label="Where you work" hint="Cities, neighborhoods or postal codes.">
            <TextInput value={context.serviceAreas} disabled={unsure("serviceAreas")} onChange={(e) => setContext({ ...context, serviceAreas: e.target.value })} placeholder="Austin and Round Rock, TX" />
          </Field>
          <Unsure field="serviceAreas" context={context} setContext={setContext} />
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-strong">Who you clean for</legend>
          <ChoiceChips aria-label="Who you clean for" density="compact" options={KINDS.map((k) => ({ value: k.id, label: k.label }))} value={context.customerKinds} onValueChange={(next) => setContext({ ...context, customerKinds: next })} />
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-strong">Kinds of cleaning</legend>
          <ChoiceChips aria-label="Kinds of cleaning" density="compact" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} value={context.categories} onValueChange={(next) => setContext({ ...context, categories: next })} />
        </fieldset>
        <Field label="What you sell today" hint="In your own words, with prices if you have them.">
          <TextArea rows={2} value={context.currentServices} onChange={(e) => setContext({ ...context, currentServices: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-1">
          <Field label="Typical property sizes">
            <TextInput value={context.typicalSizes} disabled={unsure("typicalSizes")} onChange={(e) => setContext({ ...context, typicalSizes: e.target.value })} placeholder="Mostly 3 bed, 2 bath, 1,500–2,500 sq ft" />
          </Field>
          <Unsure field="typicalSizes" context={context} setContext={setContext} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h3 className="font-heading text-base tracking-tight text-strong">Your team and time</h3>
        <div className="grid grid-cols-1 gap-1">
          <Segmented label="How the team works" value={(context.teamStructure ?? "") as "solo" | "one_crew" | "several_crews" | ""} disabled={unsure("teamStructure")} options={[{ id: "solo", label: "Just me" }, { id: "one_crew", label: "One crew" }, { id: "several_crews", label: "Several crews" }]} onChange={(v) => setContext({ ...context, teamStructure: v || null })} />
          <Unsure field="teamStructure" context={context} setContext={setContext} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberInput label="Cleaners" unit="people" value={context.cleaners} onValue={(v) => setContext({ ...context, cleaners: v })} />
          <div className="grid grid-cols-1 gap-1">
            <NumberInput label="Typical cleaning time" unit="hours on site" step={0.25} disabled={unsure("typicalVisitMinutes")} value={context.typicalVisitMinutes === null ? null : context.typicalVisitMinutes / 60} onValue={(v) => setContext({ ...context, typicalVisitMinutes: v === null ? null : Math.round(v * 60) })} />
            <Unsure field="typicalVisitMinutes" context={context} setContext={setContext} />
          </div>
          <div className="grid grid-cols-1 gap-1">
            <NumberInput label="Visits a week now" unit="visits" disabled={unsure("bookingsPerWeek")} value={context.bookingsPerWeek} onValue={(v) => setContext({ ...context, bookingsPerWeek: v })} />
            <Unsure field="bookingsPerWeek" context={context} setContext={setContext} />
          </div>
          <div className="grid grid-cols-1 gap-1">
            <NumberInput label="Visits a week you could take" unit="visits" disabled={unsure("capacityPerWeek")} value={context.capacityPerWeek} onValue={(v) => setContext({ ...context, capacityPerWeek: v })} />
            <Unsure field="capacityPerWeek" context={context} setContext={setContext} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h3 className="font-heading text-base tracking-tight text-strong">Your costs</h3>
        <p className="-mt-2 text-sm text-muted-foreground">Used to show what each job leaves you. Only you see them. Leave anything empty you don&apos;t know: it is listed as missing, never counted as $0.</p>
        <div className="grid grid-cols-1 gap-1">
          <Segmented
            label="How cleaners are paid"
            value={(pay?.model ?? "") as "hourly" | "per_visit" | "revenue_share" | ""}
            disabled={unsure("compensation")}
            options={[
              { id: "hourly", label: "By the hour" },
              { id: "per_visit", label: "A set amount per visit" },
              { id: "revenue_share", label: "A share of the price" },
            ]}
            onChange={(model) => {
              setPay(model === "hourly" ? { model, hourlyCents: 0, burdenPercent: 0 } : model === "per_visit" ? { model, amountCents: 0 } : model === "revenue_share" ? { model, sharePercent: 0 } : null);
              setContext({ ...context, compensation: model || null });
            }}
          />
          <Unsure field="compensation" context={context} setContext={setContext} />
        </div>
        {pay?.model === "hourly" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MoneyInput label="Wage" unit="per cleaner per hour" cents={pay.hourlyCents} onCents={(c) => setPay({ ...pay, hourlyCents: c ?? 0 })} />
            <NumberInput label="Payroll costs on top" unit="% of the wage" value={pay.burdenPercent} onValue={(v) => setPay({ ...pay, burdenPercent: v ?? 0 })} hint="Employer taxes, insurance, benefits." />
          </div>
        ) : pay?.model === "per_visit" ? (
          <MoneyInput label="Pay" unit="per cleaner per visit" cents={pay.amountCents} onCents={(c) => setPay({ ...pay, amountCents: c ?? 0 })} />
        ) : pay?.model === "revenue_share" ? (
          <NumberInput label="Cleaner's share" unit="% of the visit price" value={pay.sharePercent} onValue={(v) => setPay({ ...pay, sharePercent: v ?? 0 })} />
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MoneyInput label="Supplies" unit="per visit" cents={costs.suppliesPerVisitCents} onCents={(c) => setCosts({ ...costs, suppliesPerVisitCents: c })} />
          <MoneyInput label="Travel" unit="per visit" cents={costs.travelPerVisitCents} onCents={(c) => setCosts({ ...costs, travelPerVisitCents: c })} hint="Mileage or time you pay for, not a fee you charge." />
          <MoneyInput label="Equipment" unit="per visit" cents={costs.equipmentPerVisitCents} onCents={(c) => setCosts({ ...costs, equipmentPerVisitCents: c })} />
          <MoneyInput label="Laundry" unit="per load" cents={costs.laundryPerLoadCents} onCents={(c) => setCosts({ ...costs, laundryPerLoadCents: c })} />
          <NumberInput label="Card fees" unit="% of the price" step={0.1} value={costs.paymentFeePercent} onValue={(v) => setCosts({ ...costs, paymentFeePercent: v })} />
          <MoneyInput label="Card fees, fixed" unit="per payment" cents={costs.paymentFeeFixedCents} onCents={(c) => setCosts({ ...costs, paymentFeeFixedCents: c })} />
          <MoneyInput label="Overhead" unit="per visit" cents={costs.overheadPerVisitCents} onCents={(c) => setCosts({ ...costs, overheadPerVisitCents: c })} hint="Rent, software, insurance, office pay, divided across your visits. Leave empty and results say “before overhead”." />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberInput label="Target margin" unit="% of the price" value={costs.targetMarginPercent} onValue={(v) => setCosts({ ...costs, targetMarginPercent: v })} />
          <NumberInput label="Floor margin" unit="% of the price" value={costs.floorMarginPercent} onValue={(v) => setCosts({ ...costs, floorMarginPercent: v })} hint="Prices leaving less are flagged." />
          <MoneyInput label="Minimum job" unit="per visit" cents={costs.minimumJobCents} onCents={(c) => setCosts({ ...costs, minimumJobCents: c })} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 rounded-2xl border border-border bg-card p-4 sm:p-6">
        <h3 className="font-heading text-base tracking-tight text-strong">Strategy</h3>
        <Segmented
          label="How you want to set prices"
          value={(strategy ?? "") as "cost_plus" | "positioning" | "market" | ""}
          options={[
            { id: "cost_plus", label: "From my costs", hint: "cost plus target margin" },
            { id: "positioning", label: "By positioning" },
            { id: "market", label: "By the local market" },
          ]}
          onChange={(v) => setStrategy(v || null)}
        />
        <div className="grid grid-cols-1 gap-1">
          <Segmented label="Where you want to sit" value={(positioning ?? "") as "value" | "standard" | "premium" | ""} disabled={unsure("positioning")} options={[{ id: "value", label: "Value" }, { id: "standard", label: "Standard" }, { id: "premium", label: "Premium" }]} onChange={(v) => setPositioning(v || null)} />
          <Unsure field="positioning" context={context} setContext={setContext} />
        </div>
        <p className="text-xs text-muted-foreground">Whatever you choose, prices below your floor are flagged. Strategy and research shape recommendations; the prices themselves are yours.</p>
        <Toggle label="Research during setup" description="When you finish setup, Selestial researches how comparable businesses where you work publish their services and prices: one brief, 10 Selestial Credits. Switch it off to skip." checked={research} onChange={setResearch} />
      </section>

      {profile.assumptions.length ? (
        <Notice title="What Selestial will assume">
          <ul className="grid grid-cols-1 gap-0.5">
            {profile.assumptions.map((a) => (
              <li key={a}>• {a}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <FormError message={error} />
      {saved && !busy ? <p role="status" className="text-sm text-muted-foreground">Saved.</p> : null}
      <div className="flex flex-wrap gap-2">
        {firstTime ? (
          <Button variant="primary" loading={busy} onClick={() => void submit(true)}>
            {research && context.serviceAreas.trim() ? "Finish setup and start research" : "Finish setup"}
          </Button>
        ) : null}
        <Button variant={firstTime ? "secondary" : "primary"} loading={busy && !firstTime} onClick={() => void submit(false)}>
          Save
        </Button>
      </div>
    </div>
  );
}
