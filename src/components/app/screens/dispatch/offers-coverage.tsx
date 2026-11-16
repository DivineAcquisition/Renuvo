"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { canManage, useCompany } from "@/components/app/company";
import { useDetail } from "@/components/app/detail-panel";
import { FormError, TextInput, useRun } from "@/components/app/form";
import { PageHeader, Panel } from "@/components/app/shell";
import { useNow } from "@/components/app/use-now";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { dayName, clock, money, until, whenLabel } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { deliveryOf, Incomplete, RangePicker, Staffing, useRange } from "./shared";

type TabId = "offers" | "coverage" | "gaps" | "history";

const CAUSE: Record<string, string> = { drop: "A cleaner said they cannot attend", no_show: "A cleaner was confirmed a no-show", delay: "A cleaner is running too late", released: "A person released the cleaner", undelivered: "The offer text was not delivered" };
const ENDED: Record<string, string> = { declined: "Declined", expired: "No answer in time", cancelled: "Ended" };
const ENDED_CAUSE: Record<string, string> = { released: "Released by a person", job_covered: "Withdrawn: the place was filled", job_cancelled: "The visit was cancelled", job_moved: "The visit was moved", dropped: "Said they cannot attend", no_show: "Confirmed no-show", undelivered: "The text was not delivered" };

function Visit({ customer, startsAt, timezone, onOpen }: { customer: string | null; startsAt: number; timezone: string; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="text-left font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
      {customer ?? "Unknown customer"} · {dayName(startsAt, timezone)}, {clock(startsAt, timezone)}
    </button>
  );
}

/** One open offer: who, for what, by when, what became of the text, and what a person can do about it. */
function OfferRow({ offer, now, timezone, onOpen }: { offer: { assignmentId: Id<"assignments">; jobId: Id<"jobs">; customer: string | null; startsAt: number; name: string; role: string | null; kind: string; respondBy: number; payCents: number | null; messages: { status: string; problem: string | null }[] }; now: number; timezone: string; onOpen: () => void }) {
  const { companyId, role } = useCompany();
  const answer = useMutation(api.assignments.recordAnswer);
  const release = useMutation(api.assignments.release);
  const reissue = useMutation(api.dispatchOps.reissueLink);
  const { busy, error, run } = useRun();
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const text = deliveryOf(offer.messages);
  const due = until(offer.respondBy, now);
  return (
    <li className="grid gap-2 px-4 py-3.5 text-sm sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p>
            <span className="font-medium text-strong">{offer.name}</span>
            <span className="text-muted-foreground">
              {offer.role ? ` · ${offer.role}` : ""}
              {offer.kind === "backup" ? " · cover for a place that lost its cleaner" : offer.kind === "replacement" ? " · asked after an earlier no" : ""}
            </span>
          </p>
          <Visit customer={offer.customer} startsAt={offer.startsAt} timezone={timezone} onOpen={onOpen} />
        </div>
        <div className="text-right text-xs">
          <p className={cn("font-medium", due.late ? "text-destructive-foreground" : "text-strong")}>
            Answer due {whenLabel(offer.respondBy, now, timezone)} · {due.text}
          </p>
          <p className="text-muted-foreground">{offer.payCents === null ? "Pay is shown to the Owner" : `Estimated pay ${money(offer.payCents)}`}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={text.variant} size="sm">
          {text.label}
        </Badge>
        {text.failed ? <span className="text-xs text-destructive-foreground">{text.problem ?? "The cleaner has not been reached."} This is a contact problem, not a decline.</span> : <span className="text-xs text-muted-foreground">Whether it was read is not known. No answer yet.</span>}
      </div>
      <FormError message={error} />
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      {withdrawing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => release({ companyId, assignmentId: offer.assignmentId, reason: reason.trim() }));
          }}
        >
          <TextInput autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is the offer withdrawn?" aria-label="Why is the offer withdrawn?" required maxLength={500} className="max-w-sm" />
          <Button type="submit" variant="primary" size="sm" loading={busy}>
            Withdraw
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWithdrawing(false)}>
            Never mind
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="xs" disabled={busy} onClick={() => void run(() => answer({ companyId, assignmentId: offer.assignmentId, answer: "accepted" }))}>
            They told me yes
          </Button>
          <Button variant="outline" size="xs" disabled={busy} onClick={() => void run(() => answer({ companyId, assignmentId: offer.assignmentId, answer: "declined" }))}>
            They told me no
          </Button>
          {canManage(role) ? (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const sent = await reissue({ companyId, assignmentId: offer.assignmentId });
                  setNote(sent.problem ? `A new link was issued and the old one closed, but the text did not go: ${sent.problem}` : "A new link was issued and texted. The old link is closed.");
                })
              }
            >
              Send a new link
            </Button>
          ) : null}
          <Button variant="ghost" size="xs" onClick={() => setWithdrawing(true)}>
            Withdraw
          </Button>
          <Button variant="ghost" size="xs" onClick={onOpen}>
            See who is next
          </Button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Record an answer only if the cleaner gave it to you themselves. It is checked again against the open places and their other work, and the history says the office recorded it.</p>
    </li>
  );
}

/**
 * Offers & Coverage: the offers that are out, the places that lost a cleaner and are being covered, the
 * places nobody has been asked for, and what has already ended. Every row leads to its visit.
 */
export function OffersCoverageScreen() {
  const { companyId, timezone } = useCompany();
  const now = useNow();
  const open = useDetail();
  const range = useRange(now, timezone, "week");
  const args = now ? { companyId, from: range.from, to: range.to } : "skip";
  const data = useQuery(api.dispatchViews.offersAndCoverage, args);
  const board = useQuery(api.dispatchViews.board, args);
  const handBack = useMutation(api.dispatch.handBack);
  const { busy, error, run } = useRun();
  const [tab, setTab] = useState<TabId>("offers");

  const openCoverage = data?.coverage.filter((row) => row.status === "open" || row.status === "unresolved") ?? [];
  // A place nobody is being asked for: short, scheduled, and with fewer offers out than places open.
  const gaps = board?.jobs.filter((row) => row.status === "scheduled" && row.openPlaces > row.offersOut).sort((a, b) => a.startsAt - b.startsAt) ?? [];
  const history = [
    ...(board?.jobs.flatMap((row) => row.ended.map((entry) => ({ key: entry.assignmentId as string, at: entry.respondedAt ?? entry.offeredAt, jobId: row.jobId, customer: row.customer, startsAt: row.startsAt, title: entry.name, words: entry.status === "cancelled" ? (ENDED_CAUSE[entry.cause ?? ""] ?? "Ended") : ENDED[entry.status], detail: entry.reason }))) ?? []),
    ...(data?.coverage.filter((row) => row.status === "filled" || row.status === "cancelled").map((row) => ({ key: row.coverageRequestId as string, at: row.openedAt, jobId: row.jobId, customer: row.customer, startsAt: row.startsAt, title: "Cover request", words: row.status === "filled" ? "Filled" : "Closed with the visit", detail: row.summary })) ?? []),
  ].sort((a, b) => b.at - a.at);
  const tabs: { id: TabId; label: string; count: number | null }[] = [
    { id: "offers", label: "Open Offers", count: data ? data.offers.length : null },
    { id: "coverage", label: "Replacement Coverage", count: data ? openCoverage.length : null },
    { id: "gaps", label: "Unresolved Gaps", count: board ? gaps.length : null },
    { id: "history", label: "History", count: board && data ? history.length : null },
  ];
  const loading = data === undefined || board === undefined;

  return (
    <>
      <PageHeader title="Offers & Coverage" lead="Who has been asked, what became of each text, which places lost a cleaner, and which places nobody has been asked for yet." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Offers and coverage" className="inline-flex flex-wrap rounded-lg border border-border bg-muted p-0.5">
          {tabs.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={tab === option.id}
              onClick={() => setTab(option.id)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-brand-500", tab === option.id ? "bg-card text-strong shadow-sm" : "text-muted-foreground hover:text-strong")}
            >
              {option.label}
              {option.count !== null ? <span className="ml-1.5 tabular-nums text-muted-foreground">{option.count}</span> : null}
            </button>
          ))}
        </div>
        <RangePicker range={range} />
      </div>
      {data?.truncated || board?.truncated ? (
        <div className="mb-4">
          <Incomplete what="visits" shown={board?.jobs.length} total={board?.total ?? data?.total} />
        </div>
      ) : null}
      <FormError message={error} />

      {loading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : tab === "offers" ? (
        <Panel title={`Open offers · ${range.label.toLowerCase()}`} flush>
          {data.offers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No offer is waiting for an answer in this range. That says nothing about whether visits are staffed: see Unresolved Gaps.</p>
          ) : (
            <ul className="divide-y divide-border">
              {[...data.offers]
                .sort((a, b) => a.respondBy - b.respondBy)
                .map((offer) => (
                  <OfferRow key={offer.assignmentId} offer={offer} now={now} timezone={timezone} onOpen={() => open({ kind: "job", id: offer.jobId })} />
                ))}
            </ul>
          )}
        </Panel>
      ) : tab === "coverage" ? (
        <div className="grid gap-4">
          <Panel title="Places that lost a cleaner" flush>
            {openCoverage.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No place in this range has lost its cleaner and is still open.</p>
            ) : (
              <ul className="divide-y divide-border">
                {openCoverage.map((row) => {
                  const job = board.jobs.find((entry) => entry.jobId === row.jobId);
                  const due = until(row.decideBy, now);
                  return (
                    <li key={row.coverageRequestId} className="grid gap-1.5 px-4 py-3.5 text-sm sm:px-5">
                      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                        <div>
                          <Visit customer={row.customer} startsAt={row.startsAt} timezone={timezone} onOpen={() => open({ kind: "job", id: row.jobId })} />
                          <p className="text-muted-foreground">
                            Why the place reopened: {CAUSE[row.cause] ?? row.cause}
                            {row.detail ? ` — “${row.detail}”` : ""}
                          </p>
                        </div>
                        <Badge variant={row.status === "unresolved" ? "error" : "info"} size="sm">
                          {row.status === "unresolved" ? "Nobody found yet" : "Being covered"}
                        </Badge>
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {job ? <Staffing row={job} /> : null}
                        <span>
                          {row.offersOut} cover {row.offersOut === 1 ? "offer" : "offers"} out
                        </span>
                        <span className={cn(due.late && "font-medium text-destructive-foreground")}>
                          Decide by {whenLabel(row.decideBy, now, timezone)} · {due.text}
                        </span>
                        <span>With: {job?.task?.withPerson ? "a person, holding this visit" : job?.task?.status === "needs_decision" ? "a person, to decide" : "Dispatch"}</span>
                      </p>
                      {row.summary ? <p className="text-xs leading-relaxed text-strong">{row.summary}</p> : null}
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="xs" disabled={busy} onClick={() => void run(() => handBack({ companyId, jobId: row.jobId }))}>
                          {job?.task?.withPerson ? "Hand back to Dispatch" : "Have Dispatch look again"}
                        </Button>
                        <Button variant="ghost" size="xs" onClick={() => open({ kind: "job", id: row.jobId })}>
                          See who can be asked, and why others cannot
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <Panel title="Handed to Recruiter" flush>
            {data.recruiterHandoffs.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">Nothing has been handed to Recruiter as an urgent hire.</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.recruiterHandoffs.map((task) => (
                  <li key={task.taskId} className="px-4 py-3 text-sm sm:px-5">
                    <button type="button" onClick={() => open({ kind: "task", id: task.taskId })} className="text-left font-medium text-brand-300 underline-offset-4 hover:underline">
                      {task.title}
                    </button>
                    <p className="text-xs text-muted-foreground">Due {whenLabel(task.dueAt, now, timezone)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Broadcast offers are {data.broadcastEnabled ? "switched on" : "switched off"} in the company’s policy. Dispatch uses them for the places still open, never for more cleaners than are needed. Starting one by hand, and asking Recruiter by hand, are not built yet.
          </p>
        </div>
      ) : tab === "gaps" ? (
        <Panel title={`Places nobody is being asked for · ${range.label.toLowerCase()}`} flush>
          {gaps.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Every open place in this range has an offer out, or there are no open places.</p>
          ) : (
            <ul className="divide-y divide-border">
              {gaps.map((row) => (
                <li key={row.jobId} className="grid gap-1.5 px-4 py-3.5 text-sm sm:px-5">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <Visit customer={row.customer} startsAt={row.startsAt} timezone={timezone} onOpen={() => open({ kind: "job", id: row.jobId })} />
                    <span className={cn("text-xs font-medium", row.startsAt - now < 24 * 60 * 60 * 1000 ? "text-destructive-foreground" : "text-muted-foreground")}>Starts {until(row.startsAt, now).text}</span>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <Staffing row={row} />
                    <span>
                      {row.openPlaces - row.offersOut} {row.openPlaces - row.offersOut === 1 ? "place" : "places"} with nobody asked
                    </span>
                    <span>With: {row.pendingApprovalIds.length > 0 ? "a person, to approve a proposal" : row.task?.withPerson ? "a person, holding this visit" : row.task?.status === "needs_decision" ? "a person, to decide" : row.task ? "Dispatch" : "nobody yet"}</span>
                  </p>
                  {row.task?.openQuestion ? <p className="text-xs leading-relaxed text-strong">{row.task.openQuestion}</p> : row.task?.nextAction ? <p className="text-xs leading-relaxed text-strong">{row.task.nextAction}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="xs" onClick={() => open({ kind: "job", id: row.jobId })}>
                      {row.pendingApprovalIds.length > 0 ? "Open the visit to decide" : "Offer the open place"}
                    </Button>
                    {row.task?.withPerson ? (
                      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void run(() => handBack({ companyId, jobId: row.jobId }))}>
                        Hand back to Dispatch
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <Panel title={`Ended offers, assignments and cover requests · ${range.label.toLowerCase()}`} flush>
          {history.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing has ended for the visits in this range.</p>
          ) : (
            <ul className="divide-y divide-border">
              {history.map((entry) => (
                <li key={entry.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-sm sm:px-5">
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium text-strong">{entry.title}</span> <span className="text-muted-foreground">· {entry.words}</span>
                    </p>
                    {entry.detail ? <p className="text-xs text-muted-foreground">{entry.detail}</p> : null}
                  </div>
                  <Visit customer={entry.customer} startsAt={entry.startsAt} timezone={timezone} onOpen={() => open({ kind: "job", id: entry.jobId })} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
