"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { finishCardUpdate } from "@/app/actions/portal-payment";

function Inner() {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error || !setupIntent?.payment_method) {
      setBusy(false);
      toast.error(error?.message ?? "Could not save your card.");
      return;
    }
    const res = await finishCardUpdate(String(setupIntent.payment_method));
    setBusy(false);
    if ("error" in res) {
      toast.error("Saved your card, but couldn't finish. Please retry.");
      return;
    }
    setDone(true);
    toast.success("Your card is updated.");
  }

  if (done)
    return (
      <div className="text-center">
        <p className="font-display text-lg font-bold">You&apos;re all set 🎉</p>
        <p className="mt-1 text-sm text-[#6b6880]">Your card has been updated.</p>
        <button
          onClick={() => router.push("/")}
          className="mt-4 w-full rounded-xl border px-4 py-3 text-sm font-semibold"
        >
          Back to my account
        </button>
      </div>
    );

  return (
    <div className="space-y-4">
      <PaymentElement />
      <button
        onClick={submit}
        disabled={busy}
        className="w-full rounded-xl bg-[#4F38FF] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save card"}
      </button>
    </div>
  );
}

export function CardForm({
  clientSecret,
  stripeAccount,
}: {
  clientSecret: string;
  stripeAccount: string;
}) {
  const [promise] = useState(() =>
    loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!, {
      stripeAccount,
    })
  );
  return (
    <Elements
      stripe={promise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: { colorPrimary: "#4F38FF", borderRadius: "12px" },
        },
      }}
    >
      <Inner />
    </Elements>
  );
}
