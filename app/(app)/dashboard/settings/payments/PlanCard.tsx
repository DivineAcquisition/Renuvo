"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  useStripe,
  useElements,
  PaymentElement,
} from "@stripe/react-stripe-js";
import {
  subscribe,
  cancelPlan,
  openBillingPortal,
} from "@/app/actions/subscription";
import { startSaveCard, confirmSaveCard } from "@/app/actions/wallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { fromCents } from "@/lib/money";

type Plan = { id: string; name: string; price_cents: number };

const STATUS_LABEL: Record<string, string> = {
  none: "No plan",
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
};

/** Card form for the platform customer (shared by the SaaS plan + SMS wallet). */
function CardCapture({
  stripePromise,
  clientSecret,
  onSaved,
  onCancel,
  cta,
}: {
  stripePromise: Promise<Stripe | null>;
  clientSecret: string;
  onSaved: (pmId: string) => void;
  onCancel: () => void;
  cta: string;
}) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CardInner onSaved={onSaved} onCancel={onCancel} cta={cta} />
    </Elements>
  );
}

function CardInner({
  onSaved,
  onCancel,
  cta,
}: {
  onSaved: (pmId: string) => void;
  onCancel: () => void;
  cta: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error || !setupIntent?.payment_method) {
      setBusy(false);
      toast.error(error?.message ?? "Could not save card.");
      return;
    }
    onSaved(String(setupIntent.payment_method));
  }

  return (
    <div className="space-y-3 rounded-xl border bg-secondary/30 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Card details</p>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <div className="rounded-lg border bg-background p-3">
        <PaymentElement />
      </div>
      <Button onClick={save} disabled={busy} className="w-full" variant="gradient">
        {busy ? "Saving…" : cta}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        🔒 Secured by Stripe — your card never touches Renuvo.
      </p>
    </div>
  );
}

export function PlanCard({
  status,
  currentPlanId,
  trialEndsAt,
  currentPeriodEnd,
  plans,
  isOwner,
  hasCard,
}: {
  status: string;
  currentPlanId: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  plans: Plan[];
  isOwner: boolean;
  hasCard: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stripePromise, setStripePromise] =
    useState<Promise<Stripe | null> | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // a plan to subscribe to once the card is captured (null = just adding a card)
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const live = status === "active" || status === "trialing";

  async function doSubscribe(planId: string) {
    setBusy(true);
    const res = await subscribe(planId);
    setBusy(false);
    if ("error" in res) {
      toast.error(
        res.error === "plan_not_configured"
          ? "This plan couldn't be set up in Stripe. Check the platform API key."
          : res.error ?? "Could not start subscription."
      );
      return;
    }
    toast.success(
      "switched" in res && res.switched
        ? "Plan switched."
        : res.status === "trialing"
          ? "Trial started."
          : "Subscription started."
    );
    router.refresh();
  }

  // open the card form; if planId is set we subscribe right after saving
  async function beginCardCapture(planId: string | null) {
    setBusy(true);
    const res = await startSaveCard();
    setBusy(false);
    if (!("clientSecret" in res) || !res.clientSecret || !res.publishableKey) {
      toast.error(
        "error" in res && res.error === "payments_unconfigured"
          ? "Card payments aren't set up yet."
          : "Couldn't open the card form. Please try again."
      );
      return;
    }
    setStripePromise(loadStripe(res.publishableKey));
    setClientSecret(res.clientSecret);
    setPendingPlanId(planId);
  }

  async function onCardSaved(pmId: string) {
    await confirmSaveCard(pmId);
    const planId = pendingPlanId;
    setClientSecret(null);
    setStripePromise(null);
    setPendingPlanId(null);
    toast.success("Card saved.");
    if (planId) await doSubscribe(planId);
    else router.refresh();
  }

  // choosing/switching a plan captures a card first when none is on file, so the
  // subscription always has a payment method before the trial ends.
  function onChoose(planId: string) {
    if (hasCard) doSubscribe(planId);
    else beginCardCapture(planId);
  }

  async function onManageBilling() {
    setBusy(true);
    const res = await openBillingPortal();
    setBusy(false);
    if ("error" in res || !("url" in res)) {
      toast.error("Billing portal is unavailable right now.");
      return;
    }
    window.location.href = res.url;
  }

  async function onCancel() {
    setBusy(true);
    const res = await cancelPlan();
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not cancel.");
    else {
      toast.success("Cancellation scheduled for period end.");
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Your Renuvo plan</CardTitle>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            status === "past_due"
              ? "bg-destructive/10 text-destructive"
              : live
                ? "bg-emerald-100 text-emerald-700"
                : "bg-secondary text-muted-foreground"
          }`}
        >
          {STATUS_LABEL[status] ?? status}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        {live && (
          <p className="text-sm text-muted-foreground">
            {status === "trialing" && trialEndsAt
              ? `Trial ends ${new Date(trialEndsAt).toLocaleDateString()}.`
              : currentPeriodEnd
                ? `Renews ${new Date(currentPeriodEnd).toLocaleDateString()}.`
                : "Your plan is live."}
          </p>
        )}

        {status === "past_due" && (
          <p className="text-sm text-destructive">
            Your last payment failed. Update your card to keep your plan active.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const isCurrent = p.id === currentPlanId && live;
            return (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <Money value={fromCents(p.price_cents)} /> / mo
                  </p>
                </div>
                {isOwner &&
                  (isCurrent ? (
                    <span className="text-xs font-semibold text-primary">
                      Current
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !!clientSecret}
                      onClick={() => onChoose(p.id)}
                    >
                      {live ? "Switch" : "Choose"}
                    </Button>
                  ))}
              </div>
            );
          })}
        </div>

        {/* card capture (shown when choosing a plan without a card, or "Add card") */}
        {isOwner && clientSecret && stripePromise && (
          <CardCapture
            stripePromise={stripePromise}
            clientSecret={clientSecret}
            cta={pendingPlanId ? "Save card & start plan" : "Save card"}
            onSaved={onCardSaved}
            onCancel={() => {
              setClientSecret(null);
              setStripePromise(null);
              setPendingPlanId(null);
            }}
          />
        )}

        {isOwner && !hasCard && !clientSecret && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            <span>
              No card on file{live ? " — add one so billing continues after your trial." : "."}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => beginCardCapture(null)}
            >
              Add card
            </Button>
          </div>
        )}

        {isOwner && live && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={onManageBilling}
            >
              Manage billing
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={onCancel}
              className="text-muted-foreground"
            >
              Cancel plan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
