"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useState } from "react";

import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { missingSetup } from "@/components/app/not-set-up";
import { PageHeader, Panel } from "@/components/app/shell";
import { UserMenu } from "@/components/auth/user-menu";
import { LogoMark } from "@/components/brand/logo";
import { ArrowLeft } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

/**
 * Selestial's own staff console: the public request queues, the trust records the public pages are
 * built from, carrier registrations, and who is staff. Separate from any company workspace. Every read
 * and write is checked again on the server (staffQuery, staffMutation); this gate only decides what to
 * draw, and to anyone who is not staff it looks like a page that does not exist.
 */
export function StaffGate({ children }: { children: React.ReactNode }) {
  // A deployment with no sign-in or record (a preview without settings) has no providers to ask.
  if (missingSetup().length > 0) return <NotFound />;
  return <StaffCheck>{children}</StaffCheck>;
}

function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/50 p-6">
      <p className="text-base font-semibold text-strong">Not found.</p>
    </main>
  );
}

function StaffCheck({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.staff.me, isAuthenticated ? {} : "skip");
  if (isLoading || (isAuthenticated && me === undefined)) {
    return (
      <div className="mx-auto max-w-6xl p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-10 w-60" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    );
  }
  if (!me) return <NotFound />;
  return <StaffShell role={me.role}>{children}</StaffShell>;
}

const NAV = [
  { href: "/staff", label: "Requests" },
  { href: "/staff/trust", label: "Trust records" },
  { href: "/staff/companies", label: "Companies" },
  { href: "/staff/setup", label: "Setup funnel" },
  { href: "/staff/texting", label: "Texting" },
  { href: "/staff/people", label: "Staff" },
  { href: "/staff/ai", label: "AI models" },
];

function StaffShell({ role, children }: { role: "admin" | "reviewer"; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-dvh bg-muted/50">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/staff" className="flex items-center gap-2 font-heading text-base text-strong">
            <LogoMark className="size-7" />
            Selestial staff
          </Link>
          <Badge variant={role === "admin" ? "info" : "outline"}>{role === "admin" ? "Admin" : "Reviewer"}</Badge>
          <nav aria-label="Staff" className="order-last flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
            {NAV.map((item) => {
              const active = item.href === "/staff" ? pathname === "/staff" || pathname.startsWith("/staff/requests") : pathname.startsWith(item.href);
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("rounded-lg px-3 py-1.5 text-sm whitespace-nowrap", active ? "bg-brand-500/10 font-semibold text-brand-700" : "text-muted-foreground hover:text-strong")}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

// ── Requests ──────────────────────────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { privacy: "Privacy", vulnerability: "Vulnerability", security_review: "Security review" };
const SUBTYPE_LABEL: Record<string, string> = { access: "See information", correction: "Correct", deletion: "Delete", communication_preferences: "Contact preferences", other: "Other" };
const STATUS_LABEL: Record<string, string> = {
  received: "Received",
  verifying: "Verifying",
  in_progress: "In progress",
  waiting_on_requester: "Waiting on requester",
  routed_to_business: "Routed to business",
  completed: "Completed",
  closed_with_limitation: "Closed with limitation",
  spam: "Spam",
};
const RELATIONSHIP_LABEL: Record<string, string> = {
  cleaning_company_customer: "Company using Selestial",
  customer_of_a_cleaning_company: "Customer of a cleaning company",
  cleaner: "Cleaner",
  applicant: "Applicant",
  other: "Other",
};
const OPEN = new Set(["received", "verifying", "in_progress", "waiting_on_requester", "routed_to_business"]);
const when = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function statusBadge(status: string) {
  const variant = status === "completed" ? "success" : status === "spam" || status === "closed_with_limitation" ? "outline" : status === "received" ? "warning" : "info";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function RequestQueue() {
  const [kind, setKind] = useState<"" | "privacy" | "vulnerability" | "security_review">("");
  const [status, setStatus] = useState("");
  const rows = useQuery(api.requests.queue, { ...(kind ? { kind } : {}), ...(status ? { status: status as keyof typeof STATUS_LABEL & never } : {}) });
  return (
    <>
      <PageHeader title="Requests" lead="Privacy requests, vulnerability reports and security questions from the public site. Each one was saved before anyone was told." />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Kind" className="w-48">
          <SelectInput value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="">All kinds</option>
            {Object.entries(KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Status" className="w-56">
          <SelectInput value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Panel flush>
        {rows === undefined ? (
          <div className="p-4">
            <Skeleton className="h-40" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/staff/requests/${row.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-overlay/[0.03] sm:px-5">
                  <span className="font-mono text-xs text-muted-foreground">{row.reference}</span>
                  <span className="text-sm font-medium text-strong">
                    {KIND_LABEL[row.kind]}
                    {row.subtype ? ` · ${SUBTYPE_LABEL[row.subtype] ?? row.subtype}` : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{row.requester.email}</span>
                  <span className="text-xs text-muted-foreground">{when(row.receivedAt)}</span>
                  {statusBadge(row.status)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function RequestDetail() {
  const params = useParams<{ id: string }>();
  const requestId = params.id as Id<"trustRequests">;
  const request = useQuery(api.requests.get, { requestId });
  if (request === undefined) return <Skeleton className="h-80 rounded-2xl" />;
  const name = (by: string | undefined) => (by ? (request.names[by] ?? by) : "");
  const open = OPEN.has(request.status);
  return (
    <>
      <Link href="/staff" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-strong">
        <ArrowLeft className="size-4" aria-hidden />
        All requests
      </Link>
      <PageHeader title={`${KIND_LABEL[request.kind]} request ${request.reference}`} lead={`Received ${when(request.receivedAt)}`} actions={statusBadge(request.status)} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid h-fit gap-5">
          <Panel title="What they sent">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <Item label="Email" value={request.requester.email} />
              <Item label="Name" value={request.requester.name} />
              <Item label="Relationship" value={RELATIONSHIP_LABEL[request.requester.relationship]} />
              <Item label="Asking for" value={request.subtype ? SUBTYPE_LABEL[request.subtype] : null} />
              <Item label="Business named" value={request.businessName} />
              <Item label="Company" value={request.company} />
              <Item label="Role" value={request.role} />
              <Item label="What is affected" value={request.affected} />
              <Item label="Severity they gave" value={request.severityGuess} />
            </dl>
            {request.questions ? <Body label="Questions" text={request.questions} /> : null}
            {request.details ? <Body label="Details" text={request.details} /> : null}
          </Panel>
          <Panel title="History">
            <ol className="grid gap-2 text-sm">
              {[...request.actions.map((row) => ({ ...row, kind: "action" as const })), ...request.notes.map((row) => ({ ...row, action: "note", detail: row.text, kind: "note" as const }))]
                .sort((a, b) => a.at - b.at)
                .map((row, index) => (
                  <li key={index} className={cn("rounded-lg px-3 py-2", row.kind === "note" ? "bg-brand-500/5" : "bg-overlay/[0.03]")}>
                    <p className="text-xs text-muted-foreground">
                      {when(row.at)} · {name(row.by)}
                      {row.kind === "note" ? " · note" : ""}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-strong">{row.detail}</p>
                  </li>
                ))}
            </ol>
            <NoteForm requestId={requestId} />
          </Panel>
        </div>
        <div className="grid h-fit gap-5">
          <Panel title="Handling">
            <dl className="mb-4 grid gap-2 text-sm">
              <Item label="Assigned to" value={request.assignedTo ? name(request.assignedTo) : "Nobody"} />
              <Item label="Due" value={request.dueOn ?? "Not set"} />
              <Item label="Routing" value={request.routing === "business" ? `To the business${request.companyName ? `: ${request.companyName}` : ""}` : "Selestial answers"} />
              <Item label="Identity checked" value={request.verification.verifiedAt ? `${request.verification.method} (${when(request.verification.verifiedAt)})` : "Not yet"} />
              <Item label="Our inbox told" value={request.notify.state === "sent" ? "Yes" : request.notify.problem ? `No: ${request.notify.problem}` : `Not yet (${request.notify.attempts} tries)`} />
            </dl>
            {open ? <Handling requestId={requestId} status={request.status} dueOn={request.dueOn ?? ""} /> : null}
          </Panel>
          {request.completion ? (
            <Panel title="Outcome">
              <p className="text-sm text-strong">{request.completion.outcome}</p>
              {request.completion.limitation ? <p className="mt-2 text-sm text-muted-foreground">Limitation: {request.completion.limitation}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                {name(request.completion.by)}, {when(request.completion.at)}
              </p>
            </Panel>
          ) : open ? (
            <>
              {request.kind === "privacy" ? <Routing requestId={requestId} /> : null}
              <Complete requestId={requestId} />
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Item({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-strong">{value}</dd>
    </div>
  );
}

function Body({ label, text }: { label: string; text: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 rounded-lg bg-overlay/[0.03] px-3 py-2 text-sm whitespace-pre-wrap text-strong">{text}</p>
    </div>
  );
}

function NoteForm({ requestId }: { requestId: Id<"trustRequests"> }) {
  const add = useMutation(api.requests.note);
  const { busy, error, run } = useRun();
  const [text, setText] = useState("");
  return (
    <form
      className="mt-4 grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await add({ requestId, text });
          setText("");
        });
      }}
    >
      <Field label="Add a note">
        <TextArea value={text} onChange={(event) => setText(event.target.value)} />
      </Field>
      <FormError message={error} />
      <div>
        <Button type="submit" size="sm" loading={busy} disabled={!text.trim()}>
          Add note
        </Button>
      </div>
    </form>
  );
}

function Handling({ requestId, status, dueOn }: { requestId: Id<"trustRequests">; status: string; dueOn: string }) {
  const staff = useQuery(api.staff.list, {});
  const assign = useMutation(api.requests.assign);
  const setStatus = useMutation(api.requests.setStatus);
  const setDue = useMutation(api.requests.setDue);
  const verify = useMutation(api.requests.recordVerification);
  const { busy, error, run } = useRun();
  const [method, setMethod] = useState("");
  const [due, setDueValue] = useState(dueOn);
  return (
    <div className="grid gap-4 border-t border-border pt-4">
      <Field label="Assign to">
        <SelectInput defaultValue="" onChange={(event) => void run(() => assign({ requestId, staffId: (event.target.value || null) as Id<"staff"> | null }))}>
          <option value="">Choose</option>
          {(staff ?? []).map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </SelectInput>
      </Field>
      <Field label="Status">
        <SelectInput value={status} onChange={(event) => void run(() => setStatus({ requestId, status: event.target.value as "received" }))}>
          {["received", "verifying", "in_progress", "waiting_on_requester", "routed_to_business", "spam"].map((value) => (
            <option key={value} value={value}>
              {STATUS_LABEL[value]}
            </option>
          ))}
        </SelectInput>
      </Field>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => setDue({ requestId, dueOn: due || null }));
        }}
      >
        <Field label="Due on" hint="Set by you. Not a computed legal deadline." className="flex-1">
          <TextInput type="date" value={due} onChange={(event) => setDueValue(event.target.value)} />
        </Field>
        <Button type="submit" size="sm" loading={busy}>
          Set
        </Button>
      </form>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await verify({ requestId, method });
            setMethod("");
          });
        }}
      >
        <Field label="How you confirmed who they are" className="flex-1">
          <TextInput value={method} onChange={(event) => setMethod(event.target.value)} placeholder="Replied from the address on file…" />
        </Field>
        <Button type="submit" size="sm" loading={busy} disabled={!method.trim()}>
          Record
        </Button>
      </form>
      <FormError message={error} />
    </div>
  );
}

function Routing({ requestId }: { requestId: Id<"trustRequests"> }) {
  const [search, setSearch] = useState("");
  const found = useQuery(api.requests.findCompanies, { search });
  const route = useMutation(api.requests.route);
  const { busy, error, run } = useRun();
  return (
    <Panel title="Who answers">
      <p className="text-sm text-muted-foreground">If the person is a customer, cleaner or applicant of a cleaning company, that company decides. Find it and route the request to it.</p>
      <Field label="Find the company" className="mt-3">
        <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Two letters or more" />
      </Field>
      <ul className="mt-2 grid gap-1">
        {(found ?? []).map((company) => (
          <li key={company.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
            <span className="text-strong">{company.name}</span>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => route({ requestId, routing: "business", companyId: company.id }))}>
              Route here
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => route({ requestId, routing: "selestial" }))}>
          Selestial answers this one
        </Button>
      </div>
      <FormError message={error} />
    </Panel>
  );
}

function Complete({ requestId }: { requestId: Id<"trustRequests"> }) {
  const complete = useMutation(api.requests.complete);
  const { busy, error, run } = useRun();
  const [outcome, setOutcome] = useState("");
  const [limitation, setLimitation] = useState("");
  return (
    <Panel title="Close the request">
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => complete({ requestId, outcome, limitation: limitation || undefined }));
        }}
      >
        <Field label="What was done">
          <TextArea value={outcome} onChange={(event) => setOutcome(event.target.value)} required />
        </Field>
        <Field label="Anything that could not be done, and why" hint="Leave empty if everything asked for was done.">
          <TextArea value={limitation} onChange={(event) => setLimitation(event.target.value)} />
        </Field>
        <FormError message={error} />
        <div>
          <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!outcome.trim()}>
            Close request
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// ── Trust records ─────────────────────────────────────────────────────────────────────────────────

const CLAIM_STATUS_LABEL: Record<string, string> = {
  implemented_verified: "Implemented, verified",
  implemented_unverified: "Implemented, not verified",
  planned: "Planned",
  external_setup: "Needs outside setup",
  decision_required: "Needs a decision",
};
const PROVIDER_STATUS_LABEL: Record<string, string> = { in_use: "In use", connected_not_live: "Set up, not live", planned: "Planned" };

export function TrustRecords() {
  const data = useQuery(api.trust.admin, {});
  const changes = useQuery(api.trust.changes, { limit: 50 });
  if (data === undefined) return <Skeleton className="h-80 rounded-2xl" />;
  const canEdit = data.viewer.canEdit;
  return (
    <>
      <PageHeader title="Trust records" lead="What the public pages say about Selestial. Only rows marked verified and public are shown on the site. Every change needs a note and is logged with before and after." />
      {!data.seeded ? <p className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-strong">The record has not been seeded, so the site shows the built-in starting facts.</p> : null}
      <div className="grid gap-5">
        {data.settings ? <OperatorSettings settings={data.settings} canEdit={canEdit} /> : null}
        <Panel title="Documents">
          <ul className="grid gap-2">
            {data.publications.map((row) => (
              <PublicationRow key={row.documentId} row={row} canEdit={canEdit} />
            ))}
          </ul>
        </Panel>
        <Panel title="Claims">
          <ul className="grid gap-2">
            {data.claims.map((claim) => (
              <ClaimRow key={claim.key} claim={claim} canEdit={canEdit} />
            ))}
          </ul>
        </Panel>
        <Panel title="Providers">
          <ul className="grid gap-2">
            {data.providers.map((provider) => (
              <ProviderRow key={provider.key} provider={provider} canEdit={canEdit} />
            ))}
          </ul>
        </Panel>
        <Panel title="Change log">
          {changes === undefined ? (
            <Skeleton className="h-24" />
          ) : changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes yet.</p>
          ) : (
            <ol className="grid gap-1.5 text-sm">
              {changes.map((change) => (
                <li key={change._id} className="rounded-lg bg-overlay/[0.03] px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {when(change.at)} · {change.table} · {change.key}
                  </p>
                  <p className="text-strong">{change.note}</p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </>
  );
}

type Settings = { legalEntity: string; mailingAddress: string; governingPlace: string; contacts: { security: string; privacy: string; support: string }; securityTxtExpiresOn: string; verified: { legalEntity: boolean; mailingAddress: boolean; security: boolean; privacy: boolean; support: boolean } };

/** Who operates Selestial and how to reach it. A detail reaches the public pages only when ticked as verified. */
function OperatorSettings({ settings, canEdit }: { settings: Settings; canEdit: boolean }) {
  const update = useMutation(api.trust.updateSettings);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState(settings);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);
  const text = (label: string, value: string, change: (value: string) => void, verifiedKey?: keyof Settings["verified"]) => (
    <div className="grid gap-1">
      <Field label={label}>
        <TextInput value={value} onChange={(event) => (setSaved(false), change(event.target.value))} disabled={!canEdit} />
      </Field>
      {verifiedKey ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={form.verified[verifiedKey]} disabled={!canEdit} onChange={(event) => (setSaved(false), setForm({ ...form, verified: { ...form.verified, [verifiedKey]: event.target.checked } }))} className="size-3.5 accent-[#6838ef]" />
          Verified, show it in public
        </label>
      ) : null}
    </div>
  );
  return (
    <Panel title="Operator and contacts">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await update({ ...form, note });
            setNote("");
            setSaved(true);
          });
        }}
      >
        {text("Legal entity", form.legalEntity, (value) => setForm({ ...form, legalEntity: value }), "legalEntity")}
        {text("Mailing address", form.mailingAddress, (value) => setForm({ ...form, mailingAddress: value }), "mailingAddress")}
        {text("Governing law", form.governingPlace, (value) => setForm({ ...form, governingPlace: value }))}
        {text("security.txt expires on (YYYY-MM-DD)", form.securityTxtExpiresOn, (value) => setForm({ ...form, securityTxtExpiresOn: value }))}
        {text("Security contact", form.contacts.security, (value) => setForm({ ...form, contacts: { ...form.contacts, security: value } }), "security")}
        {text("Privacy contact", form.contacts.privacy, (value) => setForm({ ...form, contacts: { ...form.contacts, privacy: value } }), "privacy")}
        {text("Support contact", form.contacts.support, (value) => setForm({ ...form, contacts: { ...form.contacts, support: value } }), "support")}
        {canEdit ? (
          <div className="grid gap-2 sm:col-span-2">
            <Field label="Why this changed" hint="Kept in the change log with what it was before.">
              <TextInput value={note} onChange={(event) => setNote(event.target.value)} required />
            </Field>
            <FormError message={error} />
            {saved ? <p role="status" className="text-sm text-success-foreground">Saved. The public pages pick it up within five minutes.</p> : null}
            <div>
              <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!note.trim()}>
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </form>
    </Panel>
  );
}

type Provider = { key: string; name: string; purpose: string; dataHandled: string; locations: string | null; agreementRef: string | null; policyUrl: string | null; status: "in_use" | "connected_not_live" | "planned"; reviewStatus: "verified" | "needs_review"; reviewedOn: string; publicNote?: string };

function ProviderRow({ provider, canEdit }: { provider: Provider; canEdit: boolean }) {
  const upsert = useMutation(api.trust.upsertProvider);
  const { busy, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...provider, locations: provider.locations ?? "", agreementRef: provider.agreementRef ?? "", policyUrl: provider.policyUrl ?? "", publicNote: provider.publicNote ?? "" });
  const [note, setNote] = useState("");
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [key]: event.target.value });
  return (
    <li className="rounded-xl border border-border px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-strong">{provider.name}</p>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline">{PROVIDER_STATUS_LABEL[provider.status]}</Badge>
          <Badge variant={provider.reviewStatus === "verified" ? "success" : "warning"}>{provider.reviewStatus === "verified" ? "Reviewed" : "Needs review"}</Badge>
          {canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Close" : "Edit"}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-1 text-muted-foreground">{provider.purpose}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Locations: {provider.locations ?? "not verified"} · Agreement: {provider.agreementRef ?? "none on file"} · Reviewed {provider.reviewedOn}
      </p>
      {open ? (
        <form
          className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await upsert({
                key: provider.key,
                name: form.name,
                purpose: form.purpose,
                dataHandled: form.dataHandled,
                locations: form.locations.trim() || null,
                agreementRef: form.agreementRef.trim() || null,
                policyUrl: form.policyUrl.trim() || null,
                status: form.status,
                reviewStatus: form.reviewStatus,
                reviewedOn: form.reviewedOn,
                publicNote: form.publicNote,
                note,
              });
              setNote("");
              setOpen(false);
            });
          }}
        >
          <Field label="Name">
            <TextInput value={form.name} onChange={set("name")} required />
          </Field>
          <Field label="Status">
            <SelectInput value={form.status} onChange={set("status")}>
              {Object.entries(PROVIDER_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="What it does for us" className="sm:col-span-2">
            <TextInput value={form.purpose} onChange={set("purpose")} required />
          </Field>
          <Field label="Data it handles" className="sm:col-span-2">
            <TextInput value={form.dataHandled} onChange={set("dataHandled")} required />
          </Field>
          <Field label="Where it processes data" hint="Leave empty until checked against the provider's terms.">
            <TextInput value={form.locations} onChange={set("locations")} />
          </Field>
          <Field label="Data processing agreement" hint="A reference to where the signed terms are kept. Never public.">
            <TextInput value={form.agreementRef} onChange={set("agreementRef")} />
          </Field>
          <Field label="Privacy policy address">
            <TextInput value={form.policyUrl} onChange={set("policyUrl")} />
          </Field>
          <Field label="Public note">
            <TextInput value={form.publicNote} onChange={set("publicNote")} />
          </Field>
          <Field label="Review">
            <SelectInput value={form.reviewStatus} onChange={set("reviewStatus")}>
              <option value="verified">Reviewed</option>
              <option value="needs_review">Needs review</option>
            </SelectInput>
          </Field>
          <Field label="Reviewed on">
            <TextInput type="date" value={form.reviewedOn} onChange={set("reviewedOn")} required />
          </Field>
          <Field label="Why this changed" className="sm:col-span-2">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} required />
          </Field>
          <div className="grid gap-2 sm:col-span-2">
            <FormError message={error} />
            <div>
              <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!note.trim()}>
                Save provider
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </li>
  );
}

type Publication = { documentId: string; title: string; effectiveOn: string; status: "published" | "draft" | "withdrawn"; publishedAt: number | null; approvalNote: string | null };

function PublicationRow({ row, canEdit }: { row: Publication; canEdit: boolean }) {
  const set = useMutation(api.trust.setPublication);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const next = row.status === "published" ? "withdrawn" : "published";
  return (
    <li className="rounded-xl border border-border px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-strong">
          {row.title} <span className="font-normal text-muted-foreground">· {row.documentId}</span>
        </p>
        <Badge variant={row.status === "published" ? "success" : row.status === "withdrawn" ? "error" : "outline"}>{row.status}</Badge>
      </div>
      {row.approvalNote ? <p className="mt-1 text-xs text-muted-foreground">{row.approvalNote}</p> : null}
      {canEdit ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await set({ documentId: row.documentId, status: next, note });
              setNote("");
            });
          }}
        >
          <Field label="Why" className="min-w-56 flex-1">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} required />
          </Field>
          <Button type="submit" size="sm" loading={busy} disabled={!note.trim()}>
            {next === "published" ? "Publish" : "Withdraw"}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

type Claim = { key: string; area: string; text: string; evidence: string; status: string; reviewedOn: string; public: boolean };

function ClaimRow({ claim, canEdit }: { claim: Claim; canEdit: boolean }) {
  const upsert = useMutation(api.trust.upsertClaim);
  const { busy, error, run } = useRun();
  const [note, setNote] = useState("");
  const shown = claim.public && claim.status === "implemented_verified";
  return (
    <li className="rounded-xl border border-border px-3.5 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">
          {claim.key} · {claim.area}
        </p>
        <div className="flex gap-1.5">
          <Badge variant={claim.status === "implemented_verified" ? "success" : "outline"}>{CLAIM_STATUS_LABEL[claim.status] ?? claim.status}</Badge>
          <Badge variant={shown ? "info" : "outline"}>{shown ? "On the site" : "Not on the site"}</Badge>
        </div>
      </div>
      <p className="mt-1 text-strong">{claim.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">Evidence: {claim.evidence}</p>
      {canEdit ? (
        <form
          className="mt-2 flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await upsert({ key: claim.key, area: claim.area as "access", text: claim.text, evidence: claim.evidence, status: claim.status as "planned", reviewedOn: claim.reviewedOn, public: !claim.public, note });
              setNote("");
            });
          }}
        >
          <Field label="Why" className="min-w-56 flex-1">
            <TextInput value={note} onChange={(event) => setNote(event.target.value)} required />
          </Field>
          <Button type="submit" size="sm" loading={busy} disabled={!note.trim()}>
            {claim.public ? "Stop showing" : "Mark public"}
          </Button>
        </form>
      ) : null}
      <FormError message={error} />
    </li>
  );
}

// ── Companies (texting registration and suspension) ───────────────────────────────────────────────

export function Companies() {
  const [search, setSearch] = useState("");
  const found = useQuery(api.requests.findCompanies, { search });
  const [picked, setPicked] = useState<{ id: Id<"companies">; name: string; plan: "operate" | "expand" | "growth" | "scale" } | null>(null);
  return (
    <>
      <PageHeader title="Companies" lead="Confirm a carrier registration after checking it with the texting provider, or suspend a company's sending. Staff see names only, never a company's records." />
      <Panel>
        <Field label="Find a company">
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Two letters or more" />
        </Field>
        <ul className="mt-2 grid gap-1">
          {(found ?? []).map((company) => (
            <li key={company.id}>
              <button type="button" onClick={() => setPicked(company)} className={cn("w-full rounded-lg border px-3 py-2 text-left text-sm", picked?.id === company.id ? "border-brand-500/50 bg-brand-500/5" : "border-border")}>
                {company.name}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      {picked ? <CompanyActions key={picked.id} company={picked} /> : null}
    </>
  );
}

function CompanyActions({ company }: { company: { id: Id<"companies">; name: string; plan: "operate" | "expand" | "growth" | "scale" } }) {
  const setRegistration = useMutation(api.compliance.setRegistration);
  const setSuspended = useMutation(api.compliance.setSuspended);
  const { busy, error, run } = useRun();
  const [status, setStatus] = useState<"approved" | "rejected" | "submitted" | "not_started">("approved");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  return (
    <Panel title={company.name} className="mt-5">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await setRegistration({ companyId: company.id, status, reference: reference || undefined, note: note || undefined });
            setDone("Registration recorded.");
          });
        }}
      >
        <Field label="Carrier registration">
          <SelectInput value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="submitted">Submitted</option>
            <option value="not_started">Not started</option>
          </SelectInput>
        </Field>
        <Field label="Provider reference">
          <TextInput value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>
        <Field label="Note to the company" hint="They see this in their settings.">
          <TextInput value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            Record registration
          </Button>
        </div>
      </form>
      <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
        <Button size="sm" variant="destructive-outline" loading={busy} disabled={!note.trim()} onClick={() => void run(async () => (await setSuspended({ companyId: company.id, suspended: true, note }), setDone("Sending suspended.")))}>
          Suspend sending
        </Button>
        <Button size="sm" variant="outline" loading={busy} disabled={!note.trim()} onClick={() => void run(async () => (await setSuspended({ companyId: company.id, suspended: false, note }), setDone("Sending resumed.")))}>
          Lift suspension
        </Button>
        <p className="w-full text-xs text-muted-foreground">Suspending needs a note above, and stops every message for this company until lifted.</p>
      </div>
      <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
        Plan: {company.plan === "operate" ? "Operate" : company.plan === "expand" ? "Expand" : "none verified"}. Plans are bought and changed through Autumn, never set here.
      </p>
      {done ? <p role="status" className="mt-2 text-sm text-success-foreground">{done}</p> : null}
      <FormError message={error} />
    </Panel>
  );
}

// ── Staff ─────────────────────────────────────────────────────────────────────────────────────────

export function StaffPeople() {
  const me = useQuery(api.staff.me, {});
  const people = useQuery(api.staff.list, {});
  const add = useMutation(api.staff.add);
  const remove = useMutation(api.staff.remove);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ name: "", email: "", role: "reviewer" as "admin" | "reviewer" });
  const admin = me?.role === "admin";
  return (
    <>
      <PageHeader title="Staff" lead="Selestial people who handle requests and trust records. Being staff gives no access to any company's records." />
      <Panel>
        {people === undefined ? (
          <Skeleton className="h-24" />
        ) : (
          <ul className="grid gap-1.5">
            {people.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-strong">{person.name}</span> <span className="text-muted-foreground">{person.email}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={person.role === "admin" ? "info" : "outline"}>{person.role}</Badge>
                  {!person.joined ? <Badge variant="warning">Not signed in yet</Badge> : null}
                  {admin && person.email !== me?.email ? (
                    <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => remove({ staffId: person.id }))}>
                      Remove
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {admin ? (
          <form
            className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await add(form);
                setForm({ name: "", email: "", role: "reviewer" });
              });
            }}
          >
            <Field label="Name">
              <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            </Field>
            <Field label="Email" className="sm:col-span-2">
              <TextInput type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
            </Field>
            <Field label="Role">
              <SelectInput value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as "admin" | "reviewer" })}>
                <option value="reviewer">Reviewer</option>
                <option value="admin">Admin</option>
              </SelectInput>
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" size="sm" loading={busy}>
                Add to staff
              </Button>
            </div>
          </form>
        ) : null}
        <FormError message={error} />
      </Panel>
    </>
  );
}

// ── Texting numbers and carrier registration ──────────────────────────────────────────────────────

const TEXTING_STATUS: Record<string, { label: string; variant: "info" | "warning" | "error" | "success" | "outline" }> = {
  requested: { label: "Waiting for approval", variant: "warning" },
  approved: { label: "Approved · starting", variant: "info" },
  provisioning: { label: "Setting up", variant: "info" },
  waiting_on_carriers: { label: "Waiting on carriers", variant: "info" },
  failed: { label: "Stopped", variant: "error" },
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * Cleaning companies' requests for a texting number. Approving spends Selestial's Telnyx money (the
 * number, and the carriers' brand and campaign fees), so only an admin approves or runs one again.
 */
export function TextingQueue() {
  const rows = useQuery(api.texting.queue, {});
  const approve = useMutation(api.texting.approve);
  const reject = useMutation(api.texting.reject);
  const retry = useMutation(api.texting.retry);
  const { busy, error, run } = useRun();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <>
      <PageHeader title="Texting" lead="Requests for a texting number and its carrier registration, in each company's own name. Approving buys the number and files the brand and campaign on Selestial's Telnyx account." />
      <FormError message={error} />
      {rows === undefined ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : rows.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted-foreground">No request is open.</p>
        </Panel>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => {
            const status = TEXTING_STATUS[row.status] ?? { label: row.status, variant: "outline" as const };
            return (
              <Panel key={row.requestId}>
                <div className="grid gap-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p>
                      <span className="font-semibold text-strong">{row.company}</span>
                      <span className="text-muted-foreground"> · {row.phoneNumber}</span>
                    </p>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <dl className="grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                    <div>
                      Legal name: <span className="text-strong">{row.brand.companyName}</span>
                    </div>
                    <div>
                      Texts sent as: <span className="text-strong">{row.brand.displayName}</span>
                    </div>
                    <div>
                      EIN: <span className="text-strong">{row.brand.ein}</span>
                    </div>
                    <div>
                      Address:{" "}
                      <span className="text-strong">
                        {row.brand.street}, {row.brand.city}, {row.brand.state} {row.brand.postalCode}
                      </span>
                    </div>
                    <div>
                      Website: <span className="text-strong">{row.brand.website}</span>
                    </div>
                    <div>
                      Support: <span className="text-strong">{row.brand.email}</span>
                    </div>
                    <div>
                      Cost at request: <span className="text-strong">{row.upfrontCents !== null ? `${dollars(row.upfrontCents)} up front, ${dollars(row.monthlyCents ?? 0)} a month, plus carrier fees` : "not known"}</span>
                    </div>
                    <div>
                      Asked: <span className="text-strong">{new Date(row.requestedAt).toLocaleString()}</span>
                    </div>
                  </dl>
                  <p className="rounded-lg bg-muted px-3 py-2 text-xs leading-relaxed text-strong">Consent wording: {row.consentWording}</p>
                  {row.step ? <p className="text-strong">{row.step}</p> : null}
                  {row.problem ? <p className="text-destructive-foreground">{row.problem}</p> : null}
                  {row.numberOrderId || row.brandId || row.campaignId ? (
                    <p className="font-mono text-[11px] text-muted-foreground">
                      order {row.numberOrderId ?? "none"} · brand {row.brandId ?? "none"} · campaign {row.campaignId ?? "none"}
                    </p>
                  ) : null}
                  {row.status === "requested" ? (
                    rejecting === row.requestId ? (
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            await reject({ requestId: row.requestId, note });
                            setRejecting(null);
                            setNote("");
                          });
                        }}
                      >
                        <TextInput autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why, in words the company will read" aria-label="Why it is turned down" required className="max-w-md" />
                        <Button type="submit" variant="destructive-outline" size="sm" loading={busy}>
                          Turn down
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRejecting(null)}>
                          Never mind
                        </Button>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => approve({ requestId: row.requestId }))}>
                          Approve and buy the number
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setRejecting(row.requestId)}>
                          Turn down
                        </Button>
                      </div>
                    )
                  ) : row.status === "failed" ? (
                    <div>
                      <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => retry({ requestId: row.requestId }))}>
                        Run again from where it stopped
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
