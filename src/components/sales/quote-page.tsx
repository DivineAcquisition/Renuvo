"use client";

/**
 * The customer's quote page, opened from a private link with no sign-in. It shows one quote, exactly as
 * it was sent, and lets the customer choose a time, accept it, decline it or ask a question.
 *
 * Accepting is a yes to the price and the scope. It is not a confirmed booking, and the page says so:
 * the booking is confirmed by the company once the time and anything else it needs are in place. A
 * quote that was replaced, withdrawn or has passed its last day says which, and cannot be accepted.
 */
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useId, useState } from "react";

import { problemWords } from "@/components/cleaner/shell";
import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import { QuotePreview } from "./quote-preview";

type View = NonNullable<FunctionReturnType<typeof api.quotePage.view>>;

const control =
  "block w-full min-h-12 rounded-xl border border-border bg-card px-3.5 py-2.5 text-base text-strong placeholder:text-muted-foreground/70 focus-visible:border-brand-500/60 focus-visible:outline-2 focus-visible:outline-brand-500/30 disabled:opacity-60";
const primary = "min-h-12 w-full rounded-xl bg-brand-500 px-4 text-base font-semibold text-white shadow-[0_10px_28px_-14px_var(--color-brand-500)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-60";
const quiet = "min-h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-strong focus-visible:outline-2 focus-visible:outline-brand-500 disabled:opacity-60";

function Shell({ company, children }: { company: string | null; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-muted/50">
      <div className="h-36 bg-[radial-gradient(140%_120%_at_10%_0%,color-mix(in_oklab,var(--color-brand-500)_28%,transparent),transparent_70%)]" aria-hidden />
      <div className="mx-auto -mt-28 grid w-full max-w-xl gap-4 px-4 pb-16">
        <header className="px-1">
          <p className="truncate text-sm font-semibold text-strong">{company ?? "Your quote"}</p>
        </header>
        {children}
      </div>
    </main>
  );
}

function Panel({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "good" | "warn" | "plain" }) {
  return <section className={cn("rounded-3xl border bg-card p-5 shadow-[0_24px_60px_-32px_rgba(27,14,69,0.35)] sm:p-6", tone === "good" ? "border-success/40" : tone === "warn" ? "border-warning/40" : "border-border", className)}>{children}</section>;
}

function Label({ id, children, optional }: { id: string; children: React.ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={id} className="text-sm font-medium text-strong">
      {children}
      {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
    </label>
  );
}

const day = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", month: "long", day: "numeric" }).format(new Date(at));
const time = (at: number, timezone: string) => new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(at));
const slotWords = (slot: { startsAt: number; endsAt: number }, timezone: string) => `${day(slot.startsAt, timezone)}, ${time(slot.startsAt, timezone)} to ${time(slot.endsAt, timezone)}`;

function Accept({ token, view }: { token: string; view: View }) {
  const accept = useMutation(api.quotePage.accept);
  const id = useId();
  const [name, setName] = useState(view.customerName && !/^[+\d]|@/.test(view.customerName) ? view.customerName : "");
  const [slot, setSlot] = useState<number | null>(null);
  const [address, setAddress] = useState({ line1: "", city: "", region: "", postalCode: "" });
  const [access, setAccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const tz = view.company.timezone;
  const addressDone = !view.needsAddress || (address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim());

  const submit = async () => {
    setProblem(null);
    if (name.trim().length < 2) return setProblem("Type your full name to accept.");
    if (!addressDone) return setProblem("Enter the address where the service will be.");
    setBusy(true);
    try {
      const result = await accept({ token, hash: view.quote.hash ?? "", name, ...(slot !== null ? { startsAt: slot } : {}), ...(view.needsAddress ? { address } : {}), ...(access.trim() ? { access } : {}) });
      if (result.status !== "accepted") setProblem(result.message);
      else if (result.time === "not_open") setNote("Your acceptance is in. The time you chose was just taken, so choose another below.");
    } catch (error) {
      setProblem(problemWords(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="text-lg font-semibold text-strong">Accept this quote</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Accepting says yes to this price and what it covers. Your visit is confirmed separately: {view.company.name} will tell you once the time is set and everything is in place.</p>
      <div className="mt-4 grid gap-4">
        {view.needsAddress ? (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold text-strong">Where is the service?</legend>
            <div className="grid gap-1.5">
              <Label id={`${id}-line1`}>Street address</Label>
              <input id={`${id}-line1`} autoComplete="address-line1" value={address.line1} onChange={(event) => setAddress({ ...address, line1: event.target.value })} disabled={busy} className={control} />
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem]">
              <div className="grid gap-1.5">
                <Label id={`${id}-city`}>City</Label>
                <input id={`${id}-city`} autoComplete="address-level2" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} disabled={busy} className={control} />
              </div>
              <div className="grid gap-1.5">
                <Label id={`${id}-region`}>State</Label>
                <input id={`${id}-region`} autoComplete="address-level1" value={address.region} onChange={(event) => setAddress({ ...address, region: event.target.value })} disabled={busy} className={control} />
              </div>
              <div className="grid gap-1.5">
                <Label id={`${id}-zip`}>ZIP</Label>
                <input id={`${id}-zip`} autoComplete="postal-code" value={address.postalCode} onChange={(event) => setAddress({ ...address, postalCode: event.target.value })} disabled={busy} className={control} />
              </div>
            </div>
          </fieldset>
        ) : null}
        <div className="grid gap-1.5">
          <Label id={`${id}-access`} optional>
            How will our team get in?
          </Label>
          <input id={`${id}-access`} value={access} onChange={(event) => setAccess(event.target.value)} placeholder="Someone will be home, a key, a door code" disabled={busy} className={control} />
        </div>
        {view.times.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-strong">
              Choose a time <span className="font-normal text-muted-foreground">(optional)</span>
            </legend>
            <p className="text-xs text-muted-foreground">These times are open right now. The time is held when your booking is requested, and confirmed when we tell you.</p>
            <div className="grid gap-2">
              {view.times.map((option) => (
                <label key={option.startsAt} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-brand-500", slot === option.startsAt ? "border-brand-500 bg-brand-500/5 text-strong" : "border-border bg-card text-strong")}>
                  <input type="radio" name={`${id}-slot`} checked={slot === option.startsAt} onChange={() => setSlot(option.startsAt)} disabled={busy} className="size-4 accent-[var(--color-brand-500)]" />
                  {slotWords(option, tz)}
                </label>
              ))}
              <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-brand-500", slot === null ? "border-brand-500 bg-brand-500/5 text-strong" : "border-border bg-card text-strong")}>
                <input type="radio" name={`${id}-slot`} checked={slot === null} onChange={() => setSlot(null)} disabled={busy} className="size-4 accent-[var(--color-brand-500)]" />
                None of these. Contact me to set a time.
              </label>
            </div>
          </fieldset>
        ) : (
          <p className="rounded-xl bg-muted/50 px-3.5 py-3 text-sm text-muted-foreground">After you accept, {view.company.name} will contact you to set the time.</p>
        )}
        <div className="grid gap-1.5">
          <Label id={`${id}-name`}>Type your full name to accept</Label>
          <input id={`${id}-name`} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} className={control} />
        </div>
        {problem ? (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-3.5 py-3 text-sm text-destructive-foreground">
            {problem}
          </p>
        ) : null}
        {note ? (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm text-warning-foreground">
            {note}
          </p>
        ) : null}
        <button type="button" onClick={() => void submit()} disabled={busy} className={primary}>
          {busy ? "Sending…" : "Accept the quote"}
        </button>
      </div>
    </Panel>
  );
}

/** After accepting: choose the time, or add the address and how to get in, until the booking holds a time. */
function Finish({ token, view }: { token: string; view: View }) {
  const finish = useMutation(api.quotePage.finish);
  const id = useId();
  const [slot, setSlot] = useState<number | null>(view.chosen?.startsAt ?? null);
  const [address, setAddress] = useState({ line1: "", city: "", region: "", postalCode: "" });
  const [access, setAccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);
  const tz = view.company.timezone;
  const submit = async () => {
    setBusy(true);
    setAnswer(null);
    try {
      const addressGiven = address.line1.trim() && address.city.trim() && address.region.trim() && address.postalCode.trim();
      setAnswer(await finish({ token, ...(slot !== null && slot !== view.chosen?.startsAt ? { startsAt: slot } : {}), ...(view.needsAddress && addressGiven ? { address } : {}), ...(access.trim() ? { access } : {}) }));
    } catch (error) {
      setAnswer({ ok: false, message: problemWords(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel>
      <h2 className="text-lg font-semibold text-strong">Finish your booking</h2>
      <div className="mt-4 grid gap-4">
        {view.needsAddress ? (
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-semibold text-strong">Where is the service?</legend>
            <input aria-label="Street address" autoComplete="address-line1" placeholder="Street address" value={address.line1} onChange={(event) => setAddress({ ...address, line1: event.target.value })} disabled={busy} className={control} />
            <div className="grid gap-3 sm:grid-cols-[1fr_6rem_8rem]">
              <input aria-label="City" autoComplete="address-level2" placeholder="City" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} disabled={busy} className={control} />
              <input aria-label="State" autoComplete="address-level1" placeholder="State" value={address.region} onChange={(event) => setAddress({ ...address, region: event.target.value })} disabled={busy} className={control} />
              <input aria-label="ZIP" autoComplete="postal-code" placeholder="ZIP" value={address.postalCode} onChange={(event) => setAddress({ ...address, postalCode: event.target.value })} disabled={busy} className={control} />
            </div>
          </fieldset>
        ) : null}
        {view.needsAccess ? (
          <div className="grid gap-1.5">
            <Label id={`${id}-access`}>How will our team get in?</Label>
            <input id={`${id}-access`} value={access} onChange={(event) => setAccess(event.target.value)} placeholder="Someone will be home, a key, a door code" disabled={busy} className={control} />
          </div>
        ) : null}
        {view.times.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-strong">Choose a time</legend>
            {view.times.map((option) => (
              <label key={option.startsAt} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm has-focus-visible:outline-2 has-focus-visible:outline-brand-500", slot === option.startsAt ? "border-brand-500 bg-brand-500/5 text-strong" : "border-border bg-card text-strong")}>
                <input type="radio" name={`${id}-slot`} checked={slot === option.startsAt} onChange={() => setSlot(option.startsAt)} disabled={busy} className="size-4 accent-[var(--color-brand-500)]" />
                {slotWords(option, tz)}
              </label>
            ))}
          </fieldset>
        ) : null}
        {answer ? (
          <p role={answer.ok ? "status" : "alert"} className={cn("rounded-xl px-3.5 py-3 text-sm", answer.ok ? "bg-success/10 text-strong" : "border border-destructive/30 bg-destructive/5 text-destructive-foreground")}>
            {answer.message}
          </p>
        ) : null}
        <button type="button" onClick={() => void submit()} disabled={busy} className={primary}>
          {busy ? "Sending…" : "Save"}
        </button>
      </div>
    </Panel>
  );
}

function AskOrDecline({ token, view }: { token: string; view: View }) {
  const ask = useMutation(api.quotePage.ask);
  const decline = useMutation(api.quotePage.decline);
  const id = useId();
  const [mode, setMode] = useState<"ask" | "decline" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ ok: boolean; message: string } | null>(null);
  const open = view.state === "open";

  const send = async () => {
    setBusy(true);
    setAnswer(null);
    try {
      const result = mode === "decline" ? await decline({ token, ...(text.trim() ? { reason: text } : {}) }) : await ask({ token, question: text });
      setAnswer(result);
      if (result.ok) {
        setText("");
        setMode(null);
      }
    } catch (error) {
      setAnswer({ ok: false, message: problemWords(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="text-base font-semibold text-strong">{open ? "Not ready to accept?" : "Have a question?"}</h2>
      {view.asked ? (
        <p className="mt-2 rounded-xl bg-muted/50 px-3.5 py-3 text-sm text-strong" role="status">
          You asked: “{view.asked.text}” <span className="block text-xs text-muted-foreground">{view.company.name} has your question and will reply.</span>
        </p>
      ) : null}
      {answer ? (
        <p role={answer.ok ? "status" : "alert"} className={cn("mt-2 rounded-xl px-3.5 py-3 text-sm", answer.ok ? "bg-success/10 text-strong" : "border border-destructive/30 bg-destructive/5 text-destructive-foreground")}>
          {answer.message}
        </p>
      ) : null}
      {mode === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={quiet} onClick={() => setMode("ask")}>
            Ask a question
          </button>
          {open ? (
            <button type="button" className={quiet} onClick={() => setMode("decline")}>
              Decline the quote
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          <Label id={`${id}-text`} optional={mode === "decline"}>
            {mode === "ask" ? "Your question" : "Would you tell us why?"}
          </Label>
          <textarea id={`${id}-text`} rows={3} value={text} onChange={(event) => setText(event.target.value)} disabled={busy} className={cn(control, "min-h-24")} />
          {mode === "decline" ? <p className="text-xs text-muted-foreground">Declining closes this quote. You won’t get reminders about it.</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={cn(quiet, mode === "ask" ? "border-brand-500 bg-brand-500 text-white" : "")} disabled={busy || (mode === "ask" && text.trim().length < 3)} onClick={() => void send()}>
              {busy ? "Sending…" : mode === "ask" ? "Send my question" : "Decline the quote"}
            </button>
            <button type="button" className={quiet} disabled={busy} onClick={() => (setMode(null), setText(""))}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {view.company.phone || view.company.email ? (
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
          You can also reach {view.company.name} at {[view.company.phone, view.company.email].filter(Boolean).join(" or ")}.
        </p>
      ) : null}
    </Panel>
  );
}

export function QuotePage({ token }: { token: string }) {
  const view = useQuery(api.quotePage.view, { token });

  if (view === undefined) {
    return (
      <Shell company={null}>
        <div aria-busy="true" aria-label="Loading your quote" className="grid gap-3">
          <div className="h-64 animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" />
          <div className="h-40 animate-pulse rounded-3xl bg-muted motion-reduce:animate-none" />
        </div>
      </Shell>
    );
  }
  if (view === null) {
    return (
      <Shell company={null}>
        <Panel>
          <h1 className="text-lg font-semibold text-strong">This link doesn’t open a quote</h1>
          <p className="mt-1 text-sm text-muted-foreground">It may be incomplete. Check the link you were sent, or contact the business that sent it.</p>
        </Panel>
      </Shell>
    );
  }
  const tz = view.company.timezone;
  const first = view.customerName && !/^[+\d]|@/.test(view.customerName) ? view.customerName.split(" ")[0] : null;
  return (
    <Shell company={view.company.name}>
      <h1 className="sr-only">Your quote from {view.company.name}</h1>
      {view.state === "accepted" && view.quote.acceptance ? (
        <Panel tone="good">
          <p className="text-lg font-semibold text-strong" role="status">
            {view.booking?.status === "confirmed" ? "You’re booked" : "Thanks, your acceptance is in"}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {view.quote.acceptance.name} accepted this quote on {day(view.quote.acceptance.at, tz)}.{" "}
            {view.booking?.status === "confirmed"
              ? `Your visit is confirmed for ${day(view.booking.startsAt, tz)} at ${time(view.booking.startsAt, tz)}.`
              : view.booking
                ? `We’re holding ${day(view.booking.startsAt, tz)} at ${time(view.booking.startsAt, tz)} for you. It is confirmed once everything ${view.company.name} asked for is done.`
                : view.chosen
                  ? `You asked for ${slotWords(view.chosen, tz)}. ${view.company.name} is booking it now and will confirm.`
                  : "Choose a time below so we can book your visit."}
          </p>
        </Panel>
      ) : view.state === "declined" ? (
        <Panel>
          <p className="text-lg font-semibold text-strong" role="status">
            You declined this quote
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Nothing more will be sent about it. If you change your mind, contact {view.company.name} for a new one.</p>
        </Panel>
      ) : view.state === "expired" ? (
        <Panel tone="warn">
          <p className="text-lg font-semibold text-strong" role="status">
            This quote has expired
          </p>
          <p className="mt-1 text-sm text-muted-foreground">Its last day has passed, so it can no longer be accepted. Ask {view.company.name} for a fresh quote: prices and open times may have changed.</p>
        </Panel>
      ) : view.state === "withdrawn" || view.state === "superseded" ? (
        <Panel tone="warn">
          <p className="text-lg font-semibold text-strong" role="status">
            {view.state === "superseded" ? "This quote was replaced" : "This quote was withdrawn"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{view.state === "superseded" ? `${view.company.name} sent a newer quote. Use the link in their latest message.` : `${view.company.name} withdrew it, so it can no longer be accepted. Contact them for a new one.`}</p>
        </Panel>
      ) : (
        <div className="px-1">
          <p className="font-heading text-2xl tracking-tight text-strong">{first ? `Hi ${first}, here is your quote` : "Here is your quote"}</p>
        </div>
      )}

      <QuotePreview quote={view.quote} company={view.company.name} timezone={tz} className="rounded-3xl shadow-[0_24px_60px_-32px_rgba(27,14,69,0.35)]" />

      {view.state === "open" ? <Accept token={token} view={view} /> : null}
      {view.state === "accepted" && !view.booking && (view.times.length > 0 || view.needsAddress || view.needsAccess) ? <Finish token={token} view={view} /> : null}
      {view.state !== "withdrawn" && view.state !== "superseded" ? <AskOrDecline token={token} view={view} /> : null}
      <p className="px-2 text-center text-xs text-muted-foreground">This page is private to you. Anyone with the link can see this quote, so share it with care.</p>
    </Shell>
  );
}
