"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";

import { AgreementsForRecord } from "@/components/app/agreements/record";
import { canManage, useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";

import { NewCleanerForm, NewCustomerForm } from "@/components/app/screens/forms";
import { PageHeader, Panel } from "@/components/app/shell";
import { Home, Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { servicePath } from "@/lib/app/services";

import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { formatCents } from "../../../../convex/lib/services/words";

const KIND: Record<string, string> = { home: "Home", short_term_rental: "Short-term rental", property_manager: "Property manager", commercial: "Commercial" };

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function CustomersPanel() {
  const { companyId } = useCompany();
  const customers = useQuery(api.customers.list, { companyId });
  const ownPrices = useQuery(api.propertyPrices.forCompany, { companyId });
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
                <span className="flex items-center gap-2">
                  <Badge variant="outline" size="sm">
                    {KIND[customer.kind]}
                  </Badge>
                  <Link href={`/app/agents/sales/new?mode=booking&customer=${customer._id}&from=customer`} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-strong hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500">
                    Book service
                  </Link>
                </span>
                {ownPrices?.[customer._id]?.length ? <OwnPrices rows={ownPrices[customer._id]} /> : null}
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

type OwnPrice = NonNullable<ReturnType<typeof useQuery<typeof api.propertyPrices.forCompany>>>[string][number];

/** The customer's properties that have their own price for a service, each linked to the service where it is changed. */
function OwnPrices({ rows }: { rows: OwnPrice[] }) {
  return (
    <ul aria-label="Property prices" className="grid basis-full grid-cols-1 gap-1">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={servicePath(row.serviceId)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-brand-500/40">
            <span className="flex min-w-0 items-center gap-2">
              <Home aria-hidden className="size-4 shrink-0 text-brand-300" />
              <span className="min-w-0">
                <span className="text-strong">{row.property}</span>
                <span className="text-muted-foreground"> · {row.service}</span>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              {row.tasks ? (
                <Badge variant="outline" size="sm">
                  +{row.tasks} task{row.tasks === 1 ? "" : "s"}
                </Badge>
              ) : null}
              {row.extras ? (
                <Badge variant="outline" size="sm">
                  {row.extras} extra{row.extras === 1 ? "" : "s"} differ
                </Badge>
              ) : null}
              {row.untilWords ? (
                <Badge variant={row.dueSoon ? "warning" : "outline"} size="sm">
                  {row.untilWords}
                </Badge>
              ) : null}
              <span className="font-medium tabular-nums text-strong">{formatCents(row.baseCents)} base</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const CLEANER_STATUS: Record<Doc<"cleaners">["status"], { label: string; variant: "success" | "warning" | "outline" | "info" }> = {
  ready: { label: "Ready for work", variant: "success" },
  onboarding: { label: "Onboarding", variant: "info" },
  paused: { label: "Paused", variant: "warning" },
  suspended: { label: "Suspended", variant: "warning" },
  ended: { label: "Ended", variant: "outline" },
};

function CleanerRow({ cleaner }: { cleaner: Doc<"cleaners"> }) {
  const { companyId, role } = useCompany();
  const setStatus = useMutation(api.cleaners.setStatus);
  const { busy, error, run } = useRun();
  const status = CLEANER_STATUS[cleaner.status];
  return (
    <li className="px-4 py-3 text-sm sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="font-medium text-strong">{cleaner.name}</span>
          <span className="block text-xs text-muted-foreground">
            {cleaner.engagement === "contractor" ? "Contractor" : "Employee"}
            {cleaner.skills.length > 0 ? ` · ${cleaner.skills.join(", ")}` : ""}
            {cleaner.serviceAreas.length > 0 ? ` · works in ${cleaner.serviceAreas.join(", ")}` : " · no service areas set"}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
          {/* A person decides a cleaner's standing. No agent can. */}
          {canManage(role) && cleaner.status !== "ended" ? (
            <Button variant="ghost" size="xs" loading={busy} onClick={() => void run(() => setStatus({ companyId, cleanerId: cleaner._id, status: cleaner.status === "ready" ? "paused" : "ready" }))}>
              {cleaner.status === "ready" ? "Pause" : "Mark ready"}
            </Button>
          ) : null}
        </span>
      </div>
      <FormError message={error} />
      {canManage(role) ? <AgreementsForRecord table="cleaners" id={cleaner._id} title="Workforce documents you can see" /> : null}
    </li>
  );
}

export function CleanersPanel() {
  const { companyId, role } = useCompany();
  const ready = useQuery(api.cleaners.list, { companyId, status: "ready" });
  const onboarding = useQuery(api.cleaners.list, { companyId, status: "onboarding" });
  const paused = useQuery(api.cleaners.list, { companyId, status: "paused" });
  const [adding, setAdding] = useState(false);
  const loaded = ready && onboarding && paused;
  const all = loaded ? [...ready, ...onboarding, ...paused] : [];
  return (
    <>
      <Panel
        title="Cleaners"
        flush
        action={
          canManage(role) ? (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add a cleaner
            </Button>
          ) : undefined
        }
      >
        {!loaded ? (
          <div className="p-5">
            <Skeleton className="h-10" />
          </div>
        ) : all.length === 0 ? (
          <Empty>No cleaners yet. Add one with the hours they said they can work.</Empty>
        ) : (
          <ul className="divide-y divide-border">
            {all.map((cleaner) => (
              <CleanerRow key={cleaner._id} cleaner={cleaner} />
            ))}
          </ul>
        )}
      </Panel>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a cleaner" description="Their hours are what they told you. Nobody is offered a time outside them.">
        <NewCleanerForm onDone={() => setAdding(false)} />
      </Modal>
    </>
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
