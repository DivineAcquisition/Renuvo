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
import { toast } from "sonner";
import { updateWalletSettingsAction } from "@/app/actions/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="space-y-6">
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

      {props.isOwner && (
        <AutoReloadForm
          enabled={props.autoReloadEnabled}
          thresholdCents={props.reloadThresholdCents}
          amountCents={props.reloadAmountCents}
        />
      )}
    </div>
  );
}

function AutoReloadForm(props: {
  enabled: boolean;
  thresholdCents: number;
  amountCents: number;
}) {
  const [enabled, setEnabled] = useState(props.enabled);
  const [threshold, setThreshold] = useState(props.thresholdCents / 100);
  const [amount, setAmount] = useState(props.amountCents / 100);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await updateWalletSettingsAction({
      autoReloadEnabled: enabled,
      thresholdCents: Math.round(threshold * 100),
      amountCents: Math.round(amount * 100),
    });
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not save.");
    else toast.success("Auto-reload saved.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auto-reload</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Automatically top up when the balance runs low
        </label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Reload when below ($)</Label>
            <Input
              type="number"
              min={0}
              step="1"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={!enabled}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reload amount ($)</Label>
            <Input
              type="number"
              min={1}
              step="1"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              disabled={!enabled}
            />
          </div>
        </div>
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save auto-reload"}
        </Button>
      </CardContent>
    </Card>
  );
}
