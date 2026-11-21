"use client";

/**
 * Subcontractor companies: businesses that supply their own cleaners. Each worker has their own record here;
 * the company has an authorized contact, who can be given a link to see only their own workers, what each
 * still needs, and their upcoming jobs. Ending the relationship is the Owner's, with a reason, and ends the
 * contact's access; the workers keep their records and history.
 */
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { Field, FormError, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { ArrowLeft, Building2, Check, Copy, Mail, MapPin, PenLine, Phone, Plus, Users, X } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ago, dayName } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { StatusBadge } from "./bits";
import { CLEANERS_PATH, profilePath } from "./state";
import { EmailInput, PhoneInput } from "@/components/ui/fields";

type Row = FunctionReturnType<typeof api.subcontractors.list>[number];
type Detail = FunctionReturnType<typeof api.subcontractors.get>;

const STATUS = { active: { label: "Active", variant: "success" }, paused: { label: "Paused", variant: "warning" }, ended: { label: "Ended", variant: "outline" } } as const;

function setParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("subcontractor", id);
  else url.searchParams.delete("subcontractor");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function SubcontractorsScreen() {
  const { companyId, role } = useCompany();
  const rows = useQuery(api.subcontractors.list, { companyId });
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(params.get("subcontractor"));
  const [adding, setAdding] = useState(false);
  const manager = canManage(role);
  const choose = (id: string | null) => {
    setOpen(id);
    setParam(id);
  };
  return (
    <>
      <Link href={CLEANERS_PATH} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-strong">
        <ArrowLeft className="size-4" aria-hidden />
        Cleaners
      </Link>
      <PageHeader
        title="Subcontractor companies"
        lead="Companies that supply their own cleaners. Each worker has their own record and is checked like anyone else; the company's contact can see only their own workers."
        actions={
          manager ? (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add company
            </Button>
          ) : null
        }
      />
      {adding ? <CompanyDialog onClose={() => setAdding(false)} /> : null}
      {!rows ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
          <Building2 className="mx-auto size-6 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium text-strong">No subcontractor companies</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Add one when another business supplies cleaners to you. Its workers are then added as subcontractor workers.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul className="grid content-start gap-2" aria-label="Subcontractor companies">
            {rows.map((row) => (
              <li key={row.subcontractorId}>
                <CompanyRow row={row} selected={open === row.subcontractorId} onSelect={() => choose(open === row.subcontractorId ? null : row.subcontractorId)} />
                {open === row.subcontractorId ? (
                  <div className="mt-2 lg:hidden">
                    <CompanyDetail subcontractorId={row.subcontractorId} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="hidden lg:block">{open ? <CompanyDetail subcontractorId={open as Id<"subcontractors">} /> : <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">Choose a company to see its workers and its contact&apos;s access.</p>}</div>
        </div>
      )}
    </>
  );
}

function CompanyRow({ row, selected, onSelect }: { row: Row; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" aria-expanded={selected} onClick={onSelect} className={cn("flex w-full items-start justify-between gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-500", selected ? "border-brand-500" : "border-border hover:border-brand-500/40")}>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-semibold text-strong">{row.name}</span>
          <Badge variant={STATUS[row.status].variant} size="sm">
            {STATUS[row.status].label}
          </Badge>
        </span>
        <span className="mt-0.5 block text-sm text-muted-foreground">Contact: {row.contact.name}</span>
        {row.serviceAreas.length ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">Areas: {row.serviceAreas.join(", ")}</span> : null}
      </span>
      <span className="shrink-0 text-right text-sm">
        <span className="block font-semibold text-strong">{row.workers}</span>
        <span className="text-xs text-muted-foreground">{row.workers === 1 ? "worker" : "workers"} · {row.activeWorkers} active</span>
      </span>
    </button>
  );
}

function CompanyDetail({ subcontractorId }: { subcontractorId: Id<"subcontractors"> }) {
  const { companyId, role } = useCompany();
  const data = useQuery(api.subcontractors.get, { companyId, subcontractorId });
  const [editing, setEditing] = useState(false);
  const [ending, setEnding] = useState<"paused" | "ended" | "active" | null>(null);
  if (!data) return <Skeleton className="h-80 rounded-2xl" />;
  const manager = canManage(role);
  return (
    <article className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label={data.name}>
      {editing ? <CompanyDialog detail={data} onClose={() => setEditing(false)} /> : null}
      {ending ? <StatusDialog detail={data} to={ending} onClose={() => setEnding(null)} /> : null}
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-strong">{data.name}</h2>
          <p className="text-sm text-muted-foreground">
            {data.contact.name}
            {"title" in data.contact && data.contact.title ? `, ${data.contact.title}` : ""}
          </p>
        </div>
        {manager && data.status !== "ended" ? (
          <Button variant="ghost" size="xs" onClick={() => setEditing(true)}>
            <PenLine aria-hidden />
            Change
          </Button>
        ) : null}
      </header>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {"phone" in data.contact && data.contact.phone ? (
          <div className="flex items-center gap-2">
            <Phone className="size-4 text-muted-foreground" aria-hidden />
            <dt className="sr-only">Phone</dt>
            <dd className="text-strong">{data.contact.phone}</dd>
          </div>
        ) : null}
        {"email" in data.contact && data.contact.email ? (
          <div className="flex items-center gap-2">
            <Mail className="size-4 text-muted-foreground" aria-hidden />
            <dt className="sr-only">Email</dt>
            <dd className="truncate text-strong">{data.contact.email}</dd>
          </div>
        ) : null}
        {data.serviceAreas.length ? (
          <div className="flex items-center gap-2 sm:col-span-2">
            <MapPin className="size-4 text-muted-foreground" aria-hidden />
            <dt className="sr-only">Areas</dt>
            <dd className="text-strong">{data.serviceAreas.join(", ")}</dd>
          </div>
        ) : null}
      </dl>
      {data.notes ? <p className="rounded-xl bg-muted/40 px-3 py-2 text-sm text-strong">{data.notes}</p> : null}

      <section aria-label="Workers" className="grid gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-strong">
          <Users className="size-4" aria-hidden />
          Workers
        </h3>
        {data.workers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No workers yet. Add one from the directory as a subcontractor worker.</p>
        ) : (
          <ul className="grid gap-1">
            {data.workers.map((worker) => (
              <li key={worker.cleanerId} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/40">
                <Link href={profilePath(worker.cleanerId)} className="truncate text-sm font-medium text-strong underline-offset-4 hover:underline">
                  {worker.name}
                </Link>
                <StatusBadge status={worker.status} />
              </li>
            ))}
          </ul>
        )}
        {data.former.length ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Worked through them before ({data.former.length})</summary>
            <ul className="mt-1 grid gap-0.5">
              {data.former.map((row) => (
                <li key={`${row.cleanerId}-${row.from}`}>{row.name}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {manager ? <ContactAccess detail={data} /> : null}

      {role === "owner" ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {data.status === "active" ? (
            <Button variant="ghost" size="sm" onClick={() => setEnding("paused")}>
              Pause
            </Button>
          ) : null}
          {data.status === "paused" ? (
            <Button variant="ghost" size="sm" onClick={() => setEnding("active")}>
              Resume
            </Button>
          ) : null}
          {data.status !== "ended" ? (
            <Button variant="outline" size="sm" onClick={() => setEnding("ended")}>
              End the relationship
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">This relationship has ended. Its workers keep their records.</p>
          )}
        </footer>
      ) : null}
    </article>
  );
}

function ContactAccess({ detail }: { detail: Detail }) {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const data = useQuery(api.portalAccess.contactAccess, { companyId, subcontractorId: detail.subcontractorId });
  const make = useMutation(api.portalAccess.inviteContact);
  const reveal = useMutation(api.portalAccess.reveal);
  const revoke = useMutation(api.portalAccess.revoke);
  const { busy, error, run } = useRun();
  const [words, setWords] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!data) return <Skeleton className="h-24 rounded-xl" />;
  const live = data.links.find((link) => link.state === "active") ?? null;
  const copy = (linkId: Id<"portalLinks">) =>
    run(async () => {
      const { url } = await reveal({ companyId, linkId });
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    });
  return (
    <section aria-label="Contact's access" className="grid gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-strong">{data.contact}&apos;s access</h3>
          <p className="text-xs text-muted-foreground">Their own workers, what each still needs, and their upcoming jobs. They can tell you when a worker will be away. No documents, notes or pay.</p>
        </div>
        {detail.status !== "ended" ? (
          <Button
            variant={live ? "outline" : "primary"}
            size="xs"
            loading={busy}
            disabled={!data.configured}
            onClick={() =>
              void run(async () => {
                const answer = await make({ companyId, subcontractorId: detail.subcontractorId });
                setWords(answer.words);
                await copy(answer.linkId);
              })
            }
          >
            {live ? "Make a new link" : "Make a link"}
          </Button>
        ) : null}
      </div>
      {!data.configured ? <p className="text-sm text-muted-foreground">Links are not set up on this deployment yet.</p> : null}
      {words ? (
        <p className="rounded-lg bg-muted/40 px-2.5 py-1.5 text-sm text-strong" role="status">
          {copied ? "Copied. " : ""}
          {words}
        </p>
      ) : null}
      {live ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-2.5 py-2">
          <span className="text-xs text-muted-foreground">
            Works until {dayName(live.expiresAt, timezone)} · {live.lastActionAt ? `last used ${ago(live.lastActionAt, now, timezone)}` : "not used yet"}
          </span>
          <span className="flex gap-1">
            <Button variant="outline" size="xs" onClick={() => void copy(live.linkId)}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void run(() => revoke({ companyId, linkId: live.linkId, reason: "Ended by the office." }))}>
              <X aria-hidden />
              End access
            </Button>
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No live link.</p>
      )}
      <FormError message={error} />
    </section>
  );
}

// ── Adding, changing and ending ─────────────────────────────────────────────────────────────────────

function CompanyDialog({ detail, onClose }: { detail?: Detail; onClose: () => void }) {
  const { companyId } = useCompany();
  const create = useMutation(api.subcontractors.create);
  const update = useMutation(api.subcontractors.update);
  const { busy, error, run } = useRun();
  const contact = detail?.contact as { name: string; title?: string; email?: string; phone?: string } | undefined;
  const [form, setForm] = useState({ name: detail?.name ?? "", contactName: contact?.name ?? "", title: contact?.title ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", areas: detail?.serviceAreas.join(", ") ?? "", notes: detail?.notes ?? "" });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((current) => ({ ...current, [key]: event.target.value }));
  return (
    <Modal open onClose={onClose} title={detail ? `Change ${detail.name}` : "Add a subcontractor company"} description="The contact is the person authorized to act for the company.">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const fields = { name: form.name, contact: { name: form.contactName, title: form.title || undefined, email: form.email || undefined, phone: form.phone || undefined }, serviceAreas: form.areas.split(",").map((item) => item.trim()).filter(Boolean), notes: form.notes || undefined };
            if (detail) await update({ companyId, subcontractorId: detail.subcontractorId, ...fields });
            else await create({ companyId, ...fields });
            onClose();
          });
        }}
      >
        <Field label="Company name">
          <TextInput value={form.name} onChange={set("name")} required maxLength={160} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact's name">
            <TextInput value={form.contactName} onChange={set("contactName")} required maxLength={120} />
          </Field>
          <Field label="Their role (optional)">
            <TextInput value={form.title} onChange={set("title")} maxLength={80} placeholder="Owner" />
          </Field>
          <Field label="Mobile (optional)">
            <PhoneInput value={form.phone} onChange={(text) => set("phone")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
          </Field>
          <Field label="Email (optional)">
            <EmailInput value={form.email} onChange={(text) => set("email")({ target: { type: "text", value: text } } as unknown as React.ChangeEvent<HTMLInputElement>)} />
          </Field>
        </div>
        <Field label="Postal codes they cover (optional)" hint="Separate with commas.">
          <TextInput value={form.areas} onChange={set("areas")} />
        </Field>
        <Field label="Notes (optional)" hint="Only Owners and Managers see these.">
          <TextArea value={form.notes} onChange={set("notes")} rows={2} maxLength={2000} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            {detail ? "Save" : "Add company"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Impact = FunctionReturnType<typeof api.subcontractors.endImpact>;

/** The accepted jobs and open offers ending the relationship touches, before the Owner decides. */
function EndImpact({ impact }: { impact: Impact | undefined }) {
  if (impact === undefined) return <Skeleton className="h-14 rounded-xl" />;
  if (impact.workers.length === 0) return <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">No current workers come through this company.</p>;
  if (impact.accepted === 0 && impact.offered === 0) {
    return <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">None of their {impact.workers.length === 1 ? "worker" : `${impact.workers.length} workers`} has upcoming work or an open offer.</p>;
  }
  return (
    <div className="grid gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
      <p className="font-medium text-strong">
        {impact.accepted > 0 ? `${impact.accepted} accepted ${impact.accepted === 1 ? "job stays" : "jobs stay"} as ${impact.accepted === 1 ? "it is" : "they are"} and ${impact.accepted === 1 ? "goes" : "go"} to a person in Dispatch to decide.` : ""}
        {impact.accepted > 0 && impact.offered > 0 ? " " : ""}
        {impact.offered > 0 ? `${impact.offered} open ${impact.offered === 1 ? "offer" : "offers"} can no longer be accepted.` : ""}
      </p>
      <ul className="grid gap-1">
        {impact.workers
          .filter((worker) => worker.accepted.length > 0 || worker.offered > 0)
          .map((worker) => (
            <li key={worker.cleanerId}>
              <span className="font-medium text-strong">{worker.name}</span>
              <span className="text-muted-foreground">
                {worker.accepted.length > 0 ? `: ${worker.accepted.map((job) => job.label).join("; ")}` : ""}
                {worker.offered > 0 ? `${worker.accepted.length > 0 ? "," : ":"} ${worker.offered} open ${worker.offered === 1 ? "offer" : "offers"}` : ""}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

function StatusDialog({ detail, to, onClose }: { detail: Detail; to: "active" | "paused" | "ended"; onClose: () => void }) {
  const { companyId } = useCompany();
  const setStatus = useMutation(api.subcontractors.setStatus);
  const { busy, error, run } = useRun();
  const [reason, setReason] = useState("");
  const title = to === "ended" ? `End the relationship with ${detail.name}` : to === "paused" ? `Pause ${detail.name}` : `Resume ${detail.name}`;
  const impact = useQuery(api.subcontractors.endImpact, to === "ended" ? { companyId, subcontractorId: detail.subcontractorId } : "skip");
  const description =
    to === "ended"
      ? "Their contact's access ends, and no new work is offered to their workers through them. Their workers keep their records and history, and nobody is taken off a job they accepted: those jobs go to a person to decide."
      : to === "paused"
        ? "Nothing about their workers changes. Use this while you sort something out with them."
        : "Work with them as before.";
  return (
    <Modal open onClose={onClose} title={title} description={description}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await setStatus({ companyId, subcontractorId: detail.subcontractorId, status: to, reason });
            onClose();
          });
        }}
      >
        {to === "ended" ? <EndImpact impact={impact} /> : null}
        <Field label="Reason" hint="Kept with the company's history.">
          <TextArea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} required maxLength={500} />
        </Field>
        <FormError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant={to === "ended" ? "destructive" : "primary"} loading={busy}>
            {to === "ended" ? "End the relationship" : to === "paused" ? "Pause" : "Resume"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
