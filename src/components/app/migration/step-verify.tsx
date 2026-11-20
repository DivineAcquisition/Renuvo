"use client";

/**
 * Step 6: what moved, reconciled against the files, with links to the records and a downloadable report of
 * everything that didn't. Then the Owner's deliberate release of the imported schedule to Dispatch and the
 * recurring plans. Nothing is called complete while records are silently missing.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

import { CheckCircle2, Download, Minus, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import { KIND_LABELS } from "../../../../convex/lib/migration/rules";
import { csvCell, download, plural, useMigration } from "./context";
import { ActivationReview, UndoPanel } from "./activation";
import { Section, StepHeading } from "./parts";

const RECORD_WORDS: Record<string, string> = { customers: "customer", properties: "property", servicePlans: "recurring", jobs: "visit", cleaners: "team member", importedHistory: "past visit", openingBalances: "opening balance" };

export function VerifyStep() {
  const { companyId, act, go } = useMigration();
  const report = useQuery(api.migration.report, { companyId });
  const reopen = useMutation(api.migration.reopen);
  if (!report) return <div className="h-64 animate-pulse rounded-xl bg-muted/40 motion-reduce:animate-none" aria-busy="true" />;
  const attention = report.problems.length;
  const balanced = report.kinds.every((k) => k.balanced);

  function errorReport() {
    const lines = [["Record type", "File", "Row", "Name", "What happened", "Why"].map(csvCell).join(",")];
    for (const p of report!.problems) lines.push([KIND_LABELS[p.kind].label, p.file, p.row, p.name, p.outcome, p.reason].map(csvCell).join(","));
    download("selestial-migration-report.csv", `${lines.join("\n")}\n`);
  }

  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <StepHeading
        eyebrow="Step 6 of 6"
        title={attention ? "Your import is ready to review" : "Everything in your files is accounted for"}
        lead={attention ? "Customers, properties and upcoming visits have been imported. Some records need attention before your agents can use them." : "Every row in your files was imported, matched to an existing record, or skipped by your choice."}
      />

      <Section title="What moved" lead={balanced ? "Each count is reconciled with the rows in your files: they add up exactly." : "Some counts don't add up yet; an import may still be running."}>
        <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Records", "In files", "Created", "Updated", "Matched", "Skipped", "Undone", "Failed", "Awaiting review", ""].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 text-right font-medium first:text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.kinds.map((k) => (
                <tr key={k.kind}>
                  <th scope="row" className="px-3 py-2 text-left font-medium text-strong">{KIND_LABELS[k.kind].label}</th>
                  <td className="px-3 py-2 text-right tabular-nums">{k.source}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.created}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.updated}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.linked}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.skipped}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.undone}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.failed ? <span className="text-destructive-foreground">{k.failed}</span> : 0}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.awaiting ? <span className="text-warning-foreground">{k.awaiting}</span> : 0}</td>
                  <td className="px-3 py-2 text-right">{k.balanced ? <CheckCircle2 className="ml-auto size-3.5 text-success" aria-label="Adds up" /> : <TriangleAlert className="ml-auto size-3.5 text-warning" aria-label="Doesn't add up" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={errorReport} disabled={!attention}>
            <Download aria-hidden />
            Download the report of {plural(attention, "record")} to look at
          </Button>
          {attention ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void act(async () => {
                  await reopen({ companyId });
                  await go("review");
                })
              }
            >
              Fix them in Review & fix
            </Button>
          ) : null}
        </div>
      </Section>

      {report.recent.length ? (
        <Section title="Open your imported records">
          <ul className="flex flex-wrap gap-1.5">
            {report.recent.slice(0, 24).map((r) => (
              <li key={`${r.table}:${r.id}`}>
                <Link href={r.table === "customers" ? `/app/clients/${r.id}` : r.table === "jobs" ? "/app/schedule" : r.table === "cleaners" ? `/app/cleaners/${r.id}` : "/app/clients"} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-strong hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand-500">
                  {r.name}
                  <span className="text-muted-foreground">· {RECORD_WORDS[r.table] ?? "record"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="What didn't transfer, and why">
        <ul className="grid gap-1.5 text-xs text-muted-foreground">
          {report.kinds.filter((k) => ["services", "agreements", "other"].includes(k.kind)).map((k) => (
            <li key={k.kind} className="flex gap-1.5">
              <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
              {KIND_LABELS[k.kind].label} ({plural(k.source, "row")}): kept with your migration, not imported. {k.kind === "agreements" ? "Upload the signed documents in Agreements; a signature is never assumed from a list." : k.kind === "services" ? "Bookings were matched to your Selestial services instead." : "Selestial doesn't import this kind of record."}
            </li>
          ))}
          <li className="flex gap-1.5">
            <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
            Past visits in a bookings file are skipped there: put them in a service history file to keep them on each client as read-only history.
          </li>
          <li className="flex gap-1.5">
            <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
            Cleaner assignments from your old system: once you release your schedule, Dispatch offers each visit to your team.
          </li>
          <li className="flex gap-1.5">
            <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
            Saved cards, payment authorizations, subscriptions and bank details can&apos;t move through a file. Customers add a payment method in Selestial.
          </li>
          <li className="flex gap-1.5">
            <Minus className="mt-0.5 size-3 shrink-0" aria-hidden />
            Permission to text or email: a phone number or email isn&apos;t proof of consent, and consent recorded in your old system came without its evidence, so none was recorded as permission (it&apos;s noted on the client for the Owner). Documented opt-outs were kept, with their scope.
          </li>
        </ul>
      </Section>

      <ActivationReview />
      <UndoPanel />
    </div>
  );
}
