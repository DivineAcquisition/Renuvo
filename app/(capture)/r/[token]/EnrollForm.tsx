"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { motion, useReducedMotion } from "framer-motion";
import { createSignupPaymentSetup } from "@/lib/capture/payment";
import { enrollRecurring } from "@/app/actions/enroll";
import { StarMark } from "@/components/ui/logo";
import { fromCents, formatMoney } from "@/lib/money";

type Props = {
  token: string;
  businessName: string;
  firstName: string;
  priceCents: number;
  currency: string;
  cadences: { id: string; label: string }[];
  defaultCadenceId: string;
};

function money(cents: number) {
  return formatMoney(fromCents(cents));
}

/* ---------------- custom toggle switch ---------------- */
function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-[23px] w-10 shrink-0 rounded-full transition-colors"
      style={{
        background: checked
          ? "linear-gradient(120deg,#6A57FF,#4F38FF)"
          : "#D8D5E8",
      }}
    >
      <span
        className="absolute top-0.5 left-0.5 h-[19px] w-[19px] rounded-full bg-white shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(17px)" : "translateX(0)" }}
      />
    </button>
  );
}

/* ---------------- confetti (Web Animations API) ---------------- */
function fireConfetti(container: HTMLDivElement) {
  const colors = ["#4F38FF", "#6A57FF", "#9A8CFF", "#22C55E", "#E0457B"];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    el.style.cssText = `position:absolute;top:0;left:50%;width:8px;height:12px;border-radius:2px;background:${color};will-change:transform,opacity;`;
    container.appendChild(el);
    const dx = (Math.random() * 2 - 1) * 220;
    const dy = window.innerHeight * 0.7 + Math.random() * 120;
    const rot = (Math.random() * 2 - 1) * 720;
    const dur = 1400 + Math.random() * 900;
    el.animate(
      [
        { transform: "translate(-50%,0) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(calc(-50% + ${dx}px), ${dy}px) rotate(${rot}deg)`,
          opacity: 0,
        },
      ],
      { duration: dur, easing: "cubic-bezier(.2,.6,.4,1)", fill: "forwards" }
    );
    window.setTimeout(() => el.remove(), dur + 120);
  }
}

function SuccessView({
  cadenceLabel,
  priceCents,
}: {
  cadenceLabel: string;
  priceCents: number;
}) {
  const reduce = useReducedMotion();
  const confettiRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce || !confettiRef.current) return;
    fireConfetti(confettiRef.current);
  }, [reduce]);

  return (
    <motion.div
      className="flex flex-col items-center py-4 text-center"
      initial={reduce ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {!reduce && (
        <div
          ref={confettiRef}
          className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
        />
      )}

      <div className="relative mb-4 flex h-[88px] w-[88px] items-center justify-center">
        {!reduce && (
          <span className="success-halo absolute inset-0 rounded-full bg-primary/25" />
        )}
        <svg width="88" height="88" viewBox="0 0 88 88" fill="none">
          <circle
            cx="44"
            cy="44"
            r="40"
            stroke="#6A57FF"
            strokeWidth="3"
            pathLength={1}
            className="success-circle"
          />
          <path
            d="M28 45 L40 57 L62 33"
            stroke="#4F38FF"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            className="success-check"
          />
        </svg>
      </div>

      <h2 className="font-display text-2xl font-bold">You&apos;re all set 🎉</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        We&apos;ll text you before each visit. Cancel anytime, no hassle.
      </p>

      <div className="mt-4 rounded-xl bg-secondary px-4 py-2 text-sm">
        <span className="font-semibold text-primary">{cadenceLabel}</span>
        <span className="text-muted-foreground"> · </span>
        <span className="font-mono font-semibold text-primary">
          {money(priceCents)}/visit
        </span>
      </div>
    </motion.div>
  );
}

/* ---------------- the enroll card ---------------- */
function InnerCard(props: Props & { customerId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const emailChannelOn =
    process.env.NEXT_PUBLIC_EMAIL_CHANNEL_ENABLED === "true";
  const [cadence, setCadence] = useState(props.defaultCadenceId);
  const [smsConsent, setSmsConsent] = useState(true);
  const [email, setEmail] = useState("");
  const [emailConsent, setEmailConsent] = useState(false);
  const [billingConsent, setBillingConsent] = useState(false);
  const [billingBlocked, setBillingBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    if (!billingConsent) {
      setBillingBlocked(true);
      return;
    }
    setBusy(true);
    setErr(null);

    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message ?? "Card could not be saved.");
      setBusy(false);
      return;
    }

    const res = await enrollRecurring({
      token: props.token,
      cadenceProfileId: cadence,
      smsConsent,
      billingConsent,
      paymentMethodId: String(setupIntent!.payment_method),
      stripeCustomerId: props.customerId,
      email: emailChannelOn ? email || undefined : undefined,
      emailConsent: emailChannelOn ? emailConsent : false,
    });
    if ("error" in res) {
      setErr(
        res.error === "activation_failed"
          ? "Your card was saved, but we hit a snag finishing setup. Your provider will confirm shortly."
          : res.error
      );
      setBusy(false);
      return;
    }
    setDone(true);
  }

  const cadenceLabel =
    props.cadences.find((c) => c.id === cadence)?.label ?? "Recurring";

  if (done)
    return (
      <div className="glass animate-up rounded-[20px] p-7">
        <SuccessView cadenceLabel={cadenceLabel} priceCents={props.priceCents} />
      </div>
    );

  const buttonLabel = busy
    ? "Setting up…"
    : billingBlocked && !billingConsent
      ? "Please authorize recurring billing"
      : "Confirm recurring service";

  return (
    <div
      className="glass animate-up rounded-[20px] p-7"
      style={{ boxShadow: "0 40px 90px -36px rgba(79,56,255,.42)" }}
    >
      {/* eyebrow */}
      <div className="flex items-center gap-2">
        <StarMark gradient className="h-5 w-5" />
        <span className="text-[13px] font-semibold text-muted-foreground">
          {props.businessName}
        </span>
      </div>

      <h1 className="mt-3 font-display text-[25px] font-bold leading-tight tracking-[-0.025em]">
        Hi {props.firstName}, keep your service going automatically
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Lock in{" "}
        <span className="font-mono font-bold text-foreground">
          {money(props.priceCents)}
        </span>{" "}
        per visit, billed automatically. No rebooking, cancel anytime.
      </p>

      {/* segmented cadence selector */}
      <div className="mt-5">
        <label className="mb-1.5 block text-sm font-medium">How often?</label>
        <div className="flex gap-1 rounded-[13px] bg-secondary p-1">
          {props.cadences.map((c) => {
            const active = c.id === cadence;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCadence(c.id)}
                className={`relative flex-1 rounded-[10px] px-3 py-2 text-xs font-semibold transition-colors ${
                  active ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="cadencePill"
                    transition={{
                      type: "spring",
                      stiffness: 420,
                      damping: 34,
                    }}
                    className="absolute inset-0 rounded-[10px] bg-white shadow-[0_4px_14px_-4px_rgba(79,56,255,0.4)]"
                  />
                )}
                <span className="relative z-10">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* payment field */}
      <div
        className={`mt-4 rounded-xl border p-3 transition-shadow ${
          billingBlocked
            ? "border-primary shadow-[0_0_0_3px_rgba(79,56,255,0.12)]"
            : "border-border"
        }`}
      >
        <PaymentElement />
      </div>

      {/* consent switches */}
      <div className="mt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Authorize recurring charges for each scheduled visit until I cancel.
          </span>
          <ToggleSwitch
            checked={billingConsent}
            onChange={(v) => {
              setBillingConsent(v);
              if (v) setBillingBlocked(false);
            }}
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            Text me reminders before each visit. Reply STOP anytime.
          </span>
          <ToggleSwitch checked={smsConsent} onChange={setSmsConsent} />
        </div>
        {emailChannelOn && (
          <>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium">
                Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                Email me about my service. Unsubscribe anytime.
              </span>
              <ToggleSwitch checked={emailConsent} onChange={setEmailConsent} />
            </div>
          </>
        )}
      </div>

      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="accent-sheen hover-lift relative mt-5 w-full overflow-hidden rounded-xl bg-gradient-to-r from-[#6A57FF] to-[#4F38FF] px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-70"
      >
        <span className="relative z-10">{buttonLabel}</span>
      </button>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        🔒 Secured by Stripe · Cancel anytime ·{" "}
        <span className="font-semibold text-primary">Reply STOP</span> to opt out
      </p>
    </div>
  );
}

export function EnrollForm(props: Props) {
  const [stripePromise, setStripePromise] =
    useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    createSignupPaymentSetup(props.token).then((r) => {
      if ("error" in r) {
        setErr(r.error ?? "unavailable");
        return;
      }
      setStripePromise(
        loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!, {
          stripeAccount: r.connectedAccountId,
        })
      );
      setClientSecret(r.clientSecret);
      setCustomerId(r.stripeCustomerId);
    });
  }, [props.token]);

  if (err)
    return (
      <div className="glass rounded-[20px] p-7">
        <p className="text-sm text-destructive">
          This offer isn&apos;t available right now.
        </p>
      </div>
    );
  if (!stripePromise || !clientSecret || !customerId)
    return (
      <div className="glass rounded-[20px] p-7">
        <div className="shimmer h-5 w-40 rounded" />
        <div className="shimmer mt-3 h-7 w-full rounded" />
        <div className="shimmer mt-4 h-24 w-full rounded" />
      </div>
    );

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#4F38FF",
            colorText: "#141221",
            colorDanger: "#E0457B",
            borderRadius: "12px",
            fontFamily: "Inter, sans-serif",
          },
        },
      }}
    >
      <InnerCard {...props} customerId={customerId} />
    </Elements>
  );
}
