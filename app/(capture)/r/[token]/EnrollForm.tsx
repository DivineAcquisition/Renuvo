"use client";

import { useEffect, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { createSignupPaymentSetup } from "@/lib/capture/payment";
import { enrollRecurring } from "@/app/actions/enroll";
import { Button } from "@/components/ui/button";

type Props = {
  token: string;
  priceCents: number;
  currency: string;
  cadences: { id: string; label: string }[];
  defaultCadenceId: string;
};

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
      setErr(res.error);
      setBusy(false);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <div className="mt-6 rounded-lg border p-4">
        <p className="font-display text-lg font-bold text-primary">
          You&apos;re all set! 🎉
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          We&apos;ll text you before each visit. You can cancel anytime.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium">How often?</label>
        <select
          value={cadence}
          onChange={(e) => setCadence(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {props.cadences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <PaymentElement />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={billingConsent}
          onChange={(e) => setBillingConsent(e.target.checked)}
          className="mt-1"
        />
        <span>
          I authorize recurring charges for each scheduled visit until I cancel.
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={smsConsent}
          onChange={(e) => setSmsConsent(e.target.checked)}
          className="mt-1"
        />
        <span>Text me reminders before each visit. Reply STOP anytime.</span>
      </label>

      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button onClick={submit} disabled={busy} className="w-full">
        {busy ? "Setting up…" : "Confirm recurring service"}
      </Button>
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
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <InnerForm {...props} customerId={customerId} />
    </Elements>
  );
}
