"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { AgentAvatar, eyebrow } from "@/components/app/agent";
import { useCompany } from "@/components/app/company";
import { FormError, useRun } from "@/components/app/form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/app/format";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const AUTHORITY: Record<string, string> = {
  off: "Dispatch is switched off for this, so a person offers the visit.",
  paused: "Dispatch is paused, so nothing moves until it is resumed.",
  propose: "Dispatch proposes a cleaner and waits for your approval before any offer goes out.",
  execute_and_report: "Dispatch offers the visit itself and tells you each time.",
  execute: "Dispatch offers the visit itself. It appears in the history.",
};

/**
 * Dispatch's reasoning for one visit: who it would ask, best first, with the reasons; who it cannot
 * ask, and why. A person can offer to anyone on the list, take the visit over, or hand it back.
 */
export function DispatchView({ jobId, now, canOffer }: { jobId: Id<"jobs">; now: number; canOffer: boolean }) {
  const { companyId } = useCompany();
  const view = useQuery(api.dispatch.candidates, { companyId, jobId });
  const offer = useMutation(api.assignments.offer);
  const takeOver = useMutation(api.dispatch.takeOver);
  const handBack = useMutation(api.dispatch.handBack);
  const { busy, error, run } = useRun();
  const [showExcluded, setShowExcluded] = useState(false);
  if (view === undefined) return <Skeleton className="h-28 rounded-xl" />;
  const window = view.settings.offerWindowMinutes;
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-2.5 rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2.5">
        <AgentAvatar agent="dispatch" size="sm" />
        <p className="text-sm leading-relaxed text-strong">
          {view.withPerson ? "You are holding this visit. Dispatch leaves it alone until you hand it back." : (AUTHORITY[view.authority] ?? AUTHORITY.off)}
        </p>
      </div>

      <div>
        <p className={eyebrow}>Who Dispatch would ask, best first</p>
        {view.candidates.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">No cleaner can be offered this visit right now. The reasons are below.</p>
        ) : (
          <ol className="mt-2 grid gap-2">
            {view.candidates.map((candidate) => {
              const proposed = candidate.cleanerId === view.proposedCleanerId;
              const pay = candidate.pay;
              return (
                <li key={candidate.cleanerId} className={cn("rounded-xl border px-3 py-2.5", proposed ? "border-brand-500/50 bg-brand-500/5" : "border-border bg-background")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">
                      <span className="mr-1.5 inline-flex size-5 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">{candidate.rank}</span>
                      <span className="font-medium text-strong">{candidate.name}</span>
                      {proposed ? <span className="ml-2 text-xs font-medium text-brand-200">proposed</span> : null}
                    </p>
                    <span className="text-xs text-muted-foreground">{pay ? `${money(pay.payCents)} · ${pay.basis}` : "Pay is shown to the Owner"}</span>
                  </div>
                  <ul className="mt-1 grid gap-0.5 text-xs leading-relaxed text-muted-foreground">
                    {candidate.reasons.map((reason) => (
                      <li key={reason}>
                        {candidate.name} {reason}
                      </li>
                    ))}
                  </ul>
                  {canOffer && pay && view.coverage === "uncovered" ? (
                    <Button
                      className="mt-2"
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      onClick={() => void run(() => offer({ companyId, jobId, cleanerId: candidate.cleanerId, payCents: pay.payCents, respondBy: now + window * 60_000 }))}
                    >
                      Offer to {candidate.name} · {window} min to answer
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {view.excluded.length > 0 ? (
        <div>
          <button type="button" onClick={() => setShowExcluded((current) => !current)} aria-expanded={showExcluded} className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-brand-500">
            {showExcluded ? "Hide" : "Show"} the {view.excluded.length} who cannot be asked
          </button>
          {showExcluded ? (
            <ul className="mt-1.5 grid gap-1 text-xs leading-relaxed text-muted-foreground">
              {view.excluded.map((entry) => (
                <li key={entry.cleanerId}>
                  <span className="font-medium text-strong">{entry.name}</span> {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <FormError message={error} />
      {canOffer ? (
        <div className="flex flex-wrap gap-2">
          {view.withPerson ? (
            <Button variant="primary" size="sm" loading={busy} onClick={() => void run(() => handBack({ companyId, jobId }))}>
              Hand back to Dispatch
            </Button>
          ) : view.coverage !== "covered" ? (
            <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => takeOver({ companyId, jobId }))}>
              Handle this visit myself
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** How Dispatch works for this company. The Owner sets it. */
export function DispatchSettings() {
  const { companyId, role } = useCompany();
  const settings = useQuery(api.dispatch.settings, { companyId });
  if (!settings) return <Skeleton className="h-32 rounded-2xl" />;
  return <DispatchSettingsForm key={`${settings.offerWindowMinutes}:${settings.travelBufferMinutes}:${settings.lookAheadDays}`} settings={settings} canEdit={role === "owner"} />;
}

function DispatchSettingsForm({ settings, canEdit }: { settings: { offerWindowMinutes: number; travelBufferMinutes: number; lookAheadDays: number; usingDefaults: boolean }; canEdit: boolean }) {
  const { companyId } = useCompany();
  const save = useMutation(api.dispatch.setSettings);
  const { busy, error, run } = useRun();
  const [form, setForm] = useState({ offerWindowMinutes: String(settings.offerWindowMinutes), travelBufferMinutes: String(settings.travelBufferMinutes), lookAheadDays: String(settings.lookAheadDays) });
  const rows: { key: keyof typeof form; label: string; hint: string }[] = [
    { key: "offerWindowMinutes", label: "Minutes a cleaner has to answer", hint: "After this the offer expires and the next cleaner is asked." },
    { key: "travelBufferMinutes", label: "Minutes kept free between visits", hint: "Counted before anyone is offered a visit." },
    { key: "lookAheadDays", label: "Days ahead Dispatch looks", hint: "Visits further out wait until they come into view." },
  ];
  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3 sm:px-5">
        <AgentAvatar agent="dispatch" size="sm" />
        <h2 className="font-heading text-base tracking-tight text-strong">Dispatch</h2>
        {settings.usingDefaults ? <span className="text-xs text-muted-foreground">· using the starting values</span> : null}
      </header>
      <form
        className="grid gap-3 p-4 sm:grid-cols-3 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => save({ companyId, offerWindowMinutes: Number(form.offerWindowMinutes), travelBufferMinutes: Number(form.travelBufferMinutes), lookAheadDays: Number(form.lookAheadDays) }));
        }}
      >
        {rows.map((row) => (
          <label key={row.key} className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">{row.label}</span>
            <input
              inputMode="numeric"
              disabled={!canEdit}
              value={form[row.key]}
              onChange={(event) => setForm((current) => ({ ...current, [row.key]: event.target.value }))}
              className="block min-h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-strong focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30 disabled:opacity-70"
            />
            <span className="text-xs text-muted-foreground">{row.hint}</span>
          </label>
        ))}
        <div className="sm:col-span-3">
          <FormError message={error} />
          {canEdit ? (
            <Button type="submit" variant="primary" size="sm" loading={busy}>
              Save
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only the Owner changes these.</p>
          )}
        </div>
      </form>
    </section>
  );
}
