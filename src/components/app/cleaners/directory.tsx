"use client";

import { Avatar, Chips, NextLine, ReadinessLine, StatusBadge, TypeLabel, type Row } from "@/components/app/cleaners/shared";
import { CheckCircle2, MapPin, TeamIcon, TriangleAlert, XCircle } from "@/components/icons";
import { cn } from "@/lib/utils";

type Answers = Record<string, { available: boolean; reason: string }> | null;

/** Free in the chosen window. Free is not bookable: someone free who cannot be offered work yet says so. */
function Free({ answer, ready }: { answer?: { available: boolean; reason: string }; ready: boolean }) {
  if (!answer) return null;
  const bookable = answer.available && ready;
  return (
    <span className={cn("inline-flex items-start gap-1 text-xs font-medium", bookable ? "text-success-foreground" : answer.available ? "text-warning-foreground" : "text-muted-foreground")}>
      {bookable ? <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden /> : answer.available ? <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> : <XCircle className="mt-px size-3.5 shrink-0" aria-hidden />}
      {bookable ? "Free then" : answer.available ? "Free then, but cannot be offered work yet" : answer.reason}
    </span>
  );
}

/** Attention beyond what the readiness line already says. */
const extraAttention = (row: Row) => row.attention - (row.readiness.state === "blocked" ? 1 : 0);

function CrewLine({ crews }: { crews: Row["crews"] }) {
  if (crews.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <TeamIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {crews.map((crew, index) => (
          <span key={crew.id}>
            {index > 0 ? ", " : ""}
            <span className="text-strong">{crew.name}</span>
            {crew.role === "lead" ? " (lead)" : ""}
          </span>
        ))}
      </span>
    </span>
  );
}

/** One person, summarized: who they are, where they stand, where and what they work, and what is next. No pay. */
function Card({ row, onOpen, answer }: { row: Row; onOpen: () => void; answer?: { available: boolean; reason: string } }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "group grid h-full w-full content-start gap-3 rounded-2xl border bg-card p-4 text-left transition-[border-color,box-shadow] hover:border-brand-500/50 hover:shadow-[0_8px_24px_-16px_rgba(81,38,199,0.45)] focus-visible:outline-2 focus-visible:outline-brand-500",
          row.attention > 0 ? "border-warning/40" : "border-border",
          (row.status === "ended" || row.status === "paused") && "bg-card/70",
        )}
        aria-label={`${row.name}, ${row.statusWords}, ${row.readiness.headline}. Open profile.`}
      >
        <span className="flex items-start gap-3">
          <Avatar initials={row.initials} seed={row.cleanerId} />
          <span className="min-w-0 flex-1">
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-strong">{row.name}</span>
                {row.preferredName ? <span className="block truncate text-xs text-muted-foreground">Goes by {row.preferredName}</span> : null}
              </span>
              <StatusBadge status={row.status} />
            </span>
            <span className="mt-0.5 flex text-xs text-muted-foreground">
              <TypeLabel row={row} />
            </span>
          </span>
        </span>
        <span className="grid gap-1.5 rounded-xl bg-muted/40 px-3 py-2">
          <ReadinessLine readiness={row.readiness} />
          {extraAttention(row) > 0 ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
              <TriangleAlert className="size-3.5" aria-hidden />
              {extraAttention(row) === 1 ? "1 more thing to look at" : `${extraAttention(row)} more things to look at`}
            </span>
          ) : null}
          {answer ? <Free answer={answer} ready={row.readiness.state === "ready"} /> : null}
        </span>
        <span className="grid gap-2">
          <span className="flex min-w-0 items-start gap-1.5">
            <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <Chips values={row.serviceAreas} max={4} empty="No service area set" mono />
          </span>
          {row.skills.length > 0 ? <Chips values={row.skills} max={3} /> : null}
          <CrewLine crews={row.crews} />
        </span>
        <span className="mt-auto border-t border-border pt-3">
          <NextLine row={row} />
        </span>
      </button>
    </li>
  );
}

export function DirectoryCards({ rows, onOpen, availability }: { rows: Row[]; onOpen: (cleanerId: string) => void; availability: Answers }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((row) => (
        <Card key={row.cleanerId} row={row} onOpen={() => onOpen(row.cleanerId)} answer={availability?.[row.cleanerId]} />
      ))}
    </ul>
  );
}

/** The same rows, compact. Each row opens the person; the table scrolls inside its frame on a phone. */
export function DirectoryTable({ rows, onOpen, availability }: { rows: Row[]; onOpen: (cleanerId: string) => void; availability: Answers }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-border bg-muted/40 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="px-4 py-2.5">Name</th>
              <th scope="col" className="px-3 py-2.5">Status</th>
              <th scope="col" className="px-3 py-2.5">Readiness</th>
              <th scope="col" className="px-3 py-2.5">Areas</th>
              <th scope="col" className="px-3 py-2.5">Crew</th>
              <th scope="col" className="px-3 py-2.5">{availability ? "In the window" : "Next"}</th>
              <th scope="col" className="px-4 py-2.5">Phone</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.cleanerId} className="cursor-pointer hover:bg-muted/40" onClick={() => onOpen(row.cleanerId)}>
                <td className="px-4 py-2.5">
                  <button type="button" onClick={(event) => { event.stopPropagation(); onOpen(row.cleanerId); }} className="flex items-center gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand-500">
                    <Avatar initials={row.initials} seed={row.cleanerId} size="sm" />
                    <span className="min-w-0">
                      <span className="block font-medium text-strong">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        <TypeLabel row={row} />
                      </span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="max-w-[16rem] px-3 py-2.5">
                  <ReadinessLine readiness={row.readiness} />
                  {extraAttention(row) > 0 ? <span className="mt-0.5 block text-xs font-medium text-warning-foreground">{extraAttention(row)} more to look at</span> : null}
                </td>
                <td className="px-3 py-2.5">
                  <Chips values={row.serviceAreas} max={3} empty="None" mono />
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground">{row.crews.length > 0 ? row.crews.map((crew) => `${crew.name}${crew.role === "lead" ? " (lead)" : ""}`).join(", ") : "—"}</td>
                <td className="px-3 py-2.5 text-xs">
                  {availability ? (
                    <Free answer={availability[row.cleanerId]} ready={row.readiness.state === "ready"} />
                  ) : row.next ? (
                    <span className="text-strong">{row.next.words}</span>
                  ) : (
                    <span className="text-muted-foreground">{row.hoursWords}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{row.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
