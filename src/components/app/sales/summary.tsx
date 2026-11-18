"use client";

import type { FunctionReturnType } from "convex/server";

import { Sparkles } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import type { api } from "../../../../convex/_generated/api";
import { hoursWords, minutesToTime, ReadyLine, SummaryRow, type Readiness } from "./kit";
import type { DraftData, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;
type Booking = Extract<Summary, { mode: "booking" }>;
type Need = Booking["needs"][number];

function Lines({ visit, title }: { visit: NonNullable<Booking["visit"]>; title: string }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <dl className="grid gap-1">
        {visit.lines
          .filter((line) => line.amountCents !== 0 || line.kind === "base")
          .map((line) => (
            <SummaryRow key={line.key + line.label} label={line.label} value={money(line.amountCents)} muted={line.kind !== "base"} />
          ))}
      </dl>
    </div>
  );
}

export function NeedsList({ needs }: { needs: Need[] }) {
  if (!needs.length) return <p className="rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">Nothing missing.</p>;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/8 p-3">
      <p className="text-xs font-semibold text-warning-foreground">Still needed</p>
      <ul className="mt-1.5 grid gap-1 text-sm">
        {needs.map((need) => (
          <li key={need.key}>
            <a href={`#${need.section === "review" ? "review" : need.section}`} className={cn("underline-offset-2 hover:underline", need.blocking ? "text-strong" : "text-muted-foreground")}>
              {need.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function scheduleReadiness(booking: Booking, working: Working): { state: Readiness; detail: string } {
  if (booking.startsAt === null) return { state: "waiting", detail: "Choose a date and time." };
  if (working.body.schedule?.proposed) return { state: "waiting", detail: "Proposed date: not held until confirmed." };
  const c = booking.capacity;
  if (!c) return { state: "unknown", detail: "Choose a service to check capacity." };
  if (c.state === "fits" || c.state === "tight") return { state: "done", detail: c.why };
  if (c.state === "unknown") return { state: "unknown", detail: c.why };
  return { state: "blocked", detail: c.why };
}

/** The live summary beside the form: priced on the server whenever the draft is saved. */
export function BookingSummary({ data, working, summary, saving }: { data: DraftData; working: Working; summary: Summary | undefined; saving: boolean }) {
  if (!summary) return <Skeleton className="h-96 rounded-2xl" />;
  if (summary.mode !== "booking") return null;
  const recurring = working.bookingKind === "recurring";
  const property = data.properties.find((p) => p._id === working.propertyId);
  const tz = data.timezone;
  const payment = working.body.payment?.policy;
  const agreement = working.body.agreement;
  const schedule = scheduleReadiness(summary, working);
  const lead = summary.first ?? summary.visit;
  return (
    <div className="grid gap-4">
      <section aria-labelledby="summary-title" className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_8px_30px_-16px_color-mix(in_oklab,var(--color-brand-500)_40%,transparent)]">
        <div className="relative bg-gradient-to-br from-brand-600 via-brand-500 to-[#8b6cff] px-5 py-4 text-white">
          <div aria-hidden className="pointer-events-none absolute -top-10 -right-8 size-32 rounded-full bg-white/15 blur-2xl" />
          <p id="summary-title" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase opacity-90">
            <Sparkles aria-hidden className="size-3.5" /> Live quote {saving ? <span className="font-normal normal-case opacity-80">· updating</span> : null}
          </p>
          <p className="mt-1 truncate text-sm opacity-95">{summary.first && summary.visit ? `${summary.first.name}, then ${summary.visit.name}` : summary.visit ? summary.visit.name : "No service chosen"}</p>
          <p className="truncate text-xs opacity-80">{property ? `${property.address.line1}, ${property.address.city}` : "No address yet"}</p>
          <p className="mt-3 font-heading text-3xl tracking-tight tabular-nums" aria-live="polite">
            {summary.firstCents !== null ? money(summary.firstCents) : summary.visit?.outcome === "walkthrough" ? "Walkthrough" : "—"}
          </p>
          <p className="text-xs opacity-85">{recurring ? (summary.first ? "First visit" : "First visit, then each visit") : summary.visit?.outcome === "estimate" ? "Estimate" : "This visit"}</p>
        </div>
        <div className="grid gap-4 px-5 py-4">
          {summary.override ? (
            <div className="rounded-lg border border-warning/30 bg-warning/8 p-2.5 text-xs">
              <p className="font-medium text-strong">Price changed by staff</p>
              <p className="text-muted-foreground">
                Calculated {summary.override.referenceCents !== null ? money(summary.override.referenceCents) : "—"} → proposed {money(summary.override.proposedCents)}. {summary.override.reason ? `Reason: ${summary.override.reason}` : "Needs a reason."}
              </p>
            </div>
          ) : null}
          {summary.first ? <Lines visit={summary.first} title={`First visit · ${summary.first.name}`} /> : null}
          {summary.visit ? <Lines visit={summary.visit} title={recurring ? `Each visit after · ${summary.visit.name}` : "Price"} /> : null}
          {recurring && summary.ongoingCents !== null ? (
            <dl className="grid gap-1 border-t border-border pt-3">
              <SummaryRow label="Ongoing, per visit" value={money(summary.ongoingCents)} strong />
              {summary.cadence ? <SummaryRow label="Cadence" value={summary.cadence} muted /> : null}
            </dl>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">Due now</p>
              <p className="text-base font-semibold text-strong tabular-nums">{summary.dueNowCents !== null ? money(summary.dueNowCents) : "—"}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">{recurring ? "First visit balance" : "Balance later"}</p>
              <p className="text-base font-semibold text-strong tabular-nums">{summary.dueLaterCents !== null ? money(summary.dueLaterCents) : "—"}</p>
            </div>
          </div>
          {lead ? (
            <dl className="grid gap-1">
              <SummaryRow label="Time on site" value={hoursWords(Math.max(15, lead.time.elapsedMinutes))} />
              <SummaryRow label="Crew" value={`${lead.time.crewSize} cleaner${lead.time.crewSize === 1 ? "" : "s"}`} />
              {summary.startsAt !== null ? (
                <SummaryRow
                  label="Arrives"
                  value={`${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(summary.startsAt))}, ${minutesToTime(working.body.schedule?.arrivalMinute ?? 0)}`}
                />
              ) : null}
            </dl>
          ) : null}
          <div className="grid gap-2">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Readiness</p>
            <ul className="grid gap-2">
              <ReadyLine label="Schedule" state={schedule.state} detail={schedule.detail} />
              <ReadyLine label="Payment" state={!payment ? "waiting" : payment === "deposit" || payment === "full" ? "waiting" : "done"} detail={!payment ? "Choose how the customer pays." : payment === "deposit" || payment === "full" ? "A payment link goes out with the booking." : payment === "external" ? "Recorded when received." : "Invoiced later."} />
              <ReadyLine label="Agreement" state={agreement?.required ? "waiting" : "not_needed"} detail={agreement?.required ? "Sent for the customer's signature with the booking." : null} />
            </ul>
          </div>
          <NeedsList needs={summary.needs} />
        </div>
      </section>
      {summary.contribution ? (
        <details className="rounded-2xl border border-border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-strong">Estimated costs (Owner only)</summary>
          <div className="mt-3 grid gap-1.5 text-sm">
            {summary.contribution.result ? (
              <dl className="grid gap-1">
                <SummaryRow label="Revenue" value={money(summary.contribution.revenueCents)} />
                {summary.contribution.result.costs.map((line) => (
                  <SummaryRow key={line.key} label={line.label} value={`−${money(line.cents)}`} muted />
                ))}
                <SummaryRow label="Contribution (estimate)" value={money(summary.contribution.result.contributionCents)} strong />
              </dl>
            ) : null}
            {summary.contribution.why ? <p className="text-xs text-warning-foreground">{summary.contribution.why}</p> : null}
            <p className="text-xs text-muted-foreground">This is not net profit: overhead, travel and taxes are not included unless entered.</p>
          </div>
        </details>
      ) : null}
    </div>
  );
}
