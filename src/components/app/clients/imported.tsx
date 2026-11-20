"use client";

/**
 * What a migration brought over that isn't a live record: past visits from the old system (read-only
 * history, never jobs) and what the client owed there (opening balances, for reference, never charged).
 * Shown only when there is something to show.
 */
import { useQuery } from "convex/react";

import { useCompany } from "@/components/app/company";
import { HistoryIcon, Lock } from "@/components/icons";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Card } from "./bits";

const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const SOURCES: Record<string, string> = { jobber: "Jobber", housecall_pro: "Housecall Pro", csv: "your old system" };

export function ImportedHistory({ customerId }: { customerId: string }) {
  const { companyId } = useCompany();
  const rows = useQuery(api.migration.clientHistory, { companyId, customerId: customerId as Id<"customers"> });
  if (!rows?.length) return null;
  return (
    <Card title={`From ${SOURCES[rows[0].source] ?? "your old system"}`}>
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <HistoryIcon className="size-3.5" aria-hidden />
        Past visits brought over in your migration. Read-only: they aren&apos;t jobs, so they&apos;re never paid, invoiced or followed up.
      </p>
      <ul className="divide-y divide-border text-sm">
        {rows.map((h) => (
          <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2">
            <span className="text-strong">
              {day(h.day)} · {h.service ?? "Visit"}
            </span>
            <span className="text-xs text-muted-foreground">{[h.cleaner, h.outcome, h.priceCents !== null ? money(h.priceCents) : null].filter(Boolean).join(" · ")}</span>
            {h.notes ? <span className="w-full text-xs text-muted-foreground">{h.notes}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function OpeningBalances({ customerId }: { customerId: string }) {
  const { companyId } = useCompany();
  const data = useQuery(api.migration.clientBalances, { companyId, customerId: customerId as Id<"customers"> });
  if (!data?.rows.length) return null;
  return (
    <Card title="Opening balance from your old system">
      <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3.5" aria-hidden />
        For reference only. It isn&apos;t a Selestial invoice: it&apos;s never charged, reminded or added to what this client owes here. Collect it the way you did before, or create an invoice in Finance.
      </p>
      <ul className="divide-y divide-border text-sm">
        {data.rows.map((b) => (
          <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
            <span className="text-strong">Invoice {b.reference}</span>
            <span className="text-xs text-muted-foreground">{[b.issuedOn ? `issued ${day(b.issuedOn)}` : null, b.dueOn ? `due ${day(b.dueOn)}` : null].filter(Boolean).join(" · ")}</span>
            <span className="font-medium text-strong tabular-nums">{money(b.amountCents)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-right text-xs text-muted-foreground">Total in the old system: <span className="font-semibold text-strong">{money(data.totalCents)}</span></p>
    </Card>
  );
}
