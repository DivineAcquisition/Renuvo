"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Plus, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Skeleton } from "@/components/ui/skeleton";
import { SERVICES_ROOT } from "@/lib/app/services";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import { CALCULATION_ORDER, quote as runQuote, type Quote, type QuoteInput } from "../../../../convex/lib/services/engine";
import { profitability, type Costs } from "../../../../convex/lib/services/profit";
import type { Spec } from "../../../../convex/lib/services/spec";
import { minutesWords, scheduleLabel } from "../../../../convex/lib/services/words";
import { defaultInput, JobInputs, ProfitPanel, QuoteLines, ScheduleCalendar } from "./preview";
import { Empty, formatCents, Notice, SectionTitle } from "./shared";

type Services = NonNullable<ReturnType<typeof useQuery<typeof api.services.studio>>>["services"];
type Scenario = { key: number; label: string; serviceId: string; source: "live" | "draft"; input: QuoteInput };

const specOf = (services: Services, s: Scenario): Spec | null => {
  const row = services.find((x) => x.id === s.serviceId);
  return (s.source === "draft" ? row?.draft?.spec : row?.live?.spec) ?? row?.live?.spec ?? row?.draft?.spec ?? null;
};

/**
 * Test example jobs before anything is published. Every number comes from the same engine that prices
 * real visits, run here in the browser: it is instant, and it uses no credits.
 */
export function PricingStudio() {
  const { companyId } = useCompany();
  const data = useQuery(api.services.studio, { companyId });
  const profile = useQuery(api.services.profile, { companyId });
  if (!data) return <Skeleton className="h-96 rounded-2xl" />;
  if (data.services.length === 0) {
    return (
      <Empty title="Nothing to test yet" action={<Link href={`${SERVICES_ROOT}/new`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Add a service</Link>}>
        Pricing Studio prices example jobs with your services, live or still in draft.
      </Empty>
    );
  }
  return <Studio services={data.services} costs={data.canSeeCosts ? (profile?.costs ?? null) : null} canSeeCosts={data.canSeeCosts} />;
}

function Studio({ services, costs, canSeeCosts }: { services: Services; costs: Costs | null; canSeeCosts: boolean }) {
  const first = services[0];
  const firstSpec = (first.draft?.spec ?? first.live?.spec)!;
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [{ key: 1, label: "Job A", serviceId: first.id, source: first.live ? "live" : "draft", input: defaultInput(firstSpec) }]);
  const [counter, setCounter] = useState(2);
  const add = (scenario: Omit<Scenario, "key">) => {
    setScenarios((list) => [...list, { ...scenario, key: counter }].slice(0, 4));
    setCounter((c) => c + 1);
  };
  const base = scenarios[0];
  const baseSpec = specOf(services, base);
  const baseRow = services.find((s) => s.id === base.serviceId);
  const presets = [
    baseRow?.live && baseRow.draft ? { label: "Live vs draft", run: () => setScenarios([{ ...base, label: `Live v${baseRow.live!.version}`, source: "live" }, { ...base, key: counter, label: "Draft", source: "draft" }]) } : null,
    baseSpec?.modifiers.recurring.enabled && baseSpec.modifiers.recurring.options.length ? { label: "One-time vs recurring", run: () => setScenarios([{ ...base, label: "One time", input: { ...base.input, schedule: undefined } }, ...baseSpec.modifiers.recurring.options.slice(0, 3).map((o, i) => ({ ...base, key: counter + i, label: scheduleLabel(o.schedule), input: { ...base.input, schedule: o.schedule } }))]) } : null,
    { label: "Expected vs longer", run: () => setScenarios([{ ...base, label: "As expected", input: { ...base.input, timePercent: 100 } }, { ...base, key: counter, label: "30% longer", input: { ...base.input, timePercent: 130 } }]) },
    services.length > 1 ? { label: "Compare two services", run: () => setScenarios([base, { ...base, key: counter, label: services.find((s) => s.id !== base.serviceId)!.name, serviceId: services.find((s) => s.id !== base.serviceId)!.id, source: services.find((s) => s.id !== base.serviceId)!.live ? "live" : "draft", input: defaultInput(specOf(services, { ...base, serviceId: services.find((s) => s.id !== base.serviceId)!.id })!) }]) } : null,
  ].filter((p): p is { label: string; run: () => void } => p !== null);

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle title="Pricing Studio">Try example jobs. Nothing here changes a price: it shows what your services would charge and what each job would leave you.</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Button key={p.label} size="sm" variant="secondary" onClick={p.run}>
              {p.label}
            </Button>
          ))}
          {scenarios.length < 4 ? (
            <Button size="sm" variant="ghost" onClick={() => add({ ...base, label: `Job ${String.fromCharCode(65 + scenarios.length)}` })}>
              <Plus aria-hidden /> Add a job
            </Button>
          ) : null}
        </div>
      </div>
      {!canSeeCosts ? <Notice>Costs and margins are the Owner&apos;s, like pay. You see prices, time and crew.</Notice> : costs && costs.pay === null ? <Notice tone="warning" title="Labor cost is not entered">Margins leave labor out until you enter how cleaners are paid in Pricing setup.</Notice> : null}
      <Summary services={services} scenarios={scenarios} costs={costs} />
      <div className={cn("grid grid-cols-1 gap-4", scenarios.length > 1 && "md:grid-cols-2", scenarios.length > 2 && "2xl:grid-cols-4")}>
        {scenarios.map((s, i) => (
          <ScenarioCard
            key={s.key}
            services={services}
            scenario={s}
            costs={costs}
            onChange={(next) => setScenarios((list) => list.map((x, j) => (j === i ? next : x)))}
            onRemove={scenarios.length > 1 ? () => setScenarios((list) => list.filter((_, j) => j !== i)) : undefined}
          />
        ))}
      </div>
      <details className="rounded-xl border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium text-strong">How every price is worked out</summary>
        <ol className="mt-2 grid list-decimal gap-0.5 pl-5 text-muted-foreground">
          {CALCULATION_ORDER.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-2 text-muted-foreground">Every line is rounded to the cent when it is worked out, and the total is the sum of the lines shown. Selestial&apos;s assistant can explain a price; it never makes one.</p>
      </details>
    </div>
  );
}

function results(services: Services, s: Scenario, costs: Costs | null) {
  const spec = specOf(services, s);
  if (!spec) return null;
  const result = runQuote(spec, s.input);
  return { spec, result, profit: costs ? profitability(result, costs) : null };
}

/** Side by side, the few numbers that decide: price, unit, time on site, and what remains. */
function Summary({ services, scenarios, costs }: { services: Services; scenarios: Scenario[]; costs: Costs | null }) {
  if (scenarios.length < 2) return null;
  const rows = scenarios.map((s) => ({ s, r: results(services, s, costs) }));
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">Comparison</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="px-4 py-2 font-medium">Job</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Annual estimate</th>
            <th className="px-4 py-2 text-right font-medium">On site</th>
            {costs ? <th className="px-4 py-2 text-right font-medium">Margin</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, r }) => (
            <tr key={s.key} className="border-t border-border">
              <td className="px-4 py-2 text-strong">{s.label}</td>
              <td className="px-4 py-2 text-right tabular-nums text-strong">{r?.result.totalCents == null ? "—" : `${formatCents(r.result.totalCents)} / ${r.result.per}`}</td>
              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{annual(r?.result)}</td>
              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{r ? minutesWords(r.result.time.elapsedMinutes) : "—"}</td>
              {costs ? <td className="px-4 py-2 text-right tabular-nums text-strong">{r?.profit?.contributionMarginPercent == null ? "—" : `${r.profit.contributionMarginPercent}%`}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 pb-2 text-xs text-muted-foreground">Annual estimates use the real number of visits a schedule makes in a year (every 7 days is 52.18), labeled as an estimate.</p>
    </div>
  );
}

function annual(result: Quote | undefined): string {
  if (!result || result.totalCents === null) return "—";
  if (result.per === "month") return `${formatCents(result.totalCents * 12)} a year`;
  if (!result.schedule) return "One visit";
  return `About ${formatCents(Math.round(result.totalCents * result.schedule.visitsPerYear))} a year`;
}

function ScenarioCard({ services, scenario, costs, onChange, onRemove }: { services: Services; scenario: Scenario; costs: Costs | null; onChange: (s: Scenario) => void; onRemove?: () => void }) {
  const row = services.find((s) => s.id === scenario.serviceId);
  const r = useMemo(() => results(services, scenario, costs), [services, scenario, costs]);
  const [tab, setTab] = useState<"price" | "costs">("price");
  return (
    <section aria-label={scenario.label} className="grid grid-cols-1 content-start gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <input aria-label="Job name" className="min-w-0 flex-1 bg-transparent font-heading text-base tracking-tight text-strong outline-none focus-visible:underline" value={scenario.label} onChange={(e) => onChange({ ...scenario, label: e.target.value })} />
        {onRemove ? (
          <Button size="icon-xs" variant="ghost" aria-label={`Remove ${scenario.label}`} onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="grid grid-cols-1 gap-1.5 text-sm">
          <span className="font-medium text-strong">Service</span>
          <select
            className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm"
            value={scenario.serviceId}
            onChange={(e) => {
              const next = services.find((s) => s.id === e.target.value)!;
              const spec = (next.live?.spec ?? next.draft?.spec)!;
              onChange({ ...scenario, serviceId: next.id, source: next.live ? "live" : "draft", input: defaultInput(spec) });
            }}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid grid-cols-1 gap-1.5 text-sm">
          <span className="font-medium text-strong">Version</span>
          <select className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm" value={scenario.source} onChange={(e) => onChange({ ...scenario, source: e.target.value as "live" | "draft" })}>
            {row?.live ? <option value="live">Live (version {row.live.version})</option> : null}
            {row?.draft ? <option value="draft">Draft</option> : null}
          </select>
        </label>
      </div>
      {r ? (
        <>
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-strong">The job</summary>
            <div className="mt-3">
              <JobInputs spec={r.spec} input={scenario.input} onInput={(input) => onChange({ ...scenario, input })} compact />
              <label className="mt-3 grid gap-1.5 text-sm">
                <span className="font-medium text-strong">Time compared with usual</span>
                <input type="range" min={70} max={180} step={5} value={scenario.input.timePercent ?? 100} onChange={(e) => onChange({ ...scenario, input: { ...scenario.input, timePercent: Number(e.target.value) } })} aria-valuetext={`${scenario.input.timePercent ?? 100}% of the usual time`} />
                <span className="text-xs text-muted-foreground">{scenario.input.timePercent ?? 100}% of the usual time</span>
              </label>
            </div>
          </details>
          {costs ? (
            <div role="tablist" aria-label="Show" className="flex gap-1 rounded-lg border border-border p-1">
              {(["price", "costs"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("flex-1 rounded-md py-1 text-sm", tab === t ? "bg-brand-500/10 font-medium text-strong" : "text-muted-foreground")}>
                  {t === "price" ? "Price" : "Costs and earnings"}
                </button>
              ))}
            </div>
          ) : null}
          {tab === "price" || !costs ? (
            <>
              <QuoteLines result={r.result} />
              <p className="text-xs text-muted-foreground">
                {r.result.time.crewSize} cleaner{r.result.time.crewSize === 1 ? "" : "s"}, about {minutesWords(r.result.time.elapsedMinutes)} on site ({minutesWords(r.result.time.laborMinutes)} of labor).
              </p>
              {r.result.schedule ? <ScheduleCalendar schedule={r.result.schedule.schedule} start={scenario.input.date ?? new Date().toISOString().slice(0, 10)} /> : null}
            </>
          ) : (
            <ProfitPanel profit={r.profit} costs={costs} />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">That service has no version to test.</p>
      )}
    </section>
  );
}
