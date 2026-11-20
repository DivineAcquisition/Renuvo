"use client";

/**
 * Appointments, recurring service and history from a spreadsheet or another system's export, the same way
 * clients come in (import.tsx): choose the file, confirm the columns, see every row, then import. Each row
 * is matched to a client already imported; nothing is booked, started or sent because it was imported.
 */
import { useConvex, useMutation } from "convex/react";
import { useRef, useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, messageOf, SelectInput } from "@/components/app/form";
import { TutorialCard, TutorialLink } from "@/components/app/tutorials/offer";
import { Check, FileSpreadsheet, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { parseCsv } from "@/lib/app/csv";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import { detectSource } from "../../../../convex/lib/clients/importing";
import {
  FIELDS_FOR,
  guessRecordMapping,
  KIND_WORDS,
  RECORD_COMMIT_LIMIT,
  RECORD_FIELD_LABELS,
  RECORD_ROW_LIMIT,
  REQUIRED_FOR,
  toRecordRow,
  type RecordField,
  type RecordKind,
} from "../../../../convex/lib/migration/records";
import type { Placement, Platform } from "../../../../convex/lib/tutorials/catalog";

type Checked = FunctionReturnType<typeof api.migrationImports.check>;
type Result = FunctionReturnType<typeof api.migrationImports.commit>["results"][number];

const PLACEMENT: Record<RecordKind, Placement> = { appointment: "import.appointments", recurring: "import.recurring", history: "import.history" };
const TEMPLATE: Record<RecordKind, string> = { appointment: "/templates/selestial-appointments.csv", recurring: "/templates/selestial-recurring.csv", history: "/templates/selestial-history.csv" };
const LEAD: Record<RecordKind, string> = {
  appointment: "Visits already on your calendar. They are kept for you to review and book in Selestial; no one is notified.",
  recurring: "Which clients repeat, and how often. Each schedule waits for you to set it up as a service plan.",
  history: "Past invoices or visits, kept on each client for reference. Nothing is billed or sent.",
};

export function RecordImport({ kind, platform = null }: { kind: RecordKind; platform?: Platform | null }) {
  const { companyId } = useCompany();
  const convex = useConvex();
  const commit = useMutation(api.migrationImports.commit);
  const input = useRef<HTMLInputElement>(null);
  const focusUpload = () => input.current?.focus();
  const [file, setFile] = useState<{ name: string; header: string[]; rows: string[][]; key: string } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<RecordField, number>>>({});
  const [checked, setChecked] = useState<Checked | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = KIND_WORDS[kind];
  const placement = PLACEMENT[kind];
  const detected = file ? detectSource(file.header) : null;
  const source = detected ?? (platform && platform !== "spreadsheet" ? platform : "csv");
  const rows = file ? file.rows.map((cells) => toRecordRow(cells, mapping)) : [];
  const missing = REQUIRED_FOR[kind].filter((field) => mapping[field] === undefined && !(field === "clientName" && (mapping.clientEmail !== undefined || mapping.clientPhone !== undefined)));

  async function choose(chosen: File) {
    setError(null);
    setChecked(null);
    setResults(null);
    if (!/\.csv$/i.test(chosen.name) && chosen.type !== "text/csv") return setError("Selestial reads .csv files only. Save or export the file as CSV (.csv), then choose it.");
    if (chosen.size > 5 * 1024 * 1024) return setError("Use a file under 5 MB.");
    const parsed = parseCsv(await chosen.text());
    if (parsed.length < 2) return setError(`The file needs a header row and at least one ${words.one}.`);
    if (parsed.length - 1 > RECORD_ROW_LIMIT) return setError(`Import up to ${RECORD_ROW_LIMIT} rows at a time. Split the file and import each part.`);
    const [header, ...body] = parsed;
    setFile({ name: chosen.name, header, rows: body, key: `${kind}:${chosen.name}:${chosen.size}:${chosen.lastModified}` });
    setMapping(guessRecordMapping(kind, header));
  }

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setChecked(await convex.query(api.migrationImports.check, { companyId, kind, rows }));
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const all: Result[] = [];
    try {
      for (let start = 0; start < rows.length; start += RECORD_COMMIT_LIMIT) {
        const batch = rows.slice(start, start + RECORD_COMMIT_LIMIT).map((row, offset) => ({ index: start + offset, row }));
        const done = await commit({ companyId, importKey: `${file.key}:${JSON.stringify(mapping)}:${start}`, kind, source, label: file.name, rows: batch });
        all.push(...done.results);
        setResults([...all]);
      }
    } catch (caught) {
      setError(`${messageOf(caught)} What was imported is kept; importing again continues without adding anything twice.`);
    } finally {
      setBusy(false);
    }
  }

  const count = (outcome: Result["outcome"]) => results?.filter((row) => row.outcome === outcome).length ?? 0;
  const held = checked?.rows.filter((row) => row.problems.length || row.importedBefore || row.sameAsRow !== null || row.notes.length) ?? [];

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{LEAD[kind]}</p>
      <TutorialCard placement={placement} platform={platform} onUpload={focusUpload} />
      {!file ? (
        <label className="grid min-h-24 cursor-pointer place-items-center gap-1 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-5 text-center text-sm focus-within:outline-2 focus-within:outline-brand-500">
          <FileSpreadsheet className="size-6 text-muted-foreground" aria-hidden />
          <span className="font-medium text-strong">Choose a .csv of {words.many}</span>
          <span className="text-xs text-muted-foreground">
            Import your clients first, so each row can be matched.{" "}
            <a href={TEMPLATE[kind]} download className="font-medium text-brand-300 underline-offset-4 hover:underline" onClick={(event) => event.stopPropagation()}>
              Download a template
            </a>
          </span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (chosen) void choose(chosen);
            }}
          />
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
          <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-medium text-strong">{file.name}</span>
          <span className="text-muted-foreground">· {file.rows.length} rows</span>
          <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setFile(null)}>
            Choose another file
          </Button>
        </div>
      )}

      {file && !results ? (
        <>
          {missing.length ? (
            <div className="grid gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm" role="status">
              <p className="text-strong">
                Choose the column for {missing.map((field) => RECORD_FIELD_LABELS[field]).join(" and ")} below. If your file doesn&apos;t have it, add it and choose the file again.
              </p>
              <TutorialLink placement={placement} platform={platform} label="Which columns does Selestial need?" onUpload={focusUpload} />
            </div>
          ) : null}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-strong">Which column is which? We matched what we could; check them.</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {FIELDS_FOR[kind].map((field) => (
                <Field key={field} label={`${RECORD_FIELD_LABELS[field]}${REQUIRED_FOR[kind].includes(field) ? "" : " (optional)"}`}>
                  <SelectInput
                    value={mapping[field] === undefined ? "" : String(mapping[field])}
                    onChange={(event) => {
                      setChecked(null);
                      setMapping({ ...mapping, [field]: event.target.value === "" ? undefined : Number(event.target.value) });
                    }}
                  >
                    <option value="">Not in this file</option>
                    {file.header.map((name, index) => (
                      <option key={`${name}-${index}`} value={index}>
                        {name || `Column ${index + 1}`}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
              ))}
            </div>
          </fieldset>
          {!checked ? (
            <Button variant="primary" onClick={() => void check()} loading={busy} disabled={missing.length > 0}>
              Check {rows.length} {rows.length === 1 ? words.one : words.many}
            </Button>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-strong">
                <span className="font-semibold">{checked.willCreate}</span> will be added. {checked.rows.filter((row) => row.problems.length).length} have something to fix first.
              </p>
              {held.length ? (
                <ul className="grid max-h-72 gap-1.5 overflow-y-auto rounded-xl border border-border p-2 text-sm" aria-label="Rows to review">
                  {held.slice(0, 100).map((row) => (
                    <li key={row.index} className="rounded-lg px-2 py-1.5 hover:bg-muted/40">
                      <span className="font-medium text-strong">
                        Row {row.index + 2}: {row.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.problems.length ? row.problems.join(" ") : row.importedBefore ? "Already imported." : row.sameAsRow !== null ? `Same as row ${row.sameAsRow + 2} in this file.` : row.notes.join(" ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {checked.rows.some((row) => row.problems.length) ? <TutorialLink placement="import.clients.missing_columns" platform={platform} label="See how to fix import errors" /> : null}
              <p className="flex gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Importing books nothing, assigns no one and contacts no one. You review each {words.one} afterwards.
              </p>
              <Button variant="primary" onClick={() => void run()} loading={busy} disabled={checked.willCreate === 0}>
                Import {checked.willCreate} {checked.willCreate === 1 ? words.one : words.many}
              </Button>
            </div>
          )}
        </>
      ) : null}

      {results ? (
        <div className="grid gap-2 rounded-xl border border-border p-3 text-sm" role="status">
          <p className="flex items-center gap-2 font-medium text-strong">
            <Check className="size-4 text-success" aria-hidden />
            {count("created")} added · {count("skipped")} already here · {count("failed")} not imported
          </p>
          {count("failed") ? (
            <ul className="grid gap-1 text-xs text-muted-foreground" aria-label="Rows not imported">
              {results
                .filter((row) => row.outcome === "failed")
                .slice(0, 20)
                .map((row) => (
                  <li key={row.index}>
                    <span className="font-medium text-strong">Row {row.index + 2}</span> ({row.name}): {row.reason}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-strong" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
