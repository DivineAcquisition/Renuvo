"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { Modal } from "@/components/app/modal";
import { NewVisitForm } from "@/components/app/screens/forms";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Kanban, LayoutList, Plus, TriangleAlert } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clock, dayName, durationLabel, until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import { arrivalLabel, DELIVERY, Filter, GROUPS, GroupBadge, Incomplete, RangePicker, Staffing, useRange, type JobRow } from "./shared";

const DAY = 24 * 60 * 60 * 1000;

/** A scheduled visit that starts within a day and is still short a cleaner. */
const isUrgent = (row: JobRow, now: number) => row.status === "scheduled" && row.openPlaces > 0 && row.startsAt - now < DAY;

/** Who has the next move on this visit, from the record. */
function ownerOf(row: JobRow): string {
  if (row.group === "closed") return "Nobody: the visit is closed";
  if (row.group === "awaiting_completion_review") return "A person: the review";
  if (row.group === "awaiting_approval") return "A person: the approval";
  if (row.task?.withPerson) return "A person: holding this visit";
  if (row.task) return "Dispatch";
  if (row.openPlaces === 0) return "The crew";
  return "Nobody yet";
}

function nextOf(row: JobRow, now: number, timezone: string): string {
  if (row.group === "closed") return row.status === "cancelled" ? "Cancelled." : "Completed.";
  if (row.group === "awaiting_completion_review") return "Review the crew’s report, then close the visit or send it back.";
  if (row.group === "awaiting_approval") return "Decide the proposal Dispatch made.";
  if (row.task?.openQuestion) return row.task.openQuestion;
  if (row.task?.nextAction) return row.task.nextAction;
  if (row.offers.length > 0) return `Waiting for an answer, due ${whenLabel(Math.min(...row.offers.map((offer) => offer.respondBy)), now, timezone)}.`;
  if (row.group === "in_progress") return "The crew submits when it is done.";
  if (row.openPlaces === 0) return `The visit takes place ${whenLabel(row.startsAt, now, timezone)}.`;
  return "Offer the open place to a cleaner.";
}

function Card({ row, now, timezone, onOpen, compact }: { row: JobRow; now: number; timezone: string; onOpen: () => void; compact?: boolean }) {
  const deadline = row.hardDeadlineAt;
  const undelivered = row.offers.filter((offer) => offer.text === null || ["failed", "not_sent", "unconfirmed"].includes(offer.text.status));
  const urgent = isUrgent(row, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid w-full gap-2 rounded-xl border bg-card px-3.5 py-3 text-left text-sm hover:border-brand-500/50 focus-visible:outline-2 focus-visible:outline-brand-500",
        urgent ? "border-destructive/40" : "border-border",
        row.status === "cancelled" && "opacity-60",
      )}
    >
      <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="min-w-0">
          <span className="block truncate font-medium text-strong">{row.customer ?? "Unknown customer"}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {row.serviceType} · {row.city ?? "Area unknown"} {row.postalCode ?? ""}
          </span>
        </span>
        {compact ? null : <GroupBadge group={row.group} />}
      </span>
      <span className="grid gap-0.5 text-xs text-muted-foreground">
        <span className="font-medium text-strong">
          {dayName(row.startsAt, timezone)} · {arrivalLabel(row, timezone)}
        </span>
        <span>
          Expected to end {clock(row.endsAt, timezone)} · {durationLabel(row.endsAt - row.startsAt)}
        </span>
        {deadline ? <span className={cn(deadline < row.endsAt ? "font-medium text-destructive-foreground" : "")}>Must be finished by {whenLabel(deadline, now, timezone)}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Staffing row={row} />
        {row.requiredCrew > 1 && row.status !== "cancelled" ? <span className={cn("text-xs", row.hasLead ? "text-muted-foreground" : "font-medium text-warning-foreground")}>{row.hasLead ? "Lead accepted" : "No lead accepted"}</span> : null}
        {urgent ? <span className="text-xs font-semibold text-destructive-foreground">Starts {until(row.startsAt, now).text}</span> : null}
      </span>
      {row.crew.length > 0 ? <span className="text-xs text-muted-foreground">Crew: {row.crew.map((member) => `${member.name}${row.requiredCrew > 1 && member.role ? ` (${member.role})` : ""}`).join(", ")}</span> : null}
      {row.offers.length > 0 ? (
        <span className="grid gap-0.5 text-xs text-muted-foreground">
          {row.offers.map((offer) => (
            <span key={offer.assignmentId}>
              Offer to {offer.name}: answer due {whenLabel(offer.respondBy, now, timezone)}
            </span>
          ))}
        </span>
      ) : null}
      {undelivered.length > 0 ? (
        <span className="flex items-start gap-1.5 text-xs font-medium text-destructive-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {undelivered.map((offer) => `${offer.name}: ${offer.text ? (DELIVERY[offer.text.status]?.label ?? offer.text.status) : "no text planned"}`).join(" · ")}. A contact problem, not a decline.
          </span>
        </span>
      ) : null}
      <span className="grid gap-0.5 border-t border-border pt-2 text-xs">
        <span className="text-strong">{nextOf(row, now, timezone)}</span>
        <span className="text-muted-foreground">With: {ownerOf(row)}</span>
      </span>
    </button>
  );
}

/**
 * Dispatch Board: every visit in the range, in the group its records put it in. The list and the board
 * are two layouts of the same rows. A card opens the visit; nothing here is dragged, because a group is
 * a fact about the record, and moving a card must never invent an acceptance, a check-in or a completion.
 */
export function DispatchBoardScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const range = useRange(now, timezone, "today");
  const board = useQuery(api.dispatchViews.board, now ? { companyId, from: range.from, to: range.to } : "skip");
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [adding, setAdding] = useState(false);
  const [filters, setFilters] = useState({ group: "all", service: "all", cleaner: "all", urgency: "all" });
  const set = (key: keyof typeof filters) => (value: string) => setFilters((current) => ({ ...current, [key]: value }));

  const jobs = board?.jobs ?? [];
  const services = [...new Set(jobs.map((row) => row.serviceType))].sort();
  const cleaners = [...new Map(jobs.flatMap((row) => [...row.crew, ...row.offers]).map((person) => [person.cleanerId, person.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = jobs
    .filter((row) => filters.group === "all" || row.group === filters.group)
    .filter((row) => filters.service === "all" || row.serviceType === filters.service)
    .filter((row) => filters.cleaner === "all" || [...row.crew, ...row.offers].some((person) => person.cleanerId === filters.cleaner))
    .filter((row) => filters.urgency === "all" || isUrgent(row, now))
    .sort((a, b) => a.startsAt - b.startsAt);
  const filtered = shown.length !== jobs.length;

  return (
    <>
      <PageHeader
        title="Dispatch Board"
        lead="Every scheduled visit, grouped by where its staffing stands. Accepted and required are counted separately, so a crew job is never shown as covered by one name."
        actions={
          <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add a visit
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <RangePicker range={range} />
        <div className="flex flex-wrap items-center gap-2">
          <Filter label="Staffing" value={filters.group} onChange={set("group")} options={[{ id: "all", label: "All" }, ...GROUPS.map((group) => ({ id: group.id, label: group.label }))]} />
          <Filter label="Service" value={filters.service} onChange={set("service")} options={[{ id: "all", label: "All" }, ...services.map((service) => ({ id: service, label: service }))]} />
          <Filter label="Cleaner" value={filters.cleaner} onChange={set("cleaner")} options={[{ id: "all", label: "Anyone" }, ...cleaners.map(([id, name]) => ({ id, label: name }))]} />
          <Filter label="Urgency" value={filters.urgency} onChange={set("urgency")} options={[{ id: "all", label: "All" }, { id: "urgent", label: "Short, starts within a day" }]} />
          <div role="tablist" aria-label="Layout" className="inline-flex rounded-lg border border-border bg-muted p-0.5">
            {(
              [
                { id: "board", label: "Board", icon: Kanban },
                { id: "list", label: "List", icon: LayoutList },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={layout === option.id}
                onClick={() => setLayout(option.id)}
                className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", layout === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
              >
                <option.icon className="size-3.5" aria-hidden />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {board?.truncated ? (
        <div className="mb-4">
          <Incomplete what="visits" />
        </div>
      ) : null}

      {board === undefined ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      ) : jobs.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm font-medium text-strong">No visits are scheduled in this range ({range.label.toLowerCase()}).</p>
          <p className="pb-4 text-center text-xs text-muted-foreground">An empty board means nothing is scheduled here. It does not say anything about other days.</p>
        </Panel>
      ) : shown.length === 0 ? (
        <Panel>
          <p className="py-6 text-center text-sm text-muted-foreground">No visit in this range matches the filters. {jobs.length} are hidden by them.</p>
        </Panel>
      ) : layout === "list" ? (
        <div className="grid gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
          {shown.map((row) => (
            <Card key={row.jobId} row={row} now={now} timezone={timezone} onOpen={() => open({ kind: "job", id: row.jobId })} />
          ))}
        </div>
      ) : (
        <div className="-mx-3 overflow-x-auto px-3 pb-2 sm:-mx-6 sm:px-6">
          <div className="flex min-w-max gap-3">
            {GROUPS.filter((group) => filters.group === "all" || group.id === filters.group).map((group) => {
              const rows = shown.filter((row) => row.group === group.id);
              return (
                <section key={group.id} aria-label={group.label} className="flex w-[19rem] shrink-0 flex-col rounded-2xl border border-border bg-muted/60">
                  <header className="border-b border-border px-3.5 py-2.5">
                    <h2 className="flex items-center justify-between gap-2 text-sm font-semibold text-strong">
                      {group.label}
                      <span className="tabular-nums text-muted-foreground">{rows.length}</span>
                    </h2>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{group.hint}</p>
                  </header>
                  <div className="grid gap-2 p-2.5">
                    {rows.length === 0 ? <p className="px-1 py-3 text-xs text-muted-foreground">None{filtered ? " match the filters" : ""}.</p> : rows.map((row) => <Card key={row.jobId} row={row} now={now} timezone={timezone} onOpen={() => open({ kind: "job", id: row.jobId })} compact />)}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      <p className="mt-5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Open a visit to see who Dispatch would ask and why, approve or change a proposal, offer an open place, take the visit over or hand it back. Location is not a filter yet, because visits carry no location record to filter by.
      </p>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a visit" description="A visit is a promise to the customer. It is staffed only when every cleaner it needs has accepted.">
        <NewVisitForm onDone={() => setAdding(false)} />
      </Modal>
    </>
  );
}
