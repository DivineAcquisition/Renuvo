"use client";

import type { FunctionReturnType } from "convex/server";

import { defaultInput, JobInputs } from "@/components/app/services/preview";
import { money } from "@/lib/app/format";

import type { api } from "../../../../convex/_generated/api";
import { startingCents } from "../../../../convex/lib/services/engine";
import type { Spec } from "../../../../convex/lib/services/spec";
import type { DraftBody, ServiceChoice } from "../../../../convex/lib/sales/draft";
import { ChoiceCard, Chip, FormSection, hoursWords } from "./kit";
import type { DraftData, Segment, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;
type Catalog = DraftData["catalog"];

const CATEGORY_FOR: Record<Segment, Spec["category"][]> = {
  residential: ["residential", "specialty", "post_construction"],
  commercial: ["commercial", "post_construction", "specialty"],
  office: ["commercial", "specialty"],
  str: ["short_term_rental", "property_management", "specialty"],
};

export function servicesFor(catalog: Catalog, segment: Segment) {
  const wanted = CATEGORY_FOR[segment];
  const matching = catalog.filter((s) => wanted.includes(s.category));
  return matching.length ? matching : catalog;
}

function ServicePicker({ name, catalog, choice, onChoose }: { name: string; catalog: Catalog; choice: ServiceChoice | undefined; onChoose: (choice: ServiceChoice) => void }) {
  if (catalog.length === 0) return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">No published services yet. Publish one in Services & Pricing to book it.</p>;
  return (
    <div role="radiogroup" aria-label="Service" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {catalog.map((service) => {
        const from = startingCents(service.spec);
        return (
          <ChoiceCard
            key={service.key}
            name={name}
            value={service.key}
            checked={choice?.key === service.key}
            onChange={() => onChoose({ key: service.key, input: choice?.key === service.key ? choice.input : defaultInput(service.spec) })}
            title={service.name}
            detail={service.spec.summary}
            meta={from !== null ? `From ${money(from)} / ${service.spec.visitWord}` : service.spec.pricing.method === "custom_quote" ? "Custom quote" : null}
          />
        );
      })}
    </div>
  );
}

function Scope({ spec }: { spec: Spec }) {
  return (
    <details className="rounded-xl border border-border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-strong">
        What’s included <span className="font-normal text-muted-foreground">({spec.included.length} tasks{spec.excluded.length ? `, ${spec.excluded.length} not included` : ""})</span>
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <ul className="grid gap-1 text-xs text-strong">
          {spec.included.map((item) => (
            <li key={item.id}>✓ {item.label}</li>
          ))}
        </ul>
        {spec.excluded.length ? (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {spec.excluded.map((item) => (
              <li key={item}>✕ {item}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

export function ServiceSection({ n, data, working, setBody, summary, done }: { n: number; data: DraftData; working: Working; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; done: boolean }) {
  const catalog = servicesFor(data.catalog, working.segment);
  const body = working.body;
  const spec = data.catalog.find((s) => s.key === body.service?.key)?.spec ?? null;
  const recurring = working.bookingKind === "recurring";
  const firstMode = body.firstVisit?.mode ?? "same";
  const firstSpec = data.catalog.find((s) => s.key === body.firstVisit?.service?.key)?.spec ?? null;
  const visit = summary?.mode === "booking" ? summary.visit : null;
  return (
    <FormSection n={n} id="service" title="Service & scope" lead={recurring ? "The visit that repeats, and what the first visit includes." : "What the customer is booking. Prices come from Services & Pricing."} done={done}>
      <ServicePicker name="service" catalog={catalog} choice={body.service} onChoose={(service) => setBody((b) => ({ ...b, service }))} />
      {spec && body.service ? (
        <>
          <JobInputs spec={spec} input={body.service.input} onInput={(input) => setBody((b) => ({ ...b, service: { key: b.service!.key, input } }))} fromBooking />
          {visit ? (
            <div className="flex flex-wrap gap-2">
              <Chip tone="brand">{hoursWords(visit.time.elapsedMinutes)} on site</Chip>
              <Chip>
                {visit.time.crewSize} cleaner{visit.time.crewSize === 1 ? "" : "s"} · {hoursWords(visit.time.laborMinutes)} of work
              </Chip>
              {spec.team.skills.map((skill) => (
                <Chip key={skill}>Needs: {skill}</Chip>
              ))}
              {visit.outcome === "estimate" ? <Chip tone="warning">Estimate</Chip> : null}
              {visit.outcome === "walkthrough" ? <Chip tone="danger">Needs a walkthrough</Chip> : null}
            </div>
          ) : null}
          {visit && visit.warnings.length ? (
            <ul className="grid gap-1 text-xs text-warning-foreground">
              {visit.warnings.map((w) => (
                <li key={w.code + w.message}>{w.message}</li>
              ))}
            </ul>
          ) : null}
          <Scope spec={spec} />
          {recurring ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-strong">First visit</legend>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
                <ChoiceCard name="first" value="same" checked={firstMode === "same"} onChange={() => setBody((b) => ({ ...b, firstVisit: { mode: "same" } }))} title="Same as the others" detail="The first visit is a regular visit." />
                <ChoiceCard name="first" value="first_clean" checked={firstMode === "first_clean"} onChange={() => setBody((b) => ({ ...b, firstVisit: { mode: "first_clean" } }))} title="First-clean price" detail={spec.modifiers.firstClean.enabled ? "Uses this service's first-clean rule." : "This service has no first-clean rule."} disabled={!spec.modifiers.firstClean.enabled} />
                <ChoiceCard name="first" value="different" checked={firstMode === "different"} onChange={() => setBody((b) => ({ ...b, firstVisit: { mode: "different", service: b.firstVisit?.service } }))} title="A different service" detail="For example a deep clean first." />
              </div>
              {firstMode === "different" ? (
                <div className="grid gap-3 rounded-xl border border-border p-3">
                  <ServicePicker name="first-service" catalog={catalog} choice={body.firstVisit?.service} onChoose={(service) => setBody((b) => ({ ...b, firstVisit: { mode: "different", service } }))} />
                  {firstSpec && body.firstVisit?.service ? <JobInputs spec={firstSpec} input={body.firstVisit.service.input} onInput={(input) => setBody((b) => ({ ...b, firstVisit: { mode: "different", service: { key: b.firstVisit!.service!.key, input } } }))} fromBooking compact /> : null}
                </div>
              ) : null}
              {summary?.mode === "booking" && summary.firstNote ? <p className="text-xs text-muted-foreground">{summary.firstNote}</p> : null}
            </fieldset>
          ) : null}
        </>
      ) : null}
    </FormSection>
  );
}
