"use client";

import { useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import {
  startSaveCard,
  confirmSaveCard,
  addFunds,
} from "@/app/actions/wallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function CardSetup({ onSaved }: { onSaved: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message ?? "Could not save card.");
      setBusy(false);
      return;
    }
    await confirmSaveCard(String(setupIntent!.payment_method));
    onSaved();
  }

  return (
    <div className="space-y-3">
      <PaymentElement />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <Button onClick={save} disabled={busy} className="w-full">
        {busy ? "Saving…" : "Save card"}
      </Button>
    </div>
  );
}

export function WalletCard(props: {
  balanceCents: number;
  hasCard: boolean;
  autoReloadEnabled: boolean;
  reloadThresholdCents: number;
  reloadAmountCents: number;
  isOwner: boolean;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function beginAddCard() {
    const res = await startSaveCard();
    if ("clientSecret" in res && res.clientSecret)
      setClientSecret(res.clientSecret);
  }
  async function topUp(amount: number) {
    setAdding(true);
    await addFunds(amount);
    setAdding(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>SMS balance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end justify-between">
          <span className="text-sm text-muted-foreground">Current balance</span>
          <span className="font-mono text-2xl font-bold">
            {money(props.balanceCents)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Messages are billed from this balance at $0.02 each. Auto-reload keeps
          your sequences running.{" "}
          {props.autoReloadEnabled
            ? `Reloads ${money(props.reloadAmountCents)} when below ${money(
                props.reloadThresholdCents
              )}.`
            : "Auto-reload is off."}
        </p>

        {props.isOwner && (
          <>
            {props.hasCard ? (
              <div className="flex gap-2">
                <Button
                  onClick={() => topUp(1000)}
                  disabled={adding}
                  variant="outline"
                >
                  {adding ? "Adding…" : "Add $10"}
                </Button>
                <Button
                  onClick={() => topUp(2500)}
                  disabled={adding}
                  variant="outline"
                >
                  Add $25
                </Button>
              </div>
            ) : clientSecret ? (
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CardSetup onSaved={() => setClientSecret(null)} />
              </Elements>
            ) : (
              <Button onClick={beginAddCard}>Add a card</Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
