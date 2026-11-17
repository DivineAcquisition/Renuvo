"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Submit } from "@/components/app/cleaners/forms";
import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Building2, Plus } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

function NewCompany({ onDone }: { onDone: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.subcontractors.create);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      className="grid gap-3 rounded-xl border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await create({ companyId, name: form.name, contactName: form.contactName || undefined, contactEmail: form.contactEmail || undefined, contactPhone: form.contactPhone || undefined });
          onDone();
        });
      }}
    >
      <Field label="Company name">
        <TextInput value={form.name} onChange={set("name")} required maxLength={160} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Authorized contact (optional)" hint="Speaks for the company. Not a worker unless added as one.">
          <TextInput value={form.contactName} onChange={set("contactName")} maxLength={160} />
        </Field>
        <Field label="Contact email (optional)">
          <TextInput type="email" value={form.contactEmail} onChange={set("contactEmail")} />
        </Field>
        <Field label="Contact phone (optional)">
          <TextInput type="tel" value={form.contactPhone} onChange={set("contactPhone")} />
        </Field>
      </div>
      <FormError message={error} />
      <Submit busy={busy} label="Add company" onCancel={onDone} />
    </form>
  );
}

function StatusChange({ id, name, to, onDone }: { id: Id<"subcontractors">; name: string; to: "active" | "paused" | "ended"; onDone: () => void }) {
  const { companyId } = useCompany();
  const setStatus = useMutation(api.subcontractors.setStatus);
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-2 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await setStatus({ companyId, subcontractorId: id, status: to, reason: reason || undefined });
          onDone();
        });
      }}
    >
      {to !== "active" ? (
        <Field label={`Why is ${name} being ${to === "paused" ? "paused" : "ended"}?`} hint="Their workers keep their own status. Each one still active is listed under Needs attention for you to decide.">
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} rows={2} />
        </Field>
      ) : null}
      <FormError message={error} />
      <Submit busy={busy} label={to === "active" ? "Make active" : to === "paused" ? "Pause company" : "End company"} onCancel={onDone} />
    </form>
  );
}

/** Subcontractor companies: the organization, its contact, and how many of its people work here now. */
export function SubcontractorsDialog({ open, onClose, onFilter }: { open: boolean; onClose: () => void; onFilter: (id: Id<"subcontractors">) => void }) {
  const company = useCompany();
  const rows = useQuery(api.subcontractors.list, open ? { companyId: company.companyId } : "skip");
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<{ id: Id<"subcontractors">; to: "active" | "paused" | "ended" } | null>(null);
  const manager = canManage(company.role);
  return (
    <Modal open={open} onClose={onClose} title="Subcontractor companies" description="Companies that supply their own cleaners. Jobs always go to a named person; which company supplied them is kept in their history." wide>
      <div className="grid gap-3">
        {manager && !adding ? (
          <div>
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden /> Add a company
            </Button>
          </div>
        ) : null}
        {adding ? <NewCompany onDone={() => setAdding(false)} /> : null}
        {rows === undefined ? (
          <Skeleton className="h-24" />
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No subcontractor companies yet.</p>
        ) : (
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium text-strong">
                      <Building2 className="size-4 text-brand-600 dark:text-brand-300" aria-hidden />
                      {row.name}
                      {row.status !== "active" ? <Badge variant={row.status === "paused" ? "warning" : "outline"} size="sm">{row.status === "paused" ? "Paused" : "Ended"}</Badge> : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {row.contactName ? `Contact: ${row.contactName}` : "No contact on record"}
                      {row.contactEmail ? ` · ${row.contactEmail}` : ""}
                      {row.contactPhone ? ` · ${row.contactPhone}` : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {row.currentWorkers} working through them now{row.pastWorkers > 0 ? ` · ${row.pastWorkers} before` : ""}
                    </span>
                    {row.statusNote ? <span className="mt-1 block text-xs text-muted-foreground">“{row.statusNote}”</span> : null}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    <Button variant="ghost" size="xs" onClick={() => onFilter(row.id)}>
                      Show workers
                    </Button>
                    {manager ? (
                      row.status === "active" ? (
                        <>
                          <Button variant="ghost" size="xs" onClick={() => setChanging({ id: row.id, to: "paused" })}>
                            Pause
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setChanging({ id: row.id, to: "ended" })}>
                            End
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="xs" onClick={() => setChanging({ id: row.id, to: "active" })}>
                          Make active
                        </Button>
                      )
                    ) : null}
                  </span>
                </div>
                {changing?.id === row.id ? <StatusChange id={row.id} name={row.name} to={changing.to} onDone={() => setChanging(null)} /> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
