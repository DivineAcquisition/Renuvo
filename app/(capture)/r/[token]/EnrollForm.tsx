"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { motion, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { createSignupPaymentSetup } from "@/lib/capture/payment";
import { enrollRecurring } from "@/app/actions/enroll";

type Props = {
  token: string;
  priceCents: number;
  currency: string;
  cadences: { id: string; label: string }[];
  defaultCadenceId: string;
};

function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 text-left text-sm"
    >
      <span
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <motion.span
          layout
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className={`h-4 w-4 rounded-full bg-white shadow ${
            checked ? "ml-auto" : ""
          }`}
        />
      </span>
      <span className="text-muted-foreground">{children}</span>
    </button>
  );
}

function SuccessState() {
  const reduce = useReducedMotion();
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="relative mb-4 flex h-16 w-16 items-center justify-center">
        {!reduce && (
          <motion.span
            className="absolute inset-0 rounded-full bg-primary/20"
            initial={{ scale: 0.6, opacity: 0.8 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        )}
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#6A57FF] to-[#4F38FF] text-white shadow-lg shadow-primary/30">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 13l4 4L19 7"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              className="draw-line"
            />
          </svg>
        </span>
      </div>
      <p className="font-display text-xl font-bold">You&apos;re all set! 🎉</p>
      <p className="mt-1 text-sm text-muted-foreground">
        We&apos;ll text you before each visit. You can cancel anytime.
      </p>
    </div>
  );
}

function InnerForm(props: Props & { customerId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [cadence, setCadence] = useState(props.defaultCadenceId);
  const [smsConsent, setSmsConsent] = useState(true);
  const [billingConsent, setBillingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    if (!billingConsent) {
      setErr("Please authorize recurring billing to continue.");
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

  if (done) return <SuccessState />;

  return (
    <div className="mt-6 space-y-5">
      {/* segmented cadence control */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">How often?</label>
        <div className="flex gap-1 rounded-xl border bg-secondary/50 p-1">
          {props.cadences.map((c) => {
            const active = c.id === cadence;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCadence(c.id)}
                className={`relative flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  active ? "text-white" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="cadence-pill"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    className="absolute inset-0 rounded-lg bg-gradient-to-r from-[#6A57FF] to-[#4F38FF]"
                  />
                )}
                <span className="relative z-10">{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <PaymentElement />

      <div className="space-y-3">
        <Switch checked={billingConsent} onChange={setBillingConsent}>
          I authorize recurring charges for each scheduled visit until I cancel.
        </Switch>
        <Switch checked={smsConsent} onChange={setSmsConsent}>
          Text me reminders before each visit. Reply STOP anytime.
        </Switch>
      </div>

      {err && <p className="text-sm text-destructive">{err}</p>}

      <button
        onClick={submit}
        disabled={busy}
        className="hover-lift w-full rounded-xl bg-gradient-to-r from-[#6A57FF] to-[#4F38FF] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-60"
      >
        {busy ? "Setting up…" : "Confirm recurring service"}
      </button>
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
      <p className="mt-6 text-sm text-destructive">
        This offer isn&apos;t available right now.
      </p>
    );
  if (!stripePromise || !clientSecret || !customerId)
    return <p className="mt-6 text-sm text-muted-foreground">Loading…</p>;

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#4F38FF",
            borderRadius: "10px",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        },
      }}
    >
      <InnerForm {...props} customerId={customerId} />
    </Elements>
  );
}
