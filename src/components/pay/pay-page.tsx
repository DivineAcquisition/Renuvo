"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useMemo, useState } from "react";

import { problemWords } from "@/components/cleaner/shell";
import { calendarDate, clientKey, moneyInput, parseMoney, usd } from "@/lib/app/finance";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

type View = NonNullable<FunctionReturnType<typeof api.pay.view>>;

/**
 * The customer's pay page. It shows one invoice and nothing else, says what is owed and why, and takes
 * a card or bank payment through the company's own Stripe account. "Received" is only shown once Stripe
 * confirms it: until then the page says the payment is processing.
 */
export function PayPage({ token }: { token: string }) {
  const view = useQuery(api.pay.view, { token });
  const [paymentId, setPaymentId] = useState<Id<"payments"> | null>(() => {
    if (typeof window === "undefined") return null;
    return (new URLSearchParams(window.location.search).get("payment") as Id<"payments"> | null) ?? null;
  });
  const returned = useMutation(api.pay.returned);
  // Back from a bank or card check: ask Stripe now, not when its notice arrives.
  useEffect(() => {
    if (paymentId && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("redirect_status")) void returned({ token, paymentId }).catch(() => undefined);
  }, [paymentId, returned, token]);

  if (view === undefined) {
    return (
      <Shell company={null}>
        <div aria-busy="true" className="grid gap-3">
          <div className="h-40 animate-pulse rounded-3xl bg-muted" />
          <div className="h-56 animate-pulse rounded-3xl bg-muted" />
        </div>
      </Shell>
    );
  }
  if (view === null) {
    return (
      <Shell company={null}>
        <Panel>
          <h1 className="text-lg font-semibold text-strong">This link doesn&apos;t open an invoice</h1>
          <p className="mt-1 text-sm text-muted-foreground">It may be incomplete. Please check the link you were sent, or contact the business that sent it.</p>
        </Panel>
      </Shell>
    );
  }
  return (
    <Shell company={view.company} testMode={view.testMode}>
      <Hero view={view} />
      {view.voided ? (
        <Panel>
          <p className="text-sm font-medium text-strong">This invoice was cancelled</p>
          <p className="mt-1 text-sm text-muted-foreground">Nothing is owed on it. Contact {view.company} with any questions.</p>
        </Panel>
      ) : paymentId ? (
        <Attempt token={token} paymentId={paymentId} view={view} onRestart={() => setPaymentId(null)} />
      ) : view.requestedCents > 0 ? (
        <Pay token={token} view={view} onStarted={setPaymentId} />
      ) : null}
      <Details view={view} />
      <p className="px-2 text-center text-xs text-muted-foreground">
        Payments go directly to {view.company} through Stripe. Your card details are never seen or stored by {view.company} or Selestial.
      </p>
    </Shell>
  );
}

function Shell({ company, testMode, children }: { company: string | null; testMode?: boolean; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-muted/50">
      <div className="h-36 bg-[radial-gradient(140%_120%_at_10%_0%,color-mix(in_oklab,var(--color-brand-500)_28%,transparent),transparent_70%)]" aria-hidden />
      <div className="mx-auto -mt-28 grid w-full max-w-lg gap-4 px-4 pb-16">
        <header className="flex items-center justify-between gap-3 px-1">
          <p className="truncate text-sm font-semibold text-strong">{company ?? "Invoice"}</p>
          {testMode ? <span className="rounded-md border border-warning/40 bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning-foreground">Test mode · no real charge</span> : null}
        </header>
        {children}
      </div>
    </main>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("rounded-3xl border border-border bg-card p-5 shadow-[0_24px_60px_-32px_rgba(27,14,69,0.35)] sm:p-6", className)}>{children}</section>;
}

function Hero({ view }: { view: View }) {
  const paid = view.state === "paid" || view.state === "overpaid";
  const label = view.voided ? "Cancelled" : paid ? "Paid in full" : view.deposit?.stage && view.deposit.outstandingCents > 0 ? "Deposit due" : view.state === "processing" ? "Payment processing" : view.state === "deposit_paid" ? "Deposit received" : "Amount due";
  const amount = paid || view.voided ? view.totals.totalCents : view.state === "deposit_paid" ? view.totals.balanceCents : view.requestedCents || view.totals.processingCents;
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{label}</p>
          <p className="mt-1.5 font-heading text-[2.6rem] leading-none tracking-tight text-strong tabular-nums">{usd(amount)}</p>
        </div>
        <span className={cn("rounded-full border px-2.5 py-1 text-xs font-medium", paid ? "border-success/40 bg-success/10 text-success-foreground" : view.state === "overdue" ? "border-destructive/40 bg-destructive/8 text-destructive-foreground" : "border-border bg-muted/50 text-muted-foreground")}>{view.stateWords}</span>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Invoice</dt>
          <dd className="font-medium text-strong tabular-nums">{view.number}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{paid ? "Issued" : "Due"}</dt>
          <dd className="font-medium text-strong">{calendarDate(paid ? view.issuedOn : view.dueOn)}</dd>
        </div>
        {view.customer ? (
          <div>
            <dt className="text-xs text-muted-foreground">For</dt>
            <dd className="truncate font-medium text-strong">{view.customer}</dd>
          </div>
        ) : null}
        {view.serviceAddress ? (
          <div>
            <dt className="text-xs text-muted-foreground">Service address</dt>
            <dd className="truncate font-medium text-strong">{view.serviceAddress}</dd>
          </div>
        ) : null}
      </dl>
      {view.deposit && view.deposit.stage ? (
        <p className="mt-4 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          This is a deposit of {usd(view.deposit.cents)} toward {usd(view.totals.totalCents)}. {view.company} will ask for the rest after your service.
        </p>
      ) : null}
    </Panel>
  );
}

function Pay({ token, view, onStarted }: { token: string; view: View; onStarted: (id: Id<"payments">) => void }) {
  const start = useMutation(api.pay.start);
  const [mode, setMode] = useState<"full" | "other">("full");
  const [other, setOther] = useState(moneyInput(view.requestedCents));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [key] = useState(clientKey);
  const [tipChoice, setTipChoice] = useState<"none" | 15 | 20 | 25 | "custom">("none");
  const [customTip, setCustomTip] = useState("");
  if (!view.canPayByCard) {
    return (
      <Panel>
        <p className="text-sm font-medium text-strong">How to pay</p>
        <p className="mt-1 text-sm text-muted-foreground">{view.cardUnavailableReason ?? `Please pay ${view.company} directly.`}</p>
        {view.memo ? <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{view.memo}</p> : null}
      </Panel>
    );
  }
  const amount = mode === "full" ? view.requestedCents : parseMoney(other);
  const tips = view.tips;
  // A suggested tip is a share of what's being paid now, rounded to whole dollars. Nothing is chosen until the customer picks.
  const suggested = (percent: number) => Math.max(100, Math.round(((amount ?? view.requestedCents) * percent) / 100 / 100) * 100);
  const tipCents = !tips || tipChoice === "none" ? 0 : tipChoice === "custom" ? (parseMoney(customTip) ?? -1) : suggested(tipChoice);
  const tipInvalid = tipCents < 0 || (tips !== null && tipCents > tips.maxCents);
  const invalid = amount === null || amount < view.minCents || amount > view.requestedCents || tipInvalid;
  return (
    <Panel>
      <p className="text-sm font-semibold text-strong">Pay by card or bank</p>
      {view.allowPartial ? (
        <div role="radiogroup" aria-label="How much to pay" className="mt-3 grid gap-2">
          <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-sm", mode === "full" ? "border-brand-500/60 bg-brand-500/6" : "border-border")}>
            <span className="flex items-center gap-2.5">
              <input type="radio" checked={mode === "full"} onChange={() => setMode("full")} className="size-4 accent-brand-500" />
              Pay the full amount
            </span>
            <span className="font-medium tabular-nums">{usd(view.requestedCents)}</span>
          </label>
          <label className={cn("flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-sm", mode === "other" ? "border-brand-500/60 bg-brand-500/6" : "border-border")}>
            <span className="flex items-center gap-2.5">
              <input type="radio" checked={mode === "other"} onChange={() => setMode("other")} className="size-4 accent-brand-500" />
              Pay part of it
            </span>
            {mode === "other" ? (
              <span className="relative">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground">$</span>
                <input aria-label="Amount to pay" inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} className="h-9 w-32 rounded-lg border border-border bg-card pr-2.5 pl-6 text-right tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500/40" />
              </span>
            ) : null}
          </label>
        </div>
      ) : null}
      {tips ? (
        <fieldset className="mt-4 grid gap-2">
          <legend className="text-sm font-medium text-strong">Add a tip for your crew?</legend>
          <p className="-mt-1 text-xs text-muted-foreground">All of it goes to {crewWords(tips.crew)}, who cleaned for you. Optional.</p>
          <div role="radiogroup" aria-label="Tip" className="grid grid-cols-5 gap-1.5">
            {(["none", 15, 20, 25, "custom"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={tipChoice === choice}
                onClick={() => setTipChoice(choice)}
                className={cn("grid min-h-12 place-items-center rounded-xl border px-1 text-sm leading-tight focus-visible:outline-2 focus-visible:outline-brand-500", tipChoice === choice ? "border-brand-500/60 bg-brand-500/6 font-semibold text-strong" : "border-border text-muted-foreground")}
              >
                {choice === "none" ? "No tip" : choice === "custom" ? "Other" : (
                  <span>
                    {choice}%<span className="block text-[11px] font-normal tabular-nums text-muted-foreground">{usd(suggested(choice))}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          {tipChoice === "custom" ? (
            <span className="relative">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">$</span>
              <input aria-label="Tip amount" inputMode="decimal" autoFocus value={customTip} onChange={(e) => setCustomTip(e.target.value)} placeholder="20.00" className="h-11 w-full rounded-xl border border-border bg-card pr-3 pl-7 tabular-nums focus-visible:outline-2 focus-visible:outline-brand-500/40" />
            </span>
          ) : null}
          {tipInvalid ? <p className="text-xs text-muted-foreground">Enter a tip up to {usd(tips.maxCents)}.</p> : null}
        </fieldset>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-3 rounded-xl border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {problem}
        </p>
      ) : null}
      {tipCents > 0 && amount !== null && !invalid ? (
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Invoice</dt>
          <dd className="text-right tabular-nums text-strong">{usd(amount)}</dd>
          <dt className="text-muted-foreground">Tip for your crew</dt>
          <dd className="text-right tabular-nums text-strong">{usd(tipCents)}</dd>
        </dl>
      ) : null}
      <button
        type="button"
        disabled={busy || invalid}
        onClick={async () => {
          if (amount === null) return;
          setBusy(true);
          setProblem(null);
          try {
            const result = await start({ token, amountCents: amount, clientKey: key, tipCents: tipCents || undefined });
            if (result.paymentId) onStarted(result.paymentId);
            else setProblem(result.problem ?? "That didn't go through. Please try again.");
          } catch (error) {
            setProblem(problemWords(error));
          } finally {
            setBusy(false);
          }
        }}
        className="mt-4 min-h-12 w-full rounded-xl bg-gradient-to-b from-brand-400 via-brand-500 to-brand-700 px-4 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] transition-opacity disabled:opacity-50"
      >
        {busy ? "Preparing secure payment…" : `Continue to pay ${amount !== null && !invalid ? usd(amount + tipCents) : ""}`}
      </button>
      {mode === "other" && invalid ? <p className="mt-2 text-xs text-muted-foreground">Enter between {usd(view.minCents)} and {usd(view.requestedCents)}.</p> : null}
    </Panel>
  );
}

function crewWords(names: string[]): string {
  if (names.length === 0) return "your crew";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const stripes = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string, accountId: string) {
  const id = `${publishableKey}:${accountId}`;
  if (!stripes.has(id)) stripes.set(id, loadStripe(publishableKey, { stripeAccount: accountId }));
  return stripes.get(id)!;
}

function Attempt({ token, paymentId, view, onRestart }: { token: string; paymentId: Id<"payments">; view: View; onRestart: () => void }) {
  const attempt = useQuery(api.pay.attempt, { token, paymentId });
  const publishableKey = attempt?.publishableKey ?? null;
  const accountId = attempt?.accountId ?? null;
  const stripe = useMemo(() => (publishableKey && accountId ? stripeFor(publishableKey, accountId) : null), [publishableKey, accountId]);
  if (attempt === undefined) return <Panel><div className="h-40 animate-pulse rounded-xl bg-muted" /></Panel>;
  if (attempt === null) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">This payment can&apos;t be found on this invoice.</p>
        <button type="button" onClick={onRestart} className="mt-3 text-sm font-medium text-info-foreground underline-offset-4 hover:underline">
          Start again
        </button>
      </Panel>
    );
  }
  if (attempt.status === "succeeded") {
    return (
      <Panel className="border-success/40">
        <p className="text-lg font-semibold text-strong">Payment received. Thank you!</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {usd(attempt.amountCents + attempt.tipCents)} {attempt.methodLabel ? `from your ${attempt.methodLabel}` : ""} reached {view.company}
          {attempt.tipCents ? `, including your ${usd(attempt.tipCents)} tip for the crew` : ""}. A receipt is on its way if they have your email.
        </p>
      </Panel>
    );
  }
  if (attempt.status === "processing") {
    return (
      <Panel>
        <p className="text-lg font-semibold text-strong">Your payment is processing</p>
        <p className="mt-1 text-sm text-muted-foreground">Bank payments can take a few business days to clear. This page updates when it does. You don&apos;t need to pay again.</p>
      </Panel>
    );
  }
  if (attempt.status === "checking" || attempt.preparing) {
    return (
      <Panel>
        <p className="text-sm font-semibold text-strong">{attempt.preparing ? "Preparing a secure payment form…" : "Confirming with the payment processor…"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{attempt.preparing ? "This takes a moment." : "Please don't pay again while this is checked. Nothing will be charged twice."}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-brand-500/70" />
        </div>
      </Panel>
    );
  }
  if (attempt.status === "failed" || attempt.status === "canceled") {
    return (
      <Panel>
        <p className="text-sm font-semibold text-strong">{attempt.status === "failed" ? "That payment didn't go through" : "That payment was stopped"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{attempt.problem ?? "Nothing was charged."}</p>
        <button type="button" onClick={onRestart} className="mt-4 min-h-11 w-full rounded-xl border border-border bg-card px-4 text-sm font-semibold text-strong">
          Try again
        </button>
      </Panel>
    );
  }
  if (!stripe || !attempt.clientSecret) return <Panel><div className="h-40 animate-pulse rounded-xl bg-muted" /></Panel>;
  return (
    <Panel>
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-strong">Payment details</p>
        <p className="text-sm tabular-nums text-strong">
          {usd(attempt.amountCents + attempt.tipCents)}
          {attempt.tipCents ? <span className="block text-right text-xs text-muted-foreground">includes {usd(attempt.tipCents)} tip</span> : null}
        </p>
      </div>
      <Elements stripe={stripe} options={{ clientSecret: attempt.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: "#6838ef", borderRadius: "10px", fontFamily: "Inter, system-ui, sans-serif" } } }}>
        <ConfirmForm token={token} paymentId={paymentId} amountCents={attempt.amountCents + attempt.tipCents} />
      </Elements>
    </Panel>
  );
}

function ConfirmForm({ token, paymentId, amountCents }: { token: string; paymentId: Id<"payments">; amountCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const returned = useMutation(api.pay.returned);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        setProblem(null);
        const url = new URL(window.location.href);
        url.search = `?payment=${paymentId}`;
        const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: url.toString() }, redirect: "if_required" });
        if (result.error) {
          // A card error is shown as Stripe words it; nothing was charged.
          setProblem(result.error.message ?? "The payment didn't go through.");
          setBusy(false);
          return;
        }
        // The page shows what Stripe says next; this only asks for it sooner.
        await returned({ token, paymentId }).catch(() => undefined);
        setBusy(false);
      }}
    >
      <PaymentElement options={{ layout: "tabs" }} />
      {problem ? (
        <p role="alert" className="mt-3 rounded-xl border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {problem}
        </p>
      ) : null}
      <button type="submit" disabled={!stripe || busy} className="mt-5 min-h-12 w-full rounded-xl bg-gradient-to-b from-brand-400 via-brand-500 to-brand-700 px-4 text-base font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] disabled:opacity-50">
        {busy ? "Paying…" : `Pay ${usd(amountCents)}`}
      </button>
    </form>
  );
}

function Details({ view }: { view: View }) {
  return (
    <Panel>
      <details className="group" open={view.lines.length <= 4}>
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-strong">
          What this is for
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
        </summary>
        <ul className="mt-3 divide-y divide-border text-sm">
          {view.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-4 py-2">
              <span className="text-strong">
                {line.description}
                {line.quantity !== 1 ? <span className="block text-xs text-muted-foreground">{line.quantity} × {usd(line.unitCents)}</span> : null}
              </span>
              <span className="tabular-nums text-strong">{usd(line.amountCents)}</span>
            </li>
          ))}
        </ul>
      </details>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t border-border pt-3 text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right tabular-nums">{usd(view.totals.subtotalCents)}</dd>
        {view.totals.discountCents ? (
          <>
            <dt className="text-muted-foreground">Discounts</dt>
            <dd className="text-right tabular-nums">{usd(-view.totals.discountCents)}</dd>
          </>
        ) : null}
        {view.taxRateBps ? (
          <>
            <dt className="text-muted-foreground">{view.taxLabel}</dt>
            <dd className="text-right tabular-nums">{usd(view.totals.taxCents)}</dd>
          </>
        ) : null}
        <dt className="font-medium text-strong">Total</dt>
        <dd className="text-right font-semibold tabular-nums text-strong">{usd(view.totals.totalCents)}</dd>
        {view.credits.map((credit, i) => (
          <div key={i} className="contents">
            <dt className="text-muted-foreground">Credit · {credit.reason}</dt>
            <dd className="text-right tabular-nums">{usd(-credit.amountCents)}</dd>
          </div>
        ))}
        {view.payments.map((p) => (
          <div key={p.id} className="contents">
            <dt className="text-muted-foreground">
              {p.status === "processing" ? "Processing" : "Paid"} {calendarDate(p.on, false)} · {p.method}
            </dt>
            <dd className="text-right tabular-nums">{p.status === "processing" ? "—" : usd(-p.amountCents)}</dd>
          </div>
        ))}
        {view.refundedCents ? (
          <>
            <dt className="text-muted-foreground">Refunded to you</dt>
            <dd className="text-right tabular-nums">{usd(view.refundedCents)}</dd>
          </>
        ) : null}
        <dt className="mt-1 border-t border-border pt-2 font-medium text-strong">Balance</dt>
        <dd className="mt-1 border-t border-border pt-2 text-right font-semibold tabular-nums text-strong">{usd(Math.max(0, view.totals.balanceCents))}</dd>
      </dl>
      {view.memo ? <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">{view.memo}</p> : null}
    </Panel>
  );
}
