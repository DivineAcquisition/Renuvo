"use client";

/**
 * Everything filed for a client, read from the records that own it: agreements and proposals from
 * Company Agreements, with their versions, signing and term; and supporting files. Each row opens its
 * own record, whose access rules decide who sees it. A document is called signed only when its record
 * says so, and how it was signed is shown in the record's own words.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Download, FileText, Paperclip, Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { agreementPath, CATEGORY, LIFECYCLE, PROVENANCE, WORKFLOW, type Tone } from "@/lib/app/agreements";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card, EmptyState } from "./bits";
import type { Profile } from "./profile";

type Docs = NonNullable<ReturnType<typeof useQuery<typeof api.clientDocuments.documents>>>;
type Agreement = Docs["agreements"][number];

const TONE: Record<Tone, "outline" | "info" | "warning" | "success" | "error"> = { neutral: "outline", info: "info", warning: "warning", success: "success", error: "error" };
const SOON_DAYS = 60;

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function DocumentsTab({ profile }: { profile: Profile }) {
  const { companyId } = useCompany();
  const docs = useQuery(api.clientDocuments.documents, { companyId, customerId: profile.id });
  const [showOld, setShowOld] = useState(false);
  if (docs === undefined) return <Skeleton className="h-80 rounded-2xl" />;
  const current = docs.agreements.filter((a) => !a.archived && a.lifecycle !== "superseded");
  const old = docs.agreements.filter((a) => a.archived || a.lifecycle === "superseded");
  const dates = current.flatMap((a) => [a.renewalOn ? { a, on: a.renewalOn, what: "Renewal" } : null, a.expiresOn ? { a, on: a.expiresOn, what: "Ends" } : null]).filter((row): row is { a: Agreement; on: string; what: string } => row !== null);
  const upcoming = dates.filter((d) => daysBetween(docs.today, d.on) <= SOON_DAYS).sort((x, y) => x.on.localeCompare(y.on));
  const fileExpiring = docs.files.filter((f) => f.expiresOn && daysBetween(docs.today, f.expiresOn) <= SOON_DAYS);
  return (
    <div className="grid min-w-0 gap-4">
      {upcoming.length || fileExpiring.length ? (
        <section aria-label="Renewals and expiries" className="rounded-2xl border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm">
          <p className="font-medium text-strong">Coming up in the next {SOON_DAYS} days</p>
          <ul className="mt-1 grid gap-1 text-muted-foreground">
            {upcoming.map((d) => (
              <li key={`${d.a.id}:${d.what}`}>
                {d.what} {daysBetween(docs.today, d.on) < 0 ? "was due" : "on"} {d.on}:{" "}
                <Link href={agreementPath(d.a.id)} className="text-brand-600 underline-offset-2 hover:underline dark:text-brand-300">
                  {d.a.title}
                </Link>
              </li>
            ))}
            {fileExpiring.map((f) => (
              <li key={f.id}>
                {f.name} {daysBetween(docs.today, f.expiresOn!) < 0 ? "expired" : "expires"} on {f.expiresOn}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card
        title="Agreements and proposals"
        action={
          <Link href={`/app/agreements/new?customer=${profile.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300">
            <Plus className="size-4" aria-hidden /> New agreement
          </Link>
        }
      >
        {current.length === 0 ? (
          <EmptyState title="No agreements">Agreements linked to {profile.name} or one of their properties appear here, with their versions and signing.</EmptyState>
        ) : (
          <ul className="grid gap-3">
            {current.map((a) => (
              <AgreementRow key={a.id} a={a} today={docs.today} />
            ))}
          </ul>
        )}
        {old.length ? (
          <div className="mt-4">
            <button type="button" className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
              {showOld ? "Hide" : "Show"} {old.length} replaced or archived
            </button>
            {showOld ? (
              <ul className="mt-3 grid gap-3 opacity-80">
                {old.map((a) => (
                  <AgreementRow key={a.id} a={a} today={docs.today} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <p className="mt-4 text-xs text-muted-foreground">Only agreements your role may read are listed. Each version, its signing history and the signed copy are on the agreement&apos;s own page.</p>
      </Card>

      <Card title="Files">
        {docs.files.length === 0 ? <p className="text-sm text-muted-foreground">No files filed for this client or their properties.</p> : <Files files={docs.files} today={docs.today} />}
      </Card>
    </div>
  );
}

function AgreementRow({ a, today }: { a: Agreement; today: string }) {
  const workflow = WORKFLOW[a.workflow];
  const lifecycle = LIFECYCLE[a.lifecycle];
  const provenance = PROVENANCE[a.provenance];
  // Signed is the record's word only: a signed workflow with a provenance that says how.
  const signed = a.workflow === "signed" && a.provenance !== "unsigned";
  return (
    <li className="rounded-xl border border-border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={agreementPath(a.id)} className="font-medium text-strong underline-offset-4 hover:underline">
            {a.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {a.type} · {CATEGORY[a.category] ?? a.category} · version {a.version}
            {a.signedVersion && a.signedVersion !== a.version ? ` · version ${a.signedVersion} is the signed one` : ""}
            {a.properties.length ? ` · ${a.properties.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {workflow ? (
            <Badge variant={TONE[workflow.tone]} size="sm" title={workflow.meaning}>
              {workflow.label}
            </Badge>
          ) : null}
          {lifecycle && a.lifecycle !== "none" ? (
            <Badge variant={TONE[lifecycle.tone]} size="sm">
              {lifecycle.label}
            </Badge>
          ) : null}
        </div>
      </div>
      {a.next ? <p className="mt-2 text-sm text-strong">{a.next}</p> : null}
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        {signed && provenance ? (
          <div>
            <dt className="sr-only">Signature</dt>
            <dd title={provenance.meaning}>{provenance.label}</dd>
          </div>
        ) : null}
        {a.signing && !signed ? (
          <div>
            <dt className="sr-only">Signers</dt>
            <dd>
              {a.signing.signers.filter((s) => s.status === "signed").length} of {a.signing.signers.length} signers signed
            </dd>
          </div>
        ) : null}
        {a.effectiveOn ? (
          <div>
            <dt className="inline">From </dt>
            <dd className="inline">{a.effectiveOn}</dd>
          </div>
        ) : null}
        {a.renewalOn ? (
          <div>
            <dt className="inline">Renewal </dt>
            <dd className={cn("inline", daysBetween(today, a.renewalOn) <= SOON_DAYS && "font-medium text-warning-foreground")}>{a.renewalOn}</dd>
          </div>
        ) : null}
        {a.expiresOn ? (
          <div>
            <dt className="inline">Ends </dt>
            <dd className="inline">{a.expiresOn}</dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

function Files({ files, today }: { files: Docs["files"]; today: string }) {
  const { companyId } = useCompany();
  const download = useMutation(api.agreementFiles.downloadUrl);
  const { busy, error, run } = useRun();
  return (
    <>
      <ul className="divide-y divide-border">
        {files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            {f.kind === "agreement" ? <FileText className="size-4 text-muted-foreground" aria-hidden /> : <Paperclip className="size-4 text-muted-foreground" aria-hidden />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-strong">{f.name}</p>
              <p className="text-xs text-muted-foreground">
                {f.kind === "agreement" ? "Agreement file" : (f.supportingKind?.replace(/_/g, " ") ?? "Supporting file")} · {f.about} · {Math.max(1, Math.round(f.size / 1024))} KB
                {f.expiresOn ? ` · ${daysBetween(today, f.expiresOn) < 0 ? "expired" : "expires"} ${f.expiresOn}` : ""}
              </p>
            </div>
            {f.agreementId ? (
              <Link href={agreementPath(f.agreementId)} className="text-xs font-medium text-brand-600 underline-offset-4 hover:underline dark:text-brand-300">
                Open agreement
              </Link>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const { url } = await download({ companyId, fileId: f.id as Id<"agreementFiles"> });
                  window.open(url, "_blank", "noopener");
                })
              }
            >
              <Download aria-hidden /> Download
            </Button>
          </li>
        ))}
      </ul>
      <FormError message={error} />
      <p className="mt-3 text-xs text-muted-foreground">Downloads are recorded. A file is never marked verified or signed here; its agreement says what was checked.</p>
    </>
  );
}
