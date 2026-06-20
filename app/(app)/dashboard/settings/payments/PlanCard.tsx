"use client";

import { useState } from "react";
import { toast } from "sonner";
import { subscribe, cancelPlan } from "@/app/actions/subscription";
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

export function PlanCard({
  status,
  currentPlanId,
  trialEndsAt,
  currentPeriodEnd,
  plans,
  isOwner,
}: {
  status: string;
  currentPlanId: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  plans: Plan[];
  isOwner: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const live = status === "active" || status === "trialing";

  async function onSubscribe(planId: string) {
    setBusy(true);
    const res = await subscribe(planId);
    setBusy(false);
    if ("error" in res) {
      toast.error(
        res.error === "plan_not_configured"
          ? "This plan isn't configured yet (no Stripe price set)."
          : res.error ?? "Could not start subscription."
      );
    } else {
      toast.success(
        res.status === "trialing" ? "Trial started." : "Subscription started."
      );
    }
  }

  async function onCancel() {
    setBusy(true);
    const res = await cancelPlan();
    setBusy(false);
    if ("error" in res) toast.error(res.error ?? "Could not cancel.");
    else toast.success("Cancellation scheduled for period end.");
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
            Your last payment failed. Update your card below to keep your plan
            active.
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
                      disabled={busy}
                      onClick={() => onSubscribe(p.id)}
                    >
                      {live ? "Switch" : "Choose"}
                    </Button>
                  ))}
              </div>
            );
          })}
        </div>

        {isOwner && live && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            className="text-muted-foreground"
          >
            Cancel plan
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
