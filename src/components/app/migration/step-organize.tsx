"use client";

/**
 * Step 3: confirm what each column is (with real values from the file beside it), how dates are written,
 * the business timezone, and which Selestial service each old service name is. Suggestions are marked as
 * such; nothing is used until the owner confirms it.
 */
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";

import { SelectInput } from "@/components/app/form";
import { Check, Sparkles } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import { FIELDS, guessMapping, IMPORTABLE, KIND_LABELS, type Importable } from "../../../../convex/lib/migration/rules";
import { plural, useMigration, type FileView } from "./context";
import { Note, Section, StepHeading } from "./parts";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export function OrganizeStep() {
  const { view } = useMigration();
  const files = view.files.filter((f) => f.status === "ready" && (IMPORTABLE as readonly string[]).includes(f.kind));
  const scheduled = files.some((f) => f.kind === "recurring" || f.kind === "bookings");
  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <StepHeading eyebrow="Step 3 of 6" title="Organize your information" lead="Confirm how Selestial reads your files. Suggestions are marked; each one shows the values it's based on." />
      {!files.length ? <Note>Add a file with customers, properties, recurring services or bookings first.</Note> : null}
      {files.map((file) => (
        <MappingEditor key={`${file.id}:${file.kind}:${JSON.stringify(file.mapping)}`} file={file} />
      ))}
      {scheduled ? <DatesAndTime /> : null}
      {view.migration.serviceNames.length ? <ServiceMatching /> : null}
    </div>
  );
}

function MappingEditor({ file }: { file: FileView }) {
  const { companyId, act, locked } = useMigration();
  const setMapping = useMutation(api.migration.setMapping);
  const kind = file.kind as Importable;
  const sample = useQuery(api.migration.rows, { companyId, kind, filter: "all", offset: 0, limit: 100 });
  const rows = useMemo(() => (sample?.rows ?? []).filter((r) => r.fileId === file.id).slice(0, 3), [sample, file.id]);
  const [mapping, setLocal] = useState<Record<string, number>>(file.mapping);
  const suggested = useMemo(() => guessMapping(kind, file.header), [kind, file.header]);
  const changed = JSON.stringify(mapping) !== JSON.stringify(file.mapping);
  const fields = FIELDS[kind];
  const missingRequired = fields.filter((f) => f.required === "always" && mapping[f.key] === undefined);
  const oneOf = fields.filter((f) => f.required === "one_of");
  const oneOfMissing = oneOf.length > 0 && oneOf.every((f) => mapping[f.key] === undefined);
  const unused = file.header.map((h, i) => ({ h, i })).filter(({ i }) => !Object.values(mapping).includes(i));

  function choose(key: string, value: string) {
    const next = { ...mapping };
    delete next[key];
    if (value !== "") {
      const index = Number(value);
      for (const [k, v] of Object.entries(next)) if (v === index) delete next[k];
      next[key] = index;
    }
    setLocal(next);
  }

  return (
    <Section
      title={`${file.name} · ${KIND_LABELS[kind].label}`}
      lead={file.mappingConfirmed && !changed ? "Columns confirmed." : "Check each field's column. Values from the first rows of your file are shown so you can see it's right."}
      action={
        file.mappingConfirmed && !changed ? (
          <Badge variant="success">
            <Check className="size-3" aria-hidden />
            Confirmed
          </Badge>
        ) : (
          <Button variant="primary" size="sm" disabled={locked || missingRequired.length > 0 || oneOfMissing} onClick={() => void act(() => setMapping({ companyId, fileId: file.id, mapping, confirm: true }))}>
            Confirm columns
          </Button>
        )
      }
    >
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[36rem] text-left text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Selestial field</th>
              <th scope="col" className="px-3 py-2 font-medium">Column in your file</th>
              <th scope="col" className="px-3 py-2 font-medium">First values</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {fields.map((field) => {
              const index = mapping[field.key];
              const fromSuggestion = index !== undefined && suggested[field.key] === index;
              return (
                <tr key={field.key} className="align-top">
                  <th scope="row" className="px-3 py-2 font-medium text-strong">
                    {field.label}
                    {field.required === "always" ? <span className="text-destructive-foreground"> *</span> : null}
                    {field.help ? <span className="mt-0.5 block font-normal text-muted-foreground">{field.help}</span> : null}
                  </th>
                  <td className="px-3 py-2">
                    <div className="grid gap-1">
                      <SelectInput aria-label={`Column for ${field.label}`} value={index === undefined ? "" : String(index)} disabled={locked} onChange={(e) => choose(field.key, e.target.value)}>
                        <option value="">Not in my file</option>
                        {file.header.map((h, i) => (
                          <option key={i} value={i}>
                            {h || `Column ${i + 1}`}
                          </option>
                        ))}
                      </SelectInput>
                      {fromSuggestion && !file.mappingConfirmed ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-brand-300">
                          <Sparkles className="size-3" aria-hidden />
                          Suggested from the column name
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{index === undefined ? "—" : rows.map((r) => r.cells[index]).filter(Boolean).slice(0, 3).join(" · ") || <span className="italic">empty in the first rows</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {missingRequired.length ? <Note tone="warning">Choose a column for {missingRequired.map((f) => f.label.toLowerCase()).join(", ")}. If your file doesn&apos;t have it, add it to the file and upload again.</Note> : null}
      {oneOfMissing ? <Note tone="warning">Choose a column for the customer&apos;s name, first name, or company name.</Note> : null}
      {unused.length ? <p className="text-[11px] text-muted-foreground">Not used: {unused.map((u) => u.h || `Column ${u.i + 1}`).join(", ")}. These stay in your original file, kept with the migration.</p> : null}
    </Section>
  );
}

function DatesAndTime() {
  const { view, save, locked } = useMigration();
  const info = view.migration.dateInfo;
  const order = view.migration.dateOrder ?? info?.inferred ?? null;
  const zones = ZONES.includes(view.migration.timezone) ? ZONES : [view.migration.timezone, ...ZONES];
  return (
    <Section title="Dates and times" lead="Selestial reads every date and time by rule, never by guessing. Confirm these so visits land on the right day and hour.">
      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid gap-2 rounded-xl border border-border p-3" disabled={locked}>
          <legend className="px-1 text-xs font-semibold text-strong">How your files write dates</legend>
          {(["mdy", "dmy"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-strong">
              <input type="radio" name="date-order" checked={order === value} onChange={() => void save({ dateOrder: value })} />
              {value === "mdy" ? "Month / day / year (03/04/2027 is March 4)" : "Day / month / year (03/04/2027 is April 3)"}
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">
            {view.migration.dateOrder
              ? "You chose this."
              : info?.proof
                ? `Read from your files: "${info.proof}" can only be ${info.inferred === "mdy" ? "month/day" : "day/month"}.`
                : info?.ambiguous
                  ? `${plural(info.ambiguous, "date")} could be read either way. Choose one.`
                  : "Your files use unambiguous dates, like 2027-03-04."}
          </p>
        </fieldset>
        <fieldset className="grid gap-2 rounded-xl border border-border p-3" disabled={locked}>
          <legend className="px-1 text-xs font-semibold text-strong">Your business timezone</legend>
          <SelectInput aria-label="Business timezone" value={view.migration.timezone} onChange={(e) => void save({ timezone: e.target.value, timezoneConfirmed: true })}>
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace("_", " ")}
              </option>
            ))}
          </SelectInput>
          {view.migration.timezoneConfirmed ? (
            <p className="flex items-center gap-1 text-[11px] text-success-foreground">
              <Check className="size-3" aria-hidden />
              Confirmed. A 9:00 AM visit in your file is booked at 9:00 AM {view.migration.timezone.split("/")[1]?.replace("_", " ")} time.
            </p>
          ) : (
            <Button variant="outline" size="sm" onClick={() => void save({ timezoneConfirmed: true })}>
              Confirm {view.migration.timezone.replace("_", " ")}
            </Button>
          )}
        </fieldset>
      </div>
    </Section>
  );
}

function ServiceMatching() {
  const { view, companyId, act, locked } = useMigration();
  const mapService = useMutation(api.migration.mapService);
  return (
    <Section title="Match your services" lead="Each booking and recurring service is matched to one of your Selestial services, which sets its checklist, crew and pricing rules.">
      {!view.services.length ? <Note tone="warning">You have no live services yet. Publish your services in Services & Pricing, then come back to match them.</Note> : null}
      <ul className="grid gap-2">
        {view.migration.serviceNames.map((entry) => {
          const mapped = view.migration.serviceMap.find((m) => m.name.toLowerCase() === entry.name.toLowerCase());
          const value = mapped ? (mapped.serviceId ?? "none") : (entry.suggested ?? "");
          return (
            <li key={entry.name} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center">
              <div>
                <p className="text-sm font-medium text-strong">&ldquo;{entry.name}&rdquo;</p>
                <p className="text-xs text-muted-foreground">
                  {plural(entry.rows, "row")} in your files
                  {!mapped && entry.suggested ? " · same name as your Selestial service, so it's matched; change it if that's wrong" : !mapped ? " · not matched yet" : ""}
                </p>
              </div>
              <SelectInput aria-label={`Selestial service for ${entry.name}`} value={value} disabled={locked || !view.services.length} onChange={(e) => void act(() => mapService({ companyId, name: entry.name, serviceId: e.target.value === "none" ? null : (e.target.value as (typeof view.services)[number]["id"]) }))}>
                <option value="" disabled>
                  Choose a service…
                </option>
                {view.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="none">Don&apos;t bring these visits</option>
              </SelectInput>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
