"use client";

/**
 * Bringing clients in from a spreadsheet: choose the file, confirm which column is which, see what would
 * happen to each row, then import. Batches are sent under fixed keys, so a retry never imports twice.
 * Exports from Jobber, Housecall Pro and BookingKoala are recognized by their columns. Clients read through
 * a Jobber or Housecall Pro connection (connectors.tsx) go through the same review, ReviewImport.
 */
import { useConvex, useMutation } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, messageOf, SelectInput } from "@/components/app/form";
import { Check, FileSpreadsheet, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseCsv } from "@/lib/app/csv";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import {
  COMMIT_LIMIT,
  detectSource,
  FIELD_LABELS,
  guessMapping,
  ROW_LIMIT,
  toRow,
  type ImportField,
  type ImportRow,
} from "../../../../convex/lib/clients/importing";

type Checked = FunctionReturnType<typeof api.clientImports.check>;
type Result = FunctionReturnType<
  typeof api.clientImports.commit
>["results"][number];

const SOURCE_WORDS = {
  jobber: "Jobber",
  housecall_pro: "Housecall Pro",
  bookingkoala: "BookingKoala",
} as const;
const SHOWN: ImportField[] = [
  "name",
  "firstName",
  "lastName",
  "company",
  "email",
  "phone",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "schedule",
  "notes",
  "externalId",
];

export function ClientImport({
  onDone,
}: {
  onDone?: (created: number) => void;
}) {
  const [file, setFile] = useState<{
    name: string;
    header: string[];
    rows: string[][];
    key: string;
  } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const detected = file ? detectSource(file.header) : null;
  const rows: ImportRow[] = file
    ? file.rows.map((cells) => toRow(cells, mapping))
    : [];

  async function choose(chosen: File) {
    setError(null);
    if (chosen.size > 5 * 1024 * 1024)
      return setError("Use a file under 5 MB.");
    const parsed = parseCsv(await chosen.text());
    if (parsed.length < 2)
      return setError("The file needs a header row and at least one client.");
    if (parsed.length - 1 > ROW_LIMIT)
      return setError(
        `Import up to ${ROW_LIMIT} clients at a time. Split the file and import each part.`,
      );
    const [header, ...body] = parsed;
    setFile({
      name: chosen.name,
      header,
      rows: body,
      key: `${chosen.name}:${chosen.size}:${chosen.lastModified}`,
    });
    setMapping(guessMapping(header));
  }

  return (
    <div className="grid gap-4">
      {!file ? (
        <label className="grid min-h-28 cursor-pointer place-items-center gap-1 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm focus-within:outline-2 focus-within:outline-brand-500">
          <FileSpreadsheet
            className="size-6 text-muted-foreground"
            aria-hidden
          />
          <span className="font-medium text-strong">
            Choose a spreadsheet of your clients
          </span>
          <span className="text-xs text-muted-foreground">
            A .csv file. Exports from Jobber, Housecall Pro and BookingKoala
            work: export your client list there, then choose it here.
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(event) =>
              event.target.files?.[0] && void choose(event.target.files[0])
            }
          />
        </label>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
          <FileSpreadsheet
            className="size-4 text-muted-foreground"
            aria-hidden
          />
          <span className="font-medium text-strong">{file.name}</span>
          <span className="text-muted-foreground">
            · {file.rows.length} rows
          </span>
          {detected ? (
            <Badge variant="info">
              Looks like a {SOURCE_WORDS[detected]} export
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={() => setFile(null)}
          >
            Choose another file
          </Button>
        </div>
      )}

      {file ? (
        <>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-strong">
              Which column is which? We matched what we could; check them.
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SHOWN.map((field) => (
                <Field key={field} label={FIELD_LABELS[field]}>
                  <SelectInput
                    value={
                      mapping[field] === undefined ? "" : String(mapping[field])
                    }
                    onChange={(event) =>
                      setMapping({
                        ...mapping,
                        [field]:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
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
          {/* A changed column choice starts the check over. */}
          <ReviewImport
            key={`${file.key}:${JSON.stringify(mapping)}`}
            rows={rows}
            source={
              detected === "jobber" || detected === "housecall_pro"
                ? detected
                : "csv"
            }
            label={file.name}
            keyBase={file.key}
            ready={
              mapping.name !== undefined ||
              mapping.firstName !== undefined ||
              mapping.company !== undefined
            }
            onDone={onDone}
          />
        </>
      ) : null}
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-strong",
      )}
      role="alert"
    >
      {children}
    </p>
  );
}

/**
 * Check, then import: the same for a spreadsheet and for clients read from Jobber or Housecall Pro.
 * `keyBase` names the rows (a file, or one read): the same rows and batch always use the same key.
 */
export function ReviewImport({
  rows,
  source,
  label,
  keyBase,
  ready = true,
  onDone,
}: {
  rows: ImportRow[];
  source: "csv" | "jobber" | "housecall_pro";
  label: string;
  keyBase: string;
  ready?: boolean;
  onDone?: (created: number) => void;
}) {
  const { companyId } = useCompany();
  const convex = useConvex();
  const commit = useMutation(api.clientImports.commit);
  const [checked, setChecked] = useState<Checked | null>(null);
  const [addAnyway, setAddAnyway] = useState<number[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setChecked(
        await convex.query(api.clientImports.check, {
          companyId,
          source,
          rows,
        }),
      );
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!checked) return;
    setBusy(true);
    setError(null);
    const all: Result[] = [];
    try {
      for (let start = 0; start < rows.length; start += COMMIT_LIMIT) {
        const batch = rows
          .slice(start, start + COMMIT_LIMIT)
          .map((row, offset) => ({ index: start + offset, row }));
        // The same rows and batch always use the same key: sending it again returns the first result.
        const done = await commit({
          companyId,
          importKey: `${keyBase}:${start}`,
          source,
          label,
          rows: batch,
          addAnyway,
          skip: [],
        });
        all.push(...done.results);
        setResults([...all]);
      }
      onDone?.(all.filter((row) => row.outcome === "created").length);
    } catch (caught) {
      setError(
        `${messageOf(caught)} What was imported is kept; importing again continues safely without adding anyone twice.`,
      );
    } finally {
      setBusy(false);
    }
  }

  const count = (outcome: Result["outcome"]) =>
    results?.filter((row) => row.outcome === outcome).length ?? 0;

  return (
    <div className="grid gap-4">
      {results ? null : !checked ? (
        <Button
          variant="primary"
          onClick={() => void check()}
          loading={busy}
          disabled={!ready || rows.length === 0}
        >
          Check {rows.length} clients
        </Button>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm text-strong">
            <span className="font-semibold">{checked.willCreate}</span> will be
            added.{" "}
            {
              checked.rows.filter(
                (row) =>
                  row.matches.length ||
                  row.importedBefore ||
                  row.sameAsRow !== null,
              ).length
            }{" "}
            look like clients you already have, and{" "}
            {checked.rows.filter((row) => row.problems.length).length} have
            something to fix first.
          </p>
          <ul
            className="grid max-h-80 gap-1.5 overflow-y-auto rounded-xl border border-border p-2 text-sm"
            aria-label="Rows to review"
          >
            {checked.rows
              .filter(
                (row) =>
                  row.problems.length ||
                  row.matches.length ||
                  row.importedBefore ||
                  row.sameAsRow !== null,
              )
              .slice(0, 100)
              .map((row) => (
                <li
                  key={row.index}
                  className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-strong">
                      {row.name || `Row ${row.index + 2}`}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {row.problems.length
                        ? row.problems.join(" ")
                        : row.importedBefore
                          ? "Already imported from this system."
                          : row.sameAsRow !== null
                            ? source === "csv"
                              ? `Same as row ${row.sameAsRow + 2} in this file.`
                              : "The same client appears twice in what was read."
                            : `May be ${row.matches[0].name} (${row.matches[0].why.toLowerCase()}).`}
                    </span>
                  </span>
                  {row.matches.length && !row.problems.length ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="size-4 accent-[#6838ef]"
                        checked={addAnyway.includes(row.index)}
                        onChange={() =>
                          setAddAnyway(
                            addAnyway.includes(row.index)
                              ? addAnyway.filter((index) => index !== row.index)
                              : [...addAnyway, row.index],
                          )
                        }
                      />
                      Add anyway
                    </label>
                  ) : null}
                </li>
              ))}
          </ul>
          <p className="flex gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Importing a phone number or email is not permission to text or email
            that person. Selestial asks for that separately before anything is
            sent.
          </p>
          <Button variant="primary" onClick={() => void run()} loading={busy}>
            Import {checked.willCreate + addAnyway.length} clients
          </Button>
        </div>
      )}
      {results ? (
        <div
          className="grid gap-2 rounded-xl border border-border p-3 text-sm"
          role="status"
        >
          <p className="flex items-center gap-2 font-medium text-strong">
            <Check className="size-4 text-success" aria-hidden />
            {count("created")} added · {count("skipped")} left as they were ·{" "}
            {count("failed")} not imported
          </p>
          {count("failed") || count("skipped") ? (
            <ul
              className="grid gap-1 text-xs text-muted-foreground"
              aria-label="Rows not added"
            >
              {results
                .filter((row) => row.outcome !== "created")
                .slice(0, 20)
                .map((row) => (
                  <li key={row.index}>
                    <span className="font-medium text-strong">{row.name}</span>{" "}
                    (
                    {row.outcome === "failed"
                      ? "not imported"
                      : "left as it was"}
                    ): {row.reason}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? <Problem>{error}</Problem> : null}
    </div>
  );
}
