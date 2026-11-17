"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { Field, FormError, SelectInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { CalendarCheckIcon, Users } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Starts a draft: from a completed visit (its price comes along) or for any customer. */
export function NewInvoiceDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: Id<"invoices">) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="New invoice" description="It starts as a draft. The customer sees nothing until you issue it and share the link.">
      <Picker onCreated={onCreated} />
    </Modal>
  );
}

function Picker({ onCreated }: { onCreated: (id: Id<"invoices">) => void }) {
  const { companyId } = useCompany();
  const sources = useQuery(api.finance.invoiceSources, { companyId });
  const create = useMutation(api.finance.createInvoice);
  const { busy, error, run } = useRun();
  const [mode, setMode] = useState<"job" | "customer">("job");
  const [customer, setCustomer] = useState("");
  if (!sources) return <Skeleton className="h-48 rounded-xl" />;
  return (
    <div className="grid gap-4">
      <div role="radiogroup" aria-label="Start from" className="grid grid-cols-2 gap-2">
        {(
          [
            { id: "job", label: "A completed visit", body: `${sources.jobs.length} not invoiced yet`, icon: CalendarCheckIcon },
            { id: "customer", label: "A customer", body: "Any amount, any reason", icon: Users },
          ] as const
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            onClick={() => setMode(option.id)}
            className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-brand-500", mode === option.id ? "border-brand-500/60 bg-brand-500/8" : "border-border hover:border-brand-500/30")}
          >
            <option.icon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <span>
              <span className="block text-sm font-medium text-strong">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.body}</span>
            </span>
          </button>
        ))}
      </div>
      {mode === "job" ? (
        sources.jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Every completed visit from the last 60 days with a price already has an invoice.</p>
        ) : (
          <ul className="grid max-h-80 gap-1.5 overflow-y-auto">
            {sources.jobs.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(async () => onCreated((await create({ companyId, jobId: job.id })).invoiceId))}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:border-brand-500/40 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-strong">{job.customer}</span>
                    <span className="block truncate text-xs text-muted-foreground">{job.label}</span>
                  </span>
                  <span className="text-sm tabular-nums text-strong">{job.priceCents !== null ? usd(job.priceCents) : "No price"}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!customer) return;
            void run(async () => onCreated((await create({ companyId, customerId: customer as Id<"customers"> })).invoiceId));
          }}
        >
          <Field label="Customer">
            <SelectInput value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Choose a customer</option>
              {sources.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Button type="submit" disabled={!customer || busy}>
            Start draft
          </Button>
        </form>
      )}
      <FormError message={error} />
    </div>
  );
}
