"use client";

import { useState } from "react";
import Papa from "papaparse";
import { importCustomers, type ImportRow } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/button";

export function CsvImport({ currentCount }: { currentCount: number }) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const mapped = res.data
          .map((r) => ({
            full_name: r.name ?? r.full_name ?? r.Name ?? "",
            phone: r.phone ?? r.Phone ?? r.mobile ?? "",
            email: r.email ?? r.Email ?? "",
            // consent column: accept yes/true/1
            consent: /^(yes|true|1|y)$/i.test(
              String(r.consent ?? r.sms_consent ?? "")
            ),
          }))
          .filter((r) => r.phone);
        setRows(mapped);
      },
    });
  }

  async function doImport() {
    setBusy(true);
    setSummary(null);
    const res = await importCustomers(rows);
    setBusy(false);
    if ("error" in res) {
      setSummary(res.error ?? "Could not import.");
      return;
    }
    setSummary(
      `Imported ${res.imported}. ${res.noConsent} have no SMS consent (won't be texted until they opt in). ${res.skippedInvalid} skipped (bad phone).`
    );
    setRows([]);
  }

  return (
    <div className="space-y-3">
      {currentCount > 0 && (
        <p className="text-sm text-primary">
          {currentCount} customers imported ✓
        </p>
      )}
      <input type="file" accept=".csv" onChange={onFile} className="text-sm" />
      <p className="text-xs text-muted-foreground">
        CSV columns: <span className="font-mono">name, phone, email, consent</span>.
        Only customers with explicit SMS consent (consent = yes) will be texted.
        Importing without consent is allowed but those contacts stay
        unmessageable.
      </p>
      {rows.length > 0 && (
        <Button onClick={doImport} disabled={busy}>
          {busy ? "Importing…" : `Import ${rows.length} customers`}
        </Button>
      )}
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
    </div>
  );
}
