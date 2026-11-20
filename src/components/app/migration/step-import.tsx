"use client";

/**
 * Step 5: start the background import and watch it. It keeps going if the owner leaves, refreshes or the
 * server restarts: each batch is checkpointed, and a repeat writes nothing twice. Records waiting for a
 * choice or a correction are left out and stay in Review & fix, to import later.
 */
import { useMutation, useQuery } from "convex/react";

import { CheckCircle2, Loader2, ShieldCheck, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import { IMPORTABLE, KIND_LABELS } from "../../../../convex/lib/migration/rules";
import { plural, useMigration } from "./context";
import { Note, Section, StepHeading, Tile } from "./parts";

const PHASE_WORDS = ["customers", "properties", "your team", "recurring services", "upcoming bookings", "service history", "opening balances"];

export function ImportStep() {
  const { view, companyId, act, go } = useMigration();
  const readiness = useQuery(api.migration.readiness, { companyId });
  const startImport = useMutation(api.migration.startImport);
  const stopImport = useMutation(api.migration.stopImport);
  const run = view.run;
  const running = run?.status === "running";

  return (
    <div className="grid min-w-0 gap-7 [&>*]:min-w-0">
      <StepHeading eyebrow="Step 5 of 6" title="Import" lead="Selestial writes your records in the background: customers first, then properties, your team, recurring services, bookings, service history and opening balances. You can leave this page; it keeps going." />

      <div className="grid gap-2 rounded-2xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-2 text-sm font-semibold text-strong">
          <ShieldCheck className="size-4 text-success" aria-hidden />
          Nothing goes live yet
        </p>
        <ul className="grid list-disc gap-0.5 pl-5">
          <li>No customer, applicant or cleaner is messaged, offered work or reminded about anything because it was imported.</li>
          <li>Imported visits and recurring services are held: Dispatch doesn&apos;t offer them and plans don&apos;t book ahead until you release them in the next step.</li>
          <li>Your team is added as onboarding and held: no invitation, onboarding reminder or offer reaches them until you release them.</li>
          <li>Past visits are read-only history and balances are for reference: nothing is paid, invoiced, charged or reminded.</li>
          <li>Imported prices for recurring services are proposed for your approval in Services & Pricing; nothing is charged at them before.</li>
          <li>A phone number or email in your files is not permission to message. Documented opt-outs are kept.</li>
        </ul>
      </div>

      {running && run ? (
        <Section title="Importing" lead={`Writing ${PHASE_WORDS[run.phase] ?? "the last records"}…`}>
          <div className="grid gap-2">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done} aria-label="Import progress">
              <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-success transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${run.total ? Math.min(100, (run.done / run.total) * 100) : 5}%` }} />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {plural(run.done, "record")} of about {run.total.toLocaleString()} · {run.counts.created} created, {run.counts.linked} matched, {run.counts.failed} failed
            </p>
          </div>
          <Button variant="outline" size="sm" className="justify-self-start" onClick={() => void act(() => stopImport({ companyId }))}>
            Stop the import
          </Button>
        </Section>
      ) : null}

      {run && !running ? (
        <Section title={run.status === "done" ? "Import finished" : run.status === "cancelled" ? "Import stopped" : "Import stopped with a problem"} lead={run.problem ?? undefined}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile label="Created" value={run.counts.created} tone="good" />
            <Tile label="Updated" value={run.counts.updated} />
            <Tile label="Matched to existing" value={run.counts.linked} />
            <Tile label="Skipped" value={run.counts.skipped} tone="muted" />
            <Tile label="Failed" value={run.counts.failed} tone={run.counts.failed ? "bad" : "plain"} />
          </div>
          {run.status === "done" ? (
            <Button variant="primary" className="justify-self-start" onClick={() => void go("verify")}>
              <CheckCircle2 aria-hidden />
              Verify the results
            </Button>
          ) : null}
        </Section>
      ) : null}

      {!running && readiness ? (
        <Section title={run ? "Import again" : "Ready to import?"} lead={run ? "Records you fixed or decided since the last import are written now. Everything already imported is left as it is." : undefined}>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Records</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">In your files</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Will be created</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Matched to existing</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Skipped</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Left out for now</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {readiness.kinds.filter((k) => k.total).map((k) => (
                  <tr key={k.kind}>
                    <th scope="row" className="px-3 py-2 font-medium text-strong">{KIND_LABELS[k.kind].label}</th>
                    <td className="px-3 py-2 text-right tabular-nums">{k.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.ready}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.update}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.skip}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{k.awaiting + k.error ? <span className="text-warning-foreground">{k.awaiting + k.error}</span> : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">Duplicates you decided are counted where your choice puts them when they&apos;re written. &ldquo;Left out for now&rdquo; means waiting for your choice or a correction; they stay in Review &amp; fix.</p>
          {Object.keys(view.migration.summary).some((k) => !(IMPORTABLE as readonly string[]).includes(k)) ? <Note>Files with services, agreements or other records are kept with the migration but not imported. They&apos;re listed in your report as not transferred.</Note> : null}
          {readiness.blockers.map((b) => (
            <p key={b} className="flex items-center gap-2 text-xs text-warning-foreground">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
              {b}
            </p>
          ))}
          {view.inSupport ? (
            <Note>You&apos;ve prepared everything you can. The company&apos;s Owner or a Manager starts the import after reviewing your changes and questions.</Note>
          ) : (
            <Button variant="gradient" size="lg" className="justify-self-start" disabled={readiness.blockers.length > 0} onClick={() => void act(() => startImport({ companyId }))}>
              {run ? "Import the remaining records" : "Start the import"}
            </Button>
          )}
        </Section>
      ) : null}
    </div>
  );
}
