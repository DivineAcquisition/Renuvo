"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { Field, FormError, SelectInput, TextArea, TextInput, useRun } from "@/components/app/form";
import { Modal } from "@/components/app/modal";
import { PageHeader, Panel } from "@/components/app/shell";
import { SecondFactor } from "@/components/app/support/verify";
import { useNow } from "@/components/app/use-now";
import { Activity, AlertTriangle, Building2, CheckCircle2, Clock, ExternalLink, RefreshCw, ShieldCheck } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type Overview = FunctionReturnType<typeof api.operations.overview>;
type Row = Overview["needsStaff"][number];
type Area = "agents" | "communications" | "connections" | "billing" | "platform";
type State = Row["state"];

export const OPERATIONS_VIEWS = [
  { slug: "", label: "Overview" },
  { slug: "attention", label: "Needs attention" },
  { slug: "agents", label: "Agent work" },
  { slug: "communications", label: "Communications" },
  { slug: "connections", label: "Connections" },
  { slug: "billing", label: "Billing" },
  { slug: "activity", label: "Activity" },
] as const;
export type OperationsView = (typeof OPERATIONS_VIEWS)[number]["slug"];

const VIEW_AREA: Partial<Record<OperationsView, Area>> = { agents: "agents", communications: "communications", connections: "connections", billing: "billing" };
const VIEW_LEAD: Record<OperationsView, string> = {
  "": "What is broken, who it affects, whether recovery is running, and who acts next. Every number is a count of open incidents.",
  attention: "Every open incident, worst first. Waiting on the owner or a provider is shown apart from what needs Selestial.",
  agents: "Agent steps that stopped reporting and first work that failed after its retries. Work waiting for an approval is not here: that is normal.",
  communications: "Messages whose delivery is not confirmed, failing notices and callbacks, and texting registrations that are stuck or need the owner.",
  connections: "Inboxes and apps whose authorization ended or whose reads keep failing, and Google work that failed or is uncertain.",
  billing: "Charges that could not be settled after every retry, and balances at their floor. The work behind each charge is never run again.",
  activity: "What staff did in support sessions, and incidents that were resolved.",
};

const SEVERITY_BADGE: Record<Row["severity"], { variant: "error" | "warning" | "info" | "outline"; label: string }> = {
  critical: { variant: "error", label: "Critical" },
  high: { variant: "warning", label: "High" },
  medium: { variant: "info", label: "Medium" },
  low: { variant: "outline", label: "Low" },
};
const STATE_BADGE: Record<State, "info" | "warning" | "success" | "outline" | "error"> = {
  investigating: "info",
  recovering: "info",
  waiting_owner: "outline",
  waiting_provider: "outline",
  needs_staff: "warning",
  resolved: "success",
};
const CHECK_LABEL: Record<string, string> = {
  agent_work: "Agent work",
  chat_runs: "Chat responses",
  uncertain_messages: "Uncertain delivery",
  owner_notices: "Owner notices",
  stuck_sends: "Stuck sends",
  inbound_processing: "Provider callbacks",
  mailboxes: "Inboxes",
  google: "Google",
  connectors: "Jobber / Housecall Pro",
  texting: "Texting registration",
  ai_billing: "AI credit settlement",
  messaging_billing: "Messaging settlement",
  messaging_attention: "Messaging balances",
};

const time = (at: number) => new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function ago(at: number, now: number) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// ── Shell ────────────────────────────────────────────────────────────────────────────────────────

export function OperationsWorkspace({ view }: { view: OperationsView }) {
  const [openId, setOpenId] = useState<Id<"incidents"> | null>(null);
  const title = OPERATIONS_VIEWS.find((item) => item.slug === view)?.label ?? "Operations";
  return (
    <>
      <PageHeader title={view === "" ? "Operations" : title} lead={VIEW_LEAD[view]} />
      <OperationsTabs current={view} />
      {view === "" ? <OverviewView onOpen={setOpenId} /> : view === "activity" ? <ActivityView onOpen={setOpenId} /> : <IncidentsView area={VIEW_AREA[view]} onOpen={setOpenId} />}
      <IncidentPanel id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function OperationsTabs({ current }: { current: OperationsView }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Operations views" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {OPERATIONS_VIEWS.map((item) => {
        const href = item.slug ? `/staff/operations/${item.slug}` : "/staff/operations";
        const active = item.slug === current || pathname === href;
        return (
          <Link key={item.slug} href={href} aria-current={active ? "page" : undefined} className={cn("-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-brand-500", active ? "border-brand-500 font-semibold text-strong" : "border-transparent text-muted-foreground hover:text-strong")}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────

function OverviewView({ onOpen }: { onOpen: (id: Id<"incidents">) => void }) {
  const data = useQuery(api.operations.overview, {});
  if (data === undefined) return <Loading />;
  const needsStaff = data.byState.needs_staff ?? 0;
  const waitingOwner = data.byState.waiting_owner ?? 0;
  const waitingProvider = data.byState.waiting_provider ?? 0;
  const automatic = (data.byState.recovering ?? 0) + (data.byState.investigating ?? 0);
  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      <MonitoringStrip checks={data.checks} now={data.now} healthy={data.monitoringHealthy} />
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Count label="Open incidents" value={data.openCount} note={data.complete ? null : "First 500 shown"} />
        <Count label="Need Selestial staff" value={needsStaff} tone={needsStaff > 0 ? "warning" : undefined} />
        <Count label="Recovering automatically" value={automatic} />
        <Count label="Waiting for owners" value={waitingOwner} />
        <Count label="Companies affected" value={data.affectedCompanies.length} note={waitingProvider ? `${waitingProvider} waiting for a provider` : null} />
      </dl>
      {data.platform.length > 0 ? (
        <Panel title="Platform and provider incidents" flush>
          <IncidentTable rows={data.platform} now={data.now} onOpen={onOpen} />
        </Panel>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] [&>*]:min-w-0">
        <Panel title="Needs Selestial staff" action={<Link className="text-sm text-brand-600 hover:underline" href="/staff/operations/attention">All open incidents</Link>} flush>
          {data.needsStaff.length ? <IncidentTable rows={data.needsStaff} now={data.now} onOpen={onOpen} /> : <Empty words="Nothing needs staff right now." />}
        </Panel>
        <Panel title="Companies affected" flush>
          {data.affectedCompanies.length ? (
            <ul className="divide-y divide-border">
              {data.affectedCompanies.map((company) => (
                <li key={company.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Building2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-strong">{company.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant={SEVERITY_BADGE[company.worst].variant} size="sm">{SEVERITY_BADGE[company.worst].label}</Badge>
                    <span className="text-xs text-muted-foreground tabular-nums">{company.open} open</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty words="No company has an open incident." />
          )}
        </Panel>
      </div>
      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Recovering automatically" flush>
          {data.recovering.length ? <IncidentTable rows={data.recovering} now={data.now} onOpen={onOpen} compact /> : <Empty words="No automatic recovery is running for an open incident." />}
        </Panel>
        <Panel title="Waiting for the owner" flush>
          {data.waitingOwner.length ? <IncidentTable rows={data.waitingOwner} now={data.now} onOpen={onOpen} compact /> : <Empty words="No owner has a step to take." />}
        </Panel>
      </div>
      <Panel title="Recently resolved" flush>
        {data.recentlyResolved.length ? <IncidentTable rows={data.recentlyResolved} now={data.now} onOpen={onOpen} compact /> : <Empty words="Nothing resolved in the last day." />}
      </Panel>
    </div>
  );
}

function Count({ label, value, note, tone }: { label: string; value: number; note?: string | null; tone?: "warning" }) {
  return (
    <div className={cn("rounded-2xl border bg-card px-4 py-3", tone === "warning" ? "border-warning/40" : "border-border")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-heading text-2xl tracking-tight text-strong tabular-nums">{value}</dd>
      {note ? <dd className="text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

/** Each check's last finish. A check that stopped is never shown as fine. */
function MonitoringStrip({ checks, now, healthy }: { checks: Overview["checks"]; now: number; healthy: boolean }) {
  const [open, setOpen] = useState(!healthy);
  const bad = checks.filter((check) => check.freshness !== "ok");
  return (
    <section aria-label="Monitoring" className={cn("rounded-2xl border bg-card", healthy ? "border-border" : "border-warning/40")}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm sm:px-5">
        {healthy ? <CheckCircle2 aria-hidden className="size-4 text-success-foreground" /> : <AlertTriangle aria-hidden className="size-4 text-warning-foreground" />}
        <span className="font-medium text-strong">{healthy ? "Every check is running" : `${bad.length} ${bad.length === 1 ? "check is" : "checks are"} not running normally`}</span>
        <span className="ml-auto text-xs text-muted-foreground">{open ? "Hide" : "Show"} checks</span>
      </button>
      {open ? (
        <ul className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-3">
          {checks.map((check) => (
            <li key={check.check} className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs last:border-b-0 sm:px-5">
              <span className="text-strong">{CHECK_LABEL[check.check] ?? check.check}</span>
              <span className={cn("flex items-center gap-1.5", check.freshness === "ok" ? "text-muted-foreground" : "font-medium text-warning-foreground")}>
                {check.freshness === "ok" ? `Checked ${ago(check.lastFinishedAt!, now)}` : check.freshness === "stale" ? `Stale: last ${ago(check.lastFinishedAt!, now)}` : check.freshness === "failing" ? "Failing" : "Never run"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────

function IncidentsView({ area, onOpen }: { area?: Area; onOpen: (id: Id<"incidents">) => void }) {
  const [state, setState] = useState<"" | State>("");
  const [resolved, setResolved] = useState(false);
  const [search, setSearch] = useState("");
  const rows = useQuery(api.operations.list, { ...(area ? { area } : {}), ...(state && !resolved ? { state } : {}), resolved });
  const now = useNow();
  const shown = (rows ?? []).filter((row) => !search.trim() || `${row.title} ${row.company?.name ?? ""} ${row.label}`.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Panel flush>
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3 sm:px-5">
        <Field label="Search" className="w-56">
          <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company or incident" type="search" />
        </Field>
        <Field label="State" className="w-52">
          <SelectInput value={state} disabled={resolved} onChange={(event) => setState(event.target.value as typeof state)}>
            <option value="">Every open state</option>
            <option value="needs_staff">Needs staff action</option>
            <option value="recovering">Recovering automatically</option>
            <option value="investigating">Investigating</option>
            <option value="waiting_owner">Waiting for the owner</option>
            <option value="waiting_provider">Waiting for the provider</option>
          </SelectInput>
        </Field>
        <label className="flex min-h-10 items-center gap-2 text-sm text-strong">
          <input type="checkbox" checked={resolved} onChange={(event) => setResolved(event.target.checked)} className="size-4 accent-brand-500" />
          Resolved in the last 30 days
        </label>
      </div>
      {rows === undefined ? <Loading /> : shown.length ? <IncidentTable rows={shown} now={now} onOpen={onOpen} /> : <Empty words={resolved ? "Nothing resolved here in the last 30 days." : "No open incidents here."} />}
    </Panel>
  );
}

function IncidentTable({ rows, now, onOpen, compact = false }: { rows: Row[]; now: number; onOpen: (id: Id<"incidents">) => void; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b border-border">
            <th scope="col" className="px-4 py-2 font-medium sm:px-5">Incident</th>
            {compact ? null : <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Company</th>}
            <th scope="col" className="px-3 py-2 font-medium">State</th>
            {compact ? null : <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">Next</th>}
            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell sm:pr-5">{rows[0]?.resolvedAt ? "Resolved" : "Last seen"}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-muted/40">
              <td className="max-w-md px-4 py-2.5 sm:px-5">
                <button type="button" onClick={() => onOpen(row.id)} className="group grid gap-0.5 text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                  <span className="flex items-start gap-2">
                    <Badge variant={SEVERITY_BADGE[row.severity].variant} size="sm" className="mt-0.5 shrink-0">{SEVERITY_BADGE[row.severity].label}</Badge>
                    <span className="font-medium text-strong group-hover:underline">{row.title}</span>
                  </span>
                  <span className="line-clamp-1 text-xs text-muted-foreground">
                    {row.company ? <span className={compact ? "" : "md:hidden"}>{row.company.name} · </span> : null}
                    {row.impact}
                  </span>
                </button>
              </td>
              {compact ? null : <td className="hidden px-3 py-2.5 text-strong md:table-cell">{row.company?.name ?? <span className="text-muted-foreground">Platform</span>}</td>}
              <td className="px-3 py-2.5">
                <Badge variant={STATE_BADGE[row.state]} size="sm">{row.stateWords}</Badge>
              </td>
              {compact ? null : <td className="hidden px-3 py-2.5 text-xs text-muted-foreground lg:table-cell">{row.nextActor}</td>}
              <td className="hidden px-3 py-2.5 text-right text-xs whitespace-nowrap text-muted-foreground sm:table-cell sm:pr-5">{ago(row.resolvedAt ?? row.lastSeenAt, now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────────────────────────

const SUPPORT_KIND: Record<string, string> = { started: "Opened", manage: "Mode", extended: "Extended", revealed: "Revealed content", change: "Changed", ended: "Ended" };

function ActivityView({ onOpen }: { onOpen: (id: Id<"incidents">) => void }) {
  const events = useQuery(api.support.activity, {});
  const resolved = useQuery(api.operations.list, { resolved: true });
  const now = useNow();
  return (
    <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
      <Panel title="Staff in company workspaces" flush>
        {events === undefined ? (
          <Loading />
        ) : events.length ? (
          <ol className="divide-y divide-border">
            {events.map((event) => (
              <li key={event.id} className="grid gap-0.5 px-4 py-2.5 text-sm sm:px-5">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={event.kind === "change" || event.kind === "revealed" ? "warning" : "outline"} size="sm">{SUPPORT_KIND[event.kind] ?? event.kind}</Badge>
                  <span className="font-medium text-strong">{event.staff}</span>
                  <span className="text-muted-foreground">in {event.company.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{time(event.at)}</span>
                </span>
                <span className="text-muted-foreground">{event.summary}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty words="No support sessions yet." />
        )}
      </Panel>
      <Panel title="Resolved incidents" flush>
        {resolved === undefined ? <Loading /> : resolved.length ? <IncidentTable rows={resolved.slice(0, 50)} now={now} onOpen={onOpen} compact /> : <Empty words="Nothing resolved in the last 30 days." />}
      </Panel>
    </div>
  );
}

// ── One incident ─────────────────────────────────────────────────────────────────────────────────

function IncidentPanel({ id, onClose }: { id: Id<"incidents"> | null; onClose: () => void }) {
  return (
    <Sheet open={id !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetPopup side="right" className="max-w-xl bg-card">
        {id ? <IncidentDetail id={id} /> : null}
      </SheetPopup>
    </Sheet>
  );
}

function IncidentDetail({ id }: { id: Id<"incidents"> }) {
  const incident = useQuery(api.operations.incident, { id });
  const me = useQuery(api.staff.me, {});
  const staffList = useQuery(api.staff.list, {});
  const assign = useMutation(api.operations.assign);
  const recheck = useMutation(api.operations.recheck);
  const { busy, error, run } = useRun();
  const [result, setResult] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "note" | "resolve" | "open">(null);
  if (incident === undefined) {
    return (
      <SheetPanel>
        <Loading />
      </SheetPanel>
    );
  }
  const myId = staffList?.find((row) => row.email === me?.email)?.id;
  const open = incident.resolvedAt === null;
  return (
    <>
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SEVERITY_BADGE[incident.severity].variant}>{SEVERITY_BADGE[incident.severity].label}</Badge>
          <Badge variant={STATE_BADGE[incident.state]}>{incident.stateWords}</Badge>
          <span className="text-xs text-muted-foreground">{incident.label}</span>
        </div>
        <SheetTitle className="mt-2">{incident.title}</SheetTitle>
        <SheetDescription>{incident.company ? incident.company.name : "Platform"}{incident.provider ? ` · ${incident.provider}` : ""}</SheetDescription>
      </SheetHeader>
      <SheetPanel className="grid gap-5 text-sm">
        <section className="grid gap-3 rounded-xl border border-border bg-muted/40 p-3.5">
          <Fact label="What it blocks">{incident.impact}</Fact>
          <Fact label="Next">{incident.nextAction}</Fact>
          <Fact label="Who acts next">{incident.nextActor}</Fact>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Records">{incident.occurrences}</Fact>
            <Fact label="Retries seen">{incident.recoveryAttempts}</Fact>
            <Fact label="First seen">{time(incident.firstSeenAt)}</Fact>
            <Fact label="Last checked">{time(incident.lastCheckedAt)}</Fact>
          </div>
          {incident.assignedName ? <Fact label="Assigned to">{incident.assignedName}</Fact> : null}
          {!open ? (
            <Fact label="Resolved">
              {time(incident.resolvedAt!)} by {incident.resolvedBy}. {incident.evidence}
            </Fact>
          ) : null}
        </section>

        {open ? (
          <div className="flex flex-wrap gap-2">
            {incident.company ? (
              <Button size="sm" variant="primary" onClick={() => setDialog("open")}>
                <ExternalLink aria-hidden className="size-4" />
                Open company workspace
              </Button>
            ) : null}
            <Button size="sm" variant="outline" loading={busy} onClick={() => void run(async () => setResult((await recheck({ id })).words))}>
              <RefreshCw aria-hidden className="size-4" />
              Check again now
            </Button>
            {myId && incident.assignedTo !== myId ? (
              <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => assign({ id, staffId: myId }))}>
                Take it
              </Button>
            ) : incident.assignedTo ? (
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void run(() => assign({ id, staffId: null }))}>
                Unassign
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setDialog("note")}>
              Add note
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDialog("resolve")}>
              Resolve
            </Button>
          </div>
        ) : null}
        {result ? (
          <p role="status" className="text-sm text-muted-foreground">
            {result}
          </p>
        ) : null}
        <FormError message={error} />

        {incident.parent ? (
          <Fact label="Part of">
            {incident.parent.title} ({incident.parent.stateWords})
          </Fact>
        ) : null}
        {incident.children.length ? (
          <section>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase">Companies affected</h3>
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
              {incident.children.map((child) => (
                <li key={child.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="text-strong">{child.company?.name}</span>
                  <Badge variant={STATE_BADGE[child.state]} size="sm">{child.stateWords}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">History</h3>
          <ol className="mt-2 grid gap-2">
            {incident.updates.map((update) => (
              <li key={update.id} className="grid grid-cols-[auto_1fr] gap-x-3">
                <Clock aria-hidden className="mt-0.5 size-3.5 text-muted-foreground" />
                <div>
                  <p className="text-strong">{update.words}</p>
                  <p className="text-xs text-muted-foreground">
                    {update.by} · {time(update.at)}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <details className="rounded-xl border border-border">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Diagnostics</summary>
          <div className="grid gap-2 border-t border-border px-3 py-2.5 font-mono text-xs break-all text-strong">
            <p>check {incident.check} · key {incident.key}</p>
            {incident.diagnostics ? <p>{incident.diagnostics}</p> : null}
            {incident.related.map((ref) => (
              <p key={`${ref.table}:${ref.id}`}>
                {ref.table} {ref.id}
              </p>
            ))}
          </div>
        </details>
      </SheetPanel>
      <Modal open={dialog === "note"} onClose={() => setDialog(null)} title="Add a note" description="What you found or did. Never a secret or a customer's message.">
        <NoteForm id={id} onDone={() => setDialog(null)} />
      </Modal>
      <Modal open={dialog === "resolve"} onClose={() => setDialog(null)} title="Resolve this incident" description={incident.closeByHand ? "Its record stays failed, so it closes with your reason once the work is handled." : "It resolves only if its records no longer show the problem. If they still do, this is refused and it stays open."}>
        <ResolveForm id={id} onDone={() => setDialog(null)} />
      </Modal>
      {incident.company ? <OpenWorkspaceDialog open={dialog === "open"} onClose={() => setDialog(null)} company={incident.company} incident={{ id, title: incident.title }} /> : null}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-strong">{children}</div>
    </div>
  );
}

function NoteForm({ id, onDone }: { id: Id<"incidents">; onDone: () => void }) {
  const addNote = useMutation(api.operations.addNote);
  const [words, setWords] = useState("");
  const { busy, error, run } = useRun();
  return (
    <form className="grid gap-3" onSubmit={(event) => (event.preventDefault(), void run(async () => (await addNote({ id, words }), onDone())))}>
      <Field label="Note">
        <TextArea value={words} onChange={(event) => setWords(event.target.value)} maxLength={1000} autoFocus />
      </Field>
      <FormError message={error} />
      <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!words.trim()}>
        Add note
      </Button>
    </form>
  );
}

function ResolveForm({ id, onDone }: { id: Id<"incidents">; onDone: () => void }) {
  const resolve = useMutation(api.operations.resolve);
  const [reason, setReason] = useState("");
  const { busy, error, run } = useRun();
  return (
    <form className="grid gap-3" onSubmit={(event) => (event.preventDefault(), void run(async () => (await resolve({ id, reason }), onDone())))}>
      <Field label="What was done" hint="The evidence it is handled. The next person reads this.">
        <TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} autoFocus />
      </Field>
      <FormError message={error} />
      <Button type="submit" variant="primary" size="sm" loading={busy} disabled={reason.trim().length < 10}>
        Resolve
      </Button>
    </form>
  );
}

// ── Opening a company's workspace ────────────────────────────────────────────────────────────────

/**
 * Starts an Admin Support Session in View mode and opens it in a new tab. The tab keeps its own company;
 * this tab stays in the staff console.
 */
export function OpenWorkspaceDialog({ open, onClose, company, incident }: { open: boolean; onClose: () => void; company: { id: Id<"companies">; name: string }; incident?: { id: Id<"incidents">; title: string } }) {
  return (
    <Modal open={open} onClose={onClose} title="Open company workspace" description={`${company.name}. Opens in a new tab, in View mode, for one hour.`}>
      <OpenWorkspaceForm company={company} incident={incident} onDone={onClose} />
    </Modal>
  );
}

function OpenWorkspaceForm({ company, incident, onDone }: { company: { id: Id<"companies">; name: string }; incident?: { id: Id<"incidents">; title: string }; onDone: () => void }) {
  const access = useQuery(api.support.capabilities, {});
  const startSession = useMutation(api.support.start);
  const [reason, setReason] = useState(incident ? `Incident: ${incident.title}` : "");
  const [ticket, setTicket] = useState("");
  const [previewRole, setPreviewRole] = useState<"owner" | "manager" | "office">("owner");
  const { busy, error, run } = useRun();
  if (access === undefined) return <Loading />;
  if (!access.enabled) return <p className="text-sm text-muted-foreground">Support sessions are turned off on this deployment. They are turned on (SUPPORT_ACCESS=on) once the privacy notice describes them.</p>;
  if (!access.capabilities.includes("workspace.view")) return <p className="text-sm text-muted-foreground">Your staff role does not include opening company workspaces. A staff admin can change that.</p>;
  return (
    <div className="grid gap-4">
      <dl className="grid gap-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Company</dt>
          <dd className="font-medium text-strong">{company.name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Access</dt>
          <dd className="text-right text-strong">View only. Manage is a separate step from the banner, with a reason, and needs the owner&rsquo;s permission or an open incident.</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Duration</dt>
          <dd className="text-strong">1 hour, extendable</dd>
        </div>
        {incident ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Incident</dt>
            <dd className="text-right text-strong">{incident.title}</dd>
          </div>
        ) : null}
      </dl>
      <Field label="Reason for access" hint="The company sees this in its Support access history.">
        <TextArea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Support ticket (optional)">
          <TextInput value={ticket} onChange={(event) => setTicket(event.target.value)} maxLength={100} />
        </Field>
        <Field label="See the workspace as">
          <SelectInput value={previewRole} onChange={(event) => setPreviewRole(event.target.value as typeof previewRole)}>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
            <option value="office">Office</option>
          </SelectInput>
        </Field>
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Customer message content stays hidden. Passwords, payment details and connection keys are never shown.
      </p>
      <FormError message={error} />
      {reason.trim().length >= 10 ? (
        <SecondFactor
          label="Open workspace"
          busy={busy}
          onVerified={() =>
            void run(async () => {
              const sessionId = await startSession({ companyId: company.id, reason: reason.trim(), ticket: ticket.trim() || undefined, incidentId: incident?.id, previewRole });
              window.open(`/app?support=${sessionId}`, "_blank", "noopener");
              onDone();
            })
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">Give a reason to continue.</p>
      )}
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────────────────────────────

function Loading() {
  return (
    <div className="grid gap-2 p-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function Empty({ words }: { words: string }) {
  return (
    <p className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground sm:px-5">
      <Activity aria-hidden className="size-4" />
      {words}
    </p>
  );
}
