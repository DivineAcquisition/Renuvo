"use client";

import { useQuery } from "convex/react";
import Link from "next/link";

import { useCompany } from "@/components/app/company";
import { Guard } from "@/components/app/settings/guard";
import { LifecycleBadge, WorkflowBadge } from "@/components/app/agreements/shared";
import { agreementPath, AGREEMENTS_ROOT } from "@/lib/app/agreements";

import { api } from "../../../../convex/_generated/api";

type Table = "customers" | "properties" | "cleaners" | "jobs" | "applications";

function Inner({ table, id, title }: { table: Table; id: string; title: string }) {
  const { companyId } = useCompany();
  const rows = useQuery(api.companyAgreements.forRecord, { companyId, table, id });
  if (!rows) return null;
  return (
    <div className="mt-2 text-sm" data-agreements-for={table}>
      <p className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        <Link href={`${AGREEMENTS_ROOT}/all`} className="text-brand-600 hover:underline">All agreements</Link>
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None you can see.</p>
      ) : (
        <ul className="grid gap-1">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={agreementPath(row.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 hover:border-brand-500/40">
                <span className="min-w-0 truncate text-strong">{row.title}</span>
                <span className="flex gap-1"><WorkflowBadge workflow={row.workflow} /><LifecycleBadge status={row.lifecycle} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The agreements about one record. What shows is only what the viewer's role may read; a restricted document is not counted or hinted at. */
export function AgreementsForRecord(props: { table: Table; id: string; title?: string }) {
  return (
    <Guard fallback={() => null}>
      <Inner table={props.table} id={props.id} title={props.title ?? "Agreements"} />
    </Guard>
  );
}
