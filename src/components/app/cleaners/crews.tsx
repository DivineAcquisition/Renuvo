"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { Submit } from "@/components/app/cleaners/forms";
import { Avatar, ReadinessLine, StatusBadge, type Row } from "@/components/app/cleaners/shared";
import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { Plus, Search, TeamIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/** Every permanent crew, with its lead and members. Membership never says who is free. */
export function CrewsDialog({ open, onClose, onNew, onFilter }: { open: boolean; onClose: () => void; onNew: () => void; onFilter: (crewId: Id<"crews">) => void }) {
  const company = useCompany();
  const crews = useQuery(api.crews.list, open ? { companyId: company.companyId } : "skip");
  return (
    <Modal open={open} onClose={onClose} title="Crews" description="Named teams that usually work together. Being on a crew does not make someone free: each member's own hours and readiness still decide." wide>
      <div className="grid gap-3">
        {canManage(company.role) ? (
          <div>
            <Button variant="primary" size="sm" onClick={onNew}>
              <Plus aria-hidden /> New crew
            </Button>
          </div>
        ) : null}
        {crews === undefined ? (
          <Skeleton className="h-24" />
        ) : crews.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No crews yet.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {crews.map((crew) => (
              <li key={crew.id} className="grid gap-2 rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium text-strong">
                    <TeamIcon className="size-4 text-brand-600 dark:text-brand-300" aria-hidden />
                    {crew.name}
                  </span>
                  <button type="button" onClick={() => onFilter(crew.id)} className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-300">
                    Show in directory
                  </button>
                </div>
                {crew.members.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No members.</p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {crew.members.map((member) => (
                      <li key={member.cleanerId} className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pr-2.5 pl-0.5 text-xs">
                        <Avatar initials={member.initials} seed={member.cleanerId} size="sm" className="size-6 text-[10px]" />
                        <span className="text-strong">{member.name}</span>
                        {member.role === "lead" ? <span className="font-medium text-brand-700 dark:text-brand-300">lead</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function NewCrew({ rows, onDone }: { rows: Row[]; onDone: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.crews.create);
  const { busy, error, run, setError } = useRun();
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [members, setMembers] = useState<Id<"cleaners">[]>([]);
  const [lead, setLead] = useState<Id<"cleaners"> | null>(null);
  const candidates = rows.filter((row) => row.status !== "ended" && row.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (members.length === 0) return setError("Choose at least one member.");
        void run(async () => {
          await create({ companyId, name, memberIds: members, leadId: lead ?? undefined });
          onDone();
        });
      }}
    >
      <Field label="Crew name">
        <TextInput value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
      </Field>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-strong">Members and lead</span>
        <label className="relative">
          <span className="sr-only">Find a person</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <TextInput value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find a person" className="pl-9" />
        </label>
        <ul className="max-h-72 divide-y divide-border overflow-auto rounded-xl border border-border">
          {candidates.map((row) => {
            const on = members.includes(row.cleanerId);
            return (
              <li key={row.cleanerId} className={cn("flex items-center gap-2.5 px-3 py-2", on && "bg-brand-500/5")}>
                <input
                  type="checkbox"
                  aria-label={`Add ${row.name}`}
                  checked={on}
                  onChange={() => {
                    setMembers((current) => (on ? current.filter((id) => id !== row.cleanerId) : [...current, row.cleanerId]));
                    if (on && lead === row.cleanerId) setLead(null);
                  }}
                  className="size-4 accent-[var(--color-brand-500)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-strong">
                    {row.name} <StatusBadge status={row.status} />
                  </span>
                  <ReadinessLine readiness={row.readiness} />
                </span>
                {on ? (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input type="radio" name="lead" checked={lead === row.cleanerId} onChange={() => setLead(row.cleanerId)} className="size-3.5 accent-[var(--color-brand-500)]" />
                    Lead
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">Each member keeps their own hours and readiness. A crew is offered work only through its members, one by one.</p>
      </div>
      <FormError message={error} />
      <Submit busy={busy} label="Create crew" onCancel={onDone} />
    </form>
  );
}

export function NewCrewDialog({ open, onClose, rows }: { open: boolean; onClose: () => void; rows: Row[] }) {
  return (
    <Modal open={open} onClose={onClose} title="New crew" description="A named team with one lead.">
      <NewCrew rows={rows} onDone={onClose} />
    </Modal>
  );
}
