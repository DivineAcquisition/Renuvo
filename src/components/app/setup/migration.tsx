"use client";

/**
 * Moving in from another system, during setup: where the owner's records are now, then clients,
 * appointments, recurring service, history and cleaners, each with help that fits that system and that
 * task. The review step shows what came in and what still waits for the owner.
 *
 * Help opens only when asked. The one first-time suggestion (the export card for the chosen system) can be
 * dismissed; the link that reopens it stays beside each upload.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";

import { canManage, useCompany } from "@/components/app/company";
import { TutorialCard, TutorialLink, SourcePicker, useSource } from "@/components/app/tutorials/offer";
import { ChevronDown, Users } from "@/components/icons";
import { Button } from "@/components/ui/button";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CADENCE_WORDS } from "../../../../convex/lib/migration/records";
import { PLATFORM_WORDS } from "../../../../convex/lib/tutorials/catalog";
import { ConnectedImport } from "./connectors";
import { ClientImport } from "./import";
import { RecordImport } from "./records-import";

function More({ id, title, hint, children }: { id: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 focus-visible:outline-2 focus-visible:outline-brand-500" aria-describedby={`${id}-hint`}>
        <span className="grid flex-1 gap-0.5">
          <span className="text-sm font-semibold text-strong">{title}</span>
          <span id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </span>
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

export function MigrationRecordsStep() {
  const [platform, setPlatform] = useSource();
  const named = platform && platform !== "spreadsheet" ? PLATFORM_WORDS[platform] : null;
  return (
    <>
      <SourcePicker value={platform} onChange={setPlatform} />
      {platform ? <TutorialCard key={platform} placement="setup.source" platform={platform} dismissKey={`setup.source:${platform}`} /> : null}
      <section className="grid gap-2" aria-labelledby="clients-heading">
        <h2 id="clients-heading" className="text-sm font-semibold text-strong">
          Your clients
        </h2>
        {platform === "jobber" || platform === "housecall_pro" || platform === null ? <ConnectedImport /> : null}
        <p className="text-xs text-muted-foreground">{named ? `Or from a ${named} export:` : "Or from a spreadsheet, including an export from Jobber, Housecall Pro or BookingKoala:"}</p>
        <ClientImport platform={platform} />
      </section>
      <section className="grid gap-2" aria-labelledby="more-heading">
        <h2 id="more-heading" className="text-sm font-semibold text-strong">
          More from {named ?? "your old system"}
        </h2>
        <p className="-mt-1 text-xs text-muted-foreground">Optional. Import clients first: each row is matched to one of them.</p>
        <More id="appointments" title="Upcoming appointments" hint="Visits already booked.">
          <RecordImport kind="appointment" platform={platform} />
        </More>
        <More id="recurring" title="Recurring service" hint="Which clients repeat, and how often.">
          <RecordImport kind="recurring" platform={platform} />
        </More>
        <More id="history" title="Invoices and service history" hint="Kept on each client for reference.">
          <RecordImport kind="history" platform={platform} />
        </More>
        <More id="team" title="Cleaners and team" hint="Brought in on the Cleaners page.">
          <div className="grid gap-3">
            <TutorialCard placement="import.team" platform={platform} />
            <Button variant="outline" render={<Link href="/app/cleaners/import" />} className="justify-self-start">
              <Users aria-hidden />
              Open cleaner import
            </Button>
          </div>
        </More>
      </section>
    </>
  );
}

/** On the review step: what came in, what still waits, and how to check it. */
export function MigrationReview() {
  const { companyId, role } = useCompany();
  const summary = useQuery(api.migrationImports.summary, canManage(role) ? { companyId } : "skip");
  if (!summary) return null;
  const any = summary.clients + summary.appointments.waiting + summary.recurring.waiting + summary.history > 0;
  if (!any) return null;
  return (
    <section className="grid gap-3 rounded-2xl border border-border bg-card p-4" aria-labelledby="imported-heading">
      <h2 id="imported-heading" className="text-sm font-semibold text-strong">
        What you brought in
      </h2>
      <ul className="grid gap-1 text-sm text-strong sm:grid-cols-2">
        <li>{summary.clients} clients</li>
        <li>{summary.appointments.waiting} appointments to review</li>
        <li>{summary.recurring.waiting} recurring schedules to set up</li>
        <li>{summary.history} history records</li>
      </ul>
      {summary.recurring.waiting || summary.appointments.waiting ? <Waiting /> : null}
      <TutorialLink placement="migration.review" platform={null} label="How to check your imported records" />
    </section>
  );
}

function Waiting() {
  const { companyId } = useCompany();
  const recurring = useQuery(api.migrationImports.waiting, { companyId, kind: "recurring" });
  const appointments = useQuery(api.migrationImports.waiting, { companyId, kind: "appointment" });
  const decide = useMutation(api.migrationImports.decide);
  const rows = [...(recurring ?? []).map((row) => ({ ...row, kind: "recurring" as const })), ...(appointments ?? []).map((row) => ({ ...row, kind: "appointment" as const }))].slice(0, 12);
  return (
    <ul className="grid gap-1.5" aria-label="Waiting for you">
      {rows.map((row) => (
        <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium text-strong">{row.client}</span>
            <span className="block text-xs text-muted-foreground">
              {row.kind === "recurring" ? (row.cadence ? CADENCE_WORDS[row.cadence] : `"${row.frequency ?? ""}"`) : `Visit ${row.day ?? ""}${row.time ? ` at ${row.time}` : ""}`}
              {row.description ? ` · ${row.description}` : ""}
            </span>
          </span>
          {/* Opens the client's existing plan form and its schedule preview; nothing is created from here. */}
          <Button size="xs" variant="outline" render={<Link href={`/app/clients/${row.customerId}/services?view=plans`} />}>
            {row.kind === "recurring" ? "Review schedule" : "Open client"}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => void decide({ companyId, recordId: row.id as Id<"migrationRecords">, review: "set_up" })}>
            Mark done
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** On a client's services tab: what was imported for them, kept as it came. */
export function ImportedRecords({ customerId }: { customerId: Id<"customers"> }) {
  const { companyId, role } = useCompany();
  const rows = useQuery(api.migrationImports.forClient, canManage(role) ? { companyId, customerId } : "skip");
  if (!rows?.length) return null;
  const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return (
    <details className="rounded-2xl border border-border bg-card [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium text-strong">
        Brought from your old system ({rows.length})
        <ChevronDown className="ml-auto size-4 text-muted-foreground" aria-hidden />
      </summary>
      <ul className="grid gap-1 border-t border-border p-3 text-sm">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap gap-x-3 rounded-lg px-2 py-1.5">
            <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{row.day ?? "—"}</span>
            <span className="min-w-0 flex-1 text-strong">
              {row.kind === "recurring" ? `Recurring: ${row.cadence ? CADENCE_WORDS[row.cadence] : (row.frequency ?? "")}` : row.kind === "appointment" ? `Appointment${row.time ? ` at ${row.time}` : ""}` : "History"}
              {row.description ? ` · ${row.description}` : ""}
              {row.reference ? ` · #${row.reference}` : ""}
            </span>
            {row.amountCents !== null ? <span className="tabular-nums text-muted-foreground">{money(row.amountCents)}</span> : null}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">Kept for reference as it came. Nothing here is booked, billed or sent.</p>
    </details>
  );
}
