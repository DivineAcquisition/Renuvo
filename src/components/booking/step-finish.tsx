"use client";

/**
 * Property details and the agreement, checkout, and confirmation: the reference's last three screens.
 * Checkout is one centered column of stacked cards; payment is the company's own Stripe account; and
 * the confirmation says exactly which state the booking is in, never more.
 */
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { ArrowLeft, Bank, CalendarBlank, CalendarCheck, CheckCircle, Clock, Envelope, House, Lock, MapPin, PencilSimple, Receipt, ShieldCheck, Sparkle, Star, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CustomQuestion } from "../../../convex/lib/booking/definition";
import { copyOf, sectionOn, useBooking } from "./context";
import { BottomBar, Editable, Field, Notice, Pill, StepHeading } from "./parts";
import { Faqs } from "./step-service";
import { TrustRow } from "./step-start";
import { moneyExact } from "./theme";
import { SelectInput } from "@/components/app/form";
import { Checkbox } from "@/components/ui/selection";

// ── Details and agreement ────────────────────────────────────────────────────────────────────────

function QuestionInput({ q, value, onChange }: { q: CustomQuestion; value: unknown; onChange: (v: string | number | boolean | string[] | undefined) => void }) {
  const id = `bk-q-${q.id}`;
  const chip = (active: boolean) => cn("rounded-lg border px-3 py-2 text-sm", active ? "border-[var(--bk-brand)] bg-[rgb(var(--bk-brand-rgb)/0.1)] font-medium text-[color:var(--bk-brand-text)]" : "border-[color:var(--bk-hairline)] hover:border-[rgb(var(--bk-brand-rgb)/0.4)]");
  return (
    <Field id={id} label={q.label} required={q.required} help={q.help}>
      {q.type === "long_text" ? (
        <textarea id={id} className="bk-input resize-none" maxLength={q.max} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : q.type === "short_text" ? (
        <input id={id} className="bk-input" maxLength={q.max} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : q.type === "number" ? (
        <input id={id} className="bk-input" inputMode="numeric" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value.replace(/\D/g, "")))} />
      ) : q.type === "date" ? (
        <input id={id} type="date" className="bk-input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : q.type === "yes_no" ? (
        <div id={id} role="radiogroup" className="flex gap-2">
          {[true, false].map((b) => (
            <button key={String(b)} type="button" role="radio" aria-checked={value === b} className={chip(value === b)} onClick={() => onChange(b)}>
              {b ? "Yes" : "No"}
            </button>
          ))}
        </div>
      ) : q.type === "choice" ? (
        <SelectInput id={id} className="bk-input" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">Choose…</option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectInput>
      ) : (
        <div id={id} className="flex flex-wrap gap-2">
          {q.options.map((o) => {
            const list = (value as string[]) ?? [];
            const on = list.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} className={chip(on)} onClick={() => onChange(on ? list.filter((x) => x !== o) : [...list, o])}>
                {o}
              </button>
            );
          })}
        </div>
      )}
    </Field>
  );
}

/** Draws with a finger or mouse; keeps the strokes as an SVG path. Typing the name is always enough. */
function SignaturePad({ onChange }: { onChange: (path: string | undefined) => void }) {
  const ref = useRef<SVGSVGElement>(null);
  const [path, setPath] = useState("");
  const drawing = useRef(false);
  const point = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    return `${Math.round(((e.clientX - box.left) / box.width) * 400)} ${Math.round(((e.clientY - box.top) / box.height) * 120)}`;
  };
  return (
    <div>
      <svg
        ref={ref}
        viewBox="0 0 400 120"
        role="img"
        aria-label="Signature drawing area (optional)"
        className="h-28 w-full touch-none rounded-lg border border-dashed border-[color:var(--bk-hairline)] bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setPath((p) => `${p} M ${point(e)}`);
        }}
        onPointerMove={(e) => drawing.current && setPath((p) => `${p} L ${point(e)}`)}
        onPointerUp={() => {
          drawing.current = false;
          onChange(path.trim() || undefined);
        }}
      >
        <path d={path} fill="none" stroke="#0b0a11" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {path ? (
        <button
          type="button"
          className="mt-1 text-xs text-[color:var(--bk-muted-text)] underline"
          onClick={() => {
            setPath("");
            onChange(undefined);
          }}
        >
          Clear drawing
        </button>
      ) : null}
    </div>
  );
}

function Agreement() {
  const { view, actions } = useBooking();
  const agreement = view?.agreement;
  const [name, setName] = useState(view?.contact ? `${view.contact.firstName} ${view.contact.lastName}` : "");
  const [drawn, setDrawn] = useState<string | undefined>(undefined);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!agreement) return null;
  return (
    <Editable id="agreement" label="the agreement" className="space-y-4 border-t border-[color:var(--bk-hairline)] pt-6 text-left">
      <div className="flex items-center gap-2">
        <Sparkle className="h-5 w-5 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
        <h3 className="text-base font-semibold @3xl:text-lg">Sign your service agreement</h3>
      </div>
      {agreement.accepted ? (
        <Notice tone="good" title={`Signed by ${agreement.signerName}`}>
          A copy of exactly what you signed is kept with your booking.
        </Notice>
      ) : agreement.markdown ? (
        <>
          <div tabIndex={0} aria-label={agreement.title} className="max-h-64 overflow-y-auto rounded-lg border border-[color:var(--bk-hairline)] bg-[var(--bk-muted)] p-4 text-[13px] leading-relaxed">
            {agreement.markdown.split("\n").map((line, i) =>
              line.startsWith("# ") ? (
                <p key={i} className="mb-2 text-base font-semibold">
                  {line.slice(2)}
                </p>
              ) : line.startsWith("## ") ? (
                <p key={i} className="mt-3 font-semibold">
                  {line.slice(3)}
                </p>
              ) : line ? (
                <p key={i} className="mt-1">
                  {line}
                </p>
              ) : null,
            )}
          </div>
          <Field id="bk-sign-name" label="Type your full name to sign" required>
            <input id="bk-sign-name" className="bk-input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Draw your signature (optional)</p>
            <SignaturePad onChange={setDrawn} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox className="mt-1" checked={agreed} onCheckedChange={(checked) => setAgreed(checked)} />
            <span>I have read and agree to the {agreement.title}.</span>
          </label>
          {error ? <Notice tone="bad" title={error} /> : null}
          <button
            type="button"
            disabled={!agreed || name.trim().split(/\s+/).length < 2 || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const result = await actions.sign(name.trim(), drawn, agreement.hash!);
              setBusy(false);
              if (!result.ok) setError(result.why);
            }}
            className="bk-btn h-11 w-full"
          >
            {busy ? "Signing…" : "Sign agreement"}
          </button>
        </>
      ) : (
        <Notice tone="info" title="The agreement appears once your details are saved." />
      )}
    </Editable>
  );
}

export function DetailsStep() {
  const { def, view, actions, next, back } = useBooking();
  const copy = copyOf(def, "details").copy;
  const [address, setAddress] = useState({ line1: view?.address?.line1 ?? "", line2: view?.address?.line2 ?? "", city: view?.address?.city ?? "", region: view?.address?.region ?? "", postalCode: view?.address?.postalCode ?? view?.postalCode ?? "" });
  const [answers, setAnswers] = useState<Record<string, string | number | boolean | string[]>>(() => ({ ...(view?.answers ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!view) return null;
  const questions = view.questions.filter((q) => !q.showIf || (q.showIf.kind === "answer_equals" ? String(answers[q.showIf.questionId]) === q.showIf.value : true));
  const missing = questions.filter((q) => q.required && (answers[q.id] === undefined || answers[q.id] === "") && !(q.purpose === "access" && view.accessSaved));
  const ready = address.line1.trim() && address.city.trim() && address.region.trim() && missing.length === 0;
  const agreementPending = Boolean(view.agreement && !view.agreement.accepted);
  const save = async () => {
    setBusy(true);
    setError(null);
    const clean: Record<string, string | number | boolean | string[]> = {};
    for (const [k, value] of Object.entries(answers)) if (value !== undefined && value !== "") clean[k] = value;
    const result = await actions.setDetails({ line1: address.line1, ...(address.line2.trim() ? { line2: address.line2 } : {}), city: address.city, region: address.region, postalCode: address.postalCode }, clean);
    setBusy(false);
    if (!result.ok) return setError(result.why);
    if (!view.agreement || view.agreement.accepted) next();
  };
  return (
    <div className="flex flex-1 items-start justify-center px-3 py-8 @3xl:px-4 @3xl:py-12">
      <div className="bk-card w-full max-w-lg overflow-hidden">
        <div className="h-1.5 w-full bk-solid" />
        <div className="space-y-3 px-5 pb-4 pt-6 text-center @3xl:px-6">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[rgb(var(--bk-brand-rgb)/0.1)]">
            <House className="h-7 w-7 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
          </div>
          <Editable id="copy:details" label="the heading">
            <h1 data-editable-text className="text-lg font-semibold tracking-tight @3xl:text-xl">{copy.title}</h1>
            <p data-editable-text className="mx-auto max-w-sm text-sm text-[color:var(--bk-muted-text)]">{view.payment.state === "succeeded" ? "Your payment is received. Add these details to finish your booking." : copy.subtitle}</p>
          </Editable>
        </div>
        <form
          className="space-y-6 px-5 pb-6 @3xl:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="space-y-4 text-left">
            <h3 className="text-base font-semibold @3xl:text-lg">Service address</h3>
            <Field id="bk-line1" label="Street address" required>
              <input id="bk-line1" className="bk-input" autoComplete="address-line1" value={address.line1} onChange={(e) => setAddress({ ...address, line1: e.target.value })} />
            </Field>
            <Field id="bk-line2" label="Apartment, suite or unit">
              <input id="bk-line2" className="bk-input" autoComplete="address-line2" value={address.line2} onChange={(e) => setAddress({ ...address, line2: e.target.value })} />
            </Field>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-3">
              <Field id="bk-city" label="City" required>
                <input id="bk-city" className="bk-input" autoComplete="address-level2" value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
              </Field>
              <Field id="bk-state" label="State" required>
                <input id="bk-state" className="bk-input" autoComplete="address-level1" maxLength={40} value={address.region} onChange={(e) => setAddress({ ...address, region: e.target.value })} />
              </Field>
              <Field id="bk-postal" label="ZIP code">
                <input id="bk-postal" className="bk-input bg-[var(--bk-muted)]" readOnly value={address.postalCode} />
              </Field>
            </div>
          </div>
          {questions.length ? (
            <Editable id="questions" label="your questions" className="space-y-4 border-t border-[color:var(--bk-hairline)] pt-6 text-left">
              <h3 className="text-base font-semibold @3xl:text-lg">About the property</h3>
              {questions.map((q) => (
                <QuestionInput key={q.id} q={q} value={answers[q.id]} onChange={(value) => setAnswers((all) => ({ ...all, [q.id]: value as never }))} />
              ))}
              {view.accessSaved ? <p className="text-xs text-[color:var(--bk-muted-text)]">Access details are saved and shown only to your assigned team. Enter them again to replace them.</p> : null}
            </Editable>
          ) : null}
          {error ? <Notice tone="bad" title={error} /> : null}
          <button type="submit" disabled={!ready || busy} className="bk-btn h-12 w-full text-base @3xl:h-14">
            {busy ? "Saving…" : view.agreement && !view.agreement.accepted ? "Save details" : copy.button || "Continue"}
          </button>
          {view.address ? <Agreement /> : null}
          {view.address && !agreementPending && view.states.answers === "complete" ? (
            <button type="button" onClick={next} className="bk-btn-outline h-11 w-full">
              Continue to checkout
            </button>
          ) : null}
        </form>
      </div>
      <BottomBar onBack={back ?? undefined} continueLabel="Continue" />
    </div>
  );
}

// ── Checkout ─────────────────────────────────────────────────────────────────────────────────────

const stripes = new Map<string, Promise<Stripe | null>>();
function stripeFor(publishableKey: string, accountId: string) {
  const id = `${publishableKey}:${accountId}`;
  if (!stripes.has(id)) stripes.set(id, loadStripe(publishableKey, { stripeAccount: accountId }));
  return stripes.get(id)!;
}

function PayForm({ paymentId, amountCents }: { paymentId: string; amountCents: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const { actions } = useBooking();
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
          setProblem(result.error.message ?? "The payment didn't go through. Nothing was charged.");
          setBusy(false);
          return;
        }
        // Asks Stripe sooner; the booking moves only on Stripe's own answer.
        await actions.paymentReturned(paymentId);
        setBusy(false);
      }}
      className="space-y-4"
    >
      <div className="rounded-lg border border-[color:var(--bk-hairline)] bg-white p-4">
        <PaymentElement options={{ layout: "tabs" }} />
      </div>
      {problem ? <Notice tone="bad" title={problem} /> : null}
      <button type="submit" disabled={!stripe || busy} className="bk-btn h-14 w-full text-lg">
        {busy ? "Paying…" : `Pay ${moneyExact(amountCents)}`}
      </button>
    </form>
  );
}

function Payment() {
  const { token, view, actions } = useBooking();
  const [paymentId, setPaymentId] = useState<string | null>(view?.payment.paymentId && (view.payment.state === "started" || view.payment.state === "processing") ? view.payment.paymentId : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useQuery(api.bookingSessions.paymentAttempt, token && paymentId ? { token, paymentId: paymentId as Id<"payments"> } : "skip");
  const publishableKey = attempt?.publishableKey ?? null;
  const accountId = attempt?.accountId ?? null;
  const stripe = useMemo(() => (publishableKey && accountId ? stripeFor(publishableKey, accountId) : null), [publishableKey, accountId]);
  useEffect(() => {
    if (!paymentId || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("redirect_status")) void actions.paymentReturned(paymentId);
  }, [paymentId, actions]);
  if (!view) return null;
  const ready = view.blockers.every((b) => b === "The payment hasn't been received.");
  if (view.test) {
    return (
      <div className="space-y-3">
        <Notice tone="warn" title="Test booking">
          Nothing is charged. This shows the payment step and lets you finish the flow.
        </Notice>
        <button type="button" disabled={!ready || busy} onClick={async () => { setBusy(true); const r = await actions.simulatePayment(); setBusy(false); if (!r.ok) setError(r.why); }} className="bk-btn h-14 w-full text-lg">
          Simulate paying {moneyExact(view.quote?.dueNowCents ?? 0)}
        </button>
        {error ? <Notice tone="bad" title={error} /> : null}
      </div>
    );
  }
  if (!view.payment.canPayByCard) return <Notice tone="warn" title="Online payment isn't available right now">Please contact the company to finish your booking.</Notice>;
  if (!paymentId || attempt?.status === "failed" || attempt?.status === "canceled") {
    return (
      <div className="space-y-3">
        {attempt?.status === "failed" || attempt?.status === "canceled" ? <Notice tone="bad" title="That payment didn't go through">{attempt.problem ?? "Nothing was charged. You can try again."}</Notice> : null}
        {!ready ? <Notice tone="info" title="Before paying">{view.blockers.filter((b) => b !== "The payment hasn't been received.").join(" ")}</Notice> : null}
        {error ? <Notice tone="bad" title={error} /> : null}
        <button
          type="button"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const r = await actions.startPayment();
            setBusy(false);
            if (!r.ok) setError(r.why);
            else if (r.paymentId) setPaymentId(r.paymentId);
          }}
          className="bk-btn h-14 w-full text-lg"
        >
          {busy ? "Preparing…" : `Continue to pay ${moneyExact(view.quote?.dueNowCents ?? 0)}`}
        </button>
      </div>
    );
  }
  if (attempt === undefined || attempt?.preparing || attempt?.status === "checking") {
    return (
      <div className="space-y-3 py-2" aria-busy="true">
        <div className="h-12 animate-pulse rounded-lg bg-[var(--bk-muted)] motion-reduce:animate-none" />
        <div className="h-12 animate-pulse rounded-lg bg-[var(--bk-muted)] motion-reduce:animate-none" />
        <p className="text-center text-sm text-[color:var(--bk-muted-text)]">Preparing a secure payment form…</p>
      </div>
    );
  }
  if (attempt?.status === "processing") return <Notice tone="info" title="Your payment is processing">This page updates when it clears. You don&apos;t need to pay again.</Notice>;
  if (attempt?.status === "succeeded") return <Notice tone="good" title="Payment received">Finishing your booking…</Notice>;
  if (!stripe || !attempt?.clientSecret) return <div className="h-40 animate-pulse rounded-lg bg-[var(--bk-muted)] motion-reduce:animate-none" />;
  return (
    <Elements stripe={stripe} options={{ clientSecret: attempt.clientSecret, appearance: { theme: "stripe", variables: { colorPrimary: getComputedStyle(document.documentElement).getPropertyValue("--bk-brand") || "#6838ef", borderRadius: "10px" } } }}>
      <PayForm paymentId={paymentId} amountCents={attempt.amountCents} />
    </Elements>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="flex items-center gap-1.5 text-[color:var(--bk-muted-text)]">
        {icon}
        {label}
      </span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function NextSteps({ title = "What happens next" }: { title?: string }) {
  const { def } = useBooking();
  return (
    <Editable id="section:next_steps" label="next steps" className="bk-card p-5 text-left @2xl:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--bk-brand-text)]">{title}</p>
      <ol className="mt-5">
        {def.content.nextSteps.map((s, i) => (
          <li key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < def.content.nextSteps.length - 1 ? <span aria-hidden className="absolute left-[17px] top-9 h-[calc(100%-2.25rem)] w-px bg-[rgb(var(--bk-brand-rgb)/0.25)]" /> : null}
            <span className="relative z-[1] grid h-9 w-9 shrink-0 place-items-center rounded-xl bk-solid">
              <CheckCircle className="h-4 w-4" aria-hidden weight="bold" />
            </span>
            <div className="pt-1">
              <p className="text-[14.5px] font-medium">{s.title}</p>
              {s.body ? <p className="mt-0.5 text-[13.5px] leading-relaxed text-[color:var(--bk-muted-text)]">{s.body}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </Editable>
  );
}

export function CheckoutStep() {
  const { def, view, actions, go, back } = useBooking();
  const copy = copyOf(def, "checkout").copy;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holdLeft = useHoldLeft(view?.holdExpiresAt ?? null);
  if (!view) return null;
  const quote = view.quote;
  const offer = view.offers.find((o) => o.serviceKey === quote?.serviceKey);
  const pays = view.payment.required;
  const request = view.request;

  const finish = async () => {
    setBusy(true);
    setError(null);
    const result = request ? await actions.sendRequest() : await actions.confirm();
    setBusy(false);
    if (!result.ok) setError(result.why);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <StepHeading id="copy:checkout" title={copy.title} subtitle={request ? (view.requestWords ?? copy.subtitle) : pays && quote ? `${quote.policyWords}. ${quote.balanceTerms}`.trim() : copy.subtitle} size="lg" />
      {view.states.quote === "changed" && quote?.grandTotalCents !== null && quote ? (
        <Notice tone="warn" title={`The price is now ${moneyExact(quote.grandTotalCents!)}`}>
          Something you changed affects the price. Please accept the new price to continue.
          <button type="button" className="bk-btn mt-3 h-10 w-full" onClick={() => void actions.acceptQuote(quote.inputHash, quote.grandTotalCents!)}>
            Accept {moneyExact(quote.grandTotalCents!)}
          </button>
        </Notice>
      ) : null}
      {view.states.capacity === "expired" && !request ? (
        <Notice tone="warn" title="Your held time ended">
          Please choose a time again.
          <button type="button" className="bk-btn-outline mt-3 h-10 w-full" onClick={() => go("service")}>
            Choose a time
          </button>
        </Notice>
      ) : holdLeft && !request ? (
        <p className="text-center text-xs text-[color:var(--bk-muted-text)]" aria-live="polite">
          Your time is held for {holdLeft}.
        </p>
      ) : null}

      <div className="bk-card p-5">
        <p className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Sparkle className="h-4 w-4 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" /> {request ? "Your request" : "Your booking"}
        </p>
        <div className="space-y-3">
          <Row icon={null} label="Service" value={offer?.name ?? "—"} />
          {quote?.scheduleLabel ? <Row icon={null} label="How often" value={quote.scheduleLabel} /> : null}
          {quote ? <Row icon={<Clock className="h-3.5 w-3.5" aria-hidden />} label="About" value={`${Math.round((quote.elapsedMinutes / 60) * 2) / 2} hours${quote.crew > 1 ? `, ${quote.crew} cleaners` : ""}`} /> : null}
          <hr className="border-[color:var(--bk-hairline)]" />
          {view.schedule ? (
            <>
              <Row icon={<CalendarBlank className="h-3.5 w-3.5" aria-hidden />} label="Date" value={view.schedule.label} />
              <Row icon={<Clock className="h-3.5 w-3.5" aria-hidden />} label="Arrival" value={view.schedule.windowLabel} />
            </>
          ) : null}
          <Row icon={<MapPin className="h-3.5 w-3.5" aria-hidden />} label="Location" value={view.address ? `${view.address.line1}, ${view.address.city}` : `ZIP ${view.postalCode}`} />
        </div>
      </div>

      {quote && quote.grandTotalCents !== null ? (
        <div className="space-y-3 rounded-[var(--bk-radius)] border-2 border-[rgb(var(--bk-brand-rgb)/0.3)] bg-[rgb(var(--bk-brand-rgb)/0.04)] p-4 @3xl:p-5">
          <div className="space-y-2 text-sm" aria-label="Price breakdown">
            {quote.lines.filter((l) => l.kind !== "billed_later").map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-4">
                <span>{line.kind === "base" ? (offer?.name ?? line.label) : line.label}</span>
                <span className="font-medium tabular-nums">{line.amountCents < 0 ? "−" : ""}{moneyExact(Math.abs(line.amountCents))}</span>
              </div>
            ))}
            {quote.taxCents ? (
              <div className="flex items-baseline justify-between">
                <span>{quote.taxLabel ?? "Tax"}</span>
                <span className="font-medium tabular-nums">{moneyExact(quote.taxCents)}</span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between border-t border-[rgb(var(--bk-brand-rgb)/0.15)] pt-2">
              <span className="font-semibold">{request ? "Estimate" : "Total"}</span>
              <span className="font-semibold tabular-nums">{moneyExact(quote.grandTotalCents)}</span>
            </div>
          </div>
          {pays ? (
            <>
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Pill tone="solid">{quote.dueNowCents < quote.grandTotalCents ? "Deposit" : "Paid in full"}</Pill>
                    <span className="text-base font-bold">Pay now</span>
                  </div>
                  <p className="mt-0.5 text-xs text-[color:var(--bk-muted-text)]">Charged when you confirm</p>
                </div>
                <span className="text-2xl font-extrabold tabular-nums text-[color:var(--bk-brand-text)] @3xl:text-3xl">{moneyExact(quote.dueNowCents)}</span>
              </div>
              {quote.balanceCents > 0 ? (
                <div className="flex items-baseline justify-between rounded-md border border-[rgb(var(--bk-brand-rgb)/0.15)] bg-white/60 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold">Remaining balance</div>
                    <p className="mt-0.5 text-xs text-[color:var(--bk-muted-text)]">{quote.balanceTerms || "Due after the visit"}</p>
                  </div>
                  <span className="text-lg font-bold tabular-nums @3xl:text-xl">{moneyExact(quote.balanceCents)}</span>
                </div>
              ) : null}
            </>
          ) : !request ? (
            <p className="text-xs text-[color:var(--bk-muted-text)]">Nothing is charged now. {quote.balanceTerms || "You'll get an invoice after the visit."}</p>
          ) : null}
        </div>
      ) : null}

      {sectionOn(def, "checkout", "included") && offer?.included.length ? (
        <Editable id="section:included" label="what's included" className="bk-card p-5 text-left">
          <p className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Star className="h-4 w-4 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" /> What&apos;s included
          </p>
          <div className="grid gap-1.5 text-sm">
            {offer.included.slice(0, 12).map((item) => (
              <div key={item} className="flex items-start gap-2">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />
                <span className="text-[color:var(--bk-muted-text)]">{item}</span>
              </div>
            ))}
            {offer.excluded.length ? <p className="mt-2 text-xs text-[color:var(--bk-muted-text)]">Not included: {offer.excluded.join("; ")}.</p> : null}
          </div>
        </Editable>
      ) : null}

      {sectionOn(def, "checkout", "next_steps") && def.content.nextSteps.length ? <NextSteps /> : null}
      {sectionOn(def, "checkout", "faq") && def.content.faqs.length ? <Faqs /> : null}

      <Editable id="payment" label="payment" className="bk-card p-5 text-left @2xl:p-6">
        <p className="flex items-center gap-2 text-lg font-semibold">
          {pays ? <Bank className="h-5 w-5 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" /> : <Receipt className="h-5 w-5 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" />}
          {pays ? "Payment details" : request ? "Send your request" : "Confirm your booking"}
        </p>
        <p className="mb-4 mt-1 text-sm text-[color:var(--bk-muted-text)]">{pays && quote ? `Pay ${moneyExact(quote.dueNowCents)} now${quote.balanceCents > 0 ? ` · ${moneyExact(quote.balanceCents)} later` : ""}` : request ? "Nothing is charged." : "Nothing is charged now."}</p>
        {pays ? (
          <Payment />
        ) : (
          <>
            {!request && view.blockers.length ? <Notice tone="info" title="Before confirming">{view.blockers.join(" ")}</Notice> : null}
            {error ? <div className="mt-3"><Notice tone="bad" title={error} /></div> : null}
            <button type="button" disabled={busy || (!request && view.blockers.length > 0)} onClick={() => void finish()} className="bk-btn mt-3 h-14 w-full text-lg">
              {busy ? "Sending…" : copy.button || (request ? "Send request" : "Confirm booking")}
            </button>
          </>
        )}
        <div className="mt-4 flex items-center justify-center gap-4 border-t border-[color:var(--bk-hairline)] pt-4 text-xs text-[color:var(--bk-muted-text)]">
          <span className="flex items-center gap-1">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Private link
          </span>
          {pays ? (
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Card payment by Stripe
            </span>
          ) : null}
        </div>
      </Editable>
      {sectionOn(def, "checkout", "trust") ? <TrustRow /> : null}
      {back ? (
        <div className="hidden @3xl:block">
          <button type="button" onClick={back} className="bk-btn-outline h-10 px-4 text-sm">
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        </div>
      ) : null}
      <BottomBar onBack={back ?? undefined} continueLabel="Pay" priceCents={pays ? quote?.dueNowCents : undefined} priceLabel="Due now" />
    </div>
  );
}

function useHoldLeft(expiresAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt || expiresAt <= now) return null;
  const minutes = Math.max(1, Math.round((expiresAt - now) / 60_000));
  return `${minutes} more minute${minutes === 1 ? "" : "s"}`;
}

// ── Confirmation ─────────────────────────────────────────────────────────────────────────────────

function ics(view: NonNullable<ReturnType<typeof useBooking>["view"]>, company: string): string {
  const start = view.schedule!.startsAt;
  const end = start + ((view.quote?.elapsedMinutes ?? 120) + (view.schedule!.windowMinutes ?? 0)) * 60_000;
  const fmt = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Selestial//Booking//EN", "BEGIN:VEVENT", `UID:${view.confirmation.reference}@selestial`, `DTSTAMP:${fmt(Date.now())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${company} cleaning`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}

export function ConfirmationStep() {
  const { def, view, company, actions } = useBooking();
  const copy = copyOf(def, "confirmation").copy;
  const [access, setAccess] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [change, setChange] = useState("");
  if (!view) return null;
  const status = view.status;
  const confirmed = status === "confirmed";
  const requested = status === "requested";
  const attention = status === "needs_attention";
  const paidWaiting = !confirmed && view.payment.state === "succeeded" && !attention;
  const tone = confirmed ? { pill: "good" as const, label: view.test ? "Test confirmed" : "Confirmed" } : requested ? { pill: "brand" as const, label: "Request received" } : attention ? { pill: "warn" as const, label: "Payment received" } : paidWaiting ? { pill: "warn" as const, label: "Payment received" } : { pill: "muted" as const, label: "In progress" };
  const title = confirmed ? copy.title : requested ? def.content.requestTitle : attention ? "Your payment is received. We're confirming your time." : paidWaiting ? "Your payment is received." : "Almost there.";
  const body = confirmed ? copy.subtitle : requested ? def.content.requestBody : attention ? `${company.name} will contact you shortly to confirm a time. Nothing else is charged.` : paidWaiting ? "Finishing your booking — add any missing details." : "";
  return (
    <div className="px-2 py-4 @3xl:px-4 @3xl:py-12">
      <div className="mx-auto max-w-3xl">
        <div className="bk-card overflow-hidden bk-rise">
          <div className="h-1.5 w-full bk-solid" />
          <div className="space-y-3 px-6 pb-4 pt-6 text-center @3xl:space-y-4 @3xl:pb-8 @3xl:pt-8">
            <div className={cn("mx-auto mb-2 grid h-16 w-16 place-items-center rounded-2xl shadow-md @3xl:mb-4 @3xl:h-20 @3xl:w-20", confirmed ? "bg-emerald-50" : "bg-amber-50")}>
              {confirmed || requested ? <CheckCircle className="h-9 w-9 text-emerald-600 @3xl:h-12 @3xl:w-12" aria-hidden weight="duotone" /> : <WarningCircle className="h-9 w-9 text-amber-600 @3xl:h-12 @3xl:w-12" aria-hidden weight="duotone" />}
            </div>
            <div className="flex justify-center">
              <Pill tone={tone.pill}>{tone.label}</Pill>
            </div>
            <Editable id="copy:confirmation" label="the confirmation words">
              <h1 data-editable-text className="text-xl font-bold tracking-tight @3xl:text-3xl">{title}</h1>
              <p data-editable-text className="mx-auto mt-2 max-w-md text-xs text-[color:var(--bk-muted-text)] @3xl:text-base">{body}</p>
            </Editable>
          </div>
          <div className="space-y-4 px-4 pb-6 @3xl:space-y-8 @3xl:px-6">
            <div className="rounded-[var(--bk-radius)] border border-[rgb(var(--bk-brand-rgb)/0.2)] bg-[rgb(var(--bk-brand-rgb)/0.05)] p-4 text-left @3xl:p-6">
              <p className="mb-3 flex items-center gap-2 text-base font-semibold @3xl:text-xl">
                <CalendarCheck className="h-5 w-5 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" /> Your booking details
              </p>
              <div className="grid gap-3">
                {view.schedule ? (
                  <>
                    <Row icon={<CalendarBlank className="h-4 w-4" aria-hidden />} label="Date" value={view.schedule.label} />
                    <Row icon={<Clock className="h-4 w-4" aria-hidden />} label="Arrival" value={view.schedule.windowLabel} />
                  </>
                ) : null}
                <Row icon={<House className="h-4 w-4" aria-hidden />} label="Service" value={view.offers.find((o) => o.serviceKey === view.quote?.serviceKey)?.name ?? "—"} />
                {view.address ? <Row icon={<MapPin className="h-4 w-4" aria-hidden />} label="Location" value={`${view.address.line1}, ${view.address.city}, ${view.address.region}`} /> : null}
                {view.payment.state === "succeeded" || view.payment.state === "simulated" ? <Row icon={<Receipt className="h-4 w-4" aria-hidden />} label="Paid" value={moneyExact(view.quote?.dueNowCents ?? 0)} /> : null}
                {view.quote && view.quote.balanceCents > 0 && (view.payment.state === "succeeded" || view.payment.state === "simulated") ? <Row icon={<Receipt className="h-4 w-4" aria-hidden />} label="Due later" value={moneyExact(view.quote.balanceCents)} /> : null}
                <Row icon={<Envelope className="h-4 w-4" aria-hidden />} label="Reference" value={view.confirmation.reference} />
              </div>
              {confirmed && view.schedule && !view.test ? (
                <a href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics(view, company.name))}`} download="booking.ics" className="bk-btn-outline mt-4 h-11 w-full text-sm">
                  <CalendarBlank className="h-4 w-4" aria-hidden /> Add to calendar
                </a>
              ) : null}
            </div>
            {sectionOn(def, "confirmation", "next_steps") && def.content.nextSteps.length ? <NextSteps title="What happens next" /> : null}
            {sectionOn(def, "confirmation", "trust") ? <TrustRow /> : null}
            {confirmed && !view.test ? (
              <div className="bk-card space-y-4 p-5 text-left">
                <p className="flex items-center gap-2 font-semibold">
                  <PencilSimple className="h-4 w-4 text-[color:var(--bk-brand-text)]" aria-hidden weight="duotone" /> Manage your booking
                </p>
                <Field id="bk-access-update" label="Update how the team gets in" help="Only your assigned team sees this.">
                  <textarea id="bk-access-update" className="bk-input resize-none" maxLength={1000} value={access} onChange={(e) => setAccess(e.target.value)} />
                </Field>
                <button type="button" disabled={!access.trim()} onClick={async () => { const r = await actions.updateAccess(access); setSaved(r.ok ? "Access details saved." : r.why); }} className="bk-btn-outline h-10 w-full text-sm">
                  Save access details
                </button>
                <Field id="bk-change" label="Need to change or cancel?" help={`${company.name} will reply. Nothing changes until they confirm.`}>
                  <textarea id="bk-change" className="bk-input resize-none" maxLength={1000} value={change} onChange={(e) => setChange(e.target.value)} />
                </Field>
                <button type="button" disabled={!change.trim()} onClick={async () => { const r = await actions.requestChange("other", change); setSaved(r.ok ? "Your request was sent." : r.why); }} className="bk-btn-outline h-10 w-full text-sm">
                  Send request
                </button>
                {saved ? <p role="status" className="text-sm text-[color:var(--bk-muted-text)]">{saved}</p> : null}
              </div>
            ) : null}
            <p className="text-center text-xs text-[color:var(--bk-muted-text)] @3xl:text-sm">{company.email ? `Questions? Email ${company.email}` : company.phone ? `Questions? Call ${company.phone}` : null}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
