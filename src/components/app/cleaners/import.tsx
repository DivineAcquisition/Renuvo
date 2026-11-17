"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useRef, useState } from "react";

import { Submit } from "@/components/app/cleaners/forms";
import { plural } from "@/components/app/cleaners/shared";
import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, TextArea, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { CheckCircle2, FileSpreadsheet, TriangleAlert, XCircle } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { guessColumns, IMPORT_FIELDS, parseCsv, type ImportField } from "@/lib/app/cleaners";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";

type Engagement = "employee" | "contractor" | "subcontracted";
type Mapping = Partial<Record<ImportField, number>>;
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function rowsFrom(table: string[][], mapping: Mapping) {
  return table.slice(1, 501).map((cells) => {
    const get = (field: ImportField) => (mapping[field] === undefined ? undefined : cells[mapping[field]!]?.trim() || undefined);
    return { name: get("name") ?? "", preferredName: get("preferredName"), email: get("email"), phone: get("phone"), workerType: get("workerType"), skills: get("skills"), serviceAreas: get("serviceAreas"), subcontractor: get("subcontractor") };
  });
}

function Choose({ onTable }: { onTable: (table: string[][]) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const take = (value: string) => {
    const table = parseCsv(value);
    if (table.length < 2) return setError("The list needs a header row and at least one person.");
    if (table.length > 501) return setError("Import up to 500 people at a time. Split the list and import each part.");
    onTable(table);
  };
  return (
    <div className="grid gap-4">
      <button type="button" onClick={() => file.current?.click()} className="grid justify-items-center gap-2 rounded-2xl border border-dashed border-brand-500/40 bg-brand-500/5 px-6 py-8 text-center hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-500">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <FileSpreadsheet className="size-6" aria-hidden />
        </span>
        <span className="text-sm font-medium text-strong">Choose a CSV file</span>
        <span className="text-xs text-muted-foreground">Exported from a spreadsheet or another system. One person per row, with a header row.</span>
      </button>
      <input
        ref={file}
        type="file"
        accept=".csv,text/csv,text/plain,.tsv"
        className="sr-only"
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (!chosen) return;
          if (chosen.size > 2 * 1024 * 1024) return setError("That file is larger than 2 MB. Import up to 500 people at a time.");
          void chosen.text().then(take);
        }}
      />
      <Field label="Or paste the rows" hint="Copy from a spreadsheet, header row included.">
        <TextArea value={text} onChange={(event) => setText(event.target.value)} rows={5} placeholder={"Name,Phone,Email,Worker type,Service areas,Skills\nRosa Diaz,512-555-0100,rosa@example.com,Contractor,78701,Deep clean"} />
      </Field>
      <FormError message={error} />
      <div>
        <Button variant="primary" disabled={!text.trim()} onClick={() => take(text)}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function MapColumns({ table, mapping, setMapping, engagement, setEngagement, onBack, onNext }: { table: string[][]; mapping: Mapping; setMapping: (next: Mapping) => void; engagement: Engagement | ""; setEngagement: (value: Engagement | "") => void; onBack: () => void; onNext: () => void }) {
  const header = table[0];
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        {plural(table.length - 1, "row")} found. Check which column holds each detail. Columns not chosen are not imported.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {IMPORT_FIELDS.map((field) => (
          <Field key={field.key} label={`${field.label}${field.required ? "" : " (optional)"}`}>
            <SelectInput value={mapping[field.key] ?? ""} onChange={(event) => setMapping({ ...mapping, [field.key]: event.target.value === "" ? undefined : Number(event.target.value) })} required={field.required}>
              <option value="">Not in this list</option>
              {header.map((cell, index) => (
                <option key={index} value={index}>
                  {cell.trim() || `Column ${index + 1}`}
                  {table[1]?.[index] ? ` (e.g. ${table[1][index].slice(0, 24)})` : ""}
                </option>
              ))}
            </SelectInput>
          </Field>
        ))}
      </div>
      <Field label="Worker type for rows that leave it blank" hint="Your choice, not a guess. Leave it unset and those rows are listed as problems instead.">
        <SelectInput value={engagement} onChange={(event) => setEngagement(event.target.value as Engagement | "")}>
          <option value="">Do not fill it in</option>
          <option value="contractor">Independent contractor</option>
          <option value="employee">Employee</option>
        </SelectInput>
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" disabled={mapping.name === undefined} onClick={onNext}>
          Check the list
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}

type Decision = { add: boolean; differentPerson: boolean };

function Review({ rows, engagement, onBack, onDone }: { rows: ReturnType<typeof rowsFrom>; engagement: Engagement | ""; onBack: () => void; onDone: (result: { created: number; skipped: number }) => void }) {
  const { companyId } = useCompany();
  const args = useMemo(() => ({ companyId, rows, defaultEngagement: engagement || undefined }), [companyId, rows, engagement]);
  const preview = useQuery(api.workforce.previewImport, args);
  const commit = useMutation(api.workforce.commitImport);
  const { busy, error, run, setError } = useRun();
  const [key] = useState(newKey);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  if (preview === undefined) return <Skeleton className="h-48" />;
  const decision = (index: number): Decision => {
    const row = preview.rows[index];
    return decisions[index] ?? { add: row.problems.length === 0 && row.matches.length === 0 && row.sameAsRows.length === 0, differentPerson: false };
  };
  const chosen = preview.rows.filter((row) => decision(row.index).add);
  const blocked = chosen.filter((row) => (row.matches.length > 0 || row.sameAsRows.some((other) => decision(other).add)) && !decision(row.index).differentPerson);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const result = await commit({ companyId, key, rows, defaultEngagement: engagement || undefined, decisions: preview.rows.map((row) => ({ index: row.index, ...decision(row.index) })) });
          if (result.status === "needs_review") return setError(result.problems.join(" "));
          onDone({ created: result.created, skipped: result.skipped });
        });
      }}
    >
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="success">{preview.ready} ready to add</Badge>
        <Badge variant="warning">{preview.toReview} may already be on record</Badge>
        <Badge variant="error">{preview.withProblems} with a problem</Badge>
      </div>
      <div className="max-h-[50vh] overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="sticky top-0 bg-card text-[11px] font-semibold tracking-wide text-muted-foreground uppercase shadow-[0_1px_0_var(--border)]">
            <tr>
              <th scope="col" className="w-16 px-3 py-2">Add</th>
              <th scope="col" className="px-3 py-2">Person</th>
              <th scope="col" className="px-3 py-2">Check</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {preview.rows.map((row) => {
              const own = decision(row.index);
              const problem = row.problems.length > 0;
              const maybe = row.matches.length > 0 || row.sameAsRows.length > 0;
              return (
                <tr key={row.index} className={cn(problem && "bg-destructive/[0.03]")}>
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" aria-label={`Add ${row.name || `row ${row.index + 1}`}`} checked={own.add} disabled={problem} onChange={(event) => setDecisions((current) => ({ ...current, [row.index]: { ...own, add: event.target.checked } }))} className="size-4 accent-[var(--color-brand-500)]" />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="block font-medium text-strong">{row.name || <span className="text-muted-foreground">No name</span>}</span>
                    <span className="block text-xs text-muted-foreground">
                      Row {row.index + 1}
                      {row.engagementWords ? ` · ${row.engagementWords}` : ""}
                      {row.subcontractorName ? ` · ${row.subcontractorName}` : ""}
                      {row.phone ? ` · ${row.phone}` : ""}
                      {row.email ? ` · ${row.email}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs">
                    {problem ? (
                      <span className="flex items-start gap-1.5 text-destructive-foreground">
                        <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                        {row.problems.join(" ")}
                      </span>
                    ) : maybe ? (
                      <span className="grid gap-1">
                        <span className="flex items-start gap-1.5 text-warning-foreground">
                          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                          <span>
                            {row.matches.map((match) => `${match.name} (${match.reasons.join(", ")})`).join("; ")}
                            {row.matches.length > 0 && row.sameAsRows.length > 0 ? "; " : ""}
                            {row.sameAsRows.length > 0 ? `the same as row ${row.sameAsRows.map((other) => other + 1).join(", ")} in this list` : ""}
                          </span>
                        </span>
                        {own.add ? (
                          <label className="flex items-center gap-1.5 text-strong">
                            <input type="checkbox" checked={own.differentPerson} onChange={(event) => setDecisions((current) => ({ ...current, [row.index]: { ...own, differentPerson: event.target.checked } }))} className="size-3.5 accent-[var(--color-brand-500)]" />
                            A different person
                          </label>
                        ) : null}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-success-foreground">
                        <CheckCircle2 className="size-3.5" aria-hidden /> Ready
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Everyone added starts in onboarding. Nobody is merged with an existing record. Importing the same list twice from this screen adds nobody the second time.</p>
      {blocked.length > 0 ? <p className="text-xs font-medium text-warning-foreground">{plural(blocked.length, "chosen row")} may already be on record. Confirm each is a different person, or leave it out.</p> : null}
      <FormError message={error} />
      <div className="flex flex-wrap gap-2">
        <Submit busy={busy} label={`Add ${plural(chosen.length, "person", "people")}`} onCancel={onBack} disabled={chosen.length === 0 || blocked.length > 0} />
      </div>
    </form>
  );
}

function Flow({ onClose }: { onClose: () => void }) {
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [engagement, setEngagement] = useState<Engagement | "">("");
  const [step, setStep] = useState<"choose" | "map" | "review" | "done">("choose");
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const rows = useMemo(() => (table ? rowsFrom(table, mapping) : []), [table, mapping]);
  if (step === "done" && result) {
    return (
      <div className="grid justify-items-center gap-3 py-6 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-success/10 text-success-foreground">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <p className="text-base font-semibold text-strong">{plural(result.created, "person", "people")} added</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {result.skipped > 0 ? `${plural(result.skipped, "row")} left out. ` : ""}Each starts in onboarding. Set their hours, areas and pay, then make them active when they can take work.
        </p>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }
  if (step === "choose" || !table)
    return (
      <Choose
        onTable={(next) => {
          setTable(next);
          setMapping(guessColumns(next[0]));
          setStep("map");
        }}
      />
    );
  if (step === "map") return <MapColumns table={table} mapping={mapping} setMapping={setMapping} engagement={engagement} setEngagement={setEngagement} onBack={() => setStep("choose")} onNext={() => setStep("review")} />;
  return (
    <Review
      rows={rows}
      engagement={engagement}
      onBack={() => setStep("map")}
      onDone={(done) => {
        setResult(done);
        setStep("done");
      }}
    />
  );
}

export function ImportCleaners({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Import cleaners" description="Every row is checked for problems and possible duplicates before anyone is added." wide>
      <Flow onClose={onClose} />
    </Modal>
  );
}

