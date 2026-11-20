"use client";

/**
 * Importing a list of cleaners: paste or upload a CSV, match its columns, then review every row before
 * anything is written. A row that may be someone already in the record, or the same as another row, is held
 * back unless the person says to add it anyway. Each new person gets the onboarding checklist.
 */
import { useConvex, useMutation } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { PageHeader } from "@/components/app/shell";
import { TutorialCard, useSource } from "@/components/app/tutorials/offer";
import { ArrowLeft, Check, FileSpreadsheet, TriangleAlert, Upload } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cell, guessColumns, IMPORT_FIELDS, parseCsv, type ImportField } from "@/lib/app/csv";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { CLEANERS_PATH } from "./state";

type Checked = FunctionReturnType<typeof api.workforce.checkImport>;
type Result = FunctionReturnType<typeof api.workforce.importRows>;

const SAMPLE = "Name,Type,Phone,Email,Service areas,Skills\nRosa Diaz,Contractor,512-555-0101,rosa@example.com,78701; 78702,deep clean\nLena Park,Employee,512-555-0102,,78703,";

export function ImportScreen() {
  const { companyId, role } = useCompany();
  const [source] = useSource();
  const convex = useConvex();
  const importRows = useMutation(api.workforce.importRows);
  const { busy, error, run, setError } = useRun();
  const [text, setText] = useState("");
  const [columns, setColumns] = useState<Partial<Record<ImportField, number>> | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [skip, setSkip] = useState<number[]>([]);
  const [addAnyway, setAddAnyway] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const table = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);
  const header = table[0] ?? [];
  const body = table.slice(1);
  const rows = useMemo(
    () =>
      columns
        ? body.map((row) => ({
            name: cell(row, columns.name),
            engagement: cell(row, columns.engagement) || undefined,
            phone: cell(row, columns.phone) || undefined,
            email: cell(row, columns.email) || undefined,
            serviceAreas: cell(row, columns.serviceAreas) || undefined,
            skills: cell(row, columns.skills) || undefined,
            subcontractor: cell(row, columns.subcontractor) || undefined,
          }))
        : [],
    [body, columns],
  );

  if (role === "office") return <p className="text-sm text-muted-foreground">An Owner or Manager imports cleaners.</p>;

  const step = result ? 4 : checked ? 3 : columns ? 2 : 1;
  const review = () => {
    if (rows.length > 500) {
      setError("Import up to 500 people at a time.");
      return;
    }
    void run(async () => {
      const answer = await convex.query(api.workforce.checkImport, { companyId, rows });
      setChecked(answer);
      setSkip([]);
      setAddAnyway([]);
    });
  };
  const ready = checked?.filter((row) => row.problems.length === 0 && !skip.includes(row.index) && (row.matches.length === 0 && row.sameAsRow === null ? true : addAnyway.includes(row.index))).length ?? 0;

  return (
    <>
      <Link href={CLEANERS_PATH} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-strong">
        <ArrowLeft className="size-4" aria-hidden />
        Cleaners
      </Link>
      <PageHeader title="Import cleaners" lead="Bring in a list from a spreadsheet. Nothing is written until you have reviewed every row." />
      {step === 1 ? (
        <div className="mb-5">
          <TutorialCard placement="import.team" platform={source} />
        </div>
      ) : null}
      <ol className="mb-5 flex flex-wrap gap-2 text-sm" aria-label="Steps">
        {["Your list", "Match columns", "Review", "Done"].map((label, index) => (
          <li key={label} className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1", step === index + 1 ? "border-brand-500 bg-brand-500/8 font-medium text-strong" : step > index + 1 ? "border-success/40 text-success-foreground" : "border-border text-muted-foreground")} aria-current={step === index + 1 ? "step" : undefined}>
            {step > index + 1 ? <Check className="size-3.5" aria-hidden /> : <span className="tabular-nums">{index + 1}</span>}
            {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center hover:border-brand-500/50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500">
            <Upload className="size-6 text-muted-foreground" aria-hidden />
            <span className="text-sm font-medium text-strong">Choose a CSV file</span>
            <span className="text-xs text-muted-foreground">Export from Excel, Google Sheets or your old system as CSV.</span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void file.text().then(setText);
              }}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Or paste the rows, with a header row first</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder={SAMPLE} className="min-h-40 rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-strong placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-brand-500/30" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{body.length > 0 ? `${body.length} ${body.length === 1 ? "row" : "rows"} found.` : "Up to 500 people at a time."}</p>
            <Button variant="primary" disabled={body.length === 0} onClick={() => setColumns(guessColumns(header))}>
              Next: match columns
            </Button>
          </div>
        </section>
      ) : null}

      {step === 2 && columns ? (
        <section className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p className="text-sm text-muted-foreground">Which column holds each detail? Only a name is required. A missing relationship type is read as independent contractor.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {IMPORT_FIELDS.map((field) => (
              <label key={field.key} className="grid gap-1 text-sm">
                <span className="font-medium text-strong">{field.label}</span>
                <select
                  value={columns[field.key] ?? ""}
                  onChange={(event) => setColumns({ ...columns, [field.key]: event.target.value === "" ? undefined : Number(event.target.value) })}
                  className="h-10 rounded-lg border border-border bg-card px-2.5 text-sm text-strong sm:h-9"
                >
                  <option value="">Not in the file</option>
                  {columns[field.key] !== undefined && columns[field.key]! < 0 ? <option value={columns[field.key]}>First and last name</option> : null}
                  {header.map((name, index) => (
                    <option key={`${name}-${index}`} value={index}>
                      {name || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[560px] text-left text-xs">
              <caption className="sr-only">The first rows as they will be read</caption>
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  {IMPORT_FIELDS.map((field) => (
                    <th key={field.key} className="px-3 py-2 font-medium">
                      {field.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 4).map((row, index) => (
                  <tr key={index}>
                    {IMPORT_FIELDS.map((field) => (
                      <td key={field.key} className="px-3 py-2 text-strong">
                        {row[field.key] || <span className="text-muted-foreground">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FormError message={error} />
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => setColumns(null)}>
              Back
            </Button>
            <Button variant="primary" loading={busy} disabled={columns.name === undefined} onClick={review}>
              Next: review {rows.length} {rows.length === 1 ? "row" : "rows"}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 3 && checked ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="success">{checked.filter((row) => row.problems.length === 0 && row.matches.length === 0 && row.sameAsRow === null).length} new</Badge>
            <Badge variant="warning">{checked.filter((row) => row.problems.length === 0 && (row.matches.length > 0 || row.sameAsRow !== null)).length} to check</Badge>
            <Badge variant="error">{checked.filter((row) => row.problems.length > 0).length} cannot be added</Badge>
          </div>
          <ul className="grid gap-2">
            {checked.map((row) => {
              const problem = row.problems.length > 0;
              const similar = !problem && (row.matches.length > 0 || row.sameAsRow !== null);
              const skipped = skip.includes(row.index);
              const anyway = addAnyway.includes(row.index);
              return (
                <li key={row.index} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card px-4 py-3", problem ? "border-destructive/30" : similar && !anyway ? "border-warning/50" : "border-border", skipped && "opacity-60")}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-strong">
                      <span className="mr-2 text-xs tabular-nums text-muted-foreground">Row {row.index + 2}</span>
                      {row.name || "No name"}
                    </p>
                    {problem ? <p className="mt-0.5 text-xs text-destructive-foreground">{row.problems.join(" ")}</p> : null}
                    {row.matches.map((match) => (
                      <p key={match.cleanerId} className="mt-0.5 flex items-center gap-1.5 text-xs text-strong">
                        <TriangleAlert className="size-3.5 text-warning-foreground" aria-hidden />
                        May be {match.name}, already here ({match.why}).
                      </p>
                    ))}
                    {row.sameAsRow !== null ? <p className="mt-0.5 text-xs text-strong">Looks like row {row.sameAsRow + 2} in this file.</p> : null}
                  </div>
                  {problem ? (
                    <Badge variant="error" size="sm">
                      Not added
                    </Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {similar ? (
                        <Button variant={anyway ? "secondary" : "outline"} size="xs" aria-pressed={anyway} onClick={() => setAddAnyway(anyway ? addAnyway.filter((i) => i !== row.index) : [...addAnyway, row.index])}>
                          {anyway ? "Adding anyway" : "Different person: add"}
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="xs" aria-pressed={skipped} onClick={() => setSkip(skipped ? skip.filter((i) => i !== row.index) : [...skip, row.index])}>
                        {skipped ? "Skipped" : "Skip"}
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <FormError message={error} />
          <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
            <Button variant="ghost" onClick={() => setChecked(null)}>
              Back
            </Button>
            <Button variant="primary" loading={busy} disabled={ready === 0} onClick={() => void run(async () => setResult(await importRows({ companyId, rows, skip, addAnyway })))}>
              <FileSpreadsheet aria-hidden />
              Import {ready} {ready === 1 ? "person" : "people"}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 4 && result ? (
        <section className="grid gap-3 rounded-2xl border border-border bg-card p-5" role="status">
          <p className="flex items-center gap-2 text-base font-semibold text-strong">
            <Check className="size-5 text-success-foreground" aria-hidden />
            {result.summary}
          </p>
          {result.skipped.length > 0 ? (
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {result.skipped.map((row) => (
                <li key={row.index}>
                  Row {row.index + 2}: {row.why}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-sm text-muted-foreground">Everyone added starts in onboarding with your checklist. Invite them to their portal from their profile to collect what is missing.</p>
          <div>
            <Button variant="primary" render={<Link href={`${CLEANERS_PATH}?status=onboarding`} />}>
              See them in the directory
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
