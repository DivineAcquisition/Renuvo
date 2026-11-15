"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { NewCleanerForm, NewCustomerForm } from "@/components/app/screens/forms";
import { PageHeader, Panel } from "@/components/app/shell";
import { Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";

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

const CLEANER_STATUS: Record<Doc<"cleaners">["status"], { label: string; variant: "success" | "warning" | "outline" | "info" }> = {
  ready: { label: "Ready for work", variant: "success" },
  onboarding: { label: "Onboarding", variant: "info" },
  paused: { label: "Paused", variant: "warning" },
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

export function RecordsScreen() {
  return (
    <>
      <PageHeader title="Records" lead="Customers, properties, cleaners and jobs are shared by every department and every agent. Nothing is copied into a department." />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <CustomersPanel />
        <CleanersPanel />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">Jobs live on the Schedule. Recurring plans arrive with Retention.</p>
    </>
  );
}
