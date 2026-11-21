"use client";

/**
 * The service step, laid out as the reference's offer page: a centered heading, vertically stacked offer
 * cards with the featured one marked, a comparison a tap away, the selected card opening to its choices,
 * then the date and arrival-window picker. Every price on the page is the engine's, from the server.
 */
import { ArrowLeft, ArrowRight, CalendarBlank, CaretLeft, CaretRight, Check, Clock, Info, Minus, Moon, Plus, Sparkle, Sun, SunHorizon, X } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import { copyOf, sectionOn, useBooking, type SessionView } from "./context";
import { BottomBar, Editable, Notice, Pill, StepHeading } from "./parts";
import { TrustRow } from "./step-start";
import { money, moneyExact } from "./theme";
import { Checkbox } from "@/components/ui/selection";

type Offer = SessionView["offers"][number];

function useOffers() {
  const { def, view } = useBooking();
  return useMemo(() => {
    const out: (Offer & { pending: boolean })[] = [];
    for (const offered of def.services.offered) {
      if (offered.hidden) continue;
      const data = view?.offers.find((o) => o.serviceKey === offered.serviceKey);
      if (!data) continue;
      out.push({
        ...data,
        name: offered.displayName || data.serviceName,
        blurb: offered.blurb || data.summary,
        benefits: offered.benefits.length ? offered.benefits : data.included.slice(0, 6),
        badge: offered.badge,
        featured: def.services.featuredKey === offered.serviceKey,
        pending: false,
      });
    }
    return out;
  }, [def, view]);
}

function PriceLine({ offer }: { offer: Offer }) {
  if (offer.outcome === "firm" && offer.grandTotalCents !== null) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-[color:var(--bk-brand-text)] @3xl:text-4xl">{money(offer.grandTotalCents)}</span>
        <span className="text-sm text-[color:var(--bk-muted-text)]">total / {offer.per}</span>
      </div>
    );
  }
  if (offer.outcome === "estimate" && offer.grandTotalCents !== null) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-extrabold tracking-tight text-[color:var(--bk-brand-text)] @3xl:text-4xl">About {money(offer.grandTotalCents)}</span>
        <span className="text-sm text-[color:var(--bk-muted-text)]">estimate</span>
      </div>
    );
  }
  if (offer.outcome === "walkthrough") return <p className="text-xl font-bold text-[color:var(--bk-brand-text)]">{offer.fromCents ? `From ${money(offer.fromCents)}` : "Priced after a walkthrough"}</p>;
  return <p className="text-sm font-medium text-[color:var(--bk-muted-text)]">{offer.missing.length ? `Needs: ${offer.missing.join(", ")}` : "Choose this to see the price"}</p>;
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)} className="bk-btn-outline h-8 w-8">
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)} className="bk-btn-outline h-8 w-8">
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** The selected card's own choices: condition, frequency, how many, extras and the service's questions. */
function Choices({ offer }: { offer: Offer }) {
  const { view, actions } = useBooking();
  const sel = view?.selection?.serviceKey === offer.serviceKey ? view.selection : null;
  const [error, setError] = useState<string | null>(null);
  const update = async (patch: Partial<NonNullable<SessionView["selection"]>>) => {
    const base = sel ?? { serviceKey: offer.serviceKey, addOns: [], answers: view?.selection?.answers ?? {} };
    const next = { ...base, ...patch };
    const result = await actions.selectService({ serviceKey: offer.serviceKey, condition: next.condition, schedule: next.schedule, units: next.units, addOns: next.addOns, answers: next.answers });
    setError(result.ok ? null : result.why);
  };
  if (!sel) return null;
  const qty = (id: string) => sel.addOns.find((a) => a.id === id)?.quantity ?? 0;
  const setQty = (id: string, quantity: number) => void update({ addOns: [...sel.addOns.filter((a) => a.id !== id), ...(quantity > 0 ? [{ id, quantity }] : [])] });
  const chip = (active: boolean) => cn("rounded-lg border px-3 py-2 text-xs font-medium @2xl:text-sm", active ? "border-[var(--bk-brand)] bg-[rgb(var(--bk-brand-rgb)/0.1)] text-[color:var(--bk-brand-text)]" : "border-[color:var(--bk-hairline)] text-[color:var(--bk-muted-text)] hover:border-[rgb(var(--bk-brand-rgb)/0.4)]");
  return (
    <div className="space-y-4 border-t border-[color:var(--bk-hairline)] pt-4 bk-rise" onClick={(e) => e.stopPropagation()}>
      {offer.unitWord ? (
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">How many {offer.unitWord}s?</p>
          <Stepper value={sel.units ?? 0} min={1} max={30} label={`${offer.unitWord}s`} onChange={(n) => void update({ units: n })} />
        </div>
      ) : null}
      {offer.conditions.length ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--bk-muted-text)]">Condition</legend>
          <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
            {offer.conditions.map((c, i) => (
              <button key={c.id} type="button" aria-pressed={(sel.condition ?? offer.conditions[0].id) === c.id} onClick={() => void update({ condition: c.id })} className={chip((sel.condition ?? offer.conditions[0].id) === c.id || (!sel.condition && i === 0))}>
                {c.label}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {offer.frequencies.length ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--bk-muted-text)]">How often</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={!sel.schedule} onClick={() => void update({ schedule: undefined })} className={chip(!sel.schedule)}>
              One time
            </button>
            {offer.frequencies.map((f) => (
              <button key={f.schedule} type="button" aria-pressed={sel.schedule === f.schedule} onClick={() => void update({ schedule: f.schedule })} className={chip(sel.schedule === f.schedule)}>
                {f.label} · {f.discount}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {offer.extras.length ? (
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--bk-muted-text)]">Extras</legend>
          <div className="grid gap-2">
            {offer.extras.map((x) => {
              const n = qty(x.id);
              return (
                <div key={x.id} className={cn("flex items-center justify-between rounded-lg border px-3 py-2.5", n > 0 ? "border-[var(--bk-brand)] bg-[rgb(var(--bk-brand-rgb)/0.05)]" : "border-[color:var(--bk-hairline)]")}>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                    <Checkbox checked={n > 0} disabled={x.included} onCheckedChange={(checked) => setQty(x.id, checked ? 1 : 0)} />
                    <span className="truncate text-sm font-medium">{x.label}</span>
                    <span className="shrink-0 rounded-full border border-[color:var(--bk-hairline)] px-2 py-0.5 text-[10px]">{x.included ? "Included" : `+${money(x.priceCents)}${x.per === "item" ? ` per ${x.itemWord ?? "item"}` : x.per === "hour" ? " per hour" : ""}`}</span>
                  </label>
                  {n > 0 && x.max > 1 ? <Stepper value={n} min={0} max={x.max} label={x.itemWord ?? x.label} onChange={(q) => setQty(x.id, q)} /> : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {offer.questions.map((q) => {
        const answer = sel.answers[q.id];
        return (
          <div key={q.id} className="space-y-1.5 text-left">
            <p className="text-sm font-medium">
              {q.label}
              {q.required ? <span className="text-red-700"> *</span> : null}
            </p>
            {q.kind === "choice" ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <button key={o} type="button" aria-pressed={answer === o} className={chip(answer === o)} onClick={() => void update({ answers: { ...sel.answers, [q.id]: o } })}>
                    {o}
                  </button>
                ))}
              </div>
            ) : q.kind === "yes_no" ? (
              <div className="flex gap-2">
                {[true, false].map((b) => (
                  <button key={String(b)} type="button" aria-pressed={answer === b} className={chip(answer === b)} onClick={() => void update({ answers: { ...sel.answers, [q.id]: b } })}>
                    {b ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            ) : (
              <input className="bk-input" aria-label={q.label} inputMode={q.kind === "number" ? "numeric" : undefined} defaultValue={answer === undefined ? "" : String(answer)} onBlur={(e) => e.target.value !== "" && void update({ answers: { ...sel.answers, [q.id]: q.kind === "number" ? Number(e.target.value) : e.target.value } })} />
            )}
          </div>
        );
      })}
      {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function OfferCard({ offer, index }: { offer: Offer; index: number }) {
  const { view, actions, def } = useBooking();
  const selected = view?.selection?.serviceKey === offer.serviceKey;
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    if (selected || busy) return;
    setBusy(true);
    await actions.selectService({ serviceKey: offer.serviceKey, addOns: [], answers: view?.selection?.answers ?? {} });
    setBusy(false);
    window.setTimeout(() => document.getElementById("bk-schedule")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }), 120);
  };
  const card = (
    <div data-selected={selected} className={cn("bk-select-card cursor-pointer", offer.featured && "pt-1")} onClick={() => void choose()}>
      {selected ? null : null}
      <div className="space-y-4 px-5 pb-6 pt-6">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[rgb(var(--bk-brand-rgb)/0.1)] text-[color:var(--bk-brand-text)]">
            <Sparkle className="h-4 w-4" aria-hidden weight="duotone" />
          </span>
          {offer.request ? <Pill tone="muted">Request</Pill> : offer.dueNowCents > 0 && offer.dueNowCents < (offer.grandTotalCents ?? 0) ? <Pill>Deposit {money(offer.dueNowCents)} today</Pill> : offer.dueNowCents > 0 ? <Pill>Paid when booking</Pill> : <Pill>Pay after the visit</Pill>}
        </div>
        <div className="text-left">
          <Editable id={`service:${offer.serviceKey}`} label="this service's card">
            <h3 data-editable-text className="text-xl font-bold @3xl:text-2xl">{offer.name}</h3>
            <p data-editable-text className="text-xs text-[color:var(--bk-muted-text)] @3xl:text-sm">{offer.blurb}</p>
          </Editable>
        </div>
        <div className="text-left">
          <PriceLine offer={offer} />
          {offer.outcome === "firm" && offer.dueNowCents > 0 && offer.balanceCents > 0 ? (
            <div className="mt-2 space-y-0.5 rounded-md border border-[rgb(var(--bk-brand-rgb)/0.15)] bg-[rgb(var(--bk-brand-rgb)/0.05)] px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[color:var(--bk-muted-text)]">Pay today</span>
                <span className="font-semibold">{moneyExact(offer.dueNowCents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[color:var(--bk-muted-text)]">After the visit</span>
                <span className="font-semibold">{moneyExact(offer.balanceCents)}</span>
              </div>
            </div>
          ) : null}
          {offer.request ? <p className="mt-1.5 text-xs font-medium text-[color:var(--bk-brand-text)]">{offer.request}</p> : null}
        </div>
        <ul className="space-y-2 text-left">
          {offer.benefits.map((line) => (
            <li key={line} className="flex items-start gap-2 text-xs @3xl:text-sm">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bk-brand-text)]" aria-hidden weight="bold" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            void choose();
          }}
          className={cn("h-11 w-full text-sm @3xl:text-base", selected ? "bk-btn-outline" : "bk-btn")}
        >
          {busy ? "Working…" : selected ? (
            <>
              <Check className="h-4 w-4" aria-hidden weight="bold" /> Selected
            </>
          ) : (
            <>
              Choose {offer.name} <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </button>
        {selected ? <Choices offer={offer} /> : null}
      </div>
    </div>
  );
  if (!offer.featured || !offer.badge) return <div style={{ animationDelay: `${index * 40}ms` }}>{card}</div>;
  return (
    <div className="relative pt-4">
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2">
        <Pill tone="solid" className="px-4 py-1">
          <Sparkle className="h-3 w-3" aria-hidden weight="fill" /> {offer.badge}
        </Pill>
      </div>
      {card}
    </div>
  );
  void def;
}

function Comparison({ onClose }: { onClose: () => void }) {
  const { def, view } = useBooking();
  const offers = useOffers();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const groups = new Map<string, typeof def.services.comparison.rows>();
  for (const row of def.services.comparison.rows) groups.set(row.group || "Included", [...(groups.get(row.group || "Included") ?? []), row]);
  void view;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="bk-compare-title" className="bk-card max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="bk-compare-title" className="text-2xl font-semibold">{def.services.comparison.title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="bk-btn-outline h-9 w-9">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-[color:var(--bk-hairline)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bk-muted)]">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[color:var(--bk-muted-text)]">What&apos;s included</th>
                {offers.map((o) => (
                  <th key={o.serviceKey} className="w-28 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-[color:var(--bk-brand-text)]">
                    {o.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...groups.entries()].map(([group, rows]) => (
                <FragmentRows key={group} group={group} rows={rows} keys={offers.map((o) => o.serviceKey)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FragmentRows({ group, rows, keys }: { group: string; rows: { label: string; included: string[] }[]; keys: string[] }) {
  return (
    <>
      <tr className="border-y border-[color:var(--bk-hairline)] bg-[rgb(var(--bk-brand-rgb)/0.03)]">
        <td colSpan={keys.length + 1} className="px-3 py-2 text-xs font-bold">
          {group}
        </td>
      </tr>
      {rows.map((row) => (
        <tr key={row.label} className="border-b border-[color:var(--bk-hairline)]">
          <td className="px-3 py-2 text-xs @3xl:text-sm">{row.label}</td>
          {keys.map((k) => (
            <td key={k} className="px-3 py-2 text-center">
              {row.included.includes(k) ? <Check className="inline h-4 w-4 text-[color:var(--bk-brand-text)]" aria-label="Included" weight="bold" /> : <X className="inline h-4 w-4 text-zinc-400" aria-label="Not included" />}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PERIODS = { morning: { label: "Morning", Icon: Sun }, afternoon: { label: "Afternoon", Icon: SunHorizon }, evening: { label: "Evening", Icon: Moon } } as const;

/** The date and arrival-window picker. Times come from capacity on the server; a full day is marked in words. */
export function SchedulePicker({ onContinue, continueLabel, busy }: { onContinue: () => void; continueLabel: string; busy: boolean }) {
  const { token, view, actions } = useBooking();
  const days = useQuery(api.bookingSessions.days, token ? { token } : "skip");
  const [date, setDate] = useState<string | null>(view?.schedule?.date ?? null);
  const slots = useQuery(api.bookingSessions.slots, token && date ? { token, date } : "skip");
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<number | null>(null);
  const first = days?.days[0]?.date ?? null;
  const [month, setMonth] = useState<string | null>(null);
  const shown = month ?? (date ?? first)?.slice(0, 7) ?? null;

  const byDate = useMemo(() => new Map((days?.days ?? []).map((d) => [d.date, d.available])), [days]);
  const months = useMemo(() => [...new Set((days?.days ?? []).map((d) => d.date.slice(0, 7)))], [days]);
  if (!view) return null;

  const grid: (string | null)[] = [];
  if (shown) {
    const [y, m] = shown.split("-").map(Number);
    const firstWeekday = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
    for (let i = 0; i < firstWeekday; i += 1) grid.push(null);
    for (let d = 1; d <= daysIn; d += 1) grid.push(`${shown}-${String(d).padStart(2, "0")}`);
  }
  const monthLabel = shown ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${shown}-15T12:00:00Z`)) : "";
  const mi = shown ? months.indexOf(shown) : -1;
  const selectedTime = view.schedule?.startsAt ?? null;
  const preferredOnly = slots?.some((s) => s.preferredOnly) ?? !days?.capacity;
  const complete = Boolean(view.schedule && view.schedule.date === date);

  const pick = async (startsAt: number) => {
    setChoosing(startsAt);
    setError(null);
    const result = await actions.chooseTime(startsAt);
    setChoosing(null);
    if (!result.ok) setError(result.why);
  };

  return (
    <Editable id="schedule" label="the date and time picker" className="bk-card overflow-hidden">
      <div className="bg-gradient-to-r from-[rgb(var(--bk-brand-rgb)/0.1)] via-[rgb(var(--bk-brand-rgb)/0.05)] to-transparent p-5 pb-4 text-left">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <CalendarBlank className="h-5 w-5 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" /> Pick your date &amp; time
        </h2>
        <p className="mt-1 text-sm text-[color:var(--bk-muted-text)]">{preferredOnly ? "Choose a preferred time. The team confirms it with you." : "Times shown are open right now and held for you while you finish."}</p>
      </div>
      <div className="border-b border-[color:var(--bk-hairline)] p-4 @3xl:p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--bk-brand)] text-xs font-bold text-[color:var(--bk-on-brand)]">1</span> Select date
          </p>
          <div className="flex items-center gap-1">
            <button type="button" aria-label="Previous month" disabled={mi <= 0} onClick={() => setMonth(months[mi - 1])} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--bk-muted)] disabled:opacity-30">
              <CaretLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-[120px] text-center text-sm font-medium" aria-live="polite">
              {monthLabel}
            </span>
            <button type="button" aria-label="Next month" disabled={mi < 0 || mi >= months.length - 1} onClick={() => setMonth(months[mi + 1])} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--bk-muted)] disabled:opacity-30">
              <CaretRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        {days === undefined ? (
          <div className="grid grid-cols-7 gap-1" aria-busy="true">
            {Array.from({ length: 35 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-[var(--bk-muted)] motion-reduce:animate-none" />
            ))}
          </div>
        ) : (
          <>
            <div className="mb-2 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1 text-center text-xs font-medium text-[color:var(--bk-muted-text)]">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {grid.map((day, i) => {
                if (!day) return <div key={`p${i}`} className="aspect-square" />;
                const available = byDate.get(day);
                const disabled = available === undefined || available === false;
                const full = available === false;
                const isSelected = day === date;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={disabled}
                    aria-pressed={isSelected}
                    aria-label={`${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}${full ? ", full" : ""}`}
                    onClick={() => setDate(day)}
                    className={cn("relative grid aspect-square place-items-center rounded-lg text-sm font-medium transition-colors", disabled ? "cursor-not-allowed opacity-30" : "hover:bg-[rgb(var(--bk-brand-rgb)/0.1)]", isSelected && "bg-[var(--bk-brand)] text-[color:var(--bk-on-brand)] shadow-md hover:bg-[var(--bk-brand)]")}
                  >
                    {Number(day.slice(8))}
                    {full && !isSelected ? <span aria-hidden className="absolute bottom-1 h-1 w-1 rounded-full bg-rose-500" /> : null}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[11px] text-[color:var(--bk-muted-text)]">A red dot means that day is full.</p>
          </>
        )}
      </div>
      <div className="p-4 text-left @3xl:p-6">
        <p className="mb-4 flex items-center gap-2 text-sm font-semibold">
          <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs font-bold", date ? "bg-[var(--bk-brand)] text-[color:var(--bk-on-brand)]" : "bg-[var(--bk-muted)] text-[color:var(--bk-muted-text)]")}>2</span> Select arrival time
        </p>
        {!date ? (
          <div className="flex flex-col items-center py-8 text-[color:var(--bk-muted-text)]">
            <Clock className="mb-3 h-10 w-10 opacity-30" aria-hidden />
            <p className="text-sm">Select a date first to see times.</p>
          </div>
        ) : slots === undefined ? (
          <div className="grid grid-cols-4 gap-2" aria-busy="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-[var(--bk-muted)] motion-reduce:animate-none" />
            ))}
          </div>
        ) : !slots || slots.every((s) => !s.available) ? (
          <Notice tone="warn" title="This day is full">
            Every time on this date is taken. Please choose another day.
          </Notice>
        ) : (
          <div className="space-y-4">
            {(["morning", "afternoon", "evening"] as const).map((period) => {
              const rows = slots.filter((s) => s.period === period);
              if (!rows.length) return null;
              const { label, Icon } = PERIODS[period];
              return (
                <div key={period} className="space-y-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-[color:var(--bk-muted-text)]">
                    <Icon className="h-4 w-4" aria-hidden weight="duotone" /> {label}
                  </p>
                  <div className="grid grid-cols-4 gap-2 @2xl:grid-cols-5">
                    {rows.map((slot) => {
                      const isSelected = selectedTime === slot.startsAt;
                      return (
                        <button key={slot.startsAt} type="button" disabled={(!slot.available && !isSelected) || choosing !== null} aria-pressed={isSelected} aria-label={`${slot.windowLabel}${slot.available ? "" : ", taken"}`} title={slot.windowLabel} onClick={() => void pick(slot.startsAt)} className={cn("rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors", isSelected ? "border-[var(--bk-brand)] bg-[var(--bk-brand)] text-[color:var(--bk-on-brand)] shadow-md" : slot.available ? "border-[color:var(--bk-hairline)] hover:border-[rgb(var(--bk-brand-rgb)/0.5)] hover:bg-[var(--bk-muted)]" : "cursor-not-allowed border-[color:var(--bk-hairline)] bg-[var(--bk-muted)] opacity-40")}>
                          {choosing === slot.startsAt ? "…" : slot.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-[color:var(--bk-muted-text)]">The time is when the team arrives. The visit itself takes {view.quote ? `about ${Math.round((view.quote.elapsedMinutes / 60) * 2) / 2} hours` : "longer"}.</p>
          </div>
        )}
        {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      </div>
      <div className="border-t border-[color:var(--bk-hairline)] bg-gradient-to-r from-[var(--bk-muted)] to-white p-4 @3xl:p-6">
        <div className="flex flex-col items-center justify-between gap-4 @3xl:flex-row">
          <div className="text-center text-sm @3xl:text-left">
            {complete && view.schedule ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Pill>
                  <CalendarBlank className="h-3.5 w-3.5" aria-hidden /> {view.schedule.label}
                </Pill>
                <Pill>
                  <Clock className="h-3.5 w-3.5" aria-hidden /> {view.schedule.windowLabel}
                </Pill>
              </div>
            ) : (
              <p className="text-[color:var(--bk-muted-text)]">{date ? "Now choose an arrival time above." : "Select a date and time to continue."}</p>
            )}
          </div>
          <button type="button" onClick={onContinue} disabled={!complete || busy} className="bk-btn hidden h-12 min-w-[200px] px-6 @3xl:inline-flex">
            {busy ? "Working…" : continueLabel}
            <CaretRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>
    </Editable>
  );
}

export function ServiceStep() {
  const { def, view, actions, next, back } = useBooking();
  const copy = copyOf(def, "service").copy;
  const offers = useOffers();
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const quote = view?.quote;
  const scheduled = Boolean(view?.schedule);
  const canContinue = Boolean(view?.selection && quote && scheduled && (view.request || quote.outcome === "firm"));

  const proceed = async () => {
    if (!view || !quote) return;
    setBusy(true);
    setError(null);
    if (!view.request && quote.grandTotalCents !== null) {
      const accepted = await actions.acceptQuote(quote.inputHash, quote.grandTotalCents);
      if (!accepted.ok) {
        setBusy(false);
        return setError(accepted.why);
      }
    }
    setBusy(false);
    next();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 @3xl:space-y-8 @3xl:py-8">
      <StepHeading
        id="copy:service"
        title={copy.title}
        subtitle={copy.subtitle}
        size="lg"
        eyebrow={
          <div className="mb-3">
            <Pill>
              <Sparkle className="h-3.5 w-3.5" aria-hidden weight="fill" /> Prices for this property
            </Pill>
          </div>
        }
      />
      {sectionOn(def, "service", "promo_banner") && def.content.promo.text ? (
        <Editable id="section:promo_banner" label="the offer banner" className="mx-auto max-w-xl rounded-[var(--bk-radius)] border border-[rgb(var(--bk-brand-rgb)/0.3)] bg-[rgb(var(--bk-brand-rgb)/0.08)] p-3 text-center text-sm font-medium text-[color:var(--bk-brand-text)]">
          {def.content.promo.text}
        </Editable>
      ) : null}
      {sectionOn(def, "service", "comparison") && def.services.comparison.rows.length > 0 && offers.length > 1 ? (
        <Editable id="section:comparison" label="the comparison" className="flex justify-center">
          <button type="button" onClick={() => setCompare(true)} className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--bk-brand-rgb)/0.3)] bg-[rgb(var(--bk-brand-rgb)/0.04)] px-3 py-1.5 text-xs font-medium text-[color:var(--bk-brand-text)] hover:bg-[rgb(var(--bk-brand-rgb)/0.1)] @3xl:text-sm">
            <Info className="h-4 w-4" aria-hidden /> {def.services.comparison.title}
          </button>
        </Editable>
      ) : null}
      {view?.versionNotice ? <Notice tone="warn" title={view.versionNotice} /> : null}
      <div className="mx-auto grid max-w-xl gap-5 @3xl:gap-6">
        {offers.length === 0 ? <Notice tone="info" title="No services to show yet">{view ? "This page has no services that can be booked right now." : "Saving…"}</Notice> : offers.map((offer, i) => <OfferCard key={offer.serviceKey} offer={offer} index={i} />)}
      </div>
      {view?.selection && quote ? (
        <div id="bk-schedule" className="mx-auto max-w-4xl scroll-mt-28 bk-rise">
          {view.request && view.requestWords ? <div className="mx-auto mb-4 max-w-xl"><Notice tone="info" title={view.requestWords} /></div> : null}
          <SchedulePicker onContinue={() => void proceed()} continueLabel={copy.button || (view.request ? "Continue" : "Continue with this price")} busy={busy} />
        </div>
      ) : null}
      {error ? <div className="mx-auto max-w-xl"><Notice tone="bad" title={error} /></div> : null}
      {sectionOn(def, "service", "faq") && def.content.faqs.length ? <Faqs /> : null}
      {sectionOn(def, "service", "trust") ? <TrustRow /> : null}
      {back ? (
        <div className="hidden justify-center @3xl:flex">
          <button type="button" onClick={back} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[color:var(--bk-muted-text)] hover:bg-[var(--bk-muted)]">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        </div>
      ) : null}
      {compare ? <Comparison onClose={() => setCompare(false)} /> : null}
      <BottomBar onBack={back ?? undefined} onContinue={() => void proceed()} continueLabel={view?.request ? "Continue" : "Continue"} disabled={!canContinue} busy={busy} priceCents={quote?.outcome === "firm" ? quote.grandTotalCents : undefined} />
    </div>
  );
}

export function Faqs() {
  const { def } = useBooking();
  return (
    <Editable id="section:faq" label="questions and answers" className="mx-auto max-w-xl space-y-2">
      <h2 className="mb-2 text-center text-lg font-semibold">Questions</h2>
      {def.content.faqs.map((f) => (
        <details key={f.id} className="bk-card group p-4 text-left">
          <summary className="cursor-pointer list-none text-sm font-medium">
            <span className="flex items-center justify-between gap-2">
              {f.question}
              <Plus className="h-4 w-4 shrink-0 transition-transform group-open:rotate-45 motion-reduce:transition-none" aria-hidden />
            </span>
          </summary>
          <p className="mt-2 text-sm text-[color:var(--bk-muted-text)]">{f.answer}</p>
        </details>
      ))}
    </Editable>
  );
}
