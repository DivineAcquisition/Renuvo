"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { AgreementsForRecord } from "@/components/app/agreements/record";
import { useCompany } from "@/components/app/company";
import { Modal } from "@/components/app/modal";
import { NewCustomerForm } from "@/components/app/screens/forms";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CLEANERS_ROOT } from "@/lib/app/cleaners";

import { api } from "../../../../convex/_generated/api";

const KIND: Record<string, string> = { home: "Home", short_term_rental: "Short-term rental", property_manager: "Property manager", commercial: "Commercial" };

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function CustomersPanel() {
  const { companyId } = useCompany();
  const customers = useQuery(api.customers.list, { companyId });
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Panel
        title="Customers"
        flush
        action={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add a customer
          </Button>
        }
      >
        {customers === undefined ? (
          <div className="p-5">
            <Skeleton className="h-10" />
          </div>
        ) : customers.length === 0 ? (
          <Empty>No customers yet. Add one with their property, then schedule a visit.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {customers.map((customer) => (
              <li key={customer._id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm sm:px-5">
                <span>
                  <span className="font-medium text-strong">{customer.name}</span>
                  <span className="block text-xs text-muted-foreground">{[customer.email, customer.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                </span>
                <Badge variant="outline" size="sm">
                  {KIND[customer.kind]}
                </Badge>
                <div className="basis-full">
                  <AgreementsForRecord table="customers" id={customer._id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a customer" description="A customer and their first property.">
        <NewCustomerForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}

/**
 * The Operations workspace's view of the cleaners: the same four counts as the Cleaners workspace, from
 * the same query, with a link there. Adding, editing and status changes live in the Cleaners workspace.
 */
export function CleanersPanel() {
  const { companyId } = useCompany();
  const now = useNow();
  const data = useQuery(api.workforce.workspace, now ? { companyId, asOf: now } : "skip");
  return (
    <Panel title="Cleaners" action={<Link href={CLEANERS_ROOT} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Open Cleaners</Link>}>
      {data === undefined ? (
        <Skeleton className="h-16" />
      ) : data.counts.total === 0 ? (
        <Empty>No cleaners yet. Add them in Cleaners.</Empty>
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["Ready for assignments", data.counts.ready],
              ["Onboarding", data.counts.onboarding],
              ["Needs attention", data.counts.attention],
              ["Working today", data.counts.workingToday],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-heading text-xl text-strong tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Panel>
  );
}

export function CustomersScreen() {
  return (
    <>
      <PageHeader title="Customers & Properties" lead="The customers of this company and the properties they have service at. Every department and every agent reads these same records." />
      <CustomersPanel />
      <p className="mt-4 text-xs text-muted-foreground">A page for each customer, with their properties, preferences and service history, is not built yet.</p>
    </>
  );
}
