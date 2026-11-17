"use client";

import { useMemo, useState } from "react";

import { FileImage } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { CALCULATION_ORDER, priceSummary, quote as runQuote, scheduleDates, visitsByMonth, type Quote, type QuoteInput } from "../../../../convex/lib/services/engine";
import { DEFINITIONS, profitability, type Costs, type Profitability } from "../../../../convex/lib/services/profit";
import { CATEGORY_LABELS, SCHEDULES, type Spec } from "../../../../convex/lib/services/spec";
import { sampleInputs } from "../../../../convex/lib/services/store";
import { addOnWord, areaWord, minutesWords, scheduleLabel } from "../../../../convex/lib/services/words";
import { formatCents, NumberInput, Segmented, Stepper } from "./shared";

/** Sensible first inputs for a spec: the middle of its range, with every required question answered plainly. */
export function defaultInput(spec: Spec): QuoteInput {
  const samples = sampleInputs(spec);
  const first = samples[Math.min(1, samples.length - 1)]?.input ?? {};
  const level = spec.modifiers.condition.enabled ? spec.modifiers.condition.levels[0]?.id : undefined;
  return { ...first, ...(level ? { condition: level } : {}) };
}

/** The job's facts, shaped by how the service is priced. Only the inputs that matter are shown. */
export function JobInputs({ spec, input, onInput, compact }: { spec: Spec; input: QuoteInput; onInput: (input: QuoteInput) => void; compact?: boolean }) {
  const p = spec.pricing;
  const set = (patch: Partial<QuoteInput>) => onInput({ ...input, ...patch });
  const grid = compact ? "grid gap-3 sm:grid-cols-2" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className={grid}>
        {p.method === "size_bands" || p.method === "per_area" ? <NumberInput label="Property size" unit={areaWord(p.unit)} value={input.area ?? null} onValue={(area) => set({ area: area ?? undefined })} /> : null}
        {p.method === "bed_bath" ? (
          <>
            <Stepper label="Bedrooms" value={input.bedrooms ?? 0} onValue={(bedrooms) => set({ bedrooms })} max={20} />
            <Stepper label="Full bathrooms" value={input.bathrooms ?? 0} onValue={(bathrooms) => set({ bathrooms })} max={20} />
            <Stepper label="Half bathrooms" value={input.halfBaths ?? 0} onValue={(halfBaths) => set({ halfBaths })} max={10} />
          </>
        ) : null}
        {p.method === "per_unit" ? <Stepper label={`${p.unitWord[0]?.toUpperCase()}${p.unitWord.slice(1)}s`} value={input.units ?? 0} onValue={(units) => set({ units })} max={500} /> : null}
        {p.method === "hourly_per_cleaner" ? <NumberInput label="Expected cleaner-hours" unit="hours, all cleaners" step={0.25} value={input.laborMinutes === undefined ? null : input.laborMinutes / 60} onValue={(h) => set({ laborMinutes: h === null ? undefined : Math.round(h * 60) })} hint={`Usually ${minutesWords(p.estimatedLaborMinutes)}.`} /> : null}
        {p.method === "hourly_per_crew" ? <NumberInput label="Expected time on site" unit="hours" step={0.25} value={input.elapsedMinutes === undefined ? null : input.elapsedMinutes / 60} onValue={(h) => set({ elapsedMinutes: h === null ? undefined : Math.round(h * 60) })} hint={`Usually ${minutesWords(p.estimatedElapsedMinutes)}.`} /> : null}
        {p.method !== "hourly_per_crew" && p.method !== "recurring_package" ? <Stepper label="Cleaners" value={input.crewSize ?? spec.team.crewSize} onValue={(crewSize) => set({ crewSize })} min={1} max={12} /> : null}
        {spec.str?.enabled ? <Stepper label="Beds to make" value={input.beds ?? 0} onValue={(beds) => set({ beds })} max={30} /> : null}
        {spec.modifiers.condition.enabled ? (
          <label className="grid grid-cols-1 gap-1.5 text-sm">
            <span className="font-medium text-strong">Condition</span>
            <select className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={input.condition ?? spec.modifiers.condition.levels[0]?.id ?? ""} onChange={(event) => set({ condition: event.target.value })}>
              {spec.modifiers.condition.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                  {l.requiresWalkthrough ? " (walkthrough)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {spec.modifiers.recurring.enabled && p.method !== "recurring_package" ? (
          <label className="grid grid-cols-1 gap-1.5 text-sm">
            <span className="font-medium text-strong">How often</span>
            <select className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={input.schedule ?? ""} onChange={(event) => set({ schedule: (event.target.value || undefined) as QuoteInput["schedule"] })}>
              <option value="">One time</option>
              {spec.modifiers.recurring.options.map((o) => (
                <option key={o.schedule} value={o.schedule}>
                  {scheduleLabel(o.schedule)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {spec.modifiers.area.enabled ? (
          <label className="grid grid-cols-1 gap-1.5 text-sm">
            <span className="font-medium text-strong">Postal code</span>
            <input className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={input.postalCode ?? ""} onChange={(event) => set({ postalCode: event.target.value || undefined })} />
          </label>
        ) : null}
        {spec.modifiers.demand.enabled || spec.modifiers.promotions.length ? (
          <label className="grid grid-cols-1 gap-1.5 text-sm">
            <span className="font-medium text-strong">Visit date</span>
            <input type="date" className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={input.date ?? ""} onChange={(event) => set({ date: event.target.value || undefined })} />
          </label>
        ) : null}
        {spec.modifiers.demand.enabled && spec.modifiers.demand.busyDay.enabled ? <NumberInput label="How full the day is" unit="% booked" max={100} value={input.dayFullnessPercent ?? null} onValue={(v) => set({ dayFullnessPercent: v ?? undefined })} hint="Read from the schedule for a real visit." /> : null}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {spec.modifiers.firstClean.enabled && p.method !== "recurring_package" ? <Check label="First visit" checked={input.firstVisit === true} onChange={(firstVisit) => set({ firstVisit })} /> : null}
        {spec.modifiers.rush.enabled ? <Check label="Rush" checked={input.rush === true} onChange={(rush) => set({ rush })} /> : null}
        {spec.modifiers.afterHours.enabled ? <Check label="After hours" checked={input.afterHours === true} onChange={(afterHours) => set({ afterHours })} /> : null}
      </div>
      {spec.addOns.length ? (
        <fieldset className="grid grid-cols-1 gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">Extras</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {spec.addOns.map((a) => {
              const qty = input.addOns?.find((x) => x.id === a.id)?.quantity ?? 0;
              const setQty = (quantity: number) => set({ addOns: [...(input.addOns ?? []).filter((x) => x.id !== a.id), ...(quantity > 0 ? [{ id: a.id, quantity }] : [])] });
              return a.maxQuantity > 1 ? (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                  <span>
                    {a.label} <span className="text-xs text-muted-foreground">{formatCents(a.priceCents)} {addOnWord(a)}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" aria-label={`Fewer: ${a.label}`} className="size-7 rounded border border-border" onClick={() => setQty(Math.max(0, qty - 1))}>
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">{qty}</span>
                    <button type="button" aria-label={`More: ${a.label}`} className="size-7 rounded border border-border" onClick={() => setQty(Math.min(a.maxQuantity, qty + 1))}>
                      +
                    </button>
                  </span>
                </div>
              ) : (
                <Check key={a.id} label={`${a.label} (${formatCents(a.priceCents)} ${addOnWord(a)})`} checked={qty > 0} onChange={(on) => setQty(on ? 1 : 0)} />
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {spec.questions.length ? (
        <fieldset className="grid grid-cols-1 gap-2">
          <legend className="mb-1 text-sm font-medium text-strong">Quoting questions</legend>
          <div className={grid}>
            {spec.questions.map((q) => {
              const value = input.answers?.[q.id];
              const setAnswer = (answer: string | number | boolean | undefined) => {
                const answers = { ...(input.answers ?? {}) };
                if (answer === undefined || answer === "") delete answers[q.id];
                else answers[q.id] = answer;
                set({ answers });
              };
              return (
                <label key={q.id} className="grid grid-cols-1 gap-1.5 text-sm">
                  <span className="font-medium text-strong">
                    {q.label}
                    {q.required ? <span className="text-muted-foreground"> (required)</span> : null}
                  </span>
                  {q.kind === "choice" || q.kind === "yes_no" ? (
                    <select className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" value={String(value ?? "")} onChange={(event) => setAnswer(event.target.value || undefined)}>
                      <option value="">Not answered</option>
                      {(q.kind === "yes_no" ? ["yes", "no"] : q.options).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-strong" type={q.kind === "number" ? "number" : "text"} value={value === undefined ? "" : String(value)} onChange={(event) => setAnswer(q.kind === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value)} />
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-strong">
      <input type="checkbox" className="size-4 accent-[var(--color-brand-500)]" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

const OUTCOME: Record<Quote["outcome"], { label: string; tone: "success" | "info" | "warning" | "error" }> = {
  firm: { label: "Firm price", tone: "success" },
  estimate: { label: "Estimate", tone: "info" },
  walkthrough: { label: "Walkthrough needed", tone: "warning" },
  incomplete: { label: "Needs more information", tone: "error" },
};

/** The price, line by line, each with its reason. The total is the sum of the lines shown. */
export function QuoteLines({ result, showOrder }: { result: Quote; showOrder?: boolean }) {
  const counted = result.lines.filter((l) => l.kind !== "info" && l.kind !== "billed_later");
  const notes = result.lines.filter((l) => l.kind === "info" || l.kind === "billed_later");
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-heading text-3xl tabular-nums tracking-tight text-strong">
          {result.totalCents === null ? "—" : formatCents(result.totalCents)}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">per {result.per}</span>
        </p>
        <Badge variant={OUTCOME[result.outcome].tone} size="sm">
          {OUTCOME[result.outcome].label}
        </Badge>
      </div>
      {result.reasons.length ? (
        <ul className="grid grid-cols-1 gap-0.5 text-xs text-muted-foreground">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {counted.length ? (
        <table className="w-full text-sm">
          <caption className="sr-only">How the price is made</caption>
          <tbody>
            {counted.map((line) => (
              <tr key={line.key} className="border-t border-border first:border-t-0">
                <td className="py-1.5 pr-2 align-top">
                  <span className="text-strong">{line.label}</span>
                  <span className="block text-xs text-muted-foreground">{line.detail}</span>
                </td>
                <td className={cn("py-1.5 text-right align-top tabular-nums", line.amountCents < 0 ? "text-success-foreground" : "text-strong")}>{formatCents(line.amountCents)}</td>
              </tr>
            ))}
            {result.totalCents !== null ? (
              <tr className="border-t-2 border-border font-semibold">
                <td className="py-1.5 text-strong">Total</td>
                <td className="py-1.5 text-right tabular-nums text-strong">{formatCents(result.totalCents)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
      {notes.length ? (
        <ul className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
          {notes.map((line) => (
            <li key={line.key}>
              <span className="font-medium text-strong">{line.label}:</span> {line.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <Warnings warnings={result.warnings} />
      {showOrder ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer text-strong">The order every price is worked out in</summary>
          <ol className="mt-2 grid list-decimal gap-0.5 pl-5">
            {CALCULATION_ORDER.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

export function Warnings({ warnings }: { warnings: { code: string; severity: "critical" | "warning" | "info"; message: string }[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="grid grid-cols-1 gap-1.5">
      {warnings.map((w, i) => (
        <li key={`${w.code}-${i}`} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", w.severity === "critical" ? "border-destructive/30 bg-destructive/[0.06] text-strong" : w.severity === "warning" ? "border-warning/40 bg-warning/10 text-strong" : "border-border bg-muted/40 text-muted-foreground")}>
          <span className="font-medium">{w.severity === "critical" ? "Problem: " : w.severity === "warning" ? "Check: " : "Note: "}</span>
          {w.message}
        </li>
      ))}
    </ul>
  );
}

/** Costs and what remains, from the Owner's own numbers. Margin and markup, contribution and profit kept apart. */
export function ProfitPanel({ profit }: { profit: Profitability | null }) {
  if (!profit) return <p className="text-sm text-muted-foreground">There is no price to measure yet: the job needs more information or a walkthrough.</p>;
  const row = (label: string, value: string, detail?: string, strong?: boolean) => (
    <tr className="border-t border-border first:border-t-0">
      <td className="py-1.5 pr-2 align-top">
        <span className={strong ? "font-semibold text-strong" : "text-strong"}>{label}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </td>
      <td className={cn("py-1.5 text-right align-top tabular-nums", strong ? "font-semibold text-strong" : "text-strong")}>{value}</td>
    </tr>
  );
  return (
    <div className="grid grid-cols-1 gap-3">
      <table className="w-full text-sm">
        <caption className="sr-only">Costs and what remains</caption>
        <tbody>
          {row("Customer price", formatCents(profit.revenueCents), profit.visits !== 1 ? `Covers about ${profit.visits.toFixed(2)} visits (annual average)` : undefined)}
          {profit.costs.map((c) => row(c.label, `−${formatCents(c.cents)}`, c.detail))}
          {row("Direct costs", formatCents(profit.directCents))}
          {row("Contribution after direct costs", formatCents(profit.contributionCents), "What this job leaves before overhead, taxes and your own pay.", true)}
          {profit.overheadCents !== null ? row("Overhead allocated", `−${formatCents(profit.overheadCents)}`) : null}
          {profit.afterOverheadCents !== null ? row("Estimated operating profit before taxes", formatCents(profit.afterOverheadCents), undefined, true) : null}
        </tbody>
      </table>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="Margin" value={profit.contributionMarginPercent === null ? "—" : `${profit.contributionMarginPercent}%`} hint="of the price" />
        <Stat label="Markup" value={profit.markupPercent === null ? "—" : `${profit.markupPercent}%`} hint="on direct costs" />
        <Stat label="Per labor-hour" value={profit.perLaborHourCents === null ? "—" : formatCents(profit.perLaborHourCents)} hint="price ÷ cleaner-hours" />
        <Stat label="Floor price" value={profit.floorCents === null ? "Not set" : formatCents(profit.floorCents)} hint="for your floor margin" />
      </dl>
      {profit.targetCents !== null ? <p className="text-xs text-muted-foreground">Your target margin would need {formatCents(profit.targetCents)} for this job.</p> : null}
      <Warnings warnings={profit.warnings} />
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer text-strong">What these words mean</summary>
        <ul className="mt-2 grid gap-1">
          <li>{DEFINITIONS.margin}</li>
          <li>{DEFINITIONS.markup}</li>
          <li>{DEFINITIONS.contribution}</li>
          <li>{DEFINITIONS.afterOverhead}</li>
        </ul>
      </details>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums text-strong">{value}</dd>
      <dd className="text-[11px] text-muted-foreground">{hint}</dd>
    </div>
  );
}

/** What a customer reads: the description, the price with its unit, what is and is not included, and the extras. */
export function CustomerView({ spec, result }: { spec: Spec; result: Quote }) {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-brand-700 dark:text-brand-300">{CATEGORY_LABELS[spec.category]}</p>
        <h3 className="font-heading text-xl tracking-tight text-strong">{spec.name || "Unnamed service"}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{spec.summary || "No description yet."}</p>
        <p className="mt-2 text-sm font-medium text-strong">{priceSummary(spec)}</p>
      </div>
      <QuoteLines result={result} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium text-strong">Included</p>
          <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
            {spec.included.length ? spec.included.map((i) => <li key={i.id}>✓ {i.label}</li>) : <li>Nothing listed yet.</li>}
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium text-strong">Not included</p>
          <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
            {spec.excluded.length ? spec.excluded.map((e) => <li key={e}>– {e}</li>) : <li>Nothing listed yet.</li>}
          </ul>
        </div>
      </div>
      {spec.addOns.length ? (
        <div>
          <p className="text-sm font-medium text-strong">Extras</p>
          <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
            {spec.addOns.map((a) => (
              <li key={a.id}>
                {a.label}: {spec.included.some((i) => i.id === a.coversItemId) ? "included" : `${formatCents(a.priceCents)} ${addOnWord(a)}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** What the crew needs: time, crew, skills, the checklist by room, notes, and when to stop for a walkthrough. */
export function TeamView({ spec, result }: { spec: Spec; result: Quote }) {
  const sections = useMemo(() => {
    const groups = new Map<string, Spec["included"]>();
    for (const item of spec.included) groups.set(item.section ?? "General", [...(groups.get(item.section ?? "General") ?? []), item]);
    return [...groups.entries()];
  }, [spec.included]);
  return (
    <div className="grid grid-cols-1 gap-4 text-sm">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Crew" value={`${result.time.crewSize} cleaner${result.time.crewSize === 1 ? "" : "s"}`} hint="for this job" />
        <Stat label="On site" value={minutesWords(result.time.elapsedMinutes)} hint="elapsed time" />
        <Stat label="Labor" value={minutesWords(result.time.laborMinutes)} hint="all cleaners together" />
      </dl>
      {spec.team.skills.length ? <p className="text-muted-foreground">Only cleaners with {spec.team.skills.join(", ")} are offered it.</p> : null}
      <div>
        <p className="font-medium text-strong">Checklist</p>
        {sections.length ? (
          <div className="mt-1 grid gap-2">
            {sections.map(([section, items]) => (
              <div key={section}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{section}</p>
                <ul className="grid grid-cols-1 gap-0.5">
                  {items.map((i) => (
                    <li key={i.id} className="flex items-center gap-1.5 text-strong">
                      <span aria-hidden>☐</span> {i.label}
                      {i.requiresPhoto ? (
                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <FileImage aria-hidden className="size-3.5" /> photo
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No tasks yet. The checklist is made from the included tasks.</p>
        )}
      </div>
      {spec.teamNotes ? (
        <div>
          <p className="font-medium text-strong">Notes for the team</p>
          <p className="whitespace-pre-line text-muted-foreground">{spec.teamNotes}</p>
        </div>
      ) : null}
      {result.str ? (
        <div>
          <p className="font-medium text-strong">Turnover</p>
          <p className="text-muted-foreground">
            {result.str.linenSets} linen set{result.str.linenSets === 1 ? "" : "s"}, {result.str.loads} laundry load{result.str.loads === 1 ? "" : "s"}. Checkout {spec.str?.checkoutTime}, check-in {spec.str?.checkinTime} ({minutesWords(result.str.windowMinutes)} window).
          </p>
          {result.str.restock.length ? <p className="text-muted-foreground">Restock: {result.str.restock.map((r) => `${r.quantity} × ${r.label}`).join(", ")}.</p> : null}
        </div>
      ) : null}
      {spec.walkthroughNotes.length ? (
        <div>
          <p className="font-medium text-strong">Stop and ask for a walkthrough when</p>
          <ul className="grid grid-cols-1 gap-0.5 text-muted-foreground">
            {spec.walkthroughNotes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** A recurring schedule as it really falls: visits each month for a year, and the labeled annual average. */
export function ScheduleCalendar({ schedule, start }: { schedule: (typeof SCHEDULES)[number]; start: string }) {
  const months = visitsByMonth(scheduleDates(schedule, start, 12));
  const total = months.reduce((sum, m) => sum + m.visits, 0);
  return (
    <div className="grid grid-cols-1 gap-2 text-sm">
      <p className="text-muted-foreground">
        {scheduleLabel(schedule)} from {start}: {total} visits in 12 months, {(total / 12).toFixed(2)} a month on average.
      </p>
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {months.map((m) => (
          <li key={m.month} className="rounded-lg border border-border px-2 py-1 text-center">
            <span className="block text-[11px] text-muted-foreground">{new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short" })}</span>
            <span className="font-semibold tabular-nums text-strong">{m.visits}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const VIEWS = [
  { id: "customer", label: "What the customer sees" },
  { id: "team", label: "What your team needs" },
  { id: "costs", label: "Costs and earnings" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** The live preview beside the builder: the same engine, run here, so it is instant and free. */
export function ServicePreview({ spec, costs, canSeeCosts }: { spec: Spec; costs: Costs | null; canSeeCosts: boolean }) {
  const [view, setView] = useState<View>("customer");
  const [input, setInput] = useState<QuoteInput>(() => defaultInput(spec));
  const result = useMemo(() => runQuote(spec, input), [spec, input]);
  const profit = useMemo(() => (costs ? profitability(result, costs) : null), [result, costs]);
  return (
    <div className="grid grid-cols-1 gap-4">
      <Segmented label="Preview" value={view} options={VIEWS} onChange={setView} />
      <details className="rounded-xl border border-border bg-card p-3" open={view === "costs"}>
        <summary className="cursor-pointer text-sm font-medium text-strong">Example job</summary>
        <div className="mt-3">
          <JobInputs spec={spec} input={input} onInput={setInput} compact />
        </div>
      </details>
      <div className="rounded-xl border border-border bg-card p-4" aria-live="polite">
        {view === "customer" ? <CustomerView spec={spec} result={result} /> : view === "team" ? <TeamView spec={spec} result={result} /> : canSeeCosts ? <ProfitPanel profit={profit} /> : <p className="text-sm text-muted-foreground">Costs and earnings are the Owner&apos;s, like pay. You can see the price and the time.</p>}
      </div>
    </div>
  );
}
