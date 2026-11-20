"use client";

/**
 * Step 6: what moved, reconciled against the files, with links to the records and a downloadable report of
 * everything that didn't. Then the Owner's deliberate release of the imported schedule to Dispatch and the
 * recurring plans. Nothing is called complete while records are silently missing.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { CheckCircle2, Download, Minus, Rocket, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import { KIND_LABELS } from "../../../../convex/lib/migration/rules";
import { csvCell, download, plural, useMigration } from "./context";
import { Note, Section, StepHeading } from "./parts";

const RECORD_WORDS: Record<string, string> = { customers: "customer", properties: "property", servicePlans: "recurring", jobs: "visit", cleaners: "team member", importedHistory: "past visit", openingBalances: "opening balance" };

export function VerifyStep() {
  const { view, companyId, act, go } = useMigration();
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
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[38rem] text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Records", "In files", "Created", "Updated", "Matched", "Skipped", "Failed", "Awaiting review", ""].map((h) => (
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

      <Release held={report.held} status={report.status} releasedAt={report.releasedAt} canRelease={view.canRelease} />
    </div>
  );
}

function Release({ held, status, releasedAt, canRelease }: { held: { visits: number; plans: number; cleaners: number }; status: string; releasedAt: number | null; canRelease: boolean }) {
  const { companyId, act } = useMigration();
  const release = useMutation(api.migration.release);
  const [sure, setSure] = useState(false);
  const scheduleHeld = held.visits + held.plans > 0;
  const [schedule, setSchedule] = useState(scheduleHeld);
  const [team, setTeam] = useState(held.cleaners > 0);
  if (!scheduleHeld && !held.cleaners) {
    return releasedAt ? (
      <Section title="Activation">
        <Note tone="done">You released your imported records on {new Date(releasedAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })}.</Note>
      </Section>
    ) : null;
  }
  return (
    <Section title="Activate what you imported" lead="Imported visits, recurring services and team members are on hold until you say so. Choose what to release and see what each does.">
      <div className="grid gap-3 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.06] to-transparent p-4">
        {scheduleHeld ? (
          <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-xs">
            <input type="checkbox" className="mt-0.5" checked={schedule} disabled={!canRelease} onChange={(e) => setSchedule(e.target.checked)} />
            <span className="grid gap-1">
              <span className="text-sm font-semibold text-strong">Your schedule</span>
              {held.visits ? <span className="text-strong"><Badge variant="info">Dispatch</Badge> Offers {plural(held.visits, "imported visit")} to your cleaners, following your Dispatch settings. Offers go to cleaners by text or email, which may use messaging credits.</span> : null}
              {held.plans ? <span className="text-strong"><Badge variant="info">Recurring</Badge> Starts {plural(held.plans, "recurring service")}: each books its visits up to four weeks ahead, skipping any day an imported booking already covers. Paused ones stay paused.</span> : null}
            </span>
          </label>
        ) : null}
        {held.cleaners ? (
          <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-xs">
            <input type="checkbox" className="mt-0.5" checked={team} disabled={!canRelease} onChange={(e) => setTeam(e.target.checked)} />
            <span className="grid gap-1">
              <span className="text-sm font-semibold text-strong">Your team</span>
              <span className="text-strong"><Badge variant="info">Team</Badge> {plural(held.cleaners, "imported team member")} start getting the usual onboarding follow-ups about the steps they still owe, by text or email. They stay onboarding, and aren&apos;t offered work until you make each one active.</span>
            </span>
          </label>
        ) : null}
        <p className="text-xs text-muted-foreground">Releasing doesn&apos;t message customers. Imported prices still wait for your approval in Services & Pricing, and opening balances are never charged.</p>
        {status !== "imported" && status !== "released" ? <Note tone="warning">Finish the import before releasing.</Note> : null}
        {canRelease ? (
          <>
            <label className="flex items-start gap-2 text-xs text-strong">
              <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
              I&apos;ve checked what I imported and want what I chose above to start working with it.
            </label>
            <Button variant="gradient" className="justify-self-start" disabled={!sure || (!schedule && !team) || (status !== "imported" && status !== "released")} onClick={() => void act(() => release({ companyId, confirm: true, schedule: schedule && scheduleHeld, team: team && held.cleaners > 0 }))}>
              <Rocket aria-hidden />
              Release what I chose
            </Button>
          </>
        ) : (
          <Note>Your company&apos;s Owner releases imported records, because it starts work with your team.</Note>
        )}
      </div>
    </Section>
  );
}
