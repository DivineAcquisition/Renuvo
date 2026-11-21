"use client";

/**
 * The builder's right column: the controls for whatever is selected in the preview or the left rail.
 * Words and layout are edited here. Prices, deposits, agreements, hours and areas are never edited here:
 * each says where it comes from and links there, so changing display words can't change what is sold.
 */
import Link from "next/link";
import { useId } from "react";

import { Field, SelectInput, TextArea, TextInput } from "@/components/app/form";
import { Notice, Segmented, Toggle } from "@/components/app/services/shared";
import { ArrowDown, ArrowSquareOut as ExternalLink, ArrowUp, Plus, Trash } from "@phosphor-icons/react";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

import {
  BACKGROUNDS,
  BUTTONS,
  defaultDefinition,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  LIMITS,
  RADII,
  SECTION_LABELS,
  SECTION_PLACES,
  STEP_LABELS,
  SURFACES,
  TYPOGRAPHY,
  TYPOGRAPHY_LABELS,
  type CustomQuestion,
  type Definition,
  type ExperienceKind,
  type SectionId,
  type StepId,
} from "../../../../convex/lib/booking/definition";
import { contrast } from "@/components/booking/theme";
import { Checkbox } from "@/components/ui/selection";

export type BuilderData = {
  kind: ExperienceKind;
  services: { key: string; id: string; name: string; category: string; summary: string; method: string; startingCents: number | null; version: number; included: { label: string; section: string | null }[]; promotions: { id: string; label: string; approved: boolean }[]; frequencies: string[] }[];
  settings: { handle: string | null; profile: { displayName: string; brandColor: string; accentColor: string; phone?: string; email?: string; website?: string }; paymentPolicies: { id: string; label: string; kind: string; percent?: number; cents?: number; balanceTerms: string }[]; agreements: { id: string; label: string }[]; scheduling: { mode: string; noticeHours: number; horizonDays: number; holdMinutes: number } };
  inherited: { timezone: string; serviceAreas: number; hours: { weekday: number; startMinute: number; endMinute: number }[]; canPayByCard: boolean; plan: string | null };
  canEdit: boolean;
  /** The size cards the preview shows now, worked out from the services. */
  sizeCards?: { key: string; label: string }[];
};

type Props = { def: Definition; change: (mutate: (draft: Definition) => void) => void; data: BuilderData; selected: string };

const RULES = "/app/agents/sales/booking-forms?panel=rules";

function Inherited({ title, children, href, label }: { title: string; children: React.ReactNode; href: string; label: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-sm">
      <p className="font-medium text-strong">{title}</p>
      <div className="mt-0.5 text-muted-foreground">{children}</div>
      <Link href={href} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand-300 hover:underline">
        {label} <ExternalLink className="size-3.5" aria-hidden />
      </Link>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <header>
        <h3 className="font-heading text-base tracking-tight text-strong">{title}</h3>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Count({ value, max }: { value: string; max: number }) {
  return <span className={cn("text-[11px] tabular-nums", value.length > max ? "text-destructive-foreground" : "text-muted-foreground")}>{value.length}/{max}</span>;
}

function Text({ label, value, max, onChange, area, disabled }: { label: string; value: string; max: number; onChange: (v: string) => void; area?: boolean; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <Field label={label} error={value.length > max ? `Keep it under ${max} characters.` : null}>
        {area ? <TextArea value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} /> : <TextInput value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
      </Field>
      <div className="text-right">
        <Count value={value} max={max} />
      </div>
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  return (
    <button type="button" onClick={onReset} className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-strong hover:underline">
      Reset to template
    </button>
  );
}

/** Move a row up or down: the keyboard way to reorder. */
function MoveButtons({ index, count, onMove, label }: { index: number; count: number; onMove: (from: number, to: number) => void; label: string }) {
  return (
    <span className="inline-flex gap-0.5">
      <button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
        <ArrowUp aria-hidden />
      </button>
      <button type="button" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
        <ArrowDown aria-hidden />
      </button>
    </span>
  );
}

function move<T>(list: T[], from: number, to: number) {
  const [row] = list.splice(from, 1);
  list.splice(to, 0, row);
}

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

// ── Panels ───────────────────────────────────────────────────────────────────────────────────────

function StepPanel({ def, change, data, step }: Props & { step: StepId }) {
  const index = def.steps.findIndex((s) => s.id === step);
  const s = def.steps[index];
  const template = defaultDefinition(data.kind).steps.find((x) => x.id === step)!;
  const available = (Object.keys(SECTION_PLACES) as SectionId[]).filter((id) => SECTION_PLACES[id].includes(step) && !s.sections.some((x) => x.id === id));
  return (
    <Panel title={`${STEP_LABELS[step]} step`} description="The words customers read on this step, and which optional blocks it shows.">
      <Text label="Headline" value={s.copy.title} max={LIMITS.title} onChange={(v) => change((d) => void (d.steps[index].copy.title = v))} />
      <Text label="Supporting text" value={s.copy.subtitle} max={LIMITS.subtitle} area onChange={(v) => change((d) => void (d.steps[index].copy.subtitle = v))} />
      <Text label="Main button" value={s.copy.button} max={LIMITS.button} onChange={(v) => change((d) => void (d.steps[index].copy.button = v))} />
      <div className="space-y-2">
        <p className="text-sm font-medium text-strong">Blocks on this step</p>
        {s.sections.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : null}
        <ul className="space-y-1.5">
          {s.sections.map((section, i) => (
            <li key={section.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className={cn("text-sm", section.hidden && "text-muted-foreground line-through")}>{SECTION_LABELS[section.id]}</span>
              <span className="flex items-center gap-1">
                <MoveButtons index={i} count={s.sections.length} label={SECTION_LABELS[section.id]} onMove={(from, to) => change((d) => move(d.steps[index].sections, from, to))} />
                <button type="button" onClick={() => change((d) => void (d.steps[index].sections[i].hidden = !d.steps[index].sections[i].hidden))} className={buttonVariants({ variant: "outline", size: "xs" })}>
                  {section.hidden ? "Show" : "Hide"}
                </button>
              </span>
            </li>
          ))}
        </ul>
        {available.length ? (
          <div className="flex flex-wrap gap-1.5">
            {available.map((id) => (
              <button key={id} type="button" onClick={() => change((d) => void d.steps[index].sections.push({ id, hidden: false }))} className={buttonVariants({ variant: "outline", size: "xs" })}>
                <Plus aria-hidden /> {SECTION_LABELS[id]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Step order: use the arrows in the steps list.</span>
        <ResetButton onReset={() => change((d) => void (d.steps[index] = structuredClone(template)))} />
      </div>
    </Panel>
  );
}

function ThemePanel({ def, change, data }: Props) {
  const t = def.theme;
  const brand = t.useCompanyBrand ? data.settings.profile.brandColor : t.brandColor;
  const ratio = contrast(brand, "#ffffff");
  return (
    <Panel title="Brand & look" description="Colors, type and surfaces. Text colors are adjusted automatically so they stay readable.">
      <Toggle label="Use the company's brand" description={`${data.settings.profile.displayName}'s colors and logo from the booking rules.`} checked={t.useCompanyBrand} onChange={(v) => change((d) => void (d.theme.useCompanyBrand = v))} />
      {t.useCompanyBrand ? (
        <Inherited title="Colors come from the company's public profile" href={`${RULES}`} label="Open booking rules">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block size-4 rounded" style={{ background: data.settings.profile.brandColor }} /> {data.settings.profile.brandColor}
            <span className="inline-block size-4 rounded" style={{ background: data.settings.profile.accentColor }} /> {data.settings.profile.accentColor}
          </span>
        </Inherited>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(["brandColor", "accentColor"] as const).map((key) => (
            <Field key={key} label={key === "brandColor" ? "Brand color" : "Accent color"}>
              <span className="flex items-center gap-2">
                <input type="color" aria-label={key === "brandColor" ? "Brand color" : "Accent color"} value={t[key]} onChange={(e) => change((d) => void (d.theme[key] = e.target.value))} className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-card" />
                <TextInput value={t[key]} maxLength={7} onChange={(e) => change((d) => void (d.theme[key] = e.target.value))} />
              </span>
            </Field>
          ))}
        </div>
      )}
      {ratio < 4.5 ? <Notice tone="warning" title="Light brand color">White text on this color is hard to read ({ratio.toFixed(1)}:1), so buttons use dark text and colored text is darkened.</Notice> : null}
      <Segmented label="Type" value={t.typography} options={TYPOGRAPHY.map((id) => ({ id, label: TYPOGRAPHY_LABELS[id] }))} onChange={(v) => change((d) => void (d.theme.typography = v))} />
      <Segmented label="Background" value={t.background} options={BACKGROUNDS.map((id) => ({ id, label: { glow: "Soft glow", plain: "Plain white", tinted: "Tinted" }[id] }))} onChange={(v) => change((d) => void (d.theme.background = v))} />
      <Segmented label="Cards" value={t.surface} options={SURFACES.map((id) => ({ id, label: { raised: "Raised", outlined: "Outlined", flat: "Flat" }[id] }))} onChange={(v) => change((d) => void (d.theme.surface = v))} />
      <Segmented label="Corners" value={t.radius} options={RADII.map((id) => ({ id, label: { rounded: "Rounded", soft: "Soft", square: "Square" }[id] }))} onChange={(v) => change((d) => void (d.theme.radius = v))} />
      <Segmented label="Buttons" value={t.buttonStyle} options={BUTTONS.map((id) => ({ id, label: { gradient: "Gradient", solid: "Solid", outline: "Solid flat" }[id] }))} onChange={(v) => change((d) => void (d.theme.buttonStyle = v))} />
      <Toggle label="Size illustrations" description="The small floor plans on the size cards." checked={t.showIllustrations} onChange={(v) => change((d) => void (d.theme.showIllustrations = v))} />
      <div className="flex justify-end border-t border-border pt-3">
        <ResetButton onReset={() => change((d) => void (d.theme = defaultDefinition(data.kind).theme))} />
      </div>
    </Panel>
  );
}

function HeaderPanel({ def, change, data }: Props) {
  const h = def.header;
  return (
    <Panel title="Header" description="The sticky bar at the top of every step.">
      <Inherited title="Name, logo, phone and website come from the company's public profile" href={RULES} label="Open booking rules">
        {data.settings.profile.displayName}
        {data.settings.profile.phone ? ` · ${data.settings.profile.phone}` : " · no phone set"}
      </Inherited>
      <Toggle label="Show the phone number" checked={h.showPhone} onChange={(v) => change((d) => void (d.header.showPhone = v))} />
      <Toggle label="Show the website link" checked={h.showWebsite} onChange={(v) => change((d) => void (d.header.showWebsite = v))} />
      <Toggle label="Show progress" description="Counts only the steps this customer will see." checked={h.showProgress} onChange={(v) => change((d) => void (d.header.showProgress = v))} />
      <Text label="Help label" value={h.helpLabel} max={LIMITS.button} onChange={(v) => change((d) => void (d.header.helpLabel = v))} />
      <div className="flex justify-end border-t border-border pt-3">
        <ResetButton onReset={() => change((d) => void (d.header = defaultDefinition(data.kind).header))} />
      </div>
    </Panel>
  );
}

function ServicesPanel({ def, change, data }: Props) {
  const offeredKeys = new Set(def.services.offered.map((o) => o.serviceKey));
  const addable = data.services.filter((s) => !offeredKeys.has(s.key));
  return (
    <Panel title="Services" description="Which published services this page offers, in what order, and which is featured.">
      <Inherited title="Prices, scope and questions come from Services & Pricing" href="/app/services" label="Open Services & Pricing">
        Editing a card&apos;s words never changes what is sold or what it costs.
      </Inherited>
      <ul className="space-y-1.5">
        {def.services.offered.map((o, i) => {
          const svc = data.services.find((s) => s.key === o.serviceKey);
          return (
            <li key={o.serviceKey} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="min-w-0">
                <span className={cn("block truncate text-sm font-medium text-strong", o.hidden && "text-muted-foreground line-through")}>{o.displayName || svc?.name || o.serviceKey}</span>
                <span className="block text-xs text-muted-foreground">{svc ? `${svc.category} · version ${svc.version}` : "Not published"}{def.services.featuredKey === o.serviceKey ? " · Featured" : ""}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <MoveButtons index={i} count={def.services.offered.length} label={o.displayName || svc?.name || "service"} onMove={(from, to) => change((d) => move(d.services.offered, from, to))} />
                <button type="button" onClick={() => change((d) => void (d.services.offered[i].hidden = !d.services.offered[i].hidden))} className={buttonVariants({ variant: "outline", size: "xs" })}>
                  {o.hidden ? "Show" : "Hide"}
                </button>
                <button type="button" aria-label={`Remove ${o.displayName || svc?.name}`} onClick={() => change((d) => {
                  d.services.offered.splice(i, 1);
                  if (d.services.featuredKey === o.serviceKey) d.services.featuredKey = null;
                })} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
                  <Trash aria-hidden />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      {addable.length ? (
        <Field label="Add a published service">
          <SelectInput value="" onChange={(e) => e.target.value && change((d) => void d.services.offered.push({ serviceKey: e.target.value, displayName: "", blurb: "", benefits: [], badge: "", hidden: false }))}>
            <option value="">Choose…</option>
            {addable.map((s) => (
              <option key={s.key} value={s.key}>
                {s.name} ({s.category})
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : data.services.length === 0 ? (
        <Notice tone="warning" title="No published services yet">Publish a service in Services & Pricing first.</Notice>
      ) : null}
      <Field label="Featured service">
        <SelectInput value={def.services.featuredKey ?? ""} onChange={(e) => change((d) => void (d.services.featuredKey = e.target.value || null))}>
          <option value="">None</option>
          {def.services.offered.map((o) => (
            <option key={o.serviceKey} value={o.serviceKey}>
              {o.displayName || data.services.find((s) => s.key === o.serviceKey)?.name || o.serviceKey}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Toggle label="Show extras on the selected card" checked={def.services.showExtras} onChange={(v) => change((d) => void (d.services.showExtras = v))} />
      <Toggle label="Show recurring schedules" description="Choosing one sends a request: recurring billing isn't connected yet." checked={def.services.showFrequencies} onChange={(v) => change((d) => void (d.services.showFrequencies = v))} />
    </Panel>
  );
}

function ServiceCardPanel({ def, change, data, serviceKey }: Props & { serviceKey: string }) {
  const index = def.services.offered.findIndex((o) => o.serviceKey === serviceKey);
  const svc = data.services.find((s) => s.key === serviceKey);
  if (index < 0) return <Notice tone="info" title="This card isn't on the page">Add the service under Services.</Notice>;
  const o = def.services.offered[index];
  return (
    <Panel title={svc?.name ?? "Service card"} description="How this service is presented. Its price and scope stay as published.">
      <Inherited title="Price comes from Services & Pricing" href={svc ? `/app/services/${svc.id}` : "/app/services"} label={`Open ${svc?.name ?? "the service"}`}>
        {svc?.startingCents ? `From $${(svc.startingCents / 100).toFixed(0)} · ` : ""}Version {svc?.version ?? "—"}. Customers see the engine&apos;s price for their property.
      </Inherited>
      <Text label="Display name" value={o.displayName} max={LIMITS.name} onChange={(v) => change((d) => void (d.services.offered[index].displayName = v))} />
      <Text label="One-line description" value={o.blurb} max={LIMITS.blurb} area onChange={(v) => change((d) => void (d.services.offered[index].blurb = v))} />
      <Text label="Card label (featured card only)" value={o.badge} max={30} onChange={(v) => change((d) => void (d.services.offered[index].badge = v))} />
      <Toggle label="Featured" checked={def.services.featuredKey === serviceKey} onChange={(v) => change((d) => void (d.services.featuredKey = v ? serviceKey : null))} />
      <div className="space-y-2">
        <p className="text-sm font-medium text-strong">Benefit lines</p>
        <p className="text-xs text-muted-foreground">Empty: the service&apos;s included scope is listed.</p>
        {o.benefits.map((b, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <TextInput aria-label={`Benefit ${i + 1}`} value={b} maxLength={LIMITS.benefit} onChange={(e) => change((d) => void (d.services.offered[index].benefits[i] = e.target.value))} />
            <MoveButtons index={i} count={o.benefits.length} label="benefit" onMove={(from, to) => change((d) => move(d.services.offered[index].benefits, from, to))} />
            <button type="button" aria-label="Remove benefit" onClick={() => change((d) => void d.services.offered[index].benefits.splice(i, 1))} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
              <Trash aria-hidden />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {o.benefits.length < LIMITS.benefits ? (
            <button type="button" onClick={() => change((d) => void d.services.offered[index].benefits.push(""))} className={buttonVariants({ variant: "outline", size: "xs" })}>
              <Plus aria-hidden /> Add a line
            </button>
          ) : null}
          {svc && o.benefits.length === 0 ? (
            <button type="button" onClick={() => change((d) => void (d.services.offered[index].benefits = svc.included.slice(0, 6).map((i) => (i.section ? `${i.section}: ${i.label}` : i.label).slice(0, LIMITS.benefit))))} className={buttonVariants({ variant: "outline", size: "xs" })}>
              Start from its scope
            </button>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function ComparisonPanel({ def, change, data }: Props) {
  const keys = def.services.offered.map((o) => o.serviceKey);
  return (
    <Panel title="Service comparison" description="A table customers open from the service step. Build it from what each service really includes.">
      <Text label="Link label" value={def.services.comparison.title} max={LIMITS.title} onChange={(v) => change((d) => void (d.services.comparison.title = v))} />
      <button
        type="button"
        onClick={() =>
          change((d) => {
            const rows = new Map<string, { group: string; included: string[] }>();
            for (const key of keys) for (const item of data.services.find((s) => s.key === key)?.included ?? []) rows.set(item.label, { group: item.section ?? "Everywhere", included: [...(rows.get(item.label)?.included ?? []), key] });
            d.services.comparison.rows = [...rows.entries()].slice(0, LIMITS.comparisonRows).map(([label, row]) => ({ label: label.slice(0, LIMITS.benefit), group: row.group.slice(0, LIMITS.name), included: row.included }));
          })
        }
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        Build from the services&apos; scope
      </button>
      <ul className="space-y-2">
        {def.services.comparison.rows.map((row, i) => (
          <li key={i} className="space-y-1.5 rounded-lg border border-border p-2.5">
            <div className="flex gap-1.5">
              <TextInput aria-label="Row" value={row.label} onChange={(e) => change((d) => void (d.services.comparison.rows[i].label = e.target.value))} />
              <button type="button" aria-label="Remove row" onClick={() => change((d) => void d.services.comparison.rows.splice(i, 1))} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                <Trash aria-hidden />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {keys.map((k) => {
                const on = row.included.includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} onClick={() => change((d) => void (d.services.comparison.rows[i].included = on ? row.included.filter((x) => x !== k) : [...row.included, k]))} className={cn("rounded-md border px-2 py-0.5 text-xs", on ? "border-brand-500 bg-brand-500/10 text-strong" : "border-border text-muted-foreground")}>
                    {data.services.find((s) => s.key === k)?.name ?? k}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => change((d) => void d.services.comparison.rows.push({ label: "New row", group: "Everywhere", included: [] }))} className={buttonVariants({ variant: "outline", size: "xs" })}>
        <Plus aria-hidden /> Add a row
      </button>
    </Panel>
  );
}

function ListPanel({ def, change, kind }: Props & { kind: "trust" | "faqs" | "nextSteps" }) {
  const words = { trust: { title: "Trust statements", description: "Short facts about the company. Each must be true, and you confirm it before it is published.", add: "Add a statement" }, faqs: { title: "Questions and answers", description: "Answers to what customers usually ask.", add: "Add a question" }, nextSteps: { title: "What happens next", description: "The steps after booking, shown at checkout and on the confirmation.", add: "Add a step" } }[kind];
  return (
    <Panel title={words.title} description={words.description}>
      {kind === "trust"
        ? def.content.trust.map((t, i) => (
            <div key={t.id} className="space-y-2 rounded-lg border border-border p-3">
              <TextInput aria-label="Statement" value={t.text} maxLength={LIMITS.trustText} onChange={(e) => change((d) => {
                d.content.trust[i].text = e.target.value;
                d.content.trust[i].confirmed = false;
              })} />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={t.confirmed} onCheckedChange={(checked) => change((d) => void (d.content.trust[i].confirmed = checked))} />
                  This is true for our company
                </label>
                <span className="flex items-center">
                  <MoveButtons index={i} count={def.content.trust.length} label="statement" onMove={(f, to) => change((d) => move(d.content.trust, f, to))} />
                  <button type="button" aria-label="Remove statement" onClick={() => change((d) => void d.content.trust.splice(i, 1))} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
                    <Trash aria-hidden />
                  </button>
                </span>
              </div>
            </div>
          ))
        : kind === "faqs"
          ? def.content.faqs.map((f, i) => (
              <div key={f.id} className="space-y-2 rounded-lg border border-border p-3">
                <TextInput aria-label="Question" value={f.question} maxLength={LIMITS.faqQuestion} onChange={(e) => change((d) => void (d.content.faqs[i].question = e.target.value))} />
                <TextArea aria-label="Answer" value={f.answer} maxLength={LIMITS.faqAnswer} onChange={(e) => change((d) => void (d.content.faqs[i].answer = e.target.value))} />
                <div className="flex justify-end">
                  <MoveButtons index={i} count={def.content.faqs.length} label="question" onMove={(f2, to) => change((d) => move(d.content.faqs, f2, to))} />
                  <button type="button" aria-label="Remove question" onClick={() => change((d) => void d.content.faqs.splice(i, 1))} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
                    <Trash aria-hidden />
                  </button>
                </div>
              </div>
            ))
          : def.content.nextSteps.map((n, i) => (
              <div key={n.id} className="space-y-2 rounded-lg border border-border p-3">
                <TextInput aria-label="Step title" value={n.title} maxLength={LIMITS.title} onChange={(e) => change((d) => void (d.content.nextSteps[i].title = e.target.value))} />
                <TextArea aria-label="Step text" value={n.body} maxLength={LIMITS.subtitle} onChange={(e) => change((d) => void (d.content.nextSteps[i].body = e.target.value))} />
                <div className="flex justify-end">
                  <MoveButtons index={i} count={def.content.nextSteps.length} label="step" onMove={(f2, to) => change((d) => move(d.content.nextSteps, f2, to))} />
                  <button type="button" aria-label="Remove step" onClick={() => change((d) => void d.content.nextSteps.splice(i, 1))} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
                    <Trash aria-hidden />
                  </button>
                </div>
              </div>
            ))}
      <button
        type="button"
        onClick={() =>
          change((d) => {
            if (kind === "trust" && d.content.trust.length < LIMITS.trust) d.content.trust.push({ id: uid("t"), text: "New statement", confirmed: false });
            if (kind === "faqs" && d.content.faqs.length < LIMITS.faqs) d.content.faqs.push({ id: uid("f"), question: "New question", answer: "The answer." });
            if (kind === "nextSteps" && d.content.nextSteps.length < LIMITS.nextSteps) d.content.nextSteps.push({ id: uid("n"), title: "New step", body: "" });
          })
        }
        className={buttonVariants({ variant: "outline", size: "xs" })}
      >
        <Plus aria-hidden /> {words.add}
      </button>
    </Panel>
  );
}

function SimpleTextPanel({ def, change, which }: Props & { which: "promo" | "outOfArea" | "request" }) {
  if (which === "promo") {
    return (
      <Panel title="Offer banner" description="A short line above the first steps. It is words only: an offer's discount must be an approved promotion in Services & Pricing.">
        <Text label="Banner text" value={def.content.promo.text} max={LIMITS.subtitle} area onChange={(v) => change((d) => void (d.content.promo.text = v))} />
      </Panel>
    );
  }
  if (which === "outOfArea") {
    return (
      <Panel title="Outside the service area" description="What a visitor sees when their ZIP code isn't one you serve.">
        <Inherited title="Service ZIP codes come from Business details" href="/app/settings/business" label="Open Business details">
          Not changed here.
        </Inherited>
        <Text label="Title" value={def.content.outOfAreaTitle} max={LIMITS.title} onChange={(v) => change((d) => void (d.content.outOfAreaTitle = v))} />
        <Text label="Text" value={def.content.outOfAreaBody} max={LIMITS.subtitle} area onChange={(v) => change((d) => void (d.content.outOfAreaBody = v))} />
        <Segmented label="What they can do" value={def.behavior.outOfArea} options={[{ id: "request", label: "Leave their details" }, { id: "contact_only", label: "Contact you directly" }]} onChange={(v) => change((d) => void (d.behavior.outOfArea = v))} />
      </Panel>
    );
  }
  return (
    <Panel title="Request received" description="What a customer reads after sending a request.">
      <Text label="Title" value={def.content.requestTitle} max={LIMITS.title} onChange={(v) => change((d) => void (d.content.requestTitle = v))} />
      <Text label="Text" value={def.content.requestBody} max={LIMITS.subtitle} area onChange={(v) => change((d) => void (d.content.requestBody = v))} />
    </Panel>
  );
}

function SizesPanel({ def, change, data }: Props) {
  return (
    <Panel title="Size step" description="The size cards come from the services' size bands, so each card always means a price. You can relabel them.">
      <Inherited title="Size ranges come from Services & Pricing" href="/app/services" label="Open Services & Pricing">
        A card&apos;s range changes only when a service&apos;s bands change.
      </Inherited>
      {(data.sizeCards ?? []).length === 0 ? <p className="text-sm text-muted-foreground">The offered services don&apos;t use size cards (they ask for rooms or an exact size, or nothing).</p> : null}
      {(data.sizeCards ?? []).map((card) => {
        const own = def.sizes.labels.find((l) => l.key === card.key);
        const upsert = (patch: { label?: string; sublabel?: string }) =>
          change((d) => {
            const row = d.sizes.labels.find((l) => l.key === card.key);
            if (row) Object.assign(row, patch);
            else d.sizes.labels.push({ key: card.key, label: "", sublabel: "", ...patch });
          });
        return (
          <div key={card.key} className="space-y-1.5 rounded-lg border border-border p-2.5">
            <p className="text-xs text-muted-foreground">{card.label}</p>
            <div className="grid grid-cols-2 gap-2">
              <TextInput aria-label={`Label for ${card.label}`} value={own?.label ?? ""} placeholder={card.label} onChange={(e) => upsert({ label: e.target.value })} />
              <TextInput aria-label={`Second line for ${card.label}`} value={own?.sublabel ?? ""} placeholder="e.g. 1–2 bedrooms" onChange={(e) => upsert({ sublabel: e.target.value })} />
            </div>
          </div>
        );
      })}
      <Text label="Larger-than title" value={def.sizes.customQuoteTitle} max={LIMITS.title} onChange={(v) => change((d) => void (d.sizes.customQuoteTitle = v))} />
      <Text label="Larger-than button" value={def.sizes.customQuoteButton} max={LIMITS.button} onChange={(v) => change((d) => void (d.sizes.customQuoteButton = v))} />
      <Field label="Send larger properties to a custom quote at (sq ft)" hint="Leave empty to let the services decide.">
        <TextInput inputMode="numeric" value={def.behavior.customQuoteAboveArea ?? ""} onChange={(e) => change((d) => void (d.behavior.customQuoteAboveArea = e.target.value ? Number(e.target.value.replace(/\D/g, "")) || null : null))} />
      </Field>
    </Panel>
  );
}

function QuestionsPanel({ def, change, data }: Props) {
  const qs = def.behavior.questions;
  const idBase = useId();
  return (
    <Panel title="Your questions" description="Asked on the details step. Pricing questions come from each service and are asked once, beside the service.">
      {qs.map((q, i) => (
        <QuestionEditor key={q.id} q={q} index={i} count={qs.length} earlier={qs.slice(0, i)} change={change} idBase={`${idBase}-${i}`} />
      ))}
      {qs.length < LIMITS.questions ? (
        <button type="button" onClick={() => change((d) => void d.behavior.questions.push({ id: uid("q"), label: "New question", help: "", type: "short_text", purpose: "general", required: false, options: [], max: 200 }))} className={buttonVariants({ variant: "outline", size: "xs" })}>
          <Plus aria-hidden /> Add a question
        </button>
      ) : null}
      <div className="flex justify-end border-t border-border pt-3">
        <ResetButton onReset={() => change((d) => void (d.behavior.questions = defaultDefinition(data.kind).behavior.questions))} />
      </div>
    </Panel>
  );
}

function QuestionEditor({ q, index, count, earlier, change }: { q: CustomQuestion; index: number; count: number; earlier: CustomQuestion[]; change: Props["change"]; idBase: string }) {
  const set = (mutate: (q: CustomQuestion) => void) => change((d) => mutate(d.behavior.questions[index]));
  return (
    <details className="group rounded-lg border border-border bg-card p-3" open={index === count - 1 && q.label === "New question"}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-strong">
          {q.label}
          {q.required ? " *" : ""}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{FIELD_TYPE_LABELS[q.type]}{q.purpose === "access" ? " · crew only" : ""}{q.showIf ? " · conditional" : ""}</span>
        </span>
        <span className="flex items-center" onClick={(e) => e.preventDefault()}>
          <MoveButtons index={index} count={count} label={q.label} onMove={(f, to) => change((d) => move(d.behavior.questions, f, to))} />
          <button type="button" aria-label={`Remove ${q.label}`} onClick={() => change((d) => void d.behavior.questions.splice(index, 1))} className={buttonVariants({ variant: "ghost", size: "icon-xs" })}>
            <Trash aria-hidden />
          </button>
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <Field label="Question">
          <TextInput value={q.label} maxLength={LIMITS.questionLabel} onChange={(e) => set((x) => void (x.label = e.target.value))} />
        </Field>
        <Field label="Help text">
          <TextInput value={q.help} maxLength={LIMITS.subtitle} onChange={(e) => set((x) => void (x.help = e.target.value))} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Answer type">
            <SelectInput value={q.type} onChange={(e) => set((x) => {
              x.type = e.target.value as CustomQuestion["type"];
              if ((x.type === "choice" || x.type === "multi_choice") && x.options.length < 2) x.options = ["Option 1", "Option 2"];
            })}>
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABELS[t]}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Who sees the answer">
            <SelectInput value={q.purpose} onChange={(e) => set((x) => void (x.purpose = e.target.value as CustomQuestion["purpose"]))}>
              <option value="general">The office</option>
              <option value="property">The office and crew</option>
              <option value="scheduling">Scheduling</option>
              <option value="access">Assigned crew only (access)</option>
            </SelectInput>
          </Field>
        </div>
        {q.type === "choice" || q.type === "multi_choice" ? (
          <Field label="Choices (one per line)">
            <TextArea value={q.options.join("\n")} onChange={(e) => set((x) => void (x.options = e.target.value.split("\n").slice(0, LIMITS.options)))} />
          </Field>
        ) : null}
        {q.type === "short_text" || q.type === "long_text" || q.type === "number" ? (
          <Field label={q.type === "number" ? "Highest number" : "Longest answer (characters)"}>
            <TextInput inputMode="numeric" value={q.max || ""} onChange={(e) => set((x) => void (x.max = Number(e.target.value.replace(/\D/g, "")) || 0))} />
          </Field>
        ) : null}
        <Toggle label="Required" checked={q.required} onChange={(v) => set((x) => void (x.required = v))} />
        <Field label="Show only when" hint="An earlier question's answer.">
          <SelectInput value={q.showIf?.kind === "answer_equals" ? `${q.showIf.questionId}::${q.showIf.value}` : ""} onChange={(e) => set((x) => {
            if (!e.target.value) delete x.showIf;
            else {
              const [questionId, value] = e.target.value.split("::");
              x.showIf = { kind: "answer_equals", questionId, value };
            }
          })}>
            <option value="">Always</option>
            {earlier.flatMap((p) => (p.type === "choice" || p.type === "multi_choice" ? p.options.map((o) => ({ value: `${p.id}::${o}`, label: `${p.label} is "${o}"` })) : p.type === "yes_no" ? [{ value: `${p.id}::true`, label: `${p.label} is yes` }] : [])).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
    </details>
  );
}

function BehaviorPanel({ def, change, data }: Props) {
  const b = def.behavior;
  const policy = data.settings.paymentPolicies.find((p) => p.id === b.paymentPolicyId);
  const promotions = data.services.filter((s) => def.services.offered.some((o) => o.serviceKey === s.key)).flatMap((s) => s.promotions.map((p) => ({ ...p, service: s.name })));
  return (
    <Panel title="Booking behavior" description="What finishing this page does. Each rule comes from the company's shared booking rules.">
      <Segmented
        label="When a customer finishes"
        value={b.mode}
        options={[
          { id: "instant", label: "Book instantly" },
          { id: "estimate_request", label: "Ask for an estimate" },
          { id: "walkthrough_request", label: "Ask for a walkthrough" },
        ]}
        onChange={(v) => change((d) => {
          d.behavior.mode = v;
          if (v !== "instant") d.behavior.paymentPolicyId = null;
        })}
      />
      {b.mode === "instant" ? (
        <Field label="Payment when booking" hint={policy ? `${policy.label}. ${policy.balanceTerms}` : "Nothing is charged online; the visit is invoiced as usual."}>
          <SelectInput value={b.paymentPolicyId ?? ""} onChange={(e) => change((d) => void (d.behavior.paymentPolicyId = e.target.value || null))}>
            <option value="">No payment online</option>
            {data.settings.paymentPolicies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      {b.mode === "instant" && policy && policy.kind !== "none" && !data.inherited.canPayByCard ? <Notice tone="warning" title="Card payments aren't set up">This page can&apos;t be published with a payment until Finance takes card payments.</Notice> : null}
      <Inherited title="Deposits and payment policies live in the booking rules" href={RULES} label="Open booking rules">
        {data.settings.paymentPolicies.length} polic{data.settings.paymentPolicies.length === 1 ? "y" : "ies"} defined.
      </Inherited>
      <Field label="Agreement to sign" hint="An approved customer template from Company Agreements, filled with each booking's facts.">
        <SelectInput value={b.agreementId ?? ""} onChange={(e) => change((d) => void (d.behavior.agreementId = e.target.value || null))}>
          <option value="">None</option>
          {data.settings.agreements.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Segmented label="Property details are taken" value={b.detailsTiming} options={[{ id: "before_payment", label: "Before payment" }, { id: "after_payment", label: "After payment" }]} onChange={(v) => change((d) => void (d.behavior.detailsTiming = v))} />
      {b.detailsTiming === "after_payment" ? <Notice tone="info" title="Paid bookings wait for their details">A visit is created only once the customer adds them. Until then the booking shows as &ldquo;payment received, details incomplete&rdquo;.</Notice> : null}
      <Field label="Apply a promotion" hint="Only approved promotions on the offered services, inside their dates.">
        <SelectInput value={b.promotionId ?? ""} onChange={(e) => change((d) => void (d.behavior.promotionId = e.target.value || null))}>
          <option value="">None</option>
          {promotions.map((p) => (
            <option key={`${p.service}-${p.id}`} value={p.id} disabled={!p.approved}>
              {p.label} ({p.service}){p.approved ? "" : " — not approved"}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Inherited title="Hours, notice, horizon and holds" href={RULES} label="Open booking rules">
        {data.inherited.hours.length ? `${data.inherited.hours.length} booking windows set in Business details.` : "No booking hours set: Monday to Saturday, 8 AM to 6 PM."} Notice {data.settings.scheduling.noticeHours}h · up to {data.settings.scheduling.horizonDays} days ahead · held {data.settings.scheduling.holdMinutes} min.
      </Inherited>
      <Toggle label="Tell the office about each request" checked={b.notifyOfficeOnRequest} onChange={(v) => change((d) => void (d.behavior.notifyOfficeOnRequest = v))} />
      <Toggle label="Allow recovery reminders" description="A person can send a customer who stopped part-way a link to finish. Nothing is sent automatically." checked={b.offerRecovery} onChange={(v) => change((d) => void (d.behavior.offerRecovery = v))} />
      <Field label="Campaign source" hint="Added to every booking this page starts, for attribution. No personal information.">
        <TextInput value={def.attribution.source} maxLength={60} onChange={(e) => change((d) => void (d.attribution.source = e.target.value))} />
      </Field>
      <Field label="Campaign name">
        <TextInput value={def.attribution.campaign} maxLength={80} onChange={(e) => change((d) => void (d.attribution.campaign = e.target.value))} />
      </Field>
      <Text label="Footer note" value={def.content.footerNote} max={LIMITS.footer} area onChange={(v) => change((d) => void (d.content.footerNote = v))} />
    </Panel>
  );
}

function PaymentPanel(props: Props) {
  return (
    <div className="space-y-6">
      <BehaviorPanel {...props} />
    </div>
  );
}

/** Picks the panel for what is selected. */
export function Inspector(props: Props) {
  const { selected } = props;
  if (selected === "theme") return <ThemePanel {...props} />;
  if (selected === "header") return <HeaderPanel {...props} />;
  if (selected === "services") return <ServicesPanel {...props} />;
  if (selected.startsWith("service:")) return <ServiceCardPanel {...props} serviceKey={selected.slice(8)} />;
  if (selected.startsWith("copy:")) return <StepPanel {...props} step={selected.slice(5) as StepId} />;
  if (selected === "section:comparison") return <ComparisonPanel {...props} />;
  if (selected === "section:trust") return <ListPanel {...props} kind="trust" />;
  if (selected === "section:faq") return <ListPanel {...props} kind="faqs" />;
  if (selected === "section:next_steps") return <ListPanel {...props} kind="nextSteps" />;
  if (selected === "section:promo_banner") return <SimpleTextPanel {...props} which="promo" />;
  if (selected === "section:included") return <Notice tone="info" title="What's included">This block lists the chosen service&apos;s included scope from Services & Pricing.</Notice>;
  if (selected === "content:outOfArea") return <SimpleTextPanel {...props} which="outOfArea" />;
  if (selected === "content:request") return <SimpleTextPanel {...props} which="request" />;
  if (selected === "sizes") return <SizesPanel {...props} />;
  if (selected === "questions") return <QuestionsPanel {...props} />;
  if (selected === "behavior" || selected === "payment" || selected === "agreement" || selected === "schedule") return <PaymentPanel {...props} />;
  return <Notice tone="info" title="Select something">Click a part of the preview, or choose from the list on the left.</Notice>;
}
