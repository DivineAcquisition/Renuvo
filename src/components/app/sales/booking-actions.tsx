"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { useCompany } from "@/components/app/company";
import { FormError, messageOf } from "@/components/app/form";
import { MoneyInput } from "@/components/app/services/shared";
import { FileText } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/app/format";

import { api } from "../../../../convex/_generated/api";
import type { DraftBody } from "../../../../convex/lib/sales/draft";
import { fieldClass, FormSection } from "./kit";
import { NeedsList } from "./summary";
import type { DraftData, Working } from "./use-draft";

type Summary = FunctionReturnType<typeof api.sales.price>;

/** One explicit action, with what it creates and what stays pending, in words. */
export function ActionCard({ title, creates, pending, children }: { title: string; creates: string; pending?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="text-sm font-medium text-strong">{title}</p>
      <p className="text-xs text-muted-foreground">{creates}</p>
      {pending ? <p className="text-xs text-muted-foreground">Still pending after: {pending}</p> : null}
      <div className="mt-auto pt-1">{children}</div>
    </div>
  );
}

export function BookingActions({ n, data, working, setBody, summary, flush, revision, saving, children }: { n: number; data: DraftData; working: Working; setBody: (change: (body: DraftBody) => DraftBody) => void; summary: Summary | undefined; flush: () => Promise<void>; revision: () => number; saving: boolean; children?: React.ReactNode }) {
  const { companyId } = useCompany();
  const saveQuote = useMutation(api.sales.saveQuoteFromDraft);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const booking = summary?.mode === "booking" ? summary : null;
  const override = working.body.override;
  const priced = booking && booking.firstCents !== null && (booking.visit?.outcome === "firm" || booking.visit?.outcome === "estimate");

  const run = (work: () => Promise<string>) => {
    setError(null);
    setDone(null);
    setBusy(true);
    void flush()
      .then(work)
      .then(setDone)
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  return (
    <FormSection n={n} id="review" title="Review" lead="Check exactly what the customer gets, then choose what to do.">
      <details className="rounded-xl border border-border px-3 py-2" open={override?.priceCents !== undefined}>
        <summary className="cursor-pointer text-sm font-medium text-strong">Change the price</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <MoneyInput label={working.bookingKind === "recurring" ? "First visit price" : "Price"} unit="instead of the calculated price" cents={override?.priceCents ?? null} onCents={(priceCents) => setBody((b) => ({ ...b, override: priceCents === null ? undefined : { ...b.override, priceCents } }))} hint={booking?.override?.referenceCents ? `Calculated: ${money(booking.override.referenceCents)}` : undefined} />
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-strong">Reason</span>
            <input className={fieldClass()} value={override?.reason ?? ""} disabled={override?.priceCents === undefined} onChange={(e) => setBody((b) => ({ ...b, override: { ...b.override, reason: e.target.value } }))} placeholder="For example: price matched for a returning customer" />
          </label>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{data.role === "owner" ? "As the Owner, your change applies when you book." : "The Owner approves a changed price before anything is sent. Telling them afterward doesn't count as approval."}</p>
      </details>
      {booking ? <NeedsList needs={booking.needs} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <ActionCard title="Save a quote" creates="Saves this price with its exact answers and the published service version, held for 14 days. Nothing is booked and no time is held." pending="Booking, time, payment and agreement.">
          <Button
            variant="outline"
            disabled={busy || saving || !priced || Boolean(override)}
            onClick={() =>
              run(async () => {
                const result = await saveQuote({ companyId, draftId: data.draft._id, revision: revision() });
                return `Quote saved. It's held until ${new Date(result.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`;
              })
            }
          >
            <FileText aria-hidden className="size-4" /> Save quote
          </Button>
        </ActionCard>
        {children}
      </div>
      {done ? (
        <p role="status" className="rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm text-success-foreground">
          {done}
        </p>
      ) : null}
      <FormError message={error} />
    </FormSection>
  );
}
